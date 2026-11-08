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
//              (lib/marketing.mjs, lib/promotions.mjs) and the Team task boards (lib/team.mjs)
// Secrets (set with `npx wrangler secret put NAME`, never in code): CONSOLE_KEY, the Shopify
// domains and tokens (C3D_*, ED_*), and optionally INDEXNOW_KEY, ED_HANDLING_DAYS, *_SITE_URL,
// MESHY_API_KEY (the 3D maker, lib/meshy.mjs). Variable (public): ED_CUSTOMER_CLIENT_ID (store sign-in
// for the shirt app, lib/members.mjs).
import { handleProducts, HttpError, requireKey } from "../lib/shopify.mjs";
import { handleInsights } from "../lib/insights.mjs";
import { handleListings, libraryReader } from "../lib/listings.mjs";
import { handleC3dListings, MAX_PHOTO_BYTES } from "../lib/c3d-listings.mjs";
import { handleImages, refreshPublicSnapshot, renewPublicSnapshot } from "../lib/images.mjs";
import { handleMember } from "../lib/members.mjs";
import { handleFiles } from "../lib/files.mjs";
import { r2BlobStore, combinedStore } from "../lib/r2-store.mjs";
import { handleMeshy } from "../lib/meshy.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handlePricing, scheduledPricing } from "../lib/pricing.mjs";
import { handleMarketing, runScheduledAudits, runScheduledFixes } from "../lib/marketing.mjs";
import { handlePromotions } from "../lib/promotions.mjs";
import { handleTeam } from "../lib/team.mjs";
import { handlePicture } from "../lib/picture.mjs";
import { runScheduledSnapshots } from "../lib/tracker.mjs";
import { syncKittlLibrary, STATE_KEY as KITTL_STATE_KEY, SYNC_DEBOUNCE_MS } from "../lib/kittl-sync.mjs";
import { buildDigest, saveDigest, digestKey, isDigestDate, DIGEST_LATEST } from "../lib/digest.mjs";
import { handleScorecard } from "../lib/scorecard.mjs";

// The app pages: only its own scripts, Shopify's CDN for product photos, never framed.
export const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://cdn.shopify.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// The tool apps in tools/ (nameplate maker, hype chain maker, print trends) are single files with
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
const scorecard = jsonRoute(handleScorecard);
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
    if (pathname === "/api/listings") {
      // The design is read through the image library's own read route, from the same KV namespace.
      const readImage = async (key) => libraryReader({ blobs: imageStore(env), env: envReader(env) })(key);
      return await listings(req, env, { readImage });
    }
    // Charleston 3D listings from the console's 3D files picker: photos first (raw bytes), then the listing.
    if (pathname === "/api/c3d-listings" || pathname === "/api/c3d-listings/photo" || pathname === "/api/c3d-listings/photos") {
      const url = new URL(req.url);
      const out = await handleC3dListings({
        method: req.method, query: url.searchParams, header: (k) => req.headers.get(k),
        text: () => readTextCapped(req, MAX_JSON_BYTES),
        bytes: async () => {
          if (Number(req.headers.get("content-length")) > MAX_PHOTO_BYTES) throw new HttpError(413, "too_large", "The photo is larger than 20 MB.");
          const buf = new Uint8Array(await req.arrayBuffer());
          if (buf.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, "too_large", "The photo is larger than 20 MB.");
          return buf;
        },
      }, { env: envReader(env), fetch: (input, init) => fetch(input, init) }, pathname.slice("/api/c3d-listings/".length));
      return json(out.body, out.status);
    }
    // The marketing scorecard (lib/scorecard.mjs): ad spend and limits come from small JSON files in the RESULTS bucket.
    if (pathname === "/api/scorecard") return await scorecard(req, env, { bucket: env?.RESULTS && typeof env.RESULTS.get === "function" ? env.RESULTS : null });
    if (pathname === "/api/pricing") return await pricing(req, env, { kv: env?.PRICING ?? null });
    // A Shopify product picture for the console (it can't load pictures from other sites itself).
    if (pathname === "/api/picture") {
      const url = new URL(req.url);
      return await handlePicture({ method: req.method, query: url.searchParams, header: (k) => req.headers.get(k) }, { env: envReader(env), fetch: (input, init) => fetch(input, init) });
    }
    // The last Kittl library sync (counts only), so a check doesn't need the console key.
    // POST (console key) is the console's "Sync now": the sync runs at once and answers with the same counts.
    // The library is shared by the Elevated Designs shirt apps, so a ?store= is ignored.
    if (pathname === "/api/library-sync") {
      if (req.method === "GET") {
        const last = env?.IMAGES ? await env.IMAGES.get(KITTL_STATE_KEY, "json") : null;
        return json(last ? syncStatus(last) : { ok: false, error: "No sync has run yet." }, 200);
      }
      if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
      requireKey({ header: (k) => req.headers.get(k) }, envReader(env), "Sync now");
      imageStore(env);
      const out = await librarySyncNow(env);
      return json(out ? syncStatus(out) : { ok: false, error: "The library sync failed; see the Worker's logs." }, out ? 200 : 502);
    }
    // The daily digest (lib/digest.mjs), written by the 11:30 UTC cron. ?date=YYYY-MM-DD reads an earlier day.
    if (pathname === "/api/digest") {
      if (req.method !== "GET") return json({ error: "Use GET." }, 405);
      requireKey({ header: (k) => req.headers.get(k) }, envReader(env), "The daily digest");
      if (!env?.RESULTS || typeof env.RESULTS.get !== "function") throw new HttpError(503, "storage_not_set_up", "The digest isn't set up yet: add the RESULTS R2 bucket binding.");
      const date = new URL(req.url).searchParams.get("date");
      if (date && !isDigestDate(date)) throw new HttpError(400, "bad_input", "date must look like 2026-11-08.");
      const obj = await env.RESULTS.get(date ? digestKey(date) : DIGEST_LATEST);
      if (!obj) return json({ error: date ? `No digest for ${date}.` : "No digest yet: the first one is written at 11:30 UTC." }, 404);
      return new Response(await obj.arrayBuffer(), { status: 200, headers: API_HEADERS });
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
  // The engine has no pages of its own: with CONSOLE_PAGE set, anything that isn't /api/ or a tool
  // goes to the Creative Lab Studios console instead.
  if (env?.CONSOLE_PAGE && !pathname.startsWith("/tools/")) return Response.redirect(String(env.CONSOLE_PAGE), 302);
  // Everything else is one of the app's files.
  if (!env?.ASSETS) return new Response("Not found", { status: 404, headers: SITE_HEADERS });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(pathname.startsWith("/tools/") ? TOOL_HEADERS : SITE_HEADERS)) out.headers.set(k, v);
  return out;
}

// The crons (wrangler.toml [triggers]): the daily site check for the Marketing page, half an hour
// later the rank snapshot, the automatic SEO fixes and the daily digest (a run of their own, so each gets the full
// subrequest allowance), and every 15 minutes one step of the shirt price sync (lib/pricing.mjs).
export const AUDIT_CRON = "0 11 * * *";
export const AUTOFIX_CRON = "30 11 * * *";
// Hourly at :45 (the account has no free cron slot for a separate nightly one, so this cron does both jobs):
// - the 04:45 UTC run is the nightly Kittl library sync (lib/kittl-sync.mjs), after the 11:30 PM Eastern task
//   publishes kittl.json. 04:45 UTC is 11:45 PM Eastern in standard time and 12:45 AM during daylight time.
//   The sync saves a fresh public list itself.
// - every other hour is upkeep only: the shirt apps' saved public list is renewed when it's missing or near its
//   age limit. It never runs the Kittl sync.
// Every run also prunes old queue answers (worker/index.mjs).
export const UPKEEP_CRON = "45 * * * *";
export const KITTL_CRON = UPKEEP_CRON;
export const KITTL_HOUR_UTC = 4;
export const isKittlRun = (scheduledTime) => new Date(scheduledTime).getUTCHours() === KITTL_HOUR_UTC;
export async function handleScheduled(env, cron, scheduledTime = Date.now()) {
  if (!cron || cron === AUDIT_CRON) return runScheduledAudits(envReader(env), (input, init) => fetch(input, init), marketingKv(env));
  if (cron === AUTOFIX_CRON) {
    // Today's rank snapshot first (a few requests), then the fixes, then the digest that sums them up.
    await runScheduledSnapshots(envReader(env), (input, init) => fetch(input, init), marketingKv(env)).catch(() => null);
    const fixes = await runScheduledFixes(envReader(env), (input, init) => fetch(input, init), marketingKv(env));
    await scheduledDigest(env, fixes);
    return fixes;
  }
  if (cron === UPKEEP_CRON) return isKittlRun(scheduledTime) ? scheduledKittlSync(env, undefined, "nightly") : scheduledUpkeep(env);
  try {
    return await scheduledPricing({ env: envReader(env), kv: env?.PRICING ?? null, fetchImpl: (input, init) => fetch(input, init) });
  } catch (e) {
    console.error("price sync", e?.code ?? e?.name, e?.message);
    return null;
  }
}

// The /api/library-sync answer: counts, and the first few reasons (a Kittl id and what went wrong, nothing private)
// images didn't copy. stale: no sync in over a day and a bit, so the nightly run was missed.
export function syncStatus(last, now = Date.now()) {
  const { failed = [], ...rest } = last;
  const at = Date.parse(last.at ?? "");
  return { ...rest, failed: Array.isArray(failed) ? failed.length : Number(failed) || 0, problems: Array.isArray(failed) ? failed.slice(0, 3) : [],
    stale: !Number.isFinite(at) || now - at > 26 * 60 * 60 * 1000 };
}

export async function scheduledKittlSync(env, fetchImpl = (input, init) => fetch(input, init), trigger = "nightly") {
  try {
    const result = { ...(await syncKittlLibrary({ blobs: imageStore(env), fetchImpl })), trigger };
    await env.IMAGES.put(KITTL_STATE_KEY, JSON.stringify(result));
    // A fresh store, so its saved public list is rebuilt even when the sync itself dropped it.
    try { await refreshPublicSnapshot(imageStore(env)); } catch (e) { console.error("public list copy", e?.message); }
    return result;
  } catch (e) {
    console.error("kittl sync", e?.code ?? e?.name, e?.message);
    return null;
  }
}

// "Sync now": runs the sync (and saves a fresh public list) unless one ran in the last minute; then the last result
// is returned as it is, marked debounced, so repeated presses cost no extra KV writes or downloads.
export async function librarySyncNow(env, fetchImpl = (input, init) => fetch(input, init), now = Date.now()) {
  const last = await env.IMAGES.get(KITTL_STATE_KEY, "json").catch(() => null);
  const at = Date.parse(last?.at ?? "");
  if (last && Number.isFinite(at) && now - at >= 0 && now - at < SYNC_DEBOUNCE_MS) return { ...last, debounced: true };
  return scheduledKittlSync(env, fetchImpl, "manual");
}

// The hourly upkeep: renew the shirt apps' saved public list when needed (one KV read most hours).
export async function scheduledUpkeep(env) {
  try { return { snapshot: await renewPublicSnapshot(imageStore(env)) }; }
  catch (e) { console.error("public list copy", e?.message); return { snapshot: "failed" }; }
}

// The daily digest for Stacy (lib/digest.mjs), saved in the RESULTS bucket. A failure is logged and never stops the cron.
export async function scheduledDigest(env, autofix = null, { fetchImpl = (input, init) => fetch(input, init), now = new Date() } = {}) {
  if (!env?.RESULTS || typeof env.RESULTS.put !== "function") return null;
  try {
    const kv = (b) => (b && typeof b.get === "function" ? b : null);
    const digest = await buildDigest({ env: envReader(env), fetchImpl, marketingKv: marketingKv(env), pricingKv: kv(env.PRICING), imagesKv: kv(env.IMAGES), bucket: env.RESULTS, autofix, now });
    await saveDigest(env.RESULTS, digest, now);
    return digest;
  } catch (e) {
    console.error("daily digest", e?.code ?? e?.name, e?.message);
    return null;
  }
}
