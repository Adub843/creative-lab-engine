// Runs the Lab's Fusion jobs on Aaron's PC (lib/fusion.mjs explains the whole path).
//
// Every minute (scripts/schedule-fusion-runner.ps1) it checks that Fusion is open with the LabBridge add-in running
// (the add-in's heartbeat file), asks the engine for the next job, puts it in the add-in's inbox folder, waits for
// Fusion to build it, saves the files in the Charleston 3D file library (POST /api/files, tagged "made with Fusion"),
// keeps a copy in Aaron-Data, and tells the engine the job is done. Plain Node, no packages, so Alice can run it.
//
//   node scripts/fusion-runner.mjs            run every waiting job (up to 5), then exit
//   node scripts/fusion-runner.mjs --status   say whether Fusion and the add-in are up, and stop
//   node scripts/fusion-runner.mjs --local <job.json>   build one job file without the engine (for testing)
//
// The console key is the one drive-server/setup.ps1 stored on this PC; it is only sent to the engine as a header.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { checkMesh } from "./print-check.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
export const BASE = process.env.LAB_FUSION_JOBS ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "CreativeLab", "fusion-jobs");
const INBOX = path.join(BASE, "inbox");
const SAVE_DIR = process.env.FUSION_SAVE_DIR ?? "C:\\Users\\lewis\\Aaron-Data\\01 Charleston3D\\Made in Fusion";
const RECIPES = JSON.parse(fs.readFileSync(path.join(REPO, "tools", "fusion", "recipes.json"), "utf8")).recipes;
const MAX_PER_RUN = 5;
const JOB_WAIT_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const KEEP_FOLDERS = 30;
const LOCK = path.join(os.tmpdir(), "fusion-runner.lock");
const LOG = path.join(REPO, "ai-jobs", "runs", "fusion", "fusion.log");
// Same rule as lib/fusion.mjs: a script may only build geometry.
export const SCRIPT_BLOCKLIST = /\b(?:subprocess|socket|urllib|requests|http\.client|ftplib|smtplib|ctypes|shutil|winreg|importlib|__import__|eval|exec|compile|os\.system|os\.popen|os\.remove|os\.unlink|os\.rmdir|os\.spawn|os\.exec|open)\s*[\(.]/;

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) fs.renameSync(LOG, LOG + ".old");
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging never stops a job */ }
}

// Is Fusion open with LabBridge running? The add-in writes heartbeat.json every 5 seconds.
export function fusionUp(base = BASE, now = Date.now()) {
  try {
    const hb = JSON.parse(fs.readFileSync(path.join(base, "heartbeat.json"), "utf8"));
    return now - hb.at * 1000 < HEARTBEAT_MS ? hb : null;
  } catch { return null; }
}

// ---------- STL to 3MF (for Fusion builds without 3MF export) ----------
export function parseStl(buf) {
  const tris = [];
  const head = buf.subarray(0, 512).toString("latin1");
  const count = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  if (count >= 0 && buf.length === 84 + 50 * count) {
    for (let i = 0; i < count; i++) {
      const o = 84 + i * 50 + 12;
      tris.push([0, 1, 2].map((v) => [buf.readFloatLE(o + v * 12), buf.readFloatLE(o + v * 12 + 4), buf.readFloatLE(o + v * 12 + 8)]));
    }
    return tris;
  }
  if (!/^\s*solid/.test(head)) throw new Error("That isn't an STL file.");
  const nums = [...buf.toString("latin1").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < nums.length; i += 3) tris.push([nums[i], nums[i + 1], nums[i + 2]]);
  return tris;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// A plain ZIP (deflate) with the given files, enough for a 3MF.
export function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, "utf8"), raw = Buffer.from(data), comp = zlib.deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function stlTo3mf(stl, name = "model") {
  const tris = parseStl(stl);
  if (!tris.length) throw new Error("The STL has no triangles.");
  const index = new Map(), verts = [], faces = [];
  const id = (v) => { const k = v.map((n) => n.toFixed(4)).join(","); let i = index.get(k); if (i === undefined) { i = verts.length; index.set(k, i); verts.push(v); } return i; };
  for (const t of tris) { const f = t.map(id); if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) faces.push(f); }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${esc(name)}</metadata><metadata name="Application">Creative Lab Fusion runner</metadata><resources><object id="1" type="model"><mesh><vertices>` +
    verts.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join("") + `</vertices><triangles>` +
    faces.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join("") +
    `</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
    ["3D/3dmodel.model", model],
  ]);
}

// ---------- jobs ----------
// The Python Fusion runs for a job: a recipe from tools/fusion/recipes, or the job's own script.
export function codeFor(job) {
  if (job.recipe === "script") {
    const s = String(job.script ?? "");
    if (!/^def make\(\s*design\s*,\s*root\s*,\s*P\s*\)\s*:/m.test(s)) throw new Error("The script has no make(design, root, P).");
    if (SCRIPT_BLOCKLIST.test(s)) throw new Error("Scripts may only build geometry: no files, programs or network.");
    return s;
  }
  if (!RECIPES[job.recipe]) throw new Error(`Unknown recipe ${job.recipe}.`);
  return fs.readFileSync(path.join(REPO, "tools", "fusion", "recipes", `${job.recipe}.py`), "utf8");
}

const safeName = (s) => String(s).replace(/[^\w .()-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "model";

async function engine(pathname, key, init = {}) {
  const r = await fetch(ENGINE + pathname, { ...init, headers: { accept: "application/json", "x-console-key": key, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60000) });
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    if (!r.ok) throw new Error(`${pathname}: ${r.status}`);
    return { bytes: Buffer.from(await r.arrayBuffer()), disposition: r.headers.get("content-disposition") ?? "" };
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname}: ${r.status} ${body?.error ?? ""}`);
  return body;
}
const postJson = (p, key, v) => engine(p, key, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });

// Puts a job in the add-in's inbox and waits for Fusion's result.json.
export async function buildInFusion(job, { base = BASE, input, waitMs = JOB_WAIT_MS, pollMs = 2000 } = {}) {
  const folder = path.join(base, "inbox", job.id);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  if (input) fs.writeFileSync(path.join(folder, `input.${input.ext}`), input.bytes);
  const params = { ...(job.params ?? {}) };
  if (typeof params.svg === "string") { fs.writeFileSync(path.join(folder, "design.svg"), params.svg); delete params.svg; }
  const spec = { id: job.id, name: job.name, code: codeFor(job), params, formats: job.formats ?? ["3mf", "stl"] };
  fs.writeFileSync(path.join(folder, "job.json.tmp"), JSON.stringify(spec));
  fs.renameSync(path.join(folder, "job.json.tmp"), path.join(folder, "job.json"));
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const rp = path.join(folder, "result.json");
    if (fs.existsSync(rp)) {
      const result = JSON.parse(fs.readFileSync(rp, "utf8"));
      // Fusion builds without 3MF export leave the 3MF to us.
      if (result.ok && result.files?.["3mf_from_stl"]) {
        fs.writeFileSync(path.join(folder, "model.3mf"), stlTo3mf(fs.readFileSync(path.join(folder, result.files["3mf_from_stl"])), job.name));
        delete result.files["3mf_from_stl"];
        result.files["3mf"] = "model.3mf";
      }
      return { folder, result };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { folder, result: { ok: false, error: `Fusion didn't finish in ${Math.round(waitMs / 60000)} minutes. Is Fusion busy with a dialog open?` } };
}

// Old job folders are removed so the inbox doesn't grow; the newest KEEP_FOLDERS stay for checking.
function tidyInbox(base = BASE) {
  try {
    const dirs = fs.readdirSync(path.join(base, "inbox")).map((n) => path.join(base, "inbox", n))
      .filter((d) => fs.existsSync(path.join(d, "result.json"))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const d of dirs.slice(KEEP_FOLDERS)) fs.rmSync(d, { recursive: true, force: true });
  } catch { /* nothing to tidy */ }
}

async function runOne(job, key) {
  const t0 = Date.now();
  let input;
  if (job.from) {
    const got = await engine(`/api/files/${encodeURIComponent(job.from)}`, key);
    const ext = (/filename="[^"]*\.([A-Za-z0-9]+)"/.exec(got.disposition)?.[1] ?? "").toLowerCase().replace("stp", "step");
    if (!["step", "stl", "obj", "3mf"].includes(ext)) throw new Error("Fusion jobs can open STEP, STL, OBJ or 3MF files from the library.");
    input = { ext, bytes: got.bytes };
  }
  const { folder, result } = await buildInFusion(job, { input });
  if (!result.ok) {
    await postJson("/api/fusion/done", key, { id: job.id, ok: false, error: String(result.error ?? "Fusion couldn't make it.").slice(-1000) });
    log(`failed ${job.id} (${job.recipe}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return;
  }
  const files = {};
  let preview;
  const keep = fs.existsSync(path.dirname(SAVE_DIR)) ? path.join(SAVE_DIR, `${new Date().toISOString().slice(0, 10)} ${safeName(job.name)}`) : null;
  if (keep) fs.mkdirSync(keep, { recursive: true });
  for (const fmt of ["3mf", "stl", "step"]) {
    const rel = result.files?.[fmt];
    if (!rel) continue;
    const bytes = fs.readFileSync(path.join(folder, rel));
    const name = `${safeName(job.name)}.${fmt}`;
    if (keep) fs.writeFileSync(path.join(keep, name), bytes);
    const saved = await engine("/api/files", key, { method: "POST", headers: { "x-filename": name, "x-tags": "made with Fusion", "content-type": "application/octet-stream" }, body: bytes });
    files[fmt] = saved.item.key;
  }
  // The print check (scripts/print-check.mjs): bed fit, watertight, overhangs, plastic. Its notes show in the Lab.
  let check;
  const stlRel = result.files?.stl;
  if (stlRel) {
    try { const c = checkMesh(parseStl(fs.readFileSync(path.join(folder, stlRel)))); check = { ok: c.ok, grams: c.grams, notes: c.notes }; }
    catch (e) { log(`print check skipped for ${job.id}: ${e.message}`); }
  }
  const png = path.join(folder, "preview.png");
  const main = files["3mf"] ?? files.stl;
  if (main && result.preview && fs.existsSync(png) && fs.statSync(png).size <= 300 * 1024) {
    try { await engine(`/api/files/${main}/thumb`, key, { method: "PUT", headers: { "content-type": "image/png" }, body: fs.readFileSync(png) }); preview = main; }
    catch (e) { log(`preview not saved for ${job.id}: ${e.message}`); }
  }
  await postJson("/api/fusion/done", key, { id: job.id, ok: true, files, preview, size: result.size, check, log: `Built in Fusion in ${result.seconds ?? "?"}s.${keep ? ` Copy in ${keep}` : ""}` });
  log(`done ${job.id} (${job.recipe}) ${Object.keys(files).join("+")} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--status") {
    const hb = fusionUp();
    console.log(hb ? `Fusion is up (add-in ${hb.version}, Fusion ${hb.fusion}). Jobs folder: ${BASE}` : `Fusion or the LabBridge add-in isn't running. Jobs folder: ${BASE}`);
    return;
  }
  if (args[0] === "--local") {
    const job = JSON.parse(fs.readFileSync(args[1], "utf8"));
    job.id ??= "fulocal" + Date.now().toString(36);
    if (!fusionUp()) throw new Error("Open Fusion first (the LabBridge add-in starts with it).");
    const { folder, result } = await buildInFusion(job);
    console.log(JSON.stringify({ folder, ...result }, null, 2));
    return;
  }
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); }
  catch {
    if (Date.now() - fs.statSync(LOCK).mtimeMs < JOB_WAIT_MS * MAX_PER_RUN) return; // the last run is still working
    fs.writeFileSync(LOCK, String(process.pid));
  }
  try {
    const { readKey } = await import("../drive-server/key.mjs");
    const key = readKey();
    if (!key) { console.error("No console key on this PC yet: run drive-server\\setup.ps1 and type the key when asked."); process.exitCode = 1; return; }
    const up = fusionUp() ? "up" : "down";
    for (let n = 0; n < MAX_PER_RUN; n++) {
      const { job } = await engine(`/api/fusion/next?fusion=${up}&v=1`, key);
      if (!job) break;
      try { await runOne(job, key); }
      catch (e) {
        log(`failed ${job.id}: ${e.message}`);
        await postJson("/api/fusion/done", key, { id: job.id, ok: false, error: e.message.slice(0, 1000) }).catch(() => {});
      }
    }
    tidyInbox();
  } finally { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log("failed: " + e.message); console.error(e.message); process.exitCode = 1; });
}
