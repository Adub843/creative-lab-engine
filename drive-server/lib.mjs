// Shared pieces of the E: drive library server: how a file is sorted (brand and kind), its id, and the
// request signature the Creative Lab engine Worker sends. The Worker side of the signature is lib/drive.mjs.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const IMAGE_EXTS = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"]);
export const MODEL_EXTS = new Set([".stl", ".3mf", ".obj", ".step", ".stp"]);
// Design source files: listed and downloadable, shown with a file-type tile instead of a preview.
export const SOURCE_EXTS = new Set([".ai", ".eps", ".pdf", ".dxf", ".cdr", ".psd", ".tif", ".tiff", ".studio3"]);
export const INDEXED_EXTS = new Set([...IMAGE_EXTS, ...MODEL_EXTS, ...SOURCE_EXTS]);
// Thumbnails are made for these (sharp reads them all, SVG included).
export const THUMB_EXTS = new Set([...IMAGE_EXTS, ".tif", ".tiff"]);

// Top folders on E: that hold Charleston3D work. Every 3D model is Charleston3D's wherever it sits.
export const C3D_FOLDERS = new Set(["print files", "comercial downloaded 3d print files"]);

export function classify(relPath) {
  const parts = relPath.split(/[\\/]/);
  const top = parts.length > 1 ? parts[0] : "";
  const ext = path.extname(relPath).toLowerCase();
  const brand = MODEL_EXTS.has(ext) || C3D_FOLDERS.has(top.toLowerCase()) ? "c3d" : "ed";
  const kind = MODEL_EXTS.has(ext) ? "3d"
    : SOURCE_EXTS.has(ext) ? "source"
    : /dtf|halftone/i.test(relPath) ? "dtf"
    : /logo/i.test(relPath) ? "logo"
    : ext === ".svg" ? "svg" : "image";
  return { top, ext, brand, kind };
}

// One id per distinct file: the same name and size in two folders is the same file, listed once.
export const fileId = (name, size) => createHash("sha256").update(`${name.toLowerCase()}|${size}`).digest("hex").slice(0, 20);
export const ID_RE = /^[0-9a-f]{20}$/;

// The Worker signs each request with CONSOLE_KEY: HMAC over the expiry time and the path with its query.
export const MAX_SKEW_S = 300;
export const driveSig = (key, exp, pathAndQuery) =>
  createHmac("sha256", `drive:${key}`).update(`${exp}\n${pathAndQuery}`).digest("base64url");
export function verifySig(key, exp, sig, pathAndQuery, now = Date.now()) {
  if (!key || !sig || !/^\d{10}$/.test(String(exp))) return false;
  if (Math.abs(Number(exp) - Math.floor(now / 1000)) > MAX_SKEW_S) return false;
  const want = Buffer.from(driveSig(key, exp, pathAndQuery)), got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

export const CONTENT_TYPES = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf", ".stl": "model/stl", ".3mf": "model/3mf", ".obj": "model/obj", ".step": "model/step", ".stp": "model/step",
};

// The shirt app's share: Elevated Designs pictures (no source files, no 3D) from the E: folders in SHIRT_APP_FOLDERS.
// About 150,000 files, so the list is read from the index once (one full scan, a few seconds) and kept in memory;
// every page, folder filter and search after that is answered from memory in milliseconds.
const SHIRT_EXTS = [".png", ".svg", ".jpg", ".jpeg", ".webp"];
// The shirt app's "type" filter, sorted the way the app sorts its own art: DTF-ready prints, SVGs, then other pictures.
const SHIRT_TYPES = ["png", "svg", "dtf"];
const shirtType = (r) => (r.kind === "dtf" ? "dtf" : r.ext === ".svg" ? "svg" : "png");
export function loadShirtSet(db, roots, shirtFolders) {
  const eRoot = roots.findIndex((r) => r.src === "e");
  const esc = (w) => w.replace(/[\\%_]/g, (c) => "\\" + c);
  // a folder and everything under it: "<folder>\\" (an escaped backslash) then any path
  const folders = shirtFolders.map((f) => `${esc(f.toLowerCase())}\\\\%`);
  const where = ["root = ?", "brand = 'ed'", "kind IN ('image', 'svg', 'dtf', 'logo')", `ext IN (${SHIRT_EXTS.map(() => "?").join(", ")})`,
    `(${folders.map(() => "lower(rel) LIKE ? ESCAPE '\\'").join(" OR ") || "0"})`];
  const rows = db.prepare(`SELECT id, name, folder, ext, kind, rel FROM items WHERE ${where.join(" AND ")} ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE`)
    .all(eRoot, ...SHIRT_EXTS, ...folders);
  const lowerFolders = shirtFolders.map((f) => f.toLowerCase() + "\\");
  const counts = shirtFolders.map(() => 0);
  const items = [], tops = [], types = [], hay = [];
  for (const r of rows) {
    const rel = String(r.rel).toLowerCase();
    const top = lowerFolders.findIndex((f) => rel.startsWith(f));
    // "._name" files are Mac copy leftovers (zip "__MACOSX" folders), not pictures: they have no preview
    if (top < 0 || String(r.name).startsWith("._")) continue;
    counts[top]++;
    items.push({ id: r.id, name: r.name, folder: r.folder, ext: r.ext, kind: r.kind });
    tops.push(top);
    types.push(SHIRT_TYPES.indexOf(shirtType(r)));
    hay.push(`${String(r.name).toLowerCase()}\n${String(r.folder ?? "").toLowerCase()}`);
  }
  return { items, tops, types, hay, names: shirtFolders, folders: shirtFolders.map((name, i) => ({ name, count: counts[i] })).filter((f) => f.count) };
}

// One page of the share:  ?page=&per=&q=&folder=&type=   folder is one of the top folders (any case); type is png, svg
// or dtf; every search word must be in the file's name or folder path. Always says how many files each top folder holds, for the shirt app's folder list.
export function shirtPage(set, q) {
  const per = Math.min(1000, Math.max(1, Number(q.get("per")) || 500));
  const page = Math.max(0, Math.floor(Number(q.get("page")) || 0));
  const words = (q.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const folderName = (q.get("folder") ?? "").trim().toLowerCase();
  const top = folderName ? set.names.findIndex((n) => n.toLowerCase() === folderName) : -1;
  const type = SHIRT_TYPES.indexOf(q.get("type") ?? "");
  if (folderName && top < 0) return { page, per, total: 0, items: [], folders: set.folders };
  if (!words.length && top < 0 && type < 0) return { page, per, total: set.items.length, items: set.items.slice(page * per, page * per + per), folders: set.folders };
  const from = page * per, items = [];
  let total = 0;
  for (let i = 0; i < set.items.length; i++) {
    if (top >= 0 && set.tops[i] !== top) continue;
    if (type >= 0 && set.types[i] !== type) continue;
    if (words.length && !words.every((w) => set.hay[i].includes(w))) continue;
    if (total >= from && items.length < per) items.push(set.items[i]);
    total++;
  }
  return { page, per, total, items, folders: set.folders };
}

// Previews are made a few at a time. The newest request goes first (in the shirt app that is what the customer is
// looking at now, after scrolling past the rest), and a request whose visitor has already gone is skipped, not made.
// slot(gone) resolves true when the job may start (call done() after it) or false when gone() said nobody waits.
export function jobQueue(limit) {
  let running = 0;
  const waiting = [];
  const pump = () => {
    while (running < limit && waiting.length) {
      const job = waiting.pop();
      if (job.gone()) { job.resolve(false); continue; }
      running++;
      job.resolve(true);
    }
  };
  return {
    slot: (gone = () => false) => new Promise((resolve) => { waiting.push({ resolve, gone }); pump(); }),
    done: () => { running--; pump(); },
    get waiting() { return waiting.length; },
    get running() { return running; },
  };
}

export const shirtSearch = (db, roots, shirtFolders, q) => shirtPage(loadShirtSet(db, roots, shirtFolders), q);
