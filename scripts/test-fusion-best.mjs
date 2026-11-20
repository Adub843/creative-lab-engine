// Tests for the best-design loop (scripts/fusion-best.mjs) with stand-in models, Fusion and print check:
// nothing here calls Claude, the Blink or Fusion.   node scripts/test-fusion-best.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "./fusion-best.mjs";

const SCRIPT = "def make(design, root, P):\n    block(root, mm(P['w']), mm(P['d']), mm(P['h']), mm(3))\n";
const scriptAnswer = (extra = {}) => JSON.stringify({ store: "c3d", canDo: "yes", recipe: "script", name: "Battery holder", params: { w: 57.2, d: 39.2, h: 24 }, formats: ["3mf", "stl"], printNotes: ["Print flat side down."], notes: "", expectSize: { x: 57.2, y: 39.2, z: 24 }, script: SCRIPT, ...extra });
const tagAnswer = (extra = {}) => JSON.stringify({ store: "c3d", canDo: "yes", recipe: "plate", name: "Rainbow Row key tag", params: { text: "Rainbow Row", width: 70, height: 25, thickness: 3.5, corner: 4, textSize: 6, textDepth: 1, holes: "keyring" }, formats: ["3mf", "stl"], printNotes: ["Print flat side down, no supports."], notes: "", expectSize: { x: 70, y: 25, z: 4.5 }, ...extra });
const goodBuild = (size) => async (job) => ({ folder: "x", result: { ok: true, size, files: { stl: "model.stl" }, job } });
const okCheck = () => ({ ok: true, grams: 32.6, notes: ["Ready to slice."] });
const quiet = { keep: () => {}, printCheck: okCheck };

test("Claude's custom script passes code checks, a test build and the print check in one round", async () => {
  const input = B.bestInput("Design in Fusion: a holder for 6 AA batteries");
  assert.equal(input.ask, "a holder for 6 AA batteries");
  assert.equal(input.allowScript, true);
  assert.ok(!("svg" in input.recipes) && !("resize" in input.recipes), "no SVG recipe, and no resize without a library file");
  const built = [];
  const d = await B.designBest(input, { ...quiet, claude: async () => scriptAnswer(), build: async (job) => { built.push(job); return goodBuild({ x: 57.2, y: 39.2, z: 24 })(job); } });
  assert.equal(d.ok, true); assert.equal(d.by, "claude"); assert.equal(d.rounds, 1);
  assert.equal(built.length, 1); assert.equal(built[0].recipe, "script"); assert.match(built[0].script, /def make/);
  const job = B.labJob(d.output, input);
  assert.equal(job.by, "Alice"); assert.equal(job.recipe, "script"); assert.match(job.script, /def make/);
  assert.match(B.bestReply(d, true), /sent Battery holder \(a custom Fusion design, 57\.2 x 39\.2 x 24 mm, about 32\.6 g of PLA\).*passed a test build/);
});

test("a Fusion error goes back to Claude word for word, and the fixed answer passes", async () => {
  const prompts = [];
  const answers = [scriptAnswer(), scriptAnswer({ script: SCRIPT.replace("mm(3)", "mm(2)") })];
  let builds = 0;
  const d = await B.designBest(B.bestInput("a holder"), {
    ...quiet, claude: async (_s, p) => { prompts.push(p); return answers.shift(); },
    build: async (job) => (++builds === 1 ? { folder: "x", result: { ok: false, error: "Traceback\nRuntimeError: 3 : fillet failed on edge 4" } } : goodBuild({ x: 57.2, y: 39.2, z: 24 })(job)),
  });
  assert.equal(d.ok, true); assert.equal(d.rounds, 2);
  assert.match(prompts[1], /Your earlier answer/); assert.match(prompts[1], /fillet failed on edge 4/);
});

test("a part whose built size doesn't match expectSize is sent back (a slip in units can't get through)", async () => {
  const bad = B.judgeBuild({ expectSize: { x: 57.2, y: 39.2, z: 24 } }, { ok: true, size: { x: 5.72, y: 3.92, z: 2.4 } }, { ok: true, notes: [] });
  assert.equal(bad.length, 1); assert.match(bad[0], /built part is 5\.72 x 3\.92 x 2\.4 mm but expectSize says 57\.2/);
  assert.deepEqual(B.judgeBuild({ expectSize: { x: 39.2, y: 57.2, z: 24 } }, { ok: true, size: { x: 57.3, y: 39.1, z: 24 } }, { ok: true, notes: [] }), [], "turned on the bed and within 1 mm is fine");
  assert.match(B.judgeBuild({}, { ok: true, size: { x: 1, y: 1, z: 1 } }, { ok: false, notes: ["Too tall for the bed."] })[0], /print check failed: Too tall/);
});

test("unsafe or broken scripts are rejected by code before Fusion sees them", () => {
  const input = B.bestInput("a holder");
  const out = (s) => ({ ...JSON.parse(scriptAnswer()), script: s });
  assert.match(B.checkBest(input, out(SCRIPT + "    open('x','w')\n")).join(" "), /only build geometry/);
  assert.match(B.checkBest(input, out("import os\n" + SCRIPT)).join(" "), /no import statements/);
  assert.match(B.checkBest(input, out("def build(root):\n    pass\n")).join(" "), /make\(design, root, P\)/);
  assert.match(B.checkBest(input, { ...JSON.parse(scriptAnswer()), expectSize: { x: 300, y: 10, z: 10 } }).join(" "), /expectSize/);
  assert.match(B.checkBest({ ...input, allowScript: undefined }, JSON.parse(scriptAnswer())).join(" "), /scripts are not allowed/);
  assert.match(B.checkBest(input, { ...JSON.parse(tagAnswer()), name: "Key tag test" }).join(" "), /work label/);
  assert.deepEqual(B.checkBest(input, JSON.parse(scriptAnswer())), []);
  assert.deepEqual(B.checkBest(input, JSON.parse(tagAnswer())), []);
});

test("when Claude can't be reached, the local model designs with recipes only and the same test build", async () => {
  const seen = [];
  const d = await B.designBest(B.bestInput("a 70 mm key tag that says Rainbow Row"), {
    ...quiet, claude: async () => { throw Object.assign(new Error("Claude: no-key"), { code: "no-key" }); },
    local: async (messages) => { seen.push(messages); return tagAnswer(); }, build: goodBuild({ x: 70, y: 25, z: 4.5 }),
  });
  assert.equal(d.ok, true); assert.equal(d.by, "local"); assert.match(d.claudeDown, /no-key/);
  assert.ok(!JSON.stringify(seen[0]).includes("allowScript"), "the local model is never offered scripts");
  assert.match(B.bestReply(d, false), /Claude wasn't available/);
  const forced = await B.designBest(B.bestInput("a tag"), { ...quiet, claude: null, local: async () => tagAnswer(), build: goodBuild({ x: 70, y: 25, z: 4.5 }) });
  assert.doesNotMatch(B.bestReply(forced, false), /Claude wasn't available/);
});

test("nothing passes after every round: the reply says so and nothing is sent", async () => {
  const d = await B.designBest(B.bestInput("a holder"), { ...quiet, rounds: 2, claude: async () => scriptAnswer(), build: goodBuild({ x: 10, y: 10, z: 10 }) });
  assert.equal(d.ok, false); assert.equal(d.by, "claude");
  assert.match(B.bestReply(d, false), /couldn't get a design to pass every check/);
});

test("Claude's prompt carries the request and recipes; its instructions carry the guide and the helpers", () => {
  const p = B.claudePrompt(B.bestInput("a desk sign"), []);
  assert.match(p, /"ask": "a desk sign"/); assert.match(p, /"plate"/); assert.doesNotMatch(p, /allowScript/);
  const s = B.claudeSystem();
  for (const must of [/Bambu Lab/, /def raised_text/, /expectSize/, /recipe "script"/, /Never mention or name the other brand/]) assert.match(s, must);
  assert.doesNotMatch(s, /Never write code, a script or an SVG/, "Claude may write scripts");
});
