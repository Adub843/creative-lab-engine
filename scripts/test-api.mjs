// API tests with Shopify mocked out. Run: node scripts/test-api.mjs
// Nothing here talks to a real store: every fetch goes to the fake below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProducts, clearTokenCache } from "../lib/shopify.mjs";
import { handleInsights, buildInsights, growthPct, forecast30, linearFit, addDays } from "../lib/insights.mjs";
import { schemaErrors, variableErrors, checked } from "./schema/validate.mjs";
import { fileURLToPath } from "node:url";

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
  assert.equal(res.body.url, "https://elevatedshirts.com/products/name-ornament");
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

test("finds the Online Store by Shopify's real catalog title", async () => {
  const real = "gid://shopify/Publication/311375364400";
  const sh = fakeShopify({ publications: [
    { id: "gid://shopify/Publication/311375397168", catalog: { title: "Channel Catalog 311375397168 for Point of Sale" } },
    { id: real, catalog: { title: "Channel Catalog 311375364400 for Online Store" } }] });
  const res = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200);
  assert.equal(sh.calls.find((c) => c.op === "ConsoleProducts").variables.pub, real);
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

test("Worker adapter: JSON responses are nosniff, unframeable and sandboxed", async () => {
  const { jsonRoute } = await import("../worker/app.mjs");
  const res = await jsonRoute(async () => ({ status: 200, body: { a: 1 } }))(new Request("https://console.example/api/x"), {});
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'.*sandbox/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ---------- image library ----------
const { handleImages } = await import("../lib/images.mjs");
const { kvBlobStore } = await import("../lib/kv-store.mjs");
// In-memory Workers KV with the limits the real one enforces: values up to 25 MiB, metadata up to
// 1024 bytes once serialised, and list pages (1000 keys, smaller here to exercise the cursor).
function fakeKV({ pageSize = 1000 } = {}) {
  const m = new Map(), ops = [];
  const copy = (v) => (v instanceof ArrayBuffer ? v.slice(0) : ArrayBuffer.isView(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : new TextEncoder().encode(String(v)).buffer);
  return { m, ops,
    async put(k, value, { metadata } = {}) {
      ops.push(["put", k]);
      const data = copy(value);
      if (data.byteLength > 25 * 1024 * 1024) throw new Error("KV put() failed: value too large");
      if (metadata !== undefined && new TextEncoder().encode(JSON.stringify(metadata)).length > 1024) throw new Error("KV put() failed: metadata too large");
      m.set(k, { data, metadata: metadata === undefined ? null : JSON.parse(JSON.stringify(metadata)) });
    },
    async getWithMetadata(k, opts) {
      ops.push(["get", k]);
      const type = typeof opts === "string" ? opts : opts?.type ?? "text";
      const hit = m.get(k);
      if (!hit) return { value: null, metadata: null };
      const value = type === "arrayBuffer" ? hit.data.slice(0) : type === "json" ? JSON.parse(new TextDecoder().decode(hit.data)) : new TextDecoder().decode(hit.data);
      return { value, metadata: hit.metadata };
    },
    async get(k, opts) { return (await this.getWithMetadata(k, opts)).value; },
    async delete(k) { ops.push(["delete", k]); m.delete(k); },
    async list({ prefix = "", cursor, limit = pageSize } = {}) {
      ops.push(["list", prefix]);
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = names.slice(start, start + Math.min(limit, pageSize)).map((name) => ({ name, ...(m.get(name).metadata ? { metadata: m.get(name).metadata } : {}) }));
      const done = start + keys.length >= names.length;
      return { keys, list_complete: done, ...(done ? {} : { cursor: String(start + keys.length) }) };
    },
  };
}
// The image library's store, as the Worker builds it from the IMAGES binding.
function fakeBlobs(kv = fakeKV()) { return Object.assign(kvBlobStore(kv), { m: kv.m, kv }); }
const imgReq = (path, { method = "GET", headers = {}, body } = {}) => new Request(`https://console.example${path}`, { method, headers, body });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EVIL_SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>`;

test("images: list and writes need the key; private files need the key or a signed link", async () => {
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
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`), ctx)).status, 404, "a private image is hidden from strangers");
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`, { headers: { "sec-fetch-site": "same-origin" } }), ctx)).status, 404,
    "a forged browser header doesn't unlock a private image");
  const { url } = (await (await handleImages(imgReq("/api/images", { headers: KEYH }), ctx)).json()).items[0];
  assert.match(url, new RegExp(`^/api/images/${item.key}\\?exp=\\d+&sig=[\\w-]+$`), "the keyed list hands out a signed link");
  assert.equal(item.url?.startsWith(`/api/images/${item.key}?exp=`), true, "the upload response has one too");
  const file = await handleImages(imgReq(url), ctx);
  assert.equal(file.status, 200, "the console's own <img> tags load it through the signed link");
  assert.equal(file.headers.get("cache-control"), "private, max-age=3600", "shared caches never keep a private file");
  const exp = new URL(url, "https://x").searchParams.get("exp");
  const tampered = url.replace(/sig=.*/, "sig=" + "A".repeat(43));
  assert.equal((await handleImages(imgReq(tampered), ctx)).status, 404, "a wrong signature is refused");
  assert.equal((await handleImages(imgReq(url.replace(`exp=${exp}`, `exp=${Number(exp) + 1}`)), ctx)).status, 404, "changing the expiry breaks the signature");
  assert.equal((await handleImages(imgReq(url), { blobs, env: envOf({ CONSOLE_KEY: "a-different-long-random-console-key-123" }) })).status, 404,
    "links stop working when the console key changes");
  const other = (await (await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: PNG }), ctx)).json()).item;
  assert.equal((await handleImages(imgReq(url.replace(item.key, other.key)), ctx)).status, 404, "one image's link doesn't open another");
  await handleImages(imgReq(`/api/images/${other.key}`, { method: "DELETE", headers: KEYH }), ctx);
  const realNow = Date.now;
  try { Date.now = () => realNow() + 3 * 60 * 60 * 1000; assert.equal((await handleImages(imgReq(url), ctx)).status, 404, "an expired link is refused"); }
  finally { Date.now = realNow; }
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`, { method: "DELETE" }), ctx)).status, 401);
  assert.equal((await handleImages(imgReq(`/api/images/${item.key}`, { method: "DELETE", headers: KEYH }), ctx)).status, 200);
  assert.equal(blobs.m.size, 0);
});

const { handleFiles } = await import("../lib/files.mjs");
// The Charleston 3D file library: its own prefixes in the same KV namespace, never in the image list.
function fileCtx(kv = fakeKV(), env = envOf()) {
  return { kv, ctx: { blobs: kvBlobStore(kv, "c3d-file:"), thumbs: kvBlobStore(kv, "c3d-thumb:"), env } };
}
const binStl = (tris) => { const b = new Uint8Array(84 + 50 * tris); new DataView(b.buffer).setUint32(80, tris, true); return b; };
const upFile = (ctx, name, body, headers = KEYH) =>
  handleFiles(imgReq("/api/files", { method: "POST", headers: { "x-filename": name, "content-type": "application/octet-stream", ...headers }, body }), ctx);

test("files: Charleston 3D library takes STL, 3MF, OBJ, STEP and photos, checked by content", async () => {
  const { kv, ctx } = fileCtx();
  assert.equal((await handleFiles(imgReq("/api/files"), ctx)).status, 401, "list needs the key");
  assert.equal((await upFile(ctx, "a.stl", binStl(2), {})).status, 401, "upload needs the key");
  const ok = [["bracket.stl", binStl(3)], ["ascii.stl", new TextEncoder().encode("solid part\nfacet normal 0 0 1\nendsolid")],
    ["plate.3mf", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], ["cube.obj", new TextEncoder().encode("# cube\no Cube\nv 0 0 0\nv 1 0 0\nf 1 2 1\n")],
    ["part.STEP", new TextEncoder().encode("ISO-10303-21;\nHEADER;")], ["photo.png", PNG]];
  for (const [name, body] of ok) assert.equal((await upFile(ctx, name, body)).status, 201, name);
  for (const [name, body] of [["fake.stl", new Uint8Array(90)], ["fake.3mf", PNG], ["notes.txt", new TextEncoder().encode("hi")], ["fake.step", PNG], ["x.png", binStl(1)]])
    assert.equal((await upFile(ctx, name, body)).status, 415, `${name} refused`);
  const { items } = await (await handleFiles(imgReq("/api/files", { headers: KEYH }), ctx)).json();
  assert.equal(items.length, ok.length);
  assert.deepEqual(new Set(items.map((i) => i.type)), new Set(["model/stl", "model/3mf", "model/obj", "model/step", "image/png"]));
  assert.ok(items.every((i) => i.store === "c3d" && /^\/api\/files\/[a-z0-9]+-[0-9a-f]{8}\?exp=\d+&sig=/.test(i.url)));
  assert.ok([...kv.m.keys()].every((k) => k.startsWith("c3d-file:")), "nothing lands in the image library's keys");
  assert.equal((await kvBlobStore(kv).list()).blobs.length, 0, "the Elevated Designs image list doesn't see them");
});

test("files: downloads need the key or a signed link; models download, previews and renames work; delete removes both", async () => {
  const { kv, ctx } = fileCtx();
  const { item } = await (await upFile(ctx, "Pineapple Ornament.stl", binStl(4))).json();
  assert.equal((await handleFiles(imgReq(`/api/files/${item.key}`), ctx)).status, 404, "hidden from strangers");
  const file = await handleFiles(imgReq(item.url), ctx);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "application/octet-stream");
  assert.equal(file.headers.get("content-disposition"), 'attachment; filename="Pineapple Ornament.stl"');
  assert.equal((await handleFiles(imgReq(item.url.replace(/sig=.*/, "sig=" + "A".repeat(43))), ctx)).status, 404, "a wrong signature is refused");
  const put = (body, headers = KEYH) => handleFiles(imgReq(`/api/files/${item.key}/thumb`, { method: "PUT", headers, body }), ctx);
  assert.equal((await put(PNG, {})).status, 401);
  assert.equal((await put(binStl(1))).status, 415, "a preview must be a PNG");
  assert.equal((await put(new Uint8Array(301 * 1024).fill(0x89))).status, 413);
  const withThumb = (await (await put(PNG)).json()).item;
  assert.match(withThumb.thumbUrl, new RegExp(`^/api/files/${item.key}/thumb\\?exp=`));
  const thumb = await handleFiles(imgReq(withThumb.thumbUrl), ctx);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/png");
  // One signature per hour covers the whole library, so listing it costs one HMAC (the free plan's 10 ms limit).
  assert.equal(new URL(withThumb.thumbUrl, "https://x").search, new URL(item.url, "https://x").search, "one link signature for every file");
  const old = item.url.replace(/exp=\d+/, `exp=${Date.now() - 1000}`);
  assert.equal((await handleFiles(imgReq(old), ctx)).status, 404, "an expired link is refused");
  const otherKey = { ...ctx, env: envOf({ CONSOLE_KEY: "a-different-console-key-1234" }) };
  assert.equal((await handleFiles(imgReq(item.url), otherKey)).status, 404, "a link signed with another key is refused");
  const renamed = await handleFiles(imgReq(`/api/files/${item.key}`, { method: "PATCH", headers: { ...KEYH, "content-type": "application/json" }, body: JSON.stringify({ name: "Pineapple v2.obj", tags: "ornament, fruit" }) }), ctx);
  const r = (await renamed.json()).item;
  assert.equal(r.name, "Pineapple v2.stl", "the extension always stays the file's own");
  assert.equal(r.tags, "ornament, fruit");
  assert.equal(r.thumb, true, "renaming keeps the preview");
  assert.equal((await handleFiles(imgReq(`/api/files/${item.key}`, { method: "DELETE", headers: KEYH }), ctx)).status, 200);
  assert.equal(kv.m.size, 0, "the file and its preview are gone");
  for (const bad of ["/api/files/../image:x", "/api/files/abc", `/api/files/${item.key}/other`, `/api/files/${item.key}/thumb/x`])
    assert.equal((await handleFiles(imgReq(bad, { headers: KEYH }), ctx)).status, 404, bad);
});

test("images: content must match the declared type, and only image types are taken", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const asPng = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: html }), ctx);
  assert.equal(asPng.status, 415, "HTML bytes claiming to be PNG are refused");
  const asSvg = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/svg+xml", ...KEYH }, body: html }), ctx);
  assert.equal(asSvg.status, 415, "HTML claiming to be SVG is refused");
  assert.equal((await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "text/html", ...KEYH }, body: html }), ctx)).status, 415);
  const big = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", "content-length": String(21 * 1024 * 1024), ...KEYH }, body: PNG }), ctx);
  assert.equal(big.status, 413);
  assert.equal(ctx.blobs.m.size, 0);
});

const { handleMember, clearMemberCache } = await import("../lib/members.mjs");
// A fake store for store sign-in: the two discovery files, the Customer Account API and the Admin API.
function fakeMemberShop({ tags = ["Pro", "designs:benz1"], goodToken = "shcat_GOOD", scopeDenied = false } = {}) {
  const calls = [];
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.authorization });
    if (url === "https://elevatedshirts.com/.well-known/openid-configuration")
      return res({ authorization_endpoint: "https://shopify.com/authentication/123/oauth/authorize", token_endpoint: "https://shopify.com/authentication/123/oauth/token", end_session_endpoint: "https://shopify.com/authentication/123/logout" });
    if (url === "https://elevatedshirts.com/.well-known/customer-account-api") return res({ graphql_api: "https://shopify.com/123/account/customer/api/2025-10/graphql" });
    if (url === "https://shopify.com/123/account/customer/api/2025-10/graphql")
      return init.headers.authorization === goodToken ? res({ data: { customer: { id: "gid://shopify/Customer/77", firstName: "Dana" } } }) : res({ errors: [{ message: "Unauthorized" }] }, 401);
    if (String(url).includes("/admin/api/")) {
      const { query, variables } = JSON.parse(init.body);
      checkGraphql(query, variables);
      if (scopeDenied) return res({ errors: [{ message: "Access denied for tags field. Required access: `read_customers` access scope.", extensions: { code: "ACCESS_DENIED" } }] });
      return res({ data: { customer: { tags } } });
    }
    return res({}, 404);
  };
  return { fetch, calls };
}

test("store sign-in: config, token check, tag-unlocked images with signed links, CORS preflight", async () => {
  clearMemberCache();
  const blobs = fakeBlobs();
  const ictx = { blobs, env: envOf() };
  const post = (h) => handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH, ...h }, body: PNG }), ictx);
  await post({ "x-filename": "pub.png", "x-public": "1" });
  await post({ "x-filename": "pro.png", "x-access": "PRO" });
  await post({ "x-filename": "benz.png", "x-access": "designs:benz1, other" });
  await post({ "x-filename": "all.png", "x-access": "members" });
  await post({ "x-filename": "vip.png", "x-access": "vip" });
  await post({ "x-filename": "secret.png" });
  const shop = fakeMemberShop();
  const env = envOf({ ED_CUSTOMER_CLIENT_ID: "client-abc" });
  const ctx = { blobs, env, fetch: shop.fetch };
  const app = { origin: "https://design.elevatedshirts.com" };

  const cfg = await handleMember(imgReq("/api/member/config", { headers: app }), ctx);
  assert.equal(cfg.status, 200);
  assert.deepEqual(await cfg.json(), { clientId: "client-abc", authorize: "https://shopify.com/authentication/123/oauth/authorize", token: "https://shopify.com/authentication/123/oauth/token", logout: "https://shopify.com/authentication/123/logout" });
  assert.equal(cfg.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com");

  const pre = await handleMember(imgReq("/api/member", { method: "OPTIONS", headers: app }), ctx);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-headers"), "authorization");

  const me = await handleMember(imgReq("/api/member", { headers: { ...app, authorization: "Bearer shcat_GOOD" } }), ctx);
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.customer.firstName, "Dana");
  assert.deepEqual(body.tags, ["pro", "designs:benz1"]);
  assert.deepEqual(body.items.map((i) => i.name).sort(), ["all.png", "benz.png", "pro.png"], "only images the tags unlock, never public or untagged private ones");
  assert.equal(body.customer.id, undefined, "the customer's id isn't sent back");
  for (const i of body.items) {
    assert.match(i.url, /^https:\/\/console\.example\/api\/images\/[^?]+\?exp=\d+&sig=/);
    const file = await handleImages(new Request(i.url), ictx);
    assert.equal(file.status, 200, "the signed link opens the file");
  }
  assert.equal(shop.calls.find((c) => c.url.includes("/account/customer/api/")).auth, "shcat_GOOD", "the token goes to Shopify as-is");

  const again = shop.calls.length;
  assert.equal((await handleMember(imgReq("/api/member", { headers: { authorization: "Bearer shcat_GOOD" } }), ctx)).status, 200);
  assert.equal(shop.calls.length, again, "a checked token is remembered for a few minutes");

  const bad = await handleMember(imgReq("/api/member", { headers: { ...app, authorization: "Bearer shcat_EXPIRED" } }), ctx);
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).code, "signed_out");
  assert.equal(bad.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com", "errors still reach the app");
  assert.equal((await handleMember(imgReq("/api/member"), ctx)).status, 401, "no token");
  assert.equal((await handleMember(imgReq("/api/member", { method: "POST", headers: { authorization: "Bearer shcat_GOOD" } }), ctx)).status, 405);
  const evil = await handleMember(imgReq("/api/member", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), ctx);
  assert.equal(evil.headers.get("access-control-allow-origin"), null, "other sites get no CORS");
});

test("store sign-in: not switched on, missing scope, and access field edits", async () => {
  clearMemberCache();
  const blobs = fakeBlobs();
  const dflt = await handleMember(imgReq("/api/member/config"), { blobs, env: envOf(), fetch: fakeMemberShop().fetch });
  assert.equal((await dflt.json()).clientId, "1cd847fd-6a88-46bb-af04-d486241fc519", "the ED storefront's public client ID is built in");
  const off = await handleMember(imgReq("/api/member/config"), { blobs, env: envOf({ ED_CUSTOMER_CLIENT_ID: " " }), fetch: fakeMemberShop().fetch });
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /ED_CUSTOMER_CLIENT_ID/);
  const denied = await handleMember(imgReq("/api/member", { headers: { authorization: "Bearer shcat_GOOD" } }), { blobs, env: envOf(), fetch: fakeMemberShop({ scopeDenied: true }).fetch });
  assert.equal(denied.status, 502);
  assert.match((await denied.json()).error, /read_customers/);

  const ictx = { blobs, env: envOf() };
  const up = await (await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH, "x-access": " VIP , designs:Benz1 ,," }, body: PNG }), ictx)).json();
  assert.equal(up.item.access, "vip, designs:benz1");
  const patch = (body) => handleImages(imgReq(`/api/images/${up.item.key}`, { method: "PATCH", headers: { "content-type": "application/json", ...KEYH }, body: JSON.stringify(body) }), ictx);
  assert.equal((await (await patch({ access: Array.from({ length: 40 }, (_, n) => `tag-number-${n}`).join(",") })).json()).item.access.length <= 120, true, "long lists keep whole tags only");
  assert.equal((await patch({ access: "" })).status, 200);
  assert.equal(blobs.m.get(`image:${up.item.key}`).metadata.access, undefined, "an empty access clears it");
});

test("images: an SVG with script is never rendered on the console's origin", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  const up = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/svg+xml", ...KEYH }, body: EVIL_SVG }), ctx);
  assert.equal(up.status, 201);
  const file = await handleImages(imgReq(`/api/images/${(await up.json()).item.key}`, { headers: KEYH }), ctx);
  assert.equal(file.headers.get("content-type"), "image/svg+xml");
  assert.equal(file.headers.get("content-disposition"), "attachment");
  assert.match(file.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
});

test("images: the shirt app sees only public images, with CORS for its own origins", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf({ BUILDER_ORIGINS: "https://shirts.example.com" }) };
  const post = (h) => handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH, ...h }, body: PNG }), ctx);
  const pub = (await (await post({ "x-filename": "pub.png", "x-public": "1", "x-category": "Holidays", "x-kind": "dtf", "x-source": "kittl" })).json()).item;
  const priv = (await (await post({ "x-filename": "secret.png" })).json()).item;
  assert.equal(pub.public, true); assert.equal(pub.category, "Holidays"); assert.equal(pub.kind, "dtf"); assert.equal(pub.source, "kittl"); assert.equal(priv.public, false);
  const app = { origin: "https://shirts.example.com" };
  const list = await handleImages(imgReq("/api/images?public=1", { headers: app }), ctx);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("access-control-allow-origin"), "https://shirts.example.com");
  const items = (await list.json()).items;
  assert.deepEqual(items.map((i) => i.name), ["pub.png"], "only public items are listed");
  assert.equal(items[0].size, undefined, "public list carries only what the app needs");
  assert.equal(items[0].url, undefined, "and no signed links");
  for (const o of ["https://design.elevatedshirts.com", "https://elevatedshirts.com", "https://www.elevatedshirts.com", "https://adub843.github.io"])
    assert.equal((await handleImages(imgReq("/api/images?public=1", { headers: { origin: o } }), ctx)).headers.get("access-control-allow-origin"), o, o);
  const file = await handleImages(imgReq(`/api/images/${pub.key}`, { headers: app }), ctx);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("access-control-allow-origin"), "https://shirts.example.com");
  assert.equal(file.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await handleImages(imgReq(`/api/images/${priv.key}`, { headers: app }), ctx)).status, 404, "private file hidden from the app");
  const evil = await handleImages(imgReq("/api/images?public=1", { headers: { origin: "https://evil.example" } }), ctx);
  assert.equal(evil.headers.get("access-control-allow-origin"), null, "other origins get no CORS");
  const retired = await handleImages(imgReq("/api/images?public=1", { headers: { origin: "https://epix3d.com" } }), ctx);
  assert.equal(retired.headers.get("access-control-allow-origin"), null, "the retired EPIX3D site gets no CORS");
  assert.equal((await handleImages(imgReq("/api/images", { headers: app }), ctx)).status, 401, "the full list still needs the key");
  // flip an existing image public, then private again
  const patch = (body, h = KEYH) => handleImages(imgReq(`/api/images/${priv.key}`, { method: "PATCH", headers: { "content-type": "application/json", ...h }, body: typeof body === "string" ? body : JSON.stringify(body) }), ctx);
  assert.equal((await patch({ public: true })).status, 200);
  assert.equal((await patch({ public: true }, {})).status, 401, "PATCH needs the key");
  assert.equal((await patch("not json")).status, 400);
  assert.equal((await patch("null")).status, 400);
  assert.equal((await (await handleImages(imgReq("/api/images?public=1"), ctx)).json()).items.length, 2);
  assert.equal((await patch({ public: false, category: "x".repeat(99), kind: "bogus" })).status, 200);
  const meta = ctx.blobs.m.get(`image:${priv.key}`).metadata;
  assert.equal(meta.public, false); assert.equal(meta.category.length, 60); assert.equal(meta.kind, undefined);
  assert.equal(new Uint8Array(ctx.blobs.m.get(`image:${priv.key}`).data).length, PNG.length, "the file itself is kept");
  assert.equal((await patch({ category: "" })).status, 200);
  assert.equal(ctx.blobs.m.get(`image:${priv.key}`).metadata.category, undefined, "an empty category clears it");
  assert.equal((await handleImages(imgReq(`/api/images/zz9-89abcdef`, { method: "PATCH", headers: KEYH, body: "{}" }), ctx)).status, 404);
  assert.equal((await handleImages(imgReq(`/api/images/${priv.key}`, { method: "POST", headers: { ...app, ...KEYH } }), ctx)).headers.get("access-control-allow-origin"), null, "no CORS on writes");
});

test("images: the longest name, tags and shirt-app fields still fit Workers KV's 1024-byte metadata", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  const long = "é".repeat(200);
  const up = await handleImages(imgReq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH,
    "x-filename": encodeURIComponent(long).slice(0, 400) + "a".repeat(200), "x-tags": "t".repeat(400), "x-public": "1", "x-category": "c".repeat(99), "x-kind": "dtf", "x-source": "s".repeat(50) }, body: PNG }), ctx);
  assert.equal(up.status, 201, "saved, not refused by KV");
  const { item } = await up.json();
  const stored = ctx.blobs.m.get(`image:${item.key}`).metadata;
  assert.ok(new TextEncoder().encode(JSON.stringify(stored)).length <= 1024);
  assert.equal(stored.public, true); assert.equal(stored.category.length, 60); assert.equal(stored.source.length, 20);
  assert.ok(stored.name.length > 0);
  const p = await handleImages(imgReq(`/api/images/${item.key}`, { method: "PATCH", headers: KEYH, body: JSON.stringify({ name: "n".repeat(500), tags: "x".repeat(500) }) }), ctx);
  assert.equal(p.status, 200, "a long PATCH is shortened to fit, not refused");
});

test("images: odd keys are 404, not a crash", async () => {
  const ctx = { blobs: fakeBlobs(), env: envOf() };
  for (const p of ["/api/images/%E0%A4%A", "/api/images/..%2Fx", "/api/images/not-a-key"])
    assert.equal((await handleImages(imgReq(p), ctx)).status, 404, p);
});

// ---------- what gets published ----------
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

// ---------- shirt builder (Elevated Designs only) ----------
test("list: ED products say whether they're in the shirt builder; C3D products don't carry it", async () => {
  const node = (id, tags) => ({ id: `gid://shopify/Product/${id}`, handle: `p${id}`, title: `P${id}`, status: "ACTIVE", productType: "", tags, updatedAt: "2026-10-20T10:00:00Z", totalInventory: 0, tracksInventory: false, featuredMedia: null, priceRangeV2: null, publishedOnPublication: true });
  const sh = fakeShopify({ override: { ConsoleProducts: (v, data) => data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(1, ["Builder-Blank", "tee"]), node(2, ["builder-blanks"])] } }) } });
  const ed = await handleProducts(keyed({ store: "ed" }), { env: envOf(), fetch: sh.fetch });
  assert.deepEqual(ed.body.products.map((p) => p.builder), [true, false]);
  const c3d = await handleProducts(keyed({ store: "c3d" }), { env: envOf(), fetch: sh.fetch });
  assert.ok(c3d.body.products.every((p) => !("builder" in p)));
});

test("shirt builder off: removes every spelling of builder-blank and nothing else", async () => {
  const sh = fakeShopify({ product: { tags: ["builder-blank", "Builder-Blank", "tee"] } });
  const res = await handleProducts(post({ store: "ed", id: PID, builder: false }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.builder, false);
  assert.equal(res.body.product.builder, false);
  assert.deepEqual(sh.calls.find((c) => c.op === "ConsoleTagsRemove").variables, { id: PID, tags: ["builder-blank", "Builder-Blank"] });
  assert.ok(!sh.calls.some((c) => c.op === "ConsoleTagsAdd" || c.op === "ConsolePublish" || c.op === "ConsoleUnpublish" || c.op === "ConsoleActivate"), "only the tag changes; the product stays on the site");
});

test("shirt builder on: adds builder-blank once", async () => {
  const sh = fakeShopify({ product: { tags: ["tee"] } });
  const res = await handleProducts(post({ store: "ed", id: PID, builder: true }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.builder, true);
  assert.deepEqual(sh.calls.find((c) => c.op === "ConsoleTagsAdd").variables, { id: PID, tags: ["builder-blank"] });
  const again = fakeShopify({ product: { tags: ["builder-blank"] } });
  await handleProducts(post({ store: "ed", id: PID, builder: true }), { env: envOf(), fetch: again.fetch });
  assert.ok(!again.calls.some((c) => /Tags(Add|Remove)/.test(c.op ?? "")));
});

test("shirt builder is refused for Charleston 3D before any Shopify call; one switch per request", async () => {
  const sh = fakeShopify();
  const res = await handleProducts(post({ store: "c3d", id: PID, builder: false }), { env: envOf(), fetch: sh.fetch });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "wrong_store");
  for (const body of [{ store: "ed", id: PID, builder: "no" }, { store: "ed", id: PID, builder: true, live: true }, { store: "ed", id: PID, builder: true, customizable: true }])
    assert.equal((await handleProducts(post(body), { env: envOf(), fetch: sh.fetch })).status, 400, JSON.stringify(body));
  assert.equal((await handleProducts(post({ store: "ed", id: PID, builder: true }, { "content-type": "application/json" }), { env: envOf(), fetch: sh.fetch })).status, 401);
  assert.equal(sh.calls.length, 0);
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
  assert.equal(res.body.url, "https://elevatedshirts.com/products/lowcountry-sunset-tee");
  assert.equal(res.body.adminUrl, "https://admin.shopify.com/store/elevated-designs/products/555");
  assert.match(res.body.message, /is live on elevatedshirts\.com/);
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
  assert.deepEqual(sh.calls.find((c) => c.indexnow).indexnow.urlList, ["https://elevatedshirts.com/products/lowcountry-sunset-tee"]);
  assert.equal(sh.calls.find((c) => c.indexnow).indexnow.host, "elevatedshirts.com");
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
  assert.equal(res.body.url, "https://elevatedshirts.com/products/lowcountry-sunset-tee");
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
  assert.equal(unsafeHtml("<p>Soft &amp; comfy. <a href=\"https://elevatedshirts.com/pages/faq\">Sizing</a> x < y, on sale</p><!-- note -->"), false);
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
  assert.equal(res.body.url, "https://elevatedshirts.com/products/big-tee");
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

// ---------- the Cloudflare Worker: what gets published, routing, bindings, limits ----------
const W = await import("../worker/app.mjs");
const I = await import("../lib/images.mjs");
const fakeAssets = () => ({ calls: [], async fetch(req) { this.calls.push(new URL(req.url).pathname); return new Response("<!doctype html><title>app</title>", { headers: { "content-type": "text/html" } }); } });
const workerEnv = (over = {}) => ({ ...ENV, IMAGES: fakeKV(), ASSETS: fakeAssets(), ...over });
const wreq = (path, init = {}) => new Request(`https://business-console.example.workers.dev${path}`, init);
async function withFetch(fn, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test("build: dist/ holds only index.html, assets/ and tools/, and wrangler.toml serves just that", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-build-"));
  for (const f of ["index.html", "assets", "tools", "lib", "scripts", "worker", "data", "package.json", "README.md", "wrangler.toml"])
    fs.cpSync(path.join(root, f), path.join(tmp, f), { recursive: true });
  execFileSync(process.execPath, [path.join(tmp, "scripts", "build.mjs")], { cwd: tmp, stdio: "ignore" });
  assert.deepEqual(fs.readdirSync(path.join(tmp, "dist")).sort(), ["assets", "index.html", "tools"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const toml = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  assert.match(toml, /^main = "worker\/index\.mjs"$/m);
  assert.match(toml, /^command = "node scripts\/build\.mjs"$/m);
  assert.match(toml, /\[assets\]\s+directory = "\.\/dist"\s+binding = "ASSETS"/);
  assert.match(toml, /^run_worker_first = true$/m, "API routes and security headers go through the Worker");
  assert.match(toml, /compatibility_flags = \["nodejs_compat"\]/);
  assert.match(toml, /\[\[kv_namespaces\]\]\s+binding = "IMAGES"/);
  assert.ok(!/\[vars\]|shpat_|CONSOLE_KEY\s*=|_TOKEN\s*=|_SECRET\s*=/.test(toml), "no vars, no secrets in wrangler.toml");
  assert.deepEqual([...toml.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)].map((m) => m[1]), ["c3d-files"], "one R2 bucket: Charleston 3D's print files");
  // Nothing in this project runs on Netlify: no config, functions, packages, code or docs for it.
  for (const gone of ["netlify.toml", "netlify", "lib/netlify.mjs"]) assert.ok(!fs.existsSync(path.join(root, gone)), `${gone} is gone`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /netlify/i.test(d)), "no Netlify packages");
  assert.ok(!/netlify/i.test(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")), "none in the lockfile either");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const hosting = ["wrangler.toml", "package.json", "README.md", "index.html", ...["worker", "lib", ".github", "tools"].flatMap((d) => walk(path.join(root, d)).map((f) => path.relative(root, f)))];
  for (const f of hosting) assert.ok(!/netlify/i.test(fs.readFileSync(path.join(root, f), "utf8")), `${f} mentions Netlify`);
});

test("worker: the entry module exports only the fetch and scheduled handlers (workerd refuses anything else)", async () => {
  const entry = await import("../worker/index.mjs");
  assert.deepEqual(Object.keys(entry), ["default"]);
  assert.deepEqual(Object.keys(entry.default), ["fetch", "scheduled"]);
  const res = await entry.default.fetch(wreq("/api/nope"), workerEnv());
  assert.equal(res.status, 404);
});

test("worker: app files get the CSP and security headers; unknown /api paths are JSON 404s", async () => {
  const env = workerEnv();
  const page = await W.handleRequest(wreq("/"), env);
  assert.equal(page.status, 200);
  assert.deepEqual(env.ASSETS.calls, ["/"]);
  const csp = page.headers.get("content-security-policy");
  for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(page.headers.get("referrer-policy"), /strict-origin/);
  for (const p of ["/api", "/api/", "/api/nope", "/api/products/x", "/api/imagesx"]) {
    const res = await W.handleRequest(wreq(p), env);
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8", p);
  }
  assert.deepEqual(env.ASSETS.calls, ["/"], "API paths never fall through to the files");
});

test("worker: /api/products, /api/insights and /api/listings reach their handlers with secrets from env", async () => {
  const sh = fakeShopify();
  await withFetch(async () => {
    const env = workerEnv();
    assert.equal((await W.handleRequest(wreq("/api/products?store=c3d"), env)).status, 401, "key needed");
    const list = await W.handleRequest(wreq("/api/products?store=c3d", { headers: KEYH }), env);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).products.length, 2);
    assert.ok(sh.calls.some((c) => c.token === TOKEN && c.domain === "charleston3d.myshopify.com"), "token and domain come from env");
    const ins = await W.handleRequest(wreq("/api/insights?store=c3d&days=3"), env);
    assert.equal(ins.status, 401);
    const lst = await W.handleRequest(wreq("/api/listings?store=ed", { headers: KEYH }), env);
    assert.equal(lst.status, 200);
    assert.ok((await lst.json()).template.catalog.blanks.length >= 3, "blank catalog is bundled");
    // A binding (an object) is never taken as a setting.
    const odd = await W.handleRequest(wreq("/api/products?store=c3d", { headers: KEYH }), workerEnv({ CONSOLE_KEY: { secret: "x".repeat(32) } }));
    assert.equal((await odd.json()).code, "key_not_set");
    // No secret ever comes back in an answer.
    const bad = await W.handleRequest(wreq("/api/products?store=c3d", { headers: { "x-console-key": "wrong-key-wrong-key-1" } }), env);
    const text = await bad.text();
    assert.ok(!text.includes(TOKEN) && !text.includes(ENV.CONSOLE_KEY), text);
  }, sh.fetch);
});

test("worker: JSON bodies are capped before they're read, with or without content-length", async () => {
  const sh = fakeShopify();
  await withFetch(async () => {
    const env = workerEnv();
    const big = JSON.stringify({ store: "c3d", id: PID, live: true, pad: "x".repeat(W.MAX_JSON_BYTES) });
    const r1 = await W.handleRequest(wreq("/api/products", { method: "POST", headers: { "content-type": "application/json", ...KEYH }, body: big }), env);
    assert.equal(r1.status, 413);
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 80; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024))); c.close(); } });
    const r2 = await W.handleRequest(wreq("/api/listings", { method: "POST", headers: { "content-type": "application/json", ...KEYH }, body: stream, duplex: "half" }), env);
    assert.equal(r2.status, 413);
    assert.equal(sh.calls.filter((c) => c.op && c.op !== "OnlineStorePublication").length, 0, "nothing reached Shopify");
  }, sh.fetch);
});

test("worker: image library on Workers KV keeps the same API (list, file, upload, delete)", async () => {
  const kv = fakeKV({ pageSize: 2 }); // several list pages, followed by cursor
  const env = workerEnv({ IMAGES: kv });
  assert.equal((await W.handleRequest(wreq("/api/images"), env)).status, 401, "list needs the key");
  assert.equal((await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png" }, body: PNG }), env)).status, 401, "upload needs the key");
  const keys = [], urls = [];
  for (let i = 0; i < 5; i++) {
    const up = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", "x-filename": `d${i}.png`, "x-tags": "palmetto", ...KEYH }, body: PNG }), env);
    assert.equal(up.status, 201);
    const { item } = await up.json();
    assert.deepEqual(Object.keys(item).sort(), ["added", "key", "name", "public", "size", "tags", "type", "url"]);
    keys.push(item.key); urls.push(item.url);
  }
  assert.ok([...kv.m.keys()].every((k) => k.startsWith("image:")), "stored under the image: prefix");
  const list = await W.handleRequest(wreq("/api/images", { headers: KEYH }), env);
  const { items } = await list.json();
  assert.equal(items.length, 5, "every page of the KV list");
  assert.deepEqual(new Set(items.map((i) => i.name)), new Set(["d0.png", "d1.png", "d2.png", "d3.png", "d4.png"]));
  assert.ok(items.every((i) => i.type === "image/png" && i.size === PNG.byteLength && i.tags === "palmetto"));
  assert.equal(kv.ops.filter(([op]) => op === "get").length, 0, "listing reads no values, only KV metadata");
  assert.equal((await W.handleRequest(wreq(`/api/images/${keys[0]}`), env)).status, 404, "a private file needs the key or its signed link");
  const file = await W.handleRequest(wreq(urls[0]), env);
  assert.equal(file.status, 200, "the console's <img> tags load it through the signed link");
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
  assert.equal(file.headers.get("access-control-allow-origin"), null, "no CORS: the console's own pages only");
  assert.equal((await W.handleRequest(wreq(`/api/images/${keys[0]}`, { method: "DELETE" }), env)).status, 401, "delete needs the key");
  assert.equal((await W.handleRequest(wreq(`/api/images/${keys[0]}`, { method: "DELETE", headers: KEYH }), env)).status, 200);
  assert.equal((await W.handleRequest(wreq(`/api/images/${keys[0]}`), env)).status, 404);
  assert.equal((await W.handleRequest(wreq(`/api/images/${keys[1]}`, { method: "PUT", headers: KEYH, body: PNG }), env)).status, 405);
  assert.equal(kv.m.size, 4);
  // A public image (for the shirt app) loads for anyone, with CORS only for the app's origins.
  const pub = (await (await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", "x-public": "1", ...KEYH }, body: PNG }), env)).json()).item;
  const open = await W.handleRequest(wreq(`/api/images/${pub.key}`, { headers: { origin: "https://elevatedshirts.com" } }), env);
  assert.equal(open.status, 200);
  assert.equal(open.headers.get("access-control-allow-origin"), "https://elevatedshirts.com");
  const plist = await W.handleRequest(wreq("/api/images?public=1"), env);
  assert.deepEqual((await plist.json()).items.map((i) => i.key), [pub.key]);
});

test("worker: a KV write that fails (e.g. the free plan's daily limit) is a clear 503, not a crash", async () => {
  const kv = fakeKV();
  kv.put = async () => { throw new Error("KV PUT failed: 429 Too Many Requests"); };
  const res = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: PNG }), workerEnv({ IMAGES: kv }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "storage_failed");
  assert.ok(!/429|KV PUT/.test(body.error), "the platform's own error isn't passed on");
});

test("worker: without the IMAGES binding the library says it isn't set up (and touches nothing)", async () => {
  const env = workerEnv({ IMAGES: undefined });
  const res = await W.handleRequest(wreq("/api/images", { headers: KEYH }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "storage_not_set_up");
});

test("worker: the Charleston 3D file library is routed to its own keys in the IMAGES namespace", async () => {
  const kv = fakeKV(), env = workerEnv({ IMAGES: kv });
  assert.equal((await W.handleRequest(wreq("/api/files"), env)).status, 401);
  const stl = new Uint8Array(84 + 50); new DataView(stl.buffer).setUint32(80, 1, true);
  const up = await W.handleRequest(wreq("/api/files", { method: "POST", headers: { "x-filename": "hook.stl", ...KEYH }, body: stl }), env);
  assert.equal(up.status, 201);
  assert.deepEqual([...kv.m.keys()].map((k) => k.split(":")[0]), ["c3d-file"]);
  const imgs = await W.handleRequest(wreq("/api/images", { headers: KEYH }), env);
  assert.deepEqual((await imgs.json()).items, [], "the Elevated Designs image list stays separate");
  assert.equal((await W.handleRequest(wreq("/api/files", { headers: KEYH }), workerEnv({ IMAGES: undefined }))).status, 503);
});

test("worker: uploads are capped at 20 MB (KV takes 25 MiB), even when streamed without a length", async () => {
  assert.equal(I.MAX_BYTES, 20 * 1024 * 1024);
  const kv = fakeKV(), env = workerEnv({ IMAGES: kv });
  const exact = new Uint8Array(I.MAX_BYTES); exact.set(PNG);
  const ok = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: exact }), env);
  assert.equal(ok.status, 201, "exactly 20 MB is taken");
  assert.equal([...kv.m.values()][0].data.byteLength, I.MAX_BYTES);
  const over = new Uint8Array(I.MAX_BYTES + 1); over.set(PNG);
  const r1 = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: over }), env);
  assert.equal(r1.status, 413);
  assert.match((await r1.json()).error, /larger than 20 MB/);
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024); chunk.set(PNG);
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(chunk.slice()); if (pulled > 100) c.close(); } });
  const r2 = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", ...KEYH }, body: endless, duplex: "half" }), env);
  assert.equal(r2.status, 413);
  assert.ok(pulled <= 25, `stopped reading early (${pulled} MB pulled)`);
  assert.equal(kv.m.size, 1, "nothing more stored");
});

test("worker: names and tags always fit KV's 1024-byte metadata, without control characters", async () => {
  const kv = fakeKV(), env = workerEnv({ IMAGES: kv });
  const name = "é\"\\".repeat(100) + "\t\u0001x"; // Latin-1 only: header values are byte strings
  const up = await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", "x-filename": name, "x-tags": "ÿ\"".repeat(150), ...KEYH }, body: PNG }), env);
  assert.equal(up.status, 201);
  const { metadata } = [...kv.m.values()][0];
  assert.ok(new TextEncoder().encode(JSON.stringify(metadata)).length <= 1024);
  assert.ok(!/[\u0000-\u001f]/.test(metadata.name + metadata.tags));
  assert.ok(metadata.name.startsWith("é\"\\"));
  // and the helper keeps whole characters within its byte budget for any text
  const fitted = I.fitText("\u{1F455}".repeat(300), 200);
  assert.ok(new TextEncoder().encode(fitted).length <= I.MAX_META_TEXT_BYTES && [...fitted].every((c) => c === "\u{1F455}"));
  assert.equal((await W.handleRequest(wreq("/api/images", { method: "POST", headers: { "content-type": "image/png", "x-filename": "\u0001\u0002", ...KEYH }, body: PNG }), env)).status, 201);
  assert.ok([...kv.m.values()].some((v) => v.metadata.name === "image"), "an empty name becomes 'image'");
});

test("worker: a listing reads its design from the same KV image library", async () => {
  const sh = fakeShopify();
  await withFetch(async () => {
    const kv = fakeKV();
    await fakeBlobs(kv).set(IMG_KEY, PNG_BYTES.buffer, { metadata: { name: "lowcountry_sunset-FINAL.png", type: "image/png", size: PNG_BYTES.byteLength, added: 1 } });
    const res = await W.handleRequest(wreq("/api/listings", { method: "POST", headers: { "content-type": "application/json", ...KEYH }, body: JSON.stringify(LISTING) }), workerEnv({ IMAGES: kv }));
    assert.equal(res.status, 201, await res.clone().text());
    const upload = sh.calls.find((c) => c.upload);
    assert.equal(upload.upload.size, PNG_BYTES.byteLength);
    assert.equal(upload.upload.type, "image/png");
    const missing = await W.handleRequest(wreq("/api/listings", { method: "POST", headers: { "content-type": "application/json", ...KEYH }, body: JSON.stringify({ ...LISTING, imageKey: "zzzzzz-0123abcd" }) }), workerEnv({ IMAGES: fakeKV() }));
    assert.equal(missing.status, 404);
  }, sh.fetch);
});

// ---------- shirt prices from the price sheet ----------
{
  const P = await import("../lib/pricing.mjs");
  const SHEET = [
    ["id", "brand", "style", "name", "type", "size", "shirtspace_cost", "bulkapparel_cost", "cheapest_cost", "suggested_price", "current_site_price", "your_price", "offer"],
    ["gildan-64000", "Gildan", "64000", "Softstyle Tee", "T-shirts", "S", "2.88", "2.81", "2.81", "13.99", "", "", "yes"],
    ["gildan-64000", "Gildan", "64000", "Softstyle Tee", "T-shirts", "2XL", "5.92", "5.95", "5.92", "19.99", "", "21.50", "yes"],
    ["comfortcolors-1717", "Comfort Colors", "1717", "Heavyweight", "T-shirts", "M", "7.38", "6.74", "6.74", "21.99", "27.99", "", "yes"],
    ["bella-3001", "Bella+Canvas", "3001", "Jersey", "T-shirts", "S", "5.73", "4.55", "4.55", "17.99", "", "", "yes"],
    ["fruit-3930r", "Fruit", "3930R", "HD", "T-shirts", "S", "", "", "", "9.99", "", "", "no"],
  ];

  test("pricing: sheet rows become blank+size prices; your_price wins; offer=no is left out", () => {
    const t = P.tableFromSheet(SHEET);
    assert.equal(t.get("gildan-64000|S"), 13.99);
    assert.equal(t.get("gildan-64000|2XL"), 21.5);
    assert.equal(t.get("fruit-3930r|S"), undefined);
    assert.throws(() => P.tableFromSheet([["name", "price"]]), /needs id, size/);
    assert.equal(P.tableHash(t), P.tableHash(P.tableFromSheet(SHEET)));
    assert.notEqual(P.tableHash(t), P.tableHash(P.tableFromSheet(SHEET.slice(0, 2))));
    assert.ok(P.tableFromCatalog().get("gildan-64000|S") > 0, "bundled prices cover the catalog");
  });

  test("pricing: a variant's blank comes from its SKU, a Style option, or colors only one blank sells", () => {
    const idx = P.blankIndex();
    const opt = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
    assert.deepEqual(P.identify(idx, {}, { sku: "lcc-gildan-64000-navy-S", selectedOptions: opt({ Size: "S" }) }), { blankId: "gildan-64000", size: "S" });
    assert.equal(P.identify(idx, {}, { sku: "x-gildan-5000b-white-M", selectedOptions: opt({ Size: "M" }) }).blankId, "gildan-5000b");
    assert.equal(P.identify(idx, {}, { sku: "ED-01-CC-PEPPER-S", selectedOptions: opt({ Style: "Comfort Colors 1717", Color: "Pepper", Size: "S" }) }).blankId, "comfortcolors-1717");
    assert.equal(P.identify(idx, {}, { selectedOptions: opt({ Shirt: "Gildan H000 – Hammer Heavyweight Tee", Size: "XL" }) }).blankId, "gildan-h000");
    assert.equal(P.identify(idx, { productType: "T-Shirt", colors: ["Pepper", "Espresso"] }, { selectedOptions: opt({ Color: "Pepper", Size: "S" }) }).blankId, "comfortcolors-1717");
    assert.equal(P.identify(idx, { productType: "T-Shirt", colors: [] }, { selectedOptions: opt({ Size: "S" }) }).blankId, null, "size-only shirts aren't guessed");
    assert.equal(P.identify(idx, { tags: ["builder-blank"], handle: "gildan-h000", colors: ["White"] }, { sku: "ED-H000-WHITE-S", selectedOptions: opt({ Color: "White", Size: "S" }) }).blankId, "gildan-h000", "a plain blank is named by its handle");
    assert.equal(P.identify(idx, { tags: [], handle: "gildan-h000", colors: [] }, { sku: "x", selectedOptions: opt({ Size: "S" }) }).blankId, null, "only for builder blanks");
    assert.equal(P.identify(idx, { productType: "T-Shirt", colors: ["Black"] }, { selectedOptions: opt({ Color: "Black", Size: "S" }) }).blankId, null, "a color many blanks sell isn't enough");
  });

  test("pricing: plan adds the design markup, blanks get the sheet price, other brands and unknowns are left alone", () => {
    const t = P.tableFromSheet(SHEET);
    const lines = [
      { id: "gid://shopify/Product/1", handle: "design", vendor: "Elevated Designs Originals", productType: "T-Shirt", tags: [] },
      { id: "gid://shopify/ProductVariant/11", __parentId: "gid://shopify/Product/1", sku: "ED-01-CC-PEPPER-M", price: "28.99", selectedOptions: [{ name: "Style", value: "Comfort Colors 1717" }, { name: "Color", value: "Pepper" }, { name: "Size", value: "M" }] },
      { id: "gid://shopify/ProductVariant/12", __parentId: "gid://shopify/Product/1", sku: "ED-01-BC-BLACK-S", price: "27.99", selectedOptions: [{ name: "Style", value: "Bella+Canvas 3001" }, { name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
      { id: "gid://shopify/Product/2", handle: "blank", vendor: "Elevated Designs", productType: "T-Shirt", tags: ["builder-blank"] },
      { id: "gid://shopify/ProductVariant/21", __parentId: "gid://shopify/Product/2", sku: "gildan-64000-white-S", price: "13.99", selectedOptions: [{ name: "Size", value: "S" }] },
      { id: "gid://shopify/ProductVariant/22", __parentId: "gid://shopify/Product/2", sku: "gildan-64000-white-2XL", price: "19.99", selectedOptions: [{ name: "Size", value: "2XL" }] },
      { id: "gid://shopify/Product/3", handle: "ornament", vendor: "Charleston 3D Prints", productType: "3D Printed Ornament", tags: [] },
      { id: "gid://shopify/ProductVariant/31", __parentId: "gid://shopify/Product/3", sku: "", price: "14.00", selectedOptions: [{ name: "Size", value: "S" }] },
      { id: "gid://shopify/Product/4", handle: "old-size-only", vendor: "Elevated Designs", productType: "T-Shirt", tags: [] },
      { id: "gid://shopify/ProductVariant/41", __parentId: "gid://shopify/Product/4", sku: null, price: "29.99", selectedOptions: [{ name: "Size", value: "S" }] },
      { id: "gid://shopify/Product/5", handle: "line-tee", vendor: "Over-Engineered Co.", productType: "T-Shirt", tags: ["Elevated Designs", "brand:b27"] },
      { id: "gid://shopify/ProductVariant/51", __parentId: "gid://shopify/Product/5", sku: "B27-01-CC-IVORY-M", price: "27.99", selectedOptions: [{ name: "Style", value: "Comfort Colors 1717" }, { name: "Color", value: "Ivory" }, { name: "Size", value: "M" }] },
      { id: "gid://shopify/Product/6", handle: "c3d-tee", vendor: "Charleston 3D Prints", productType: "T-Shirt", tags: ["Elevated Designs"] },
      { id: "gid://shopify/ProductVariant/61", __parentId: "gid://shopify/Product/6", sku: "", price: "20.00", selectedOptions: [{ name: "Style", value: "Comfort Colors 1717" }, { name: "Size", value: "M" }] },
      { id: "gid://shopify/Product/7", handle: "other-brand", vendor: "Someone Else", productType: "T-Shirt", tags: [] },
      { id: "gid://shopify/ProductVariant/71", __parentId: "gid://shopify/Product/7", sku: "", price: "20.00", selectedOptions: [{ name: "Style", value: "Comfort Colors 1717" }, { name: "Size", value: "M" }] },
    ];
    const { updates, report } = P.planChanges(lines, t, { markup: 10 });
    assert.deepEqual(updates, [
      { productId: "gid://shopify/Product/1", variants: [{ id: "gid://shopify/ProductVariant/11", price: "31.99" }, { id: "gid://shopify/ProductVariant/12", price: "27.99" }].filter((v) => v.price !== "27.99") },
      { productId: "gid://shopify/Product/2", variants: [{ id: "gid://shopify/ProductVariant/22", price: "21.50" }] },
      { productId: "gid://shopify/Product/5", variants: [{ id: "gid://shopify/ProductVariant/51", price: "31.99" }] },
    ]);
    assert.equal(report.unchanged, 2);
    assert.equal(report.skipped.not_a_shirt, 3, "C3D and untagged other brands stay untouched");
    assert.equal(report.skipped.unknown_shirt, 1);
    assert.deepEqual(report.unknown, ["old-size-only"]);
  });

  test("pricing: the sync runs query -> upload + bulk update -> done, and skips when nothing changed", async () => {
    const kvData = new Map();
    const kv = { get: async (k) => (kvData.has(k) ? JSON.parse(kvData.get(k)) : null), put: async (k, v) => { kvData.set(k, v); } };
    const calls = [];
    let status = "RUNNING";
    const JSONL = [
      { id: "gid://shopify/Product/1", handle: "design", vendor: "Elevated Designs", productType: "T-Shirt", tags: [] },
      { id: "gid://shopify/ProductVariant/11", __parentId: "gid://shopify/Product/1", sku: "a-gildan-64000-navy-S", title: "S", price: "29.99", selectedOptions: [{ name: "Size", value: "S" }] },
    ].map((l) => JSON.stringify(l)).join("\n");
    const fetchImpl = async (url, init = {}) => {
      const u = String(url);
      if (u === "https://bulk.example/out.jsonl") return new Response(JSONL, { status: 200 });
      if (u.startsWith(STAGED_URL)) { calls.push({ upload: await init.body.get("file").text() }); return new Response("", { status: 201 }); }
      const { query, variables } = JSON.parse(init.body);
      checkGraphql(query, variables);
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
      calls.push({ op, variables });
      const data = {
        ConsolePricingQuery: { bulkOperationRunQuery: { bulkOperation: { id: "gid://shopify/BulkOperation/1", status: "CREATED" }, userErrors: [] } },
        ConsolePricingStatus: { node: { id: variables.id, status, errorCode: null, objectCount: "2", url: "https://bulk.example/out.jsonl", partialDataUrl: null } },
        ConsolePricingStage: { stagedUploadsCreate: { stagedTargets: [{ url: STAGED_URL, resourceUrl: null, parameters: [{ name: "key", value: "tmp/prices.jsonl" }] }], userErrors: [] } },
        ConsolePricingApply: { bulkOperationRunMutation: { bulkOperation: { id: "gid://shopify/BulkOperation/2", status: "CREATED" }, userErrors: [] } },
      }[op];
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const env = envOf({ DESIGN_MARKUP: "10" });
    const client = (await import("../lib/shopify.mjs")).adminClient({ name: "Elevated Designs", domain: "elevated-designs.myshopify.com", token: "shpat_x", prefix: "ED" }, fetchImpl);
    let s = await P.step({ client, kv, env, fetchImpl });
    assert.equal(s.phase, "querying");
    assert.equal(s.source, "bundled");
    s = await P.step({ client, kv, env, fetchImpl });
    assert.equal(s.phase, "querying", "waits while Shopify is still running");
    status = "COMPLETED";
    s = await P.step({ client, kv, env, fetchImpl });
    assert.equal(s.phase, "applying");
    assert.equal(s.report.changed, 1);
    const up = calls.find((c) => c.upload);
    assert.deepEqual(JSON.parse(up.upload.trim()), { productId: "gid://shopify/Product/1", variants: [{ id: "gid://shopify/ProductVariant/11", price: "23.99" }] });
    const apply = calls.find((c) => c.op === "ConsolePricingApply").variables;
    assert.equal(apply.path, "tmp/prices.jsonl");
    // The bulk query and the per-line mutation travel as strings: check them against the schema too.
    checkGraphql(calls.find((c) => c.op === "ConsolePricingQuery").variables.query, {});
    checkGraphql(apply.mutation, { productId: "gid://shopify/Product/1", variants: [{ id: "gid://shopify/ProductVariant/11", price: "23.99" }] });
    s = await P.step({ client, kv, env, fetchImpl });
    assert.equal(s.phase, "idle");
    assert.ok(s.finishedAt);
    const before = calls.length;
    s = await P.step({ client, kv, env, fetchImpl });
    assert.equal(s.phase, "idle", "same prices and a fresh sync: nothing new starts");
    assert.equal(calls.length, before);
  });

  test("pricing: route needs the key, is ED only, and reports where the sync is", async () => {
    const kv = { get: async () => ({ phase: "idle", report: { changed: 3 } }), put: async () => {} };
    const r0 = await P.handlePricing({ method: "GET", query: new URLSearchParams("store=ed"), header: () => null }, { env: envOf(), kv, fetch });
    assert.equal(r0.status, 401);
    const hdr = (k) => (k === "x-console-key" ? ENV.CONSOLE_KEY : null);
    const r1 = await P.handlePricing({ method: "GET", query: new URLSearchParams("store=c3d"), header: hdr }, { env: envOf(), kv, fetch });
    assert.equal(r1.status, 400);
    const r2 = await P.handlePricing({ method: "GET", query: new URLSearchParams("store=ed"), header: hdr }, { env: envOf(), kv, fetch });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.markup, 10);
    assert.equal(r2.body.report.changed, 3);
  });
}

// ---------- marketing ----------
const MK = await import("../lib/marketing.mjs");
const MKENV = { C3D_INDEXNOW_KEY: "c3dkey12345678", ED_INDEXNOW_KEY: "edkey987654321" };
const HOME_GOOD = `<!doctype html><html><head><title>Charleston3D | Personalized 3D Printed Gifts, Charleston SC</title>
<meta name="description" content="Personalized ornaments, Lowcountry decor and custom 3D printed gifts, designed and made to order in Charleston, SC. Ships in 5-7 days.">
<link rel="canonical" href="https://charleston3d.com/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="Charleston3D"><meta property="og:description" content="Gifts"><meta property="og:image" content="https://cdn.shopify.com/a.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="geo.region" content="US-SC"><meta name="geo.placename" content="Charleston">
<meta name="google-site-verification" content="abcDEF1234567890">
<meta name="msvalidate.01" content="0123456789ABCDEF0123456789ABCDEF">
<link rel="alternate" type="text/plain" href="/pages/llms">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":["OnlineStore","LocalBusiness"],"name":"Charleston3D","address":{"@type":"PostalAddress","addressLocality":"Charleston","addressRegion":"SC"},"areaServed":[{"@type":"City","name":"Charleston"}]},{"@type":"WebSite","url":"https://charleston3d.com"}]}</script>
</head><body><h1>Gifts</h1><img src="a.png" alt="Ornament"><p>Made in Charleston, SC. Orders ship in 5-7 days.</p>
<script>(function(g,c){})("G-ABC1234XYZ", "k2abc3defg");</script></body></html>`;
const HOME_BAD = `<!doctype html><html><head><title>Home</title><meta name="robots" content="noindex,nofollow">
<script type="application/ld+json">{"@type":"LocalBusiness","telephone":"843-555-0100","address":{"streetAddress":"12 King St"}}</script>
<script type="application/ld+json">{ broken </script></head><body><h1>a</h1><h1>b</h1><img src="x.png"><p>Call 843-555-0100</p></body></html>`;
const PRODUCT_PAGE = `<html><head><title>Name Ornament, Charleston SC | Charleston3D</title><meta name="description" content="A personalized ornament with your family name, 3D printed to order in Charleston, SC. Ships in 5-7 days.">
<script type="application/ld+json">[{"@type":"Product","offers":[{"@type":"Offer","price":"24.00"}]},{"@type":"BreadcrumbList"}]</script></head><body></body></html>`;
const COLLECTION_PAGE = `<html><head><title>Personalized Christmas Ornaments | Charleston3D</title><meta name="description" content="Personalized Christmas ornaments with your family name, 3D printed to order in Charleston, SC. From $12."><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></head><body></body></html>`;
const ROBOTS_GOOD = `# Shopify defaults\nUser-agent: *\nDisallow: /cart\nDisallow: /checkout\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nAllow: /\nDisallow: /cart\n\nSitemap: https://charleston3d.com/sitemap.xml\n`;
const ROBOTS_BAD = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: Bingbot\nDisallow: /\n\nUser-agent: *\nDisallow: /checkout\n`;
const LLMS = `# Charleston3D\n\n> Personalized 3D printed gifts made to order in Charleston, SC.\n\n${"- Ornaments from $12\n".repeat(20)}`;

function fakeSite({ bad = false, site = "https://charleston3d.com", keys = MKENV, down = false, noLlms = false } = {}) {
  const hits = [];
  const host = new URL(site).host;
  const text = (body, status = 200, type = "text/html") => new Response(body, { status, headers: { "content-type": type } });
  return { hits, fetch: async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.host !== host) return null;
    hits.push(u.pathname);
    assert.ok(init.signal, "every site fetch has a timeout");
    assert.match(init.headers["user-agent"], /BusinessConsole-SEO/);
    if (down) return text("", 503);
    switch (u.pathname) {
      case "/": return text(bad ? HOME_BAD : HOME_GOOD);
      case "/robots.txt": return text(bad ? ROBOTS_BAD : ROBOTS_GOOD, 200, "text/plain");
      case "/llms.txt": return noLlms || bad ? text("<html>Not found</html>", 404) : text(LLMS, 200, "text/plain");
      case "/sitemap.xml": return text(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${site}/sitemap_products_1.xml?from=1&amp;to=9</loc></sitemap><sitemap><loc>${site}/sitemap_collections_1.xml</loc></sitemap><sitemap><loc>https://evil.example/x.xml</loc></sitemap></sitemapindex>`, 200, "application/xml");
      case "/sitemap_products_1.xml": return text(`<urlset><url><loc>${site}/</loc></url><url><loc>${site}/products/name-ornament</loc></url><url><loc>${site}/products/keychain</loc></url></urlset>`, 200, "application/xml");
      case "/sitemap_collections_1.xml": return text(`<urlset><url><loc>${site}/collections/all</loc></url><url><loc>${site}/collections/frontpage</loc></url><url><loc>${site}/collections/ornaments</loc></url></urlset>`, 200, "application/xml");
      case "/products/name-ornament": return text(PRODUCT_PAGE);
      case "/collections/ornaments": return text(COLLECTION_PAGE);
      default: {
        const key = Object.values(keys).find((k) => u.pathname === `/${k}.txt`);
        // The C3D theme serves only the C3D key, so a pairing with the other brand's key fails.
        if (key && (host === "charleston3d.com" ? key === keys.C3D_INDEXNOW_KEY : key === keys.ED_INDEXNOW_KEY)) return text(key, 200, "text/plain");
        return text("Not found", 404);
      }
    }
  } };
}
// One fetch for a test: the public site(s), Bing, Google, IndexNow, then the fake Shopify.
function mkFetch(sh, ...sites) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    for (const s of sites) { const r = await s.fetch(url, init); if (r) return r; }
    const u = String(url);
    if (u.startsWith("https://ssl.bing.com/")) { calls.push({ bing: u }); return mkFetch.bing?.(u) ?? new Response(JSON.stringify({ d: [] }), { status: 200 }); }
    if (u.startsWith("https://oauth2.googleapis.com/") || u.startsWith("https://searchconsole.googleapis.com/")) { calls.push({ google: u, init }); return mkFetch.google(u, init); }
    return sh.fetch(url, init);
  };
  return { fetch, calls };
}
const mkGet = (q) => keyed(q);
const mkCtx = (f, over = {}, extra = {}) => ({ env: envOf({ ...MKENV, ...over }), fetch: f, ...extra });
const levelOf = (a, id) => a.checks.find((c) => c.id === id)?.level;

test("marketing: readPage reads title, description, schema types, verification, geo and analytics", () => {
  const p = MK.readPage(HOME_GOOD);
  assert.equal(p.title, "Charleston3D | Personalized 3D Printed Gifts, Charleston SC");
  assert.equal(p.h1, 1);
  assert.equal(p.canonical, "https://charleston3d.com/");
  assert.deepEqual(p.ldTypes, ["LocalBusiness", "OnlineStore", "PostalAddress", "WebSite", "City"].sort());
  assert.equal(p.ldAreaServed, true);
  assert.equal(p.ldStreetAddress, false);
  assert.equal(p.ga4, true);
  assert.equal(p.clarity, true);
  assert.equal(p.bingVerification, "0123456789ABCDEF0123456789ABCDEF");
  assert.equal(p.llmsLink, "/pages/llms");
  assert.equal(p.phoneInText, false, "5-7 days is not a phone number");
  const b = MK.readPage(HOME_BAD);
  assert.equal(b.ldBroken, 1);
  assert.equal(b.ldTelephone, true);
  assert.equal(b.ldStreetAddress, true);
  assert.equal(b.phoneInText, true);
  assert.equal(b.imagesNoAlt, 1);
  assert.equal(b.clarity, false);
  assert.equal(b.ga4, false);
});

test("marketing: robots.txt groups decide which crawlers are blocked", () => {
  const good = MK.parseRobots(ROBOTS_GOOD);
  assert.deepEqual(good.sitemaps, ["https://charleston3d.com/sitemap.xml"]);
  for (const [bot] of MK.CRAWLERS) assert.equal(MK.crawlerBlocked(good, bot), false, bot);
  const bad = MK.parseRobots(ROBOTS_BAD);
  assert.equal(MK.crawlerBlocked(bad, "GPTBot"), true);
  assert.equal(MK.crawlerBlocked(bad, "PerplexityBot"), true, "a group with two user agents applies to both");
  assert.equal(MK.crawlerBlocked(bad, "Bingbot"), true);
  assert.equal(MK.crawlerBlocked(bad, "Googlebot"), false, "falls back to * which only blocks /checkout");
  assert.equal(MK.crawlerBlocked(MK.parseRobots("User-agent: *\nDisallow: /\nAllow: /$\n"), "GPTBot"), false, "Allow wins a tie");
  assert.equal(MK.crawlerBlocked(MK.parseRobots("User-agent: *\nDisallow:\n"), "GPTBot"), false, "an empty Disallow blocks nothing");
});

test("marketing: a healthy site scores well, uses its own IndexNow key, and only reads its own host", async () => {
  const site = fakeSite();
  const a = await MK.auditSite(site.fetch, { store: "c3d", site: "https://charleston3d.com", key: MKENV.C3D_INDEXNOW_KEY, clock: () => NOW });
  const notPass = a.checks.filter((c) => c.level !== "pass").map((c) => `${c.id}: ${c.title}`);
  assert.deepEqual(notPass, []);
  assert.equal(a.scores.overall, 100);
  for (const k of Object.keys(MK.AREAS)) assert.equal(a.scores[k], 100, k);
  assert.ok(site.hits.includes(`/${MKENV.C3D_INDEXNOW_KEY}.txt`));
  assert.ok(!site.hits.includes(`/${MKENV.ED_INDEXNOW_KEY}.txt`), "never checks the other brand's key");
  assert.deepEqual(a.pages.map((p) => p.kind), ["home", "product", "collection"]);
  assert.equal(a.sitemapCount, 6, "other hosts in the sitemap are ignored");
  assert.ok(!site.hits.includes("/collections/all"), "collections/all is not used as the sample collection");
  assert.ok(!site.hits.includes("/collections/frontpage"), "the hidden home page collection is not used either");
});

test("marketing: a domain that redirects to another host is flagged and the live sitemap is still read", async () => {
  const live = fakeSite({ site: "https://theelevateddesignsllc.com" });
  const redirecting = async (url, init) => {
    const u = new URL(String(url));
    if (u.host !== "elevatedshirts.com") return live.fetch(url, init);
    u.host = "theelevateddesignsllc.com";
    const r = await live.fetch(u.href, init);
    Object.defineProperty(r, "url", { value: u.href });
    return r;
  };
  const a = await MK.auditSite(redirecting, { store: "ed", site: "https://elevatedshirts.com", key: MKENV.ED_INDEXNOW_KEY, clock: () => NOW });
  const d = a.checks.find((c) => c.id === "domain");
  assert.equal(d.level, "fail");
  assert.match(d.title, /elevatedshirts\.com redirects to theelevateddesignsllc\.com/);
  assert.match(d.fix, /Settings > Domains/);
  assert.ok(a.sitemapCount > 0, "pages on the live host are counted");
  assert.deepEqual(a.pages.map((p) => p.kind), ["home", "product", "collection"]);
  const fine = await MK.auditSite(fakeSite().fetch, { store: "c3d", site: "https://charleston3d.com", key: MKENV.C3D_INDEXNOW_KEY, clock: () => NOW });
  assert.equal(fine.checks.find((c) => c.id === "domain"), undefined);
});

test("marketing: an llms link with an empty address is called out", () => {
  const p = MK.readPage(HOME_GOOD.replace('href="/pages/llms"', 'href=""'));
  if (p.llmsLink !== "") return assert.fail("fixture has no llms link to empty: " + p.llmsLink);
  const out = [];
  MK.pageChecks("home", "https://charleston3d.com/", p, out);
  assert.match(out.find((c) => c.id === "llms-link").title, /empty address/);
});

test("marketing: a broken site lists each problem with a fix", async () => {
  const a = await MK.auditSite(fakeSite({ bad: true }).fetch, { store: "c3d", site: "https://charleston3d.com", key: "", clock: () => NOW });
  for (const id of ["noindex", "home-description", "schema-home", "schema-broken", "privacy", "llms", "indexnow-key", "crawl-ai", "crawl-bing", "geo-meta", "canonical"])
    assert.equal(levelOf(a, id), "fail", id);
  for (const id of ["h1", "home-alt", "ga4", "clarity", "bing-verify", "google-verify", "robots-sitemap"]) assert.equal(levelOf(a, id), "warn", id);
  assert.equal(levelOf(a, "crawl-seo"), "pass", "Googlebot still allowed");
  assert.match(a.checks.find((c) => c.id === "crawl-ai").title, /GPTBot, ClaudeBot, PerplexityBot/);
  assert.match(a.checks.find((c) => c.id === "indexnow-key").fix, /IndexNow key in the console.s settings/);
  assert.ok(a.checks.filter((c) => c.level !== "pass").every((c) => c.fix || c.detail), "every problem says what's wrong or how to fix it");
  assert.ok(a.scores.overall < 50);
  const down = await MK.auditSite(fakeSite({ down: true }).fetch, { store: "c3d", site: "https://charleston3d.com", key: "c3dkey12345678", clock: () => NOW });
  assert.equal(levelOf(down, "home-up"), "fail");
  assert.equal(levelOf(down, "sitemap"), "fail");
});

test("marketing: the Elevated Designs key is never verified on Charleston 3D (brands stay apart)", async () => {
  const a = await MK.auditSite(fakeSite().fetch, { store: "c3d", site: "https://charleston3d.com", key: MKENV.ED_INDEXNOW_KEY, clock: () => NOW });
  assert.equal(levelOf(a, "indexnow-key"), "fail");
});

test("marketing: audit needs the key, saves daily history per store and reports new problems", async () => {
  const kv = fakeKV();
  const sh = fakeShopify();
  const ok1 = mkFetch(sh, fakeSite());
  assert.equal((await MK.handleMarketing(get({ store: "c3d" }), mkCtx(ok1.fetch, {}, { kv }))).status, 401);
  assert.equal((await MK.handleMarketing(keyed({ store: "xx" }), mkCtx(ok1.fetch, {}, { kv }))).status, 400);
  assert.equal((await MK.handleMarketing(keyed({ store: "c3d", part: "nope" }), mkCtx(ok1.fetch, {}, { kv }))).status, 400);
  const day1 = await MK.handleMarketing(keyed({ store: "c3d" }), mkCtx(ok1.fetch, {}, { kv, now: () => new Date("2026-10-24T11:00:00Z") }));
  assert.equal(day1.status, 200);
  assert.equal(day1.body.previous, null);
  assert.equal(day1.body.history.length, 1);
  assert.deepEqual(day1.body.indexNow, { key: true, own: true });
  const bad = mkFetch(sh, fakeSite({ noLlms: true }));
  const day2 = await MK.handleMarketing(keyed({ store: "c3d" }), mkCtx(bad.fetch, {}, { kv, now: () => new Date("2026-10-25T11:00:00Z") }));
  assert.equal(day2.body.previous.date, "2026-10-24");
  assert.deepEqual(day2.body.newProblems, ["llms"]);
  assert.equal(day2.body.history.length, 2);
  const again = await MK.handleMarketing(keyed({ store: "c3d" }), mkCtx(ok1.fetch, {}, { kv, now: () => new Date("2026-10-25T15:00:00Z") }));
  assert.equal(again.body.history.length, 2, "one entry per day");
  assert.deepEqual(again.body.fixed, [], "the previous day had no llms failure");
  assert.ok(kv.m.has("history:c3d") && !kv.m.has("history:ed"));
  const hist = await MK.handleMarketing(keyed({ store: "ed", part: "history" }), mkCtx(ok1.fetch, {}, { kv }));
  assert.deepEqual(hist.body.history, [], "Elevated Designs has its own history");
  // Without the KV binding it still checks, and says history isn't kept.
  const nokv = await MK.handleMarketing(keyed({ store: "c3d" }), mkCtx(ok1.fetch));
  assert.equal(nokv.status, 200);
  assert.equal(nokv.body.historyAvailable, false);
  assert.equal(sh.calls.filter((c) => c.op).length, 0, "the audit needs no Shopify access");
});

test("marketing: history keeps 120 days", async () => {
  const kv = fakeKV();
  for (let i = 0; i < 125; i++) {
    const day = new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString();
    await MK.saveHistory(kv, { store: "ed", checkedAt: day, scores: { overall: i % 100 }, checks: [] });
  }
  const h = await MK.readHistory(kv, "ed");
  assert.equal(h.length, 120);
  assert.equal(h[0].date, "2026-06-06");
});

const catalogShopify = (opts = {}) => fakeShopify({ ...opts, override: {
  MarketingCatalog: (v, data) => data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    { id: "gid://shopify/Product/1", handle: "name-ornament", title: "Name Ornament", productType: "Ornament", seo: { title: null, description: null },
      description: "A personalized ornament with your family name. Printed in silk PLA.", featuredMedia: { id: "gid://shopify/MediaImage/11", alt: "", preview: { image: { url: "https://cdn.shopify.com/o.jpg" } } } },
    { id: "gid://shopify/Product/2", handle: "keychain", title: "Keychain", productType: "", seo: { title: "Custom Keychain, 3D Printed in Charleston SC | Charleston3D", description: "A custom name keychain, 3D printed to order in Charleston, SC. Ships in 5-7 business days." },
      description: "", featuredMedia: { id: "gid://shopify/MediaImage/12", alt: "Blue keychain", preview: { image: { url: "https://cdn.shopify.com/k.jpg" } } } },
    { id: "gid://shopify/Product/3", handle: "blank", title: "Ornaments", productType: "", seo: { title: "", description: "" }, description: "", featuredMedia: null },
  ] } }),
  MarketingCollections: (v, data) => data({ collections: { nodes: [
    { id: "gid://shopify/Collection/5", handle: "ornaments", title: "Ornaments", seo: { title: null, description: null }, description: "Ornaments made in Charleston.", image: null },
    { id: "gid://shopify/Collection/6", handle: "frontpage", title: "Home page", seo: { title: null, description: null }, description: "", image: null },
  ] } }),
  ...opts.override,
} });

test("marketing: catalog lists SEO problems with suggestions inside the limits", async () => {
  const sh = catalogShopify();
  const res = await MK.handleMarketing(keyed({ store: "c3d", part: "catalog" }), mkCtx(sh.fetch));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const by = Object.fromEntries(res.body.items.map((i) => [i.handle, i]));
  assert.ok(!by.frontpage, "the hidden frontpage collection is skipped");
  assert.deepEqual(by.keychain.issues, [], "a complete product has no issues");
  assert.deepEqual(by["name-ornament"].issues.map((i) => i.field), ["title", "description", "alt"]);
  assert.equal(by["name-ornament"].mediaId, "gid://shopify/MediaImage/11");
  assert.equal(by.blank.issues.find((i) => i.field === "description").level, "fail");
  assert.ok(by.blank.issues.some((i) => i.text === "Same title as another page"), "duplicate titles are flagged");
  assert.ok(by.ornaments.issues.some((i) => i.text === "Same title as another page"));
  assert.equal(by["name-ornament"].url, "https://charleston3d.com/products/name-ornament");
  assert.equal(by.ornaments.url, "https://charleston3d.com/collections/ornaments");
  for (const i of res.body.items) {
    assert.ok(i.suggestion.title.length <= 60, i.suggestion.title);
    assert.ok(i.suggestion.description.length <= 155 && i.suggestion.description.length >= 50, i.suggestion.description);
    assert.match(i.suggestion.title, /\| Charleston3D$/);
  }
  assert.equal(by["name-ornament"].suggestion.title, "Name Ornament, Charleston SC | Charleston3D");
  assert.match(by["name-ornament"].suggestion.description, /^A personalized ornament with your family name\. Designed and 3D printed/);
  assert.deepEqual(res.body.summary, { total: 4, withIssues: 3, ok: 1, noSeoTitle: 3, noSeoDescription: 3, noAlt: 1 });
  noLeak(res);
});

const fixWrites = {
  MarketingProductSeo: (v, data) => data({ productUpdate: { product: { id: v.product.id, handle: "x", seo: v.product.seo }, userErrors: [] } }),
  MarketingCollectionSeo: (v, data) => data({ collectionUpdate: { collection: { id: v.input.id, handle: "x", seo: v.input.seo }, userErrors: [] } }),
  MarketingAlt: (v, data) => data({ fileUpdate: { files: [{ id: v.files[0].id, alt: v.files[0].alt }], userErrors: [] } }),
};

test("marketing: automatic fixes fill what's missing, keep good wording, log the old value and ping IndexNow", async () => {
  const sh = catalogShopify({ override: fixWrites });
  const kv = fakeKV();
  const res = await MK.handleMarketing(post({ store: "c3d", action: "autofix" }), mkCtx(sh.fetch, {}, { kv }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const seo = sh.calls.filter((c) => c.op === "MarketingProductSeo").map((c) => c.variables.product);
  assert.deepEqual(seo.map((p) => p.id), ["gid://shopify/Product/1", "gid://shopify/Product/3"], "the complete keychain is left alone");
  assert.equal(seo[0].seo.title, "Name Ornament, Charleston SC | Charleston3D");
  assert.match(seo[0].seo.description, /^A personalized ornament with your family name\./);
  const alt = sh.calls.find((c) => c.op === "MarketingAlt").variables.files[0];
  assert.deepEqual(alt, { id: "gid://shopify/MediaImage/11", alt: "Name Ornament from Charleston3D" });
  assert.equal(sh.calls.filter((c) => c.op === "MarketingAlt").length, 1, "an existing alt text is never replaced");
  assert.equal(sh.calls.filter((c) => c.op === "MarketingCollectionSeo").length, 1, "the hidden frontpage collection is skipped");
  assert.equal(res.body.applied.length, 4);
  assert.equal(res.body.remaining, 0);
  const ping = sh.calls.find((c) => c.indexnow).indexnow;
  assert.equal(ping.key, MKENV.C3D_INDEXNOW_KEY);
  assert.ok(ping.urlList.includes("https://charleston3d.com/products/name-ornament"));
  const log = await MK.handleMarketing(keyed({ store: "c3d", part: "changes" }), mkCtx(sh.fetch, {}, { kv }));
  assert.equal(log.body.changes.length, 4);
  assert.equal(log.body.auto, true);
  const first = log.body.changes.find((f) => f.kind === "seo" && f.title === "Name Ornament");
  assert.deepEqual(first.before, { seoTitle: "", seoDescription: "" });
  assert.match(first.at, /^\d{4}-\d\d-\d\dT/);
  const ed = await MK.handleMarketing(keyed({ store: "ed", part: "changes" }), mkCtx(sh.fetch, {}, { kv }));
  assert.deepEqual(ed.body.changes, [], "each store keeps its own log");
});

test("marketing: fix rules: lengths, never a shorter description, and the per-run cap", () => {
  const item = (o) => ({ kind: "product", id: "gid://shopify/Product/9", title: "Tee", url: "https://elevatedshirts.com/products/tee", seoTitle: "", seoDescription: "", mediaId: null, alt: "",
    suggestion: { title: "Tee | Elevated Designs", description: "A soft tee printed in Charleston, SC, by Elevated Designs. Order yours today." }, ...o });
  const ok = "A heavyweight tee screen printed by hand in Charleston, South Carolina. Ships in a week.";
  assert.deepEqual(MK.planFixes("ed", { items: [item({ seoTitle: "Tee: the Lowcountry classic | Elevated Designs", seoDescription: ok })] }), [], "good wording stays");
  const long = MK.planFixes("ed", { items: [item({ seoTitle: "x".repeat(61), seoDescription: ok })] });
  assert.deepEqual(long[0].after, { seoTitle: "Tee | Elevated Designs", seoDescription: ok }, "only the field out of range changes");
  const short = MK.planFixes("ed", { items: [item({ seoTitle: "Tee | Elevated Designs", seoDescription: "Soft tee." })] });
  assert.equal(short[0].after.seoDescription, item({}).suggestion.description);
  const shorter = MK.planFixes("ed", { items: [item({ seoTitle: "Tee | Elevated Designs", seoDescription: "x".repeat(69), suggestion: { title: "Tee | Elevated Designs", description: "Short." } })] });
  assert.deepEqual(shorter, [], "a suggestion shorter than what's there is not used");
  const many = Array.from({ length: 20 }, (_, n) => item({ id: `gid://shopify/Product/${n + 1}`, mediaId: `gid://shopify/MediaImage/${n + 1}` }));
  assert.equal(MK.planFixes("ed", { items: many }).length, MK.AUTOFIX_MAX_CHANGES);
  assert.ok(MK.planFixes("ed", { items: many }).every((f) => !/Charleston3D/.test(JSON.stringify(f.after))), "brands stay separate");
});

test("marketing: the daily fix run covers both stores, survives one failing, and can be switched off", async () => {
  const sh = catalogShopify({ override: fixWrites });
  const kv = fakeKV();
  const out = await MK.runScheduledFixes(envOf({ ...MKENV }), sh.fetch, kv);
  assert.equal(out.c3d.applied, 4);
  assert.equal(out.ed.applied, 4);
  assert.ok(kv.m.has("changes:c3d") && kv.m.has("changes:ed"));
  const off = await MK.runScheduledFixes(envOf({ ...MKENV, MARKETING_AUTOFIX: "off" }), sh.fetch, fakeKV());
  assert.deepEqual(off, {});
  const half = await MK.runScheduledFixes(envOf({ ...MKENV, ED_SHOPIFY_DOMAIN: undefined }), sh.fetch, fakeKV());
  assert.equal(half.c3d.applied, 4);
  assert.equal(half.ed.error, "not_connected");
  const denied = catalogShopify({ override: { ...fixWrites, MarketingProductSeo: () => new Response(JSON.stringify({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED", requiredAccess: "`write_products`" } }] }), { status: 200 }) } });
  const r = await MK.handleMarketing(post({ store: "c3d", action: "autofix" }), mkCtx(denied.fetch, {}, { kv: fakeKV() }));
  assert.equal(r.status, 200);
  assert.equal(r.body.applied.length, 0);
  assert.equal(r.body.failed.length, 1, "stops after the first access denied");
  const bad = await MK.handleMarketing(post({ store: "c3d", action: "autofix", extra: 1 }), mkCtx(sh.fetch));
  assert.equal(bad.status, 400);
});

// ShopifyQL answers keyed by the report asked for, with rows per day relative to NOW.
const dayOf = (offset) => new Date(NOW.getTime() - offset * 86400000).toISOString().slice(0, 10);
function qlShopify({ pageRows = [], siteRows = [], salesRows = [], extra = {}, ...opts } = {}) {
  const table = (columns, rows) => ({ shopifyqlQuery: { parseErrors: [], tableData: { columns: columns.map((name) => ({ name, dataType: "STRING" })), rows: rows.map((r) => columns.map((c) => r[c] ?? null)) } } });
  return catalogShopify({ ...opts, override: { ...fixWrites,
    MarketingTraffic: (v, data) => {
      if (/GROUP BY landing_page_path/.test(v.q)) return data(table(["day", "landing_page_path", "sessions", "sessions_with_cart_additions", "sessions_that_completed_checkout"], pageRows));
      if (/^FROM sessions SHOW sessions, online_store_visitors/.test(v.q)) return data(table(["day", "sessions", "online_store_visitors", "sessions_with_cart_additions", "sessions_that_reached_checkout", "sessions_that_completed_checkout", "conversion_rate", "average_session_duration", "bounce_rate"], siteRows));
      if (/^FROM sales/.test(v.q)) return data(table(["day", "orders", "total_sales"], salesRows));
      return data(table([], []));
    }, ...extra } });
}
const daily = (path, from, to, sessions) => Array.from({ length: from - to + 1 }, (_, i) => ({ day: dayOf(from - i), landing_page_path: path, sessions, sessions_with_cart_additions: 0, sessions_that_completed_checkout: 0 }));

test("marketing: a change's effect compares visits per day in the 14 days before and since", () => {
  const pages = MK.pageDays([...daily("/products/tee", 30, 16, 4), ...daily("/products/tee", 15, 0, 6), { day: dayOf(3), landing_page_path: "/products/tee?x=1", sessions: 2 }]);
  const e = MK.changeEffect({ at: `${dayOf(15)}T12:00:00Z` }, pages.get("/products/tee"), NOW);
  assert.equal(e.days, 14);
  assert.equal(e.beforePerDay, 4);
  assert.equal(e.afterPerDay, 6.14, "query strings count toward the page");
  assert.equal(e.change, 53);
  assert.equal(e.early, false);
  const young = MK.changeEffect({ at: `${dayOf(3)}T12:00:00Z` }, pages.get("/products/tee"), NOW);
  assert.equal(young.days, 3);
  assert.equal(young.early, true);
  assert.equal(MK.changeEffect({ at: `${dayOf(20)}T00:00:00Z` }, undefined, NOW).change, null, "no visits before: no percentage");
});

test("marketing: 14 days on, an automatic change that cut its page's visits is undone and left alone", async () => {
  const kv = fakeKV();
  const at = `${dayOf(16)}T11:30:00Z`;
  const changes = [
    MK.changeEntry({ at, source: "auto", kind: "seo", itemKind: "product", target: "gid://shopify/Product/2", title: "Keychain", url: "https://charleston3d.com/products/keychain",
      before: { seoTitle: "Keychain old", seoDescription: "old description" },
      after: { seoTitle: "Custom Keychain, 3D Printed in Charleston SC | Charleston3D", seoDescription: "A custom name keychain, 3D printed to order in Charleston, SC. Ships in 5-7 business days." } }),
    MK.changeEntry({ at, source: "auto", kind: "seo", itemKind: "product", target: "gid://shopify/Product/1", title: "Name Ornament", url: "https://charleston3d.com/products/name-ornament",
      before: { seoTitle: "", seoDescription: "" }, after: { seoTitle: "x", seoDescription: "y" } }),
  ];
  await kv.put("changes:c3d", JSON.stringify(changes));
  const sh = qlShopify({ pageRows: [...daily("/products/keychain", 31, 17, 5), ...daily("/products/keychain", 16, 0, 2), ...daily("/products/name-ornament", 31, 0, 3)] });
  const r = await MK.applyFixes({ env: envOf({ ...MKENV }), fetchImpl: sh.fetch, kv, store: "c3d", clock: () => NOW });
  assert.equal(r.reviewed, 2);
  const undo = sh.calls.filter((c) => c.op === "MarketingProductSeo").find((c) => c.variables.product.id === "gid://shopify/Product/2");
  assert.deepEqual(undo.variables.product.seo, { title: "Keychain old", description: "old description" });
  const log = await MK.readChanges(kv, "c3d");
  const revert = log.find((c) => c.kind === "revert");
  assert.match(revert.note, /fell 6\d% in the 14 days/);
  assert.equal(log.find((c) => c.id === changes[0].id).review.verdict, "undo");
  // The ornament's current SEO isn't what the change wrote (someone changed it), so it's kept as is.
  assert.equal(log.find((c) => c.id === changes[1].id).review.verdict, "kept");
  // Next run: the undone keychain is left alone even though its wording is short.
  const sh2 = qlShopify();
  await MK.applyFixes({ env: envOf({ ...MKENV }), fetchImpl: sh2.fetch, kv, store: "c3d", clock: () => NOW });
  assert.ok(!sh2.calls.some((c) => c.op === "MarketingProductSeo" && c.variables.product.id === "gid://shopify/Product/2"));
  assert.ok(!sh2.calls.some((c) => /GROUP BY landing_page_path/.test(c.variables?.q ?? "")), "nothing left to review, so no page report");
});

test("marketing: changes made on the page are logged with what they replaced, and can be undone", async () => {
  const kv = fakeKV();
  const sh = qlShopify({ extra: {
    MarketingSeoBefore: (v, data) => data({ node: v.id.includes("Product/1")
      ? { title: "Name Ornament", handle: "name-ornament", seo: { title: "Old title", description: "Old description" }, featuredMedia: { id: "gid://shopify/MediaImage/11", alt: "old alt" } }
      : null }),
    MarketingProductSeo: (v, data) => data({ productUpdate: { product: { id: v.product.id, handle: "name-ornament", seo: v.product.seo }, userErrors: [] } }),
  } });
  const ctx = mkCtx(sh.fetch, {}, { kv, now: () => NOW });
  const s1 = await MK.handleMarketing(post({ store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: "New title for the ornament", seoDescription: "New description" }), ctx);
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const s2 = await MK.handleMarketing(post({ store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/11", productId: "gid://shopify/Product/1", alt: "Red ornament" }), ctx);
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  let log = (await MK.handleMarketing(keyed({ store: "c3d", part: "changes" }), ctx)).body.changes;
  assert.deepEqual(log.map((c) => [c.source, c.kind, c.title]), [["console", "alt", "Name Ornament"], ["console", "seo", "Name Ornament"]]);
  assert.deepEqual(log[1].before, { seoTitle: "Old title", seoDescription: "Old description" });
  assert.equal(log[0].url, "https://charleston3d.com/products/name-ornament");
  assert.deepEqual(log[0].before, { alt: "old alt" });
  const u = await MK.handleMarketing(post({ store: "c3d", action: "undo", changeId: log[1].id }), ctx);
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const write = sh.calls.filter((c) => c.op === "MarketingProductSeo").at(-1).variables.product.seo;
  assert.deepEqual(write, { title: "Old title", description: "Old description" });
  log = (await MK.handleMarketing(keyed({ store: "c3d", part: "changes" }), ctx)).body.changes;
  assert.equal(log[0].kind, "revert");
  assert.equal(log.find((c) => c.id === u.body.undone).review.verdict, "undo");
  const missing = await MK.handleMarketing(post({ store: "c3d", action: "undo", changeId: "20261025150000-00000000" }), ctx);
  assert.equal(missing.status, 404);
  const bad = await MK.handleMarketing(post({ store: "c3d", action: "undo", changeId: "../x" }), ctx);
  assert.equal(bad.status, 400);
  // A spoofed productId whose photo is a different file doesn't give the log a wrong page.
  await MK.handleMarketing(post({ store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/99", productId: "gid://shopify/Product/1", alt: "x" }), ctx);
  log = (await MK.handleMarketing(keyed({ store: "c3d", part: "changes" }), ctx)).body.changes;
  assert.equal(log[0].url, "https://charleston3d.com/");
});

test("marketing: growth puts visits, sales, search clicks and health in one daily series, with each change's effect", async () => {
  const kv = fakeKV();
  await kv.put("changes:ed", JSON.stringify([MK.changeEntry({ at: `${dayOf(10)}T11:30:00Z`, source: "auto", kind: "seo", itemKind: "product", target: "gid://shopify/Product/1", title: "Tee", url: "https://elevatedshirts.com/products/tee", before: { seoTitle: "" }, after: { seoTitle: "Tee | Elevated Designs" } })]));
  await MK.saveHistory(kv, { store: "ed", checkedAt: NOW.toISOString(), scores: { overall: 88 }, checks: [] });
  const sh = qlShopify({
    siteRows: [{ day: dayOf(0), sessions: 27, online_store_visitors: 26, sessions_with_cart_additions: 2, sessions_that_reached_checkout: 1, sessions_that_completed_checkout: 1, conversion_rate: "0.037", average_session_duration: "32.37", bounce_rate: "0.92" },
      { day: dayOf(40), sessions: 9 }],
    salesRows: [{ day: dayOf(0), orders: 1, total_sales: "31.98" }],
    pageRows: [...daily("/products/tee", 24, 11, 1), ...daily("/products/tee", 10, 0, 3)],
  });
  mkFetch.bing = (u) => (u.includes("GetRankAndTrafficStats") ? new Response(JSON.stringify({ d: [{ Clicks: 4, Impressions: 90, Date: `/Date(${Date.parse(`${dayOf(1)}T07:00:00Z`)}-0700)/` }] }), { status: 200 }) : null);
  const f = mkFetch(sh);
  const res = await MK.handleMarketing(keyed({ store: "ed", part: "growth", days: "60" }), mkCtx(f.fetch, { BING_WEBMASTER_API_KEY: "bing-key-1234" }, { kv, now: () => NOW }));
  delete mkFetch.bing;
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const g = res.body;
  assert.equal(g.series.length, 60);
  const today = g.series.at(-1);
  assert.deepEqual([today.date, today.sessions, today.visitors, today.cartAdds, today.checkouts, today.orders, today.revenue, today.duration, today.bounce, today.health],
    [dayOf(0), 27, 26, 2, 1, 1, 31.98, 32, 92, 88]);
  assert.equal(g.series.at(-2).bingClicks, 4);
  assert.equal(g.series.at(-2).googleClicks, null, "not connected is null, not zero");
  assert.equal(g.totals.sessions.last30, 27);
  assert.equal(g.totals.sessions.prev30, 9);
  assert.equal(g.totals.sessions.change, 200);
  assert.equal(g.changes[0].effect.beforePerDay, 1);
  assert.equal(g.changes[0].effect.afterPerDay, 3);
  assert.equal(g.sources.google.connected, false);
  assert.equal(g.sources.bing.connected, true);
  assert.equal(g.sources.ga4.connected, false);
  assert.ok(!JSON.stringify(g).includes("bing-key-1234"));
  const denied = qlShopify({ extra: { MarketingTraffic: () => new Response(JSON.stringify({ errors: [{ message: "denied", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 }) } });
  const d = await MK.handleMarketing(keyed({ store: "ed", part: "growth" }), mkCtx(mkFetch(denied).fetch, {}, { kv, now: () => NOW }));
  assert.equal(d.status, 200);
  assert.match(d.body.sources.shop.note, /read_reports/);
  assert.equal(d.body.changes[0].effect, null);
});

test("marketing: GA4 and Google daily figures come through the service account, per store", async () => {
  MK.clearGoogleToken();
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const sa = JSON.stringify({ client_email: "console@proj.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` });
  const seen = [];
  mkFetch.google = async (u, init) => {
    if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    seen.push(u);
    if (u.startsWith("https://analyticsdata.googleapis.com/")) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.metrics.map((m) => m.name), MK.GA4_METRICS);
      return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: dayOf(1).replace(/-/g, "") }], metricValues: ["12", "95.5", "0.613", "3", "1", "31.98"].map((value) => ({ value })) }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ rows: [{ keys: [dayOf(2)], clicks: 3, impressions: 70, position: 11.2 }] }), { status: 200 });
  };
  const origGoogle = mkFetch.google;
  const routed = async (u, init) => (u.startsWith("https://analyticsdata.googleapis.com/") ? origGoogle(u, init) : null);
  const sh = qlShopify();
  const base = mkFetch(sh).fetch;
  const f = async (url, init) => (await routed(String(url), init)) ?? base(url, init);
  const res = await MK.handleMarketing(keyed({ store: "c3d", part: "growth", days: "30" }), mkCtx(f, { GSC_SERVICE_ACCOUNT: sa, C3D_GA4_PROPERTY: "123456789" }, { kv: fakeKV(), now: () => NOW }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const y = res.body.series.find((d) => d.date === dayOf(1));
  assert.equal(y.ga4Engagement, 61.3);
  assert.equal(y.ga4EngagedTime, 96);
  assert.equal(res.body.series.find((d) => d.date === dayOf(2)).googleClicks, 3);
  assert.ok(seen.some((u) => u.includes("properties/123456789:runReport")));
  const bad = await MK.handleMarketing(keyed({ store: "ed", part: "growth" }), mkCtx(f, { GSC_SERVICE_ACCOUNT: sa, ED_GA4_PROPERTY: "G-ABC" }, { kv: fakeKV(), now: () => NOW }));
  assert.match(bad.body.sources.ga4.error, /Property details, not the G- code/);
  MK.clearGoogleToken();
});

test("marketing: keywords: defaults per brand, save, and positions from Google and Bing", async () => {
  const kv = fakeKV();
  const ctx = mkCtx(qlShopify().fetch, {}, { kv, now: () => NOW });
  const first = await MK.handleMarketing(keyed({ store: "ed", part: "keywords" }), ctx);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.keywords.map((k) => k.keyword), MK.DEFAULT_KEYWORDS.ed);
  assert.ok(MK.DEFAULT_KEYWORDS.c3d.every((k) => !MK.DEFAULT_KEYWORDS.ed.includes(k)), "each brand has its own");
  assert.equal(first.body.sources.google.connected, false);
  const saved = await MK.handleMarketing(post({ store: "ed", action: "keywords", keywords: ["Charleston  Tees", "charleston tees", "palmetto shirt"] }), ctx);
  assert.deepEqual(saved.body.keywords, ["charleston tees", "palmetto shirt"]);
  for (const bad of [["<script>"], ["a"], "x", Array(31).fill("abc"), [5]]) {
    const r = await MK.handleMarketing(post({ store: "ed", action: "keywords", keywords: bad }), ctx);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const c3d = await MK.handleMarketing(keyed({ store: "c3d", part: "keywords" }), ctx);
  assert.deepEqual(c3d.body.keywords.map((k) => k.keyword), MK.DEFAULT_KEYWORDS.c3d, "saving ED's list doesn't touch Charleston3D's");
  const st = MK.keywordStats("charleston tees", [
    { query: "best charleston tees", page: "https://elevatedshirts.com/collections/tees", clicks: 2, impressions: 40, position: 8 },
    { query: "tees charleston sc", page: "https://elevatedshirts.com/", clicks: 0, impressions: 10, position: 18 },
    { query: "charleston hats", page: "https://elevatedshirts.com/", clicks: 9, impressions: 90, position: 2 },
  ]);
  assert.deepEqual(st, { clicks: 2, impressions: 50, position: 10, page: "https://elevatedshirts.com/collections/tees", searches: 2 });
  const nokv = await MK.handleMarketing(post({ store: "ed", action: "keywords", keywords: ["charleston tees"] }), mkCtx(qlShopify().fetch));
  assert.equal(nokv.status, 503);
});

test("marketing: suggestions stay short for long names, and ED uses its own brand", () => {
  const s = MK.suggestSeo("ed", { title: "Lowcountry Sunset Palmetto Moon Heavyweight Garment Dyed Tee With Extra Words", description: "" });
  assert.ok(s.title.length <= 60, s.title);
  assert.match(s.title, /\| Elevated Designs$/);
  assert.ok(!/Charleston3D/.test(s.title + s.description));
  assert.ok(s.description.length <= 155);
});

test("marketing: saving SEO updates the product or collection and pings that store's IndexNow key", async () => {
  const sh = fakeShopify({ override: {
    MarketingProductSeo: (v, data) => data({ productUpdate: { product: { id: v.product.id, handle: "name-ornament", seo: v.product.seo }, userErrors: [] } }),
    MarketingCollectionSeo: (v, data) => data({ collectionUpdate: { collection: { id: v.input.id, handle: "ornaments", seo: v.input.seo }, userErrors: [] } }),
  } });
  const body = { store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: "  Name Ornament,   Charleston SC | Charleston3D ", seoDescription: "A personalized ornament." };
  const res = await MK.handleMarketing(post(body), mkCtx(sh.fetch));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.seoTitle, "Name Ornament, Charleston SC | Charleston3D", "spaces are tidied");
  const ping = sh.calls.find((c) => c.indexnow).indexnow;
  assert.equal(ping.key, MKENV.C3D_INDEXNOW_KEY);
  assert.equal(ping.keyLocation, `https://charleston3d.com/${MKENV.C3D_INDEXNOW_KEY}.txt`);
  assert.deepEqual(ping.urlList, ["https://charleston3d.com/products/name-ornament"]);
  const col = await MK.handleMarketing(post({ ...body, store: "ed", id: "gid://shopify/Collection/5" }), mkCtx(sh.fetch));
  assert.equal(col.status, 200);
  assert.equal(col.body.url, "https://elevatedshirts.com/collections/ornaments");
  assert.equal(sh.calls.filter((c) => c.indexnow).at(-1).indexnow.key, MKENV.ED_INDEXNOW_KEY, "ED pings with its own key");
  assert.equal(sh.calls.find((c) => c.op === "MarketingCollectionSeo").domain, "elevated-designs.myshopify.com");
});

test("marketing: bad SEO, alt and IndexNow input is refused before any Shopify call", async () => {
  const sh = fakeShopify();
  const bad = [
    { store: "c3d", action: "seo", id: "gid://shopify/Order/1", seoTitle: "a", seoDescription: "b" },
    { store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: "x".repeat(71), seoDescription: "b" },
    { store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: "<script>", seoDescription: "b" },
    { store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: 5, seoDescription: "b" },
    { store: "c3d", action: "seo", id: "gid://shopify/Product/1", seoTitle: "a", seoDescription: "b", extra: 1 },
    { store: "c3d", action: "alt", mediaId: "gid://shopify/Product/1", alt: "x" },
    { store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/1", alt: "x".repeat(251) },
    { store: "c3d", action: "indexnow", urls: [] },
    { store: "c3d", action: "indexnow", urls: ["https://elevatedshirts.com/products/a"] },
    { store: "c3d", action: "indexnow", urls: ["http://charleston3d.com/products/a"] },
    { store: "c3d", action: "delete" },
    { store: "zz", action: "seo" },
  ];
  for (const b of bad) {
    const res = await MK.handleMarketing(post(b), mkCtx(sh.fetch));
    assert.equal(res.status, 400, JSON.stringify(b));
  }
  assert.equal((await MK.handleMarketing(post(bad[0], { "content-type": "application/json" }), mkCtx(sh.fetch))).status, 401);
  assert.equal((await MK.handleMarketing({ ...keyed({}), method: "DELETE" }, mkCtx(sh.fetch))).status, 405);
  assert.equal(sh.calls.length, 0);
});

test("marketing: alt text is saved with fileUpdate", async () => {
  const sh = fakeShopify({ override: { MarketingAlt: (v, data) => data({ fileUpdate: { files: [{ id: v.files[0].id, alt: v.files[0].alt }], userErrors: [] } }) } });
  const res = await MK.handleMarketing(post({ store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/11", alt: "Red name ornament with a palmetto" }), mkCtx(sh.fetch));
  assert.equal(res.status, 200);
  assert.equal(res.body.alt, "Red name ornament with a palmetto");
  const err = fakeShopify({ override: { MarketingAlt: (v, data) => data({ fileUpdate: { files: [], userErrors: [{ field: ["files"], message: "File not found" }] } }) } });
  const r2 = await MK.handleMarketing(post({ store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/11", alt: "x" }), mkCtx(err.fetch));
  assert.equal(r2.status, 422);
  assert.match(r2.body.error, /File not found/);
  const denied = fakeShopify({ override: { MarketingAlt: () => new Response(JSON.stringify({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED", requiredAccess: "`write_files` access scope" } }] }), { status: 200 }) } });
  const r3 = await MK.handleMarketing(post({ store: "c3d", action: "alt", mediaId: "gid://shopify/MediaImage/11", alt: "x" }), mkCtx(denied.fetch));
  assert.equal(r3.status, 502);
  assert.match(r3.body.error, /write_files/);
});

const SETTINGS_FILE = `/*\n * Shopify comment\n */\n${JSON.stringify({ current: "Charleston3D", presets: { Charleston3D: { brand_name: "Charleston3D", city: "Charleston", region: "SC", areas_served: "Charleston\nMount Pleasant", ga4_id: "", color_navy: "#1f2a44" } } }, null, 2)}`;
function themeShopify(file = SETTINGS_FILE, extra = {}) {
  const writes = [];
  const sh = fakeShopify({ override: {
    MarketingTheme: (v, data) => data({ themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/77", name: "Charleston3D", files: { nodes: file == null ? [] : [{ filename: "config/settings_data.json", body: { content: file } }] } }] } }),
    MarketingThemeWrite: (v, data) => { writes.push(v); return data({ themeFilesUpsert: { upsertedThemeFiles: [{ filename: "config/settings_data.json" }], userErrors: [] } }); },
    ...extra,
  } });
  return Object.assign(sh, { writes });
}

test("marketing: theme settings are read from the live theme, preset or edited", async () => {
  const sh = themeShopify();
  const res = await MK.handleMarketing(keyed({ store: "c3d", part: "settings" }), mkCtx(sh.fetch));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.settings.city, "Charleston");
  assert.equal(res.body.settings.google_verification, "");
  assert.ok(!("color_navy" in res.body.settings), "only marketing settings are exposed");
  assert.ok(res.body.fields.ga4_id.label);
  const edited = themeShopify(JSON.stringify({ current: { city: "Mount Pleasant", bing_verification: "ABC" } }));
  assert.equal((await MK.handleMarketing(keyed({ store: "c3d", part: "settings" }), mkCtx(edited.fetch))).body.settings.city, "Mount Pleasant");
  const none = themeShopify(null);
  assert.equal((await MK.handleMarketing(keyed({ store: "c3d", part: "settings" }), mkCtx(none.fetch))).status, 502);
  const denied = fakeShopify({ override: { MarketingTheme: () => new Response(JSON.stringify({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED", requiredAccess: "`read_themes` access scope" } }] }), { status: 200 }) } });
  const d = await MK.handleMarketing(keyed({ store: "c3d", part: "settings" }), mkCtx(denied.fetch));
  assert.equal(d.status, 502);
  assert.deepEqual(d.body.details.scopes, ["read_themes", "write_themes"]);
});

test("marketing: saving settings writes only allowed keys and keeps the rest of the file", async () => {
  const sh = themeShopify();
  const values = { ga4_id: "G-ABC1234XYZ", bing_verification: "0123456789abcdef0123456789ABCDEF", areas_served: "Charleston\r\n  Summerville \n\n", same_as: "https://www.instagram.com/charleston3d" };
  const res = await MK.handleMarketing(post({ store: "c3d", action: "settings", values }), mkCtx(sh.fetch));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.changed.sort(), ["areas_served", "bing_verification", "ga4_id", "same_as"]);
  const w = sh.writes[0];
  assert.equal(w.themeId, "gid://shopify/OnlineStoreTheme/77");
  assert.equal(w.files[0].filename, "config/settings_data.json");
  const written = w.files[0].body.value;
  assert.ok(written.startsWith("/*\n * Shopify comment\n */\n"), "the comment header is kept");
  const data = JSON.parse(written.replace(/^\/\*[\s\S]*?\*\/\s*/, ""));
  assert.equal(data.current.color_navy, "#1f2a44", "the preset is copied into current so nothing else changes");
  assert.equal(data.current.areas_served, "Charleston\nSummerville");
  assert.equal(data.current.ga4_id, "G-ABC1234XYZ");
  assert.ok(data.presets.Charleston3D, "presets are kept");
});

test("marketing: settings refuse addresses, phone numbers, bad IDs, markup and unknown keys", async () => {
  const sh = themeShopify();
  const bad = [
    { city: "12 King Street" }, { areas_served: "Charleston\n843-555-0100" }, { brand_description: "Visit us at 123 Meeting St, Charleston" },
    { ga4_id: "UA-12345-1" }, { clarity_id: "Has Spaces" }, { meta_pixel_id: "abc" }, { tiktok_pixel_id: "lower-case" }, { pinterest_tag_id: "12" }, { bing_verification: "short" }, { google_verification: "<meta>" },
    { same_as: "http://insecure.example" }, { home_title: "{{ shop.name }}" }, { geo_lat: "north" }, { color_navy: "#000" },
    { ga4_id: 5 }, {}, "values",
  ];
  for (const values of bad) {
    const res = await MK.handleMarketing(post({ store: "c3d", action: "settings", values }), mkCtx(sh.fetch));
    assert.equal(res.status, 400, JSON.stringify(values));
  }
  assert.equal(sh.writes.length, 0);
  assert.equal(sh.calls.length, 0);
  // Empty turns a setting off.
  const off = await MK.handleMarketing(post({ store: "c3d", action: "settings", values: { ga4_id: "" } }), mkCtx(sh.fetch));
  assert.equal(off.status, 200);
});

test("marketing: traffic by source and UTM campaign, Bing queries, Google not set up", async () => {
  const sh = fakeShopify({ override: { MarketingTraffic: (v, data) => /utm_campaign/.test(v.q)
    ? data({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: "utm_source" }, { name: "utm_medium" }, { name: "utm_campaign" }, { name: "sessions" }, { name: "conversion_rate" }],
      rows: [{ utm_source: null, utm_medium: null, utm_campaign: null, sessions: "142", conversion_rate: "0.0" }, { utm_source: "qr", utm_medium: "print", utm_campaign: "ed-builder", sessions: "2", conversion_rate: "0.5" }] } } })
    : data({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: "referrer_source" }, { name: "referrer_name" }, { name: "sessions" }, { name: "conversion_rate" }],
      rows: [["search", "google", "3", "0.0"], ["direct", null, "142", "0.012"], [null, null, "0", "0"]] } } }) } });
  mkFetch.bing = (u) => {
    assert.match(u, /GetQueryStats\?siteUrl=https%3A%2F%2Felevatedshirts\.com%2F&apikey=bing-key-1234/);
    return new Response(JSON.stringify({ d: [
      { Query: "charleston shirts", Clicks: 2, Impressions: 40, AvgImpressionPosition: 8, Date: "/Date(1316156400000-0700)/" },
      { Query: "charleston shirts", Clicks: 1, Impressions: 10, AvgImpressionPosition: 3, Date: "/Date(1316761200000-0700)/" },
      { Query: "elevated designs", Clicks: 5, Impressions: 6, AvgImpressionPosition: 1, Date: "/Date(1316156400000-0700)/" }] }), { status: 200 });
  };
  const f = mkFetch(sh);
  const res = await MK.handleMarketing(keyed({ store: "ed", part: "traffic" }), mkCtx(f.fetch, { BING_WEBMASTER_API_KEY: "bing-key-1234" }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.shop.sources.map((s) => [s.source, s.sessions]), [["direct", 142], ["search", 3]]);
  assert.equal(res.body.shop.sources[0].conversionRate, 1.2);
  assert.deepEqual(res.body.shop.campaigns, [{ campaign: "ed-builder", source: "qr", medium: "print", sessions: 2, conversionRate: 50 }]);
  assert.equal(res.body.bing.clicks, 8);
  assert.deepEqual(res.body.bing.queries[0], { query: "charleston shirts", clicks: 3, impressions: 50, position: 7 });
  assert.deepEqual(res.body.bing.opportunities.map((q) => q.query), ["charleston shirts"]);
  assert.equal(res.body.google.connected, false);
  assert.ok(!JSON.stringify(res.body).includes("bing-key-1234"), "the Bing key never reaches the browser");
  delete mkFetch.bing;
  const nobing = await MK.handleMarketing(keyed({ store: "ed", part: "traffic" }), mkCtx(mkFetch(sh).fetch));
  assert.equal(nobing.body.bing.connected, false);
  const denied = fakeShopify({ override: { MarketingTraffic: () => new Response(JSON.stringify({ errors: [{ message: "denied", extensions: { code: "ACCESS_DENIED", requiredAccess: "`read_reports`" } }] }), { status: 200 }) } });
  const d = await MK.handleMarketing(keyed({ store: "c3d", part: "traffic" }), mkCtx(mkFetch(denied).fetch));
  assert.equal(d.status, 200);
  assert.match(d.body.shop.note, /read_reports/);
});

test("marketing: Google Search Console with a service account signs a JWT and reads queries for the store's own property", async () => {
  MK.clearGoogleToken();
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64").replace(/(.{64})/g, "$1\n");
  const sa = JSON.stringify({ client_email: "console@proj.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` });
  const seen = [];
  mkFetch.google = async (u, init) => {
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const jwt = new URLSearchParams(init.body).get("assertion");
      const [h, p, sig] = jwt.split(".");
      const dec = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, dec(sig), new TextEncoder().encode(`${h}.${p}`)), "JWT signature verifies");
      const claims = JSON.parse(dec(p).toString());
      assert.equal(claims.iss, "console@proj.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/analytics.readonly");
      seen.push("token");
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    }
    seen.push(u);
    assert.equal(init.headers.authorization, "Bearer ya29.test");
    const q = JSON.parse(init.body);
    assert.equal(q.endDate, "2026-10-23");
    return new Response(JSON.stringify({ rows: [{ keys: ["charleston ornaments"], clicks: 4, impressions: 120, ctr: 0.03, position: 9.4 }] }), { status: 200 });
  };
  const sh = fakeShopify({ override: { MarketingTraffic: (v, data) => data({ shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } } }) } });
  const ctx = mkCtx(mkFetch(sh).fetch, { GSC_SERVICE_ACCOUNT: sa }, { now: () => NOW });
  const res = await MK.handleMarketing(keyed({ store: "c3d", part: "traffic" }), ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.google.property, "sc-domain:charleston3d.com");
  assert.deepEqual(res.body.google.queries, [{ query: "charleston ornaments", clicks: 4, impressions: 120, position: 9.4 }]);
  assert.ok(seen[1].includes(encodeURIComponent("sc-domain:charleston3d.com")));
  await MK.handleMarketing(keyed({ store: "ed", part: "traffic" }), mkCtx(mkFetch(sh).fetch, { GSC_SERVICE_ACCOUNT: sa, ED_GSC_PROPERTY: "https://elevatedshirts.com/" }, { now: () => NOW }));
  assert.equal(seen.filter((x) => x === "token").length, 1, "the access token is reused");
  assert.ok(seen.at(-1).includes(encodeURIComponent("https://elevatedshirts.com/")), "ED reads its own property");
  assert.ok(!JSON.stringify(res.body).includes("PRIVATE KEY"));
  const broken = await MK.handleMarketing(keyed({ store: "c3d", part: "traffic" }), mkCtx(mkFetch(sh).fetch, { GSC_SERVICE_ACCOUNT: "{not json" }));
  assert.match(broken.body.google.error, /complete key file/);
  MK.clearGoogleToken();
});

test("marketing: IndexNow refuses to send another domain's pages when the site redirects", async () => {
  const sh = fakeShopify();
  const live = fakeSite({ site: "https://theelevateddesignsllc.com" });
  const redirecting = { fetch: async (url, init) => {
    const u = new URL(String(url));
    if (u.host === "theelevateddesignsllc.com") return live.fetch(url, init);
    if (u.host !== "elevatedshirts.com") return null;
    u.host = "theelevateddesignsllc.com";
    const r = await live.fetch(u.href, init);
    Object.defineProperty(r, "url", { value: u.href });
    return r;
  } };
  const f = mkFetch(sh, redirecting);
  const res = await MK.handleMarketing(post({ store: "ed", action: "indexnow" }), mkCtx(f.fetch));
  assert.equal(res.status, 409);
  assert.match(res.body.error, /no pages on elevatedshirts\.com.*primary domain/);
  assert.equal(sh.calls.filter((c) => c.indexnow).length, 0, "nothing sent");
});

test("marketing: send the whole sitemap to IndexNow with the store's own key", async () => {
  const sh = fakeShopify();
  const f = mkFetch(sh, fakeSite({ site: "https://elevatedshirts.com" }));
  const res = await MK.handleMarketing(post({ store: "ed", action: "indexnow" }), mkCtx(f.fetch));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ping = sh.calls.find((c) => c.indexnow).indexnow;
  assert.equal(ping.host, "elevatedshirts.com");
  assert.equal(ping.key, MKENV.ED_INDEXNOW_KEY);
  assert.equal(ping.urlList.length, 6);
  assert.ok(ping.urlList.every((u) => u.startsWith("https://elevatedshirts.com/")));
  const listed = await MK.handleMarketing(post({ store: "ed", action: "indexnow", urls: ["https://elevatedshirts.com/products/a"] }), mkCtx(f.fetch));
  assert.equal(listed.body.indexNow.count, 1);
  const nokey = await MK.handleMarketing(post({ store: "ed", action: "indexnow" }), mkCtx(f.fetch, { ED_INDEXNOW_KEY: undefined, INDEXNOW_KEY: undefined }));
  assert.equal(nokey.status, 502);
  assert.match(nokey.body.error, /ED_INDEXNOW_KEY/);
  const failing = fakeShopify({ indexNow: "500" });
  const r500 = await MK.handleMarketing(post({ store: "ed", action: "indexnow" }), mkCtx(mkFetch(failing, fakeSite({ site: "https://elevatedshirts.com" })).fetch));
  assert.equal(r500.status, 502);
});

test("IndexNow: each store pings with its own key, falling back to the shared INDEXNOW_KEY", async () => {
  const sh = fakeShopify();
  await handleProducts(post({ store: "ed", id: PID, live: true }), { env: envOf({ ED_INDEXNOW_KEY: "edkey987654321" }), fetch: sh.fetch });
  await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf({ ED_INDEXNOW_KEY: "edkey987654321" }), fetch: sh.fetch });
  const keys = sh.calls.filter((c) => c.indexnow).map((c) => [c.indexnow.host, c.indexnow.key]);
  assert.deepEqual(keys, [["elevatedshirts.com", "edkey987654321"], ["charleston3d.com", "abc123indexnow"]]);
  const sh2 = fakeShopify();
  const r = await handleProducts(post({ store: "c3d", id: PID, live: true }), { env: envOf({ INDEXNOW_KEY: "bad key!" }), fetch: sh2.fetch });
  assert.equal(r.body.indexNow.sent, false, "a malformed key is not sent");
});

test("worker: /api/marketing runs through the Worker with the MARKETING KV, and the cron checks both stores", async () => {
  const sh = fakeShopify();
  const f = mkFetch(sh, fakeSite(), fakeSite({ site: "https://elevatedshirts.com" }));
  await withFetch(async () => {
    const kv = fakeKV();
    const res = await W.handleRequest(wreq("/api/marketing?store=c3d", { headers: KEYH }), workerEnv({ ...MKENV, MARKETING: kv }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await res.json()).historyAvailable, true);
    const kv2 = fakeKV();
    const out = await W.handleScheduled(workerEnv({ ...MKENV, MARKETING: kv2 }));
    assert.equal(out.c3d, 100);
    assert.ok(out.ed > 0);
    assert.ok(kv2.m.has("history:c3d") && kv2.m.has("history:ed"));
    const idx = await import("../worker/index.mjs");
    let waited = null;
    idx.default.scheduled({}, workerEnv({ ...MKENV, MARKETING: fakeKV() }), { waitUntil: (p) => { waited = p; } });
    await waited;
    assert.ok(waited instanceof Promise);
  }, f.fetch);
});

test("wrangler.toml: MARKETING and PRICING KV bindings, the daily audit cron, the price sync cron and the Kittl sync cron", async () => {
  const fs = await import("node:fs");
  const toml = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[\[kv_namespaces\]\]\s*\nbinding = "MARKETING"/);
  assert.match(toml, /\[\[kv_namespaces\]\]\s*\nbinding = "PRICING"/);
  assert.match(toml, /\[triggers\]\s*\ncrons = \["0 11 \* \* \*", "30 11 \* \* \*", "\*\/15 \* \* \* \*", "45 \* \* \* \*"\]/);
  const W2 = await import("../worker/app.mjs");
  assert.equal(W2.AUDIT_CRON, "0 11 * * *");
  assert.equal(W2.AUTOFIX_CRON, "30 11 * * *");
  assert.equal(W2.KITTL_CRON, "45 * * * *");
});

// ---------- promotions ----------
const PR = await import("../lib/promotions.mjs");
const PROMO_OVERRIDE = (opts = {}) => {
  const ue = (extra = {}) => ({ userErrors: opts.reject ? [{ field: ["code"], message: "Code must be unique." }] : [], ...extra });
  const deny = () => new Response(JSON.stringify({ errors: [{ message: "Access denied for giftCards field. Required access: `read_gift_cards` access scope.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 });
  return {
    PromoDiscounts: (v, data) => data({ discountNodes: { nodes: [
      { id: "gid://shopify/DiscountCodeNode/11", discount: { __typename: "DiscountCodeBasic", title: "Market 15", status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: null, asyncUsageCount: 4, summary: "15% off entire order", codes: { nodes: [{ code: "MARKET15" }] } } },
      { id: "gid://shopify/DiscountAutomaticNode/12", discount: { __typename: "DiscountAutomaticFreeShipping", title: "Free shipping over $50", status: "EXPIRED", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-30T00:00:00Z", asyncUsageCount: 9, summary: "Free shipping on orders over $50" } }] } }),
    PromoGiftCards: (v, data) => (opts.denyGift ? deny() : data({ giftCards: { nodes: [{ id: "gid://shopify/GiftCard/5", lastCharacters: "AB12", enabled: true, expiresOn: null, createdAt: "2026-10-02T00:00:00Z", note: "raffle", balance: { amount: "20.0", currencyCode: "USD" }, initialValue: { amount: "25.0" }, customer: null }] } })),
    PromoSegments: (v, data) => data({ segments: { nodes: [{ id: "gid://shopify/Segment/7", name: "Email subscribers", query: "email_subscription_status = 'SUBSCRIBED'", creationDate: "2026-10-12T02:07:42Z", lastEditDate: "2026-10-12T02:07:42Z" }] } }),
    PromoCampaigns: (v, data) => data({ marketingActivities: { nodes: [{ id: "gid://shopify/MarketingActivity/3", title: "Fall sale email", status: "ACTIVE", createdAt: "2026-10-10T00:00:00Z", marketingChannelType: "EMAIL", tactic: "NEWSLETTER", sourceAndMedium: "Shopify Email", isExternal: false, utmParameters: { campaign: "fall", source: "shopify", medium: "email" }, app: { title: "Shopify Email" }, adSpend: null }] } }),
    PromoChannels: (v, data) => data({ publications: { nodes: [{ id: "gid://shopify/Publication/1", catalog: { title: "Channel Catalog 1 for Online Store" } }, { id: "gid://shopify/Publication/2", catalog: { title: "Channel Catalog 2 for Google & YouTube" } }] } }),
    PromoAbandoned: (v, data) => data({ abandonedCheckouts: { nodes: [{ id: "gid://shopify/AbandonedCheckout/9", createdAt: "2026-10-21T09:55:34Z", abandonedCheckoutUrl: "https://elevatedshirts.com/checkouts/x/recover", totalPriceSet: { shopMoney: { amount: "27.99", currencyCode: "USD" } }, customer: null, lineItems: { nodes: [{ title: "Crest Tee", quantity: 1 }] } }] } }),
    PromoDiscountCodeBasicCreate: (v, data) => data({ discountCodeBasicCreate: ue({ codeDiscountNode: opts.reject ? null : { id: "gid://shopify/DiscountCodeNode/21" } }) }),
    PromoDiscountCodeFreeShippingCreate: (v, data) => data({ discountCodeFreeShippingCreate: ue({ codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/22" } }) }),
    PromoDiscountAutomaticBasicCreate: (v, data) => data({ discountAutomaticBasicCreate: ue({ automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/23" } }) }),
    PromoDiscountAutomaticFreeShippingCreate: (v, data) => data({ discountAutomaticFreeShippingCreate: ue({ automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/24" } }) }),
    PromoCodeOn: (v, data) => data({ discountCodeActivate: ue({ codeDiscountNode: { id: v.id } }) }),
    PromoCodeOff: (v, data) => data({ discountCodeDeactivate: ue({ codeDiscountNode: { id: v.id } }) }),
    PromoAutoOn: (v, data) => data({ discountAutomaticActivate: ue({ automaticDiscountNode: { id: v.id } }) }),
    PromoAutoOff: (v, data) => data({ discountAutomaticDeactivate: ue({ automaticDiscountNode: { id: v.id } }) }),
    PromoCodeDelete: (v, data) => data({ discountCodeDelete: ue({ deletedCodeDiscountId: v.id }) }),
    PromoAutoDelete: (v, data) => data({ discountAutomaticDelete: ue({ deletedAutomaticDiscountId: v.id }) }),
    PromoGiftCard: (v, data) => (opts.denyGift ? deny() : data({ giftCardCreate: ue({ giftCard: { id: "gid://shopify/GiftCard/6", lastCharacters: "ZZ99" }, giftCardCode: "abcd efgh ijkl zz99" }) })),
    PromoGiftCardOff: (v, data) => data({ giftCardDeactivate: ue({ giftCard: { id: v.id, enabled: false } }) }),
    PromoSegment: (v, data) => data({ segmentCreate: ue({ segment: { id: "gid://shopify/Segment/8", name: v.name } }) }),
  };
};
const promoShopify = (opts = {}) => fakeShopify({ override: PROMO_OVERRIDE(opts) });
const prCtx = (sh, extra = {}) => ({ env: envOf(), fetch: sh.fetch, now: () => NOW, ...extra });

test("promotions: one read shows every section, with admin links, for the store asked", async () => {
  const sh = promoShopify();
  const res = await PR.handlePromotions(keyed({ store: "ed" }), prCtx(sh));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  noLeak(res);
  const b = res.body;
  assert.equal(b.admin, "https://admin.shopify.com/store/elevated-designs");
  assert.deepEqual(b.discounts.items.map((d) => [d.code, d.automatic, d.kind, d.status, d.used]), [["MARKET15", false, "amount", "active", 4], [null, true, "shipping", "expired", 9]]);
  assert.equal(b.discounts.items[0].admin, "https://admin.shopify.com/store/elevated-designs/discounts/11");
  assert.deepEqual(b.giftCards.items[0].balance, { amount: 20, currency: "USD" });
  assert.equal(b.segments.items[0].admin, "https://admin.shopify.com/store/elevated-designs/customers/segments/7");
  assert.equal(b.campaigns.items[0].utm.campaign, "fall");
  assert.deepEqual(b.channels.items.installed, ["Online Store", "Google & YouTube"]);
  assert.deepEqual(b.channels.items.ads.filter((c) => c.installed).map((c) => c.name), ["Google & YouTube"]);
  assert.equal(b.abandoned.items[0].total.amount, 27.99);
  assert.ok(b.adminOnly.some((x) => x.name === "Shopify Email" && x.url.endsWith("/apps/shopify-email")));
  assert.ok(b.templates.length >= 4);
  assert.ok(sh.calls.every((c) => !c.domain || c.domain === "elevated-designs.myshopify.com"), "only the Elevated Designs store is read");
});

test("promotions: a missing scope empties only its own section and names the scope", async () => {
  const res = await PR.handlePromotions(keyed({ store: "c3d" }), prCtx(promoShopify({ denyGift: true })));
  assert.equal(res.status, 200);
  assert.equal(res.body.giftCards.code, "access_denied");
  assert.deepEqual(res.body.giftCards.scopes, ["read_gift_cards", "write_gift_cards"]);
  assert.equal(res.body.discounts.items.length, 2);
  const make = await PR.handlePromotions(post({ store: "c3d", action: "giftcard", amount: 25 }), prCtx(promoShopify({ denyGift: true })));
  assert.equal(make.status, 502);
  assert.deepEqual(make.body.details.scopes, ["read_gift_cards", "write_gift_cards"]);
});

test("promotions: reading and changing need the console key", async () => {
  const sh = promoShopify();
  assert.equal((await PR.handlePromotions(get({ store: "ed" }), prCtx(sh))).status, 401);
  assert.equal((await PR.handlePromotions(post({ store: "ed", action: "segment", name: "x", query: "number_of_orders >= 1" }, { "content-type": "application/json" }), prCtx(sh))).status, 401);
  assert.equal(sh.calls.filter((c) => c.op).length, 0);
});

test("promotions: discounts of every kind become the right Shopify input, and are logged", async () => {
  const sh = promoShopify();
  const kv = fakeKV();
  const ctx = prCtx(sh, { kv });
  const code = await PR.handlePromotions(post({ store: "ed", action: "discount", method: "code", type: "percentage", title: "Market 15", code: "market15", value: 15, minSubtotal: 30, usageLimit: 100, oncePerCustomer: true, endsAt: "2026-12-31T23:59:00-05:00", segmentId: "gid://shopify/Segment/7" }), ctx);
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.equal(code.body.admin, "https://admin.shopify.com/store/elevated-designs/discounts/21");
  const d = sh.calls.find((c) => c.op === "PromoDiscountCodeBasicCreate").variables.d;
  assert.equal(d.code, "MARKET15");
  assert.deepEqual(d.customerGets, { items: { all: true }, value: { percentage: 0.15 } });
  assert.deepEqual(d.minimumRequirement, { subtotal: { greaterThanOrEqualToSubtotal: "30.00" } });
  assert.deepEqual(d.context, { customerSegments: { add: ["gid://shopify/Segment/7"] } });
  assert.equal(d.startsAt, NOW.toISOString());
  assert.equal(d.endsAt, "2027-01-01T04:59:00.000Z");
  assert.equal(d.usageLimit, 100);
  assert.equal(d.appliesOncePerCustomer, true);
  assert.deepEqual(d.combinesWith, { shippingDiscounts: true });

  await PR.handlePromotions(post({ store: "ed", action: "discount", method: "code", type: "shipping", title: "Ship free", code: "SHIPFREE" }), ctx);
  const ship = sh.calls.find((c) => c.op === "PromoDiscountCodeFreeShippingCreate").variables.d;
  assert.deepEqual(ship.destination, { all: true });
  assert.equal(ship.customerGets, undefined);
  assert.deepEqual(ship.context, { all: "ALL" });

  await PR.handlePromotions(post({ store: "ed", action: "discount", method: "automatic", type: "amount", title: "$5 off $40", value: 5, minSubtotal: 40 }), ctx);
  const auto = sh.calls.find((c) => c.op === "PromoDiscountAutomaticBasicCreate").variables.d;
  assert.deepEqual(auto.customerGets.value, { discountAmount: { amount: "5.00", appliesOnEachItem: false } });
  assert.equal(auto.code, undefined);
  assert.equal(auto.usageLimit, undefined);

  await PR.handlePromotions(post({ store: "ed", action: "discount", method: "automatic", type: "shipping", title: "Free ship over $50", minSubtotal: 50 }), ctx);
  assert.ok(sh.calls.some((c) => c.op === "PromoDiscountAutomaticFreeShippingCreate"));

  const log = await MK.readChanges(kv, "ed");
  assert.equal(log.length, 4);
  assert.ok(log.every((x) => x.kind === "promotion" && x.source === "console" && x.url === "https://elevatedshirts.com"));
  assert.equal(log[3].after.discount, "15% off orders over $30.00 with code MARKET15");
  assert.equal((await MK.readChanges(kv, "c3d")).length, 0, "the brands keep separate logs");
});

test("promotions: turning discounts on and off and deleting picks code or automatic mutations", async () => {
  const sh = promoShopify();
  const ctx = prCtx(sh, { kv: fakeKV() });
  for (const [id, active] of [["gid://shopify/DiscountCodeNode/11", true], ["gid://shopify/DiscountCodeNode/11", false], ["gid://shopify/DiscountAutomaticNode/12", true], ["gid://shopify/DiscountAutomaticNode/12", false]]) {
    const r = await PR.handlePromotions(post({ store: "c3d", action: "discountStatus", id, active }), ctx);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.deepEqual(sh.calls.filter((c) => c.op).map((c) => c.op), ["PromoCodeOn", "PromoCodeOff", "PromoAutoOn", "PromoAutoOff"]);
  await PR.handlePromotions(post({ store: "c3d", action: "discountDelete", id: "gid://shopify/DiscountCodeNode/11" }), ctx);
  await PR.handlePromotions(post({ store: "c3d", action: "discountDelete", id: "gid://shopify/DiscountAutomaticNode/12" }), ctx);
  assert.deepEqual(sh.calls.filter((c) => c.op).slice(-2).map((c) => c.op), ["PromoCodeDelete", "PromoAutoDelete"]);
});

test("promotions: gift cards and customer groups", async () => {
  const sh = promoShopify();
  const kv = fakeKV();
  const ctx = prCtx(sh, { kv });
  const g = await PR.handlePromotions(post({ store: "c3d", action: "giftcard", amount: 25, note: "Market raffle", expiresOn: "2027-12-31" }), ctx);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.code, "abcd efgh ijkl zz99");
  assert.deepEqual(sh.calls.find((c) => c.op === "PromoGiftCard").variables.d, { initialValue: "25.00", note: "Market raffle", expiresOn: "2027-12-31" });
  const logged = JSON.stringify(await MK.readChanges(kv, "c3d"));
  assert.ok(!logged.includes("abcd efgh"), "the gift card code is never kept in the log");
  assert.equal((await PR.handlePromotions(post({ store: "c3d", action: "giftcardDisable", id: "gid://shopify/GiftCard/5" }), ctx)).status, 200);
  const s = await PR.handlePromotions(post({ store: "c3d", action: "segment", name: "Loyal: 3+ orders", query: "number_of_orders >= 3" }), ctx);
  assert.equal(s.status, 200);
  assert.equal(s.body.admin, "https://admin.shopify.com/store/charleston3d/customers/segments/8");
});

test("promotions: Shopify's refusal comes back as a readable 422", async () => {
  const r = await PR.handlePromotions(post({ store: "ed", action: "discount", method: "code", type: "percentage", title: "Dup", code: "MARKET15", value: 10 }), prCtx(promoShopify({ reject: true })));
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Code must be unique/);
});

const BAD_PROMOS = [
  ["unknown action", { action: "email" }],
  ["bad method", { action: "discount", method: "bogo", type: "percentage", title: "x", code: "ABC", value: 10 }],
  ["percent over 100", { action: "discount", method: "code", type: "percentage", title: "x", code: "ABC", value: 150 }],
  ["no value", { action: "discount", method: "code", type: "amount", title: "x", code: "ABC" }],
  ["value on free shipping", { action: "discount", method: "code", type: "shipping", title: "x", code: "ABC", value: 5 }],
  ["code with spaces", { action: "discount", method: "code", type: "percentage", title: "x", code: "TEN OFF", value: 10 }],
  ["code on automatic", { action: "discount", method: "automatic", type: "percentage", title: "x", code: "ABC", value: 10 }],
  ["no title", { action: "discount", method: "code", type: "percentage", code: "ABC", value: 10 }],
  ["end before start", { action: "discount", method: "code", type: "percentage", title: "x", code: "ABC", value: 10, startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }],
  ["date without zone", { action: "discount", method: "code", type: "percentage", title: "x", code: "ABC", value: 10, endsAt: "2026-12-01T00:00" }],
  ["bad segment id", { action: "discount", method: "code", type: "percentage", title: "x", code: "ABC", value: 10, segmentId: "7" }],
  ["extra field", { action: "discount", method: "code", type: "percentage", title: "x", code: "ABC", value: 10, appliesTo: "all" }],
  ["product id as discount id", { action: "discountStatus", id: PID, active: true }],
  ["active not boolean", { action: "discountStatus", id: "gid://shopify/DiscountCodeNode/1", active: "yes" }],
  ["gift card too big", { action: "giftcard", amount: 50000 }],
  ["gift card expired", { action: "giftcard", amount: 10, expiresOn: "2026-10-01" }],
  ["segment without rule", { action: "segment", name: "x" }],
];
test("promotions: bad input is refused before Shopify is called", async () => {
  const sh = promoShopify();
  for (const [why, body] of BAD_PROMOS) {
    const r = await PR.handlePromotions(post({ store: "ed", ...body }), prCtx(sh));
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(sh.calls.filter((c) => c.op).length, 0);
});

test("promotions: the worker routes /api/promotions with the marketing log", async () => {
  const kv = fakeKV();
  const sh = promoShopify();
  const res = await withFetch(() => W.handleRequest(wreq("/api/promotions?store=ed", { headers: { "x-console-key": ENV.CONSOLE_KEY } }), workerEnv({ MARKETING: kv })), sh.fetch);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await res.json()).discounts.items.length, 2);
});

test("marketing: Search Console pages, devices, sitemaps, indexing, sitemap submit and page check", async () => {
  MK.clearGoogleToken();
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const sa = JSON.stringify({ client_email: "console@proj.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` });
  const seen = [];
  let scope = null;
  mkFetch.google = async (u, init) => {
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const jwt = new URLSearchParams(init.body).get("assertion");
      scope = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).scope;
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    }
    seen.push(`${init.method} ${u}`);
    if (u.includes("urlInspection")) {
      const b = JSON.parse(init.body);
      assert.equal(b.siteUrl, "sc-domain:charleston3d.com");
      return new Response(JSON.stringify({ inspectionResult: { inspectionResultLink: "https://search.google.com/x", indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-20T00:00:00Z", googleCanonical: `${b.inspectionUrl}`, userCanonical: `${b.inspectionUrl}` } } }), { status: 200 });
    }
    if (u.endsWith("/sitemaps") && init.method === "GET") return new Response(JSON.stringify({ sitemap: [{ path: "https://charleston3d.com/sitemap.xml", lastDownloaded: "2026-10-22T00:00:00Z", errors: "0", warnings: "1", contents: [{ type: "web", submitted: "42" }] }] }), { status: 200 });
    if (init.method === "PUT") return new Response("", { status: 200 });
    const dims = JSON.parse(init.body).dimensions;
    if (dims[0] === "page") return new Response(JSON.stringify({ rows: [{ keys: ["https://charleston3d.com/products/ornament"], clicks: 4, impressions: 120, ctr: 0.0333, position: 8.42 }] }), { status: 200 });
    return new Response(JSON.stringify({ rows: [{ keys: ["MOBILE"], clicks: 3, impressions: 90, ctr: 0.0333, position: 9 }, { keys: ["DESKTOP"], clicks: 1, impressions: 30, ctr: 0.0333, position: 7 }] }), { status: 200 });
  };
  const f = mkFetch(qlShopify()).fetch;
  const ctx = mkCtx(f, { GSC_SERVICE_ACCOUNT: sa }, { now: () => NOW });
  const res = await MK.handleMarketing(mkGet({ store: "c3d", part: "google" }), ctx);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(scope.split(" ")[0], "https://www.googleapis.com/auth/webmasters", "full Search Console scope, so sitemaps can be submitted");
  assert.deepEqual(res.body.pages[0], { page: "https://charleston3d.com/products/ornament", clicks: 4, impressions: 120, ctr: 3.3, position: 8.4 });
  assert.deepEqual(res.body.devices.map((d) => d.device), ["mobile", "desktop"]);
  assert.deepEqual(res.body.sitemaps[0], { path: "https://charleston3d.com/sitemap.xml", submitted: null, downloaded: "2026-10-22T00:00:00Z", pending: false, errors: 0, warnings: 1, urls: 42 });
  assert.equal(res.body.home.verdict, "pass");
  const sub = await MK.handleMarketing(post({ store: "c3d", action: "sitemap" }), ctx);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.ok(seen.includes(`PUT https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Acharleston3d.com/sitemaps/${encodeURIComponent("https://charleston3d.com/sitemap.xml")}`));
  const ins = await MK.handleMarketing(post({ store: "c3d", action: "inspect", url: "https://charleston3d.com/products/ornament" }), ctx);
  assert.equal(ins.status, 200);
  assert.equal(ins.body.coverage, "Submitted and indexed");
  const other = await MK.handleMarketing(post({ store: "c3d", action: "inspect", url: "https://elevatedshirts.com/" }), ctx);
  assert.equal(other.status, 400, "a page on the other brand's site is refused");
  const none = await MK.handleMarketing(mkGet({ store: "ed", part: "google" }), mkCtx(f, {}, { now: () => NOW }));
  assert.equal(none.body.connected, false);
  assert.match(none.body.note, /Connect Google Search Console/);
  MK.clearGoogleToken();
});

test("marketing: Holo blog posts come from the store's public blog feed and are logged once", async () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><published>2026-10-20T10:00:00-04:00</published><link rel="alternate" type="text/html" href="https://charleston3d.com/blogs/news/rainbow-row-ornaments"/><title>Rainbow Row ornaments &amp; gifts</title><author><name>Holo</name></author></entry>
<entry><link rel="alternate" href="https://elevatedshirts.com/blogs/news/other-brand"/><title>Other brand</title></entry></feed>`;
  const seen = [];
  const site = { fetch: async (u) => { seen.push(String(u)); return String(u).endsWith(".atom") ? new Response(feed, { status: 200 }) : null; } };
  const f = mkFetch(qlShopify(), site).fetch;
  const kv = fakeKV();
  const ctx = mkCtx(f, {}, { kv, now: () => NOW });
  const res = await MK.handleMarketing(mkGet({ store: "c3d", part: "holo" }), ctx);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(seen.includes("https://charleston3d.com/blogs/news.atom"));
  assert.deepEqual(res.body.posts.map((p) => p.title), ["Rainbow Row ornaments & gifts"], "a post on the other brand's site is ignored");
  assert.equal(res.body.logged, 1);
  const log = await MK.readChanges(kv, "c3d");
  assert.equal(log[0].kind, "article");
  assert.equal(log[0].at, "2026-10-20T14:00:00.000Z");
  const again = await MK.handleMarketing(mkGet({ store: "c3d", part: "holo" }), ctx);
  assert.equal(again.body.logged, 0, "a post is logged only once");
  const custom = await MK.handleMarketing(mkGet({ store: "c3d", part: "holo" }), mkCtx(f, { C3D_HOLO_BLOG: "Journal" }, { kv, now: () => NOW }));
  assert.equal(custom.body.blog, "journal");
  const missing = { fetch: async (u) => (String(u).endsWith(".atom") ? new Response("", { status: 404 }) : null) };
  const none = await MK.handleMarketing(mkGet({ store: "ed", part: "holo" }), mkCtx(mkFetch(qlShopify(), missing).fetch, {}, { kv, now: () => NOW }));
  assert.match(none.body.error, /no blog at \/blogs\/news/);
  assert.deepEqual(none.body.posts, []);
});

// ---------- last: the schema check over everything sent above ----------
test("every GraphQL string sent matches the Admin API 2025-10 schema, variables included", async () => {
  const S = await import("../lib/shopify.mjs");
  const L = await import("../lib/listings.mjs");
  const P = await import("../lib/pricing.mjs");
  const I = await import("../lib/insights.mjs");
  const M = await import("../lib/marketing.mjs");
  const R = await import("../lib/promotions.mjs");
  const ops = [...[S, L, M, P, R].flatMap((m) => Object.entries(m).filter(([k, v]) => /_(QUERY|MUTATION)$/.test(k) && typeof v === "string").map(([, v]) => v)),
    ...Object.values(R.MUTATIONS), I.ordersQuery(true), I.ordersQuery(false), I.SHOP_QUERY, I.SESSIONS_QUERY];
  const sent = new Set(checked()); // before the loop below adds the rest
  for (const q of ops) assert.deepEqual(schemaErrors(q), [], q.slice(0, 80));
  const unsent = ops.filter((q) => !sent.has(q)).map((q) => q.slice(0, 60));
  assert.deepEqual(unsent, [], "every exported operation was exercised by a test");
  assert.deepEqual(schemaProblems, []);
});

test("marketing: suggested titles keep the first part of long names, and SEO writes always send both fields", async () => {
  assert.equal(MK.suggestSeo("ed", { title: "Salt Marsh T-Shirt, Lowcountry Marsh Sunset Tee, Charleston SC Spartina Grass Shirt" }).title, "Salt Marsh T-Shirt | Elevated Designs");
  assert.equal(MK.suggestSeo("ed", { title: "Lowcountry Sunrise Shirt - Retro Palmetto Sun Tee" }).title, "Lowcountry Sunrise Shirt | Elevated Designs");
  assert.equal(MK.suggestSeo("c3d", { title: "Rainbow Row Ornament" }).title, "Rainbow Row Ornament, Charleston SC | Charleston3D");
  // Shopify clears a field left out of seo {}, so a title-only fix must still carry the description.
  const seen = [];
  const sh = catalogShopify({ override: { ...fixWrites, MarketingProductSeo: (v, data) => { seen.push(v.product.seo); return fixWrites.MarketingProductSeo(v, data); }, MarketingCollectionSeo: (v, data) => { seen.push(v.input.seo); return fixWrites.MarketingCollectionSeo(v, data); } } });
  const res = await MK.handleMarketing(post({ store: "c3d", action: "autofix" }), mkCtx(sh.fetch, {}, { kv: fakeKV(), now: () => NOW }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(seen.length > 0);
  for (const seo of seen) assert.deepEqual(Object.keys(seo).sort(), ["description", "title"]);
});

// ---------- Kittl library sync ----------
const KS = await import("../lib/kittl-sync.mjs");
const { handleRequest, scheduledKittlSync } = await import("../worker/app.mjs");
const WS = "cmg2xuxy59gcc0h7o81r9dnid", CLIP = "cmg2ygtn05fvy7o0hds631ob0";
const kid = (n) => `cmkittl${String(n).padStart(18, "0")}`;
const libItem = (blobs, n, meta = {}) => blobs.set(`k${n}-0000000${n % 10}`, PNG.buffer.slice(0), {
  metadata: { name: `kittl-${kid(n)}`, type: "image/png", size: PNG.byteLength, tags: `kittl:${kid(n)}`, added: n, public: true, category: "Clipped Images", source: "kittl", ...meta } });
const manifest = (ids, extra = {}) => ({ workspace: WS, folders: { [CLIP]: "Clipped Images" }, images: ids.map((n) => ({ id: kid(n), type: "image/png", folder: CLIP, ...(extra[n] ?? {}) })) });
function kittlFetch(man, { bad = new Set() } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url); calls.push(u);
    if (u !== KS.MANIFEST_URL && !/^image\//.test(init?.headers?.accept ?? "")) return new Response("bare request", { status: 403 });
    if (u === KS.MANIFEST_URL) return man ? new Response(JSON.stringify(man)) : new Response("nope", { status: 404 });
    const m = /^https:\/\/cache\.kittl\.com\/pr:sharp\/plain\/api\/users\/(\w+)\/uploads\/(\w+)\.png$/.exec(u);
    if (!m || m[1] !== WS) return new Response("not here", { status: 404 });
    return new Response(bad.has(m[2]) ? new Uint8Array([1, 2, 3]) : PNG, { headers: { "content-type": "image/png" } });
  };
  return { fetchImpl, calls };
}
const metas = (blobs) => [...blobs.m.values()].map((v) => v.metadata).filter(Boolean);

test("kittl sync: new Kittl images are copied in with the folder's category, removed ones leave", async () => {
  const blobs = fakeBlobs();
  for (const n of [1, 2, 3]) await libItem(blobs, n);
  await libItem(blobs, 4, { public: false }); // hidden in the console: stays hidden
  const { fetchImpl, calls } = kittlFetch(manifest([1, 3, 4, 5, 6], { 6: { public: false } }));
  const out = await KS.syncKittlLibrary({ blobs, fetchImpl, now: () => 1_800_000_000_000 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([out.added, out.removed, out.waiting, out.failed.length], [2, 1, 0, 0]);
  const tags = metas(blobs).map((m) => m.tags).sort();
  assert.deepEqual(tags, [1, 3, 4, 5, 6].map((n) => `kittl:${kid(n)}`));
  const five = metas(blobs).find((m) => m.tags === `kittl:${kid(5)}`);
  assert.deepEqual([five.category, five.source, five.public, five.kind, five.type], ["Clipped Images", "kittl", true, "png", "image/png"]);
  assert.equal(metas(blobs).find((m) => m.tags === `kittl:${kid(6)}`).public, false, "a brand logo comes in hidden");
  assert.equal(metas(blobs).find((m) => m.tags === `kittl:${kid(4)}`).public, false, "the console's own hide is kept");
  assert.ok(calls.filter((u) => u !== KS.MANIFEST_URL).every((u) => u.startsWith(`https://cache.kittl.com/pr:sharp/plain/api/users/${WS}/uploads/`)));
  // a second run with nothing new does nothing
  const again = await KS.syncKittlLibrary({ blobs, fetchImpl });
  assert.deepEqual([again.added, again.removed], [0, 0]);
});

test("kittl sync: console uploads and other categories are never removed", async () => {
  const blobs = fakeBlobs();
  await libItem(blobs, 1);
  await libItem(blobs, 2, { category: "Charleston3D Shirts" });
  await libItem(blobs, 3, { source: "console" });
  await blobs.set("own-00000001", PNG.buffer.slice(0), { metadata: { name: "mine.png", type: "image/png", tags: "", public: true } });
  const out = await KS.syncKittlLibrary({ blobs, fetchImpl: kittlFetch(manifest([1])).fetchImpl });
  assert.equal(out.removed, 0);
  assert.equal(blobs.m.size, 4);
});

test("kittl sync: a mass removal, an empty or broken list, and bad files change nothing", async () => {
  const blobs = fakeBlobs();
  for (let n = 1; n <= 40; n++) await libItem(blobs, n);
  const mass = await KS.syncKittlLibrary({ blobs, fetchImpl: kittlFetch(manifest([1, 2])).fetchImpl });
  assert.equal(mass.removed, 0);
  assert.match(mass.warning, /38 images left Kittl/);
  assert.equal(blobs.m.size, 40);
  for (const bad of [null, { ...manifest([]) }, { ...manifest([1]), workspace: "../evil" }, { workspace: WS, folders: {}, images: [] },
    { ...manifest([1]), images: [{ id: kid(1), type: "text/html", folder: CLIP }] }]) {
    const out = await KS.syncKittlLibrary({ blobs, fetchImpl: kittlFetch(bad).fetchImpl });
    assert.equal(out.ok, false);
  }
  assert.equal(blobs.m.size, 40);
  const odd = await KS.syncKittlLibrary({ blobs, fetchImpl: kittlFetch(manifest([...Array(40)].map((_, i) => i + 1).concat(41)), { bad: new Set([kid(41)]) }).fetchImpl });
  assert.deepEqual([odd.added, odd.failed.length, odd.waiting], [0, 1, 1]);
  assert.equal(blobs.m.size, 40, "a file that isn't a real PNG is not saved");
});

test("kittl sync: a few copies per run, the rest on the next runs", async () => {
  const blobs = fakeBlobs();
  const { fetchImpl } = kittlFetch(manifest([...Array(20)].map((_, i) => i + 1)));
  const first = await KS.syncKittlLibrary({ blobs, fetchImpl });
  assert.deepEqual([first.added, first.waiting], [KS.MAX_ADDS, 20 - KS.MAX_ADDS]);
  await KS.syncKittlLibrary({ blobs, fetchImpl });
  const third = await KS.syncKittlLibrary({ blobs, fetchImpl });
  assert.deepEqual([third.added, third.waiting], [20 - 2 * KS.MAX_ADDS, 0]);
  assert.equal(blobs.m.size, 20);
});

test("kittl sync: the hourly cron saves its result and /api/library-sync shows the counts without the key", async () => {
  const kv = fakeKV();
  const env = { IMAGES: kv };
  await libItem(kvBlobStore(kv), 1);
  const out = await scheduledKittlSync(env, kittlFetch(manifest([1, 2])).fetchImpl);
  assert.equal(out.added, 1);
  const res = await handleRequest(new Request("https://console.example/api/library-sync"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.ok, body.added, body.removed, body.inKittl, body.failed, body.problems], [true, 1, 0, 2, 0, []]);
  await scheduledKittlSync(env, kittlFetch(manifest([1, 2, 3]), { bad: new Set([kid(3)]) }).fetchImpl);
  const bad = await (await handleRequest(new Request("https://console.example/api/library-sync"), env)).json();
  assert.deepEqual([bad.failed, bad.problems], [1, [`${kid(3)}: not a valid png file`]], "the reason a copy failed is shown");
  const list = await handleImages(imgReq("/api/images?public=1"), { blobs: kvBlobStore(kv), env: envOf() });
  assert.equal((await list.json()).items.length, 2, "the sync's own record isn't listed as an image");
});

// ---------- rank tracker ----------
const TR = await import("../lib/tracker.mjs");
async function trackerSa() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  return JSON.stringify({ client_email: "console@proj.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` });
}
// Search Console answers by the dimensions and dates asked for; every call is recorded.
function trackerGoogle(seen, { site = "https://charleston3d.com" } = {}) {
  return async (u, init) => {
    if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    const b = JSON.parse(init.body);
    seen.push({ u, ...b });
    const dims = b.dimensions.join(",");
    if (dims === "query,page") return new Response(JSON.stringify({ rows: [
      { keys: ["3d printing charleston", `${site}/`], clicks: 5, impressions: 100, position: 4 },
      { keys: ["3d printing in charleston sc", `${site}/pages/custom`], clicks: 1, impressions: 100, position: 8 },
      { keys: ["custom 3d printed gifts", `${site}/collections/gifts`], clicks: 0, impressions: 40, position: 15 },
    ] }), { status: 200 });
    if (dims === "page") {
      const cur = b.startDate === dayOf(29);
      return new Response(JSON.stringify({ rows: cur
        ? [{ keys: [`${site}/products/ornament`], clicks: 12, impressions: 300, position: 6 }, { keys: [`${site}/pages/about`], clicks: 1, impressions: 50, position: 20 }, { keys: ["https://elevatedshirts.com/x"], clicks: 99, impressions: 9, position: 1 }]
        : [{ keys: [`${site}/products/ornament`], clicks: 4, impressions: 200, position: 9 }, { keys: [`${site}/pages/about`], clicks: 6, impressions: 80, position: 12 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ rows: [
      { keys: ["3d printing charleston"], clicks: 5, impressions: 100, position: 4 },
      { keys: ["rainbow row ornament"], clicks: 2, impressions: 260, position: 11.4 },
      { keys: ["holy city keychain"], clicks: 0, impressions: 30, position: 24 },
    ] }), { status: 200 });
  };
}

test("tracker: buckets, click-through visibility and the daily trend", () => {
  assert.deepEqual([null, 1, 3, 3.4, 10, 11, 20, 21].map(TR.bucketOf), ["none", "top3", "top3", "top10", "top10", "top20", "top20", "beyond"]);
  assert.deepEqual(TR.visibility(["a", "b", "c"], (k) => ({ a: 2, b: 15 })[k] ?? null), { top3: 1, top10: 0, top20: 1, beyond: 0, none: 1 });
  assert.equal(TR.ctrOf(1), 0.28); assert.equal(TR.ctrOf(1.4), 0.28); assert.equal(TR.ctrOf(12), 0.01); assert.equal(TR.ctrOf(25), 0); assert.equal(TR.ctrOf(null), 0);
  const trend = TR.averageSeries([{ date: "2026-10-01", k: { a: [1, 3, 40], b: [null, 0, 0] } }, { date: "2026-10-02", k: { a: [1, 3, 40], b: [1, 1, 9] } }]);
  assert.deepEqual(trend, [{ date: "2026-10-01", average: 1, seen: 1, visibility: 50 }, { date: "2026-10-02", average: 1, seen: 2, visibility: 100 }]);
});

test("tracker: rank table gives position now, 7 and 28 days back, best and the series", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, k: { tee: [30 - i, i, i * 10], gone: i < 5 ? [9, 0, 1] : [null, 0, 0] } }));
  const [tee, gone] = TR.rankTable(["tee", "gone", "new"], history).concat();
  assert.equal(tee.position, 1); assert.equal(tee.week, 8); assert.equal(tee.month, 29);
  assert.equal(tee.change7, 7, "moving from 8 to 1 is 7 places up"); assert.equal(tee.change28, 28);
  assert.equal(tee.best, 1); assert.equal(tee.clicks, 29); assert.equal(tee.series.length, 30);
  assert.equal(gone.position, null); assert.equal(gone.best, 9); assert.equal(gone.change7, null);
  const short = TR.rankTable(["tee"], history.slice(-3))[0];
  assert.equal(short.week, null, "no 7-day comparison until there are 8 days");
});

test("tracker: page movers, untracked searches and the suggestion and Bing link parsers", () => {
  const site = "https://charleston3d.com";
  const m = TR.pageMovers([{ keys: [`${site}/a`], clicks: 10, impressions: 100 }, { keys: [`${site}/b`], clicks: 1, impressions: 10 }, { keys: ["https://elevatedshirts.com/c"], clicks: 50, impressions: 5 }],
    [{ keys: [`${site}/a`], clicks: 2, impressions: 60 }, { keys: [`${site}/b`], clicks: 5, impressions: 30 }], site);
  assert.deepEqual(m.winners.map((x) => [x.page, x.change]), [[`${site}/a`, 8]]);
  assert.deepEqual(m.losers.map((x) => [x.page, x.change]), [[`${site}/b`, -4]]);
  const ideas = TR.searchIdeas([{ keys: ["Custom Gifts Charleston"], clicks: 1, impressions: 20, position: 5 }, { keys: ["custom gifts charleston"], clicks: 1, impressions: 20, position: 7 }, { keys: ["3d printing charleston sc"], clicks: 3, impressions: 90, position: 2 }], ["3d printing charleston"]);
  assert.deepEqual(ideas, [{ query: "custom gifts charleston", clicks: 2, impressions: 40, position: 6 }], "covered searches are left out and the same search is merged");
  assert.deepEqual(TR.parseSuggest(["tee", ["Charleston Tee", 4, "lowcountry tee "]]), ["charleston tee", "lowcountry tee"]);
  assert.deepEqual(TR.parseSuggest({ nope: 1 }), []);
  assert.deepEqual(TR.parseLinkCounts({ d: { Links: [{ Count: 2, Url: "https://charleston3d.com/a" }, { Count: 7, Url: "https://charleston3d.com/" }], TotalPages: 1 } }).pages.map((p) => p.links), [7, 2]);
  assert.deepEqual(TR.parseUrlLinks({ d: { Details: [{ Url: "https://blog.example/post", AnchorText: "3D prints" }, { Url: "" }] } }), [{ from: "https://blog.example/post", anchor: "3D prints" }]);
});

test("tracker: competitor list takes public sites only, never the store's own", () => {
  assert.deepEqual(TR.parseCompetitors(["https://www.Rival.com/shop", "rival.com", "other-prints.co.uk"], "charleston3d.com"), ["rival.com", "other-prints.co.uk"]);
  for (const bad of [["localhost"], ["10.0.0.1"], ["http://192.168.1.1/"], ["charleston3d.com"], ["www.charleston3d.com"], ["not a site"], [7]])
    assert.throws(() => TR.parseCompetitors(bad, "charleston3d.com"), (e) => e.status === 400, JSON.stringify(bad));
  assert.throws(() => TR.parseCompetitors(["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"], "x.com"), (e) => e.status === 400);
});

test("tracker: one snapshot a day per store, each store against its own Search Console property", async () => {
  MK.clearGoogleToken();
  const sa = await trackerSa();
  const seen = [];
  mkFetch.google = trackerGoogle(seen);
  const f = mkFetch(qlShopify()).fetch;
  const kv = fakeKV();
  const env = envOf({ ...MKENV, GSC_SERVICE_ACCOUNT: sa });
  const first = await TR.snapshotRanks({ env, fetchImpl: f, kv, store: "c3d", clock: () => NOW });
  assert.equal(first.taken, true);
  const e = first.history[0];
  assert.equal(e.date, "2026-10-25");
  assert.deepEqual(e.k["3d printing charleston"], [6, 6, 200], "both searches with all the words count, position weighted by times shown");
  assert.deepEqual(e.k["custom 3d printed gifts"], [15, 0, 40]);
  assert.deepEqual(e.k["charleston souvenirs"], [null, 0, 0]);
  assert.equal(seen[0].startDate, dayOf(8)); assert.equal(seen[0].endDate, dayOf(2));
  assert.ok(seen[0].u.includes(encodeURIComponent("sc-domain:charleston3d.com")));
  const again = await TR.snapshotRanks({ env, fetchImpl: f, kv, store: "c3d", clock: () => NOW });
  assert.equal(again.taken, false, "only one a day");
  assert.equal(seen.length, 1);
  const out = await TR.runScheduledSnapshots(env, f, kv, () => new Date(NOW.getTime() + 86400000));
  assert.deepEqual(out, { c3d: true, ed: true });
  assert.equal((await kv.get("ranks:c3d", { type: "json" })).length, 2);
  const ed = await kv.get("ranks:ed", { type: "json" });
  assert.equal(ed.length, 1);
  assert.deepEqual(Object.keys(ed[0].k), MK.DEFAULT_KEYWORDS.ed, "the ED history holds only ED keywords");
  assert.ok(seen.at(-1).u.includes(encodeURIComponent("sc-domain:elevatedshirts.com")), "ED asks ED's own property");
  const none = await TR.snapshotRanks({ env: envOf(MKENV), fetchImpl: f, kv: fakeKV(), store: "c3d", clock: () => NOW });
  assert.equal(none.taken, false);
  MK.clearGoogleToken();
});

test("tracker: the panel shows visibility, history, movers, ideas, Bing positions and backlinks", async () => {
  MK.clearGoogleToken();
  const sa = await trackerSa();
  const seen = [];
  mkFetch.google = trackerGoogle(seen);
  mkFetch.bing = (u) => {
    if (u.includes("GetQueryStats")) return new Response(JSON.stringify({ d: [{ Query: "3d printing charleston", Clicks: 2, Impressions: 30, AvgImpressionPosition: 3 }] }), { status: 200 });
    if (u.includes("GetLinkCounts")) return new Response(JSON.stringify({ d: { Links: [{ Count: 3, Url: "https://charleston3d.com/" }], TotalPages: 1 } }), { status: 200 });
    return null;
  };
  const kv = fakeKV();
  await kv.put("ranks:c3d", JSON.stringify([{ date: dayOf(1), k: { "3d printing charleston": [9, 1, 50], "custom 3d printed gifts": [30, 0, 5], "personalized ornaments charleston": [null, 0, 0], "3d printed name keychain": [null, 0, 0], "charleston souvenirs": [null, 0, 0] } }]));
  const ctx = mkCtx(mkFetch(qlShopify()).fetch, { GSC_SERVICE_ACCOUNT: sa, BING_WEBMASTER_API_KEY: "bing-key-1234" }, { kv, now: () => NOW });
  const res = await MK.handleMarketing(mkGet({ store: "c3d", part: "tracker" }), ctx);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const t = res.body;
  assert.equal(t.snapshot.days, 2); assert.equal(t.snapshot.taken, true);
  assert.deepEqual(t.visibility.google, { top3: 0, top10: 1, top20: 1, beyond: 0, none: 3 });
  assert.equal(t.visibility.bing.top3, 1);
  assert.equal(t.trend.length, 2);
  assert.ok(t.trend[1].visibility > t.trend[0].visibility, "moving from 9 to 6 raises visibility");
  const kw = t.keywords.find((r) => r.keyword === "3d printing charleston");
  assert.equal(kw.position, 6); assert.equal(kw.bing, 3);
  assert.deepEqual(t.pages.winners.map((x) => x.page), ["https://charleston3d.com/products/ornament"]);
  assert.deepEqual(t.pages.losers.map((x) => x.page), ["https://charleston3d.com/pages/about"]);
  assert.ok(![...t.pages.winners, ...t.pages.losers].some((x) => x.page.includes("elevatedshirts")), "never the other brand's pages");
  assert.deepEqual(t.ideas.map((x) => x.query), ["rainbow row ornament", "holy city keychain"]);
  assert.deepEqual(t.backlinks, { connected: true, pages: [{ url: "https://charleston3d.com/", links: 3 }], total: 3 });
  assert.deepEqual(t.competitors, []);
  assert.ok(!JSON.stringify(t).includes("bing-key-1234"), "the Bing key never reaches the page");
  const bare = await MK.handleMarketing(mkGet({ store: "ed", part: "tracker" }), mkCtx(mkFetch(qlShopify()).fetch, {}, { kv: fakeKV(), now: () => NOW }));
  assert.equal(bare.status, 200);
  assert.match(bare.body.sources.google.note, /Connect Google Search Console/);
  assert.match(bare.body.backlinks.note, /Connect Bing Webmaster Tools/);
  assert.equal(bare.body.pages, null);
  delete mkFetch.bing;
  MK.clearGoogleToken();
});

test("tracker: competitors, compare, suggestions, who links here and snapshot actions", async () => {
  MK.clearGoogleToken();
  const kv = fakeKV();
  const asked = [];
  const outside = { fetch: async (url) => {
    const u = String(url);
    if (u.startsWith("https://suggestqueries.google.com/")) { asked.push(u); return new Response(JSON.stringify(["x", ["3d printing charleston sc", "3d printing charleston", "3d printing near me"]]), { status: 200 }); }
    if (u.startsWith("https://api.bing.com/osjson.aspx")) { asked.push(u); return new Response(JSON.stringify(["x", ["3d printing near me"]]), { status: 200 }); }
    if (u === "https://rival.com/") return new Response("<html><head><title>Rival Prints</title></head><body><h1>Hi</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (u === "https://down.example/") throw new TypeError("fetch failed");
    return null;
  } };
  mkFetch.bing = (u) => (u.includes("GetUrlLinks") ? new Response(JSON.stringify({ d: { Details: [{ Url: "https://blog.example/post", AnchorText: "great prints" }] } }), { status: 200 }) : null);
  const ctx = mkCtx(mkFetch(qlShopify(), fakeSite(), outside).fetch, { BING_WEBMASTER_API_KEY: "bing-key-1234" }, { kv, now: () => NOW });
  const save = await MK.handleMarketing(post({ store: "c3d", action: "competitors", competitors: ["www.rival.com", "down.example"] }), ctx);
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.deepEqual(await kv.get("competitors:c3d", { type: "json" }), ["rival.com", "down.example"]);
  assert.equal(await kv.get("competitors:ed"), null, "ED's list is untouched");
  const own = await MK.handleMarketing(post({ store: "c3d", action: "competitors", competitors: ["charleston3d.com"] }), ctx);
  assert.equal(own.status, 400);
  const cmp = await MK.handleMarketing(post({ store: "c3d", action: "compare" }), ctx);
  assert.equal(cmp.status, 200, JSON.stringify(cmp.body));
  assert.equal(cmp.body.own.host, "charleston3d.com"); assert.equal(cmp.body.own.local, true);
  assert.equal(cmp.body.competitors[0].title, "Rival Prints"); assert.equal(cmp.body.competitors[0].h1, 1);
  assert.equal(cmp.body.competitors[1].error, "couldn't connect");
  const ideas = await MK.handleMarketing(post({ store: "c3d", action: "ideas", seeds: ["3D Printing Charleston"] }), ctx);
  assert.equal(ideas.status, 200, JSON.stringify(ideas.body));
  assert.deepEqual(ideas.body.ideas.map((x) => [x.phrase, x.sources]), [["3d printing near me", ["Google", "Bing"]], ["3d printing charleston sc", ["Google"]]], "tracked phrases are left out, found by both first");
  assert.equal(asked.length, 2);
  for (const bad of [{ seeds: [] }, { seeds: ["<script>"] }, { seeds: Array(11).fill("tee") }, { seeds: ["tee"], extra: 1 }])
    assert.equal((await MK.handleMarketing(post({ store: "c3d", action: "ideas", ...bad }), ctx)).status, 400, JSON.stringify(bad));
  const links = await MK.handleMarketing(post({ store: "c3d", action: "links", url: "https://charleston3d.com/" }), ctx);
  assert.equal(links.status, 200, JSON.stringify(links.body));
  assert.deepEqual(links.body.links, [{ from: "https://blog.example/post", anchor: "great prints" }]);
  const other = await MK.handleMarketing(post({ store: "c3d", action: "links", url: "https://elevatedshirts.com/" }), ctx);
  assert.equal(other.status, 400, "a page on the other brand's site is refused");
  const snap = await MK.handleMarketing(post({ store: "c3d", action: "snapshot" }), ctx);
  assert.equal(snap.status, 503, "no snapshot without Search Console");
  const nokv = await MK.handleMarketing(post({ store: "c3d", action: "competitors", competitors: ["rival.com"] }), mkCtx(mkFetch(qlShopify()).fetch, {}, { now: () => NOW }));
  assert.equal(nokv.status, 503);
  const nokey = await MK.handleMarketing(post({ store: "c3d", action: "compare" }, { "content-type": "application/json" }), ctx);
  assert.equal(nokey.status, 401, "actions need the console key");
  delete mkFetch.bing;
});

// ---------- 3D maker (lib/meshy.mjs) ----------
const { handleMeshy, cost: meshyCost } = await import("../lib/meshy.mjs");
const MESHY_KEY = "msy_TEST_SECRET_1234";
// A small stand-in for api.meshy.ai and assets.meshy.ai that records every call.
function fakeMeshy({ balance = 500, status = "SUCCEEDED", fail } = {}) {
  const calls = [], tasks = new Map();
  let n = 0;
  const stl = binStl(2), threemf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u.href, method, body, auth: init.headers?.authorization });
    const res = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (u.hostname === "assets.meshy.ai") return new Response(u.pathname.endsWith(".stl") ? stl : u.pathname.endsWith(".3mf") ? threemf : PNG);
    if (fail) return res({ message: "nope" }, fail);
    if (u.pathname === "/openapi/v1/balance") return res({ balance });
    const m = u.pathname.match(/^\/openapi\/(v1\/image-to-3d|v1\/multi-image-to-3d|v2\/text-to-3d)(?:\/(.+))?$/);
    if (!m) return res({ message: "not found" }, 404);
    if (method === "POST") { const id = `0193bfc5-0000-7000-8000-${String(++n).padStart(12, "0")}`; tasks.set(id, body); return res({ result: id }); }
    if (!tasks.has(m[2])) return res({ message: "Task not found" }, 404);
    return res({ id: m[2], status, progress: status === "SUCCEEDED" ? 100 : 40, consumed_credits: 30, expires_at: 1900000000000,
      thumbnail_url: `https://assets.meshy.ai/x/${m[2]}/preview.png?Expires=1&Signature=s`,
      model_urls: status === "SUCCEEDED" ? Object.fromEntries(["glb", "stl", "3mf", "obj"].map((f) => [f, `https://assets.meshy.ai/x/${m[2]}/model.${f}?Expires=1&Signature=s`])) : {},
      ...(status === "FAILED" ? { task_error: { message: "Image too dark" } } : {}) });
  };
  return { fetch, calls, tasks };
}
function meshyCtx(opts = {}, env = envOf({ MESHY_API_KEY: MESHY_KEY })) {
  const kv = fakeKV(), fake = fakeMeshy(opts);
  return { kv, fake, ctx: { jobs: kvBlobStore(kv, "c3d-meshy:"), files: kvBlobStore(kv, "c3d-file:"), env, fetch: fake.fetch } };
}
const mreq = (path, { method = "GET", body, headers = KEYH } = {}) =>
  new Request(`https://console.example${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const DATA_PNG = "data:image/png;base64," + Buffer.from(PNG).toString("base64");

test("meshy: needs the console key, and says how to add the Meshy key when it's missing", async () => {
  const { ctx, fake } = meshyCtx();
  assert.equal((await handleMeshy(mreq("/api/meshy", { headers: {} }), ctx)).status, 401);
  assert.equal(fake.calls.length, 0, "nothing reaches Meshy without the console key");
  const none = meshyCtx({}, envOf({ MESHY_API_KEY: undefined }));
  const st = await (await handleMeshy(mreq("/api/meshy"), none.ctx)).json();
  assert.deepEqual([st.configured, st.balance, st.jobs], [false, null, []]);
  const start = await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "a pineapple ornament" } }), none.ctx);
  assert.equal(start.status, 503);
  assert.match((await start.json()).error, /wrangler secret put MESHY_API_KEY/);
  const ok = await (await handleMeshy(mreq("/api/meshy"), ctx)).json();
  assert.deepEqual([ok.configured, ok.balance], [true, 500]);
  assert.equal(fake.calls[0].auth, `Bearer ${MESHY_KEY}`);
  assert.ok(!JSON.stringify(ok).includes(MESHY_KEY), "the Meshy key never goes to the browser");
});

test("meshy: photos and words start the right Meshy jobs, ready for printing, with the cost shown", async () => {
  const { ctx, fake, kv } = meshyCtx();
  const one = await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "photos", images: [DATA_PNG], name: "Pineapple / ornament", color: true } }), ctx);
  assert.equal(one.status, 201);
  const j1 = (await one.json()).job;
  assert.deepEqual([j1.kind, j1.name, j1.color, j1.cost, j1.status], ["photo", "Pineapple ornament", true, 30, "PENDING"]);
  let call = fake.calls.at(-1);
  assert.equal(call.url, "https://api.meshy.ai/openapi/v1/image-to-3d");
  assert.deepEqual([call.body.image_url, call.body.should_texture, call.body.target_formats], [DATA_PNG, true, ["glb", "stl", "3mf", "obj"]]);
  const many = await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "photos", images: [DATA_PNG, DATA_PNG, DATA_PNG], detail: "high" } }), ctx)).json();
  call = fake.calls.at(-1);
  assert.equal(call.url, "https://api.meshy.ai/openapi/v1/multi-image-to-3d");
  assert.deepEqual([call.body.image_urls.length, call.body.should_texture, call.body.geometry_resolution, many.job.cost], [3, false, "2k", 25]);
  const words = await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "  palmetto tree desk ornament  ", name: "Palmetto" } }), ctx)).json();
  call = fake.calls.at(-1);
  assert.equal(call.url, "https://api.meshy.ai/openapi/v2/text-to-3d");
  assert.deepEqual([call.body.mode, call.body.prompt, words.job.cost], ["preview", "palmetto tree desk ornament", 20]);
  const list = await (await handleMeshy(mreq("/api/meshy"), ctx)).json();
  assert.equal(list.jobs.length, 3);
  assert.ok([...kv.m.keys()].every((k) => k.startsWith("c3d-meshy:")));
  for (const [body, why] of [[{ mode: "photos", images: [] }, "no photo"], [{ mode: "photos", images: Array(5).fill(DATA_PNG) }, "five photos"],
    [{ mode: "photos", images: ["https://evil.example/x.png"] }, "a link, not a photo"], [{ mode: "photos", images: ["data:text/html;base64,PGh0bWw+"] }, "not an image"],
    [{ mode: "words", prompt: "x" }, "too short"], [{ mode: "words", prompt: "y".repeat(801) }, "too long"], [{ mode: "video" }, "unknown mode"]])
    assert.equal((await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body }), ctx)).status, 400, why);
  assert.equal(fake.tasks.size, 3, "refused requests spend nothing");
  assert.deepEqual([meshyCost({ mode: "words" }), meshyCost({ mode: "photos", color: false }), meshyCost({ mode: "color" })], [20, 20, 10]);
});

test("meshy: progress, downloads only from Meshy's file host, add color, save to the 3D file library", async () => {
  const { ctx, fake, kv } = meshyCtx();
  const { job } = await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "a lighthouse keychain", name: "Lighthouse" } }), ctx)).json();
  const live = (await (await handleMeshy(mreq(`/api/meshy/jobs/${job.id}`), ctx)).json()).job;
  assert.deepEqual([live.status, live.progress, live.formats, live.picture], ["SUCCEEDED", 100, ["glb", "stl", "3mf", "obj"], true]);
  assert.ok(!JSON.stringify(live).includes("Signature"), "Meshy's signed links stay on the server");
  const stl = await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/file/stl`), ctx);
  assert.equal(stl.status, 200);
  assert.equal(stl.headers.get("content-disposition"), 'attachment; filename="Lighthouse.stl"');
  assert.equal((await stl.arrayBuffer()).byteLength, 84 + 100);
  const pic = await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/file/picture`), ctx);
  assert.equal(pic.headers.get("content-type"), "image/png");
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/file/obj`), ctx)).headers.get("content-disposition"), 'attachment; filename="Lighthouse.obj"');
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/file/fbx`), ctx)).status, 404);
  const colored = await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/color`, { method: "POST" }), ctx);
  assert.equal(colored.status, 201);
  const cj = (await colored.json()).job;
  assert.deepEqual([cj.name, cj.color, cj.cost, cj.from], ["Lighthouse (color)", true, 10, job.id]);
  assert.deepEqual([fake.calls.at(-1).body.mode, fake.calls.at(-1).body.preview_task_id], ["refine", job.id]);
  const saved = await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/save`, { method: "POST", body: { format: "3mf" } }), ctx);
  assert.equal(saved.status, 201);
  const item = (await saved.json()).item;
  assert.deepEqual([item.name, item.type, item.store, item.tags], ["Lighthouse.3mf", "model/3mf", "c3d", "made with Meshy"]);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith("c3d-file:")).length, 1, "the model is in the 3D file library");
  const after = (await (await handleMeshy(mreq("/api/meshy"), ctx)).json()).jobs.find((j) => j.id === job.id);
  assert.equal(after.saved, item.key, "the job remembers it was saved");
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/save`, { method: "POST", body: { format: "glb" } }), ctx)).status, 400);
  // a file link pointing anywhere but Meshy is refused
  const evil = meshyCtx();
  const e = (await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "a boat" } }), evil.ctx)).json()).job;
  const inner = evil.ctx.fetch;
  evil.ctx.fetch = async (url, init) => { const r = await inner(url, init); if (!String(url).includes(e.id)) return r; const b = await r.json(); b.model_urls.stl = "https://evil.example/model.stl"; return new Response(JSON.stringify(b)); };
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${e.id}/file/stl`), evil.ctx)).status, 502);
  assert.ok(!evil.fake.calls.some((c) => c.url.startsWith("https://evil.example")), "nothing is fetched from it");
  // take a job off the list; unknown and malformed ids are 404
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${cj.id}`, { method: "DELETE" }), ctx)).status, 200);
  for (const bad of [`/api/meshy/jobs/${cj.id}`, "/api/meshy/jobs/../c3d-file:x", "/api/meshy/other", `/api/meshy/jobs/${job.id}/file/stl/x`])
    assert.equal((await handleMeshy(mreq(bad), ctx)).status, 404, bad);
});

test("meshy: unfinished and failed jobs, and Meshy's errors in plain words", async () => {
  const busy = meshyCtx({ status: "IN_PROGRESS" });
  const { job } = await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "a crab" } }), busy.ctx)).json();
  assert.equal((await (await handleMeshy(mreq(`/api/meshy/jobs/${job.id}`), busy.ctx)).json()).job.progress, 40);
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/save`, { method: "POST", body: {} }), busy.ctx)).status, 409);
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/color`, { method: "POST" }), busy.ctx)).status, 409);
  assert.equal((await handleMeshy(mreq(`/api/meshy/jobs/${job.id}/file/stl`), busy.ctx)).status, 404);
  const failed = meshyCtx({ status: "FAILED" });
  const f = (await (await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "photos", images: [DATA_PNG] } }), failed.ctx)).json()).job;
  assert.equal((await (await handleMeshy(mreq(`/api/meshy/jobs/${f.id}`), failed.ctx)).json()).job.error, "Image too dark");
  for (const [code, re] of [[402, /Not enough Meshy credits/], [401, /didn't accept the key/], [429, /busy/], [400, /Meshy said: nope/], [500, /Meshy had a problem/]]) {
    const { ctx } = meshyCtx({ fail: code });
    const r = await handleMeshy(mreq("/api/meshy/jobs", { method: "POST", body: { mode: "words", prompt: "a crab" } }), ctx);
    assert.match((await r.json()).error, re, String(code));
    assert.equal((await (await handleMeshy(mreq("/api/meshy"), ctx)).json()).balance, null, "the balance just shows as unknown");
  }
});

test("worker: the 3D maker is routed with its own keys in the IMAGES namespace", async () => {
  const kv = fakeKV(), env = workerEnv({ IMAGES: kv });
  assert.equal((await W.handleRequest(wreq("/api/meshy"), env)).status, 401);
  const r = await W.handleRequest(wreq("/api/meshy", { headers: KEYH }), env);
  assert.deepEqual(await r.json(), { configured: false, balance: null, jobs: [] });
  assert.equal((await W.handleRequest(wreq("/api/meshy", { headers: KEYH }), workerEnv({ IMAGES: undefined }))).status, 503);
});

// ---------- team board ----------
const { handleTeam, ownersFor, MAX_TASKS } = await import("../lib/team.mjs");
const teamReq = (method, body, headers = { "content-type": "application/json", "x-console-key": "open-sesame-test-key-0001" }) =>
  ({ method, query: new URLSearchParams(), header: (k) => headers[k.toLowerCase()] ?? null, text: async () => JSON.stringify(body) });

test("team: the board needs the key and the KV; each store has its own board and roster", async () => {
  const kv = fakeKV();
  assert.equal((await handleTeam(get({ store: "ed" }), { env: envOf(), kv })).status, 401);
  assert.equal((await handleTeam(keyed({ store: "ed" }), { env: envOf(), kv: null })).status, 503);
  assert.equal((await handleTeam(keyed({ store: "both" }), { env: envOf(), kv })).status, 400);
  const add = await handleTeam(teamReq("POST", { store: "ed", text: "  Check the   shirt app  ", owner: "ed" }), { env: envOf(), kv });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.added[0].text, "Check the shirt app");
  const ed = await handleTeam(keyed({ store: "ed" }), { env: envOf(), kv });
  assert.deepEqual(ed.body.tasks.map((t) => [t.text, t.owner, t.done]), [["Check the shirt app", "ed", false]]);
  assert.ok(ed.body.roster.some((m) => m.id === "ed") && !ed.body.roster.some((m) => m.id === "c3d"), "ED roster has no Charleston 3D agent");
  assert.ok(ed.body.consoleJobs.length >= 4);
  const c3d = await handleTeam(keyed({ store: "c3d" }), { env: envOf(), kv });
  assert.deepEqual(c3d.body.tasks, [], "the brands never share a board");
  assert.ok(!c3d.body.roster.some((m) => m.id === "ed"));
  assert.deepEqual([...kv.m.keys()].sort(), ["team:ed"]);
});

test("team: an agent of the other store can't be given a task; bad text is refused", async () => {
  const kv = fakeKV();
  assert.deepEqual(ownersFor("c3d"), ["aaron", "ops", "c3d", "marketing", "builder", "admin"]);
  for (const body of [{ store: "c3d", text: "x", owner: "ed" }, { store: "c3d", text: "   " }, { store: "c3d", text: "x".repeat(201) }, { store: "c3d", text: 5 }, { store: "c3d", tasks: [] }])
    assert.equal((await handleTeam(teamReq("POST", body), { env: envOf(), kv })).status, 400, JSON.stringify(body));
  assert.equal(kv.m.size, 0);
});

test("team: done, reassign, rename and remove; unknown id is 404", async () => {
  const kv = fakeKV();
  const { body: { added: [t] } } = await handleTeam(teamReq("POST", { store: "c3d", text: "Print the sign" }), { env: envOf(), kv });
  assert.equal(t.owner, "aaron");
  let r = await handleTeam(teamReq("PATCH", { store: "c3d", id: t.id, done: true }), { env: envOf(), kv });
  assert.equal(r.body.task.done, true); assert.ok(r.body.task.doneAt);
  r = await handleTeam(teamReq("PATCH", { store: "c3d", id: t.id, done: false, owner: "c3d", text: "Print the big sign" }), { env: envOf(), kv });
  assert.deepEqual([r.body.task.done, r.body.task.owner, r.body.task.text, "doneAt" in r.body.task], [false, "c3d", "Print the big sign", false]);
  assert.equal((await handleTeam(teamReq("PATCH", { store: "c3d", id: t.id }), { env: envOf(), kv })).status, 400);
  assert.equal((await handleTeam(teamReq("PATCH", { store: "c3d", id: t.id, done: "yes" }), { env: envOf(), kv })).status, 400);
  assert.equal((await handleTeam(teamReq("PATCH", { store: "ed", id: t.id, done: true }), { env: envOf(), kv })).status, 404, "a task belongs to one store");
  assert.equal((await handleTeam(teamReq("DELETE", { store: "c3d", id: t.id }), { env: envOf(), kv })).status, 200);
  assert.equal((await handleTeam(teamReq("DELETE", { store: "c3d", id: t.id }), { env: envOf(), kv })).status, 404);
  assert.equal((await handleTeam(teamReq("PATCH", { store: "c3d", id: "x", done: true }, { "content-type": "application/json" }), { env: envOf(), kv })).status, 401);
});

test("team: importing the old device list, and a full board drops old done tasks but never open ones", async () => {
  const kv = fakeKV();
  const imp = await handleTeam(teamReq("POST", { store: "ed", tasks: [{ text: "Order blanks" }, { text: "Old thing", done: true }] }), { env: envOf(), kv });
  assert.equal(imp.status, 201);
  assert.deepEqual(imp.body.tasks.map((t) => [t.text, t.done]), [["Order blanks", false], ["Old thing", true]]);
  const many = Array.from({ length: MAX_TASKS - 2 }, (_, i) => ({ id: `d${i}`, text: `done ${i}`, owner: "aaron", done: true, doneAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` }));
  await kv.put("team:ed", JSON.stringify({ tasks: [...imp.body.tasks, ...many] }));
  const r = await handleTeam(teamReq("POST", { store: "ed", text: "New one" }), { env: envOf(), kv });
  assert.equal(r.status, 201);
  assert.equal(r.body.tasks.length, MAX_TASKS);
  assert.ok(r.body.tasks.some((t) => t.text === "Order blanks") && r.body.tasks.some((t) => t.text === "New one"));
  const open = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `o${i}`, text: `open ${i}`, owner: "aaron", done: false }));
  await kv.put("team:ed", JSON.stringify({ tasks: open }));
  assert.equal((await handleTeam(teamReq("POST", { store: "ed", text: "One more" }), { env: envOf(), kv })).status, 409);
});

test("worker: /api/team uses the MARKETING KV", async () => {
  const W = await import("../worker/app.mjs");
  const kv = fakeKV();
  const env = { CONSOLE_KEY: "open-sesame-test-key-0001", MARKETING: kv };
  const r = await W.handleRequest(new Request("https://console.example/api/team", { method: "POST", headers: { "content-type": "application/json", "x-console-key": env.CONSOLE_KEY }, body: JSON.stringify({ store: "c3d", text: "Hi" }) }), env);
  assert.equal(r.status, 201);
  assert.ok(kv.m.has("team:c3d"));
  assert.equal((await W.handleRequest(new Request("https://console.example/api/team?store=c3d"), env)).status, 401);
});

// ---------- 3D file library in R2 (lib/r2-store.mjs) ----------
const { r2BlobStore, combinedStore } = await import("../lib/r2-store.mjs");
// A small stand-in for an R2 bucket binding: put/get/delete/list with customMetadata and paging.
function fakeR2({ pageSize = 1000 } = {}) {
  const m = new Map();
  return { m,
    async put(key, data, { customMetadata } = {}) {
      for (const v of Object.values(customMetadata ?? {})) assert.equal(typeof v, "string", "R2 custom metadata values are strings");
      const bytes = data instanceof ArrayBuffer ? data.slice(0) : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      m.set(key, { bytes, customMetadata: { ...customMetadata } });
    },
    async get(key) { const o = m.get(key); return o ? { key, customMetadata: o.customMetadata, arrayBuffer: async () => o.bytes.slice(0) } : null; },
    async delete(key) { m.delete(key); },
    async list({ prefix = "", cursor, include = [] } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const objects = names.slice(start, start + pageSize).map((key) => ({ key, ...(include.includes("customMetadata") ? { customMetadata: m.get(key).customMetadata } : {}) }));
      const truncated = start + pageSize < names.length;
      return { objects, truncated, ...(truncated ? { cursor: String(start + pageSize) } : {}) };
    },
  };
}

test("r2 store: files keep their details, list across pages, and older KV files still work", async () => {
  const r2 = fakeR2({ pageSize: 2 }), kv = fakeKV();
  const store = r2BlobStore(r2, "c3d-file/");
  for (const n of [1, 2, 3]) await store.set(`k${n}-0123abcd`, new Uint8Array([0x50, 0x4b, 3, 4, n]), { metadata: { name: `part ${n}.3mf`, size: 5, added: n } });
  const { blobs } = await store.list();
  assert.deepEqual(blobs.map((b) => [b.key, b.metadata.name, b.metadata.added]), [["k1-0123abcd", "part 1.3mf", 1], ["k2-0123abcd", "part 2.3mf", 2], ["k3-0123abcd", "part 3.3mf", 3]]);
  assert.deepEqual([...new Uint8Array((await store.getWithMetadata("k2-0123abcd")).data)], [0x50, 0x4b, 3, 4, 2]);
  assert.equal(await store.getWithMetadata("nope-0123abcd"), null);
  // a file saved to KV before the move
  const old = kvBlobStore(kv, "c3d-file:");
  await old.set("old-0123abcd", new Uint8Array([0x50, 0x4b, 3, 4]), { metadata: { name: "old.3mf" } });
  const both = combinedStore(store, old);
  assert.equal((await both.list()).blobs.length, 4);
  assert.equal((await both.getWithMetadata("old-0123abcd")).metadata.name, "old.3mf");
  await both.set("new-0123abcd", new Uint8Array([1]), { metadata: { name: "new.3mf" } });
  assert.ok(r2.m.has("c3d-file/new-0123abcd") && !kv.m.has("c3d-file:new-0123abcd"), "new files go to R2");
  await both.delete("old-0123abcd");
  assert.equal(kv.m.has("c3d-file:old-0123abcd"), false);
});

test("worker: with the FILES bucket bound, uploads go to R2 and the 3D file library lists both", async () => {
  const kv = fakeKV(), r2 = fakeR2();
  await kvBlobStore(kv, "c3d-file:").set("old-0123abcd", new Uint8Array([0x50, 0x4b, 3, 4]), { metadata: { name: "old.3mf", type: "model/3mf", size: 4, added: 1, store: "c3d" } });
  const env = workerEnv({ IMAGES: kv, FILES: r2 });
  const up = await W.handleRequest(wreq("/api/files", { method: "POST", headers: { ...KEYH, "x-filename": "vase.3mf" }, body: new Uint8Array([0x50, 0x4b, 3, 4, 9]) }), env);
  assert.equal(up.status, 201);
  const { item } = await up.json();
  assert.ok(r2.m.has(`c3d-file/${item.key}`), "the file is in R2");
  assert.ok(![...kv.m.keys()].some((k) => k.includes(item.key)), "not in KV");
  const list = await (await W.handleRequest(wreq("/api/files", { headers: KEYH }), env)).json();
  assert.deepEqual(list.items.map((i) => i.name).sort(), ["old.3mf", "vase.3mf"]);
  const dl = await W.handleRequest(wreq(`/api/files/${item.key}`, { headers: KEYH }), env);
  assert.equal(dl.status, 200);
  assert.equal((await dl.arrayBuffer()).byteLength, 5);
  // without the bucket, the library stays in KV as before
  const plain = await W.handleRequest(wreq("/api/files", { method: "POST", headers: { ...KEYH, "x-filename": "cup.3mf" }, body: new Uint8Array([0x50, 0x4b, 3, 4]) }), workerEnv({ IMAGES: kv }));
  assert.equal(plain.status, 201);
  assert.ok(kv.m.has(`c3d-file:${(await plain.json()).item.key}`));
});
