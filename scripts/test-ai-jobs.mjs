// Checks the portable AI jobs in ai-jobs/: every jobs.json entry points to a file that exists, and every job file
// has the six required sections in order. Run: node scripts/test-ai-jobs.mjs (part of npm test).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../ai-jobs/", import.meta.url));
export const SECTIONS = ["Purpose", "When it runs", "Inputs", "Instructions", "Output", "Hard rules"];
const ENGINES = new Set(["claude", "alice"]);
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
    assert.ok(ENGINES.has(j.engine), `${j.id}: engine is claude or alice`);
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
