// The Lab's database: the same document store the claude.ai `db` capability gave the page
// (JSON documents at slash paths, collections, where/orderBy/limit, live updates), kept in one
// SQLite file on the server. Built on node:sqlite, so there is nothing native to compile.
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";

const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
export const MAX_DOC_BYTES = 256 * 1024;

export function splitPath(path) {
  const p = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!p) return [];
  const segs = p.split("/");
  if (segs.length > 16 || p.length > 1000) throw bad("path is too long");
  for (const s of segs) if (!SEG.test(s) || s === "." || s === ".." || Buffer.byteLength(s) > 200) throw bad(`bad path segment "${s}"`);
  return segs;
}
export function bad(message) { return Object.assign(new Error(message), { code: "invalid_argument" }); }

/* ---------- access rules (the same shape the artifact declared) ---------- */
const LEVEL = { view: 0, interact: 1, admin: 2, owner: 3 };
// rules: [{path:"", read:"interact", write:"interact"}, {path:"pins", read:"interact", write:"owner"},
//         {path:"pins/{self}", write:"interact"}, {path:"data/users/{self}", write:"interact"}]
export function makeRules(rules) {
  const list = (rules || []).map(r => {
    const self = /\/\{self\}$/.test(r.path);
    const base = self ? r.path.replace(/\/\{self\}$/, "") : r.path;
    return { base: base ? base.split("/") : [], self, read: r.read, write: r.write };
  });
  // the platform's default: everyone's data/users/<id> subtree is private, even from the owner
  if (!list.some(r => r.self && r.base.join("/") === "data/users")) list.push({ base: ["data", "users"], self: true });
  return list;
}
function under(segs, base) { return base.length <= segs.length && base.every((s, i) => segs[i] === s); }
// Can `who` ({id, level}) do `act` ("read"|"write") at segs?
export function allowed(rules, who, act, segs) {
  if (!who) return false;
  let need = { read: "view", write: "interact" };
  // walk from the shallowest rule to the deepest; deeper rules override
  const hits = rules.filter(r => under(segs, r.base)).sort((a, b) => a.base.length - b.base.length || (a.self ? 1 : -1));
  for (const r of hits) {
    if (r.self) {
      const owner = segs[r.base.length];
      if (owner === undefined) continue; // the prefix itself: its own rule decides
      if (owner !== who.id) return false; // a sibling's subtree is private
      need = { read: r.read || need.read, write: r.write || need.write };
    } else {
      need = { read: r.read || need.read, write: r.write || need.write };
    }
  }
  if (LEVEL[need.write] < LEVEL[need.read]) need.write = need.read;
  const lvl = LEVEL[who.level] ?? -1;
  return act === "read" ? lvl >= LEVEL[need.read] : lvl >= LEVEL[need.write];
}

/* ---------- the store ---------- */
export class Store extends EventEmitter {
  constructor(file, rules) {
    super();
    this.setMaxListeners(0);
    this.sql = new DatabaseSync(file);
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, coll TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL, by TEXT, lease_holder TEXT, lease_until INTEGER);
      CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll);
      CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, by TEXT, before TEXT);`);
    this.rules = makeRules(rules);
    this.q = {
      get: this.sql.prepare("SELECT body, version FROM docs WHERE path=?"),
      coll: this.sql.prepare("SELECT id, body, version FROM docs WHERE coll=?"),
      put: this.sql.prepare(`INSERT INTO docs(path,coll,id,body,version,updated,by) VALUES(?,?,?,?,1,?,?)
        ON CONFLICT(path) DO UPDATE SET body=excluded.body, version=docs.version+1, updated=excluded.updated, by=excluded.by`),
      del: this.sql.prepare("DELETE FROM docs WHERE path=?"),
      log: this.sql.prepare("INSERT INTO changes(path,kind,at,by,before) VALUES(?,?,?,?,?)"),
      lease: this.sql.prepare("SELECT lease_holder, lease_until FROM docs WHERE path=?"),
      setLease: this.sql.prepare("UPDATE docs SET lease_holder=?, lease_until=? WHERE path=?"),
      count: this.sql.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(body)),0) AS bytes FROM docs"),
      trim: this.sql.prepare("DELETE FROM changes WHERE seq < (SELECT MAX(seq) FROM changes) - 50000"),
    };
  }
  close() { this.sql.close(); }

  docPath(path) { const s = splitPath(path); if (s.length % 2 !== 0 || !s.length) throw bad("a document path has an even number of segments"); return s; }
  collPath(path) { const s = splitPath(path); if (s.length % 2 !== 1) throw bad("a collection path has an odd number of segments"); return s; }

  get(who, path) {
    const s = this.docPath(path);
    if (!allowed(this.rules, who, "read", s)) return { id: s.at(-1), exists: false };
    const row = this.q.get.get(s.join("/"));
    return row ? { id: s.at(-1), exists: true, data: JSON.parse(row.body), version: row.version } : { id: s.at(-1), exists: false };
  }

  query(who, path, opts = {}) {
    const s = this.collPath(path);
    const coll = s.join("/");
    let rows = this.q.coll.all(coll)
      .filter(r => allowed(this.rules, who, "read", s.concat(r.id)))
      .map(r => ({ id: r.id, data: JSON.parse(r.body), version: r.version }));
    for (const [field, op, value] of opts.where || []) rows = rows.filter(r => test(r.data[field], op, value));
    if (opts.orderBy) {
      const [f, dir] = opts.orderBy; const sign = dir === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        const x = a.data[f], y = b.data[f];
        if (x === undefined && y === undefined) return a.id < b.id ? -1 : 1;
        if (x === undefined) return 1; if (y === undefined) return -1; // missing sorts last
        const c = cmp(x, y); return c ? c * sign : (a.id < b.id ? -1 : 1);
      });
    } else rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (opts.limit) rows = rows.slice(0, Math.max(1, Math.min(1000, opts.limit | 0)));
    return rows;
  }

  write(who, path, kind, data) {
    const s = this.docPath(path), p = s.join("/");
    if (!allowed(this.rules, who, "write", s)) throw bad("not allowed to write here");
    const before = this.q.get.get(p);
    let body;
    if (kind === "delete") {
      if (!before) return { ok: true };
      this.q.del.run(p);
    } else {
      if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("a document body is a plain object");
      if (kind === "update") {
        if (!before) throw bad("update needs an existing document");
        body = deepMerge(JSON.parse(before.body), data);
      } else body = data;
      const json = JSON.stringify(body);
      if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw bad("a document is over 256 KiB");
      if (depth(body) > 32) throw bad("a document is over 32 levels deep");
      this.q.put.run(p, s.slice(0, -1).join("/"), s.at(-1), json, Date.now(), who.id);
    }
    this.q.log.run(p, kind, Date.now(), who.id, before ? before.body : null);
    if (Math.random() < 0.01) this.q.trim.run();
    this.emit("change", { path: p, coll: s.slice(0, -1).join("/"), kind });
    return { ok: true };
  }

  acquire(who, path, { holder, ttlMs, data } = {}) {
    const s = this.docPath(path), p = s.join("/");
    if (!allowed(this.rules, who, "write", s)) throw bad("not allowed to write here");
    const ttl = Math.min(600000, Math.max(1000, ttlMs || 30000)), now = Date.now();
    if (!this.q.get.get(p)) this.q.put.run(p, s.slice(0, -1).join("/"), s.at(-1), "{}", now, who.id);
    const l = this.q.lease.get(p);
    if (l.lease_holder && l.lease_until > now && l.lease_holder !== String(holder)) return { acquired: false, expiresAt: new Date(l.lease_until).toISOString() };
    if (data) this.write(who, p, "update", data);
    this.q.setLease.run(String(holder), now + ttl, p);
    return { acquired: true, holder: String(holder), version: this.q.get.get(p).version, expiresAt: new Date(now + ttl).toISOString() };
  }

  stats() { return this.q.count.get(); }

  // Everything, for backups and the move from claude.ai (ignores access rules: owner-only callers).
  *dump() { for (const r of this.sql.prepare("SELECT path, body FROM docs ORDER BY path").iterate()) yield { path: r.path, data: JSON.parse(r.body) }; }
  importDoc(path, data, by = "import") {
    const s = this.docPath(path);
    this.q.put.run(s.join("/"), s.slice(0, -1).join("/"), s.at(-1), JSON.stringify(data), Date.now(), by);
  }
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}
function depth(v, d = 1) { if (!v || typeof v !== "object") return d - 1; let m = d; for (const x of Object.values(v)) m = Math.max(m, depth(x, d + 1)); return m; }
function cmp(a, b) {
  const t = v => (v === null ? 0 : typeof v === "boolean" ? 1 : typeof v === "number" ? 2 : typeof v === "string" ? 3 : 4);
  if (t(a) !== t(b)) return t(a) - t(b);
  if (typeof a === "number" || typeof a === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean") return Number(a) - Number(b);
  const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0;
}
function eq(a, b) { return a === b || (a && b && typeof a === "object" && JSON.stringify(a) === JSON.stringify(b)); }
export function test(v, op, val) {
  switch (op) {
    case "==": return eq(v, val);
    case "!=": return v !== undefined && !eq(v, val);
    case "<": return v !== undefined && cmp(v, val) < 0;
    case "<=": return v !== undefined && cmp(v, val) <= 0;
    case ">": return v !== undefined && cmp(v, val) > 0;
    case ">=": return v !== undefined && cmp(v, val) >= 0;
    case "in": return Array.isArray(val) && val.some(x => eq(v, x));
    case "not-in": return v !== undefined && Array.isArray(val) && !val.some(x => eq(v, x));
    case "array-contains": return Array.isArray(v) && v.some(x => eq(x, val));
    case "array-contains-any": return Array.isArray(v) && Array.isArray(val) && v.some(x => val.some(y => eq(x, y)));
    default: throw bad(`unknown operator ${op}`);
  }
}
