// Checks the portable AI jobs in ai-jobs/: every jobs.json entry points to a file that exists, and every job file
// has the six required sections in order. Run: node scripts/test-ai-jobs.mjs (part of npm test).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../ai-jobs/", import.meta.url));
export const SECTIONS = ["Purpose", "When it runs", "Inputs", "Instructions", "Output", "Hard rules"];
const ENGINES = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, "engines.json"), "utf8")).engines));
const REQUIRED_JOBS = ["marketing-qa", "weekly-marketing-decision", "daily-brief", "listing-copy", "seo-fix-picker", "review-summary"];

const { jobs } = JSON.parse(fs.readFileSync(path.join(DIR, "jobs.json"), "utf8"));

test("jobs.json: every job has id, file, schedule and engine, and the file exists", () => {
  assert.ok(Array.isArray(jobs) && jobs.length > 0);
  assert.deepEqual(new Set(jobs.map((j) => j.id)).size, jobs.length, "ids are unique");
  for (const id of REQUIRED_JOBS) assert.ok(jobs.some((j) => j.id === id), `${id} is listed`);
  for (const j of jobs) {
    assert.match(j.id, /^[a-z0-9-]+$/);
    assert.equal(j.file, `${j.id}.md`, `${j.id}: file is <id>.md`);
    assert.ok(typeof j.schedule === "string" && j.schedule.trim(), `${j.id}: schedule`);
    assert.ok(ENGINES.has(j.engine), `${j.id}: engine is listed in engines.json`);
    assert.ok(fs.existsSync(path.join(DIR, j.file)), `${j.file} exists`);
  }
});

test("each job file has the required sections, in order, none empty", () => {
  for (const j of jobs) {
    const text = fs.readFileSync(path.join(DIR, j.file), "utf8");
    const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(heads, SECTIONS, `${j.file} sections`);
    const parts = text.split(/^## .+$/m).slice(1);
    parts.forEach((p, i) => assert.ok(p.trim().length > 20, `${j.file}: "${SECTIONS[i]}" is filled in`));
    // Model-neutral: no tool names of one AI product, and never a secret.
    assert.doesNotMatch(text, /mcp__|ToolSearch|Claude in Chrome|Artifact tool|wrangler secret/i, `${j.file} is model-neutral`);
    assert.doesNotMatch(text, /shpat_|sk-[A-Za-z0-9]{10}/, `${j.file} has no secrets`);
    // The hard rules every job carries.
    const rules = parts[5];
    for (const r of [/one brand/i, /fake/i, /price sheet/i, /market price minus \$2/i, /\$2 a day/i, /never spend/i, /secrets/i])
      assert.match(rules, r, `${j.file} hard rules: ${r}`);
  }
});

test("every job file is listed in jobs.json", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
  assert.deepEqual(files.sort(), jobs.map((j) => j.file).sort());
});

// The local runner (scripts/run-ai-job.mjs): its checks, without calling a model.
const R = await import("./run-ai-job.mjs");
const LC = fs.readFileSync(path.join(DIR, "listing-copy.md"), "utf8");
const LC_IN = JSON.parse(fs.readFileSync(path.join(DIR, "examples/listing-copy.c3d.input.json"), "utf8"));
const LC_GOOD = { store: "c3d", title: "3D Printed Desk Organizer with Phone Stand", descriptionHtml: "<p>Three pen slots and a phone stand.</p>",
  seo: { title: "3D Printed Desk Organizer | Charleston 3D", description: "A 3D printed desk organizer with three pen slots and an angled phone stand. PLA plastic in black, white or teal, printed to order in Charleston, SC." },
  alt: [{ url: "https://example.invalid/organizer-front.jpg", alt: "Black organizer holding three pens and a phone" }], price: 16.99, keywordsUsed: ["3d printed desk organizer"], notes: "" };

test("runner: engines.json has a fallback chain that ends at claude and holds no secrets", () => {
  const { engines, fallback } = JSON.parse(fs.readFileSync(path.join(DIR, "engines.json"), "utf8"));
  for (const [from, to] of Object.entries(fallback)) { assert.ok(engines[from], from); assert.ok(engines[to], to); }
  assert.equal(engines.claude.manual, true);
  assert.doesNotMatch(JSON.stringify(engines), /password|secret|api.?key|bearer/i);
});

test("runner: reads the Output keys and pulls JSON out of a chatty answer", () => {
  assert.deepEqual(R.outputKeys(LC), ["store", "title", "descriptionHtml", "seo", "alt", "price", "keywordsUsed", "notes"]);
  assert.deepEqual(R.extractJson('<think>hmm {x}</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => R.extractJson("sorry, no"));
});

test("runner: listing-copy checks pass a good answer and catch each bad one", () => {
  assert.deepEqual(R.check("listing-copy", LC, LC_IN, LC_GOOD), []);
  const bad = (patch) => R.check("listing-copy", LC, LC_IN, { ...LC_GOOD, ...patch }).join("; ");
  assert.match(bad({ price: 17.99 }), /price must stay 16.99/);
  assert.match(bad({ store: "ed" }), /store must be/);
  assert.match(bad({ notes: "Also sold by Elevated Designs" }), /other brand/);
  assert.match(bad({ seo: { title: "Desk Organizer | c3d", description: LC_GOOD.seo.description } }), /brand name/);
  assert.match(bad({ seo: { title: LC_GOOD.seo.title, description: "Too short." } }), /too short/);
  assert.match(bad({ title: "x".repeat(70) }), /under 70/);
  const { title, ...noTitle } = LC_GOOD;
  assert.match(R.check("listing-copy", LC, LC_IN, noTitle).join("; "), /missing "title"/);
});

test("runner: a retry shows the model its last answer and what to fix", () => {
  const m = R.buildMessages(LC, LC_IN, ["price must stay 16.99"], '{"price":1}');
  assert.equal(m.length, 4); assert.match(m[0].content, /Hard rules/); assert.match(m[1].content, /Charleston 3D/); assert.match(m[3].content, /price must stay/);
});

test("runner: a long SEO description is cut back to whole words inside 155 characters, never reworded", () => {
  const long = "A 3D printed desk organizer with three pen slots and an angled phone stand. Made from PLA plastic in black, white or teal. Printed to order in Charleston, SC. Fits any desk and keeps things tidy.";
  const t = R.tidy("listing-copy", { seo: { title: "x", description: long } }).seo.description;
  assert.ok(t.length >= 140 && t.length <= 155, String(t.length)); assert.ok(long.startsWith(t.slice(0, -1))); assert.match(t, /[.!]$/);
  const t2 = R.tidy("listing-copy", { seo: { description: "word ".repeat(60).trim() } }).seo.description;
  assert.ok(t2.length <= 155 && !/ $/.test(t2));
  assert.equal(R.tidy("listing-copy", { seo: { description: "Short one." } }).seo.description, "Short one.");
  assert.match(R.check("listing-copy", LC, LC_IN, { ...LC_GOOD, seo: { title: LC_GOOD.seo.title, description: "Too short." } }).join(), /add about/);
});
