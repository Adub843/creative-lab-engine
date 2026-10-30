// Sign document -> outlines for the 2D canvas and coloured solids for the 3D preview and the 3MF.
// Document coordinates are mm with y pointing DOWN (like the canvas); outlines are mm with y UP.
import { UM, loadFont, textPaths, union, subtract, intersect, offset, circle, rect, bounds, extrude, solidOutline, area, islands } from "../geom.js";
import { iconPaths, svgFilePaths } from "../svgpath.js";
import { filament, RULES, thinShare } from "../print.js";
import { plateOutline, shapeOutline } from "./shapes.js";

export const BORDER_WEIGHTS = { none: 0, thin: 1.2, medium: 2, thick: 3 };
export const THICK_KIND = { text: "text", icon: "text", svg: "svg", shape: "shape" };

let iconData = null;
export function loadIcons() {
  return iconData ??= fetch("data/icons.json").then((r) => r.json()).catch((e) => { iconData = null; throw e; });
}
export async function iconNodes(name) {
  const cats = await loadIcons();
  for (const c of cats) { const i = c.icons.find((x) => x.n === name); if (i) return i; }
  return null;
}

const localCache = new Map();
// An element's outline, centred on 0,0 before it's moved and turned.
export async function elementLocal(el) {
  const key = JSON.stringify([el.kind, el.text, el.font, el.size, el.bold, el.align, el.lineGap, el.spacing, el.curve, el.name, el.filled, el.shape, el.w, el.h, el.r, el.svgId]);
  if (localCache.has(key)) return localCache.get(key);
  let p = [];
  if (el.kind === "text") {
    const font = await loadFont(el.font);
    p = textPaths(font, el.text || " ", el.size, { spacing: el.spacing || 0, lineGap: el.lineGap ?? 0.25, align: el.align || "center", curve: el.curve || 0 });
    if (el.bold) p = offset(p, Math.max(0.15, el.size * 0.035));
  } else if (el.kind === "icon") {
    const ic = await iconNodes(el.name);
    if (ic) p = iconPaths(el.filled && ic.f ? ic.f : ic.o, el.size, !!(el.filled && ic.f));
  } else if (el.kind === "shape") {
    p = shapeOutline(el.shape, el.w, el.h, el.r || 0);
  } else if (el.kind === "svg") {
    p = el.svg ? svgFilePaths(el.svg, el.size) : [];
  }
  if (localCache.size > 300) localCache.clear();
  localCache.set(key, p);
  return p;
}

export function place(paths, x, y, rotDeg = 0) {
  const a = -rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return paths.map((pp) => pp.map((q) => {
    const px = q.X / UM, py = q.Y / UM;
    return { X: Math.round((px * c - py * s + x) * UM), Y: Math.round((px * s + py * c - y) * UM) };
  }));
}

export function holePaths(h) { return circle(h.x, -h.y, h.d / 2); }

// Keyhole slot cut into the back: narrow slot (screw shank) under a wider pocket (screw head).
function keyhole(h, wide) {
  const r = h.d / 2, len = h.d * 1.4;
  const w = wide ? r : r * 0.55;
  return union(circle(h.x, -h.y, r), rect(h.x - w, -h.y, h.x + w, -h.y + len), circle(h.x, -h.y + len, w));
}

function neck(x0, y0, x1, y1, width) {
  const C = window.ClipperLib; const co = new C.ClipperOffset(); const out = new C.Paths();
  co.AddPath([{ X: Math.round(x0 * UM), Y: Math.round(y0 * UM) }, { X: Math.round(x1 * UM), Y: Math.round(y1 * UM) }], C.JoinType.jtRound, C.EndType.etOpenRound);
  co.Execute(out, width / 2 * UM);
  return out;
}

export async function buildSign(doc) {
  const T = doc.thick; const checks = [];
  const els = [];
  for (const el of doc.els) {
    const local = await elementLocal(el);
    els.push({ el, paths: place(local, el.x, el.y, el.rot || 0) });
  }
  // plate
  let plate = [];
  const P = doc.plate;
  if (P.style === "outline") {
    const all = union(...els.map((e) => e.paths));
    plate = all.length ? solidOutline(offset(all, P.margin ?? 4)) : [];
  } else if (P.style === "svg" && P.svgId) {
    plate = place(await elementLocal({ kind: "svg", svg: P.svg, svgId: P.svgId, size: Math.max(P.w, P.h) }), 0, 0, 0);
  } else plate = plateOutline(P.style, P.w, P.h, P.r || 0);

  // boundary holes grow a tab outside the edge
  const holes = doc.holes || [];
  for (const h of holes.filter((x) => x.type === "boundary")) {
    const R = h.d / 2 + Math.max(2.4, h.d * 0.45);
    let next = union(plate, circle(h.x, -h.y, R));
    if (plate.length && islands(next) > islands(plate)) {
      // the tab sits off the edge: join it to the plate with a short neck towards the middle
      const pb = bounds(plate);
      next = union(next, neck(h.x, -h.y, pb.cx, pb.cy, R * 1.5));
    }
    plate = next;
  }
  if (P.style === "tagLong" || P.style === "tagShort") { /* tags get their hole from the default hole list */ }
  const through = union(...holes.filter((x) => x.type !== "back").map(holePaths));
  plate = subtract(plate, through);

  // border ring
  let border = [];
  const bw = BORDER_WEIGHTS[P.border?.weight || "none"] || 0;
  if (bw && plate.length && P.style !== "none") {
    const solid = subtract(solidOutline(plate), []);
    const o = P.border.offset || 0;
    border = subtract(offset(solid, -o), offset(solid, -o - bw));
    border = subtract(border, offset(through, 1));
  }

  // element layers: later elements cover earlier ones, nothing overlaps
  const hasPlate = plate.length > 0;
  const layers = [];
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    let p = hasPlate && P.style !== "outline" ? intersect(e.paths, solidOutline(plate)) : e.paths;
    p = subtract(p, through);
    if (hasPlate && P.style !== "outline" && area(p) < area(e.paths) - 0.5) checks.push({ level: "warn", text: "Part of the design hangs off the plate and is trimmed." });
    layers.push({ el: e.el, paths: p, t: T[THICK_KIND[e.el.kind]] ?? 0.6 });
  }
  if (border.length) layers.unshift({ el: { kind: "border", color: P.border.color }, paths: border, t: T.text });
  for (let i = 0; i < layers.length; i++) {
    const later = union(...layers.slice(i + 1).map((l) => l.paths));
    if (later.length) layers[i].paths = subtract(layers[i].paths, later);
  }

  // solids
  const base = hasPlate ? T.base : 0;
  const byColor = new Map();
  const put = (color, name, tris) => {
    const f = filament(color); const k = f.id;
    if (!byColor.has(k)) byColor.set(k, { name, filament: f.name, color: f.hex, chunks: [], z1: 0 });
    const g = byColor.get(k); g.chunks.push(tris);
  };
  const face = union(...layers.map((l) => l.paths));
  if (hasPlate) {
    const backs = holes.filter((x) => x.type === "back");
    if (doc.facedown) {
      const tmax = Math.max(0, ...layers.map((l) => l.t));
      const tb = Math.max(T.base, tmax + 0.4);
      // face-up while building; the export turns it over
      put(P.color, "Plate", extrude(subtract(plate, face), tb - tmax, tb));
      layers.forEach((l) => put(l.el.color, "Design", extrude(l.paths, tb - l.t, tb)));
      put(P.color, "Plate", extrude(plate, 0, tb - tmax));
      doc._height = tb;
    } else if (backs.length) {
      const a = Math.min(1.2, base * 0.3), b = Math.min(base - 0.8, a + 2.4);
      put(P.color, "Plate", extrude(subtract(plate, union(...backs.map((h) => keyhole(h, false)))), 0, a));
      put(P.color, "Plate", extrude(subtract(plate, union(...backs.map((h) => keyhole(h, true)))), a, b));
      put(P.color, "Plate", extrude(plate, b, base));
      if (base < 4) checks.push({ level: "bad", text: "A hanging slot on the back needs a base plate of at least 4 mm." });
    } else put(P.color, "Plate", extrude(plate, 0, base));
  }
  if (!doc.facedown || !hasPlate) layers.forEach((l) => put(l.el.color, l.el.kind === "border" ? "Border" : "Design", extrude(l.paths, base, base + l.t)));

  const parts = [...byColor.values()].map((g) => {
    const n = g.chunks.reduce((s, c) => s + c.length, 0); const tris = new Float32Array(n); let o = 0;
    for (const c of g.chunks) { tris.set(c, o); o += c.length; }
    let z1 = 0; for (let i = 2; i < tris.length; i += 3) if (tris[i] > z1) z1 = tris[i];
    return { name: g.filament, filament: g.filament, color: g.color, tris, z0: 0, z1 };
  }).filter((p) => p.tris.length);

  // checks
  const all = union(plate, face);
  const bb = bounds(all);
  const height = Math.max(0, ...parts.map((p) => p.z1));
  if (!parts.length) checks.push({ level: "bad", text: "Add some text, an icon or a plate to make something to print." });
  const textLayers = layers.filter((l) => l.el.kind === "text" && l.paths.length);
  if (textLayers.length) {
    const lost = thinShare(union(...textLayers.map((l) => l.paths)), RULES.minStroke);
    checks.push(lost > 0.06 ? { level: "bad", text: `Some text has lines thinner than ${RULES.minStroke} mm. Make it bigger or bolder.` }
      : lost > 0.015 ? { level: "warn", text: "A few thin spots in the text will print soft." }
        : { level: "ok", text: `Text lines are all at least ${RULES.minStroke} mm wide.` });
    const small = textLayers.filter((l) => l.el.size < RULES.minCap);
    if (small.length) checks.push({ level: "warn", text: `Text under ${RULES.minCap} mm tall is hard to read.` });
  }
  const iconLayers = layers.filter((l) => l.el.kind !== "text" && l.el.kind !== "border" && l.paths.length);
  if (iconLayers.length && thinShare(union(...iconLayers.map((l) => l.paths)), RULES.minStroke) > 0.06) checks.push({ level: "warn", text: `Icons or SVG art have lines under ${RULES.minStroke} mm. Make them bigger.` });
  const thin = Object.entries(T).filter(([k, v]) => k !== "base" && v < RULES.minLayer && layers.some((l) => (THICK_KIND[l.el.kind] || "text") === k));
  if (thin.length && !doc.facedown) checks.push({ level: "warn", text: `Raised parts under ${RULES.minLayer} mm are only ${Math.round(thin[0][1] / 0.2)} layers and barely stand out.` });
  if (hasPlate && T.base < 1.6 && Math.max(bb.w, bb.h) > 60) checks.push({ level: "warn", text: "A base under 1.6 mm bends on a sign this size. 2 to 3 mm is sturdier." });
  if (hasPlate && islands(plate) > 1) checks.push({ level: "warn", text: "The plate is in more than one piece." });
  if (!hasPlate && islands(face) > 1) checks.push({ level: "warn", text: "Without a plate, the pieces print loose. Add a plate or overlap them." });
  for (const h of holes) if (h.type === "inside" && h.d < 3) checks.push({ level: "warn", text: "Holes under 3 mm close up when printed." });
  checks.push(Math.max(bb.w, bb.h) > RULES.bed ? { level: "bad", text: `It's ${Math.max(bb.w, bb.h).toFixed(0)} mm long, bigger than the ${RULES.bed} mm bed.` }
    : { level: "ok", text: `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} × ${height.toFixed(1)} mm, fits the bed.` });

  return { plate, border, layers, els, holes, parts, checks, bb, height, title: doc.name || "Sign" };
}

// Turn a face-down build over for printing: face on the bed.
export function flipForPrint(parts, height) {
  return parts.map((p) => {
    const t = new Float32Array(p.tris.length);
    for (let i = 0; i < t.length; i += 3) { t[i] = p.tris[i]; t[i + 1] = -p.tris[i + 1]; t[i + 2] = height - p.tris[i + 2]; }
    return { ...p, tris: t };
  });
}

export { bounds, UM };
