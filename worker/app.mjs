// The whole console as one Cloudflare Worker: the app's files (index.html and assets/, copied into
// dist/ by scripts/build.mjs and served from the ASSETS binding) and the /api/* routes.
// worker/index.mjs is the entry point; it only exports the handler (Workers allow nothing else there).
// The API logic lives in lib/ as plain functions; this file only connects it to the Worker:
// Worker env bindings and secrets in, JSON Responses with security headers out.
//
// Bindings (see wrangler.toml and the README):
//   ASSETS   the static files in dist/
//   IMAGES   Workers KV namespace holding the image library (lib/kv-store.mjs)
//   PRICING  Workers KV namespace holding where the shirt price sync got to (lib/pricing.mjs)
// Secrets (set with `npx wrangler secret put NAME`, never in code): CONSOLE_KEY, the Shopify
// domains and tokens (C3D_*, ED_*), and optionally INDEXNOW_KEY, ED_HANDLING_DAYS, *_SITE_URL.
import { handleProducts, HttpError } from "../lib/shopify.mjs";
import { handleInsights } from "../lib/insights.mjs";
import { handleListings, libraryReader } from "../lib/listings.mjs";
import { handleImages } from "../lib/images.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handlePricing, scheduledPricing } from "../lib/pricing.mjs";

// The app pages: only its own scripts, Shopify's CDN for product photos, never framed.
export const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://cdn.shopify.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// API answers: JSON that is never sniffed, cached, framed or run as a page.
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
};
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: API_HEADERS });

// The largest JSON body any route accepts is a listing (32 KB); nothing bigger is read into memory.
export const MAX_JSON_BYTES = 64 * 1024;

// Secrets and vars arrive as strings on env; bindings (KV, ASSETS) are objects and never read as settings.
export const envReader = (env) => (k) => (typeof env?.[k] === "string" ? env[k] : undefined);

async function readTextCapped(req, max) {
  if (Number(req.headers.get("content-length")) > max) throw new HttpError(413, "too_large", "Request body is too large.");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw new HttpError(413, "too_large", "Request body is too large."); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Turns a Web Request into the plain request the handlers in lib/ expect, and their
// { status, body } back into a JSON Response.
export function jsonRoute(handler) {
  return async (req, env, extra = {}) => {
    const url = new URL(req.url);
    const out = await handler(
      { method: req.method, query: url.searchParams, header: (k) => req.headers.get(k), text: () => readTextCapped(req, MAX_JSON_BYTES) },
      // fetch is wrapped: Workers refuse a fetch called with another object as `this`.
      { env: envReader(env), fetch: (input, init) => fetch(input, init), ...extra },
    );
    return json(out.body, out.status);
  };
}

const imageStore = (env) => {
  if (!env?.IMAGES || typeof env.IMAGES.list !== "function")
    throw new HttpError(503, "storage_not_set_up", "The image library isn't set up yet: add the IMAGES KV namespace binding (see the README).");
  return kvBlobStore(env.IMAGES);
};

const products = jsonRoute(handleProducts);
const insights = jsonRoute(handleInsights);
const listings = jsonRoute(handleListings);
const pricing = jsonRoute(handlePricing);

export async function handleRequest(req, env) {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === "/api/products") return await products(req, env);
    if (pathname === "/api/insights") return await insights(req, env);
    if (pathname === "/api/listings") {
      // The design is read through the image library's own read route, from the same KV namespace.
      const readImage = async (key) => libraryReader({ blobs: imageStore(env), env: envReader(env) })(key);
      return await listings(req, env, { readImage });
    }
    if (pathname === "/api/pricing") return await pricing(req, env, { kv: env?.PRICING ?? null });
    if (pathname === "/api/images" || pathname.startsWith("/api/images/"))
      return await handleImages(req, { blobs: imageStore(env), env: envReader(env) });
    if (pathname === "/api" || pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("console api error", pathname, e?.name);
    return json({ error: "Something went wrong on the server." }, 500);
  }
  // Everything else is one of the app's files.
  if (!env?.ASSETS) return new Response("Not found", { status: 404, headers: SITE_HEADERS });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SITE_HEADERS)) out.headers.set(k, v);
  return out;
}

// The cron (wrangler.toml [triggers]): moves the shirt price sync one step on. See lib/pricing.mjs.
export async function handleScheduled(env) {
  try {
    await scheduledPricing({ env: envReader(env), kv: env?.PRICING ?? null, fetchImpl: (input, init) => fetch(input, init) });
  } catch (e) {
    console.error("price sync", e?.code ?? e?.name, e?.message);
  }
}
