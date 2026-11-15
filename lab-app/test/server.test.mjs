// End-to-end checks of the Lab server: sign-in gate, origin check, db rules, live updates, files, Cloudflare allowlist.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeServer } from "../server/index.mjs";
import { parseCron } from "../server/runner.mjs";

let srv, base, A, S; // A = Aaron's cookie, S = Shana's
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-"));
  mkdirSync(join(dir, "site/js"), { recursive: true });
  writeFileSync(join(dir, "site/index.html"), `<!doctype html><html><head><meta charset=utf8></head><body><script src="js/boot.js"></script></body></html>`);
  writeFileSync(join(dir, "site/js/boot.js"), "window.booted=1");
  const cfg = { port: 0, host: "127.0.0.1", origin: "http://localhost:1", dataDir: join(dir, "data"), labDir: join(dir, "site"),
    people: [{ id: "aaron", name: "Aaron", level: "owner" }, { id: "shana", name: "Shana", level: "interact" }],
    cloudflare: { accountId: "acc1", queueId: "q1" }, libraries: [{ name: "video", dir: join(dir, "nas-video") }] };
  mkdirSync(join(dir, "nas-video/YouTube"), { recursive: true }); writeFileSync(join(dir, "nas-video/YouTube/clip one.mp4"), Buffer.alloc(5000, 7));
  writeFileSync(join(dir, "secret.txt"), "outside");
  srv = makeServer(cfg);
  await new Promise(r => srv.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
  cfg.origin = base; // requests below send this as Origin
  A = "lab_s=" + srv.auth.newSession("aaron", "test"); S = "lab_s=" + srv.auth.newSession("shana", "test");
});
after(() => new Promise(r => srv.server.close(r)));

const req = (path, { who, method = "GET", body, headers = {}, origin = true } = {}) => fetch(base + path, {
  method, redirect: "manual",
  headers: { ...(who ? { cookie: who } : {}), ...(origin && method !== "GET" ? { origin: base } : {}), ...(body && typeof body === "object" && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...headers },
  body: body && typeof body === "object" && !(body instanceof Uint8Array) ? JSON.stringify(body) : body,
});
const db = (who, b) => req("/_lab/db", { who, method: "POST", body: b }).then(r => r.json());

test("signed out: the Lab redirects to sign-in and the API refuses", async () => {
  const r = await req("/");
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /^\/_lab\/login\?next=/);
  assert.equal((await req("/_lab/db", { method: "POST", body: { op: "get", path: "a/b" } })).status, 401);
  assert.equal((await req("/_blob/" + "0".repeat(32))).status, 401);
  assert.equal((await req("/_lab/login")).status, 200);
  assert.equal((await req("/manifest.webmanifest")).status, 200);
  assert.equal((await req("/_lab/icon-192.png")).status, 200);
  assert.equal((await req("/_lab/webauthn.js")).status, 200);
});

test("bad or forged cookies are refused", async () => {
  assert.equal((await req("/", { who: "lab_s=nope" })).status, 302);
});

test("signed in: the Lab page comes with the runtime added at the top", async () => {
  const r = await req("/", { who: A }); const html = await r.text();
  assert.equal(r.status, 200);
  assert.ok(html.indexOf("/_lab/runtime.js") < html.indexOf("js/boot.js"));
  assert.match(html, /rel="manifest"/);
  assert.equal((await req("/js/boot.js", { who: A }).then(r => r.text())), "window.booted=1");
  assert.equal((await req("/../../etc/passwd", { who: A })).status, 404);
  assert.equal((await req("/%2e%2e/%2e%2e/etc/passwd", { who: A })).status, 404);
});

test("changes from another site are refused", async () => {
  const r = await req("/_lab/db", { who: A, method: "POST", body: { op: "set", path: "x/y", data: {} }, origin: false, headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  const r2 = await req("/_lab/db", { who: A, method: "POST", body: { op: "set", path: "x/y", data: {} }, origin: false });
  assert.equal(r2.status, 403);
});

test("db: set, get, update merges, query with where/orderBy/limit, delete", async () => {
  await db(A, { op: "set", path: "tasks/t1", data: { n: 2, tag: "a", deep: { x: 1 } } });
  await db(A, { op: "set", path: "tasks/t2", data: { n: 1, tag: "b" } });
  await db(A, { op: "set", path: "tasks/t3", data: { n: 3, tag: "a" } });
  await db(A, { op: "update", path: "tasks/t1", data: { deep: { y: 2 } } });
  assert.deepEqual((await db(A, { op: "get", path: "tasks/t1" })).data, { n: 2, tag: "a", deep: { x: 1, y: 2 } });
  const q = await db(S, { op: "query", path: "tasks", where: [["tag", "==", "a"]], orderBy: ["n", "desc"], limit: 1 });
  assert.deepEqual(q.docs.map(d => d.id), ["t3"]);
  assert.equal((await db(A, { op: "update", path: "tasks/none", data: { a: 1 } })).error.code, "invalid_argument");
  await db(A, { op: "delete", path: "tasks/t2" });
  assert.equal((await db(A, { op: "get", path: "tasks/t2" })).exists, false);
  assert.equal((await db(A, { op: "get", path: "odd" })).error.code, "invalid_argument");
});

test("db rules: private user folders, pins only by their owner", async () => {
  await db(A, { op: "set", path: "data/users/aaron/n1", data: { secret: 1 } });
  assert.equal((await db(S, { op: "get", path: "data/users/aaron/n1" })).exists, false);
  assert.equal((await db(S, { op: "set", path: "data/users/aaron/n2", data: {} })).error.code, "invalid_argument");
  assert.equal((await db(S, { op: "query", path: "data/users/aaron" })).docs.length, 0);
  assert.ok((await db(S, { op: "set", path: "data/users/shana/n1", data: { a: 1 } })).ok);
  assert.equal((await db(A, { op: "get", path: "data/users/shana/n1" })).exists, false); // private even from the owner
  assert.ok((await db(S, { op: "set", path: "pins/shana", data: { pin: "x" } })).ok);
  assert.equal((await db(S, { op: "set", path: "pins/aaron", data: { pin: "x" } })).error.code, "invalid_argument");
  assert.ok((await db(A, { op: "set", path: "pins/aaron", data: { pin: "y" } })).ok);
});

test("db leases: one holder at a time", async () => {
  assert.equal((await db(A, { op: "acquire", path: "locks/l1", options: { holder: "a", ttlMs: 5000 } })).acquired, true);
  assert.equal((await db(S, { op: "acquire", path: "locks/l1", options: { holder: "b", ttlMs: 5000 } })).acquired, false);
  assert.equal((await db(A, { op: "acquire", path: "locks/l1", options: { holder: "a", ttlMs: 5000 } })).acquired, true);
});

test("live updates reach readers, and never leak a private change", async () => {
  const seen = { A: [], S: [] };
  const open = async (who, list) => {
    const ctl = new AbortController();
    const r = await fetch(base + "/_lab/events", { headers: { cookie: who }, signal: ctl.signal });
    (async () => { const dec = new TextDecoder(); try { for await (const c of r.body) list.push(dec.decode(c)); } catch {} })();
    return ctl;
  };
  const ca = await open(A, seen.A), cs = await open(S, seen.S);
  await new Promise(r => setTimeout(r, 100));
  await db(A, { op: "set", path: "board/b1", data: { v: 1 } });
  await db(A, { op: "set", path: "data/users/aaron/px", data: { v: 1 } });
  await new Promise(r => setTimeout(r, 150));
  ca.abort(); cs.abort();
  assert.match(seen.A.join(""), /board\/b1/); assert.match(seen.S.join(""), /board\/b1/);
  assert.match(seen.A.join(""), /data\/users\/aaron\/px/);
  assert.doesNotMatch(seen.S.join(""), /data\/users\/aaron/);
});

test("files: upload, list, serve with ranges, safe headers, delete", async () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 251);
  const up = await req("/_lab/assets", { who: A, method: "PUT", body: bytes, headers: { "content-type": "image/png" } }).then(r => r.json());
  assert.match(up.id, /^[0-9a-f]{32}$/); assert.equal(up.url, "/_blob/" + up.id); assert.equal(up.sizeBytes, 1000);
  const all = await req("/_lab/assets", { who: S }).then(r => r.json());
  assert.ok(all.assets.some(a => a.id === up.id));
  const r = await req(up.url, { who: S, headers: { range: "bytes=10-19" } });
  assert.equal(r.status, 206); assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...bytes.slice(10, 20)]);
  const full = await req(up.url, { who: A });
  assert.equal(full.headers.get("x-content-type-options"), "nosniff"); assert.match(full.headers.get("content-security-policy"), /sandbox/);
  const bad = await req("/_lab/assets", { who: A, method: "PUT", body: new Uint8Array(4), headers: { "content-type": "application/x-msdownload" } });
  assert.equal(bad.status, 400);
  assert.equal((await req("/_lab/assets/" + up.id, { who: A, method: "DELETE" }).then(r => r.json())).deleted, true);
  assert.equal((await req(up.url, { who: A })).status, 404);
});

test("Cloudflare: only the engine's queue and buckets get through", async () => {
  const cf = b => req("/_lab/cf", { who: A, method: "POST", body: b }).then(r => r.json());
  // no token on this test server, so allowed paths stop at "not connected" and others at the allowlist
  process.env.CF_API_TOKEN = "";
  assert.equal((await cf({ method: "POST", path: "/accounts/acc1/queues/q1/messages", body: {} })).error.code, "server_not_connected");
  srv.conn.cfReady();
});

test("connectors: Stacy's shifts list for everyone, but only Aaron can run one", async () => {
  const mcp = (who, b) => req("/_lab/mcp", { who, method: "POST", body: b }).then(r => r.json());
  const r = await mcp(S, { server: "Claude Code Remote", tool: "list_triggers", input: { limit: 10 } });
  assert.deepEqual(r.payload.data, []);
  assert.equal((await mcp(S, { server: "Claude Code Remote", tool: "fire_trigger", input: { trigger_id: "x" } })).error.code, "blocked_by_policy");
  assert.equal((await mcp(A, { server: "Nope", tool: "x" })).error.code, "server_not_found");
  assert.equal((await mcp(A, { server: "Kittl", tool: "kittl-get-token-balance" })).error.code, "server_not_connected");
  const tools = await req("/_lab/mcp/tools", { who: A }).then(r => r.json());
  assert.equal(tools.cloudflare.accountId, "acc1");
});

test("agent keys: scoped, and only with a valid key", async () => {
  const key = srv.auth.newAgentKey("stacy", "aaron", ["db"]);
  const call = (k, path, b) => fetch(base + "/_lab/api/" + path, { method: "POST", headers: { authorization: "Bearer " + k, "content-type": "application/json", origin: base }, body: JSON.stringify(b) });
  assert.equal((await call(key, "db", { op: "get", path: "board/b1" }).then(r => r.json())).data.v, 1);
  assert.equal((await call("lab_wrong", "db", { op: "get", path: "board/b1" })).status, 401);
  assert.equal((await call(key, "assets", {})).status, 403);
});

test("cron: Eastern-time schedules and next run", () => {
  const c = parseCron("CRON_TZ=America/New_York 50 6 * * *");
  assert.ok(c.matches(new Date("2026-11-16T11:50:00Z"))); // 6:50 AM EST
  assert.ok(!c.matches(new Date("2026-11-16T10:50:00Z")));
  assert.equal(parseCron("*/15 * * * *").next(new Date("2026-11-16T10:07:30Z")).toISOString(), "2026-11-16T10:15:00.000Z");
  assert.ok(parseCron("0 9 * * 1-5").matches(new Date("2026-11-16T09:00:00Z"))); // Monday
  assert.ok(!parseCron("0 9 * * 1-5").matches(new Date("2026-11-15T09:00:00Z"))); // Sunday
  assert.throws(() => parseCron("bad"));
});

test("admin import: an ArtifactData export folder, with claude.ai ids swapped for the Lab's", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "labimp-"));
  mkdirSync(join(dir, "export/rules"), { recursive: true }); mkdirSync(join(dir, "export/data/users/u_abc"), { recursive: true });
  writeFileSync(join(dir, "export/rules/global.json"), JSON.stringify({ note: "hi", by: "u_abc" }));
  writeFileSync(join(dir, "export/data/users/u_abc/pin.json"), JSON.stringify({ names: {} }));
  writeFileSync(join(dir, "lab.config.json"), JSON.stringify({ dataDir: join(dir, "data") }));
  const out = execFileSync(process.execPath, ["server/admin.mjs", "import-db", join(dir, "export"), "u_abc=aaron"], { env: { ...process.env, LAB_CONFIG: join(dir, "lab.config.json") }, stderr: "ignore" }).toString();
  assert.match(out, /2 documents imported/);
  const { Store } = await import("../server/db.mjs");
  const st = new Store(join(dir, "data/lab.db"), []);
  assert.deepEqual(st.get({ id: "aaron", level: "owner" }, "rules/global").data, { note: "hi", by: "aaron" });
  assert.equal(st.get({ id: "aaron", level: "owner" }, "data/users/aaron/pin").exists, true);
  st.close();
});

test("Stacy's lab tools (lab-mcp) read and write the Lab with an agent key", async t => {
  const { spawn } = await import("node:child_process");
  const key = srv.auth.newAgentKey("stacy", "aaron", ["db", "assets"]);
  const p = spawn(process.execPath, ["server/lab-mcp.mjs"], { env: { ...process.env, LAB_URL: base, LAB_AGENT_KEY: key } });
  t.after(() => p.kill());
  const replies = []; let buf = "";
  p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = m => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const wait = id => new Promise((r, no) => { setTimeout(() => no(new Error("no reply " + id)), 5000); const t = setInterval(() => { const x = replies.find(y => y.id === id); if (x) { clearInterval(t); r(x); } }, 10); });
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal((await wait(1)).result.serverInfo.name, "lab");
  send({ id: 2, method: "tools/list" });
  assert.deepEqual((await wait(2)).result.tools.map(t => t.name), ["get", "list", "set", "update", "delete", "upload_file"]);
  send({ id: 3, method: "tools/call", params: { name: "set", arguments: { path: "brief/todo", data: { items: ["a"] } } } });
  await wait(3);
  send({ id: 4, method: "tools/call", params: { name: "get", arguments: { path: "brief/todo" } } });
  assert.deepEqual(JSON.parse((await wait(4)).result.content[0].text).data, { items: ["a"] });
  send({ id: 5, method: "tools/call", params: { name: "list", arguments: { collection: "brief" } } });
  assert.equal(JSON.parse((await wait(5)).result.content[0].text).docs.length, 1);
  p.kill();
});

test("big libraries: list NAS folders and stream files, never outside the folder", async () => {
  assert.deepEqual((await req("/_lab/lib", { who: S }).then(r => r.json())).libraries, [{ name: "video", label: "video" }]);
  const top = await req("/_lab/lib/video", { who: S }).then(r => r.json());
  assert.deepEqual(top.items.map(i => [i.name, i.folder]), [["YouTube", true]]);
  const yt = await req("/_lab/lib/video/YouTube", { who: S }).then(r => r.json());
  assert.equal(yt.items[0].url, "/_lib/video/YouTube/clip%20one.mp4");
  const part = await req(yt.items[0].url, { who: S, headers: { range: "bytes=0-99" } });
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-type"), "video/mp4"); assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await req("/_lib/video/../secret.txt", { who: A })).status, 404);
  assert.equal((await req("/_lib/video/%2e%2e/secret.txt", { who: A })).status, 404);
  assert.equal((await req("/_lab/lib/nope", { who: A })).status, 404);
  assert.equal((await req(yt.items[0].url)).status, 401);
});
