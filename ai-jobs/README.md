# AI jobs

Every step in the marketing loop that needs judgment is written here as a plain job file, so any model can run it.
The engine is one of Aaron's own local models first (`local-small` on the GMKtec, `local-big` on the Blink) and `claude` only for judgment calls, for now. Everything else (fetching numbers, the
scorecard, cost math, flags, the digest, saving files) is plain code in `lib/` and never needs a model.

## The loop

1. Code collects the numbers: `GET /api/scorecard?store=c3d|ed&days=2|7` (lib/scorecard.mjs), the daily digest
   (`GET /api/digest`, R2 `digest/latest.json`), and the Marketing routes (`GET /api/marketing?store=..&part=...`).
2. An AI job reads those numbers and decides: what to keep, stop or try, which post passes QA, which SEO fix comes next.
3. Code or a person carries out the decision. Nothing is spent or published without Aaron's approval.

## Files

- `jobs.json` lists every job: `{ "id", "file", "schedule", "engine" }`.
  `engine` is the per-job switch, one of the engines in `engines.json`: `"local-small"`, `"local-big"` or `"claude"`. Move one job at a time.
- `engines.json` says where each engine runs and which engine a job falls back to when its answer fails the checks
  (`local-small` to `local-big` to `claude`). No keys: the local models listen only on their own machine and are reached over SSH.
- `scripts/run-ai-job.mjs` is the local runner: `node scripts/run-ai-job.mjs listing-copy --input ai-jobs/examples/listing-copy.c3d.input.json`.
  It checks every answer (Output shape, one brand, price unchanged, length limits), retries with the list of problems, then falls back.
  Every run is saved in `ai-jobs/runs/` (this PC only, not in git); a job no local model could pass is saved in `ai-jobs/runs/needs-claude/`.
- **Keeping the local model current (rule 20):** when a job file, rule or check changes, change it here, add or update an
  example input in `examples/` and a test in `scripts/test-ai-jobs.mjs` the same day, and re-run the job on the local engines.
  When Claude makes a judgment call on a job, save the input, the decision and the reason as an example so the local model can learn it.
- `<job>.md` is one job. Every file has the same sections, in this order:
  - `## Purpose`: what the job is for, in a sentence or two.
  - `## When it runs`: the trigger or schedule.
  - `## Inputs`: the exact JSON shape, and where each part comes from (an engine route, an R2 file, a database document).
  - `## Instructions`: the steps the model follows. Plain words, model-neutral, no tool names of any one AI product.
  - `## Output`: the exact JSON shape the model must return, and where it is saved.
  - `## Hard rules`: rules that win over everything else in the file.

`scripts/test-ai-jobs.mjs` (part of `npm test`) checks that every entry in `jobs.json` points to a file that exists and
that every file has all six sections.

## How a runner uses a job (any model)

1. Read `jobs.json`, pick the job, and check `engine` to know which model runs it.
2. Gather the inputs exactly as the file says, and build the input JSON.
3. Give the model the file's Instructions and Hard rules, plus the input JSON. Ask for JSON only, in the Output shape.
4. Check the answer is valid JSON in that shape. If it isn't, run it once more; if it fails again, save nothing and report it.
5. Save the output where the file says, for example R2 `ai/<job>/<store>/<YYYY-MM-DD>.json` and `ai/<job>/<store>/latest.json`.

## Rules for every job

- One brand per run. Charleston 3D (`c3d`) and Elevated Designs (`ed`) are never in the same input, output or file.
- Nothing fake: real product photos only, no invented reviews, numbers, badges or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). Never invent a price.
- Ads: $2 a day per campaign at most.
- Never spend money, publish, or message a customer without Aaron's typed approval. Jobs recommend; they don't act.
- No secrets in any input, output or file.
