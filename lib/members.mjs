// Store account sign-in for the shirt app. Customers sign in with their Elevated Designs customer account
// (Shopify's Customer Account API, a public client with PKCE, run in the shirt app itself); the console
// checks their token and says what their Shopify customer tags unlock.
// GET /api/member/config  the sign-in addresses and public client ID for the shirt app (no auth)
// GET /api/member         Authorization: Bearer <customer access token> -> the customer's first name, tags,
//                         and the private images their tags unlock (each with a signed link)
// Unlocking is done in Shopify: tag a customer (e.g. "pro", "designs:benz1") and give an image the same tag
// in its access field (lib/images.mjs). "members" on an image means any signed-in customer.
// Env: ED_CUSTOMER_CLIENT_ID overrides the Headless channel's Customer Account API client ID below
// (public, not a secret; the shirt app sends it to Shopify in the browser anyway).
// Reading customer tags needs the read_customers scope on the ED store's app.
import { HttpError, storeConfig, siteUrl, adminClient, fetchWithTimeout } from "./shopify.mjs";
import { builderOrigins, imagesForTags } from "./images.mjs";

// The Elevated Designs Headless storefront's Customer Account API client (public client), made 2026-10-30.
export const ED_CUSTOMER_CLIENT_ID = "1cd847fd-6a88-46bb-af04-d486241fc519";
// The store's sign-in addresses, as its /.well-known files listed them on 2026-10-30. Shopify refuses some
// server-side reads of those files from Cloudflare, so these are used whenever the live read fails.
export const ED_ACCOUNT = {
  authorize: "https://account.elevatedshirts.com/authentication/oauth/authorize",
  token: "https://account.elevatedshirts.com/authentication/oauth/token",
  logout: "https://account.elevatedshirts.com/authentication/logout",
  graphql: "https://account.elevatedshirts.com/customer/api/2026-10/graphql",
};
const TIMEOUT_MS = 8000;
const DISCOVERY_MS = 60 * 60 * 1000;
const CHECK_MS = 5 * 60 * 1000;
const discovery = new Map(); // url -> { at, body }
const checked = new Map(); // token -> { at, customer }
export const clearMemberCache = () => { discovery.clear(); checked.clear(); };

const HEADERS = {
  "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
};
// CORS for the shirt app's own origins only; the member check sends an Authorization header, so it is preflighted.
function cors(req, env) {
  const origin = req.headers.get("origin");
  if (!origin || !builderOrigins(env).includes(origin)) return { vary: "Origin" };
  return { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization", "access-control-allow-methods": "GET", "access-control-max-age": "600", vary: "Origin" };
}
const json = (body, status, extra) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

// The store's own /.well-known file, or null when it can't be read (a failed read is retried after a minute).
async function wellKnown(fetchImpl, url, now) {
  const hit = discovery.get(url);
  if (hit && now - hit.at < (hit.body ? DISCOVERY_MS : 60_000)) return hit.body;
  let body = null;
  try {
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } }, TIMEOUT_MS);
    if (res.ok) body = await res.json();
  } catch { /* use the built-in addresses */ }
  discovery.set(url, { at: now, body });
  return body;
}
const https = (u) => typeof u === "string" && u.startsWith("https://");

export async function memberConfig(env, fetchImpl, now = Date.now()) {
  const clientId = (env("ED_CUSTOMER_CLIENT_ID") ?? ED_CUSTOMER_CLIENT_ID).trim();
  if (!clientId) throw new HttpError(503, "not_connected", "Store sign-in isn't switched on yet. Set ED_CUSTOMER_CLIENT_ID in the console's environment variables.");
  const oid = await wellKnown(fetchImpl, `${siteUrl(env, "ed")}/.well-known/openid-configuration`, now);
  const { authorization_endpoint: authorize, token_endpoint: token, end_session_endpoint: logout } = oid ?? {};
  if ([authorize, token, logout].every(https)) return { clientId, authorize, token, logout };
  const { graphql, ...built } = ED_ACCOUNT;
  return { clientId, ...built };
}

// Who the token belongs to: asks the Customer Account API (which rejects a bad or expired token),
// then reads the customer's tags with the console's Admin access.
async function checkToken(token, env, fetchImpl, now) {
  const hit = checked.get(token);
  if (hit && now - hit.at < CHECK_MS) return hit.customer;
  const api = await wellKnown(fetchImpl, `${siteUrl(env, "ed")}/.well-known/customer-account-api`, now);
  const graphqlUrl = https(api?.graphql_api) ? api.graphql_api : ED_ACCOUNT.graphql;
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: token },
      body: JSON.stringify({ query: "{ customer { id firstName } }" }),
    }, TIMEOUT_MS);
  } catch { throw new HttpError(504, "store_timeout", "The store didn't answer. Try again in a minute."); }
  const body = res.ok ? await res.json().catch(() => null) : null;
  const who = body?.data?.customer;
  if (!who?.id) throw new HttpError(401, "signed_out", "Your sign-in has ended. Sign in again.");
  const admin = adminClient(storeConfig(env, "ed"), fetchImpl);
  const data = await admin.gql("query Tags($id: ID!) { customer(id: $id) { tags } }", { id: who.id });
  const customer = { id: who.id, firstName: who.firstName ?? "", tags: (data?.customer?.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean) };
  if (checked.size > 500) checked.clear();
  checked.set(token, { at: now, customer });
  return customer;
}

export async function handleMember(req, { blobs, env, fetch: fetchImpl, now = Date.now() }) {
  const corsHeaders = cors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Not supported" }, 405, corsHeaders);
  try {
    const { pathname, origin } = new URL(req.url);
    if (pathname === "/api/member/config") return json(await memberConfig(env, fetchImpl, now), 200, corsHeaders);
    if (pathname !== "/api/member") return json({ error: "Not found" }, 404, corsHeaders);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token || token.length > 4096) return json({ error: "Sign in first.", code: "signed_out" }, 401, corsHeaders);
    const customer = await checkToken(token, env, fetchImpl, now);
    const items = await imagesForTags(blobs, customer.tags, env, origin);
    return json({ customer: { firstName: customer.firstName }, tags: customer.tags, items }, 200, corsHeaders);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code, ...(e.scopes ? { scopes: e.scopes } : {}) }, e.status, corsHeaders);
    return json({ error: "Something went wrong checking your sign-in.", code: "internal" }, 500, corsHeaders);
  }
}
