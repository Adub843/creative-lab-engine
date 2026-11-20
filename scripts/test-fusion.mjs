// Tests for Fusion jobs: the engine route (lib/fusion.mjs) and the PC runner (scripts/fusion-runner.mjs).
// Fusion itself can't run here, so the add-in is played by a stand-in that writes the files it would.
//   node scripts/test-fusion.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import * as FU from "../lib/fusion.mjs";
import { handleRequest } from "../worker/app.mjs";

process.env.LAB_FUSION_JOBS = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-test-"));
const RUN = await import("./fusion-runner.mjs");

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const KEY = "open-sesame-test-key-0001";
const env = (k) => ({ CONSOLE_KEY: KEY })[k];
let now = Date.parse("2026-11-17T01:00:00Z");
const clock = () => new Date(now);
function r2() {
  const m = new Map();
  return { m,
    async put(key, v) { m.set(key, { text: String(v), uploaded: new Date(now).toISOString() }); },
    async get(key) { const o = m.get(key); return o ? { text: async () => o.text } : null; },
    async head(key) { return m.has(key) ? { key } : null; },
    async delete(keys) { for (const k of [].concat(keys)) m.delete(k); },
    async list({ prefix = "" } = {}) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key, uploaded: m.get(key).uploaded })), truncated: false }; },
  };
}
const req = (method, body, query = {}, headers = { "content-type": "application/json", "x-console-key": KEY }) =>
  ({ method, query: new URLSearchParams(query), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => JSON.stringify(body ?? {}) });
const call = async (ctx, method, body, query, sub = "", headers) => {
  const res = await FU.handleFusion(req(method, body, query, headers), ctx, sub, clock);
  return { status: res.status, body: res.body ?? (await res.json?.()) };
};

test("engine: the Lab posts a recipe job, the runner claims it once, reports files, the Lab sees it done", async () => {
  const ctx = { env, bucket: r2() };
  assert.equal((await call(ctx, "GET", null, {}, "", { "content-type": "application/json" })).status, 401, "needs the console key");
  assert.equal((await call({ env, bucket: null }, "GET")).status, 503);
  const made = await call(ctx, "POST", { name: "Rainbow Row key tag", by: "Aaron", recipe: "plate", params: { text: "Charleston", holes: "keyring" } });
  assert.equal(made.status, 201);
  const job = made.body.job;
  assert.equal(job.status, "waiting");
  assert.deepEqual(job.formats, ["3mf", "stl"]);
  assert.equal(job.params.width, 90, "defaults filled in");
  assert.equal(job.params.thickness, 3);
  // Fusion closed: the runner checks in, nothing is handed out, and the Lab sees Fusion is down.
  assert.equal((await call(ctx, "GET", null, { fusion: "down" }, "next")).body.job, null);
  let list = await call(ctx, "GET");
  assert.equal(list.body.runner.online, true);
  assert.equal(list.body.runner.fusion, "down");
  assert.ok(list.body.recipes.box && list.body.recipes.svg);
  // Fusion open: the job goes out once.
  const n1 = await call(ctx, "GET", null, { fusion: "up" }, "next");
  assert.equal(n1.body.job.id, job.id);
  assert.equal(n1.body.job.status, "working");
  assert.equal((await call(ctx, "GET", null, { fusion: "up" }, "next")).body.job, null, "not handed out twice");
  const done = await call(ctx, "POST", { id: job.id, ok: true, files: { "3mf": "mabc123-0123abcd", stl: "mabc124-0123abce", evil: "x" }, preview: "mabc123-0123abcd", size: { x: 90, y: 30, z: 4.2 } }, {}, "done");
  assert.equal(done.status, 200);
  assert.equal(done.body.job.status, "done");
  assert.deepEqual(done.body.job.files, { "3mf": "mabc123-0123abcd", stl: "mabc124-0123abce" }, "only known formats and real file keys");
  list = await call(ctx, "GET");
  assert.equal(list.body.jobs[0].status, "done");
  assert.equal((await call(ctx, "GET", null, { id: job.id })).body.job.size.z, 4.2);
  // Off the list after a month; the files stay in the library (not touched here).
  now += FU.KEEP_MS + 1000;
  assert.equal((await call(ctx, "GET")).body.jobs.length, 0);
});

test("engine: bad jobs are refused with plain reasons", async () => {
  const ctx = { env, bucket: r2() };
  const bad = async (body, code = 400) => assert.equal((await call(ctx, "POST", body)).status, code, JSON.stringify(body).slice(0, 80));
  await bad({ name: "x", by: "Aaron", recipe: "rocket" });
  await bad({ name: "", by: "Aaron", recipe: "box" });
  await bad({ name: "Box", by: "", recipe: "box" });
  await bad({ name: "Box", by: "Aaron", recipe: "box", params: { width: 9000 } });
  await bad({ name: "Box", by: "Aaron", recipe: "box", formats: ["dwg"] });
  await bad({ name: "Tag", by: "Aaron", recipe: "plate", params: { holes: "lots" } });
  await bad({ name: "Logo", by: "Aaron", recipe: "svg", params: { svg: "not a drawing" } });
  await bad({ name: "Logo", by: "Aaron", recipe: "svg", params: { svg: "<svg><script>alert(1)</script></svg>" } });
  await bad({ name: "Resize", by: "Aaron", recipe: "resize" });
  await bad({ name: "Resize", by: "Aaron", recipe: "resize", from: "../etc" });
  await bad({ name: "S", by: "Stacy", recipe: "script", script: "print(1)" });
  await bad({ name: "S", by: "Stacy", recipe: "script", script: "def make(design, root, P):\n    import subprocess\n    subprocess.run('x')" });
  await bad({ name: "S", by: "Stacy", recipe: "script", script: "def make(design, root, P):\n    open('C:/x').read()" });
  await bad({ name: "S", by: "Stacy", recipe: "script", script: "def make(design, root, P):\n    pass\n" + "#".repeat(FU.MAX_SCRIPT) });
  const ok = await call(ctx, "POST", { name: "Cube", by: "Stacy", recipe: "script", script: "def make(design, root, P):\n    block(root, mm(10), mm(10), mm(10))\n", formats: ["stl", "step"] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.job.hasScript, true);
  assert.equal(ok.body.job.script, undefined, "the list leaves long scripts out");
  const resize = await call(ctx, "POST", { name: "Bigger gnome", by: "Aaron", recipe: "resize", from: "mabc123-0123abcd", params: { longest: 120 } });
  assert.equal(resize.status, 201);
  assert.equal(resize.body.job.from, "mabc123-0123abcd");
});

test("engine: a runner that dies gives the job back, and three tries end it", async () => {
  const ctx = { env, bucket: r2() };
  const { job } = (await call(ctx, "POST", { name: "Box", by: "Aaron", recipe: "box" })).body;
  for (let i = 1; i <= 3; i++) {
    assert.equal((await call(ctx, "GET", null, { fusion: "up" }, "next")).body.job?.id, job.id, `try ${i}`);
    now += FU.CLAIM_MS + 1000;
  }
  assert.equal((await call(ctx, "GET", null, { fusion: "up" }, "next")).body.job, null);
  const after = (await call(ctx, "GET", null, { id: job.id })).body.job;
  assert.equal(after.status, "failed");
  assert.match(after.error, /three times/);
  assert.equal((await call(ctx, "DELETE", null, { id: job.id })).status, 200);
  assert.equal((await call(ctx, "GET", null, { id: job.id })).status, 404);
});

test("worker: /api/fusion is routed with the RESULTS bucket", async () => {
  const bucket = r2();
  const wenv = { CONSOLE_KEY: KEY, RESULTS: bucket };
  const res = await handleRequest(new Request("https://x/api/fusion", { method: "POST", headers: { "content-type": "application/json", "x-console-key": KEY }, body: JSON.stringify({ name: "Box", by: "Aaron", recipe: "box" }) }), wenv);
  assert.equal(res.status, 201);
  const next = await handleRequest(new Request("https://x/api/fusion/next?fusion=up", { headers: { "x-console-key": KEY } }), wenv);
  assert.equal((await next.json()).job.recipe, "box");
});

test("runner: STL becomes a valid 3MF zip with the same triangles", async () => {
  const tri = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  const b = Buffer.alloc(84 + 50);
  b.writeUInt32LE(1, 80);
  tri.forEach((v, i) => v.forEach((n, j) => b.writeFloatLE(n, 84 + 12 + i * 12 + j * 4)));
  assert.deepEqual(RUN.parseStl(b), [tri]);
  assert.deepEqual(RUN.parseStl(Buffer.from("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid x\n")), [tri]);
  const z = RUN.stlTo3mf(b, "Tag & <test>");
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  // Read the zip back: find 3D/3dmodel.model through the central directory.
  const end = z.length - 22, cdOff = z.readUInt32LE(end + 16), count = z.readUInt16LE(end + 10);
  const names = {};
  for (let i = 0, p = cdOff; i < count; i++) {
    const nlen = z.readUInt16LE(p + 28), name = z.subarray(p + 46, p + 46 + nlen).toString(), lo = z.readUInt32LE(p + 42), clen = z.readUInt32LE(p + 20);
    const lnl = z.readUInt16LE(lo + 26);
    names[name] = zlib.inflateRawSync(z.subarray(lo + 30 + lnl, lo + 30 + lnl + clen)).toString();
    p += 46 + nlen;
  }
  assert.deepEqual(Object.keys(names).sort(), ["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
  assert.match(names["3D/3dmodel.model"], /unit="millimeter"/);
  assert.match(names["3D/3dmodel.model"], /Tag &amp; &lt;test&gt;/);
  assert.equal((names["3D/3dmodel.model"].match(/<triangle /g) ?? []).length, 1);
});

test("runner: hands the add-in the recipe, the SVG and the input file, and reads its result", async () => {
  const base = process.env.LAB_FUSION_JOBS;
  assert.equal(RUN.fusionUp(base), null, "no heartbeat = Fusion down");
  fs.writeFileSync(path.join(base, "heartbeat.json"), JSON.stringify({ at: Date.now() / 1000, version: "1.0.0", fusion: "2.0.x" }));
  assert.equal(RUN.fusionUp(base).version, "1.0.0");
  assert.equal(RUN.fusionUp(base, Date.now() + 60_000), null, "an old heartbeat = Fusion down");
  assert.match(RUN.codeFor({ recipe: "box" }), /def make\(design, root, P\)/);
  assert.throws(() => RUN.codeFor({ recipe: "script", script: "def make(design, root, P):\n    __import__('os')" }), /only build geometry/);
  const job = { id: "futest0000000001", name: "Logo", recipe: "svg", params: { svg: "<svg viewBox='0 0 10 10'><rect width='10' height='10'/></svg>", width: 50, thickness: 3 }, formats: ["3mf", "stl"] };
  // The stand-in add-in: answers like LabBridge on an old Fusion without 3MF export.
  const folder = path.join(base, "inbox", job.id);
  const fake = setInterval(() => {
    if (!fs.existsSync(path.join(folder, "job.json"))) return;
    clearInterval(fake);
    const spec = JSON.parse(fs.readFileSync(path.join(folder, "job.json"), "utf8"));
    assert.match(spec.code, /importSVG/);
    assert.equal(spec.params.svg, undefined, "the SVG goes in its own file");
    assert.ok(fs.existsSync(path.join(folder, "design.svg")));
    assert.ok(fs.existsSync(path.join(folder, "input.stl")));
    const b = Buffer.alloc(84 + 50); b.writeUInt32LE(1, 80); b.writeFloatLE(10, 84 + 24); b.writeFloatLE(10, 84 + 40);
    fs.writeFileSync(path.join(folder, "model.stl"), b);
    fs.writeFileSync(path.join(folder, "result.json"), JSON.stringify({ ok: true, files: { stl: "model.stl", "3mf_from_stl": "model.stl" }, size: { x: 50, y: 50, z: 3 } }));
  }, 20);
  const { result } = await RUN.buildInFusion(job, { base, input: { ext: "stl", bytes: Buffer.from("solid x\nendsolid x\n") }, waitMs: 5000, pollMs: 20 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, { stl: "model.stl", "3mf": "model.3mf" }, "the runner made the 3MF");
  assert.equal(fs.readFileSync(path.join(folder, "model.3mf")).readUInt32LE(0), 0x04034b50);
  const slow = await RUN.buildInFusion({ ...job, id: "futest0000000002" }, { base, waitMs: 50, pollMs: 10 });
  assert.equal(slow.result.ok, false);
  assert.match(slow.result.error, /didn't finish/);
});

test("the add-in and recipes are valid Python, and the recipe list matches the files", async () => {
  const dir = new URL("../tools/fusion/", import.meta.url);
  const files = ["LabBridge/LabBridge.py", "LabBridge/labkit.py", ...Object.keys(FU.RECIPES).map((r) => `recipes/${r}.py`)];
  for (const f of files) assert.ok(fs.existsSync(new URL(f, dir)), `${f} exists`);
  let py = null;
  for (const c of ["python3", "python"]) { try { execFileSync(c, ["--version"], { stdio: "ignore" }); py = c; break; } catch { /* next */ } }
  if (!py) { console.log("  (no Python here: syntax check skipped)"); return; }
  const code = `import ast,sys\nfor f in sys.argv[1:]:\n    ast.parse(open(f,encoding='utf-8').read(), f)\n`;
  execFileSync(py, ["-I", "-c", code, ...files.map((f) => new URL(f, dir).pathname)]);
  for (const r of Object.keys(FU.RECIPES)) assert.match(fs.readFileSync(new URL(`recipes/${r}.py`, dir), "utf8"), /^def make\(design, root, P\):/m, `${r}.py has make()`);
  JSON.parse(fs.readFileSync(new URL("LabBridge/LabBridge.manifest", dir), "utf8"));
});

// A closed 10 mm cube as triangles, and the same cube with one face missing.
function cube(sz = 10) {
  const v = [[0,0,0],[sz,0,0],[sz,sz,0],[0,sz,0],[0,0,sz],[sz,0,sz],[sz,sz,sz],[0,sz,sz]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.map((t) => t.map((i) => v[i]));
}
test("print check: a cube is ready to slice; an open or oversized part is flagged", async () => {
  const PC = await import("./print-check.mjs");
  const good = PC.checkMesh(cube());
  assert.equal(good.ok, true); assert.deepEqual(good.size, { x: 10, y: 10, z: 10 });
  assert.equal(good.volumeCm3, 1); assert.equal(good.openEdges, 0); assert.match(good.notes[0], /Ready to slice/);
  const open = PC.checkMesh(cube().slice(2));
  assert.equal(open.ok, false); assert.ok(open.notes.some((n) => /watertight/.test(n)));
  const big = PC.checkMesh(cube(300));
  assert.equal(big.ok, false); assert.ok(big.notes.some((n) => /Too big/.test(n)));
  assert.deepEqual(PC.parseBed("180x180x180"), { x: 180, y: 180, z: 180 });
  assert.deepEqual(FU.cleanCheck({ ok: true, grams: 12.34, notes: ["a", 5, ""] }), { ok: true, grams: 12.3, notes: ["a", "5"] });
});

test("Alice design job: good answers pass, bad sizes and made-up recipes are sent back", async () => {
  const D = await import("./fusion-design.mjs");
  const input = D.designInput("Design in Fusion: a key tag that says Rainbow Row");
  assert.equal(input.ask, "a key tag that says Rainbow Row");
  assert.deepEqual(Object.keys(input.recipes).sort(), ["box", "plate"]); // no SVG, no resize without a file
  const good = { store: "c3d", canDo: "yes", recipe: "plate", name: "Rainbow Row key tag", params: { text: "Rainbow Row", width: 90, height: 25, thickness: 3.5, corner: 4, textSize: 7, textDepth: 1, holes: "keyring" }, formats: ["3mf", "stl"], printNotes: ["Flat side down."], notes: "" };
  const answers = [
    JSON.stringify({ ...good, recipe: "figurine" }),
    JSON.stringify({ ...good, params: { ...good.params, textSize: 20 } }),
    "<think>sizes</think>" + JSON.stringify(good),
  ];
  const seen = [];
  const d = await D.designWith(async (m) => { seen.push(m); return answers.shift(); }, input);
  assert.equal(d.ok, true); assert.equal(seen.length, 3);
  assert.match(seen[1].at(-1).content, /recipe must be one of: box, plate/);
  assert.match(seen[2].at(-1).content, /text does not fit|textSize must be at most/);
  assert.deepEqual(D.jobFor(d.output, input), { name: "Rainbow Row key tag", by: "Alice", recipe: "plate", params: good.params, formats: ["3mf", "stl"] });
  assert.match(D.replyFor(d.output, true), /sent Rainbow Row key tag .* to Fusion/);
  const no = await D.designWith(async () => JSON.stringify({ store: "c3d", canDo: "no", recipe: "", name: "", params: {}, formats: [], printNotes: [], notes: "A dog figure needs a script job: Claude writes it." }), input);
  assert.equal(no.ok, true); assert.match(D.replyFor(no.output, false), /can't build that one/);
  const thin = await D.designWith(async () => JSON.stringify({ ...good, recipe: "box", params: { width: 40, depth: 40, height: 20, wall: 0.8, corner: 2, lid: false } }), input, 1);
  assert.equal(thin.ok, false); assert.ok(thin.problems.some((p) => /at least 1.2 mm/.test(p)));
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failed++; console.error(`FAIL - ${name}\n${e.stack}`); }
}
fs.rmSync(process.env.LAB_FUSION_JOBS, { recursive: true, force: true });
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log(`all ${tests.length} Fusion tests passed`);
