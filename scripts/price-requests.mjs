// Makes the price changes Aaron confirmed with Steve (agents/steve-web/price_change.py). Runs every minute on the NUC
// (task "Creative Lab price requests"), because the NUC already holds the console key and the Blink must not.
//
// For each confirmed request on the Blink it checks again before touching the store:
//   - the request is fresh (10 minutes) and well formed, with a sane price,
//   - the product is in that store's public product list at exactly the "from" price Aaron was shown,
// then it asks the engine (POST /api/products { store, id, price }), which applies its own rules, and reports the
// outcome back to the Blink, where Steve tells Aaron on his next message. Nothing here ever prints the key.
//
//   node scripts/price-requests.mjs            one pass (does nothing when there are no requests)
//   node scripts/price-requests.mjs --dry      shows what it would do, changes nothing
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "../drive-server/key.mjs";

const BLINK = "aaronlewis@100.70.128.45";
const ENGINE = "https://creative-lab-engine.business-console.workers.dev";
export const SITES = { c3d: "https://charleston3d.com", ed: "https://elevatedshirts.com" };
export const MAX_AGE_MS = 10 * 60 * 1000, PRICE_MIN = 0.5, PRICE_MAX = 5000, MAX_PER_PASS = 5;

// Why a request must not be carried out, in words Steve can repeat. null = it may go ahead.
export function requestProblem(req, now = Date.now()) {
  if (!req || !/^[a-f0-9]{12}$/.test(String(req.id ?? ""))) return "The request was not readable. Nothing was changed.";
  if (!Object.hasOwn(SITES, req.store)) return "The request named a store that does not exist. Nothing was changed.";
  if (!Number.isInteger(req.product_id) || req.product_id <= 0) return "The request had no product id. Nothing was changed.";
  const at = Date.parse(req.at);
  if (!Number.isFinite(at) || now - at > MAX_AGE_MS || at - now > 60000) return "The request was more than 10 minutes old, so it was dropped. Nothing was changed.";
  for (const k of ["old", "new"]) if (typeof req[k] !== "number" || !Number.isFinite(req[k])) return "The request had a bad price. Nothing was changed.";
  if (req.new < PRICE_MIN || req.new > PRICE_MAX) return `The new price must be from ${PRICE_MIN.toFixed(2)} to ${PRICE_MAX.toFixed(2)}. Nothing was changed.`;
  if (Math.abs(req.new - req.old) < 0.005) return "The new price is the same as the old one. Nothing was changed.";
  return null;
}

// The product's live price from the store's public list, or why it cannot be used.
export function livePriceProblem(products, req) {
  const p = (products ?? []).find((x) => x.id === req.product_id);
  if (!p) return "That product is no longer in the store's public list. Nothing was changed.";
  const prices = [...new Set((p.variants ?? []).map((v) => Number(v.price).toFixed(2)))];
  if (prices.length !== 1) return "That product has different prices by size or option. Change it in Shopify. Nothing was changed.";
  if (prices[0] !== req.old.toFixed(2)) return `The live price is now $${prices[0]}, not the $${req.old.toFixed(2)} you were shown, so I did not change it. Ask again if you still want it changed.`;
  return null;
}

async function storeProducts(store, fetchImpl = fetch) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetchImpl(`${SITES[store]}/products.json?limit=250&page=${page}`, { headers: { "user-agent": "creative-lab-price-requests" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`the store's product list answered ${r.status}`);
    const batch = (await r.json()).products ?? [];
    out.push(...batch);
    if (batch.length < 250) break;
  }
  return out;
}

const ssh = (command, input) => spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", BLINK, command], { input, encoding: "utf8", timeout: 40000 });
const finish = (id, outcome, reason = "") => /ok/.test(String(ssh(`cd ~/steve-web && python3 price_change.py finish ${id} ${outcome}`, reason).stdout ?? ""));

export async function carryOut(req, { key, fetchImpl = fetch, now = Date.now() } = {}) {
  const bad = requestProblem(req, now);
  if (bad) return { ok: false, reason: bad };
  let products;
  try { products = await storeProducts(req.store, fetchImpl); }
  catch (e) { return { ok: false, reason: `I could not read the store's product list (${e.message}). Nothing was changed.` }; }
  const live = livePriceProblem(products, req);
  if (live) return { ok: false, reason: live };
  let r;
  try {
    r = await fetchImpl(`${ENGINE}/api/products`, { method: "POST", signal: AbortSignal.timeout(60000),
      headers: { "content-type": "application/json", "x-console-key": key },
      body: JSON.stringify({ store: req.store, id: `gid://shopify/Product/${req.product_id}`, price: req.new.toFixed(2) }) });
  } catch (e) { return { ok: false, reason: `The engine could not be reached (${e.name}). Nothing was changed.` }; }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, reason: `${body.error ?? `The engine answered ${r.status}.`} Nothing was changed.` };
  return { ok: true, changed: body.changed ?? 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes("--dry");
  const listed = ssh("cd ~/steve-web && python3 price_change.py list");
  let requests = [];
  try { requests = JSON.parse(String(listed.stdout ?? "").trim() || "[]"); } catch { console.error("The Blink's request list was not readable."); process.exit(1); }
  if (!requests.length) process.exit(0);
  const key = dry ? "" : await readKey();
  for (const req of requests.slice(0, MAX_PER_PASS)) {
    if (dry) { console.log(`would change ${req.title} (${req.store}) from ${req.old} to ${req.new}: ${requestProblem(req) ?? "passes the first check"}`); continue; }
    const out = await carryOut(req, { key });
    const told = finish(req.id, out.ok ? "done" : "failed", out.ok ? "" : out.reason);
    console.log(`${new Date().toISOString()} ${req.title} (${req.store}) ${req.old} -> ${req.new}: ${out.ok ? "changed" : "not changed: " + out.reason}${told ? "" : " (could not report back to the Blink)"}`);
  }
}
