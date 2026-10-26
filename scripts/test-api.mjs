// API tests with Shopify mocked out. Run: node scripts/test-api.mjs
// Nothing here talks to a real store: every fetch goes to the fake below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProducts, clearTokenCache } from "../lib/shopify.mjs";
import { handleInsights, buildInsights, growthPct, forecast30, linearFit, addDays } from "../lib/insights.mjs";
import { schemaErrors, variableErrors, checked } from "./schema/validate.mjs";

// Every GraphQL string a fake Shopify receives is checked against the real Admin API 2025-10
// schema (query fields and arguments, and the variables' input types). Problems are collected
// here, not thrown inside fetch, where the client would report them as a network error.
const schemaProblems = [];
function checkGraphql(query, variables) {
  const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "(anonymous)";
  for (const m of [...schemaErrors(query), ...variableErrors(query, variables)]) schemaProblems.push(`${op}: ${m}`);
}

const TOKEN = "shpat_TEST_SECRET_TOKEN_123456";
const ENV = {
  C3D_SHOPIFY_DOMAIN: "charleston3d.myshopify.com", C3D_ADMIN_TOKEN: TOKEN,
  ED_SHOPIFY_DOMAIN: "elevated-designs.myshopify.com", ED_ADMIN_TOKEN: "shpat_ED_SECRET_987654",
  CONSOLE_KEY: "open-sesame-test-key-0001", INDEXNOW_KEY: "abc123indexnow",
};
const envOf = (over = {}) => (k) => (k in over ? over[k] : ENV[k]);
const PUB = "gid://shopify/Publication/1";
const PID = "gid://shopify/Product/101";
const STAGED_URL = "https://shopify-staged-uploads.storage.googleapis.com/";
const OPERATION = "gid://shopify/ProductSetOperation/42";

// ---------- fake Shopify ----------
function fakeShopify(opts = {}) {
  const calls = [];
  const product = (o = {}) => ({ id: PID, handle: "name-ornament", title: "Name Ornament", status: "DRAFT", productType: "Ornament",
    updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false,
    featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/x.jpg?v=1", altText: null } } },
    priceRangeV2: { minVariantPrice: { amount: "24.0", currencyCode: "USD" } }, publishedOnPublication: false, tags: [], ...o });
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
    if (u.startsWith(STAGED_URL)) {
      const form = init.body;
      const file = form.get("file");
      calls.push({ upload: { fields: Object.fromEntries([...form.entries()].filter(([k]) => k !== "file")), size: file.size, type: file.type, name: file.name } });
      if (opts.upload === "throw") throw new Error("socket hang up");
      return new Response("", { status: opts.upload === "403" ? 403 : 201 });
    }
    if (!/^https:\/\/[a-z0-9-]+\.myshopify\.com\//.test(u)) calls.push({ stray: u });
    assert.match(u, /^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/api\/2025-10\/graphql\.json$/);
    assert.ok(init.signal, "every Shopify call has a timeout signal");
    const { query, variables } = JSON.parse(init.body);
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)[1];
    calls.push({ op, variables, token: init.headers["X-Shopify-Access-Token"], domain: new URL(u).host });
    checkGraphql(query, variables);
    const data = (d) => new Response(JSON.stringify({ data: d }), { status: 200, headers: { "content-type": "application/json" } });
    if (opts.override?.[op]) return opts.override[op](variables, data);
    switch (op) {
      case "OnlineStorePublication":
        // Admin API 2025-10 has no Publication.channels; the Online Store is the app catalog titled "Online Store".
        assert.ok(!/channels/.test(query), "Publication.channels doesn't exist in 2025-10");
        assert.match(query, /publications\(first: 50, catalogType: APP\)/);
        return data({ publications: { nodes: opts.publications ?? [
          { id: "gid://shopify/Publication/9", catalog: { title: "Point of Sale" } },
          { id: "gid://shopify/Publication/7", catalog: null },
          { id: PUB, catalog: { title: "Online Store" } }] } });
      case "ConsoleProducts": return data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        product({ status: "ACTIVE", publishedOnPublication: true, id: "gid://shopify/Product/100", handle: "keychain", title: "Keychain", totalInventory: 7, tracksInventory: true }),
        product()] } });
      case "ConsoleProduct": return data({ product: opts.missing ? null : product(opts.product) });
      case "ConsoleActivate": return data({ productUpdate: { product: { id: PID, status: "ACTIVE" }, userErrors: opts.activateErrors ?? [] } });
      case "ConsolePublish": return data({ publishablePublish: { userErrors: opts.publishErrors ?? [] } });
      case "ConsoleUnpublish": return data({ publishableUnpublish: { userErrors: [] } });
      case "ConsoleProductTags": return data({ product: opts.missing ? null : { id: variables.id, tags: opts.product?.tags ?? [] } });
      case "ConsoleTagsAdd": return data({ tagsAdd: { node: { id: variables.id }, userErrors: opts.tagErrors ?? [] } });
      case "ConsoleTagsRemove": return data({ tagsRemove: { node: { id: variables.id }, userErrors: opts.tagErrors ?? [] } });
      case "ConsoleListingLookup": return data({ products: { nodes: opts.listed ?? [] } });
      case "ConsoleStagedUpload": return data({ stagedUploadsCreate: opts.stageErrors
        ? { stagedTargets: [], userErrors: opts.stageErrors }
        : { stagedTargets: [{ url: opts.stagedUrl ?? STAGED_URL, resourceUrl: opts.resourceUrl ?? `${STAGED_URL}tmp/123/${variables.input[0].filename}`,
          parameters: [{ name: "Content-Type", value: variables.input[0].mimeType }, { name: "key", value: "tmp/123/x" }, { name: "policy", value: "abc" }] }], userErrors: [] } });
      case "ConsoleListingCreate": return data({ productSet: opts.createErrors
        ? { product: null, productSetOperation: null, userErrors: opts.createErrors }
        : variables.synchronous
          ? { product: { id: "gid://shopify/Product/555", handle: "lowcountry-sunset-tee", title: variables.input.title, status: "ACTIVE" }, productSetOperation: null, userErrors: [] }
          : { product: null, productSetOperation: { id: OPERATION, status: "CREATED" }, userErrors: [] } });
      case "ConsoleListingOperation": {
        // opts.operation: statuses returned in turn (the last one repeats), or "errors" / "missing"
        if (opts.operation === "missing") return data({ productOperation: null });
        const seq = opts.operation ?? ["ACTIVE", "COMPLETE"];
        const status = seq[Math.min(calls.filter((c) => c.op === "ConsoleListingOperation").length - 1, seq.length - 1)];
        return data({ productOperation: { id: variables.id, status,
          product: status === "COMPLETE" ? { id: "gid://shopify/Product/556", handle: "big-tee", title: "Big Tee", status: "ACTIVE" } : null,
          userErrors: opts.operationErrors ?? [] } });
      }
      default: throw new Error(`unexpected op ${op}`);
    }
  };
  return { fetch, calls };
}

const get = (q, headers = {}) => ({ method: "GET", query: new URLSearchParams(q), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => "" });
const keyed = (q) => get(q, { "x-console-key": "open-sesame-test-key-0001" });
const post = (body, headers = { "content-type": "application/json", "x-console-key": "open-sesame-test-key-0001" }) =>
  ({ method: "POST", query: new URLSearchParams(), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const noLeak = (res) => { const s = JSON.stringify(res); assert.ok(!s.includes(TOKEN) && !s.includes("shpat_"), `token leaked: ${s}`); };

// ---------- products ----------
test("list: products with live flag, public URL, admin URL", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
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
  const res = await handleProducts(keyed({ store: "ed" }), { env: envOf({ ED_SITE_URL: "https://shop.example.com/" }), fetch: sh.fetch });
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
  assert.deepEqual(ping, { host: "charleston3d.com", key: "abc123indexnow", keyLocation: "https://charleston3d.com/abc123indexnow.txt", urlList: ["https://charleston3d.com/products/name-ornament"] });
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
  assert.equal((await handleProducts(post("{}", { "content-type": "text/plain", "x-console-key": "open-sesame-test-key-0001" }), { env: envOf(), fetch: sh.fetch })).status, 415);
  assert.equal((await handleProducts(post(JSON.stringify({ store: "c3d", pad: "x".repeat(5000) })), { env: envOf(), fetch: sh.fetch })).status, 413);
  assert.equal((await handleProducts(keyed({ store: "nope" }), { env: envOf(), fetch: sh.fetch })).status, 400);
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
  const res = await handleProducts(keyed({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: "" }), fetch: sh.fetch });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "not_connected");
  assert.match(res.body.error, /ED_ADMIN_TOKEN/);
  const evil = await handleProducts(keyed({ store: "c3d" }), { env: envOf({ C3D_SHOPIFY_DOMAIN: "evil.example.com" }), fetch: sh.fetch });
  assert.equal(evil.status, 503);
  assert.equal(sh.calls.length, 0, "token is never sent to a non-Shopify host");
});

test("Dev Dashboard app: client credentials swapped for a token once, then cached", async () => {
  clearTokenCache();
  const sh = fakeShopify();
  const env = envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id", ED_CLIENT_SECRET: "dev-secret-value" });
  const one = await handleProducts(keyed({ store: "ed" }), { env, fetch: sh.fetch });
  const two = await handleProducts(keyed({ store: "ed" }), { env, fetch: sh.fetch });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(sh.calls.filter((c) => c.oauth).length, 1, "token reused while valid");
  assert.deepEqual(sh.calls.find((c) => c.oauth).oauth, { grant_type: "client_credentials", client_id: "dev-client-id", client_secret: "dev-secret-value" });
  assert.ok(sh.calls.filter((c) => c.op).every((c) => c.token === "shpat_FROM_CLIENT_CREDENTIALS"));
});

test("Dev Dashboard app: wrong secret is a clear 502 without leaking it; half-set is 503", async () => {
  clearTokenCache();
  const sh = fakeShopify();
  const res = await handleProducts(keyed({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id", ED_CLIENT_SECRET: "wrong-secret-xyz" }), fetch: sh.fetch });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "shopify_auth");
  assert.ok(!JSON.stringify(res.body).includes("wrong-secret-xyz"));
  const half = await handleProducts(keyed({ store: "ed" }), { env: envOf({ ED_ADMIN_TOKEN: undefined, ED_CLIENT_ID: "dev-client-id" }), fetch: sh.fetch });
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
  const res = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 502);
  noLeak(res);
  const auth = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: fakeShopify({ override: { OnlineStorePublication: () => new Response("{}", { status: 401 }) } }).fetch });
  assert.equal(auth.status, 502);
  assert.equal(auth.body.code, "shopify_auth");
  noLeak(auth);
});

test("no Online Store publication is a clear 502", async () => {
  const sh = fakeShopify({ publications: [{ id: "gid://shopify/Publication/9", catalog: { title: "Point of Sale" } }] });
  const res = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "no_online_store");
});

test("missing read_publications scope says which scope to add", async () => {
  const sh = fakeShopify({ override: { OnlineStorePublication: () => new Response(JSON.stringify({ errors: [{ message: "Access denied for publications field. Required access: `read_publications` access scope.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 }) } });
  const res = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
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

test("forecast: falls back to the daily average with little history, seasonal note in Nov–Dec", () => {
  const orders = [{ day: TODAY, total: 300, items: [] }];
  const f = forecast30(orders, TODAY, {});
  assert.equal(f.method, "average");
  assert.equal(f.next30, 300, "a full 30 days of history repeats the last 30 days");
  assert.equal(f.seasonal, "holiday");
  assert.ok(f.seasonalNote, "window runs into November");
  const june = forecast30(orders, "2026-06-01", {});
  assert.equal(june.seasonalNote, null);
});

test("forecast: one week of sales is scaled to 30 days, not repeated as a month", () => {
  const start = addDays(TODAY, -6);
  const orders = Array.from({ length: 7 }, (_, i) => ({ day: addDays(start, i), total: 10, items: [] })); // $10 a day for 7 days
  const f = forecast30(orders, TODAY, { firstOrderDay: start });
  assert.equal(f.method, "average");
  assert.equal(f.weeksUsed, 1);
  assert.equal(f.next30, 300);
  assert.match(f.explanation, /7 days of sales/);
  const first = forecast30([{ day: TODAY, total: 25, items: [] }], TODAY, { firstOrderDay: TODAY });
  assert.equal(first.next30, 750, "first day of sales");
  assert.equal(forecast30([], TODAY, {}).next30, 0, "no sales at all");
});

test("insights: $0 orders (free custom print requests) are not counted as sales", async () => {
  const now = new Date(`${TODAY}T15:00:00Z`);
  const r = buildInsights({ store: "c3d", now, days: 30, orderNodes: [order(TODAY, 40), order(TODAY, 0, [["gid://shopify/Product/9", "Custom 3D print request", 1]])] });
  const p30 = r.periods["30"];
  assert.equal(p30.current.orders, 1);
  assert.equal(p30.current.aov, 40);
});

test("forecast: holiday season vs after Christmas", async () => {
  const { seasonOf } = await import("../lib/insights.mjs");
  assert.equal(seasonOf("2026-10-01"), null, "Oct 1 window ends Oct 31");
  assert.equal(seasonOf("2026-10-02"), "holiday");
  assert.equal(seasonOf("2026-12-12"), "holiday", "Dec 13 Priority cutoff still ahead");
  assert.equal(seasonOf("2026-12-13", [{ end: "2026-12-13", revenue: 500 }]), "post-holiday", "cutoff passed");
  assert.equal(seasonOf("2027-01-10", [{ end: "2026-12-20", revenue: 500 }]), "post-holiday");
  assert.equal(seasonOf("2026-12-28", [{ end: "2026-12-20", revenue: 0 }]), null, "no holiday sales to warn about");
  // The "holiday season is next" suggestion stops once the order-by dates have passed.
  const dec = buildInsights({ store: "c3d", orderNodes: [order("2026-12-15", 50)], now: new Date("2026-12-20T15:00:00Z"), days: 30 });
  assert.equal(dec.forecast.seasonal, "post-holiday");
  assert.ok(!dec.suggestions.some((t) => /Holiday season is next/.test(t)), dec.suggestions.join("\n"));
  assert.match(dec.forecast.seasonalNote, /after Christmas/);
  const nov = buildInsights({ store: "ed", orderNodes: [order("2026-11-15", 50)], now: new Date("2026-11-20T15:00:00Z"), days: 30 });
  assert.ok(nov.suggestions.some((t) => /Holiday season is next/.test(t)));
});

test("growth %: zero previous period, zero current, AOV with no orders", () => {
  const r = buildInsights({ store: "c3d", orderNodes: [order(TODAY, 80)], now: NOW, days: 30 });
  assert.equal(r.periods["7"].growth.revenue, null, "nothing before: no % (UI says New)");
  assert.equal(r.periods["7"].growth.aov, null);
  assert.equal(r.periods["7"].previous.aov, 0);
  const none = buildInsights({ store: "c3d", orderNodes: [], now: NOW, days: 30 });
  assert.deepEqual(none.periods["30"].growth, { revenue: 0, orders: 0, aov: 0 });
  assert.equal(none.forecast.next30, 0);
  assert.equal(none.series.length, 30);
  assert.ok(none.series.every((d) => d.revenue === 0));
  assert.match(none.suggestions[0], /No orders in the last 30 days/);
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

test("suggestions don't call a trend or a one-product store on a handful of orders", () => {
  const A = "gid://shopify/Product/A";
  // 1 order the month before, 3 this month: +200%, and A is 100% of revenue.
  const nodes = [order(addDays(TODAY, -40), 50, [[A, "Anchor", 1]]), ...[1, 2, 3].map((d) => order(addDays(TODAY, -d), 50, [[A, "Anchor", 1]]))];
  const r = buildInsights({ store: "ed", orderNodes: nodes, now: NOW, days: 30 });
  assert.equal(r.periods["30"].growth.revenue, 200);
  assert.ok(r.suggestions.some((s) => /too few to call a trend/.test(s)), r.suggestions.join("\n"));
  assert.ok(!r.suggestions.some((s) => /Sales are (up|down)|carrying the store/.test(s)), r.suggestions.join("\n"));
});

test("sessions from ShopifyQL rows (objects or arrays), conversion as %", async () => {
  const { shopifyqlRows, sessionsSummary } = await import("../lib/insights.mjs");
  const table = { columns: [{ name: "day" }, { name: "sessions" }, { name: "conversion_rate" }], rows: [["2026-10-24", 100, 0.02], ["2026-10-25", 300, 0.01]] };
  const s = sessionsSummary(shopifyqlRows(table), 5);
  assert.equal(s.total, 400);
  assert.equal(s.conversionRate, 1.25);
  // Real 2025-10 shape: rows are objects keyed by column name, every value a string, PERCENT as a
  // decimal (0.25 = 25%). A conversion rate under 1% must stay under 1%.
  const s2 = sessionsSummary([{ day: "2026-10-24", sessions: "0", conversion_rate: null }, { day: "2026-10-25", sessions: "50", conversion_rate: "0.008" }], 1);
  assert.equal(s2.total, 50);
  assert.equal(s2.conversionRate, 0.8);
  assert.deepEqual(s2.series.map((r) => r.conversionRate), [null, 0.8], "per-day rates are % too");
  const s3 = sessionsSummary([{ day: "2026-10-25", sessions: "200" }], 3);
  assert.equal(s3.conversionRate, 1.5, "no conversion column: orders / sessions");
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
    checkGraphql(query, variables);
    if (op === "ConsoleShop") return ok({ shop: { currencyCode: "USD", ianaTimezone: "America/New_York" } });
    if (op === "ConsoleOrders") {
      if (denyOrders) return denied("read_orders", "orders");
      if (denyCustomers && query.includes("customer {")) return denied("read_customers", "customer");
      return ok({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [order("2026-10-20", 40), order("2026-10-10", 60)] } });
    }
    if (op === "ConsoleSessions") {
      if (denyReports) return denied("read_reports", "shopifyqlQuery");
      return ok({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: "day", dataType: "DAY_TIMESTAMP" }, { name: "sessions", dataType: "INTEGER" }, { name: "conversion_rate", dataType: "PERCENT" }], rows: [{ day: "2026-10-25", sessions: "40", conversion_rate: "0.025" }] } } });
    }
    throw new Error(op);
  };
  return { fetch, calls };
}

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
  assert.equal(sh.calls.find((c) => c.op === "ConsoleSessions").variables.q,
    "FROM sessions SHOW sessions, conversion_rate TIMESERIES day SINCE -89d UNTIL today ORDER BY day ASC", "90 days including today");
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

test("insights: protected customer data denial (no scope named) still shows sales", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    const op = /query\s+(\w+)/.exec(query)[1];
    calls.push(op);
    const ok = (d) => new Response(JSON.stringify({ data: d }), { status: 200 });
    if (op === "ConsoleShop") return ok({ shop: { currencyCode: "USD", ianaTimezone: "UTC" } });
    if (op === "ConsoleOrders" && query.includes("customer {"))
      return new Response(JSON.stringify({ errors: [{ message: "This app is not approved to access the Customer object.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 });
    if (op === "ConsoleOrders") return ok({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [order("2026-10-20", 40)] } });
    return ok({ shopifyqlQuery: { parseErrors: ["Table not found: sessions"], tableData: null } });
  };
  const res = await handleInsights(keyed({ store: "c3d", days: "30" }), { env: envOf(), fetch, now: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.available, true, "sales still shown");
  assert.equal(res.body.periods["30"].current.revenue, 40);
  assert.ok(!res.body.missingScopes.some((m) => m.scope === "read_orders"));
  assert.equal(res.body.sessions.available, false, "parse errors degrade sessions");
});

test("insights: more orders than one read shows the truncated note", async () => {
  let page = 0;
  let t = NOW.getTime();
  const fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    const op = /query\s+(\w+)/.exec(query)[1];
    const ok = (d) => new Response(JSON.stringify({ data: d }), { status: 200 });
    if (op === "ConsoleShop") return ok({ shop: { currencyCode: "USD", ianaTimezone: "UTC" } });
    if (op === "ConsoleOrders") { t += 3000; page++; return ok({ orders: { pageInfo: { hasNextPage: true, endCursor: `c${page}` }, nodes: [order("2026-10-20", 10)] } }); }
    return ok({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } } });
  };
  const res = await handleInsights(keyed({ store: "c3d", days: "30" }), { env: envOf(), fetch, now: () => new Date(t) });
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.truncated, true);
  assert.ok(page < 30, "stops on the time budget");
  assert.ok(res.body.notes.some((n) => /more orders than the console reads/.test(n)));
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

// ---------- security regressions ----------
const KEYH = { "x-console-key": "open-sesame-test-key-0001" };

test("product list needs the console key, before any Shopify call", async () => {
  const sh = fakeShopify();
  const none = await handleProducts(get({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(none.status, 401);
  const wrong = await handleProducts(get({ store: "c3d" }, { "x-console-key": "open-sesame-test-key-0002" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(wrong.status, 401);
  assert.equal((await handleProducts(get({ store: "c3d" }), { env: envOf({ CONSOLE_KEY: undefined }), fetch: sh.fetch })).status, 403);
  assert.equal(sh.calls.length, 0, "no Shopify call without the key");
  assert.ok(!JSON.stringify(none).includes("open-sesame"), "key never echoed");
});

test("a CONSOLE_KEY shorter than 16 characters is refused everywhere", async () => {
  const sh = fakeShopify();
  const env = envOf({ CONSOLE_KEY: "short-key" });
  const h = { "x-console-key": "short-key" };
  const list = await handleProducts(get({ store: "c3d" }, h), { env, fetch: sh.fetch });
  assert.equal(list.status, 403);
  assert.equal(list.body.code, "key_too_short");
  assert.equal((await handleProducts(post({ store: "c3d", id: PID, live: true }, { "content-type": "application/json", ...h }), { env, fetch: sh.fetch })).status, 403);
  assert.equal((await handleInsights(get({ store: "c3d" }, h), { env, fetch: sh.fetch, now: () => NOW })).status, 403);
  assert.equal(sh.calls.length, 0);
});

test("Netlify adapter: JSON responses are nosniff, unframeable and sandboxed", async () => {
  const { netlifyHandler } = await import("../lib/netlify.mjs");
  const res = await netlifyHandler(async () => ({ status: 200, body: { a: 1 } }))(new Request("https://console.example/api/x"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'.*sandbox/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ---------- image library ----------
const { handleImages } = await import("../lib/images.mjs");
function fakeBlobs() {
  const m = new Map();
  return { m,
    list: async () => ({ blobs: [...m.keys()].map((key) => ({ key })) }),
    getMetadata: async (k) => (m.has(k) ? { metadata: m.get(k).metadata } : null),
    getWithMetadata: async (k) => (m.has(k) ? { data: m.get(k).data, metadata: m.get(k).metadata } : null),
    set: async (k, data, { metadata }) => { m.set(k, { data, metadata }); },
    delete: async (k) => { m.delete(k); },
  };
}
const imgReq = (path, { method = "GET", headers = {}, body } = {}) => new Request(`https://console.example${path}`, { method, headers, body });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EVIL_SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>`;

test("images: list and writes need the key; files are public by unguessable key", async () => {
  const blobs = fakeBlobs(), ctx = { blobs, env: envOf() };
  assert.equal((await handleImages(imgReq("/api/images"), ctx)).status, 401, "list needs the key");
  assert.equal((await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png" }, body: PNG }), ctx)).status, 401);
  const up = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", "x-filename": "a.png", ...KEYH }, body: PNG }), ctx);
  assert.equal(up.status, 201);
  const { item } = await up.json();
  assert.match(item.key, /^[a-z0-9]+-[0-9a-f]{8}$/);
  const list = await handleImages(imgReq("/api/images", { headers: KEYH }), ctx);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items[0].name, "a.png");
  const file = await handleImages(imgReq(`/api/images/${item.key}`), ctx);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`, { method: "DELETE" }), ctx)).status, 401);
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`, { method: "DELETE", headers: KEYH }), ctx)).status, 200);
  assert.equal(blobs.m.size, 0);
});

test("images: content must match the declared type, and only image types are taken", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const asPng = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: html }), ctx);
  assert.equal(asPng.status, 415, "HTML bytes claiming to be PNG are refused");
  const asSvg = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/svg+xml", ...KEYH }, body: html }), ctx);
  assert.equal(asSvg.status, 415, "HTML claiming to be SVG is refused");
  assert.equal((await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "text/html", ...KEYH }, body: html }), ctx)).status, 415);
  const big = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", "content-length": String(7 * 1024 * 1024), ...KEYH }, body: PNG }), ctx);
  assert.equal(big.status, 413);
  assert.equal(ctx.blobs.m.size, 0);
});

test("images: an SVG with script is never rendered on the console's origin", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  const up = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/svg+xml", ...KEYH }, body: EVIL_SVG }), ctx);
  assert.equal(up.status, 201);
  const file = await handleImages(imgReq(`/api/images/${(await up.json()).item.key}`), ctx);
  assert.equal(file.headers.get("content-type"), "image/svg+xml");
  assert.equal(file.headers.get("content-disposition"), "attachment");
  assert.match(file.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
});

test("images: odd keys are 404, not a crash", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  for (const p of ["/api/images/%E0%A4%A", "/api/images/..%2Fx", "/api/images/not-a-key"])
    assert.equal((await handleImages(imgReq(p), ctx)).status, 404, p);
});

// ---------- what gets published ----------
test("netlify.toml publishes only index.html and assets/, with CSP and frame-ancestors", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const build = toml.split("[dev]")[0];
  assert.match(build, /publish = "dist"/);
  const cmd = /command = "([^"]+)"/.exec(build)[1];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-build-"));
  for (const f of ["index.html", "assets", "lib", "scripts", "netlify", "package.json", "README.md", "netlify.toml"])
    fs.cpSync(path.join(root, f), path.join(tmp, f), { recursive: true });
  execSync(cmd, { cwd: tmp, shell: "/bin/sh" });
  assert.deepEqual(fs.readdirSync(path.join(tmp, "dist")).sort(), ["assets", "index.html"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
  for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.match(toml, /X-Content-Type-Options = "nosniff"/);
  assert.match(toml, /Referrer-Policy = /);
});

// ---------- customizable (Charleston 3D only) ----------
const { handleListings, libraryReader, listingTemplate } = await import("../lib/listings.mjs");

test("list: Charleston 3D products say whether they're customizable (any case); ED products don't carry it", async () => {
  const sh = fakeShopify({ override: { ConsoleProducts: (v, data) => data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    { id: "gid://shopify/Product/1", handle: "a", title: "A", status: "ACTIVE", productType: "", tags: ["Customizable", "gift"], updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false, featuredMedia: null, priceRangeV2: null, publishedOnPublication: true },
    { id: "gid://shopify/Product/2", handle: "b", title: "B", status: "ACTIVE", productType: "", tags: ["customizable-ish"], updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false, featuredMedia: null, priceRangeV2: null, publishedOnPublication: true }] } }) } });
  const c3d = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.deepEqual(c3d.body.products.map((p) => p.customizable), [true, false]);
  const ed = await handleProducts(keyed({ store: "ed" }), { env: envOf(), fetch: sh.fetch });
  assert.ok(ed.body.products.every((p) => !("customizable" in p)));
});

test("customizable on: adds the tag with tagsAdd and returns the product", async () => {
  const sh = fakeShopify({ product: { tags: ["gift"] } });
  const res = await handleProducts(post({ store: "c3d", id: PID, customizable: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.customizable, true);
  assert.equal(res.body.product.customizable, true);
  const add = sh.calls.find((c) => c.op === "ConsoleTagsAdd");
  assert.deepEqual(add.variables, { id: PID, tags: ["customizable"] });
  assert.ok(!sh.calls.some((c) => c.op === "ConsoleTagsRemove" || c.op === "ConsolePublish" || c.op === "ConsoleActivate"), "only the tag changes");
});

test("customizable on when already tagged sends no mutation", async () => {
  const sh = fakeShopify({ product: { tags: ["CUSTOMIZABLE"] } });
  const res = await handleProducts(post({ store: "c3d", id: PID, customizable: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.ok(!sh.calls.some((c) => /Tags(Add|Remove)/.test(c.op ?? "")));
});

test("customizable off: removes every spelling of the tag with tagsRemove", async () => {
  const sh = fakeShopify({ product: { tags: ["customizable", "Customizable", "gift"] } });
  const res = await handleProducts(post({ store: "c3d", id: PID, customizable: false }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.customizable, false);
  assert.deepEqual(sh.calls.find((c) => c.op === "ConsoleTagsRemove").variables, { id: PID, tags: ["customizable", "Customizable"] });
});

test("customizable matches the theme: older personalized tags count as on, and off removes them too", async () => {
  const on = fakeShopify({ product: { tags: ["Personalized", "gift"] } });
  const res = await handleProducts(post({ store: "c3d", id: PID, customizable: true }), { env: envOf(), fetch: on.fetch });
  assert.equal(res.body.customizable, true);
  assert.ok(!on.calls.some((c) => /Tags(Add|Remove)/.test(c.op ?? "")), "already on for the theme");
  const off = fakeShopify({ product: { tags: ["personalized", "Personalised", "customizable", "gift"] } });
  const res2 = await handleProducts(post({ store: "c3d", id: PID, customizable: false }), { env: envOf(), fetch: off.fetch });
  assert.equal(res2.body.customizable, false);
  assert.deepEqual(off.calls.find((c) => c.op === "ConsoleTagsRemove").variables.tags, ["personalized", "Personalised", "customizable"]);
});

test("customizable is refused for Elevated Designs before any Shopify call", async () => {
  const sh = fakeShopify();
  for (const v of [true, false]) {
    const res = await handleProducts(post({ store: "ed", id: PID, customizable: v }), { env: envOf(), fetch: sh.fetch });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "wrong_store");
  }
  assert.equal(sh.calls.length, 0);
});

test("customizable: bad input, both fields, key, 404 and userErrors", async () => {
  const sh = fakeShopify();
  for (const body of [{ store: "c3d", id: PID, customizable: "yes" }, { store: "c3d", id: PID, customizable: true, live: true }, { store: "c3d", id: PID }])
    assert.equal((await handleProducts(post(body), { env: envOf(), fetch: sh.fetch })).status, 400, JSON.stringify(body));
  assert.equal((await handleProducts(post({ store: "c3d", id: PID, customizable: true }, { "content-type": "application/json" }), { env: envOf(), fetch: sh.fetch })).status, 401);
  assert.equal(sh.calls.length, 0);
  assert.equal((await handleProducts(post({ store: "c3d", id: PID, customizable: true }), { env: envOf(), fetch: fakeShopify({ missing: true }).fetch })).status, 404);
  const rej = await handleProducts(post({ store: "c3d", id: PID, customizable: true }), { env: envOf(), fetch: fakeShopify({ tagErrors: [{ field: ["tags"], message: "Tags is too long" }] }).fetch });
  assert.equal(rej.status, 422);
  assert.match(rej.body.error, /customizable tag: Tags is too long/);
});

// ---------- make-active worked, publish didn't ----------
test("publish fails after making it active: 422 with Shopify's current state, not a rollback", async () => {
  let reads = 0;
  const sh = fakeShopify({ publishErrors: [{ field: ["id"], message: "Online Store isn't available" }],
    override: { ConsoleProduct: (v, data) => data({ product: { id: PID, handle: "name-ornament", title: "Name Ornament", status: reads++ ? "ACTIVE" : "DRAFT", productType: "", tags: [],
      updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false, featuredMedia: null, priceRangeV2: null, publishedOnPublication: false } }) } });
  const res = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "partly_published");
  assert.match(res.body.error, /now Active in Shopify, but it isn't on the Online Store yet: Online Store isn't available/);
  assert.equal(res.body.details.product.status, "ACTIVE", "refreshed from Shopify");
  assert.equal(res.body.details.product.live, false);
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleProduct", "ConsoleActivate", "ConsolePublish", "ConsoleProduct"]);
});

// ---------- listings (Elevated Designs only) ----------
const IMG_KEY = "mh2k3x-0123abcd";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
async function libraryWith(items = [[IMG_KEY, PNG_BYTES, "image/png"]]) {
  const blobs = fakeBlobs();
  for (const [k, data, type] of items) await blobs.set(k, data.buffer, { metadata: { name: "lowcountry_sunset-FINAL.png", type, size: data.byteLength, added: 1 } });
  return libraryReader({ blobs, env: envOf() });
}
const OFFER = [{ id: "gildan-5000", colors: ["Black", "White"] }, { id: "bella-3001", colors: ["Navy"] }];
const LISTING = {
  store: "ed", imageKey: IMG_KEY, title: "Lowcountry Sunset Tee", blanks: OFFER, sizes: ["S", "M", "2XL"], markup: 0,
  productType: "T-Shirt", tags: ["elevated-designs", "graphic-tee"],
  descriptionHtml: "<p>Lowcountry Sunset: an original Elevated Designs graphic.</p><h3>Choose your shirt</h3><ul><li>Gildan 5000</li></ul>",
  seoTitle: "Lowcountry Sunset Tee | Elevated Designs", seoDescription: "Lowcountry Sunset graphic tee from Elevated Designs, printed to order. Sizes S to 2XL.",
};
const listCtx = async (sh, over = {}) => ({ env: envOf(over.env), fetch: sh.fetch, readImage: over.readImage ?? await libraryWith(), sleep: over.sleep ?? (async () => {}) });

test("blank catalog: data/blanks.json is well formed and its Blank names are unique", async () => {
  const { blankCatalog } = await import("../lib/listings.mjs");
  const { blankLabel, SIZES } = await import("../assets/listing.js");
  const c = blankCatalog();
  assert.ok(c.blanks.length >= 3);
  assert.equal(new Set(c.blanks.map((b) => b.id)).size, c.blanks.length, "ids unique");
  assert.equal(new Set(c.blanks.map(blankLabel)).size, c.blanks.length, "Blank option values unique");
  for (const b of c.blanks) {
    assert.ok(c.tiers[b.tier] && c.types[b.type], b.id);
    assert.ok(b.sizes.every((s) => SIZES.includes(s)), `${b.id} sizes`);
    assert.deepEqual(Object.keys(b.prices).sort(), [...b.sizes].sort(), `${b.id} has a price for every size`);
    assert.equal(new Set(b.colors.map((x) => x.name)).size, b.colors.length, `${b.id} colors unique`);
    assert.ok(!("cost" in b) && !("suppliers" in b), "costs and suppliers stay on the server");
  }
});

test("listings: template has the catalog and a preset: cheapest tee per tier with black, white, navy, grey", async () => {
  const res = await handleListings(keyed({ store: "ed" }), { env: envOf(), fetch: fakeShopify().fetch });
  assert.equal(res.status, 200);
  const t = res.body.template;
  assert.equal(t.handlingDays, "5-7");
  assert.deepEqual(t.options, ["Blank", "Color", "Size"]);
  assert.equal(t.limits.variants, 2048);
  const tiers = t.defaults.blanks.map((d) => t.catalog.blanks.find((b) => b.id === d.id));
  assert.deepEqual(tiers.map((b) => [b.type, b.tier]), [["tee", "value"], ["tee", "standard"], ["tee", "premium"]]);
  for (const b of tiers) {
    const cheaper = t.catalog.blanks.filter((x) => x.type === "tee" && x.tier === b.tier && Math.min(...Object.values(x.prices)) < Math.min(...Object.values(b.prices)));
    assert.deepEqual(cheaper, [], `${b.id} is the cheapest ${b.tier} tee`);
  }
  assert.deepEqual(t.defaults.blanks.find((d) => d.id === "gildan-64000").colors, ["Black", "White", "Navy", "Sport Grey"]);
  assert.deepEqual(t.defaults.blanks[0].colors, ["Black", "White", "Navy", "Sport Grey"]);
  assert.equal(listingTemplate(envOf({ ED_HANDLING_DAYS: "3-5" })).handlingDays, "3-5");
  assert.equal(listingTemplate(envOf({ ED_HANDLING_DAYS: "<b>soon</b>" })).handlingDays, "5-7", "odd values fall back");
  assert.equal((await handleListings(get({ store: "ed" }), { env: envOf() })).status, 401);
  assert.equal((await handleListings(keyed({ store: "c3d" }), { env: envOf() })).body.code, "wrong_store");
});

test("listings: presetColors falls back to the blank's first colors", async () => {
  const { presetColors } = await import("../assets/listing.js");
  assert.deepEqual(presetColors({ colors: ["Red", "Gold", "Pink", "Teal", "Lime"].map((name) => ({ name })) }), ["Red", "Gold", "Pink", "Teal"]);
  assert.deepEqual(presetColors({ colors: ["Navy", "Red", "Black"].map((name) => ({ name })) }), ["Black", "Navy", "Red"]);
});

test("listings: happy path stages the image, creates Blank x Color x Size, publishes it and pings IndexNow", async () => {
  const sh = fakeShopify();
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.alreadyListed, false);
  assert.equal(res.body.url, "https://theelevateddesignsllc.com/products/lowcountry-sunset-tee");
  assert.equal(res.body.adminUrl, "https://admin.shopify.com/store/elevated-designs/products/555");
  assert.match(res.body.message, /is live on theelevateddesignsllc\.com/);
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleListingLookup", "ConsoleStagedUpload", "ConsoleListingCreate", "ConsolePublish"]);
  assert.ok(sh.calls.filter((c) => c.op).every((c) => c.domain === "elevated-designs.myshopify.com"), "only the ED store is touched");
  assert.equal(sh.calls.find((c) => c.op === "ConsoleListingLookup").variables.q, `tag:"design:${IMG_KEY}"`);
  const stage = sh.calls.find((c) => c.op === "ConsoleStagedUpload").variables.input[0];
  assert.deepEqual(stage, { resource: "IMAGE", filename: "lowcountry-sunset-tee.png", mimeType: "image/png", httpMethod: "POST", fileSize: String(PNG_BYTES.byteLength) });
  const up = sh.calls.find((c) => c.upload).upload;
  assert.deepEqual(up.fields, { "Content-Type": "image/png", key: "tmp/123/x", policy: "abc" }, "staged parameters sent first, as given");
  assert.equal(up.size, PNG_BYTES.byteLength);
  assert.equal(up.type, "image/png");
  const create = sh.calls.find((c) => c.op === "ConsoleListingCreate").variables;
  assert.equal(create.synchronous, true, "a few variants: synchronous");
  const input = create.input;
  assert.equal(input.status, "ACTIVE");
  assert.equal(input.vendor, "Elevated Designs");
  assert.equal(input.productType, "T-Shirt");
  assert.deepEqual(input.tags, ["elevated-designs", "graphic-tee", `design:${IMG_KEY}`]);
  assert.deepEqual(input.seo, { title: LISTING.seoTitle, description: LISTING.seoDescription });
  assert.deepEqual(input.productOptions, [
    { name: "Blank", position: 1, values: [{ name: "Gildan 5000 – Heavy Cotton Tee" }, { name: "Bella+Canvas 3001 – Unisex Jersey Tee" }] },
    { name: "Color", position: 2, values: [{ name: "White" }, { name: "Black" }, { name: "Navy" }] },
    { name: "Size", position: 3, values: [{ name: "S" }, { name: "M" }, { name: "2XL" }] }]);
  assert.equal(input.variants.length, 9, "2 colors x 3 sizes + 1 color x 3 sizes");
  const row = (v) => [...v.optionValues.map((o) => o.name), v.price, v.sku];
  assert.deepEqual(row(input.variants[0]), ["Gildan 5000 – Heavy Cotton Tee", "White", "S", "13.99", `${IMG_KEY}-gildan-5000-white-S`]);
  assert.deepEqual(row(input.variants[5]), ["Gildan 5000 – Heavy Cotton Tee", "Black", "2XL", "17.99", `${IMG_KEY}-gildan-5000-black-2XL`]);
  assert.deepEqual(row(input.variants[8]), ["Bella+Canvas 3001 – Unisex Jersey Tee", "Navy", "2XL", "23.99", `${IMG_KEY}-bella-3001-navy-2XL`]);
  assert.ok(input.variants.every((v) => v.optionValues.map((o) => o.optionName).join() === "Blank,Color,Size"));
  assert.equal(new Set(input.variants.map((v) => v.sku)).size, 9, "SKUs unique");
  assert.ok(input.variants.every((v) => v.inventoryItem.tracked === false && v.inventoryPolicy === "CONTINUE"), "print on demand: stock not tracked");
  assert.deepEqual(input.files, [{ originalSource: `${STAGED_URL}tmp/123/lowcountry-sunset-tee.png`, contentType: "IMAGE", alt: "Lowcountry Sunset Tee", filename: "lowcountry-sunset-tee.png" }]);
  assert.equal(sh.calls.find((c) => c.op === "ConsolePublish").variables.id, "gid://shopify/Product/555");
  assert.deepEqual(sh.calls.find((c) => c.indexnow).indexnow.urlList, ["https://theelevateddesignsllc.com/products/lowcountry-sunset-tee"]);
  assert.equal(sh.calls.find((c) => c.indexnow).indexnow.host, "theelevateddesignsllc.com");
  assert.equal(res.body.indexNow.sent, true);
  noLeak(res);
});

test("listings: markup (as a string too) is added to every catalog price; sizes a blank lacks are skipped", async () => {
  const sh = fakeShopify();
  const res = await handleListings(post({ ...LISTING, blanks: [{ id: "hanes-5280", colors: ["Black"] }], sizes: ["M", "5XL", "XS"], markup: "5.50" }), await listCtx(sh));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const v = sh.calls.find((c) => c.op === "ConsoleListingCreate").variables.input.variants;
  assert.deepEqual(v.map((x) => [x.optionValues[2].name, x.price]), [["M", "19.49"]], "Hanes 5280 has no XS or 5XL");
});

test("listings: already listed returns the existing product with a link, and creates nothing", async () => {
  const listed = [{ id: "gid://shopify/Product/777", handle: "lowcountry-sunset-tee", title: "Lowcountry Sunset Tee", status: "ACTIVE", tags: [`design:${IMG_KEY}`], publishedOnPublication: true }];
  const sh = fakeShopify({ listed });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 200);
  assert.equal(res.body.alreadyListed, true);
  assert.equal(res.body.republished, false);
  assert.match(res.body.message, /already listed as "Lowcountry Sunset Tee"/);
  assert.equal(res.body.url, "https://theelevateddesignsllc.com/products/lowcountry-sunset-tee");
  assert.equal(res.body.adminUrl, "https://admin.shopify.com/store/elevated-designs/products/777");
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleListingLookup"]);
  assert.ok(!sh.calls.some((c) => c.upload || c.indexnow));
});

test("listings: already listed but off the site (or a failed publish) is put back on", async () => {
  const listed = [{ id: "gid://shopify/Product/777", handle: "lowcountry-sunset-tee", title: "Lowcountry Sunset Tee", status: "DRAFT", tags: [`design:${IMG_KEY}`], publishedOnPublication: false }];
  const sh = fakeShopify({ listed });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 200);
  assert.equal(res.body.republished, true);
  assert.match(res.body.message, /back on the site/);
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleListingLookup", "ConsoleActivate", "ConsolePublish"]);
  assert.ok(sh.calls.some((c) => c.indexnow));
});

test("listings: a loose search hit with another design tag is not treated as listed", async () => {
  const sh = fakeShopify({ listed: [{ id: "gid://shopify/Product/9", handle: "x", title: "X", status: "ACTIVE", tags: [`design:${IMG_KEY}x`], publishedOnPublication: true }] });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 201);
});

const BAD_LISTINGS = [
  ["Charleston 3D store", { store: "c3d" }, "wrong_store"],
  ["no store", { store: undefined }, "bad_store"],
  ["bad image key", { imageKey: "../etc" }, "bad_input"],
  ["local-only image key", { imageKey: "local-abc-123456" }, "bad_input"],
  ["empty title", { title: " " }, "bad_input"],
  ["title too long", { title: "T".repeat(256) }, "bad_input"],
  ["no blanks", { blanks: [] }, "bad_input"],
  ["blanks missing", { blanks: undefined }, "bad_input"],
  ["unknown blank id", { blanks: [{ id: "gildan-9999", colors: ["Black"] }] }, "bad_input"],
  ["blank id injection", { blanks: [{ id: "__proto__", colors: ["Black"] }] }, "bad_input"],
  ["same blank twice", { blanks: [{ id: "gildan-5000", colors: ["Black"] }, { id: "gildan-5000", colors: ["White"] }] }, "bad_input"],
  ["unknown color", { blanks: [{ id: "gildan-5000", colors: ["Black", "Plaid"] }] }, "bad_input"],
  ["color from another blank", { blanks: [{ id: "bella-3001", colors: ["Sport Grey"] }] }, "bad_input"],
  ["no colors", { blanks: [{ id: "gildan-5000", colors: [] }] }, "bad_input"],
  ["color twice", { blanks: [{ id: "gildan-5000", colors: ["Black", "Black"] }] }, "bad_input"],
  ["extra key on a blank", { blanks: [{ id: "gildan-5000", colors: ["Black"], price: 1 }] }, "bad_input"],
  ["unknown size", { sizes: ["S", "XXL"] }, "bad_input"],
  ["no sizes", { sizes: [] }, "bad_input"],
  ["blank with none of the sizes", { blanks: [{ id: "gildan-5000b", colors: ["Black"] }], sizes: ["2XL"] }, "bad_input"],
  ["markup too low", { markup: -11 }, "bad_input"],
  ["markup too high", { markup: 101 }, "bad_input"],
  ["markup fractions of a cent", { markup: 1.005 }, "bad_input"],
  ["markup not a number", { markup: "lots" }, "bad_input"],
  ["price override sent", { price: 5 }, "bad_input"],
  ["bad operation id", { operationId: "gid://shopify/Product/1" }, "bad_input"],
  ["SEO title over 60", { seoTitle: "S".repeat(61) }, "bad_input"],
  ["SEO description over 155", { seoDescription: "D".repeat(156) }, "bad_input"],
  ["script in description", { descriptionHtml: "<p>Nice</p><script>alert(1)</script>" }, "bad_input"],
  ["event handler in description", { descriptionHtml: "<p onclick=\"x()\">Nice shirt here</p>" }, "bad_input"],
  // Security review: browsers run these, so they must not pass the description check.
  ["handler after a slash", { descriptionHtml: "<p>Nice shirt</p><img/onerror=alert(1) src=x>" }, "bad_input"],
  ["handler right after a quote", { descriptionHtml: "<p>Nice shirt</p><img src=\"x\"onerror=alert(1)>" }, "bad_input"],
  ["javascript: written as an entity", { descriptionHtml: "<p><a href=\"javascript&#58;alert(1)\">Nice shirt</a></p>" }, "bad_input"],
  ["javascript: with an encoded tab", { descriptionHtml: "<p><a href=\"java&#x09;script:alert(1)\">Nice shirt</a></p>" }, "bad_input"],
  ["javascript&colon;", { descriptionHtml: "<p><a href=\"javascript&colon;alert(1)\">Nice shirt</a></p>" }, "bad_input"],
  ["vbscript: link", { descriptionHtml: "<p><a href=\"vbscript:msgbox(1)\">Nice shirt</a></p>" }, "bad_input"],
  ["tag outside the formatting list", { descriptionHtml: "<p>Nice shirt</p><details open ontoggle=alert(1)>x</details>" }, "bad_input"],
  ["customizable tag on ED", { tags: ["customizable"] }, "bad_input"],
  ["design tag forged", { tags: ["design:other-01234567"] }, "bad_input"],
  ["tag with comma", { tags: ["a,b"] }, "bad_input"],
  ["vendor override", { vendor: "Charleston 3D" }, "bad_input"],
  ["status override", { status: "DRAFT" }, "bad_input"],
];
for (const [name, over, code] of BAD_LISTINGS)
  test(`listings: ${name} is 400 (${code}) and never reaches Shopify`, async () => {
    const sh = fakeShopify();
    const res = await handleListings(post({ ...LISTING, ...over }), await listCtx(sh));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, code);
    assert.equal(sh.calls.length, 0);
  });

test("listings: key required (401), CONSOLE_KEY unset (403), body too large (413)", async () => {
  const sh = fakeShopify();
  assert.equal((await handleListings(post(LISTING, { "content-type": "application/json" }), await listCtx(sh))).status, 401);
  assert.equal((await handleListings(post(LISTING, { "content-type": "application/json", "x-console-key": "guess" }), await listCtx(sh))).status, 401);
  assert.equal((await handleListings(post(LISTING), await listCtx(sh, { env: { CONSOLE_KEY: undefined } }))).status, 403);
  assert.equal((await handleListings(post({ ...LISTING, descriptionHtml: "x".repeat(40000) }), await listCtx(sh))).status, 413);
  assert.equal(sh.calls.length, 0);
});

test("listings: an image missing from the library is 404 and nothing is created", async () => {
  const sh = fakeShopify();
  const res = await handleListings(post({ ...LISTING, imageKey: "zz9-89abcdef" }), await listCtx(sh));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "image_not_found");
  assert.ok(!sh.calls.some((c) => c.op === "ConsoleStagedUpload" || c.op === "ConsoleListingCreate"));
});

test("listings: an SVG design is refused (Shopify product photos can't be SVG)", async () => {
  const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const sh = fakeShopify();
  const res = await handleListings(post(LISTING), await listCtx(sh, { readImage: await libraryWith([[IMG_KEY, svg, "image/svg+xml"]]) }));
  assert.equal(res.status, 415);
  assert.match(res.body.error, /PNG, JPEG, WebP or GIF/);
  assert.ok(!sh.calls.some((c) => c.op === "ConsoleStagedUpload"));
});

for (const mode of ["403", "throw"])
  test(`listings: staged upload failure (${mode}) is 502 and no product is made`, async () => {
    const sh = fakeShopify({ upload: mode });
    const res = await handleListings(post(LISTING), await listCtx(sh));
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "upload_failed");
    assert.match(res.body.error, /Nothing was listed/);
    assert.ok(!sh.calls.some((c) => c.op === "ConsoleListingCreate" || c.indexnow));
  });

for (const [name, over] of [
  ["http upload target", { stagedUrl: "http://shopify-staged-uploads.storage.googleapis.com/" }],
  ["upload target on another host", { stagedUrl: "https://attacker.example/upload" }],
  ["internal upload target", { stagedUrl: "https://169.254.169.254/latest/" }],
  ["look-alike host", { stagedUrl: "https://storage.googleapis.com.attacker.example/" }],
  ["resourceUrl on another host", { resourceUrl: "https://attacker.example/x.png" }],
])
  test(`listings: ${name} is refused before any bytes are sent`, async () => {
    const sh = fakeShopify(over);
    const res = await handleListings(post(LISTING), await listCtx(sh));
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "upload_failed");
    assert.ok(!sh.calls.some((c) => c.upload || c.stray || c.op === "ConsoleListingCreate"), JSON.stringify(sh.calls.filter((c) => c.stray)));
  });

test("listings: the description check keeps the generated copy and ordinary formatting", async () => {
  const { unsafeHtml, listingTemplate } = await import("../lib/listings.mjs");
  const { buildListing } = await import("../assets/listing.js");
  assert.equal(unsafeHtml(buildListing({ name: "sunset_final.png" }, listingTemplate(envOf())).descriptionHtml), false);
  assert.equal(unsafeHtml("<p>Soft &amp; comfy. <a href=\"https://theelevateddesignsllc.com/pages/faq\">Sizing</a> x < y, on sale</p><!-- note -->"), false);
});

test("listings: stagedUploadsCreate userErrors are 422 and stop before the upload", async () => {
  const sh = fakeShopify({ stageErrors: [{ field: ["input", "0", "mimeType"], message: "Mime type is not supported" }] });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 422);
  assert.match(res.body.error, /Mime type is not supported/);
  assert.ok(!sh.calls.some((c) => c.upload));
});

test("listings: productSet userErrors are passed on as 422 with Shopify's messages", async () => {
  const sh = fakeShopify({ createErrors: [{ field: ["input", "variants", "0", "price"], message: "Price must be greater than or equal to 0", code: "INVALID_VARIANT" }] });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "shopify_rejected");
  assert.match(res.body.error, /Shopify wouldn't create the product: Price must be/);
  assert.deepEqual(res.body.details.userErrors[0].field, ["input", "variants", "0", "price"]);
  assert.ok(!sh.calls.some((c) => c.op === "ConsolePublish" || c.indexnow));
});

test("listings: product made but publish refused says so, with the admin link, and retry publishes it", async () => {
  const sh = fakeShopify({ publishErrors: [{ field: ["input"], message: "Publication not found" }] });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "partly_listed");
  assert.match(res.body.error, /made in Shopify but isn't on the Online Store yet: Publication not found/);
  assert.equal(res.body.details.product.adminUrl, "https://admin.shopify.com/store/elevated-designs/products/555");
  assert.ok(!sh.calls.some((c) => c.indexnow));
});

test("listings: IndexNow failure doesn't fail a listing; no ED creds is 503", async () => {
  const sh = fakeShopify({ indexNow: "throw" });
  const res = await handleListings(post(LISTING), await listCtx(sh));
  assert.equal(res.status, 201);
  assert.equal(res.body.indexNow.sent, false);
  const none = await handleListings(post(LISTING), await listCtx(fakeShopify(), { env: { ED_ADMIN_TOKEN: "" } }));
  assert.equal(none.status, 503);
  assert.match(none.body.error, /ED_ADMIN_TOKEN/);
});

test("listings: more than 2,048 variants is refused before Shopify, naming the count", async () => {
  const { blankCatalog } = await import("../lib/listings.mjs");
  const all = blankCatalog().blanks.map((b) => ({ id: b.id, colors: b.colors.map((c) => c.name) }));
  const sh = fakeShopify();
  const res = await handleListings(post({ ...LISTING, blanks: all, sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] }), await listCtx(sh));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "too_many_variants");
  assert.match(res.body.error, /That's \d,?\d+ variants; Shopify allows 2048 per product/);
  assert.ok(res.body.details.variants > 2048);
  assert.equal(sh.calls.length, 0);
});

const bigOffer = async () => {
  const { blankCatalog } = await import("../lib/listings.mjs");
  const ids = ["gildan-5000", "bella-3001", "comfortcolors-1717"];
  return ids.map((id) => ({ id, colors: blankCatalog().blanks.find((b) => b.id === id).colors.slice(0, 8).map((c) => c.name) }));
};

test("listings: over 100 variants runs productSet asynchronously and polls until it's done", async () => {
  const sh = fakeShopify({ operation: ["CREATED", "ACTIVE", "COMPLETE"] });
  const slept = [];
  const res = await handleListings(post({ ...LISTING, blanks: await bigOffer(), sizes: ["S", "M", "L", "XL", "2XL", "3XL"] }), await listCtx(sh, { sleep: async (ms) => slept.push(ms) }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const create = sh.calls.find((c) => c.op === "ConsoleListingCreate").variables;
  assert.equal(create.synchronous, false);
  assert.ok(create.input.variants.length > 100 && create.input.variants.length <= 2048, String(create.input.variants.length));
  assert.equal(sh.calls.filter((c) => c.op === "ConsoleListingOperation").length, 3);
  assert.deepEqual(slept, [1000, 1000]);
  assert.equal(sh.calls.find((c) => c.op === "ConsoleListingOperation").variables.id, OPERATION);
  assert.equal(sh.calls.find((c) => c.op === "ConsolePublish").variables.id, "gid://shopify/Product/556");
  assert.equal(res.body.url, "https://theelevateddesignsllc.com/products/big-tee");
});

test("listings: still running after the wait is 202 with the operation id; asking again with it finishes, without a second product", async () => {
  const sh = fakeShopify({ operation: ["ACTIVE"] });
  const body = { ...LISTING, blanks: await bigOffer(), sizes: ["S", "M", "L", "XL", "2XL", "3XL"] };
  const first = await handleListings(post(body), await listCtx(sh));
  assert.equal(first.status, 202);
  assert.equal(first.body.pending, true);
  assert.equal(first.body.operationId, OPERATION);
  assert.match(first.body.message, /still making this listing/);
  assert.ok(!sh.calls.some((c) => c.op === "ConsolePublish"));
  assert.ok(sh.calls.filter((c) => c.op === "ConsoleListingOperation").length <= 5, "waits about 4 seconds at most");
  const sh2 = fakeShopify({ operation: ["COMPLETE"] });
  const again = await handleListings(post({ ...body, operationId: OPERATION }), await listCtx(sh2));
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.deepEqual(sh2.calls.filter((c) => c.op).map((c) => c.op), ["OnlineStorePublication", "ConsoleListingOperation", "ConsolePublish"], "no lookup, upload or second productSet");
});

test("listings: an asynchronous productSet's userErrors are 422; an unknown operation is 404", async () => {
  const body = { ...LISTING, blanks: await bigOffer(), sizes: ["S", "M", "L", "XL", "2XL", "3XL"] };
  const bad = await handleListings(post(body), await listCtx(fakeShopify({ operation: ["COMPLETE"], operationErrors: [{ field: ["variants"], message: "Too many variants", code: "INVALID_INPUT" }] })));
  assert.equal(bad.status, 422);
  assert.match(bad.body.error, /Too many variants/);
  const gone = await handleListings(post({ ...body, operationId: OPERATION }), await listCtx(fakeShopify({ operation: "missing" })));
  assert.equal(gone.status, 404);
});

test("listings: unsupported method is 405", async () => {
  const res = await handleListings({ method: "DELETE", query: new URLSearchParams(), header: (k) => (k === "x-console-key" ? "open-sesame-test-key-0001" : null), text: async () => "" }, { env: envOf() });
  assert.equal(res.status, 405);
});

test("the listing template builder (assets/listing.js) fits Shopify's limits and the brand", async () => {
  const { buildListing, cleanTitle, describe, variantCount } = await import("../assets/listing.js");
  const tpl = listingTemplate(envOf());
  assert.equal(cleanTitle("lowcountry_sunset-v2 FINAL copy.png"), "Lowcountry Sunset Tee");
  assert.equal(cleanTitle("IMG_2041.JPG"), "Graphic Tee");
  assert.equal(cleanTitle("Palmetto Moon Tee.png"), "Palmetto Moon Tee");
  const l = buildListing({ name: "a-really-long-design-name-that-goes-on-and-on-about-the-charleston-harbor-at-dusk.png", tags: "harbor, sunset" }, tpl);
  assert.ok(l.seoTitle.length <= 60, l.seoTitle);
  assert.ok(l.seoDescription.length <= 155, l.seoDescription);
  assert.match(l.descriptionHtml, /<h3>Choose your shirt<\/h3>/);
  assert.match(l.descriptionHtml, /<li><strong>Gildan 5000 – Heavy Cotton Tee<\/strong>: 100% cotton \(heathers are blends\), 5.3 oz, classic fit<\/li>/);
  assert.equal((l.descriptionHtml.match(/<li>/g) ?? []).length, 3, "one line per offered blank");
  assert.match(l.descriptionHtml, /Printed to order/);
  assert.match(l.descriptionHtml, /5-7 business days/);
  const brandCopy = l.descriptionHtml.replace(/<ul>[\s\S]*<\/ul>/, "") + l.seoDescription; // blank facts come from the catalog
  assert.ok(!/100%|organic|eco|best|guarantee/i.test(brandCopy), "no claims the brand can't back");
  assert.deepEqual(l.tags.slice(-2), ["harbor", "sunset"]);
  assert.equal(variantCount(tpl.catalog, { blanks: l.blanks, sizes: l.sizes }), 80, "default preset: 3 blanks x 4 colors, all their sizes");
  assert.ok(!describe({ title: "<b>x</b>", handlingDays: "5-7", catalog: tpl.catalog, blanks: [], sizes: ["S"] }).includes("<b>x</b>"), "escaped");
  // and what it makes is accepted by the API as is
  const sh = fakeShopify();
  const res = await handleListings(post({ store: "ed", imageKey: IMG_KEY, blanks: l.blanks, sizes: l.sizes, markup: l.markup, productType: l.productType,
    title: l.title, tags: l.tags, descriptionHtml: l.descriptionHtml, seoTitle: l.seoTitle, seoDescription: l.seoDescription }), await listCtx(sh));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(sh.calls.find((c) => c.op === "ConsoleListingCreate").variables.input.variants.length, 80);
});

// ---------- last: the schema check over everything sent above ----------
test("every GraphQL string sent matches the Admin API 2025-10 schema, variables included", async () => {
  const S = await import("../lib/shopify.mjs");
  const L = await import("../lib/listings.mjs");
  const I = await import("../lib/insights.mjs");
  const ops = [...[S, L].flatMap((m) => Object.entries(m).filter(([k, v]) => /_(QUERY|MUTATION)$/.test(k) && typeof v === "string").map(([, v]) => v)),
    I.ordersQuery(true), I.ordersQuery(false), I.SHOP_QUERY, I.SESSIONS_QUERY];
  const sent = new Set(checked()); // before the loop below adds the rest
  for (const q of ops) assert.deepEqual(schemaErrors(q), [], q.slice(0, 80));
  const unsent = ops.filter((q) => !sent.has(q)).map((q) => q.slice(0, 60));
  assert.deepEqual(unsent, [], "every exported operation was exercised by a test");
  assert.deepEqual(schemaProblems, []);
});
