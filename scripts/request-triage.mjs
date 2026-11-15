// Sorts new Charleston 3D custom requests (task "Creative Lab request sorting", hourly on the NUC).
// It asks the engine for the requests of the last 14 days (GET /api/requests: the request text only, never who sent
// it), and for each one it has not seen, has the local model sort it and draft a first reply
// (ai-jobs/request-triage.md, checked in code by scripts/run-ai-job.mjs). Each result is saved as a draft for Aaron
// in Aaron-Data\_Drafts - needs OK\Charleston3D\Custom requests, and one line goes on the team board.
// Nothing is sent to a customer and no order is changed. The console key is read from this PC's saved store and is
// only sent to the engine as a header; it is never printed.
//
//   node scripts/request-triage.mjs          one pass (does nothing when there is nothing new)
//   node scripts/request-triage.mjs --dry    shows what it would sort, runs no model, saves nothing
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "../drive-server/key.mjs";
import { runJob, saveRun } from "./run-ai-job.mjs";
import { postTeamNote } from "./daily-brief.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const STATE = fileURLToPath(new URL("../ai-jobs/runs/request-triage/state.json", import.meta.url));
export const RUSH_DAYS = 7, MAX_PER_PASS = 5;

const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);

// The job input for one request. Days left and urgency are worked out here, so the model never does date maths.
export function toInput(request, today) {
  const daysLeft = request.neededBy ? dayNumber(request.neededBy) - dayNumber(today) : null;
  return { store: "c3d", request, today, daysLeft, urgency: daysLeft !== null && daysLeft <= RUSH_DAYS ? "rush" : "normal" };
}

// Requests not sorted yet: open ones only, oldest first, a few per pass so one busy hour cannot hold the model.
export function fresh(requests, seen, limit = MAX_PER_PASS) {
  return (requests ?? []).filter((r) => r.open !== false && r.order && !seen?.[r.order]).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, limit);
}

export function draftText(input, out) {
  const r = input.request, yes = { yes: "Looks printable", maybe: "Maybe printable, check first", no: "Probably not something we can print" }[out.canDo];
  const facts = [`Type: ${out.kind}`, r.quantity ? `Quantity: ${r.quantity}` : null, r.size ? `Size: ${r.size}` : null, r.colors ? `Colors: ${r.colors}` : null,
    r.neededBy ? `Needed by: ${r.neededBy} (${input.daysLeft} days from ${input.today})` : "Needed by: not given", `Files sent: ${r.files}`, r.exampleLink ? "They gave an example link (open the order to see it)" : null].filter(Boolean);
  return [`# Custom request ${r.order}, received ${r.date}`, "", out.urgency === "rush" ? "**RUSH: needed within 7 days.**" : "Normal timing.", "",
    "## What they asked for", "", r.request, "", ...facts.map((f) => `- ${f}`), "",
    "## The local model's read", "", `${yes}. ${out.why}`, "", ...(out.missing.length ? ["Still needed to quote:", ...out.missing.map((q) => `- ${q}`), ""] : []),
    "## Draft reply (edit it, add your quote, and send it yourself from the order in Shopify)", "", out.replyDraft.trim(), "",
    out.notes ? `Note from the model: ${out.notes}\n` : "", "Written by the local model and checked by code. No price is given and nothing was sent."].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes("--dry");
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
  const today = new Date().toLocaleDateString("en-CA");
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first run */ }
  let res;
  try { res = await fetch(`${ENGINE}/api/requests?days=14`, { headers: { "x-console-key": await readKey() }, signal: AbortSignal.timeout(30000) }); }
  catch (e) { log(`the engine could not be reached (${e.name})`); process.exit(1); }
  if (res.status === 404) { log("the engine does not have the requests route yet (it needs a deploy)"); process.exit(0); }
  if (!res.ok) { log(`the engine answered ${res.status}: ${(await res.json().catch(() => ({}))).error ?? ""}`); process.exit(1); }
  const todo = fresh((await res.json()).requests, state);
  if (!todo.length) process.exit(0);
  const dir = path.join(os.homedir(), "Aaron-Data", "_Drafts - needs OK", "Charleston3D", "Custom requests");
  for (const r of todo) {
    const input = toInput(r, today);
    if (dry) { log(`would sort ${r.order} from ${r.date} (${input.urgency})`); continue; }
    const result = await runJob("request-triage", input, { log: (m) => log(`  ${r.order}: ${m}`) });
    saveRun("request-triage", input, result);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${r.date} request ${r.order.replace(/[^0-9A-Za-z]/g, "")} v1.md`;
    if (result.ok) fs.writeFileSync(path.join(dir, name), draftText(input, result.output));
    else fs.writeFileSync(path.join(dir, name), `# Custom request ${r.order}, received ${r.date}\n\n${input.urgency === "rush" ? "**RUSH: needed within 7 days.**\n\n" : ""}## What they asked for\n\n${r.request}\n\nThe local model could not write a reply that passed the checks, so there is no draft. Open the order in Shopify and answer it yourself.\n`);
    state[r.order] = new Date().toISOString();
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    postTeamNote(`Charleston 3D custom request ${r.order} from ${r.date} is sorted (${input.urgency}${result.ok ? `, ${result.output.canDo === "yes" ? "looks printable" : result.output.canDo === "maybe" ? "maybe printable" : "probably not printable"}` : ", no draft"}). The draft reply is in Aaron's drafts folder, waiting for him.`);
    log(`${r.order}: ${result.ok ? "sorted, draft saved" : "saved without a draft"}`);
  }
}
