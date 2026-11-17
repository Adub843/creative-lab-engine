// Loads every .3mf file in a folder (and its subfolders) into Charleston 3D's 3D file library
// (POST /api/files, lib/files.mjs). Read-only on the folder: nothing there is moved, renamed or changed.
//   node scripts/import-3mf.mjs <folder> [console-url] [--dry-run] [--max-gb=0.5] [--r2] [--log=<file>]
// The console key comes from the CONSOLE_KEY environment variable or a hidden prompt; it is never printed
// or logged (only how many characters were entered, when it is refused).
// Files over 20 MB are skipped, copies (same name and size) are sent once, and files already in the
// library are skipped, so a re-run carries on where the last one stopped. It stops on a wrong key and on
// Cloudflare's daily write limit. --max-gb caps what one run sends: the free Workers KV plan holds 1 GB in
// all, shared with the Elevated Designs image library and the console's other data. Once the library is in
// the R2 bucket (FILES binding), --r2 lifts that cap; the 20 MB per-file limit stays.
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 20 * 1024 * 1024;
const SKIP_DIRS = new Set(["$recycle.bin", "system volume information", "node_modules", ".git"]);
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const dryRun = !!flag("dry-run");
// --log=<file> keeps a copy of what this run printed (counts and file names, never the key).
const logFile = flag("log")?.split("=").slice(1).join("=");
if (logFile) {
  fs.writeFileSync(logFile, `Run started ${new Date().toISOString()}\n`);
  for (const k of ["log", "error"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { orig(...a); try { fs.appendFileSync(logFile, `${a.join(" ")}\n`); } catch { /* the log is optional */ } };
  }
}
// Anything unexpected is written down (the error only, never the key) before the run ends.
for (const ev of ["uncaughtException", "unhandledRejection"])
  process.on(ev, (e) => { console.error(`Stopped by an unexpected error: ${e?.stack ?? e}`); process.exit(1); });
process.on("exit", (code) => { if (code && logFile) try { fs.appendFileSync(logFile, `Exited with code ${code}\n`); } catch { /* optional */ } });
const maxGb = flag("r2") ? Infinity : Number((flag("max-gb") ?? "--max-gb=0.5").split("=")[1]);
const [folder, base = "https://creative-lab-engine.business-console.workers.dev"] = args.filter((a) => !a.startsWith("--"));
if (!folder || Number.isNaN(maxGb) || maxGb <= 0) {
  console.error("Usage: node scripts/import-3mf.mjs <folder> [console-url] [--dry-run] [--max-gb=0.5] [--r2] [--log=<file>]");
  process.exit(2);
}
const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;
// Answers worth asking again: Cloudflare busy (429) or failing (any 5xx).
const retryable = (status) => status === 429 || status >= 500;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) yield* walk(p); }
    else if (e.isFile() && /\.3mf$/i.test(e.name)) yield p;
  }
}

// Hidden typing: the key is read from the terminal without being shown.
function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { resolve(""); return; }
    stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const done = (v) => { stdin.setRawMode(false); stdin.pause(); stdin.off("data", on); stdout.write("\n"); resolve(v.trim()); };
    const on = (raw) => {
      // A paste in Windows Terminal arrives wrapped in ESC[200~ … ESC[201~; those markers (and any other
      // escape sequence, such as an arrow key) are not part of the key.
      const ch = raw.replace(/\u001b\[[0-9;]*[~A-Za-z]/g, "").replace(/\u001b/g, "");
      for (const c of ch) {
        if (c === "\r" || c === "\n") return done(value);
        if (c === "\u0003") { stdout.write("\n"); process.exit(130); }
        if (c === "\u0008" || c === "\u007f") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    stdin.on("data", on);
  });
}

// The library's file name travels in an HTTP header, which only carries plain ASCII. A name with other
// characters (教堂灯.3mf) keeps its readable part, falls back to its folder's name, and gets a short tag
// from the original name so two such files never share a name. The same name is used to skip files
// already loaded.
function uploadName(p) {
  const base = path.basename(p);
  if (/^[ -~]+$/.test(base)) return base;
  const plain = (s) => s.normalize("NFKD").replace(/[^ -~]+/g, " ").replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim();
  const stem = plain(base.replace(/\.3mf$/i, "")) || plain(path.basename(path.dirname(p))) || "model";
  let h = 0;
  for (const c of base) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `${stem.slice(0, 80)}-${h.toString(36)}.3mf`;
}

// What's on disk: one entry per name and size, the first copy found.
const seen = new Map();
let found = 0, tooBig = 0, copies = 0;
for (const p of walk(folder)) {
  found++;
  let size;
  try { size = fs.statSync(p).size; } catch { continue; }
  if (size > MAX_BYTES) { tooBig++; continue; }
  const id = `${path.basename(p).toLowerCase()}|${size}`;
  if (seen.has(id)) { copies++; continue; }
  seen.set(id, { p, name: uploadName(p), size });
}
const todo = [...seen.values()];
console.log(`Found ${found} .3mf files in ${folder}: ${tooBig} over 20 MB (skipped), ${copies} copies (sent once), ${todo.length} to load (${gb(todo.reduce((s, f) => s + f.size, 0))}).`);

if (dryRun) {
  const byFolder = new Map();
  for (const f of todo) { const top = path.relative(folder, f.p).split(path.sep)[0]; byFolder.set(top, (byFolder.get(top) ?? 0) + 1); }
  for (const [d, n] of [...byFolder].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${d}`);
  let budget = 0, fits = 0;
  for (const f of todo) { if (budget + f.size > maxGb * 1e9) break; budget += f.size; fits++; }
  console.log(`Dry run: nothing sent. One run ${maxGb === Infinity ? "with --r2 (no size cap)" : `with --max-gb=${maxGb}`} would send ${fits} files (${gb(budget)}).`);
  process.exit(0);
}

// What the library already holds, so nothing is sent twice. A refused key is asked for again (3 tries).
let key = process.env.CONSOLE_KEY ?? "", headers, existing;
for (let tries = 1; !existing; tries++) {
  if (!key) key = await askHidden("Console key (typing is hidden, paste works): ");
  if (!key) { console.error("No console key entered, so nothing was sent."); process.exit(1); }
  headers = { "x-console-key": key };
  try {
    // Listing a big library can briefly fail (a 5xx, a 429 or a dropped connection); it is asked again
    // after 10, 30, 90 and 270 seconds, like the uploads.
    let res;
    for (let a = 0; ; a++) {
      let why;
      try {
        res = await fetch(`${base}/api/files`, { headers });
        if (!retryable(res.status)) break;
        why = `answered ${res.status}`;
      } catch (e) { res = null; why = `connection dropped (${e.cause?.code ?? e.message})`; }
      if (a >= 4) { if (!res) throw new Error(why); break; }
      console.log(`  the library ${why}; asking again in ${10 * 3 ** a} s`);
      await new Promise((r) => setTimeout(r, 10000 * 3 ** a));
    }
    if (res.status === 401) {
      console.error(`That console key was refused (${key.length} characters entered). Nothing was sent.`);
      if (tries >= 3 || process.env.CONSOLE_KEY) process.exit(1);
      key = "";
      continue;
    }
    if (!res.ok) throw new Error(`the library answered ${res.status}`);
    existing = new Set((await res.json()).items.map((i) => `${String(i.name).toLowerCase()}|${i.size}`));
  } catch (e) { console.error(`Couldn't read the 3D file library (${e.message}). Nothing was sent.`); process.exit(1); }
}
console.log(`Key accepted. The library holds ${existing.size} files already.`);

let sent = 0, skipped = 0, failed = 0, bytes = 0, stopped = "";
for (const f of todo) {
  if (existing.has(`${f.name.toLowerCase()}|${f.size}`)) { skipped++; continue; }
  if (bytes + f.size > maxGb * 1e9) { stopped = `this run's ${maxGb} GB cap`; break; }
  let res, out = {};
  // A dropped connection, or Cloudflare saying it's busy or failing (429 or any 5xx), is tried again after
  // 10, 30, 90 and 270 seconds before the run stops.
  for (let attempt = 0; ; attempt++) {
    let why = "";
    try {
      res = await fetch(`${base}/api/files`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream", "x-filename": f.name, "x-tags": "3mf import" },
        body: fs.readFileSync(f.p),
      });
      out = await res.json().catch(() => ({}));
      if (!retryable(res.status)) break;
      why = `${res.status} ${out.error ?? ""}`.trim();
    } catch (e) { res = null; why = `connection dropped (${e.cause?.code ?? e.message})`; }
    if (attempt >= 4) { console.log(`  gave up on ${f.name}: ${why}`); break; }
    console.log(`  ${f.name}: ${why}; trying again in ${10 * 3 ** attempt} s`);
    await new Promise((r) => setTimeout(r, 10000 * 3 ** attempt));
  }
  if (!res) { stopped = "the connection kept dropping"; break; }
  if (res.status === 401) { stopped = "the console key was refused"; break; }
  if (retryable(res.status)) { stopped = `Cloudflare kept refusing writes (${res.status}: ${out.error ?? "no reason given"})`; break; }
  if (!res.ok) { failed++; console.log(`  skipped ${f.name}: ${out.error ?? res.status}`); continue; }
  sent++; bytes += f.size;
  if (sent % 25 === 0) console.log(`  ${sent} sent (${gb(bytes)})…`);
}
console.log(`Done: ${sent} sent (${gb(bytes)}), ${skipped} already in the library, ${failed} refused.`);
if (stopped) console.log(`Stopped early: ${stopped}. Run it again later to carry on.`);
