// One-click listings for Elevated Designs: a design from the image library becomes a live T-shirt
// product on theelevateddesignsllc.com. Plain functions with no hosting code (see lib/shopify.mjs).
//
// GET  /api/listings?store=ed   the listing template defaults (price, sizes, handling days)   key
// POST /api/listings            { store: "ed", imageKey, title, price, ... } lists it          key
//
// Steps for a new listing: look for a product already tagged design:<imageKey> (so pressing
// List it twice never makes two products), read the image from the library, stage it with
// stagedUploadsCreate and POST it to the staged target, create the product with productSet
// (sizes as variants, inventory not tracked: printed to order), publish it to the Online Store,
// then ping IndexNow. Elevated Designs only: Charleston 3D products are made in Shopify.
import {
  HttpError, ok, fail, requireKey, parseStore, storeConfig, adminClient, userErrorsOrThrow,
  readJsonBody, pingIndexNow, productUrl, adminUrl, fetchWithTimeout, PUBLISH_MUTATION, ACTIVATE_MUTATION,
} from "./shopify.mjs";
import { handleImages } from "./images.mjs";

const MAX_LISTING_BODY = 32 * 1024;
const LISTING_TIMEOUT_MS = 15000; // productSet with media and a 6 MB upload take longer than a list
const IMAGE_KEY = /^[a-z0-9]{1,12}-[0-9a-f]{8}$/; // same shape lib/images.mjs gives new images
export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const PRODUCT_IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const VENDOR = "Elevated Designs";
export const designTag = (imageKey) => `design:${imageKey}`;

export function listingTemplate(env) {
  const days = (env("ED_HANDLING_DAYS") ?? "").trim();
  return {
    store: "ed",
    vendor: VENDOR,
    productType: "T-Shirt",
    price: 28,
    sizes: ["S", "M", "L", "XL", "2XL"],
    upcharges: { "2XL": 3 },
    handlingDays: /^\d{1,2}(-\d{1,2})?$/.test(days) ? days : "5-7",
    fabric: "Soft ring-spun cotton tee",
    tags: ["elevated-designs", "graphic-tee", "t-shirt", "printed-to-order"],
    limits: { title: 255, seoTitle: 60, seoDescription: 155, descriptionHtml: 20000, tags: 25, tag: 40, priceMin: 1, priceMax: 500 },
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
const UNSAFE_HTML = /<\s*\/?\s*(script|iframe|object|embed|style|form|input|button|link|meta|base|svg|math)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;

export function parseListingInput(body, tpl) {
  const allowed = new Set(["store", "imageKey", "title", "price", "sizes", "upcharges", "productType", "tags", "descriptionHtml", "seoTitle", "seoDescription"]);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw bad(`Unexpected field: ${extra.slice(0, 3).join(", ")}.`);
  const store = parseStore(body.store);
  if (store !== "ed") throw new HttpError(400, "wrong_store", "Listings are for Elevated Designs only. Charleston 3D products are made in Shopify, then switched on in Products.");
  if (typeof body.imageKey !== "string" || !IMAGE_KEY.test(body.imageKey))
    throw bad("imageKey must be the key of an image in the online library.", "imageKey");
  const L = tpl.limits;
  const title = str(body.title, "title", { min: 2, max: L.title, label: "Title" });

  const price = typeof body.price === "string" && body.price.trim() !== "" ? Number(body.price) : body.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < L.priceMin || price > L.priceMax || !cents(price))
    throw bad(`Price must be a dollar amount from $${L.priceMin} to $${L.priceMax}, like 28 or 28.50.`, "price");

  const sizesIn = body.sizes ?? tpl.sizes;
  if (!Array.isArray(sizesIn) || !sizesIn.length || sizesIn.some((s) => !SIZES.includes(s)) || new Set(sizesIn).size !== sizesIn.length)
    throw bad(`Sizes must be one or more of ${SIZES.join(", ")}, each once.`, "sizes");
  const sizes = SIZES.filter((s) => sizesIn.includes(s));

  const upIn = body.upcharges ?? tpl.upcharges;
  if (!upIn || typeof upIn !== "object" || Array.isArray(upIn)) throw bad("upcharges must be like { \"2XL\": 3 }.", "upcharges");
  const upcharges = {};
  for (const [k, v] of Object.entries(upIn)) {
    if (!SIZES.includes(k)) throw bad(`No size ${String(k).slice(0, 10)} for an upcharge.`, "upcharges");
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100 || !cents(v)) throw bad(`The ${k} upcharge must be $0 to $100.`, "upcharges");
    if (sizes.includes(k) && v > 0) upcharges[k] = v;
  }

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
  if (UNSAFE_HTML.test(descriptionHtml)) throw bad("The description can only use plain formatting (paragraphs, lists, bold, links); no scripts, forms or embeds.", "descriptionHtml");
  const seoTitle = str(body.seoTitle, "seoTitle", { max: L.seoTitle, label: "SEO title" });
  const seoDescription = str(body.seoDescription, "seoDescription", { min: 20, max: L.seoDescription, label: "SEO description" });

  return { store, imageKey: body.imageKey, title, price, sizes, upcharges, productType, tags, descriptionHtml, seoTitle, seoDescription };
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
export const PRODUCT_SET_MUTATION = `mutation ConsoleListingCreate($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle title status }
    userErrors { field message code }
  }
}`;

async function findListed(client, imageKey, pub) {
  const tag = designTag(imageKey);
  const d = await client.gql(LISTING_LOOKUP_QUERY, { q: `tag:"${tag}"`, pub });
  // Shopify's search is loose, so keep only an exact tag match.
  return d?.products?.nodes?.find((p) => (p.tags ?? []).includes(tag)) ?? null;
}

async function stageImage(client, fetchImpl, { bytes, type }, filename) {
  const s = await client.gql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename, mimeType: type, httpMethod: "POST", fileSize: String(bytes.byteLength) }] });
  userErrorsOrThrow(s.stagedUploadsCreate, "Shopify wouldn't take the image upload");
  const target = s.stagedUploadsCreate.stagedTargets?.[0];
  let url;
  try { url = new URL(target?.url); } catch { url = null; }
  if (!url || url.protocol !== "https:" || !target.resourceUrl)
    throw new HttpError(502, "upload_failed", "Shopify didn't give an upload address for the image. Nothing was listed; try again.");
  const form = new FormData();
  for (const p of target.parameters ?? []) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type }), filename);
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, url.toString(), { method: "POST", body: form }, LISTING_TIMEOUT_MS);
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
  return {
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    vendor: VENDOR,
    productType: input.productType,
    status: "ACTIVE",
    tags: [...input.tags, designTag(input.imageKey)],
    seo: { title: input.seoTitle, description: input.seoDescription },
    productOptions: [{ name: "Size", position: 1, values: input.sizes.map((name) => ({ name })) }],
    // Printed to order: stock isn't tracked, so every size can always be bought.
    variants: input.sizes.map((size, i) => ({
      optionValues: [{ optionName: "Size", name: size }],
      price: money(input.price + (input.upcharges[size] ?? 0)),
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
  const created = await client.gql(PRODUCT_SET_MUTATION, { input: productSetInput(input, resourceUrl, ext) });
  userErrorsOrThrow(created.productSet, "Shopify wouldn't create the product");
  const p = created.productSet.product;
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
