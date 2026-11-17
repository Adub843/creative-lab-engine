// Answers the questions people send Alice from the Lab console (lib/alice-mail.mjs).
//
// Runs on Aaron's PC every minute (scripts/schedule-alice-mailbox.ps1). Each run asks the engine for the next
// waiting question; only when there is one does it open the SSH forward to the Blink, ask the model that is ALREADY
// loaded there, and post the answer back. It never loads a model: the Blink shares one model between Alice and the
// other local jobs, and loading a second one crashed it (graphics memory, 2026-11-15). No model loaded = the
// question waits for the next run.
//
//   node scripts/alice-mailbox.mjs            answer everything waiting (up to 6 questions), then exit
//   node scripts/alice-mailbox.mjs --dry      show the next question without answering it
//
// The console key is the one drive-server/setup.ps1 stored on this PC; it is only sent to the engine as a header.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "../drive-server/key.mjs";
import { withForward } from "./run-ai-job.mjs";
import { DESIGN_PREFIX, designInput, designWith, jobFor, replyFor, sendJob } from "./fusion-design.mjs";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const ENGINES = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../ai-jobs/engines.json", import.meta.url)), "utf8")).engines;
const BLINK = ENGINES[process.env.ALICE_ENGINE ?? "local-big"];
const MAX_PER_RUN = 6;
const LOCK = path.join(os.tmpdir(), "alice-mailbox.lock");
const LOG = fileURLToPath(new URL("../ai-jobs/runs/alice-mailbox/mailbox.log", import.meta.url));
// One line per answer (names and timing only), kept under about 256 KB with one older copy.
function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) fs.renameSync(LOG, LOG + ".old");
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging never stops an answer */ }
}

export const ALICE_RULES = `You are Alice, the assistant inside the Lab, the back office for Elevated Designs (shirts) and Charleston3D (3D printing), both in Charleston, SC.
Answer the person who is signed in, by name when it fits. Plain, friendly, short sentences; under 150 words unless they ask for more.
Rules that always win:
- Elevated Designs and Charleston3D are separate brands. Never mix them in one answer about products, copy or prices.
- Never invent prices, numbers, reviews or facts. If you don't know, say so and say who could check.
- Never ask for or repeat passwords, keys or card numbers.
- You can't press buttons, publish, spend money or message customers. Say what to do and where in the Lab.`;

export function messagesFor(q) {
  const msgs = [{ role: "system", content: ALICE_RULES + (q.private ? "\nThis is a private question: it is saved only on this person's own console." : "") }];
  for (const h of q.history ?? []) msgs.push({ role: h.from === "alice" ? "assistant" : "user", content: h.text });
  msgs.push({ role: "user", content: `${q.person}: ${q.text}` });
  return msgs;
}

// The model that is loaded right now (LM Studio lists every model with its state), or null.
export async function loadedModel(base, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const list = (await r.json()).data ?? [];
    const m = list.find((x) => x.state === "loaded" && x.type !== "embeddings");
    return m ? m.id : null;
  } catch { return null; }
}

async function engine(pathname, key, init = {}) {
  const r = await fetch(ENGINE + pathname, { ...init, headers: { accept: "application/json", "x-console-key": key, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(30000) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname}: ${r.status} ${body?.error ?? ""}`);
  return body;
}

async function main() {
  const dry = process.argv.includes("--dry");
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); }
  catch {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < 10 * 60 * 1000) return; // the last run is still answering
    fs.writeFileSync(LOCK, String(process.pid));
  }
  try {
    const key = readKey();
    if (!key) { console.error("No console key on this PC yet: run drive-server\\setup.ps1 and type the key when asked."); process.exitCode = 1; return; }
    let q = (await engine("/api/alice/next", key)).question;
    if (!q) return;
    if (dry) { console.log(JSON.stringify({ id: q.id, person: q.person, private: q.private }, null, 2)); return; }
    await withForward(BLINK, async (base) => {
      const model = await loadedModel(base);
      if (!model) { log("no model loaded on the Blink; the question waits"); return; }
      for (let n = 0; q && n < MAX_PER_RUN; n++) {
        const t0 = Date.now();
        const chat = async (messages, temperature = 0.4, maxTokens = 700) => {
          const r = await fetch(`${base}/v1/chat/completions`, {
            method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180000),
            body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
          });
          if (!r.ok) throw new Error(`model answered ${r.status}`);
          return String((await r.json()).choices?.[0]?.message?.content ?? "");
        };
        let text;
        if (DESIGN_PREFIX.test(q.text)) {
          // "Design in Fusion: ..." from the Lab's 3D maker: Alice works as the design engineer (scripts/fusion-design.mjs).
          const input = designInput(q.text);
          const d = await designWith((m) => chat(m, 0.2, 1200), input);
          if (!d.ok) text = "I couldn't turn that into a Fusion part I trust yet. Add the size in millimetres and what it's for, or ask Claude for a custom script.";
          else if (d.output.canDo !== "yes") text = replyFor(d.output, false);
          else { await sendJob(jobFor(d.output, input), key); text = replyFor(d.output, true); }
        } else text = (await chat(messagesFor(q))).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (!text) throw new Error("the model gave an empty answer");
        await engine("/api/alice/answer", key, { method: "POST", body: JSON.stringify({ id: q.id, text: text.slice(0, 6000) }) });
        // Names and timing only: never the question or the answer, so private ones stay private on this PC too.
        log(`answered ${q.private ? "a private" : "a shared"} question from ${q.person} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        q = (await engine("/api/alice/next", key)).question;
      }
    });
  } finally { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log("failed: " + e.message); console.error(e.message); process.exitCode = 1; });
}
