// SVG to outlines: parses path data and basic shapes into polylines, applies transforms, and turns
// fills and strokes into filled Clipper outlines (mm) for printing.
import { UM, union, offset } from "./geom.js";
const C = window.ClipperLib;

// ---------- path data -> polylines [{pts:[[x,y]...], closed}] ----------
export function parsePath(d, tol = 0.25) {
  const toks = String(d).match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  const out = []; let cur = null; let i = 0, cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = "";
  const num = () => parseFloat(toks[i++]);
  const has = () => i < toks.length && !/^[a-z]$/i.test(toks[i]);
  const seg = (n) => Math.max(2, Math.min(32, n));
  const start = (px, py) => { if (cur && cur.pts.length > 1) out.push(cur); cur = { pts: [[px, py]], closed: false }; };
  const line = (px, py) => { if (!cur) start(x, y); cur.pts.push([px, py]); };
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    const n = seg(Math.ceil(Math.sqrt((Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2)) / tol)));
    for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; line(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey); }
  };
  const quad = (x1, y1, ex, ey) => {
    const n = seg(Math.ceil(Math.sqrt((Math.hypot(x1 - x, y1 - y) + Math.hypot(ex - x1, ey - y1)) / tol)));
    for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; line(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey); }
  };
  const arc = (rx, ry, rot, large, sweep, ex, ey) => {
    if (!rx || !ry) { line(ex, ey); return; }
    rx = Math.abs(rx); ry = Math.abs(ry); const phi = rot * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x - ex) / 2, dy = (y - ey) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
    let l = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry); if (l > 1) { l = Math.sqrt(l); rx *= l; ry *= l; }
    let k = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    if (large === sweep) k = -k;
    const ccx = k * rx * y1 / ry, ccy = -k * ry * x1 / rx;
    const mx = cp * ccx - sp * ccy + (x + ex) / 2, my = sp * ccx + cp * ccy + (y + ey) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
    const t1 = ang(1, 0, (x1 - ccx) / rx, (y1 - ccy) / ry);
    let dt = ang((x1 - ccx) / rx, (y1 - ccy) / ry, (-x1 - ccx) / rx, (-y1 - ccy) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = seg(Math.ceil(Math.abs(dt) * Math.sqrt(Math.max(rx, ry) / tol)));
    for (let j = 1; j <= n; j++) { const t = t1 + dt * j / n; line(mx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, my + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp); }
  };
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++]; else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C2 = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C2 === "Z") { if (cur) { cur.closed = true; out.push(cur); cur = null; } x = sx; y = sy; prev = "Z"; continue; }
    if (!has()) { continue; }
    if (C2 === "M") { x = ox + num(); y = oy + num(); sx = x; sy = y; start(x, y); cmd = rel ? "l" : "L"; }
    else if (C2 === "L") { const nx = ox + num(), ny = oy + num(); line(nx, ny); x = nx; y = ny; }
    else if (C2 === "H") { const nx = ox + num(); line(nx, y); x = nx; }
    else if (C2 === "V") { const ny = (rel ? y : 0) + num(); line(x, ny); y = ny; }
    else if (C2 === "C") { const a = ox + num(), b = oy + num(), c = ox + num(), d2 = oy + num(), e = ox + num(), f = oy + num(); cubic(a, b, c, d2, e, f); cx = c; cy = d2; x = e; y = f; }
    else if (C2 === "S") { const rx = /[CS]/.test(prev) ? 2 * x - cx : x, ry = /[CS]/.test(prev) ? 2 * y - cy : y; const c = ox + num(), d2 = oy + num(), e = ox + num(), f = oy + num(); cubic(rx, ry, c, d2, e, f); cx = c; cy = d2; x = e; y = f; }
    else if (C2 === "Q") { const a = ox + num(), b = oy + num(), e = ox + num(), f = oy + num(); quad(a, b, e, f); qx = a; qy = b; x = e; y = f; }
    else if (C2 === "T") { const a = /[QT]/.test(prev) ? 2 * x - qx : x, b = /[QT]/.test(prev) ? 2 * y - qy : y; const e = ox + num(), f = oy + num(); quad(a, b, e, f); qx = a; qy = b; x = e; y = f; }
    else if (C2 === "A") { const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), e = ox + num(), f = oy + num(); arc(rx, ry, rot, !!la, !!sw, e, f); x = e; y = f; }
    else { i++; }
    prev = C2;
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

const circlePts = (cx, cy, rx, ry, n = 48) => { const p = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return p; };

// One SVG element description ([tag, attrs]) -> polylines in its own units.
export function shapeToPolys(tag, a) {
  const f = (k, d = 0) => parseFloat(a[k] ?? d) || 0;
  switch (tag) {
    case "path": return parsePath(a.d || "");
    case "circle": return [{ pts: circlePts(f("cx"), f("cy"), f("r"), f("r")), closed: true }];
    case "ellipse": return [{ pts: circlePts(f("cx"), f("cy"), f("rx"), f("ry")), closed: true }];
    case "line": return [{ pts: [[f("x1"), f("y1")], [f("x2"), f("y2")]], closed: false }];
    case "rect": {
      const x = f("x"), y = f("y"), w = f("width"), h = f("height");
      let rx = a.rx != null ? f("rx") : a.ry != null ? f("ry") : 0; let ry = a.ry != null ? f("ry") : rx;
      if (!rx) return [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      return parsePath(`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`);
    }
    case "polyline": case "polygon": {
      const n = String(a.points || "").trim().split(/[\s,]+/).map(Number); const pts = [];
      for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]]);
      return [{ pts, closed: tag === "polygon" }];
    }
  }
  return [];
}

// Polylines (SVG units, y down) -> Clipper outlines in mm (y up), scaled by `k` mm per unit.
function toPaths(polys, k, closedOnly) {
  return polys.filter((p) => !closedOnly || p.closed || p.pts.length > 2).map((p) => p.pts.map(([x, y]) => ({ X: Math.round(x * k * UM), Y: Math.round(-y * k * UM) })));
}
export function fillPolys(polys, k, evenOdd = false) {
  const c = new C.Clipper(); const out = new C.Paths();
  c.AddPaths(toPaths(polys, k, true), C.PolyType.ptSubject, true);
  const ft = evenOdd ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero;
  c.Execute(C.ClipType.ctUnion, out, ft, ft);
  return out;
}
export function strokePolys(polys, k, width) {
  const co = new C.ClipperOffset(2, 0.02 * UM); const out = new C.Paths();
  for (const p of polys) co.AddPath(toPaths([p], k)[0], C.JoinType.jtRound, p.closed ? C.EndType.etClosedLine : C.EndType.etOpenRound);
  co.Execute(out, width * k * UM / 2);
  return union(out);
}

// Tabler-style icon nodes (24-unit stroke icons) -> outlines `size` mm across.
export function iconPaths(nodes, size, filled = false) {
  const k = size / 24; let polys = [];
  for (const [tag, a] of nodes) { if (a.stroke === "none" && a.fill === "none") continue; polys = polys.concat(shapeToPolys(tag, a)); }
  const p = filled ? fillPolys(polys, k) : strokePolys(polys, k, 2);
  return centre(p);
}

// A whole SVG file -> outlines. Filled shapes are filled, stroked ones stroked; scaled so the longest side is `size` mm.
export function svgFilePaths(text, size) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error("That file isn't an SVG.");
  // only geometry is needed: drop anything that could run or load
  for (const bad of svg.querySelectorAll("script,foreignObject,iframe,image,use,animate,set")) bad.remove();
  for (const st of svg.querySelectorAll("style")) st.textContent = st.textContent.replace(/@import[^;]*;?|url\([^)]*\)/gi, "");
  for (const el of [svg, ...svg.querySelectorAll("*")]) for (const at of [...el.attributes]) if (/^on/i.test(at.name) || /href$/i.test(at.name)) el.removeAttribute(at.name);
  const host = document.createElement("div"); host.style.cssText = "position:absolute;left:-9999px;top:0;width:10px;height:10px;overflow:hidden";
  host.appendChild(document.importNode(svg, true)); document.body.appendChild(host);
  const root = host.firstChild; let fills = [], strokes = [];
  try {
    const rootM = root.getScreenCTM().inverse();
    for (const el of root.querySelectorAll("path,circle,ellipse,rect,line,polyline,polygon")) {
      if (el.closest("defs,clipPath,mask,symbol")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const a = {}; for (const at of el.attributes) a[at.name] = at.value;
      const m = rootM.multiply(el.getScreenCTM());
      const polys = shapeToPolys(el.nodeName.toLowerCase(), a).map((p) => ({ closed: p.closed, pts: p.pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]) }));
      const fill = cs.fill, stroke = cs.stroke, sw = parseFloat(cs.strokeWidth) || 0;
      if (fill && fill !== "none" && !/rgba\(.*,\s*0\)/.test(fill)) fills.push({ polys, eo: cs.fillRule === "evenodd", white: isWhite(fill) });
      if (stroke && stroke !== "none" && sw > 0) strokes.push({ polys, w: sw * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), white: isWhite(stroke) });
    }
  } finally { host.remove(); }
  // measure in SVG units, then scale
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of [...fills, ...strokes]) for (const p of g.polys) for (const [x, y] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x0 === Infinity) throw new Error("No shapes found in that SVG.");
  const k = size / Math.max(x1 - x0, y1 - y0, 1e-6);
  // paint in order: dark shapes add, white shapes cut (common for logos drawn on a white card)
  let acc = [];
  for (const g of fills) { const p = fillPolys(g.polys, k, g.eo); acc = g.white ? diff(acc, p) : union(acc, p); }
  for (const g of strokes) { const p = strokePolys(g.polys, k, g.w); acc = g.white ? diff(acc, p) : union(acc, p); }
  return centre(acc);
}
function isWhite(c) { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return !!m && +m[1] > 235 && +m[2] > 235 && +m[3] > 235; }
function diff(a, b) {
  if (!a.length) return a;
  const c = new C.Clipper(); const out = new C.Paths();
  c.AddPaths(a, C.PolyType.ptSubject, true); c.AddPaths(b, C.PolyType.ptClip, true);
  c.Execute(C.ClipType.ctDifference, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}
function centre(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) { x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); y0 = Math.min(y0, q.Y); y1 = Math.max(y1, q.Y); }
  if (x0 === Infinity) return paths;
  const dx = Math.round((x0 + x1) / 2), dy = Math.round((y0 + y1) / 2);
  return paths.map((p) => p.map((q) => ({ X: q.X - dx, Y: q.Y - dy })));
}
export { offset };
