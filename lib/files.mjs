// Charleston 3D file library: the 3D print files (STL, 3MF, OBJ, STEP) and their photos, kept apart from
// the Elevated Designs image library (lib/images.mjs) so the two brands never share a list.
// GET    /api/files              list every file (metadata only)                         needs the console key
// GET    /api/files/:key         the file itself, with the key or a signed link (?exp=&sig=) from the list
// GET    /api/files/:key/thumb   its preview picture (PNG made in the browser at upload), same rules
// POST   /api/files              save one file (raw body, filename in x-filename, optional x-tags)  needs the key
// PUT    /api/files/:key/thumb   save the preview picture (PNG, up to 300 KB)            needs the key
// PATCH  /api/files/:key         change name or tags (JSON body)                          needs the key
// DELETE /api/files/:key         remove a file and its preview                            needs the key
// handleFiles(req, { blobs, thumbs, env }) takes two blob stores (lib/kv-store.mjs, own prefixes) and returns a Response.
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireKey } from "./shopify.mjs";
import { MAX_BYTES, MAX_MB, fitText, fitMeta, looksLike } from "./images.mjs";

export const MAX_THUMB_BYTES = 300 * 1024;
const KEY_RE = /^[a-z0-9]{1,12}-[0-9a-f]{8}$/;
const text = (b, n = 4096) => new TextDecoder().decode(b.subarray(0, n));
const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// Each file type: the extensions it may have and a check on its first bytes, so a file is what its name says.
export const TYPES = {
  "model/stl": { ext: ["stl"], ok: (b) => /^\s*solid\b/i.test(text(b, 256)) || (b.length >= 84 && b.length === 84 + 50 * new DataView(b.buffer, b.byteOffset).getUint32(80, true)) },
  "model/3mf": { ext: ["3mf"], ok: isZip },
  "model/obj": { ext: ["obj"], ok: (b) => /^(\s*(#.*|o .*|g .*|mtllib .*|usemtl .*|s .*)?\r?\n)*\s*v\s+-?[\d.]/m.test(text(b)) },
  "model/step": { ext: ["step", "stp"], ok: (b) => /^\s*ISO-10303-21;/.test(text(b, 64)) },
  "image/png": { ext: ["png"], ok: (b) => looksLike("image/png", b) },
  "image/jpeg": { ext: ["jpg", "jpeg"], ok: (b) => looksLike("image/jpeg", b) },
  "image/webp": { ext: ["webp"], ok: (b) => looksLike("image/webp", b) },
};
export const EXTENSIONS = Object.values(TYPES).flatMap((t) => t.ext);
export const typeFor = (name) => {
  const ext = String(name).toLowerCase().split(".").pop();
  return Object.keys(TYPES).find((t) => TYPES[t].ext.includes(ext)) ?? null;
};

const BASE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const keyRefusal = (req, env, what) => {
  try { requireKey({ header: (k) => req.headers.get(k) }, env, what); return null; }
  catch (e) { return json({ error: e.message, code: e.code }, e.status); }
};
const hasKey = (req, env) => keyRefusal(req, env) === null;

// Signed links so <img> and download links work without sending the key. One signature covers every
// file in the library for the same hour, so listing the library costs one HMAC, not one or two per file
// (the free Workers plan allows 10 ms of compute per request, and the library holds hundreds of files).
// The links only ever reach someone who already has the console key.
const LINK_MS = 60 * 60 * 1000;
const sigFor = (exp, env) => createHmac("sha256", `file-link:${env("CONSOLE_KEY")}`).update(`files.${exp}`).digest("base64url");
const linkQuery = (env) => {
  const exp = (Math.floor(Date.now() / LINK_MS) + 2) * LINK_MS;
  return `?exp=${exp}&sig=${sigFor(exp, env)}`;
};
const validLink = (req, env) => {
  if (!env("CONSOLE_KEY")) return false;
  const q = new URL(req.url).searchParams;
  const exp = Number(q.get("exp")), sig = q.get("sig") ?? "";
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + 2 * LINK_MS) return false;
  const want = Buffer.from(sigFor(exp, env)), got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
};
const withUrls = (item, query) => ({ ...item, url: `/api/files/${item.key}${query}`, ...(item.thumb ? { thumbUrl: `/api/files/${item.key}/thumb${query}` } : {}) });

// Checks one file (its extension and its first bytes) and saves it to the library. Also used by
// the 3D maker (lib/meshy.mjs) to keep a model it made. Returns { status, item } or { status, error }.
export async function saveFile(blobs, env, { name, body, tags = "" }) {
  name = fitText(name, 200);
  const type = typeFor(name);
  if (!type) return { status: 415, error: "That kind of file can't go in the 3D file library." };
  if (body.byteLength > MAX_BYTES) return { status: 413, error: `File is larger than ${MAX_MB} MB` };
  if (!body.length || !TYPES[type].ok(body)) return { status: 415, error: `That file isn't a valid .${name.split(".").pop().toLowerCase()} file.` };
  const newKey = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const metadata = fitMeta({ name, type, size: body.byteLength, tags: fitText(tags, 200), added: Date.now(), store: "c3d" });
  try { await blobs.set(newKey, body, { metadata }); }
  catch { return { status: 503, error: "Couldn't save the file online just now. Try again later.", code: "storage_failed" }; }
  return { status: 201, item: withUrls({ key: newKey, ...metadata }, linkQuery(env)) };
}

async function readCapped(req, max) {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

export async function handleFiles(req, { blobs, thumbs, env }) {
  let rest;
  try { rest = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/files\/?/, "")); }
  catch { return json({ error: "File not found" }, 404); }
  const [key = "", part = "", extra] = rest.split("/");
  if (extra !== undefined || (key && !KEY_RE.test(key)) || (part && part !== "thumb")) return json({ error: "File not found" }, 404);

  if (req.method === "GET" && key) {
    if (!validLink(req, env) && !hasKey(req, env)) return json({ error: "File not found" }, 404);
    const found = await (part ? thumbs : blobs).getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "File not found" }, 404);
    if (part) return new Response(found.data, { headers: { ...BASE_HEADERS, "content-type": "image/png", "cache-control": "private, max-age=3600" } });
    const type = Object.hasOwn(TYPES, found.metadata?.type) ? found.metadata.type : "application/octet-stream";
    const isImage = type.startsWith("image/");
    const name = String(found.metadata?.name ?? "file").replace(/[^\w.\- ]+/g, "_");
    const headers = { ...BASE_HEADERS, "content-type": isImage ? type : "application/octet-stream", "cache-control": "private, max-age=3600" };
    if (!isImage) headers["content-disposition"] = `attachment; filename="${name}"`;
    return new Response(found.data, { headers });
  }

  if (req.method === "GET") {
    const refused = keyRefusal(req, env, "The 3D file library");
    if (refused) return refused;
    const { blobs: list } = await blobs.list();
    const query = linkQuery(env);
    const items = list.map(({ key, metadata }) => withUrls({ key, ...(metadata ?? {}) }, query));
    items.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
    return json({ items });
  }

  const refused = keyRefusal(req, env, "Uploads and deletes");
  if (refused) return refused;

  if (req.method === "POST" && !key) {
    const name = fitText(req.headers.get("x-filename") ?? "", 200);
    if (!typeFor(name)) return json({ error: `Send a 3D file (${EXTENSIONS.filter((e) => !/png|jpe?g|webp/.test(e)).join(", ")}) or a photo (png, jpg, webp).` }, 415);
    const tooBig = () => json({ error: `File is larger than ${MAX_MB} MB` }, 413);
    if (Number(req.headers.get("content-length")) > MAX_BYTES) return tooBig();
    const body = await readCapped(req, MAX_BYTES);
    if (!body) return tooBig();
    const out = await saveFile(blobs, env, { name, body, tags: req.headers.get("x-tags") ?? "" });
    return json(out.error ? { error: out.error, code: out.code } : { item: out.item }, out.status);
  }

  if (req.method === "PUT" && key && part === "thumb") {
    const found = await blobs.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "File not found" }, 404);
    const body = await readCapped(req, MAX_THUMB_BYTES);
    if (!body) return json({ error: "Preview is larger than 300 KB" }, 413);
    if (!looksLike("image/png", body)) return json({ error: "The preview must be a PNG." }, 415);
    try {
      await thumbs.set(key, body, { metadata: { type: "image/png" } });
      await blobs.set(key, found.data, { metadata: fitMeta({ ...found.metadata, thumb: true }) });
    } catch { return json({ error: "Couldn't save the preview just now.", code: "storage_failed" }, 503); }
    return json({ item: withUrls({ key, ...found.metadata, thumb: true }, linkQuery(env)) });
  }

  if (req.method === "PATCH" && key && !part) {
    const found = await blobs.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "File not found" }, 404);
    let patch;
    try { patch = JSON.parse(new TextDecoder().decode(await readCapped(req, 16 * 1024))); } catch { return json({ error: "Send a JSON body" }, 400); }
    if (!patch || typeof patch !== "object") return json({ error: "Send a JSON body" }, 400);
    const meta = { ...found.metadata };
    // The extension stays, so the file still opens in the slicer.
    if ("name" in patch) {
      const ext = String(meta.name).split(".").pop();
      const base = fitText(String(patch.name ?? "").replace(/\.[a-z0-9]+$/i, ""), 190);
      if (base) meta.name = `${base}.${ext}`;
    }
    if ("tags" in patch) meta.tags = fitText(patch.tags ?? "", 200);
    const fitted = fitMeta(meta);
    try { await blobs.set(key, found.data, { metadata: fitted }); }
    catch { return json({ error: "Couldn't save the change just now. Try again later.", code: "storage_failed" }, 503); }
    return json({ item: withUrls({ key, ...fitted }, linkQuery(env)) });
  }

  if (req.method === "DELETE" && key && !part) {
    await blobs.delete(key);
    await thumbs.delete(key);
    return json({ deleted: key });
  }

  return json({ error: "Not supported" }, 405);
}
