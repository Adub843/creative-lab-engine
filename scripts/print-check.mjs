// Checks an STL before it goes to the printer: does it fit the bed, is it closed (watertight), does it sit flat,
// how much hangs over thin air, and roughly how much plastic it takes. Plain Node, no packages, so Alice can run it.
//
//   node scripts/print-check.mjs <file.stl> [--bed 256x256x256] [--json]
//
// The Fusion runner runs it on every part Fusion makes and the notes show in the Lab's 3D maker. The bed default is
// a Bambu Lab X1/P1 (256 mm cube); pass --bed for another printer. It only reads the file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStl } from "./fusion-runner.mjs";

export const DEFAULT_BED = { x: 256, y: 256, z: 256 };
const PLA_G_PER_CM3 = 1.24;
const OVERHANG_DEG = 45; // faces leaning out more than this from vertical need supports
const BIG_TRIANGLES = 1_500_000;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r1 = (n) => Math.round(n * 10) / 10;

export function parseBed(s) {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(String(s ?? "").trim());
  return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
}

// tris: [[[x,y,z] x3], ...] in mm. Returns { ok, size, volumeCm3, grams, triangles, openEdges, overhangPct, notes[] }.
export function checkMesh(tris, bed = DEFAULT_BED) {
  const notes = [];
  if (!tris.length) return { ok: false, triangles: 0, notes: ["The file has no triangles."] };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let i = 0; i < 3; i++) { if (v[i] < lo[i]) lo[i] = v[i]; if (v[i] > hi[i]) hi[i] = v[i]; }
  const size = { x: r1(hi[0] - lo[0]), y: r1(hi[1] - lo[1]), z: r1(hi[2] - lo[2]) };

  // Volume (signed tetrahedra), area that faces down, and area that sits on the bed.
  let vol = 0, downArea = 0, totalArea = 0, baseArea = 0;
  const cosLimit = Math.cos((90 - OVERHANG_DEG) * Math.PI / 180); // normal pointing down more steeply than this = overhang
  const floor = lo[2] + 0.05;
  const edges = new Map();
  const key = (v) => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
  for (const [a, b, c] of tris) {
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const n = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(...n);
    if (!len) continue;
    const area = len / 2;
    totalArea += area;
    const nz = n[2] / len;
    const onBed = a[2] <= floor && b[2] <= floor && c[2] <= floor;
    if (onBed && nz < -0.99) baseArea += area;
    else if (nz < -cosLimit) downArea += area;
    const ks = [key(a), key(b), key(c)];
    for (let i = 0; i < 3; i++) {
      const e = ks[i] < ks[(i + 1) % 3] ? ks[i] + "|" + ks[(i + 1) % 3] : ks[(i + 1) % 3] + "|" + ks[i];
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let openEdges = 0, sharedEdges = 0;
  for (const n of edges.values()) if (n % 2) openEdges++; else if (n > 2) sharedEdges++;
  const volumeCm3 = Math.round(Math.abs(vol) / 10) / 100;
  const overhangPct = totalArea ? Math.round((downArea / totalArea) * 1000) / 10 : 0;

  let ok = true;
  const dims = [size.x, size.y].sort((p, q) => q - p), bedXY = [bed.x, bed.y].sort((p, q) => q - p);
  if (dims[0] > bedXY[0] || dims[1] > bedXY[1] || size.z > bed.z) {
    ok = false;
    notes.push(`Too big for the ${bed.x} x ${bed.y} x ${bed.z} mm bed: split it or scale it down.`);
  }
  if (Math.min(size.x, size.y, size.z) < 0.4) { ok = false; notes.push("One side is under 0.4 mm: too thin to print."); }
  if (openEdges) { ok = false; notes.push(`Not watertight: ${openEdges} open edge${openEdges === 1 ? "" : "s"}. Repair it in Bambu Studio (Fix model) or rebuild it in Fusion.`); }
  if (sharedEdges) notes.push(`${sharedEdges} edge${sharedEdges === 1 ? " is" : "s are"} shared by more than two faces (parts touching); it prints, but Fix model in Bambu Studio cleans it.`);
  if (vol < 0) notes.push("The faces point inward; the slicer usually fixes this on its own.");
  const footprint = size.x * size.y;
  if (footprint && baseArea / footprint < 0.05) notes.push("Very little of it touches the bed: lay it on a flat side, or add a brim.");
  if (overhangPct >= 10) notes.push(`${overhangPct}% of the surface hangs out past ${OVERHANG_DEG} degrees: turn on supports or turn the part.`);
  if (size.z > 4 * Math.max(1, Math.min(size.x, size.y))) notes.push("Tall and thin: add a brim so it doesn't tip over.");
  if (tris.length > BIG_TRIANGLES) notes.push(`${tris.length.toLocaleString("en-US")} triangles: the slicer will be slow; export a lighter mesh if you can.`);
  if (ok && notes.every((n) => /shared by more/.test(n))) notes.unshift("Ready to slice: fits the bed, closed, flat on the bed, no big overhangs.");
  return { ok, size, volumeCm3, grams: Math.round(volumeCm3 * PLA_G_PER_CM3 * 10) / 10, triangles: tris.length, openEdges, sharedEdges, overhangPct, notes };
}

export function checkFile(file, bed = DEFAULT_BED) {
  return checkMesh(parseStl(fs.readFileSync(file)), bed);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--bed");
  const bed = args.includes("--bed") ? parseBed(args[args.indexOf("--bed") + 1]) : DEFAULT_BED;
  if (!file || !bed) { console.error("Usage: node scripts/print-check.mjs <file.stl> [--bed 256x256x256] [--json]"); process.exit(2); }
  const r = checkFile(file, bed);
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${path.basename(file)}: ${r.size?.x} x ${r.size?.y} x ${r.size?.z} mm, ${r.volumeCm3} cm3 (about ${r.grams} g solid PLA), ${r.triangles} triangles`);
    for (const n of r.notes) console.log(`- ${n}`);
  }
  process.exitCode = r.ok ? 0 : 1;
}
