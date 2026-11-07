// Keeps the image library in step with Aaron's Kittl library, so the shirt apps' designs stay current.
// Once an hour (the 15-minute cron at :45, see worker/app.mjs scheduledJob) the Worker reads a list of the Kittl images that belong
// in the library, published with the ED shirt app at MANIFEST_URL:
//   { "workspace": "<kittl team id>", "folders": { "<kittl folder id>": "<library category>" },
//     "images": [{ "id": "<kittl upload id>", "type": "image/png", "folder": "<kittl folder id>", "public": true }] }
// New Kittl images are copied in (a few per run, from Kittl's own image host only), and library images
// that came from a listed Kittl folder but are no longer in Kittl are removed. Nothing else changes:
// images uploaded in the console, other categories, and the console's own edits (name, tags, public)
// are left alone. The list is written by a scheduled Claude task that reads Kittl and marks brand
// logos `public: false`, so they stay out of the customer library (see the README, "Kittl library sync").
// No key is involved: the Worker only reads a public list and a public image host.
import { looksLike, fitMeta, MAX_BYTES } from "./images.mjs";

export const MANIFEST_URL = "https://design.elevatedshirts.com/library/kittl.json";
// Where the last run's result is kept in the IMAGES namespace (outside the "image:" keys the library lists).
export const STATE_KEY = "sync:kittl";
// Copies per run: each is one download and one KV write, well inside a cron run's limits.
export const MAX_ADDS = 8;
// A Worker's fetch sends no browser headers, and image hosts often turn such bare requests away.
export const DOWNLOAD_HEADERS = { accept: "image/png,image/jpeg,image/webp,image/svg+xml,image/*;q=0.8", "user-agent": "Mozilla/5.0 (compatible; ElevatedDesignsConsole/1.0; +https://design.elevatedshirts.com)" };

const ID = /^c[a-z0-9]{20,30}$/;
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

export function parseManifest(m) {
  if (!m || typeof m !== "object") throw new Error("the list isn't JSON");
  if (!ID.test(m.workspace ?? "")) throw new Error("the list has no Kittl workspace id");
  const folders = new Map();
  for (const [id, category] of Object.entries(m.folders ?? {})) {
    if (!ID.test(id) || typeof category !== "string" || !category.trim()) throw new Error(`bad folder ${String(id).slice(0, 40)}`);
    folders.set(id, category.trim().slice(0, 60));
  }
  if (!folders.size) throw new Error("the list names no Kittl folders");
  if (!Array.isArray(m.images) || !m.images.length) throw new Error("the list has no images; refusing to empty the library");
  const images = [], seen = new Set();
  for (const i of m.images) {
    if (!ID.test(i?.id ?? "") || !EXT[i.type] || !folders.has(i.folder)) throw new Error(`bad image ${String(i?.id).slice(0, 40)}`);
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    images.push({ id: i.id, type: i.type, folder: i.folder, public: i.public !== false });
  }
  return { workspace: m.workspace, folders, images };
}

export async function syncKittlLibrary({ blobs, fetchImpl, manifestUrl = MANIFEST_URL, now = Date.now, maxAdds = MAX_ADDS }) {
  const at = new Date(now()).toISOString();
  let man;
  try {
    const res = await fetchImpl(manifestUrl, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`reading the list failed (${res.status})`);
    man = parseManifest(await res.json());
  } catch (e) {
    return { ok: false, at, error: e.message };
  }

  const categories = new Set(man.folders.values());
  const { blobs: list } = await blobs.list();
  const inLibrary = new Map(); // Kittl upload id -> library entries carrying its kittl:<id> tag
  for (const b of list) {
    for (const t of String(b.metadata?.tags ?? "").split(/\s+/)) {
      if (t.startsWith("kittl:")) (inLibrary.get(t.slice(6)) ?? inLibrary.set(t.slice(6), []).get(t.slice(6))).push(b);
    }
  }
  const fromFolders = (b) => b.metadata?.source === "kittl" && categories.has(b.metadata?.category);
  const wanted = new Set(man.images.map((i) => i.id));

  // A sudden mass removal is far more likely a bad list than Aaron clearing Kittl: hold it for a look.
  const gone = [...inLibrary].filter(([id]) => !wanted.has(id)).flatMap(([, bs]) => bs.filter(fromFolders));
  const synced = [...inLibrary.values()].flat().filter(fromFolders).length;
  const limit = Math.max(10, Math.ceil(synced * 0.1));
  let removed = 0, warning = null;
  if (gone.length > limit) warning = `${gone.length} images left Kittl at once (more than ${limit}), so none were removed; check the list`;
  else for (const b of gone) { await blobs.delete(b.key); removed++; }

  const todo = man.images.filter((i) => !inLibrary.has(i.id));
  let added = 0;
  const failed = [];
  for (const img of todo.slice(0, maxAdds)) {
    try {
      const res = await fetchImpl(`https://cache.kittl.com/pr:sharp/plain/api/users/${man.workspace}/uploads/${img.id}.${EXT[img.type]}`, { headers: DOWNLOAD_HEADERS });
      if (!res.ok) throw new Error(`download ${res.status}`);
      if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error("over 20 MB");
      const body = await res.arrayBuffer();
      if (body.byteLength > MAX_BYTES) throw new Error("over 20 MB");
      if (!looksLike(img.type, new Uint8Array(body))) throw new Error(`not a valid ${EXT[img.type]} file`);
      const t = now();
      const metadata = fitMeta({
        name: `kittl-${img.id}`, type: img.type, size: body.byteLength, tags: `kittl:${img.id}`, added: t,
        public: img.public, category: man.folders.get(img.folder), kind: img.type === "image/svg+xml" ? "svg" : "png", source: "kittl",
      });
      await blobs.set(`${t.toString(36)}-${crypto.randomUUID().slice(0, 8)}`, body, { metadata });
      added++;
    } catch (e) {
      failed.push(`${img.id}: ${e.message}`);
    }
  }
  return { ok: true, at, inKittl: man.images.length, added, removed, waiting: todo.length - added, failed, warning };
}
