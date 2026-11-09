// The console's live System map (Apps & Agents > System map in Creative Lab Studios).
//
// Two kinds of status live here, both in the RESULTS R2 bucket (R2 writes are cheap; KV's 1,000 a day are not):
//   status/cron-<job>.json  one object per timed job, written after every run (worker/index.mjs), so the map can
//                           show when each job last ran, whether it worked, and raise an alarm when one is missed.
//   status/network.json     the heartbeat Aaron's PC (NUC_SKULL) writes every 5 minutes with tools/network-heartbeat.ps1:
//                           gateway, internet, printer, E: drive, the drive tunnel and every Tailscale device.
// GET /api/system-map (console key) answers with both, already turned into ok / warn / bad / off per map circle.
// Nothing here changes a store, a task or a device: it only reads and reports.

import { requireKey, HttpError } from "./shopify.mjs";
import { STATE_KEY as KITTL_STATE_KEY } from "./kittl-sync.mjs";

const MIN = 60 * 1000, HOUR = 60 * MIN;
export const NETWORK_KEY = "status/network.json";
export const cronKey = (id) => `status/cron-${id}.json`;

// The engine's timed jobs, in the order the map lists them. late: how long after the last run it counts as missed.
export const JOBS = [
  { id: "cron-mkt", cron: "0 11 * * *", label: "Site check", when: "daily 11:00 UTC", late: 25 * HOUR },
  { id: "cron-fix", cron: "30 11 * * *", label: "Safe fixes + digest", when: "daily 11:30 UTC", late: 25 * HOUR },
  { id: "cron-price", cron: "*/15 * * * *", label: "Price sync + Taxi", when: "every 15 min", late: 50 * MIN },
  { id: "cron-lib", cron: "45 * * * *", label: "Library sync", when: "hourly at :45", late: 2 * HOUR + 10 * MIN },
];
export const jobForCron = (cron) => JOBS.find((j) => j.cron === cron) ?? null;
const HEARTBEAT_LOST = 15 * MIN;

// A short, plain line about what a run returned (never the whole result: it can hold store data).
export function runSummary(result) {
  if (result == null) return "";
  if (typeof result !== "object") return String(result).slice(0, 80);
  if (typeof result.changed === "number") return `${result.changed} price${result.changed === 1 ? "" : "s"} changed`;
  if (typeof result.added === "number" || typeof result.copied === "number") return `library synced${typeof result.added === "number" ? ` · ${result.added} new` : ""}`;
  if (Array.isArray(result.applied)) return `${result.applied.length} safe fix${result.applied.length === 1 ? "" : "es"}`;
  if (result.stores) return "checked both stores";
  return "ran";
}

// Called after every scheduled run. ok=false when the job threw or answered null (the jobs log and swallow their own errors).
export async function recordRun(bucket, cron, { ok, result, error, at = new Date() } = {}) {
  const job = jobForCron(cron);
  if (!job || !bucket || typeof bucket.put !== "function") return null;
  const rec = { job: job.id, at: new Date(at).toISOString(), ok: !!ok, text: ok ? runSummary(result) || "ran" : String(error?.message ?? error ?? "the job failed; see the Worker's logs").slice(0, 160) };
  try { await bucket.put(cronKey(job.id), JSON.stringify(rec), { httpMetadata: { contentType: "application/json" } }); } catch (e) { console.error("system map: record run", e?.message); }
  return rec;
}

async function readJson(bucket, key) {
  try { const obj = await bucket.get(key); return obj ? JSON.parse(await obj.text()) : null; } catch { return null; }
}
const ago = (ms) => (ms < 2 * MIN ? "just now" : ms < HOUR ? `${Math.round(ms / MIN)} min ago` : ms < 48 * HOUR ? `${Math.round(ms / HOUR)} h ago` : `${Math.round(ms / (24 * HOUR))} d ago`);

// One timed job's circle status.
export function jobStatus(job, rec, now = Date.now()) {
  if (!rec || !rec.at) return { label: job.label, when: job.when, tone: "off", text: "no run recorded yet" };
  const age = now - Date.parse(rec.at);
  if (!rec.ok) return { label: job.label, when: job.when, tone: "bad", text: `failed: ${rec.text}`, last: rec.at };
  if (age > job.late) return { label: job.label, when: job.when, tone: "bad", text: `missed its run · last ran ${ago(age)}`, last: rec.at };
  return { label: job.label, when: job.when, tone: "ok", text: rec.text || "ran", last: rec.at };
}

// Keeps only the fields the map shows from the PC heartbeat, with sane types and sizes.
export function cleanHeartbeat(h) {
  if (!h || typeof h !== "object" || !h.at || !Number.isFinite(Date.parse(h.at))) return null;
  const up = (o) => (o && typeof o === "object" ? { up: o.up === true ? true : o.up === false ? false : null, ms: Number.isFinite(+o.ms) && o.ms !== null && o.ms !== "" ? Math.round(+o.ms) : null } : null);
  const ts = Array.isArray(h.tailscale) ? h.tailscale.slice(0, 40).map((p) => ({ name: String(p?.name ?? "").slice(0, 60), ip: String(p?.ip ?? "").slice(0, 45), os: String(p?.os ?? "").slice(0, 20), online: p?.online === true, lastSeen: p?.lastSeen && Number.isFinite(Date.parse(p.lastSeen)) ? new Date(p.lastSeen).toISOString() : null })) : [];
  const lan = Array.isArray(h.lan) ? h.lan.slice(0, 80).map((d) => ({ ip: String(d?.ip ?? "").slice(0, 45), name: String(d?.name ?? "").slice(0, 60) })) : [];
  const ed = h.edrive && typeof h.edrive === "object" ? { present: h.edrive.present === true, freeGB: Number.isFinite(+h.edrive.freeGB) && h.edrive.freeGB !== null ? Math.round(+h.edrive.freeGB) : null } : null;
  return { at: new Date(h.at).toISOString(), host: String(h.host ?? "").slice(0, 40), gateway: up(h.gateway), internet: up(h.internet), printer: up(h.printer), tunnel: up(h.tunnel), edrive: ed, tailscale: ts, lan };
}

export async function buildSystemMap({ bucket, imagesKv = null, now = Date.now() } = {}) {
  const nodes = {};
  let network = null;
  if (bucket && typeof bucket.get === "function") {
    const recs = await Promise.all(JOBS.map((j) => readJson(bucket, cronKey(j.id))));
    const jobs = JOBS.map((j, i) => ({ id: j.id, ...jobStatus(j, recs[i], now) }));
    const bad = jobs.filter((j) => j.tone === "bad");
    nodes.engine = { tone: bad.length ? "bad" : "ok", text: bad.length ? `${bad.map((j) => j.label).join(", ")}: ${bad[0].text}` : "connected · jobs on time", jobs };
    network = cleanHeartbeat(await readJson(bucket, NETWORK_KEY));
    if (network && now - Date.parse(network.at) > HEARTBEAT_LOST) network.lost = true;
  } else {
    nodes.engine = { tone: "warn", text: "status storage isn't bound (RESULTS)", jobs: [] };
  }
  if (imagesKv && typeof imagesKv.get === "function") {
    const k = await imagesKv.get(KITTL_STATE_KEY, "json").catch(() => null);
    const at = Date.parse(k?.at ?? "");
    if (!k) nodes.kittl = { tone: "off", text: "no library sync yet" };
    else if (!Number.isFinite(at) || now - at > 26 * HOUR) nodes.kittl = { tone: "bad", text: `nightly sync missed · last ${Number.isFinite(at) ? ago(now - at) : "unknown"}` };
    else nodes.kittl = { tone: "ok", text: `synced ${ago(now - at)}` };
  }
  return { at: new Date(now).toISOString(), nodes, network };
}

// GET /api/system-map  (console key)
export async function handleSystemMap(req, { env, bucket, imagesKv, now = Date.now() }) {
  if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
  requireKey(req, env, "The system map");
  return buildSystemMap({ bucket, imagesKv, now });
}
