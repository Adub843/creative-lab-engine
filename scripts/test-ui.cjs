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
  const site = store === "c3d" ? "https://charleston3d.com" : "https://elevatedshirts.com";
  const shop = store === "c3d" ? "charleston3d" : "elevated-designs";
  const handle = o.handle ?? `${store}-item-${n}`;
  return { id: `gid://shopify/Product/${store === "c3d" ? 100 + n : 200 + n}`, handle, title: o.title ?? `Item ${n}`, type: o.type ?? "Gift",
    status: o.status ?? "ACTIVE", live: o.live ?? false, url: `${site}/products/${handle}`,
    adminUrl: `https://admin.shopify.com/store/${shop}/products/${store === "c3d" ? 100 + n : 200 + n}`,
    image: null, price: 24 + n, currency: "USD", inventory: o.inventory ?? null, updatedAt: "2026-10-20T10:00:00Z",
    ...(store === "c3d" ? { customizable: o.customizable ?? false } : {}) };
};
const PRODUCTS = {
  c3d: [product("c3d", 1, { title: "Personalized Name Ornament", type: "Ornament", live: true, handle: "name-ornament", customizable: true }),
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

  const mode = { c3d: "ok", ed: "ok", insights: "ok", postDelay: 150, listing: "ok" };
  const posts = [];
  const productGets = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  // Image library: kept in memory, list/upload/delete need the key, files are served without it.
  const images = new Map();
  const imageCalls = [];
  let staleList = null; // when set, the list answers this instead (Workers KV lists can lag behind writes)
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.route("**/api/images**", async (route) => {
    const req = route.request();
    const key = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/api\/images\/?/, ""));
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    imageCalls.push({ method: req.method(), key, auth: req.headers()["x-console-key"] ?? null });
    if (req.method() === "GET" && key) return images.has(key) ? route.fulfill({ status: 200, contentType: "image/png", body: PNG }) : json(404, { error: "Image not found" });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    if (req.method() === "GET") return json(200, { items: staleList ?? [...images.values()].sort((a, b) => b.added - a.added) });
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
      productGets.push(store);
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
    if ("customizable" in body) {
      if (body.store !== "c3d") return json(400, { error: "Customizable is a Charleston 3D setting.", code: "wrong_store" });
      if (p.title.startsWith("Broken")) return json(422, { error: "Couldn't add the customizable tag: Tags is invalid", code: "shopify_rejected" });
      p.customizable = body.customizable;
      return json(200, { store: "c3d", id: p.id, customizable: p.customizable, product: { ...p } });
    }
    if (p.title.startsWith("Half")) {
      Object.assign(p, { status: "ACTIVE", live: false });
      return json(422, { error: "It's now Active in Shopify, but it isn't on the Online Store yet: Online Store isn't available. Try the switch again, or publish it in Shopify.", code: "partly_published", details: { product: { ...p } } });
    }
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

  // Listings: the body the page sends is checked with the server's own parser, so a sheet that
  // builds something the API would refuse fails here.
  const L = await import(path.join(ROOT, "lib/listings.mjs"));
  const TPL = L.listingTemplate(() => undefined);
  // Expected shirts, colors, counts and prices come from data/blanks.json through the page's own helpers.
  const LJ = await import(path.join(ROOT, "assets/listing.js"));
  const CAT = TPL.catalog;
  const blankOf = (id) => CAT.blanks.find((b) => b.id === id) ?? assert.fail(`${id} isn't in data/blanks.json`);
  const defaultOf = (tier) => TPL.defaults.blanks.find((d) => blankOf(d.id).tier === tier) ?? assert.fail(`no default ${tier} tee`);
  const inCatalogOrder = (id, names) => blankOf(id).colors.map((c) => c.name).filter((n) => names.includes(n));
  const preset = (id) => ({ id, colors: inCatalogOrder(id, LJ.presetColors(blankOf(id))) });
  const offerOf = (blanks, { sizes = LJ.SIZES, markup = 0 } = {}) => {
    const p = LJ.variantsFor(CAT, { blanks, sizes, markup }).map((v) => v.price);
    return { variants: p.length, colors: blanks.reduce((n, b) => n + b.colors.length, 0), lo: Math.min(...p), hi: Math.max(...p) };
  };
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const usd = (n) => rx(`$${n.toFixed(2)}`);
  const VALUE = defaultOf("value").id, STANDARD = defaultOf("standard").id, PREMIUM = defaultOf("premium").id;
  const DEFAULTS = TPL.defaults.blanks.map((d) => preset(d.id));
  const EXTRA = "bella-3001"; // a tee that isn't preset, picked by hand below
  const BIG = [EXTRA, "comfortcolors-1717", "nextlevel-3600"]; // three more tees: a listing over 100 variants
  const listings = [];
  let listingGets = 0;
  await page.route("**/api/listings**", async (route) => {
    const req = route.request();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    if (req.method() === "GET") { listingGets++; return json(200, { template: TPL }); }
    const body = JSON.parse(req.postData());
    listings.push(body);
    let input;
    try { input = L.parseListingInput(body, TPL); } catch (e) { listings.at(-1).refused = e.message; return json(e.status ?? 400, { error: e.message, code: e.code }); }
    listings.at(-1).variants = input.variants.length;
    await new Promise((r) => setTimeout(r, 200));
    const handle = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const product = { id: "gid://shopify/Product/555", handle, title: input.title, url: `https://elevatedshirts.com/products/${handle}`, adminUrl: "https://admin.shopify.com/store/elevated-designs/products/555" };
    if (mode.listing === "error") return json(422, { error: "Shopify wouldn't create the product: Title has already been taken", code: "shopify_rejected" });
    if (mode.listing === "partly") return json(422, { error: "The product was made in Shopify but isn't on the Online Store yet: Publication not found Press List it again to retry, or publish it in Shopify.", code: "partly_listed", details: { product } });
    if (mode.listing === "pending" && !body.operationId) return json(202, { store: "ed", pending: true, operationId: "gid://shopify/ProductSetOperation/42", message: "Shopify is still making this listing (it has a lot of variants). Press Check again in a moment to put it on elevatedshirts.com." });
    if (mode.listing === "already") return json(200, { store: "ed", alreadyListed: true, republished: false, live: true, product, url: product.url, adminUrl: product.adminUrl, message: `This design is already listed as "${input.title}".` });
    PRODUCTS.ed.push({ ...product, type: input.productType, status: "ACTIVE", live: true, image: null, price: Math.min(...input.variants.map((v) => v.price)), currency: "USD", inventory: null, updatedAt: "2026-10-25T10:00:00Z" });
    return json(201, { store: "ed", alreadyListed: false, live: true, product, url: product.url, adminUrl: product.adminUrl, indexNow: { sent: true }, message: `"${input.title}" is live on elevatedshirts.com.` });
  });

  const rows = () => page.locator(".prow");
  const sw = (title) => page.locator(".prow", { hasText: title }).locator('.switch[data-field="live"]');
  const csw = (title) => page.locator(".prow", { hasText: title }).locator('.switch[data-field="customizable"]');
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
    assert.match(await page.locator("#prod-title").textContent(), /elevatedshirts\.com/);
    assert.equal(await page.locator(".prow", { hasText: "Lowcountry" }).locator('a[data-act="view"]').getAttribute("href"), "https://elevatedshirts.com/products/lowcountry-tee");
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
    await page.waitForSelector(".plist .state-setup");
    assert.match(await page.locator(".plist .state-setup").textContent(), /isn't connected yet.*ED_SHOPIFY_DOMAIN/s);
    assert.equal(await page.locator(".plist .state-setup a").getAttribute("href"), "https://github.com/Adub843/Business-console#connect-a-store");
    mode.ed = "empty";
    await page.click(".plist .state-setup button");
    await page.waitForSelector(".plist .state-empty");
    assert.equal(await page.locator(".plist .state-empty a").getAttribute("href"), "https://elevatedshirts.com/admin/products/new");
    mode.ed = "error";
    await page.click("#prod-refresh");
    await page.waitForSelector(".plist .state-error");
    mode.ed = "ok";
    await page.click(".plist .state-error button");
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
    assert.match(await page.locator("#prod-title").textContent(), /elevatedshirts\.com/);
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
    assert.match(t7, /(^|[^0-9,])1 order · \$1,234\.50 average/);
    assert.ok(!/(^|[^0-9,])1 orders\b/.test(await page.locator("#view").textContent()), "no \"1 orders\" anywhere");
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

  await step("studio: a list that lags behind uploads and deletes (Workers KV) still shows what this tab did", async () => {
    const old = { key: "k0-0123abcd", name: "old.png", type: "image/png", size: 10, tags: "", added: 1 };
    images.set(old.key, old);
    staleList = [old];
    await page.click('a.nav[data-route="dashboard"]');
    await page.click('a.nav[data-route="studio"]');
    await page.waitForSelector('.lib button:has-text("old.png")');
    await clearToasts();
    await page.setInputFiles('.studio input[type="file"]', { name: "late.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector('.lib button:has-text("late.png")'); // not in the (stale) list yet, shown anyway
    assert.ok(!staleList.some((i) => i.name === "late.png"));
    page.once("dialog", (d) => d.accept());
    await page.locator('.lib button:has-text("old.png")').click({ button: "right" });
    await page.waitForSelector(".toast >> text=Image deleted");
    await page.click('a.nav[data-route="dashboard"]');
    await page.click('a.nav[data-route="studio"]');
    await page.waitForSelector('.lib button:has-text("late.png")');
    assert.equal(await page.locator('.lib button:has-text("old.png")').count(), 0, "a deleted image stays gone though the list still has it");
    staleList = null;
    for (const k of [...images.keys()]) images.delete(k);
  });

  await step("dashboard and brand pages: store links go to the Shopify sites, not Netlify", async () => {
    for (const [route, site] of [["dashboard", null], ["c3d", "https://charleston3d.com"], ["ed", "https://elevatedshirts.com"]]) {
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
    assert.deepEqual(quick, ["https://charleston3d.com", "https://app.charleston3d.com", "#products/c3d", "#insights/c3d",
      "https://elevatedshirts.com", "https://design.elevatedshirts.com", "#products/ed", "#insights/ed"]);
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

  // ---------- Charleston 3D: Customizable switch ----------
  const customLabel = (id) => page.evaluate((i) => document.querySelector(`.prow[data-id="${i}"] .pcust > span`)?.textContent, id);
  await step("customizable: a switch per Charleston 3D product, none on Elevated Designs", async () => {
    await page.click('a.nav[data-route="products"]');
    await page.click('.seg-btn[data-store="c3d"]').catch(() => {});
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
    assert.equal(await page.locator('.switch[data-field="customizable"]').count(), await rows().count());
    assert.equal(await csw("Personalized Name Ornament").getAttribute("aria-checked"), "true");
    assert.equal(await csw("Rainbow Row").getAttribute("aria-checked"), "false");
    assert.match(await csw("Rainbow Row").getAttribute("aria-label"), /Customizable.*Rainbow Row Keychain/);
    assert.equal(await page.locator("#list-design").isHidden(), true, "no listing panel on Charleston 3D");
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    assert.equal(await page.locator('.switch[data-field="customizable"]').count(), 0, "Elevated Designs has no Customizable switch");
    await page.click('.seg-btn[data-store="c3d"]');
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
  });

  await step("customizable: switching on saves (optimistic) and only sends the tag change", async () => {
    await clearToasts();
    const before = posts.length;
    await csw("Rainbow Row").click();
    assert.equal(await csw("Rainbow Row").getAttribute("aria-checked"), "true", "flips before the server answers");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/102"] .pcust > span')?.textContent === "Customizable");
    assert.equal(posts.length - before, 1);
    assert.deepEqual(posts.at(-1).body, { store: "c3d", id: "gid://shopify/Product/102", customizable: true });
    assert.equal(posts.at(-1).key, KEY);
    assert.match(await toastText(), /Rainbow Row Keychain now asks for a name to print/);
    assert.equal(await sw("Rainbow Row").getAttribute("aria-checked"), "true", "Live untouched");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "products-c3d-customizable-1280.png"), fullPage: true }); }
  });

  await step("customizable: Shopify refusal rolls the switch back with the reason", async () => {
    await clearToasts();
    await csw("Broken Publish").click();
    assert.equal(await csw("Broken Publish").getAttribute("aria-checked"), "true");
    await page.waitForSelector(".toast >> text=Tags is invalid");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/104"] .switch[data-field="customizable"]').getAttribute("aria-checked") === "false");
    assert.match(await toastText(), /Couldn't change Broken Publish Product/);
  });

  await step("customizable: keyboard (Space) turns it off and keeps focus on that switch", async () => {
    await csw("Personalized Name Ornament").focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/101"] .switch[data-field="customizable"]').getAttribute("aria-checked") === "false"
      && document.querySelector('.prow[data-id="gid://shopify/Product/101"] .pcust > span').textContent === "Customizable");
    assert.deepEqual(await page.evaluate(() => [document.activeElement?.dataset.id, document.activeElement?.dataset.field]), ["gid://shopify/Product/101", "customizable"]);
    assert.equal(posts.at(-1).body.customizable, false);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/101"] .switch[data-field="customizable"]').getAttribute("aria-checked") === "true");
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2; });
    assert.ok(ring, "visible focus ring");
  });

  await step("customizable: no key asks for it; cancelling rolls back and sends nothing", async () => {
    await clearToasts();
    await page.evaluate(() => sessionStorage.removeItem("bc-console-key"));
    const before = posts.length;
    await csw("Pineapple").click();
    await page.waitForSelector("dialog.keydlg[open]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .switch[data-field="customizable"]').getAttribute("aria-checked") === "false");
    assert.equal(posts.length, before);
    assert.match(await toastText(), /No console key entered/);
    await csw("Pineapple").click();
    await page.waitForSelector("dialog.keydlg[open]");
    await page.fill("#key-in", KEY);
    await page.click("#key-save");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/103"] .switch[data-field="customizable"]').getAttribute("aria-checked") === "true"
      && document.querySelector('.prow[data-id="gid://shopify/Product/103"] .pcust > span').textContent === "Customizable");
    assert.equal(posts.at(-1).key, KEY);
  });

  await step("live: Active worked but publishing didn't: row shows Active, not live, with a clear message", async () => {
    PRODUCTS.c3d.push(product("c3d", 5, { title: "Half Published Sign", status: "DRAFT" }));
    await page.click("#prod-refresh");
    await page.waitForSelector('.prow:has-text("Half Published")');
    await clearToasts();
    await sw("Half Published").click();
    await page.waitForSelector(".toast >> text=now Active in Shopify");
    await page.waitForFunction(() => document.querySelector('.prow[data-id="gid://shopify/Product/105"] .plive > span')?.textContent === "Off");
    const r = page.locator(".prow", { hasText: "Half Published" });
    assert.equal(await r.locator(".pill").textContent(), "Active", "status refreshed from Shopify, not rolled back to Draft");
    assert.equal(await sw("Half Published").getAttribute("aria-checked"), "false");
    assert.match(await toastText(), /isn't on the Online Store yet: Online Store isn't available/);
    PRODUCTS.c3d.pop();
  });

  // ---------- Elevated Designs: List a design ----------
  const seed = [["mh2k3x-0123abcd", "lowcountry_sunset-FINAL.png", "image/png", "sunset, charleston"], ["mh2k4a-89abcdef", "palmetto moon.png", "image/png", ""],
    ["mh2k5b-fedcba98", "logo-vector.svg", "image/svg+xml", ""]];
  const card = (name) => page.locator(".lcard", { hasText: name });
  const openSheet = async (name) => {
    await card(name).locator('button[data-act="list"]').click();
    await page.waitForSelector("#list-sheet[open] #ls-title");
  };
  await step("list a design: panel on Elevated Designs shows the online library; SVG can't be listed", async () => {
    seed.forEach(([key, name, type, tags], n) => images.set(key, { key, name, type, size: 68, tags, added: 1000 - n }));
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector('.prow:has-text("Lowcountry Tee")');
    assert.equal(await page.locator("#list-design").isVisible(), true);
    await page.click("#lib-refresh");
    await page.waitForSelector('.lcard:has-text("palmetto moon")');
    assert.equal(await page.locator(".lcard").count(), 3);
    assert.match(await page.locator("#lib-count").textContent(), /3 of 3 designs/);
    assert.equal(await card("logo-vector").locator("button").count(), 0, "SVG has no list button");
    assert.match(await card("logo-vector").textContent(), /Export it as a PNG/);
    assert.equal(await card("lowcountry").locator('button[data-act="list"]').getAttribute("aria-label"), "Add lowcountry_sunset-FINAL.png to Elevated Designs");
    await page.fill("#lib-q", "palmetto");
    assert.equal(await page.locator(".lcard").count(), 1);
    await page.fill("#lib-q", "");
    await page.dispatchEvent("#lib-q", "input");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "ed-list-panel-1280.png"), fullPage: true }); }
  });

  await step("list a design: sheet is prefilled: cheapest tee per tier, preset colors, catalog prices", async () => {
    await openSheet("lowcountry");
    assert.equal(listingGets, 1, "template fetched once");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-title", "focus starts on the title");
    assert.equal(await page.inputValue("#ls-title"), "Lowcountry Sunset Tee");
    assert.equal(await page.inputValue("#ls-markup"), "0");
    const picked = await page.locator(".lblank-head input:checked").evaluateAll((i) => i.map((x) => x.dataset.blank));
    assert.deepEqual(picked, TPL.defaults.blanks.map((b) => b.id));
    assert.equal(picked.length, Object.keys(CAT.tiers).length, "one tee per tier");
    for (const d of DEFAULTS) assert.deepEqual(await page.locator(`#ls-colors-${d.id} input:checked`).evaluateAll((i) => i.map((x) => x.value)), d.colors, `${d.id} preset colors`);
    assert.ok(!picked.includes(EXTRA), `${EXTRA} isn't preset`);
    assert.equal(await page.locator(`#ls-colors-${EXTRA}`).isHidden(), true, "colors only for offered shirts");
    for (const id of [VALUE, EXTRA]) {
      const b = blankOf(id);
      assert.match(await page.locator(`.lblank[data-blank="${id}"]`).textContent(),
        new RegExp(`${rx(`${b.brand} ${b.style} ${b.name}`)}.*${rx(CAT.tiers[b.tier])}.*${rx(b.fit)}.*from ${usd(Math.min(...Object.values(b.prices)))}`, "s"));
    }
    const def = offerOf(DEFAULTS);
    assert.ok(def.variants <= TPL.limits.standardVariants, "the preset fits a standard store");
    assert.equal(await page.locator("#ls-count").textContent(), `${def.variants} variants of 2,048`);
    assert.match(await page.locator("#ls-summary").textContent(), new RegExp(`^${DEFAULTS.length} shirts, ${def.colors} colors, ${usd(def.lo)} to ${usd(def.hi)}\\.`));
    if (CAT.pricing.placeholder || CAT.costsAreEstimates) assert.match(await page.locator("#ls-shirts").textContent(), /still placeholders/);
    else assert.doesNotMatch(await page.locator("#ls-shirts").textContent(), /placeholder/, "real prices carry no placeholder note");
    assert.equal(await page.locator('details.lgroup[data-type="tee"]').evaluate((d) => d.open), true);
    assert.equal(await page.locator('details.lgroup[data-type="hoodie"]').evaluate((d) => d.open), false);
    await page.click(".lmore summary");
    const desc = await page.inputValue("#ls-desc");
    assert.match(desc, /<strong>Lowcountry Sunset<\/strong>/);
    assert.match(desc, /<h3>Choose your shirt<\/h3>/);
    assert.match(desc, /Gildan 64000 – Softstyle Tee<\/strong>: /);
    assert.match(desc, /ships in 5-7 business days/);
    assert.match(await page.inputValue("#ls-tags"), /^elevated-designs, graphic-tee, t-shirt, printed-to-order, sunset, charleston$/);
    assert.equal(await page.inputValue("#ls-seo-title"), "Lowcountry Sunset Tee | Elevated Designs");
    assert.ok((await page.inputValue("#ls-seo-desc")).length <= 155);
    await page.click(".lmore summary");
    if (SCREENS) { await page.locator("#list-sheet").evaluate((d) => (d.scrollTop = 0)); await page.screenshot({ path: path.join(SCREENS, "ed-list-sheet-1280.png") }); }
  });

  await step("list a design: picking shirts and colors updates the counter, prices and copy; hand edits are kept", async () => {
    await page.check(`#ls-blank-${EXTRA}`);
    assert.equal(await page.locator(`#ls-colors-${EXTRA}`).isVisible(), true);
    assert.deepEqual(await page.locator(`#ls-colors-${EXTRA} input:checked`).evaluateAll((i) => i.map((x) => x.value)), preset(EXTRA).colors, "preset colors for a newly picked shirt");
    const more = offerOf([...DEFAULTS, preset(EXTRA)]).variants;
    assert.ok(more > TPL.limits.standardVariants, `${more} variants: over 100 with ${EXTRA}`);
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${more} variants of 2,048\\. Over 100: Shopify makes it in the background`));
    assert.equal(await page.locator("#ls-count").getAttribute("class"), "vcount warn");
    await page.uncheck(`#ls-blank-${EXTRA}`);
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${offerOf(DEFAULTS).variants} variants`));
    await page.uncheck(`#ls-blank-${VALUE}`);
    await page.uncheck("#ls-color-gildan-h000-sport-grey");
    await page.check("#ls-color-gildan-h000-sand");
    const two = [preset(STANDARD), { id: PREMIUM, colors: inCatalogOrder(PREMIUM, [...preset(PREMIUM).colors.filter((c) => c !== "Sport Grey"), "Sand"]) }];
    assert.equal(two[1].colors.length, 4, "swapped Sport Grey for Sand");
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${offerOf(two).variants} variants`), "2 shirts x 4 colors x their sizes");
    await page.fill("#ls-markup", "2");
    const marked = offerOf(two, { markup: 2 });
    assert.match(await page.locator("#ls-summary").textContent(), new RegExp(`^2 shirts, 8 colors, ${usd(marked.lo)} to ${usd(marked.hi)}\\.`));
    await page.click(".lmore summary");
    assert.ok(!(await page.inputValue("#ls-desc")).includes(LJ.blankLabel(blankOf(VALUE))), "description follows the shirts offered");
    assert.ok((await page.inputValue("#ls-desc")).includes(LJ.blankLabel(blankOf(STANDARD))));
    await page.fill("#ls-title", "Lowcountry Sunset Classic Tee");
    assert.match(await page.inputValue("#ls-desc"), /<strong>Lowcountry Sunset Classic<\/strong>/);
    assert.equal(await page.inputValue("#ls-seo-title"), "Lowcountry Sunset Classic Tee | Elevated Designs");
    await page.fill("#ls-seo-desc", "Hand-written SEO description for the Lowcountry Sunset tee.");
    await page.fill("#ls-title", "Lowcountry Sunset Tee");
    assert.equal(await page.inputValue("#ls-seo-desc"), "Hand-written SEO description for the Lowcountry Sunset tee.", "kept after a title change");
    await page.uncheck("#ls-size-3XL");
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${offerOf(two, { sizes: LJ.SIZES.filter((z) => z !== "3XL") }).variants} variants`));
    await page.fill("#ls-tags", "elevated-designs, sunset,  , lowcountry");
  });

  await step("list a design: List it sends one valid listing and shows the live link", async () => {
    await clearToasts();
    const before = listings.length, gets = productGets.length;
    await page.click("#ls-submit");
    assert.equal(await page.locator("#ls-submit").textContent(), "Listing…");
    assert.equal(await page.locator("#ls-submit").isDisabled(), true);
    await page.waitForSelector("#ls-result");
    assert.equal(listings.length - before, 1);
    const body = listings.at(-1);
    assert.equal(body.refused, undefined, `server would refuse: ${body.refused}`);
    assert.equal(body.store, "ed");
    assert.equal(body.imageKey, "mh2k3x-0123abcd");
    assert.equal(body.title, "Lowcountry Sunset Tee");
    assert.equal(body.markup, 2);
    const two = [preset(STANDARD), { id: PREMIUM, colors: inCatalogOrder(PREMIUM, [...preset(PREMIUM).colors.filter((c) => c !== "Sport Grey"), "Sand"]) }];
    assert.deepEqual(body.blanks, two);
    assert.deepEqual(body.sizes, ["XS", "S", "M", "L", "XL", "2XL", "4XL", "5XL"]);
    assert.equal(body.variants, offerOf(two, { sizes: body.sizes }).variants, "server counted the same variants as the sheet");
    assert.deepEqual(body.tags, ["elevated-designs", "sunset", "lowcountry"]);
    assert.equal(body.seoDescription, "Hand-written SEO description for the Lowcountry Sunset tee.");
    assert.match(await page.locator("#ls-result").textContent(), /Live on elevatedshirts\.com.*is live/s);
    assert.equal(await page.locator("#ls-view").getAttribute("href"), "https://elevatedshirts.com/products/lowcountry-sunset-tee");
    assert.equal(await page.locator("#ls-view").getAttribute("target"), "_blank");
    assert.equal(await page.locator("#ls-admin").getAttribute("href"), "https://admin.shopify.com/store/elevated-designs/products/555");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-view");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "ed-list-success-1280.png") }); }
    await page.click("#ls-done");
    assert.equal(await page.locator("#list-sheet[open]").count(), 0);
    await page.waitForSelector('.prow:has-text("Lowcountry Sunset Tee")'); // the product list reloaded
    assert.deepEqual(productGets.slice(gets), ["ed"], "Elevated Designs list reloaded once");
    assert.equal(await card("lowcountry").locator(".pill").textContent(), "Listed");
    assert.equal(await card("lowcountry").locator('a[data-act="listed-view"]').getAttribute("href"), "https://elevatedshirts.com/products/lowcountry-sunset-tee");
  });

  await step("list a design: already listed says so with the links", async () => {
    mode.listing = "already";
    await openSheet("lowcountry");
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-result");
    assert.match(await page.locator("#ls-result").textContent(), /Already listed.*already listed as "Lowcountry Sunset Tee"/s);
    assert.equal(await page.locator("#ls-admin").getAttribute("href"), "https://admin.shopify.com/store/elevated-designs/products/555");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#list-sheet[open]").count(), 0);
    mode.listing = "ok";
  });

  await step("list a design: a big listing still being made shows Check again, which finishes it with the operation id", async () => {
    mode.listing = "pending";
    await openSheet("lowcountry");
    for (const id of BIG) await page.check(`#ls-blank-${id}`);
    const big = offerOf([...DEFAULTS, ...BIG.map(preset)]).variants;
    assert.ok(big > TPL.limits.standardVariants && big <= TPL.limits.variants, `${big} variants`);
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${big} variants`));
    const before = listings.length;
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-pending");
    assert.match(await page.locator("#ls-pending").textContent(), /Still being made in Shopify.*still making this listing/s);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-check");
    await page.click("#ls-check");
    await page.waitForSelector("#ls-result");
    assert.equal(listings.length - before, 2);
    assert.equal(listings.at(-1).operationId, "gid://shopify/ProductSetOperation/42");
    assert.equal(listings.at(-1).refused, undefined);
    await page.click("#ls-done");
    PRODUCTS.ed.pop();
    mode.listing = "ok";
  });

  await step("list a design: errors stay in the sheet, the form is kept, and a retry works", async () => {
    PRODUCTS.ed.pop();
    mode.listing = "error";
    await openSheet("palmetto");
    assert.equal(await page.inputValue("#ls-title"), "Palmetto Moon Tee");
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-error:not([hidden])");
    assert.match(await page.locator("#ls-error").textContent(), /Not listed yet.*Title has already been taken/s);
    assert.equal(await page.locator("#ls-submit").isDisabled(), false);
    assert.equal(await page.locator("#ls-submit").textContent(), "List it");
    assert.equal(await page.inputValue("#ls-title"), "Palmetto Moon Tee", "nothing typed is lost");
    mode.listing = "partly";
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-err-admin");
    assert.match(await page.locator("#ls-error").textContent(), /isn't on the Online Store yet/);
    assert.equal(await page.locator("#ls-err-admin").getAttribute("href"), "https://admin.shopify.com/store/elevated-designs/products/555");
    mode.listing = "ok";
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-result");
    await page.click("#ls-done");
  });

  await step("list a design: no title, no shirts, no sizes or over 2,048 variants are caught before anything is sent", async () => {
    await openSheet("palmetto");
    const before = listings.length;
    await page.fill("#ls-title", "");
    await page.click("#ls-submit");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-title");
    await page.fill("#ls-title", "Palmetto Moon Tee");
    for (const b of TPL.defaults.blanks) await page.uncheck(`#ls-blank-${b.id}`);
    assert.match(await page.locator("#ls-summary").textContent(), /Pick at least one shirt/);
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-error:not([hidden]) >> text=Pick at least one shirt");
    // every shirt in every color: far over Shopify's limit
    await page.locator("details.lgroup").evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
    for (const box of await page.locator(".lblank-head input").all()) await box.check();
    await page.locator(".lcolors input:not(:checked)").evaluateAll((is) => is.forEach((i) => i.click()));
    assert.match(await page.locator("#ls-count").textContent(), /^\d,\d{3} variants of 2,048: too many/);
    assert.equal(await page.locator("#ls-count").getAttribute("class"), "vcount over");
    assert.equal(await page.locator("#ls-submit").isDisabled(), true, "List it is off over the limit");
    await page.locator(".lblank-head input:checked").evaluateAll((is) => is.forEach((i) => i.click()));
    assert.equal(await page.locator(".lblank-head input:checked").count(), 0);
    await page.check(`#ls-blank-${VALUE}`);
    await page.click(".lmore summary");
    for (const s of ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]) await page.uncheck(`#ls-size-${s}`);
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-error:not([hidden]) >> text=Pick at least one size");
    await page.fill("#ls-seo-title", "x".repeat(70));
    assert.equal((await page.inputValue("#ls-seo-title")).length, 60, "SEO title capped at 60");
    assert.equal(listings.length, before, "nothing sent");
    await page.click("#ls-cancel");
    assert.equal(await page.locator("#list-sheet[open]").count(), 0);
  });

  await step("list a design: closing a listing still being made and opening it again goes back to Check again, never a second List it", async () => {
    mode.listing = "pending";
    await openSheet("palmetto");
    await page.check(`#ls-blank-${EXTRA}`);
    const before = listings.length;
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-pending");
    await page.click("#ls-later");
    assert.equal(await page.locator("#list-sheet[open]").count(), 0);
    await card("palmetto").locator('button[data-act="list"]').click();
    await page.waitForSelector("#list-sheet[open] #ls-pending");
    assert.equal(await page.locator("#ls-title").count(), 0, "no form to send a second productSet from");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-check");
    await page.click("#ls-check");
    await page.waitForSelector("#ls-result");
    assert.equal(listings.length - before, 2, "one listing, then one check");
    assert.equal(listings.at(-1).operationId, "gid://shopify/ProductSetOperation/42");
    await page.click("#ls-done");
    PRODUCTS.ed.pop();
    mode.listing = "ok";
    await openSheet("palmetto");
    assert.equal(await page.locator("#ls-pending").count(), 0, "finished: the form is back");
    await page.click("#ls-cancel");
  });

  await step("list a design: a shirt in none of the chosen sizes is caught before sending", async () => {
    await openSheet("palmetto");
    const before = listings.length;
    await page.click(".lmore summary");
    for (const s of ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]) await page.uncheck(`#ls-size-${s}`);
    await page.check("#ls-size-5XL");
    const with5 = DEFAULTS.filter((d) => blankOf(d.id).sizes.includes("5XL")), without5 = DEFAULTS.filter((d) => !with5.includes(d));
    assert.deepEqual(with5.map((d) => d.id), [VALUE], "only the value tee has 5XL among the defaults");
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${with5[0].colors.length} variants`));
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-error:not([hidden]) >> text=comes in none of the chosen sizes");
    assert.equal(await page.evaluate(() => document.activeElement?.id), `ls-blank-${without5[0].id}`, "focus on the first shirt with no chosen size");
    assert.equal(listings.length, before, "nothing sent");
    for (const d of without5) await page.uncheck(`#ls-blank-${d.id}`);
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-result");
    assert.equal(listings.at(-1).refused, undefined, `server would refuse: ${listings.at(-1).refused}`);
    assert.equal(listings.at(-1).variants, with5[0].colors.length);
    await page.click("#ls-done");
    PRODUCTS.ed.pop();
  });

  await step("list a design: markup bounds and cents, negative markup, and price rounding match the server", async () => {
    await openSheet("palmetto");
    const before = listings.length;
    for (const bad of ["100.01", "-10.5", "2.555"]) {
      await page.fill("#ls-markup", bad);
      await page.click("#ls-submit");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-markup", `${bad} caught`);
    }
    assert.equal(listings.length, before, "nothing sent for a bad markup");
    await page.fill("#ls-markup", "-10");
    const lo = offerOf(DEFAULTS).lo;
    assert.match(await page.locator("#ls-summary").textContent(), new RegExp(`${usd(lo - 10)} to `), `${lo} - 10`);
    await page.fill("#ls-markup", "0.1");
    assert.match(await page.locator("#ls-summary").textContent(), new RegExp(`, ${usd(Math.round((lo + 0.1) * 100) / 100)} to `), "no float noise");
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-result");
    assert.equal(listings.at(-1).markup, 0.1);
    assert.equal(listings.at(-1).refused, undefined);
    await page.click("#ls-done");
    PRODUCTS.ed.pop();
  });

  await step("list a design: a very long design name gives a valid listing and fits at 390", async () => {
    const long = `${"Supercalifragilistic".repeat(8)} lowcountry heron at dusk over the marsh with a very long file name indeed.png`;
    images.set("mh2k6c-0a0b0c0d", { key: "mh2k6c-0a0b0c0d", name: long, type: "image/png", size: 68, tags: "", added: 2000 });
    await page.fill("#lib-q", "");
    await page.click("#lib-refresh");
    await page.waitForSelector('.lcard[data-key="mh2k6c-0a0b0c0d"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await noOverflow("long name card 390");
    await page.locator('.lcard[data-key="mh2k6c-0a0b0c0d"] button[data-act="list"]').click();
    await page.waitForSelector("#list-sheet[open] #ls-title");
    const t = await page.inputValue("#ls-title");
    assert.ok(t.length <= 120 && t.length >= 2, `title ${t.length}`);
    assert.ok((await page.inputValue("#ls-seo-title")).length <= 60);
    assert.ok((await page.inputValue("#ls-seo-desc")).length <= 155);
    const wide = await page.evaluate(() => [...document.querySelectorAll("#list-sheet *")].filter((e) => e.getBoundingClientRect().right > 390.5).map((e) => e.id || e.className || e.tagName));
    assert.deepEqual(wide, [], "nothing in the sheet sticks out");
    await page.click("#ls-submit");
    await page.waitForSelector("#ls-result");
    assert.equal(listings.at(-1).refused, undefined, `server would refuse: ${listings.at(-1).refused}`);
    await page.click("#ls-done");
    PRODUCTS.ed.pop();
    images.delete("mh2k6c-0a0b0c0d");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#lib-refresh");
    await page.waitForSelector('.lcard:has-text("palmetto moon")');
  });

  await step("list a design: keyboard only: open, move through, close, focus returns", async () => {
    await page.locator("#lib-refresh").focus();
    await page.waitForSelector(".lcard button");
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      await page.keyboard.press("Tab");
      found = await page.evaluate(() => document.activeElement?.dataset.act === "list");
    }
    assert.ok(found, "Tab reaches Add to Elevated Designs");
    const opener = await page.evaluate(() => document.activeElement.closest(".lcard").dataset.key);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#list-sheet[open] #ls-title");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-title");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "ls-markup");
    // Tab to a shirt not yet offered and pick it with Space
    let at = null;
    for (let i = 0; i < 200 && at !== `ls-blank-${EXTRA}`; i++) { await page.keyboard.press("Tab"); at = await page.evaluate(() => document.activeElement?.id); }
    assert.equal(at, `ls-blank-${EXTRA}`, "Tab reaches each shirt");
    await page.keyboard.press("Space");
    assert.equal(await page.locator(`#ls-blank-${EXTRA}`).isChecked(), true);
    assert.match(await page.locator("#ls-count").textContent(), new RegExp(`^${offerOf([...DEFAULTS, preset(EXTRA)]).variants} variants`));
    let reached = false;
    for (let i = 0; i < 300 && !reached; i++) { await page.keyboard.press("Tab"); reached = await page.evaluate(() => document.activeElement?.id === "ls-submit"); }
    assert.ok(reached, "List it reachable by Tab");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#list-sheet[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.closest(".lcard")?.dataset.key), opener, "focus back on the button that opened it");
  });

  await step("list a design: with no key, List it asks for it, then lists", async () => {
    await page.evaluate(() => sessionStorage.removeItem("bc-console-key"));
    await openSheet("palmetto");
    await page.click("#ls-submit");
    await page.waitForSelector("dialog.keydlg[open]");
    await page.fill("#key-in", KEY);
    await page.click("#key-save");
    await page.waitForSelector("#ls-result");
    assert.equal(await page.locator("#ls-view").getAttribute("href"), "https://elevatedshirts.com/products/palmetto-moon-tee");
    await page.click("#ls-done");
  });

  await step("list a design and customizable: no horizontal overflow at 390 and 1280", async () => {
    await noOverflow("ed products 1280");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow("ed products 390");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "ed-list-panel-390.png"), fullPage: true }); }
    await openSheet("lowcountry");
    assert.equal(await page.locator("dialog#list-sheet").count(), 1, "one sheet however often the page is drawn");
    const box = await page.locator("#list-sheet").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `sheet fits the phone: ${JSON.stringify(box)}`);
    const wide = await page.evaluate(() => [...document.querySelectorAll("#list-sheet *")].filter((e) => e.getBoundingClientRect().right > 390.5).map((e) => e.id || e.tagName));
    assert.deepEqual(wide, [], "nothing in the sheet sticks out");
    await noOverflow("sheet 390");
    if (SCREENS) await page.screenshot({ path: path.join(SCREENS, "ed-list-sheet-390.png") });
    await page.keyboard.press("Escape");
    await page.click('.seg-btn[data-store="c3d"]');
    await page.waitForSelector('.prow:has-text("Rainbow Row")');
    await noOverflow("c3d products 390");
    const sticking = await page.evaluate(() => [...document.querySelectorAll(".prow *")].filter((e) => e.getBoundingClientRect().right > 390.5).length);
    assert.equal(sticking, 0, "rows with two switches fit");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "products-c3d-customizable-390.png"), fullPage: true }); }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("list a design: Elevated Designs page links straight to it; Service Map shows the route", async () => {
    await page.click('a.nav[data-route="ed"]');
    await page.click(".quick a:has-text('List a design')");
    await page.waitForSelector('.lcard:has-text("palmetto")');
    assert.equal(await page.locator('.seg-btn[data-store="ed"]').getAttribute("aria-pressed"), "true");
    const top = await page.locator("#list-design").evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(top < 900, `panel scrolled into view (${top})`);
    await page.click('a.nav[data-route="c3d"]');
    assert.equal(await page.locator(".quick a", { hasText: "List a design" }).count(), 0, "no listing link on Charleston 3D");
    await page.click('a.nav[data-route="map"]');
    assert.match(await page.locator(".route.brand-ed").textContent(), /List in one click/);
    assert.match(await page.locator(".route.brand-c3d").textContent(), /set customizable/);
  });

  await step("service map: system topology shows every layer, jumps to what a node feeds, and fits at 390", async () => {
    await page.click('a.nav[data-route="map"]');
    await page.waitForSelector(".topology .topo-node");
    const layers = await page.locator(".topo-layer h3").allTextContents();
    assert.deepEqual(layers, ["Domains and DNS", "What customers use", "Stores (all payments)", "Back office (Cloudflare)", "Code and deploys (GitHub)", "Outside tools", "Planned: home lab"]);
    assert.match(await page.locator("#topo-dns-c3d").textContent(), /DNS managed at Wix.*→ Charleston3D app · app\. CNAME/s);
    assert.match(await page.locator("#topo-openclaw").textContent(), /Planned.*Beelink SER9 Pro/s);
    await page.locator("#topo-gh-console .chip").click();
    await page.waitForFunction(() => document.activeElement?.id === "topo-console");
    assert.equal(await page.locator("#topo-console a", { hasText: "Open console" }).getAttribute("href"), "https://business-console.business-console.workers.dev");
    const ids = await page.locator(".topo-to .chip").count();
    assert.ok(ids >= 20, "every connection is drawn");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow("topology 390");
    if (SCREENS) await page.locator(".topology").screenshot({ path: path.join(SCREENS, "topology-390.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (SCREENS) await page.locator(".topology").screenshot({ path: path.join(SCREENS, "topology-1280.png") });
  });

  // ---------- marketing ----------
  const mkPosts = [];
  const mkFixes = [{ id: "20261026113000-aaaaaaaa", store: "c3d", source: "auto", kind: "seo", itemKind: "product", target: "gid://shopify/Product/5", title: "Palmetto Keychain", url: "https://charleston3d.com/products/palmetto-keychain", at: "2026-10-26T11:30:00Z",
    before: { seoTitle: "", seoDescription: "Keychain." }, after: { seoTitle: "Palmetto Keychain, Charleston SC | Charleston3D", seoDescription: "Keychain." } },
    { id: "20261001113000-bbbbbbbb", store: "c3d", source: "console", kind: "seo", itemKind: "collection", target: "gid://shopify/Collection/2", title: "Ornaments", url: "https://charleston3d.com/collections/ornaments", at: "2026-10-01T15:00:00Z",
      before: { seoTitle: "", seoDescription: "" }, after: { seoTitle: "Ornaments | Charleston3D", seoDescription: "" } }];
  const mkDay = (i) => new Date(Date.UTC(2026, 9, 26) - i * 86400000).toISOString().slice(0, 10);
  const mkGrowth = (store, days) => ({ store, days, site: "https://charleston3d.com",
    series: Array.from({ length: days }, (_, k) => { const i = days - 1 - k; return { date: mkDay(i), sessions: 20 + (k % 7), visitors: 18, cartAdds: k % 3, checkouts: k % 4 ? 0 : 1, orders: k % 9 ? 0 : 1, revenue: k % 9 ? 0 : 24.5, duration: 40 + (k % 5), bounce: 60,
      googleClicks: null, googleImpressions: null, bingClicks: k % 2, bingImpressions: 10, ga4Engagement: null, ga4EngagedTime: null, health: i < 2 ? 80 : null }; }),
    totals: { sessions: { last30: 690, prev30: 600, change: 15 }, cartAdds: { last30: 30, prev30: 30, change: 0 }, checkouts: { last30: 8, prev30: 10, change: -20 }, orders: { last30: 3, prev30: 0, change: null }, revenue: { last30: 73.5, prev30: 0, change: null }, googleClicks: { last30: 0, prev30: 0, change: null }, bingClicks: { last30: 15, prev30: 10, change: 50 } },
    changes: mkFixes.filter((f) => f.store === store).map((f) => ({ ...f, effect: f.id.startsWith("20261026") ? { days: 0, early: true, beforePerDay: 3, afterPerDay: null, change: null } : { days: 14, early: false, beforePerDay: 2, afterPerDay: 3, change: 50 } })),
    sources: { shop: { available: true }, google: { connected: false, note: "Connect Google Search Console to chart Google clicks." }, bing: { connected: true }, ga4: { connected: false, note: "Connect Google Analytics to chart time on site and engagement." } } });
  let mkKeywords = ["3d printing charleston", "charleston souvenirs"];
  const mkAudit = (store) => ({
    store, site: store === "ed" ? "https://elevatedshirts.com" : "https://charleston3d.com", checkedAt: "2026-10-26T11:00:00Z",
    scores: { overall: 82, seo: 90, geo: 100, bing: 60, ai: 85, analytics: 50 },
    checks: [
      { area: "seo", id: "domain", level: "fail", title: "elevatedshirts.com redirects to theelevateddesignsllc.com", detail: "https://theelevateddesignsllc.com/", fix: "In Shopify Settings > Domains make elevatedshirts.com the primary domain." },
      { area: "bing", id: "bing-verify", level: "warn", title: "No Bing verification code", detail: "", fix: "Paste it in Site settings below." },
      { area: "seo", id: "home-title", level: "pass", title: "Home page title is 54 characters", detail: "", fix: "" },
    ],
    pages: [{ kind: "home", url: "https://charleston3d.com/", title: "Charleston3D | 3D Printed Gifts Made in Charleston, SC", description: "Custom 3D printed gifts made in Charleston." }],
    sitemapCount: 17, history: [{ date: "2026-10-25", scores: { overall: 78, seo: 85, geo: 100, bing: 60, ai: 80, analytics: 50 } }, { date: "2026-10-26", scores: { overall: 82, seo: 90, geo: 100, bing: 60, ai: 85, analytics: 50 } }],
    previous: { date: "2026-10-25", scores: { overall: 78, seo: 85, geo: 100, bing: 60, ai: 85, analytics: 50 } }, newProblems: ["domain"], fixed: ["h1"], historyAvailable: true,
    indexNow: { key: "c3dkey12345678", own: true },
  });
  const mkCatalog = { summary: { total: 2, ok: 1, noSeoTitle: 1, noSeoDescription: 1, noAlt: 1 }, truncated: false, items: [
    { kind: "product", id: "gid://shopify/Product/1", title: "Rainbow Row Ornament", url: "https://charleston3d.com/products/rainbow-row-ornament", image: "", seoTitle: "", seoDescription: "", shownTitle: "Rainbow Row Ornament", mediaId: "gid://shopify/MediaImage/9", alt: "",
      suggestion: { title: "Rainbow Row Ornament, Charleston SC | Charleston3D", description: "A 3D printed Rainbow Row ornament made in Charleston, SC." },
      issues: [{ field: "title", level: "warn", text: "No SEO title" }, { field: "description", level: "warn", text: "No SEO description" }, { field: "alt", level: "warn", text: "Photo has no alt text" }] },
    { kind: "collection", id: "gid://shopify/Collection/2", title: "Ornaments", url: "https://charleston3d.com/collections/ornaments", image: "", seoTitle: "Ornaments | Charleston3D", seoDescription: "Handmade 3D printed ornaments from Charleston, SC, personalized with any name.", shownTitle: "Ornaments | Charleston3D", mediaId: null, alt: "",
      suggestion: { title: "Ornaments, Charleston SC | Charleston3D", description: "x" }, issues: [] },
  ] };
  const mkSettings = { theme: { id: "gid://shopify/OnlineStoreTheme/1", name: "Charleston3D" },
    fields: { home_title: { label: "Home page title", group: "search", max: 70 }, bing_verification: { label: "Bing verification code", group: "search", max: 32 }, city: { label: "City", group: "geo", max: 60 }, ga4_id: { label: "Google Analytics 4 ID", group: "analytics", max: 20 } },
    settings: { home_title: "Charleston3D | 3D Printed Gifts Made in Charleston, SC", bing_verification: "", city: "Charleston", ga4_id: "" } };
  const mkTraffic = { shop: { available: true, sources: [{ source: "search", name: "Google", sessions: 30, conversionRate: 3.3 }, { source: "direct", name: "", sessions: 10, conversionRate: null }],
      campaigns: [{ source: "qr", medium: "print", campaign: "ed-builder", sessions: 4, conversionRate: 0 }] },
    google: { connected: false, note: "Connect Google Search Console to see Google searches here (see the setup guide)." },
    bing: { connected: true, clicks: 3, impressions: 120, start: "2026-09-26", end: "2026-10-25", queries: [{ query: "charleston 3d printing", impressions: 60, clicks: 2, position: 7.5 }], opportunities: [{ query: "charleston 3d printing", position: 7.5 }] } };
  await page.route("**/api/marketing**", async (route) => {
    const req = route.request();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    if (req.method() === "GET") {
      const u = new URL(req.url());
      const store = u.searchParams.get("store"), part = u.searchParams.get("part");
      if (part === "audit") return json(200, mkAudit(store));
      if (part === "catalog") return json(200, mkCatalog);
      if (part === "settings") return json(200, mkSettings);
      if (part === "traffic") return json(200, mkTraffic);
      if (part === "changes") return json(200, { store, auto: true, logAvailable: true, changes: mkFixes.filter((f) => f.store === store) });
      if (part === "growth") return json(200, mkGrowth(store, Number(u.searchParams.get("days") || 90)));
      if (part === "google") return json(200, store === "ed" ? { store, connected: false, note: "Connect Google Search Console to see your pages, sitemaps and indexing here (see the setup guide)." } : { store, connected: true,
        property: "sc-domain:charleston3d.com", start: "2026-09-26", end: "2026-10-24", serviceAccount: "console@proj.iam.gserviceaccount.com",
        pages: [{ page: "https://charleston3d.com/products/rainbow-row-ornament", clicks: 4, impressions: 120, ctr: 3.3, position: 8.4 }],
        devices: [{ device: "mobile", clicks: 3, impressions: 90, ctr: 3.3, position: 9 }, { device: "desktop", clicks: 1, impressions: 30, ctr: 3.3, position: 7 }],
        sitemaps: [], home: { url: "https://charleston3d.com/", verdict: "pass", coverage: "Submitted and indexed", lastCrawl: "2026-10-20T00:00:00Z" } });
      if (part === "keywords") return json(200, { store, saveAvailable: true, keywords: mkKeywords.map((k, i) => ({ keyword: k, google: i ? null : { clicks: 4, impressions: 120, position: 8.4, page: "https://charleston3d.com/pages/custom", searches: 3 }, googlePrev: null, bing: { clicks: 1, impressions: 9, position: 5, page: "", searches: 1 }, moved: i ? null : 2.1 })),
        sources: { google: { connected: true }, bing: { connected: true } } });
      return json(400, { error: "bad part" });
    }
    const b = JSON.parse(req.postData());
    mkPosts.push(b);
    if (b.action === "seo") return json(200, { seoTitle: b.seoTitle, seoDescription: b.seoDescription, indexNow: { sent: true } });
    if (b.action === "alt") return json(200, { alt: b.alt });
    if (b.action === "settings") return json(200, { settings: { ...mkSettings.settings, ...b.values }, changed: Object.keys(b.values) });
    if (b.action === "autofix") {
      mkFixes.unshift({ id: "20261026120000-cccccccc", store: b.store, source: "auto", kind: "alt", itemKind: "product", target: "gid://shopify/MediaImage/9", title: "Rainbow Row Ornament", url: "https://charleston3d.com/products/rainbow-row-ornament", at: "2026-10-26T12:00:00Z", before: { alt: "" }, after: { alt: "Rainbow Row Ornament from Charleston3D" } });
      return json(200, { store: b.store, applied: [mkFixes[0]], failed: [], remaining: 0, indexNow: { sent: true } });
    }
    if (b.action === "undo") {
      const c = mkFixes.find((f) => f.id === b.changeId);
      c.review = { verdict: "undo", by: "you" };
      mkFixes.unshift({ id: "20261026130000-dddddddd", store: b.store, source: "console", kind: "revert", itemKind: c.itemKind, target: c.target, title: c.title, url: c.url, at: "2026-10-26T13:00:00Z", before: c.after, after: c.before, note: "Undone on the Marketing page." });
      return json(200, { store: b.store, undone: c.id, entry: mkFixes[0] });
    }
    if (b.action === "keywords") { mkKeywords = b.keywords.map((k) => k.toLowerCase()); return json(200, { store: b.store, keywords: mkKeywords }); }
    if (b.action === "indexnow") return json(200, { store: b.store, indexNow: { sent: true, status: 200, count: 17 } });
    if (b.action === "sitemap") return json(200, { store: b.store, submitted: "https://charleston3d.com/sitemap.xml" });
    if (b.action === "inspect") return json(200, { store: b.store, url: b.url, verdict: "neutral", coverage: "Discovered - currently not indexed", lastCrawl: null, link: "https://search.google.com/x" });
    return json(400, { error: "bad action" });
  });

  await step("marketing: health check, trend, fixes and the home page search preview", async () => {
    await page.click('a.nav[data-route="marketing"]');
    await page.waitForSelector(".checks .check");
    assert.equal(await page.locator('a.nav[data-route="marketing"]').getAttribute("aria-current"), "page");
    assert.match(await page.locator(".tile").first().textContent(), /Overall\s*82.*▲ 4 since last check/s);
    assert.match(await page.locator("h3", { hasText: "to fix or improve" }).textContent(), /2 things/);
    const first = page.locator(".checks .check").first();
    assert.match(await first.textContent(), /Fix.*redirects to theelevateddesignsllc\.com.*New.*Settings > Domains/s);
    assert.match(await page.locator("text=1 new problem since 2026-10-25").textContent(), /new problem/);
    assert.match(await page.locator(".serp").first().textContent(), /charleston3d\.com.*Charleston3D \| 3D Printed Gifts/s);
  });

  await step("marketing: growth tiles and a daily chart with change flags, by metric and days", async () => {
    const grow = page.locator(".panel", { hasText: "Growth" }).first();
    await grow.locator(".chart svg").waitFor();
    assert.match(await grow.locator(".tiles").textContent(), /Visits\s*690.*▲ 15% vs the 30 days before.*Sales\s*\$73\.50.*Bing clicks\s*15/s);
    assert.ok(!/Google clicks/.test(await grow.locator(".tiles").textContent()), "Google isn't connected, so no Google tile");
    assert.equal(await grow.locator(".chart .mark").count(), 2, "one flag per day something changed");
    assert.equal(await grow.locator('.chip[data-k="googleClicks"]').count(), 0);
    await grow.locator('.chip[data-k="revenue"]').click();
    assert.equal(await grow.locator('.chip[data-k="revenue"]').getAttribute("aria-pressed"), "true");
    await grow.locator(".chart").focus();
    await page.keyboard.press("End");
    assert.match(await grow.locator(".tip").textContent(), /Oct 26: \$0\.00 · Changed: Palmetto Keychain/);
    assert.match(await grow.textContent(), /Connect Google Search Console to chart Google clicks/);
    await grow.locator(".chip", { hasText: "30 days" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".panel")].some((p) => /Growth/.test(p.textContent) && p.querySelector('.chip[aria-pressed="true"]')?.textContent === "Sales" && [...p.querySelectorAll(".chip")].find((c) => c.textContent === "30 days")?.getAttribute("aria-pressed") === "true"));
    await grow.locator('.chip[data-k="sessions"]').click();
  });

  await step("marketing: every change is logged with its effect, Apply now runs fixes, and Undo puts the old value back", async () => {
    const log = page.locator(".panel", { hasText: "Changes and what they did" });
    await log.locator("a", { hasText: "Palmetto Keychain" }).waitFor();
    await log.locator("text=Visits to this page").waitFor();
    assert.match(await log.textContent(), /never changed.*Auto.*Palmetto Keychain.*SEO title: \(empty\) → Palmetto Keychain, Charleston SC \| Charleston3D.*Too early to tell.*You.*Ornaments.*Visits to this page: 2\/day before → 3\/day since \(\+50%\)/s);
    assert.ok(!/SEO description/.test(await log.locator(".check").first().textContent()), "unchanged fields aren't listed");
    await log.locator("button", { hasText: "Apply safe fixes now" }).click();
    assert.equal(mkPosts.filter((p) => p.action === "autofix").length, 0, "the first click only asks");
    await log.locator("button", { hasText: "Click again to change the live site" }).click();
    await page.waitForSelector("text=Applied 1 fix");
    await page.waitForSelector(".panel:has-text('Changes and what they did') >> text=Photo alt text");
    assert.deepEqual(mkPosts.find((p) => p.action === "autofix"), { store: "c3d", action: "autofix" });
    const orn = page.locator(".panel:has-text('Changes and what they did') .check", { hasText: "Ornaments" });
    await orn.locator("button", { hasText: "Undo" }).click();
    await orn.locator("button", { hasText: "Click again to put it back" }).click();
    await page.waitForSelector("text=Put back: Ornaments");
    assert.deepEqual(mkPosts.find((p) => p.action === "undo"), { store: "c3d", action: "undo", changeId: "20261001113000-bbbbbbbb" });
    await page.waitForSelector(".panel:has-text('Changes and what they did') >> text=You undid this.");
    const first = page.locator(".panel:has-text('Changes and what they did') .check").first();
    assert.match(await first.textContent(), /Undone.*Ornaments.*Undone on the Marketing page/s);
    assert.equal(await first.locator("button", { hasText: "Undo" }).count(), 0, "an undo can't itself be undone from the log");
  });

  await step("marketing: keywords show Google position and movement, and the list can be changed", async () => {
    const kw = page.locator(".panel", { hasText: "Keywords" }).first();
    await kw.locator("td", { hasText: "3d printing charleston" }).waitFor();
    assert.match(await kw.locator("tbody tr").first().textContent(), /3d printing charleston\s*8\.4\s*▲ 2\.1\s*4\s*120\s*1\s*\/pages\/custom/);
    await kw.locator("summary", { hasText: "Change the keywords" }).click();
    await kw.locator("textarea").fill("3d printing charleston\nCustom Ornaments");
    await kw.locator("button", { hasText: "Save keywords" }).click();
    await page.waitForSelector("text=Tracking 2 keywords");
    assert.deepEqual(mkPosts.find((p) => p.action === "keywords").keywords, ["3d printing charleston", "Custom Ornaments"]);
    await page.locator(".panel:has-text('Keywords') td", { hasText: "custom ornaments" }).waitFor();
  });

  await step("marketing: edit a product's SEO with the suggestion and save alt text", async () => {
    await page.waitForSelector(".seo-row");
    assert.equal(await page.locator(".seo-row").count(), 1, "Needs work shows only items with issues");
    const row = page.locator(".seo-row").first();
    await row.locator("summary").click();
    await row.locator("button", { hasText: "Use suggestion" }).click();
    assert.match(await row.locator(".serp-title").textContent(), /Rainbow Row Ornament, Charleston SC \| Charleston3D/);
    await row.locator("button", { hasText: /^Save$/ }).click();
    await page.waitForSelector("text=Saved and sent to Bing: Rainbow Row Ornament");
    const seo = mkPosts.find((p) => p.action === "seo");
    assert.deepEqual([seo.store, seo.id, seo.seoTitle], ["c3d", "gid://shopify/Product/1", "Rainbow Row Ornament, Charleston SC | Charleston3D"]);
    const row2 = page.locator(".seo-row").first();
    await row2.locator("summary").click();
    await row2.locator('input[aria-label^="Alt text"]').fill("Rainbow Row ornament in pastel colors");
    await row2.locator("button", { hasText: "Save alt text" }).click();
    await page.waitForSelector("text=Alt text saved: Rainbow Row Ornament");
    const alt = mkPosts.find((p) => p.action === "alt");
    assert.deepEqual([alt.mediaId, alt.productId], ["gid://shopify/MediaImage/9", "gid://shopify/Product/1"]);
    await page.click('.chip[data-k="all"]');
    assert.equal(await page.locator(".seo-row").count(), 2);
  });

  await step("marketing: site settings send only what changed", async () => {
    await page.fill("#mk-bing_verification", "0123456789ABCDEF0123456789ABCDEF");
    await page.click("button:has-text('Save to the live site')");
    await page.waitForSelector("text=Saved 1 setting.");
    assert.deepEqual(mkPosts.find((p) => p.action === "settings").values, { bing_verification: "0123456789ABCDEF0123456789ABCDEF" });
  });

  await step("marketing: traffic, QR campaigns and Bing searches", async () => {
    await page.waitForSelector("td:has-text('ed-builder')");
    assert.match(await page.locator("text=Closest to page 1").locator("..").textContent(), /charleston 3d printing.*#7\.5/);
    assert.match(await page.locator("text=Connect Google Search Console to see Google searches").first().textContent(), /setup guide/);
  });

  await step("marketing: UTM builder only allows the brand's own site", async () => {
    await page.fill("#utm-campaign", "Holiday Market");
    assert.equal(await page.locator(".utm-out").textContent(), "https://charleston3d.com/?utm_source=qr&utm_medium=print&utm_campaign=holiday-market");
    await page.fill("#utm-page", "https://elevatedshirts.com/");
    assert.match(await page.locator(".utm-out").textContent(), /Use a page on charleston3d\.com/);
    assert.equal(await page.locator(".utm-out ~ button, button:has-text('Copy link')").first().isDisabled(), true);
  });

  await step("marketing: switching to Elevated Designs reloads that store; no overflow at 1280 and 390", async () => {
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector(".checks .check");
    assert.match(await page.locator(".panel").first().textContent(), /elevatedshirts\.com/);
    await noOverflow("marketing 1280");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "marketing-1280.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow("marketing 390");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "marketing-390.png"), fullPage: true }); }
    await page.setViewportSize({ width: 1280, height: 900 });
  });


  await step("marketing: Search Console pages, home page indexing, sitemap submit and page check", async () => {
    await page.click('.seg-btn[data-store="c3d"]');
    await page.locator(".marketing .sr[role=status]", { hasText: "Charleston 3D marketing loaded." }).waitFor({ state: "attached" });
    assert.equal(await page.locator(".marketing [aria-live]").count(), 0, "one status for the page, no live panels");
    assert.ok(!(await page.locator("#mk-run").isDisabled()), "Check again is back once everything loaded");
    await page.locator(".jump a", { hasText: "Google Search Console" }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "mk-google");
    assert.match(page.url(), /#marketing/, "jump links don't change the route");
    const gsc = page.locator("#mk-google");
    await gsc.locator("table").waitFor();
    assert.match(await gsc.textContent(), /mobile: 3 clicks \(75%\).*Indexed.*Submitted and indexed.*\/products\/rainbow-row-ornament.*3\.3%.*Google has no sitemap/s);
    await gsc.locator("button", { hasText: "Submit sitemap to Google" }).click();
    await gsc.locator("text=Submitted https://charleston3d.com/sitemap.xml.").waitFor();
    await gsc.locator('input[aria-label="Page address to check"]').fill("https://charleston3d.com/products/rainbow-row-ornament");
    await gsc.locator("button", { hasText: "Is it in Google?" }).click();
    await gsc.locator("text=Discovered - currently not indexed").waitFor();
    assert.deepEqual(mkPosts.slice(-2).map((b) => b.action), ["sitemap", "inspect"]);
    assert.ok(await gsc.locator("a", { hasText: "Merchant Center" }).count());
  });

  // ---------- promotions ----------
  const prPosts = [];
  const prData = (store) => ({ store, admin: `https://admin.shopify.com/store/${store === "c3d" ? "charleston3d" : "elevated-designs"}`,
    discounts: { items: [{ id: "gid://shopify/DiscountCodeNode/11", automatic: false, kind: "amount", title: "Market 15", code: "MARKET15", status: "active", summary: "15% off entire order", startsAt: "2026-10-01T00:00:00Z", endsAt: null, used: 4, admin: "https://admin.shopify.com/store/x/discounts/11" }] },
    giftCards: { error: "Add the read_gift_cards and write_gift_cards scopes to the store's app to use this.", code: "access_denied", scopes: ["read_gift_cards", "write_gift_cards"] },
    segments: { items: [{ id: "gid://shopify/Segment/7", name: "Email subscribers", query: "email_subscription_status = 'SUBSCRIBED'", admin: "https://admin.shopify.com/store/x/customers/segments/7" }] },
    campaigns: { items: [] },
    channels: { items: { installed: ["Online Store", "Google & YouTube"], ads: [{ name: "Google & YouTube", app: "https://apps.shopify.com/google", installed: true }, { name: "TikTok", app: "https://apps.shopify.com/tiktok", installed: false }] } },
    abandoned: { items: [{ id: "a", createdAt: "2026-10-21T09:55:34Z", url: "https://elevatedshirts.com/checkouts/x/recover", total: { amount: 27.99, currency: "USD" }, customer: null, items: ["1 × Crest Tee"] }] },
    adminOnly: [{ name: "Shopify Email", why: "Email campaigns.", url: "https://admin.shopify.com/store/x/apps/shopify-email" }, { name: "Marketing automations", why: "Abandoned cart emails.", url: "https://admin.shopify.com/store/x/marketing/automations" }],
    templates: [{ name: "Loyal: 3+ orders", query: "number_of_orders >= 3" }] });
  await page.route("**/api/promotions**", async (route) => {
    const req = route.request();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.headers()["x-console-key"] !== KEY) return json(401, { error: "Wrong or missing console key.", code: "bad_key" });
    if (req.method() === "GET") return json(200, prData(new URL(req.url()).searchParams.get("store")));
    const b = JSON.parse(req.postData());
    prPosts.push(b);
    return json(200, { store: b.store, action: b.action, id: "gid://shopify/DiscountCodeNode/21", logged: true });
  });

  await step("promotions: discounts, a missing permission, channels, abandoned checkouts and admin-only tools", async () => {
    await page.click('a.nav[data-route="promote"]');
    await page.waitForSelector("#promo-discount");
    assert.equal(await page.locator('a.nav[data-route="promote"]').getAttribute("aria-current"), "page");
    const disc = page.locator(".panel", { hasText: "Discounts" }).first();
    assert.match(await disc.locator("tbody").textContent(), /Market 15.*15% off entire order.*MARKET15.*On.*4/s);
    assert.match(await page.locator(".panel", { hasText: "Gift cards" }).first().textContent(), /needs a permission.*read_gift_cards, write_gift_cards/s);
    assert.equal(await page.locator("#promo-giftcard").count(), 0, "no gift card form without the scope");
    assert.match(await page.locator(".panel", { hasText: "Sales channels" }).first().textContent(), /Online Store, Google & YouTube.*Connected.*TikTok.*Add channel/s);
    assert.match(await page.locator(".panel", { hasText: "Abandoned checkouts" }).first().textContent(), /\$27\.99 left in 1 checkout/);
    assert.match(await page.locator(".panel", { hasText: "Only in Shopify" }).first().textContent(), /Shopify Email.*Marketing automations/s);
  });

  await step("promotions: create a code discount, turn one off (two clicks to delete), and add a customer group", async () => {
    const form = page.locator("#promo-discount");
    await form.locator("button", { hasText: "Create discount" }).click();
    await form.locator("text=Name (shown at checkout) is needed.").waitFor();
    assert.equal(await form.locator('[name="title"]').getAttribute("aria-invalid"), "true");
    await form.locator('[name="title"]').fill("Holiday market");
    await form.locator('[name="code"]').fill("no spaces allowed");
    await form.locator('[name="value"]').fill("20");
    await form.locator("button", { hasText: "Create discount" }).click();
    await form.locator("text=Code must be 3 to 40 letters").waitFor();
    assert.equal(prPosts.length, 0, "nothing is sent until the form is right");
    await form.locator('[name="code"]').fill("market20");
    await form.locator('[name="value"]').fill("20");
    await form.locator('[name="minSubtotal"]').fill("30");
    await form.locator('[name="segmentId"]').selectOption("gid://shopify/Segment/7");
    await form.locator("button", { hasText: "Create discount" }).click();
    await page.waitForFunction(() => document.querySelector("#promo-discount") && !document.querySelector("#promo-discount button[disabled]"));
    await page.waitForTimeout(200);
    const made = prPosts.find((b) => b.action === "discount");
    assert.deepEqual({ ...made, startsAt: undefined }, { store: "c3d", action: "discount", method: "code", type: "percentage", title: "Holiday market", code: "market20", oncePerCustomer: false, value: 20, minSubtotal: 30, segmentId: "gid://shopify/Segment/7", startsAt: undefined });
    // Automatic hides the code fields; free shipping hides the value.
    await page.locator('#promo-discount [name="method"]').selectOption("automatic");
    assert.ok(await page.locator('#promo-discount [name="code"]').isHidden());
    await page.locator('#promo-discount [name="type"]').selectOption("shipping");
    assert.ok(await page.locator('#promo-discount [name="value"]').isHidden());
    const row = page.locator(".panel", { hasText: "Discounts" }).first().locator("tbody tr").first();
    await row.locator("button", { hasText: "Turn off" }).click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(200);
    assert.deepEqual(prPosts.find((b) => b.action === "discountStatus"), { store: "c3d", action: "discountStatus", id: "gid://shopify/DiscountCodeNode/11", active: false });
    const del = page.locator(".panel", { hasText: "Discounts" }).first().locator("tbody tr").first().locator("button", { hasText: "Delete" });
    await del.click();
    assert.equal(prPosts.filter((b) => b.action === "discountDelete").length, 0, "the first click only asks");
    await page.locator("button", { hasText: "Click again to delete" }).click();
    await page.waitForTimeout(200);
    assert.equal(prPosts.filter((b) => b.action === "discountDelete").length, 1);
    const seg = page.locator("#promo-segment");
    await seg.locator("select").selectOption({ label: "Loyal: 3+ orders" });
    assert.equal(await seg.locator("textarea").inputValue(), "number_of_orders >= 3");
    await seg.locator("button", { hasText: "Create group" }).click();
    await page.waitForTimeout(200);
    assert.deepEqual(prPosts.find((b) => b.action === "segment"), { store: "c3d", action: "segment", name: "Loyal: 3+ orders", query: "number_of_orders >= 3" });
  });

  await step("promotions: switching stores, no overflow at 1280 and 390", async () => {
    await page.click('.seg-btn[data-store="ed"]');
    await page.waitForSelector("#promo-discount");
    await page.locator(".promotions .sr[role=status]", { hasText: "Elevated Designs promotions loaded." }).waitFor({ state: "attached" });
    await noOverflow("promotions 1280");
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "promotions-1280.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow("promotions 390");
    // The discount table becomes cards, so the actions are on screen without sideways scrolling.
    const del = page.locator(".panel", { hasText: "Discounts" }).first().locator("button", { hasText: "Delete" }).first();
    const box = await del.boundingBox();
    assert.ok(box && box.x + box.width <= 390, `Delete is on screen (${JSON.stringify(box)})`);
    if (SCREENS) { await clearToasts(); await page.screenshot({ path: path.join(SCREENS, "promotions-390.png"), fullPage: true }); }
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

