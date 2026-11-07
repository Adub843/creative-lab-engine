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
//   MARKETING  Workers KV namespace holding each store's daily marketing scores and change log
//              (lib/marketing.mjs, lib/promotions.mjs), the Team task boards (lib/team.mjs) and the
//              agents' handoff board and manager brief (lib/handoffs.mjs)
// Secrets (set with `npx wrangler secret put NAME`, never in code): CONSOLE_KEY, the Shopify
// domains and tokens (C3D_*, ED_*), and optionally INDEXNOW_KEY, ED_HANDLING_DAYS, *_SITE_URL,
// MESHY_API_KEY (the 3D maker, lib/meshy.mjs). Variable (public): ED_CUSTOMER_CLIENT_ID (store sign-in
// for the shirt app, lib/members.mjs).
import { handleProducts, HttpError } from "../lib/shopify.mjs";
import { handleInsights } from "../lib/insights.mjs";
import { handleListings, libraryReader } from "../lib/listings.mjs";
import { handleImages } from "../lib/images.mjs";
import { handleMember } from "../lib/members.mjs";
import { handleFiles } from "../lib/files.mjs";
import { r2BlobStore, combinedStore } from "../lib/r2-store.mjs";
import { handleMeshy } from "../lib/meshy.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handlePricing, scheduledPricing } from "../lib/pricing.mjs";
import { handleMarketing, runScheduledAudits, runScheduledFixes } from "../lib/marketing.mjs";
import { handlePromotions } from "../lib/promotions.mjs";
import { handleTeam } from "../lib/team.mjs";
import { handleHandoffs } from "../lib/handoffs.mjs";
import { runScheduledSnapshots } from "../lib/tracker.mjs";
import { syncKittlLibrary, STATE_KEY as KITTL_STATE_KEY } from "../lib/kittl-sync.mjs";

// The app pages: only its own scripts, Shopify's CDN for product photos, never framed.
export const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://cdn.shopify.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// The tool apps in tools/ (Maker Studio and its makers, print trends) are single files with
// their own inline scripts, and run framed inside the console, so they get their own policy:
// same-origin framing only, no outside connections except the fonts and the web image search.
export const TOOL_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' blob: data: https://*.wikipedia.org https://commons.wikimedia.org https://upload.wikimedia.org; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "x-robots-tag": "noindex, nofollow",
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
const marketing = jsonRoute(handleMarketing);
const promotions = jsonRoute(handlePromotions);
const team = jsonRoute(handleTeam);
const handoffs = jsonRoute(handleHandoffs);
const marketingKv = (env) => (env?.MARKETING && typeof env.MARKETING.get === "function" ? env.MARKETING : null);

// Previews are small, so they stay in KV either way.
const fileStore = (env) => env.FILES
  ? combinedStore(r2BlobStore(env.FILES, "c3d-file/"), kvBlobStore(env.IMAGES, "c3d-file:"))
  : kvBlobStore(env.IMAGES, "c3d-file:");

export async function handleRequest(req, env) {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === "/api/products") return await products(req, env);
    if (pathname === "/api/insights") return await insights(req, env);
    if (pathname === "/api/marketing") return await marketing(req, env, { kv: marketingKv(env) });
    // Promotions log their changes in the Marketing change log, so they share its KV.
    if (pathname === "/api/promotions") return await promotions(req, env, { kv: marketingKv(env) });
    // The Team page's task board is small JSON, kept in the same KV under "team:<store>".
    if (pathname === "/api/team") return await team(req, env, { kv: marketingKv(env) });
    // The agents' handoff board and the manager run's brief, in the same KV under "handoffs".
    if (pathname === "/api/handoffs") return await handoffs(req, env, { kv: marketingKv(env) });
    if (pathname === "/api/listings") {
      // The design is read through the image library's own read route, from the same KV namespace.
      const readImage = async (key) => libraryReader({ blobs: imageStore(env), env: envReader(env) })(key);
      return await listings(req, env, { readImage });
    }
    if (pathname === "/api/pricing") return await pricing(req, env, { kv: env?.PRICING ?? null });
    // The last Kittl library sync (counts only), so a check doesn't need the console key.
    if (pathname === "/api/library-sync" && req.method === "GET") {
      const last = env?.IMAGES ? await env.IMAGES.get(KITTL_STATE_KEY, "json") : null;
      const { failed = [], ...rest } = last ?? {};
      // The first few reasons (a Kittl id and what went wrong, nothing private) say why images didn't copy.
      return json(last ? { ...rest, failed: failed.length, problems: failed.slice(0, 3) } : { ok: false, error: "No sync has run yet." }, 200);
    }
    if (pathname === "/api/member" || pathname === "/api/member/config")
      return await handleMember(req, { blobs: imageStore(env), env: envReader(env), fetch: (input, init) => fetch(input, init) });
    if (pathname === "/api/images" || pathname.startsWith("/api/images/"))
      return await handleImages(req, { blobs: imageStore(env), env: envReader(env) });
    // Charleston 3D's 3D files: in the FILES R2 bucket once it's bound (older ones stay readable in KV),
    // otherwise in the IMAGES KV namespace under their own prefix. Never in the image list.
    if (pathname === "/api/files" || pathname.startsWith("/api/files/")) {
      imageStore(env); // same binding check and message as the image library
      return await handleFiles(req, { blobs: fileStore(env), thumbs: kvBlobStore(env.IMAGES, "c3d-thumb:"), env: envReader(env) });
    }
    // The 3D maker: jobs under their own prefix; a model it keeps goes into the 3D file library above.
    if (pathname === "/api/meshy" || pathname.startsWith("/api/meshy/")) {
      imageStore(env);
      return await handleMeshy(req, { jobs: kvBlobStore(env.IMAGES, "c3d-meshy:"), files: fileStore(env), env: envReader(env), fetch: (input, init) => fetch(input, init) });
    }
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
  for (const [k, v] of Object.entries(pathname.startsWith("/tools/") ? TOOL_HEADERS : SITE_HEADERS)) out.headers.set(k, v);
  return out;
}

// The crons (wrangler.toml [triggers]): the daily site check for the Marketing page, half an hour
// later the rank snapshot and the automatic SEO fixes (a run of their own, so each gets the full subrequest allowance),
// and every 15 minutes one step of the shirt price sync (lib/pricing.mjs).
export const AUDIT_CRON = "0 11 * * *";
export const AUTOFIX_CRON = "30 11 * * *";
// Hourly, at :45: the image library follows Aaron's Kittl library (lib/kittl-sync.mjs).
export const KITTL_CRON = "45 * * * *";
export async function handleScheduled(env, cron) {
  if (!cron || cron === AUDIT_CRON) return runScheduledAudits(envReader(env), (input, init) => fetch(input, init), marketingKv(env));
  if (cron === AUTOFIX_CRON) {
    // Today's rank snapshot first (a few requests), then the fixes.
    await runScheduledSnapshots(envReader(env), (input, init) => fetch(input, init), marketingKv(env)).catch(() => null);
    return runScheduledFixes(envReader(env), (input, init) => fetch(input, init), marketingKv(env));
  }
  if (cron === KITTL_CRON) return scheduledKittlSync(env);
  try {
    return await scheduledPricing({ env: envReader(env), kv: env?.PRICING ?? null, fetchImpl: (input, init) => fetch(input, init) });
  } catch (e) {
    console.error("price sync", e?.code ?? e?.name, e?.message);
    return null;
  }
}

export async function scheduledKittlSync(env, fetchImpl = (input, init) => fetch(input, init)) {
  try {
    const result = await syncKittlLibrary({ blobs: imageStore(env), fetchImpl });
    await env.IMAGES.put(KITTL_STATE_KEY, JSON.stringify(result));
    return result;
  } catch (e) {
    console.error("kittl sync", e?.code ?? e?.name, e?.message);
    return null;
  }
}
