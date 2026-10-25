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
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e.stack || e).split("\n").slice(0, 4).join("\n  ")}`); }
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

  const mode = { c3d: "ok", ed: "ok", insightsC3d: "ok" };
  const posts = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("**/api/images**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
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
    await new Promise((r) => setTimeout(r, 150));
    const p = PRODUCTS[body.store].find((x) => x.id === body.id);
    if (p.title.startsWith("Broken")) return json(422, { error: "Couldn't publish to the Online Store: Product needs a price", code: "shopify_rejected" });
    const out = { ...p, live: body.live, status: body.live ? "ACTIVE" : p.status };
    return json(200, { store: body.store, id: p.id, live: body.live, url: p.url, product: out, indexNow: { sent: true } });
  });
  await page.route("**/api/insights**", async (route) => {
    const u = new URL(route.request().url());
    const store = u.searchParams.get("store");
    if (route.request().headers()["x-console-key"] !== KEY) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Wrong or missing console key.", code: "bad_key" }) });
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await insightsFixture(store, u.searchParams.get("days"))) });
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

  await step("no console errors", async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  server.kill();
  console.log(failures ? `\n${failures} failed` : "\nall UI checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

