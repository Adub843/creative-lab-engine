// Plate outlines and basic shapes, all centred on 0,0 in mm (y up), sized to w × h.
import { UM, union, subtract, offset, circle, rect, roundRect, bounds } from "../geom.js";

const poly = (pts) => [pts.map(([x, y]) => ({ X: Math.round(x * UM), Y: Math.round(y * UM) }))];

function fit(paths, w, h) {
  const b = bounds(paths); const sx = w / (b.w || 1), sy = h / (b.h || 1);
  return paths.map((p) => p.map((q) => ({ X: Math.round((q.X / UM - b.cx) * sx * UM), Y: Math.round((q.Y / UM - b.cy) * sy * UM) })));
}
// Rounds every corner to radius r (inside corners too), keeping the overall size.
export function roundCorners(paths, r) {
  if (!(r > 0.05)) return paths;
  return offset(offset(offset(paths, r), -2 * r), r);
}

function starPts(n = 5, inner = 0.45) {
  const p = []; for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + i * Math.PI / n; const r = i % 2 ? inner : 1; p.push([r * Math.cos(a), r * Math.sin(a)]); } return p;
}
function heartPts() {
  const p = []; for (let i = 0; i < 96; i++) { const t = i / 96 * Math.PI * 2; p.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]); } return p;
}

export const PLATE_STYLES = [
  { id: "none", name: "No plate" },
  { id: "rect", name: "Rectangle", w: 150, h: 100, r: 10 },
  { id: "circle", name: "Circle", w: 100, h: 100 },
  { id: "triangle", name: "Triangle", w: 120, h: 104, r: 6 },
  { id: "star", name: "Star", w: 110, h: 105, r: 3 },
  { id: "heart", name: "Heart", w: 110, h: 100 },
  { id: "cat", name: "Cat", w: 110, h: 100, r: 3 },
  { id: "arch", name: "Arch", w: 100, h: 120 },
  { id: "bone", name: "Bone", w: 120, h: 50 },
  { id: "tagLong", name: "Long tag", w: 30, h: 100 },
  { id: "tagShort", name: "Short tag", w: 32, h: 64 },
  { id: "outline", name: "Follow design", margin: 4 },
];

export function plateOutline(style, w, h, r = 0) {
  switch (style) {
    case "rect": return roundRect(-w / 2, -h / 2, w / 2, h / 2, Math.min(r, w / 2, h / 2));
    case "circle": return fit(circle(0, 0, 50, 128), w, h);
    case "triangle": return roundCorners(fit(poly([[0, 1], [-0.866, -0.5], [0.866, -0.5]]), w, h), r);
    case "star": return roundCorners(fit(poly(starPts()), w, h), r);
    case "heart": return fit(poly(heartPts()), w, h);
    case "cat": {
      const head = circle(0, 0, 40, 96);
      const ears = union(poly([[-38, 12], [-34, 52], [-8, 34]]), poly([[38, 12], [34, 52], [8, 34]]));
      return roundCorners(fit(union(head, ears), w, h), r || 3);
    }
    case "arch": return fit(union(rect(-50, -60, 50, 10), circle(0, 10, 50, 96)), w, h);
    case "bone": {
      const k = h / 2, rr = k * 0.55;
      return union(rect(-w / 2 + rr, -k * 0.5, w / 2 - rr, k * 0.5), circle(-w / 2 + rr, k - rr, rr), circle(-w / 2 + rr, -k + rr, rr), circle(w / 2 - rr, k - rr, rr), circle(w / 2 - rr, -k + rr, rr));
    }
    case "tagLong": case "tagShort": return roundRect(-w / 2, -h / 2, w / 2, h / 2, w / 2);
  }
  return [];
}

export const SHAPES = [
  { id: "square", name: "Square" }, { id: "triangle", name: "Triangle" }, { id: "circle", name: "Circle" }, { id: "star", name: "Star" },
];
export function shapeOutline(kind, w, h, r = 0) {
  if (kind === "square") return roundRect(-w / 2, -h / 2, w / 2, h / 2, Math.max(0.01, r));
  if (kind === "circle") return fit(circle(0, 0, 50, 96), w, h);
  if (kind === "triangle") return roundCorners(fit(poly([[0, 1], [-0.866, -0.5], [0.866, -0.5]]), w, h), r);
  if (kind === "star") return roundCorners(fit(poly(starPts()), w, h), r);
  return [];
}

export { subtract };
