/* The Lab's runtime on Aaron's own server.
   On claude.ai the page got six built-ins from `window.claude.use(name)`: db, assets, sample, mcp, user, downloads.
   This file gives the page the same calls, answered by the Lab server, so the Lab's own code runs unchanged. */
(() => {
  "use strict";
  if (window.claude && window.claude.use) return;

  const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});
  async function api(path, init) {
    let r;
    try { r = await fetch(path, { credentials: "same-origin", ...init }); }
    catch (e) { throw err("unavailable", "The Lab server didn't answer."); }
    if (r.status === 401) { signedOut(); throw err("revoked", "Signed out."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw err((j.error && j.error.code) || "unavailable", (j.error && j.error.message) || `HTTP ${r.status}`, j.error && j.error.status ? { status: j.error.status } : null);
    return j;
  }
  const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let wentOut = false;
  function signedOut() { if (wentOut) return; wentOut = true; location.href = "/_lab/login?next=" + encodeURIComponent(location.pathname + location.search); }

  /* ======================= user ======================= */
  let meP = null;
  const meta = () => (meP ||= api("/_lab/user"));
  const LV = { view: 0, interact: 1, admin: 2, owner: 3 };
  const profile = (p, myId) => ({ id: p.id, name: p.name || "", avatarUrl: "", color: p.color || "#888", email: null, isMe: p.id === myId, guest: false });
  const user = ({
    async id() { return (await meta()).me.id; },
    async isOwner() { return (await meta()).me.level === "owner"; },
    async canEdit() { return LV[(await meta()).me.level] >= LV.admin; },
    async can(name) { const l = LV[(await meta()).me.level]; return name === "data.write" ? l >= LV.interact : null; },
    async me() { const m = (await meta()).me; return { id: m.id, name: m.name, avatarUrl: "", color: m.color || "#888", email: null, isOwner: m.level === "owner", canEdit: LV[m.level] >= LV.admin }; },
    async name() { return (await meta()).me.name; },
    async avatarUrl() { return null; },
    async email() { return null; },
    async profiles(ids) {
      const m = await meta(); const want = [].concat(ids || []); const out = {};
      for (const id of want) { const p = m.people.find(x => x.id === id); if (p) out[id] = profile(p, m.me.id); }
      return out;
    },
    async search(q) { const m = await meta(); q = String(q || "").toLowerCase(); return m.people.filter(p => !q || p.name.toLowerCase().includes(q)).map(p => profile(p, m.me.id)); },
  });

  /* ======================= db ======================= */
  const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
  function segs(path) {
    if (typeof path !== "string") throw new TypeError("a db path is a string");
    const p = path.replace(/^\/+|\/+$/g, ""); const s = p ? p.split("/") : [];
    if (s.length > 16 || p.length > 1000) throw new TypeError("a db path has at most 16 segments and 1000 bytes");
    for (const x of s) if (!SEG.test(x) || x === "." || x === "..") throw new TypeError(`bad path segment "${x}"`);
    return s;
  }
  const newId = () => { const a = new Uint8Array(20); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("").slice(0, 20); };
    const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  function docSnap(id, exists, data) { const d = exists ? data : undefined; return { id, exists, data: () => d, metadata: META }; }
  const dbCall = async b => { try { return await post("/_lab/db", b); } catch (e) { if (e.code === "unavailable") { await new Promise(r => setTimeout(r, 300 + Math.random() * 500)); return post("/_lab/db", b); } throw e; } };

  // live updates: one event stream; each listener refetches when something it watches changes
  const watchers = new Set();
  let es = null, esOpen = false;
  function stream() {
    if (es) return;
    es = new EventSource("/_lab/events");
    es.onopen = () => { if (esOpen === null) for (const w of watchers) w.refresh(); esOpen = true; };
    es.onerror = () => { esOpen = null; }; // EventSource reconnects by itself; refresh everything when it does
    es.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.mcp) { mcpChanged(m.mcp); return; }
      for (const w of watchers) if (w.matches(m)) w.kick();
    };
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") for (const w of watchers) w.refresh(); });

  function listen(matches, load, next, error) {
    let alive = true, timer = null, busy = false, again = false;
    const w = {
      matches,
      kick() { clearTimeout(timer); timer = setTimeout(() => w.refresh(), 40); },
      async refresh() {
        if (!alive) return; if (busy) { again = true; return; } busy = true;
        try { const s = await load(); if (alive) next(s); }
        catch (e) { if (alive && e.code !== "unavailable" && error) { error({ code: e.code, message: e.message }); if (e.code === "invalid_argument" || e.code === "revoked") stop(); } }
        finally { busy = false; if (again && alive) { again = false; w.refresh(); } }
      },
    };
    const stop = () => { alive = false; clearTimeout(timer); watchers.delete(w); };
    watchers.add(w); stream(); w.refresh();
    return stop;
  }

  function docRef(path) {
    const s = segs(path);
    if (!s.length || s.length % 2) throw new TypeError(`a document path has an even number of segments (got ${s.length})`);
    const p = s.join("/"), id = s.at(-1);
    const get = async () => { const r = await dbCall({ op: "get", path: p }); return docSnap(id, !!r.exists, r.data); };
    const plain = (d, what) => { if (!d || typeof d !== "object" || Array.isArray(d)) throw err("invalid_argument", what + " takes a plain object"); return JSON.parse(JSON.stringify(d)); };
    return ({
      id, path: p, get,
      async set(d) { await dbCall({ op: "set", path: p, data: plain(d, "set") }); },
      async update(d) { await dbCall({ op: "update", path: p, data: plain(d, "update") }); },
      async delete() { await dbCall({ op: "delete", path: p }); },
      async acquire(o) { if (!o || !o.holder) throw err("invalid_argument", "acquire needs a holder"); return dbCall({ op: "acquire", path: p, options: o }); },
      onSnapshot(next, error) {
        let last;
        return listen(m => m.p === p, get, snap => { const key = JSON.stringify([snap.exists, snap.data()]); if (key !== last) { last = key; next(snap); } }, error);
      },
      collection(sub) { return collRef(p + "/" + String(sub).replace(/^\/+/, "")); },
    });
  }

  function query(p, q) {
    const run = async () => {
      const r = await dbCall({ op: "query", path: p, where: q.where, orderBy: q.orderBy, limit: q.limit });
      return r.docs;
    };
    const snapOf = (docs, changes) => {
      const ds = docs.map(d => docSnap(d.id, true, d.data));
      return ({ docs: ds, size: ds.length, empty: !ds.length, docChanges: () => changes(ds), metadata: META });
    };
    const self = {
      where(f, op, v) { if ((q.where || []).length >= 10) throw err("invalid_argument", "at most 10 filters"); return query(p, { ...q, where: [...(q.where || []), [f, op, v]] }); },
      orderBy(f, dir = "asc") { return query(p, { ...q, orderBy: [f, dir === "desc" ? "desc" : "asc"] }); },
      limit(n) { return query(p, { ...q, limit: n }); },
      async get() { const docs = await run(); return snapOf(docs, ds => ds.map((doc, i) => ({ type: "added", doc, oldIndex: -1, newIndex: i }))); },
      onSnapshot(next, error) {
        let prev = null; // [{id, key}]
        return listen(m => m.c === p, run, docs => {
          const now = docs.map(d => ({ id: d.id, key: d.version + ":" + JSON.stringify(d.data) }));
          if (prev && prev.length === now.length && prev.every((x, i) => x.id === now[i].id && x.key === now[i].key)) return;
          const before = prev || []; prev = now;
          next(snapOf(docs, ds => {
            const out = [], oldIx = new Map(before.map((x, i) => [x.id, i])), newIx = new Map(now.map((x, i) => [x.id, i]));
            before.forEach((x, i) => { if (!newIx.has(x.id)) out.push({ type: "removed", doc: docSnap(x.id, false), oldIndex: i, newIndex: -1 }); });
            ds.forEach((doc, i) => {
              const o = oldIx.get(doc.id);
              if (o === undefined) out.push({ type: "added", doc, oldIndex: -1, newIndex: i });
              else if (before[o].key !== now[i].key || o !== i) out.push({ type: "modified", doc, oldIndex: o, newIndex: i });
            });
            return out;
          }));
        }, error);
      },
    };
    return self;
  }
  function collRef(path) {
    const s = segs(path);
    if (s.length % 2 !== 1) throw new TypeError(`a collection path has an odd number of segments (got ${s.length})`);
    const p = s.join("/");
    return ({
      ...query(p, {}), path: p, id: s.at(-1),
      doc(id) { return docRef(p + "/" + (id === undefined ? newId() : id)); },
      async add(d) { const ref = docRef(p + "/" + newId()); await ref.set(d); return ref; },
    });
  }
  const db = ({ doc: docRef, collection: collRef });

  /* ======================= assets ======================= */
  const assets = ({
    async upload(blob, opts) {
      if (!(blob instanceof Blob)) throw err("invalid_request", "upload takes a Blob");
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      const name = blob.name ? "?name=" + encodeURIComponent(blob.name) : "";
      return api("/_lab/assets" + name, { method: "PUT", headers: { "content-type": type }, body: blob });
    },
    list() { return api("/_lab/assets"); },
    async delete(ref) { const m = String(ref || "").match(/[0-9a-f]{32}/); if (!m) return { deleted: false }; return api("/_lab/assets/" + m[0], { method: "DELETE" }); },
  });

  /* ======================= sample (ask Claude / Alice) ======================= */
  const b64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const memo = new Map();
  async function aiTurn(body, signal, onDelta) {
    let r;
    try { r = await fetch("/_lab/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (e) { if (signal && signal.aborted) throw err("cancelled", "cancelled"); throw err("upstream_error", "The Lab server didn't answer."); }
    if (r.status === 401) { signedOut(); throw err("session_expired", "Signed out."); }
    if (!r.ok || !r.body) throw err("upstream_error", `HTTP ${r.status}`);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", result = null, fault = null;
    try {
      while (true) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find(l => l.startsWith("data:")); if (!line) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.t === "delta" || ev.t === "reset") onDelta(ev);
          else if (ev.t === "done") result = ev.result; else if (ev.t === "error") fault = ev.error;
        }
      }
    } catch (e) { if (signal && signal.aborted) throw err("cancelled", "cancelled"); throw err("upstream_error", e.message); }
    if (fault) throw err(fault.code, fault.message);
    if (!result) throw err("upstream_error", "The answer stopped early.");
    return result;
  }
  async function sample(input, opts = {}) {
    if (typeof input === "string") input = [{ role: "user", content: input }];
    if (!Array.isArray(input) || !input.length || input.at(-1).role !== "user") throw err("invalid_request", "input is a string or messages ending with a user message");
    const tools = opts.tools || [];
    const images = opts.images ? Array.from(opts.images instanceof Blob ? [opts.images] : opts.images) : [];
    const useCache = opts.cache !== false && !tools.length && !images.length && !opts.onText;
    const key = useCache ? JSON.stringify([input, opts.modelTier, opts.model, opts.effort]) : null;
    if (key && memo.has(key) && memo.get(key).until > Date.now() && !(opts.cache && opts.cache.refresh)) return memo.get(key).value;
    const body = {
      messages: input.map(m => ({ role: m.role, content: String(m.content) })),
      modelTier: opts.modelTier || "default", model: opts.model, effort: opts.effort,
      tools: tools.map(t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} } })),
      images: await Promise.all(images.map(async im => ({ media_type: im.type || "image/png", data: await b64(im) }))),
    };
    let text = "";
    const say = ev => { if (ev.t === "reset") text = ""; else text += ev.text; if (opts.onText) try { opts.onText({ text, delta: ev.t === "reset" ? "" : ev.text }); } catch {} };
    for (let round = 0; round < 25; round++) {
      if (opts.signal && opts.signal.aborted) throw err("cancelled", "cancelled");
      const turnStart = text.length;
      const r = await aiTurn(body, opts.signal, say);
      const uses = (r.content || []).filter(b => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || !uses.length) {
        const final = (r.content || []).filter(b => b.type === "text").map(b => b.text).join("");
        if (!final.trim()) throw err("empty_completion", "The answer was empty.", { text });
        const value = { text: final, truncated: r.stop_reason === "max_tokens", modelTierApplied: r.tierApplied || body.modelTier, modelApplied: r.modelApplied };
        if (key) memo.set(key, { value, until: Date.now() + ((opts.cache && opts.cache.gcTime) || 5 * 60e3) });
        return value;
      }
      // run the page's own tools, then continue the same conversation
      body.messages.push({ role: "assistant", content: r.content });
      body.images = [];
      const results = [];
      for (const u of uses) {
        const t = tools.find(x => x.name === u.name);
        let out, isErr = false;
        try { if (!t) throw new Error("no tool called " + u.name); out = await t.execute(u.input || {}, { signal: opts.signal || new AbortController().signal }); }
        catch (e) { isErr = true; out = (e && e.message) || String(e); }
        results.push({ type: "tool_result", tool_use_id: u.id, content: typeof out === "string" ? out : JSON.stringify(out === undefined ? null : out), ...(isErr ? { is_error: true } : {}) });
      }
      body.messages.push({ role: "user", content: results });
      if (text.length > turnStart) say({ t: "delta", text: "\n\n" });
    }
    throw err("upstream_error", "Too many tool rounds.");
  }
  sample.json = async (input, opts) => {
    const r = await sample(input, opts);
    const t = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(t); } catch {}
    const m = t.match(/[\[{][\s\S]*[\]}]/); if (m) try { return JSON.parse(m[0]); } catch {}
    throw err("invalid_json", "The answer wasn't JSON.", { text: r.text });
  };
  let limitsP = null;
  sample.limits = () => (limitsP ||= api("/_lab/ai/limits"));

  /* ======================= mcp (connectors) ======================= */
  const cache = new Map(); // key -> {result, at}
  const mwatch = new Set();
  const ckey = (s, t, i) => JSON.stringify([s, t, i === undefined ? {} : i]);
  // The engine page's Cloudflare code runs here, as it ran in the connector: `cloudflare.request` and `accountId`
  // are given to it, and each request goes to the Lab server, which only lets through the engine's queue and buckets.
  let cfAccount = null;
  async function cfExecute(code) {
    if (!cfAccount) cfAccount = (await api("/_lab/mcp/tools")).cloudflare?.accountId || "";
    const cloudflare = {
      async request({ method = "GET", path, body, contentType } = {}) {
        let b = body;
        if (b instanceof ArrayBuffer) b = new Uint8Array(b);
        if (ArrayBuffer.isView(b)) b = { __bytes: await b64(new Blob([b])) };
        else if (b instanceof Blob) b = { __bytes: await b64(b) };
        const r = await post("/_lab/cf", { method, path, body: b, contentType });
        if (r.kind === "bytes") { const bin = atob(r.value); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
        return r.value;
      },
    };
    const fn = new Function("cloudflare", "accountId", `"use strict"; return (${code})();`);
    return fn(cloudflare, cfAccount);
  }
  async function callTool(server, tool, input, options = {}) {
    const k = ckey(server, tool, input);
    const c = options.cache === false ? null : options.cache || {};
    if (c && !c.refresh && cache.has(k) && Date.now() - cache.get(k).at < (c.staleTime ?? 0)) return { ...cache.get(k).result, cache: { storedAt: cache.get(k).at, revalidating: false } };
    let result;
    try {
      if (server === "cloudflare" && tool === "execute") {
        const payload = await cfExecute(String((input && input.code) || ""));
        result = { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload ?? null) }], payload };
      } else result = await post("/_lab/mcp", { server, tool, input: input ?? {} });
    } catch (e) {
      if (options.signal && options.signal.aborted) throw err("cancelled", "cancelled");
      throw err(e.code || "tool_error", e.message, { server, retryable: e.code === "server_unavailable" || e.code === "unavailable" });
    }
    cache.set(k, { result, at: Date.now() });
    return result;
  }
  function mcpChanged(server) { for (const w of mwatch) if (w.server === server) w.run(); }
  const mcp = ({
    callTool,
    watchTool(server, tool, input, handler, opts = {}) {
      const k = ckey(server, tool, input);
      const w = {
        server, tool, input, alive: true, timer: null,
        async run() {
          if (!w.alive) return;
          try { const r = await callTool(server, tool, input, { cache: false }); if (w.alive) handler({ type: "data", result: { ...r, cache: { storedAt: Date.now(), revalidating: false } } }); }
          catch (e) { if (w.alive) handler({ type: "error", error: { code: e.code, message: e.message, server, retryable: !!e.retryable } }); }
        },
      };
      if (cache.has(k)) { const c = cache.get(k); queueMicrotask(() => w.alive && handler({ type: "data", result: { ...c.result, cache: { storedAt: c.at, revalidating: true } } })); }
      mwatch.add(w); stream(); w.run();
      if (opts.refetchInterval) w.timer = setInterval(() => document.visibilityState === "visible" && w.run(), Math.max(5000, opts.refetchInterval));
      return () => { w.alive = false; clearInterval(w.timer); mwatch.delete(w); };
    },
    async invalidate(server, tool, input) {
      for (const k of [...cache.keys()]) { const [s, t, i] = JSON.parse(k); if ((!server || s === server) && (!tool || t === tool) && (input === undefined || JSON.stringify(i) === JSON.stringify(input))) cache.delete(k); }
      for (const w of mwatch) if ((!server || w.server === server) && (!tool || w.tool === tool)) w.run();
    },
    async listTools(server) { const r = await api("/_lab/mcp/tools"); return { servers: server ? r.servers.filter(s => s.server === server) : r.servers }; },
    async server(name) {
      const r = await api("/_lab/mcp/tools"); const s = r.servers.find(x => x.server === name);
      if (!s) throw err("server_not_found", `No connector called ${name}`);
      const h = {}; for (const t of s.tools) h[t.name] = (input, o) => callTool(name, t.name, input, o).then(x => x.payload);
      return h;
    },
    async describeTool(server, tool) { return { name: tool, description: tool, inputSchema: { type: "object" } }; },
  });

  /* ======================= downloads ======================= */
  const downloads = ({
    async save({ filename, data } = {}) {
      if (!filename || data == null) throw err("invalid_request", "save needs a filename and data");
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = String(filename).replace(/[\\/:*?"<>|]+/g, "-");
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return { saved: true };
    },
  });

  const NS = { db, assets, sample, mcp, user, downloads };
  window.claude = Object.freeze({ use: async name => NS[name] || null }); // the namespaces stay plain objects: the Lab wraps db in a Proxy

  // the app shell: install as an app, and start offline with the last good copy of the page files
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
