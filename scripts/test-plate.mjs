// Plate maker geometry tests. Run: node scripts/test-plate.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as G from "../assets/plate-geom.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("plate base: volume matches its outline minus the slots", () => {
  const spec = G.PLATES["us-car"];
  const { base, rim } = G.plateShapes(spec, { border: 4 });
  const solid = G.extrude(base, 0, 2);
  const area = Math.abs(G.signedArea(base[0].outer)) - base[0].holes.reduce((s, h) => s + Math.abs(G.signedArea(h)), 0);
  close(G.meshVolume(solid), area * 2, 1, "base volume");
  const r = 9.5, full = spec.w * spec.h - (4 - Math.PI) * r * r;
  close(Math.abs(G.signedArea(base[0].outer)), full, 5, "rounded corner area");
  const slot = spec.slotLen * spec.slotWide - (4 - Math.PI) * (spec.slotWide / 2) ** 2;
  close(Math.abs(G.signedArea(base[0].holes[0])), slot, 0.5, "slot area");
  const rimVol = G.meshVolume(G.extrude(rim, 2, 3));
  assert.ok(rimVol > 0 && rimVol < full, "rim is a ring");
  for (const [x, y] of spec.holes) assert.ok(Math.abs(x) + spec.slotLen / 2 < spec.w / 2 - 4 && Math.abs(y) + spec.slotWide / 2 < spec.h / 2 - 4, "slots sit inside the border");
});

test("plate frame: the window is cut out and every screw slot sits in solid frame", () => {
  const spec = G.PLATES["us-frame"];
  const { base } = G.plateShapes(spec);
  assert.equal(base[0].holes.length, 5);
  const win = G.windowRing(spec);
  const winArea = spec.window.w * spec.window.h - (4 - Math.PI) * spec.window.r ** 2;
  close(Math.abs(G.signedArea(win)), winArea, 3, "window area");
  for (const [x, y] of spec.holes) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = [x + dx * (spec.slotLen / 2 + 1.5), y + dy * (spec.slotWide / 2 + 1.5)];
      assert.ok(!G.pointInRing(p, win), `slot at ${x},${y} clears the window`);
      assert.ok(G.pointInRing(p, base[0].outer), `slot at ${x},${y} is inside the frame`);
    }
  }
  // The real plate (12 × 6 in, holes on the same pattern) fits behind the frame.
  const plateTop = spec.holes[0][1] + 15.875, plateBottom = spec.holes[2][1] - 15.875;
  close(plateTop - plateBottom, 152.4, 0.01, "hole pattern matches a plate");
  assert.ok(plateTop < spec.h / 2 && plateBottom > -spec.h / 2 && 304.8 < spec.w);
});

test("every face points outward (closed solid, positive volume)", () => {
  for (const spec of Object.values(G.PLATES)) assert.ok(G.meshVolume(G.extrude(G.plateShapes(spec).base, 0, 2)) > 0);
});

test("mask outline: a disc traces to a circle, a ring keeps its hole", () => {
  const w = 200, h = 200, a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 100, y - 100);
    a[y * w + x] = d < 80 && d > 40 ? 255 : 0;
  }
  const polys = G.loopsToPolys(G.maskLoops(a, w, h));
  assert.equal(polys.length, 1); assert.equal(polys[0].holes.length, 1);
  const vol = G.meshVolume(G.extrude(polys, 0, 1));
  close(vol, Math.PI * (80 * 80 - 40 * 40), 120, "ring area");
});

test("mask outline: separate shapes, a dot inside a hole, and a saddle", () => {
  const w = 60, h = 60, a = new Uint8Array(w * h);
  const fill = (x0, y0, x1, y1, v = 255) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = v; };
  fill(2, 2, 28, 28); fill(8, 8, 22, 22, 0); fill(13, 13, 17, 17); // square with a hole and an island
  fill(32, 32, 40, 40); fill(40, 40, 48, 48); // two squares touching at a corner
  const polys = G.loopsToPolys(G.maskLoops(a, w, h));
  const holes = polys.reduce((n, p) => n + p.holes.length, 0);
  assert.equal(holes, 1);
  assert.ok(polys.length >= 3, `outer pieces: ${polys.length}`);
  assert.ok(G.meshVolume(G.extrude(polys, 0, 1)) > 0);
});

test("3MF: write then read gives the same triangles, and it's a valid zip with deflate", async () => {
  const spec = G.PLATES["us-moto"];
  const s = G.plateShapes(spec);
  const base = G.extrude(s.base, 0, 2), rim = G.extrude(s.rim, 2, 3);
  for (const deflate of [null, G.deflateRaw]) {
    const file = await G.write3MF({ title: "Test <plate>", parts: [{ name: "Base", color: "#1f2638", pos: base }, { name: "Border", color: "#b8892a", pos: rim }], deflate });
    const back = await G.parse3MF(file);
    assert.equal(back.length, base.length + rim.length);
    close(G.meshVolume(back), G.meshVolume(base) + G.meshVolume(rim), 0.5, "volume after roundtrip");
    const zip = await G.readZip(file);
    const xml = new TextDecoder().decode(await zip.read("3D/3dmodel.model"));
    assert.match(xml, /Test &lt;plate&gt;/); assert.match(xml, /<basematerials id="1"><base name="#1f2638" displaycolor="#1F2638FF"\/>/);
    assert.match(xml, /<components><component objectid="2"\/><component objectid="3"\/><\/components>/);
  }
});

test("STL: binary write then read", () => {
  const m = G.extrude(G.plateShapes(G.PLATES["us-car"]).base, 0, 2);
  const back = G.parseSTL(G.writeSTL([m]));
  assert.equal(back.length, m.length);
  close(G.meshVolume(back), G.meshVolume(m), 0.5, "volume");
  const ascii = new TextEncoder().encode("solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n");
  assert.equal(G.parseSTL(ascii).length, 9);
  assert.throws(() => G.parseSTL(new TextEncoder().encode("hello")), /isn't an STL/);
});

test("the flower library files all load, sit flat and are closed", async () => {
  const dir = new URL("../assets/plates/flowers/", import.meta.url);
  const list = JSON.parse(await readFile(new URL("../flowers.json", dir), "utf8"));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".stl")).sort();
  assert.deepEqual(list.map((f) => f.file).sort(), files, "every file is credited, every credit has a file");
  for (const f of list) {
    for (const k of ["name", "author", "license", "source"]) assert.ok(f[k], `${f.file} ${k}`);
    assert.match(f.license, /^CC(0| BY| BY-SA) /);
    assert.match(f.source, /^https:\/\/(www\.)?(printables|thingiverse)\.com\//);
    const pos = G.parseSTL(await readFile(new URL(f.file, dir)));
    const { lo, hi } = G.bounds(pos);
    close(lo[2], 0, 0.01, `${f.file} sits on z=0`);
    assert.ok(hi[1] - lo[1] >= 0.85 * (hi[0] - lo[0]), `${f.file} stands upright (taller than wide, or close)`);
    assert.ok(G.meshVolume(pos) > 0, `${f.file} volume`);
  }
});
