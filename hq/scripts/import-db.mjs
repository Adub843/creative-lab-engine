// Turns an export of the console's documents (one JSON file per document, folders = collections,
// e.g. ideas/abc.json, brief/today.json) into SQL for the D1 database:
//   node scripts/import-db.mjs <export-folder> > import.sql
//   npx.cmd wrangler d1 execute creative-lab-hq --remote --file import.sql
// Existing documents with the same path are replaced; nothing else is touched.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
if (!root) { console.error("usage: node scripts/import-db.mjs <export-folder>"); process.exit(1); }

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const now = Date.now();
let n = 0, skipped = 0;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith(".json")) yield p;
  }
}

for (const file of files(root)) {
  const path = relative(root, file).split(sep).join("/").replace(/\.json$/, "");
  const segs = path.split("/");
  if (segs.length % 2 !== 0) { skipped++; console.error("skipped (not a document path):", path); continue; }
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); } catch { skipped++; console.error("skipped (bad JSON):", path); continue; }
  if (!data || typeof data !== "object" || Array.isArray(data)) { skipped++; continue; }
  const text = JSON.stringify(data);
  if (text.length > 900000) { skipped++; console.error("skipped (over 900 KB):", path); continue; }
  const id = segs[segs.length - 1], coll = segs.slice(0, -1).join("/");
  process.stdout.write(`INSERT OR REPLACE INTO docs(path,coll,id,data,updated) VALUES(${q(path)},${q(coll)},${q(id)},${q(text)},${now});\n`);
  n++;
}
console.error(`${n} documents, ${skipped} skipped`);
