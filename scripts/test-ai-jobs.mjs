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
const REQUIRED_JOBS = ["marketing-qa", "weekly-marketing-decision", "daily-brief", "listing-copy", "seo-fix-picker", "review-summary", "post-captions", "request-triage"];

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
  // Each local engine falls back to the other one once, then to claude: never a loop.
  assert.deepEqual(R.engineChain("local-big", fallback, engines), ["local-big", "local-small", "claude"]);
  assert.deepEqual(R.engineChain("local-small", fallback, engines), ["local-small", "local-big", "claude"]);
  assert.deepEqual(R.engineChain("claude", fallback, engines), ["claude"]);
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
const DB_GOOD = { store: "c3d", date: "2026-11-14", needsYou: DB_IN.needsYou,
  brief: "One ad should be paused today and one product page is missing its description. Over the last 7 days the shop had 412 visits, 5 orders and $96.45 in sales. Visits are up 24 from yesterday's count of 388. The automatic fixes made 3 changes and undid 1.", notes: "" };

test("runner: daily-brief rejects numbers that are not in the digest, and long briefs", () => {
  assert.deepEqual(R.check("daily-brief", DB, DB_IN, DB_GOOD), []);
  const bad = (patch) => R.check("daily-brief", DB, DB_IN, { ...DB_GOOD, ...patch }).join("; ");
  assert.match(bad({ brief: DB_GOOD.brief.replace("412", "1,250") }), /not in the input: 1250/);
  assert.match(bad({ brief: "word ".repeat(130) }), /under 120 words/);
  assert.match(bad({ needsYou: "Pause the ad" }), /needsYou must be a list/);
  assert.match(bad({ needsYou: [...DB_IN.needsYou, "No sales in 7 days."] }), /needsYou must be the input's needsYou list/);
  assert.deepEqual(R.tidy("daily-brief", { needsYou: ["No sales in 7 days."] }, DB_IN).needsYou, DB_IN.needsYou, "code replaces the model's list");
  assert.match(R.check("daily-brief", DB, { ...DB_IN, needsYou: [] }, { ...DB_GOOD, needsYou: [], brief: DB_GOOD.brief + " This needs your attention." }).join("; "), /must not say anything needs Aaron/);
  assert.match(bad({ date: "2026-11-08" }), /date must be 2026-11-14/);
  assert.match(bad({ brief: DB_GOOD.brief.replace("412 visits", "412 sessions") }), /word for word/);
  assert.match(bad({ notes: "There were no orders this week" }), /do not say there were none/);
  assert.match(bad({ brief: "All data shows no activity or traffic." }), /do not say there were none/);
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
  assert.deepEqual(c3d.needsYou, []);
  assert.deepEqual(D.needsYouList({ siteCheck: { fails: ["indexnow-key", "robots"], warns: ["ga4"] }, scorecard: { pauseRecommended: ["Chains FB"], overCap: ["Chains FB"], missingScopes: ["read_reports"] }, pricing: { error: "bad sheet" }, library: { ok: false } }),
    ['Pause the ad "Chains FB".', 'The ad "Chains FB" is over the daily cap: lower its budget.', "The site check failed on the IndexNow key: set it in the console's Site settings.", "The site check failed on: robots.",
      "The price sync failed: open Prices in the console.", "The Kittl library sync failed: open the Art library in the console.", "Add the read_reports scope to this store's app."]);
  const ed = D.briefInput("ed", digest, null);
  assert.equal(ed.yesterday, null); assert.deepEqual(ed.digest.pricing, { phase: "idle", changed: 0 });
  const h = D.handoffFor("c3d", "2026-11-14", { ok: true, engine: "local-small", output: { brief: "Short brief. ".repeat(60), needsYou: ["Fix the IndexNow key."] } });
  assert.equal(h.lane, "console"); assert.equal(h.store, "c3d"); assert.ok(h.did.length <= 400 && h.did.endsWith(".")); assert.equal(h.needsAaron, "Fix the IndexNow key.");
  assert.equal(D.handoffFor("ed", "2026-11-14", { ok: false, tries: [] }).status, "partial");
});

test("daily brief run: the team board only hears about a fallback or a failure", async () => {
  const D = await import("./daily-brief.mjs");
  assert.equal(D.teamNoteFor("c3d", { ok: true, engine: "local-big", tries: [{ engine: "local-big" }] }), null);
  const fell = D.teamNoteFor("c3d", { ok: true, engine: "local-small", tries: [{ engine: "local-big" }, { engine: "local-small" }] });
  assert.match(fell, /Charleston 3D: the Blink did not answer or failed its checks, so the GMKtec wrote it/);
  assert.doesNotMatch(fell, /Elevated/);
  assert.match(D.teamNoteFor("ed", { ok: false, tries: [{ engine: "local-big" }] }), /Elevated Designs: no local PC could write it today/);
  const calls = [];
  assert.equal(D.postTeamNote("x", (cmd, args, opts) => { calls.push([cmd, args.at(-1), opts.input]); return { stdout: "posted\n" }; }), true);
  assert.deepEqual(calls, [["ssh", "python3 ~/team-notes/post_note.py job nuc", "x"]]);
  assert.equal(D.postTeamNote("x", () => ({ stdout: "" })), false);
});

test("price requests: a confirmed request is checked again before the store is touched", async () => {
  const P = await import("./price-requests.mjs");
  const now = Date.parse("2026-11-15T17:00:00Z");
  const req = { id: "0123456789ab", store: "c3d", product_id: 101, title: "Mini Name Desk Plate", old: 19, new: 21, at: "2026-11-15T16:58:00Z" };
  assert.equal(P.requestProblem(req, now), null);
  assert.match(P.requestProblem({ ...req, at: "2026-11-15T16:40:00Z" }, now), /10 minutes old/);
  assert.match(P.requestProblem({ ...req, store: "other" }, now), /store that does not exist/);
  assert.match(P.requestProblem({ ...req, new: 0.1 }, now), /must be from 0\.50/);
  assert.match(P.requestProblem({ ...req, new: 19 }, now), /same as the old one/);
  assert.match(P.requestProblem({ ...req, product_id: "101" }, now), /no product id/);
  assert.match(P.requestProblem({ ...req, id: "../x" }, now), /not readable/);

  const products = [{ id: 101, variants: [{ price: "19.00" }] }, { id: 102, variants: [{ price: "12.00" }, { price: "24.99" }] }];
  assert.equal(P.livePriceProblem(products, req), null);
  assert.match(P.livePriceProblem(products, { ...req, old: 18 }), /live price is now \$19\.00, not the \$18\.00/);
  assert.match(P.livePriceProblem(products, { ...req, product_id: 102 }), /different prices by size/);
  assert.match(P.livePriceProblem(products, { ...req, product_id: 999 }), /no longer in the store/);

  // the whole pass, with the store and the engine faked
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", key: init.headers?.["x-console-key"], body: init.body });
    if (String(url).includes("/products.json")) return new Response(JSON.stringify({ products }), { status: 200 });
    if (String(url).endsWith("/api/products")) return new Response(JSON.stringify({ changed: 1, price: "21.00" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const done = await P.carryOut(req, { key: "a-test-key-000000000", fetchImpl, now });
  assert.deepEqual(done, { ok: true, changed: 1 });
  const post = calls.find((c) => c.method === "POST");
  assert.equal(post.url, "https://creative-lab-engine.business-console.workers.dev/api/products");
  assert.deepEqual(JSON.parse(post.body), { store: "c3d", id: "gid://shopify/Product/101", price: "21.00" });
  assert.equal(post.key, "a-test-key-000000000");
  assert.ok(calls[0].url.startsWith("https://charleston3d.com/products.json"), "the Charleston 3D store is the only one read");

  // a stale price never reaches the engine
  calls.length = 0;
  const stale = await P.carryOut({ ...req, old: 18 }, { key: "k", fetchImpl, now });
  assert.equal(stale.ok, false);
  assert.ok(!calls.some((c) => c.method === "POST"));
  // the engine's refusal is passed on in its own words
  const refuse = async (url, init = {}) => String(url).includes("/products.json") ? new Response(JSON.stringify({ products }), { status: 200 })
    : new Response(JSON.stringify({ error: "This shirt is priced from the price sheet.", code: "sheet_priced" }), { status: 409 });
  assert.match((await P.carryOut(req, { key: "k", fetchImpl: refuse, now })).reason, /priced from the price sheet\. Nothing was changed/);
});

test("every job on a local engine has an example input and its own checks", () => {
  for (const j of jobs.filter((x) => x.engine.startsWith("local"))) {
    assert.ok(fs.readdirSync(path.join(DIR, "examples")).some((f) => f.startsWith(j.id + ".")), `${j.id}: example input in ai-jobs/examples/`);
    assert.match(fs.readFileSync(new URL("./run-ai-job.mjs", import.meta.url), "utf8"), new RegExp(`jobId === "${j.id}"`), `${j.id}: checks in the runner`);
  }
});

test("post captions: code rejects links, hashtags, emoji, made-up numbers, prices and claims", async () => {
  const R = await import("./run-ai-job.mjs");
  const jobText = fs.readFileSync(path.join(DIR, "post-captions.md"), "utf8");
  const input = JSON.parse(fs.readFileSync(path.join(DIR, "examples", "post-captions.c3d.input.json"), "utf8"));
  const ig = "A tidy desk starts here. This 3D printed organizer has three pen slots and one angled phone stand, and it comes in black, white and teal. Printed to order in Charleston, SC. Link below.";
  const fb = "Looking for a simple way to clear your desk? This 3D printed organizer holds your pens in three slots and props up your phone on an angled stand. It comes in black, white and teal, and each one is printed to order in Charleston, SC. Order yours at the link.";
  const good = () => ({ store: "c3d", product: input.product.title, posts: [{ platform: "instagram", caption: ig }, { platform: "facebook", caption: fb }], topicTags: ["#DeskOrganizer", "#PhoneStand"], notes: "" });
  assert.deepEqual(R.check("post-captions", jobText, input, good()), []);
  const bad = (change, want) => { const o = good(); change(o); assert.match(R.check("post-captions", jobText, input, o).join(" | "), want); };
  bad((o) => { o.posts[0].caption = ig + " See charleston3d.com"; }, /must not contain a link/);
  bad((o) => { o.posts[0].caption = ig + " #desk"; }, /must not contain a hashtag/);
  bad((o) => { o.posts[1].caption = fb + " \u{1F600}"; }, /must not contain emoji/);
  bad((o) => { o.posts[0].caption = ig.replace("three", "12"); }, /numbers that are not in the input \(12\)/);
  bad((o) => { o.posts[0].caption = ig + " Only $14.99."; }, /the only price allowed is \$16\.99/);
  bad((o) => { o.posts[1].caption = fb + " Free shipping."; }, /claim the listing does not make/);
  bad((o) => { o.posts[0].caption = "Too short. Link below."; }, /instagram caption must be 25 to 70 words/);
  bad((o) => { o.posts.reverse(); }, /"instagram" first, then "facebook"/);
  bad((o) => { o.product = "Another product"; }, /product must be the input title/);
  bad((o) => { o.posts[1].caption = fb + " Also see Elevated Designs."; }, /names the other brand/);
  const priced = good(); priced.posts[0].caption = ig + " It is $16.99.";
  assert.deepEqual(R.check("post-captions", jobText, input, priced), [], "the real price may be stated");
  assert.match(R.check("post-captions", jobText, { ...input, product: { ...input.product, priceVaries: true } }, priced).join(" "), /more than one price/);
  // Topic tags are tidied by code, never a reason to throw away a caption.
  assert.deepEqual(R.tidy("post-captions", { topicTags: ["desk organizer", "#Phone-Stand", "#phone-stand", "#1776", "x", "#extra"] }, input).topicTags, ["#desk", "#organizer", "#PhoneStand"]);
});

test("overnight jobs: only honest, single-brand products are picked, each at most once in 30 days", async () => {
  const O = await import("./overnight-jobs.mjs");
  const long = "<p>" + "A real listing with plenty of plain facts about the item. ".repeat(6) + "</p>";
  const p = (handle, extra = {}) => ({ handle, title: handle, body_html: long, tags: [], variants: [{ price: "16.99", available: true }], ...extra });
  const products = [p("a"), p("b"), p("thin", { body_html: "<p>Short.</p>" }), p("blank", { tags: ["builder-blank"] }),
    p("mixed", { body_html: long + "<p>From Elevated Designs.</p>" }), p("sold-out", { variants: [{ price: "5.00", available: false }] })];
  assert.deepEqual(O.eligible(products, "c3d").map((x) => x.handle), ["a", "b"]);
  assert.deepEqual(O.eligible([p("tee"), p("print", { title: "Charleston 3D print" })], "ed").map((x) => x.handle), ["tee"]);
  const now = Date.parse("2026-11-15T05:40:00Z");
  const list = [p("a"), p("b"), p("c")];
  assert.deepEqual(O.pick(list, {}, 2, now).map((x) => x.handle), ["a", "b"]);
  assert.deepEqual(O.pick(list, { a: "2026-11-14T05:40:00Z", b: "2026-10-01T05:40:00Z" }, 2, now).map((x) => x.handle), ["c", "b"], "never drafted first, then the oldest; a is resting");
  assert.deepEqual(O.pick(list, { a: "2026-11-14T05:40:00Z", b: "2026-11-13T05:40:00Z", c: "2026-11-12T05:40:00Z" }, 2, now), []);
  const input = O.toInput("c3d", p("a", { title: "Desk Thing", tags: ["desk"], variants: [{ price: "12.00" }, { price: "24.99" }] }));
  assert.equal(input.product.priceVaries, true);
  assert.equal(input.product.price, 12);
  assert.ok(!/</.test(input.product.description));
  const text = O.draftText("c3d", p("desk-thing", { title: "Desk Thing", images: [{ src: "https://cdn.example/x.png" }] }),
    { posts: [{ platform: "instagram", caption: "One." }, { platform: "facebook", caption: "Two." }], topicTags: ["#desk", "#charleston3d"], notes: "" }, "202611");
  assert.match(text, /https:\/\/charleston3d\.com\/products\/desk-thing\?utm_source=instagram&utm_medium=social&utm_campaign=c3d-202611-desk-thing/);
  assert.match(text, /utm_source=facebook/);
  assert.match(text, /#Charleston3D #CharlestonSC #3DPrinting #CustomGifts #MadeInCharleston #desk\n/, "brand tags first, a repeated brand tag is dropped");
  assert.ok(!/elevated/i.test(text));
  for (const s of ["c3d", "ed"]) assert.ok(!O.BRANDS[s].tags.some((t) => (s === "c3d" ? /elevated|shirt/i : /3d/i).test(t)), "each brand has only its own hashtags");
});

test("request triage: the draft reply never quotes, promises a date, or asks for what was given", async () => {
  const R = await import("./run-ai-job.mjs");
  const jobText = fs.readFileSync(path.join(DIR, "request-triage.md"), "utf8");
  const input = JSON.parse(fs.readFileSync(path.join(DIR, "examples", "request-triage.c3d.input.json"), "utf8"));
  const reply = "Thank you for reaching out to us about a sign for your boat with the name Salty Dog on it. A shelf sign in navy and white is something we print often. To put a quote together, could you tell us about how tall or wide you would like it to be? Once we have that, a quote will follow.";
  const good = () => ({ store: "c3d", order: "#1012", kind: "custom design", canDo: "yes", why: "A shelf sign with a name is a normal plastic print.", missing: ["About how tall or wide should it be?"], replyDraft: reply, urgency: "normal", notes: "" });
  assert.deepEqual(R.check("request-triage", jobText, input, good()), []);
  const bad = (change, want) => { const o = good(); change(o); assert.match(R.check("request-triage", jobText, input, o).join(" | "), want); };
  bad((o) => { o.replyDraft = reply + " It will be about $25."; }, /must not state a price/);
  bad((o) => { o.replyDraft = reply + " We can offer a discount."; }, /must not state a price or a discount/);
  bad((o) => { o.replyDraft = reply + " We will have it ready by your date."; }, /must not promise a delivery date/);
  bad((o) => { o.replyDraft = reply + " It takes 9 days."; }, /numbers that are not in the request \(9\)/);
  bad((o) => { o.replyDraft = reply + " See https://charleston3d.com"; }, /must not contain a link/);
  bad((o) => { o.replyDraft = reply + " Call 843-555-0199."; }, /phone number or an email/);
  bad((o) => { o.replyDraft = "Thanks. A quote will follow."; }, /40 to 110 words/);
  bad((o) => { o.missing = ["What colors would you like?"]; }, /already gives the colors/);
  bad((o) => { o.missing = ["When do you need it?"]; }, /already gives the date it is needed/);
  bad((o) => { o.replyDraft = reply + " Please confirm the date you need it."; }, /must not ask for the date/);
  bad((o) => { o.missing = ["a", "b", "c", "d"]; }, /at most 3 short questions/);
  bad((o) => { o.kind = "shirt"; }, /kind must be/);
  bad((o) => { o.canDo = "sure"; }, /canDo must be/);
  bad((o) => { o.replyDraft = reply + " Elevated Designs can help too."; }, /names the other brand/);
  // Order number and urgency are facts: code sets them whatever the model wrote.
  const fixed = R.tidy("request-triage", { ...good(), order: "#9", urgency: "rush", missing: "How tall?" }, input);
  assert.deepEqual([fixed.order, fixed.urgency, fixed.missing], ["#1012", "normal", ["How tall?"]]);
});

test("request triage: urgency and days left are worked out by code, and each request is sorted once", async () => {
  const T = await import("./request-triage.mjs");
  const r = (order, over = {}) => ({ order, date: "2026-11-14", open: true, type: "Custom design", request: "A sign", exampleLink: false, quantity: 1, neededBy: null, size: "", colors: "", files: 0, ...over });
  assert.deepEqual([T.toInput(r("#1", { neededBy: "2026-11-22" }), "2026-11-15").daysLeft, T.toInput(r("#1", { neededBy: "2026-11-22" }), "2026-11-15").urgency], [7, "rush"]);
  assert.equal(T.toInput(r("#1", { neededBy: "2026-11-23" }), "2026-11-15").urgency, "normal");
  assert.deepEqual([T.toInput(r("#1"), "2026-11-15").daysLeft, T.toInput(r("#1"), "2026-11-15").urgency], [null, "normal"]);
  assert.equal(T.toInput(r("#1", { neededBy: "2026-11-10" }), "2026-11-15").urgency, "rush", "a date already past is a rush");
  const list = [r("#3", { date: "2026-11-15" }), r("#2", { date: "2026-11-13" }), r("#1", { open: false }), r("#4", { date: "2026-11-14" })];
  assert.deepEqual(T.fresh(list, { "#4": "2026-11-14T10:00:00Z" }).map((x) => x.order), ["#2", "#3"], "closed and already sorted ones are skipped, oldest first");
  assert.equal(T.fresh(Array.from({ length: 9 }, (_, i) => r("#" + (10 + i))), {}).length, T.MAX_PER_PASS);
  const input = T.toInput(r("#1012", { neededBy: "2026-11-20", colors: "Navy", files: 2 }), "2026-11-15");
  const text = T.draftText(input, { kind: "custom design", canDo: "maybe", why: "Size is not given.", missing: ["How tall?"], replyDraft: "Thanks for asking.", urgency: "rush", notes: "" });
  assert.match(text, /RUSH: needed within 7 days/);
  assert.match(text, /Needed by: 2026-11-20 \(5 days from 2026-11-15\)/);
  assert.match(text, /Maybe printable, check first\. Size is not given\./);
  assert.match(text, /nothing was sent/);
});
