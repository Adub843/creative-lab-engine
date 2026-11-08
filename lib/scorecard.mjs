// The marketing scorecard: how each UTM campaign (post or ad) did over the last 2 or 7 days, in plain code (no AI).
// GET /api/scorecard?store=c3d|ed&days=2|7 (console key). The 11:30 UTC digest carries each store's 7-day scorecard,
// and the AI jobs in ai-jobs/ (marketing-qa, weekly-marketing-decision) read it.
//
// Where the numbers come from (one store per call; the brands never share a request or a file):
//   visits, add-to-carts, checkouts  ShopifyQL sessions report grouped by utm_campaign/utm_source/utm_medium (read_reports)
//   orders and sales                  Admin API orders, credited to the campaign of the order's last visit, else its first
//                                     visit (read_orders). Without read_orders, orders fall back to completed checkouts.
//   cost                              optional R2 file ads/spend-<store>.json in the RESULTS bucket:
//                                       { "<utm_campaign>": { "dailyBudget": 2, "spendToDate": 9.5, "startDate": "2026-11-01" } }
//                                     startDate is optional. A campaign in this file is an ad (paid); any other is a free post.
//   limits                            optional R2 file config/marketing-limits.json: { "<store>": { "maxCostPerVisit": 0.5, "maxDailyBudget": 2 } }
//                                     Only this store's section is read. maxDailyBudget can lower the $2/day cap, never raise it.
//
// Cost in the window: dailyBudget x the days the ad ran inside the window, no more than spendToDate when that's given;
// with no dailyBudget, spendToDate is used as it is.
//
// Labels (each campaign is compared with the store's own average over the same days):
//   conversion = orders / visits. The store average is all orders / all visits (tagged and untagged).
//   loser    a pause is recommended (below), or at least MIN_VISITS visits and conversion <= LOSER_RATIO x the average,
//            or (when the store had no orders at all) an ad whose cost per visit is >= 1.5x the average ad cost per visit
//   winner   at least MIN_VISITS visits, at least one order and conversion >= WINNER_RATIO x the average,
//            or (when the store had no orders at all) an ad whose cost per visit is <= 0.75x the average ad cost per visit
//   average  everything else, including campaigns with fewer than MIN_VISITS visits (too early to call)
// Pause recommended (ads only):
//   no_visits      0 visits in the window and the ad has run at least 3 days
//   cost_per_visit cost per visit above the store's maxCostPerVisit (default $0.50)
// Cap (ads only): over_daily_cap when dailyBudget is above $2 (or the lower configured cap). The engine never changes
// a budget: it reports it, and the ad has to be lowered or paused by hand.
import { HttpError, adminClient, fail, ok, parseStore, requireKey, storeConfig } from "./shopify.mjs";
import { shopifyql } from "./marketing.mjs";

export const DAILY_CAP = 2;
export const DEFAULT_MAX_COST_PER_VISIT = 0.5;
export const MIN_VISITS = 10;
export const WINNER_RATIO = 1.25;
export const LOSER_RATIO = 0.5;
export const NO_VISIT_DAYS = 3;
export const ALLOWED_DAYS = [2, 7];
export const spendKey = (store) => `ads/spend-${store}.json`;
export const LIMITS_KEY = "config/marketing-limits.json";
const DAY = 86400000;
const MAX_ORDER_PAGES = 10;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
const dateKey = (t) => new Date(t).toISOString().slice(0, 10);
const norm = (s) => String(s ?? "").trim().toLowerCase();

export const campaignSessionsQ = (days) =>
  `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout GROUP BY utm_campaign, utm_source, utm_medium SINCE -${days - 1}d UNTIL today ORDER BY sessions DESC LIMIT 1000`;

export const SCORECARD_ORDERS_QUERY = `query ScorecardOrders($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt test cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customerJourneySummary {
        lastVisit { utmParameters { campaign source medium } }
        firstVisit { utmParameters { campaign source medium } }
      }
    }
  }
}`;

// The store's limits from the config file's section for this store, with the defaults and the hard $2 cap.
export function storeLimits(config, store) {
  const s = config && typeof config === "object" ? config[store] ?? {} : {};
  const maxCostPerVisit = Number(s.maxCostPerVisit) > 0 ? Number(s.maxCostPerVisit) : DEFAULT_MAX_COST_PER_VISIT;
  const maxDailyBudget = Number(s.maxDailyBudget) > 0 ? Math.min(Number(s.maxDailyBudget), DAILY_CAP) : DAILY_CAP;
  return { maxCostPerVisit, maxDailyBudget };
}

// Cost of one ad inside the window (see the top of the file).
export function windowCost(entry, { days, today }) {
  if (!entry) return 0;
  const budget = Number(entry.dailyBudget);
  const spent = entry.spendToDate == null ? null : num(entry.spendToDate);
  if (!(budget > 0)) return spent ?? 0;
  let active = days;
  if (entry.startDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.startDate)) {
    const ran = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.startDate}T00:00:00Z`)) / DAY) + 1;
    active = Math.max(0, Math.min(days, ran));
  }
  const cost = budget * active;
  return spent == null ? cost : Math.min(cost, spent);
}

// Days an ad has been running (startDate to today, counting both), or null when unknown.
function daysRunning(entry, today) {
  if (!entry?.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(entry.startDate)) return null;
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.startDate}T00:00:00Z`)) / DAY) + 1;
}

// Pure: turns ShopifyQL rows, order nodes and the spend file into the scorecard. Tested on fixtures.
//   sessionRows  [{ utm_campaign, utm_source, utm_medium, sessions, sessions_with_cart_additions, ... }] or null when unavailable
//   orderNodes   Admin API order nodes, or null when unavailable
//   spend        the parsed ads/spend-<store>.json, or null
//   limitsConfig the parsed config/marketing-limits.json, or null
export function buildScorecard({ store, days, sessionRows = null, orderNodes = null, spend = null, limitsConfig = null, now = new Date(), errors = {}, missingScopes = [] }) {
  const today = dateKey(now);
  const limits = storeLimits(limitsConfig, store);
  const spendMap = new Map();
  for (const [k, v] of Object.entries(spend && typeof spend === "object" ? spend : {})) if (norm(k) && v && typeof v === "object") spendMap.set(norm(k), { name: k, ...v });

  const byCampaign = new Map();
  const get = (name) => {
    const key = norm(name);
    if (!byCampaign.has(key)) byCampaign.set(key, { campaign: key, sources: new Map(), sessions: 0, cartAdds: 0, checkouts: 0, completedCheckouts: 0, orders: 0, sales: 0 });
    return byCampaign.get(key);
  };
  const totals = { sessions: 0, cartAdds: 0, checkouts: 0, completedCheckouts: 0, orders: 0, sales: 0 };

  for (const r of sessionRows ?? []) {
    const s = num(r.sessions), cart = num(r.sessions_with_cart_additions), co = num(r.sessions_that_reached_checkout), done = num(r.sessions_that_completed_checkout);
    totals.sessions += s; totals.cartAdds += cart; totals.checkouts += co; totals.completedCheckouts += done;
    if (!norm(r.utm_campaign)) continue; // untagged visits count toward the store average only
    const c = get(r.utm_campaign);
    c.sessions += s; c.cartAdds += cart; c.checkouts += co; c.completedCheckouts += done;
    const sk = `${norm(r.utm_source)}|${norm(r.utm_medium)}`;
    const src = c.sources.get(sk) ?? { source: norm(r.utm_source), medium: norm(r.utm_medium), sessions: 0 };
    src.sessions += s;
    c.sources.set(sk, src);
  }

  const ordersAvailable = Array.isArray(orderNodes);
  let currency = "USD";
  if (ordersAvailable) {
    for (const o of orderNodes) {
      if (o?.test || o?.cancelledAt) continue;
      const amount = num(o.currentTotalPriceSet?.shopMoney?.amount);
      currency = o.currentTotalPriceSet?.shopMoney?.currencyCode || currency;
      totals.orders += 1; totals.sales += amount;
      const j = o.customerJourneySummary;
      const name = j?.lastVisit?.utmParameters?.campaign || j?.firstVisit?.utmParameters?.campaign;
      if (!norm(name)) continue;
      const c = get(name);
      c.orders += 1; c.sales += amount;
    }
  } else {
    // No order access: completed checkouts stand in for orders, and sales are unknown.
    totals.orders = totals.completedCheckouts; totals.sales = null;
    for (const c of byCampaign.values()) { c.orders = c.completedCheckouts; c.sales = null; }
  }

  // Ads in the spend file that had no visits at all still get a row (that's how a dead ad shows up).
  for (const key of spendMap.keys()) get(key);

  const avgConversion = totals.sessions > 0 ? totals.orders / totals.sessions : 0;
  const rows = [...byCampaign.values()].map((c) => {
    const entry = spendMap.get(c.campaign) ?? null;
    const paid = !!entry;
    const cost = paid ? r2(windowCost(entry, { days, today })) : 0;
    return { ...c, entry, paid, cost, costPerVisit: paid && c.sessions > 0 ? r2(cost / c.sessions) : null, costPerOrder: paid && c.orders > 0 ? r2(cost / c.orders) : null };
  });
  const paidWithVisits = rows.filter((r) => r.paid && r.sessions > 0);
  const paidCost = paidWithVisits.reduce((a, r) => a + r.cost, 0);
  const paidVisits = paidWithVisits.reduce((a, r) => a + r.sessions, 0);
  const paidOrders = rows.filter((r) => r.paid).reduce((a, r) => a + r.orders, 0);
  const avgCostPerVisit = paidVisits > 0 ? paidCost / paidVisits : null;
  const avgCostPerOrder = paidOrders > 0 ? rows.filter((r) => r.paid).reduce((a, r) => a + r.cost, 0) / paidOrders : null;

  const campaigns = rows.map((r) => {
    const flags = [], reasons = [];
    let pause = false;
    if (r.paid) {
      const ran = daysRunning(r.entry, today);
      if (r.sessions === 0 && (ran ?? days) >= NO_VISIT_DAYS) { flags.push("no_visits"); reasons.push(`No visits after ${ran ?? days} days.`); pause = true; }
      if (r.costPerVisit != null && r.costPerVisit > limits.maxCostPerVisit) { flags.push("cost_per_visit"); reasons.push(`$${r.costPerVisit.toFixed(2)} a visit is over the $${limits.maxCostPerVisit.toFixed(2)} limit.`); pause = true; }
      if (Number(r.entry.dailyBudget) > limits.maxDailyBudget) { flags.push("over_daily_cap"); reasons.push(`$${Number(r.entry.dailyBudget).toFixed(2)}/day is over the $${limits.maxDailyBudget.toFixed(2)}/day cap: lower it.`); }
    }
    const conversion = r.sessions > 0 ? r.orders / r.sessions : 0;
    let label = "average";
    if (pause) label = "loser";
    else if (r.sessions < MIN_VISITS) reasons.push(`Only ${r.sessions} visits: too early to call.`);
    else if (avgConversion > 0) {
      const ratio = conversion / avgConversion;
      if (r.orders > 0 && ratio >= WINNER_RATIO) { label = "winner"; reasons.push(`Buys at ${ratio.toFixed(2)}x the store average.`); }
      else if (ratio <= LOSER_RATIO) { label = "loser"; reasons.push(`Buys at ${ratio.toFixed(2)}x the store average.`); }
    } else if (r.paid && r.costPerVisit != null && avgCostPerVisit) {
      if (r.costPerVisit <= 0.75 * avgCostPerVisit) { label = "winner"; reasons.push("Cheapest visits of the ads (no orders in the store yet)."); }
      else if (r.costPerVisit >= 1.5 * avgCostPerVisit) { label = "loser"; reasons.push("Dearest visits of the ads (no orders in the store yet)."); }
    }
    return {
      campaign: r.campaign, paid: r.paid, sources: [...r.sources.values()].sort((a, b) => b.sessions - a.sessions),
      sessions: r.sessions, cartAdds: r.cartAdds, checkouts: r.checkouts, orders: r.orders, sales: r.sales == null ? null : r2(r.sales),
      conversionRate: pctOf(r.orders, r.sessions), cost: r.paid ? r.cost : null, dailyBudget: r.paid && r.entry.dailyBudget != null ? num(r.entry.dailyBudget) : null,
      costPerVisit: r.costPerVisit, costPerOrder: r.costPerOrder, label, pauseRecommended: pause, flags, reasons,
    };
  }).sort((a, b) => b.sessions - a.sessions || a.campaign.localeCompare(b.campaign));

  return {
    store, days, since: dateKey(now.getTime() - (days - 1) * DAY), until: today, generatedAt: now.toISOString(), currency,
    limits, thresholds: { minVisits: MIN_VISITS, winnerRatio: WINNER_RATIO, loserRatio: LOSER_RATIO, noVisitDays: NO_VISIT_DAYS },
    totals: { ...totals, sales: totals.sales == null ? null : r2(totals.sales), conversionRate: pctOf(totals.orders, totals.sessions) },
    average: { conversionRate: pctOf(totals.orders, totals.sessions), costPerVisit: r2(avgCostPerVisit), costPerOrder: r2(avgCostPerOrder) },
    ordersSource: ordersAvailable ? "orders" : "completed_checkouts",
    campaigns,
    pauseRecommended: campaigns.filter((c) => c.pauseRecommended).map((c) => c.campaign),
    overCap: campaigns.filter((c) => c.flags.includes("over_daily_cap")).map((c) => c.campaign),
    errors, missingScopes,
  };
}

// Reads a small JSON file from the RESULTS bucket: null when it's missing, an error string when it's broken.
export async function readR2Json(bucket, key) {
  if (!bucket || typeof bucket.get !== "function") return { value: null };
  try {
    const obj = await bucket.get(key);
    if (!obj) return { value: null };
    return { value: JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) };
  } catch (e) {
    return { value: null, error: `${key} couldn't be read: ${e instanceof SyntaxError ? "it isn't valid JSON" : String(e?.message ?? e).slice(0, 120)}.` };
  }
}

async function fetchOrders(client, sinceDate) {
  const nodes = [];
  let cursor = null, pages = 0, truncated = false;
  do {
    const d = await client.gql(SCORECARD_ORDERS_QUERY, { cursor, q: `created_at:>=${sinceDate}` });
    nodes.push(...(d?.orders?.nodes ?? []));
    cursor = d?.orders?.pageInfo?.hasNextPage ? d.orders.pageInfo.endCursor : null;
    if (cursor && ++pages >= MAX_ORDER_PAGES) { truncated = true; cursor = null; }
  } while (cursor);
  return { nodes, truncated };
}

// Fetches everything for one store and builds the scorecard. Shopify failures never throw: they end up in errors
// (with the scope to add), so a missing read_reports or read_orders scope only empties that part.
export async function loadScorecard({ env, fetchImpl, bucket = null, store, days = 7, now = new Date() }) {
  const errors = {}, missingScopes = [];
  const [spendFile, limitsFile] = await Promise.all([readR2Json(bucket, spendKey(store)), readR2Json(bucket, LIMITS_KEY)]);
  if (spendFile.error) errors.spend = spendFile.error;
  if (limitsFile.error) errors.limits = limitsFile.error;
  let sessionRows = null, orderNodes = null;
  let client;
  try { client = adminClient(storeConfig(env, store), fetchImpl); }
  catch (e) { errors.shopify = e.message; }
  if (client) {
    const since = dateKey(now.getTime() - (days - 1) * DAY);
    const [s, o] = await Promise.allSettled([shopifyql(client, campaignSessionsQ(days)), fetchOrders(client, since)]);
    if (s.status === "fulfilled") sessionRows = s.value;
    else if (s.reason?.code === "access_denied") { errors.sessions = "Add the read_reports scope to this store's app to see visits by campaign."; missingScopes.push("read_reports"); }
    else errors.sessions = `Shopify couldn't run the visits report: ${String(s.reason?.message ?? s.reason).slice(0, 160)}`;
    if (o.status === "fulfilled") { orderNodes = o.value.nodes; if (o.value.truncated) errors.orders = "More orders than one read; the oldest in the window were left out."; }
    else if (o.reason?.code === "access_denied") { errors.orders = "Add the read_orders scope to credit orders and sales to campaigns; completed checkouts are used instead."; missingScopes.push("read_orders"); }
    else errors.orders = `Shopify couldn't list orders: ${String(o.reason?.message ?? o.reason).slice(0, 160)}`;
  }
  return buildScorecard({ store, days, sessionRows, orderNodes, spend: spendFile.value, limitsConfig: limitsFile.value, now, errors, missingScopes });
}

// The digest's copy: totals, flags and the top campaigns, so the digest stays small.
export function scorecardBrief(sc, top = 10) {
  if (!sc || sc.error) return sc ?? null;
  return { days: sc.days, since: sc.since, until: sc.until, totals: sc.totals, average: sc.average, ordersSource: sc.ordersSource,
    pauseRecommended: sc.pauseRecommended, overCap: sc.overCap, errors: sc.errors, missingScopes: sc.missingScopes,
    campaigns: sc.campaigns.slice(0, top).map(({ sources, ...c }) => c) };
}

// ---------- /api/scorecard ----------
export async function handleScorecard(req, ctx) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    requireKey(req, ctx.env, "The scorecard");
    const store = parseStore(req.query.get("store"));
    const days = Number(req.query.get("days") ?? "7");
    if (!ALLOWED_DAYS.includes(days)) throw new HttpError(400, "bad_input", "days must be 2 or 7.");
    return ok(await loadScorecard({ env: ctx.env, fetchImpl: ctx.fetch, bucket: ctx.bucket ?? null, store, days, now: ctx.now ? ctx.now() : new Date() }));
  } catch (e) {
    return fail(e);
  }
}
