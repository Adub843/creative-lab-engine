// The daily digest: one small JSON summary of both stores, written by the 11:30 UTC cron after the rank
// snapshot and the safe fixes, for Stacy and the Creative Lab Studios console (GET /api/digest).
//
// It lives in the RESULTS R2 bucket, not KV, so it costs none of the free plan's 1,000 KV writes a day:
//   digest/latest.json        the newest one
//   digest/YYYY-MM-DD.json    one per day, kept DIGEST_KEEP_DAYS days (pruneResults in worker/queue.mjs only
//                             prunes results/ and uploads/, so it never touches these)
//
// Each store is its own section (c3d, ed) and nothing is shared between them. The shirt price sync and the Kittl
// library sync belong to Elevated Designs, so they're in the ed section. Only scores, counts, product and page
// titles and error reasons go in: no secrets and no customer details.
import { STORES, adminClient, storeConfig } from "./shopify.mjs";
import { readHistory, readChanges, shopifyql, SITE_SESSIONS_Q, SITE_SALES_Q } from "./marketing.mjs";
import { readRanks, visibility } from "./tracker.mjs";
import { STATE_KEY as KITTL_STATE_KEY } from "./kittl-sync.mjs";

export const DIGEST_PREFIX = "digest/";
export const DIGEST_LATEST = `${DIGEST_PREFIX}latest.json`;
export const DIGEST_KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const PRICING_STATE_KEY = "pricing:state";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const reason = (e) => String(e?.message ?? e?.code ?? e ?? "failed").slice(0, 200);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const digestKey = (date) => `${DIGEST_PREFIX}${date}.json`;
export const isDigestDate = (d) => DATE.test(String(d ?? ""));

// Today's site check (the 11:00 cron) from the MARKETING history.
function siteCheck(history, today) {
  const last = history.at(-1);
  if (!last) return null;
  return { date: last.date, today: last.date === today, scores: last.scores ?? null, fails: last.fails ?? [], warns: last.warns ?? [] };
}

// Automatic changes and undos from the change log in the last 24 hours, plus what this morning's run reported.
function autofixSummary(changes, now, run) {
  const recent = changes.filter((c) => c.source === "auto" && now - Date.parse(c.at) < DAY);
  const undone = recent.filter((c) => c.kind === "revert");
  const made = recent.filter((c) => c.kind !== "revert");
  const brief = (c) => ({ kind: c.kind, title: String(c.title ?? "").slice(0, 120) });
  return { made: made.length, undone: undone.length, items: [...made, ...undone].slice(0, 10).map(brief), run: run ?? null };
}

// The newest rank snapshot: how many tracked searches sit in each band of Google results.
function rankSummary(ranks) {
  const last = ranks.at(-1);
  if (!last?.k) return null;
  const k = last.k;
  const keywords = Object.keys(k);
  const positions = keywords.map((kw) => k[kw]?.[0]).filter((p) => Number.isFinite(p));
  return {
    date: last.date, keywords: keywords.length, ...visibility(keywords, (kw) => (Number.isFinite(k[kw]?.[0]) ? k[kw][0] : null)),
    avgPosition: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
    clicks: keywords.reduce((n, kw) => n + num(k[kw]?.[1]), 0),
  };
}

// Sessions, orders and sales for the last 7 days from the store's own reports (ShopifyQL, read_reports scope).
export async function shopWeek(env, fetchImpl, store) {
  const client = adminClient(storeConfig(env, store), fetchImpl);
  const [sessions, sales] = await Promise.all([shopifyql(client, SITE_SESSIONS_Q(7)), shopifyql(client, SITE_SALES_Q(7))]);
  return {
    days: 7,
    sessions: sessions.reduce((n, r) => n + num(r.sessions), 0),
    orders: sales.reduce((n, r) => n + num(r.orders), 0),
    sales: Math.round(sales.reduce((n, r) => n + num(r.total_sales), 0) * 100) / 100,
  };
}

function pricingSummary(state) {
  if (!state) return null;
  const r = state.report;
  return {
    phase: state.phase ?? null, source: state.source ?? null, finishedAt: state.finishedAt ?? null,
    report: r ? { products: r.products ?? 0, variants: r.variants ?? 0, changed: r.changed ?? 0, unchanged: r.unchanged ?? 0, skipped: r.skipped ?? {}, markup: r.markup ?? null } : null,
    applied: state.applied ?? null, error: state.error ?? null, errorAt: state.errorAt ?? null,
  };
}

function librarySummary(s) {
  if (!s) return null;
  return {
    at: s.at ?? null, ok: s.ok === true, trigger: s.trigger ?? null, inKittl: s.inKittl ?? null, added: s.added ?? 0, removed: s.removed ?? 0,
    waiting: s.waiting ?? 0, failed: Array.isArray(s.failed) ? s.failed.length : num(s.failed), warning: s.warning ?? null, error: s.error ?? null,
  };
}

const safeGet = async (kv, key) => { if (!kv) return null; try { return await kv.get(key, "json"); } catch { return null; } };
const settle = async (p, fallback) => { try { return await p; } catch (e) { return fallback(e); } };

// Builds the digest. Every part is read on its own, so a missing binding, an empty history or a store that isn't
// connected only leaves that part empty (or an error string) and never stops the rest.
// autofix: the result runScheduledFixes returned this morning ({ c3d: {...}, ed: {...} }), when there is one.
export async function buildDigest({ env, fetchImpl, marketingKv = null, pricingKv = null, imagesKv = null, autofix = null, now = new Date(), week = shopWeek }) {
  const t = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const stores = {};
  await Promise.all(Object.keys(STORES).map(async (store) => {
    const [history, changes, ranks, shop] = await Promise.all([
      settle(readHistory(marketingKv, store), () => []),
      settle(readChanges(marketingKv, store), () => []),
      settle(readRanks(marketingKv, store), () => []),
      settle(week(env, fetchImpl, store), (e) => ({ error: reason(e) })),
    ]);
    stores[store] = {
      name: STORES[store].name,
      siteCheck: siteCheck(Array.isArray(history) ? history : [], today),
      autofix: autofixSummary(Array.isArray(changes) ? changes : [], t, autofix?.[store]),
      ranks: rankSummary(Array.isArray(ranks) ? ranks : []),
      shop,
    };
  }));
  // Elevated Designs only: the shirt price sync and the Kittl library behind its shirt apps.
  stores.ed.pricing = pricingSummary(await safeGet(pricingKv, PRICING_STATE_KEY));
  stores.ed.library = librarySummary(await safeGet(imagesKv, KITTL_STATE_KEY));
  return { date: today, generatedAt: now.toISOString(), stores: { c3d: stores.c3d, ed: stores.ed } };
}

// Saves the digest as latest.json and as that day's file, and removes day files older than DIGEST_KEEP_DAYS.
export async function saveDigest(bucket, digest, now = new Date()) {
  const body = JSON.stringify(digest);
  const opts = { httpMetadata: { contentType: "application/json" } };
  await bucket.put(digestKey(digest.date), body, opts);
  await bucket.put(DIGEST_LATEST, body, opts);
  const cutoff = new Date(now.getTime() - DIGEST_KEEP_DAYS * DAY).toISOString().slice(0, 10);
  const old = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: DIGEST_PREFIX, cursor });
    for (const o of page.objects) {
      const date = o.key.slice(DIGEST_PREFIX.length, -".json".length);
      if (isDigestDate(date) && date < cutoff) old.push(o.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (old.length) await bucket.delete(old);
  return { key: digestKey(digest.date), removed: old.length };
}
