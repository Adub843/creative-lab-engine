/* Tests for tools/maker/geo.js: sealed solids, right volume, colours that meet without gaps. Run: node scripts/test-maker-geo.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const box = { self: {} }; box.window = box.self; vm.createContext(box);   // load the browser files the way a page does
for (const f of ["../tools/vendor/earcut.min.js", "../tools/maker/geo.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), box, { filename: f });
const G = box.self.MakerGeo;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
const C = 200, R = 160, res = 0.25, g = { C, R, res };
const mask = (fn) => { const m = new Uint8Array(C * R); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (fn(c + 0.5, r + 0.5)) m[r * C + c] = 1; return m; };
const cells = (m) => m.reduce((a, b) => a + b, 0);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// 1. a disc
const disc = mask((x, y) => Math.hypot(x - 100, y - 80) < 60);
let [m] = G.meshParts([{ mask: disc, z0: 0, z1: 2 }], g);
ok(G.sealed(m), "disc is sealed"); ok(near(G.volume(m), cells(disc) * res * res * 2, 0.01), "disc volume " + G.volume(m).toFixed(1) + " vs " + (cells(disc) * res * res * 2).toFixed(1));
ok(m.tris.length / 3 < 3000, "disc is small (" + m.tris.length / 3 + " triangles)");
// 2. a ring with a hole and an island in the hole
const ring = mask((x, y) => { const d = Math.hypot(x - 100, y - 80); return (d < 70 && d > 50) || d < 20; });
[m] = G.meshParts([{ mask: ring, z0: 1, z1: 3 }], g);
ok(G.sealed(m), "ring + island is sealed"); ok(near(G.volume(m), cells(ring) * res * res * 2, 0.01), "ring volume");
// 3. three colours side by side on one layer, plus a frame: nothing lost, nothing doubled
const a = mask((x, y) => Math.hypot(x - 100, y - 80) < 60 && x < 90 + 10 * Math.sin(y / 9));
const b = mask((x, y) => Math.hypot(x - 100, y - 80) < 60 && !(x < 90 + 10 * Math.sin(y / 9)) && y < 80);
const c3 = mask((x, y) => Math.hypot(x - 100, y - 80) < 60 && !(x < 90 + 10 * Math.sin(y / 9)) && !(y < 80));
const fr = mask((x, y) => { const d = Math.hypot(x - 100, y - 80); return d >= 60 && d < 75; });
const ms = G.meshParts([{ mask: a, z0: 0, z1: 0.8 }, { mask: b, z0: 0, z1: 0.8 }, { mask: c3, z0: 0, z1: 0.8 }, { mask: fr, z0: 0, z1: 0.8 }], g);
ok(ms.every(G.sealed), "all four colour parts are sealed");
const vsum = ms.reduce((s, q) => s + G.volume(q), 0), want = (cells(a) + cells(b) + cells(c3) + cells(fr)) * res * res * 0.8;
ok(near(vsum, want, 0.01), "colour parts add up to the whole (" + vsum.toFixed(2) + " vs " + want.toFixed(2) + ")");
ok(ms.every((q) => G.volume(q) > 0), "every part faces outward");
// 4. mirrored (the face-down image layer) keeps the same volume and stays sealed
const mm = G.meshParts([{ mask: a, z0: 0, z1: 0.8 }], { C, R, res, mirror: true })[0];
ok(G.sealed(mm) && near(G.volume(mm), G.volume(ms[0]), 0.01), "mirrored part is sealed, same volume");
// 5. awkward pixels: checkerboard corners, single cells, one-cell lines
const odd = mask((x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return (cx > 20 && cx < 60 && cy > 20 && cy < 60 && (cx + cy) % 2 === 0) || (cy === 100 && cx > 10 && cx < 150) || (cx === 170 && cy > 10 && cy < 150); });
[m] = G.meshParts([{ mask: odd, z0: 0, z1: 1 }], g);
ok(G.sealed(m) && G.volume(m) > 0, "awkward pixels stay sealed");
// 6. one solid for a single-colour file
const u = G.meshUnion([{ mask: disc, z0: 0, z1: 0.8 }, { mask: fr, z0: 0, z1: 5 }, { mask: a, z0: 0.8, z1: 1.6 }], g);
ok(G.sealed(u) && G.volume(u) > 0, "single-colour solid is sealed");
// 7. round grow and shrink
const dot = mask((x, y) => Math.hypot(x - 100, y - 80) < 10);
const grown = G.dilate(dot, C, R, 8), back = G.erode(grown, C, R, 8);
ok(near(cells(grown), Math.PI * 18 * 18, 0.03), "grow by 8 gives a radius-18 disc"); ok(near(cells(back), cells(dot), 0.05), "shrink undoes grow");
// 8. speed at export size
const BC = 1600, BR = 1600, big = new Uint8Array(BC * BR); for (let r = 0; r < BR; r++) for (let c = 0; c < BC; c++) if (Math.hypot(c - 800, r - 800) < 780 && Math.sin(c / 37) * Math.cos(r / 41) > -0.2) big[r * BC + c] = 1;
let t = Date.now(); const bm = G.meshParts([{ mask: big, z0: 0, z1: 0.8 }], { C: BC, R: BR, res: 0.1 })[0]; t = Date.now() - t;
ok(G.sealed(bm) && t < 8000, "1600 x 1600 grid meshes in " + t + " ms, " + bm.tris.length / 3 + " triangles");
// 9. shape makers: every style of every kind is a sealed solid that faces outward
vm.runInContext(fs.readFileSync(path.join(__dirname, "../tools/maker/solids.js"), "utf8"), box, { filename: "solids.js" });
const S = box.self.MakerSolids;
for (const k of Object.keys(S.kinds)) for (const [n, st] of [["defaults", {}], ...S.kinds[k].styles]) { const b = S.build(k, st); ok(G.sealed(b.mesh) && G.volume(b.mesh) > 0, `${k} ${n}: sealed, ${b.mesh.size.map((v) => v.toFixed(0)).join(" x ")} mm`); }
{ const a = S.build("vase", {}), b = S.build("vase", { spiral: true }); ok(G.sealed(b.mesh) && G.volume(b.mesh) > G.volume(a.mesh) * 3, "spiral-mode vase is solid all the way through");
  const o = S.build("organizer", { w: 100, d: 60, h: 30, cols: 2, rows: 1, wall: 2, floor: 2, corner: 0, back: 30 }), want = 100 * 60 * 2 + (100 * 60 - 2 * 47 * 56) * 28; ok(near(G.volume(o.mesh), want, 0.03), "organizer volume " + G.volume(o.mesh).toFixed(0) + " vs " + want);
  ok(S.values("vase", { h: 9999, wall: "x" }).h === 250 && S.values("vase", { wall: "x" }).wall === 1.6, "sizes stay inside their sliders"); }
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
