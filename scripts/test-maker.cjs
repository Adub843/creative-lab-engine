// Maker (tools/maker/): pictures, text and shapes as layers you move, resize and turn; undo and redo; filament colours;
// box options (picture layer, diffuser, white lining, back cover thickness); holes (round, rectangle, keyhole) dragged on the
// Back view; stand; printer bed check; 3D view; saved designs; every part a sealed solid; keychain, sign and lithophane still
// build; the editor fits a phone.
// Run: npm run test:maker   (uses the pre-installed Playwright Chromium; no network needed)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const PAGE = "file://" + path.resolve(__dirname, "../tools/maker/index.html");
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "maker-shots");
let failed = 0;
async function step(name, fn) { try { await fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL -", name, "\n     ", e.message); } }

// test pictures: navy disc, yellow square, red dot on a see-through background; and a photo-like one on a plain white background
const PICTURE = `<canvas id=c width=600 height=600></canvas><script>{const x=c.getContext("2d");x.fillStyle="#143c8c";x.beginPath();x.arc(300,300,250,0,7);x.fill();x.fillStyle="#f0c828";x.fillRect(200,200,200,200);x.fillStyle="#c81e1e";x.beginPath();x.arc(300,300,40,0,7);x.fill();document.title=c.toDataURL();}</script>`;
const PHOTO = `<canvas id=c width=800 height=500></canvas><script>{const x=c.getContext("2d");x.fillStyle="#ffffff";x.fillRect(0,0,800,500);x.fillStyle="#2e9a4c";x.beginPath();x.ellipse(400,250,260,170,0,0,7);x.fill();document.title=c.toDataURL("image/jpeg",0.95);}</script>`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const tmp = await browser.newPage();
  const save = async (html, name) => { await tmp.setContent(html); const p = path.join(SHOTS, name); fs.writeFileSync(p, Buffer.from((await tmp.title()).split(",")[1], "base64")); return p; };
  const pic = await save(PICTURE, "test-picture.png"), photo = await save(PHOTO, "test-photo.jpg");
  await tmp.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.removeItem("c3d-maker-drafts-v1"));
  await page.setInputFiles("#lbFile", pic);
  await page.waitForFunction(() => MK.L && MK.L.palette);

  // all meshes of the current design, checked in the page with the maker's own builders
  const meshCheck = () => page.evaluate(() => {
    const L = mkLayout(); const out = [];
    for (const p of L.parts) out.push([p.name, mkSealed(mkMesh(p, L))]);
    out.push(["one-colour", mkSealed(mkUnion(L.parts.filter((p) => !p.lid), L))]);
    if (L.parts.some((p) => p.lid)) out.push(["back cover", mkSealed(mkUnion(L.parts.filter((p) => p.lid), L))]);
    if (MK.stand) out.push(["stand", mkSealed(mkStandMesh(L))]);
    return out;
  });
  const bad = async () => (await meshCheck()).filter((x) => !x[1]);
  const settle = (ms = 350) => page.waitForTimeout(ms);
  // centre of a layer on the stage in page px
  const elPt = (id, dx = 0, dy = 0) => page.evaluate(([id, dx, dy]) => { const e = MK.els.find((x) => x.id === id); const g = mkElGeom(e); const cv = document.getElementById("mkStage"); const b = cv.getBoundingClientRect(); const k = b.width / cv.width;
    const c = Math.cos(g.a), s = Math.sin(g.a); const lx = dx === "r" ? g.hw + 4 * (cv.width / b.width) : dx === "t" ? 0 : dx, ly = dx === "r" ? g.hh + 4 * (cv.width / b.width) : dx === "t" ? -g.hh - 24 * (cv.width / b.width) : dy;
    return [b.left + (g.cx + lx * c - ly * s) * k, b.top + (g.cy + lx * s + ly * c) * k]; }, [id, dx, dy]);
  const drag = async (a, b) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 6 }); await page.mouse.up(); await settle(); };

  await step("picture: becomes a layer and sets the design to its shape (120 × 120 mm)", async () => {
    const r = await page.evaluate(() => ({ n: MK.els.length, type: MK.els[0].type, w: MK.width, h: MK.height }));
    assert.deepEqual(r, { n: 1, type: "image", w: 120, h: 120 });
  });

  await step("light box: every part is a sealed solid at every detail level, with and without diffuser and lining", async () => {
    for (const opt of [{ diffuse: true, reflect: false }, { diffuse: false, reflect: true }, { diffuse: true, reflect: true }]) {
      for (const res of [0.6, 0.4, 0.3]) {
        await page.evaluate(([o, r]) => { Object.assign(MK, o); MK.res = r; }, [opt, res]);
        assert.deepEqual(await bad(), [], `detail ${res} ${JSON.stringify(opt)}`);
      }
    }
    await page.evaluate(() => { MK.diffuse = true; MK.reflect = false; MK.res = 0.4; });
  });

  await step("light box: the back cover rim leaves a gap inside the wall (and the lining) at every detail level", async () => {
    for (const reflect of [false, true]) for (const res of [0.6, 0.4, 0.3]) {
      const r = await page.evaluate(([res, reflect]) => {
        MK.res = res; MK.lid = true; MK.reflect = reflect; const L = mkLayout(); const C = L.cols, R = L.rows;
        let touch = 0; for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const i = y * C + x; if (!L.lidRing[i]) continue;
          if (!L.free[i]) touch++; for (const j of [i - 1, i + 1, i - C, i + C]) if (!L.free[j]) touch++; }
        return { touch, fit: L.fit };
      }, [res, reflect]);
      assert.equal(r.touch, 0, `detail ${res}: rim touches the wall`);
      assert.ok(r.fit >= 0.3, `detail ${res}: gap ${r.fit} mm`);
    }
    await page.evaluate(() => { MK.res = 0.4; MK.reflect = false; });
  });

  await step("box options: picture layer, diffuser and back cover thickness change the parts", async () => {
    await page.click('[data-tool="build"]');
    await page.fill("#mkImgT", "0.8"); await page.fill("#mkBackT", "1.2"); await page.fill("#mkLidT", "3");
    await settle();
    const z = await page.evaluate(() => Object.fromEntries(MK.L.parts.map((p) => [p.name.split(" #")[0], [p.z0, p.z1]])));
    assert.deepEqual(z["Colour 1"], [0, 0.8]); assert.deepEqual(z["White diffuser"], [0.8, 2]); assert.deepEqual(z["Frame front"], [0, 2]);
    assert.deepEqual(z["Back cover"], [0, 3]); assert.deepEqual(z["Back cover rim"], [3, 9]);
    await page.click("#mkDiffuse"); await settle();
    assert.ok(await page.evaluate(() => !MK.L.parts.some((p) => p.name === "White diffuser") && MK.L.parts.find((p) => p.name === "Frame front").z1 === 0.8));
    await page.click("#mkReflect"); await settle();
    assert.ok(await page.evaluate(() => MK.L.parts.some((p) => p.name === "White lining")));
    assert.match(await page.textContent("#mkCheck"), /White lining/);
    await page.click("#mkDiffuse"); await page.click("#mkReflect"); await page.fill("#mkImgT", "0.6"); await page.fill("#mkBackT", "1"); await page.fill("#mkLidT", "2"); await settle();
  });

  await step("holes: the 15 mm button cuts a round hole through the back cover", async () => {
    await page.click("#mkHole"); await settle();
    const r = await page.evaluate(() => { const L = mkLayout(); const C = L.cols; const x = L.holes[0]; const at = (cx, cy) => L.lidPlate[Math.round(cy) * C + Math.round(cx)];
      return { n: MK.holes.length, w: MK.holes[0].w, centre: at(x.cx, x.cy), edge: at(x.cx + 7.5 / L.res + 2, x.cy), ring: L.lidRing[Math.round(x.cy) * C + Math.round(x.cx)], view: MK.view.lightbox }; });
    assert.deepEqual(r, { n: 1, w: 15, centre: 0, edge: 1, ring: 0, view: "back" });
    assert.match(await page.textContent("#mkCheck"), /15 mm round hole in the back cover/);
  });

  await step("holes: rectangle and keyhole cut too, everything stays sealed, a hole off the box is flagged", async () => {
    await page.click('[data-addhole="rect"]'); await page.click('[data-addhole="key"]'); await settle();
    const r = await page.evaluate(() => { const L = mkLayout(); const C = L.cols; return L.holes.map((x) => L.lidPlate[Math.round(x.cy) * C + Math.round(x.cx)]); });
    assert.deepEqual(r, [0, 0, 0]);
    assert.deepEqual(await bad(), []);
    await page.evaluate(() => { MK.holes[1].x = 0; lbPreview(0); }); await settle();
    assert.match(await page.textContent("#mkCheck"), /runs past the inside of the box/);
    await page.evaluate(() => { MK.holes[1].x = 0.75; lbPreview(0); }); await settle();
  });

  await step("holes: drag a hole on the Back view", async () => {
    await page.click('[data-view="back"]'); await settle(200);
    const before = await page.evaluate(() => [MK.holes[0].x, MK.holes[0].y]);
    const p = await page.evaluate(() => { const F = MK.vpB, L = MK.L; const b = mkHoleBox(L.holes[0], F, L.cols, L.res); const cv = document.getElementById("mkStage"); const r = cv.getBoundingClientRect(); const k = r.width / cv.width; return [r.left + b[4] * k, r.top + b[5] * k]; });
    await drag(p, [p[0] + 60, p[1] + 40]);
    const after = await page.evaluate(() => [MK.holes[0].x, MK.holes[0].y]);
    assert.ok(after[0] > before[0] + 0.05 && after[1] > before[1] + 0.05, `moved ${before} → ${after}`); // x and y are as seen from behind
    await page.screenshot({ path: path.join(SHOTS, "lightbox-back-1280.png") });
    await page.click("#mkHoles .hole:nth-child(2) [data-del]"); await page.click("#mkHoles .hole:nth-child(2) [data-del]"); await settle();
    assert.equal(await page.evaluate(() => MK.holes.length), 1);
  });

  await step("text: add, type, move, resize and turn it on the design", async () => {
    await page.click('[data-view="lit"]'); await page.click('[data-tool="text"]');
    await page.click('#mkAddText [data-size="0.14"]');
    await page.fill("#mkElText", "CHARLESTON"); await settle();
    const id = await page.evaluate(() => MK.sel);
    const y0 = await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).y);
    const c = await elPt(id); await drag(c, [c[0], c[1] - 60]);
    assert.ok(await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).y) < y0 - 0.05, "moved up");
    const s0 = await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).size);
    const h = await elPt(id, "r"); await drag(h, [h[0] + 50, h[1] + 12]);
    assert.ok(await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).size) > s0 * 1.1, "bigger");
    const t = await elPt(id, "t"); const cc = await elPt(id); await drag(t, [cc[0] + 120, cc[1]]);
    const rot = await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).rot);
    assert.ok(Math.abs(rot - 90) <= 5, `turned to ${rot}`);
    await page.fill("#mkElRot", "0"); await page.dispatchEvent("#mkElRot", "input"); await settle();
    assert.match(await page.textContent("#mkCheck"), /"CHARLESTON" letters about/);
  });

  await step("text: letter spacing and outline", async () => {
    const w0 = await page.evaluate(() => MK.els.find((e) => e.id === MK.sel)._wh[0]);
    await page.fill("#mkElSp", "0.3"); await page.dispatchEvent("#mkElSp", "input"); await settle();
    assert.ok(await page.evaluate(() => MK.els.find((e) => e.id === MK.sel)._wh[0]) > w0 * 1.15, "wider with spacing");
    await page.check("#mkElOut"); await page.click('#mkElOutInk [data-ink="#1b2a4a"]'); await settle();
    assert.ok(await page.evaluate(() => { const e = MK.els.find((x) => x.id === MK.sel); return e.stroke > 0 && e.strokeColor === "#1b2a4a"; }));
    assert.deepEqual(await bad(), []);
  });

  await step("shapes and layers: add a heart, recolour, reorder, duplicate, delete", async () => {
    await page.click('[data-tool="shapes"]'); await page.click('#mkAddShape [data-kind="heart"]'); await settle();
    await page.click('#mkElInk [data-ink="#c8202c"]'); await settle();
    assert.ok(await page.evaluate(() => { const e = MK.els[MK.els.length - 1]; return e.type === "shape" && e.kind === "heart" && e.color === "#c8202c"; }));
    await page.click('[data-tool="layers"]');
    assert.equal(await page.locator("#mkLayers .layer").count(), 3);
    await page.click('#mkLayers .layer:first-child [data-op="down"]'); await settle();
    assert.deepEqual(await page.evaluate(() => MK.els.map((e) => e.type)), ["image", "shape", "text"]);
    await page.click('#mkLayers .layer:first-child [data-op="copy"]'); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 4);
    await page.focus("#mkStage"); await page.keyboard.press("Delete"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3);
  });

  await step("undo and redo", async () => {
    await page.click('#mkLayers .layer:first-child [data-op="del"]'); await settle(600);
    assert.equal(await page.evaluate(() => MK.els.length), 2);
    await page.click("#mkUndo"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3, "undo brings it back");
    await page.keyboard.press("Control+Shift+Z"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 2, "redo removes it again");
    await page.keyboard.press("Control+Z"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3);
  });

  await step("filament: pick a filament for a picture colour; same filament merges", async () => {
    const n0 = await page.evaluate(() => MK.L.palette.length);
    await page.click("#lbPal .ink:first-child > button"); await page.click('#lbPal .ink:first-child [data-ink="#c8202c"]'); await settle();
    const r = await page.evaluate(() => ({ red: MK.L.parts.some((p) => p.name.endsWith("#c8202c")), n: MK.L.palette.length }));
    assert.ok(r.red); assert.ok(r.n <= n0);
    await page.click("#lbPal .ink:last-child > button"); await page.click('#lbPal .ink:last-child [data-ink="#1b2a4a"]'); await settle();
    assert.ok(await page.evaluate(() => MK.L.parts.find((p) => p.name === "Box wall").color.join() === "27,42,74"));
    assert.deepEqual(await bad(), []);
  });

  await step("pictures: a second picture is its own layer; a plain photo background is removed", async () => {
    await page.setInputFiles("#lbFile", photo); await settle(600);
    const r = await page.evaluate(() => { const e = MK.els.filter((x) => x.type === "image"); const p = MK.pics.get(e[1].pic); return { n: e.length, cut: e[1].cut && !!p.cut }; });
    assert.deepEqual(r, { n: 2, cut: true });
    assert.deepEqual(await bad(), []);
  });

  await step("printer: a design too big for the bed is flagged", async () => {
    await page.selectOption("#mkBed", "a1mini"); await page.click('[data-tool="size"]'); await page.fill("#lbW", "200"); await settle();
    assert.match(await page.textContent("#mkCheck"), /too big for the Bambu A1 mini/);
    await page.fill("#lbW", "120"); await page.selectOption("#mkBed", "x1"); await settle();
    assert.match(await page.textContent("#mkCheck"), /Fits the Bambu X1/);
  });

  await step("3D view shows every part, the stand too", async () => {
    await page.click('[data-tool="build"]'); await page.check("#mkStand");
    await page.click('[data-view="3d"]');
    await page.waitForFunction(() => MK.three && MK.three.group.children.length > 0, null, { timeout: 20000 });
    await settle(500);
    const r = await page.evaluate(() => ({ n: MK.three.group.children.length, parts: MK.L.parts.length, shown: !document.getElementById("mk3d").hidden }));
    assert.equal(r.n, r.parts + 1); assert.ok(r.shown);
    await page.screenshot({ path: path.join(SHOTS, "lightbox-3d-1280.png") });
    await page.click('#mkLit3d [data-lit="0"]'); await page.click("#mkLit3d [data-apart]"); await settle(300);
    await page.screenshot({ path: path.join(SHOTS, "lightbox-3d-off-1280.png") });
  });

  await step("download gives the 3MF, back cover, stand and STLs, all sealed", async () => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#lbBuild")]);
    assert.match(d.suggestedFilename(), /print-files\.zip$/);
    const names = await page.evaluate(() => MK.parts.map((p) => p.name));
    for (const s of [".3mf", "-back-cover.3mf", "-one-colour.stl", "-back-cover.stl", "-stand.stl"]) assert.ok(names.some((n) => n.endsWith(s)), `${s} in ${names.join()}`);
    assert.match(await page.textContent("#mkCheck"), /sealed solids \(checked\)/);
    for (const v of ["lit", "off", "back"]) { await page.click(`[data-view="${v}"]`); await settle(200); await page.screenshot({ path: path.join(SHOTS, `lightbox-${v}-1280.png`) }); }
    await d.saveAs(path.join(SHOTS, "lightbox-print-files.zip"));
  });

  await step("saved designs: the design saves itself, a new one starts empty, the saved one opens again", async () => {
    await page.evaluate(() => mkSaveDraftNow());
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem("c3d-maker-drafts-v1")).length);
    assert.ok(n >= 1);
    const els = await page.evaluate(() => MK.els.length);
    await page.click("#mkDrafts"); await page.click(".modal [data-new]"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 0);
    await page.click("#mkDrafts"); await page.screenshot({ path: path.join(SHOTS, "drafts-1280.png") });
    await page.click(".modal .draft:not(.new) [data-open]"); await settle(800);
    assert.equal(await page.evaluate(() => MK.els.length), els);
    assert.deepEqual(await bad(), []);
  });

  await step("light box: text on its own (no picture) builds a rounded box", async () => {
    await page.evaluate(() => { MK.els = MK.els.filter((e) => e.type === "text"); MK.comp = null; mkLayersUI(); lbPreview(0); }); await settle();
    const L = await page.evaluate(() => ({ ok: !!MK.L, colours: MK.L && MK.L.palette.length }));
    assert.ok(L.ok && L.colours >= 1);
    assert.deepEqual(await bad(), []);
    await page.setInputFiles("#lbFile", pic); await settle(500);
  });

  for (const mode of ["keychain", "sign", "litho"]) {
    await step(`${mode}: still builds${mode === "litho" ? "" : " sealed parts"}`, async () => {
      await page.click(`[data-mode="${mode}"]`);
      if (mode === "sign") { await page.click('[data-tool="text"]'); await page.fill("#mkText", "THE LEWIS FAMILY"); }
      await settle(400);
      if (mode !== "litho") assert.deepEqual(await bad(), []);
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#lbBuild")]);
      assert.ok(d.suggestedFilename().endsWith(".zip"));
      await page.screenshot({ path: path.join(SHOTS, `${mode}-1280.png`) });
    });
  }

  await step("lithophane STL is sealed (bottom matches the walls)", async () => {
    const ok = await page.evaluate(() => { const tri = lbGridSolid(12, 9, 0.5, (c, r) => 1 + ((c * 7 + r * 3) % 5) / 4);
      const key = (i) => [tri[i], tri[i + 1], tri[i + 2]].map((v) => v.toFixed(4)).join(","); const cnt = new Map();
      for (let t = 0; t < tri.length; t += 9) for (let k = 0; k < 3; k++) { const a = key(t + k * 3), b = key(t + ((k + 1) % 3) * 3); const e = a < b ? a + "|" + b : b + "|" + a; cnt.set(e, (cnt.get(e) || 0) + 1); }
      return [...cnt.values()].every((v) => v === 2); });
    assert.ok(ok);
  });

  assert.deepEqual(errors, []);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  phone.on("pageerror", (e) => errors.push("390: " + e.message));
  await step("phone: no sideways scroll, bottom bar opens each tool as a sheet, tapping a layer opens its settings", async () => {
    await phone.goto(PAGE);
    await phone.evaluate(() => localStorage.removeItem("c3d-maker-drafts-v1"));
    await phone.setInputFiles("#lbFile", pic);
    await phone.waitForTimeout(600);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.ok(await phone.isHidden("#mkDrawer"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-390.png") });
    await phone.click('[data-tool="text"]'); await phone.click('#mkAddText [data-size="0.14"]'); await phone.waitForTimeout(400);
    assert.ok(await phone.isVisible("#mkElText"), "text settings open as a sheet");
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-text-390.png") });
    await phone.click('#mkProps [data-close]');
    await phone.click('[data-tool="build"]');
    assert.ok(await phone.isVisible("#mkHole"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-box-390.png") });
    await phone.click('[data-tool="print"]');
    assert.ok(await phone.isVisible("#lbBuild"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-print-390.png") });
    await phone.click('#mkProps [data-close]'); await phone.click('[data-view="3d"]');
    await phone.waitForFunction(() => MK.three && MK.three.group.children.length > 0, null, { timeout: 20000 }); await phone.waitForTimeout(400);
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-3d-390.png") });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? `${failed} failed` : "all maker checks passed", "· screenshots in", SHOTS);
  process.exit(failed ? 1 : 0);
})();
