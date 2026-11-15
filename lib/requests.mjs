// Charleston 3D custom requests, for the sorting job on Aaron's local model (ai-jobs/request-triage.md).
// GET /api/requests?days=14 (console key) reads the free "Custom request" orders the order app and the site's
// Custom page create, and returns only what was asked for: the request text and its options. It never returns a
// customer's name, email, phone or address, the uploaded files' links, or anything from the Elevated Designs store.
// Email addresses and phone numbers typed into the request text are blanked out before it leaves here.
import { HttpError, adminClient, fail, ok, requireKey, storeConfig } from "./shopify.mjs";

const DAY_MS = 86400000;
const MAX_PAGES = 5; // 500 orders: far more than two weeks of a small shop
export const REQUEST_TAG = "request-product";
const FIELDS = { "request type": "type", request: "request", "example link": "exampleLink", "quantity wanted": "quantity", "needed by": "neededBy", size: "size", colors: "colors" };
const FILE_KEY = /^(photo \d|3d file|file|pdf)/i;

export const REQUESTS_QUERY = `query ConsoleRequests($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt closed test
      lineItems(first: 10) { nodes { title product { handle tags } customAttributes { key value } } }
    }
  }
}`;

// Blanks out anything that looks like an email address or a phone number.
export const scrub = (text) => String(text ?? "")
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]")
  .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone removed]")
  .replace(/\s+/g, " ").trim();

const isRequestLine = (li) => (li?.product?.tags ?? []).some((t) => String(t).toLowerCase() === REQUEST_TAG) || /^custom request$/i.test(String(li?.title ?? "").trim());

// One entry per request line, newest first. Cancelled and test orders are left out.
export function normalizeRequests(nodes) {
  const out = [];
  for (const o of nodes ?? []) {
    if (!o || o.cancelledAt || o.test) continue;
    for (const li of o.lineItems?.nodes ?? []) {
      if (!isRequestLine(li)) continue;
      const r = { order: String(o.name ?? ""), date: String(o.createdAt ?? "").slice(0, 10), open: o.closed !== true, type: "", request: "", exampleLink: false, quantity: null, neededBy: null, size: "", colors: "", files: 0 };
      for (const a of li.customAttributes ?? []) {
        const key = String(a?.key ?? "").trim(), value = String(a?.value ?? "").trim();
        if (!key || !value || key.startsWith("_")) continue;
        if (FILE_KEY.test(key)) { r.files++; continue; }
        const field = FIELDS[key.toLowerCase()];
        if (field === "exampleLink") r.exampleLink = true;
        else if (field === "quantity") r.quantity = /^\d{1,5}$/.test(value) ? Number(value) : null;
        else if (field === "neededBy") r.neededBy = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
        else if (field) r[field] = scrub(value).slice(0, field === "request" ? 1500 : 120);
      }
      if (r.request) out.push(r);
    }
  }
  return out;
}

export async function handleRequests(req, ctx) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    requireKey(req, ctx.env, "Custom requests");
    const store = req.query.get("store") ?? "c3d";
    if (store !== "c3d") throw new HttpError(400, "bad_input", "Custom requests are a Charleston 3D feature: store must be c3d.");
    const daysRaw = req.query.get("days") ?? "14";
    if (!/^\d{1,2}$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 60) throw new HttpError(400, "bad_input", "days must be a whole number from 1 to 60.");
    const now = ctx.now ? ctx.now() : new Date();
    const since = new Date(now.getTime() - Number(daysRaw) * DAY_MS).toISOString().slice(0, 10);
    const client = adminClient(storeConfig(ctx.env, store), ctx.fetch);
    const nodes = [];
    let cursor = null, pages = 0, truncated = false;
    do {
      const d = await client.gql(REQUESTS_QUERY, { cursor, q: `created_at:>=${since}` });
      nodes.push(...d.orders.nodes);
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
      if (cursor && ++pages >= MAX_PAGES) { truncated = true; cursor = null; }
    } while (cursor);
    return ok({ store, since, truncated, requests: normalizeRequests(nodes) });
  } catch (e) { return fail(e); }
}
