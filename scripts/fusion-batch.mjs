// Runs a whole folder of print files through Fusion on the NUC: each model file is opened in Fusion at its true
// size, checked, and saved again as a clean 3MF and STL, into one folder per product on the Desktop and (with
// --upload) into the Charleston 3D file library, tagged "made with Fusion". Needs Fusion open with LabBridge.
//
//   node scripts/fusion-batch.mjs --src "<folder of product folders>" --names <id,title csv> --out "<Desktop folder>" [--upload] [--only c01,f02]
//
// <src> has one folder per product (c01, f02...), as made by gather.ps1; every STL, OBJ, STEP or 3MF inside is one
// part. When a product has STL files, those are used (its 3MF is often a slicer project with plates); otherwise its
// 3MF or STEP files. A manifest.csv in <out> lists every part, its size in mm and where it went. Nothing in <src>
// is changed. Re-running skips parts already in <out>.
import fs from "node:fs";
import path from "node:path";
import { buildInFusion, fusionUp } from "./fusion-runner.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const MAX_UPLOAD = 20 * 1024 * 1024;
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const src = opt("src"), out = opt("out"), namesFile = opt("names");
const upload = args.includes("--upload");
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
if (!src || !out || !namesFile) { console.error("Usage: node scripts/fusion-batch.mjs --src <dir> --names <csv> --out <dir> [--upload] [--only id,id]"); process.exit(2); }

const names = Object.fromEntries(fs.readFileSync(namesFile, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
  const i = l.indexOf(","); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
}));
const safe = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "model";

function modelFiles(dir) {
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(stl|obj|3mf|step|stp)$/i.test(e.name)) all.push(p); } };
  walk(dir);
  const by = (re) => all.filter((p) => re.test(p));
  const stl = by(/\.(stl|obj)$/i);
  return stl.length ? stl : by(/\.(3mf|step|stp)$/i);
}

let key = "";
async function saveToLibrary(file, name, tags) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_UPLOAD) return "too big for the library (over 20 MB)";
  const r = await fetch(`${ENGINE}/api/files`, { method: "POST", headers: { "x-console-key": key, "x-filename": name, "x-tags": tags, "content-type": "application/octet-stream" }, body: bytes, signal: AbortSignal.timeout(120000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`library: ${r.status} ${body.error ?? ""}`);
  return body.item.key;
}

async function main() {
  if (!fusionUp()) throw new Error("Open Fusion first (the LabBridge add-in starts with it).");
  if (upload) {
    const { readKey } = await import("../drive-server/key.mjs");
    key = readKey();
    if (!key) throw new Error("No console key on this PC: run drive-server\\setup.ps1 first.");
  }
  fs.mkdirSync(out, { recursive: true });
  const manifest = path.join(out, "manifest.csv");
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, "id,product,part,x_mm,y_mm,z_mm,folder,library_3mf,library_stl,note\n");
  const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const ids = fs.readdirSync(src).filter((d) => fs.statSync(path.join(src, d)).isDirectory() && (!only || only.includes(d))).sort();
  let made = 0, failed = 0;
  for (const id of ids) {
    const product = safe(names[id] ?? id);
    const dest = path.join(out, `${id} ${product}`);
    const parts = modelFiles(path.join(src, id));
    if (!parts.length) { fs.appendFileSync(manifest, [id, product, "", "", "", "", "", "", "", "no model files found"].map(csv).join(",") + "\n"); continue; }
    fs.mkdirSync(dest, { recursive: true });
    for (const file of parts) {
      const part = safe(path.basename(file).replace(/\.[^.]+$/, ""));
      if (fs.existsSync(path.join(dest, `${part}.3mf`)) && fs.existsSync(path.join(dest, `${part}.stl`))) continue;
      const ext = path.extname(file).slice(1).toLowerCase().replace("stp", "step");
      const job = { id: `fubatch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: `${product} - ${part}`, recipe: "resize", params: { longest: 0 }, formats: ["3mf", "stl"] };
      const t0 = Date.now();
      const { folder, result } = await buildInFusion(job, { input: { ext, bytes: fs.readFileSync(file) } });
      if (!result.ok) {
        failed++;
        const why = String(result.error ?? "").trim().split("\n").pop();
        console.log(`FAIL ${id} ${part}: ${why}`);
        fs.appendFileSync(manifest, [id, product, part, "", "", "", dest, "", "", `Fusion: ${why}`].map(csv).join(",") + "\n");
        continue;
      }
      const lib = {};
      for (const fmt of ["3mf", "stl"]) {
        if (!result.files?.[fmt]) continue;
        const target = path.join(dest, `${part}.${fmt}`);
        fs.copyFileSync(path.join(folder, result.files[fmt]), target);
        if (upload) {
          try { lib[fmt] = await saveToLibrary(target, `${product} - ${part}.${fmt}`, `made with Fusion, C3D ${id}`); }
          catch (e) { lib[fmt] = `not saved: ${e.message}`; }
        }
      }
      made++;
      const s = result.size ?? {};
      console.log(`ok ${id} ${part} ${s.x}x${s.y}x${s.z} mm in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      fs.appendFileSync(manifest, [id, product, part, s.x, s.y, s.z, dest, lib["3mf"], lib.stl, ""].map(csv).join(",") + "\n");
    }
  }
  console.log(`done: ${made} parts made, ${failed} failed. List: ${manifest}`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
