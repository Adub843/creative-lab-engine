// One-click listings for Elevated Designs: a design from the image library becomes a live
// product on theelevateddesignsllc.com, offered on the blanks the customer picks from.
// Plain functions with no hosting code (see lib/shopify.mjs).
//
// GET  /api/listings?store=ed   the template: defaults, handling days and the blank catalog    key
// POST /api/listings            { store: "ed", imageKey, title, blanks, sizes, markup, ... }   key
//
// Options are Blank x Color x Size. Blanks, colors and per-size prices come from the shared blank
// catalog in data/blanks.json (copied from the shirt app; see README).
//
// Steps for a new listing: look for a product already tagged design:<imageKey> (so pressing
// List it twice never makes two products), read the image from the library, stage it with
// stagedUploadsCreate and POST it to the staged target, create the product with productSet
// (inventory not tracked: printed to order), publish it to the Online Store, then ping IndexNow.
// Up to 100 variants productSet runs synchronously; above that it runs asynchronously and the
// operation is polled for about 4 seconds (Netlify functions stop at 10 s). If it isn't done by
// then the answer is 202 with the operation id, and the page asks again with that id, which
// finishes the listing without starting a second product.
// Elevated Designs only: Charleston 3D products are made in Shopify.
import fs from "node:fs";
import {
  HttpError, ok, fail, requireKey, parseStore, storeConfig, adminClient, userErrorsOrThrow,
  readJsonBody, pingIndexNow, productUrl, adminUrl, fetchWithTimeout, PUBLISH_MUTATION, ACTIVATE_MUTATION,
} from "./shopify.mjs";
import { handleImages } from "./images.mjs";
import { SIZES, MAX_VARIANTS, STANDARD_VARIANTS, OPTION_NAMES, blankLabel, sku, defaultBlanks, variantsFor } from "../assets/listing.js";
export { SIZES };

// Read once per function instance. netlify.toml includes data/blanks.json with the functions.
let catalogCache = null;
export function blankCatalog() {
  if (!catalogCache) {
    const c = JSON.parse(fs.readFileSync(new URL("../data/blanks.json", import.meta.url), "utf8"));
    catalogCache = { version: c.version, updated: c.updated, currency: c.currency, costsAreEstimates: c.costsAreEstimates, pricing: c.pricing, types: c.types, tiers: c.tiers,
      // Costs and suppliers stay on the server: the page only needs what a listing shows.
      blanks: c.blanks.map(({ cost, suppliers, ...b }) => b) };
  }
  return catalogCache;
}

const MAX_LISTING_BODY = 32 * 1024;
const LISTING_TIMEOUT_MS = 15000; // productSet with media and a 6 MB upload take longer than a list
const POLL_BUDGET_MS = 4000; // how long one request waits for an asynchronous productSet (Netlify stops at 10 s)
const POLL_EVERY_MS = 1000;
const OPERATION_GID = /^gid:\/\/shopify\/ProductSetOperation\/[1-9]\d{0,19}$/;
const IMAGE_KEY = /^[a-z0-9]{1,12}-[0-9a-f]{8}$/; // same shape lib/images.mjs gives new images
const PRODUCT_IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const VENDOR = "Elevated Designs";
export const designTag = (imageKey) => `design:${imageKey}`;

export function listingTemplate(env) {
  const days = (env("ED_HANDLING_DAYS") ?? "").trim();
  return {
    store: "ed",
    vendor: VENDOR,
    productType: "T-Shirt",
    handlingDays: /^\d{1,2}(-\d{1,2})?$/.test(days) ? days : "5-7",
    tags: ["elevated-designs", "graphic-tee", "t-shirt", "printed-to-order"],
    options: OPTION_NAMES,
    defaults: { blanks: defaultBlanks(blankCatalog()), sizes: [...SIZES], markup: 0 },
    catalog: blankCatalog(),
    limits: { title: 255, seoTitle: 60, seoDescription: 155, descriptionHtml: 20000, tags: 25, tag: 40, blanks: 25, variants: MAX_VARIANTS,
      standardVariants: STANDARD_VARIANTS, markupMin: -10, markupMax: 100, priceMin: 1, priceMax: 500 },
  };
}

// ---------- input ----------
const bad = (msg, field) => new HttpError(400, "bad_input", msg, field ? { details: { field } } : {});
const str = (v, field, { min = 1, max, label }) => {
  if (typeof v !== "string") throw bad(`${label} must be text.`, field);
  const t = v.trim();
  if (t.length < min) throw bad(`${label} can't be empty.`, field);
  if (t.length > max) throw bad(`${label} is ${t.length} characters; the most is ${max}.`, field);
  return t;
};
const cents = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
// The description is the store owner's own copy, but nothing that runs script goes on the store.
// Browsers run handlers written as <img/onerror=..> or <img src="x"onerror=..> (no space before
// "on") and read entities and tabs inside URLs (javascript&#58; or java&#x09;script:), so: only
// formatting tags, no on* attribute after any separator, and schemes checked after decoding.
const SAFE_TAGS = new Set(["p", "br", "hr", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "span", "div",
  "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption"]);
const NAMED = { colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", period: ".", amp: "&" };
const decodeEntities = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (m, hex, dec, name) => {
  if (hex || dec) { const n = parseInt(hex ?? dec, hex ? 16 : 10); return n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return NAMED[name.toLowerCase()] ?? m;
});
export function unsafeHtml(html) {
  for (const [, name] of html.matchAll(/<\/?([a-z][^\s/>]*)/gi)) if (!SAFE_TAGS.has(name.toLowerCase())) return true;
  if (/<(?:!(?!--)|\?)/.test(html)) return true; // doctype, CDATA, processing instructions
  if (/[\s/"'`]on[a-z]+\s*=/i.test(html)) return true;
  const flat = decodeEntities(decodeEntities(html)).replace(/[\u0000-\u0020\u007f-\u009f]+/g, "");
  return /(javascript|vbscript|livescript):|data:text\/html/i.test(flat);
}

export function parseListingInput(body, tpl) {
  const allowed = new Set(["store", "imageKey", "title", "blanks", "sizes", "markup", "productType", "tags", "descriptionHtml", "seoTitle", "seoDescription", "operationId"]);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw bad(`Unexpected field: ${extra.slice(0, 3).join(", ")}.`);
  const store = parseStore(body.store);
  if (store !== "ed") throw new HttpError(400, "wrong_store", "Listings are for Elevated Designs only. Charleston 3D products are made in Shopify, then switched on in Products.");
  if (typeof body.imageKey !== "string" || !IMAGE_KEY.test(body.imageKey))
    throw bad("imageKey must be the key of an image in the online library.", "imageKey");
  const L = tpl.limits;
  const title = str(body.title, "title", { min: 2, max: L.title, label: "Title" });

  const { blanks, sizes, markup, variants } = parseOffer(body, tpl);
  const productType = body.productType == null ? tpl.productType : str(body.productType, "productType", { max: 60, label: "Product type" });

  const tagsIn = body.tags ?? tpl.tags;
  if (!Array.isArray(tagsIn) || tagsIn.length > L.tags) throw bad(`Tags must be a list of at most ${L.tags}.`, "tags");
  const tags = [];
  for (const t of tagsIn) {
    const v = str(t, "tags", { max: L.tag, label: "Each tag" });
    if (v.includes(",")) throw bad("A tag can't contain a comma; send each tag on its own.", "tags");
    if (/^design:/i.test(v)) throw bad("The design: tag is added by the console.", "tags");
    if (v.toLowerCase() === "customizable") throw bad("The customizable tag is a Charleston 3D setting, not for Elevated Designs.", "tags");
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase())) tags.push(v);
  }

  const descriptionHtml = str(body.descriptionHtml, "descriptionHtml", { min: 10, max: L.descriptionHtml, label: "Description" });
  if (unsafeHtml(descriptionHtml)) throw bad("The description can only use plain formatting (paragraphs, lists, bold, links); no scripts, forms or embeds.", "descriptionHtml");
  const seoTitle = str(body.seoTitle, "seoTitle", { max: L.seoTitle, label: "SEO title" });
  const seoDescription = str(body.seoDescription, "seoDescription", { min: 20, max: L.seoDescription, label: "SEO description" });

  let operationId = null;
  if (body.operationId != null) {
    if (typeof body.operationId !== "string" || !OPERATION_GID.test(body.operationId)) throw bad("operationId must be the id Shopify gave a listing still being made.", "operationId");
    operationId = body.operationId;
  }
  return { store, imageKey: body.imageKey, title, blanks, sizes, markup, variants, productType, tags, descriptionHtml, seoTitle, seoDescription, operationId };
}

// Which blanks, colors and sizes, checked against the catalog, and Shopify's variant limit.
function parseOffer(body, tpl) {
  const L = tpl.limits, catalog = tpl.catalog;
  const markup = body.markup == null ? 0 : typeof body.markup === "string" && body.markup.trim() !== "" ? Number(body.markup) : body.markup;
  if (typeof markup !== "number" || !Number.isFinite(markup) || markup < L.markupMin || markup > L.markupMax || !cents(markup))
    throw bad(`Markup must be a dollar amount from $${L.markupMin} to $${L.markupMax}, like 0, 5 or 2.50.`, "markup");

  const sizesIn = body.sizes ?? tpl.defaults.sizes;
  if (!Array.isArray(sizesIn) || !sizesIn.length || sizesIn.some((s) => !SIZES.includes(s)) || new Set(sizesIn).size !== sizesIn.length)
    throw bad(`Sizes must be one or more of ${SIZES.join(", ")}, each once.`, "sizes");
  const sizes = SIZES.filter((s) => sizesIn.includes(s));

  if (!Array.isArray(body.blanks) || !body.blanks.length || body.blanks.length > L.blanks)
    throw bad(`Pick 1 to ${L.blanks} blanks to offer.`, "blanks");
  const blanks = [], labels = new Set();
  for (const sel of body.blanks) {
    if (!sel || typeof sel !== "object" || Array.isArray(sel) || Object.keys(sel).some((k) => k !== "id" && k !== "colors"))
      throw bad("Each blank must be { id, colors }.", "blanks");
    const b = typeof sel.id === "string" ? catalog.blanks.find((x) => x.id === sel.id) : null;
    if (!b) throw bad(`No blank ${String(sel.id).slice(0, 40)} in the catalog.`, "blanks");
    if (blanks.some((x) => x.id === b.id)) throw bad(`${blankLabel(b)} is listed twice.`, "blanks");
    if (labels.has(blankLabel(b))) throw bad(`Two blanks share the name ${blankLabel(b)}.`, "blanks");
    labels.add(blankLabel(b));
    const names = b.colors.map((c) => c.name);
    if (!Array.isArray(sel.colors) || !sel.colors.length || new Set(sel.colors).size !== sel.colors.length)
      throw bad(`Pick at least one color for ${blankLabel(b)}, each once.`, "blanks");
    const unknown = sel.colors.filter((c) => !names.includes(c));
    if (unknown.length) throw bad(`${blankLabel(b)} doesn't come in ${String(unknown[0]).slice(0, 40)}.`, "blanks");
    if (!sizes.some((s) => b.sizes.includes(s))) throw bad(`${blankLabel(b)} comes in none of the chosen sizes.`, "sizes");
    blanks.push({ id: b.id, colors: names.filter((c) => sel.colors.includes(c)) });
  }
  const variants = variantsFor(catalog, { blanks, sizes, markup });
  if (variants.length > L.variants)
    throw new HttpError(400, "too_many_variants", `That's ${variants.length} variants; Shopify allows ${L.variants} per product. Offer fewer blanks, colors or sizes.`, { details: { field: "blanks", variants: variants.length } });
  const cheap = variants.find((v) => v.price < L.priceMin || v.price > L.priceMax);
  if (cheap) throw bad(`With that markup ${blankLabel(cheap.blank)} ${cheap.size} would be $${cheap.price.toFixed(2)}; prices must be $${L.priceMin} to $${L.priceMax}.`, "markup");
  return { blanks, sizes, markup, variants };
}

// ---------- the library ----------
// Reads an image through lib/images.mjs's own GET route, so the library's rules (key format,
// stored type) stay in one place. Returns { bytes, type } or null.
export function libraryReader({ blobs, env }) {
  return async (key) => {
    const res = await handleImages(new Request(`https://console.internal/api/images/${encodeURIComponent(key)}`), { blobs, env });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: (res.headers.get("content-type") ?? "").split(";")[0].trim() };
  };
}

// ---------- Shopify ----------
export const LISTING_LOOKUP_QUERY = `query ConsoleListingLookup($q: String!, $pub: ID!) {
  products(first: 5, query: $q) {
    nodes { id handle title status tags publishedOnPublication(publicationId: $pub) }
  }
}`;
export const STAGED_UPLOAD_MUTATION = `mutation ConsoleStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;
export const PRODUCT_SET_MUTATION = `mutation ConsoleListingCreate($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(input: $input, synchronous: $synchronous) {
    product { id handle title status }
    productSetOperation { id status }
    userErrors { field message code }
  }
}`;
export const PRODUCT_OPERATION_QUERY = `query ConsoleListingOperation($id: ID!) {
  productOperation(id: $id) {
    ... on ProductSetOperation {
      id status
      product { id handle title status }
      userErrors { field message code }
    }
  }
}`;

async function findListed(client, imageKey, pub) {
  const tag = designTag(imageKey);
  const d = await client.gql(LISTING_LOOKUP_QUERY, { q: `tag:"${tag}"`, pub });
  // Shopify's search is loose, so keep only an exact tag match.
  return d?.products?.nodes?.find((p) => (p.tags ?? []).includes(tag)) ?? null;
}

// The image bytes only ever go to Shopify's own upload storage (Google Cloud Storage today), over
// https, whatever the GraphQL answer says: never to another host the console could reach.
const safeUrl = (u) => { try { return new URL(u); } catch { return null; } };
export const stagingHost = (u) => !!u && u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443")
  && /(^|\.)(storage\.googleapis\.com|shopify\.com|shopifycdn\.com)$/i.test(u.hostname);

async function stageImage(client, fetchImpl, { bytes, type }, filename) {
  const s = await client.gql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename, mimeType: type, httpMethod: "POST", fileSize: String(bytes.byteLength) }] });
  userErrorsOrThrow(s.stagedUploadsCreate, "Shopify wouldn't take the image upload");
  const target = s.stagedUploadsCreate.stagedTargets?.[0];
  let url;
  try { url = new URL(target?.url); } catch { url = null; }
  if (!url || !stagingHost(url) || !stagingHost(safeUrl(target.resourceUrl)))
    throw new HttpError(502, "upload_failed", "Shopify didn't give an upload address for the image. Nothing was listed; try again.");
  const form = new FormData();
  for (const p of target.parameters ?? []) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type }), filename);
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, url.toString(), { method: "POST", body: form, redirect: "error" }, LISTING_TIMEOUT_MS);
  } catch (e) {
    throw new HttpError(e?.name === "AbortError" ? 504 : 502, "upload_failed", "The image upload to Shopify didn't finish. Nothing was listed; try again.");
  }
  if (!res.ok && res.status !== 201 && res.status !== 204)
    throw new HttpError(502, "upload_failed", `Shopify's file storage refused the image (HTTP ${res.status}). Nothing was listed; try again.`);
  return target.resourceUrl;
}

const money = (n) => n.toFixed(2);
const slug = (t) => t.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60) || "design";

export function productSetInput(input, resourceUrl, ext) {
  const uniq = (xs) => [...new Set(xs)];
  const v = input.variants;
  return {
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    vendor: VENDOR,
    productType: input.productType,
    status: "ACTIVE",
    tags: [...input.tags, designTag(input.imageKey)],
    seo: { title: input.seoTitle, description: input.seoDescription },
    productOptions: [
      { name: "Blank", position: 1, values: uniq(v.map((x) => blankLabel(x.blank))).map((name) => ({ name })) },
      { name: "Color", position: 2, values: uniq(v.map((x) => x.color)).map((name) => ({ name })) },
      { name: "Size", position: 3, values: SIZES.filter((s) => v.some((x) => x.size === s)).map((name) => ({ name })) },
    ],
    // Printed to order: stock isn't tracked, so every variant can always be bought.
    variants: v.map((x, i) => ({
      optionValues: [{ optionName: "Blank", name: blankLabel(x.blank) }, { optionName: "Color", name: x.color }, { optionName: "Size", name: x.size }],
      price: money(x.price),
      sku: sku(input.imageKey, x.blank.id, x.color, x.size),
      position: i + 1,
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false, requiresShipping: true },
      taxable: true,
    })),
    files: [{ originalSource: resourceUrl, contentType: "IMAGE", alt: input.title, filename: `${slug(input.title)}.${ext}` }],
  };
}

const links = (cfg, p) => ({ id: p.id, handle: p.handle, title: p.title, url: productUrl(cfg, p.handle), adminUrl: adminUrl(cfg, p.id) });

async function publish(client, id, pub) {
  const r = await client.gql(PUBLISH_MUTATION, { id, pub });
  userErrorsOrThrow(r.publishablePublish, "Couldn't publish to the Online Store");
}

export async function createListing(client, ctx, input) {
  const cfg = client.cfg;
  const pub = await client.onlineStorePublication();

  // A listing Shopify was still making when the last request had to answer: wait for that one.
  if (input.operationId) {
    const p = await waitForOperation(client, ctx, input.operationId);
    if (!p) return pending(cfg, input.operationId);
    return finish(client, ctx, p, pub);
  }

  const existing = await findListed(client, input.imageKey, pub);
  if (existing) {
    // Listed before. If it's off the site (or a retry after a failed publish), put it back on.
    let republished = false;
    if (existing.status !== "ACTIVE") {
      const u = await client.gql(ACTIVATE_MUTATION, { product: { id: existing.id, status: "ACTIVE" } });
      userErrorsOrThrow(u.productUpdate, "Couldn't make the existing listing active");
      republished = true;
    }
    if (existing.publishedOnPublication !== true) { await publish(client, existing.id, pub); republished = true; }
    const l = links(cfg, existing);
    const indexNow = republished ? await pingIndexNow(ctx.fetch, ctx.env, cfg, [l.url]) : { sent: false, reason: "already live" };
    return { status: 200, body: { store: "ed", alreadyListed: true, republished, live: true, product: l, url: l.url, adminUrl: l.adminUrl, indexNow,
      message: republished ? `This design was already listed as "${existing.title}". It's back on the site.` : `This design is already listed as "${existing.title}".` } };
  }

  const image = await ctx.readImage(input.imageKey);
  if (!image) throw new HttpError(404, "image_not_found", "That image isn't in the online library any more. Refresh the library and pick another.");
  const ext = PRODUCT_IMAGE_TYPES[image.type];
  if (!ext) throw new HttpError(415, "bad_image_type", "Shopify product photos must be PNG, JPEG, WebP or GIF. Export this design as a PNG, upload it, and list that.");

  const resourceUrl = await stageImage(client, ctx.fetch, image, `${slug(input.title)}.${ext}`);
  const synchronous = input.variants.length <= STANDARD_VARIANTS;
  const created = await client.gql(PRODUCT_SET_MUTATION, { input: productSetInput(input, resourceUrl, ext), synchronous });
  userErrorsOrThrow(created.productSet, "Shopify wouldn't create the product");
  let p = created.productSet.product;
  if (!synchronous) {
    const op = created.productSet.productSetOperation;
    if (!op?.id) throw new HttpError(502, "shopify_error", "Shopify didn't return the listing's progress.");
    p = await waitForOperation(client, ctx, op.id);
    if (!p) return pending(cfg, op.id);
  }
  return finish(client, ctx, p, pub);
}

// Polls an asynchronous productSet; the product when it's done, null if it's still going.
async function waitForOperation(client, ctx, id) {
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let waited = 0; ; waited += POLL_EVERY_MS) {
    const d = await client.gql(PRODUCT_OPERATION_QUERY, { id });
    const op = d?.productOperation;
    if (!op?.id) throw new HttpError(404, "not_found", "Shopify has no record of that listing in progress. Press List it again.");
    if (op.userErrors?.length) userErrorsOrThrow(op, "Shopify wouldn't create the product");
    if (op.status === "COMPLETE") {
      if (!op.product?.id) throw new HttpError(502, "shopify_error", "Shopify finished without a product.");
      return op.product;
    }
    if (waited + POLL_EVERY_MS > POLL_BUDGET_MS) return null;
    await sleep(POLL_EVERY_MS);
  }
}

const pending = (cfg, operationId) => ({ status: 202, body: { store: "ed", pending: true, operationId,
  message: `Shopify is still making this listing (it has a lot of variants). Press Check again in a moment to put it on ${new URL(cfg.site).host}.` } });

async function finish(client, ctx, p, pub) {
  const cfg = client.cfg;
  if (!p?.id) throw new HttpError(502, "shopify_error", "Shopify didn't return the new product.");
  const l = links(cfg, p);
  try {
    await publish(client, p.id, pub);
  } catch (e) {
    throw new HttpError(e.status ?? 502, "partly_listed",
      `The product was made in Shopify but isn't on the Online Store yet: ${String(e.message).replace(/^Couldn't publish to the Online Store:\s*/, "")} Press List it again to retry, or publish it in Shopify.`.slice(0, 500),
      { details: { product: l, ...(e.details ?? {}) } });
  }
  const indexNow = await pingIndexNow(ctx.fetch, ctx.env, cfg, [l.url]);
  return { status: 201, body: { store: "ed", alreadyListed: false, live: true, product: l, url: l.url, adminUrl: l.adminUrl, indexNow,
    message: `"${p.title}" is live on ${new URL(cfg.site).host}.` } };
}

// ---------- /api/listings ----------
export async function handleListings(req, ctx) {
  try {
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Listings");
      const store = parseStore(req.query.get("store"));
      if (store !== "ed") throw new HttpError(400, "wrong_store", "Listings are for Elevated Designs only.");
      return ok({ template: listingTemplate(ctx.env) });
    }
    if (req.method === "POST") {
      requireKey(req, ctx.env, "Listings");
      const tpl = listingTemplate(ctx.env);
      const input = parseListingInput(await readJsonBody(req, MAX_LISTING_BODY), tpl);
      const cfg = storeConfig(ctx.env, input.store);
      if (typeof ctx.readImage !== "function") throw new HttpError(503, "no_library", "The image library isn't available here.");
      const out = await createListing(adminClient(cfg, ctx.fetch, { timeoutMs: LISTING_TIMEOUT_MS }), ctx, input);
      return ok(out.body, out.status);
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
