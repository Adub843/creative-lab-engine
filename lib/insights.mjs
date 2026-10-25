// Store insights for the console: sales, products and sessions from Shopify Admin, with growth,
// a 30-day forecast and plain-English next steps. buildInsights() is pure (no network) so the
// maths can be tested on fixture data; handleInsights() fetches from Shopify and calls it.
import { HttpError, adminClient, fail, ok, parseStore, requireKey, storeConfig } from "./shopify.mjs";

const DAY_MS = 86400000;
const ORDER_FETCH_BUDGET_MS = 8000;
const MAX_ORDER_PAGES = 30; // 3,000 orders

// ---------- dates (calendar days in the shop's time zone, as YYYY-MM-DD keys) ----------
export function dayKey(date, timeZone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}
export const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const dayRange = (endKey, n) => Array.from({ length: n }, (_, i) => addDays(endKey, i - n + 1));
const monthOf = (key) => Number(key.slice(5, 7));

// ---------- small maths ----------
const money = (n, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n ?? 0);
const round = (n, dp = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);
export function growthPct(current, previous) {
  if (!previous) return current ? null : 0; // no base to compare against
  return round(((current - previous) / previous) * 100, 1);
}
export function linearFit(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  ys.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const resid = ys.map((y, x) => y - (intercept + slope * x));
  const ssr = resid.reduce((a, r) => a + r * r, 0);
  const sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  return { slope, intercept, r2: sst ? 1 - ssr / sst : 0, residualSd: n > 2 ? Math.sqrt(ssr / (n - 2)) : 0 };
}

// ---------- orders ----------
// Turns Admin API order nodes into { day, total, customerId, customerOrders, items[] }, dropping
// cancelled and test orders.
export function normalizeOrders(nodes, timeZone) {
  return nodes
    .filter((o) => !o.cancelledAt && !o.test)
    .map((o) => ({
      day: dayKey(new Date(o.createdAt), timeZone),
      total: Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0),
      customerId: o.customer?.id ?? null,
      customerOrders: o.customer ? Number(o.customer.numberOfOrders) : null,
      items: (o.lineItems?.nodes ?? []).map((li) => ({
        productId: li.product?.id ?? `title:${li.title}`,
        title: li.product?.title ?? li.title,
        handle: li.product?.handle ?? null,
        qty: li.quantity ?? 0,
        revenue: Number(li.discountedTotalSet?.shopMoney?.amount ?? 0),
      })),
    }));
}

const inRange = (o, start, end) => o.day >= start && o.day <= end;
export function periodSummary(orders, start, end) {
  const list = orders.filter((o) => inRange(o, start, end));
  const revenue = list.reduce((a, o) => a + o.total, 0);
  return { start, end, revenue: round(revenue), orders: list.length, aov: list.length ? round(revenue / list.length) : 0 };
}
export function comparePeriods(orders, today, n) {
  const current = periodSummary(orders, addDays(today, -n + 1), today);
  const previous = periodSummary(orders, addDays(today, -2 * n + 1), addDays(today, -n));
  return {
    days: n, current, previous,
    growth: { revenue: growthPct(current.revenue, previous.revenue), orders: growthPct(current.orders, previous.orders), aov: growthPct(current.aov, previous.aov) },
  };
}
export function dailySeries(orders, today, n) {
  const map = new Map(dayRange(today, n).map((d) => [d, { date: d, revenue: 0, orders: 0 }]));
  for (const o of orders) { const row = map.get(o.day); if (row) { row.revenue += o.total; row.orders += 1; } }
  return [...map.values()].map((r) => ({ ...r, revenue: round(r.revenue) }));
}
// Revenue for consecutive 7-day blocks ending today, oldest first.
export function weeklyTotals(orders, today, weeks) {
  return Array.from({ length: weeks }, (_, i) => {
    const end = addDays(today, -7 * (weeks - 1 - i));
    return { start: addDays(end, -6), end, revenue: periodSummary(orders, addDays(end, -6), end).revenue };
  });
}

// ---------- forecast ----------
// Fits a straight line through recent weekly revenue (least squares) and adds up the next 30 days
// along that line. With under 4 weeks of sales it falls back to the recent daily average.
export function forecast30(orders, today, { weeks = 12, firstOrderDay = null, currency = "USD" } = {}) {
  let w = weeks;
  if (firstOrderDay) {
    const span = Math.floor((Date.parse(today) - Date.parse(firstOrderDay)) / DAY_MS) + 1;
    w = Math.max(1, Math.min(weeks, Math.floor(span / 7)));
  }
  const weekly = weeklyTotals(orders, today, w);
  const ys = weekly.map((x) => x.revenue);
  const windowEnd = addDays(today, 30);
  const seasonal = [11, 12].includes(monthOf(addDays(today, 1))) || [11, 12].includes(monthOf(windowEnd));
  const seasonalNote = seasonal
    ? "The next 30 days include November or December. Holiday shopping usually runs well above the normal trend, so treat this as a floor, not a ceiling."
    : null;
  const nonZero = ys.filter((y) => y > 0).length;
  if (nonZero < 4) {
    const last = periodSummary(orders, addDays(today, -29), today).revenue;
    return {
      next30: round(last), low: null, high: null, method: "average",
      explanation: "Not enough weekly history for a trend yet, so this repeats the last 30 days of sales.",
      weeksUsed: w, slopePerWeek: null, weekly, projected: [], seasonalNote,
    };
  }
  const fit = linearFit(ys);
  const n = ys.length;
  const at = (x) => Math.max(0, fit.intercept + fit.slope * x);
  const projected = [0, 1, 2, 3].map((k) => ({ start: addDays(today, 7 * k + 1), end: addDays(today, 7 * k + 7), revenue: round(at(n + k)) }));
  const next30 = projected.reduce((a, p) => a + p.revenue, 0) + (2 / 7) * at(n + 4);
  const spread = fit.residualSd * Math.sqrt(30 / 7);
  return {
    next30: round(next30), low: round(Math.max(0, next30 - spread)), high: round(next30 + spread), method: "linear-weekly",
    explanation: `A straight line fitted through the last ${n} weeks of sales (each week ${fit.slope >= 0 ? "adds" : "loses"} about ${money(Math.abs(fit.slope), currency)} in revenue), continued for 30 days. The range is the typical week-to-week wobble around that line.`,
    weeksUsed: n, slopePerWeek: round(fit.slope), r2: round(fit.r2, 2), weekly, projected, seasonalNote,
  };
}

// ---------- products ----------
export function productTotals(orders, start, end) {
  const map = new Map();
  for (const o of orders) {
    if (!inRange(o, start, end)) continue;
    for (const it of o.items) {
      const row = map.get(it.productId) ?? { id: it.productId, title: it.title, handle: it.handle, qty: 0, revenue: 0 };
      row.qty += it.qty; row.revenue += it.revenue;
      map.set(it.productId, row);
    }
  }
  return map;
}
export function productMomentum(orders, today, n = 30) {
  const cur = productTotals(orders, addDays(today, -n + 1), today);
  const prev = productTotals(orders, addDays(today, -2 * n + 1), addDays(today, -n));
  const ids = new Set([...cur.keys(), ...prev.keys()]);
  const rows = [...ids].map((id) => {
    const c = cur.get(id), p = prev.get(id);
    const base = c ?? p;
    return { id, title: base.title, handle: base.handle, revenue: round(c?.revenue ?? 0), previousRevenue: round(p?.revenue ?? 0),
      qty: c?.qty ?? 0, previousQty: p?.qty ?? 0, change: growthPct(c?.revenue ?? 0, p?.revenue ?? 0) };
  });
  return {
    // Lost at least 40% of its revenue (and at least 2 sales' worth of units) versus the period before.
    losing: rows.filter((r) => r.previousRevenue > 0 && r.revenue <= r.previousRevenue * 0.6 && r.previousQty - r.qty >= 2)
      .sort((a, b) => (a.revenue - a.previousRevenue) - (b.revenue - b.previousRevenue)).slice(0, 5),
    rising: rows.filter((r) => r.revenue > 0 && (r.previousRevenue === 0 ? r.qty >= 2 : r.revenue >= r.previousRevenue * 1.4))
      .sort((a, b) => (b.revenue - b.previousRevenue) - (a.revenue - a.previousRevenue)).slice(0, 5),
  };
}
export function topProducts(orders, start, end, limit = 8) {
  const rows = [...productTotals(orders, start, end).values()];
  const total = rows.reduce((a, r) => a + r.revenue, 0);
  return rows.sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, limit)
    .map((r) => ({ ...r, revenue: round(r.revenue), share: total ? round((r.revenue / total) * 100, 1) : 0 }));
}

// Share of customers who ordered in the window that have ordered more than once (lifetime when
// Shopify gives us customer order counts, otherwise within the window). Guest checkouts are skipped.
export function repeatCustomerRate(orders, start, end) {
  const byCustomer = new Map();
  let lifetime = true;
  for (const o of orders) {
    if (!inRange(o, start, end) || !o.customerId) continue;
    if (o.customerOrders == null) lifetime = false;
    const c = byCustomer.get(o.customerId) ?? { inWindow: 0, lifetime: 0 };
    c.inWindow += 1; c.lifetime = Math.max(c.lifetime, o.customerOrders ?? 0);
    byCustomer.set(o.customerId, c);
  }
  const customers = byCustomer.size;
  if (!customers) return { rate: null, customers: 0, repeat: 0, basis: lifetime ? "lifetime" : "window" };
  const repeat = [...byCustomer.values()].filter((c) => (lifetime ? Math.max(c.lifetime, c.inWindow) : c.inWindow) > 1).length;
  return { rate: round((repeat / customers) * 100, 1), customers, repeat, basis: lifetime ? "lifetime" : "window" };
}

// ---------- sessions (ShopifyQL) ----------
export function shopifyqlRows(tableData) {
  if (!tableData) return [];
  const cols = (tableData.columns ?? []).map((c) => c.name);
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  return rows.map((r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r));
}
export function sessionsSummary(rows, ordersInWindow) {
  const series = rows.map((r) => ({ date: String(r.day ?? r.date ?? "").slice(0, 10), sessions: Number(r.sessions ?? 0), conversionRate: r.conversion_rate == null ? null : Number(r.conversion_rate) }))
    .filter((r) => r.date);
  const total = series.reduce((a, r) => a + r.sessions, 0);
  // conversion_rate comes back as a fraction (0.021) or a percent (2.1) depending on the schema; normalise to %.
  const weighted = series.reduce((a, r) => a + (r.conversionRate ?? 0) * r.sessions, 0);
  let rate = total ? weighted / total : null;
  if (rate != null && rate <= 1 && series.some((r) => (r.conversionRate ?? 0) > 0)) rate *= 100;
  if (rate == null && total) rate = (ordersInWindow / total) * 100;
  return { available: true, total, conversionRate: round(rate, 2), series };
}

// ---------- suggestions ----------
// Below these counts a percentage swing or a revenue share is mostly noise, so no advice is built on it.
const MIN_ORDERS_TO_COMPARE = 5; // in the previous 30 days, before calling sales up or down
const MIN_ORDERS_FOR_SHARE = 10; // in the window, before saying one product carries the store
export function suggestions(r) {
  const out = [];
  const p30 = r.periods["30"];
  const cur = r.currency;
  if (!r.orders.available) {
    out.push("Connect order data: add the read_orders scope to this store's custom app so the console can see sales.");
    return out;
  }
  if (p30.current.orders === 0) {
    out.push("No orders in the last 30 days. Check that products are switched on in Products, then share a few product links on social and with past customers.");
  } else if (p30.previous.orders < MIN_ORDERS_TO_COMPARE) {
    out.push(`${p30.current.orders} ${p30.current.orders === 1 ? "order" : "orders"} in the last 30 days and ${p30.previous.orders} in the 30 before: too few to call a trend yet, so treat the percentages above as rough.`);
  } else if (p30.growth.revenue != null && p30.growth.revenue <= -10) {
    out.push(`Sales are down ${Math.abs(p30.growth.revenue)}% on the 30 days before. Put your best seller on the home page and send past buyers a short "new this month" email.`);
  } else if (p30.growth.revenue != null && p30.growth.revenue >= 10) {
    out.push(`Sales are up ${p30.growth.revenue}% on the 30 days before. Keep the materials for your top sellers in stock so orders ship on time.`);
  }
  const top = r.topProducts[0];
  if (top && top.share >= 30 && r.orders.count >= MIN_ORDERS_FOR_SHARE) out.push(`${top.title} brings in ${top.share}% of revenue. Add a variation or a matching item so one design isn't carrying the store.`);
  for (const l of r.losingMomentum.slice(0, 2))
    out.push(`${l.title} sold ${money(l.previousRevenue, cur)} the month before and ${money(l.revenue, cur)} in the last 30 days. Refresh its photos and title, or pair it with a best seller.`);
  if (r.rising[0]) out.push(`${r.rising[0].title} is picking up (${money(r.rising[0].revenue, cur)} in 30 days). Feature it and make sure it's in the right collections.`);
  if (r.repeatCustomers.rate != null && r.repeatCustomers.customers >= 5 && r.repeatCustomers.rate < 20)
    out.push(`Only ${r.repeatCustomers.rate}% of customers have ordered more than once. A thank-you note with a small code for the next order is the cheapest growth there is.`);
  if (r.sessions.available && r.sessions.total >= 100 && r.sessions.conversionRate != null && r.sessions.conversionRate < 1)
    out.push(`${r.sessions.total.toLocaleString("en-US")} visits but ${r.sessions.conversionRate}% buy. Check product pages on a phone: clear photos, price, personalization box and delivery time up top.`);
  if (r.forecast.seasonalNote)
    out.push(r.store === "c3d"
      ? "Holiday season is next. Switch on ornaments and Christmas gifts, and show the order-by date (Dec 10, or Dec 13 with Priority) on the site."
      : "Holiday season is next. Get gift-ready designs live early and plan one launch email per week through mid December.");
  if (!out.length) out.push("Steady month. Add one new product a week and watch which ones move here.");
  return out.slice(0, 6);
}

// ---------- assemble ----------
export function buildInsights({ store, orderNodes, ordersAvailable = true, ordersTruncated = false, timeZone = "UTC", currency = "USD", now = new Date(), days = 90, sessionRows = null, sessionsNote = null, missingScopes = [], notes = [] }) {
  const today = dayKey(now, timeZone);
  const orders = ordersAvailable ? normalizeOrders(orderNodes ?? [], timeZone) : [];
  const firstOrderDay = orders.reduce((m, o) => (!m || o.day < m ? o.day : m), null);
  const windowStart = addDays(today, -days + 1);
  const periods = Object.fromEntries([7, 30, 90].map((n) => [String(n), comparePeriods(orders, today, n)]));
  const momentum = productMomentum(orders, today, 30);
  const inWindow = orders.filter((o) => inRange(o, windowStart, today)).length;
  const r = {
    store, currency, timeZone, days, today, generatedAt: now.toISOString(),
    orders: { available: ordersAvailable, truncated: ordersTruncated, count: inWindow },
    periods,
    series: dailySeries(orders, today, days),
    forecast: forecast30(orders, today, { firstOrderDay, currency }),
    topProducts: topProducts(orders, windowStart, today),
    losingMomentum: momentum.losing,
    rising: momentum.rising,
    repeatCustomers: repeatCustomerRate(orders, windowStart, today),
    sessions: sessionRows ? sessionsSummary(sessionRows, inWindow) : { available: false, note: sessionsNote },
    missingScopes,
    notes,
  };
  r.suggestions = suggestions(r);
  return r;
}

// ---------- Shopify queries ----------
const ORDER_FIELDS = (withCustomer) => `
  id createdAt cancelledAt test
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  ${withCustomer ? "customer { id numberOfOrders }" : ""}
  lineItems(first: 5) { nodes { title quantity product { id title handle } discountedTotalSet { shopMoney { amount } } } }`;
export const ordersQuery = (withCustomer) => `query ConsoleOrders($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS(withCustomer)} }
  }
}`;
export const SHOP_QUERY = `query ConsoleShop { shop { currencyCode ianaTimezone } }`;
export const SESSIONS_QUERY = `query ConsoleSessions($q: String!) {
  shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType } rows } }
}`;

async function fetchOrders(client, sinceIso, withCustomer, clock) {
  const nodes = [];
  let cursor = null, pages = 0, truncated = false;
  const started = clock();
  do {
    const d = await client.gql(ordersQuery(withCustomer), { cursor, q: `created_at:>=${sinceIso}` });
    nodes.push(...d.orders.nodes);
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    if (cursor && (++pages >= MAX_ORDER_PAGES || clock() - started > ORDER_FETCH_BUDGET_MS)) { truncated = true; cursor = null; }
  } while (cursor);
  return { nodes, truncated };
}

const SCOPE_HELP = {
  read_orders: "sales, best sellers and the forecast",
  read_reports: "online store sessions and conversion rate",
  read_customers: "repeat customer rate (optional; without it repeats are counted within the period only)",
};

// ---------- /api/insights ----------
export async function handleInsights(req, ctx) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    requireKey(req, ctx.env, "Insights");
    const store = parseStore(req.query.get("store"));
    const daysRaw = req.query.get("days") ?? "90";
    if (!/^\d{1,3}$/.test(daysRaw) || Number(daysRaw) < 7 || Number(daysRaw) > 365)
      throw new HttpError(400, "bad_input", "days must be a whole number from 7 to 365.");
    const days = Number(daysRaw);
    const cfg = storeConfig(ctx.env, store);
    const client = adminClient(cfg, ctx.fetch);
    const now = ctx.now ? ctx.now() : new Date();
    const clock = () => (ctx.now ? ctx.now().getTime() : Date.now());

    const shop = (await client.gql(SHOP_QUERY)).shop;
    const missingScopes = [];
    const notes = [];
    const lookback = Math.max(days, 90) * 2; // enough for every "vs previous period" comparison
    const sinceIso = new Date(now.getTime() - lookback * DAY_MS).toISOString().slice(0, 10);
    if (lookback > 60) notes.push(`Shopify only shares the last 60 days of orders unless the app also has read_all_orders, so comparisons that reach further back may show as zero.`);

    const ordersP = (async () => {
      try { return { ...(await fetchOrders(client, sinceIso, true, clock)), available: true }; }
      catch (e) {
        if (e.code !== "access_denied") throw e;
        const customerOnly = e.scopes?.includes("read_customers") && !e.scopes.includes("read_orders");
        if (!customerOnly) {
          missingScopes.push({ scope: "read_orders", for: SCOPE_HELP.read_orders });
          return { nodes: [], truncated: false, available: false };
        }
        // Customer fields are denied: try again without them.
        try {
          const r = await fetchOrders(client, sinceIso, false, clock);
          missingScopes.push({ scope: "read_customers", for: SCOPE_HELP.read_customers });
          return { ...r, available: true };
        } catch (e2) {
          if (e2.code !== "access_denied") throw e2;
          missingScopes.push({ scope: "read_orders", for: SCOPE_HELP.read_orders });
          return { nodes: [], truncated: false, available: false };
        }
      }
    })();
    const sessionsP = (async () => {
      try {
        const d = await client.gql(SESSIONS_QUERY, { q: `FROM sessions SHOW sessions, conversion_rate TIMESERIES day SINCE -${days}d UNTIL today ORDER BY day ASC` });
        const res = d?.shopifyqlQuery;
        if (!res || res.parseErrors?.length) return { rows: null, note: "Shopify couldn't run the sessions report for this store." };
        return { rows: shopifyqlRows(res.tableData), note: null };
      } catch (e) {
        if (e.code === "access_denied" || e.code === "shopify_error") {
          if (e.code === "access_denied") missingScopes.push({ scope: "read_reports", for: SCOPE_HELP.read_reports });
          return { rows: null, note: e.code === "access_denied" ? "Add the read_reports scope to see sessions and conversion." : "Sessions aren't available for this store's plan or API version." };
        }
        throw e;
      }
    })();
    const [orders, sessions] = await Promise.all([ordersP, sessionsP]);
    if (orders.truncated) notes.push("This store has more orders than the console reads in one go; totals cover the most recent ones it could load.");

    return ok(buildInsights({
      store, orderNodes: orders.nodes, ordersAvailable: orders.available, ordersTruncated: orders.truncated,
      timeZone: shop?.ianaTimezone || "UTC", currency: shop?.currencyCode || "USD", now, days,
      sessionRows: sessions.rows, sessionsNote: sessions.note, missingScopes, notes,
    }));
  } catch (e) {
    return fail(e);
  }
}
