/* Shape makers for tools/maker: things made from sizes, not from a picture (vase, desk organizer).
   Each kind gives its sliders, its styles, a sealed mesh in millimetres (z up, resting on z = 0) and its print checks.
   Needs MakerGeo for the organizer. Works in the browser (window.MakerSolids) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./geo.js"));
  else root.MakerSolids = factory(root.MakerGeo);
})(typeof self !== "undefined" ? self : this, function (G) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), TAU = Math.PI * 2;

  /* ---- vase: a profile turned round its axis, with optional flat sides, ribs and twist ---- */
  const VASE = {
    title: "Vase",
    params: [
      { k: "h", label: "Height", min: 40, max: 250, step: 1, def: 150 },
      { k: "bottom", label: "Bottom width", min: 20, max: 200, step: 1, def: 60 },
      { k: "mid", label: "Middle width", min: 20, max: 220, step: 1, def: 96 },
      { k: "neck", label: "Neck width", min: 15, max: 220, step: 1, def: 56 },
      { k: "top", label: "Top width", min: 15, max: 220, step: 1, def: 72 },
      { k: "sides", label: "Flat sides", min: 0, max: 12, step: 1, def: 0, unit: "", hint: "0 is round." },
      { k: "ribs", label: "Ribs", min: 0, max: 32, step: 1, def: 12, unit: "" },
      { k: "ribD", label: "Rib depth", min: 0, max: 8, step: 0.2, def: 2.4 },
      { k: "twist", label: "Twist", min: -360, max: 360, step: 5, def: 90, unit: "°" },
      { k: "wall", label: "Wall", min: 0.8, max: 5, step: 0.1, def: 1.6 },
      { k: "floor", label: "Bottom thickness", min: 0.8, max: 6, step: 0.2, def: 2 },
    ],
    flags: [{ k: "spiral", label: "Solid, for spiral vase mode", def: false, hint: "Bambu Studio: turn on Others, Special mode, Spiral vase. One wall, no seam." }],
    styles: [
      ["Classic", { h: 150, bottom: 60, mid: 96, neck: 56, top: 72, sides: 0, ribs: 12, ribD: 2.4, twist: 90 }],
      ["Tulip", { h: 160, bottom: 48, mid: 70, neck: 84, top: 110, sides: 0, ribs: 8, ribD: 3, twist: 0 }],
      ["Bottle", { h: 180, bottom: 74, mid: 82, neck: 34, top: 36, sides: 0, ribs: 0, ribD: 0, twist: 0 }],
      ["Twisted", { h: 150, bottom: 70, mid: 80, neck: 70, top: 80, sides: 6, ribs: 0, ribD: 0, twist: 120 }],
      ["Cylinder", { h: 120, bottom: 80, mid: 80, neck: 80, top: 80, sides: 0, ribs: 24, ribD: 1.6, twist: 0 }],
      ["Bowl", { h: 80, bottom: 70, mid: 112, neck: 134, top: 142, sides: 0, ribs: 0, ribD: 0, twist: 0 }],
    ],
    /* radius of the smooth profile at height fraction t (0 bottom, 1 top): a smooth curve through the four widths */
    radius(p, t) {
      const xs = [0, 0.35, 0.75, 1], ys = [p.bottom / 2, p.mid / 2, p.neck / 2, p.top / 2];
      const m = xs.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (xs[1] - xs[0]) : i === 3 ? (ys[3] - ys[2]) / (xs[3] - xs[2]) : (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]));
      let i = t < xs[1] ? 0 : t < xs[2] ? 1 : 2; const h = xs[i + 1] - xs[i], s = clamp((t - xs[i]) / h, 0, 1), s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
    },
    /* outside radius at angle a and height z */
    outer(p, a, z) {
      const t = z / p.h, tw = (p.twist * Math.PI / 180) * t; let r = VASE.radius(p, t);
      if (p.sides >= 3) { const w = TAU / p.sides; let q = ((a - tw) % w + w) % w; r *= Math.cos(w / 2) / Math.cos(q - w / 2); }
      if (p.ribs > 0 && p.ribD > 0) r += p.ribD * 0.5 * Math.cos(p.ribs * (a - tw));
      return Math.max(r, (p.spiral ? 0 : p.wall) + 3);
    },
    build(p) {
      const n = p.sides >= 3 ? p.sides : 0, per = Math.max(n, p.ribs > 0 && p.ribD > 0 ? p.ribs : 0);
      let S = per ? per * Math.max(4, Math.round(120 / per)) : 120; if (n && p.ribs > 0 && p.ribD > 0) S = n * p.ribs * Math.max(1, Math.round(160 / (n * p.ribs))); S = clamp(S, 48, 384);
      const Z = clamp(Math.round(p.h / 1.5), 24, 170), verts = [], tris = [];
      const ring = (z, inner) => { const b = verts.length / 3; for (let i = 0; i < S; i++) { const a = TAU * i / S, r = VASE.outer(p, a, z) - (inner ? p.wall : 0); verts.push(r * Math.cos(a), r * Math.sin(a), z); } return b; };
      const pt = (x, y, z) => { verts.push(x, y, z); return verts.length / 3 - 1; };
      const out = []; for (let j = 0; j <= Z; j++) out.push(ring(p.h * j / Z, false));
      for (let j = 0; j < Z; j++) for (let i = 0; i < S; i++) { const k = (i + 1) % S, a = out[j] + i, b = out[j] + k, c = out[j + 1] + k, d = out[j + 1] + i; tris.push(a, b, c, a, c, d); }
      const c0 = pt(0, 0, 0); for (let i = 0; i < S; i++) tris.push(c0, out[0] + (i + 1) % S, out[0] + i);
      if (p.spiral) { const c1 = pt(0, 0, p.h); for (let i = 0; i < S; i++) tris.push(c1, out[Z] + i, out[Z] + (i + 1) % S); }
      else {
        const f = Math.min(p.floor, p.h - 2), Zi = Math.max(8, Math.round((p.h - f) / 1.5)), inn = []; for (let j = 0; j <= Zi; j++) inn.push(ring(f + (p.h - f) * j / Zi, true));
        for (let j = 0; j < Zi; j++) for (let i = 0; i < S; i++) { const k = (i + 1) % S, a = inn[j] + i, b = inn[j] + k, c = inn[j + 1] + k, d = inn[j + 1] + i; tris.push(a, c, b, a, d, c); }
        const c1 = pt(0, 0, f); for (let i = 0; i < S; i++) tris.push(c1, inn[0] + i, inn[0] + (i + 1) % S);
        for (let i = 0; i < S; i++) { const k = (i + 1) % S, o = out[Z], q = inn[Zi]; tris.push(o + i, o + k, q + k, o + i, q + k, q + i); }
      }
      let R = 0; for (let i = 0; i < verts.length; i += 3) R = Math.max(R, Math.abs(verts[i]), Math.abs(verts[i + 1]));
      for (let i = 0; i < verts.length; i += 3) { verts[i] += R; verts[i + 1] += R; }
      return { verts, tris, size: [2 * R, 2 * R, p.h] };
    },
    checks(p, mesh, bed) {
      const out = [], w = mesh.size[0];
      let lean = 0; for (let j = 0; j < 60; j++) { const a = VASE.radius(p, j / 60), b = VASE.radius(p, (j + 1) / 60); lean = Math.max(lean, Math.abs(b - a) / (p.h / 60)); }
      out.push(lean <= 1 ? ["ok", "The sides never lean more than 45°, so it prints without supports."] : ["warn", "The side leans more than 45° somewhere. Make the widths closer together or the vase taller, or it needs supports."]);
      if (p.spiral) out.push(["info", "Solid shape: turn on Spiral vase in Bambu Studio (Others, Special mode). It prints one wall with no seam."]);
      else { out.push(p.wall >= 1.2 ? ["ok", `Wall ${p.wall} mm and a ${p.floor} mm bottom.`] : ["info", `Wall ${p.wall} mm is thin. 1.2 mm or more is sturdier.`]); out.push(["info", "For a vase that holds water, print 3 or more walls and a 100% solid bottom."]); }
      if (p.bottom < w * 0.35) out.push(["warn", "The bottom is narrow next to the widest part, so it can tip over. Widen the bottom."]);
      return out;
    },
    print: "Prints standing up, no supports.",
  };

  /* ---- desk organizer: a tray of compartments ---- */
  const ORG = {
    title: "Desk organizer",
    params: [
      { k: "w", label: "Width", min: 40, max: 250, step: 1, def: 160 },
      { k: "d", label: "Depth", min: 30, max: 250, step: 1, def: 90 },
      { k: "h", label: "Height", min: 10, max: 120, step: 1, def: 45 },
      { k: "cols", label: "Compartments across", min: 1, max: 8, step: 1, def: 3, unit: "" },
      { k: "rows", label: "Compartments deep", min: 1, max: 6, step: 1, def: 2, unit: "" },
      { k: "back", label: "Back row height", min: 10, max: 150, step: 1, def: 80, hint: "A taller back row holds pens. Set it to the height for a flat tray." },
      { k: "wall", label: "Wall", min: 1.2, max: 5, step: 0.2, def: 2 },
      { k: "floor", label: "Bottom thickness", min: 0.8, max: 5, step: 0.2, def: 1.6 },
      { k: "corner", label: "Corner rounding", min: 0, max: 20, step: 1, def: 6 },
    ],
    flags: [],
    styles: [
      ["Pen and tray", { w: 160, d: 90, h: 45, cols: 3, rows: 2, back: 90 }],
      ["Drawer tray", { w: 200, d: 120, h: 30, cols: 4, rows: 2, back: 30 }],
      ["Pen cup", { w: 80, d: 80, h: 100, cols: 2, rows: 2, back: 100 }],
      ["Small parts", { w: 150, d: 100, h: 22, cols: 5, rows: 3, back: 22 }],
    ],
    build(p) {
      const res = 0.5, C = Math.round(p.w / res), R = Math.round(p.d / res), wl = Math.max(2, Math.round(p.wall / res)), cr = Math.min(p.corner, p.w / 2 - 1, p.d / 2 - 1) / res;
      const rr = (c, r, x0, y0, x1, y1, rad) => { if (c < x0 || c >= x1 || r < y0 || r >= y1) return false; rad = Math.max(0, Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2)); const dx = c + 0.5 < x0 + rad ? x0 + rad - c - 0.5 : c + 0.5 > x1 - rad ? c + 0.5 - (x1 - rad) : 0, dy = r + 0.5 < y0 + rad ? y0 + rad - r - 0.5 : r + 0.5 > y1 - rad ? r + 0.5 - (y1 - rad) : 0; return dx * dx + dy * dy <= rad * rad; };
      const cw = (C - wl * (p.cols + 1)) / p.cols, rh = (R - wl * (p.rows + 1)) / p.rows, tall = p.rows > 1 && p.back > p.h;
      const body = new Uint8Array(C * R), walls = new Uint8Array(C * R), backWalls = new Uint8Array(C * R);
      /* row 0 of the grid is the back of the tray */
      const split = Math.round(wl + rh + wl);   // the back row and both of its walls
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (!rr(c, r, 0, 0, C, R, cr)) continue; const i = r * C + c; body[i] = 1; let pocket = false;
        for (let a = 0; a < p.cols && !pocket; a++) for (let b = 0; b < p.rows && !pocket; b++) { const x0 = Math.round(wl + a * (cw + wl)), y0 = Math.round(wl + b * (rh + wl)); pocket = rr(c, r, x0, y0, Math.round(x0 + cw), Math.round(y0 + rh), Math.max(0, cr - wl)); }
        if (!pocket) { walls[i] = 1; if (tall && r < split) backWalls[i] = 1; } }
      const parts = [{ mask: body, z0: 0, z1: p.floor }, { mask: walls, z0: 0, z1: p.h }]; if (tall) parts.push({ mask: backWalls, z0: 0, z1: p.back });
      const m = G.meshUnion(parts, { C, R, res });
      return { verts: m.verts, tris: m.tris, size: [C * res, R * res, tall ? p.back : p.h], pocket: [cw * res, rh * res] };
    },
    checks(p, mesh) {
      const out = [], [a, b] = mesh.pocket;
      out.push(a >= 12 && b >= 12 ? ["ok", `Each compartment is ${a.toFixed(0)} × ${b.toFixed(0)} mm inside.`] : ["warn", `Each compartment is only ${a.toFixed(0)} × ${b.toFixed(0)} mm inside. Use fewer compartments or a bigger tray.`]);
      out.push(["ok", "Prints open side up, no supports."]);
      if (p.rows > 1 && p.back > p.h) out.push(["info", `The back row stands ${p.back} mm tall for pens.`]);
      return out;
    },
    print: "Prints open side up, no supports.",
  };

  const kinds = { vase: VASE, organizer: ORG };
  /* the full set of values for a kind: saved ones over the defaults, kept inside each slider's range */
  function values(kind, saved) { const K = kinds[kind], o = {}; if (!K) return o; saved = saved || {};
    for (const q of K.params) { const v = +saved[q.k]; o[q.k] = Number.isFinite(v) && q.k in saved ? clamp(v, q.min, q.max) : q.def; }
    for (const q of K.flags) o[q.k] = q.k in saved ? !!saved[q.k] : q.def; return o; }
  function build(kind, saved) { const K = kinds[kind], p = values(kind, saved), mesh = K.build(p); return { kind, p, mesh, title: K.title, print: K.print, checks: K.checks(p, mesh) }; }
  return { kinds, values, build };
});
