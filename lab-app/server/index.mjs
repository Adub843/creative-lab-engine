// The Lab server: serves the Lab's own page files (unchanged) plus a small runtime that answers the six
// claude.ai built-ins (db, assets, sample, mcp, user, downloads) from this machine.
// It listens on 127.0.0.1 only; Tailscale (`tailscale serve`) puts it on HTTPS for Aaron's own devices.
// Nothing here is opened to the internet.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream, mkdirSync } from "node:fs";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, allowed } from "./db.mjs";
import { Auth, SESSION_DAYS } from "./auth.mjs";
import { Assets, ID, sendRanged } from "./assets.mjs";
import { realpathSync, readdirSync } from "node:fs";
import { makeAI } from "./ai.mjs";
import { Runner } from "./runner.mjs";
import { makeConnectors } from "./connectors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "../web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".map": "application/json", ".glb": "model/gltf-binary", ".stl": "model/stl",
  ".3mf": "model/3mf", ".obj": "model/obj", ".step": "application/step", ".stp": "application/step", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".pdf": "application/pdf", ".psd": "image/vnd.adobe.photoshop",
  ".ai": "application/postscript", ".eps": "application/postscript", ".zip": "application/zip", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff",
};
// the rules the Lab artifact declared on claude.ai
export const LAB_RULES = [
  { path: "", read: "interact", write: "interact" },
  { path: "pins", read: "interact", write: "owner" },
  { path: "pins/{self}", write: "interact" },
  { path: "data/users/{self}", write: "interact" },
];

export function loadConfig(file = process.env.LAB_CONFIG || (existsSync("/etc/lab/lab.config.json") ? "/etc/lab/lab.config.json" : resolve(HERE, "../lab.config.json"))) {
  return withDefaults(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
}
export function withDefaults(cfg) {
  cfg.port ??= 3000;
  cfg.host ??= "127.0.0.1";
  cfg.origin ??= `http://localhost:${cfg.port}`;
  cfg.rpID ??= new URL(cfg.origin).hostname;
  cfg.dataDir = resolve(cfg.dataDir || resolve(HERE, "../data"));
  cfg.filesDir = resolve(cfg.filesDir || join(cfg.dataDir, "files"));
  cfg.labDir = resolve(cfg.labDir || resolve(HERE, "../site"));
  cfg.people ??= [
    { id: "aaron", name: "Aaron", level: "owner", color: "#c9a24a" },
    { id: "shana", name: "Shana", level: "interact", color: "#5b8db8" },
    { id: "josh", name: "Josh", level: "interact", color: "#6aa57a" },
  ];
  return cfg;
}

export function makeServer(cfg) {
  cfg = withDefaults(cfg);
  mkdirSync(cfg.dataDir, { recursive: true });
  const store = new Store(join(cfg.dataDir, "lab.db"), cfg.dbRules || LAB_RULES);
  const auth = new Auth(join(cfg.dataDir, "auth.db"), { rpID: cfg.rpID, origin: cfg.origin, people: cfg.people });
  const assets = new Assets(cfg.filesDir, join(cfg.dataDir, "assets.db"), { maxBytes: cfg.maxUploadBytes });
  const ai = makeAI(cfg);
  const clients = new Set(); // live update streams
  const broadcast = (msg, filter) => { const line = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) if (!filter || filter(c)) c.res.write(line); };
  const runner = new Runner(join(cfg.dataDir, "runner.db"), {
    claudeCli: cfg.claudeCli, workDir: cfg.runner?.workDir || join(cfg.dataDir, "runner-work"), logDir: join(cfg.dataDir, "runner-logs"),
    mcpConfig: cfg.runner?.mcpConfig,
    onRunStart: () => broadcast({ mcp: "Claude Code Remote" }), onRunEnd: () => broadcast({ mcp: "Claude Code Remote" }),
  });
  const conn = makeConnectors(cfg, runner);
  store.on("change", ch => { const segs = ch.path.split("/"); broadcast({ p: ch.path, c: ch.coll }, c => allowed(store.rules, c.who, "read", segs)); });

  const fails = new Map(); // ip -> {n, until}: slows down guessing at the sign-in endpoints
  const limited = ip => { const f = fails.get(ip); return f && f.n >= 10 && f.until > Date.now(); };
  const failed = ip => { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 15 * 60e3; fails.set(ip, f); };

  /* ---------- helpers ---------- */
  const secure = cfg.origin.startsWith("https:");
  function cookie(res, name, value, maxAgeSec) {
    res.setHeader("set-cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`);
  }
  function cookies(req) { const out = {}; for (const p of String(req.headers.cookie || "").split(";")) { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return out; }
  function send(res, status, body, headers = {}) {
    const json = typeof body !== "string" && !Buffer.isBuffer(body);
    const data = json ? JSON.stringify(body) : body;
    res.writeHead(status, { "content-type": json ? "application/json" : "text/plain; charset=utf-8", "cache-control": "no-store", ...headers });
    res.end(data);
  }
  const fail = (res, e, status = 400) => send(res, status, { error: { code: e.code || "error", message: e.message || String(e), ...(e.status ? { status: e.status } : {}) } });
  async function body(req, limit = 2 * 2 ** 20) {
    let n = 0; const parts = [];
    for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error("request is too large"), { code: "too_large" }); parts.push(c); }
    const s = Buffer.concat(parts).toString("utf8");
    try { return s ? JSON.parse(s) : {}; } catch { throw Object.assign(new Error("bad JSON"), { code: "invalid_argument" }); }
  }
  const ipOf = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const deviceOf = req => String(req.headers["user-agent"] || "").slice(0, 160);
  // Requests that change things must come from the Lab's own pages (the cookie is also SameSite=Strict).
  function sameOrigin(req) {
    if (["GET", "HEAD"].includes(req.method)) return true;
    const o = req.headers.origin; if (o) return o === cfg.origin;
    return req.headers["sec-fetch-site"] === "same-origin";
  }
  function whoOf(req) {
    const p = auth.session(cookies(req).lab_s);
    return p ? { id: p.id, level: p.level, person: p } : null;
  }
  function agentOf(req) {
    const m = /^Bearer\s+(lab_\S+)$/.exec(req.headers.authorization || "");
    const a = m && auth.agent(m[1]);
    return a ? { id: a.id, level: a.level, person: a, agent: a.agent, scopes: a.scopes } : null;
  }

  /* ---------- static files ---------- */
  function serveFile(req, res, root, rel, { inject } = {}) {
    let file;
    try { file = resolve(root, "." + decodeURIComponent(rel)); } catch { return send(res, 400, "bad path"); }
    if (file !== root && !file.startsWith(root + "/")) return send(res, 404, "not found");
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return send(res, 404, "not found");
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" };
    if (inject && type.startsWith("text/html")) {
      res.writeHead(200, { ...headers, "x-frame-options": "SAMEORIGIN" });
      return res.end(inject(readFileSync(file, "utf8")));
    }
    res.writeHead(200, { ...headers, "content-length": statSync(file).size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  }
  // The Lab page is served as written, with the runtime and the app manifest added at the top of <head>.
  const HEAD_ADD = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#1b1e23">` +
    `<link rel="apple-touch-icon" href="/_lab/icon-180.png"><meta name="apple-mobile-web-app-capable" content="yes">` +
    `<script src="/_lab/runtime.js"></script>`;
  const injectLab = html => /<meta charset[^>]*>/i.test(html) ? html.replace(/<meta charset[^>]*>/i, m => m + HEAD_ADD) : HEAD_ADD + html;
  // Pages inside the Lab (office tools, maker tools) get the runtime too when they ask claude.use() themselves.
  const injectTool = html => /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + `<script src="/_lab/runtime.js"></script>`) : html;

  /* ---------- the request handler ---------- */
  async function handle(req, res) {
    const url = new URL(req.url, cfg.origin);
    const path = url.pathname;
    const ip = ipOf(req);

    // public: the sign-in page, its script, the app manifest, icons and the offline worker
    if (path === "/_lab/login" || path === "/_lab/login.html") return serveFile(req, res, WEB, "/login.html");
    if (path === "/_lab/login.js" || path === "/_lab/login.css" || /^\/_lab\/icon[-\w]*\.(png|svg)$/.test(path)) return serveFile(req, res, WEB, path.slice(5));
    if (path === "/_lab/webauthn.js") return serveFile(req, res, resolve(HERE, "../node_modules/@simplewebauthn/browser/dist/bundle"), "/index.umd.min.js");
    if (path === "/manifest.webmanifest") return serveFile(req, res, WEB, "/manifest.webmanifest");
    if (path === "/sw.js") { res.setHeader("service-worker-allowed", "/"); return serveFile(req, res, WEB, "/sw.js"); }
    if (path === "/_lab/health") return send(res, 200, { ok: true });

    // Agents use a bearer key, not a cookie, so a web page elsewhere can't borrow them: no origin check needed.
    /* ---- agents (Stacy's runner through lab-mcp.mjs, Alice's scripts): bearer key, only their scopes ---- */
    if (path.startsWith("/_lab/api/")) {
      const a = agentOf(req);
      if (!a) return send(res, 401, { error: { code: "bad_key", message: "A Lab agent key is needed." } });
      const scope = path.slice(10).split("/")[0];
      if (!a.scopes.includes(scope) && !a.scopes.includes("*")) return send(res, 403, { error: { code: "no_scope", message: `This key can't use ${scope}.` } });
      try {
        if (scope === "db") return send(res, 200, dbOp(a, await body(req)));
        if (scope === "assets" && req.method === "PUT") return send(res, 200, await assets.put(req, { type: req.headers["content-type"], by: a.agent, name: url.searchParams.get("name") }));
        if (scope === "assets") return send(res, 200, assets.list());
        return send(res, 404, { error: { code: "not_found", message: "no such API" } });
      } catch (e) { return fail(res, e); }
    }

    if (!sameOrigin(req)) return send(res, 403, { error: { code: "bad_origin", message: "This request didn't come from the Lab." } });

    /* ---- sign-in ---- */
    if (path.startsWith("/_lab/auth/")) {
      const step = path.slice(11);
      if (limited(ip) && step !== "me") return send(res, 429, { error: { code: "rate_limited", message: "Too many tries. Wait 15 minutes." } });
      try {
        if (step === "login-options" && req.method === "POST") return send(res, 200, await auth.loginOptions());
        if (step === "login-verify" && req.method === "POST") {
          const b = await body(req);
          let p; try { p = await auth.loginVerify(b.ticket, b.response); } catch (e) { failed(ip); auth.log(null, "passkey-failed", deviceOf(req), ip); throw e; }
          cookie(res, "lab_s", auth.newSession(p.id, deviceOf(req)), SESSION_DAYS * 86400);
          auth.log(p.id, "passkey", deviceOf(req), ip);
          return send(res, 200, { ok: true, person: p });
        }
        // Adding a passkey: with a one-time setup code typed at the server, or while signed in (a new device for yourself).
        if (step === "register-options" && req.method === "POST") {
          const b = await body(req);
          let personId = whoOf(req)?.id;
          if (b.code) { personId = auth.useSetupCode(b.code); if (!personId) { failed(ip); throw Object.assign(new Error("That setup code isn't right or has run out."), { code: "bad_code" }); } }
          if (!personId) throw Object.assign(new Error("Sign in first, or use a setup code."), { code: "signed_out" });
          return send(res, 200, await auth.registerOptions(personId));
        }
        if (step === "register-verify" && req.method === "POST") {
          const b = await body(req);
          const p = await auth.registerVerify(b.ticket, b.response, b.device || deviceOf(req));
          cookie(res, "lab_s", auth.newSession(p.id, deviceOf(req)), SESSION_DAYS * 86400);
          auth.log(p.id, "passkey-added", deviceOf(req), ip);
          return send(res, 200, { ok: true, person: p });
        }
        if (step === "logout" && req.method === "POST") { auth.endSession(cookies(req).lab_s); cookie(res, "lab_s", "", 0); return send(res, 200, { ok: true }); }
        if (step === "me") { const w = whoOf(req); return send(res, 200, { person: w?.person || null }); }
        const w = whoOf(req);
        if (!w) return send(res, 401, { error: { code: "signed_out", message: "Signed out." } });
        if (step === "devices") return send(res, 200, { sessions: auth.sessions(w.id), passkeys: auth.passkeys(w.id) });
        if (step === "end-session" && req.method === "POST") { const b = await body(req); auth.endSessionById(w.id, String(b.id || "")); return send(res, 200, { ok: true }); }
        if (step === "signins" && w.level === "owner") return send(res, 200, { signins: auth.recentSignins() });
        return send(res, 404, { error: { code: "not_found", message: "no such step" } });
      } catch (e) { return fail(res, e); }
    }

    /* ---- everything below needs a signed-in person ---- */
    const who = whoOf(req);
    if (!who) {
      if (path.startsWith("/_lab/") || path.startsWith("/_blob/") || path.startsWith("/_lib/")) return send(res, 401, { error: { code: "signed_out", message: "Signed out." } });
      res.writeHead(302, { location: "/_lab/login?next=" + encodeURIComponent(path + url.search), "cache-control": "no-store" });
      return res.end();
    }

    if (path === "/_lab/runtime.js") return serveFile(req, res, WEB, "/runtime.js");
    if (path.startsWith("/_blob/")) { const id = path.slice(7); return ID.test(id) ? assets.serve(id, req, res) : send(res, 404, "not found"); }

    try {
      if (path === "/_lab/db" && req.method === "POST") return send(res, 200, dbOp(who, await body(req)));
      if (path === "/_lab/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        res.write(": hello\n\n");
        const c = { res, who }; clients.add(c);
        const ping = setInterval(() => res.write(": ping\n\n"), 25000);
        req.on("close", () => { clearInterval(ping); clients.delete(c); });
        return;
      }
      // Big libraries: folders on the NAS (videos, 3D models, the full-size E: drive art), read-only.
      // GET /_lab/lib lists them; /_lab/lib/<name>/<folder> lists a folder; /_lib/<name>/<file> sends a file.
      if (path === "/_lab/lib") return send(res, 200, { libraries: (cfg.libraries || []).map(l => ({ name: l.name, label: l.label || l.name })) });
      if (path.startsWith("/_lab/lib/") || path.startsWith("/_lib/")) {
        const listing = path.startsWith("/_lab/lib/");
        const rest = decodeURIComponent(path.slice(listing ? 10 : 6)); const name = rest.split("/")[0];
        const lib = (cfg.libraries || []).find(l => l.name === name);
        if (!lib) return send(res, 404, { error: { code: "not_found", message: "no such library" } });
        const root = realpathSync(lib.dir); let target;
        try { target = realpathSync(resolve(root, "." + rest.slice(name.length))); } catch { return send(res, 404, { error: { code: "not_found", message: "not found" } }); }
        if (target !== root && !target.startsWith(root + "/")) return send(res, 404, { error: { code: "not_found", message: "not found" } });
        const st = statSync(target);
        if (listing) {
          if (!st.isDirectory()) return send(res, 400, { error: { code: "invalid_argument", message: "not a folder" } });
          const items = readdirSync(target, { withFileTypes: true }).filter(e => !e.name.startsWith(".")).slice(0, 5000).map(e => {
            const full = join(target, e.name); let size = 0, mtime = 0; try { const s2 = statSync(full); size = s2.size; mtime = s2.mtimeMs; } catch {}
            const rel = full.slice(root.length);
            return { name: e.name, folder: e.isDirectory(), size, modified: new Date(mtime).toISOString(), url: e.isDirectory() ? null : "/_lib/" + name + rel.split("/").map(encodeURIComponent).join("/") };
          });
          return send(res, 200, { library: name, path: target.slice(root.length) || "/", items });
        }
        if (!st.isFile()) return send(res, 404, { error: { code: "not_found", message: "not found" } });
        return sendRanged(target, MIME[extname(target).toLowerCase()] || "application/octet-stream", req, res);
      }
      if (path === "/_lab/user") return send(res, 200, { me: { ...who.person }, people: auth.people() });

      if (path === "/_lab/assets" && req.method === "GET") return send(res, 200, assets.list());
      if (path === "/_lab/assets" && req.method === "PUT") {
        if (who.level === "view") throw Object.assign(new Error("Viewers can't upload."), { code: "not_granted" });
        return send(res, 200, await assets.put(req, { type: req.headers["content-type"], by: who.id, name: url.searchParams.get("name") }));
      }
      if (path.startsWith("/_lab/assets/") && req.method === "DELETE") {
        if (who.level === "view") throw Object.assign(new Error("Viewers can't delete."), { code: "not_granted" });
        return send(res, 200, assets.delete(path.slice(13)));
      }

      if (path === "/_lab/ai/limits") return send(res, 200, ai.limits());
      if (path === "/_lab/ai" && req.method === "POST") {
        const b = await body(req, 120 * 2 ** 20);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
        const ctl = new AbortController();
        res.on("close", () => { if (!res.writableFinished) ctl.abort(); });
        const emit = ev => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
        try { emit({ t: "done", result: await ai.answer(b, emit, ctl.signal) }); }
        catch (e) { emit({ t: "error", error: { code: e.code === "skip" ? "upstream_error" : e.code || "upstream_error", message: e.message } }); }
        return res.end();
      }

      if (path === "/_lab/mcp/tools") return send(res, 200, conn.tools());
      if (path === "/_lab/mcp" && req.method === "POST") {
        const b = await body(req, 30 * 2 ** 20);
        if (b.server === "Claude Code Remote" && who.level !== "owner" && b.tool !== "list_triggers") throw Object.assign(new Error("Only Aaron can run or change Stacy's shifts."), { code: "blocked_by_policy" });
        return send(res, 200, await conn.call(b.server, b.tool, b.input));
      }
      if (path === "/_lab/cf" && req.method === "POST") return send(res, 200, await conn.cfRequest(await body(req, 40 * 2 ** 20)));
    } catch (e) { return fail(res, e, e.code === "server_not_connected" ? 503 : 400); }

    if (path.startsWith("/_lab/")) return send(res, 404, { error: { code: "not_found", message: "no such route" } });

    // the Lab's own files
    if (path === "/" || path === "/index.html") return serveFile(req, res, cfg.labDir, "/index.html", { inject: injectLab });
    if (/\.html?$/i.test(path)) return serveFile(req, res, cfg.labDir, path, { inject: injectTool });
    return serveFile(req, res, cfg.labDir, path);
  }

  function dbOp(who, b) {
    const { op, path } = b;
    if (op === "get") return store.get(who, path);
    if (op === "query") return { docs: store.query(who, path, { where: b.where, orderBy: b.orderBy, limit: b.limit }) };
    if (op === "set" || op === "update" || op === "delete") return store.write(who, path, op, b.data);
    if (op === "acquire") return store.acquire(who, path, b.options || {});
    throw Object.assign(new Error(`unknown db op ${op}`), { code: "invalid_argument" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); if (!res.headersSent) fail(res, e, 500); else res.end(); });
  });
  server.on("close", () => { for (const c of clients) c.res.end(); store.close(); auth.close(); assets.close(); runner.close(); });
  return { server, store, auth, assets, runner, conn, ai };
}

// started directly: `node server/index.mjs`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const { server, runner } = makeServer(cfg);
  if (cfg.runner?.enabled !== false) runner.start();
  server.listen(cfg.port, cfg.host, () => console.log(`Lab server on http://${cfg.host}:${cfg.port} (open it at ${cfg.origin})`));
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.close(() => process.exit(0)));
}
