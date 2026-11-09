// Maker (tools/maker/): Design and Preview; Image, Text, Shape and Layer tools; the Overall panel (Color, Background, Hole,
// Dimensions, Structure, Base, Print check); elements you move, resize and turn; undo and redo; printer bed picker; holes
// placed on the design; 3D preview and the plates as they print; the export flow (hole reminder, printer and nozzle) giving a
// two-plate 3MF and STLs; every part a sealed solid; My designs; keychain, sign and lithophane still build; the editor fits a phone.
// Run: npm run test:maker   (uses the pre-installed Playwright Chromium; no network needed)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const zlib = require("node:zlib");

const PAGE = "file://" + path.resolve(__dirname, "../tools/maker/index.html");
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "maker-shots");
let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL -", name, "\n     ", e.message); } }

// test pictures: navy disc, yellow square, red dot on a see-through background; and a photo-like one on a plain white background
const PICTURE = `<canvas id=c width=600 height=600></canvas><script>{const x=c.getContext("2d");x.fillStyle="#143c8c";x.beginPath();x.arc(300,300,250,0,7);x.fill();x.fillStyle="#f0c828";x.fillRect(200,200,200,200);x.fillStyle="#c81e1e";x.beginPath();x.arc(300,300,40,0,7);x.fill();document.title=c.toDataURL();}</script>`;
const PHOTO = `<canvas id=c width=800 height=500></canvas><script>{const x=c.getContext("2d");x.fillStyle="#ffffff";x.fillRect(0,0,800,500);x.fillStyle="#2e9a4c";x.beginPath();x.ellipse(400,250,260,170,0,0,7);x.fill();document.title=c.toDataURL("image/jpeg",0.95);}</script>`;

// read a stored or deflated zip (what the maker and the browser download write)
function unzip(buf) { const out = {}; let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) { const method = buf.readUInt16LE(o + 8), csize = buf.readUInt32LE(o + 18), nlen = buf.readUInt16LE(o + 26), xlen = buf.readUInt16LE(o + 28);
    const name = buf.slice(o + 30, o + 30 + nlen).toString("utf8"), start = o + 30 + nlen + xlen, data = buf.slice(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data; o = start + csize; }
  return out; }

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
  await page.evaluate(() => { localStorage.removeItem("c3d-maker-drafts-v1"); localStorage.removeItem("c3d-maker-hole-tip-off"); });
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
  const open = async (sec) => { await page.evaluate(() => { if (MK.sel) mkSelect(null); }); if (!(await page.evaluate((s) => MK.sec === s, sec))) await page.click(`[data-sec="${sec}"] .ah`); await settle(100); };
  const zOf = () => page.evaluate(() => Object.fromEntries(MK.L.parts.map((p) => [p.name.split(" #")[0], [p.z0, p.z1]])));
  // centre of an element on the canvas in page px
  const elPt = (id, dx = 0, dy = 0) => page.evaluate(([id, dx, dy]) => { const e = MK.els.find((x) => x.id === id); const g = mkElGeom(e); const cv = document.getElementById("mkStage"); const b = cv.getBoundingClientRect(); const k = b.width / cv.width;
    const c = Math.cos(g.a), s = Math.sin(g.a); const lx = dx === "r" ? g.hw + 4 * (cv.width / b.width) : dx === "t" ? 0 : dx, ly = dx === "r" ? g.hh + 4 * (cv.width / b.width) : dx === "t" ? -g.hh - 24 * (cv.width / b.width) : dy;
    return [b.left + (g.cx + lx * c - ly * s) * k, b.top + (g.cy + lx * s + ly * c) * k]; }, [id, dx, dy]);
  const drag = async (a, b) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 6 }); await page.mouse.up(); await settle(); };

  await step("light, neutral look: white top bar, grey canvas, near-black Export, light box name and My designs present", async () => {
    const r = await page.evaluate(() => { const cs = (s, p) => getComputedStyle(document.querySelector(s))[p]; return { top: cs(".ed-top", "backgroundColor"), stage: cs(".ed-stage", "backgroundColor"), exp: cs("#mkExport", "backgroundColor"), drafts: !!document.getElementById("mkDrafts"), name: document.getElementById("lbName").placeholder || document.getElementById("lbName").value }; });
    assert.equal(r.top, "rgb(255, 255, 255)"); assert.equal(r.stage, "rgb(236, 236, 236)"); assert.equal(r.exp, "rgb(26, 26, 26)"); assert.ok(r.drafts);
    assert.match(fs.readFileSync(path.resolve(__dirname, "../tools/maker/index.html"), "utf8"), /mkDrafts/);
  });

  await step("image: becomes an element and sets the design to its shape (120 × 120 mm)", async () => {
    const r = await page.evaluate(() => ({ n: MK.els.length, type: MK.els[0].type, w: MK.width, h: MK.height }));
    assert.deepEqual(r, { n: 1, type: "image", w: 120, h: 120 });
  });

  await step("light box: every part is a sealed solid at every detail level, with and without diffusion and reflection layers", async () => {
    for (const opt of [{ diffuse: true, reflect: false }, { diffuse: false, reflect: true }, { diffuse: true, reflect: true }]) {
      for (const res of [0.6, 0.4, 0.3]) {
        await page.evaluate(([o, r]) => { Object.assign(MK, o); MK.res = r; }, [opt, res]);
        assert.deepEqual(await bad(), [], `detail ${res} ${JSON.stringify(opt)}`);
      }
    }
    await page.evaluate(() => { MK.diffuse = true; MK.reflect = true; MK.res = 0.4; });
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
    await page.evaluate(() => { MK.res = 0.4; MK.reflect = true; lbPreview(0); }); await settle();
  });

  await step("Design | Preview: Preview hides the tool rail and shows only Color, Dimensions, Structure (and Print check)", async () => {
    await page.evaluate(() => mkSelect(null)); assert.equal(await page.evaluate(() => MK.dp), "design");
    assert.ok(await page.isVisible("#mkRail")); assert.ok(await page.isHidden("#mkPvBar")); assert.ok(await page.isVisible("#mkBedChip"));
    await page.click('[data-dp="preview"]'); await settle(200);
    assert.equal(await page.evaluate(() => MK.dp), "preview");
    assert.ok(await page.isHidden("#mkRail")); assert.ok(await page.isVisible("#mkPvBar")); assert.ok(await page.isHidden("#mkBedChip"));
    for (const s of ["color", "dims", "structure"]) assert.ok(await page.isVisible(`[data-sec="${s}"]`), s);
    for (const s of ["background", "hole", "base"]) assert.ok(await page.isHidden(`[data-sec="${s}"]`), s);
    await page.click('[data-dp="design"]'); await settle(200);
    assert.ok(await page.isVisible("#mkRail")); assert.ok(await page.isVisible('[data-sec="background"]'));
  });

  await step("Dimensions: sliders and fields change depth, front, frame and back, and the parts follow", async () => {
    await open("dims");
    await page.fill("#mkImgT", "0.9"); await page.fill("#mkLidT", "2.5"); await settle();
    let z = await zOf();
    assert.deepEqual(z["Colour 1"], [0, 0.9]); assert.deepEqual(z["White diffuser"], [0.9, 1.9]); assert.deepEqual(z["Frame front"], [0, 1.9]);
    assert.deepEqual(z["Back cover"], [0, 2.5]); assert.deepEqual(z["Back cover rim"], [2.5, 8.5]); assert.deepEqual(z["White lining"], [1.9, 40]);
    await page.evaluate(() => { const r = document.getElementById("mkDepthR"); r.value = 60; r.dispatchEvent(new Event("input", { bubbles: true })); }); await settle();
    assert.equal(await page.inputValue("#mkDepth"), "60"); z = await zOf(); assert.deepEqual(z["Box wall"], [0, 60]);
    await page.fill("#mkFrameW", "12"); await settle();
    assert.deepEqual(await page.evaluate(() => [MK.L.wallT, MK.L.border]), [3.6, 8.4]);
    assert.match(await page.textContent("#mkCheck"), /Frame 12 mm wide with a 3\.6 mm wall/);
    await page.fill("#mkImgT", "0.3"); await page.dispatchEvent("#mkImgT", "change"); await settle();
    assert.equal(await page.evaluate(() => MK.imgT), 0.6, "front is clamped to 0.6 mm");
    assert.deepEqual(await bad(), []);
    await page.fill("#mkImgT", "0.8"); await page.fill("#mkDepth", "40"); await page.fill("#mkFrameW", "10"); await page.fill("#mkLidT", "2"); await settle();
  });

  await step("Structure: diffusion and reflection layers switch off and on; Reversed blocks the background", async () => {
    await open("structure");
    await page.click("#mkDiffuse"); await settle();
    assert.ok(await page.evaluate(() => !MK.L.parts.some((p) => p.name === "White diffuser") && MK.L.parts.find((p) => p.name === "Frame front").z1 === 0.8));
    await page.click("#mkReflect"); await settle();
    assert.ok(await page.evaluate(() => !MK.L.parts.some((p) => p.name === "White lining")));
    await page.click("#mkDiffuse"); await page.click("#mkReflect"); await settle();
    assert.match(await page.textContent("#mkCheck"), /Reflection layer/);
    await open("background"); await page.click('#mkBgShape [data-v="rect"]'); await settle();
    await open("structure"); await page.click('#mkStruct [data-v="reversed"]'); await settle();
    const r = await page.evaluate(() => ({ rev: MK.reverse, bg: MK.L.parts.some((p) => p.name.startsWith("Background")) }));
    assert.deepEqual(r, { rev: true, bg: true });
    assert.match(await page.textContent("#mkCheck"), /Reversed: the background prints solid/);
    assert.deepEqual(await bad(), []);
    await page.click('#mkStruct [data-v="default"]'); await settle();
    assert.ok(await page.evaluate(() => !MK.L.parts.some((p) => p.name.startsWith("Background"))));
  });

  await step("Background: Outline adds a white margin round the traced design; None and shapes switch back", async () => {
    await open("background"); await page.click('#mkBgType [data-v="outline"]'); await settle();
    assert.deepEqual(await page.evaluate(() => [MK.bgType, MK.shape, MK.L.parts.some((p) => p.name === "White margin")]), ["outline", "trace", true]);
    assert.ok(await page.isVisible("#mkGap")); assert.deepEqual(await bad(), []);
    await page.click('#mkBgType [data-v="standard"]'); await page.click('#mkBgShape [data-v="circle"]'); await settle();
    assert.deepEqual(await page.evaluate(() => [MK.bgType, MK.shape, MK.L.parts.some((p) => p.name === "White margin")]), ["standard", "circle", false]);
    await page.click('#mkBgShape [data-v="trace"]'); await settle();
  });

  await step("Hole: a 15 mm circle cuts a round hole through the back cover", async () => {
    await open("hole"); await page.click('#mkHoleType [data-v="circle"]');
    assert.equal(await page.inputValue("#mkHoleW"), "15");
    await page.click("#mkHoleAdd"); await settle();
    const r = await page.evaluate(() => { const L = mkLayout(); const C = L.cols; const x = L.holes[0]; const at = (cx, cy) => L.lidPlate[Math.round(cy) * C + Math.round(cx)];
      return { n: MK.holes.length, w: MK.holes[0].w, centre: at(x.cx, x.cy), edge: at(x.cx + 7.5 / L.res + 2, x.cy), ring: L.lidRing[Math.round(x.cy) * C + Math.round(x.cx)], dp: MK.dp }; });
    assert.deepEqual(r, { n: 1, w: 15, centre: 0, edge: 1, ring: 0, dp: "design" });
    assert.match(await page.textContent("#mkCheck"), /15 mm round hole in the back cover/);
  });

  await step("Hole: rectangle (20 × 10 default) and keyhole cut too, everything stays sealed, a hole off the box is flagged", async () => {
    await page.click('#mkHoleType [data-v="rect"]'); assert.deepEqual([await page.inputValue("#mkHoleW"), await page.inputValue("#mkHoleH")], ["20", "10"]);
    await page.click("#mkHoleAdd"); await page.click('#mkHoleType [data-v="key"]'); await page.click("#mkHoleAdd"); await settle();
    const r = await page.evaluate(() => { const L = mkLayout(); const C = L.cols; return L.holes.map((x) => L.lidPlate[Math.round(x.cy) * C + Math.round(x.cx)]); });
    assert.deepEqual(r, [0, 0, 0]);
    assert.match(await page.textContent("#mkCheck"), /20 × 10 mm hole/);
    assert.deepEqual(await bad(), []);
    await page.evaluate(() => { MK.holes[1].x = 0; lbPreview(0); }); await settle();
    assert.match(await page.textContent("#mkCheck"), /runs past the inside of the box/);
    await page.evaluate(() => { MK.holes[1].x = 0.75; lbPreview(0); }); await settle();
  });

  await step("Hole: drag a hole on the design (seen through the front)", async () => {
    await page.evaluate(() => mkSelect(null)); await settle(150);
    const before = await page.evaluate(() => [MK.holes[0].x, MK.holes[0].y]);
    const p = await page.evaluate(() => { const F = MK.vpH, L = MK.L; const b = mkHoleBoxF(L.holes[0], F, L.res); const cv = document.getElementById("mkStage"); const r = cv.getBoundingClientRect(); const k = r.width / cv.width; return [r.left + b[4] * k, r.top + b[5] * k]; });
    await drag(p, [p[0] + 60, p[1] + 40]);
    const after = await page.evaluate(() => [MK.holes[0].x, MK.holes[0].y, MK.selHole === MK.holes[0].id]);
    // x is measured from behind, so moving right on the front makes it smaller
    assert.ok(after[0] < before[0] - 0.05 && after[1] > before[1] + 0.05 && after[2], `moved ${before} → ${after}`);
    await page.screenshot({ path: path.join(SHOTS, "lightbox-holes-1280.png") });
    await page.click("#mkHoles .hole:nth-child(2) [data-del]"); await page.click("#mkHoles .hole:nth-child(2) [data-del]"); await settle();
    assert.equal(await page.evaluate(() => MK.holes.length), 1);
  });

  await step("Text tool: one click adds text in the centre, selects it, and shows Text settings with an Overall link", async () => {
    await page.click('[data-tool="text"]'); await settle();
    const r = await page.evaluate(() => { const e = MK.els.find((x) => x.id === MK.sel); return { type: e && e.type, x: e && e.x, y: e && e.y, title: document.getElementById("mkPropsTitle").textContent }; });
    assert.deepEqual(r, { type: "text", x: 0.5, y: 0.5, title: "Text" });
    assert.ok(await page.isVisible("#mkOverall")); assert.ok(await page.isVisible("#mkElFont")); assert.ok(await page.isVisible("#mkElSize")); assert.ok(await page.isVisible("#mkElWeight"));
    assert.ok(await page.isVisible("#mkElAlign")); assert.ok(await page.isVisible("#mkElSpN")); assert.ok(await page.isVisible("#mkElHex")); assert.ok(await page.isVisible("#mkElOut"));
  });

  await step("text: type, move, resize and turn it on the design", async () => {
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
    await page.fill("#mkElRot", "0"); await settle();
    assert.equal(await page.evaluate(() => MK.els.find((e) => e.id === MK.sel).rot), 0);
    assert.match(await page.textContent("#mkCheck"), /"CHARLESTON" letters about/);
  });

  await step("text: font, weight, size, align, letter spacing %, hex colour and stroke", async () => {
    const w0 = await page.evaluate(() => MK.els.find((e) => e.id === MK.sel)._wh[0]);
    await page.fill("#mkElSpN", "30"); await settle();
    assert.ok(await page.evaluate(() => MK.els.find((e) => e.id === MK.sel)._wh[0]) > w0 * 1.15, "wider with spacing");
    await page.selectOption("#mkElFont", "Montserrat"); await settle();
    assert.deepEqual(await page.$$eval("#mkElWeight option", (o) => o.map((x) => x.textContent)), ["Regular", "Bold", "Extra bold"]);
    await page.selectOption("#mkElWeight", "700"); await page.selectOption("#mkElSize", "24"); await page.click('#mkElAlign [data-v="right"]');
    await page.fill("#mkElHex", "C8202C"); await settle();
    await page.check("#mkElOut"); await page.click('#mkElOutInk [data-ink="#1b2a4a"]'); await settle();
    const e = await page.evaluate(() => MK.els.find((x) => x.id === MK.sel));
    assert.deepEqual([e.font, e.weight, Math.round(e.size * 120), e.align, e.color, e.stroke > 0, e.strokeColor], ["Montserrat", 700, 24, "right", "#c8202c", true, "#1b2a4a"]);
    assert.deepEqual(await bad(), []);
    await page.click("#mkOverall"); await settle(150);
    assert.equal(await page.evaluate(() => [MK.sel, document.getElementById("mkPropsTitle").textContent].join()), ",Overall");
  });

  await step("Shape: the pop-over adds a heart; recolour it", async () => {
    await page.click('[data-tool="shape"]'); assert.ok(await page.isVisible("#mkPop"));
    assert.equal(await page.locator("#mkAddShape [data-kind]").count(), 6);
    await page.click('#mkAddShape [data-kind="heart"]'); await settle();
    await page.click('#mkElInk [data-ink="#c8202c"]'); await settle();
    assert.ok(await page.evaluate(() => { const e = MK.els[MK.els.length - 1]; return e.type === "shape" && e.kind === "heart" && e.color === "#c8202c"; }));
    await page.click('#mkAddShape [data-kind="sparkle"]'); await page.click('#mkAddShape [data-kind="triangle"]'); await settle();
    assert.deepEqual(await bad(), []);
    await page.evaluate(() => { MK.els = MK.els.filter((e) => !(e.type === "shape" && e.kind !== "heart")); MK.sel = null; MK.comp = null; mkLayersUI(); mkElUI(); lbPreview(0); mkCommitNow(); }); await settle();
  });

  await step("Layer: the pop-over lists the layers; ⋮ menu moves, duplicates and deletes; drag a row to reorder", async () => {
    await page.click('[data-tool="layer"]');
    assert.equal(await page.locator("#mkLayers .layer").count(), 3);
    await page.click("#mkLayers .layer:first-child [data-menu]"); await page.click('#mkFloatMenu [data-v="down"]'); await settle();
    assert.deepEqual(await page.evaluate(() => MK.els.map((e) => e.type)), ["image", "shape", "text"]);
    await page.click("#mkLayers .layer:first-child [data-menu]"); await page.click('#mkFloatMenu [data-v="copy"]'); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 4);
    await page.focus("#mkStage"); await page.keyboard.press("Delete"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3);
    await page.locator("#mkLayers .layer:last-child").dragTo(page.locator("#mkLayers .layer:first-child")); await settle();
    assert.deepEqual(await page.evaluate(() => MK.els.map((e) => e.type)), ["shape", "text", "image"], "image dragged to the top");
    await page.locator("#mkLayers .layer:first-child").dragTo(page.locator("#mkLayers .layer:last-child")); await settle();
    assert.deepEqual(await page.evaluate(() => MK.els.map((e) => e.type)), ["image", "shape", "text"]);
  });

  await step("undo and redo", async () => {
    await page.click("#mkLayers .layer:first-child [data-menu]"); await page.click('#mkFloatMenu [data-v="del"]'); await settle(600);
    assert.equal(await page.evaluate(() => MK.els.length), 2);
    await page.click("#mkUndo"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3, "undo brings it back");
    await page.keyboard.press("Control+Shift+Z"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 2, "redo removes it again");
    await page.keyboard.press("Control+Z"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 3);
    await page.click('[data-tool="layer"]');
  });

  await step("Color: pick a filament for a front colour (same filament merges), the side and the back", async () => {
    await open("color");
    const n0 = await page.evaluate(() => MK.L.palette.length);
    await page.click('#lbPal [data-key^="c:"]'); await page.click('#lbPal .inkpick [data-ink="#c8202c"]'); await settle();
    const r = await page.evaluate(() => ({ red: MK.L.parts.some((p) => p.name.endsWith("#c8202c")), n: MK.L.palette.length }));
    assert.ok(r.red); assert.ok(r.n <= n0);
    await page.click('#lbPal [data-key="frame"]'); await page.click('#lbPal .inkpick [data-ink="#1b2a4a"]'); await settle();
    assert.ok(await page.evaluate(() => MK.L.parts.find((p) => p.name === "Box wall").color.join() === "27,42,74"));
    await page.click('#lbPal [data-key="back"]'); await page.click('#lbPal .inkpick [data-ink="#f4f3ef"]'); await settle();
    assert.ok(await page.evaluate(() => MK.L.parts.find((p) => p.name === "Back cover").color.join() === "244,243,239"));
    assert.deepEqual(await bad(), []);
  });

  await step("images: a second image is its own element; a plain photo background is removed", async () => {
    await page.setInputFiles("#lbFile", photo); await settle(600);
    const r = await page.evaluate(() => { const e = MK.els.filter((x) => x.type === "image"); const p = MK.pics.get(e[1].pic); return { n: e.length, cut: e[1].cut && !!p.cut }; });
    assert.deepEqual(r, { n: 2, cut: true });
    assert.deepEqual(await bad(), []);
  });

  await step("bed picker: the chip on the bed swaps printers, redraws the bed and flags a design too big for it", async () => {
    await page.evaluate(() => mkSelect(null));
    assert.match(await page.textContent("#mkBedChip"), /X1\/P1\/A1 \(256 × 256 mm\)/);
    await page.click("#mkBedBtn"); assert.equal(await page.locator("#mkBedMenu [data-bed]").count(), 5);
    await page.click('#mkBedMenu [data-bed="h2s"]'); await settle();
    const r = await page.evaluate(() => ({ bed: MK.bed, ratio: Math.round(MK.bedR[2] / MK.bedR[3] * 100) }));
    assert.deepEqual(r, { bed: "h2s", ratio: 106 }); assert.match(await page.textContent("#mkBedChip"), /H2S \(340 × 320 mm\)/);
    await page.click("#mkBedBtn"); await page.click('#mkBedMenu [data-bed="a1mini"]'); await open("dims"); await page.fill("#lbW", "200"); await settle();
    assert.match(await page.textContent("#mkCheck"), /too big for the A1 mini bed/);
    await page.fill("#lbW", "120"); await page.click("#mkBedBtn"); await page.click('#mkBedMenu [data-bed="x1"]'); await settle();
    assert.match(await page.textContent("#mkCheck"), /Fits the X1C bed \(256 × 256 mm\)/);
  });

  await step("canvas toolbar: zoom, hand and the light box frame toggle", async () => {
    const w0 = await page.evaluate(() => MK.bedR[2]);
    await page.click("#mkZin"); await settle(100); assert.ok(await page.evaluate((w) => MK.bedR[2] > w * 1.2, w0));
    await page.click("#mkZout"); await settle(100); assert.ok(await page.evaluate((w) => Math.abs(MK.bedR[2] - w) < 1, w0));
    await page.click("#mkToolHand"); const s = await page.evaluate(() => { const cv = document.getElementById("mkStage").getBoundingClientRect(); return [cv.left + 60, cv.top + 60]; });
    await drag(s, [s[0] + 40, s[1] + 30]); assert.deepEqual(await page.evaluate(() => MK.pan), [40, 30]); await page.click("#mkToolSel");
    await page.evaluate(() => { MK.pan = [0, 0]; mkDraw(); });
    await page.check("#mkFrame"); await settle(200); await page.screenshot({ path: path.join(SHOTS, "lightbox-frame-1280.png") }); await page.uncheck("#mkFrame");
  });

  await step("Preview: 3D box with every part, the base and a floor shadow; light off; Plates shows each plate on the bed", async () => {
    await open("base"); await page.click('#mkBase [data-v="with"]'); await settle();
    await page.click('[data-dp="preview"]');
    await page.waitForFunction(() => MK.three && MK.three.group.children.length > 0, null, { timeout: 20000 });
    await settle(500);
    const r = await page.evaluate(() => ({ n: MK.three.group.children.length, parts: MK.L.parts.length, shown: !document.getElementById("mk3d").hidden }));
    assert.equal(r.n, r.parts + 2); assert.ok(r.shown);
    await page.screenshot({ path: path.join(SHOTS, "lightbox-preview-1280.png") });
    await page.click("#mkLight"); await settle(300); assert.equal(await page.evaluate(() => MK.lit3d), false);
    await page.screenshot({ path: path.join(SHOTS, "lightbox-preview-off-1280.png") }); await page.click("#mkLight");
    await page.click('[data-pv="plates"]'); await settle(400);
    assert.deepEqual(await page.$$eval("#mkPlates [data-plate]", (b) => b.map((x) => x.textContent)), ["Plate 1 – Front and side", "Plate 2 – Back and base"]);
    const front = await page.evaluate(() => [MK.three.group.children.length, MK.L.parts.filter((p) => !p.lid).length]);
    assert.equal(front[0], front[1] + 1, "plate 1: front parts + the bed");
    await page.click('[data-plate="2"]'); await settle(400);
    assert.equal(await page.evaluate(() => MK.three.group.children.length), 4, "plate 2: back cover, rim, base and the bed");
    await page.screenshot({ path: path.join(SHOTS, "lightbox-plate2-1280.png") });
    await page.click('[data-pv="render"]'); await page.click('[data-dp="design"]'); await settle(200);
  });

  await step("Export: the hole reminder comes first (Add a hole now opens Hole; Don't show again sticks), then printer and nozzle", async () => {
    await page.evaluate(() => { MK.holes = []; mkHolesUI(); lbPreview(0); }); await settle();
    await page.click("#mkExport"); assert.ok(await page.isVisible("#mkHoleDlg")); assert.ok(await page.isHidden("#mkPrinterDlg"));
    await page.click("#mkHoleNow"); await settle(150);
    assert.ok(await page.isHidden("#mkHoleDlg")); assert.equal(await page.evaluate(() => [MK.dp, MK.sec].join()), "design,hole"); assert.ok(await page.isVisible("#mkHoleAdd"));
    await page.click('[data-dp="preview"]'); await page.click("#mkExport"); assert.ok(await page.isVisible("#mkHoleDlg"));
    await page.screenshot({ path: path.join(SHOTS, "export-holes-1280.png") });
    await page.check("#mkNoTip"); await page.click("#mkHoleGo"); await settle(150);
    assert.ok(await page.isHidden("#mkHoleDlg")); assert.ok(await page.isVisible("#mkPrinterDlg"));
    assert.deepEqual(await page.$$eval("#mkPrinter option", (o) => o.map((x) => x.textContent)), ["A1", "A1 mini", "P1S", "P1P", "P2S", "X1C", "X1", "X1E", "X2D", "H2D", "H2D Pro", "H2C", "H2S", "A2L"]);
    assert.deepEqual(await page.$$eval("#mkNozzle option", (o) => o.map((x) => x.value)), ["0.2", "0.4", "0.6", "0.8"]);
    assert.equal(await page.inputValue("#mkNozzle"), "0.4");
    await page.screenshot({ path: path.join(SHOTS, "export-printer-1280.png") });
    await page.click("#mkPrinterDlg [data-x]"); assert.ok(await page.isHidden("#mkPrinterDlg"));
    await page.click("#mkExport"); assert.ok(await page.isHidden("#mkHoleDlg"), "don't show again"); assert.ok(await page.isVisible("#mkPrinterDlg"));
    await page.click("#mkPrinterDlg [data-x]");
    await page.evaluate(() => localStorage.removeItem("c3d-maker-hole-tip-off"));
  });

  await step("Export: printer and nozzle feed the bed and the finest detail; the 3MF has 2 plates of sealed parts, plus STLs", async () => {
    await page.click('[data-dp="design"]'); await open("hole"); await page.click('#mkHoleType [data-v="circle"]'); await page.click("#mkHoleAdd"); await settle();
    await page.click("#mkExport"); assert.ok(await page.isVisible("#mkPrinterDlg"), "with a hole there's no reminder");
    await page.selectOption("#mkPrinter", "H2D"); await page.selectOption("#mkNozzle", "0.6");
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#mkPrGo")]);
    assert.match(d.suggestedFilename(), /print-files\.zip$/);
    await page.waitForFunction(() => !MK.busy);
    assert.deepEqual(await page.evaluate(() => [MK.bed, MK.printer, MK.nozzle, MK.L.minFeat]), ["h2d", "H2D", 0.6, 0.9]);
    const names = await page.evaluate(() => MK.parts.map((p) => p.name));
    for (const s of [".3mf", "-one-colour.stl", "-back-cover.stl", "-base.stl"]) assert.ok(names.some((n) => n.endsWith(s)), `${s} in ${names.join()}`);
    assert.match(await page.textContent("#mkCheck"), /sealed solids \(checked\)/);
    assert.match(await page.textContent("#mkCheck"), /Fits the H2D bed \(300 × 320 mm\)/);
    const zp = path.join(SHOTS, "lightbox-print-files.zip"); await d.saveAs(zp);
    const z = unzip(fs.readFileSync(zp)); const tm = Object.keys(z).find((n) => n.endsWith(".3mf")); assert.ok(tm, Object.keys(z).join());
    assert.match(z["HOW TO PRINT.txt"].toString(), /H2D with a 0\.6 mm nozzle/);
    const m = unzip(z[tm]);
    for (const f of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "Metadata/model_settings.config"]) assert.ok(m[f], f);
    const model = m["3D/3dmodel.model"].toString(), conf = m["Metadata/model_settings.config"].toString();
    const chk = await page.evaluate(([model, conf]) => { const P = new DOMParser(); const x = P.parseFromString(model, "application/xml"), c = P.parseFromString(conf, "application/xml");
      if (x.querySelector("parsererror") || c.querySelector("parsererror")) return { ok: false };
      const items = [...x.getElementsByTagName("item")].map((i) => [i.getAttribute("objectid"), +i.getAttribute("transform").split(" ")[9], +i.getAttribute("transform").split(" ")[10]]);
      const byId = Object.fromEntries([...x.getElementsByTagName("object")].map((o) => [o.getAttribute("id"), o])); const assemblies = items.map((i) => byId[i[0]]);
      const meshes = [...x.getElementsByTagName("object")].filter((o) => o.getElementsByTagName("mesh").length);
      return { ok: true, items: items.length, plateX: items.map((i) => Math.round(i[1])), plateY: items.map((i) => Math.round(i[2])), assemblies: assemblies.map((o) => o.getAttribute("name")), meshesOk: meshes.every((o) => o.getElementsByTagName("triangle").length > 0), plates: c.getElementsByTagName("plate").length }; }, [model, conf]);
    assert.ok(chk.ok, "3MF xml parses"); assert.equal(chk.items, 3); assert.equal(chk.plates, 2); assert.ok(chk.meshesOk);
    assert.deepEqual(chk.assemblies, ["Front and side", "Back cover", "Base"]);
    // plate 2 starts a bed and a fifth to the right (H2D: 300 × 320 mm); the base sits in front of the back cover on it
    assert.ok(chk.plateX[1] > 360 && chk.plateX[2] > 360 && chk.plateY[2] < chk.plateY[1], `plates: ${chk.plateX} / ${chk.plateY}`);
  });

  await step("My designs: the design saves itself; cards with name, Last updated and ⋮ (rename, duplicate, delete); New project; open again", async () => {
    await page.evaluate(() => mkSaveDraftNow());
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("c3d-maker-drafts-v1")).length) >= 1);
    const els = await page.evaluate(() => MK.els.length);
    await page.click("#mkDrafts");
    assert.match(await page.textContent("#mkDraftsDlg h2"), /My designs \(1 \/ 30\)/);
    assert.match(await page.textContent("#mkDraftsDlg .draft:not(.new) .meta"), /Last updated \d{4}-\d\d-\d\d \d\d:\d\d/);
    await page.click("#mkDraftsDlg .draft:not(.new) [data-menu]"); await page.click('#mkFloatMenu [data-v="dup"]'); await settle(200);
    assert.equal(await page.locator("#mkDraftsDlg .draft:not(.new)").count(), 2);
    await page.click("#mkDraftsDlg .draft:not(.new) [data-menu]"); await page.click('#mkFloatMenu [data-v="rename"]');
    await page.fill("#mkDraftsDlg .rn", "Coffee bar sign"); await page.keyboard.press("Enter");
    assert.ok(await page.evaluate(() => mkDraftsLoad().some((d) => d.name === "Coffee bar sign")));
    await page.click("#mkDraftsDlg .draft:not(.new) [data-menu]"); await page.click('#mkFloatMenu [data-v="del"]'); await settle(150);
    assert.equal(await page.locator("#mkDraftsDlg .draft:not(.new)").count(), 1); assert.match(await page.textContent("#mkDraftsDlg h2"), /\(1 \/ 30\)/);
    await page.screenshot({ path: path.join(SHOTS, "my-designs-1280.png") });
    await page.click("#mkDraftsDlg [data-new]"); await settle();
    assert.equal(await page.evaluate(() => MK.els.length), 0);
    await page.click("#mkBack"); await page.click("#mkDraftsDlg .draft:not(.new) [data-open]"); await settle(800);
    assert.equal(await page.evaluate(() => MK.els.length), els);
    assert.deepEqual(await bad(), []);
  });

  await step("light box: text on its own (no image) builds a rounded box", async () => {
    await page.evaluate(() => { MK.els = MK.els.filter((e) => e.type === "text"); MK.comp = null; mkLayersUI(); lbPreview(0); }); await settle();
    const L = await page.evaluate(() => ({ ok: !!MK.L, colours: MK.L && MK.L.palette.length }));
    assert.ok(L.ok && L.colours >= 1);
    assert.deepEqual(await bad(), []);
    await page.setInputFiles("#lbFile", pic); await settle(500);
  });

  for (const mode of ["keychain", "sign", "litho"]) {
    await step(`${mode}: still builds${mode === "litho" ? "" : " sealed parts"} through Export`, async () => {
      await page.click('[data-dp="design"]'); await page.click("#mkModeBtn"); await page.click(`#mkModes [data-mode="${mode}"]`);
      if (mode === "sign") { await page.click('[data-tool="text"]'); await page.fill("#mkText", "THE LEWIS FAMILY"); }
      await settle(400);
      if (mode !== "litho") assert.deepEqual(await bad(), []);
      await page.click("#mkExport"); assert.ok(await page.isVisible("#mkPrinterDlg"), "no hole reminder outside the light box");
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#mkPrGo")]);
      assert.ok(d.suggestedFilename().endsWith(".zip"));
      await page.waitForFunction(() => !MK.busy);
      await page.screenshot({ path: path.join(SHOTS, `${mode}-1280.png`) });
      await page.click('[data-dp="preview"]'); await settle(500); await page.screenshot({ path: path.join(SHOTS, `${mode}-preview-1280.png`) }); await page.click('[data-dp="design"]');
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
  await step("phone: no sideways scroll; the tools sit in a bottom bar; Text opens its settings as a sheet; Settings and pop-overs are sheets", async () => {
    await phone.goto(PAGE);
    await phone.evaluate(() => localStorage.removeItem("c3d-maker-drafts-v1"));
    await phone.setInputFiles("#lbFile", pic);
    await phone.waitForTimeout(600);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    const bar = await phone.evaluate(() => { const r = document.getElementById("mkRail").getBoundingClientRect(); return [Math.round(r.bottom), Math.round(r.width)]; });
    assert.deepEqual(bar, [844, 390]);
    assert.ok(await phone.isHidden("#mkProps")); assert.ok(await phone.isHidden("#mkDrafts"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-390.png") });
    await phone.click('[data-tool="text"]'); await phone.waitForTimeout(400);
    assert.ok(await phone.isVisible("#mkElText"), "text settings open as a sheet"); assert.ok(await phone.isVisible("#mkOverall"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-text-390.png") });
    await phone.click('#mkProps [data-close]'); assert.ok(await phone.isHidden("#mkProps"));
    await phone.click('[data-tool="settings"]'); await phone.waitForTimeout(200); await phone.evaluate(() => mkSelect(null));
    assert.ok(await phone.isVisible('[data-sec="dims"]'));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-settings-390.png") });
    await phone.click('[data-tool="image"]'); assert.ok(await phone.isVisible("#lbDrop")); assert.ok(await phone.isHidden("#mkProps"));
    await phone.click('#mkPop [data-close]');
    await phone.click('[data-dp="preview"]');
    await phone.waitForFunction(() => MK.three && MK.three.group.children.length > 0, null, { timeout: 20000 }); await phone.waitForTimeout(400);
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-preview-390.png") });
    await phone.click("#mkExport"); await phone.waitForTimeout(200);
    const dlg = await phone.evaluate(() => { const r = document.querySelector("#mkHoleDlg .dlg").getBoundingClientRect(); return [r.left >= 0, r.right <= 390]; });
    assert.deepEqual(dlg, [true, true], "the dialog fits the phone");
    await phone.screenshot({ path: path.join(SHOTS, "export-holes-390.png") });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? `${failed} failed, ${passed} passed` : `all ${passed} maker checks passed`, "· screenshots in", SHOTS);
  process.exit(failed ? 1 : 0);
})();
