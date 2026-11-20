// The best design, every time (Aaron, 2026-11-19: "everything we make should be the best design and we need to be
// doing that every time"). One plain request ("Design in Fusion: a holder for 6 AA batteries") goes through:
//
//   1. Claude designs it: Alice's Claude on the Blink (/api/claude-job, local-only; Aaron's key never leaves the
//      Blink). It picks a recipe, or writes a make(design, root, P) Fusion script for anything the recipes can't make,
//      and says the size the finished part must have.
//   2. Code checks it: the recipe limits and print rules (run-ai-job.mjs checkFusionDesign), or the script rules
//      (lib/fusion.mjs cleanScript: geometry only, no files, programs or network).
//   3. Fusion test-builds it on this PC (the LabBridge add-in), then the print check reads the part
//      (scripts/print-check.mjs): fits the bed, closed, flat base, overhangs. The built size must match the size
//      Claude said, so a slip in units or a wrong shape can't get through.
//   4. Anything wrong goes back to Claude with the exact error, up to ROUNDS times. Only a part that passes every
//      check goes to the Lab (POST /api/fusion), where the runner builds it again and saves it to the 3D library.
//
// When Claude can't be reached (no key, Blink down, busy), the local model on the Blink does steps 1 and 4 with the
// recipes only, and steps 2 and 3 stay the same. Each design Claude gets through is kept in
// ai-jobs/runs/fusion-design-examples/ so the local model's examples can grow from it (rule 20).
//
//   node scripts/fusion-best.mjs --ask "a holder for 6 AA batteries"          design + test build, send nothing
//   node scripts/fusion-best.mjs --ask "..." --send                            ... and send it to the Lab
//   node scripts/fusion-best.mjs --ask "..." --local                           the local model only (to compare)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RECIPES, cleanScript } from "../lib/fusion.mjs";
import { buildMessages, check, extractJson, tidy, withForward } from "./run-ai-job.mjs";
import { buildInFusion, fusionUp } from "./fusion-runner.mjs";
import { checkFile } from "./print-check.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const JOB_TEXT = fs.readFileSync(here("../ai-jobs/fusion-design.md"), "utf8");
const GUIDE = fs.readFileSync(here("../tools/fusion/DESIGN-ENGINEER.md"), "utf8");
const LABKIT = fs.readFileSync(here("../tools/fusion/LabBridge/labkit.py"), "utf8");
const ENGINES = JSON.parse(fs.readFileSync(here("../ai-jobs/engines.json"), "utf8")).engines;
const EXAMPLES = here("../ai-jobs/runs/fusion-design-examples");
export const ROUNDS = 3;
export const DESIGN_PREFIX = /^\s*design in fusion\s*:\s*/i;

// ---------- the request ----------
// Every recipe a designer may use (the SVG one needs a file a person picks; resize needs a library file).
export function bestInput(ask, from, { allowScript = true } = {}) {
  const recipes = {};
  for (const [k, r] of Object.entries(RECIPES)) {
    if (r.params?.svg || (r.needsFile && !from?.key)) continue;
    recipes[k] = { label: r.label, about: r.about, params: r.params };
  }
  return { store: "c3d", ask: String(ask).replace(DESIGN_PREFIX, "").trim().slice(0, 1500), ...(from?.key ? { from: { key: from.key, name: from.name ?? "" } } : {}), recipes, ...(allowScript ? { allowScript: true } : {}) };
}

// What Claude is told: the design-engineer guide, the job, the helpers its scripts get, and how a script must look.
export function claudeSystem() {
  return `You are the design engineer for Charleston 3D, a small 3D-printing shop in Charleston, SC. You turn one plain request into a part that prints well the first time on a Bambu Lab printer (256 mm bed, 0.4 mm nozzle, PLA/PETG). Make it the best design you can: the right shape for what it is used for, clean proportions, real-world sizes and fits, rounded edges where hands touch it, and no wasted plastic.

# Design engineer guide
${GUIDE}

# The job
${JOB_TEXT.replace(/## Hard rules[\s\S]*$/, "")}
# Custom shapes: recipe "script"
When none of the recipes in the input makes the best version of the part, set "recipe" to "script" and put a Fusion Python script in "script". Use a recipe when it really is the best tool (signs, tags, plain boxes); write a script when the part needs its own shape (holders, stands, clips, organizers with compartments, brackets, cases, spacers).
- The script defines make(design, root, P) and builds the part in root. Fusion's adsk.core, adsk.fusion and math are already imported, and these helpers are already defined (sizes are CENTIMETRES; wrap millimetres with mm()):
\`\`\`python
${LABKIT}
\`\`\`
- The design is in direct-modeling mode (no timeline). Sketches, extrudes, fillets, chamfers, shells, combines, revolves and patterns all work. P holds the "params" you give (millimetres); use mm() on them.
- Geometry only: no import statements, no open(), no files, programs or network (code rejects them). No print().
- One solid body (or several bodies that print together), with a flat face on the bed at z = 0, everything within 256 x 256 x 256 mm.
- Keep it under 30 KB. Put the main sizes in "params" so a person can change them later.
- "expectSize": {"x": , "y": , "z": } in millimetres: the overall size the finished part must have (x and y across the bed, z up). Code builds the part in Fusion and compares; every request needs it.

# Output
One JSON object only, in the Output shape above plus "expectSize" (always) and "script" (only for recipe "script"). For a recipe, "params" holds every parameter of that recipe. For a script, "params" holds the sizes your script reads.

# Hard rules
${JOB_TEXT.match(/## Hard rules\n([\s\S]*)$/)?.[1].replace(/^- Only the recipes in the input\..*$/m, "- Recipes from the input, or a \"script\" when no recipe makes the best part.") ?? ""}`;
}

// ---------- checks ----------
const sorted = (s) => [s.x, s.y, s.z].map(Number).sort((a, b) => a - b);

// Code checks on the answer (before Fusion sees it). Recipes: the same check as the local job. Scripts: the engine's rules.
export function checkBest(input, out) {
  if (out?.recipe !== "script") {
    const bad = check("fusion-design", JOB_TEXT, input, out);
    if (out?.canDo === "yes" && out?.recipe !== "resize" && !validSize(out.expectSize)) bad.push('expectSize must be {"x":, "y":, "z":} in millimetres, the size of the finished part');
    return bad;
  }
  if (!input.allowScript) return ['recipe must be one of the recipes in the input; scripts are not allowed here'];
  // The shared checks (every output key, the store, no other brand, nothing that looks like a key), minus the recipe list.
  const bad = check("fusion-design", JOB_TEXT, input, out).filter((m) => !/^recipe must be one of/.test(m));
  if (out.canDo !== "yes") bad.push('canDo must be "yes" for a script');
  try { cleanScript(out.script); } catch (e) { bad.push(`script: ${e.message}`); }
  if (/^\s*(?:import|from)\s+\w/m.test(String(out.script ?? ""))) bad.push("script: no import statements (adsk, math and the helpers are already there)");
  if (out.params == null || typeof out.params !== "object" || Array.isArray(out.params)) bad.push("params must be an object (the sizes the script reads, in mm)");
  const name = String(out.name ?? "").trim();
  if (!name || name.length > 60) bad.push("name must be 1 to 60 characters");
  if (/\b(?:test|draft|v\d|c3d|ed)\b/i.test(name)) bad.push('name must not have a store code or work label ("test", "draft", "v2")');
  if (!Array.isArray(out.formats) || !out.formats.length || out.formats.some((f) => !["3mf", "stl", "step"].includes(f))) bad.push('formats must be a list of "3mf", "stl" or "step"');
  if (!Array.isArray(out.printNotes) || out.printNotes.length > 3) bad.push("printNotes must be a list of at most 3 short tips");
  if (!validSize(out.expectSize)) bad.push('expectSize must be {"x":, "y":, "z":} in millimetres, each between 1 and 256');
  return bad;
}
const validSize = (s) => s && ["x", "y", "z"].every((k) => Number.isFinite(Number(s[k])) && Number(s[k]) >= 1 && Number(s[k]) <= 256);

// The built part against what was asked: Fusion's result, the print check and the size. Returns problems in plain words.
export function judgeBuild(out, result, printCheck) {
  if (!result?.ok) return [`Fusion could not build it. The end of the error was:\n${String(result?.error ?? "unknown").trim().split("\n").slice(-6).join("\n")}`];
  const bad = [];
  if (printCheck && !printCheck.ok) bad.push(`the print check failed: ${printCheck.notes.join(" ")}`);
  if (out.expectSize && result.size) {
    const want = sorted(out.expectSize), got = sorted(result.size);
    const off = want.map((w, i) => Math.abs(w - got[i]) > Math.max(1, w * 0.03));
    if (off.some(Boolean)) bad.push(`the built part is ${result.size.x} x ${result.size.y} x ${result.size.z} mm but expectSize says ${out.expectSize.x} x ${out.expectSize.y} x ${out.expectSize.z} mm; fix the geometry (or expectSize if the part is right)`);
  }
  return bad;
}

// ---------- models ----------
// Alice's Claude on the Blink. The call goes over SSH to the Blink's own localhost, so the key stays there.
export function askBlinkClaude(system, prompt, { maxTokens = 16000, engine = ENGINES["claude-blink"], timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!engine?.ssh) return reject(Object.assign(new Error("no claude-blink engine in ai-jobs/engines.json"), { code: "config" }));
    const ssh = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", engine.ssh,
      `curl -s -m ${Math.round(timeoutMs / 1000)} -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${engine.port}/api/claude-job`], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { ssh.kill(); reject(Object.assign(new Error("Claude took too long"), { code: "slow" })); }, timeoutMs + 15000);
    ssh.stdout.on("data", (d) => { out += d; });
    ssh.on("error", (e) => { clearTimeout(timer); reject(Object.assign(e, { code: "ssh" })); });
    ssh.on("close", () => {
      clearTimeout(timer);
      let body;
      try { body = JSON.parse(out); } catch { return reject(Object.assign(new Error("no answer from the Blink"), { code: "blink" })); }
      if (body.reply) resolve(String(body.reply));
      else reject(Object.assign(new Error(`Claude: ${body.error?.message ?? body.error ?? "no reply"}`), { code: String(body.error ?? "unknown") }));
    });
    ssh.stdin.end(JSON.stringify({ system, prompt, max_tokens: maxTokens }));
  });
}

// Claude's conversation as one prompt (the Blink endpoint takes one user turn): the request, then every earlier
// answer and what was wrong with it, so each round fixes the last one.
export function claudePrompt(input, rounds) {
  const req = { store: input.store, ask: input.ask, ...(input.from ? { from: input.from } : {}), recipes: input.recipes };
  let p = `Request and recipes (JSON):\n${JSON.stringify(req, null, 2)}\n\nAnswer with one JSON object only.`;
  for (const r of rounds) p += `\n\n--- Your earlier answer ---\n${r.raw}\n\n--- What was wrong with it ---\n- ${r.problems.join("\n- ")}\n\nFix every point and send the whole JSON object again.`;
  return p;
}

// The local model already loaded on the Blink (it never loads one), the same way Alice's mailbox asks it.
export function localAsker(engine = ENGINES["local-big"]) {
  return (messages) => withForward(engine, async (base) => {
    const models = await (await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) })).json().catch(() => ({ data: [] }));
    const model = (models.data ?? []).find((m) => m.state === "loaded")?.id ?? engine.model;
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(engine.timeoutMs ?? 300000),
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1200, stream: false }),
    });
    if (!r.ok) throw new Error(`model answered ${r.status}`);
    return String((await r.json()).choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
  });
}

// ---------- the loop ----------
let seq = 0;
export function testJob(out, input) {
  return { id: `fubest${Date.now().toString(36)}${(seq++).toString(36)}`, name: out.name, recipe: out.recipe, params: out.params ?? {}, ...(out.recipe === "script" ? { script: out.script } : {}), formats: ["stl"], ...(out.recipe === "resize" ? { from: input.from?.key } : {}) };
}

// Fusion test build + print check. A resize needs the library file, so it is checked by the runner's own build.
export async function testBuild(out, input, { build = buildInFusion, printCheck = (f) => checkFile(f) } = {}) {
  if (out.recipe === "resize") return { problems: [], skipped: true };
  const { folder, result } = await build(testJob(out, input));
  let pc = null;
  if (result?.ok && result.files?.stl) { try { pc = printCheck(path.join(folder, result.files.stl)); } catch (e) { pc = { ok: false, notes: [`could not read the STL (${e.message})`] }; } }
  return { problems: judgeBuild(out, result, pc), size: result?.size, printCheck: pc, preview: result?.preview ? path.join(folder, result.preview) : null };
}

// Claude first, local model as the backup; each answer is checked by code and test-built before it counts.
// Returns { ok, output, by, rounds, size, printCheck } or { ok: false, problems, by }.
export async function designBest(input, { claude = askBlinkClaude, local = null, build, printCheck, rounds = ROUNDS, log = () => {}, keep = keepExample } = {}) {
  const tries = [];
  let claudeDown = null;
  if (claude) {
    const system = claudeSystem();
    for (let i = 0; i < rounds; i++) {
      let raw = "", out = null, problems;
      try {
        raw = await claude(system, claudePrompt(input, tries));
        out = tidy("fusion-design", extractJson(raw), input);
        problems = checkBest(input, out);
      } catch (e) {
        if (e.code && !/^(slow)$/.test(e.code) && !raw) { claudeDown = e.message; log(`Claude not reachable (${e.code}); using the local model`); break; }
        problems = [e.message];
      }
      if (!problems.length && out.canDo !== "yes") return { ok: true, output: out, by: "claude", rounds: i + 1 };
      let t = null;
      if (!problems.length) { t = await testBuild(out, input, { build, printCheck }); problems = t.problems; }
      log(`Claude round ${i + 1}: ${problems.length ? problems.length + " problem(s)" : "passed"}`);
      if (!problems.length) { keep(input, out); return { ok: true, output: out, by: "claude", rounds: i + 1, size: t?.size, printCheck: t?.printCheck, preview: t?.preview }; }
      tries.push({ raw: raw || "(no answer)", problems });
    }
    if (!claudeDown) return { ok: false, by: "claude", problems: tries.at(-1)?.problems ?? ["no answer"] };
  }
  if (!local) return { ok: false, by: "none", problems: [claudeDown ?? "no designer available"] };
  // The local model: recipes only, the same checks and test build, with the problems fed back.
  const lin = { ...input }; delete lin.allowScript;
  let problems = null, raw = "";
  for (let i = 0; i < rounds; i++) {
    let out = null;
    try {
      raw = await local(buildMessages(JOB_TEXT, lin, problems, raw));
      out = tidy("fusion-design", extractJson(raw), lin);
      problems = check("fusion-design", JOB_TEXT, lin, out);
    } catch (e) { problems = [e.message]; }
    if (!problems.length && out.canDo !== "yes") return { ok: true, output: out, by: "local", rounds: i + 1, claudeDown };
    let t = null;
    if (!problems.length) { t = await testBuild(out, lin, { build, printCheck }); problems = t.problems; }
    log(`local round ${i + 1}: ${problems.length ? problems.length + " problem(s)" : "passed"}`);
    if (!problems.length) return { ok: true, output: out, by: "local", rounds: i + 1, size: t?.size, printCheck: t?.printCheck, claudeDown };
  }
  return { ok: false, by: "local", problems, claudeDown };
}

// Rule 20: a design Claude got through becomes an example the local model can learn from (saved on this PC only).
function keepExample(input, out) {
  try {
    fs.mkdirSync(EXAMPLES, { recursive: true });
    fs.writeFileSync(path.join(EXAMPLES, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ ask: input.ask, output: out }, null, 2));
  } catch { /* an example is a bonus, never a reason to fail */ }
}

// The Lab job for a design that passed.
export function labJob(out, input) {
  return { name: out.name, by: "Alice", recipe: out.recipe, params: out.params ?? {}, ...(out.recipe === "script" ? { script: out.script } : {}), formats: out.formats, ...(out.recipe === "resize" ? { from: input.from.key } : {}) };
}

const r1 = (n) => Math.round(Number(n) * 10) / 10;
// Alice's reply in the Lab, in plain words.
export function bestReply(d, sent) {
  if (!d.ok) return `I couldn't get a design to pass every check yet (${(d.problems ?? []).slice(0, 2).join("; ").slice(0, 300)}). Add the size in millimetres and what it's for, and I'll try again.`;
  const out = d.output;
  if (out.canDo !== "yes") return `I can't make that one in Fusion. ${out.notes ?? ""}`.trim();
  const how = out.recipe === "script" ? "a custom Fusion design" : RECIPES[out.recipe]?.label.toLowerCase();
  const size = d.size ? `, ${r1(d.size.x)} x ${r1(d.size.y)} x ${r1(d.size.z)} mm` : "";
  const grams = d.printCheck?.grams ? `, about ${d.printCheck.grams} g of PLA` : "";
  const checked = d.size ? " It passed a test build in Fusion and the print check." : "";
  const tips = out.printNotes?.length ? ` Print tips: ${out.printNotes.join(" ")}` : "";
  const who = d.by === "local" && d.claudeDown ? " (Claude wasn't available, so the local model designed this one.)" : "";
  return sent ? `I sent ${out.name} (${how}${size}${grams}) to Fusion on the NUC.${checked} The files go to the 3D file library when it's built, and it shows in Make, 3D maker.${tips}${who}`
    : `Here's the plan: ${out.name} (${how}${size}${grams}).${checked}${tips}${who}`;
}

// ---------- command line ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const ask = opt("ask");
  if (!ask) { console.error('Usage: node scripts/fusion-best.mjs --ask "what to make" [--from <file key>] [--send] [--local]'); process.exit(2); }
  if (!fusionUp()) { console.error("Open Fusion first (the LabBridge add-in starts with it)."); process.exit(2); }
  const input = bestInput(ask, opt("from") ? { key: opt("from"), name: opt("from-name") } : null);
  const d = await designBest(input, { claude: args.includes("--local") ? null : askBlinkClaude, local: localAsker(), log: (m) => console.error(m) });
  console.log(JSON.stringify({ ...d, output: d.output && { ...d.output, script: d.output.script ? `(${d.output.script.length} characters)` : undefined } }, null, 2));
  if (d.ok && d.output.canDo === "yes" && args.includes("--send")) {
    const { readKey } = await import("../drive-server/key.mjs");
    const { sendJob } = await import("./fusion-design.mjs");
    const job = await sendJob(labJob(d.output, input), readKey());
    console.log(bestReply(d, true), `(job ${job?.id ?? "sent"})`);
  } else console.log(bestReply(d, false));
}
