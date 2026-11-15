# Office suite (Lab ▸ Office ▸ Office suite)

Three open-source editors that run inside the Lab (Creative Lab Studios console), with no server:

| Lab page | Program | License | What it does |
|---|---|---|---|
| Documents (`docs.html`) | [SuperDoc](https://github.com/superdoc-dev/superdoc) 1.46.3 | AGPL-3.0 | Real Word `.docx`: pages, tables, headers/footers, lists, styles, comments, track changes |
| Spreadsheets (`sheets.html`) | [Univer](https://github.com/dream-num/univer) 1.5.0 + [SheetJS](https://sheetjs.com) 0.18.5 | Apache-2.0 | Excel-style workbooks, 400+ formulas, formatting, merges, many sheets; opens `.xlsx/.xls/.csv`, downloads `.xlsx` |
| Photo editor (`photo.html`, also on Make) | [miniPaint](https://github.com/viliusle/miniPaint) 4.14.3 | MIT | Photoshop-style layers, selections, brush, clone, magic eraser, text, crop, resize, adjustments, 40+ effects |

Kittl stays the main tool for designs and mockups. These cover everyday office work and quick picture fixes.

## How it fits in the Lab

- `office.js` + `office.css`: the shared top bar (name, Lab files, New, Open, Write/Fill with AI, Download, Save, Ctrl+S).
- `lab-office.js` is published in the Lab as `js/office.js`. It adds the pages and `window.LAB_OFFICE`, which the editors call (same site) to list, load, save and delete Lab files, download, and ask Claude (`sample`).
- The editor pages are published under `engine/tools/office/` in the Lab artifact. Vendor builds are in `vendor/` and `minipaint/`.
- An open editor is never rebuilt by the Lab's live updates, and the last saved file reopens when you come back to the page.

## Lab files (for Stacy, Alice and Claude)

Each file is a row in the Lab database collection `office`:

```
{ kind: "doc" | "sheet" | "image", title, by, byName, at, updatedAt, size, fileName,
  fileId,    // asset id; .docx/.xlsx are stored as JSON {name, type, b64} (the asset store takes no Office types), .png as is
  wrapped,   // true when fileId is that JSON wrapper
  extraId,   // full-fidelity copy (sheet workbook snapshot / photo layers), JSON asset
  previewId, // small picture (photos)
  text }     // plain text of the file for agents to read (60k chars max; sheets as CSV per sheet)
```

To hand Aaron a draft, an agent writes a row with **no** `fileId`:

- doc: `{kind:"doc", title, html}` or `{kind:"doc", title, markdown}`
- sheet: `{kind:"sheet", title, rows:[["Item","Qty"],["Tee",2]]}` or `sheets:[{name, rows}]` (cells starting with `=` are formulas)
- image: `{kind:"image", title, src:"/_blob/<asset id>"}` or an https link
- always add `at` (ISO time), `by`, `byName`.

It shows in Lab files as "from Stacy" (or whoever), opens in the editor, and Save turns it into a real file.
Agents on a PC can also edit `.docx` files directly with SuperDoc's own CLI/SDK (`@superdoc-dev/cli`, `superdoc-sdk`) or LibreOffice headless.

## Tests

`npm run test:office` runs all three editors in Chromium against `test/harness.html` (a stand-in for the Lab's store):
start, open, save, reopen, download, and open an agent draft.

## Updating a vendor build

- SuperDoc: `npm i @harbour-enterprises/superdoc@<ver>`, copy `dist/superdoc.min.js` and `dist/style.css`.
- Univer: bundle `@univerjs/presets`, `@univerjs/preset-sheets-core` (+ en-US locale and CSS) and `xlsx` with esbuild into one IIFE that sets `window.LabSheetsLib = { createUniver, LocaleType, mergeLocales, UniverSheetsCorePreset, enUS, XLSX }`.
- miniPaint: copy `dist/` from the GitHub repo, then inline `images/` into `dist/bundle.js` as data URIs (the Lab artifact has a 512-file limit; see the commit "Inline miniPaint icons"); keep our `minipaint/index.html` head (theme, Lab colors).
