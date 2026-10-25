// Browser test for the Products and Insights pages with /api/* mocked.
// Run: NODE_PATH=$(npm root -g) node scripts/test-ui.cjs   (needs Playwright and python3)
// Optional: SCREENS=/path/to/dir saves screenshots there.
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4173 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/`;
const SCREENS = process.env.SCREENS || "";
const KEY = "open-sesame";

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e.stack || e).split("\n").slice(0, process.env.DEBUG ? 60 : 4).join("\n  ")}`); }
};

const product = (store, n, o = {}) => {
  const site = store === "c3d" ? "https://charleston3d.com" : "https://theelevateddesignsllc.com";
  const shop = store === "c3d" ? "charleston3d" : "elevated-designs";
  const handle = o.handle ?? `${store}-item-${n}`;
  return { id: `gid://shopify/Product/${store === "c3d" ? 100 + n : 200 + n}`, handle, title: o.title ?? `Item ${n}`, type: o.type ?? "Gift",
    status: o.status ?? "ACTIVE", live: o.live ?? false, url: `${site}/products/${handle}`,
    adminUrl: `https://admin.shopify.com/store/${shop}/products/${store === "c3d" ? 100 + n : 200 + n}`,
    image: null, price: 24 + n, currency: "USD", inventory: o.inventory ?? null, updatedAt: "2026-10-20T10:00:00Z" };
};
const PRODUCTS = {
  c3d: [product("c3d", 1, { title: "Personalized Name Ornament", type: "Ornament", live: true, handle: "name-ornament" }),
    product("c3d", 2, { title: "Rainbow Row Keychain", type: "Keychain", status: "DRAFT", inventory: 12 }),
    product("c3d", 3, { title: "Pineapple Desk Sign With A Very Long Name That Should Wrap Nicely On Phones", type: "Home" }),
    product("c3d", 4, { title: "Broken Publish Product", type: "Test" })],
  ed: [product("ed", 1, { title: "Lowcountry Tee", type: "Shirt", live: true, handle: "lowcountry-tee" }),
    product("ed", 2, { title: "Pluff Mud Hoodie", type: "Hoodie" })],
};

// Edge-case fixtures: no orders at all, a single order, no read_orders scope, more orders than one read.
async function edgeFixture(kind, store, days) {
  const { buildInsights } = await import(path.join(ROOT, "lib/insights.mjs"));
  const now = new Date("2026-10-25T15:00:00Z");
  const one = [{ id: "o1", createdAt: "2026-10-25T16:00:00Z", cancelledAt: null, test: false, currentTotalPriceSet: { shopMoney: { amount: "1234.5", currencyCode: "USD" } },
    customer: null, lineItems: { nodes: [{ title: "Big Sign", quantity: 1, product: { id: "gid://shopify/Product/9", title: "Big Sign", handle: "big-sign" }, discountedTotalSet: { shopMoney: { amount: "1234.5" } } }] } }];
  const base = { store, now, days: Number(days), timeZone: "America/New_York" };
  if (kind === "empty") return buildInsights({ ...base, orderNodes: [], sessionRows: [] });
  if (kind === "one") return buildInsights({ ...base, orderNodes: one, sessionRows: [{ day: "2026-10-25", sessions: "12", conversion_rate: "0.0833" }] });
  if (kind === "noorders") return buildInsights({ ...base, orderNodes: [], ordersAvailable: false, sessionRows: null, sessionsNote: "Add the read_reports scope to see sessions and conversion.",
    missingScopes: [{ scope: "read_orders", for: "sales, best sellers and the forecast" }, { scope: "read_reports", for: "online store sessions and conversion rate" }] });
  if (kind === "truncated") return buildInsights({ ...base, orderNodes: one, ordersTruncated: true, notes: ["This store has more orders than the console reads in one go; totals cover the most recent ones it could load."] });
  throw new Error(kind);
}

async function insightsFixture(store, days) {
  const { buildInsights, addDays } = await import(path.join(ROOT, "lib/insights.mjs"));
  const now = new Date("2026-10-25T15:00:00Z");
  const nodes = [];
  let seed = store === "c3d" ? 7 : 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let d = 0; d < 180; d++) {
    const day = addDays("2026-10-25", -d);
    const perDay = Math.round(rnd() * 3 + (180 - d) / 60);
    for (let i = 0; i < perDay; i++) {
      const pick = rnd();
      const [id, title, price] = pick < 0.5 ? ["gid://shopify/Product/101", "Personalized Name Ornament", 28] : pick < 0.8 ? ["gid://shopify/Product/102", "Rainbow Row Keychain", 14] : ["gid://shopify/Product/103", "Pineapple Desk Sign", 35];
      if (title === "Pineapple Desk Sign" && d < 30 && rnd() < 0.8) continue;
      nodes.push({ id: `o${d}-${i}`, createdAt: `${day}T16:00:00Z`, cancelledAt: null, test: false, currentTotalPriceSet: { shopMoney: { amount: String(price), currencyCode: "USD" } },
        customer: { id: `c${Math.floor(rnd() * 80)}`, numberOfOrders: String(1 + Math.floor(rnd() * 2.4)) },
        lineItems: { nodes: [{ title, quantity: 1, product: { id, title, handle: title.toLowerCase().replace(/ /g, "-") }, discountedTotalSet: { shopMoney: { amount: String(price) } } }] } });
    }
  }
  const sessionRows = store === "c3d" ? Array.from({ length: Number(days) }, (_, i) => ({ day: addDays("2026-10-25", i - Number(days) + 1), sessions: 40 + Math.round(rnd() * 30 + i / 3), conversion_rate: 0.012 + rnd() * 0.01 })) : null;
  return buildInsights({ store, orderNodes: nodes, now, days: Number(days), timeZone: "America/New_York", sessionRows,
    sessionsNote: store === "ed" ? "Add the read_reports scope to see sessions and conversion." : null,
    missingScopes: store === "ed" ? [{ scope: "read_reports", for: "online store sessions and conversion rate" }] : [],
    notes: ["Shopify only shares the last 60 days of orders unless the app also has read_all_orders."] });
}

async function main() {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  // Responses the test provokes on purpose (401, 422, 502, 503) are logged by Chrome as resource errors; anything else counts.
  const expected = /Failed to load resource: the server responded with a status of (401|422|502|503)/;
  page.on("console", (m) => { if (m.type() === "error" && !expected.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  const mode = { c3d: "ok", ed: "ok", insights: "ok", postDelay: 150 };
  const posts = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  // Image library: kept in memory, list/upload/delete need the key, files are served without it.
  const images = new Map();
  const imageCalls = [];
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.route("**/api/images**", async (route) => {
    const req = route.request();
    const key = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/api\/images\/?/, ""));
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    imageCalls.push({ method: req.method(), key, auth: req.headers()["x-console-key"] ?? null });
    if (req.method() === "GET" && key) return images.has(key) ? route.fulfill({ status: 200, contentType: "image/png", body: PNG }) : json(404, { error: "Image not found" });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    if (req.method() === "GET") return json(200, { items: [...images.values()].sort((a, b) => b.added - a.added) });
    if (req.method() === "POST") {
      const item = { key: `k${images.size + 1}-0123abcd`, name: req.headers()["x-filename"], type: req.headers()["content-type"], size: req.postDataBuffer()?.length ?? 0, tags: req.headers()["x-tags"] ?? "", added: Date.now() };
      images.set(item.key, item);
      return json(201, { item });
    }
    if (req.method() === "DELETE") { images.delete(key); return json(200, { deleted: key }); }
    return json(405, { error: "Not supported" });
  });
  await page.route("**/api/products**", async (route) => {
    const req = route.request();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "GET") {
      const store = new URL(req.url()).searchParams.get("store");
      if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
      await new Promise((r) => setTimeout(r, 60));
      if (mode[store] === "not_connected") return json(503, { error: `Set ${store.toUpperCase()}_SHOPIFY_DOMAIN and ${store.toUpperCase()}_ADMIN_TOKEN in the console's environment variables.`, code: "not_connected" });
      if (mode[store] === "empty") return json(200, { store, products: [] });
      if (mode[store] === "error") return json(502, { error: "Shopify answered with HTTP 500.", code: "shopify_error" });
      return json(200, { store, products: PRODUCTS[store] });
    }
    const body = JSON.parse(req.postData());
    posts.push({ body, key: req.headers()["x-console-key"] });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    await new Promise((r) => setTimeout(r, mode.postDelay));
    const p = PRODUCTS[body.store].find((x) => x.id === body.id);
    if (p.title.startsWith("Broken")) return json(422, { error: "Couldn't publish to the Online Store: Product needs a price", code: "shopify_rejected" });
    const out = { ...p, live: body.live, status: body.live ? "ACTIVE" : p.status };
    Object.assign(p, out); // the store remembers it, like Shopify would
    return json(200, { store: body.store, id: p.id, live: body.live, url: p.url, product: out, indexNow: { sent: true } });
  });
  await page.route("**/api/insights**", async (route) => {
    const u = new URL(route.request().url());
    const store = u.searchParams.get("store");
    if (route.request().headers()["x-console-key"] !== KEY) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Wrong or missing console key.", code: "bad_key" }) });
    const days = u.searchParams.get("days");
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mode.insights === "ok" ? await insightsFixture(store, days) : await edgeFixture(mode.insights, store, days)) });
  });

  const rows = () => page.locator(".prow");
  const sw = (title) => page.locator(".prow", { hasText: title }).locator(".switch");
  const clearToasts = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  const noOverflow = async (label) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(o.sw <= o.cw, `${label}: page scrolls sideways (${o.sw} > ${o.cw})`);
  };

  await page.goto(`${BASE}#products`);
  await step("products: the list itself asks for the key first", async () => {
    await page.waitForSelector("dialog.keydlg[open]");
    assert.equal(await rows().count(), 0, "nothing listed before the key");
    await page.fill("#key-in", KEY);
    await page.click("#key-save");
    await page.waitForSelector(".prow");
  });

  await step("products: lists Charleston 3D by default with summary", async () => {
    assert.equal(await rows().count(), 4);
    assert.match(await page.locator("#prod-title").textContent(), /charleston3d\.com/);
    assert.match(await page.locator("#prod-summary").textContent(), /1 of 4 products are live/);
    assert.equal(await page.locator('.seg-btn[data-store="c3d"]').getAttribute("aria-pressed"), "true");
  });

  await step("products: View on site and Edit in Shopify links", async () => {
    const r = page.locator(".prow", { hasText: "Personalized Name Ornament" });
    assert.equal(await r.locator('a[data-act="view"]').getAttribute("href"), "https://charleston3d.com/products/name-ornament");
    assert.equal(await r.locator('a[data-act="view"]').getAttribute("target"), "_blank");
    assert.equal(await r.locator('a[data-act="edit"]').getAttribute("href"), "https://admin.shopify.com/store/charleston3d/products/101");
    const off = page.locator(".prow", { hasText: "Rainbow Row" });
    assert.equal(await off.locator('a[data-act="view"]').count(), 0, "no site link while not live");
    assert.equal(await off.locator('a[data-act="edit"]').getAttribute("href"), "https://admin.shopify.com/store/charleston3d/products/102");
  });

  await step("products: search, filter, clear filters", async () => {
    await page.fill("#prod-q", "keychain");
    assert.equal(await rows().count(), 1);
    await page.fill("#prod-q", "zzz-nothing");
    assert.equal(await rows().count(), 0);
    await page.click("#prod-clear");
    assert.equal(await rows().count(), 4);
    assert.equal(await page.inputValue("#prod-q"), "");
    for (const [v, n] of [["live", 1], ["off", 3], ["draft", 1], ["all", 4]]) {
      await page.selectOption("#prod-filter", v);
      assert.equal(await rows().count(), n, `filter ${v}`);
    }
  });

  await step("products: toggle uses the session key and goes live (optimistic)", async () => {
    await sw("Rainbow Row").click();
    assert.equal(await sw("Rainbow Row").getAttribute("aria-checked"), "true", "optimistic flip before the server answers");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/102"] .plive > span')?.textContent === "Live");
    assert.equal(await sw("Rainbow Row").getAttribute("aria-checked"), "true");
    assert.equal(posts.at(-1).key, KEY);
    assert.deepEqual(posts.at(-1).body, { store: "c3d", id: "gid://shopify/Product/102", live: true });
    const store = await page.evaluate(() => ({ s: sessionStorage.getItem("bc-console-key"), l: Object.keys(localStorage).filter((k) => /key/i.test(k)) }));
    assert.equal(store.s, KEY);
    assert.deepEqual(store.l, [], "key never in localStorage");
    assert.match(await page.locator("#prod-summary").textContent(), /2 of 4/);
    assert.equal(await page.locator(".prow", { hasText: "Rainbow Row" }).locator('a[data-act="view"]').count(), 1);
  });

  await step("products: failed toggle rolls back and shows the error", async () => {
    await sw("Broken Publish").click();
    assert.equal(await sw("Broken Publish").getAttribute("aria-checked"), "true");
    await page.waitForSelector(".toast", { hasText: "Product needs a price" });
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/104"] .switch').getAttribute("aria-checked") === "false");
    assert.match(await page.locator(".toast").last().textContent(), /Couldn't change Broken Publish Product/);
  });

  await step("products: keyboard toggle (Space) turns a product off and keeps focus", async () => {
    await sw("Personalized Name Ornament").focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/101"] .plive > span')?.textContent === "Off");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), "gid://shopify/Product/101");
    assert.equal(posts.at(-1).body.live, false);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/101"] .plive > span')?.textContent === "Live");
  });

  await step("products: switch to Elevated Designs and back", async () => {
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    assert.equal(await rows().count(), 2);
    assert.match(await page.locator("#prod-title").textContent(), /theelevateddesignsllc\.com/);
    assert.equal(await page.locator(".prow", { hasText: "Lowcountry" }).locator('a[data-act="view"]').getAttribute("href"), "https://theelevateddesignsllc.com/products/lowcountry-tee");
    assert.ok(page.url().endsWith("#products/ed"));
    await sw("Pluff Mud").click();
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/202"] .plive > span')?.textContent === "Live");
    assert.equal(posts.at(-1).body.store, "ed");
    await page.click('.seg-btn[data-store="c3d"]');
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
  });

  await step("products: refresh, not connected, empty and error states", async () => {
    await page.click("#prod-refresh");
    await page.waitForSelector(".prow");
    mode.ed = "not_connected";
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector(".state-setup");
    assert.match(await page.locator(".state-setup").textContent(), /isn't connected yet.*ED_SHOPIFY_DOMAIN/s);
    assert.equal(await page.locator(".state-setup a").getAttribute("href"), "https://github.com/Adub843/Business-console#connect-a-store");
    mode.ed = "empty";
    await page.click(".state-setup button");
    await page.waitForSelector(".state-empty");
    assert.equal(await page.locator(".state-empty a").getAttribute("href"), "https://theelevateddesignsllc.com/admin/products/new");
    mode.ed = "error";
    await page.click("#prod-refresh");
    await page.waitForSelector(".state-error");
    mode.ed = "ok";
    await page.click(".state-error button");
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    await page.click('.seg-btn[data-store="c3d"]');
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
  });

  await step("products: no horizontal overflow at 1280 and 390", async () => {
    await noOverflow("products 1280");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "products-1280.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow("products 390");
    const navRight = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".side > *")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.getBoundingClientRect().right)));
    assert.ok(navRight <= 390, `bottom nav fits on a phone (${navRight})`);
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "products-390.png"), fullPage: true }); }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ---------- insights ----------
  await step("insights: nav link opens the page and loads with the session key", async () => {
    await page.click('a.nav[data-route="insights"]');
    await page.waitForSelector(".tiles");
    await page.waitForSelector(".chart svg .bar.fc", { state: "attached" });
    assert.equal(await page.locator('a.nav[data-route="insights"]').getAttribute("aria-current"), "page");
    assert.equal(await page.locator(".tile").count(), 5);
    assert.match(await page.locator(".tile").first().textContent(), /Last 7 days.*\$.*(Up|Down|Flat)/s);
    assert.ok(await page.locator(".chart svg .bar").count() > 30, "daily bars drawn");
    assert.ok(await page.locator(".chart svg .bar.fc").count() === 4, "4 forecast weeks drawn");
    await page.waitForSelector(".chart svg .line", { state: "attached" });
    assert.ok(await page.locator("ol.next li").count() >= 1, "suggestions shown");
    assert.match(await page.locator("text=How it's worked out").locator("..").textContent(), /straight line/);
    assert.equal(await page.locator(".seasonal").count(), 1, "Nov–Dec note");
  });

  await step("insights: chart keyboard readout and Show numbers tables", async () => {
    const chart = page.locator(".chart").first();
    await chart.focus();
    await page.keyboard.press("End");
    assert.match(await chart.locator(".tip").textContent(), /Oct 25: \$/);
    await page.keyboard.press("ArrowLeft");
    assert.match(await chart.locator(".tip").textContent(), /Oct 24/);
    await chart.hover();
    assert.equal(await chart.locator(".tip").isVisible(), true);
    const details = page.locator("details.nums");
    for (let i = 0; i < await details.count(); i++) {
      await details.nth(i).locator("summary").click();
      assert.equal(await details.nth(i).evaluate((d) => d.open), true);
      assert.ok(await details.nth(i).locator("tbody tr").count() > 0);
    }
  });

  await step("insights: links, days select, refresh", async () => {
    assert.equal(await page.locator("a", { hasText: "Open Products" }).getAttribute("href"), "#products/c3d");
    assert.equal(await page.locator("a", { hasText: "Open charleston3d.com" }).getAttribute("href"), "https://charleston3d.com");
    const top = page.locator("table a").first();
    assert.match(await top.getAttribute("href"), /^https:\/\/charleston3d\.com\/products\//);
    await page.selectOption("#ins-days", "30");
    await page.waitForFunction(() => document.querySelectorAll(".chart")[0]?.querySelectorAll(".bar").length === 30);
    await page.click("#ins-refresh");
    await page.waitForSelector(".tiles");
  });

  await step("insights: Elevated Designs shows missing scope notice and no sessions chart", async () => {
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector(".notice");
    assert.match(await page.locator(".notice").textContent(), /read_reports/);
    assert.match(await page.locator(".notice").textContent(), /Develop apps/);
    assert.equal(await page.locator(".chart svg .line").count(), 0);
    assert.match(await page.locator(".tile", { hasText: "Sessions" }).textContent(), /read_reports/);
    assert.equal(await page.locator("a", { hasText: "Open Products" }).getAttribute("href"), "#products/ed");
  });

  await step("insights: no horizontal overflow at 1280 and 390", async () => {
    await page.click('.seg-btn[data-store="c3d"]');
    await page.selectOption("#ins-days", "90");
    await page.waitForFunction(() => document.querySelectorAll(".chart")[0]?.querySelectorAll(".bar").length === 90);
    await noOverflow("insights 1280");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "insights-1280.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await noOverflow("insights 390");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "insights-390.png"), fullPage: true }); }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("insights: cancelling the key prompt shows Enter key, which then loads", async () => {
    await page.evaluate(() => sessionStorage.clear());
    await page.click("#ins-refresh");
    await page.waitForSelector("dialog.keydlg[open]");
    await page.click("#key-cancel");
    await page.waitForSelector("text=Insights need the console key");
    await page.click("button:has-text('Enter key')");
    await page.waitForSelector("dialog.keydlg[open]");
    await page.fill("#key-in", "wrong");
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog.keydlg[open] >> text=didn't work");
    await page.fill("#key-in", KEY);
    await page.click("#key-save");
    await page.waitForSelector(".tiles");
  });

  await step("other pages still render and every nav link works", async () => {
    for (const r of ["dashboard", "c3d", "ed", "products", "insights", "studio", "map"]) {
      await page.click(`a.nav[data-route="${r}"]`);
      await page.waitForFunction((rt) => document.querySelector(`a.nav[data-route="${rt}"]`)?.getAttribute("aria-current") === "page", r);
      await page.waitForTimeout(100);
      await noOverflow(`${r} 1280`);
    }
    await page.click('a.nav[data-route="c3d"]');
    assert.equal(await page.locator(".quick a", { hasText: "Insights" }).getAttribute("href"), "#insights/c3d");
    await page.click(".quick a:has-text('Products')");
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
    await page.click('a.nav[data-route="ed"]');
    await page.click(".quick a:has-text('Products')");
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    assert.equal(await page.locator('.seg-btn[data-store="ed"]').getAttribute("aria-pressed"), "true");
  });

  // ---------- QA: edge cases and every remaining button ----------
  const toastText = () => page.locator(".toast").last().textContent();
  const liveLabel = (id) => page.evaluate((i) => document.querySelector(`.prow[data-id="${i}"] .plive > span`)?.textContent, id);

  await step("products: double click sends one change, not two", async () => {
    await page.click('a.nav[data-route="products"]');
    await page.click('.seg-btn[data-store="c3d"]').catch(() => {});
    await page.waitForSelector('.prow:has-text("Pineapple")');
    const before = posts.length;
    mode.postDelay = 400;
    await sw("Pineapple").dblclick();
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .plive > span')?.textContent === "Live");
    mode.postDelay = 150;
    assert.equal(posts.length - before, 1, "one POST for a double click");
    assert.equal(posts.at(-1).body.live, true);
  });

  await step("products: wrong key on a change re-prompts, right key saves", async () => {
    await clearToasts();
    await page.evaluate(() => sessionStorage.setItem("bc-console-key", "wrong-key"));
    await sw("Pineapple").click();
    await page.waitForSelector("dialog.keydlg[open] >> text=didn't work");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("bc-console-key")), null, "refused key is dropped");
    await page.fill("#key-in", KEY);
    await page.click("#key-save");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .plive > span')?.textContent === "Off");
    assert.equal(posts.at(-1).key, KEY);
    assert.match(await toastText(), /off the site/);
  });

  await step("products: cancelling the key prompt rolls the switch back", async () => {
    await clearToasts();
    await page.evaluate(() => sessionStorage.removeItem("bc-console-key"));
    const before = posts.length;
    await sw("Pineapple").click();
    await page.waitForSelector("dialog.keydlg[open]");
    assert.equal(await sw("Pineapple").getAttribute("aria-checked"), "true", "optimistic while asking");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .switch').getAttribute("aria-checked") === "false");
    assert.equal(posts.length, before, "nothing sent without a key");
    assert.match(await toastText(), /No console key entered/);
    // wrong key, then cancel the re-prompt: also rolled back
    await page.evaluate(() => sessionStorage.setItem("bc-console-key", "wrong-key"));
    await sw("Pineapple").click();
    await page.waitForSelector("dialog.keydlg[open] >> text=didn't work");
    await page.click("#key-cancel");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .switch').getAttribute("aria-checked") === "false");
    assert.equal(await page.locator("dialog.keydlg[open]").count(), 0);
    await page.evaluate((k) => sessionStorage.setItem("bc-console-key", k), KEY);
  });

  await step("products: switching store mid-change keeps each store's list right", async () => {
    mode.postDelay = 500;
    await page.fill("#prod-q", "");
    await sw("Pineapple").click();
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    await page.waitForTimeout(700); // the c3d change finishes while ED is showing
    mode.postDelay = 150;
    assert.equal(await rows().count(), 2, "ED list not redrawn with C3D rows");
    assert.match(await page.locator("#prod-title").textContent(), /theelevateddesignsllc\.com/);
    await page.click('.seg-btn[data-store="c3d"]');
    await page.waitForSelector('.prow:has-text("Pineapple")');
    assert.equal(await liveLabel("gid://shopify/Product/103"), "Live", "C3D shows the saved change");
    assert.equal(await page.evaluate(() => localStorage.getItem("bc-store")), '"c3d"');
    // search and filter
    await page.fill("#prod-q", "ornament");
    assert.equal(await rows().count(), 1);
    await page.fill("#prod-q", "");
    await page.selectOption("#prod-filter", "all");
  });

  await step("products: links open the live site and Shopify admin in a new tab", async () => {
    for (const r of await rows().all()) {
      const edit = r.locator('a[data-act="edit"]');
      assert.match(await edit.getAttribute("href"), /^https:\/\/admin\.shopify\.com\/store\/charleston3d\/products\/\d+$/);
      assert.equal(await edit.getAttribute("rel"), "noopener");
      const view = r.locator('a[data-act="view"]');
      if (await view.count()) assert.match(await view.getAttribute("href"), /^https:\/\/charleston3d\.com\/products\/[a-z0-9-]+$/);
    }
  });

  await step("products: keyboard reaches the switch with a visible focus ring", async () => {
    await page.locator("#prod-refresh").focus();
    await page.waitForSelector(".prow");
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await page.keyboard.press("Tab");
      found = await page.evaluate(() => document.activeElement?.classList.contains("switch"));
    }
    assert.ok(found, "Tab reaches a switch");
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow }; });
    assert.ok((ring.style !== "none" && ring.width >= 2) || ring.shadow !== "none", `focus visible: ${JSON.stringify(ring)}`);
  });

  await step("insights: no orders at all shows $0, Flat, a zero chart and next steps", async () => {
    mode.insights = "empty";
    await page.click('a.nav[data-route="insights"]');
    await page.waitForSelector(".tiles");
    assert.match(await page.locator(".tile").first().textContent(), /\$0.*Flat 0%.*0 orders · \$0\.00 average/s);
    assert.equal(await page.locator(".chart").first().locator(".bar").count(), 90, "zero bars still drawn");
    assert.match(await page.locator("p.big").textContent(), /About \$0/);
    assert.equal(await page.locator(".legend .key.fc").count(), 0, "no forecast key without a forecast");
    assert.match(await page.locator("text=No sales in the last").textContent(), /90 days/);
    assert.match(await page.locator("ol.next").textContent(), /No orders in the last 30 days/);
    assert.equal(await page.locator("text=Online store visits").count(), 0, "no visits chart with no sessions");
    assert.match(await page.locator(".tile", { hasText: "Sessions" }).textContent(), /^Sessions0/);
  });

  await step("insights: a single order: USD with cents, New badge, one-bar forecast, one-point visits chart", async () => {
    mode.insights = "one";
    await page.click("#ins-refresh");
    await page.waitForSelector(".tiles .num");
    const t7 = await page.locator(".tile").first().textContent();
    assert.match(t7, /\$1,235/, "tile rounds to whole dollars");
    assert.match(t7, /New: nothing to compare yet/);
    assert.match(t7, /1 orders · \$1,234\.50 average/);
    const charts = page.locator(".chart");
    assert.equal(await charts.count(), 3);
    assert.equal(await charts.nth(1).locator(".bar").count(), 1, "one week of history");
    assert.equal(await charts.nth(2).locator(".line").count(), 1, "one-point line drawn");
    await charts.nth(2).focus();
    await page.keyboard.press("End");
    assert.match(await charts.nth(2).locator(".tip").textContent(), /Oct 25: 12/);
    await charts.nth(1).focus();
    await page.keyboard.press("Home");
    assert.match(await charts.nth(1).locator(".tip").textContent(), /: \$1,234\.50$/);
    assert.match(await page.locator("p.big").textContent(), /About \$37,035/, "1 day of sales x 30");
    const visits = page.locator("section", { hasText: "Online store visits" }).locator("details.nums");
    await visits.locator("summary").click();
    assert.equal(await visits.locator("tbody td").nth(2).textContent(), "8.33", "per-day conversion shown as %");
    assert.match(await page.locator(".tile", { hasText: "Sessions" }).textContent(), /8\.33% of visits ordered/);
    const svgText = await charts.first().locator("text.axis").allTextContents();
    assert.ok(svgText.some((x) => /^\$[\d,]+$/.test(x)), `axis in USD: ${svgText}`);
  });

  await step("insights: missing read_orders explains the scope and hides sales", async () => {
    mode.insights = "noorders";
    await page.click("#ins-refresh");
    await page.waitForSelector(".notice");
    assert.match(await page.locator(".notice").textContent(), /read_orders.*read_reports/s);
    assert.equal(await page.locator(".tiles").count(), 0);
    assert.match(await page.locator("text=Sales aren't visible yet").textContent(), /read_orders/);
    assert.equal(await page.locator(".chart").count(), 0);
    assert.match(await page.locator("ol.next").textContent(), /read_orders/);
  });

  await step("insights: truncated orders show the note", async () => {
    mode.insights = "truncated";
    await page.click("#ins-refresh");
    await page.waitForSelector(".tiles");
    assert.equal(await page.locator("#view p", { hasText: "more orders than the console reads" }).count(), 1);
    mode.insights = "ok";
    await page.click("#ins-refresh");
    await page.waitForSelector(".chart .line", { state: "attached" });
  });

  await step("insights: each store and each period loads", async () => {
    for (const st of ["c3d", "ed"]) {
      await page.click(`.seg-btn[data-store="${st}"]`);
      for (const d of ["30", "90", "180"]) {
        await page.selectOption("#ins-days", d);
        await page.waitForFunction((n) => document.querySelectorAll(".chart")[0]?.querySelectorAll(".bar").length === Number(n), d);
        assert.match(await page.locator(".panel-head h2").first().textContent(), st === "c3d" ? /Charleston 3D sales/ : /Elevated Designs sales/);
      }
    }
    assert.ok(page.url().endsWith("#insights/ed"));
    await page.click('.seg-btn[data-store="c3d"]');
    await page.selectOption("#ins-days", "90");
    await page.waitForFunction(() => document.querySelectorAll(".chart")[0]?.querySelectorAll(".bar").length === 90);
  });

  await step("studio: upload needs the key, then list, add to shirt, delete", async () => {
    await page.click('a.nav[data-route="studio"]');
    await page.waitForSelector(".lib");
    await page.evaluate(() => sessionStorage.removeItem("bc-console-key"));
    await page.locator(".controls details summary").click();
    await page.locator(".controls details input").fill("");
    await page.locator(".controls details input").dispatchEvent("change");
    await clearToasts();
    await page.setInputFiles('.studio input[type="file"]', { name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector(".toast >> text=1 failed. Wrong or missing console key"); // the reason stays on screen
    assert.equal(images.size, 0, "nothing stored without the key");
    await page.waitForFunction(() => /Enter the console key/.test(document.querySelector(".studio").textContent));
    await page.locator(".controls details input").fill(KEY);
    await page.locator(".controls details input").dispatchEvent("change");
    await page.fill('.studio input[placeholder^="Tags"]', "logo, test");
    await page.setInputFiles('.studio input[type="file"]', { name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector('.lib button:has-text("logo.png")');
    const up = imageCalls.filter((c) => c.method === "POST").at(-1);
    assert.equal(up.auth, KEY);
    assert.equal([...images.values()][0].tags, "logo, test");
    assert.match(await page.locator(".studio").textContent(), /1 of 1 images\./);
    await page.click('.lib button:has-text("logo.png")');
    await page.waitForSelector(".print-area .layer img");
    page.once("dialog", (d) => d.accept());
    await page.locator('.lib button:has-text("logo.png")').click({ button: "right" });
    await page.waitForSelector(".toast >> text=Image deleted");
    assert.equal(images.size, 0);
    assert.equal(imageCalls.filter((c) => c.method === "DELETE").at(-1).auth, KEY);
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "Clear shirt" }).click();
    assert.equal(await page.locator(".print-area .layer").count(), 1, "cancel keeps the shirt");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Clear shirt" }).click();
    assert.equal(await page.locator(".print-area .layer").count(), 0);
  });

  await step("dashboard and brand pages: store links go to the Shopify sites, not Netlify", async () => {
    for (const [route, site] of [["dashboard", null], ["c3d", "https://charleston3d.com"], ["ed", "https://theelevateddesignsllc.com"]]) {
      await page.click(`a.nav[data-route="${route}"]`);
      await page.waitForFunction((r) => document.querySelector(`a.nav[data-route="${r}"]`)?.getAttribute("aria-current") === "page", route);
      const hrefs = await page.locator("#view a[href]").evaluateAll((as) => as.map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href"), target: a.getAttribute("target") })));
      for (const a of hrefs) {
        if (/^(Website|View live site|Open live site)/.test(a.t)) assert.ok(!/netlify/.test(a.h), `${route}: ${a.t} -> ${a.h}`);
        if (/netlify\.app/.test(a.h)) assert.ok(!/charleston3d-site|elevated-designs-site/.test(a.h), `stale store site link ${a.h}`);
        if (/^https?:/.test(a.h)) assert.equal(a.target, "_blank", `${a.t} opens in a new tab`);
      }
      if (site) {
        assert.equal(await page.locator(".quick a", { hasText: "Website" }).getAttribute("href"), site);
        assert.equal(await page.locator("a", { hasText: "View live site" }).getAttribute("href"), site);
      }
    }
    await page.click('a.nav[data-route="dashboard"]');
    await page.waitForSelector("h1:has-text('Dashboard')");
    const quick = await page.locator(".quick a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    assert.deepEqual(quick, ["https://charleston3d.com", "#products/c3d", "#insights/c3d", "https://charleston3d.com/admin",
      "https://theelevateddesignsllc.com", "#products/ed", "#insights/ed", "https://theelevateddesignsllc.com/admin/orders"]);
  });

  await step("dashboard: jump palette, service drawer and theme switch", async () => {
    await page.click("#view");
    await page.keyboard.press("/");
    await page.waitForSelector("#palette[open]");
    await page.keyboard.type("insights");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash.startsWith("#insights"));
    assert.equal(await page.locator("#palette[open]").count(), 0);
    await page.click('a.nav[data-route="map"]');
    await page.locator(".card", { hasText: "charleston3d.com" }).first().click();
    await page.waitForSelector("#drawer:not([hidden])");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "d-close");
    assert.equal(await page.locator("#d-body a", { hasText: "Open live site" }).getAttribute("href"), "https://charleston3d.com");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#drawer").isHidden(), true);
    const t0 = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.click("#theme");
    const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.notEqual(t1, t0);
    await page.click("#theme");
  });

  await step("mobile 390px: nav fits, every link is reachable and works", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const r of ["dashboard", "c3d", "ed", "products", "insights", "studio", "map"]) {
      const link = page.locator(`a.nav[data-route="${r}"]`);
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      assert.ok(box && box.width >= 32 && box.height >= 32, `${r} tap target ${JSON.stringify(box)}`);
      await link.click();
      await page.waitForFunction((rt) => document.querySelector(`a.nav[data-route="${rt}"]`)?.getAttribute("aria-current") === "page", r);
      await page.waitForTimeout(150);
      await noOverflow(`${r} 390`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("no console errors", async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  server.kill();
  console.log(failures ? `\n${failures} failed` : "\nall UI checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

