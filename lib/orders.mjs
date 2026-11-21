// Orders for the Lab's Sales page: every open order on both stores, what each one needs next, and
// the actions Aaron takes on them (mark fulfilled with tracking, save a staff note).
//
//   GET  /api/orders?store=c3d|ed|all[&days=60]   open orders + recent orders + totals, per store
//   POST /api/orders  { store, id, action: "fulfill", tracking?: { number, company?, url? }, notify? }
//   POST /api/orders  { store, id, action: "note", note }
//
// Payments stay in Shopify checkout: nothing here charges, refunds or edits prices. A store that
// can't be read (missing scope, not connected) comes back with its own error so the other store
// still shows. Nothing is written to KV.
import { adminClient, HttpError, ok, fail, parseStore, readJsonBody, requireKey, storeConfig, STORES, userErrorsOrThrow } from "./shopify.mjs";

const DAY_MS = 864e5;
const MAX_NOTE = 2000;
const GID_ORDER = /^gid:\/\/shopify\/Order\/\d{1,20}$/;
const URL_RE = /^https:\/\/[^\s"<>]{3,500}$/i;

// One order's fields. Customer and address fields are protected customer data, so they sit in
// their own fragment: when Shopify refuses them the list is read again without them.
const ADDRESS = "name company address1 address2 city provinceCode zip countryCodeV2 phone";
const PERSON = `customer { displayName email phone numberOfOrders }
    shippingAddress { ${ADDRESS} }
    billingAddress { ${ADDRESS} }
    email phone`;
const ORDER_FIELDS = (withPerson) => `id name createdAt cancelledAt closed test note tags sourceName
    displayFinancialStatus displayFulfillmentStatus requiresShipping
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    totalOutstandingSet { shopMoney { amount } }
    subtotalPriceSet { shopMoney { amount } }
    totalShippingPriceSet { shopMoney { amount } }
    totalTaxSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    paymentGatewayNames processedAt
    shippingLine { title }
    ${withPerson ? PERSON : ""}
    lineItems(first: 20) { nodes { title variantTitle quantity unfulfilledQuantity sku
      image { url altText }
      originalUnitPriceSet { shopMoney { amount } }
      customAttributes { key value } } }
    fulfillments(first: 5) { status createdAt trackingInfo(first: 3) { number company url } }`;
export const ordersListQuery = (withPerson) => `query LabOrders($q: String!) {
  orders(first: 60, sortKey: CREATED_AT, reverse: true, query: $q) {
    nodes { ${ORDER_FIELDS(withPerson)} }
  }
}`;
export const SHOP_QUERY = `query LabShop { shop { currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }`;
// Marking an order fulfilled needs write access to the fulfillment orders it's made of (merchant-managed
// for the store's own shipping); saving a note needs write_orders.
const FULFILL_SCOPES = ["write_merchant_managed_fulfillment_orders", "write_assigned_fulfillment_orders", "write_fulfillments"];
export const FULFILLMENT_ORDERS_QUERY = `query LabFulfillmentOrders($id: ID!) {
  order(id: $id) { id name fulfillmentOrders(first: 10, displayable: true) { nodes { id status } } }
}`;
export const FULFILL_MUTATION = `mutation LabFulfill($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;
export const NOTE_MUTATION = `mutation LabOrderNote($input: OrderInput!) {
  orderUpdate(input: $input) { order { id note } userErrors { field message } }
}`;

const num = (v) => Number(v ?? 0) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const numericId = (gid) => String(gid).split("/").pop();
export const orderAdminUrl = (cfg, gid) => `https://admin.shopify.com/store/${cfg.shopHandle}/orders/${numericId(gid)}`;

// What the order needs from Aaron next, in plain words, plus a short code the page styles by.
export function nextStep(o) {
  const total = num(o.total);
  const fin = o.financial;
  const ful = o.fulfillment;
  if (o.cancelled) return { code: "none", text: "Cancelled" };
  if (o.isRequest && total === 0) return { code: "quote", text: "Quote this custom request and reply to the customer" };
  if (["PENDING", "PARTIALLY_PAID"].includes(fin) || (o.outstanding > 0 && fin !== "PAID"))
    return { code: "payment", text: `Waiting on payment${o.outstanding > 0 ? ` (${o.outstanding.toFixed(2)} still owed)` : ""}` };
  if (fin === "AUTHORIZED") return { code: "payment", text: "Payment authorized: capture it in Shopify before shipping" };
  if (["UNFULFILLED", "PARTIALLY_FULFILLED", "ON_HOLD", "SCHEDULED", "IN_PROGRESS", "PENDING_FULFILLMENT", "OPEN"].includes(ful)) {
    if (o.requiresShipping && o.personVisible && !o.shipTo) return { code: "address", text: "Paid. No shipping address on the order: confirm where to ship, then make and ship it" };
    return { code: "ship", text: o.requiresShipping ? "Paid. Make it, ship it, then mark it fulfilled with tracking" : "Paid. Make it, then mark it fulfilled" };
  }
  return { code: "done", text: ful === "FULFILLED" ? "Shipped" : "Nothing to do" };
}

export function shapeOrder(cfg, n, personVisible) {
  const items = (n.lineItems?.nodes ?? []).map((li) => {
    const attrs = (li.customAttributes ?? []).filter((a) => a && a.key && !String(a.key).startsWith("_"));
    return {
      title: li.title, variant: li.variantTitle && li.variantTitle !== "Default Title" ? li.variantTitle : null,
      qty: li.quantity ?? 0, unfulfilled: li.unfulfilledQuantity ?? 0, sku: li.sku || null,
      price: num(li.originalUnitPriceSet?.shopMoney?.amount),
      image: li.image?.url ?? null,
      details: attrs.filter((a) => !URL_RE.test(String(a.value).trim())).map((a) => ({ key: String(a.key).slice(0, 80), value: String(a.value).slice(0, 1500) })),
      files: attrs.filter((a) => URL_RE.test(String(a.value).trim())).map((a) => ({ key: String(a.key).slice(0, 80), url: String(a.value).trim() })),
    };
  });
  const addr = (a) => (a && (a.address1 || a.city) ? { name: a.name ?? null, company: a.company ?? null, address1: a.address1 ?? null, address2: a.address2 ?? null, city: a.city ?? null, province: a.provinceCode ?? null, zip: a.zip ?? null, country: a.countryCodeV2 ?? null, phone: a.phone ?? null } : null);
  const money = (k) => round2(num(n[k]?.shopMoney?.amount));
  const o = {
    id: n.id, name: n.name, store: cfg.store, createdAt: n.createdAt,
    cancelled: Boolean(n.cancelledAt), closed: Boolean(n.closed), test: Boolean(n.test),
    financial: n.displayFinancialStatus ?? null, fulfillment: n.displayFulfillmentStatus ?? null,
    total: num(n.currentTotalPriceSet?.shopMoney?.amount), currency: n.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
    outstanding: round2(num(n.totalOutstandingSet?.shopMoney?.amount)),
    subtotal: money("subtotalPriceSet"), shippingCost: money("totalShippingPriceSet"), tax: money("totalTaxSet"), discounts: money("totalDiscountsSet"),
    paidWith: (n.paymentGatewayNames ?? []).slice(0, 3), paidAt: n.processedAt ?? null,
    requiresShipping: Boolean(n.requiresShipping), shipping: n.shippingLine?.title ?? null,
    note: n.note ?? null, tags: n.tags ?? [], source: n.sourceName ?? null,
    personVisible,
    customer: personVisible ? (n.customer?.displayName || n.billingAddress?.name || null) : null,
    email: personVisible ? (n.email || n.customer?.email || null) : null,
    phone: personVisible ? (n.phone || n.customer?.phone || n.shippingAddress?.phone || n.billingAddress?.phone || null) : null,
    customerOrders: personVisible ? (Number(n.customer?.numberOfOrders) || null) : null,
    shipTo: personVisible ? addr(n.shippingAddress) : null,
    billTo: personVisible ? addr(n.billingAddress) : null,
    tracking: (n.fulfillments ?? []).flatMap((f) => (f.trackingInfo ?? []).map((t) => ({ number: t.number ?? null, company: t.company ?? null, url: t.url ?? null }))),
    items,
    isRequest: items.some((i) => /custom request/i.test(i.title)),
    adminUrl: orderAdminUrl(cfg, n.id),
  };
  o.next = nextStep(o);
  o.open = !o.cancelled && !["none", "done"].includes(o.next.code);
  return o;
}

const isSale = (o) => !o.cancelled && !o.test && o.total > 0;
export function totals(orders, now, tz = "UTC") {
  const sum = (days) => {
    const since = now.getTime() - days * DAY_MS;
    const list = orders.filter((o) => isSale(o) && Date.parse(o.createdAt) >= since);
    return { orders: list.length, revenue: round2(list.reduce((a, o) => a + o.total, 0)) };
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const todays = orders.filter((o) => isSale(o) && new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(o.createdAt)) === today);
  return {
    today: { orders: todays.length, revenue: round2(todays.reduce((a, o) => a + o.total, 0)) },
    d7: sum(7), d30: sum(30),
    open: orders.filter((o) => o.open).length,
    toShip: orders.filter((o) => ["ship", "address"].includes(o.next.code)).length,
    toQuote: orders.filter((o) => o.next.code === "quote").length,
    awaitingPayment: orders.filter((o) => o.next.code === "payment").length,
  };
}

async function listFor(client, q) {
  try {
    return { nodes: (await client.gql(ordersListQuery(true), { q })).orders.nodes, personVisible: true };
  } catch (e) {
    if (e.code !== "access_denied" || e.scopes?.includes("read_orders")) throw e;
    // Protected customer data (names, emails, addresses) refused: show the orders without them.
    return { nodes: (await client.gql(ordersListQuery(false), { q })).orders.nodes, personVisible: false };
  }
}

export async function storeOrders(ctx, store, days, now) {
  const cfg = storeConfig(ctx.env, store);
  const client = adminClient(cfg, ctx.fetch);
  const since = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const [shopData, recent, open] = await Promise.all([
    client.gql(SHOP_QUERY).catch(() => null),
    listFor(client, `created_at:>=${since}`),
    listFor(client, "status:open fulfillment_status:unshipped"),
  ]);
  const seen = new Map();
  for (const n of [...open.nodes, ...recent.nodes]) if (!seen.has(n.id)) seen.set(n.id, n);
  const personVisible = recent.personVisible && open.personVisible;
  const orders = [...seen.values()].map((n) => shapeOrder(cfg, n, personVisible)).filter((o) => !o.test)
    .sort((a, b) => (b.open - a.open) || b.createdAt.localeCompare(a.createdAt));
  const shop = shopData?.shop ?? null;
  const scopes = (shopData?.currentAppInstallation?.accessScopes ?? []).map((a) => a.handle);
  const known = scopes.length > 0;
  const can = { fulfill: known ? FULFILL_SCOPES.some((x) => scopes.includes(x)) : null, note: known ? scopes.includes("write_orders") : null };
  const tz = shop?.ianaTimezone || "America/New_York";
  return {
    store, name: STORES[store].name, ok: true, can, currency: shop?.currencyCode || "USD", timeZone: tz,
    personVisible, notes: personVisible ? [] : ["Shopify hides customer names and addresses from the Lab's app. Open the order in Shopify to see them, or turn on Protected customer data for the app in the Dev Dashboard."],
    totals: totals(orders, now, tz),
    ordersAdminUrl: `https://admin.shopify.com/store/${cfg.shopHandle}/orders`,
    orders,
  };
}

function storeError(store, e) {
  const scopes = e?.scopes?.length ? e.scopes : e?.code === "access_denied" ? ["read_orders"] : [];
  return { store, name: STORES[store].name, ok: false, code: e?.code ?? "error", error: e instanceof HttpError ? e.message : "Couldn't read this store's orders.", scopes, orders: [], totals: null };
}

async function fulfill(ctx, store, body) {
  const cfg = storeConfig(ctx.env, store);
  const client = adminClient(cfg, ctx.fetch);
  const d = await client.gql(FULFILLMENT_ORDERS_QUERY, { id: body.id });
  if (!d?.order) throw new HttpError(404, "not_found", "That order wasn't found on this store.");
  const fos = (d.order.fulfillmentOrders?.nodes ?? []).filter((f) => ["OPEN", "IN_PROGRESS", "SCHEDULED", "ON_HOLD"].includes(f.status));
  if (!fos.length) throw new HttpError(409, "nothing_to_fulfill", `${d.order.name} has nothing left to fulfill.`);
  const fulfillment = { lineItemsByFulfillmentOrder: fos.map((f) => ({ fulfillmentOrderId: f.id })), notifyCustomer: body.notify !== false };
  const t = body.tracking;
  if (t && t.number) fulfillment.trackingInfo = { number: t.number, ...(t.company ? { company: t.company } : {}), ...(t.url ? { url: t.url } : {}) };
  const r = await client.gql(FULFILL_MUTATION, { fulfillment });
  userErrorsOrThrow(r?.fulfillmentCreate, `Couldn't mark ${d.order.name} fulfilled`);
  return { store, id: body.id, name: d.order.name, done: "fulfilled", status: r.fulfillmentCreate.fulfillment?.status ?? null, notified: fulfillment.notifyCustomer, tracking: fulfillment.trackingInfo ?? null };
}

async function saveNote(ctx, store, body) {
  const cfg = storeConfig(ctx.env, store);
  const client = adminClient(cfg, ctx.fetch);
  const r = await client.gql(NOTE_MUTATION, { input: { id: body.id, note: body.note } });
  userErrorsOrThrow(r?.orderUpdate, "Couldn't save the note");
  return { store, id: body.id, done: "note", note: r.orderUpdate.order?.note ?? body.note };
}

export function parseAction(body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "bad_input", "Send a JSON body.");
  const store = parseStore(body.store);
  if (typeof body.id !== "string" || !GID_ORDER.test(body.id)) throw new HttpError(400, "bad_input", "id must be an order id like gid://shopify/Order/123.");
  if (body.action === "fulfill") {
    let tracking = null;
    if (body.tracking != null) {
      const t = body.tracking;
      const number = String(t.number ?? "").trim();
      const company = String(t.company ?? "").trim();
      const url = String(t.url ?? "").trim();
      if (number && !/^[A-Za-z0-9 -]{4,40}$/.test(number)) throw new HttpError(400, "bad_input", "The tracking number should be 4 to 40 letters and digits.");
      if (company.length > 60) throw new HttpError(400, "bad_input", "The carrier name is too long.");
      if (url && !URL_RE.test(url)) throw new HttpError(400, "bad_input", "The tracking link must start with https://");
      if (number) tracking = { number: number.replace(/\s+/g, ""), company: company || null, url: url || null };
    }
    return { store, id: body.id, action: "fulfill", tracking, notify: body.notify !== false };
  }
  if (body.action === "note") {
    const note = String(body.note ?? "");
    if (note.length > MAX_NOTE) throw new HttpError(400, "bad_input", `Keep the note under ${MAX_NOTE} characters.`);
    return { store, id: body.id, action: "note", note };
  }
  throw new HttpError(400, "bad_input", 'action must be "fulfill" or "note".');
}

export async function handleOrders(req, ctx) {
  try {
    requireKey(req, ctx.env, "Orders");
    const now = ctx.now ? ctx.now() : new Date();
    if (req.method === "GET") {
      const which = req.query.get("store") ?? "all";
      const stores = which === "all" ? Object.keys(STORES) : [parseStore(which)];
      const daysRaw = req.query.get("days") ?? "60";
      if (!/^\d{1,2}$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 60) throw new HttpError(400, "bad_input", "days must be 1 to 60 (Shopify shares 60 days of orders).");
      const out = await Promise.all(stores.map((s) => storeOrders(ctx, s, Number(daysRaw), now).catch((e) => storeError(s, e))));
      return ok({ generatedAt: now.toISOString(), days: Number(daysRaw), stores: out });
    }
    if (req.method === "POST") {
      const a = parseAction(await readJsonBody(req, 8192));
      return ok(a.action === "fulfill" ? await fulfill(ctx, a.store, a) : await saveNote(ctx, a.store, a));
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
