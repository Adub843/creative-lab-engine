// Taxi, the Creative Lab tax agent: works out what every sale owes, what to move into the tax accounts each
// week, what SC sales tax is due each month and what the year's income tax will be, for Elevated Designs LLC
// (a single-member LLC in Charleston County, SC; Charleston 3D is a DBA of the same LLC, so both stores land
// on ONE Schedule C). Each store's numbers stay in their own column; only the tax totals are combined.
//
// Taxi is guidance built from IRS and SCDOR rules, not a licensed CPA. Every rule she uses is in TAX_RULES
// below with its source, and every guess she makes is in ASSUMPTIONS, shown on the page.
//
//   GET    /api/taxes                       the whole Taxi page: weeks, months, year, deadlines, records, log
//   POST   /api/taxes { action: "run" }     run the roundup now (the 15-minute cron runs it daily at 10:00 UTC)
//   POST   /api/taxes { action: "settings", ... }   job pay, material costs, fee rate
//   POST   /api/taxes { action: "record", kind, date, amount, ... }   a receipt, screenshot or tax payment
//   DELETE /api/taxes { id }                remove a record (and its file)
//   POST   /api/taxes/file/<id>             attach a photo or PDF to a record (raw body)
//   GET    /api/taxes/file/<id>             the attached file
// All of it needs the console key. Data lives in the MARKETING KV under "tax:*"; files in IMAGES under "tax-file:".
import { HttpError, adminClient, fail, ok, readJsonBody, requireKey, storeConfig, STORES } from "./shopify.mjs";
import { dayKey, addDays } from "./insights.mjs";

// ---------- the rules (tax year 2026) ----------
export const TAX_RULES = {
  year: 2026,
  federal: {
    standardDeduction: 16100, // single, 2026 (IRS Rev. Proc. 2025-32, after the 2025 tax law)
    brackets: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
    qbiRate: 0.20, // qualified business income deduction, made permanent in 2025
  },
  se: { base: 0.9235, ss: 0.124, medicare: 0.029, wageBase: 184500, addlMedicare: 0.009, addlThreshold: 200000 },
  sc: {
    // H.4216 (2026): taxable income starts from federal AGI, minus the SC income-adjusted deduction (SCIAD).
    low: 0.0199, top: 0.0521, topMinus: 966, lowLimit: 30000,
    sciad: { full: 15000, phaseStart: 40000, phaseEnd: 95000 },
  },
  salesTax: { state: 0.06, charleston: 0.09, dueDay: 20 },
  shopifyFee: { rate: 0.029, flat: 0.30 }, // Shopify Basic online card rate, used when Shopify doesn't report the real fee
};

export const SOURCES = [
  { label: "IRS: 2026 tax brackets and standard deduction", url: "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill" },
  { label: "IRS: Self-employment tax (Schedule SE)", url: "https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes" },
  { label: "IRS: Estimated taxes (Form 1040-ES)", url: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes" },
  { label: "IRS: Qualified business income deduction", url: "https://www.irs.gov/newsroom/qualified-business-income-deduction" },
  { label: "SSA: 2026 Social Security wage base ($184,500)", url: "https://www.ssa.gov/oact/cola/cbb.html" },
  { label: "SCDOR: Sales tax (rates, due dates, Retail License)", url: "https://dor.sc.gov/sales-use-tax-index/sales-tax" },
  { label: "SCDOR: ST-3 return instructions", url: "https://dor.sc.gov/forms-site/Forms/ST3I.pdf" },
  { label: "SCDOR: Information Letter 26-20 (2026 income tax reform, H.4216)", url: "https://dor.sc.gov/policy" },
  { label: "SCDOR: Individual estimated tax (SC1040ES)", url: "https://dor.sc.gov/tax/individual-income" },
  { label: "Shopify: 1099-K forms", url: "https://help.shopify.com/en/manual/payments/shopify-payments/1099-k" },
];

export const LINKS = {
  mydorway: "https://mydorway.dor.sc.gov",
  irsPay: "https://www.irs.gov/payments/direct-pay",
  irsAccount: "https://www.irs.gov/payments/your-online-account",
  eftps: "https://www.eftps.gov",
  scPay: "https://mydorway.dor.sc.gov",
  shopifyTaxC3D: "https://charleston3d.com/admin/settings/taxes",
  shopifyTaxED: "https://elevatedshirts.com/admin/settings/taxes",
  shopifyPayouts: "https://elevatedshirts.com/admin/payments/payouts",
  shopifyPayoutsC3D: "https://charleston3d.com/admin/payments/payouts",
  countyLicense: "https://revenuecollectionsportal.charlestoncounty.gov",
};

export const ASSUMPTIONS = [
  "You file single. Married filing jointly changes the brackets; tell Taxi and she'll switch.",
  "Your job's W-2 withholding covers the tax on your job pay. Taxi only reserves the extra tax the business adds on top.",
  "Elevated Designs LLC has never elected S corp, so all business profit lands on Schedule C and Schedule SE of your personal return.",
  "Both stores count as one business (one Schedule C), because Charleston 3D is a DBA of the LLC.",
  "Material costs are an estimate per store until real costs are on the products in Shopify or you switch to counting material receipts.",
  "Shipping you charge the customer is assumed to equal what the label cost you.",
  "When Shopify doesn't report the real card fee, Taxi uses 2.9% + 30¢ (Shopify Basic online rate).",
  "SC sales tax: Shopify collects it at checkout and you file it monthly on MyDORWAY by the 20th (SCDOR's default schedule).",
  "SC taxes shipping charged on a taxable sale; check that \"Charge tax on shipping rates\" is on in both stores.",
  "The first Saturday-to-Monday in August is SC's sales tax holiday for clothing; Shopify may not skip it on its own.",
  "Free $0 custom requests and test orders are not sales and are left out.",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (n) => Math.ceil((Number(n) || 0) - 1e-9);

// ---------- federal, SE and SC tax for one year ----------
export function bracketTax(taxable, brackets) {
  let tax = 0, prev = 0;
  for (const [top, rate] of brackets) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, top) - prev) * rate;
    prev = top;
  }
  return tax;
}
export function sciad(agi, r = TAX_RULES.sc.sciad) {
  if (agi <= r.phaseStart) return r.full;
  if (agi >= r.phaseEnd) return 0;
  const cut = Math.floor((r.full * (agi - r.phaseStart) / (r.phaseEnd - r.phaseStart)) / 10) * 10;
  return Math.max(0, r.full - cut);
}
export function scTax(taxable, r = TAX_RULES.sc) {
  if (taxable <= 0) return 0;
  return taxable < r.lowLimit ? taxable * r.low : taxable * r.top - r.topMinus;
}
// wages: W-2 job pay (box 1). profit: Schedule C net profit (can be negative).
export function yearTax({ wages = 0, profit = 0, rules = TAX_RULES } = {}) {
  const p = Number(profit) || 0, w = Math.max(0, Number(wages) || 0);
  const seBase = p > 0 ? p * rules.se.base : 0;
  // SE tax only applies once net earnings reach $400.
  const ssPart = seBase >= 400 ? Math.min(seBase, Math.max(0, rules.se.wageBase - w)) * rules.se.ss : 0;
  const medPart = seBase >= 400 ? seBase * rules.se.medicare : 0;
  const addl = seBase >= 400 ? Math.max(0, Math.min(seBase, w + seBase - rules.se.addlThreshold)) * rules.se.addlMedicare : 0;
  const se = ssPart + medPart + addl;
  const halfSe = (ssPart + medPart) / 2;
  const agi = w + p - halfSe;
  const beforeQbi = Math.max(0, agi - rules.federal.standardDeduction);
  const qbi = Math.min(Math.max(0, p - halfSe) * rules.federal.qbiRate, beforeQbi * rules.federal.qbiRate);
  const fedTaxable = Math.max(0, beforeQbi - qbi);
  const federal = bracketTax(fedTaxable, rules.federal.brackets);
  const scTaxable = Math.max(0, agi - sciad(agi, rules.sc.sciad));
  const sc = scTax(scTaxable, rules.sc);
  return { wages: w, profit: round2(p), agi: round2(agi), se: round2(se), halfSe: round2(halfSe), qbi: round2(qbi), fedTaxable: round2(fedTaxable),
    federal: round2(federal), scTaxable: round2(scTaxable), sc: round2(sc), total: round2(se + federal + sc) };
}
// The tax the business adds on top of the job, and the share of each profit dollar to put away.
export function businessTax({ wages = 0, profit = 0, rules = TAX_RULES } = {}) {
  const withBiz = yearTax({ wages, profit, rules }), jobOnly = yearTax({ wages, profit: 0, rules });
  const extra = {
    se: round2(withBiz.se - jobOnly.se), federal: round2(withBiz.federal - jobOnly.federal), sc: round2(withBiz.sc - jobOnly.sc),
  };
  extra.total = round2(extra.se + extra.federal + extra.sc);
  // The rate for the next dollars of profit (what each new sale should reserve), over a $1,000 step from at
  // least $2,000 of profit, so a tiny first-year profit doesn't jump over the $400 SE threshold in one step.
  const step = 1000, base = Math.max(2000, profit);
  const next = yearTax({ wages, profit: base + step, rules }), here = yearTax({ wages, profit: base, rules });
  const marginal = (next.total - here.total) / step;
  return { withBiz, jobOnly, extra, marginalRate: Math.round(marginal * 1000) / 1000, averageRate: profit > 0 ? Math.round((extra.total / profit) * 1000) / 1000 : 0 };
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  wages: 72000, // W-2 job pay before tax; a guess from the budget app's take-home pay until Aaron enters his real number
  wagesConfirmed: false,
  costPct: { c3d: 20, ed: 45 }, // material cost as % of product sales when Shopify has no unit cost
  costMode: "estimate", // "estimate" uses costPct on each sale; "receipts" uses material receipts instead
  feeRate: 2.9, feeFlat: 0.30,
  reserveRate: null, // a fixed % of profit to reserve instead of Taxi's calculated rate (null = calculated)
  salesTaxSchedule: "monthly",
  confirmed: {}, // assumption key -> the day Aaron confirmed it (see CONFIRMABLE)
};
// Assumptions Aaron can confirm, by their place in ASSUMPTIONS. Confirmed ones say so on the page.
export const CONFIRMABLE = { filing: 0, sCorp: 2, materials: 4 };
export function assumptionsFor(settings) {
  const c = settings?.confirmed ?? {};
  return ASSUMPTIONS.map((a, i) => {
    const key = Object.keys(CONFIRMABLE).find((k) => CONFIRMABLE[k] === i);
    if (!key || !c[key]) return a;
    const text = key === "materials" ? `Materials are about ${settings.costPct?.c3d ?? 20}% of Charleston 3D sales and ${settings.costPct?.ed ?? 45}% of Elevated Designs sales, until real costs are on the products in Shopify or you switch to counting material receipts.` : a;
    return `Confirmed by you on ${c[key]}: ${text}`;
  });
}
const num = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, "bad_input", `${name} must be a number from ${min} to ${max}.`);
  return n;
};
export function cleanSettings(body, current = DEFAULT_SETTINGS) {
  const s = structuredClone({ ...DEFAULT_SETTINGS, ...current, costPct: { ...DEFAULT_SETTINGS.costPct, ...(current.costPct ?? {}) } });
  if (body.wages != null) { s.wages = num(body.wages, "Job pay", 0, 2000000); s.wagesConfirmed = true; }
  if (body.costPct && typeof body.costPct === "object") for (const k of Object.keys(STORES)) if (body.costPct[k] != null) s.costPct[k] = num(body.costPct[k], `${STORES[k].name} material cost`, 0, 95);
  if (body.costMode != null) { if (!["estimate", "receipts"].includes(body.costMode)) throw new HttpError(400, "bad_input", "costMode must be estimate or receipts."); s.costMode = body.costMode; }
  if (body.feeRate != null) s.feeRate = num(body.feeRate, "Card fee %", 0, 10);
  if (body.feeFlat != null) s.feeFlat = num(body.feeFlat, "Card fee per order", 0, 5);
  if (Object.hasOwn(body, "reserveRate")) s.reserveRate = body.reserveRate === null || body.reserveRate === "" ? null : num(body.reserveRate, "Reserve %", 0, 80);
  if (Array.isArray(body.confirm)) {
    s.confirmed = { ...(s.confirmed ?? {}) };
    const day = new Date().toISOString().slice(0, 10);
    for (const k of body.confirm) { if (!Object.hasOwn(CONFIRMABLE, k)) throw new HttpError(400, "bad_input", `confirm takes ${Object.keys(CONFIRMABLE).join(", ")}.`); s.confirmed[k] = day; }
  }
  if (body.salesTaxSchedule != null) { if (!["monthly", "quarterly", "annual"].includes(body.salesTaxSchedule)) throw new HttpError(400, "bad_input", "salesTaxSchedule must be monthly, quarterly or annual."); s.salesTaxSchedule = body.salesTaxSchedule; }
  return s;
}

// ---------- orders ----------
const money = (set) => Number(set?.shopMoney?.amount ?? 0) || 0;
// One Shopify order in the few numbers Taxi needs. Nothing about the customer is kept.
export function compactOrder(o, store, timeZone) {
  const total = money(o.currentTotalPriceSet);
  const tax = money(o.currentTotalTaxSet);
  const shipping = money(o.currentShippingPriceSet);
  const merch = money(o.currentSubtotalPriceSet); // after discounts, before shipping and tax
  let fees = null;
  if (Array.isArray(o.transactions)) {
    const f = o.transactions.filter((t) => t.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(t.kind))
      .flatMap((t) => t.fees ?? []).reduce((a, x) => a + money(x.amount ? { shopMoney: x.amount } : null), 0);
    if (o.transactions.some((t) => Array.isArray(t.fees) && t.fees.length)) fees = round2(f);
  }
  let cost = 0, costKnown = true, units = 0;
  for (const li of o.lineItems?.nodes ?? []) {
    const qty = Number(li.currentQuantity ?? li.quantity ?? 0);
    units += qty;
    const unit = li.variant?.inventoryItem?.unitCost?.amount;
    if (unit == null || unit === "") costKnown = false; else cost += Number(unit) * qty;
  }
  const province = o.shippingAddress?.provinceCode ?? null;
  return {
    id: o.id, name: o.name ?? "", store, day: dayKey(new Date(o.createdAt), timeZone),
    total: round2(total), tax: round2(tax), shipping: round2(shipping), merch: round2(merch), refunded: round2(money(o.totalRefundedSet)),
    fees, cost: costKnown && units ? round2(cost) : null, units,
    sc: province == null ? null : province === "SC",
  };
}
// Keeps paid sales only: no cancelled, test or $0 orders (Charleston 3D's free custom requests).
export const isSale = (o) => !o.cancelledAt && !o.test && money(o.currentTotalPriceSet) > 0;

// How one sale splits: what goes to the sales tax account, the income tax account, costs, and you.
export function splitSale(o, settings, rate) {
  const fees = o.fees != null ? o.fees : o.total > 0 ? round2(o.total * (settings.feeRate / 100) + settings.feeFlat) : 0;
  const costEstimated = o.cost == null;
  const cost = settings.costMode === "receipts" ? 0 : o.cost != null ? o.cost : round2(o.merch * ((settings.costPct?.[o.store] ?? 0) / 100));
  const shippingCost = o.shipping; // assumed pass-through
  const profit = round2(o.merch + o.shipping - fees - cost - shippingCost);
  const reserve = round2(Math.max(0, profit) * rate);
  const yours = round2(o.total - o.tax - fees - cost - shippingCost - reserve);
  return { ...o, fees, feesEstimated: o.fees == null, cost, costEstimated: settings.costMode !== "receipts" && costEstimated, shippingCost, profit, salesTax: o.tax, reserve, toTaxAccounts: round2(o.tax + reserve), yours };
}

// ---------- weeks, months, deadlines ----------
// Taxi's week runs Friday to Thursday, so the Friday-morning report closes the week that just ended.
export function weekStartOf(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sun .. 5 Fri
  return addDays(day, -((dow + 2) % 7));
}
export const weekEndOf = (start) => addDays(start, 6);
const monthKey = (day) => day.slice(0, 7);
const nextMonth = (mk) => { const [y, m] = mk.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export const salesTaxDue = (mk) => `${nextMonth(mk)}-${String(TAX_RULES.salesTax.dueDay).padStart(2, "0")}`;

// Estimated tax due dates for the tax year (federal 1040-ES and SC1040ES share them); a weekend date moves to Monday.
const nextBusinessDay = (day) => { const d = new Date(`${day}T00:00:00Z`).getUTCDay(); return d === 6 ? addDays(day, 2) : d === 0 ? addDays(day, 1) : day; };
export function estimatedDueDates(year) {
  return [
    { q: 1, covers: `Jan 1 to Mar 31, ${year}`, due: nextBusinessDay(`${year}-04-15`) },
    { q: 2, covers: `Apr 1 to May 31, ${year}`, due: nextBusinessDay(`${year}-06-15`) },
    { q: 3, covers: `Jun 1 to Aug 31, ${year}`, due: nextBusinessDay(`${year}-09-15`) },
    { q: 4, covers: `Sep 1 to Dec 31, ${year}`, due: nextBusinessDay(`${year + 1}-01-15`) },
  ];
}
export function deadlines(today, months = 4) {
  const year = Number(today.slice(0, 4));
  const out = [];
  // Sales tax: each month's return on the 20th of the next month.
  let mk = monthKey(addDays(today, -40));
  for (let i = 0; i < months + 2; i++) { out.push({ date: nextBusinessDay(salesTaxDue(mk)), what: `SC sales tax return (ST-3) for ${monthName(mk)}`, kind: "salesTax", period: mk, link: LINKS.mydorway }); mk = nextMonth(mk); }
  for (const y of [year - 1, year]) for (const e of estimatedDueDates(y))
    out.push({ date: e.due, what: `Estimated tax Q${e.q} ${y} (IRS 1040-ES and SC1040ES), covers ${e.covers}`, kind: "estimated", period: `${y}-Q${e.q}`, link: LINKS.irsPay });
  for (const y of [year, year + 1]) {
    out.push({ date: `${y}-01-31`, what: `Shopify sends a 1099-K for ${y - 1} if a store passed $20,000 and 200 payments`, kind: "info", link: "https://help.shopify.com/en/manual/payments/shopify-payments/1099-k" });
    out.push({ date: nextBusinessDay(`${y}-04-15`), what: `${y - 1} tax return: Form 1040 with Schedule C and SE, plus SC1040`, kind: "annual", link: LINKS.irsAccount });
    out.push({ date: `${y}-04-30`, what: `Charleston County business license renewal (fee is based on ${y - 1} gross sales) and SC PT-100 if the LLC owns equipment`, kind: "license", link: LINKS.countyLicense });
  }
  const end = addDays(today, 31 * months);
  return out.filter((d) => d.date >= addDays(today, -31) && d.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}
export const monthName = (mk) => new Date(`${mk}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// ---------- the summary the page and the reports read ----------
const sum = (list, k) => round2(list.reduce((a, x) => a + (Number(x[k]) || 0), 0));
const EXPENSE_KINDS = new Set(["expense"]);
const MATERIAL = "Materials (blanks, filament, ink)";
export const EXPENSE_CATEGORIES = [MATERIAL, "Shipping supplies and labels", "Software and subscriptions", "Equipment (printers, press, computer)", "Marketing and ads", "Fees and licenses", "Mileage and travel", "Other business expense"];
export const RECORD_KINDS = ["expense", "screenshot", "payment", "transfer", "document"];
export const PAYMENT_TYPES = ["salesTax", "federal", "sc"];

export function buildSummary({ orders = [], records = [], settings = DEFAULT_SETTINGS, today, state = {}, reports = [] }) {
  const year = Number(today.slice(0, 4));
  const yearOrders = orders.filter((o) => o.day.startsWith(String(year)));
  // Profit so far this year (before tax), to size the reserve rate.
  const pre = yearOrders.map((o) => splitSale(o, settings, 0));
  const expenses = records.filter((r) => EXPENSE_KINDS.has(r.kind) && r.date?.startsWith(String(year)));
  const countedExpenses = expenses.filter((r) => settings.costMode === "receipts" || r.category !== MATERIAL);
  const ytdProfit = round2(sum(pre, "profit") - sum(countedExpenses, "amount"));
  // Projected full-year profit: so far, plus the last 30 days' pace for the rest of the year.
  const first = yearOrders.reduce((m, o) => (!m || o.day < m ? o.day : m), null);
  const recentStart = addDays(today, -29);
  const paceDays = first ? Math.max(1, Math.min(30, Math.round((Date.parse(today) - Date.parse(first > recentStart ? first : recentStart)) / 86400000) + 1)) : 30;
  const recentProfit = sum(pre.filter((o) => o.day >= recentStart), "profit");
  const daysLeft = Math.max(0, Math.round((Date.parse(`${year}-12-31`) - Date.parse(today)) / 86400000));
  const projectedProfit = round2(ytdProfit + (recentProfit / paceDays) * daysLeft);
  const biz = businessTax({ wages: settings.wages, profit: Math.max(ytdProfit, projectedProfit) });
  const calcRate = biz.marginalRate;
  const rate = settings.reserveRate != null ? settings.reserveRate / 100 : up(calcRate * 100) / 100; // rounded UP to a whole percent

  const sales = orders.map((o) => splitSale(o, settings, rate)).sort((a, b) => b.day.localeCompare(a.day) || b.name.localeCompare(a.name));
  const ytd = sales.filter((o) => o.day.startsWith(String(year)));
  const byStore = (list) => Object.fromEntries(Object.keys(STORES).map((k) => [k, totals(list.filter((o) => o.store === k))]));
  function totals(list) {
    return { orders: list.length, sales: sum(list, "total"), salesTax: sum(list, "salesTax"), fees: sum(list, "fees"), cost: sum(list, "cost"),
      profit: sum(list, "profit"), reserve: sum(list, "reserve"), toTaxAccounts: sum(list, "toTaxAccounts"), yours: sum(list, "yours") };
  }
  // Weeks (Friday to Thursday), newest first, back to the first sale or 8 weeks.
  const thisWeek = weekStartOf(today);
  const transfers = records.filter((r) => r.kind === "transfer");
  const weeks = [];
  for (let i = 0; i < 12; i++) {
    const start = addDays(thisWeek, -7 * i), end = weekEndOf(start);
    const list = sales.filter((o) => o.day >= start && o.day <= end);
    // Back to the week of the first sale (at least 4 weeks shown), at most 12.
    if (i >= 4 && (!first || end < first)) break;
    const moved = round2(transfers.filter((t) => t.week === start).reduce((a, t) => a + t.amount, 0));
    weeks.push({ start, end, current: i === 0, ...totals(list), byStore: byStore(list), moved, left: round2(Math.max(0, totals(list).toTaxAccounts - moved)) });
  }
  // Sales tax by month, with what's been filed and paid.
  const payments = records.filter((r) => r.kind === "payment");
  const monthsSeen = [...new Set(sales.map((o) => monthKey(o.day)))].sort().reverse().slice(0, 12);
  if (!monthsSeen.includes(monthKey(today))) monthsSeen.unshift(monthKey(today));
  const months = monthsSeen.map((mk) => {
    const list = sales.filter((o) => monthKey(o.day) === mk);
    const paid = round2(payments.filter((p) => p.type === "salesTax" && p.period === mk).reduce((a, p) => a + p.amount, 0));
    const collected = sum(list, "salesTax");
    const due = nextBusinessDay(salesTaxDue(mk));
    const status = paid > 0 && paid + 0.5 >= collected ? "paid" : mk === monthKey(today) ? "collecting" : today > due ? "late" : "due";
    return { month: mk, name: monthName(mk), orders: list.length, sales: sum(list, "total"), taxable: sum(list.filter((o) => o.salesTax > 0), "merch"),
      collected, byStore: Object.fromEntries(Object.keys(STORES).map((k) => [k, sum(list.filter((o) => o.store === k), "salesTax")])),
      zeroTaxSC: list.filter((o) => o.sc === true && o.salesTax === 0).map((o) => o.name), due, paid, status };
  });
  // The year: tax owed on the business so far and projected, and what's been paid.
  const owedSoFar = businessTax({ wages: settings.wages, profit: Math.max(0, ytdProfit) }).extra;
  const paidFed = round2(payments.filter((p) => p.type === "federal" && p.period?.startsWith(String(year))).reduce((a, p) => a + p.amount, 0));
  const paidSc = round2(payments.filter((p) => p.type === "sc" && p.period?.startsWith(String(year))).reduce((a, p) => a + p.amount, 0));
  const reservedYtd = sum(ytd, "reserve");
  const yearView = {
    year, ...totals(ytd), byStore: byStore(ytd), expenses: sum(expenses, "amount"), countedExpenses: sum(countedExpenses, "amount"),
    ytdProfit, projectedProfit, owedSoFar, projected: biz.extra, paid: { federal: paidFed, sc: paidSc, total: round2(paidFed + paidSc) },
    stillOwed: round2(Math.max(0, owedSoFar.total - paidFed - paidSc)), reservedYtd,
  };
  // Every $100 of product sales, split the way Taxi splits a sale (Charleston rate shown for sales tax).
  const per100 = Object.fromEntries(Object.keys(STORES).map((k) => {
    const s = splitSale({ id: "x", name: "", store: k, day: today, total: 100 * (1 + TAX_RULES.salesTax.charleston), tax: 100 * TAX_RULES.salesTax.charleston, shipping: 0, merch: 100, refunded: 0, fees: null, cost: null, units: 1, sc: true }, settings, rate);
    return [k, { customerPays: round2(s.total), salesTax: s.salesTax, fees: s.fees, cost: s.cost, reserve: s.reserve, yours: s.yours }];
  }));
  return {
    today, settings, rules: TAX_RULES, rate, calcRate, rateExplained: rateExplain(biz, settings, rate), per100,
    week: weeks[0], lastWeek: weeks[1] ?? null, weeks, months, year: yearView,
    recent: sales.slice(0, 60), deadlines: deadlines(today), state, reports: reports.slice(0, 30),
    records: records.slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.at ?? "").localeCompare(a.at ?? "")),
    expenseCategories: EXPENSE_CATEGORIES, assumptions: assumptionsFor(settings), sources: SOURCES, links: LINKS,
  };
}
function rateExplain(biz, settings, rate) {
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  if (settings.reserveRate != null) return `You set a fixed ${settings.reserveRate}% of profit. Taxi's own math says ${pct(biz.marginalRate)}.`;
  return `With about $${Math.round(settings.wages).toLocaleString("en-US")} of job pay${settings.wagesConfirmed ? "" : " (a guess until you enter yours)"}, each extra $1 of profit adds about ${pct(biz.marginalRate)} in tax: self-employment tax (15.3% on 92.35% of profit), federal income tax at your bracket after the 20% QBI deduction, and SC income tax at 5.21% (plus the SC deduction shrinking as income rises). Taxi rounds up to ${Math.round(rate * 100)}%.`;
}

// ---------- the daily roundup ----------
const ORDER_FIELDS = (full) => `
  id name createdAt cancelledAt test
  currentTotalPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  currentShippingPriceSet { shopMoney { amount } }
  currentSubtotalPriceSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 50) { nodes { quantity currentQuantity ${full ? "variant { inventoryItem { unitCost { amount } } }" : ""} } }
  ${full ? "shippingAddress { provinceCode }\n  transactions(first: 10) { kind status fees { amount { amount } } }" : ""}`;
export const taxOrdersQuery = (full) => `query TaxiOrders($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS(full)} }
  }
}`;
export const TAX_SHOP_QUERY = `query TaxiShop { shop { ianaTimezone currencyCode } }`;
const MAX_PAGES = 40;

async function pullStore(store, ctx, sinceDay) {
  const cfg = storeConfig(ctx.env, store);
  const client = adminClient(cfg, ctx.fetch);
  const shop = (await client.gql(TAX_SHOP_QUERY)).shop ?? {};
  const tz = shop.ianaTimezone || "America/New_York";
  const notes = [];
  const fetchAll = async (full) => {
    const nodes = [];
    let cursor = null, pages = 0;
    do {
      const d = await client.gql(taxOrdersQuery(full), { cursor, q: `created_at:>=${sinceDay}` });
      nodes.push(...d.orders.nodes);
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
      if (cursor && ++pages >= MAX_PAGES) { notes.push("More orders than one roundup reads; the oldest may be missing."); cursor = null; }
    } while (cursor);
    return nodes;
  };
  let nodes, full = true;
  try { nodes = await fetchAll(true); }
  catch (e) {
    if (e.code !== "access_denied" && e.code !== "shopify_error") throw e;
    // Card fees, product costs or the ship-to state need extra access; read the basics instead.
    full = false;
    nodes = await fetchAll(false);
    notes.push("Shopify didn't share card fees, product costs or ship-to state with the console app, so Taxi estimated fees and costs. Adding read_shopify_payments_payouts, read_inventory and read_orders to the app's scopes gives exact numbers.");
  }
  return { orders: nodes.filter(isSale).map((o) => compactOrder(o, store, tz)), tz, full, notes };
}

const K = { settings: "tax:settings", ledger: (y) => `tax:ledger:${y}`, records: "tax:records", reports: "tax:reports", state: "tax:state", weekly: "tax:weekly" };
const getJson = async (kv, key, d) => { try { return (await kv.get(key, { type: "json" })) ?? d; } catch { return d; } };
export async function readSettings(kv) { return cleanSettings({}, await getJson(kv, K.settings, DEFAULT_SETTINGS)); }
async function readLedger(kv, year) { const v = await getJson(kv, K.ledger(year), null); return v?.orders && typeof v.orders === "object" ? v.orders : {}; }
async function readRecords(kv) { const v = await getJson(kv, K.records, null); return Array.isArray(v?.records) ? v.records : []; }
async function readReports(kv) { const v = await getJson(kv, K.reports, null); return Array.isArray(v?.reports) ? v.reports : []; }

// Pulls both stores, updates the year's ledger, writes Taxi's report to herself, and on Fridays the week's
// summary for Aaron. Both reach Stacy through the daily digest (taxiBrief below, lib/digest.mjs) and show on
// the Taxi page in Creative Lab Studios (Money > Taxi).
export async function runTaxi(ctx, { now = new Date(), reason = "daily" } = {}) {
  const kv = ctx.kv;
  const settings = await readSettings(kv);
  const nowIso = now.toISOString();
  const today = dayKey(now, "America/New_York");
  const year = Number(today.slice(0, 4));
  const prevState = await getJson(kv, K.state, {});
  // First run: the whole year. After that, the last 45 days again, so refunds and edits are picked up.
  const since = prevState.lastRun ? addDays(today, -45) : `${year}-01-01`;
  const ledger = await readLedger(kv, year);
  const storeStatus = {};
  const notes = [];
  for (const store of Object.keys(STORES)) {
    try {
      const r = await pullStore(store, ctx, since < `${year}-01-01` ? `${year}-01-01` : since);
      // Orders inside the window that are no longer sales (cancelled, refunded to $0) leave the ledger.
      for (const [id, o] of Object.entries(ledger)) if (o.store === store && o.day >= since) delete ledger[id];
      for (const o of r.orders) if (o.day.startsWith(String(year))) ledger[o.id] = o;
      storeStatus[store] = { ok: true, orders: r.orders.length, exact: r.full };
      notes.push(...r.notes.map((n) => `${STORES[store].name}: ${n}`));
    } catch (e) {
      storeStatus[store] = { ok: false, error: e.message ?? "Couldn't read the store." };
    }
  }
  await kv.put(K.ledger(year), JSON.stringify({ orders: ledger, updatedAt: nowIso }));
  // Early January: last year's ledger still counts for its own Q4 and sales tax.
  const lastYear = today.slice(5) < "02-01" ? Object.values(await readLedger(kv, year - 1)) : [];
  const records = await readRecords(kv);
  const reports = await readReports(kv);
  const s = buildSummary({ orders: [...Object.values(ledger), ...lastYear], records, settings, today });
  const state = { lastRun: nowIso, reason, stores: storeStatus, notes: [...new Set(notes)].slice(0, 6) };
  await kv.put(K.state, JSON.stringify(state));

  // Taxi's report to herself: what she did, and the next action.
  const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const yest = addDays(today, -1);
  const yList = s.recent.filter((o) => o.day === yest);
  const failed = Object.entries(storeStatus).filter(([, v]) => !v.ok).map(([k]) => STORES[k].name);
  const did = `Pulled ${Object.values(storeStatus).filter((v) => v.ok).map((v) => v.orders).reduce((a, b) => a + b, 0)} paid orders from ${Object.values(storeStatus).filter((v) => v.ok).length} of 2 stores. Yesterday: ${yList.length} sale${yList.length === 1 ? "" : "s"}, ${fmt(yList.reduce((a, o) => a + o.salesTax, 0))} sales tax, ${fmt(yList.reduce((a, o) => a + o.reserve, 0))} income tax reserve. This week so far: ${fmt(s.week.toTaxAccounts)} to the tax accounts.`;
  const next = nextActions(s, today);
  const report = { at: nowIso, day: today, reason, status: failed.length ? (failed.length === 2 ? "failed" : "partial") : "ok", did, next, failed };
  const kept = [report, ...reports.filter((r) => r.day !== today || r.reason !== reason)].slice(0, 90);
  await kv.put(K.reports, JSON.stringify({ reports: kept }));

  const isFriday = new Date(`${today}T12:00:00Z`).getUTCDay() === 5;
  let weekly = null;
  if (reason === "daily" && isFriday && s.lastWeek) {
    const w = s.lastWeek;
    weekly = { at: nowIso, week: w.start, end: w.end, orders: w.orders, sales: w.sales, salesTax: w.salesTax, reserve: w.reserve, total: w.toTaxAccounts, byStore: w.byStore, rate: s.rate, next };
    const list = await getJson(kv, K.weekly, { weeks: [] });
    await kv.put(K.weekly, JSON.stringify({ weeks: [weekly, ...(list.weeks ?? []).filter((x) => x.week !== w.start)].slice(0, 60) }));
  }
  return { report, weekly, summary: s };
}
const w2 = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The next things to do, most urgent first, in plain words.
export function nextActions(s, today) {
  const out = [];
  const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  for (const m of s.months) {
    if (m.status === "late") out.push(`Sales tax for ${m.name} was due ${w2(m.due)}: file and pay ${fmt(m.collected)} on MyDORWAY now, even if it's $0, to stop penalties.`);
    else if (m.status === "due" && m.due >= today) out.push(`File SC sales tax for ${m.name} by ${w2(m.due)}: ${fmt(m.collected)} collected${m.collected ? "" : " (file a $0 return anyway)"}.`);
    if (m.zeroTaxSC.length) out.push(`${m.zeroTaxSC.length} SC order${m.zeroTaxSC.length === 1 ? "" : "s"} in ${m.name} had no sales tax (${m.zeroTaxSC.slice(0, 3).join(", ")}). Check Shopify's tax settings.`);
  }
  const est = s.deadlines.find((d) => d.kind === "estimated" && d.date >= today && d.date <= addDays(today, 21));
  if (est) out.push(`${est.what} is due ${w2(est.date)}. Taxi suggests paying ${fmt(Math.max(0, s.year.stillOwed))} between the IRS and SC (see the Year panel for the split).`);
  if (s.lastWeek && s.lastWeek.left > 0) out.push(`Move ${fmt(s.lastWeek.left)} for the week of ${w2(s.lastWeek.start)} into the tax accounts, then tick it off.`);
  if (!s.settings.wagesConfirmed) out.push("Enter your job's yearly pay (W-2 box 1) in Taxi's settings so the reserve rate is exact.");
  if (!out.length) out.push("Nothing due. Keep logging receipts as they come in.");
  return out.slice(0, 6);
}

// ---------- records (receipts, screenshots, payments, transfers) ----------
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const QUARTER_RE = /^\d{4}(-Q[1-4])?$/;
const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export function cleanRecord(body, now) {
  const kind = body.kind;
  if (!RECORD_KINDS.includes(kind)) throw new HttpError(400, "bad_input", `kind must be one of: ${RECORD_KINDS.join(", ")}`);
  const date = typeof body.date === "string" && DAY_RE.test(body.date) ? body.date : null;
  if (!date) throw new HttpError(400, "bad_input", "date must look like 2026-11-08.");
  const amount = body.amount == null || body.amount === "" ? 0 : num(body.amount, "Amount", 0, 1000000);
  if (["expense", "payment", "transfer"].includes(kind) && !(amount > 0)) throw new HttpError(400, "bad_input", "Enter the amount.");
  const r = { id: crypto.randomUUID(), at: now, kind, date, week: weekStartOf(date), amount: round2(amount), vendor: text(body.vendor, 80), note: text(body.note, 300) };
  if (body.store != null && body.store !== "both") { if (!Object.hasOwn(STORES, body.store)) throw new HttpError(400, "bad_store", "store must be c3d, ed or both."); r.store = body.store; } else r.store = "both";
  if (kind === "expense") {
    r.category = EXPENSE_CATEGORIES.includes(body.category) ? body.category : "Other business expense";
  }
  if (kind === "payment") {
    if (!PAYMENT_TYPES.includes(body.type)) throw new HttpError(400, "bad_input", `type must be one of: ${PAYMENT_TYPES.join(", ")}`);
    r.type = body.type;
    const period = text(body.period, 10);
    if (body.type === "salesTax" ? !MONTH_RE.test(period) : !QUARTER_RE.test(period)) throw new HttpError(400, "bad_input", body.type === "salesTax" ? "period must be the month, like 2026-11." : "period must be the quarter, like 2026-Q4.");
    r.period = period;
    r.confirmation = text(body.confirmation, 60);
  }
  if (kind === "transfer" && body.week && DAY_RE.test(body.week)) r.week = weekStartOf(body.week);
  return r;
}

export const MAX_RECORDS = 3000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const startsWith = (b, ...sig) => sig.every((v, i) => b[i] === v);
export const FILE_TYPES = {
  "image/png": (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47),
  "image/jpeg": (b) => startsWith(b, 0xff, 0xd8, 0xff),
  "image/webp": (b) => startsWith(b, 0x52, 0x49, 0x46, 0x46) && startsWith(b.subarray(8), 0x57, 0x45, 0x42, 0x50),
  "image/gif": (b) => startsWith(b, 0x47, 0x49, 0x46, 0x38),
  "application/pdf": (b) => startsWith(b, 0x25, 0x50, 0x44, 0x46),
};
export const sniffType = (bytes) => Object.keys(FILE_TYPES).find((t) => FILE_TYPES[t](bytes)) ?? null;

// ---------- /api/taxes (JSON) ----------
export async function handleTaxes(req, ctx) {
  try {
    if (!ctx.kv) throw new HttpError(503, "storage_not_set_up", "Taxi isn't set up yet: add the MARKETING KV namespace binding (see the README).");
    const now = ctx.now ? ctx.now() : new Date();
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Taxi");
      const today = dayKey(now, "America/New_York");
      const year = Number(today.slice(0, 4));
      const ledger = Object.values(await readLedger(ctx.kv, year));
      const lastYear = today.slice(5) < "02-01" ? Object.values(await readLedger(ctx.kv, year - 1)) : [];
      const weekly = await getJson(ctx.kv, K.weekly, { weeks: [] });
      const s = buildSummary({ orders: [...ledger, ...lastYear], records: await readRecords(ctx.kv), settings: await readSettings(ctx.kv), today,
        state: await getJson(ctx.kv, K.state, {}), reports: await readReports(ctx.kv) });
      return ok({ ...s, next: nextActions(s, today), fridays: (weekly.weeks ?? []).slice(0, 12) });
    }
    if (!["POST", "DELETE"].includes(req.method)) throw new HttpError(405, "method_not_allowed", "Use GET, POST or DELETE.");
    requireKey(req, ctx.env);
    const body = await readJsonBody(req);
    if (req.method === "DELETE") {
      const records = await readRecords(ctx.kv);
      const i = records.findIndex((r) => r.id === body.id);
      if (typeof body.id !== "string" || i < 0) throw new HttpError(404, "not_found", "That record isn't there any more.");
      const [gone] = records.splice(i, 1);
      if (gone.file && ctx.files) await ctx.files.delete(gone.id).catch(() => null);
      await ctx.kv.put(K.records, JSON.stringify({ records }));
      return ok({ removed: gone.id });
    }
    if (body.action === "run") {
      const r = await runTaxi(ctx, { now, reason: "manual" });
      return ok({ report: r.report });
    }
    if (body.action === "settings") {
      const s = cleanSettings(body, await readSettings(ctx.kv));
      await ctx.kv.put(K.settings, JSON.stringify(s));
      return ok({ settings: s });
    }
    if (body.action === "record") {
      const records = await readRecords(ctx.kv);
      if (records.length >= MAX_RECORDS) throw new HttpError(409, "full", `Taxi holds ${MAX_RECORDS} records. Export and remove old years first.`);
      const r = cleanRecord(body, now.toISOString());
      records.push(r);
      await ctx.kv.put(K.records, JSON.stringify({ records }));
      return ok({ record: r }, 201);
    }
    throw new HttpError(400, "bad_input", "action must be run, settings or record.");
  } catch (e) {
    return fail(e);
  }
}

// ---------- /api/taxes/file/<id> (raw files) ----------
const FILE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox", "cache-control": "private, no-store" };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...FILE_HEADERS, "content-type": "application/json; charset=utf-8" } });
export async function handleTaxFile(request, { kv, files, env }) {
  const plain = { header: (k) => request.headers.get(k) };
  try {
    if (!kv || !files) throw new HttpError(503, "storage_not_set_up", "Taxi's file storage isn't set up yet.");
    requireKey(plain, env, "Taxi's files");
    const id = new URL(request.url).pathname.split("/")[4] ?? "";
    const records = await readRecords(kv);
    const rec = records.find((r) => r.id === id);
    if (!rec) throw new HttpError(404, "not_found", "That record isn't there any more.");
    if (request.method === "GET") {
      const got = await files.getWithMetadata(id);
      if (!got) throw new HttpError(404, "not_found", "No file on that record.");
      return new Response(got.data, { status: 200, headers: { ...FILE_HEADERS, "content-type": got.metadata?.type ?? "application/octet-stream", "content-disposition": `inline; filename="${(got.metadata?.name ?? "file").replace(/[^\w.-]/g, "_")}"` } });
    }
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
    if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES) throw new HttpError(413, "too_large", "Files can be up to 10 MB.");
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > MAX_FILE_BYTES) throw new HttpError(413, "too_large", "Files can be up to 10 MB.");
    const type = sniffType(buf);
    if (!type) throw new HttpError(415, "bad_type", "Send a photo (JPG, PNG, WebP, GIF) or a PDF.");
    const name = text(decodeURIComponent(request.headers.get("x-filename") ?? "file"), 80) || "file";
    await files.set(id, buf.buffer, { metadata: { type, name, size: buf.byteLength } });
    rec.file = { type, name, size: buf.byteLength };
    await kv.put(K.records, JSON.stringify({ records }));
    return jsonRes({ record: rec }, 201);
  } catch (e) {
    const f = fail(e);
    return jsonRes(f.body, f.status);
  }
}

// Taxi's line in the daily digest, for Stacy and the Creative Lab Studios Home page: her last report and, on
// Fridays, the week's summary with what Aaron should move. Totals only: no orders and no customer details.
export async function taxiBrief(kv) {
  if (!kv) return null;
  const [reports, weekly, state] = await Promise.all([readReports(kv), getJson(kv, K.weekly, { weeks: [] }), getJson(kv, K.state, {})]);
  const r = reports[0] ?? null;
  const w = Array.isArray(weekly?.weeks) ? weekly.weeks[0] ?? null : null;
  if (!r && !w) return null;
  return {
    lastRun: state.lastRun ?? null,
    report: r ? { day: r.day, status: r.status, did: r.did, next: (r.next ?? []).slice(0, 3) } : null,
    week: w ? { start: w.week, end: w.end, orders: w.orders, sales: w.sales, salesTax: w.salesTax, reserve: w.reserve, total: w.total, at: w.at } : null,
  };
}
