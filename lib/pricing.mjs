// Shirt prices that follow the price sheet. Every Elevated Designs shirt variant is priced from the
// sheet row for its blank and size: the sheet's your_price when Aaron set one, else its
// suggested_price (blank cost x 2 + $8 print fee, rounded up to .99). Printed designs add the design
// markup on top (DESIGN_MARKUP, $10 unless set); the plain blanks the shirt app sells (tag
// builder-blank) get the sheet price as is. Rows with offer=no are never used.
// Plain functions with no hosting code (see lib/shopify.mjs).
//
// GET  /api/pricing?store=ed   where the last sync got to, and what the next run would change   key
// POST /api/pricing            { store: "ed" }  moves the sync one step on (the cron does the same) key
//
// One sync is three steps, each a short request, so it fits the Workers free plan (50 subrequests):
//   1. idle      -> start a bulk query of every product's variants         (phase "querying")
//   2. querying  -> when Shopify has the file: read it, work out the price changes, upload them as
//                   JSONL and start one bulk productVariantsBulkUpdate      (phase "applying")
//   3. applying  -> when that finishes, record what changed                 (phase "idle")
// The cron (worker/index.mjs) calls step() every 15 minutes. From idle it only starts a new sync
// when the sheet's prices changed since the last one, or the last one is over a day old.
//
// A variant's blank comes from, in order: its SKU (console listings: ...-<blankId>-<color>-<size>),
// a Shirt/Style/Blank option naming the blank ("Comfort Colors 1717", or the console's
// "Comfort Colors 1717 – Garment-Dyed Heavyweight Tee"), or, for a shirt with no such option,
// colors that only one blank of that kind sells (Pepper and Espresso are Comfort Colors). Anything
// still unknown is left alone and counted in the report, never guessed.
import { HttpError, ok, fail, requireKey, parseStore, storeConfig, adminClient, userErrorsOrThrow, fetchWithTimeout, readJsonBody } from "./shopify.mjs";
import catalogFile from "../data/blanks.json" with { type: "json" };

export const PRICE_SHEET_ID = "11G7MyaGqSaz3WCd21etMYc-YebpAbyKzmvE1aqNWpy8";
export const DEFAULT_MARKUP = 10;
export const BLANK_TAG = "builder-blank";
const RESYNC_MS = 24 * 3600 * 1000;
const STATE_KEY = "pricing:state";
const SHEETS_TIMEOUT_MS = 10000;
const MAX_CHANGES_LISTED = 25;

// ---------- the price table ----------
const money = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const key = (blankId, size) => `${blankId}|${String(size).toUpperCase()}`;

// rows: arrays from the sheet, the first one being the header (id, size, suggested_price, your_price, offer, ...)
export function tableFromSheet(rows) {
  const [head, ...body] = rows ?? [];
  const col = (name) => (head ?? []).findIndex((h) => String(h).trim().toLowerCase() === name);
  const c = { id: col("id"), size: col("size"), suggested: col("suggested_price"), yours: col("your_price"), offer: col("offer") };
  if (c.id < 0 || c.size < 0 || (c.suggested < 0 && c.yours < 0))
    throw new HttpError(502, "sheet_format", "The price sheet needs id, size and suggested_price or your_price columns.");
  const table = new Map();
  for (const r of body) {
    const id = String(r[c.id] ?? "").trim(), size = String(r[c.size] ?? "").trim();
    if (!id || !size) continue;
    if (c.offer >= 0 && String(r[c.offer] ?? "").trim().toLowerCase() === "no") continue;
    const price = money(r[c.yours]) ?? money(r[c.suggested]);
    if (price) table.set(key(id, size), price);
  }
  if (!table.size) throw new HttpError(502, "sheet_empty", "The price sheet has no prices in it.");
  return table;
}

// The copy bundled with the console (data/blanks.json), used until the sheet can be read.
export function tableFromCatalog(catalog = catalogFile) {
  const table = new Map();
  for (const b of catalog.blanks) for (const [size, price] of Object.entries(b.prices ?? {})) if (money(price)) table.set(key(b.id, size), money(price));
  return table;
}

// Bump when planChanges picks different products, so the next run re-prices the store at once.
export const RULES_VERSION = 2;

export function tableHash(table) {
  let h = 2166136261;
  for (const [k, v] of [...table].sort(([a], [b]) => (a < b ? -1 : 1))) for (const ch of `${k}=${v};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (const ch of `rules=${RULES_VERSION}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16);
}

// ---------- reading the Google Sheet ----------
// With a Google service account (GOOGLE_SERVICE_ACCOUNT, or the GSC_SERVICE_ACCOUNT the Marketing
// page uses) that the sheet is shared with as a viewer, the console reads the sheet itself. The sheet
// holds supplier costs, so it is never published to the web.
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

async function googleToken(sa, fetchImpl) {
  const pem = String(sa.private_key ?? "").replace(/-----[^-]+-----|\s+/g, "");
  if (!sa.client_email || !pem) throw new HttpError(503, "sheet_not_set_up", "GOOGLE_SERVICE_ACCOUNT isn't a service account key (JSON with client_email and private_key).");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned));
  const res = await fetchWithTimeout(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  }, SHEETS_TIMEOUT_MS);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new HttpError(502, "sheet_auth", "Google refused the service account. Check GOOGLE_SERVICE_ACCOUNT.");
  return body.access_token;
}

export async function loadPriceTable(env, fetchImpl) {
  const raw = env("GOOGLE_SERVICE_ACCOUNT") ?? env("GSC_SERVICE_ACCOUNT");
  if (!raw) return { table: tableFromCatalog(), source: "bundled" };
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new HttpError(503, "sheet_not_set_up", "GOOGLE_SERVICE_ACCOUNT isn't valid JSON."); }
  const token = await googleToken(sa, fetchImpl);
  const sheet = (env("PRICE_SHEET_ID") ?? PRICE_SHEET_ID).trim();
  const res = await fetchWithTimeout(fetchImpl, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values/A1:Z2000`, {
    headers: { authorization: `Bearer ${token}` },
  }, SHEETS_TIMEOUT_MS);
  if (res.status === 403 || res.status === 404)
    throw new HttpError(502, "sheet_access", `Google won't show the price sheet to ${sa.client_email}. Share the sheet with that address as a viewer.`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new HttpError(502, "sheet_error", `Google Sheets answered with HTTP ${res.status}.`);
  return { table: tableFromSheet(body.values), source: "sheet" };
}

// ---------- which blank and size a variant is ----------
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const KIND = { "t-shirt": "tee", tee: "tee", shirt: "tee", "long sleeve": "long-sleeve", sweatshirt: "crewneck", crewneck: "crewneck", hoodie: "hoodie", tank: "tank" };

export function blankIndex(catalog = catalogFile) {
  const byName = new Map(); // normalized "brand style" and the console's full label -> blank id
  for (const b of catalog.blanks) {
    byName.set(norm(`${b.brand} ${b.style}`), b.id);
    byName.set(norm(`${b.brand} ${b.style} ${b.name}`), b.id);
  }
  // Longest ids first, so "gildan-5000b" wins over "gildan-5000" in a SKU.
  const ids = catalog.blanks.map((b) => b.id).sort((a, b) => b.length - a.length);
  return { catalog, byName, ids };
}

const SHIRT_OPTION = /^(shirt|style|blank|garment)$/i;
const SIZE_OPTION = /^size$/i;
const COLOR_OPTION = /^colou?r$/i;

// product: { tags, handle, productType, colors: [all its Color values] }; variant: { sku, selectedOptions }
export function identify(idx, product, variant) {
  const opts = variant.selectedOptions ?? [];
  const size = opts.find((o) => SIZE_OPTION.test(o.name))?.value?.toUpperCase();
  const sku = String(variant.sku ?? "").toLowerCase();
  let blankId = idx.ids.find((id) => sku === id || sku.startsWith(`${id}-`) || sku.includes(`-${id}-`)) ?? null;
  // The shirt app's plain blanks are named by their blank id (handle "gildan-h000").
  if (!blankId && (product.tags ?? []).includes(BLANK_TAG) && idx.ids.includes(product.handle)) blankId = product.handle;
  if (!blankId) {
    const shirt = opts.find((o) => SHIRT_OPTION.test(o.name))?.value;
    if (shirt) blankId = idx.byName.get(norm(shirt)) ?? idx.byName.get(norm(shirt.split(/\s[–-]\s/)[0])) ?? null;
    else if (product.colors?.length) {
      const kind = KIND[norm(product.productType).replace(/ /g, "-")] ?? KIND[norm(product.productType)];
      const fits = idx.catalog.blanks.filter((b) => (!kind || b.type === kind) && product.colors.every((c) => b.colors.some((x) => norm(x.name) === norm(c))));
      if (fits.length === 1) blankId = fits[0].id;
    }
  }
  return { blankId, size: size ?? null };
}

// ---------- planning ----------
// lines: the bulk query's JSONL rows, products then their variants (variants carry __parentId).
export function planChanges(lines, table, { markup = DEFAULT_MARKUP, idx = blankIndex() } = {}) {
  const products = new Map();
  for (const l of lines) {
    if (l.__parentId) products.get(l.__parentId)?.variants.push(l);
    else if (/\/Product\//.test(l.id ?? "")) products.set(l.id, { ...l, variants: [] });
  }
  const updates = [];
  const report = { products: 0, variants: 0, changed: 0, unchanged: 0, skipped: { not_a_shirt: 0, unknown_shirt: 0, no_size: 0, not_on_sheet: 0 }, examples: [], unknown: [] };
  for (const p of products.values()) {
    const isBlank = (p.tags ?? []).includes(BLANK_TAG);
    const vendor = String(p.vendor ?? "");
    // Only Elevated Designs shirts: never another brand's products (the store also holds old C3D items).
    // The design lines (Over-Engineered Co., Charleston SC Line, ...) sell under their own vendor
    // name but carry the "Elevated Designs" tag, so the tag counts too.
    const isEd = !vendor || /elevated/i.test(vendor) || (p.tags ?? []).some((t) => /^elevated designs$/i.test(t));
    if (!isBlank && (!isEd || /charleston 3d/i.test(vendor) || !/shirt|tee|sweat|hood|crew|tank|long/i.test(p.productType ?? ""))) {
      report.skipped.not_a_shirt += p.variants.length; continue;
    }
    report.products++;
    const colors = [...new Set(p.variants.flatMap((v) => (v.selectedOptions ?? []).filter((o) => COLOR_OPTION.test(o.name)).map((o) => o.value)))];
    const out = [];
    for (const v of p.variants) {
      report.variants++;
      const { blankId, size } = identify(idx, { tags: p.tags, handle: p.handle, productType: p.productType, colors }, v);
      if (!blankId) { report.skipped.unknown_shirt++; if (report.unknown.length < MAX_CHANGES_LISTED && !report.unknown.includes(p.handle)) report.unknown.push(p.handle); continue; }
      if (!size) { report.skipped.no_size++; continue; }
      const base = table.get(key(blankId, size));
      if (!base) { report.skipped.not_on_sheet++; continue; }
      const price = Math.round((base + (isBlank ? 0 : markup)) * 100) / 100;
      if (Math.abs(Number(v.price) - price) < 0.005) { report.unchanged++; continue; }
      out.push({ id: v.id, price: price.toFixed(2) });
      report.changed++;
      if (report.examples.length < MAX_CHANGES_LISTED) report.examples.push({ product: p.handle, variant: v.title ?? `${blankId} ${size}`, from: Number(v.price), to: price });
    }
    if (out.length) updates.push({ productId: p.id, variants: out });
  }
  return { updates, report };
}

// ---------- Shopify bulk operations ----------
export const BULK_QUERY = `{
  products {
    edges { node { id handle vendor productType tags
      variants { edges { node { id sku title price selectedOptions { name value } } } } } }
  }
}`;
export const BULK_QUERY_MUTATION = `mutation ConsolePricingQuery($query: String!) {
  bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } }
}`;
export const BULK_STATUS_QUERY = `query ConsolePricingStatus($id: ID!) {
  node(id: $id) { ... on BulkOperation { id status errorCode objectCount url partialDataUrl } }
}`;
export const PRICE_UPDATE_MUTATION = `mutation ConsolePriceUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
}`;
export const STAGE_JSONL_MUTATION = `mutation ConsolePricingStage($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
}`;
export const BULK_MUTATION_MUTATION = `mutation ConsolePricingApply($mutation: String!, $path: String!) {
  bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $path) { bulkOperation { id status } userErrors { field message } }
}`;

async function bulkStatus(client, id) {
  const d = await client.gql(BULK_STATUS_QUERY, { id });
  if (!d?.node) throw new HttpError(502, "shopify_error", "Shopify lost track of the price sync's bulk operation.");
  return d.node;
}

async function readJsonl(fetchImpl, url) {
  const res = await fetchWithTimeout(fetchImpl, url, {}, 30000);
  if (!res.ok) throw new HttpError(502, "shopify_error", `Couldn't download the product list from Shopify (HTTP ${res.status}).`);
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function uploadJsonl(client, fetchImpl, text) {
  const s = await client.gql(STAGE_JSONL_MUTATION, { input: [{ resource: "BULK_MUTATION_VARIABLES", filename: "prices.jsonl", mimeType: "text/jsonl", httpMethod: "POST" }] });
  userErrorsOrThrow(s.stagedUploadsCreate, "Shopify wouldn't take the price list");
  const t = s.stagedUploadsCreate.stagedTargets?.[0];
  if (!t?.url) throw new HttpError(502, "shopify_error", "Shopify gave no upload address for the price list.");
  const form = new FormData();
  for (const p of t.parameters ?? []) form.append(p.name, p.value);
  form.append("file", new Blob([text], { type: "text/jsonl" }), "prices.jsonl");
  const res = await fetchWithTimeout(fetchImpl, t.url, { method: "POST", body: form }, 30000);
  if (!res.ok) throw new HttpError(502, "shopify_error", `Uploading the price list failed (HTTP ${res.status}).`);
  const path = (t.parameters ?? []).find((p) => p.name === "key")?.value;
  if (!path) throw new HttpError(502, "shopify_error", "Shopify's upload address had no file key.");
  return path;
}

// ---------- the sync, one step at a time ----------
export const markupFrom = (env) => {
  const m = Number((env("DESIGN_MARKUP") ?? "").trim() || DEFAULT_MARKUP);
  return Number.isFinite(m) && m >= 0 && m <= 100 ? m : DEFAULT_MARKUP;
};

// state lives in KV under STATE_KEY: { phase, opId, hash, source, startedAt, finishedAt, report, error }
export async function step({ client, kv, env, fetchImpl, now = Date.now(), force = false }) {
  const state = (await kv.get(STATE_KEY, { type: "json" })) ?? { phase: "idle" };
  const save = async (s) => { await kv.put(STATE_KEY, JSON.stringify(s)); return s; };

  if (state.phase === "idle") {
    const { table, source } = await loadPriceTable(env, fetchImpl);
    const hash = tableHash(table);
    const stale = !state.finishedAt || now - Date.parse(state.finishedAt) > RESYNC_MS;
    if (!force && !stale && hash === state.hash) return { ...state, checkedAt: new Date(now).toISOString(), source };
    const d = await client.gql(BULK_QUERY_MUTATION, { query: BULK_QUERY });
    userErrorsOrThrow(d.bulkOperationRunQuery, "Shopify wouldn't start the price check");
    return save({ ...state, phase: "querying", opId: d.bulkOperationRunQuery.bulkOperation.id, hash, source, startedAt: new Date(now).toISOString(), error: null });
  }

  const op = await bulkStatus(client, state.opId);
  if (["CREATED", "RUNNING", "CANCELING"].includes(op.status)) return state;
  if (op.status !== "COMPLETED")
    return save({ ...state, phase: "idle", finishedAt: new Date(now).toISOString(), error: `Shopify's bulk ${state.phase === "querying" ? "read" : "update"} ended ${op.status}${op.errorCode ? ` (${op.errorCode})` : ""}.` });

  if (state.phase === "querying") {
    const { table, source } = await loadPriceTable(env, fetchImpl);
    const lines = op.url ? await readJsonl(fetchImpl, op.url) : [];
    const { updates, report } = planChanges(lines, table, { markup: markupFrom(env) });
    report.markup = markupFrom(env);
    if (!updates.length) return save({ ...state, phase: "idle", hash: tableHash(table), source, finishedAt: new Date(now).toISOString(), report });
    const path = await uploadJsonl(client, fetchImpl, updates.map((u) => JSON.stringify(u)).join("\n") + "\n");
    const d = await client.gql(BULK_MUTATION_MUTATION, { mutation: PRICE_UPDATE_MUTATION, path });
    userErrorsOrThrow(d.bulkOperationRunMutation, "Shopify wouldn't start the price update");
    return save({ ...state, phase: "applying", opId: d.bulkOperationRunMutation.bulkOperation.id, hash: tableHash(table), source, report });
  }

  // applying, and Shopify finished it
  return save({ ...state, phase: "idle", finishedAt: new Date(now).toISOString(), applied: op.objectCount ?? null });
}

// ---------- route ----------
export async function handlePricing(req, ctx) {
  try {
    if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
    requireKey(req, ctx.env, "The price sync");
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const store = parseStore(req.method === "POST" ? body.store : req.query.get("store"));
    if (store !== "ed") throw new HttpError(400, "bad_input", "Shirt prices are for Elevated Designs only.");
    if (!ctx.kv) throw new HttpError(503, "storage_not_set_up", "The price sync isn't set up yet: add the PRICING KV namespace binding (see the README).");
    if (req.method === "GET") {
      const state = (await ctx.kv.get(STATE_KEY, { type: "json" })) ?? { phase: "idle" };
      return ok({ ...state, markup: markupFrom(ctx.env) });
    }
    const client = adminClient(storeConfig(ctx.env, "ed"), ctx.fetch);
    return ok(await step({ client, kv: ctx.kv, env: ctx.env, fetchImpl: ctx.fetch, force: body.force === true }));
  } catch (e) {
    return fail(e);
  }
}

// The cron: one step for Elevated Designs, skipped quietly when the store isn't connected yet.
// A failed step (the sheet or Shopify refusing) is saved in the state's error, so GET /api/pricing says why the
// sync stopped. It is written only when the reason changes, so a failure every 15 minutes costs one KV write.
export async function scheduledPricing({ env, kv, fetchImpl, now = Date.now() }) {
  if (!kv || !env("ED_SHOPIFY_DOMAIN")) return null;
  try {
    const client = adminClient(storeConfig(env, "ed"), fetchImpl);
    return await step({ client, kv, env, fetchImpl, now });
  } catch (e) {
    const error = String(e?.message ?? e?.code ?? "The price sync failed.").slice(0, 300);
    const state = (await kv.get(STATE_KEY, { type: "json" }).catch(() => null)) ?? { phase: "idle" };
    if (state.error !== error) await kv.put(STATE_KEY, JSON.stringify({ ...state, error, errorAt: new Date(now).toISOString() })).catch(() => null);
    throw e;
  }
}
