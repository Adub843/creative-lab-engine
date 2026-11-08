// Charleston 3D listings made from the console: Aaron ticks 3D items on the C3D page and the console
// sends each one here with the listing copy already written (title, description, price, tags, SEO)
// and its photos. Plain functions with no hosting code (see lib/shopify.mjs).
//
// POST /api/c3d-listings/photo   raw image bytes (image/png|jpeg|webp|gif), x-filename   key
//                                -> { resourceUrl }  (staged in Shopify's own upload storage)
// POST /api/c3d-listings/photos  { store: "c3d", ref, photos?: [{ resourceUrl (staged upload or Kittl image), alt }] }   key
//                                -> adds the staged photos (e.g. a lifestyle photo) to that item's product; answers its
//                                   photo links, so the console can use the first one as a reference for a new photo
// POST /api/c3d-listings         { store: "c3d", ref, title, descriptionHtml, price, tags, seoTitle,
//                                  seoDescription, productType, photos: [{ resourceUrl, alt }], live }  key
//
// One product per console item: it's tagged item:<ref>, so sending the same item twice never makes a
// second product (the first one is put back on the site instead). One variant, printed to order
// (stock not tracked). live: true puts it on the Online Store; false leaves it off the site, ready to
// post from the console's Post to site page. Charleston 3D only: never the Elevated Designs store.
import {
  HttpError, ok, fail, requireKey, storeConfig, adminClient, userErrorsOrThrow, readJsonBody,
  pingIndexNow, productUrl, adminUrl, PUBLISH_MUTATION, ACTIVATE_MUTATION,
} from "./shopify.mjs";
import { stageImage, stagingHost, LISTING_LOOKUP_QUERY, PRODUCT_SET_MUTATION } from "./listings.mjs";

export const C3D_VENDOR = "Charleston3D";
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_BODY = 48 * 1024;
const TIMEOUT_MS = 20000;
const REF = /^[A-Za-z0-9_-]{3,80}$/;
const PHOTO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const itemTag = (ref) => `item:${ref}`;

const bad = (message, field) => new HttpError(400, "bad_input", message, { details: { field } });
const str = (v, max, field, required = false) => {
  if (v == null || v === "") { if (required) throw bad(`${field} is required.`, field); return ""; }
  if (typeof v !== "string") throw bad(`${field} must be text.`, field);
  const t = v.trim();
  if (required && !t) throw bad(`${field} is required.`, field);
  if (t.length > max) throw bad(`${field} is longer than ${max} characters.`, field);
  return t;
};
// Listing copy is the store owner's own, but nothing that runs script goes on the store.
const scriptFree = (html) => !/<\s*(script|iframe|object|embed|style)\b|\son\w+\s*=|javascript:/i.test(html);

export function parseC3dListing(body) {
  const allowed = new Set(["store", "ref", "title", "descriptionHtml", "price", "tags", "seoTitle", "seoDescription", "productType", "photos", "live"]);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw bad(`Unexpected field: ${extra.slice(0, 3).join(", ")}.`, extra[0]);
  if (body.store !== "c3d") throw new HttpError(400, "wrong_store", "These listings are for Charleston 3D only.");
  if (typeof body.ref !== "string" || !REF.test(body.ref)) throw bad("ref must be the console item id (letters, digits, - or _).", "ref");
  const title = str(body.title, 255, "title", true);
  const descriptionHtml = str(body.descriptionHtml, 20000, "descriptionHtml", true);
  if (!scriptFree(descriptionHtml)) throw bad("The description can't contain scripts, frames or event handlers.", "descriptionHtml");
  const price = typeof body.price === "string" ? Number(body.price) : body.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 1 || price > 1000 || Math.round(price * 100) !== price * 100)
    throw bad("price must be a dollar amount from $1 to $1000, like 14.99.", "price");
  const tags = body.tags == null ? [] : body.tags;
  if (!Array.isArray(tags) || tags.length > 40 || tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 60))
    throw bad("tags must be up to 40 short words or phrases.", "tags");
  const photos = body.photos == null ? [] : body.photos;
  if (!Array.isArray(photos) || photos.length > 10) throw bad("Send up to 10 photos.", "photos");
  const files = photos.map((p, i) => {
    let u = null;
    try { u = new URL(p?.resourceUrl); } catch { /* checked below */ }
    if (!u || !stagingHost(u)) throw bad(`Photo ${i + 1} must be a staged Shopify upload (send it to /api/c3d-listings/photo first).`, "photos");
    return { resourceUrl: u.toString(), alt: str(p.alt, 500, "photo alt") || title };
  });
  if (typeof body.live !== "boolean") throw bad("live must be true or false.", "live");
  return {
    store: "c3d", ref: body.ref, title, descriptionHtml, price,
    tags: [...new Set(tags.map((t) => t.trim()))],
    seoTitle: str(body.seoTitle, 70, "seoTitle") || title.slice(0, 70),
    seoDescription: str(body.seoDescription, 320, "seoDescription"),
    productType: str(body.productType, 255, "productType") || "3D Print",
    photos: files, live: body.live,
  };
}

export function c3dProductSetInput(input) {
  return {
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    vendor: C3D_VENDOR,
    productType: input.productType,
    status: "ACTIVE",
    tags: [...new Set(["charleston3d", "3d-printed", "made-to-order", ...input.tags, itemTag(input.ref)])],
    // Sending both keeps Shopify from clearing the description (CLAUDE.md, known gotchas).
    seo: { title: input.seoTitle, description: input.seoDescription || input.title },
    productOptions: [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }],
    variants: [{
      optionValues: [{ optionName: "Title", name: "Default Title" }],
      price: input.price.toFixed(2),
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false, requiresShipping: true },
      taxable: true,
    }],
    files: input.photos.map((p) => ({ originalSource: p.resourceUrl, contentType: "IMAGE", alt: p.alt })),
  };
}

export const PRODUCT_PHOTOS_QUERY = `query ConsoleC3dPhotos($q: String!) {
  products(first: 5, query: $q) {
    nodes { id handle title tags media(first: 20) { nodes { ... on MediaImage { id status image { url } } } } }
  }
}`;
export const ADD_PHOTOS_MUTATION = `mutation ConsoleC3dAddPhotos($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) { product { id } userErrors { field message } }
}`;

export function parsePhotosBody(body) {
  const extra = Object.keys(body).filter((k) => !["store", "ref", "photos"].includes(k));
  if (extra.length) throw bad(`Unexpected field: ${extra.slice(0, 3).join(", ")}.`, extra[0]);
  if (body.store !== "c3d") throw new HttpError(400, "wrong_store", "These listings are for Charleston 3D only.");
  if (typeof body.ref !== "string" || !REF.test(body.ref)) throw bad("ref must be the console item id (letters, digits, - or _).", "ref");
  const photos = body.photos == null ? [] : body.photos;
  if (!Array.isArray(photos) || photos.length > 5) throw bad("Send up to 5 photos.", "photos");
  const files = photos.map((p, i) => {
    let u = null;
    try { u = new URL(p?.resourceUrl); } catch { /* checked below */ }
    // A staged upload, or a finished Kittl image (Shopify fetches it from Kittl's own storage).
    const kittl = u && u.protocol === "https:" && /(^|\.)kittl\.com$/i.test(u.hostname) && !u.username && !u.password && !u.port;
    if (!u || !(stagingHost(u) || kittl)) throw bad(`Photo ${i + 1} must be a staged Shopify upload or a Kittl image.`, "photos");
    return { resourceUrl: u.toString(), alt: str(p.alt, 500, "photo alt") };
  });
  return { ref: body.ref, photos: files };
}

export async function c3dPhotos(client, input) {
  const tag = itemTag(input.ref);
  const find = async () => (await client.gql(PRODUCT_PHOTOS_QUERY, { q: `tag:"${tag}"` }))?.products?.nodes?.find((p) => (p.tags ?? []).includes(tag)) ?? null;
  let p = await find();
  if (!p) throw new HttpError(404, "not_listed", "This item isn't on Shopify yet. List it first.");
  if (input.photos.length) {
    const r = await client.gql(ADD_PHOTOS_MUTATION, { product: { id: p.id },
      media: input.photos.map((x) => ({ originalSource: x.resourceUrl, mediaContentType: "IMAGE", alt: x.alt || p.title })) });
    userErrorsOrThrow(r.productUpdate, "Shopify wouldn't add the photo");
    p = await find() ?? p;
  }
  const images = (p.media?.nodes ?? []).map((m) => m?.image?.url).filter((u) => typeof u === "string" && u.startsWith("https://"));
  return { store: "c3d", ref: input.ref, productId: p.id, added: input.photos.length, images };
}

const links = (cfg, p) => ({ id: p.id, handle: p.handle, title: p.title, url: productUrl(cfg, p.handle), adminUrl: adminUrl(cfg, p.id) });

export async function createC3dListing(client, ctx, input) {
  const cfg = client.cfg;
  const pub = await client.onlineStorePublication();
  const tag = itemTag(input.ref);
  const found = await client.gql(LISTING_LOOKUP_QUERY, { q: `tag:"${tag}"`, pub });
  const existing = found?.products?.nodes?.find((p) => (p.tags ?? []).includes(tag)) ?? null;
  let product = existing, made = false;
  if (!existing) {
    const created = await client.gql(PRODUCT_SET_MUTATION, { input: c3dProductSetInput(input), synchronous: true });
    userErrorsOrThrow(created.productSet, "Shopify wouldn't create the product");
    product = created.productSet.product;
    if (!product?.id) throw new HttpError(502, "shopify_error", "Shopify didn't return the new product.");
    made = true;
  } else if (input.live && existing.status !== "ACTIVE") {
    const u = await client.gql(ACTIVATE_MUTATION, { product: { id: existing.id, status: "ACTIVE" } });
    userErrorsOrThrow(u.productUpdate, "Couldn't make the existing listing active");
  }
  const l = links(cfg, product);
  const onSite = existing ? existing.publishedOnPublication === true : false;
  let live = onSite, indexNow = { sent: false };
  if (input.live && !onSite) {
    try {
      const r = await client.gql(PUBLISH_MUTATION, { id: product.id, pub });
      userErrorsOrThrow(r.publishablePublish, "Couldn't publish to the Online Store");
      live = true;
    } catch (e) {
      throw new HttpError(e.status ?? 502, "partly_listed",
        `The product is in Shopify but isn't on charleston3d.com yet: ${String(e.message).replace(/^Couldn't publish to the Online Store:\s*/, "")} Post it from Post to site.`.slice(0, 500),
        { details: { product: l } });
    }
    indexNow = await pingIndexNow(ctx.fetch, ctx.env, cfg, [l.url]);
  }
  return { status: made ? 201 : 200, body: { store: "c3d", ref: input.ref, alreadyListed: !made, live, product: l, url: l.url, adminUrl: l.adminUrl, indexNow,
    message: made ? `"${product.title}" is ${live ? "live on charleston3d.com" : "in Shopify, off the site"}.` : `This item was already listed as "${product.title}".${live && !onSite ? " It's back on the site." : ""}` } };
}

// ---------- /api/c3d-listings ----------
// req.bytes() (photo upload only) reads the raw body, capped at MAX_PHOTO_BYTES.
export async function handleC3dListings(req, ctx, sub = "") {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
    requireKey(req, ctx.env, "Listings");
    const cfg = storeConfig(ctx.env, "c3d");
    const client = adminClient(cfg, ctx.fetch, { timeoutMs: TIMEOUT_MS });
    if (sub === "photo") {
      const type = (req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = PHOTO_TYPES[type];
      if (!ext) throw new HttpError(415, "bad_image_type", "Photos must be PNG, JPEG, WebP or GIF.");
      const bytes = await req.bytes();
      if (!bytes?.byteLength) throw new HttpError(400, "no_images", "The photo was empty.");
      const name = String(req.header("x-filename") ?? "photo").replace(/[^\w.-]+/g, "-").slice(0, 80).replace(/\.[a-z0-9]+$/i, "") || "photo";
      const resourceUrl = await stageImage(client, ctx.fetch, { bytes, type }, `${name}.${ext}`);
      return ok({ resourceUrl });
    }
    if (sub === "photos") return ok(await c3dPhotos(client, parsePhotosBody(await readJsonBody(req, MAX_BODY))));
    if (sub) throw new HttpError(404, "not_found", "Not found");
    const input = parseC3dListing(await readJsonBody(req, MAX_BODY));
    const out = await createC3dListing(client, ctx, input);
    return ok(out.body, out.status);
  } catch (e) {
    return fail(e);
  }
}
