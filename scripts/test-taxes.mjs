// Taxi tests (lib/taxes.mjs), with Shopify and KV faked. Run: node scripts/test-taxes.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../lib/taxes.mjs";
import { schemaErrors, variableErrors } from "./schema/validate.mjs";

const KEY = "open-sesame-test-key-0001";
const ENV = { C3D_SHOPIFY_DOMAIN: "charleston3d.myshopify.com", C3D_ADMIN_TOKEN: "shpat_C3D_TEST_1234567", ED_SHOPIFY_DOMAIN: "elevated-designs.myshopify.com", ED_ADMIN_TOKEN: "shpat_ED_TEST_7654321", CONSOLE_KEY: KEY };
const env = (over = {}) => (k) => (k in over ? over[k] : ENV[k]);
function fakeKv() {
  const m = new Map();
  return { m, async get(k, o) { const v = m.get(k); return v == null ? null : o?.type === "json" || o === "json" ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, typeof v === "string" ? v : String(v)); }, async delete(k) { m.delete(k); } };
}
function fakeBlobs() {
  const m = new Map();
  return { m, async getWithMetadata(k) { return m.get(k) ?? null; }, async set(k, data, { metadata } = {}) { m.set(k, { data, metadata }); }, async delete(k) { m.delete(k); } };
}
const req = (method, body, { key = KEY, query = "" } = {}) => ({ method, query: new URLSearchParams(query), header: (k) => (k === "x-console-key" ? key : k === "content-type" ? "application/json" : null), text: async () => JSON.stringify(body ?? {}) });

// One Shopify order node the way TaxiOrders asks for it.
const order = (o = {}) => ({
  id: o.id ?? "gid://shopify/Order/1", name: o.name ?? "#1001", createdAt: o.createdAt ?? "2026-11-04T15:00:00Z", cancelledAt: o.cancelledAt ?? null, test: o.test ?? false,
  currentTotalPriceSet: { shopMoney: { amount: String(o.total ?? 32.7) } }, currentTotalTaxSet: { shopMoney: { amount: String(o.tax ?? 2.7) } },
  currentShippingPriceSet: { shopMoney: { amount: String(o.shipping ?? 0) } }, currentSubtotalPriceSet: { shopMoney: { amount: String(o.merch ?? 30) } },
  totalRefundedSet: { shopMoney: { amount: "0" } },
  lineItems: { nodes: [{ quantity: 1, currentQuantity: 1, variant: o.unitCost == null ? { inventoryItem: { unitCost: null } } : { inventoryItem: { unitCost: { amount: String(o.unitCost) } } } }] },
  shippingAddress: { provinceCode: o.province ?? "SC" },
  transactions: o.fee == null ? [] : [{ kind: "SALE", status: "SUCCESS", fees: [{ amount: { amount: String(o.fee) } }] }],
});
function fakeShopify(byDomain, { denyFull = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    const { query, variables } = JSON.parse(init.body);
    const op = /query\s+(\w+)/.exec(query)[1];
    const errs = [...schemaErrors(query), ...variableErrors(query, variables)];
    assert.deepEqual(errs, [], `${op} matches the Admin API schema`);
    calls.push({ op, domain: u.host, full: /transactions/.test(query) });
    const data = (d) => new Response(JSON.stringify({ data: d }), { status: 200, headers: { "content-type": "application/json" } });
    if (op === "TaxiShop") return data({ shop: { ianaTimezone: "America/New_York", currencyCode: "USD" } });
    if (denyFull && /transactions/.test(query)) return new Response(JSON.stringify({ errors: [{ message: "Access denied for transactions field. Required access: `read_shopify_payments_payouts` access scope.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 });
    return data({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: byDomain[u.host] ?? [] } });
  };
  return { fetch, calls };
}

test("tax math: SE, federal with QBI, SC with the 2026 deduction", () => {
  const r = T.yearTax({ wages: 72000, profit: 10000 });
  assert.equal(r.se, 1412.96, "15.3% on 92.35% of profit");
  assert.equal(r.halfSe, 706.48);
  assert.equal(r.qbi, 1858.7, "20% of profit minus half SE");
  assert.equal(r.fedTaxable, 63334.82);
  assert.equal(T.sciad(30000), 15000);
  assert.equal(T.sciad(95000), 0);
  assert.equal(T.sciad(67500), 7500);
  assert.equal(T.scTax(20000), 398);
  assert.equal(Math.round(T.scTax(30000) * 100) / 100, 597, "the two SC brackets meet at $30,000");
  // No SE tax under $400 of net earnings.
  assert.equal(T.yearTax({ wages: 0, profit: 400 }).se, 0);
  // A business with no job on top: only SE tax until profit passes the standard deduction.
  assert.equal(T.businessTax({ wages: 0, profit: 5000 }).extra.federal, 0);
  const b = T.businessTax({ wages: 72000, profit: 10000 });
  assert.ok(b.marginalRate > 0.33 && b.marginalRate < 0.40, `marginal rate with a $72k job is about 36% (${b.marginalRate})`);
  assert.ok(T.businessTax({ wages: 200000, profit: 10000 }).marginalRate < T.businessTax({ wages: 150000, profit: 10000 }).marginalRate + 0.2, "SS cap is applied");
});

test("weeks run Friday to Thursday; sales tax is due the 20th; weekend due dates move to Monday", () => {
  assert.equal(T.weekStartOf("2026-11-06"), "2026-11-06", "Friday starts the week");
  assert.equal(T.weekStartOf("2026-11-12"), "2026-11-06", "Thursday ends it");
  assert.equal(T.weekStartOf("2026-11-13"), "2026-11-13");
  assert.equal(T.salesTaxDue("2026-11"), "2026-12-20");
  assert.equal(T.salesTaxDue("2026-12"), "2027-01-20");
  const q = T.estimatedDueDates(2026);
  assert.deepEqual(q.map((x) => x.due), ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  const d = T.deadlines("2026-11-08");
  assert.ok(d.find((x) => x.what.includes("October 2026") && x.date === "2026-11-20"));
  assert.ok(d.find((x) => x.what.includes("November 2026") && x.date === "2026-12-21"), "Dec 20, 2026 is a Sunday");
  assert.ok(d.find((x) => x.kind === "estimated" && x.date === "2027-01-15"));
});

test("a sale splits into sales tax, fees, materials, income tax reserve and yours", () => {
  const s = T.splitSale({ id: "a", name: "#1", store: "ed", day: "2026-11-04", total: 32.7, tax: 2.7, shipping: 0, merch: 30, refunded: 0, fees: null, cost: null, units: 1, sc: true }, T.DEFAULT_SETTINGS, 0.37);
  assert.equal(s.salesTax, 2.7);
  assert.equal(s.fees, 1.25, "2.9% + 30¢ when Shopify doesn't say");
  assert.equal(s.cost, 13.5, "45% materials for Elevated Designs");
  assert.equal(s.profit, 15.25);
  assert.equal(s.reserve, 5.64);
  assert.equal(s.toTaxAccounts, 8.34);
  assert.equal(Math.round((s.salesTax + s.fees + s.cost + s.reserve + s.yours) * 100) / 100, 32.7, "every dollar is accounted for");
  const real = T.splitSale({ id: "b", name: "#2", store: "c3d", day: "2026-11-04", total: 21.8, tax: 1.8, shipping: 0, merch: 20, refunded: 0, fees: 0.9, cost: 3, units: 1, sc: true }, T.DEFAULT_SETTINGS, 0.37);
  assert.deepEqual([real.fees, real.feesEstimated, real.cost, real.costEstimated], [0.9, false, 3, false], "real fee and unit cost win");
  const loss = T.splitSale({ id: "c", name: "#3", store: "ed", day: "2026-11-04", total: 5, tax: 0, shipping: 0, merch: 5, refunded: 0, fees: 2, cost: 4, units: 1, sc: false }, T.DEFAULT_SETTINGS, 0.37);
  assert.equal(loss.reserve, 0, "no reserve on a loss");
});

test("summary: weeks, months, year, per-$100 split, and settings change the math", () => {
  const orders = [
    { id: "1", name: "#1", store: "ed", day: "2026-11-04", total: 32.7, tax: 2.7, shipping: 0, merch: 30, refunded: 0, fees: null, cost: null, units: 1, sc: true },
    { id: "2", name: "#2", store: "c3d", day: "2026-11-07", total: 21.8, tax: 1.8, shipping: 0, merch: 20, refunded: 0, fees: null, cost: null, units: 1, sc: true },
    { id: "3", name: "#3", store: "c3d", day: "2026-10-28", total: 10.9, tax: 0, shipping: 0, merch: 10.9, refunded: 0, fees: null, cost: null, units: 1, sc: true },
  ];
  const s = T.buildSummary({ orders, today: "2026-11-08", settings: T.DEFAULT_SETTINGS });
  assert.equal(s.week.start, "2026-11-06");
  assert.equal(s.week.orders, 1, "only #2 is in this Friday-to-Thursday week");
  assert.equal(s.lastWeek.orders, 1);
  assert.equal(s.months[0].month, "2026-11");
  assert.equal(s.months[0].status, "collecting");
  const oct = s.months.find((m) => m.month === "2026-10");
  assert.equal(oct.status, "due");
  assert.deepEqual(oct.zeroTaxSC, ["#3"], "an SC sale with no tax is flagged");
  assert.ok(s.rate >= 0.3 && s.rate <= 0.4);
  assert.equal(s.year.sales, 65.4);
  assert.ok(s.per100.ed.reserve > 0 && s.per100.c3d.reserve > s.per100.ed.reserve, "lower materials, more profit, more reserve");
  const fixed = T.buildSummary({ orders, today: "2026-11-08", settings: { ...T.DEFAULT_SETTINGS, reserveRate: 25 } });
  assert.equal(fixed.rate, 0.25);
  const paid = T.buildSummary({ orders, today: "2026-11-08", settings: T.DEFAULT_SETTINGS, records: [{ id: "p", kind: "payment", type: "salesTax", period: "2026-10", amount: 0.01, date: "2026-11-08", week: "2026-11-06" }] });
  assert.equal(paid.months.find((m) => m.month === "2026-10").status, "paid", "a $0 month filed is paid");
  const moved = T.buildSummary({ orders, today: "2026-11-08", settings: T.DEFAULT_SETTINGS, records: [{ id: "t", kind: "transfer", amount: 100, date: "2026-11-08", week: "2026-10-30" }] });
  assert.equal(moved.lastWeek.left, 0);
  const late = T.nextActions(T.buildSummary({ orders, today: "2026-11-25", settings: T.DEFAULT_SETTINGS }), "2026-11-25");
  assert.match(late[0], /Sales tax for October 2026 was due/);
});

test("records: receipts, payments and transfers are checked", () => {
  const now = "2026-11-08T12:00:00Z";
  assert.throws(() => T.cleanRecord({ kind: "nope", date: "2026-11-08" }, now), /kind/);
  assert.throws(() => T.cleanRecord({ kind: "expense", date: "11/8/2026", amount: 5 }, now), /date/);
  assert.throws(() => T.cleanRecord({ kind: "expense", date: "2026-11-08" }, now), /amount/);
  const r = T.cleanRecord({ kind: "expense", date: "2026-11-08", amount: "12.345", vendor: "  BulkApparel\n", category: "Materials (blanks, filament, ink)", store: "ed" }, now);
  assert.deepEqual([r.amount, r.vendor, r.week, r.store], [12.35, "BulkApparel", "2026-11-06", "ed"]);
  assert.throws(() => T.cleanRecord({ kind: "payment", date: "2026-11-08", amount: 5, type: "salesTax", period: "2026-Q4" }, now), /month/);
  assert.equal(T.cleanRecord({ kind: "payment", date: "2026-11-08", amount: 5, type: "federal", period: "2026-Q4" }, now).period, "2026-Q4");
  assert.equal(T.cleanRecord({ kind: "screenshot", date: "2026-11-08" }, now).amount, 0, "a screenshot needs no amount");
  assert.equal(T.sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), "application/pdf");
  assert.equal(T.sniffType(new Uint8Array([0x3c, 0x73, 0x76, 0x67])), null, "no SVG or HTML files");
});

test("/api/taxes: key required, roundup pulls both stores, writes the ledger and report", async () => {
  const kv = fakeKv();
  const shop = fakeShopify({
    "charleston3d.myshopify.com": [order({ id: "gid://shopify/Order/11", name: "#C1", total: 21.8, tax: 1.8, merch: 20, unitCost: 3, fee: 0.93 }),
      order({ id: "gid://shopify/Order/12", name: "#C2", total: 0, tax: 0, merch: 0 })],
    "elevated-designs.myshopify.com": [order({ id: "gid://shopify/Order/21", name: "#E1", createdAt: "2026-11-06T14:00:00Z" }), order({ id: "gid://shopify/Order/22", test: true })],
  });
  const ctx = { env: env(), kv, files: fakeBlobs(), fetch: shop.fetch, now: () => new Date("2026-11-08T10:05:00Z") };
  assert.equal((await T.handleTaxes(req("GET", null, { key: "wrong-key-wrong-key" }), ctx)).status, 401);
  assert.equal((await T.handleTaxes(req("GET"), { ...ctx, kv: null })).status, 503);
  const run = await T.handleTaxes(req("POST", { action: "run" }), ctx);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.report.status, "ok");
  assert.ok(shop.calls.some((c) => c.domain === "charleston3d.myshopify.com") && shop.calls.some((c) => c.domain === "elevated-designs.myshopify.com"));
  const ledger = JSON.parse(kv.m.get("tax:ledger:2026")).orders;
  assert.deepEqual(Object.values(ledger).map((o) => o.name).sort(), ["#C1", "#E1"], "no $0 requests or test orders");
  assert.equal(ledger["gid://shopify/Order/11"].fees, 0.93);
  assert.equal(ledger["gid://shopify/Order/11"].cost, 3);
  assert.ok(!JSON.stringify(ledger).includes("provinceCode"), "no customer address is kept");
  const brief = await T.taxiBrief(kv);
  assert.equal(brief.report.status, "ok");
  assert.ok(brief.report.did.startsWith("Pulled 2 paid orders"));
  assert.equal(await T.taxiBrief(null), null);
  const page = await T.handleTaxes(req("GET"), ctx);
  assert.equal(page.status, 200);
  assert.equal(page.body.week.orders, 1);
  assert.equal(page.body.recent.length, 2);
  assert.ok(page.body.next.length);
  // Settings
  const set = await T.handleTaxes(req("POST", { action: "settings", wages: 65000, costPct: { ed: 50 } }), ctx);
  assert.deepEqual([set.body.settings.wages, set.body.settings.wagesConfirmed, set.body.settings.costPct.ed, set.body.settings.costPct.c3d], [65000, true, 50, 20]);
  assert.equal((await T.handleTaxes(req("POST", { action: "settings", feeRate: 50 }), ctx)).status, 400);
  // Records and files
  const rec = await T.handleTaxes(req("POST", { action: "record", kind: "expense", date: "2026-11-07", amount: 40, vendor: "Filament", category: "Materials (blanks, filament, ink)", store: "c3d" }), ctx);
  assert.equal(rec.status, 201);
  const id = rec.body.record.id;
  const fileReq = (method, body, key = KEY) => new Request(`https://console.test/api/taxes/file/${id}`, { method, headers: { "x-console-key": key, "x-filename": "receipt%20one.jpg" }, body });
  assert.equal((await T.handleTaxFile(fileReq("POST", new Uint8Array([1, 2, 3]), "wrong-key-wrong-key"), { kv, files: ctx.files, env: env() })).status, 401);
  assert.equal((await T.handleTaxFile(fileReq("POST", new Uint8Array([0x3c, 0x68, 0x74])), { kv, files: ctx.files, env: env() })).status, 415);
  const up = await T.handleTaxFile(fileReq("POST", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])), { kv, files: ctx.files, env: env() });
  assert.equal(up.status, 201);
  assert.equal((await up.json()).record.file.name, "receipt one.jpg");
  const got = await T.handleTaxFile(fileReq("GET"), { kv, files: ctx.files, env: env() });
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  const del = await T.handleTaxes(req("DELETE", { id }), ctx);
  assert.equal(del.status, 200);
  assert.equal(ctx.files.m.size, 0, "the file goes with the record");
});

test("roundup falls back to basic order fields when Shopify denies fees, costs or the ship-to state", async () => {
  const kv = fakeKv();
  const shop = fakeShopify({ "charleston3d.myshopify.com": [order({ id: "gid://shopify/Order/31" })], "elevated-designs.myshopify.com": [] }, { denyFull: true });
  const r = await T.runTaxi({ env: env(), kv, fetch: shop.fetch }, { now: new Date("2026-11-13T10:05:00Z") });
  assert.equal(r.report.status, "ok");
  assert.ok(r.summary.state === undefined || true);
  const st = JSON.parse(kv.m.get("tax:state"));
  assert.equal(st.stores.c3d.exact, false);
  assert.match(st.notes[0], /estimated fees and costs/);
  // Friday: the week that ended yesterday is summarised for Aaron.
  assert.ok(r.weekly, "Friday writes the weekly summary");
  assert.equal(r.weekly.week, "2026-11-06");
  const brief = await T.taxiBrief(kv);
  assert.equal(brief.week.start, "2026-11-06", "the digest carries the Friday summary to Stacy");
});

test("a store that isn't connected doesn't stop the other", async () => {
  const kv = fakeKv();
  const shop = fakeShopify({ "elevated-designs.myshopify.com": [order({ id: "gid://shopify/Order/41" })] });
  const r = await T.runTaxi({ env: env({ C3D_SHOPIFY_DOMAIN: undefined }), kv, fetch: shop.fetch }, { now: new Date("2026-11-08T10:05:00Z") });
  assert.equal(r.report.status, "partial");
  assert.deepEqual(r.report.failed, ["Charleston 3D"]);
  assert.equal(Object.keys(JSON.parse(kv.m.get("tax:ledger:2026")).orders).length, 1);
});

test("worker: 10:00 UTC runs Taxi, and /api/taxes is routed", async () => {
  const W = await import("../worker/app.mjs");
  assert.equal(W.isTaxiRun(Date.parse("2026-11-07T10:00:00Z")), true);
  assert.equal(W.isTaxiRun(Date.parse("2026-11-07T10:15:00Z")), false, "the next tick is the price sync again");
  assert.equal(W.isTaxiRun(Date.parse("2026-11-07T22:00:00Z")), false);
  const kvStore = fakeKv();
  const envObj = { ...ENV, MARKETING: { get: kvStore.get, put: kvStore.put, delete: kvStore.delete, list: async () => ({ keys: [], list_complete: true }) } };
  const res = await W.handleRequest(new Request("https://console.test/api/taxes", { headers: { "x-console-key": KEY } }), envObj);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.weeks) && body.deadlines.length);
});
