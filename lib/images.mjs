// Image library for the console's Art library and shirt designer, written without hosting platform code so it can be tested.
// GET    /api/images        list every saved image (metadata only)       needs the console key
// GET    /api/images?public=1  list only images marked public, for the shirt app (no key); never Charleston 3D art
//                           &brand=ed|epix3d narrows it to one brand
// GET    /api/images/:key   the image file itself: public images for anyone; private ones only with the
//                           key or a signed link (?exp=&sig=, HMAC with CONSOLE_KEY) that the keyed list,
//                           upload and PATCH responses hand out as `url`, so the console's <img> tags work
// POST   /api/images        save one image (raw body, filename in x-filename)   needs the key
//                           optional x-public: 1, x-category, x-kind (svg|png|dtf), x-source, x-access, x-brand
// PATCH  /api/images/:key   change name, tags, category, kind, public, access or brand (JSON body)   needs the key
// brand: every image belongs to one brand, c3d, ed or epix3d (EPIX3D is an Elevated Designs label). Images from before
// brands existed count as ed, or c3d when their category names Charleston 3D. Charleston 3D art is never public.
// access: customer tags that unlock a private image in the shirt app for signed-in customers (comma-separated,
// e.g. "pro, designs:benz1"; "members" means any signed-in customer). See lib/members.mjs.
// DELETE /api/images/:key   remove one image                              needs the key
// Reads from the shirt app's origins (built in, plus BUILDER_ORIGINS, comma-separated) get CORS headers, GET only.
// handleImages(req, { blobs, env }) takes a Web Request and a blob store with
// list/getWithMetadata/set/delete (lib/kv-store.mjs makes one from Workers KV) and returns a Response.
import { createHmac, timingSafeEqual } from "node:crypto";
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

// True when the bytes really are the given image type (used by the Kittl library sync too).
export const looksLike = (type, bytes) => Object.hasOwn(SNIFF, type) && SNIFF[type](bytes);

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

const KINDS = new Set(["svg", "png", "dtf"]);
export const BRANDS = ["c3d", "ed", "epix3d"];
export const brandOf = (meta) => BRANDS.includes(meta?.brand) ? meta.brand : /charleston\s*3d/i.test(meta?.category ?? "") ? "c3d" : "ed";
// The shirt apps sell through Elevated Designs, so Charleston 3D art is never public (CLAUDE.md rule 3).
export const canBePublic = (brand) => brand !== "c3d";
// The shirt apps' own addresses (Elevated Designs, plus the GitHub Pages test address);
// more can be added with BUILDER_ORIGINS.
const DEFAULT_ORIGINS = ["https://design.elevatedshirts.com", "https://elevatedshirts.com", "https://www.elevatedshirts.com",
  "https://adub843.github.io"];
// CORS for the shirt app: exact origins only, never a wildcard, and only on reads.
export const builderOrigins = (env) => [...DEFAULT_ORIGINS, ...String(env("BUILDER_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
const corsFor = (req, env) => {
  const origin = req.headers.get("origin");
  if (!origin || req.method !== "GET") return {};
  return builderOrigins(env).includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : { vary: "Origin" };
};
const withHeaders = (res, extra) => { for (const [k, v] of Object.entries(extra)) res.headers.set(k, v); return res; };
const hasKey = (req, env) => { try { requireKey({ header: (k) => req.headers.get(k) }, env); return true; } catch { return false; } };
// Signed links for private images: valid for one to two hours, rounded so a page's links stay the same for an hour.
const LINK_MS = 60 * 60 * 1000;
const sigFor = (key, exp, env) => createHmac("sha256", `image-link:${env("CONSOLE_KEY")}`).update(`${key}.${exp}`).digest("base64url");
const signedUrl = (key, env) => {
  const exp = (Math.floor(Date.now() / LINK_MS) + 2) * LINK_MS;
  return `/api/images/${encodeURIComponent(key)}?exp=${exp}&sig=${sigFor(key, exp, env)}`;
};
const validLink = (req, key, env) => {
  if (!env("CONSOLE_KEY")) return false;
  const q = new URL(req.url).searchParams;
  const exp = Number(q.get("exp")), sig = q.get("sig") ?? "";
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + 2 * LINK_MS) return false;
  const want = Buffer.from(sigFor(key, exp, env)), got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
};
const withUrl = (item, env) => ({ ...item, url: signedUrl(item.key, env) });

// Customer tags an image's access field names, lowercased: "pro, Designs:Benz1" -> ["pro", "designs:benz1"].
export const accessTags = (s) => String(s ?? "").toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
// At most 120 characters, dropping whole tags from the end so no tag is cut in half.
export const fitAccess = (s) => {
  const tags = accessTags(s);
  while (tags.join(", ").length > 120) tags.pop();
  return tags.join(", ");
};
// The private images a signed-in customer with these tags may use, each with a signed link on the console's
// own address (base). Public images are not repeated here; the app already has them.
export async function imagesForTags(blobs, tags, env, base) {
  const have = new Set(["members", ...tags.map((t) => String(t).toLowerCase().trim())]);
  const { blobs: list } = await blobs.list();
  const items = list.map(({ key, metadata }) => ({ key, ...(metadata ?? {}) }))
    .filter((i) => i.public !== true && canBePublic(brandOf(i)) && accessTags(i.access).some((t) => have.has(t)))
    .map(({ key, name, type, tags: t, category, kind, added }) => ({ key, name, type, tags: t, category, kind, added, url: `${base}${signedUrl(key, env)}` }));
  items.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  return items;
}
// Workers KV metadata is at most 1024 bytes; the shirt app fields can push a long name plus long tags
// over, so tags then the name are shortened until it fits.
export const MAX_META_BYTES = 1024;
const metaBytes = (m) => encoder.encode(JSON.stringify(m)).length;
export function fitMeta(meta) {
  const m = { ...meta };
  for (const f of ["tags", "name"]) {
    while (metaBytes(m) > MAX_META_BYTES && m[f]) m[f] = [...m[f]].slice(0, -8).join("");
  }
  if (!m.name) m.name = "image";
  return m;
}

const keyRefusal = (req, env, what) => {
  try { requireKey({ header: (k) => req.headers.get(k) }, env, what); return null; }
  catch (e) { return json({ error: e.message, code: e.code }, e.status); }
};

export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// The hourly upkeep cron renews the copy once it's this old, so a shirt app visit almost never finds it expired.
// That's about 5 KV lists and writes a day instead of 24.
export const SNAPSHOT_RENEW_MS = 5 * 60 * 60 * 1000;

// Lists the library once and saves the shirt apps' public list. The nightly Kittl sync and the hourly upkeep cron
// call it too, so a fresh copy exists before anything else on the account can use up the daily KV list allowance.
export async function refreshPublicSnapshot(blobs) {
  const { blobs: list } = await blobs.list();
  const items = list.map(({ key, metadata }) => ({ key, ...(metadata ?? {}), brand: brandOf(metadata) }))
    .filter((i) => i.public === true && canBePublic(i.brand))
    .map(({ key, name, type, tags, category, kind, added, brand }) => ({ key, name, type, tags, category, kind, added, brand }));
  items.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
  if (typeof blobs.writeSnapshot === "function") await blobs.writeSnapshot({ at: Date.now(), items });
  return items;
}

// The hourly upkeep: one KV read, and a list plus a write only when the copy is missing (a library change dropped it)
// or near its 6-hour age limit. Returns "kept" or "renewed".
export async function renewPublicSnapshot(blobs, now = Date.now()) {
  const snap = typeof blobs.readSnapshot === "function" ? await blobs.readSnapshot() : null;
  if (snap && Array.isArray(snap.items) && Number.isFinite(snap.at) && now - snap.at < SNAPSHOT_RENEW_MS) return "kept";
  await refreshPublicSnapshot(blobs);
  return "renewed";
}

export async function handleImages(req, { blobs, env }) {
  return withHeaders(await route(req, { blobs, env }), corsFor(req, env));
}

async function route(req, { blobs, env }) {
  let key;
  try { key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/images\/?/, "")); }
  catch { return json({ error: "Image not found" }, 404); }
  if (key && !KEY_RE.test(key)) return json({ error: "Image not found" }, 404);

  if (req.method === "GET" && key) {
    const found = await blobs.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "Image not found" }, 404);
    // Unreleased designs stay private: anyone else gets the same 404 as a missing image.
    const isPublic = found.metadata?.public === true;
    if (!isPublic && !validLink(req, key, env) && !hasKey(req, env)) return json({ error: "Image not found" }, 404);
    const type = Object.hasOwn(SNIFF, found.metadata?.type) ? found.metadata.type : "application/octet-stream";
    // Private files are never stored by a shared cache, so a link can't outlive its expiry there.
    const cache = isPublic ? "public, max-age=31536000, immutable" : "private, max-age=3600";
    const headers = { ...BASE_HEADERS, "content-type": type, "cache-control": cache };
    // An SVG can carry script: <img> never runs it, and opened directly it downloads instead of rendering.
    if (type === "image/svg+xml" || type === "application/octet-stream") headers["content-disposition"] = "attachment";
    return new Response(found.data, { headers });
  }

  if (req.method === "GET" && new URL(req.url).searchParams.get("public") === "1") {
    const want = new URL(req.url).searchParams.get("brand");
    if (want && !BRANDS.includes(want)) return json({ error: "Unknown brand" }, 400);
    // The saved copy (lib/kv-store.mjs) answers while it's under 6 hours old; a library change drops it sooner.
    const snap = typeof blobs.readSnapshot === "function" ? await blobs.readSnapshot() : null;
    const usable = snap && Array.isArray(snap.items) && Number.isFinite(snap.at);
    // A copy saved before art had brands is renewed, so the brand filter and the C3D rule always apply.
    const branded = usable && snap.items.every((i) => i && BRANDS.includes(i.brand));
    const pick = (list) => list.filter((i) => canBePublic(i.brand ?? brandOf(i)) && (!want || i.brand === want));
    if (branded && Date.now() - snap.at < SNAPSHOT_MAX_AGE_MS) return json({ items: pick(snap.items) });
    let items;
    try { items = pick(await refreshPublicSnapshot(blobs)); }
    catch (e) { if (usable) return json({ items: pick(snap.items.map((i) => ({ ...i, brand: i.brand ?? brandOf(i) }))) }); throw e; } // e.g. the day's KV list allowance is used up
    return json({ items });
  }

  if (req.method === "GET") {
    const refused = keyRefusal(req, env, "The image library list");
    if (refused) return refused;
    const { blobs: list } = await blobs.list();
    const items = list.map(({ key, metadata }) => withUrl({ key, ...(metadata ?? {}), brand: brandOf(metadata) }, env));
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
    const metadata = fitMeta({ name, type, size: body.byteLength, tags, added: Date.now(), ...extraMeta(req) });
    try { await blobs.set(newKey, body, { metadata }); }
    catch { return json({ error: "Couldn't save the image online just now (the free plan allows 1,000 uploads a day). Try again later.", code: "storage_failed" }, 503); }
    return json({ item: withUrl({ key: newKey, ...metadata }, env) }, 201);
  }

  if (req.method === "PATCH" && key) {
    const found = await blobs.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "Image not found" }, 404);
    let patch;
    try { patch = JSON.parse(new TextDecoder().decode(await readCapped(req, 16 * 1024))); } catch { return json({ error: "Send a JSON body" }, 400); }
    if (!patch || typeof patch !== "object") return json({ error: "Send a JSON body" }, 400);
    const meta = { ...found.metadata };
    if ("name" in patch) meta.name = fitText(patch.name ?? "", 200) || meta.name;
    if ("tags" in patch) meta.tags = fitText(patch.tags ?? "", 200);
    if ("category" in patch) { const c = fitText(patch.category ?? "", 60); if (c) meta.category = c; else delete meta.category; }
    if ("kind" in patch) { if (KINDS.has(patch.kind)) meta.kind = patch.kind; else delete meta.kind; }
    if ("public" in patch) meta.public = patch.public === true;
    if ("access" in patch) { const a = fitAccess(patch.access); if (a) meta.access = a; else delete meta.access; }
    if ("brand" in patch) { if (!BRANDS.includes(patch.brand)) return json({ error: "Unknown brand" }, 400); meta.brand = patch.brand; }
    if (!canBePublic(brandOf(meta))) { meta.public = false; delete meta.access; }
    const fitted = fitMeta(meta);
    try { await blobs.set(key, found.data, { metadata: fitted }); }
    catch { return json({ error: "Couldn't save the change just now. Try again later.", code: "storage_failed" }, 503); }
    return json({ item: withUrl({ key, ...fitted, brand: brandOf(fitted) }, env) });
  }

  if (req.method === "DELETE" && key) {
    await blobs.delete(key);
    return json({ deleted: key });
  }

  return json({ error: "Not supported" }, 405);
}

// Optional upload headers for the shirt app's library: shown publicly, category, kind and where it came from.
function extraMeta(req) {
  const h = (k) => req.headers.get(k);
  const out = { public: h("x-public") === "1" };
  const category = fitText(h("x-category") ?? "", 60);
  if (category) out.category = category;
  if (KINDS.has(h("x-kind"))) out.kind = h("x-kind");
  const source = fitText(h("x-source") ?? "", 20);
  if (source) out.source = source;
  const access = fitAccess(h("x-access"));
  if (access) out.access = access;
  const brand = h("x-brand");
  out.brand = BRANDS.includes(brand) ? brand : "ed";
  if (!canBePublic(out.brand)) { out.public = false; delete out.access; }
  return out;
}
