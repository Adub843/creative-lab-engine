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
export function tidy(jobId, out, input) {
  // The daily brief's "needs you" list is built by code from the digest (scripts/daily-brief.mjs): the model's own list is replaced.
  if (jobId === "daily-brief" && out && Array.isArray(input?.needsYou)) out.needsYou = [...input.needsYou];
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

const numbers = (t) => (String(t).replace(/,(?=\d{3})/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

// Checks every job shares, then the listing-copy limits. Returns a list of problems (empty = pass).
export function check(jobId, jobText, input, out) {
  const bad = [];
  if (!out || typeof out !== "object" || Array.isArray(out)) return ["answer is not a JSON object"];
  for (const k of outputKeys(jobText)) if (!(k in out)) bad.push(`missing "${k}"`);
  if (input.store && out.store !== input.store) bad.push(`store must be "${input.store}"`);
  const text = JSON.stringify(out);
  if (OTHER[input.store]?.test(text)) bad.push("names the other brand");
  if (/shpat_|sk-[A-Za-z0-9]{10}/.test(text)) bad.push("contains something that looks like a key");
  if ("notes" in out && typeof out.notes !== "string") bad.push('notes must be one text string ("" if nothing is missing)');
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
  if (jobId === "review-summary") {
    const said = (input.reviews ?? []).map((r) => String(r.text ?? "")).concat((input.requests ?? []).map(String)).join("\n").toLowerCase();
    const real = (q) => typeof q === "string" && q.trim().length > 3 && said.includes(q.trim().replace(/^["'“”]+|["'“”.]+$/g, "").toLowerCase());
    if (out.count !== (input.reviews ?? []).length) bad.push(`count must be ${(input.reviews ?? []).length}, the number of reviews in the input`);
    for (const t of out.themes ?? []) for (const q of t.quotes ?? []) if (!real(q)) bad.push(`quote is not word for word from a review: "${String(q).slice(0, 60)}"; copy an exact phrase`);
    for (const q of out.postQuotes ?? []) {
      if (!real(q?.quote)) bad.push(`post quote is not word for word from a review: "${String(q?.quote).slice(0, 60)}"`);
      if (!/needs Aaron's OK/i.test(q?.status ?? "")) bad.push(`every postQuotes status must be "needs Aaron's OK before use"`);
    }
    if ((out.changes ?? []).length > 3) bad.push("at most 3 changes");
    if ((out.postQuotes ?? []).length > 3) bad.push("at most 3 postQuotes");
    if (!Array.isArray(out.themes) || !out.themes.length) bad.push("themes must be a list with at least one theme");
    const dates = (input.reviews ?? []).map((r) => r.date).filter(Boolean).sort();
    if (dates.length && (out.period?.from !== dates[0] || out.period?.to !== dates.at(-1))) bad.push(`period must be from ${dates[0]} to ${dates.at(-1)}, the first and last review dates in the input`);
    const made = [...new Set(numbers((out.changes ?? []).map((c) => c?.change).join(" ")).filter((n) => !numbers(JSON.stringify(input)).includes(n)))];
    if (made.length) bad.push(`changes use numbers that no review gave (${made.join(", ")}); never state a time, count or price that is not in the input`);
  }
  if (jobId === "daily-brief") {
    const words = String(out.brief ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (words < 15 || words >= 120) bad.push(`brief must be under 120 words of plain text (is ${words})`);
    if (!Array.isArray(out.needsYou)) bad.push("needsYou must be a list of short sentences (an empty list if nothing)");
    const day = input.date ?? input.digest?.siteCheck?.date;
    if (day ? out.date !== day : !/^\d{4}-\d{2}-\d{2}$/.test(out.date ?? "")) bad.push(`date must be ${day ?? "YYYY-MM-DD, the digest's date"}`);
    const flat = (t) => String(t ?? "").replace(/\s+/g, " ");
    if (input.numbers && !flat(out.brief).includes(flat(input.numbers))) bad.push(`the brief must contain this sentence word for word: "${input.numbers}"`);
    const shop = input.digest?.shop ?? {};
    for (const [field, words] of [["sessions", "sessions|visits|visitors|traffic|activity"], ["orders", "orders"], ["sales", "sales"]]) {
      if (shop[field] > 0 && new RegExp(`\\b(?:no|zero|0)\\s+(?:${words})\\b`, "i").test(`${out.brief} ${[].concat(out.needsYou ?? []).join(" ")} ${out.notes ?? ""}`)) bad.push(`the input has ${shop[field]} ${field}, so do not say there were none`);
    }
    if (Array.isArray(input.needsYou) && JSON.stringify(out.needsYou) !== JSON.stringify(input.needsYou)) bad.push("needsYou must be the input's needsYou list, unchanged");
    if (Array.isArray(input.needsYou) && !input.needsYou.length && /needs? (?:you|aaron|your attention)|you (?:need|must|should)/i.test(out.brief ?? "")) bad.push("the input's needsYou list is empty, so the brief must not say anything needs Aaron");
    const sc = input.digest?.siteCheck;
    if (sc && sc.today === false && sc.date && !flat(out.brief).includes(sc.date)) bad.push(`the site check is an older one: say in the brief that it is from ${sc.date}`);
    // Every number in the brief has to be in the input (or be a plain difference of two input numbers).
    const nums = (t) => (String(t).replace(/,(?=\d{3})/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const have = nums(JSON.stringify(input));
    const ok = (n) => have.some((h) => Math.abs(h - n) < 0.005) || have.some((a) => have.some((b) => Math.abs(Math.abs(a - b) - n) < 0.006));
    const invented = [...new Set(nums(`${out.brief} ${[].concat(out.needsYou ?? []).join(" ")}`).filter((n) => !ok(n)))];
    if (invented.length) bad.push(`these numbers are not in the input: ${invented.join(", ")}; use only numbers from the input`);
  }
  return bad;
}

export function buildMessages(jobText, input, problems, lastAnswer) {
  const system = `You run one job for a small business. Follow the instructions and hard rules exactly.\n\n## Instructions\n${section(jobText, "Instructions")}\n\n## Output\n${section(jobText, "Output")}\n\n## Hard rules\n${section(jobText, "Hard rules")}`;
  const brand = BRAND[input.store];
  const user = `${brand ? `The brand name for store "${input.store}" is "${brand}"; use that name in text people read, but keep "store": "${input.store}" exactly. ` : ""}${/listing-copy/.test(jobText.slice(0, 40)) ? "Write the SEO description as 26 to 30 words in two or three sentences. " : ""}Input JSON:\n${JSON.stringify(input, null, 2)}\n\nThe dates and numbers shown in the Output shape are placeholders: take every date and number from the input. \"notes\" is one text string. Answer with one JSON object only, in the Output shape. No other text.`;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  if (problems?.length) {
    if (lastAnswer) messages.push({ role: "assistant", content: lastAnswer });
    messages.push({ role: "user", content: `That answer was rejected. Fix these and send the whole JSON object again:\n- ${problems.join("\n- ")}` });
  }
  return messages;
}

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });

export async function withForward(engine, fn) {
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

// The order engines are tried in: the job's engine, then each fallback once. The two local engines point at each
// other, so the walk stops when it comes back round, and a job no local engine could do ends at claude.
export function engineChain(start, fallback, engines) {
  const chain = [];
  for (let n = start; n && !chain.includes(n); n = fallback[n]) chain.push(n);
  if (engines.claude && !chain.includes("claude")) chain.push("claude");
  return chain;
}

export async function runJob(jobId, input, { engineName, log = () => {} } = {}) {
  const { jobs } = JSON.parse(fs.readFileSync(path.join(DIR, "jobs.json"), "utf8"));
  const { engines, fallback } = JSON.parse(fs.readFileSync(path.join(DIR, "engines.json"), "utf8"));
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`no job "${jobId}" in jobs.json`);
  const jobText = fs.readFileSync(path.join(DIR, job.file), "utf8");
  const tries = [];
  for (const name of engineChain(engineName ?? job.engine, fallback, engines)) {
    const engine = engines[name];
    if (!engine) throw new Error(`no engine "${name}" in engines.json`);
    if (engine.manual) return { ok: false, engine: name, needsClaude: true, tries };
    let problems = null, raw = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t0 = Date.now(); let out = null;
      try {
        const messages = buildMessages(jobText, input, problems, raw);
        raw = await withForward(engine, (base) => ask(base, engine, messages));
        out = tidy(jobId, extractJson(raw), input); problems = check(jobId, jobText, input, out);
      } catch (e) { problems = [e.message]; }
      const t = { engine: name, model: engine.model, attempt, seconds: +((Date.now() - t0) / 1000).toFixed(1), problems, raw };
      tries.push(t); log(`${name} try ${attempt}: ${t.seconds}s ${problems.length ? "REJECTED: " + problems.join("; ") : "passed"}`);
      if (!problems.length) return { ok: true, engine: name, output: out, tries };
      if (/^cannot reach /.test(problems[0])) break; // that PC is off or asleep: go straight to the next engine
    }
  }
  return { ok: false, tries };
}

export function saveRun(jobId, input, result) {
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
