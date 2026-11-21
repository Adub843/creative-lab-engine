// Charleston 3D's 3D maker: photos (1 to 4) or a few words in, a printable model out, made by Meshy
// (api.meshy.ai) with Aaron's own Meshy credits. The key lives only in the Worker as the MESHY_API_KEY
// secret (Aaron types it with `npx wrangler secret put MESHY_API_KEY`); it never reaches the browser.
//
// GET    /api/meshy                      setup state, credit balance and the job list       needs the console key
// POST   /api/meshy/jobs                 start a job (JSON: mode photos|words, images or prompt,
//                                        name, color, detail)                                  needs the key
// GET    /api/meshy/jobs/:id             the job with Meshy's live status and progress        needs the key
// GET    /api/meshy/jobs/:id/file/:fmt   the finished model (stl, 3mf, obj, glb) or its picture   needs the key
// POST   /api/meshy/jobs/:id/color       add color to a finished words job (a refine job)     needs the key
// POST   /api/meshy/jobs/:id/save        keep the model in the 3D file library (JSON: format) needs the key
// DELETE /api/meshy/jobs/:id             take a job off the list (Meshy keeps it until it expires)
//
// No key? Then Meshy runs through the Meshy CLI that is signed in on Aaron's PC (browser sign-in, no key
// anywhere): the job waits here in the RESULTS bucket under meshy/, scripts/meshy-runner.mjs on the PC (every
// minute) sends it with the CLI, watches it, and brings the finished files back here, so the page works the same.
//
// GET    /api/meshy/runner                     (the PC runner) heartbeat + what to send and what to watch
// GET    /api/meshy/runner/req/:id             (the PC runner) the Meshy request body for a waiting job
// POST   /api/meshy/runner/sent/:id            (the PC runner) { taskId } or { error }
// POST   /api/meshy/runner/status/:id          (the PC runner) { status, progress, queue, credits, expiresAt, error, formats, picture }
// PUT    /api/meshy/runner/file/:id/:fmt       (the PC runner) a finished file (glb, stl, 3mf, obj, picture)
//
// Meshy keeps finished models for 3 days, so the page says to save the ones worth keeping.
// handleMeshy(req, { jobs, files, env, fetch }) takes the job store and the file library's store
// (both lib/kv-store.mjs, own prefixes) and returns a Response.
import { requireKey, HttpError } from "./shopify.mjs";
import { fitText, MAX_BYTES } from "./images.mjs";
import { saveFile } from "./files.mjs";

export const MESHY = "https://api.meshy.ai";
// Where each kind of job lives in Meshy's API.
const PATHS = { photo: "/openapi/v1/image-to-3d", photos: "/openapi/v1/multi-image-to-3d", words: "/openapi/v2/text-to-3d" };
// Every model comes back ready to slice (STL and 3MF) and to look at (GLB).
export const FORMATS = ["glb", "stl", "3mf", "obj"];
// Credits from Meshy's price list: shape only 20, with color 30 (photos), color added later 10 (words),
// high detail +5.
export const cost = ({ mode, color, detail }) => (mode === "color" ? 10 : (mode === "words" || !color ? 20 : 30) + (detail === "high" ? 5 : 0));

// The PC route (no key): everything lives in the RESULTS bucket, never KV.
export const RELAY = { job: "meshy/job/", req: "meshy/req/", file: "meshy/file/", runner: "meshy/runner.json" };
export const RUNNER_FRESH_MS = 10 * 60 * 1000; // the runner says hello every minute
export const KEEP_FILES_MS = 7 * 24 * 60 * 60 * 1000; // copies of finished models stay a week (Meshy keeps them 3 days)
const STATUSES = new Set(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELED"]);
const FILE_TYPES = [...FORMATS, "picture"];

const MAX_IMAGES = 4;
const MAX_BODY = 32 * 1024 * 1024; // four photos, already made smaller in the browser
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const MESHY_TIMEOUT = 25_000;

const HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function readJson(req, max) {
  if (Number(req.headers.get("content-length")) > max) throw new HttpError(413, "too_large", "Those photos are too big together. Use smaller photos.");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too_large", "Those photos are too big together. Use smaller photos.");
  try { const v = JSON.parse(text || "{}"); if (v && typeof v === "object") return v; } catch { /* below */ }
  throw new HttpError(400, "bad_json", "Send a JSON body.");
}

// One call to Meshy with the key, a time limit and plain-English errors.
async function meshy(ctx, path, init = {}) {
  const key = ctx.env("MESHY_API_KEY");
  if (!key) throw new HttpError(503, "meshy_not_set_up", "The 3D maker needs your Meshy key. Add it once with: npx wrangler secret put MESHY_API_KEY");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MESHY_TIMEOUT);
  let res;
  try {
    res = await ctx.fetch(MESHY + path, { ...init, signal: ctrl.signal, headers: { authorization: `Bearer ${key}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  } catch {
    throw new HttpError(502, "meshy_unreachable", "Couldn't reach Meshy just now. Try again in a minute.");
  } finally { clearTimeout(timer); }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const said = typeof body?.message === "string" ? ` Meshy said: ${body.message.slice(0, 200)}` : "";
  if (res.status === 401) throw new HttpError(502, "meshy_bad_key", "Meshy didn't accept the key. Put the right one in with: npx wrangler secret put MESHY_API_KEY");
  if (res.status === 402) throw new HttpError(402, "meshy_no_credits", "Not enough Meshy credits for this. Top up at meshy.ai, then try again.");
  if (res.status === 429) throw new HttpError(429, "meshy_busy", "Meshy is busy. Wait a minute and try again.");
  if (res.status === 404) throw new HttpError(404, "meshy_gone", "Meshy no longer has this job (models are kept 3 days).");
  if (res.status === 400) throw new HttpError(400, "meshy_refused", `Meshy couldn't use that.${said}`);
  throw new HttpError(502, "meshy_error", `Meshy had a problem (${res.status}).${said}`);
}

// What the page needs from a Meshy task: no signed download links, just which files are ready.
function view(job, task) {
  const t = task ?? {};
  const urls = t.model_urls ?? {};
  return {
    ...job,
    status: t.status ?? "UNKNOWN",
    progress: Number.isFinite(t.progress) ? t.progress : 0,
    queue: t.status === "PENDING" && Number.isFinite(t.preceding_tasks) ? t.preceding_tasks : undefined,
    formats: FORMATS.filter((f) => typeof urls[f] === "string"),
    picture: typeof t.thumbnail_url === "string",
    credits: Number.isFinite(t.consumed_credits) ? t.consumed_credits : undefined,
    expiresAt: Number.isFinite(t.expires_at) ? t.expires_at : undefined,
    error: t.status === "FAILED" ? String(t.task_error?.message || "Meshy couldn't make this one. No credits were used.").slice(0, 300) : undefined,
  };
}

async function getJob(jobs, id) {
  const found = await jobs.getWithMetadata(id, { type: "text" });
  if (!found) throw new HttpError(404, "not_found", "That job isn't on the list.");
  return { id, ...found.metadata };
}
const taskOf = (ctx, job) => meshy(ctx, `${PATHS[job.kind]}/${job.id}`);

// A finished file, fetched from Meshy's file host only.
async function download(ctx, task, fmt) {
  const url = fmt === "picture" ? task.thumbnail_url : task.model_urls?.[fmt];
  if (typeof url !== "string") throw new HttpError(404, "not_ready", "That file isn't ready.");
  let host;
  try { host = new URL(url); } catch { throw new HttpError(502, "meshy_error", "Meshy sent a bad file link."); }
  if (host.protocol !== "https:" || !(host.hostname === "assets.meshy.ai" || host.hostname.endsWith(".meshy.ai")))
    throw new HttpError(502, "meshy_error", "Meshy sent a file link from somewhere else.");
  const res = await ctx.fetch(url).catch(() => null);
  if (!res?.ok) throw new HttpError(502, "meshy_error", "Couldn't download the file from Meshy. Try again.");
  if (Number(res.headers.get("content-length")) > 60 * 1024 * 1024) throw new HttpError(413, "too_large", "That model is too big to bring in.");
  return new Uint8Array(await res.arrayBuffer());
}

const safeName = (s) => fitText(String(s ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim(), 80, 160) || "3D model";

// Checks what the page sent and builds the Meshy request; nothing is sent yet.
function prepareJob(input) {
  const name = safeName(input.name);
  const color = input.color === true;
  const detail = input.detail === "high" ? "high" : "standard";
  const common = { ai_model: "latest", target_formats: FORMATS, ...(detail === "high" ? { geometry_resolution: "2k" } : {}) };
  let kind, body, prompt = "";
  if (input.mode === "words") {
    prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (prompt.length < 3) throw new HttpError(400, "no_prompt", "Describe the model in a few words.");
    if (prompt.length > 800) throw new HttpError(400, "prompt_too_long", "Keep the description under 800 characters.");
    kind = "words";
    body = { mode: "preview", prompt, ...common };
  } else if (input.mode === "photos") {
    const images = Array.isArray(input.images) ? input.images : [];
    if (!images.length) throw new HttpError(400, "no_images", "Add at least one photo.");
    if (images.length > MAX_IMAGES) throw new HttpError(400, "too_many_images", "Use up to 4 photos of the same thing.");
    if (!images.every((u) => typeof u === "string" && IMAGE_RE.test(u) && u.length * 0.75 <= MAX_BYTES))
      throw new HttpError(400, "bad_image", "Each photo must be a PNG, JPG or WebP under 20 MB.");
    kind = images.length === 1 ? "photo" : "photos";
    body = { ...(kind === "photo" ? { image_url: images[0] } : { image_urls: images }), should_texture: color, ...common };
  } else throw new HttpError(400, "bad_mode", "Pick photos or words.");
  return { path: PATHS[kind], body, job: { kind, name, prompt: fitText(prompt, 160, 320), color: kind === "words" ? false : color, detail, cost: cost({ mode: input.mode, color, detail }) } };
}

async function startJob(ctx, input) {
  const { path, body, job } = prepareJob(input);
  const made = await meshy(ctx, path, { method: "POST", body: JSON.stringify(body) });
  const id = String(made?.result ?? "");
  if (!ID_RE.test(id)) throw new HttpError(502, "meshy_error", "Meshy didn't start the job. Try again.");
  return { id, ...job, created: Date.now() };
}

// ---------- the PC route (no key) ----------
const relayId = () => "pc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
async function readR2Json(bucket, key) {
  const o = await bucket.get(key);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch { return null; }
}
const putR2Json = (bucket, key, v) => bucket.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });
async function relayFiles(bucket, id) {
  const { objects } = await bucket.list({ prefix: `${RELAY.file}${id}/` });
  return objects.map((o) => o.key);
}
// What the page sees for a PC job: the same shape as view(), from what the runner last reported.
function relayView(job) {
  const { taskId, sentAt, waiting, ...rest } = job;
  return { ...rest, status: job.status ?? "PENDING", progress: Number.isFinite(job.progress) ? job.progress : 0, formats: job.formats ?? [], picture: job.picture === true };
}
async function relayQueue(ctx, path, body, job) {
  const id = relayId();
  await putR2Json(ctx.relay, RELAY.req + id, { path, body });
  const rec = { id, ...job, created: Date.now(), status: "PENDING", progress: 0, waiting: true };
  await ctx.relayJobs.set(id, "1", { metadata: rec });
  return rec;
}
async function relayDelete(ctx, id) {
  await Promise.all([ctx.relayJobs.delete(id), ctx.relay.delete(RELAY.req + id), ...(await relayFiles(ctx.relay, id)).map((k) => ctx.relay.delete(k))]);
}

// The runner on the PC: its hello (with the Meshy balance it read through the CLI), and its reports.
async function handleRunner(req, ctx, parts) {
  const [what = "", id = "", fmt = "", extra] = parts;
  if (extra !== undefined || (id && !ID_RE.test(id))) return json({ error: "Not found" }, 404);
  const { relay, relayJobs } = ctx;
  if (!what && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const bal = Number(q.get("balance"));
    const prev = (await readR2Json(relay, RELAY.runner)) ?? {};
    await putR2Json(relay, RELAY.runner, {
      at: Date.now(), signedIn: q.get("signedIn") === "1", version: String(q.get("v") ?? "").slice(0, 20),
      balance: q.has("balance") && Number.isFinite(bal) ? bal : prev.balance ?? null, balanceAt: q.has("balance") ? Date.now() : prev.balanceAt ?? null,
    });
    const { blobs } = await relayJobs.list();
    const jobs = blobs.map(({ key, metadata }) => ({ id: key, ...(metadata ?? {}) })).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    const send = jobs.filter((j) => j.waiting && j.status === "PENDING").map((j) => j.id).slice(0, 4);
    const watch = jobs.filter((j) => j.taskId && !["SUCCEEDED", "FAILED", "EXPIRED", "CANCELED"].includes(j.status))
      .map((j) => ({ id: j.id, kind: j.kind, taskId: j.taskId, path: PATHS[j.kind] }));
    return json({ send, watch });
  }
  if (!id) return json({ error: "Not found" }, 404);
  const job = await getJob(relayJobs, id);
  if (what === "req" && req.method === "GET") {
    const r = await readR2Json(relay, RELAY.req + id);
    if (!r || !job.waiting) return json({ error: "Nothing to send for this job." }, 404);
    return json({ id, kind: job.kind, ...r });
  }
  if (what === "sent" && req.method === "POST") {
    const b = await readJson(req, 4096);
    if (!job.waiting) return json({ job: relayView(job) }); // sent already: never twice
    let next;
    if (typeof b.taskId === "string" && ID_RE.test(b.taskId)) next = { ...job, waiting: false, taskId: b.taskId, sentAt: Date.now(), status: "PENDING", progress: 0 };
    else next = { ...job, waiting: false, status: "FAILED", error: fitText(String(b.error || "Meshy couldn't start this one. No credits were used."), 200, 300) };
    await relayJobs.set(id, "1", { metadata: next });
    await relay.delete(RELAY.req + id);
    return json({ job: relayView(next) });
  }
  if (what === "status" && req.method === "POST") {
    const b = await readJson(req, 4096);
    if (!STATUSES.has(b.status)) return json({ error: "Unknown status." }, 400);
    const next = {
      ...job, status: b.status,
      progress: Number.isFinite(b.progress) ? Math.max(0, Math.min(100, Math.round(b.progress))) : job.progress ?? 0,
      queue: Number.isFinite(b.queue) ? b.queue : undefined,
      credits: Number.isFinite(b.credits) ? b.credits : job.credits,
      expiresAt: Number.isFinite(b.expiresAt) ? b.expiresAt : job.expiresAt,
      error: b.status === "FAILED" ? fitText(String(b.error || "Meshy couldn't make this one. No credits were used."), 200, 300) : undefined,
      formats: Array.isArray(b.formats) ? FORMATS.filter((f) => b.formats.includes(f)) : job.formats ?? [],
      picture: b.picture === true || job.picture === true,
    };
    if (next.status === "SUCCEEDED") {
      const have = new Set((await relayFiles(relay, id)).map((k) => k.split("/").pop()));
      next.formats = next.formats.filter((f) => have.has(f));
      next.picture = have.has("picture");
      if (!next.formats.length) return json({ error: "Send the finished files first." }, 409);
    }
    await relayJobs.set(id, "1", { metadata: next });
    return json({ job: relayView(next) });
  }
  if (what === "file" && req.method === "PUT") {
    if (!FILE_TYPES.includes(fmt)) return json({ error: "Not found" }, 404);
    if (!job.taskId) return json({ error: "This job wasn't sent yet." }, 409);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return json({ error: "The file is empty." }, 400);
    if (bytes.length > 60 * 1024 * 1024) return json({ error: "That model is too big to bring in." }, 413);
    await relay.put(`${RELAY.file}${id}/${fmt}`, bytes);
    return json({ ok: true, bytes: bytes.length });
  }
  return json({ error: "Not supported" }, 405);
}

// Every page request when Meshy runs through the PC.
async function handleRelay(req, ctx, section, id, action, fmt) {
  const { relay, relayJobs, files } = ctx;
  if (!section && req.method === "GET") {
    const runner = await readR2Json(relay, RELAY.runner);
    const online = Boolean(runner && Date.now() - runner.at < RUNNER_FRESH_MS);
    const { blobs } = await relayJobs.list();
    const list = [];
    for (const { key, metadata } of blobs) {
      let j = { id: key, ...(metadata ?? {}) };
      // Old copies are cleared out; the job stays on the list as expired unless it was saved to the library.
      if (j.status === "SUCCEEDED" && Date.now() - (j.created ?? 0) > KEEP_FILES_MS) {
        for (const k of await relayFiles(relay, key)) await relay.delete(k);
        j = { ...j, status: "EXPIRED", formats: [], picture: false };
        await relayJobs.set(key, "1", { metadata: j });
      }
      list.push(relayView(j));
    }
    list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    return json({ configured: true, via: "pc", runner: { online, at: runner?.at ?? null, signedIn: runner?.signedIn ?? null }, balance: runner?.balance ?? null, jobs: list });
  }
  if (section === "jobs" && !id && req.method === "POST") {
    const { path, body, job } = prepareJob(await readJson(req, MAX_BODY));
    return json({ job: relayView(await relayQueue(ctx, path, body, job)) }, 201);
  }
  if (!id) return json({ error: "Not supported" }, 405);
  const job = await getJob(relayJobs, id);
  if (!action && req.method === "GET") return json({ job: relayView(job) });
  if (!action && req.method === "DELETE") { await relayDelete(ctx, id); return json({ deleted: id }); }
  if (action === "file" && req.method === "GET") {
    if (!FILE_TYPES.includes(fmt)) return json({ error: "Not found" }, 404);
    if (job.status === "EXPIRED") throw new HttpError(404, "meshy_gone", "This model has expired (copies are kept 7 days).");
    const o = await relay.get(`${RELAY.file}${id}/${fmt}`);
    if (!o) throw new HttpError(404, "not_ready", "That file isn't ready.");
    const bytes = new Uint8Array(await o.arrayBuffer());
    const headers = { ...HEADERS, "cache-control": "private, max-age=600" };
    if (fmt === "picture") headers["content-type"] = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
    else { headers["content-type"] = "application/octet-stream"; headers["content-disposition"] = `attachment; filename="${safeName(job.name).replace(/[^\w.\- ]+/g, "_")}.${fmt}"`; }
    return new Response(bytes, { headers });
  }
  if (action === "color" && req.method === "POST") {
    if (job.kind !== "words") return json({ error: "Color is picked when a photo job starts." }, 400);
    if (job.status !== "SUCCEEDED" || !job.taskId) return json({ error: "Wait until the shape is finished, then add color." }, 409);
    const colored = await relayQueue(ctx, PATHS.words, { mode: "refine", preview_task_id: job.taskId, target_formats: FORMATS },
      { kind: "words", name: fitText(`${job.name} (color)`, 90, 170), prompt: job.prompt, color: true, detail: job.detail, cost: cost({ mode: "color" }), from: id });
    return json({ job: relayView(colored) }, 201);
  }
  if (action === "save" && req.method === "POST") {
    const { format = "3mf" } = await readJson(req, 1024);
    if (!["3mf", "stl"].includes(format)) return json({ error: "Save a 3MF or an STL." }, 400);
    if (job.status !== "SUCCEEDED") return json({ error: "Wait until the model is finished." }, 409);
    const o = await relay.get(`${RELAY.file}${id}/${format}`) ?? (format === "3mf" ? await relay.get(`${RELAY.file}${id}/stl`) : null);
    if (!o) return json({ error: "That file isn't ready." }, 404);
    const ext = o.key.endsWith("/stl") ? "stl" : format;
    const out = await saveFile(files, ctx.env, { name: `${safeName(job.name)}.${ext}`, body: new Uint8Array(await o.arrayBuffer()), tags: "made with Meshy" }, ctx.afterSave);
    if (out.error) return json({ error: out.error, code: out.code }, out.status);
    await relayJobs.set(id, "1", { metadata: { ...job, saved: out.item.key } });
    return json({ item: out.item }, 201);
  }
  return json({ error: "Not supported" }, 405);
}

export async function handleMeshy(req, ctx) {
  try {
    requireKey({ header: (k) => req.headers.get(k) }, ctx.env, "The 3D maker");
    let rest;
    try { rest = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/meshy\/?/, "")); }
    catch { return json({ error: "Not found" }, 404); }
    const parts = rest.split("/");
    const viaPc = !ctx.env("MESHY_API_KEY") && ctx.relay && ctx.relayJobs;
    if (parts[0] === "runner") return viaPc ? await handleRunner(req, ctx, parts.slice(1)) : json({ error: "Meshy runs with the key here, not through the PC." }, 409);
    const [section = "", id = "", action = "", fmt = "", extra] = parts;
    if (extra !== undefined || (section && section !== "jobs") || (id && !ID_RE.test(id))) return json({ error: "Not found" }, 404);
    if (viaPc) return await handleRelay(req, ctx, section, id, action, fmt);
    const { jobs, files } = ctx;

    if (!section && req.method === "GET") {
      const configured = Boolean(ctx.env("MESHY_API_KEY"));
      let balance = null;
      if (configured) balance = await meshy(ctx, "/openapi/v1/balance").then((b) => (Number.isFinite(b?.balance) ? b.balance : null)).catch(() => null);
      const { blobs } = await jobs.list();
      const list = blobs.map(({ key, metadata }) => ({ id: key, ...(metadata ?? {}) })).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
      return json({ configured, balance, jobs: list });
    }

    if (section === "jobs" && !id && req.method === "POST") {
      const job = await startJob(ctx, await readJson(req, MAX_BODY));
      await jobs.set(job.id, "1", { metadata: job });
      return json({ job: view(job, { status: "PENDING", progress: 0 }) }, 201);
    }

    if (!id) return json({ error: "Not supported" }, 405);
    const job = await getJob(jobs, id);

    if (!action && req.method === "GET") return json({ job: view(job, await taskOf(ctx, job)) });

    if (!action && req.method === "DELETE") {
      await jobs.delete(id);
      return json({ deleted: id });
    }

    if (action === "file" && req.method === "GET") {
      if (![...FORMATS, "picture"].includes(fmt)) return json({ error: "Not found" }, 404);
      const bytes = await download(ctx, await taskOf(ctx, job), fmt);
      const headers = { ...HEADERS, "cache-control": "private, max-age=600" };
      if (fmt === "picture") headers["content-type"] = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
      else { headers["content-type"] = "application/octet-stream"; headers["content-disposition"] = `attachment; filename="${safeName(job.name).replace(/[^\w.\- ]+/g, "_")}.${fmt}"`; }
      return new Response(bytes, { headers });
    }

    if (action === "color" && req.method === "POST") {
      if (job.kind !== "words") return json({ error: "Color is picked when a photo job starts." }, 400);
      const task = await taskOf(ctx, job);
      if (task.status !== "SUCCEEDED") return json({ error: "Wait until the shape is finished, then add color." }, 409);
      const made = await meshy(ctx, PATHS.words, { method: "POST", body: JSON.stringify({ mode: "refine", preview_task_id: id, target_formats: FORMATS }) });
      const newId = String(made?.result ?? "");
      if (!ID_RE.test(newId)) return json({ error: "Meshy didn't start the job. Try again." }, 502);
      const colored = { id: newId, kind: "words", name: fitText(`${job.name} (color)`, 90, 170), prompt: job.prompt, color: true, detail: job.detail, created: Date.now(), cost: cost({ mode: "color" }), from: id };
      await jobs.set(newId, "1", { metadata: colored });
      return json({ job: view(colored, { status: "PENDING", progress: 0 }) }, 201);
    }

    if (action === "save" && req.method === "POST") {
      const { format = "3mf" } = await readJson(req, 1024);
      if (!["3mf", "stl"].includes(format)) return json({ error: "Save a 3MF or an STL." }, 400);
      const task = await taskOf(ctx, job);
      if (task.status !== "SUCCEEDED") return json({ error: "Wait until the model is finished." }, 409);
      const body = await download(ctx, task, format);
      const out = await saveFile(files, ctx.env, { name: `${safeName(job.name)}.${format}`, body, tags: "made with Meshy" }, ctx.afterSave);
      if (out.error) return json({ error: out.error, code: out.code }, out.status);
      await jobs.set(id, "1", { metadata: { ...job, saved: out.item.key } });
      return json({ item: out.item }, 201);
    }

    return json({ error: "Not supported" }, 405);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
}
