// The Lab's "ask Claude" (the claude.ai `sample` capability), answered on the server.
// Order is set in the config: Alice (the local model on the Blink, OpenAI-style API from LM Studio) first
// for plain questions, then Claude through the API key Aaron types at install, then the Claude Code
// command line signed in to his Claude plan. Tool calls and images go straight to Claude.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

const TIER_MODEL = { quick: "claude-haiku-5-5", default: "claude-opus-5-5", complex: "claude-opus-5-5" };
const TIER_EFFORT = { quick: "low", default: "medium", complex: "high" };

export function makeAI(cfg) {
  const order = (cfg.aiOrder || ["alice", "anthropic", "claude-cli"]).filter(p =>
    p === "alice" ? !!cfg.aliceUrl : p === "anthropic" ? !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) : p === "claude-cli" ? !!cfg.claudeCli : false);
  const client = order.includes("anthropic") ? new Anthropic() : null;

  async function viaAlice(req, emit, signal) {
    if (req.tools?.length || req.images?.length || req.modelTier === "complex") throw skip("Alice handles plain questions only");
    const messages = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.filter(b => b.type === "text").map(b => b.text).join("\n") });
    const r = await fetch(cfg.aliceUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(cfg.aliceTimeoutMs || 90000)]),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.aliceModel || "local", messages, stream: true, temperature: 0.4 }),
    });
    if (!r.ok || !r.body) throw skip(`Alice answered ${r.status}`);
    let text = "", buf = "";
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString("utf8");
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim(); if (d === "[DONE]") continue;
        try { const delta = JSON.parse(d).choices?.[0]?.delta?.content; if (delta) { text += delta; emit({ t: "delta", text: delta }); } } catch {}
      }
    }
    // a small local model sometimes thinks out loud in <think> tags; never show that
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw skip("Alice gave an empty answer");
    return { content: [{ type: "text", text }], stop_reason: "end_turn", modelApplied: "alice:" + (cfg.aliceModel || "local") };
  }

  async function viaAnthropic(req, emit, signal) {
    const tier = TIER_MODEL[req.modelTier] ? req.modelTier : "default";
    const model = req.model && /^claude-[a-z0-9-]+$/.test(req.model) ? req.model : TIER_MODEL[tier];
    const messages = req.messages.map(m => ({ role: m.role, content: m.content }));
    if (req.images?.length) {
      const last = messages.at(-1);
      const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
      last.content = [...req.images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })), ...blocks];
    }
    const params = {
      model, max_tokens: req.maxTokens || 32000, messages,
      output_config: { effort: req.effort || TIER_EFFORT[tier] },
      ...(req.system ? { system: req.system } : {}),
      ...(req.tools?.length ? { tools: req.tools.map(t => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object", properties: {} } })) } : {}),
    };
    const stream = client.messages.stream(params, { signal });
    stream.on("text", delta => emit({ t: "delta", text: delta }));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw Object.assign(new Error("Claude declined this request."), { code: "refused" });
    return { content: msg.content.filter(b => b.type === "text" || b.type === "tool_use"), stop_reason: msg.stop_reason, modelApplied: msg.model };
  }

  function viaCli(req, emit, signal) {
    if (req.tools?.length || req.images?.length) return Promise.reject(skip("the Claude command line here answers plain questions only"));
    const prompt = [req.system, ...req.messages.map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${typeof m.content === "string" ? m.content : m.content.filter(b => b.type === "text").map(b => b.text).join("\n")}`)].filter(Boolean).join("\n\n");
    return new Promise((resolve, reject) => {
      const p = spawn(cfg.claudeCli, ["-p", "--output-format", "text", "--model", req.modelTier === "quick" ? "haiku" : "opus"], { signal, stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      p.stdout.on("data", d => { const s = d.toString(); out += s; emit({ t: "delta", text: s }); });
      p.stderr.on("data", d => { err += d; });
      p.on("error", reject);
      p.on("close", code => code === 0 && out.trim() ? resolve({ content: [{ type: "text", text: out.trim() }], stop_reason: "end_turn", modelApplied: "claude-cli" }) : reject(skip(`claude exited ${code}: ${err.slice(0, 200)}`)));
      p.stdin.end(prompt);
    });
  }

  const run = { alice: viaAlice, anthropic: viaAnthropic, "claude-cli": viaCli };
  return {
    providers: order,
    limits: () => ({ maxPromptBytes: 4_000_000, images: order.includes("anthropic") ? { maxCount: 20, maxInputBytes: 5 * 2 ** 20, mediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] } : undefined, tools: order.includes("anthropic") ? { maxCount: 32 } : undefined }),
    async answer(req, emit, signal) {
      if (!order.length) throw Object.assign(new Error("No AI is set up on the server yet."), { code: "sampling_disabled" });
      let last;
      for (const p of order) {
        // the page may ask for a model by name only when Aaron names it; that always goes to Claude
        if (req.model && p === "alice") continue;
        try { const r = await run[p](req, emit, signal); return { ...r, tierApplied: req.modelTier || "default", provider: p }; }
        catch (e) {
          if (signal.aborted) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          last = e; if (e.code === "refused") throw e;
          emit({ t: "reset" }); // anything streamed by a provider that failed is thrown away
        }
      }
      throw Object.assign(new Error(last?.message || "No AI answered."), { code: "upstream_error" });
    },
  };
}
function skip(message) { return Object.assign(new Error(message), { code: "skip" }); }
