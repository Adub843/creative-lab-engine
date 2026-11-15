// "Ask Claude" with the page's own tools: Claude asks for a tool, the page runs it, Claude answers.
// Uses a stand-in for the Anthropic API so no key or money is needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { makeServer } from "../server/index.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
let api, lab, base, browser, seen = [];
const sse = (res, events) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); res.end(); };
const msg = (stop, blocks) => [
  { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } },
  ...blocks.flatMap((b, i) => b.type === "text"
    ? [{ type: "content_block_start", index: i, content_block: { type: "text", text: "" } }, ...b.text.match(/.{1,5}/g).map(t => ({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: t } })), { type: "content_block_stop", index: i }]
    : [{ type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }, { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }, { type: "content_block_stop", index: i }]),
  { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 5 } }, { type: "message_stop" },
];
before(async () => {
  api = createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => {
    const body = JSON.parse(b); seen.push(body);
    const last = body.messages.at(-1);
    if (Array.isArray(last.content) && last.content[0]?.type === "tool_result") return sse(res, msg("end_turn", [{ type: "text", text: "There are " + last.content[0].content + " open asks." }]));
    sse(res, msg("tool_use", [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tu_1", name: "count_asks", input: { status: "open" } }]));
  }); });
  await new Promise(r => api.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${api.address().port}`; process.env.ANTHROPIC_API_KEY = "test-only";
  const dir = mkdtempSync(join(tmpdir(), "labai-")); mkdirSync(join(dir, "site"));
  writeFileSync(join(dir, "site/index.html"), "<!doctype html><html><head><meta charset=utf8></head><body></body></html>");
  const cfg = { port: 0, dataDir: join(dir, "data"), labDir: join(dir, "site"), aiOrder: ["anthropic"] };
  lab = makeServer(cfg); await new Promise(r => lab.server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${lab.server.address().port}`; cfg.origin = base;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); await new Promise(r => lab.server.close(r)); api.close(); delete process.env.ANTHROPIC_BASE_URL; delete process.env.ANTHROPIC_API_KEY; });

test("Claude uses the page's tool, then answers", async () => {
  const ctx = await browser.newContext(); await ctx.addCookies([{ name: "lab_s", value: lab.auth.newSession("aaron", "t"), url: base }]);
  const p = await ctx.newPage(); await p.goto(base + "/");
  const r = await p.evaluate(async () => {
    const sample = await claude.use("sample"); const texts = []; const calls = [];
    const res = await sample([{ role: "user", content: "How many asks are open?" }], {
      modelTier: "complex", onText: u => texts.push(u.text),
      tools: [{ name: "count_asks", description: "Count asks", inputSchema: { type: "object", properties: { status: { type: "string" } } }, execute: i => { calls.push(i); return 4; } }],
    });
    return { text: res.text, calls, lastStream: texts.at(-1), tier: res.modelTierApplied, model: res.modelApplied };
  });
  assert.deepEqual(r.calls, [{ status: "open" }]);
  assert.equal(r.text, "There are 4 open asks.");
  assert.equal(r.lastStream, "Checking.\n\nThere are 4 open asks.");
  assert.equal(r.tier, "complex"); assert.equal(r.model, "claude-opus-5-5");
  assert.equal(seen[0].model, "claude-opus-5-5"); assert.equal(seen[0].output_config.effort, "high");
  assert.equal(seen[0].tools[0].name, "count_asks");
  assert.equal(seen[1].messages[1].role, "assistant"); assert.equal(seen[1].messages[2].content[0].tool_use_id, "tu_1");
});
