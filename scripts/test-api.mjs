// API tests with Shopify mocked out. Run: node scripts/test-api.mjs
// Nothing here talks to a real store: every fetch goes to the fake below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProducts, clearTokenCache } from "../lib/shopify.mjs";
import { handleInsights, buildInsights, growthPct, forecast30, linearFit, addDays } from "../lib/insights.mjs";

const TOKEN = "shpat_TEST_SECRET_TOKEN_123456";
const ENV = {
  C3D_SHOPIFY_DOMAIN: "charleston3d.myshopify.com", C3D_ADMIN_TOKEN: TOKEN,
  ED_SHOPIFY_DOMAIN: "elevated-designs.myshopify.com", ED_ADMIN_TOKEN: "shpat_ED_SECRET_987654",
  CONSOLE_KEY: "open-sesame", INDEXNOW_KEY: "abc123indexnow",
};
const envOf = (over = {}) => (k) => (k in over ? over[k] : ENV[k]);
const PUB = "gid://shopify/Publication/1";
const PID = "gid://shopify/Product/101";

// ---------- fake Shopify ----------
function fakeShopify(opts = {}) {
  const calls = [];
  const product = (o = {}) => ({ id: PID, handle: "name-ornament", title: "Name Ornament", status: "DRAFT", productType: "Ornament",
    updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false,
    featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/x.jpg?v=1", altText: null } } },
    priceRangeV2: { minVariantPrice: { amount: "24.0", currencyCode: "USD" } }, publishedOnPublication: false, ...o });
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.indexnow.org")) {
      calls.push({ indexnow: JSON.parse(init.body) });
      if (opts.indexNow === "throw") throw new Error("network down");
      if (opts.indexNow === "hang") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return new Response("", { status: opts.indexNow === "500" ? 500 : 202 });
    }
    if (u.endsWith("/admin/oauth/access_token")) {
      const form = new URLSearchParams(init.body);
      calls.push({ oauth: Object.fromEntries(form) });
      if (form.get("client_secret") !== "dev-secret-value") return new Response(JSON.stringify({ error: "invalid_client", error_description: "bad dev-secret" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "shpat_FROM_CLIENT_CREDENTIALS", scope: "read_products", expires_in: 86399 }), { status: 200 });
    }
    assert.match(u, /^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/api\/2025-10\/graphql\.json$/);
    assert.ok(init.signal, "every Shopify call has a timeout signal");
    const { query, variables } = JSON.parse(init.body);
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)[1];
    calls.push({ op, variables, token: init.headers["X-Shopify-Access-Token"], domain: new URL(u).host });
    const data = (d) => new Response(JSON.stringify({ data: d }), { status: 200, headers: { "content-type": "application/json" } });
    if (opts.override?.[op]) return opts.override[op](variables, data);
    switch (op) {
      case "OnlineStorePublication": return data({ publications: { nodes: [
        { id: "gid://shopify/Publication/9", catalog: { title: "Point of Sale" }, channels: { nodes: [{ handle: "pos", name: "Point of Sale" }] } },
        { id: PUB, catalog: { title: "Online Store" }, channels: { nodes: [{ handle: "online_store", name: "Online Store" }] } }] } });
      case "ConsoleProducts": return data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        product({ status: "ACTIVE", publishedOnPublication: true, id: "gid://shopify/Product/100", handle: "keychain", title: "Keychain", totalInventory: 7, tracksInventory: true }),
        product()] } });
      case "ConsoleProduct": return data({ product: opts.missing ? null : product(opts.product) });
      case "ConsoleActivate": return data({ productUpdate: { product: { id: PID, status: "ACTIVE" }, userErrors: opts.activateErrors ?? [] } });
      case "ConsolePublish": return data({ publishablePublish: { userErrors: opts.publishErrors ?? [] } });
      case "ConsoleUnpublish": return data({ publishableUnpublish: { userErrors: [] } });
      default: throw new Error(`unexpected op ${op}`);
    }
  };
  return { fetch, calls };
}

const get = (q, headers = {}) => ({ method: "GET", query: new URLSearchParams(q), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => "" });
const post = (body, headers = { "content-type": "application/json", "x-console-key": "open-sesame" }) =>
  ({ method: "POST", query: new URLSearchParams(), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const noLeak = (res) => { const s = JSON.stringify(res); assert.ok(!s.includes(TOKEN) && !s.includes("shpat_"), `token leaked: ${s}`); };

// ---------- products ----------
test("list: products with live flag, public URL, admin URL", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(get({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200);
  const [live, draft] = res.body.products;
  assert.equal(live.live, true);
  assert.equal(live.url, "https://charleston3d.com/products/keychain");
  assert.equal(live.adminUrl, "https://admin.shopify.com/store/charleston3d/products/100");
  assert.equal(live.inventory, 7);
  assert.equal(draft.live, false);
  assert.equal(draft.inventory, null);
  assert.equal(draft.price, 24);
  assert.equal(sh.calls.filter((c) => c.op === "OnlineStorePublication").length, 1);
  assert.equal(sh.calls.find((c) => c.op === "ConsoleProducts").variables.pub, PUB, "uses the Online Store publication");
  noLeak(res);
});

test("list: ED uses its own domain, token and site URL override", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(get({ store: "ed" }), { env: envOf({ ED_SITE_URL: "https://shop.example.com/" }), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.equal(res.body.products[0].url, "https://shop.example.com/products/keychain");
  assert.ok(sh.calls.every((c) => !c.op || (c.domain === "elevated-designs.myshopify.com" && c.token === "shpat_ED_SECRET_987654")));
});

test("publish: activates, publishes to Online Store, pings IndexNow, returns live URL", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.live, true);
  assert.equal(res.body.url, "https://charleston3d.com/products/name-ornament");
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleProduct", "ConsoleActivate", "ConsolePublish"]);
  assert.deepEqual(sh.calls.find((c) => c.op === "ConsoleActivate").variables.product, { id: PID, status: "ACTIVE" });
  const ping = sh.calls.find((c) => c.indexnow).indexnow;
  assert.deepEqual(ping, { host: "charleston3d.com", key: "abc123indexnow", keyLocation: "https://charleston3d.com/pages/indexnow-key", urlList: ["https://charleston3d.com/products/name-ornament"] });
  assert.equal(res.body.indexNow.sent, true);
});

test("publish: already active skips the status update", async () => {
  const sh = fakeShopify({ product: { status: "ACTIVE" } });
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.ok(!sh.calls.some((c) => c.op === "ConsoleActivate"));
});

test("unpublish: removes from Online Store only", async () => {
  const sh = fakeShopify({ product: { status: "ACTIVE", publishedOnPublication: true } });
  const res = await handleProducts(post({ store: "ed", id: PID, live: false }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.equal(res.body.live, false);
  assert.equal(res.body.product.status, "ACTIVE");
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleProduct", "ConsoleUnpublish"]);
  assert.equal(res.body.url, "https://theelevateddesignsllc.com/products/name-ornament");
});

test("no INDEXNOW_KEY: nothing is pinged", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf({ INDEXNOW_KEY: undefined }), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.ok(!sh.calls.some((c) => c.indexnow));
  assert.equal(res.body.indexNow.sent, false);
});

for (const mode of ["throw", "500", "hang"])
  test(`IndexNow failure (${mode}) never fails the request`, async () => {
    const sh = fakeShopify({ indexNow: mode });
    const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
    assert.equal(res.status, 200);
    assert.equal(res.body.live, true);
    assert.equal(res.body.indexNow.sent, false);
  });

const BAD = [
  ["missing store", { id: PID, live: true }],
  ["unknown store", { store: "etsy", id: PID, live: true }],
  ["prototype store", { store: "__proto__", id: PID, live: true }],
  ["bad id", { store: "c3d", id: "123", live: true }],
  ["variant id", { store: "c3d", id: "gid://shopify/ProductVariant/1", live: true }],
  ["id injection", { store: "c3d", id: `${PID}"){}`, live: true }],
  ["live as string", { store: "c3d", id: PID, live: "true" }],
  ["extra field", { store: "c3d", id: PID, live: true, status: "ARCHIVED" }],
  ["array body", [1, 2]],
];
for (const [name, body] of BAD)
  test(`bad input (${name}) is 400 and never reaches Shopify`, async () => {
    const sh = fakeShopify();
    const res = await handleProducts(post(body), { env: envOf(), fetch: sh.fetch });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(typeof res.body.error, "string");
    assert.equal(sh.calls.length, 0);
  });

test("bad JSON is 400, wrong content type is 415, huge body is 413", async () => {
  const sh = fakeShopify();
  assert.equal((await handleProducts(post("{nope"), { env: envOf(), fetch: sh.fetch })).status, 400);
  assert.equal((await handleProducts(post("{}", { "content-type": "text/plain", "x-console-key": "open-sesame" }), { env: envOf(), fetch: sh.fetch })).status, 415);
  assert.equal((await handleProducts(post(JSON.stringify({ store: "c3d", pad: "x".repeat(5000) })), { env: envOf(), fetch: sh.fetch })).status, 413);
  assert.equal((await handleProducts(get({ store: "nope" }), { env: envOf(), fetch: sh.fetch })).status, 400);
  assert.equal(sh.calls.length, 0);
});

test("missing or wrong console key is 401", async () => {
  const sh = fakeShopify();
  const body = { store: "c3d", id: PID, live: true };
  const none = await handleProducts(post(body, { "content-type": "application/json" }), { env: envOf(), fetch: sh.fetch });
  const wrong = await handleProducts(post(body, { "content-type": "application/json", "x-console-key": "guess" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(sh.calls.length, 0);
});

test("CONSOLE_KEY unset: writes are refused (403), not allowed", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }, { "content-type": "application/json" }), { env: envOf({ CONSOLE_KEY: undefined }), fetch: sh.fetch });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "key_not_set");
  assert.equal(sh.calls.length, 0);
});

test("missing env is 503 naming the variables, and a non-myshopify domain is refused", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(get({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: "" }), fetch: sh.fetch });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "not_connected");
  assert.match(res.body.error, /ED_ADMIN_TOKEN/);
  const evil = await handleProducts(get({ store: "c3d" }), { env: envOf({ C3D_SHOPIFY_DOMAIN: "evil.example.com" }), fetch: sh.fetch });
  assert.equal(evil.status, 503);
  assert.equal(sh.calls.length, 0, "token is never sent to a non-Shopify host");
});

test("Dev Dashboard app: client credentials swapped for a token once, then cached", async () => {
  clearTokenCache();
  const sh = fakeShopify();
  const env = envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id", ED_CLIENT_SECRET: "dev-secret-value" });
  const one = await handleProducts(get({ store: "ed" }), { env, fetch: sh.fetch });
  const two = await handleProducts(get({ store: "ed" }), { env, fetch: sh.fetch });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(sh.calls.filter((c) => c.oauth).length, 1, "token reused while valid");
  assert.deepEqual(sh.calls.find((c) => c.oauth).oauth, { grant_type: "client_credentials", client_id: "dev-client-id", client_secret: "dev-secret-value" });
  assert.ok(sh.calls.filter((c) => c.op).every((c) => c.token === "shpat_FROM_CLIENT_CREDENTIALS"));
});

test("Dev Dashboard app: wrong secret is a clear 502 without leaking it; half-set is 503", async () => {
  clearTokenCache();
  const sh = fakeShopify();
  const res = await handleProducts(get({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id", ED_CLIENT_SECRET: "wrong-secret-xyz" }), fetch: sh.fetch });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "shopify_auth");
  assert.ok(!JSON.stringify(res.body).includes("wrong-secret-xyz"));
  const half = await handleProducts(get({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id" }), fetch: sh.fetch });
  assert.equal(half.status, 503);
  assert.match(half.body.error, /ED_CLIENT_ID and ED_CLIENT_SECRET/);
});

test("userErrors are propagated as 422 with Shopify's messages", async () => {
  const sh = fakeShopify({ publishErrors: [{ field: ["id"], message: "Product can't be published: missing price" }] });
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /missing price/);
  assert.equal(res.body.details.userErrors[0].message, "Product can't be published: missing price");
  assert.ok(!sh.calls.some((c) => c.indexnow), "no IndexNow ping when publishing failed");
});

test("unknown product is 404", async () => {
  const sh = fakeShopify({ missing: true });
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 404);
});

test("Shopify errors never leak the token", async () => {
  const sh = fakeShopify({ override: { OnlineStorePublication: () => new Response(JSON.stringify({ errors: [{ message: `Invalid token ${TOKEN}` }] }), { status: 200 }) } });
  const res = await handleProducts(get({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 502);
  noLeak(res);
  const auth = await handleProducts(get({ store: "c3d" }), { env: envOf(), fetch: fakeShopify({ override: { OnlineStorePublication: () => new Response("{}", { status: 401 }) } }).fetch });
  assert.equal(auth.status, 502);
  assert.equal(auth.body.code, "shopify_auth");
  noLeak(auth);
});

test("missing read_publications scope says which scope to add", async () => {
  const sh = fakeShopify({ override: { OnlineStorePublication: () => new Response(JSON.stringify({ errors: [{ message: "Access denied for publications field. Required access: `read_publications` access scope.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 }) } });
  const res = await handleProducts(get({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /read_publications/);
});

test("Shopify timeout is 504", async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const { adminClient } = await import("../lib/shopify.mjs");
  const client = adminClient({ domain: "x.myshopify.com", token: TOKEN, name: "Test", prefix: "C3D" }, hang, { timeoutMs: 50 });
  await assert.rejects(client.gql("query X { shop { name } }"), (e) => e.status === 504);
});

test("unsupported method is 405", async () => {
  const res = await handleProducts({ method: "DELETE", query: new URLSearchParams(), header: () => null, text: async () => "" }, { env: envOf(), fetch: fakeShopify().fetch });
  assert.equal(res.status, 405);
});

// ---------- insights maths ----------
const NOW = new Date("2026-10-25T15:00:00Z");
const TODAY = "2026-10-25";
function order(day, total, items = [["gid://shopify/Product/1", "Ornament", 1]], customer = null, extra = {}) {
  return { id: `o-${day}-${total}-${Math.random()}`, createdAt: `${day}T15:00:00Z`, cancelledAt: null, test: false,
    currentTotalPriceSet: { shopMoney: { amount: String(total), currencyCode: "USD" } },
    customer, ...extra,
    lineItems: { nodes: items.map(([id, title, qty]) => ({ title, quantity: qty, product: { id, title, handle: title.toLowerCase() }, discountedTotalSet: { shopMoney: { amount: String(total / items.length) } } })) } };
}

test("growth %: up, down, no base, both zero", () => {
  assert.equal(growthPct(150, 100), 50);
  assert.equal(growthPct(80, 100), -20);
  assert.equal(growthPct(10, 0), null);
  assert.equal(growthPct(0, 0), 0);
});

test("period totals and growth on fixture orders", () => {
  const nodes = [
    order(TODAY, 100), order(addDays(TODAY, -3), 50),             // last 7: 150, 2 orders
    order(addDays(TODAY, -8), 60), order(addDays(TODAY, -10), 40), // previous 7: 100
    order(addDays(TODAY, -2), 999, undefined, null, { cancelledAt: "2026-10-24T00:00:00Z" }), // ignored
    order(addDays(TODAY, -1), 999, undefined, null, { test: true }),                          // ignored
  ];
  const r = buildInsights({ store: "c3d", orderNodes: nodes, now: NOW, days: 30 });
  assert.deepEqual([r.periods["7"].current.revenue, r.periods["7"].current.orders, r.periods["7"].current.aov], [150, 2, 75]);
  assert.equal(r.periods["7"].previous.revenue, 100);
  assert.equal(r.periods["7"].growth.revenue, 50);
  assert.equal(r.periods["7"].growth.orders, 0);
  assert.equal(r.periods["7"].growth.aov, 50);
  assert.equal(r.periods["30"].current.revenue, 250);
  assert.equal(r.series.length, 30);
  assert.equal(r.series.at(-1).date, TODAY);
  assert.equal(r.series.at(-1).revenue, 100);
});

test("linear fit recovers a straight line", () => {
  const f = linearFit([10, 20, 30, 40]);
  assert.equal(Math.round(f.slope), 10);
  assert.equal(Math.round(f.intercept), 10);
  assert.equal(Math.round(f.r2 * 100), 100);
});

test("forecast: weekly linear trend projected 30 days", () => {
  // 8 weeks, revenue 100, 110, ..., 170 per week (one order on the last day of each week).
  const nodes = Array.from({ length: 8 }, (_, i) => order(addDays(TODAY, -7 * (7 - i)), 100 + 10 * i));
  const orders = nodes.map((o) => ({ day: o.createdAt.slice(0, 10), total: Number(o.currentTotalPriceSet.shopMoney.amount), items: [] }));
  const f = forecast30(orders, TODAY, { weeks: 8, firstOrderDay: addDays(TODAY, -60) });
  assert.equal(f.method, "linear-weekly");
  assert.equal(f.weeksUsed, 8);
  assert.equal(f.slopePerWeek, 10);
  // Next weeks on the line: 180, 190, 200, 210, plus 2/7 of 220.
  assert.deepEqual(f.projected.map((p) => p.revenue), [180, 190, 200, 210]);
  assert.equal(f.next30, Math.round((780 + (2 / 7) * 220) * 100) / 100);
  assert.equal(f.low, f.next30); // perfect fit, no spread
  assert.match(f.explanation, /straight line/);
});

test("forecast: falls back to 30-day average with little history, seasonal note in Nov–Dec", () => {
  const orders = [{ day: TODAY, total: 300, items: [] }];
  const f = forecast30(orders, TODAY, { firstOrderDay: TODAY });
  assert.equal(f.method, "average");
  assert.equal(f.next30, 300);
  assert.ok(f.seasonalNote, "window runs into November");
  const june = forecast30(orders, "2026-06-01", {});
  assert.equal(june.seasonalNote, null);
});

test("best sellers, losing momentum, repeat customers, suggestions", () => {
  const A = "gid://shopify/Product/A", B = "gid://shopify/Product/B";
  const c1 = { id: "gid://shopify/Customer/1", numberOfOrders: "3" }, c2 = { id: "gid://shopify/Customer/2", numberOfOrders: "1" };
  const nodes = [
    // previous 30 days: B sold 4 for 200
    ...[35, 36, 37, 38].map((d) => order(addDays(TODAY, -d), 50, [[B, "Bear", 1]], c2)),
    // last 30 days: A sold 3 for 300, B sold 1 for 50
    order(addDays(TODAY, -1), 100, [[A, "Anchor", 1]], c1), order(addDays(TODAY, -2), 100, [[A, "Anchor", 1]], c1),
    order(addDays(TODAY, -3), 100, [[A, "Anchor", 1]], null), order(addDays(TODAY, -4), 50, [[B, "Bear", 1]], c2),
  ];
  const r = buildInsights({ store: "c3d", orderNodes: nodes, now: NOW, days: 30 });
  assert.equal(r.topProducts[0].title, "Anchor");
  assert.equal(r.topProducts[0].revenue, 300);
  assert.equal(r.topProducts[0].share, 85.7);
  assert.equal(r.losingMomentum[0].title, "Bear");
  assert.equal(r.losingMomentum[0].previousRevenue, 200);
  assert.equal(r.rising[0].title, "Anchor");
  assert.deepEqual([r.repeatCustomers.customers, r.repeatCustomers.repeat, r.repeatCustomers.rate], [2, 1, 50]);
  assert.ok(r.suggestions.some((s) => s.includes("Bear")), r.suggestions.join("\n"));
  assert.ok(r.suggestions.some((s) => /Holiday/.test(s)));
});

test("sessions from ShopifyQL rows (objects or arrays), conversion as %", async () => {
  const { shopifyqlRows, sessionsSummary } = await import("../lib/insights.mjs");
  const table = { columns: [{ name: "day" }, { name: "sessions" }, { name: "conversion_rate" }], rows: [["2026-10-24", 100, 0.02], ["2026-10-25", 300, 0.01]] };
  const s = sessionsSummary(shopifyqlRows(table), 5);
  assert.equal(s.total, 400);
  assert.equal(s.conversionRate, 1.25);
  const s2 = sessionsSummary([{ day: "2026-10-25", sessions: "50", conversion_rate: "2.0" }], 1);
  assert.equal(s2.conversionRate, 2);
});

// ---------- insights endpoint ----------
function fakeInsightsShopify({ denyOrders = false, denyCustomers = false, denyReports = false } = {}) {
  const ok = (d) => new Response(JSON.stringify({ data: d }), { status: 200 });
  const denied = (scope, field) => new Response(JSON.stringify({ data: null, errors: [{ message: `Access denied for ${field} field. Required access: \`${scope}\` access scope.`, extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 });
  const calls = [];
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const op = /query\s+(\w+)/.exec(query)[1];
    calls.push({ op, variables, query });
    if (op === "ConsoleShop") return ok({ shop: { currencyCode: "USD", ianaTimezone: "America/New_York" } });
    if (op === "ConsoleOrders") {
      if (denyOrders) return denied("read_orders", "orders");
      if (denyCustomers && query.includes("customer {")) return denied("read_customers", "customer");
      return ok({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [order("2026-10-20", 40), order("2026-10-10", 60)] } });
    }
    if (op === "ConsoleSessions") {
      if (denyReports) return denied("read_reports", "shopifyqlQuery");
      return ok({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: "day" }, { name: "sessions" }, { name: "conversion_rate" }], rows: [{ day: "2026-10-25", sessions: 40, conversion_rate: 0.025 }] } } });
    }
    throw new Error(op);
  };
  return { fetch, calls };
}
const keyed = (q) => get(q, { "x-console-key": "open-sesame" });

test("insights: full response with sessions", async () => {
  const sh = fakeInsightsShopify();
  const res = await handleInsights(keyed({ store: "ed", days: "90" }), { env: envOf(), fetch: sh.fetch, now: () => NOW });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.periods["30"].current.revenue, 100);
  assert.equal(res.body.sessions.total, 40);
  assert.equal(res.body.sessions.conversionRate, 2.5);
  assert.equal(res.body.timeZone, "America/New_York");
  assert.deepEqual(res.body.missingScopes, []);
  assert.ok(sh.calls.find((c) => c.op === "ConsoleOrders").variables.q.startsWith("created_at:>=2026-04-28"), "reads 180 days for 90-day comparisons");
  assert.ok(res.body.suggestions.length > 0);
});

test("insights: missing read_reports degrades sessions and names the scope", async () => {
  const res = await handleInsights(keyed({ store: "c3d" }), { env: envOf(), fetch: fakeInsightsShopify({ denyReports: true }).fetch, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessions.available, false);
  assert.deepEqual(res.body.missingScopes.map((m) => m.scope), ["read_reports"]);
  assert.equal(res.body.orders.available, true);
});

test("insights: missing read_orders degrades sales and names the scope", async () => {
  const res = await handleInsights(keyed({ store: "c3d" }), { env: envOf(), fetch: fakeInsightsShopify({ denyOrders: true }).fetch, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.available, false);
  assert.ok(res.body.missingScopes.some((m) => m.scope === "read_orders"));
  assert.match(res.body.suggestions[0], /read_orders/);
});

test("insights: customer data denied retries without it", async () => {
  const sh = fakeInsightsShopify({ denyCustomers: true });
  const res = await handleInsights(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.available, true);
  assert.ok(res.body.missingScopes.some((m) => m.scope === "read_customers"));
  assert.equal(sh.calls.filter((c) => c.op === "ConsoleOrders").length, 2);
});

test("insights: needs the key, valid store and days, and env", async () => {
  const ctx = { env: envOf(), fetch: fakeInsightsShopify().fetch, now: () => NOW };
  assert.equal((await handleInsights(get({ store: "c3d" }), ctx)).status, 401);
  assert.equal((await handleInsights(keyed({ store: "c3d", days: "abc" }), ctx)).status, 400);
  assert.equal((await handleInsights(keyed({ store: "c3d", days: "9999" }), ctx)).status, 400);
  assert.equal((await handleInsights(keyed({ store: "x" }), ctx)).status, 400);
  assert.equal((await handleInsights(keyed({ store: "c3d" }), { ...ctx, env: envOf({ C3D_SHOPIFY_DOMAIN: undefined }) })).status, 503);
  assert.equal((await handleInsights(get({ store: "c3d" }), { ...ctx, env: envOf({ CONSOLE_KEY: undefined }) })).status, 403);
});
