// Geometry for the plate maker, with no page code so it runs (and is tested) in Node too.
// Units are millimetres. World space has the plate's centre at the origin, x right, y up, z up from the
// print bed. Meshes are triangle soups: a Float32Array with 9 numbers (3 corners) per triangle.
//
//   plateShapes(spec)            the plate and its raised border as polygons (outer ring plus holes)
//   extrude(polys, z0, z1)       a closed solid from polygons, between two heights
//   maskLoops(alpha, w, h)       outlines of a raster mask (marching squares), smooth and simplified
//   loopsToPolys(loops)          outer rings with their holes, for extrude()
//   parseSTL / parse3MF          read a model file into a mesh
//   write3MF / writeSTL          the files the plate maker downloads
import earcut from "./vendor/earcut.js";

// ---------- small helpers ----------
export const signedArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2; // positive = counter-clockwise with y up
};
const ccw = (ring) => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);
const cw = (ring) => (signedArea(ring) > 0 ? ring.slice().reverse() : ring);
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- plate outline ----------
// A rounded rectangle centred on the origin, counter-clockwise, about one point per 0.5 mm of corner.
export function roundedRect(w, h, r, cx = 0, cy = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const steps = Math.max(4, Math.ceil((Math.PI * r) / 2 / 0.5));
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [x, y, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = ((start + (90 * i) / steps) * Math.PI) / 180;
      const pt = [cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)], last = pts[pts.length - 1];
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1e-6) pts.push(pt);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <= 1e-6) pts.pop();
  return pts;
}
// A horizontal slot (a stadium) for a mounting screw.
export const slot = (cx, cy, len, wide) => roundedRect(len, wide, wide / 2, cx, cy);

// The plates on offer. A US car plate is 12 × 6 in with four mounting slots on a 7 × 4¾ in pattern.
export const PLATES = {
  "us-car": { name: "Car plate", note: "12 × 6 in, US standard holes", w: 304.8, h: 152.4, r: 9.5,
    holes: [[-88.9, 60.325], [88.9, 60.325], [-88.9, -60.325], [88.9, -60.325]], slotLen: 12.7, slotWide: 7.1 },
  "us-moto": { name: "Motorcycle plate", note: "7 × 4 in, two top holes", w: 177.8, h: 101.6, r: 6.5,
    holes: [[-69.85, 38.1], [69.85, 38.1]], slotLen: 9.5, slotWide: 7.1 },
  // A frame that goes around a real 12 × 6 in plate: 12¾ × 6¾ in outside, screws through the plate's
  // own holes, a window that shows the plate's numbers, and a deeper bottom band for text.
  "us-frame": { name: "Plate frame", note: "Fits around a 12 × 6 in plate", w: 323.85, h: 171.45, r: 9.5,
    holes: [[-88.9, 66.85], [88.9, 66.85], [-88.9, -53.8], [88.9, -53.8]], slotLen: 12.7, slotWide: 7.1,
    window: { w: 280.8, h: 108.6, r: 5, cy: 6.525 } },
};

// The plate as polygons: the base (with its slots as holes) and, if wanted, a raised border ring.
export function plateShapes(spec, { border = 4 } = {}) {
  const outer = roundedRect(spec.w, spec.h, spec.r);
  const holes = spec.holes.map(([x, y]) => cw(slot(x, y, spec.slotLen, spec.slotWide)));
  if (spec.window) holes.push(cw(windowRing(spec)));
  const base = [{ outer: ccw(outer), holes }];
  const rim = border > 0 ? [{ outer: ccw(outer), holes: [cw(roundedRect(spec.w - 2 * border, spec.h - 2 * border, Math.max(1, spec.r - border)))] }] : [];
  return { base, rim, holes: spec.holes.map(([x, y]) => slot(x, y, spec.slotLen, spec.slotWide)) };
}

// The frame's opening, or null for a plain plate.
export const windowRing = (spec) => spec.window ? roundedRect(spec.window.w, spec.window.h, spec.window.r, 0, spec.window.cy) : null;

// ---------- extrusion ----------
// Turns polygons ({outer, holes}) into one closed solid from z0 to z1.
export function extrude(polys, z0, z1) {
  const out = [];
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (const p of polys) {
    const rings = [ccw(p.outer), ...(p.holes ?? []).map(cw)];
    const flat = [], holeIdx = [];
    for (const [n, ring] of rings.entries()) {
      if (n) holeIdx.push(flat.length / 2);
      for (const [x, y] of ring) flat.push(x, y);
    }
    const idx = earcut(flat, holeIdx);
    for (let i = 0; i < idx.length; i += 3) {
      let [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((k) => [flat[2 * k], flat[2 * k + 1]]);
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
      tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]); // top faces up
      tri([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]); // bottom faces down
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        tri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]);
        tri([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
      }
    }
  }
  return new Float32Array(out);
}

// ---------- outlines of a raster mask ----------
// Marching squares over alpha (0-255, row by row, y down), threshold halfway. Returns closed loops in
// pixel units (sample centres at integer coordinates), simplified to within `tolerance` pixels.
export function maskLoops(alpha, w, h, { threshold = 128, tolerance = 0.35, minArea = 2 } = {}) {
  const v = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);
  const W = w + 2;
  const hId = (x, y) => ((y + 1) * W + (x + 1)) * 2;
  const vId = (x, y) => ((y + 1) * W + (x + 1)) * 2 + 1;
  const lerp = (a, b) => (a === b ? 0.5 : (threshold - a) / (b - a));
  const pointOf = (id) => {
    const k = id >> 1, x = (k % W) - 1, y = Math.floor(k / W) - 1;
    if (id & 1) return [x, y + lerp(v(x, y), v(x, y + 1))];
    return [x + lerp(v(x, y), v(x + 1, y)), y];
  };
  const next = new Map(); // start edge -> end edge
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = [v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)]; // tl tr br bl, clockwise
      const ins = c.map((n) => n >= threshold);
      if (ins.every(Boolean) || !ins.some(Boolean)) continue;
      const edges = [hId(x, y), vId(x + 1, y), hId(x, y + 1), vId(x, y)]; // between corner i and i+1
      const exits = [], entries = [];
      for (let i = 0; i < 4; i++) {
        const a = ins[i], b = ins[(i + 1) % 4];
        if (a && !b) exits.push(i); else if (!a && b) entries.push(i);
      }
      if (exits.length === 1) { next.set(edges[exits[0]], edges[entries[0]]); continue; }
      // A saddle: join through the middle when the centre is inside, otherwise cut the corners off.
      const centreIn = (c[0] + c[1] + c[2] + c[3]) / 4 >= threshold;
      for (const e of exits) {
        const pick = centreIn ? entries.find((n) => n === (e + 1) % 4) ?? entries.find((n) => n !== e)
          : entries.find((n) => n === (e + 3) % 4) ?? entries.find((n) => n !== e);
        next.set(edges[e], edges[pick]);
      }
    }
  }
  const loops = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop = [];
    let e = start;
    while (next.has(e)) { loop.push(pointOf(e)); const n = next.get(e); next.delete(e); e = n; }
    if (loop.length >= 3) {
      const s = simplifyLoop(loop, tolerance);
      if (s.length >= 3 && Math.abs(signedArea(s)) >= minArea) loops.push(s);
    }
  }
  return loops;
}

// Ramer-Douglas-Peucker for a closed loop: split at the point farthest from the first, simplify both halves.
function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, at + 1), tol).slice(0, -1), ...rdp(pts.slice(at), tol)];
}
export function simplifyLoop(loop, tol) {
  let far = 0, at = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > far) { far = d; at = i; }
  }
  const a = rdp(loop.slice(0, at + 1), tol), b = rdp([...loop.slice(at), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// Loops (any orientation, y up) into outer rings with the holes inside them. Mask outlines alternate:
// a loop's depth (how many loops contain it) says if it is an outer ring (even) or a hole (odd).
export function loopsToPolys(loops) {
  const items = loops.map((ring) => ({ ring, area: Math.abs(signedArea(ring)) })).sort((a, b) => b.area - a.area);
  for (const [i, it] of items.entries()) {
    it.parents = [];
    for (let j = 0; j < i; j++) if (pointInRing(it.ring[0], items[j].ring)) it.parents.push(items[j]);
    it.depth = it.parents.length;
  }
  const outers = items.filter((it) => it.depth % 2 === 0).map((it) => ({ it, poly: { outer: ccw(it.ring), holes: [] } }));
  for (const it of items.filter((x) => x.depth % 2 === 1)) {
    const parent = it.parents.filter((p) => p.depth === it.depth - 1).sort((a, b) => a.area - b.area)[0];
    outers.find((o) => o.it === parent)?.poly.holes.push(cw(it.ring));
  }
  return outers.map((o) => o.poly);
}

// ---------- reading models ----------
export function parseSTL(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (bytes.byteLength >= 84 && 84 + n * 50 === bytes.byteLength) {
    const out = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
    return out;
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/.test(text)) throw new Error("That isn't an STL file.");
  const nums = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
  if (!nums.length || nums.length % 9 || nums.some((x) => !Number.isFinite(x))) throw new Error("That STL file has no readable triangles.");
  return new Float32Array(nums);
}

// The files in a zip (3MF is a zip), stored or deflated. inflate(bytes) is async and returns bytes.
export async function readZip(buf, inflate = inflateRaw) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That file isn't a 3MF (zip) file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The 3MF file is damaged.");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    files.set(name.replace(/^\//, ""), { method, raw });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...files.keys()],
    async read(name) {
      const f = files.get(name.replace(/^\//, ""));
      if (!f) return null;
      if (f.method === 0) return f.raw;
      if (f.method === 8) return inflate(f.raw);
      throw new Error("The 3MF file uses an unsupported compression.");
    },
  };
}
async function streamThrough(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export const inflateRaw = (bytes) => streamThrough(bytes, new DecompressionStream("deflate-raw"));
export const deflateRaw = (bytes) => streamThrough(bytes, new CompressionStream("deflate-raw"));

const MAT = (s) => {
  const n = String(s ?? "").trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : null;
};
// 3MF matrices are 4x3, row vectors: [m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz].
const mul = (a, b) => [ // a then b
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11],
];
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// Every printable mesh in a 3MF, placed as its build items say (Bambu, Prusa and Orca files included).
export async function parse3MF(buf, inflate = inflateRaw) {
  const zip = await readZip(buf, inflate);
  const rels = await zip.read("_rels/.rels");
  const mainName = (rels && new TextDecoder().decode(rels).match(/Target="([^"]+\.model)"/i)?.[1]) || "3D/3dmodel.model";
  const docs = new Map();
  const doc = async (name) => {
    name = name.replace(/^\//, "");
    if (!docs.has(name)) {
      const raw = await zip.read(name);
      docs.set(name, raw ? indexObjects(new TextDecoder().decode(raw)) : null);
    }
    return docs.get(name);
  };
  const main = await doc(mainName);
  if (!main) throw new Error("That 3MF has no model in it.");
  const out = [];
  const place = async (file, id, m, depth = 0) => {
    const d = await doc(file);
    const obj = d?.objects.get(id);
    if (!obj || depth > 8) return;
    if (obj.mesh) out.push(meshFrom(obj.mesh, m));
    for (const c of obj.components) await place(c.path ?? file, c.id, mul(c.m, m), depth + 1);
  };
  for (const it of main.items) await place(mainName, it.id, it.m);
  if (!out.length) throw new Error("That 3MF has no printable mesh.");
  const total = out.reduce((n, a) => n + a.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const a of out) { all.set(a, at); at += a.length; }
  return all;
}
function indexObjects(xml) {
  const objects = new Map();
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], "id"), body = m[2];
    const components = [...body.matchAll(/<component\b[^>]*\/?>/g)].map((c) => ({
      id: attr(c[0], "objectid"), path: attr(c[0], "p:path"), m: MAT(attr(c[0], "transform")) ?? ID }));
    objects.set(id, { mesh: /<mesh\b/.test(body) ? body : null, components });
  }
  const items = [...xml.matchAll(/<item\b[^>]*\/?>/g)]
    .filter((t) => attr(t[0], "printable") !== "0")
    .map((t) => ({ id: attr(t[0], "objectid"), m: MAT(attr(t[0], "transform")) ?? ID }));
  return { objects, items };
}
function meshFrom(body, m) {
  const vs = [];
  for (const v of body.matchAll(/<vertex\b([^>]*)\/?>/g)) {
    const x = +attr(v[1], "x"), y = +attr(v[1], "y"), z = +attr(v[1], "z");
    vs.push(x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]);
  }
  const tris = [...body.matchAll(/<triangle\b([^>]*)\/?>/g)];
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => ["v1", "v2", "v3"].forEach((k, j) => {
    const n = +attr(t[1], k);
    out[i * 9 + j * 3] = vs[n * 3]; out[i * 9 + j * 3 + 1] = vs[n * 3 + 1]; out[i * 9 + j * 3 + 2] = vs[n * 3 + 2];
  }));
  return out;
}

// A model laid ready for the plate: centred on x and y, sitting on z = 0. Returns its size too.
export function normalizeMesh(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < lo[k]) lo[k] = pos[i]; if (pos[i] > hi[k]) hi[k] = pos[i]; }
  if (!Number.isFinite(lo[0])) throw new Error("That model is empty.");
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] - c[i % 3];
  return { pos: out, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
export function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < lo[k]) lo[k] = pos[i]; if (pos[i] > hi[k]) hi[k] = pos[i]; }
  return { lo, hi };
}

// ---------- writing files ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// A zip of [{name, data}] (deflated when deflate is given, else stored).
export async function writeZip(entries, deflate = typeof CompressionStream === "function" ? deflateRaw : null) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameB = enc.encode(name);
    const raw = typeof data === "string" ? enc.encode(data) : data;
    const packed = deflate ? await deflate(raw) : raw;
    const method = deflate ? 8 : 0, crc = crc32(raw);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, method, true);
    head.setUint16(10, 0, true); head.setUint16(12, 0x21, true); // a fixed date: 1980-01-01
    head.setUint32(14, crc, true); head.setUint32(18, packed.length, true); head.setUint32(22, raw.length, true);
    head.setUint16(26, nameB.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(10, method, true);
    cen.setUint16(14, 0x21, true); cen.setUint32(16, crc, true); cen.setUint32(20, packed.length, true); cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(head.buffer), nameB, packed);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + packed.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n) => (Math.round(n * 10000) / 10000).toString();
// One mesh's XML with shared corners (so slicers see a closed solid, not loose triangles).
function meshXml(pos) {
  const index = new Map(), verts = [], tris = [];
  const vid = (i) => {
    const k = `${num(pos[i])},${num(pos[i + 1])},${num(pos[i + 2])}`;
    let n = index.get(k);
    if (n == null) { n = verts.length; index.set(k, n); verts.push(`<vertex x="${num(pos[i])}" y="${num(pos[i + 1])}" z="${num(pos[i + 2])}"/>`); }
    return n;
  };
  for (let i = 0; i < pos.length; i += 9) {
    const a = vid(i), b = vid(i + 3), c = vid(i + 6);
    if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return `<mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh>`;
}
const hexColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? `${c.toUpperCase()}FF` : "#808080FF");

// The plate as one 3MF object made of parts (one per colour layer), so it imports as a single object
// that keeps its layout, and each part can get its own filament. Parts: [{name, color, colorName, pos}].
export async function write3MF({ title, parts, deflate }) {
  const mats = [...new Map(parts.map((p) => [p.color, p.colorName ?? p.color])).entries()];
  const objs = parts.map((p, i) => `<object id="${i + 2}" type="model" name="${esc(p.name)}" pid="1" pindex="${mats.findIndex(([c]) => c === p.color)}">${meshXml(p.pos)}</object>`);
  const asm = parts.length + 2;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Business Console plate maker</metadata>
<resources>
<basematerials id="1">${mats.map(([c, n]) => `<base name="${esc(n)}" displaycolor="${hexColor(c)}"/>`).join("")}</basematerials>
${objs.join("\n")}
<object id="${asm}" type="model" name="${esc(title)}"><components>${parts.map((_, i) => `<component objectid="${i + 2}"/>`).join("")}</components></object>
</resources>
<build><item objectid="${asm}"/></build>
</model>`;
  return writeZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: "3D/3dmodel.model", data: model },
  ], deflate);
}

// One binary STL of every part together (for printing in one colour).
export function writeSTL(meshes, header = "Business Console plate maker") {
  const n = meshes.reduce((s, m) => s + m.length / 9, 0);
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode(header.slice(0, 79)));
  dv.setUint32(80, n, true);
  let p = 84;
  for (const m of meshes) {
    for (let i = 0; i < m.length; i += 9) {
      const ux = m[i + 3] - m[i], uy = m[i + 4] - m[i + 1], uz = m[i + 5] - m[i + 2];
      const vx = m[i + 6] - m[i], vy = m[i + 7] - m[i + 1], vz = m[i + 8] - m[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(p, nx / l, true); dv.setFloat32(p + 4, ny / l, true); dv.setFloat32(p + 8, nz / l, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(p + 12 + k * 4, m[i + k], true);
      p += 50;
    }
  }
  return new Uint8Array(buf);
}

// Volume of a closed mesh (for tests and the size readout).
export function meshVolume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    v += pos[i] * (pos[i + 4] * pos[i + 8] - pos[i + 5] * pos[i + 7])
      - pos[i + 1] * (pos[i + 3] * pos[i + 8] - pos[i + 5] * pos[i + 6])
      + pos[i + 2] * (pos[i + 3] * pos[i + 7] - pos[i + 4] * pos[i + 6]);
  }
  return v / 6;
}
