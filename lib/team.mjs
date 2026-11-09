// The Team page: who does what (Aaron and the OpenClaw agents), when each agent's jobs run, and one
// shared task board per store. The board lives in the MARKETING KV namespace under "team:<store>", so
// it is the same on every device (the old Home to-do list was saved in one browser only), and an agent
// can read its own tasks with GET /api/team?store=ed.
// The two stores never share a board (CLAUDE.md rule 3); the c3d agent only works on Charleston 3D
// and the ed agent only on Elevated Designs.
import { HttpError, ok, fail, parseStore, readJsonBody, requireKey } from "./shopify.mjs";

// From Desktop\Business Handoff\03 Agents\AGENT-ROSTER.md. Times are Charleston time (ET).
export const ROSTER = [
  { id: "aaron", name: "Aaron", role: "Owner", runs: "You", jobs: [] },
  { id: "ops", name: "ops", role: "Coordinator: routes every request and keeps the guardrails", runs: "OpenClaw",
    jobs: ["Daily 6:30 AM and 5:30 PM: manager run (reads every handoff, writes Home's Agents' report)", "Daily 7:00 AM: morning brief and site health", "Mon 8:00 AM: weekly review", "Daily 2:30 AM: nightly repo backup"] },
  { id: "c3d", store: "c3d", name: "c3d", role: "Charleston 3D: custom requests, listings, the order app", runs: "OpenClaw",
    jobs: ["Hourly: triage new custom requests", "Daily: order app health", "Weekly: check which products are customizable", "Weekly from Nov 1: holiday order cutoff"] },
  { id: "ed", store: "ed", name: "ed", role: "Elevated Designs: listings, shirt orders, the shirt apps", runs: "OpenClaw",
    jobs: ["Daily: price sheet watch", "Daily: shirt app health", "As they come: shirt orders and print files", "As needed: collections"] },
  { id: "marketing", name: "marketing", role: "SEO, Bing and AI search, local listings, reports", runs: "OpenClaw",
    jobs: ["Daily 9:15 AM: ad budget guard", "Mon, Wed, Fri, Sat 10:00 AM: social posts", "Thu 10:30 AM: Google Business posts", "Sun 6:00 AM: weekly SEO audit", "Mon 7:30 AM: marketing report", "Monthly: local and GEO upkeep", "Jan 5 and Aug 1: market calendar", "After every change: IndexNow"] },
  { id: "builder", name: "builder", role: "Code, themes, console changes and deploys, research", runs: "Claude Code", jobs: ["On request"] },
  { id: "admin", name: "admin", role: "Deadlines, paperwork from the Master Document, expenses", runs: "OpenClaw",
    jobs: ["Reminders: business license, SC ST-3, 1040-ES (Q4 due Jan 15), grants", "Monthly: expense log"] },
];
// The console's own scheduled jobs (wrangler.toml), shown with the team so every schedule is in one place.
export const CONSOLE_JOBS = [
  "Daily 11:00 UTC: marketing check of both sites",
  "Daily 11:30 UTC: rank snapshot, safe SEO fixes (undone if visits drop) and the daily digest",
  "Every 15 min: Elevated Designs shirt prices from the price sheet",
  "Nightly 04:45 UTC (11:45 PM EST / 12:45 AM EDT): image library follows Kittl",
];

export const MAX_TASKS = 300;
export const MAX_TEXT = 200;
export const MAX_IMPORT = 50;
const kvKey = (store) => `team:${store}`;
export const ownersFor = (store) => ROSTER.filter((m) => !m.store || m.store === store).map((m) => m.id);

async function readBoard(kv, store) {
  try { const v = await kv.get(kvKey(store), { type: "json" }); return Array.isArray(v?.tasks) ? v.tasks : []; } catch { return []; }
}
async function writeBoard(kv, store, tasks) {
  await kv.put(kvKey(store), JSON.stringify({ tasks, updatedAt: new Date().toISOString() }));
}

function cleanText(v) {
  if (typeof v !== "string") throw new HttpError(400, "bad_input", "text must be a sentence.");
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) throw new HttpError(400, "bad_input", "Type the task first.");
  if (t.length > MAX_TEXT) throw new HttpError(400, "bad_input", `Keep a task under ${MAX_TEXT} characters.`);
  return t;
}
function cleanOwner(v, store) {
  const owner = v ?? "aaron";
  if (!ownersFor(store).includes(owner)) throw new HttpError(400, "bad_owner", `owner must be one of: ${ownersFor(store).join(", ")}`);
  return owner;
}
const newTask = (text, owner, now) => ({ id: crypto.randomUUID(), text, owner, done: false, createdAt: now });

// GET ?store=ed -> { store, roster, consoleJobs, tasks }
// POST { store, text, owner? } adds one; { store, tasks: [{ text, owner?, done? }] } imports a list
// PATCH { store, id, done?, owner?, text? } changes one; DELETE { store, id } removes one.
export async function handleTeam(req, ctx) {
  try {
    if (!ctx.kv) throw new HttpError(503, "storage_not_set_up", "The task board isn't set up yet: add the MARKETING KV namespace binding (see the README).");
    if (req.method === "GET") {
      requireKey(req, ctx.env, "The task board");
      const store = parseStore(req.query.get("store"));
      return ok({ store, roster: ROSTER.filter((m) => ownersFor(store).includes(m.id)), consoleJobs: CONSOLE_JOBS, tasks: await readBoard(ctx.kv, store) });
    }
    if (!["POST", "PATCH", "DELETE"].includes(req.method)) throw new HttpError(405, "method_not_allowed", "Use GET, POST, PATCH or DELETE.");
    requireKey(req, ctx.env);
    const body = await readJsonBody(req);
    const store = parseStore(body.store);
    const tasks = await readBoard(ctx.kv, store);
    const now = new Date().toISOString();

    if (req.method === "POST") {
      const incoming = Array.isArray(body.tasks) ? body.tasks : [body];
      if (!incoming.length || incoming.length > MAX_IMPORT) throw new HttpError(400, "bad_input", `Send 1 to ${MAX_IMPORT} tasks.`);
      const added = incoming.map((t) => {
        if (!t || typeof t !== "object") throw new HttpError(400, "bad_input", "Each task needs text.");
        return { ...newTask(cleanText(t.text), cleanOwner(t.owner, store), now), ...(t.done === true ? { done: true, doneAt: now } : {}) };
      });
      if (tasks.length + added.length > MAX_TASKS) {
        // Make room by dropping the oldest finished tasks; open ones are never dropped.
        const room = MAX_TASKS - added.length;
        const open = tasks.filter((t) => !t.done);
        if (open.length > room) throw new HttpError(409, "board_full", `The board holds ${MAX_TASKS} tasks. Finish or remove some first.`);
        const done = tasks.filter((t) => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, room - open.length);
        tasks.splice(0, tasks.length, ...open, ...done);
      }
      tasks.push(...added);
      await writeBoard(ctx.kv, store, tasks);
      return ok({ store, added, tasks }, 201);
    }

    const i = tasks.findIndex((t) => t.id === body.id);
    if (typeof body.id !== "string" || i < 0) throw new HttpError(404, "not_found", "That task isn't on the board any more.");
    if (req.method === "DELETE") {
      tasks.splice(i, 1);
      await writeBoard(ctx.kv, store, tasks);
      return ok({ store, removed: body.id, tasks });
    }
    const t = { ...tasks[i] };
    const fields = ["done", "owner", "text"].filter((k) => Object.hasOwn(body, k));
    if (!fields.length) throw new HttpError(400, "bad_input", "Send done, owner or text to change.");
    if (Object.hasOwn(body, "done")) {
      if (typeof body.done !== "boolean") throw new HttpError(400, "bad_input", "done must be true or false.");
      t.done = body.done;
      if (body.done) t.doneAt = now; else delete t.doneAt;
    }
    if (Object.hasOwn(body, "owner")) t.owner = cleanOwner(body.owner, store);
    if (Object.hasOwn(body, "text")) t.text = cleanText(body.text);
    tasks[i] = t;
    await writeBoard(ctx.kv, store, tasks);
    return ok({ store, task: t, tasks });
  } catch (e) {
    return fail(e);
  }
}
