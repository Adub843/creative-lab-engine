// Promotions for each store: the marketing tools in Shopify's own admin that its Admin API lets the
// console run. Plain functions with no hosting code, like lib/shopify.mjs.
//
//   GET  /api/promotions?store=c3d|ed   discounts (code and automatic), gift cards, customer segments,
//                                       marketing campaigns and activity, sales channels, abandoned checkouts
//   POST /api/promotions {store, action: "discount" | "discountStatus" | "discountDelete" | "giftcard"
//                                        | "giftcardDisable" | "segment", ...}
//
// Each section is read on its own, so a scope the store's app doesn't have yet only empties its own
// section and names the scope to add. Shopify keeps some tools out of its API (Shopify Email
// campaigns, marketing automations, Flow workflows, connecting ad channels); those are listed with
// links into the store's admin (ADMIN_ONLY). Every change made here goes in the Marketing change
// log (kind "promotion"), so the Growth chart shows it against visits and sales.
import { HttpError, adminClient, fail, ok, parseStore, readJsonBody, requireKey, storeConfig, userErrorsOrThrow } from "./shopify.mjs";
import { changeEntry, logChanges } from "./marketing.mjs";

const LIST = 25;
export const SCOPES = {
  discounts: ["read_discounts", "write_discounts"],
  giftCards: ["read_gift_cards", "write_gift_cards"],
  segments: ["read_customers", "write_customers"],
  campaigns: ["read_marketing_events"],
  channels: ["read_publications"],
  abandoned: ["read_orders"],
};

// ---------- reading ----------
const DISCOUNT_FIELDS = "title status startsAt endsAt asyncUsageCount";
export const DISCOUNTS_QUERY = `query PromoDiscounts($n: Int!) {
  discountNodes(first: $n, sortKey: CREATED_AT, reverse: true) { nodes { id discount { __typename
    ... on DiscountCodeBasic { ${DISCOUNT_FIELDS} summary codes(first: 1) { nodes { code } } }
    ... on DiscountCodeFreeShipping { ${DISCOUNT_FIELDS} summary codes(first: 1) { nodes { code } } }
    ... on DiscountCodeBxgy { ${DISCOUNT_FIELDS} summary codes(first: 1) { nodes { code } } }
    ... on DiscountCodeApp { ${DISCOUNT_FIELDS} codes(first: 1) { nodes { code } } }
    ... on DiscountAutomaticBasic { ${DISCOUNT_FIELDS} summary }
    ... on DiscountAutomaticBxgy { ${DISCOUNT_FIELDS} summary }
    ... on DiscountAutomaticFreeShipping { ${DISCOUNT_FIELDS} summary }
    ... on DiscountAutomaticApp { ${DISCOUNT_FIELDS} } } } }
}`;
export const GIFT_CARDS_QUERY = `query PromoGiftCards($n: Int!) {
  giftCards(first: $n, sortKey: CREATED_AT, reverse: true) { nodes { id lastCharacters enabled expiresOn createdAt note
    balance { amount currencyCode } initialValue { amount } customer { displayName } } }
}`;
export const SEGMENTS_QUERY = `query PromoSegments($n: Int!) { segments(first: $n) { nodes { id name query creationDate lastEditDate } } }`;
export const CAMPAIGNS_QUERY = `query PromoCampaigns($n: Int!) {
  marketingActivities(first: $n, sortKey: CREATED_AT, reverse: true) { nodes { id title status createdAt marketingChannelType tactic
    sourceAndMedium isExternal utmParameters { campaign source medium } app { title } adSpend { amount currencyCode } } }
}`;
export const CHANNELS_QUERY = `query PromoChannels { publications(first: 20) { nodes { id catalog { title } } } }`;
export const ABANDONED_QUERY = `query PromoAbandoned($n: Int!) {
  abandonedCheckouts(first: $n, sortKey: CREATED_AT, reverse: true) { nodes { id createdAt abandonedCheckoutUrl
    totalPriceSet { shopMoney { amount currencyCode } } customer { displayName } lineItems(first: 3) { nodes { title quantity } } } }
}`;

const numericId = (gid) => String(gid).split("/").pop();
export const adminBase = (cfg) => `https://admin.shopify.com/store/${cfg.shopHandle}`;
const money = (m) => (m ? { amount: Number(m.amount), currency: m.currencyCode ?? "USD" } : null);

export function shapeDiscount(cfg, node) {
  const d = node.discount ?? {};
  const type = d.__typename ?? "";
  return {
    id: node.id,
    automatic: type.startsWith("DiscountAutomatic"),
    kind: /FreeShipping/.test(type) ? "shipping" : /Bxgy/.test(type) ? "bxgy" : /App$/.test(type) ? "app" : "amount",
    title: d.title ?? "",
    code: d.codes?.nodes?.[0]?.code ?? null,
    status: String(d.status ?? "").toLowerCase(),
    summary: d.summary ?? "",
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    used: d.asyncUsageCount ?? 0,
    admin: `${adminBase(cfg)}/discounts/${numericId(node.id)}`,
  };
}
// Publication catalogs are titled like "Channel Catalog 311375364400 for Online Store".
export const channelName = (title) => (/ for (.+)$/.exec(title ?? "")?.[1] ?? title ?? "").trim();
// The ad and shopping channels Shopify offers as apps. installed = a publication of that name exists.
export const AD_CHANNELS = [
  { name: "Google & YouTube", match: /google/i, app: "https://apps.shopify.com/google" },
  { name: "Facebook & Instagram", match: /facebook|instagram/i, app: "https://apps.shopify.com/facebook" },
  { name: "TikTok", match: /tiktok/i, app: "https://apps.shopify.com/tiktok" },
  { name: "Pinterest", match: /pinterest/i, app: "https://apps.shopify.com/pinterest" },
];

const SECTIONS = {
  discounts: async (client, cfg) => ((await client.gql(DISCOUNTS_QUERY, { n: LIST })).discountNodes?.nodes ?? []).map((n) => shapeDiscount(cfg, n)),
  giftCards: async (client, cfg) => ((await client.gql(GIFT_CARDS_QUERY, { n: LIST })).giftCards?.nodes ?? []).map((g) => ({
    id: g.id, last4: g.lastCharacters, enabled: g.enabled, expiresOn: g.expiresOn ?? null, createdAt: g.createdAt, note: g.note ?? "",
    balance: money(g.balance), initial: Number(g.initialValue?.amount ?? 0), customer: g.customer?.displayName ?? null,
    admin: `${adminBase(cfg)}/gift_cards/${numericId(g.id)}`,
  })),
  segments: async (client, cfg) => ((await client.gql(SEGMENTS_QUERY, { n: 50 })).segments?.nodes ?? []).map((s) => ({
    id: s.id, name: s.name, query: s.query, created: s.creationDate, edited: s.lastEditDate,
    admin: `${adminBase(cfg)}/customers/segments/${numericId(s.id)}`,
  })),
  campaigns: async (client) => ((await client.gql(CAMPAIGNS_QUERY, { n: LIST })).marketingActivities?.nodes ?? []).map((a) => ({
    id: a.id, title: a.title, status: String(a.status ?? "").toLowerCase(), createdAt: a.createdAt, channel: String(a.marketingChannelType ?? "").toLowerCase(),
    tactic: String(a.tactic ?? "").toLowerCase(), source: a.sourceAndMedium ?? "", external: Boolean(a.isExternal), app: a.app?.title ?? null,
    utm: a.utmParameters ?? null, adSpend: money(a.adSpend),
  })),
  channels: async (client) => {
    const names = ((await client.gql(CHANNELS_QUERY)).publications?.nodes ?? []).map((p) => channelName(p.catalog?.title)).filter(Boolean);
    const installed = [...new Set(names)];
    return { installed, ads: AD_CHANNELS.map((c) => ({ name: c.name, app: c.app, installed: installed.some((n) => c.match.test(n)) })) };
  },
  abandoned: async (client) => ((await client.gql(ABANDONED_QUERY, { n: LIST })).abandonedCheckouts?.nodes ?? []).map((c) => ({
    id: c.id, createdAt: c.createdAt, url: c.abandonedCheckoutUrl, total: money(c.totalPriceSet?.shopMoney), customer: c.customer?.displayName ?? null,
    items: (c.lineItems?.nodes ?? []).map((l) => `${l.quantity} × ${l.title}`),
  })),
};

// The tools Shopify doesn't open to apps: run in its admin, linked from the console.
export function adminOnly(cfg) {
  const a = adminBase(cfg);
  return [
    { name: "Shopify Email", why: "Email campaigns and newsletters. Shopify has no API to write or send them.", url: `${a}/apps/shopify-email` },
    { name: "Marketing automations", why: "Abandoned cart, browse and welcome emails. Turned on and edited only in the admin.", url: `${a}/marketing/automations` },
    { name: "Shopify Flow", why: "Workflows (tag VIPs, alert on low stock, follow up after an order). Built in the Flow app.", url: `${a}/apps/flow` },
    { name: "Campaigns", why: "Group activities and see attributed sales. The console shows them; creating one is admin only.", url: `${a}/marketing/campaigns` },
    { name: "Ad channels", why: "Connecting Google, Meta, TikTok and Pinterest accounts and running their ads happens in each channel app.", url: `${a}/settings/apps` },
  ];
}

export async function loadPromotions(client, cfg) {
  const out = { store: cfg.store, admin: adminBase(cfg), adminOnly: adminOnly(cfg) };
  await Promise.all(Object.entries(SECTIONS).map(async ([k, read]) => {
    try { out[k] = { items: await read(client, cfg) }; }
    catch (e) {
      if (e?.code === "access_denied") out[k] = { error: `Add the ${SCOPES[k].join(" and ")} scope${SCOPES[k].length > 1 ? "s" : ""} to the store's app to use this.`, code: "access_denied", scopes: SCOPES[k] };
      else if (e instanceof HttpError) out[k] = { error: e.message, code: e.code };
      else out[k] = { error: "Couldn't load this from Shopify.", code: "internal" };
    }
  }));
  return out;
}

// ---------- changing ----------
const mutation = (name, arg, type, node) => `mutation Promo${name[0].toUpperCase()}${name.slice(1)}($d: ${type}!) { ${name}(${arg}: $d) { ${node} { id } userErrors { field message } } }`;
export const MUTATIONS = {
  codeAmount: mutation("discountCodeBasicCreate", "basicCodeDiscount", "DiscountCodeBasicInput", "codeDiscountNode"),
  codeShipping: mutation("discountCodeFreeShippingCreate", "freeShippingCodeDiscount", "DiscountCodeFreeShippingInput", "codeDiscountNode"),
  autoAmount: mutation("discountAutomaticBasicCreate", "automaticBasicDiscount", "DiscountAutomaticBasicInput", "automaticDiscountNode"),
  autoShipping: mutation("discountAutomaticFreeShippingCreate", "freeShippingAutomaticDiscount", "DiscountAutomaticFreeShippingInput", "automaticDiscountNode"),
  codeActivate: `mutation PromoCodeOn($id: ID!) { discountCodeActivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`,
  codeDeactivate: `mutation PromoCodeOff($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`,
  autoActivate: `mutation PromoAutoOn($id: ID!) { discountAutomaticActivate(id: $id) { automaticDiscountNode { id } userErrors { field message } } }`,
  autoDeactivate: `mutation PromoAutoOff($id: ID!) { discountAutomaticDeactivate(id: $id) { automaticDiscountNode { id } userErrors { field message } } }`,
  codeDelete: `mutation PromoCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }`,
  autoDelete: `mutation PromoAutoDelete($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { field message } } }`,
  giftCardCreate: `mutation PromoGiftCard($d: GiftCardCreateInput!) { giftCardCreate(input: $d) { giftCard { id lastCharacters } giftCardCode userErrors { field message } } }`,
  giftCardDeactivate: `mutation PromoGiftCardOff($id: ID!) { giftCardDeactivate(id: $id) { giftCard { id enabled } userErrors { field message } } }`,
  segmentCreate: `mutation PromoSegment($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id name } userErrors { field message } } }`,
};

const GID = {
  discount: /^gid:\/\/shopify\/Discount(Code|Automatic)Node\/[1-9]\d{0,19}$/,
  giftCard: /^gid:\/\/shopify\/GiftCard\/[1-9]\d{0,19}$/,
  segment: /^gid:\/\/shopify\/Segment\/[1-9]\d{0,19}$/,
};
const CODE = /^[A-Za-z0-9_-]{3,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const bad = (msg) => new HttpError(400, "bad_input", msg);
function only(body, keys) {
  const extra = Object.keys(body).filter((k) => !keys.includes(k));
  if (extra.length) throw bad(`Unexpected field: ${extra.slice(0, 3).join(", ")}.`);
}
const text = (v, name, max, { required = true } = {}) => {
  if (v == null || v === "") { if (required) throw bad(`${name} is required.`); return ""; }
  if (typeof v !== "string" || v.trim().length > max) throw bad(`${name} must be text of at most ${max} characters.`);
  return v.trim();
};
const number = (v, name, min, max, { int = false } = {}) => {
  if (v == null || v === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < min || x > max || (int && !Number.isInteger(x))) throw bad(`${name} must be ${int ? "a whole number" : "a number"} from ${min} to ${max}.`);
  return x;
};
const when = (v, name) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a date and time like 2026-11-01T09:00:00Z.`);
  return new Date(v).toISOString();
};
const gid = (v, kind, name) => {
  if (typeof v !== "string" || !GID[kind].test(v)) throw bad(`${name} isn't a Shopify ${kind === "giftCard" ? "gift card" : kind} id.`);
  return v;
};

export function parsePromotionInput(body, now = new Date()) {
  const store = parseStore(body.store);
  switch (body.action) {
    case "discount": {
      only(body, ["store", "action", "method", "type", "title", "code", "value", "minSubtotal", "startsAt", "endsAt", "usageLimit", "oncePerCustomer", "segmentId"]);
      if (!["code", "automatic"].includes(body.method)) throw bad("method must be code or automatic.");
      if (!["percentage", "amount", "shipping"].includes(body.type)) throw bad("type must be percentage, amount or shipping.");
      const auto = body.method === "automatic";
      const out = { store, action: "discount", method: body.method, type: body.type, title: text(body.title, "Title", 255) };
      if (auto) {
        if (body.code || body.usageLimit != null || body.oncePerCustomer != null) throw bad("Automatic discounts have no code, use limit or once-per-customer setting.");
      } else {
        out.code = text(body.code, "Code", 40).toUpperCase();
        if (!CODE.test(out.code)) throw bad("Code must be 3 to 40 letters, numbers, dashes or underscores.");
        out.usageLimit = number(body.usageLimit, "Use limit", 1, 1000000, { int: true });
        if (body.oncePerCustomer != null && typeof body.oncePerCustomer !== "boolean") throw bad("oncePerCustomer must be true or false.");
        out.oncePerCustomer = Boolean(body.oncePerCustomer);
      }
      if (body.type === "shipping") { if (body.value != null && body.value !== "") throw bad("Free shipping has no value."); out.value = null; }
      else out.value = body.type === "percentage" ? number(body.value, "Percent off", 1, 100) : number(body.value, "Amount off", 0.01, 100000);
      if (body.type !== "shipping" && out.value == null) throw bad(body.type === "percentage" ? "Percent off is required." : "Amount off is required.");
      out.minSubtotal = number(body.minSubtotal, "Minimum order", 0.01, 1000000);
      out.startsAt = when(body.startsAt, "Start") ?? now.toISOString();
      out.endsAt = when(body.endsAt, "End");
      if (out.endsAt && Date.parse(out.endsAt) <= Date.parse(out.startsAt)) throw bad("End must be after the start.");
      out.segmentId = body.segmentId ? gid(body.segmentId, "segment", "segmentId") : null;
      return out;
    }
    case "discountStatus":
      only(body, ["store", "action", "id", "active"]);
      if (typeof body.active !== "boolean") throw bad("active must be true or false.");
      return { store, action: body.action, id: gid(body.id, "discount", "id"), active: body.active };
    case "discountDelete":
      only(body, ["store", "action", "id"]);
      return { store, action: body.action, id: gid(body.id, "discount", "id") };
    case "giftcard": {
      only(body, ["store", "action", "amount", "note", "expiresOn"]);
      const amount = number(body.amount, "Amount", 1, 10000);
      if (amount == null) throw bad("Amount is required.");
      let expiresOn = null;
      if (body.expiresOn) {
        if (typeof body.expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn) || Number.isNaN(Date.parse(body.expiresOn))) throw bad("Expires must be a date like 2027-12-31.");
        if (body.expiresOn <= now.toISOString().slice(0, 10)) throw bad("Expires must be after today.");
        expiresOn = body.expiresOn;
      }
      return { store, action: "giftcard", amount, note: text(body.note, "Note", 500, { required: false }), expiresOn };
    }
    case "giftcardDisable":
      only(body, ["store", "action", "id"]);
      return { store, action: body.action, id: gid(body.id, "giftCard", "id") };
    case "segment":
      only(body, ["store", "action", "name", "query"]);
      return { store, action: "segment", name: text(body.name, "Name", 255), query: text(body.query, "Rule", 2000) };
    default:
      throw bad("action must be discount, discountStatus, discountDelete, giftcard, giftcardDisable or segment.");
  }
}

// The Shopify input for a new discount. Amount-off discounts stack with shipping discounts, and free
// shipping stacks with amount-off ones, so a sale never blocks free shipping.
export function discountInput(i) {
  const d = { title: i.title, startsAt: i.startsAt, endsAt: i.endsAt ?? null,
    context: i.segmentId ? { customerSegments: { add: [i.segmentId] } } : { all: "ALL" } };
  if (i.minSubtotal != null) d.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: i.minSubtotal.toFixed(2) } };
  if (i.method === "code") {
    d.code = i.code;
    d.appliesOncePerCustomer = i.oncePerCustomer;
    if (i.usageLimit != null) d.usageLimit = i.usageLimit;
  }
  if (i.type === "shipping") {
    d.destination = { all: true };
    d.combinesWith = { productDiscounts: true, orderDiscounts: true };
  } else {
    d.customerGets = { items: { all: true }, value: i.type === "percentage" ? { percentage: i.value / 100 } : { discountAmount: { amount: i.value.toFixed(2), appliesOnEachItem: false } } };
    d.combinesWith = { shippingDiscounts: true };
  }
  return d;
}
export const describeDiscount = (i) => `${i.type === "shipping" ? "Free shipping" : i.type === "percentage" ? `${i.value}% off` : `$${i.value.toFixed(2)} off`}`
  + `${i.minSubtotal != null ? ` orders over $${i.minSubtotal.toFixed(2)}` : ""}${i.method === "code" ? ` with code ${i.code}` : ", applied automatically"}`;

async function applyPromotion(client, cfg, input) {
  const g = client.gql;
  switch (input.action) {
    case "discount": {
      const key = `${input.method === "code" ? "code" : "auto"}${input.type === "shipping" ? "Shipping" : "Amount"}`;
      const data = await g(MUTATIONS[key], { d: discountInput(input) });
      const r = Object.values(data ?? {})[0];
      userErrorsOrThrow(r, "Couldn't create the discount");
      const id = (r.codeDiscountNode ?? r.automaticDiscountNode)?.id;
      return { result: { id, admin: id ? `${adminBase(cfg)}/discounts/${numericId(id)}` : null },
        log: { itemKind: "discount", target: id, title: input.title, before: {}, after: { discount: describeDiscount(input), status: "on" } } };
    }
    case "discountStatus": {
      const auto = input.id.includes("DiscountAutomaticNode");
      const key = `${auto ? "auto" : "code"}${input.active ? "Activate" : "Deactivate"}`;
      const r = Object.values((await g(MUTATIONS[key], { id: input.id })) ?? {})[0];
      userErrorsOrThrow(r, `Couldn't turn the discount ${input.active ? "on" : "off"}`);
      return { result: { id: input.id, active: input.active },
        log: { itemKind: "discount", target: input.id, title: "Discount", before: { status: input.active ? "off" : "on" }, after: { status: input.active ? "on" : "off" } } };
    }
    case "discountDelete": {
      const auto = input.id.includes("DiscountAutomaticNode");
      const r = Object.values((await g(MUTATIONS[auto ? "autoDelete" : "codeDelete"], { id: input.id })) ?? {})[0];
      userErrorsOrThrow(r, "Couldn't delete the discount");
      return { result: { deleted: input.id },
        log: { itemKind: "discount", target: input.id, title: "Discount", before: { status: "existed" }, after: { status: "deleted" } } };
    }
    case "giftcard": {
      const d = { initialValue: input.amount.toFixed(2) }; // Admin API 2025-10 (later versions use initialAmount)
      if (input.note) d.note = input.note;
      if (input.expiresOn) d.expiresOn = input.expiresOn;
      const r = (await g(MUTATIONS.giftCardCreate, { d })).giftCardCreate;
      userErrorsOrThrow(r, "Couldn't create the gift card");
      // The full code is shown once, here; Shopify only ever returns the last characters after this.
      return { result: { id: r.giftCard?.id, code: r.giftCardCode ?? null, last4: r.giftCard?.lastCharacters ?? null,
        admin: r.giftCard?.id ? `${adminBase(cfg)}/gift_cards/${numericId(r.giftCard.id)}` : null },
        log: { itemKind: "giftcard", target: r.giftCard?.id ?? null, title: `Gift card ending ${r.giftCard?.lastCharacters ?? ""}`.trim(), before: {}, after: { giftCard: `$${input.amount.toFixed(2)}` } } };
    }
    case "giftcardDisable": {
      const r = (await g(MUTATIONS.giftCardDeactivate, { id: input.id })).giftCardDeactivate;
      userErrorsOrThrow(r, "Couldn't turn the gift card off");
      return { result: { id: input.id, enabled: false },
        log: { itemKind: "giftcard", target: input.id, title: "Gift card", before: { status: "on" }, after: { status: "off for good" } } };
    }
    case "segment": {
      const r = (await g(MUTATIONS.segmentCreate, { name: input.name, query: input.query })).segmentCreate;
      userErrorsOrThrow(r, "Couldn't create the segment");
      return { result: { id: r.segment?.id, name: r.segment?.name, admin: r.segment?.id ? `${adminBase(cfg)}/customers/segments/${numericId(r.segment.id)}` : null },
        log: { itemKind: "segment", target: r.segment?.id ?? null, title: input.name, before: {}, after: { segment: input.query } } };
    }
  }
  throw bad("Unknown action.");
}

// Ready-made customer segments (Shopify's segment query language).
// Every query here was checked against Shopify (customerSegmentMembers). Names differ from the
// segments Shopify makes by default, since segment names must be unique.
export const SEGMENT_TEMPLATES = [
  { name: "Loyal: 3+ orders", query: "number_of_orders >= 3" },
  { name: "Lapsed: no order in 90 days", query: "number_of_orders >= 1 AND last_order_date < -90d" },
  { name: "Top spenders: $150+", query: "amount_spent >= 150" },
  { name: "Subscribed, never bought", query: "email_subscription_status = 'SUBSCRIBED' AND number_of_orders = 0" },
  { name: "South Carolina customers", query: "customer_regions CONTAINS 'US-SC'" },
];

// ---------- /api/promotions ----------
export async function handlePromotions(req, ctx) {
  try {
    const clock = ctx.now ?? (() => new Date());
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Promotions");
      const store = parseStore(req.query.get("store"));
      const cfg = storeConfig(ctx.env, store);
      return ok({ ...(await loadPromotions(adminClient(cfg, ctx.fetch), cfg)), templates: SEGMENT_TEMPLATES });
    }
    if (req.method === "POST") {
      requireKey(req, ctx.env);
      const input = parsePromotionInput(await readJsonBody(req, 8 * 1024), clock());
      const cfg = storeConfig(ctx.env, input.store);
      let done;
      try { done = await applyPromotion(adminClient(cfg, ctx.fetch), cfg, input); }
      catch (e) {
        if (e?.code === "access_denied") {
          const scopes = input.action.startsWith("discount") ? SCOPES.discounts : input.action.startsWith("giftcard") ? SCOPES.giftCards : SCOPES.segments;
          throw new HttpError(502, "access_denied", `Add the ${scopes.join(" and ")} scopes to the store's app first.`, { details: { scopes } });
        }
        throw e;
      }
      const entry = changeEntry({ at: clock().toISOString(), source: "console", kind: "promotion", url: cfg.site, ...done.log });
      await logChanges(ctx.kv, input.store, [entry]).catch(() => {});
      return ok({ store: input.store, action: input.action, ...done.result, logged: Boolean(ctx.kv) });
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
