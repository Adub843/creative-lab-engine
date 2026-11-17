// Fusion jobs: how the Lab (and Stacy, later Alice) makes and changes 3D print files with Autodesk Fusion on
// Aaron's PC, without spending Meshy credits.
//
// Fusion only runs on the PC, and the Lab is a claude.ai page that can't reach the PC, so a job goes through this
// engine like Alice's questions do (lib/alice-mail.mjs): the Lab posts a job, the runner on the PC
// (scripts/fusion-runner.mjs, every minute) picks it up, has Fusion build it through Autodesk's own Fusion MCP
// server (127.0.0.1:27182, on the PC only), saves the files in the Charleston 3D file library (POST /api/files)
// and reports back here. The Lab then shows the job with its files.
//
//   GET    /api/fusion                 { runner, recipes, jobs }            the list (newest first)
//   GET    /api/fusion?id=<id>         { job }
//   POST   /api/fusion                 { name, by, recipe, params?, script?, from?, formats? }  -> 201 { job }
//   DELETE /api/fusion?id=<id>         take a job off the list (files already saved stay in the library)
//   GET    /api/fusion/next?fusion=up|down                     -> { job | null }   (the runner; also its heartbeat)
//   POST   /api/fusion/done { id, ok, files?, preview?, log?, error? }  -> { job }   (the runner)
//
// A job is one of the ready-made recipes in tools/fusion/recipes.json (sizes and text only, so a small local model
// can fill one in), or recipe "script": a Fusion Python script with a make(design, root, P) function, written by
// Claude or Stacy. Everything lives in the RESULTS R2 bucket under fusion/, never KV. Every route needs the console key.
import { HttpError, ok, fail, readJsonBody, requireKey } from "./shopify.mjs";
import recipesFile from "../tools/fusion/recipes.json" with { type: "json" };

export const RECIPES = recipesFile.recipes;
export const JOB_PREFIX = "fusion/job/";
export const RUNNER_KEY = "fusion/runner.json";
export const CLAIM_MS = 15 * 60 * 1000; // a runner that died mid-job gives it back after 15 minutes
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // finished jobs leave the list after 30 days (their files stay)
export const MAX_JOBS = 200;
export const MAX_SCRIPT = 50_000; // the engine reads at most 64 KB of JSON per request
export const FORMATS = ["3mf", "stl", "step"];
const ID = /^fu[a-z0-9]{10,40}$/;
const FILE_KEY = /^[a-z0-9]{1,12}-[0-9a-f]{8}$/;
const PERSON = /^[A-Za-z][A-Za-z .'-]{0,30}$/;
const SECRET = /\b(?:shpat_|sk-|ghp_|github_pat_)[A-Za-z0-9_]{6,}/;
// A script runs inside Fusion on Aaron's PC, so it may only build geometry: no files outside its job folder,
// no programs, no network. The runner checks the same list again before Fusion sees the script.
export const SCRIPT_BLOCKLIST = /\b(?:subprocess|socket|urllib|requests|http\.client|ftplib|smtplib|ctypes|shutil|winreg|importlib|__import__|eval|exec|compile|os\.system|os\.popen|os\.remove|os\.unlink|os\.rmdir|os\.spawn|os\.exec|open)\s*[\(.]/;

const newId = (nowMs) => "fu" + nowMs.toString(36) + Math.random().toString(36).slice(2, 12);
const jobKey = (id) => JOB_PREFIX + id + ".json";

async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch { return null; }
}
const putJson = (bucket, key, v) => bucket.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });

function cleanName(v) {
  const t = String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 90);
  if (!t) throw new HttpError(400, "bad_input", "Give the job a name, like \"Rainbow Row key tag\".");
  return t;
}

// Checks the recipe's settings against tools/fusion/recipes.json and fills in the defaults.
export function cleanParams(recipe, params = {}) {
  const spec = RECIPES[recipe]?.params ?? {};
  if (params == null || typeof params !== "object" || Array.isArray(params)) throw new HttpError(400, "bad_input", "params must be an object.");
  const out = {};
  for (const [k, s] of Object.entries(spec)) {
    const v = params[k] ?? s.default;
    if (v === undefined) throw new HttpError(400, "bad_input", `${k} is required for ${RECIPES[recipe].label}.`);
    if (s.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < s.min || n > s.max) throw new HttpError(400, "bad_input", `${k} must be a number from ${s.min} to ${s.max} (millimetres).`);
      out[k] = Math.round(n * 100) / 100;
    } else if (s.type === "boolean") {
      out[k] = v === true || v === "true";
    } else if (s.type === "choice") {
      if (!s.options.includes(v)) throw new HttpError(400, "bad_input", `${k} must be one of: ${s.options.join(", ")}.`);
      out[k] = v;
    } else if (s.type === "text") {
      const t = String(v).replace(/[\u0000-\u001f]/g, "").trim();
      if (!t || t.length > s.max) throw new HttpError(400, "bad_input", `${k} must be 1 to ${s.max} characters.`);
      out[k] = t;
    } else if (s.type === "svg") {
      const t = String(v);
      if (t.length > s.max || !/<svg[\s>]/i.test(t)) throw new HttpError(400, "bad_input", `${k} must be an SVG drawing under ${Math.round(s.max / 1000)} KB.`);
      if (/<script|javascript:|<foreignObject|xlink:href\s*=\s*["']https?:/i.test(t)) throw new HttpError(400, "bad_input", "That SVG has scripts or outside links in it. Use a plain drawing.");
      out[k] = t;
    }
  }
  return out;
}

export function cleanScript(v) {
  const t = String(v ?? "");
  if (!t.trim()) throw new HttpError(400, "bad_input", "A script job needs the script.");
  if (t.length > MAX_SCRIPT) throw new HttpError(400, "bad_input", `Keep the script under ${MAX_SCRIPT / 1000} KB.`);
  if (!/^def make\(\s*design\s*,\s*root\s*,\s*P\s*\)\s*:/m.test(t)) throw new HttpError(400, "bad_input", "The script must define make(design, root, P), which builds the model in root (sizes in centimetres, Fusion's own unit).");
  if (SCRIPT_BLOCKLIST.test(t)) throw new HttpError(400, "unsafe_script", "Scripts may only build geometry: no files, programs or network.");
  if (SECRET.test(t)) throw new HttpError(400, "private_detail", "That script looks like it has a key in it.");
  return t;
}

// The list, newest first, dropping finished jobs older than KEEP_MS.
async function allJobs(bucket, nowMs) {
  const objs = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: JOB_PREFIX, cursor });
    objs.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && objs.length < 2000);
  const jobs = [];
  for (const o of objs) {
    const j = await readJson(bucket, o.key);
    if (!j) continue;
    const ended = j.status === "done" || j.status === "failed";
    if (ended && nowMs - Date.parse(j.finished ?? j.at) > KEEP_MS) { await bucket.delete(o.key); continue; }
    jobs.push(j);
  }
  return jobs.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

// What the Lab sees: the script itself stays out of the list (it can be long); the job read by id has it.
const brief = ({ script, params, ...j }) => ({ ...j, params: params?.svg ? { ...params, svg: `(SVG, ${params.svg.length} characters)` } : params, hasScript: !!script });

export async function handleFusion(req, ctx, sub = "", clock = () => new Date()) {
  try {
    const bucket = ctx.bucket;
    if (!bucket) throw new HttpError(503, "storage_not_set_up", "Fusion jobs aren't set up: the RESULTS R2 bucket binding is missing.");
    requireKey(req, ctx.env, "Fusion jobs");
    const nowMs = clock().getTime(), now = new Date(nowMs).toISOString();

    if (sub === "next") {
      if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
      const fusion = req.query.get("fusion") === "up" ? "up" : "down";
      await putJson(bucket, RUNNER_KEY, { at: now, fusion, version: String(req.query.get("v") ?? "").slice(0, 40) });
      if (fusion !== "up") return ok({ job: null });
      const waiting = (await allJobs(bucket, nowMs)).reverse().filter((j) =>
        j.status === "waiting" || (j.status === "working" && nowMs - Date.parse(j.started) > CLAIM_MS));
      const j = waiting[0];
      if (!j) return ok({ job: null });
      const full = await readJson(bucket, jobKey(j.id));
      full.status = "working"; full.started = now; full.tries = (full.tries ?? 0) + 1;
      if (full.tries > 3) {
        Object.assign(full, { status: "failed", finished: now, error: "Fusion stopped three times on this job. Check the script or the sizes, then send it again." });
        await putJson(bucket, jobKey(j.id), full);
        return ok({ job: null });
      }
      await putJson(bucket, jobKey(j.id), full);
      return ok({ job: full });
    }
    if (sub === "done") {
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
      const body = await readJsonBody(req);
      if (!ID.test(String(body.id ?? ""))) throw new HttpError(400, "bad_input", "id is missing.");
      const job = await readJson(bucket, jobKey(body.id));
      if (!job) throw new HttpError(404, "not_found", "That job isn't on the list any more.");
      const files = {};
      for (const [fmt, key] of Object.entries(body.files ?? {}))
        if (FORMATS.includes(fmt) && FILE_KEY.test(String(key))) files[fmt] = String(key);
      Object.assign(job, {
        status: body.ok === true && Object.keys(files).length ? "done" : "failed",
        finished: now,
        files,
        preview: FILE_KEY.test(String(body.preview ?? "")) ? String(body.preview) : undefined,
        size: body.size && typeof body.size === "object" ? { x: Number(body.size.x) || 0, y: Number(body.size.y) || 0, z: Number(body.size.z) || 0 } : undefined,
        log: String(body.log ?? "").slice(-4000) || undefined,
        error: body.ok === true ? undefined : (String(body.error ?? "").slice(0, 1000) || "Fusion couldn't make it."),
      });
      await putJson(bucket, jobKey(job.id), job);
      return ok({ job: brief(job) });
    }
    if (sub) throw new HttpError(404, "not_found", "Unknown Fusion route.");

    if (req.method === "GET") {
      const id = req.query.get("id");
      if (id) {
        if (!ID.test(id)) throw new HttpError(400, "bad_input", "That isn't a Fusion job id.");
        const job = await readJson(bucket, jobKey(id));
        if (!job) throw new HttpError(404, "not_found", "That job isn't on the list any more.");
        return ok({ job });
      }
      const runner = await readJson(bucket, RUNNER_KEY);
      const seen = runner ? nowMs - Date.parse(runner.at) : Infinity;
      return ok({
        runner: { seen: runner?.at ?? null, online: seen < 5 * 60 * 1000, fusion: seen < 5 * 60 * 1000 ? runner.fusion : "down" },
        recipes: RECIPES,
        jobs: (await allJobs(bucket, nowMs)).map(brief),
      });
    }
    if (req.method === "DELETE") {
      const id = req.query.get("id");
      if (!ID.test(String(id ?? ""))) throw new HttpError(400, "bad_input", "That isn't a Fusion job id.");
      await bucket.delete(jobKey(id));
      return ok({ ok: true });
    }
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET, POST or DELETE.");

    const body = await readJsonBody(req, 64 * 1024);
    const recipe = String(body.recipe ?? "");
    if (recipe !== "script" && !RECIPES[recipe]) throw new HttpError(400, "bad_input", `recipe must be "script" or one of: ${Object.keys(RECIPES).join(", ")}.`);
    const by = String(body.by ?? "").trim();
    if (!PERSON.test(by)) throw new HttpError(400, "bad_input", "by must be who asked (Aaron, Stacy, Alice...).");
    const from = body.from == null || body.from === "" ? undefined : String(body.from);
    if (from !== undefined && !FILE_KEY.test(from)) throw new HttpError(400, "bad_input", "from must be a file key from the 3D library.");
    if (RECIPES[recipe]?.needsFile && !from) throw new HttpError(400, "bad_input", "Pick the library file to start from.");
    const formats = [...new Set(Array.isArray(body.formats) && body.formats.length ? body.formats : ["3mf", "stl"])];
    if (!formats.every((f) => FORMATS.includes(f))) throw new HttpError(400, "bad_input", `formats can be: ${FORMATS.join(", ")}.`);
    if ((await allJobs(bucket, nowMs)).length >= MAX_JOBS) throw new HttpError(429, "too_many", "The Fusion list is full. Take a few old jobs off it first.");
    const job = {
      id: newId(nowMs), name: cleanName(body.name), by, recipe,
      params: recipe === "script" ? (body.params && typeof body.params === "object" && !Array.isArray(body.params) ? JSON.parse(JSON.stringify(body.params).slice(0, 4000)) : {}) : cleanParams(recipe, body.params ?? {}),
      script: recipe === "script" ? cleanScript(body.script) : undefined,
      from, formats, status: "waiting", at: now,
    };
    await putJson(bucket, jobKey(job.id), job);
    return ok({ job: brief(job) }, 201);
  } catch (e) {
    return fail(e);
  }
}
