// Rank tracker for the Marketing page: what a paid SEO suite shows, built on free data the console
// already has. Each store on its own, like lib/marketing.mjs.
//
//   - Daily rank history for the tracked keywords (Google, a 7-day window ending 2 days ago, since
//     Search Console runs behind), saved once a day per store and charted over time.
//   - Visibility: how many tracked keywords sit in the top 3, top 10, top 20, further down, or nowhere.
//   - Pages that gained or lost Google clicks against the 28 days before.
//   - Keyword ideas: searches the site already shows up for that aren't tracked yet, and on demand
//     the phrases Google and Bing suggest as people type each tracked keyword.
//   - Backlinks: pages with links pointing at them, from Bing Webmaster Tools.
//   - Competitors: up to 5 sites per store, read side by side with the store's own home page.
//
// What free data can't give (and the page says so): monthly search volume for a phrase, where a
// competitor ranks, and a full web-wide backlink index.
import { HttpError, STORES, fetchWithTimeout, siteUrl } from "./shopify.mjs";
import { bingQueries, getPage, gscRows, keywordStats, readKeywords, readPage } from "./marketing.mjs";

const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const TIMEOUT_MS = 8000;
export const HISTORY_DAYS = 400;
export const MAX_COMPETITORS = 5;
export const MAX_IDEA_SEEDS = 10;

// ---------- rank history ----------
// One entry per day: { date, k: { keyword: [position, clicks, impressions] } }. Newest last.
export async function readRanks(kv, store) {
  if (!kv) return [];
  try { const v = await kv.get(`ranks:${store}`, { type: "json" }); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function bucketOf(pos) {
  if (pos == null) return "none";
  return pos <= 3 ? "top3" : pos <= 10 ? "top10" : pos <= 20 ? "top20" : "beyond";
}
export function visibility(keywords, positionOf) {
  const out = { top3: 0, top10: 0, top20: 0, beyond: 0, none: 0 };
  for (const kw of keywords) out[bucketOf(positionOf(kw))]++;
  return out;
}
// Takes today's snapshot unless one exists. Returns the history (with today's entry).
export async function snapshotRanks({ env, fetchImpl, kv, store, clock = () => new Date(), force = false }) {
  const history = await readRanks(kv, store);
  const now = clock().getTime();
  const date = dayKey(now);
  if (!force && history.at(-1)?.date === date) return { history, taken: false };
  const site = siteUrl(env, store);
  const g = await gscRows(fetchImpl, env, store, site, now, { start: dayKey(now - 8 * DAY), end: dayKey(now - 2 * DAY), dimensions: ["query", "page"], rowLimit: 5000 });
  if (!g.rows) return { history, taken: false, error: g.error ?? null, connected: g.connected };
  const rows = g.rows.map((r) => ({ query: (r.keys[0] ?? "").toLowerCase(), page: r.keys[1] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const keywords = await readKeywords(kv, store);
  const k = {};
  for (const kw of keywords) { const s = keywordStats(kw, rows); k[kw] = [s.position, s.clicks, s.impressions]; }
  const next = [...history.filter((h) => h.date !== date), { date, k }].slice(-HISTORY_DAYS);
  if (kv) await kv.put(`ranks:${store}`, JSON.stringify(next));
  return { history: next, taken: true };
}
export async function runScheduledSnapshots(env, fetchImpl, kv, clock = () => new Date()) {
  const out = {};
  for (const store of Object.keys(STORES)) {
    try { out[store] = (await snapshotRanks({ env, fetchImpl, kv, store, clock })).taken; } catch { out[store] = null; }
  }
  return out;
}
// Per keyword: position now, 7 and 28 days ago, best ever, and the daily series for a chart.
export function rankTable(keywords, history) {
  const at = (daysBack) => history.at(-1 - daysBack) ?? null;
  return keywords.map((kw) => {
    const series = history.map((h) => ({ date: h.date, position: h.k?.[kw]?.[0] ?? null }));
    const now = at(0)?.k?.[kw]?.[0] ?? null;
    const was = (d) => { const e = history.length > d ? at(d) : null; return e?.k?.[kw]?.[0] ?? null; };
    const known = series.map((x) => x.position).filter((p) => p != null);
    const w7 = was(7), w28 = was(28);
    return { keyword: kw, position: now, week: w7, month: w28, best: known.length ? Math.min(...known) : null,
      change7: now != null && w7 != null ? round1(w7 - now) : null, change28: now != null && w28 != null ? round1(w28 - now) : null,
      clicks: at(0)?.k?.[kw]?.[1] ?? 0, impressions: at(0)?.k?.[kw]?.[2] ?? 0, series };
  });
}
// Share of clicks a result tends to get at each Google position (a common click-through curve).
// Visibility is the tracked keywords' average of that share, scaled so position 1 everywhere = 100.
const CTR = [0, 0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025];
export function ctrOf(pos) {
  if (pos == null || !(pos > 0)) return 0;
  const p = Math.round(pos);
  return p <= 10 ? CTR[Math.max(1, p)] : p <= 20 ? 0.01 : 0;
}
// Per day: average position of the tracked keywords Google shows, and the visibility score
// (rises as rankings improve, so it charts upward).
export function averageSeries(history) {
  return history.map((h) => {
    const vals = Object.values(h.k ?? {});
    const ps = vals.map((v) => v?.[0]).filter((p) => p != null);
    const vis = vals.length ? round1((vals.reduce((a, v) => a + ctrOf(v?.[0]), 0) / vals.length / CTR[1]) * 100) : 0;
    return { date: h.date, average: ps.length ? round1(ps.reduce((a, p) => a + p, 0) / ps.length) : null, seen: ps.length, visibility: vis };
  });
}

// ---------- pages that moved ----------
export function pageMovers(cur, prev, site) {
  const byPage = (rows) => new Map(rows.map((r) => [r.keys[0], r]));
  const a = byPage(cur), b = byPage(prev);
  const pages = new Set([...a.keys(), ...b.keys()]);
  const list = [...pages].filter((p) => p && p.startsWith(site)).map((page) => {
    const c = a.get(page), p = b.get(page);
    return { page, clicks: c?.clicks ?? 0, clicksBefore: p?.clicks ?? 0, impressions: c?.impressions ?? 0, impressionsBefore: p?.impressions ?? 0,
      position: round1(c?.position ?? null), positionBefore: round1(p?.position ?? null) };
  }).map((x) => ({ ...x, change: x.clicks - x.clicksBefore, shownChange: x.impressions - x.impressionsBefore }));
  const score = (x) => x.change || x.shownChange / 20;
  return {
    winners: list.filter((x) => score(x) > 0).sort((x, y) => score(y) - score(x)).slice(0, 10),
    losers: list.filter((x) => score(x) < 0).sort((x, y) => score(x) - score(y)).slice(0, 10),
  };
}

// ---------- keyword ideas ----------
// Searches the site already appears for, not covered by a tracked keyword, best first.
const covered = (query, keywords) => keywords.some((kw) => kw.split(" ").every((w) => query.includes(w)));
export function searchIdeas(rows, keywords, limit = 25) {
  const map = new Map();
  for (const r of rows) {
    const q = (r.keys[0] ?? "").toLowerCase().trim();
    if (!q || covered(q, keywords)) continue;
    const m = map.get(q) ?? { query: q, clicks: 0, impressions: 0, posSum: 0 };
    m.clicks += r.clicks; m.impressions += r.impressions; m.posSum += (r.position ?? 0) * r.impressions;
    map.set(q, m);
  }
  return [...map.values()].map((m) => ({ query: m.query, clicks: m.clicks, impressions: m.impressions, position: m.impressions ? round1(m.posSum / m.impressions) : null }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, limit);
}
// What Google and Bing suggest as someone types a phrase (their public suggestion lists).
export function parseSuggest(body) {
  // Both answer in the OpenSearch shape: [query, [suggestion, ...], ...]
  return Array.isArray(body) && Array.isArray(body[1]) ? body[1].filter((x) => typeof x === "string").map((x) => x.toLowerCase().trim()).filter(Boolean) : [];
}
async function suggest(fetchImpl, url) {
  try {
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } }, TIMEOUT_MS);
    if (!res.ok) return null;
    return parseSuggest(JSON.parse(await res.text()));
  } catch { return null; }
}
export async function suggestIdeas(fetchImpl, seeds, tracked) {
  const out = new Map();
  let answered = 0;
  await Promise.all(seeds.slice(0, MAX_IDEA_SEEDS).map(async (seed) => {
    const q = encodeURIComponent(seed);
    const [g, b] = await Promise.all([
      suggest(fetchImpl, `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${q}`),
      suggest(fetchImpl, `https://api.bing.com/osjson.aspx?market=en-US&query=${q}`),
    ]);
    if (g || b) answered++;
    for (const [src, list] of [["Google", g], ["Bing", b]])
      for (const s of list ?? []) {
        if (s === seed || tracked.includes(s) || s.length > 80) continue;
        const e = out.get(s) ?? { phrase: s, from: seed, sources: [] };
        if (!e.sources.includes(src)) e.sources.push(src);
        out.set(s, e);
      }
  }));
  const ideas = [...out.values()].sort((a, b) => b.sources.length - a.sources.length || a.phrase.localeCompare(b.phrase)).slice(0, 60);
  return { ideas, error: answered ? null : "Google and Bing suggestions didn't answer. Try again later." };
}

// ---------- backlinks (Bing Webmaster Tools) ----------
const pick = (o, ...names) => { for (const k of names) if (o?.[k] != null) return o[k]; return undefined; };
export function parseLinkCounts(body) {
  const d = body?.d ?? body;
  const links = pick(d, "Links", "links") ?? [];
  return { pages: (Array.isArray(links) ? links : []).map((l) => ({ url: String(pick(l, "Url", "url") ?? ""), links: n(pick(l, "Count", "count")) })).filter((l) => l.url).sort((a, b) => b.links - a.links),
    totalPages: n(pick(d, "TotalPages", "totalPages")) };
}
export async function bingBacklinks(fetchImpl, env, site) {
  const key = (env("BING_WEBMASTER_API_KEY") ?? "").trim();
  if (!key) return { connected: false, note: "Connect Bing Webmaster Tools to see the links pointing at the site." };
  try {
    const res = await fetchWithTimeout(fetchImpl, `https://ssl.bing.com/webmaster/api.svc/json/GetLinkCounts?siteUrl=${encodeURIComponent(`${site}/`)}&page=0&apikey=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } }, TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { connected: true, error: res.status === 401 || res.status === 403 ? "Bing didn't accept the Bing Webmaster Tools key. Check it." : `Bing answered ${res.status}.` };
    const { pages } = parseLinkCounts(body);
    return { connected: true, pages: pages.slice(0, 25), total: pages.reduce((a, p) => a + p.links, 0) };
  } catch { return { connected: true, error: "Bing Webmaster Tools didn't answer." }; }
}
export function parseUrlLinks(body) {
  const d = body?.d ?? body;
  const list = pick(d, "Details", "details") ?? [];
  return (Array.isArray(list) ? list : []).map((x) => ({ from: String(pick(x, "Url", "url") ?? ""), anchor: String(pick(x, "AnchorText", "anchorText") ?? "") })).filter((x) => x.from);
}
export async function bingLinksTo(fetchImpl, env, site, link) {
  const key = (env("BING_WEBMASTER_API_KEY") ?? "").trim();
  if (!key) throw new HttpError(503, "not_connected", "Connect Bing Webmaster Tools first.");
  const res = await fetchWithTimeout(fetchImpl, `https://ssl.bing.com/webmaster/api.svc/json/GetUrlLinks?siteUrl=${encodeURIComponent(`${site}/`)}&link=${encodeURIComponent(link)}&page=0&apikey=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } }, TIMEOUT_MS)
    .catch(() => { throw new HttpError(502, "bing_error", "Bing Webmaster Tools didn't answer."); });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new HttpError(502, "bing_error", `Bing answered ${res.status}.`);
  return parseUrlLinks(body).slice(0, 50);
}

// ---------- competitors ----------
export function parseCompetitors(list, ownHost) {
  if (!Array.isArray(list) || list.length > MAX_COMPETITORS) throw new HttpError(400, "bad_input", `competitors must be a list of up to ${MAX_COMPETITORS} sites.`);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string" || raw.length > 200) throw new HttpError(400, "bad_input", "Each competitor must be a web address.");
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new HttpError(400, "bad_input", `"${raw.slice(0, 60)}" isn't a web address.`); }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^(\d+\.){3}\d+$/.test(host) || host === "localhost") throw new HttpError(400, "bad_input", `"${raw.slice(0, 60)}" isn't a public web address.`);
    if (host === ownHost) throw new HttpError(400, "bad_input", "That's this store's own site.");
    if (!out.includes(host)) out.push(host);
  }
  return out;
}
export async function readCompetitors(kv, store) {
  if (!kv) return [];
  try { const v = await kv.get(`competitors:${store}`, { type: "json" }); return Array.isArray(v) ? v : []; } catch { return []; }
}
const words = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
export function siteCard(host, page) {
  if (!page.body || page.status >= 400 || page.status === 0) return { host, error: page.error ?? `answered ${page.status}` };
  const p = readPage(page.body);
  return { host, url: page.finalUrl, title: p.title, titleLength: p.title.length, description: p.description, descriptionLength: p.description.length,
    h1: p.h1, words: words(page.body), schema: p.ldTypes, local: p.ldTypes.some((t) => /LocalBusiness|Store$/.test(t)) || Boolean(p.geoPlace),
    socialCard: Boolean(p.og.title && p.og.image), images: p.images, imagesNoAlt: p.imagesNoAlt };
}
export async function compareSites(fetchImpl, site, hosts) {
  const own = new URL(site).hostname.replace(/^www\./, "");
  const cards = await Promise.all([own, ...hosts].map(async (h) => siteCard(h, await getPage(fetchImpl, h === own ? `${site}/` : `https://${h}/`))));
  return { own: cards[0], competitors: cards.slice(1) };
}

// ---------- the whole panel ----------
export async function loadTracker({ env, fetchImpl, kv, store, clock = () => new Date() }) {
  const site = siteUrl(env, store);
  const now = clock().getTime();
  const end = dayKey(now - 2 * DAY);
  const [snap, keywords, curPages, prevPages, queries, links, competitors] = await Promise.all([
    snapshotRanks({ env, fetchImpl, kv, store, clock }),
    readKeywords(kv, store),
    gscRows(fetchImpl, env, store, site, now, { start: dayKey(now - 29 * DAY), end, dimensions: ["page"], rowLimit: 500 }),
    gscRows(fetchImpl, env, store, site, now, { start: dayKey(now - 57 * DAY), end: dayKey(now - 30 * DAY), dimensions: ["page"], rowLimit: 500 }),
    gscRows(fetchImpl, env, store, site, now, { start: dayKey(now - 29 * DAY), end, dimensions: ["query"], rowLimit: 1000 }),
    bingBacklinks(fetchImpl, env, site),
    readCompetitors(kv, store),
  ]);
  const history = snap.history;
  const latest = history.at(-1) ?? null;
  const google = queries.rows ? { connected: true } : { connected: queries.connected, error: queries.error, note: queries.connected ? undefined : "Connect Google Search Console to track positions." };
  // Bing positions for the same keywords (its query report covers about the last 6 months, by week).
  const bing = await bingQueries(fetchImpl, env, site);
  const bingRows = (bing.queries ?? []).map((q) => ({ ...q, query: q.query.toLowerCase(), page: "" }));
  const bingPos = (kw) => (bing.queries ? keywordStats(kw, bingRows).position : null);
  return {
    store, site, saveAvailable: Boolean(kv), sources: { google, bing: bing.queries ? { connected: true } : { connected: bing.connected, error: bing.error, note: bing.note } },
    snapshot: { latest: latest?.date ?? null, days: history.length, taken: snap.taken },
    visibility: { google: visibility(keywords, (kw) => latest?.k?.[kw]?.[0] ?? null), bing: bing.queries ? visibility(keywords, bingPos) : null, tracked: keywords.length },
    trend: averageSeries(history),
    keywords: rankTable(keywords, history).map((r) => ({ ...r, bing: bingPos(r.keyword) })),
    pages: curPages.rows && prevPages.rows ? pageMovers(curPages.rows, prevPages.rows, site) : null,
    ideas: queries.rows ? searchIdeas(queries.rows, keywords) : [],
    backlinks: links,
    competitors,
  };
}

// ---------- input ----------
const only = (body, allowed) => {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(400, "bad_input", `Unexpected field: ${extra.slice(0, 3).join(", ")}.`);
};
export function parseTrackerInput(body, store, site) {
  switch (body.action) {
    case "competitors":
      only(body, ["store", "action", "competitors"]);
      return { store, action: "competitors", competitors: parseCompetitors(body.competitors, new URL(site).hostname.replace(/^www\./, "")) };
    case "ideas": {
      only(body, ["store", "action", "seeds"]);
      if (!Array.isArray(body.seeds) || !body.seeds.length || body.seeds.length > MAX_IDEA_SEEDS) throw new HttpError(400, "bad_input", `seeds must be a list of 1 to ${MAX_IDEA_SEEDS} phrases.`);
      const seeds = body.seeds.map((s) => {
        if (typeof s !== "string") throw new HttpError(400, "bad_input", "Each seed must be text.");
        const v = s.replace(/\s+/g, " ").trim().toLowerCase();
        if (!/^[\p{L}\p{N}][\p{L}\p{N} '&-]{0,78}[\p{L}\p{N}]$/u.test(v)) throw new HttpError(400, "bad_input", `"${s.slice(0, 40)}" isn't a phrase (2 to 80 letters, numbers, spaces, ' & -).`);
        return v;
      });
      return { store, action: "ideas", seeds: [...new Set(seeds)] };
    }
    case "links": {
      only(body, ["store", "action", "url"]);
      let u;
      try { u = new URL(body.url); } catch { throw new HttpError(400, "bad_input", "url must be a page address."); }
      if (u.protocol !== "https:" || u.host !== new URL(site).host) throw new HttpError(400, "bad_input", `The page must be on ${new URL(site).host}.`);
      return { store, action: "links", url: u.href };
    }
    case "compare":
      only(body, ["store", "action"]);
      return { store, action: "compare" };
    case "snapshot":
      only(body, ["store", "action"]);
      return { store, action: "snapshot" };
    default:
      return null;
  }
}
export async function runTrackerAction(input, ctx, clock) {
  const site = siteUrl(ctx.env, input.store);
  if (input.action === "competitors") {
    if (!ctx.kv) throw new HttpError(503, "no_storage", "Saving competitors needs the console's storage, which isn't set up yet (see the setup guide).");
    await ctx.kv.put(`competitors:${input.store}`, JSON.stringify(input.competitors));
    return { store: input.store, competitors: input.competitors };
  }
  if (input.action === "compare") {
    const hosts = await readCompetitors(ctx.kv, input.store);
    return { store: input.store, ...(await compareSites(ctx.fetch, site, hosts)) };
  }
  if (input.action === "ideas") {
    const tracked = await readKeywords(ctx.kv, input.store);
    return { store: input.store, ...(await suggestIdeas(ctx.fetch, input.seeds, tracked)) };
  }
  if (input.action === "links") return { store: input.store, url: input.url, links: await bingLinksTo(ctx.fetch, ctx.env, site, input.url) };
  const r = await snapshotRanks({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store: input.store, clock, force: true });
  if (!r.taken) throw new HttpError(503, "not_connected", r.error ?? "Connect Google Search Console to take a snapshot.");
  return { store: input.store, date: r.history.at(-1).date, days: r.history.length };
}
