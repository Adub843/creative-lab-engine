// Image library for the Design Studio, written without hosting platform code so it can be tested.
// GET    /api/images        list every saved image (metadata only)       needs the console key
// GET    /api/images/:key   the image file itself (for <img>, so no key; keys are unguessable)
// POST   /api/images        save one image (raw body, filename in x-filename)   needs the key
// DELETE /api/images/:key   remove one image                              needs the key
// handleImages(req, { blobs, env }) takes a Web Request and a blob store with
// list/getWithMetadata/set/delete (lib/kv-store.mjs makes one from Workers KV) and returns a Response.
import { requireKey } from "./shopify.mjs";

// Workers KV takes values up to 25 MiB; 20 MB leaves room and is Shopify's limit for product images.
export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_MB = MAX_BYTES / 1024 / 1024;
// Workers KV metadata is at most 1024 bytes once serialised, so name and tags are capped in bytes.
export const MAX_META_TEXT_BYTES = 400;
const KEY_RE = /^[a-z0-9]{1,12}-[0-9a-f]{8}$/;

// Each allowed type with a check on the file's first bytes, so the stored type matches the content.
const startsWith = (b, ...sig) => sig.every((v, i) => v == null || b[i] === v);
const SNIFF = {
  "image/png": (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  "image/jpeg": (b) => startsWith(b, 0xff, 0xd8, 0xff),
  "image/gif": (b) => startsWith(b, 0x47, 0x49, 0x46, 0x38),
  "image/webp": (b) => startsWith(b, 0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50),
  "image/svg+xml": (b) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 4096)).replace(/^﻿/, "")),
};

// Every response: never sniffed, never framed, never runs script on the console's origin.
const BASE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
// Drops control characters and trims to whole characters so the JSON-encoded string fits in maxBytes.
const encoder = new TextEncoder();
export function fitText(value, maxChars, maxBytes = MAX_META_TEXT_BYTES) {
  let chars = [...String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")].slice(0, maxChars);
  while (chars.length && encoder.encode(JSON.stringify(chars.join(""))).length - 2 > maxBytes) chars = chars.slice(0, -1);
  return chars.join("");
}

// Reads at most max bytes of the body, stopping (null) as soon as it's bigger, so an oversized
// upload without a content-length is never held in memory whole.
async function readCapped(req, max) {
  if (!req.body) return new ArrayBuffer(0);
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
  return out.buffer;
}

const keyRefusal = (req, env, what) => {
  try { requireKey({ header: (k) => req.headers.get(k) }, env, what); return null; }
  catch (e) { return json({ error: e.message, code: e.code }, e.status); }
};

export async function handleImages(req, { blobs, env }) {
  let key;
  try { key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/images\/?/, "")); }
  catch { return json({ error: "Image not found" }, 404); }
  if (key && !KEY_RE.test(key)) return json({ error: "Image not found" }, 404);

  if (req.method === "GET" && key) {
    const found = await blobs.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "Image not found" }, 404);
    const type = Object.hasOwn(SNIFF, found.metadata?.type) ? found.metadata.type : "application/octet-stream";
    const headers = { ...BASE_HEADERS, "content-type": type, "cache-control": "public, max-age=31536000, immutable" };
    // An SVG can carry script: <img> never runs it, and opened directly it downloads instead of rendering.
    if (type === "image/svg+xml" || type === "application/octet-stream") headers["content-disposition"] = "attachment";
    return new Response(found.data, { headers });
  }

  if (req.method === "GET") {
    const refused = keyRefusal(req, env, "The image library list");
    if (refused) return refused;
    const { blobs: list } = await blobs.list();
    const items = list.map(({ key, metadata }) => ({ key, ...(metadata ?? {}) }));
    items.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
    return json({ items });
  }

  const refused = keyRefusal(req, env, "Uploads and deletes");
  if (refused) return refused;

  if (req.method === "POST" && !key) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!Object.hasOwn(SNIFF, type)) return json({ error: `Unsupported file type: ${type.slice(0, 60) || "unknown"}` }, 415);
    const tooBig = () => json({ error: `Image is larger than ${MAX_MB} MB` }, 413);
    if (Number(req.headers.get("content-length")) > MAX_BYTES) return tooBig();
    const body = await readCapped(req, MAX_BYTES);
    if (!body) return tooBig();
    if (!SNIFF[type](new Uint8Array(body))) return json({ error: `That file isn't a valid ${type.replace("image/", "").replace("+xml", "")} image.` }, 415);
    const name = fitText(req.headers.get("x-filename") ?? "", 200) || "image";
    const tags = fitText(req.headers.get("x-tags") ?? "", 200);
    const newKey = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const metadata = { name, type, size: body.byteLength, tags, added: Date.now() };
    try { await blobs.set(newKey, body, { metadata }); }
    catch { return json({ error: "Couldn't save the image online just now (the free plan allows 1,000 uploads a day). Try again later.", code: "storage_failed" }, 503); }
    return json({ item: { key: newKey, ...metadata } }, 201);
  }

  if (req.method === "DELETE" && key) {
    await blobs.delete(key);
    return json({ deleted: key });
  }

  return json({ error: "Not supported" }, 405);
}
