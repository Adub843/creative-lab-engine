// Alice's design-engineer step: a plain request ("a key tag that says Rainbow Row") becomes a checked Fusion job.
// The local model picks the recipe and sizes (ai-jobs/fusion-design.md), code checks every value against
// tools/fusion/recipes.json and the print rules (scripts/run-ai-job.mjs checkFusionDesign), then the job goes to the
// engine (POST /api/fusion, by "Alice") and Fusion on the NUC builds it for free. Plain Node, no packages.
//
//   node scripts/fusion-design.mjs --ask "a 70 mm key tag that says Rainbow Row"            show the job, send nothing
//   node scripts/fusion-design.mjs --ask "..." --send                                        send it to Fusion
//   node scripts/fusion-design.mjs --ask "make it 150 mm" --from <library file key> --send   resize a library file
//
// Alice's mailbox (scripts/alice-mailbox.mjs) runs the same steps for Lab messages that start "Design in Fusion:".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPES } from "../lib/fusion.mjs";
import { buildMessages, check, extractJson, tidy, runJob, saveRun } from "./run-ai-job.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const JOB_TEXT = fs.readFileSync(fileURLToPath(new URL("../ai-jobs/fusion-design.md", import.meta.url)), "utf8");
export const DESIGN_PREFIX = /^\s*design in fusion\s*:\s*/i;

// The job input: the request plus every recipe a model may use (the SVG one needs a file a person picks).
export function designInput(ask, from) {
  const recipes = {};
  for (const [k, r] of Object.entries(RECIPES)) {
    if (r.params?.svg || (r.needsFile && !from?.key)) continue;
    recipes[k] = { label: r.label, about: r.about, params: r.params };
  }
  return { store: "c3d", ask: String(ask).replace(DESIGN_PREFIX, "").trim().slice(0, 1500), ...(from?.key ? { from: { key: from.key, name: from.name ?? "" } } : {}), recipes };
}

// Asks a model (askFn(messages) -> text) up to 3 times, feeding back what the checks rejected.
export async function designWith(askFn, input, tries = 3) {
  let problems = null, raw = "";
  for (let i = 0; i < tries; i++) {
    let out = null;
    try {
      raw = await askFn(buildMessages(JOB_TEXT, input, problems, raw));
      out = tidy("fusion-design", extractJson(raw), input);
      problems = check("fusion-design", JOB_TEXT, input, out);
    } catch (e) { problems = [e.message]; }
    if (!problems.length) return { ok: true, output: out };
  }
  return { ok: false, problems };
}

// The engine job for a checked design.
export function jobFor(out, input) {
  return { name: out.name, by: "Alice", recipe: out.recipe, params: out.params, formats: out.formats, ...(out.recipe === "resize" ? { from: input.from.key } : {}) };
}

export async function sendJob(job, key) {
  const r = await fetch(`${ENGINE}/api/fusion`, { method: "POST", headers: { "content-type": "application/json", "x-console-key": key }, body: JSON.stringify(job), signal: AbortSignal.timeout(30000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`the engine said ${r.status} ${body.error ?? ""}`);
  return body.job;
}

const SIZE = { box: (p) => `${p.width} x ${p.depth} x ${p.height} mm${p.lid ? " with a lid" : ""}`, plate: (p) => `${p.width} x ${p.height} x ${p.thickness} mm, "${p.text}"`, resize: (p) => p.longest ? `longest side ${p.longest} mm` : "same size" };

// Alice's reply in the Lab, in plain words.
export function replyFor(out, sent) {
  if (out.canDo !== "yes") return `I can't build that one from my Fusion recipes yet. ${out.notes}`.trim();
  const what = `${out.name} (${RECIPES[out.recipe].label.toLowerCase()}, ${SIZE[out.recipe]?.(out.params) ?? ""})`;
  const tips = out.printNotes?.length ? ` Print tips: ${out.printNotes.join(" ")}` : "";
  return sent ? `I sent ${what} to Fusion on the NUC. It shows up in Make, 3D maker, and the files go to the 3D file library when it's built.${tips}`
    : `Here's the plan: ${what}.${tips}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const ask = opt("ask");
  if (!ask) { console.error('Usage: node scripts/fusion-design.mjs --ask "what to make" [--from <file key>] [--send] [--engine local-big|local-small]'); process.exit(2); }
  const input = designInput(ask, opt("from") ? { key: opt("from"), name: opt("from-name") } : null);
  const result = await runJob("fusion-design", input, { engineName: opt("engine"), log: (m) => console.error(m) });
  saveRun("fusion-design", input, result);
  if (!result.ok) { console.error("No local model passed the checks. Saved for Claude in ai-jobs/runs/needs-claude/."); process.exit(2); }
  const out = result.output;
  console.log(JSON.stringify(out, null, 2));
  if (args.includes("--send") && out.canDo === "yes") {
    const { readKey } = await import("../drive-server/key.mjs");
    const key = readKey();
    if (!key) { console.error("No console key on this PC: run drive-server\\setup.ps1 first."); process.exit(1); }
    const job = await sendJob(jobFor(out, input), key);
    console.log(`Sent to Fusion as ${job.id}. ${replyFor(out, true)}`);
  }
}
