// Tests for /api/orders (lib/orders.mjs) with Shopify mocked. Run: node scripts/test-orders.mjs
// Every GraphQL string and its variables are checked against the real Admin API 2025-10 schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrders, nextStep, ordersListQuery, FULFILLMENT_ORDERS_QUERY, FULFILL_MUTATION, NOTE_MUTATION, SHOP_QUERY } from "../lib/orders.mjs";
import { clearTokenCache } from "../lib/shopify.mjs";
import { schemaErrors, variableErrors } from "./schema/validate.mjs";

const KEY = "open-sesame-test-key-0001";
const ENV = {
  C3D_SHOPIFY_DOMAIN: "nu2xws-gy.myshopify.com", C3D_ADMIN_TOKEN: "shpat_C3D_TEST_TOKEN_1",
  ED_SHOPIFY_DOMAIN: "xzqxnd-er.myshopify.com", ED_ADMIN_TOKEN: "shpat_ED_TEST_TOKEN_2",
  CONSOLE_KEY: KEY,
};
const env = (over = {}) => (k) => (k in over ? over[k] : ENV[k]);
const NOW = new Date("2026-11-21T16:00:00Z");
const problems = [];

// Order #1001 as it really is: a $0 custom request, edited to 6 ornaments + $8 shipping, paid, no shipping address.
const ORDER_1001 = {
  id: "gid://shopify/Order/19014878691515", name: "#1001", createdAt: "2026-11-14T15:15:00Z", cancelledAt: null, closed: false, test: false,
  note: null, tags: [], sourceName: "web", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", requiresShipping: true,
  currentTotalPriceSet: { shopMoney: { amount: "119.0", currencyCode: "USD" } }, totalOutstandingSet: { shopMoney: { amount: "0.0" } },
  shippingLine: { title: "shipping" },
  customer: { displayName: "Test Buyer" }, shippingAddress: null,
  billingAddress: { name: "Test Buyer", company: null, address1: "1 Test Lane", address2: null, city: "Greenwich", provinceCode: "CT", zip: "06831", countryCodeV2: "US", phone: "555-0100" }, email: "buyer@example.com", phone: null,
  subtotalPriceSet: { shopMoney: { amount: "111.0" } }, totalShippingPriceSet: { shopMoney: { amount: "8.0" } }, totalTaxSet: { shopMoney: { amount: "0.0" } }, totalDiscountsSet: { shopMoney: { amount: "0.0" } },
  paymentGatewayNames: ["shopify_payments"], processedAt: "2026-11-16T14:00:00Z",
  lineItems: { nodes: [
    { title: "Custom request", variantTitle: null, quantity: 1, unfulfilledQuantity: 1, sku: null, image: { url: "https://cdn.shopify.com/req.jpg", altText: null },
      originalUnitPriceSet: { shopMoney: { amount: "0.0" } },
      customAttributes: [{ key: "Request", value: "Mini bottle ornaments" }, { key: "Photo 1", value: "https://cdn.shopify.com/s/files/photo.jpg" }, { key: "_hidden", value: "x" }] },
    { title: "Custom bottle ornament - Preston Lane", variantTitle: null, quantity: 6, unfulfilledQuantity: 6, sku: null, image: null,
      originalUnitPriceSet: { shopMoney: { amount: "18.5" } }, customAttributes: [] }] },
  fulfillments: [],
};

function fake(opts = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = String(url);
    assert.match(u, /^https:\/\/[a-z0-9-]+\.myshopify\.com\/admin\/api\/2025-10\/graphql\.json$/);
    const { query, variables } = JSON.parse(init.body);
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)[1];
    for (const m of [...schemaErrors(query), ...variableErrors(query, variables)]) problems.push(`${op}: ${m}`);
    calls.push({ op, variables, host: new URL(u).host, person: /shippingAddress/.test(query) });
    const data = (d) => new Response(JSON.stringify({ data: d }), { status: 200 });
    const host = new URL(u).host;
    if (opts.fail?.[host]) return opts.fail[host]({ op, query, variables });
    switch (op) {
      case "LabShop": return data({ shop: { currencyCode: "USD", ianaTimezone: "America/New_York" }, currentAppInstallation: { accessScopes: (opts.scopes ?? ["read_orders", "write_orders", "write_merchant_managed_fulfillment_orders"]).map((handle) => ({ handle })) } });
      case "LabOrders":
        if (opts.denyPerson && /shippingAddress/.test(query))
          return new Response(JSON.stringify({ errors: [{ message: "This app is not approved to access the Customer object.", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 });
        return data({ orders: { nodes: host.startsWith("nu2") ? [ORDER_1001] : [] } });
      case "LabFulfillmentOrders": return data({ order: opts.noOrder ? null : { id: variables.id, name: "#1001", fulfillmentOrders: { nodes: opts.fos ?? [{ id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" }, { id: "gid://shopify/FulfillmentOrder/2", status: "CLOSED" }] } } });
      case "LabFulfill": return data({ fulfillmentCreate: opts.fulfillErrors ? { fulfillment: null, userErrors: [{ field: ["x"], message: "Tracking is invalid" }] } : { fulfillment: { id: "gid://shopify/Fulfillment/9", status: "SUCCESS" }, userErrors: [] } });
      case "LabOrderNote": return data({ orderUpdate: { order: { id: variables.input.id, note: variables.input.note }, userErrors: [] } });
      default: throw new Error("unexpected op " + op);
    }
  };
  return { fetch, calls };
}
const req = (method, path, body, key = KEY) => {
  const url = new URL(path, "https://x");
  return { method, query: url.searchParams, header: (k) => (k === "x-console-key" ? key : k === "content-type" ? "application/json" : null), text: async () => (body == null ? "" : JSON.stringify(body)) };
};
const run = (r, f, over) => { clearTokenCache(); return handleOrders(r, { env: env(over), fetch: f.fetch, now: () => NOW }); };

test("all queries match the Admin API 2025-10 schema", () => {
  for (const q of [ordersListQuery(true), ordersListQuery(false), FULFILLMENT_ORDERS_QUERY, FULFILL_MUTATION, NOTE_MUTATION, SHOP_QUERY]) assert.deepEqual(schemaErrors(q), []);
});

test("GET all: both stores, order #1001 needs an address and is counted as a $119 sale", async () => {
  const f = fake();
  const out = await run(req("GET", "/api/orders?store=all"), f);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.stores.map((s) => s.store), ["c3d", "ed"]);
  const c3d = out.body.stores[0];
  assert.equal(c3d.ok, true);
  assert.equal(c3d.orders.length, 1, "open + recent lists are merged without duplicates");
  const o = c3d.orders[0];
  assert.equal(o.next.code, "address");
  assert.equal(o.open, true);
  assert.equal(o.total, 119);
  assert.equal(o.adminUrl, "https://admin.shopify.com/store/nu2xws-gy/orders/19014878691515");
  assert.deepEqual(o.items[0].details, [{ key: "Request", value: "Mini bottle ornaments" }]);
  assert.deepEqual(o.items[0].files, [{ key: "Photo 1", url: "https://cdn.shopify.com/s/files/photo.jpg" }]);
  assert.equal(o.billTo.address1, "1 Test Lane", "full street address for the shipping label");
  assert.equal(o.phone, "555-0100", "phone falls back to the address phone");
  assert.equal(o.email, "buyer@example.com");
  assert.deepEqual([o.subtotal, o.shippingCost, o.tax, o.discounts], [111, 8, 0, 0]);
  assert.deepEqual(o.paidWith, ["shopify_payments"]);
  assert.equal(c3d.totals.d30.revenue, 119);
  assert.equal(c3d.totals.d7.orders, 0);
  assert.equal(c3d.totals.toShip, 1);
  assert.deepEqual(c3d.can, { fulfill: true, note: true });
  assert.equal(out.body.stores[1].orders.length, 0);
  assert.ok(f.calls.every((c) => c.op !== "LabFulfill"), "reading never writes");
});

test("customer data refused: orders still show without names or addresses", async () => {
  const f = fake({ denyPerson: true });
  const out = await run(req("GET", "/api/orders?store=c3d"), f);
  assert.equal(out.status, 200);
  const s = out.body.stores[0];
  assert.equal(s.personVisible, false);
  assert.equal(s.orders[0].customer, null);
  assert.equal(s.orders[0].next.code, "ship", "without address data it can't say the address is missing");
  assert.ok(s.notes[0].includes("Protected customer data"));
});

test("one store failing doesn't hide the other", async () => {
  const f = fake({ fail: { "xzqxnd-er.myshopify.com": () => new Response(JSON.stringify({ errors: [{ message: "Access denied for orders field. Required access: `read_orders`", extensions: { code: "ACCESS_DENIED" } }] }), { status: 200 }) } });
  const out = await run(req("GET", "/api/orders"), f);
  assert.equal(out.status, 200);
  assert.equal(out.body.stores[0].ok, true);
  assert.equal(out.body.stores[1].ok, false);
  assert.deepEqual(out.body.stores[1].scopes, ["read_orders"]);
});

test("not connected store reports itself", async () => {
  const out = await run(req("GET", "/api/orders?store=ed"), fake(), { ED_SHOPIFY_DOMAIN: "", ED_ADMIN_TOKEN: "" });
  assert.equal(out.body.stores[0].code, "not_connected");
});

test("fulfill: open fulfillment orders only, tracking and notify sent", async () => {
  const f = fake();
  const out = await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill", tracking: { number: "9400 1000 0000 0000 0000 00", company: "USPS" } }), f);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const call = f.calls.find((c) => c.op === "LabFulfill");
  assert.deepEqual(call.variables.fulfillment, { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" }], notifyCustomer: true, trackingInfo: { number: "9400100000000000000000", company: "USPS" } });
  assert.equal(out.body.done, "fulfilled");
});

test("fulfill: nothing open, unknown order and Shopify errors are plain messages", async () => {
  let out = await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill" }), fake({ fos: [{ id: "gid://shopify/FulfillmentOrder/2", status: "CLOSED" }] }));
  assert.equal(out.status, 409);
  out = await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill" }), fake({ noOrder: true }));
  assert.equal(out.status, 404);
  out = await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill" }), fake({ fulfillErrors: true }));
  assert.equal(out.status, 422);
  assert.match(out.body.error, /Tracking is invalid/);
});

test("note: saved through orderUpdate", async () => {
  const f = fake();
  const out = await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "note", note: "Printing Sat, ship Mon" }), f);
  assert.equal(out.status, 200);
  assert.deepEqual(f.calls.find((c) => c.op === "LabOrderNote").variables, { input: { id: ORDER_1001.id, note: "Printing Sat, ship Mon" } });
});

test("input checks: key, store, id, action, tracking, days, method", async () => {
  const f = fake();
  assert.equal((await run(req("GET", "/api/orders", null, "wrong-key-wrong-key"), f)).status, 401);
  assert.equal((await run(req("GET", "/api/orders?store=etsy"), f)).status, 400);
  assert.equal((await run(req("GET", "/api/orders?days=90"), f)).status, 400);
  assert.equal((await run(req("POST", "/api/orders", { store: "c3d", id: "123", action: "fulfill" }), f)).status, 400);
  assert.equal((await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "refund" }), f)).status, 400);
  assert.equal((await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill", tracking: { number: "<script>" } }), f)).status, 400);
  assert.equal((await run(req("POST", "/api/orders", { store: "c3d", id: ORDER_1001.id, action: "fulfill", tracking: { number: "1234567", url: "http://x.y" } }), f)).status, 400);
  assert.equal((await run(req("DELETE", "/api/orders"), f)).status, 405);
  assert.ok(!f.calls.some((c) => c.op === "LabFulfill"));
});

test("next step wording", () => {
  const base = { total: 20, financial: "PAID", fulfillment: "UNFULFILLED", outstanding: 0, requiresShipping: true, personVisible: true, shipTo: { city: "Charleston" }, isRequest: false, cancelled: false };
  assert.equal(nextStep(base).code, "ship");
  assert.equal(nextStep({ ...base, total: 0, isRequest: true }).code, "quote");
  assert.equal(nextStep({ ...base, financial: "PENDING", outstanding: 20 }).code, "payment");
  assert.equal(nextStep({ ...base, financial: "AUTHORIZED" }).code, "payment");
  assert.equal(nextStep({ ...base, fulfillment: "FULFILLED" }).code, "done");
  assert.equal(nextStep({ ...base, cancelled: true }).code, "none");
  assert.equal(nextStep({ ...base, requiresShipping: false }).text, "Paid. Make it, then mark it fulfilled");
});

test("no GraphQL schema problems", () => assert.deepEqual(problems, []));
