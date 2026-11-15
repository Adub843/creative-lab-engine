// The daily brief on Aaron's own machines (rule 20). Reads the engine's live digest, builds the daily-brief input
// for each brand on its own, runs the job on the local model (scripts/run-ai-job.mjs, with its checks and
// fallbacks), saves the result in ai-jobs/runs/daily-brief/<store>/ and writes one handoff per brand to the board.
//   node scripts/daily-brief.mjs [--store c3d|ed] [--no-handoff] [--force]
// Scheduled on the NUC by scripts/schedule-daily-brief.ps1. The console key is the one drive-server/setup.ps1
// stored (typed by Aaron into a hidden prompt, encrypted by Windows); it is only sent to the engine as a header
// and is never printed, logged or saved here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "../drive-server/key.mjs";
import { runJob, saveRun, BRAND } from "./run-ai-job.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const OUT = fileURLToPath(new URL("../ai-jobs/runs/daily-brief/", import.meta.url));

// Drops nulls and the long sync reports so the input fits a small model; nothing is changed or rounded.
export function slim(v) {
  if (Array.isArray(v)) return v.map(slim);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, slim(x)]));
  return v;
}

// The numbers sentence, written by code so the counts and the change from yesterday are always right. The model
// has to put it in the brief word for word (checked in run-ai-job.mjs).
export function numbersLine(shop, before) {
  if (!shop || typeof shop.sessions !== "number") return null;
  const n = (v) => Number(v ?? 0).toLocaleString("en-US"), usd = (v) => "$" + Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let t = `Over the last ${shop.days ?? 7} days the shop had ${n(shop.sessions)} visits, ${n(shop.orders)} orders and ${usd(shop.sales)} in sales.`;
  if (before && typeof before.sessions === "number") {
    const d = shop.sessions - before.sessions;
    t += d === 0 ? ` Visits are the same as yesterday's count of ${n(before.sessions)}.` : ` Visits are ${d > 0 ? "up" : "down"} ${n(Math.abs(d))} from yesterday's count of ${n(before.sessions)}.`;
  }
  return t;
}

// What Aaron has to act on today, built by code from the digest so nothing is padded or missed: ads to pause,
// budgets over the cap, site check fails (not warnings), a failed price or library sync, and missing app scopes.
// Low visits or no sales is never on this list. Add a plain name here when the site check gets a new fail id.
const FAIL_NAMES = { "indexnow-key": "The site check failed on the IndexNow key: set it in the console's Site settings." };
export function needsYouList(s) {
  const out = [], sc = s?.scorecard ?? {};
  for (const c of sc.pauseRecommended ?? []) out.push(`Pause the ad "${c}".`);
  for (const c of sc.overCap ?? []) out.push(`The ad "${c}" is over the daily cap: lower its budget.`);
  for (const f of s?.siteCheck?.fails ?? []) out.push(FAIL_NAMES[f] ?? `The site check failed on: ${f}.`);
  if (s?.pricing?.error) out.push("The price sync failed: open Prices in the console.");
  if (s?.library && (s.library.ok === false || s.library.error)) out.push("The Kittl library sync failed: open the Art library in the console.");
  for (const m of sc.missingScopes ?? []) out.push(`Add the ${m} scope to this store's app.`);
  return out;
}

// The daily-brief input for one store, from the whole digest and yesterday's (or null).
export function briefInput(store, digest, yesterday) {
  const s = digest?.stores?.[store];
  if (!s) throw new Error(`the digest has no "${store}" store`);
  const { pricing, library, ...rest } = s;
  const d = slim(rest);
  if (pricing) d.pricing = slim({ phase: pricing.phase, finishedAt: pricing.finishedAt, changed: pricing.report?.changed, error: pricing.error });
  if (library) d.library = slim({ ok: library.ok, at: library.at, added: library.added, removed: library.removed, failed: library.failed, warning: library.warning, error: library.error });
  const y = yesterday?.stores?.[store];
  return { store, date: digest.date, numbers: numbersLine(s.shop, y?.shop), needsYou: needsYouList(s), digest: d, yesterday: y?.shop ? slim({ date: yesterday.date, shop: y.shop, ranks: y.ranks }) : null };
}

// One handoff for the board from a run's result. The board keeps fields short, so a long brief ends on a whole sentence.
export function handoffFor(store, date, result) {
  const fit = (t, max) => { t = String(t).replace(/\s+/g, " ").trim(); if (t.length <= max) return t; const c = t.slice(0, max); const stop = c.lastIndexOf(". "); return stop > 80 ? c.slice(0, stop + 1) : c.slice(0, c.lastIndexOf(" ")); };
  const base = { lane: "console", store, task: `Daily brief ${date} (local model)` };
  if (!result.ok) return { ...base, status: "partial", did: `The local model could not write a ${BRAND[store]} brief that passed the checks, so none was sent. The input is saved for Claude in ai-jobs/runs/needs-claude.`, next: "A Claude session writes this brief from the saved input." };
  const needs = [].concat(result.output.needsYou ?? []).join(" ");
  return { ...base, status: "ok", did: fit(result.output.brief, 400), needsAaron: fit(needs, 200), next: `Written by ${result.engine} and checked by code against the digest.` };
}

async function get(pathname, key) {
  const r = await fetch(ENGINE + pathname, { headers: { accept: "application/json", "x-console-key": key }, signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${pathname} answered ${r.status}`);
  return r.json();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes("--store") ? args[args.indexOf("--store") + 1] : null;
  const key = readKey();
  if (!key) { console.error("No console key on this PC yet: run drive-server\\setup.ps1 and type the key when asked."); process.exit(1); }
  const digest = await get("/api/digest", key);
  if (!digest) { console.error("No digest yet."); process.exit(1); }
  const day = new Date(Date.parse(digest.date) - 86400000).toISOString().slice(0, 10);
  const yesterday = await get(`/api/digest?date=${day}`, key).catch(() => null);
  let failed = 0;
  for (const store of Object.keys(BRAND).filter((s) => !only || s === only)) {
    const file = path.join(OUT, store, `${digest.date}.json`);
    if (fs.existsSync(file) && !args.includes("--force")) { console.error(`${store}: ${digest.date} is already done.`); continue; }
    const input = briefInput(store, digest, yesterday);
    const result = await runJob("daily-brief", input, { log: (m) => console.error(`${store}: ${m}`) });
    saveRun("daily-brief", input, result);
    if (result.ok) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const saved = JSON.stringify({ ...result.output, engine: result.engine, tries: result.tries.length }, null, 2);
      fs.writeFileSync(file, saved); fs.writeFileSync(path.join(OUT, store, "latest.json"), saved);
      console.log(`${store}: ${result.output.brief}`);
    } else failed++;
    if (!args.includes("--no-handoff")) {
      const r = await fetch(ENGINE + "/api/handoffs", { method: "POST", headers: { "content-type": "application/json", "x-console-key": key }, body: JSON.stringify(handoffFor(store, digest.date, result)) });
      if (!r.ok) { console.error(`${store}: the handoff was refused (${r.status}): ${(await r.text()).slice(0, 200)}`); failed++; }
    }
  }
  process.exit(failed ? 2 : 0);
}
