/* Maker geometry core (Charleston 3D makers).
   Turns a grid of labelled cells into smooth outlines, and those into sealed solids, the way a slicer wants them:
   - every part is a prism with a real outline (no pixel boxes), so files stay small and edges are smooth;
   - two parts that touch share the same outline points, so there are no gaps or overlaps between colours;
   - every edge belongs to exactly two triangles (sealed), checked by sealed().
   Needs earcut (../vendor/earcut.min.js). Works in the browser (window.MakerGeo) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../vendor/earcut.min.js"));
  else root.MakerGeo = factory(root.earcut);
})(typeof self !== "undefined" ? self : this, function (earcutLib) {
  "use strict";
  const earcut = earcutLib && earcutLib.default ? earcutLib.default : earcutLib;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];      // direction of travel along side 0 top, 1 right, 2 bottom, 3 left (the cell is on the right)
  const OX = [0, 1, 0, -1], OY = [-1, 0, 1, 0];      // the cell on the other side of that side

  /* Outlines of every label in a grid. lab[r*C+c] = label (0 = empty). Returns Map(label -> [ring, ...]),
     ring = Float64Array of x,y pairs in cell units (y down). Points sit on the middle of each boundary edge and are
     smoothed with a 5-point average wherever only two labels meet, which both neighbours compute identically. */
  function traceLabels(lab, C, R, opt) {
    const smooth = !opt || opt.smooth !== false;
    const at = (c, r) => (c < 0 || r < 0 || c >= C || r >= R) ? 0 : lab[r * C + c];
    const simple = (c, r) => { const a = at(c - 1, r - 1), b = at(c, r - 1), d = at(c - 1, r), e = at(c, r);
      let n = 1; if (b !== a) n++; if (d !== a && d !== b) n++; if (e !== a && e !== b && e !== d) n++;
      if (n !== 2) return n === 1; return !(a === e && b === d); };
    const seen = new Uint8Array(C * R * 4), out = new Map();
    const boundary = (c, r, s, A) => at(c + OX[s], r + OY[s]) !== A;
    for (let r0 = 0; r0 < R; r0++) for (let c0 = 0; c0 < C; c0++) {
      const A = lab[r0 * C + c0]; if (!A) continue;
      for (let s0 = 0; s0 < 4; s0++) {
        if (seen[(r0 * C + c0) * 4 + s0] || !boundary(c0, r0, s0, A)) continue;
        const px = [], py = [], sv = [];
        let c = c0, r = r0, s = s0;
        do { seen[(r * C + c) * 4 + s] = 1;
          px.push(s === 0 || s === 2 ? c + 0.5 : s === 1 ? c + 1 : c); py.push(s === 1 || s === 3 ? r + 0.5 : s === 2 ? r + 1 : r);
          const vx = s === 0 || s === 1 ? c + 1 : c, vy = s === 1 || s === 2 ? r + 1 : r; sv.push(simple(vx, vy) ? 1 : 0);
          const s1 = (s + 1) & 3;
          if (boundary(c, r, s1, A)) s = s1;                                   // turn round this cell's corner
          else { const c2 = c + DX[s], r2 = r + DY[s];
            if (boundary(c2, r2, s, A)) { c = c2; r = r2; }                    // straight on
            else { c = c2 + OX[s]; r = r2 + OY[s]; s = (s + 3) & 3; } }       // turn the other way
        } while (c !== c0 || r !== r0 || s !== s0);
        const n = px.length; let X = px, Y = py;
        if (smooth && n >= 5) { X = new Array(n); Y = new Array(n);
          for (let i = 0; i < n; i++) { const a = (i + n - 2) % n, b = (i + n - 1) % n, d = (i + 1) % n, e = (i + 2) % n;
            if (sv[a] && sv[b] && sv[i] && sv[d]) { X[i] = (px[a] + 4 * px[b] + 6 * px[i] + 4 * px[d] + px[e]) / 16; Y[i] = (py[a] + 4 * py[b] + 6 * py[i] + 4 * py[d] + py[e]) / 16; }
            else { X[i] = px[i]; Y[i] = py[i]; } } }
        const ring = []; // drop points that sit exactly on the line between their two neighbours
        for (let i = 0; i < n; i++) { const b = (i + n - 1) % n, d = (i + 1) % n;
          const cr = (X[i] - X[b]) * (Y[d] - Y[i]) - (Y[i] - Y[b]) * (X[d] - X[i]);
          if (Math.abs(cr) > 1e-9) ring.push(X[i], Y[i]); }
        if (ring.length >= 6) { if (!out.has(A)) out.set(A, []); out.get(A).push(Float64Array.from(ring)); }
      }
    }
    return out;
  }

  const ringArea = (g) => { let a = 0; for (let i = 0, n = g.length; i < n; i += 2) { const j = (i + 2) % n; a += g[i] * g[j + 1] - g[j] * g[i + 1]; } return a / 2; };
  function inRing(x, y, g) { let inside = false; for (let i = 0, n = g.length, j = n - 2; i < n; j = i, i += 2) {
      const xi = g[i], yi = g[i + 1], xj = g[j], yj = g[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }

  /* rings of one label -> [{outer, holes:[...]}]. Outer rings run one way round and holes the other (the tracer keeps the label on its right). */
  function polygons(rings) {
    const info = rings.map((g) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < g.length; i += 2) { if (g[i] < x0) x0 = g[i]; if (g[i] > x1) x1 = g[i]; if (g[i + 1] < y0) y0 = g[i + 1]; if (g[i + 1] > y1) y1 = g[i + 1]; } return { g, a: ringArea(g), bb: [x0, x1, y0, y1] }; });
    const outers = info.filter((o) => o.a > 0).map((o) => ({ outer: o.g, holes: [], a: o.a, bb: o.bb }));
    for (const h of info.filter((o) => o.a < 0)) { let best = null;
      for (const o of outers) { if (h.bb[0] < o.bb[0] || h.bb[1] > o.bb[1] || h.bb[2] < o.bb[2] || h.bb[3] > o.bb[3]) continue;
        if (inRing(h.g[0], h.g[1], o.outer) && (!best || o.a < best.a)) best = o; }
      if (best) best.holes.push(h.g); }
    return outers;
  }

  /* polygons -> one sealed mesh between z0 and z1. tx(x,y) maps cell units to millimetres [X,Y]. */
  function extrude(polys, z0, z1, tx, into) {
    const V = into ? into.verts : [], T = into ? into.tris : [];
    for (const p of polys) {
      const flat = [], holes = []; const add = (g) => { for (let i = 0; i < g.length; i += 2) { const q = tx(g[i], g[i + 1]); flat.push(q[0], q[1]); } };
      add(p.outer); for (const h of p.holes) { holes.push(flat.length / 2); add(h); }
      const idx = earcut(flat, holes, 2); if (!idx.length) continue;
      const n = flat.length / 2, base = V.length / 3;
      for (let i = 0; i < n; i++) V.push(flat[i * 2], flat[i * 2 + 1], z0);
      for (let i = 0; i < n; i++) V.push(flat[i * 2], flat[i * 2 + 1], z1);
      const edge = new Map();
      for (let i = 0; i < idx.length; i += 3) { let a = idx[i], b = idx[i + 1], c = idx[i + 2];
        const ar = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
        if (ar < 0) { const t = b; b = c; c = t; }
        T.push(base + n + a, base + n + b, base + n + c, base + a, base + c, base + b);   // top faces up, bottom faces down
        for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = v * n + u; if (edge.has(k)) edge.delete(k); else edge.set(u * n + v, [u, v]); } }
      for (const [u, v] of edge.values()) T.push(base + n + v, base + n + u, base + u, base + n + v, base + u, base + v); // side walls on the outline
    }
    return { verts: V, tris: T };
  }

  /* every edge used by exactly two triangles, running opposite ways */
  function sealed(mesh) { const n = mesh.verts.length / 3, T = mesh.tris, m = new Map(); if (!T.length) return false;
    for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { const a = T[i + k], b = T[i + (k + 1) % 3]; const key = a * n + b; if (m.has(key)) return false; m.set(key, 1); }
    for (const key of m.keys()) { const a = Math.floor(key / n), b = key % n; if (!m.has(b * n + a)) return false; } return true; }
  function volume(mesh) { const V = mesh.verts, T = mesh.tris; let v = 0; for (let i = 0; i < T.length; i += 3) { const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
      v += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]); } return v / 6; }

  /* parts: [{mask: Uint8Array C*R, z0, z1, ...}]. g: {C, R, res, mirror}. Returns one mesh per part, in order.
     Parts on the same layer (same z0 and z1) are traced together so their shared edges match point for point. */
  function meshParts(parts, g) {
    const C = g.C, R = g.R, res = g.res, W = C * res, H = R * res;
    const tx = g.mirror ? (x, y) => [W - x * res, H - y * res] : (x, y) => [x * res, H - y * res];
    const out = new Array(parts.length), groups = new Map();
    parts.forEach((p, i) => { const k = p.z0 + "|" + p.z1 + "|" + (p.layer || ""); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    for (const list of groups.values()) {
      const lab = new Uint16Array(C * R); list.forEach((pi, li) => { const m = parts[pi].mask; for (let i = 0; i < m.length; i++) if (m[i]) lab[i] = li + 1; });
      const rings = traceLabels(lab, C, R, g);
      list.forEach((pi, li) => { const p = parts[pi]; const polys = polygons(rings.get(li + 1) || []);
        // mirrored outlines turn the other way round, which extrude() sorts out per triangle
        out[pi] = extrude(g.mirror ? polys.map((q) => ({ outer: q.outer, holes: q.holes })) : polys, p.z0, p.z1, tx); });
    }
    return out;
  }

  /* all the parts as one solid for a single-colour file: each column runs from 0 to its highest part, cut into flat slabs */
  function meshUnion(parts, g) {
    const C = g.C, R = g.R, hm = new Float32Array(C * R);
    for (const p of parts) for (let i = 0; i < hm.length; i++) if (p.mask[i] && p.z1 > hm[i]) hm[i] = p.z1;
    const lv = [...new Set(Array.from(hm).filter((v) => v > 0))].sort((a, b) => a - b);
    const slabs = lv.map((z, k) => { const m = new Uint8Array(C * R); for (let i = 0; i < hm.length; i++) if (hm[i] >= z) m[i] = 1; return { mask: m, z0: k ? lv[k - 1] : 0, z1: z, layer: "u" + k }; });
    const ms = meshParts(slabs, g), all = { verts: [], tris: [] };
    for (const m of ms) { const b = all.verts.length / 3; for (const v of m.verts) all.verts.push(v); for (const t of m.tris) all.tris.push(t + b); }
    return all;
  }

  /* exact round grow/shrink of a mask by rad cells (two-pass squared distance transform) */
  function sqDist(mask, C, R, inside) {
    const INF = 1e12, f = new Float64Array(C * R), n = Math.max(C, R), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), ff = new Float64Array(n);
    for (let i = 0; i < f.length; i++) f[i] = (mask[i] ? 1 : 0) === (inside ? 1 : 0) ? 0 : INF;
    const pass = (len, get, set) => { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; for (let q = 0; q < len; q++) ff[q] = get(q);
      for (let q = 1; q < len; q++) { let s; do { const p = v[k]; s = ((ff[q] + q * q) - (ff[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0); k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
      k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + ff[p]; } for (let q = 0; q < len; q++) set(q, d[q]); };
    for (let c = 0; c < C; c++) pass(R, (q) => f[q * C + c], (q, val) => { f[q * C + c] = val; });
    for (let r = 0; r < R; r++) pass(C, (q) => f[r * C + q], (q, val) => { f[r * C + q] = val; });
    return f;
  }
  function dilate(mask, C, R, rad) { if (rad <= 0) return mask.slice(); const d = sqDist(mask, C, R, true), o = new Uint8Array(C * R), r2 = rad * rad; for (let i = 0; i < o.length; i++) o[i] = d[i] <= r2 ? 1 : 0; return o; }
  function erode(mask, C, R, rad) { if (rad <= 0) return mask.slice(); const d = sqDist(mask, C, R, false), o = new Uint8Array(C * R), r2 = rad * rad; /* outside the grid counts as empty */
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const i = r * C + c, e = Math.min(c + 1, r + 1, C - c, R - r); o[i] = mask[i] && d[i] > r2 && e > rad ? 1 : 0; } return o; }

  return { traceLabels, polygons, extrude, sealed, volume, meshParts, meshUnion, dilate, erode, ringArea };
});
