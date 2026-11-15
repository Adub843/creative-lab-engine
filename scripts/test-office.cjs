// Office suite (tools/office/): Documents, Spreadsheets and the Photo editor, run in Chromium against the test
// harness (tools/office/test/harness.html stands in for the Lab's Lab files store). Each tool must start, open a
// file, save it, reopen it from Lab files, download it, and open an agent's draft (a row with no file).
// Run: npm run test:office (serves the repo on a free port by itself).
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "office-"));

(async () => {
  await new Promise((ok) => server.listen(0, ok)); const base = `http://localhost:${server.address().port}/tools/office/test/harness.html`;
  const b = await chromium.launch(); const errors = [];
  const open = async (tool, ready) => { const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.on("pageerror", (e) => errors.push(tool + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error") console.log("  console:", tool, m.text().slice(0, 200)); });
    await p.goto(base + "?tool=" + tool); await p.waitForTimeout(500); const fr = p.frame({ url: new RegExp(tool + "\\.html") }); await fr.waitForFunction(ready, null, { timeout: 40000 }); return { p, fr }; };
  const files = async (fr) => { await fr.click("#obFiles"); await fr.waitForTimeout(300); };

  { // Documents
    const { p, fr } = await open("docs", () => typeof SD !== "undefined" && SD && SD.activeEditor);
    const text = () => fr.evaluate(() => { const ed = SD.activeEditor; return ed.state.doc.textBetween(0, ed.state.doc.content.size, " | "); });
    await fr.click("#obAi"); await fr.fill("#obAiText", "intro"); await fr.click("#obAiGo"); await p.waitForTimeout(1200);
    assert.match(await text(), /Test heading/, "Write with AI puts text in the document");
    await fr.fill("#obName", "Doc one"); await fr.click("#obSave"); await p.waitForTimeout(2000);
    assert.match(await fr.textContent("#obStatus"), /Saved to Lab files/);
    await fr.click("#obNew"); await p.waitForTimeout(1200); assert.equal(await text(), "");
    await files(fr); await fr.click("[data-open]"); await p.waitForTimeout(2500); assert.match(await text(), /Test heading \| A paragraph of test text/, "saved .docx reopens");
    await fr.click("#obDown"); await p.waitForTimeout(800); const n = await p.evaluate(() => LAST_DOWNLOAD.size); assert.ok(n > 5000, "downloads a .docx");
    const id = await p.evaluate(() => LAB_OFFICE.addRow({ kind: "doc", title: "Agent draft", html: "<h1>Hi Aaron</h1><p>Agent text.</p>", byName: "Stacy" }));
    await files(fr); await fr.click(`[data-open="${id}"]`); await p.waitForTimeout(2500); assert.match(await text(), /Hi Aaron \| Agent text/, "agent html draft opens");
    assert.match(await fr.textContent("#obStatus"), /Draft from Stacy/); await p.close(); console.log("ok  Documents");
  }
  { // Spreadsheets
    const { execFileSync } = require("child_process");
    const xlsx = path.join(tmp, "t.xlsx");
    execFileSync("python3", ["-c", `import openpyxl\nwb=openpyxl.Workbook();ws=wb.active;ws.title='Prices';ws.append(['Item','Qty','Price']);ws.append(['Tee',2,18.99]);ws['D2']='=B2*C2';ws.merge_cells('A4:C4');ws['A4']='note';wb.save(${JSON.stringify(xlsx)})`]);
    const { p, fr } = await open("sheets", () => typeof WB !== "undefined" && WB);
    await fr.evaluate(() => { window.__CMDLOG = []; });
    await fr.setInputFiles("#obFile", xlsx); await p.waitForTimeout(2500);
    assert.deepEqual(JSON.parse(await fr.evaluate(() => JSON.stringify(WB.getActiveSheet().getRange(0, 0, 2, 4).getValues()))), [["Item", "Qty", "Price", null], ["Tee", 2, 18.99, 37.98]], "xlsx opens with formulas worked out");
    await fr.click("#obSave"); await p.waitForTimeout(2000); await fr.click("#obNew"); await p.waitForTimeout(1000);
    await files(fr); await fr.click("[data-open]"); await p.waitForTimeout(2500);
    assert.equal(await fr.evaluate(() => WB.save().sheets[WB.save().sheetOrder[0]].cellData[1][3].f), "=B2*C2", "formulas survive save and reopen");
    await fr.click("#obDown"); await p.waitForTimeout(800);
    const bytes = await p.evaluate(async () => Array.from(new Uint8Array(await LAST_DOWNLOAD.arrayBuffer()))); const out = path.join(tmp, "out.xlsx"); fs.writeFileSync(out, Buffer.from(bytes));
    const back = execFileSync("python3", ["-c", `import openpyxl\nws=openpyxl.load_workbook(${JSON.stringify(out)}).active\nprint(ws['D2'].value, ws.merged_cells.ranges)`]).toString().trim();
    assert.match(back, /=B2\*C2 \{<MergedCellRange A4:C4>\}/, "downloaded .xlsx keeps formulas and merges: " + back);
    await p.waitForTimeout(1000);
    const id = await p.evaluate(() => LAB_OFFICE.addRow({ kind: "sheet", title: "Agent sheet", rows: [["A", "B"], [1, "=A2*2"]], byName: "Alice" }));
    await files(fr); await fr.click(`[data-open="${id}"]`); await p.waitForTimeout(2500);
    assert.equal(await fr.evaluate(() => JSON.stringify(WB.getActiveSheet().getRange(0, 0, 2, 2).getValues())), '[["A","B"],[1,2]]', "agent rows open with formulas: " + (await fr.evaluate(() => [...new Set(window.__CMDLOG)].join(","))) + " | " + await fr.textContent("#obStatus") + " / " + await fr.evaluate(() => document.querySelector(".ob-toast") && document.querySelector(".ob-toast").textContent));
    await p.close(); console.log("ok  Spreadsheets");
  }
  { // Photo editor
    const { execFileSync } = require("child_process"); const pic = path.join(tmp, "pic.png");
    execFileSync("python3", ["-c", `from PIL import Image\nImage.new('RGB',(640,480),(40,90,140)).save(${JSON.stringify(pic)})`]);
    const { p, fr } = await open("photo", () => typeof MP !== "undefined" && MP && BLANK);
    await fr.setInputFiles("#obFile", pic); await p.waitForTimeout(2500);
    assert.deepEqual(await fr.evaluate(() => MP.Layers.get_dimensions()), { width: 640, height: 480 }, "picture opens at its size");
    await fr.click("#obSave"); await p.waitForTimeout(2500); await fr.click("#obNew"); await p.waitForTimeout(800);
    await files(fr); await fr.click("[data-open]"); await p.waitForTimeout(2500);
    assert.deepEqual(await fr.evaluate(() => MP.Layers.get_dimensions()), { width: 640, height: 480 }, "layered copy reopens");
    await fr.click("#obDown"); await p.waitForTimeout(800); assert.ok(await p.evaluate(() => LAST_DOWNLOAD.type === "image/png" && LAST_DOWNLOAD.size > 500), "downloads a PNG");
    await p.close(); console.log("ok  Photo editor");
  }
  await b.close(); server.close();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log("Office suite: all checks passed");
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
