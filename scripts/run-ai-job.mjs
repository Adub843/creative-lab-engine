// Runs one AI job from ai-jobs/ on Aaron's own machines (rule 20: local model first, Claude for judgment calls).
//   node scripts/run-ai-job.mjs <job-id> --input <file.json> [--engine local-small|local-big] [--out <file.json>]
// It reads the job file, sends its Instructions and Hard rules plus the input JSON to the engine named in
// jobs.json (or --engine), checks the answer is JSON in the job's Output shape, tries once more if it isn't, then
// moves to the fallback engine in engines.json. If the last fallback is "claude", the input is saved in
// ai-jobs/runs/needs-claude/ for a Claude session to pick up. Every run is logged in ai-jobs/runs/ (not in git),
// which doubles as the examples file for improving the local model. No keys: the models listen on localhost on
// their own machine and are reached through an SSH forward.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../ai-jobs/", import.meta.url));
const RUNS = path.join(DIR, "runs");
export const BRAND = { c3d: "Charleston 3D", ed: "Elevated Designs" };
const OTHER = { c3d: /elevated\s*designs|elevatedshirts|epix3d/i, ed: /charleston\s*3d|charleston3d/i };

export function section(text, name) {
  const m = text.split(/^## /m).find((p) => p.startsWith(name + "\n") || p.startsWith(name + "\r\n"));
  return m ? m.slice(name.length).trim() : "";
}

// The top-level keys of the first json block in the Output section.
export function outputKeys(jobText) {
  const block = /```json\s*([\s\S]*?)```/.exec(section(jobText, "Output"))?.[1] ?? "";
  const keys = []; let depth = 0, inStr = false;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === '"' && block[i - 1] !== "\\") {
      if (!inStr && depth === 1) { const m = /^"([A-Za-z0-9_]+)"\s*:/.exec(block.slice(i)); if (m) keys.push(m[1]); }
      inStr = !inStr;
    } else if (!inStr) { if (c === "{" || c === "[") depth++; else if (c === "}" || c === "]") depth--; }
  }
  return keys;
}

// Pulls the JSON object out of a model answer: drops any <think> block and code fences.
export function extractJson(answer) {
  let t = String(answer ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = t.lastIndexOf("</think>"); if (close >= 0) t = t.slice(close + 8);
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in the answer");
  const body = t.slice(a, b + 1);
  try { return JSON.parse(body); } catch { return JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")); }
}

// Small models cannot count characters, so code does the exact fitting: an SEO description that runs long is cut
// back to its last whole sentence (or word) that fits in 155 characters. Nothing is added or reworded.
export function tidy(jobId, out) {
  if (jobId !== "listing-copy" || typeof out?.seo?.description !== "string") return out;
  let d = out.seo.description.trim().replace(/\s+/g, " ");
  if (d.length > 155) {
    const cut = d.slice(0, 156);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
    d = stop >= 139 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "") + ".";
    if (d.length > 155) d = d.slice(0, d.lastIndexOf(" ", 153)).replace(/[,;:\s]+$/, "") + ".";
  }
  out.seo.description = d;
  return out;
}

// Checks every job shares, then the listing-copy limits. Returns a list of problems (empty = pass).
export function check(jobId, jobText, input, out) {
  const bad = [];
  if (!out || typeof out !== "object" || Array.isArray(out)) return ["answer is not a JSON object"];
  for (const k of outputKeys(jobText)) if (!(k in out)) bad.push(`missing "${k}"`);
  if (input.store && out.store !== input.store) bad.push(`store must be "${input.store}"`);
  const text = JSON.stringify(out);
  if (OTHER[input.store]?.test(text)) bad.push("names the other brand");
  if (/shpat_|sk-[A-Za-z0-9]{10}/.test(text)) bad.push("contains something that looks like a key");
  if (jobId === "listing-copy") {
    const len = (s) => (typeof s === "string" ? s.length : -1);
    if (!(len(out.title) > 0 && len(out.title) < 70)) bad.push(`title must be under 70 characters (is ${len(out.title)})`);
    if (!(len(out.seo?.title) > 0 && len(out.seo.title) < 60)) bad.push(`seo.title must be under 60 characters (is ${len(out.seo?.title)})`);
    const d = len(out.seo?.description);
    if (d < 140 || d > 155) bad.push(d < 140 ? `seo.description is too short (${d} characters); add about ${Math.ceil((148 - d) / 6)} more words of real facts from the input` : `seo.description must be 140 to 155 characters (is ${d})`);
    const brand = BRAND[input.store];
    if (brand && !String(out.seo?.title ?? "").endsWith(brand)) bad.push(`seo.title must end with the brand name "${brand}"`);
    if (/\b(c3d|ed)\b/.test(`${out.title} ${out.seo?.title}`)) bad.push(`never show the store code; the brand name is "${brand}"`);
    if (out.price !== input.product?.price) bad.push(`price must stay ${input.product?.price}`);
    if (!/^<p>/.test(out.descriptionHtml ?? "")) bad.push("descriptionHtml must be HTML paragraphs");
    for (const a of out.alt ?? []) if (len(a?.alt) >= 125) bad.push("alt text must be under 125 characters");
  }
  return bad;
}

export function buildMessages(jobText, input, problems, lastAnswer) {
  const system = `You run one job for a small business. Follow the instructions and hard rules exactly.\n\n## Instructions\n${section(jobText, "Instructions")}\n\n## Output\n${section(jobText, "Output")}\n\n## Hard rules\n${section(jobText, "Hard rules")}`;
  const brand = BRAND[input.store];
  const user = `${brand ? `The brand name for store "${input.store}" is "${brand}"; use that name in text people read, but keep "store": "${input.store}" exactly. ` : ""}Write the SEO description as 26 to 30 words in two or three sentences. Input JSON:\n${JSON.stringify(input, null, 2)}\n\nAnswer with one JSON object only, in the Output shape. No other text.`;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  if (problems?.length) {
    if (lastAnswer) messages.push({ role: "assistant", content: lastAnswer });
    messages.push({ role: "user", content: `That answer was rejected. Fix these and send the whole JSON object again:\n- ${problems.join("\n- ")}` });
  }
  return messages;
}

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });

async function withForward(engine, fn) {
  const local = await freePort();
  const ssh = spawn("ssh", ["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10", "-L", `${local}:127.0.0.1:${engine.port}`, engine.ssh], { stdio: "ignore" });
  try {
    const base = `http://127.0.0.1:${local}`;
    for (let i = 0; ; i++) {
      try { const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) }); if (r.ok) break; } catch { /* not up yet */ }
      if (i > 15 || ssh.exitCode !== null) throw new Error(`cannot reach ${engine.ssh}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return await fn(base);
  } finally { ssh.kill(); }
}

async function ask(base, engine, messages) {
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ model: engine.model, messages, temperature: 0.3, max_tokens: engine.maxTokens ?? 1500, stream: false }),
  });
  if (!r.ok) throw new Error(`model answered ${r.status}`);
  return (await r.json()).choices?.[0]?.message?.content ?? "";
}

export async function runJob(jobId, input, { engineName, log = () => {} } = {}) {
  const { jobs } = JSON.parse(fs.readFileSync(path.join(DIR, "jobs.json"), "utf8"));
  const { engines, fallback } = JSON.parse(fs.readFileSync(path.join(DIR, "engines.json"), "utf8"));
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`no job "${jobId}" in jobs.json`);
  const jobText = fs.readFileSync(path.join(DIR, job.file), "utf8");
  const tries = [];
  for (let name = engineName ?? job.engine; name; name = fallback[name]) {
    const engine = engines[name];
    if (!engine) throw new Error(`no engine "${name}" in engines.json`);
    if (engine.manual) return { ok: false, engine: name, needsClaude: true, tries };
    let problems = null, raw = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t0 = Date.now(); let out = null;
      try {
        const messages = buildMessages(jobText, input, problems, raw);
        raw = await withForward(engine, (base) => ask(base, engine, messages));
        out = tidy(jobId, extractJson(raw)); problems = check(jobId, jobText, input, out);
      } catch (e) { problems = [e.message]; }
      const t = { engine: name, model: engine.model, attempt, seconds: +((Date.now() - t0) / 1000).toFixed(1), problems, raw };
      tries.push(t); log(`${name} try ${attempt}: ${t.seconds}s ${problems.length ? "REJECTED: " + problems.join("; ") : "passed"}`);
      if (!problems.length) return { ok: true, engine: name, output: out, tries };
    }
  }
  return { ok: false, tries };
}

function saveRun(jobId, input, result) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(path.join(RUNS, "needs-claude"), { recursive: true });
  fs.writeFileSync(path.join(RUNS, `${stamp} ${jobId}.json`), JSON.stringify({ job: jobId, at: new Date().toISOString(), input, ...result }, null, 2));
  if (!result.ok) fs.writeFileSync(path.join(RUNS, "needs-claude", `${stamp} ${jobId}.json`), JSON.stringify({ job: jobId, input, tries: result.tries.map(({ raw, ...t }) => t) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [jobId, ...rest] = process.argv.slice(2);
  const arg = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
  if (!jobId || !arg("--input")) { console.error("usage: node scripts/run-ai-job.mjs <job-id> --input <file.json> [--engine <name>] [--out <file.json>]"); process.exit(64); }
  const input = JSON.parse(fs.readFileSync(arg("--input"), "utf8"));
  const result = await runJob(jobId, input, { engineName: arg("--engine"), log: (m) => console.error(m) });
  saveRun(jobId, input, result);
  if (result.ok) { const s = JSON.stringify(result.output, null, 2); if (arg("--out")) fs.writeFileSync(arg("--out"), s); console.log(s); }
  else { console.error(result.needsClaude ? "Local models could not pass the checks. Saved for Claude in ai-jobs/runs/needs-claude/." : "Failed."); process.exit(2); }
}
