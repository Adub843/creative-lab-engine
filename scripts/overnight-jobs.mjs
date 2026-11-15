// The overnight jobs for the GMKtec's small model (task "Creative Lab overnight jobs", 12:40 AM on the NUC).
// These are jobs where speed does not matter, so the slow PC does them while everyone sleeps.
//
// Job 1, post drafts: for each brand, pick two live products that have not had a draft for 30 days, have the model
// write an Instagram and a Facebook caption from the listing's own text (ai-jobs/post-captions.md, checked in code
// by scripts/run-ai-job.mjs), then code adds the tagged link and the brand's hashtags and saves one draft file per
// brand in Aaron-Data\_Drafts - needs OK\<brand>\Post drafts. Nothing is posted: Aaron picks from the drafts.
//
//   node scripts/overnight-jobs.mjs                 the nightly run
//   node scripts/overnight-jobs.mjs --store c3d --count 1 --dry     one product, print the draft, save nothing
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runJob, saveRun } from "./run-ai-job.mjs";
import { utm } from "../lib/utm.mjs";

const STATE = fileURLToPath(new URL("../ai-jobs/runs/overnight/state.json", import.meta.url));
export const BRANDS = {
  c3d: { name: "Charleston3D", folder: "Charleston3D", site: "https://charleston3d.com",
    voice: "Friendly, plain and local. Short sentences. No hype words.",
    tags: ["#Charleston3D", "#CharlestonSC", "#3DPrinting", "#CustomGifts", "#MadeInCharleston"] },
  ed: { name: "Elevated Designs", folder: "Elevated Designs", site: "https://elevatedshirts.com",
    voice: "Confident, warm and local. Short sentences. No hype words.",
    tags: ["#ElevatedDesigns", "#CharlestonSC", "#Lowcountry", "#CharlestonShirts", "#GraphicTees"] },
};
const OTHER = { c3d: /elevated\s*designs|elevatedshirts|epix3d/i, ed: /charleston\s*3d|charleston3d|3d[- ]print/i };
const SKIP_TAGS = new Set(["builder-blank", "request-product", "nameplate-maker", "epix3d-platinum"]);
export const REST_DAYS = 30;

export const plain = (html) => String(html ?? "").replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// The products a caption can honestly be written for: a real listing with enough text, one brand only.
export function eligible(products, store) {
  return (products ?? []).filter((p) => {
    const text = plain(p.body_html);
    if (text.length < 200) return false;                                   // too thin to write from
    if ((p.tags ?? []).some((t) => SKIP_TAGS.has(String(t).toLowerCase()))) return false;
    if (OTHER[store].test(`${p.title} ${text} ${(p.tags ?? []).join(" ")}`)) return false; // names the other brand
    return (p.variants ?? []).some((v) => v.available !== false);
  });
}

// Tonight's picks: never-drafted products first, then the ones drafted longest ago, and none inside the rest period.
export function pick(products, done, count, now = Date.now()) {
  const last = (p) => Date.parse(done?.[p.handle] ?? "") || 0;
  return products.filter((p) => now - last(p) > REST_DAYS * 86400000)
    .sort((a, b) => last(a) - last(b) || String(a.handle).localeCompare(String(b.handle))).slice(0, count);
}

export function toInput(store, p) {
  const prices = [...new Set((p.variants ?? []).map((v) => Number(v.price)))];
  return { store, voice: BRANDS[store].voice,
    product: { title: p.title, description: plain(p.body_html).slice(0, 6000), price: Math.min(...prices), priceVaries: prices.length > 1, tags: (p.tags ?? []).slice(0, 12) } };
}

// The finished draft for one product: the model's words, plus the link and hashtags that code decides.
export function draftText(store, p, out, month) {
  const b = BRANDS[store], url = `${b.site}/products/${p.handle}`;
  const topic = (out.topicTags ?? []).filter((t) => !b.tags.some((x) => x.toLowerCase() === String(t).toLowerCase()));
  const tags = [...b.tags, ...topic].join(" ");
  const lines = [`## ${p.title}`, "", `Listing: ${url}`, `Picture: ${p.images?.[0]?.src ?? "(the listing has no picture)"}`, ""];
  for (const post of out.posts) {
    const link = utm(url, { source: post.platform, medium: "social", campaign: `${store}-${month}-${p.handle}`.slice(0, 100) });
    lines.push(`### ${post.platform === "instagram" ? "Instagram" : "Facebook"}`, "", post.caption.trim(), "", link, "", tags, "");
  }
  if (out.notes) lines.push(`Note from the model: ${out.notes}`, "");
  return lines.join("\n");
}

async function storeProducts(store) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${BRANDS[store].site}/products.json?limit=250&page=${page}`, { headers: { "user-agent": "creative-lab-overnight-jobs" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${store} product list answered ${r.status}`);
    const batch = (await r.json()).products ?? [];
    out.push(...batch);
    if (batch.length < 250) break;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const dry = process.argv.includes("--dry"), count = Number(arg("--count") ?? 2);
  const stores = arg("--store") ? [arg("--store")] : ["c3d", "ed"];
  const today = new Date().toLocaleDateString("en-CA"), month = today.slice(0, 7).replace("-", "");
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first run */ }
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
  for (const store of stores) {
    if (!BRANDS[store]) { log(`no store "${store}"`); continue; }
    let products;
    try { products = eligible(await storeProducts(store), store); } catch (e) { log(`${store}: ${e.message}; skipped`); continue; }
    const picks = pick(products, state[store], count);
    log(`${store}: ${products.length} products can have a draft; tonight: ${picks.map((p) => p.handle).join(", ") || "none (all drafted in the last 30 days)"}`);
    const parts = [];
    for (const p of picks) {
      const input = toInput(store, p);
      const result = await runJob("post-captions", input, { log: (m) => log(`  ${p.handle}: ${m}`) });
      if (!dry) saveRun("post-captions", input, result);
      if (!result.ok) { log(`  ${p.handle}: no draft (the checks were not passed${result.needsClaude ? "; saved for Claude" : ""})`); continue; }
      parts.push(draftText(store, p, result.output, month));
      (state[store] ??= {})[p.handle] = new Date().toISOString();
    }
    if (!parts.length) continue;
    const body = [`# ${BRANDS[store].name} post drafts, ${today}`, "",
      "Drafts written overnight by the local model from the live listings, and checked by code. Nothing has been posted.",
      "Pick what you like, change any words, and use the real product photo. Delete this file when you are done with it.", "", ...parts].join("\n");
    if (dry) { console.log(body); continue; }
    const dir = path.join(os.homedir(), "Aaron-Data", "_Drafts - needs OK", BRANDS[store].folder, "Post drafts");
    fs.mkdirSync(dir, { recursive: true });
    let v = 1; while (fs.existsSync(path.join(dir, `${today} post drafts v${v}.md`))) v++;
    fs.writeFileSync(path.join(dir, `${today} post drafts v${v}.md`), body);
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    log(`${store}: saved ${parts.length} draft(s) in ${dir}`);
  }
}
