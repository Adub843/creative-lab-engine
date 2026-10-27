// Creative Lab Studios on Cloudflare: one Worker serves the console's files (public/) and a small
// API that stands in for the claude.ai page runtime (public/cf-claude.js):
//   /api/login, /api/logout  team key -> signed session cookie (the key is the CONSOLE_KEY secret)
//   /api/db/*                document store in D1 (table docs), same paths the console always used
//   /api/changes             which collections changed since a time, so open pages refresh
//   /api/assets, /_blob/:id  uploaded files in KV (HQ_ASSETS); files moved from claude.ai ship in public/_blob
//   /api/sample              Ask Stephanie and the other AI helpers, through the Anthropic API
// Secrets are set with `npx wrangler secret put NAME` and never written here.

const COOKIE = "hq_session";
const SESSION_DAYS = 30;
const ID_RE = /^[0-9a-f]{32}$/;
const MAX_ASSET = 20 * 1024 * 1024;
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };

const SITE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(req, env) {
    try {
      return withHeaders(await route(req, env));
    } catch (e) {
      console.error("hq", e && e.stack || e);
      return withHeaders(json({ error: "server_error" }, 500));
    }
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/api/login" && req.method === "POST") return login(req, env);
  if (p === "/api/logout" && req.method === "POST") return logout();
  if (p === "/login" || p === "/login.html" || p === "/favicon.ico" || p === "/robots.txt") {
    return env.ASSETS.fetch(new Request(new URL(p === "/login" ? "/login.html" : p, url), req));
  }

  const signedIn = await checkSession(req, env);
  if (!signedIn) {
    if (p.startsWith("/api/") || p.startsWith("/_blob/")) return json({ error: "signed_out" }, 401);
    return Response.redirect(new URL("/login", url).href, 302);
  }

  if (p === "/api/session") return json({ ok: true });
  if (p === "/api/changes") return changes(url, env);
  if (p.startsWith("/api/db/")) return dbRoute(req, env, decodeURIComponent(p.slice(8)), url);
  if (p === "/api/assets" && req.method === "POST") return assetUpload(req, env);
  if (p === "/api/assets" && req.method === "GET") return assetList(env);
  if (p.startsWith("/api/assets/") && req.method === "DELETE") return assetDelete(env, p.slice(12));
  if (p.startsWith("/_blob/")) return blob(req, env, p.slice(7));
  if (p === "/api/sample" && req.method === "POST") return sample(req, env);
  if (p.startsWith("/api/")) return json({ error: "not_found" }, 404);
  return env.ASSETS.fetch(req);
}

/* ---------- sessions ---------- */

async function login(req, env) {
  if (!env.CONSOLE_KEY) return json({ error: "not_set_up" }, 503);
  let body = {};
  try { body = await req.json(); } catch {}
  const key = String(body.key || "");
  if (!(await sameText(key, env.CONSOLE_KEY))) return json({ error: "wrong_key" }, 401);
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = exp + "." + (await sign(env, "hq|" + exp));
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
    },
  });
}

function logout() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
}

async function checkSession(req, env) {
  if (!env.CONSOLE_KEY) return false;
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9]+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now()) return false;
  return sameText(m[2], await sign(env, "hq|" + m[1]));
}

async function sign(env, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CONSOLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map((t) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

/* ---------- documents ---------- */

// A path with an odd number of segments is a collection ("ideas", "data/users/team"); even is a
// document ("ideas/abc", "brief/today"). Each document row keeps its collection path for listing.
export function splitPath(path) {
  const segs = String(path || "").split("/").filter(Boolean);
  if (!segs.length || segs.length > 12 || segs.some((s) => s.length > 200 || s === "." || s === "..")) return null;
  return segs;
}

async function dbRoute(req, env, path, url) {
  const segs = splitPath(path);
  if (!segs) return json({ error: "bad_path" }, 400);
  const isDoc = segs.length % 2 === 0;
  if (!isDoc) {
    const coll = segs.join("/");
    if (req.method === "GET") return listDocs(env, coll, url);
    if (req.method === "POST") {
      const data = await bodyObject(req);
      if (!data) return json({ error: "bad_body" }, 400);
      const id = newId();
      await putDoc(env, coll + "/" + id, coll, id, data);
      return json({ id });
    }
    return json({ error: "method" }, 405);
  }
  const id = segs[segs.length - 1], coll = segs.slice(0, -1).join("/"), full = segs.join("/");
  if (req.method === "GET") {
    const row = await env.DB.prepare("SELECT data FROM docs WHERE path=?").bind(full).first();
    return json(row ? { exists: true, id, data: JSON.parse(row.data) } : { exists: false, id });
  }
  if (req.method === "PUT") {
    const data = await bodyObject(req);
    if (!data) return json({ error: "bad_body" }, 400);
    await putDoc(env, full, coll, id, data);
    return json({ ok: true });
  }
  if (req.method === "PATCH") {
    const patch = await bodyObject(req);
    if (!patch) return json({ error: "bad_body" }, 400);
    const row = await env.DB.prepare("SELECT data FROM docs WHERE path=?").bind(full).first();
    if (!row) return json({ error: "not_found" }, 404);
    await putDoc(env, full, coll, id, applyPatch(JSON.parse(row.data), patch));
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM docs WHERE path=?").bind(full),
      env.DB.prepare("INSERT OR REPLACE INTO deleted(path,coll,at) VALUES(?,?,?)").bind(full, coll, now),
    ]);
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}

// update() merges top-level fields; a dotted key ("a.b") sets one nested field, as Firestore does.
export function applyPatch(doc, patch) {
  const out = { ...doc };
  for (const [k, v] of Object.entries(patch)) {
    if (!k.includes(".")) { out[k] = v; continue; }
    const parts = k.split(".");
    let o = out;
    for (const part of parts.slice(0, -1)) {
      o[part] = o[part] && typeof o[part] === "object" && !Array.isArray(o[part]) ? { ...o[part] } : {};
      o = o[part];
    }
    o[parts[parts.length - 1]] = v;
  }
  return out;
}

async function putDoc(env, path, coll, id, data) {
  const text = JSON.stringify(data);
  if (text.length > 900000) throw Object.assign(new Error("doc_too_large"), { code: 413 });
  await env.DB.prepare("INSERT OR REPLACE INTO docs(path,coll,id,data,updated) VALUES(?,?,?,?,?)").bind(path, coll, id, text, Date.now()).run();
}

async function listDocs(env, coll, url) {
  const field = url.searchParams.get("orderBy");
  const dir = url.searchParams.get("dir") === "desc" ? "DESC" : "ASC";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "2000", 10) || 2000, 1), 5000);
  let sql = "SELECT id,data FROM docs WHERE coll=?";
  const args = [coll];
  if (field && /^[A-Za-z0-9_.]{1,80}$/.test(field)) {
    sql += ` ORDER BY json_extract(data, ?) ${dir}, id ${dir}`;
    args.push("$." + field);
  } else sql += " ORDER BY id";
  sql += " LIMIT ?";
  args.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ docs: results.map((r) => ({ id: r.id, data: JSON.parse(r.data) })) });
}

async function changes(url, env) {
  const since = Number(url.searchParams.get("since") || 0) || 0;
  const now = Date.now();
  const [a, b] = await env.DB.batch([
    env.DB.prepare("SELECT DISTINCT coll FROM docs WHERE updated>?").bind(since),
    env.DB.prepare("SELECT DISTINCT coll FROM deleted WHERE at>?").bind(since),
  ]);
  const colls = [...new Set([...a.results, ...b.results].map((r) => r.coll))];
  return json({ now, colls });
}

async function bodyObject(req) {
  try {
    const v = await req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return Date.now().toString(36) + [...b].map((x) => (x % 36).toString(36)).join("");
}

/* ---------- files ---------- */

async function assetUpload(req, env) {
  const type = (req.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!/^(image\/(png|jpeg|gif|webp|svg\+xml|avif)|video\/(mp4|webm|quicktime)|application\/pdf|font\/[a-z0-9]+|text\/(plain|csv|markdown|css)|application\/json|application\/octet-stream|model\/[a-z0-9.+-]+)$/.test(type)) {
    return json({ code: "unsupported_type", error: "unsupported_type" }, 415);
  }
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return json({ code: "empty", error: "empty" }, 400);
  if (buf.byteLength > MAX_ASSET) return json({ code: "too_large", error: "too_large" }, 413);
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const name = (req.headers.get("x-file-name") || "").slice(0, 200);
  await env.HQ_ASSETS.put(id, buf, { metadata: { type, size: buf.byteLength } });
  await env.DB.prepare("INSERT OR REPLACE INTO assets(id,type,size,name,at) VALUES(?,?,?,?,?)").bind(id, type, buf.byteLength, name, Date.now()).run();
  return json({ id, url: "/_blob/" + id, sizeBytes: buf.byteLength, contentType: type });
}

async function assetList(env) {
  const { results } = await env.DB.prepare("SELECT id,type,size,name,at FROM assets ORDER BY at DESC LIMIT 5000").all();
  const used = results.reduce((s, r) => s + (r.size || 0), 0);
  return json({ assets: results.map((r) => ({ id: r.id, url: "/_blob/" + r.id, sizeBytes: r.size, contentType: r.type, name: r.name })), usage: { usedBytes: used } });
}

async function assetDelete(env, id) {
  if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
  await env.HQ_ASSETS.delete(id);
  await env.DB.prepare("DELETE FROM assets WHERE id=?").bind(id).run();
  return json({ ok: true });
}

async function blob(req, env, id) {
  if (!ID_RE.test(id)) return new Response("Not found", { status: 404 });
  const { value, metadata } = await env.HQ_ASSETS.getWithMetadata(id, "arrayBuffer");
  if (value) {
    const type = (metadata && metadata.type) || "application/octet-stream";
    return new Response(value, { headers: blobHeaders(type) });
  }
  // Files moved from claude.ai ship with the site as public/_blob/<id>; their type is in the index.
  const r = await env.ASSETS.fetch(new Request(new URL("/_blob/" + id, req.url)));
  if (!r.ok) return new Response("Not found", { status: 404 });
  const idx = await env.ASSETS.fetch(new Request(new URL("/_blob/index.json", req.url)));
  let type = "application/octet-stream";
  if (idx.ok) { try { type = (await idx.json())[id] || type; } catch {} }
  return new Response(r.body, { headers: blobHeaders(type) });
}

function blobHeaders(type) {
  const h = { "content-type": type, "cache-control": "private, max-age=31536000, immutable" };
  // An uploaded SVG or HTML file is shown as a picture or download, never run as a page.
  h["content-security-policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  return h;
}

/* ---------- AI helpers ---------- */

async function sample(req, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ code: "not_granted", message: "Ask Stephanie needs the ANTHROPIC_API_KEY secret." }, 503);
  let body;
  try { body = await req.json(); } catch { return json({ code: "bad_request", message: "bad body" }, 400); }
  const messages = toMessages(body.input, body.images || []);
  if (!messages) return json({ code: "bad_request", message: "input must be text or a list of messages ending with the user" }, 400);
  const model = MODELS[body.modelTier] || MODELS.default;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: Math.min(Number(body.maxTokens) || 8000, 16000), messages }),
  });
  if (r.status === 429) return json({ code: "rate_limited", message: "Too many requests. Try again shortly." }, 429);
  if (!r.ok) {
    console.error("anthropic", r.status, (await r.text()).slice(0, 500));
    return json({ code: "upstream_error", message: "The AI service didn't answer. Try again." }, 502);
  }
  const out = await r.json();
  const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return json({ text, truncated: out.stop_reason === "max_tokens", modelApplied: model });
}

export function toMessages(input, images) {
  let msgs;
  if (typeof input === "string") msgs = [{ role: "user", content: input }];
  else if (Array.isArray(input) && input.length) msgs = input.map((m) => ({ role: m && m.role === "assistant" ? "assistant" : "user", content: String(m && m.content || "") }));
  else return null;
  if (msgs[msgs.length - 1].role !== "user") return null;
  const pics = (Array.isArray(images) ? images : []).filter((i) => i && /^image\/(png|jpeg|gif|webp)$/.test(i.type) && typeof i.data === "string").slice(0, 8);
  if (pics.length) {
    const last = msgs[msgs.length - 1];
    last.content = [...pics.map((i) => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })), { type: "text", text: last.content }];
  }
  return msgs;
}

/* ---------- helpers ---------- */

function json(v, status = 200) {
  return new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function withHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SITE_HEADERS)) if (!r.headers.has(k)) r.headers.set(k, v);
  return r;
}
