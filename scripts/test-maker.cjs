// Maker (tools/maker/): every mode builds, every part is a sealed solid, the light box back cover fits at every
// detail level, the 15 mm hole goes through the back cover, text works in a light box, and the editor fits a phone.
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

// a test picture: navy disc, yellow square, red dot, see-through background
const PICTURE = `<canvas id=c width=600 height=600></canvas><script>const x=c.getContext("2d");x.fillStyle="#143c8c";x.beginPath();x.arc(300,300,250,0,7);x.fill();x.fillStyle="#f0c828";x.fillRect(200,200,200,200);x.fillStyle="#c81e1e";x.beginPath();x.arc(300,300,40,0,7);x.fill();document.title=c.toDataURL();</script>`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const tmp = await browser.newPage();
  await tmp.setContent(PICTURE);
  const png = Buffer.from((await tmp.title()).split(",")[1], "base64");
  const pic = path.join(SHOTS, "test-picture.png");
  fs.writeFileSync(pic, png);
  await tmp.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.setInputFiles("#lbFile", pic);
  await page.waitForFunction(() => MK.L && MK.L.palette);

  // all meshes of the current design, checked in the page with the maker's own builders
  const meshCheck = () => page.evaluate(() => {
    const L = mkLayout(); const out = [];
    for (const p of L.parts) out.push([p.name, mkSealed(mkMesh(p, L))]);
    out.push(["one-colour", mkSealed(mkUnion(L.parts.filter((p) => !p.lid), L))]);
    if (L.parts.some((p) => p.lid)) out.push(["back cover", mkSealed(mkUnion(L.parts.filter((p) => p.lid), L))]);
    return out;
  });

  await step("light box: every part is a sealed solid at every detail level", async () => {
    for (const res of [0.6, 0.4, 0.3]) {
      const bad = (await page.evaluate((r) => { MK.res = r; return 0; }, res), await meshCheck()).filter((x) => !x[1]);
      assert.deepEqual(bad, [], `detail ${res}`);
    }
  });

  await step("light box: the back cover rim leaves a gap inside the wall at every detail level", async () => {
    for (const res of [0.6, 0.4, 0.3]) {
      const r = await page.evaluate((res) => {
        MK.res = res; MK.lid = true; const L = mkLayout(); const C = L.cols, R = L.rows;
        // no rim cell may touch the wall or sit outside the inside of the box
        let touch = 0; for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const i = y * C + x; if (!L.lidRing[i]) continue;
          if (!L.inner[i]) touch++; for (const j of [i - 1, i + 1, i - C, i + C]) if (!L.inner[j]) touch++; }
        return { touch, fit: L.fit };
      }, res);
      assert.equal(r.touch, 0, `detail ${res}: rim touches the wall`);
      assert.ok(r.fit >= 0.3, `detail ${res}: gap ${r.fit} mm`);
    }
  });

  await step("light box: the 15 mm hole button cuts a hole through the back cover", async () => {
    await page.evaluate(() => { MK.res = 0.4; });
    await page.click('[data-tool="build"]');
    assert.equal(await page.getAttribute("#mkHole", "aria-pressed"), "false");
    await page.click("#mkHole");
    assert.equal(await page.getAttribute("#mkHole", "aria-pressed"), "true");
    const r = await page.evaluate(() => { const L = mkLayout(); const C = L.cols; const { cx, cy, r } = L.hole;
      const at = (x, y) => L.lidPlate[Math.round(y) * C + Math.round(x)];
      return { r: r * L.res, centre: at(cx, cy), edge: at(cx + r + 2, cy) }; });
    assert.equal(r.r, 7.5);
    assert.equal(r.centre, 0, "hole in the middle");
    assert.equal(r.edge, 1, "cover just outside the hole");
    await page.waitForTimeout(400);
    assert.match(await page.textContent("#mkCheck"), /15 mm hole/);
  });

  await step("light box: text can be added, moved by dragging, and builds sealed", async () => {
    await page.click('[data-tool="text"]');
    await page.click("#mkAddText");
    await page.fill("#mkTxtIn", "CHARLESTON");
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => MK.texts[0].y);
    const box = await page.evaluate(() => { const r = mkTextRect(MK.texts[0]); const cv = document.getElementById("mkStage"); const k = cv.getBoundingClientRect().width / cv.width; const b = cv.getBoundingClientRect(); return [b.left + (r[0] + r[2]) / 2 * k, b.top + (r[1] + r[3]) / 2 * k]; });
    await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move(box[0], box[1] - 60, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => MK.texts[0].y) < before - 0.05, "text moved up");
    assert.deepEqual((await meshCheck()).filter((x) => !x[1]), []);
    assert.match(await page.textContent("#mkCheck"), /CHARLESTON" letters about/);
    for (const v of ["lit", "off", "box", "back"]) { await page.click(`[data-view="${v}"]`); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, `lightbox-${v}-1280.png`) }); }
  });

  await step("light box: text on its own (no picture) builds a rounded box", async () => {
    await page.click('[data-tool="picture"]');
    await page.click(".lbrm");
    await page.waitForTimeout(300);
    const L = await page.evaluate(() => ({ ok: !!MK.L, colours: MK.L && MK.L.palette.length }));
    assert.ok(L.ok && L.colours >= 1);
    assert.deepEqual((await meshCheck()).filter((x) => !x[1]), []);
    await page.setInputFiles("#lbFile", pic);
    await page.waitForTimeout(400);
  });

  await step("download gives the 3MF, back cover and STLs, all sealed", async () => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#lbBuild")]);
    assert.match(d.suggestedFilename(), /print-files\.zip$/);
    const names = await page.evaluate(() => MK.parts.map((p) => p.name));
    assert.ok(names.some((n) => n.endsWith("-back-cover.3mf")) && names.some((n) => n.endsWith("-one-colour.stl")), names.join());
    assert.match(await page.textContent("#mkCheck"), /sealed solids \(checked\)/);
  });

  for (const mode of ["keychain", "sign", "litho"]) {
    await step(`${mode}: still builds${mode === "litho" ? "" : " sealed parts"}`, async () => {
      await page.click(`[data-mode="${mode}"]`);
      if (mode === "sign") { await page.click('[data-tool="text"]'); await page.fill("#mkText", "THE LEWIS FAMILY"); }
      await page.waitForTimeout(400);
      if (mode !== "litho") assert.deepEqual((await meshCheck()).filter((x) => !x[1]), []);
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
  await step("phone: no sideways scroll, bottom bar opens each tool as a sheet", async () => {
    await phone.goto(PAGE);
    await phone.setInputFiles("#lbFile", pic);
    await phone.waitForTimeout(500);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.ok(await phone.isHidden("#mkDrawer"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-390.png") });
    await phone.click('[data-tool="build"]');
    assert.ok(await phone.isVisible("#mkHole"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-box-390.png") });
    await phone.click('[data-tool="print"]');
    assert.ok(await phone.isVisible("#lbBuild"));
    await phone.screenshot({ path: path.join(SHOTS, "lightbox-print-390.png") });
  });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(failed ? `${failed} failed` : "all maker checks passed", "· screenshots in", SHOTS);
  process.exit(failed ? 1 : 0);
})();
