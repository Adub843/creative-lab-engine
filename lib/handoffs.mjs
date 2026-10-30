// The handoff board: how the agents (and Claude chats) tell each other what they just did. Agents
// can't read each other's chats and every scheduled run starts fresh, so each run READS its lane's
// last handoff and any heads-up sent to it FIRST, and WRITES exactly one handoff LAST. Twice a day
// the ops manager run reads them all, looks for conflicts, and writes the brief Aaron sees on Home:
// Needs you, Fixed, Watching. Stored in the MARKETING KV under "handoffs" and "handoffs:brief".
//
//   GET    /api/handoffs?lane=marketing&since=<iso>&limit=50  -> { handoffs, brief, lanes, stale }
//   POST   /api/handoffs { lane, task, status, did, changed?, next?, needsAaron?, store?, headsUp? }
//   POST   /api/handoffs { brief: { needsYou: [], fixed: [], watching: [] } }   (the manager run)
//   DELETE /api/handoffs { id }
//
// Handoffs are plain words: no customer emails or phone numbers, and never a key or password.
import { HttpError, ok, fail, readJsonBody, requireKey } from "./shopify.mjs";
import { ROSTER } from "./team.mjs";

// The lanes: every agent on the roster, the console's own crons, and Claude chats that change
// something the agents rely on (ads, posts, the sites, the console).
export const LANES = [...ROSTER.filter((m) => m.id !== "aaron").map((m) => m.id), "console", "claude"];
export const STATUSES = ["ok", "partial", "failed"];
export const MAX_HANDOFFS = 500;
export const KEEP_DAYS = 30;
export const MAX_FIELD = 400;
export const MAX_BRIEF_ITEMS = 12;
// A lane with a daily job that hasn't written for this long is listed as stale (it may have failed
// quietly, or "succeeded" in a few seconds without doing anything).
export const STALE_HOURS = 36;
const DAILY_LANES = ["ops", "marketing", "c3d", "ed"];
const KEY = "handoffs";
const BRIEF_KEY = "handoffs:brief";
const DAY = 86400000;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const SECRET = /\b(?:shpat_|sk-|ghp_|github_pat_)[A-Za-z0-9_]{6,}/;

function clean(v, field, { required = false, max = MAX_FIELD } = {}) {
  if (v == null || v === "") {
    if (required) throw new HttpError(400, "bad_input", `${field} is required.`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, "bad_input", `${field} must be text.`);
  const t = v.replace(/\s+/g, " ").trim();
  if (required && !t) throw new HttpError(400, "bad_input", `${field} is required.`);
  if (t.length > max) throw new HttpError(400, "bad_input", `Keep ${field} under ${max} characters.`);
  if (EMAIL.test(t) || PHONE.test(t)) throw new HttpError(400, "private_detail", `${field} has an email address or phone number. Handoffs are plain words only.`);
  if (SECRET.test(t)) throw new HttpError(400, "private_detail", `${field} looks like it has a key in it. Never put keys in a handoff.`);
  return t;
}
function cleanLane(v, field = "lane") {
  if (!LANES.includes(v)) throw new HttpError(400, "bad_lane", `${field} must be one of: ${LANES.join(", ")}`);
  return v;
}
function cleanHeadsUp(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 6) throw new HttpError(400, "bad_input", "headsUp must be a list of up to 6 notes.");
  return list.map((h) => {
    if (!h || typeof h !== "object") throw new HttpError(400, "bad_input", "Each heads-up needs to and text.");
    return { to: cleanLane(h.to, "headsUp.to"), text: clean(h.text, "headsUp.text", { required: true, max: 200 }) };
  });
}

export function cleanHandoff(body, now) {
  const store = body.store ?? "both";
  if (!["c3d", "ed", "both"].includes(store)) throw new HttpError(400, "bad_store", "store must be c3d, ed or both.");
  const status = body.status ?? "ok";
  if (!STATUSES.includes(status)) throw new HttpError(400, "bad_input", `status must be one of: ${STATUSES.join(", ")}`);
  const headsUp = cleanHeadsUp(body.headsUp);
  return {
    id: crypto.randomUUID(),
    at: now,
    lane: cleanLane(body.lane),
    task: clean(body.task, "task", { required: true, max: 80 }),
    store,
    status,
    did: clean(body.did, "did", { required: true }),
    changed: clean(body.changed, "changed"),
    next: clean(body.next, "next"),
    needsAaron: clean(body.needsAaron, "needsAaron", { max: 200 }),
    headsUp,
    headsUpTo: [...new Set(headsUp.map((h) => h.to))],
  };
}

function cleanBrief(b, now) {
  if (!b || typeof b !== "object") throw new HttpError(400, "bad_input", "brief must have needsYou, fixed and watching lists.");
  const list = (v, name) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > MAX_BRIEF_ITEMS) throw new HttpError(400, "bad_input", `${name} must be a list of up to ${MAX_BRIEF_ITEMS} lines.`);
    return v.map((t) => clean(t, name, { required: true, max: 200 }));
  };
  return { at: now, needsYou: list(b.needsYou, "needsYou"), fixed: list(b.fixed, "fixed"), watching: list(b.watching, "watching") };
}

// Handoffs older than KEEP_DAYS go, and the board never holds more than MAX_HANDOFFS (newest kept).
export function prune(list, nowMs) {
  return list.filter((h) => nowMs - Date.parse(h.at) < KEEP_DAYS * DAY).sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_HANDOFFS);
}

// Daily lanes with no handoff in STALE_HOURS (newest first by lane).
export function staleLanes(list, nowMs) {
  return DAILY_LANES.filter((lane) => {
    const last = list.find((h) => h.lane === lane);
    return !last || nowMs - Date.parse(last.at) > STALE_HOURS * 3600000;
  });
}

async function readAll(kv) {
  try { const v = await kv.get(KEY, { type: "json" }); return Array.isArray(v?.handoffs) ? v.handoffs : []; } catch { return []; }
}
async function readBrief(kv) {
  try { return (await kv.get(BRIEF_KEY, { type: "json" })) ?? null; } catch { return null; }
}

export async function handleHandoffs(req, ctx, clock = () => new Date()) {
  try {
    if (!ctx.kv) throw new HttpError(503, "storage_not_set_up", "The handoff board isn't set up yet: add the MARKETING KV namespace binding (see the README).");
    const nowMs = clock().getTime(), now = new Date(nowMs).toISOString();
    if (req.method === "GET") {
      requireKey(req, ctx.env, "The handoff board");
      const all = prune(await readAll(ctx.kv), nowMs);
      const lane = req.query.get("lane");
      if (lane) cleanLane(lane);
      const since = req.query.get("since");
      if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, "bad_input", "since must be a date and time (ISO 8601).");
      const limit = Math.min(Math.max(Number(req.query.get("limit")) || 50, 1), MAX_HANDOFFS);
      // A lane sees its own handoffs and every heads-up sent to it.
      const shown = all.filter((h) => (!lane || h.lane === lane || h.headsUpTo.includes(lane)) && (!since || h.at > new Date(since).toISOString()));
      return ok({ handoffs: shown.slice(0, limit), brief: await readBrief(ctx.kv), lanes: LANES, stale: staleLanes(all, nowMs) });
    }
    if (!["POST", "DELETE"].includes(req.method)) throw new HttpError(405, "method_not_allowed", "Use GET, POST or DELETE.");
    requireKey(req, ctx.env);
    const body = await readJsonBody(req);
    if (req.method === "POST" && Object.hasOwn(body, "brief")) {
      const brief = cleanBrief(body.brief, now);
      await ctx.kv.put(BRIEF_KEY, JSON.stringify(brief));
      return ok({ brief }, 201);
    }
    const all = prune(await readAll(ctx.kv), nowMs);
    if (req.method === "POST") {
      const h = cleanHandoff(body, now);
      const next = prune([h, ...all], nowMs);
      await ctx.kv.put(KEY, JSON.stringify({ handoffs: next, updatedAt: now }));
      return ok({ handoff: h }, 201);
    }
    const i = all.findIndex((h) => h.id === body.id);
    if (typeof body.id !== "string" || i < 0) throw new HttpError(404, "not_found", "That handoff isn't on the board any more.");
    all.splice(i, 1);
    await ctx.kv.put(KEY, JSON.stringify({ handoffs: all, updatedAt: now }));
    return ok({ removed: body.id });
  } catch (e) {
    return fail(e);
  }
}
