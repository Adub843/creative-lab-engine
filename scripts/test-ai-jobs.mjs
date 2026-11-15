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

const RS = fs.readFileSync(path.join(DIR, "review-summary.md"), "utf8");
const RS_IN = JSON.parse(fs.readFileSync(path.join(DIR, "examples/review-summary.ed.input.json"), "utf8"));
const RS_GOOD = { store: "ed", period: { from: "2026-11-02", to: "2026-11-07" }, count: 6, averageRating: 4,
  themes: [{ theme: "fit", count: 3, averageRating: 3.3, quotes: ["it runs small", "Fits true to size"] }],
  changes: [{ change: "Add a size chart to the product page", theme: "fit" }],
  postQuotes: [{ quote: "Colors look just like the photo.", rating: 5, status: "needs Aaron's OK before use" }], notes: "" };

test("runner: review-summary only passes quotes that are word for word from the reviews", () => {
  assert.deepEqual(R.check("review-summary", RS, RS_IN, RS_GOOD), []);
  const bad = (patch) => R.check("review-summary", RS, RS_IN, { ...RS_GOOD, ...patch }).join("; ");
  assert.match(bad({ themes: [{ theme: "fit", count: 1, averageRating: 3, quotes: ["Best shirt I ever owned"] }] }), /not word for word/);
  assert.match(bad({ postQuotes: [{ quote: "Amazing quality, ten stars", rating: 5, status: "needs Aaron's OK before use" }] }), /post quote is not word for word/);
  assert.match(bad({ postQuotes: [{ quote: "Great gift.", rating: 5, status: "approved" }] }), /needs Aaron's OK/);
  assert.match(bad({ count: 9 }), /count must be 6/);
  assert.match(bad({ period: { from: "2026-11-01", to: "2026-11-08" } }), /period must be from 2026-11-02 to 2026-11-07/);
  assert.match(bad({ changes: [{ change: "Say delivery takes 5 to 9 days", theme: "shipping" }] }), /numbers that no review gave/);
  assert.match(bad({ notes: [] }), /notes must be one text string/);
  assert.match(bad({ changes: [1, 2, 3, 4].map((n) => ({ change: "c" + n, theme: "fit" })) }), /at most 3 changes/);
  assert.match(bad({ notes: "Charleston 3D also sells these" }), /other brand/);
});

const DB = fs.readFileSync(path.join(DIR, "daily-brief.md"), "utf8");
const DB_IN = JSON.parse(fs.readFileSync(path.join(DIR, "examples/daily-brief.c3d.input.json"), "utf8"));
const DB_GOOD = { store: "c3d", date: "2026-11-14", needsYou: ["Pause the Hype chains Facebook ad."],
  brief: "One ad should be paused today and one product page is missing its description. Over the last 7 days the shop had 412 visits, 5 orders and $96.45 in sales. Visits are up 24 from yesterday's count of 388. The automatic fixes made 3 changes and undid 1.", notes: "" };

test("runner: daily-brief rejects numbers that are not in the digest, and long briefs", () => {
  assert.deepEqual(R.check("daily-brief", DB, DB_IN, DB_GOOD), []);
  const bad = (patch) => R.check("daily-brief", DB, DB_IN, { ...DB_GOOD, ...patch }).join("; ");
  assert.match(bad({ brief: DB_GOOD.brief.replace("412", "1,250") }), /not in the input: 1250/);
  assert.match(bad({ brief: "word ".repeat(130) }), /under 120 words/);
  assert.match(bad({ needsYou: "Pause the ad" }), /needsYou must be a list/);
  assert.match(bad({ date: "2026-11-08" }), /date must be 2026-11-14/);
  assert.match(bad({ brief: DB_GOOD.brief.replace("412 visits", "412 sessions") }), /word for word/);
  assert.match(bad({ notes: "There were no orders this week" }), /do not say there were none/);
  const old = { ...DB_IN, digest: { ...DB_IN.digest, siteCheck: { ...DB_IN.digest.siteCheck, date: "2026-11-12", today: false } } };
  assert.match(R.check("daily-brief", DB, old, DB_GOOD).join("; "), /older one.*2026-11-12/);
});

test("daily brief run: the input, numbers sentence and handoff are built by code", async () => {
  const D = await import("./daily-brief.mjs");
  assert.equal(D.numbersLine({ days: 7, sessions: 55, orders: 0, sales: 0 }, { sessions: 66 }), "Over the last 7 days the shop had 55 visits, 0 orders and $0.00 in sales. Visits are down 11 from yesterday's count of 66.");
  assert.equal(D.numbersLine({ days: 7, sessions: 1250, orders: 3, sales: 1096.5 }, null), "Over the last 7 days the shop had 1,250 visits, 3 orders and $1,096.50 in sales.");
  const digest = { date: "2026-11-14", stores: { c3d: { name: "Charleston 3D", shop: { days: 7, sessions: 55, orders: 0, sales: 0 }, ranks: { avgPosition: null } }, ed: { name: "Elevated Designs", shop: { days: 7, sessions: 98, orders: 0, sales: 0 }, pricing: { phase: "idle", report: { changed: 0, variants: 48095 }, applied: "1410" } } } };
  const c3d = D.briefInput("c3d", digest, { date: "2026-11-13", stores: { c3d: { shop: { sessions: 66 } } } });
  assert.equal(c3d.date, "2026-11-14"); assert.match(c3d.numbers, /down 11/); assert.equal("avgPosition" in c3d.digest.ranks, false);
  assert.doesNotMatch(JSON.stringify(c3d), /Elevated|98/, "one brand per input");
  const ed = D.briefInput("ed", digest, null);
  assert.equal(ed.yesterday, null); assert.deepEqual(ed.digest.pricing, { phase: "idle", changed: 0 });
  const h = D.handoffFor("c3d", "2026-11-14", { ok: true, engine: "local-small", output: { brief: "Short brief. ".repeat(60), needsYou: ["Fix the IndexNow key."] } });
  assert.equal(h.lane, "console"); assert.equal(h.store, "c3d"); assert.ok(h.did.length <= 400 && h.did.endsWith(".")); assert.equal(h.needsAaron, "Fix the IndexNow key.");
  assert.equal(D.handoffFor("ed", "2026-11-14", { ok: false, tries: [] }).status, "partial");
});

test("every job on a local engine has an example input and its own checks", () => {
  for (const j of jobs.filter((x) => x.engine.startsWith("local"))) {
    assert.ok(fs.readdirSync(path.join(DIR, "examples")).some((f) => f.startsWith(j.id + ".")), `${j.id}: example input in ai-jobs/examples/`);
    assert.match(fs.readFileSync(new URL("./run-ai-job.mjs", import.meta.url), "utf8"), new RegExp(`jobId === "${j.id}"`), `${j.id}: checks in the runner`);
  }
});
