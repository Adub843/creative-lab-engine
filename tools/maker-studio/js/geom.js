// 2D shapes in millimetres, kept as Clipper paths in micrometres (integers), and the solids made from
// them. Every maker builds flat outlines (text, plates, rings) and stacks them as extruded parts.
const C = window.ClipperLib;
const earcut = window.earcut.default || window.earcut;
export const UM = 1000; // Clipper units per millimetre

// ---------- fonts ----------
export const FONTS = [
  { id: "montserrat", name: "Montserrat Heavy", file: "montserrat-800-normal.woff" },
  { id: "bebas", name: "Bebas Neue", file: "bebas-neue-400-normal.woff" },
  { id: "anton", name: "Anton", file: "anton-400-normal.woff" },
  { id: "righteous", name: "Righteous", file: "righteous-400-normal.woff" },
  { id: "bungee", name: "Bungee", file: "bungee-400-normal.woff" },
  { id: "pacifico", name: "Pacifico", file: "pacifico-400-normal.woff" },
  { id: "lobster", name: "Lobster", file: "lobster-400-normal.woff" },
  { id: "marker", name: "Permanent Marker", file: "permanent-marker-400-normal.woff" },
];
const fontCache = new Map();
// Fonts people import from their own computer (kept for this session; the project saves the bytes).
export function registerFont(id, name, buffer) {
  const font = window.opentype.parse(buffer);
  if (!FONTS.some((f) => f.id === id)) FONTS.push({ id, name, local: true });
  fontCache.set(id, Promise.resolve(font));
  return font;
}
export function loadFont(id) {
  const f = FONTS.find((x) => x.id === id) || FONTS[0];
  if (!fontCache.has(f.id)) {
    fontCache.set(f.id, fetch(`fonts/${f.file}`).then((r) => {
      if (!r.ok) throw new Error(`Font ${f.name} didn't load`);
      return r.arrayBuffer();
    }).then((b) => window.opentype.parse(b)).catch((e) => { fontCache.delete(f.id); throw e; }));
  }
  return fontCache.get(f.id);
}

// ---------- path helpers ----------
const pt = (x, y) => ({ X: Math.round(x * UM), Y: Math.round(y * UM) });

function flatten(cmds, tol = 0.05) {
  // opentype path commands (y down) -> closed polylines in mm (y up)
  const rings = []; let cur = null; let x0 = 0, y0 = 0;
  const add = (x, y) => cur.push(pt(x, -y));
  for (const c of cmds) {
    if (c.type === "M") { if (cur && cur.length > 2) rings.push(cur); cur = []; add(c.x, c.y); x0 = c.x; y0 = c.y; }
    else if (c.type === "L") { add(c.x, c.y); x0 = c.x; y0 = c.y; }
    else if (c.type === "Q" || c.type === "C") {
      const len = Math.hypot(c.x - x0, c.y - y0) + Math.hypot((c.x1 - x0), (c.y1 - y0));
      const n = Math.max(2, Math.min(24, Math.ceil(Math.sqrt(len / tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        let x, y;
        if (c.type === "Q") { x = u * u * x0 + 2 * u * t * c.x1 + t * t * c.x; y = u * u * y0 + 2 * u * t * c.y1 + t * t * c.y; }
        else { x = u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x; y = u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y; }
        add(x, y);
      }
      x0 = c.x; y0 = c.y;
    } else if (c.type === "Z") { if (cur && cur.length > 2) rings.push(cur); cur = null; }
  }
  if (cur && cur.length > 2) rings.push(cur);
  return rings;
}

export function union(...sets) {
  const c = new C.Clipper(); const out = new C.Paths();
  for (const s of sets) if (s && s.length) c.AddPaths(s, C.PolyType.ptSubject, true);
  c.Execute(C.ClipType.ctUnion, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}
export function subtract(a, b) {
  if (!b || !b.length) return a;
  const c = new C.Clipper(); const out = new C.Paths();
  c.AddPaths(a, C.PolyType.ptSubject, true); c.AddPaths(b, C.PolyType.ptClip, true);
  c.Execute(C.ClipType.ctDifference, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}
export function intersect(a, b) {
  const c = new C.Clipper(); const out = new C.Paths();
  c.AddPaths(a, C.PolyType.ptSubject, true); c.AddPaths(b, C.PolyType.ptClip, true);
  c.Execute(C.ClipType.ctIntersection, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}
export function offset(paths, mm) {
  if (!paths.length || !mm) return paths;
  const co = new C.ClipperOffset(2, 0.02 * UM); const out = new C.Paths();
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  co.Execute(out, mm * UM);
  return out;
}
// Outer outlines only (fills every counter and hole).
export function solidOutline(paths) {
  return union(paths.filter((p) => C.Clipper.Orientation(p)));
}
export function islands(paths) { return paths.filter((p) => C.Clipper.Orientation(p)).length; }
export function area(paths) { let a = 0; for (const p of paths) a += C.Clipper.Area(p); return a / (UM * UM); }

export function bounds(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) { if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X; if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y; }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, cx: 0, cy: 0 };
  return { x0: x0 / UM, y0: y0 / UM, x1: x1 / UM, y1: y1 / UM, w: (x1 - x0) / UM, h: (y1 - y0) / UM, cx: (x0 + x1) / 2 / UM, cy: (y0 + y1) / 2 / UM };
}
export function translate(paths, dx, dy) {
  const X = Math.round(dx * UM), Y = Math.round(dy * UM);
  return paths.map((p) => p.map((q) => ({ X: q.X + X, Y: q.Y + Y })));
}

// ---------- primitives (mm) ----------
export function circle(cx, cy, r, n) {
  n = n || Math.max(24, Math.min(96, Math.round(r * 8)));
  const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  return [p];
}
export function rect(x0, y0, x1, y1) { return [[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]]; }
export function roundRect(x0, y0, x1, y1, r) {
  r = Math.max(0.01, Math.min(r, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01));
  return offset(rect(x0 + r, y0 + r, x1 - r, y1 - r), r);
}

// Text as filled outlines. Lines are centred on x = 0; the block is centred on y = 0.
// `size` is the cap height in mm (the height of a capital H), which is what people mean by text size.
// `curve` bends each line along an arc spanning that many degrees (positive arches up).
export function textPaths(font, text, size, { spacing = 0, lineGap = 0.25, align = "center", curve = 0 } = {}) {
  const capUnits = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fs = size * font.unitsPerEm / capUnits; // font size giving the requested cap height
  const lines = String(text || "").split(/\r?\n/).map((s) => s.replace(/\s+$/, "")).filter((s, i, a) => s || a.length === 1);
  const lineH = size * (1 + lineGap) + size * 0.35;
  let all = [];
  lines.forEach((line, i) => {
    if (!line) return;
    const glyphs = font.stringToGlyphs(line);
    let x = 0; const placed = [];
    glyphs.forEach((g, gi) => {
      const adv = (g.advanceWidth || 0) * fs / font.unitsPerEm;
      placed.push({ rings: flatten(g.getPath(x, 0, fs).commands), mid: x + adv / 2 });
      const kern = gi < glyphs.length - 1 ? font.getKerningValue(g, glyphs[gi + 1]) * fs / font.unitsPerEm : 0;
      x += adv + kern + spacing;
    });
    const width = Math.max(1e-3, x - spacing);
    let parts = [];
    if (Math.abs(curve) > 0.5) {
      // bend: a glyph centred at `mid` sits at angle (mid - width/2) / R on a circle of radius R
      const R = width / Math.abs(curve * Math.PI / 180);
      for (const g of placed) {
        const a = (g.mid - width / 2) / R, c = Math.cos(a), s = Math.sin(a);
        for (const r of g.rings) parts.push(r.map((q) => {
          const lx = q.X / UM - g.mid, ly = q.Y / UM; // glyph-local, baseline at y = 0
          // arch: circle centre below the baseline; smile: centre above it. Letters stay upright to the arc.
          const X = curve > 0 ? (R + ly) * s + lx * c : (R - ly) * s + lx * c;
          const Y = curve > 0 ? (R + ly) * c - lx * s - R : R - (R - ly) * c + lx * s;
          return { X: Math.round(X * UM), Y: Math.round(Y * UM) };
        }));
      }
    } else for (const g of placed) parts.push(...g.rings);
    let shape = union(parts);
    const b = bounds(shape);
    const dx = align === "left" ? -b.x0 : align === "right" ? -b.x1 : -b.cx;
    shape = translate(shape, dx, -i * lineH);
    all = all.concat(shape);
  });
  all = union(all);
  const b = bounds(all);
  return translate(all, 0, -b.cy);
}

// Morphological opening: what's left of a shape after anything thinner than `w` mm is removed.
export function opening(paths, w) { return offset(offset(paths, -w / 2), w / 2); }

// ---------- solids ----------
function dropCollinear(r) {
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
    if ((b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X) !== 0) out.push(b);
  }
  return out;
}

// Extrude filled outlines (with holes) from z0 to z1. Returns a flat Float32Array of triangles (mm).
export function extrude(paths, z0, z1) {
  const c = new C.Clipper(); const tree = new C.PolyTree();
  // drop points that sit on a straight edge: earcut skips them, which would leave T-junctions in the mesh
  // and pull every edge in by 5 µm so outlines that touch along an edge become separate, closed solids
  const co = new C.ClipperOffset(2, 1); const shrunk = new C.Paths();
  co.AddPaths(paths, C.JoinType.jtMiter, C.EndType.etClosedPolygon); co.Execute(shrunk, -5);
  c.AddPaths(C.Clipper.CleanPolygons(shrunk, 1.5), C.PolyType.ptSubject, true);
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const out = [];
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  const walk = (node) => {
    for (const outer of node.Childs()) {
      if (outer.IsHole()) continue;
      const rings = [outer.Contour(), ...outer.Childs().map((h) => h.Contour())].map(dropCollinear).filter((r) => r.length > 2);
      if (!rings.length || rings[0].length < 3) continue;
      // caps
      const flat = [], holes = [];
      rings.forEach((r, i) => { if (i) holes.push(flat.length / 2); for (const q of r) flat.push(q.X / UM, q.Y / UM); });
      const idx = earcut(flat, holes, 2);
      // integer copies of the ring points, to find any that earcut skipped (they'd leave T-junctions)
      const ix = []; for (let k = 0; k < flat.length; k += 2) ix.push([Math.round(flat[k] * UM), Math.round(flat[k + 1] * UM)]);
      const onEdge = (A, B) => {
        const hit = [];
        const minX = Math.min(A[0], B[0]), maxX = Math.max(A[0], B[0]), minY = Math.min(A[1], B[1]), maxY = Math.max(A[1], B[1]);
        for (const P of ix) {
          if (P[0] < minX || P[0] > maxX || P[1] < minY || P[1] > maxY) continue;
          if ((P[0] === A[0] && P[1] === A[1]) || (P[0] === B[0] && P[1] === B[1])) continue;
          if ((B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]) !== 0) continue;
          hit.push(P);
        }
        const L = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2;
        return hit.sort((m, n) => ((m[0] - A[0]) * (B[0] - A[0]) + (m[1] - A[1]) * (B[1] - A[1])) / L - ((n[0] - A[0]) * (B[0] - A[0]) + (n[1] - A[1]) * (B[1] - A[1])) / L);
      };
      const cap = (P0, P1, P2) => { // P* integer points, counter-clockwise
        const ring = [P0, ...onEdge(P0, P1), P1, ...onEdge(P1, P2), P2, ...onEdge(P2, P0)];
        const f = (P) => [P[0] / UM, P[1] / UM];
        if (ring.length === 3) {
          const [a, b, c] = ring.map(f);
          tri(a[0], a[1], z1, b[0], b[1], z1, c[0], c[1], z1); tri(a[0], a[1], z0, c[0], c[1], z0, b[0], b[1], z0);
          return;
        }
        const m = [(P0[0] + P1[0] + P2[0]) / 3 / UM, (P0[1] + P1[1] + P2[1]) / 3 / UM];
        for (let k = 0; k < ring.length; k++) {
          const a = f(ring[k]), b = f(ring[(k + 1) % ring.length]);
          tri(m[0], m[1], z1, a[0], a[1], z1, b[0], b[1], z1); tri(m[0], m[1], z0, b[0], b[1], z0, a[0], a[1], z0);
        }
      };
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], d = idx[i + 2];
        const A = ix[a], B = ix[b], D = ix[d];
        const ccw = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]) > 0;
        if (ccw) cap(A, B, D); else cap(A, D, B);
      }
      // walls: outer contours run counter-clockwise, holes clockwise, so (dy, -dx) always faces out
      for (const r of rings) {
        const ring = r;
        for (let i = 0; i < ring.length; i++) {
          const A = ring[i], B = ring[(i + 1) % ring.length];
          const ax = A.X / UM, ay = A.Y / UM, bx = B.X / UM, by = B.Y / UM;
          tri(ax, ay, z0, bx, by, z0, bx, by, z1);
          tri(ax, ay, z0, bx, by, z1, ax, ay, z1);
        }
      }
      for (const h of outer.Childs()) walk(h); // islands inside holes
    }
  };
  walk(tree);
  return new Float32Array(out);
}
