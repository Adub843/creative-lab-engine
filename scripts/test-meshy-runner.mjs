// Tests for Meshy through the PC (no API key): the engine route (lib/meshy.mjs) with the PC runner
// (scripts/meshy-runner.mjs) end to end. Meshy itself is played by a stand-in CLI and file host: no credits used.
//   node scripts/test-meshy-runner.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleMeshy } from "../lib/meshy.mjs";
import { r2BlobStore } from "../lib/r2-store.mjs";
import { runOnce, engineClient, CliError, download } from "./meshy-runner.mjs";

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const KEY = "open-sesame-test-key-0001";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a80000000049454e44ae426082", "hex");
const DATA_PNG = "data:image/png;base64," + PNG.toString("base64");
const STL = Buffer.alloc(84 + 50); STL.writeUInt32LE(1, 80);

function r2() {
  const m = new Map();
  const toBytes = (d) => (typeof d === "string" ? Buffer.from(d) : Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d));
  return { m,
    async put(key, data, { customMetadata } = {}) { m.set(key, { bytes: toBytes(data), customMetadata: { ...customMetadata } }); },
    async get(key) { const o = m.get(key); return o ? { key, customMetadata: o.customMetadata, text: async () => o.bytes.toString(), arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.length) } : null; },
    async delete(key) { m.delete(key); },
    async list({ prefix = "", include = [] } = {}) {
      return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key, ...(include.includes("customMetadata") ? { customMetadata: m.get(key).customMetadata } : {}) })), truncated: false };
    },
  };
}

// The engine with no MESHY_API_KEY, reached by the runner through a stand-in fetch.
function setup() {
  const bucket = r2(), files = r2();
  const env = (k) => ({ CONSOLE_KEY: KEY })[k];
  const ctx = { jobs: r2BlobStore(r2(), "x/"), files: r2BlobStore(files, "c3d-file/"), env, fetch: async () => { throw new Error("the engine must not call Meshy"); }, relay: bucket, relayJobs: r2BlobStore(bucket, "meshy/job/") };
  const call = (p, init = {}) => handleMeshy(new Request("https://engine.test" + p, { ...init, headers: { "x-console-key": KEY, ...(init.headers ?? {}) } }), ctx);
  const page = async (p, method = "GET", body) => (await call(p, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) })).json();
  const hosts = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    hosts.push(u.hostname);
    if (u.hostname === "engine.test") return call(u.pathname + u.search, init);
    if (u.hostname === "assets.meshy.ai") return new Response(u.pathname.endsWith(".png") ? PNG : u.pathname.endsWith(".stl") ? STL : Buffer.from("model " + u.pathname));
    return new Response("no", { status: 404 });
  };
  const engine = engineClient(KEY, { base: "https://engine.test", fetchImpl });
  // A stand-in for the signed-in Meshy CLI.
  const meshy = { calls: [], tasks: new Map(), balance: 1820, next: 1, failPost: null };
  const cli = (args) => {
    meshy.calls.push(args);
    const [, method, p] = args;
    if (p === "/balance") return { balance: meshy.balance };
    if (method === "POST") {
      if (meshy.failPost) throw meshy.failPost;
      const file = args[args.indexOf("--data") + 1].slice(1);
      const body = JSON.parse(fs.readFileSync(file, "utf8"));
      const id = `0193a1b2-0000-7000-8000-00000000000${meshy.next++}`;
      meshy.tasks.set(id, { id, status: "PENDING", progress: 0, preceding_tasks: 2, body, path: p, flags: args.slice(3) });
      meshy.balance -= 20;
      return { result: id };
    }
    const id = p.split("/").pop();
    const t = meshy.tasks.get(id);
    if (!t) throw new CliError("Invalid ID", { status: 400, sure: true });
    return t;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meshy-runner-test-"));
  const run = () => runOnce({ engine, cli, fetchImpl, dir });
  return { bucket, files, page, meshy, run, dir, hosts };
}

const finish = (t) => Object.assign(t, {
  status: "SUCCEEDED", progress: 100, consumed_credits: 20, expires_at: 1795268883718,
  model_urls: Object.fromEntries(["glb", "stl", "3mf", "obj"].map((f) => [f, `https://assets.meshy.ai/u/tasks/${t.id}/output/model.${f}?Expires=1&Signature=s`])),
  thumbnail_url: `https://assets.meshy.ai/u/tasks/${t.id}/output/preview.png?Expires=1&Signature=s`,
});

test("a photo job goes from the Lab through the PC's Meshy and back, with no key anywhere", async () => {
  const s = setup();
  let st = await s.page("/api/meshy");
  assert.deepEqual([st.configured, st.runner.online], [true, false]);
  const { job } = await s.page("/api/meshy/jobs", "POST", { mode: "photos", images: [DATA_PNG], name: "Pineapple ornament" });
  await s.run();
  st = await s.page("/api/meshy");
  assert.deepEqual([st.runner.online, st.runner.signedIn, st.balance], [true, true, 1820]);
  const post = s.meshy.calls.find((c) => c[1] === "POST");
  assert.deepEqual(post.slice(0, 3), ["api", "POST", "/image-to-3d"]);
  const task = [...s.meshy.tasks.values()][0];
  assert.equal(task.body.image_url, DATA_PNG);
  assert.equal(task.body.should_texture, false);
  assert.ok(!fs.readdirSync(s.dir).some((f) => f.startsWith(job.id)), "the request file is removed after sending");
  // still making: progress shows in the Lab
  Object.assign(task, { status: "IN_PROGRESS", progress: 55 });
  await s.run();
  let live = (await s.page(`/api/meshy/jobs/${job.id}`)).job;
  assert.deepEqual([live.status, live.progress], ["IN_PROGRESS", 55]);
  // done: files come back and can be saved to the 3D file library
  finish(task);
  await s.run();
  live = (await s.page(`/api/meshy/jobs/${job.id}`)).job;
  assert.deepEqual([live.status, live.formats, live.picture, live.credits], ["SUCCEEDED", ["glb", "stl", "3mf"], true, 20]);
  assert.ok(!s.hosts.some((h) => h !== "engine.test" && h !== "assets.meshy.ai"), "files come only from Meshy's host");
  const { item } = await s.page(`/api/meshy/jobs/${job.id}/save`, "POST", { format: "stl" });
  assert.deepEqual([item.name, item.tags], ["Pineapple ornament.stl", "made with Meshy"]);
  // the balance is read again after a job finishes
  s.meshy.balance = 1800;
  await s.run();
  assert.equal((await s.page("/api/meshy")).balance, 1800);
  // nothing more to do: no more Meshy calls but the hello
  const before = s.meshy.calls.length;
  await s.run();
  assert.equal(s.meshy.calls.filter((c, i) => i >= before && c[2] !== "/balance").length, 0);
});

test("a paid job is never sent twice, even if the engine missed the answer", async () => {
  const s = setup();
  const { job } = await s.page("/api/meshy/jobs", "POST", { mode: "words", prompt: "a palmetto keychain" });
  // the PC sent it, but the engine never heard back: simulate by writing the ledger and leaving the job waiting
  fs.writeFileSync(path.join(s.dir, "state.json"), JSON.stringify({ sent: { [job.id]: "0193a1b2-0000-7000-8000-000000000099" }, balanceAt: Date.now() }));
  await s.run();
  assert.equal(s.meshy.calls.filter((c) => c[1] === "POST").length, 0, "not sent again");
  const h = await s.page("/api/meshy/runner");
  assert.equal(h.watch[0].taskId, "0193a1b2-0000-7000-8000-000000000099");
  assert.deepEqual(h.watch[0].path, "/openapi/v2/text-to-3d");
});

test("words go to Meshy's v2 route; refused and unknown sends fail plainly and are not retried", async () => {
  const s = setup();
  const w = (await s.page("/api/meshy/jobs", "POST", { mode: "words", prompt: "a lighthouse keychain" })).job;
  await s.run();
  const post = s.meshy.calls.find((c) => c[1] === "POST");
  assert.deepEqual([post[2], post.includes("--v2")], ["/text-to-3d", true]);
  const t = [...s.meshy.tasks.values()][0];
  assert.equal(t.body.mode, "preview");
  finish(t); await s.run();
  // add color: a refine job on the finished shape
  const c = (await s.page(`/api/meshy/jobs/${w.id}/color`, "POST")).job;
  await s.run();
  const refine = [...s.meshy.tasks.values()][1];
  assert.deepEqual([refine.body.mode, refine.body.preview_task_id], ["refine", t.id]);
  assert.equal((await s.page(`/api/meshy/jobs/${c.id}`)).job.status, "PENDING");
  // Meshy refuses one (e.g. not enough credits): failed, and never sent again
  s.meshy.failPost = new CliError("Insufficient credits", { status: 402, sure: true });
  const bad = (await s.page("/api/meshy/jobs", "POST", { mode: "words", prompt: "a boat" })).job;
  await s.run();
  let j = (await s.page(`/api/meshy/jobs/${bad.id}`)).job;
  assert.deepEqual([j.status, /Insufficient credits/.test(j.error)], ["FAILED", true]);
  // a send with an unknown result: failed with a check-first note, never retried
  s.meshy.failPost = new CliError("timed out", { sure: false });
  const unk = (await s.page("/api/meshy/jobs", "POST", { mode: "words", prompt: "a crab" })).job;
  await s.run();
  s.meshy.failPost = null;
  const posts = s.meshy.calls.filter((x) => x[1] === "POST").length;
  await s.run(); await s.run();
  assert.equal(s.meshy.calls.filter((x) => x[1] === "POST").length, posts);
  j = (await s.page(`/api/meshy/jobs/${unk.id}`)).job;
  assert.deepEqual([j.status, /Check meshy.ai/.test(j.error)], ["FAILED", true]);
});

test("an expired Meshy task shows as expired; downloads refuse other hosts", async () => {
  const s = setup();
  const { job } = await s.page("/api/meshy/jobs", "POST", { mode: "words", prompt: "a sea turtle" });
  await s.run();
  s.meshy.tasks.clear();
  await s.run();
  assert.equal((await s.page(`/api/meshy/jobs/${job.id}`)).job.status, "EXPIRED");
  await assert.rejects(download("https://evil.example/model.stl", async () => { throw new Error("fetched"); }), /somewhere else/);
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failed++; console.log(`not ok - ${name}\n  ${e.stack}`); }
}
console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
