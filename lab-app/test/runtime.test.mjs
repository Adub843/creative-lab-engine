// The browser side: the Lab's six built-ins answered by this server, checked in a real Chromium page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { makeServer } from "../server/index.mjs";

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); } catch {} }

let lab, base, alice, cf, browser, A, S;
const r2 = new Map(); const queue = [];
before(async () => {
  // a stand-in for Alice (LM Studio's OpenAI-style streaming API)
  alice = createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      const q = JSON.parse(b).messages.at(-1).content;
      const answer = /json/i.test(q) ? '<think>hmm</think>{"ok": true, "n": 3}' : "Hello from Alice.";
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const part of answer.match(/.{1,6}/gs)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  // a stand-in for Cloudflare's API: the engine's queue and one R2 bucket
  cf = createServer((req, res) => {
    const parts = []; req.on("data", c => parts.push(c)); req.on("end", () => {
      const body = Buffer.concat(parts); const m = /\/r2\/buckets\/([^/]+)\/objects\/(.+)$/.exec(req.url);
      if (req.url.includes("/queues/")) { queue.push(JSON.parse(body)); res.writeHead(200, { "content-type": "application/json" }); return res.end('{"success":true,"errors":[],"result":{}}'); }
      if (m && req.method === "PUT") { r2.set(m[2], { body, type: req.headers["content-type"] }); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
      if (m && req.method === "GET") { const o = r2.get(m[2]); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": o.type }); return res.end(o.body); }
      if (m && req.method === "DELETE") { r2.delete(m[2]); res.writeHead(200); return res.end(); }
      res.writeHead(400); res.end();
    });
  });
  await new Promise(r => alice.listen(0, "127.0.0.1", r)); await new Promise(r => cf.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "labrt-")); mkdirSync(join(dir, "site"), { recursive: true });
  writeFileSync(join(dir, "site/index.html"), `<!doctype html><html><head><meta charset=utf8></head><body><h1>Lab</h1></body></html>`);
  const cfg = { port: 0, dataDir: join(dir, "data"), labDir: join(dir, "site"), aliceUrl: `http://127.0.0.1:${alice.address().port}/v1`, aiOrder: ["alice"],
    cloudflare: { accountId: "acc1", queueId: "q1", buckets: ["creative-lab-engine"], apiBase: `http://127.0.0.1:${cf.address().port}` },
    people: [{ id: "aaron", name: "Aaron", level: "owner" }, { id: "shana", name: "Shana", level: "interact" }] };
  lab = makeServer(cfg);
  await new Promise(r => lab.server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${lab.server.address().port}`;
  cfg.origin = base; // the page's requests carry this Origin
  A = lab.auth.newSession("aaron", "t"); S = lab.auth.newSession("shana", "t");
  browser = chromium && await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => lab.server.close(r)); alice.close(); cf.close(); });

async function page(session) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addCookies([{ name: "lab_s", value: session, url: base }]);
  const p = await ctx.newPage(); p.errors = []; p.on("pageerror", e => p.errors.push(e.message));
  await p.goto(base + "/"); await p.waitForFunction(() => window.claude && window.claude.use);
  return p;
}

test("runtime in a real browser", { skip: !chromium && "Playwright isn't installed here" }, async t => {
  const a = await page(A), s = await page(S);
  await t.test("user", async () => {
    const r = await a.evaluate(async () => { const u = await claude.use("user"); return [await u.id(), await u.isOwner(), await u.can("data.write"), Object.keys(await u.profiles(["aaron", "shana", "nobody"]))]; });
    assert.deepEqual(r, ["aaron", true, true, ["aaron", "shana"]]);
    assert.equal(await s.evaluate(async () => (await claude.use("user")).isOwner()), false);
    assert.equal(await a.evaluate(async () => (await claude.use("nope")) === null), true);
  });
  await t.test("db live updates between two people", async () => {
    await s.evaluate(async () => { const db = await claude.use("db"); window.seen = []; db.collection("tasks").orderBy("n").onSnapshot(q => window.seen.push({ ids: q.docs.map(d => d.id), ch: q.docChanges().map(c => c.type + ":" + c.doc.id) })); });
    await a.evaluate(async () => { const db = await claude.use("db"); await db.doc("tasks/b").set({ n: 2 }); await db.collection("tasks").doc("a").set({ n: 1 }); await db.doc("tasks/b").update({ x: { y: 1 } }); });
    await s.waitForFunction(() => window.seen.length && window.seen.at(-1).ids.join() === "a,b", null, { timeout: 5000 });
    const seen = await s.evaluate(() => window.seen);
    assert.deepEqual(seen[0], { ids: [], ch: [] });
    assert.ok(seen.some(x => x.ch.includes("added:a")));
    await a.evaluate(async () => (await claude.use("db")).doc("tasks/a").delete());
    await s.waitForFunction(() => window.seen.at(-1).ids.join() === "b", null, { timeout: 5000 });
    assert.ok((await s.evaluate(() => window.seen.at(-1).ch)).includes("removed:a"));
    const ref = await a.evaluate(async () => { const r = await (await claude.use("db")).collection("notes").add({ t: 1 }); return [r.id.length, r.path.startsWith("notes/")]; });
    assert.deepEqual(ref, [20, true]);
    assert.equal(await a.evaluate(async () => { try { (await claude.use("db")).doc("odd"); return "no"; } catch (e) { return e.constructor.name; } }), "TypeError");
    assert.equal(await s.evaluate(async () => { try { await (await claude.use("db")).doc("data/users/aaron/x").set({ a: 1 }); return "wrote"; } catch (e) { return e.code; } }), "invalid_argument");
  });
  await t.test("files: upload in the page, then show it", async () => {
    const r = await a.evaluate(async () => {
      const assets = await claude.use("assets");
      const c = document.createElement("canvas"); c.width = c.height = 8; const blob = await new Promise(res => c.toBlob(res, "image/png"));
      const up = await assets.upload(blob);
      const img = new Image(); img.src = up.url; await img.decode();
      const list = await assets.list();
      return [/^[0-9a-f]{32}$/.test(up.id), img.naturalWidth, list.assets.some(x => x.id === up.id), (await assets.delete(up.id)).deleted];
    });
    assert.deepEqual(r, [true, 8, true, true]);
  });
  await t.test("ask: streaming answer, and JSON answers", async () => {
    const r = await a.evaluate(async () => {
      const sample = await claude.use("sample"); const parts = [];
      const res = await sample("Say hi", { onText: u => parts.push(u.text) });
      const j = await sample.json("Answer in json");
      return [res.text, parts.length > 1, parts.at(-1), j];
    });
    assert.deepEqual(r, ["Hello from Alice.", true, "Hello from Alice.", { ok: true, n: 3 }]);
  });
  await t.test("engine: Cloudflare code runs through the server's allowlist", async () => {
    r2.set("results/abc", { body: Buffer.from('{"done":1}'), type: "application/json" });
    const r = await a.evaluate(async () => {
      const mcp = await claude.use("mcp");
      const code = `async () => { const A="/accounts/"+accountId;
        await cloudflare.request({method:"POST",path:A+"/queues/q1/messages",body:{body:{id:"abc"},content_type:"json"}});
        await cloudflare.request({method:"PUT",path:A+"/r2/buckets/creative-lab-engine/objects/up/x.bin",body:new Uint8Array([1,2,3]),contentType:"application/octet-stream"});
        const got = await cloudflare.request({method:"GET",path:A+"/r2/buckets/creative-lab-engine/objects/results/abc"});
        const bin = await cloudflare.request({method:"GET",path:A+"/r2/buckets/creative-lab-engine/objects/up/x.bin"});
        let blocked = null; try { await cloudflare.request({method:"GET",path:"/accounts/"+accountId+"/workers/scripts"}); } catch (e) { blocked = e.code; }
        return {got, bin:[...bin], blocked}; }`;
      return (await mcp.callTool("cloudflare", "execute", { code, truncate: false }, { cache: false })).payload;
    });
    assert.deepEqual(r, { got: { done: 1 }, bin: [1, 2, 3], blocked: "blocked_by_policy" });
    assert.deepEqual(queue.at(-1), { body: { id: "abc" }, content_type: "json" });
  });
  await t.test("Stacy's shifts: watched list refreshes when a run starts", async () => {
    lab.runner.upsert({ id: "job_1", name: "Morning brief", cron_expression: "CRON_TZ=America/New_York 50 6 * * *", prompt: "Write the brief." });
    const r = await a.evaluate(async () => new Promise(res => { (async () => { const mcp = await claude.use("mcp"); mcp.watchTool("Claude Code Remote", "list_triggers", { limit: 100 }, ev => { if (ev.type === "data") res(ev.result.payload.data.map(t => [t.name, t.enabled, !!t.next_run_at])); }); })(); }));
    assert.deepEqual(r, [["Morning brief", true, true]]);
  });
  await t.test("downloads", async () => {
    const [dl] = await Promise.all([a.waitForEvent("download"), a.evaluate(async () => (await claude.use("downloads")).save({ filename: "note.txt", data: new Blob(["hi"]) }))]);
    assert.equal(dl.suggestedFilename(), "note.txt");
  });
  assert.deepEqual(a.errors, []); assert.deepEqual(s.errors, []);
});
