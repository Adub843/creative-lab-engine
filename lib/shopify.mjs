// Shopify Admin access for the console, written as plain functions with no hosting platform code.
// A handler takes a plain request ({ method, query, header(name), text() }) and a context
// ({ env(name), fetch, now }) and returns { status, body }. worker/app.mjs adapts these
// to the Cloudflare Worker; another host only needs its own small adapter like it.
import { createHash, timingSafeEqual } from "node:crypto";

export const API_VERSION = "2025-10";
const SHOPIFY_TIMEOUT_MS = 8000;
const INDEXNOW_TIMEOUT_MS = 3000;
const MAX_BODY_BYTES = 4096;
const MAX_PRODUCT_PAGES = 10; // 1,000 products

export const STORES = {
  c3d: { name: "Charleston 3D", prefix: "C3D", site: "https://charleston3d.com" },
  ed: { name: "Elevated Designs", prefix: "ED", site: "https://theelevateddesignsllc.com" },
};

// ---------- errors and responses ----------
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}
export const ok = (body, status = 200) => ({ status, body });
export const fail = (e) => {
  if (e instanceof HttpError) {
    const body = { error: e.message, code: e.code };
    if (e.details) body.details = e.details;
    return { status: e.status, body };
  }
  return { status: 500, body: { error: "Something went wrong in the console API.", code: "internal" } };
};

// Removes secrets from any text before it can reach a response or a log.
export const redact = (text, secrets) =>
  secrets.filter((s) => s && s.length >= 6).reduce((t, s) => t.split(s).join("[redacted]"), String(text));

// ---------- store config ----------
const MYSHOPIFY = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const PUBLIC_URL = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i;

export function parseStore(value) {
  if (typeof value !== "string" || !Object.hasOwn(STORES, value))
    throw new HttpError(400, "bad_store", `store must be one of: ${Object.keys(STORES).join(", ")}`);
  return value;
}

export function storeConfig(env, store) {
  const s = STORES[store];
  const domain = (env(`${s.prefix}_SHOPIFY_DOMAIN`) ?? "").trim().toLowerCase();
  // Either a fixed Admin API token (an existing admin-created custom app), or a Dev Dashboard
  // app's client ID and secret, which are swapped for a 24-hour token (client credentials grant).
  const token = (env(`${s.prefix}_ADMIN_TOKEN`) ?? "").trim();
  const clientId = (env(`${s.prefix}_CLIENT_ID`) ?? "").trim();
  const clientSecret = (env(`${s.prefix}_CLIENT_SECRET`) ?? "").trim();
  const missing = [];
  if (!domain) missing.push(`${s.prefix}_SHOPIFY_DOMAIN`);
  if (!token && !(clientId && clientSecret)) missing.push(clientId || clientSecret ? `${s.prefix}_CLIENT_ID and ${s.prefix}_CLIENT_SECRET` : `${s.prefix}_ADMIN_TOKEN`);
  if (missing.length)
    throw new HttpError(503, "not_connected", `${s.name} isn't connected yet. Set ${missing.join(" and ")} in the console's environment variables.`, { details: { missing } });
  if (!MYSHOPIFY.test(domain))
    throw new HttpError(503, "bad_config", `${s.prefix}_SHOPIFY_DOMAIN must be the store's .myshopify.com domain, e.g. your-store.myshopify.com.`);
  const site = (env(`${s.prefix}_SITE_URL`) ?? "").trim().replace(/\/+$/, "") || s.site;
  if (!PUBLIC_URL.test(site))
    throw new HttpError(503, "bad_config", `${s.prefix}_SITE_URL must look like https://example.com with no path.`);
  return { store, name: s.name, prefix: s.prefix, domain, token, clientId, clientSecret, site, shopHandle: domain.replace(/\.myshopify\.com$/, "") };
}

// ---------- access token ----------
const tokenCache = new Map(); // `${domain}|${clientId}` -> { token, expires }; lives as long as the function instance
export const clearTokenCache = () => tokenCache.clear();
async function accessToken(cfg, fetchImpl, timeoutMs) {
  if (cfg.token) return cfg.token;
  const key = `${cfg.domain}|${cfg.clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `https://${cfg.domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
    }, timeoutMs);
  } catch (e) {
    throw networkError(e, cfg);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string")
    throw new HttpError(502, "shopify_auth", `Shopify refused ${cfg.prefix}_CLIENT_ID / ${cfg.prefix}_CLIENT_SECRET (HTTP ${res.status}). Check them, and that the app is installed on the store.`);
  const ttl = Math.max(60, Number(body.expires_in) || 86399) - 300;
  tokenCache.set(key, { token: body.access_token, expires: Date.now() + ttl * 1000 });
  return body.access_token;
}

// ---------- console key ----------
const digest = (s) => createHash("sha256").update(String(s)).digest();
// There's no lockout on wrong guesses (serverless instances share no state), so a short key could
// be guessed: anything under MIN_KEY_LENGTH characters is treated as not set.
export const MIN_KEY_LENGTH = 16;
export function requireKey(req, env, what = "Changes") {
  const expected = env("CONSOLE_KEY") ?? "";
  if (!expected) throw new HttpError(403, "key_not_set", `${what} are turned off until CONSOLE_KEY is set in the console's environment variables.`);
  if (expected.length < MIN_KEY_LENGTH) throw new HttpError(403, "key_too_short", `${what} are turned off until CONSOLE_KEY is at least ${MIN_KEY_LENGTH} characters (a long random password).`);
  const given = req.header("x-console-key");
  if (!given || !timingSafeEqual(digest(given), digest(expected)))
    throw new HttpError(401, "bad_key", "Wrong or missing console key.");
}

// ---------- fetch with timeout ----------
export async function fetchWithTimeout(fetchImpl, url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const networkError = (e, cfg) => e?.name === "AbortError"
  ? new HttpError(504, "shopify_timeout", `${cfg.name}'s Shopify didn't answer in time. Try again.`)
  : new HttpError(502, "shopify_unreachable", `Couldn't reach ${cfg.name}'s Shopify.`);

// ---------- Admin GraphQL client ----------
export function adminClient(cfg, fetchImpl, { timeoutMs = SHOPIFY_TIMEOUT_MS } = {}) {
  const url = `https://${cfg.domain}/admin/api/${API_VERSION}/graphql.json`;
  let token = null;
  const clean = (t) => redact(t, [cfg.token, cfg.clientSecret, token]);
  async function gql(query, variables = {}) {
    token ??= await accessToken(cfg, fetchImpl, timeoutMs);
    let res;
    try {
      res = await fetchWithTimeout(fetchImpl, url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      }, timeoutMs);
    } catch (e) {
      throw networkError(e, cfg);
    }
    if (res.status === 401 || res.status === 403) {
      if (!cfg.token) tokenCache.delete(`${cfg.domain}|${cfg.clientId}`);
      throw new HttpError(502, "shopify_auth", `Shopify refused the ${cfg.token ? `${cfg.prefix}_ADMIN_TOKEN` : "app's access token"} (HTTP ${res.status}). Check the credentials and the app's access scopes.`);
    }
    if (res.status === 429) throw new HttpError(503, "shopify_throttled", "Shopify is rate limiting the console. Try again in a minute.");
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new HttpError(502, "shopify_error", `Shopify answered with HTTP ${res.status}.`);
    if (body.errors?.length) {
      const denied = body.errors.filter((e) => e?.extensions?.code === "ACCESS_DENIED");
      if (denied.length) {
        const scopes = [...new Set(denied.map((e) => scopeFrom(e)).filter(Boolean))];
        throw new HttpError(502, "access_denied", clean(`Shopify denied access${scopes.length ? `; add the ${scopes.join(", ")} scope` : ""}.`), { scopes, data: body.data });
      }
      if (body.errors.some((e) => e?.extensions?.code === "THROTTLED"))
        throw new HttpError(503, "shopify_throttled", "Shopify is rate limiting the console. Try again in a minute.");
      throw new HttpError(502, "shopify_error", clean(`Shopify: ${body.errors.map((e) => e?.message).filter(Boolean).join(" ").slice(0, 300)}`));
    }
    return body.data;
  }
  let pubPromise = null; // cached for the life of this client, i.e. one request
  return { gql, cfg, onlineStorePublication: () => (pubPromise ??= findOnlineStorePublication(gql, cfg)) };
}

function scopeFrom(err) {
  const m = /`?(read|write)_[a-z_]+`?/.exec(`${err?.extensions?.requiredAccess ?? ""} ${err?.message ?? ""}`);
  return m ? m[0].replace(/`/g, "") : null;
}

export function userErrorsOrThrow(payload, what) {
  const errs = payload?.userErrors ?? [];
  if (errs.length)
    throw new HttpError(422, "shopify_rejected", `${what}: ${errs.map((e) => e.message).join(" ")}`.slice(0, 400),
      { details: { userErrors: errs.map((e) => ({ field: e.field ?? null, message: e.message })) } });
  if (!payload) throw new HttpError(502, "shopify_error", `${what}: Shopify returned nothing.`);
}

// ---------- Online Store publication ----------
// Publication has no channels field in Admin API 2025-10 (it arrived in a later version), so the
// Online Store publication is found by its app catalog, whose title is "Online Store".
export const PUBLICATIONS_QUERY = `query OnlineStorePublication {
  publications(first: 50, catalogType: APP) {
    nodes { id catalog { title } }
  }
}`;

async function findOnlineStorePublication(gql, cfg) {
  let data;
  try { data = await gql(PUBLICATIONS_QUERY); }
  catch (e) {
    if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_publications scope so the console can find the Online Store channel.", { scopes: ["read_publications"] });
    throw e;
  }
  const isOnline = (p) => p.catalog?.title?.trim().toLowerCase() === "online store";
  const pub = data?.publications?.nodes?.find(isOnline);
  if (!pub) throw new HttpError(502, "no_online_store", `${cfg.name} has no Online Store sales channel the app can see. Add the Online Store channel and the read_publications scope.`);
  return pub.id;
}

// ---------- products ----------
// Fields shapeProduct() reads; $pub is the Online Store publication id.
const PRODUCT_FIELDS = `id handle title status productType tags updatedAt totalInventory tracksInventory
  featuredMedia { preview { image { url altText } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  publishedOnPublication(publicationId: $pub)`;
export const PRODUCTS_QUERY = `query ConsoleProducts($cursor: String, $pub: ID!) {
  products(first: 100, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { ${PRODUCT_FIELDS} }
  }
}`;

const numericId = (gid) => gid.split("/").pop();
export const productUrl = (cfg, handle) => `${cfg.site}/products/${encodeURIComponent(handle)}`;
export const adminUrl = (cfg, gid) => `https://admin.shopify.com/store/${cfg.shopHandle}/products/${numericId(gid)}`;

// Charleston 3D only: the theme shows the "Name to print" field on products with this tag.
// The theme (snippets/personalized-check.liquid) also honours the older "personalized" and
// "personalised" tags, so they count as on here too and switching off removes them as well.
export const CUSTOMIZABLE_TAG = "customizable";
const CUSTOMIZABLE_TAGS = new Set([CUSTOMIZABLE_TAG, "personalized", "personalised"]);
const isCustomizableTag = (t) => CUSTOMIZABLE_TAGS.has(String(t).trim().toLowerCase());
const isCustomizable = (tags) => Array.isArray(tags) && tags.some(isCustomizableTag);

export function shapeProduct(cfg, p) {
  const live = p.status === "ACTIVE" && p.publishedOnPublication === true;
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    type: p.productType || "",
    status: p.status,
    live,
    url: productUrl(cfg, p.handle),
    adminUrl: adminUrl(cfg, p.id),
    image: p.featuredMedia?.preview?.image?.url ?? null,
    price: p.priceRangeV2 ? Number(p.priceRangeV2.minVariantPrice.amount) : null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? "USD",
    inventory: p.tracksInventory ? p.totalInventory : null,
    updatedAt: p.updatedAt,
    ...(cfg.store === "c3d" ? { customizable: isCustomizable(p.tags) } : {}),
  };
}

export async function listProducts(client) {
  const pub = await client.onlineStorePublication();
  const out = [];
  let cursor = null, pages = 0, truncated = false;
  do {
    const d = await client.gql(PRODUCTS_QUERY, { cursor, pub });
    for (const p of d.products.nodes) out.push(shapeProduct(client.cfg, p));
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    if (cursor && ++pages >= MAX_PRODUCT_PAGES) { truncated = true; cursor = null; }
  } while (cursor);
  return { products: out, truncated };
}

export const PRODUCT_QUERY = `query ConsoleProduct($id: ID!, $pub: ID!) {
  product(id: $id) { ${PRODUCT_FIELDS} }
}`;
export const ACTIVATE_MUTATION = `mutation ConsoleActivate($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id status } userErrors { field message } }
}`;
export const PUBLISH_MUTATION = `mutation ConsolePublish($id: ID!, $pub: ID!) {
  publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { field message } }
}`;
export const UNPUBLISH_MUTATION = `mutation ConsoleUnpublish($id: ID!, $pub: ID!) {
  publishableUnpublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { field message } }
}`;

export async function setLive(client, id, live) {
  const pub = await client.onlineStorePublication();
  const found = await client.gql(PRODUCT_QUERY, { id, pub });
  if (!found?.product) throw new HttpError(404, "not_found", `No product ${id} in ${client.cfg.name}.`);
  if (live) {
    let activated = false;
    if (found.product.status !== "ACTIVE") {
      const u = await client.gql(ACTIVATE_MUTATION, { product: { id, status: "ACTIVE" } });
      userErrorsOrThrow(u.productUpdate, "Couldn't make the product active");
      activated = true;
    }
    try {
      const p = await client.gql(PUBLISH_MUTATION, { id, pub });
      userErrorsOrThrow(p.publishablePublish, "Couldn't publish to the Online Store");
    } catch (e) {
      if (!activated) throw e;
      // The status change went through but publishing didn't: send back what Shopify now has, so
      // the console shows Active (not on the site) instead of rolling back to Draft.
      throw await afterPartialPublish(client, id, pub, e);
    }
  } else {
    const p = await client.gql(UNPUBLISH_MUTATION, { id, pub });
    userErrorsOrThrow(p.publishableUnpublish, "Couldn't take the product off the Online Store");
  }
  return shapeProduct(client.cfg, { ...found.product, status: live ? "ACTIVE" : found.product.status, publishedOnPublication: live });
}

async function afterPartialPublish(client, id, pub, cause) {
  let product = null;
  try {
    const again = await client.gql(PRODUCT_QUERY, { id, pub });
    if (again?.product) product = shapeProduct(client.cfg, again.product);
  } catch { /* keep the original error */ }
  const reason = String(cause?.message ?? "").replace(/^Couldn't publish to the Online Store:\s*/, "");
  return new HttpError(cause?.status ?? 502, "partly_published",
    `It's now Active in Shopify, but it isn't on the Online Store yet: ${reason || "Shopify didn't say why."} Try the switch again, or publish it in Shopify.`.slice(0, 500),
    { details: { ...(cause?.details ?? {}), ...(product ? { product } : {}) } });
}

// ---------- customizable (Charleston 3D) ----------
export const PRODUCT_TAGS_QUERY = `query ConsoleProductTags($id: ID!) {
  product(id: $id) { id tags }
}`;
export const TAGS_ADD_MUTATION = `mutation ConsoleTagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;
export const TAGS_REMOVE_MUTATION = `mutation ConsoleTagsRemove($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

export async function setCustomizable(client, id, on) {
  if (client.cfg.store !== "c3d") throw new HttpError(400, "wrong_store", "Customizable is a Charleston 3D setting; Elevated Designs products don't use it.");
  const found = await client.gql(PRODUCT_TAGS_QUERY, { id });
  if (!found?.product) throw new HttpError(404, "not_found", `No product ${id} in ${client.cfg.name}.`);
  const tags = found.product.tags ?? [];
  if (on && !isCustomizable(tags)) {
    const r = await client.gql(TAGS_ADD_MUTATION, { id, tags: [CUSTOMIZABLE_TAG] });
    userErrorsOrThrow(r.tagsAdd, "Couldn't add the customizable tag");
  }
  if (!on) {
    // Remove every tag the theme matches (any case, older spellings too) so it stops asking for a name.
    const spellings = tags.filter(isCustomizableTag);
    if (spellings.length) {
      const r = await client.gql(TAGS_REMOVE_MUTATION, { id, tags: spellings });
      userErrorsOrThrow(r.tagsRemove, "Couldn't remove the customizable tag");
    }
  }
  const pub = await client.onlineStorePublication();
  const now = await client.gql(PRODUCT_QUERY, { id, pub });
  if (!now?.product) throw new HttpError(404, "not_found", `No product ${id} in ${client.cfg.name}.`);
  // Shopify's tag index can lag a moment behind the mutation, so report the state just set.
  const rest = (now.product.tags ?? []).filter((t) => !isCustomizableTag(t));
  return shapeProduct(client.cfg, { ...now.product, tags: on ? [...rest, CUSTOMIZABLE_TAG] : rest });
}

// ---------- IndexNow ----------
// Tells Bing, Yandex and other IndexNow engines that a URL changed. Never throws.
// The key must sit at the site root to cover /products/... URLs (a key under /pages/ only covers
// /pages/...). Shopify can't serve a root file, so each store has a page (handle indexnow-key,
// template page.indexnow) that prints the key and a URL redirect from /<key>.txt to that page.
export const indexNowKeyLocation = (site, key) => `${site}/${key}.txt`;
export async function pingIndexNow(fetchImpl, env, cfg, urls) {
  const key = (env("INDEXNOW_KEY") ?? "").trim();
  if (!key) return { sent: false, reason: "INDEXNOW_KEY not set" };
  try {
    const res = await fetchWithTimeout(fetchImpl, "https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(cfg.site).host, key, keyLocation: indexNowKeyLocation(cfg.site, key), urlList: urls }),
    }, INDEXNOW_TIMEOUT_MS);
    return { sent: res.ok || res.status === 202, status: res.status };
  } catch {
    return { sent: false, reason: "IndexNow didn't answer" };
  }
}

// ---------- request body ----------
export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const type = (req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "bad_content_type", "Send JSON with content-type: application/json.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Request body is too large.");
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, "bad_json", "Request body isn't valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_input", "Send a JSON object.");
  return body;
}

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d{0,19}$/;
// { store, id, live } puts a product on or off the site; { store: "c3d", id, customizable } sets
// whether the Charleston 3D theme asks for a name to print. One change per request.
export function parsePublishInput(body) {
  const allowed = new Set(["store", "id", "live", "customizable"]);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw new HttpError(400, "bad_input", `Unexpected field: ${extra.slice(0, 3).join(", ")}. Send { store, id, live } or { store, id, customizable }.`);
  const store = parseStore(body.store);
  if (typeof body.id !== "string" || !PRODUCT_GID.test(body.id))
    throw new HttpError(400, "bad_input", "id must be a product id like gid://shopify/Product/123.");
  const hasLive = Object.hasOwn(body, "live"), hasCustom = Object.hasOwn(body, "customizable");
  if (hasLive === hasCustom) throw new HttpError(400, "bad_input", "Send either live or customizable (true or false), not both.");
  if (hasCustom) {
    if (typeof body.customizable !== "boolean") throw new HttpError(400, "bad_input", "customizable must be true or false.");
    if (store !== "c3d") throw new HttpError(400, "wrong_store", "Customizable is a Charleston 3D setting; Elevated Designs products don't use it.");
    return { store, id: body.id, customizable: body.customizable };
  }
  if (typeof body.live !== "boolean") throw new HttpError(400, "bad_input", "live must be true or false.");
  return { store, id: body.id, live: body.live };
}

// ---------- /api/products ----------
export async function handleProducts(req, ctx) {
  try {
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Product lists");
      const store = parseStore(req.query.get("store"));
      const cfg = storeConfig(ctx.env, store);
      const { products, truncated } = await listProducts(adminClient(cfg, ctx.fetch));
      return ok({ store, site: cfg.site, products, truncated });
    }
    if (req.method === "POST") {
      requireKey(req, ctx.env);
      const input = parsePublishInput(await readJsonBody(req));
      const cfg = storeConfig(ctx.env, input.store);
      if ("customizable" in input) {
        const product = await setCustomizable(adminClient(cfg, ctx.fetch), input.id, input.customizable);
        return ok({ store: input.store, id: product.id, customizable: product.customizable, product });
      }
      const product = await setLive(adminClient(cfg, ctx.fetch), input.id, input.live);
      const indexNow = await pingIndexNow(ctx.fetch, ctx.env, cfg, [product.url]);
      return ok({ store: input.store, id: product.id, live: product.live, url: product.url, product, indexNow });
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
