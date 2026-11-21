// Runs the Lab's Meshy jobs on Aaron's PC with the Meshy CLI that is signed in there (browser sign-in, no API key
// anywhere). lib/meshy.mjs explains the whole path: with no MESHY_API_KEY on the engine, a job from the Lab's
// 3D maker waits in the engine, and this runner (every minute, scripts/setup-meshy.ps1) sends it to Meshy,
// reports its progress, and brings the finished files back to the engine so the Lab can show and save them.
// Plain Node, no packages, so Alice can run it.
//
//   node scripts/meshy-runner.mjs            send waiting jobs, check running ones, then exit
//   node scripts/meshy-runner.mjs --status   say whether the Meshy CLI is signed in and the credit balance
//
// Never sends a paid job twice: each Meshy task id is written to sent.json before the engine hears about it,
// and a send whose result is unknown is reported as failed (check meshy.ai) instead of being tried again.
// The CLI keeps its own sign-in; this script never reads it. The console key (drive-server\setup.ps1) is only
// sent to the engine as a header.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE = process.env.CONSOLE_URL ?? "https://creative-lab-engine.business-console.workers.dev";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const LAB = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "CreativeLab");
export const CLI = process.env.MESHY_CLI ?? path.join(LAB, "meshy-cli", "node_modules", "meshy-cli", "dist", "index.js");
const WORK = process.env.LAB_MESHY_JOBS ?? path.join(LAB, "meshy-jobs");
const LOCK = path.join(os.tmpdir(), "meshy-runner.lock");
const LOG = path.join(REPO, "ai-jobs", "runs", "meshy", "meshy.log");
const BALANCE_EVERY_MS = 10 * 60 * 1000;
const MAX_FILE = 60 * 1024 * 1024;
// The only Meshy routes the Lab uses (lib/meshy.mjs PATHS), as the CLI names them.
const ROUTES = {
  "/openapi/v1/image-to-3d": { path: "/image-to-3d", flags: [] },
  "/openapi/v1/multi-image-to-3d": { path: "/multi-image-to-3d", flags: [] },
  "/openapi/v2/text-to-3d": { path: "/text-to-3d", flags: ["--v2"] },
};
const TASK_ID = /^[A-Za-z0-9-]{8,64}$/;
const FILES = ["glb", "stl", "3mf"]; // what the Lab shows and saves; OBJ stays at Meshy

export function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) fs.renameSync(LOG, LOG + ".old");
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging never stops a job */ }
}

export class CliError extends Error {
  constructor(message, { status, sure }) { super(message); this.status = status; this.sure = sure; }
}

// One Meshy CLI call. The answer is Meshy's JSON body; a failure says whether Meshy surely refused it (sure: true)
// or the result is unknown (a timeout or a lost connection).
export function meshyCli(args, { cli = CLI, timeout = 180_000 } = {}) {
  if (!fs.existsSync(cli)) throw new CliError("The Meshy CLI isn't installed here: run scripts\\setup-meshy.ps1.", { sure: true });
  const r = spawnSync(process.execPath, [cli, ...args, "--format", "json", "--no-update-check"], { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (r.error) throw new CliError(`The Meshy CLI didn't answer (${r.error.code ?? r.error.message}).`, { sure: false });
  let body = null;
  try { body = JSON.parse(r.stdout || "null"); } catch { /* below */ }
  if (r.status === 0 && body !== null) return body;
  const msg = String(body?.message ?? r.stderr ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || `exit ${r.status}`;
  const status = Number(body?.status) || undefined;
  throw new CliError(msg, { status, sure: Boolean(status && status >= 400 && status < 500) });
}

// The engine's runner routes (lib/meshy.mjs), with the console key.
export function engineClient(key, { base = ENGINE, fetchImpl = fetch } = {}) {
  return async (pathname, init = {}) => {
    const r = await fetchImpl(base + pathname, { ...init, headers: { accept: "application/json", "x-console-key": key, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${pathname}: ${r.status} ${body?.error ?? ""}`);
    return body;
  };
}
const postJson = (engine, p, v) => engine(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });

// Files come only from Meshy's own file host, like the engine's own downloads.
export async function download(url, fetchImpl = fetch) {
  let u;
  try { u = new URL(url); } catch { throw new Error("Meshy sent a bad file link."); }
  if (u.protocol !== "https:" || !(u.hostname === "assets.meshy.ai" || u.hostname.endsWith(".meshy.ai"))) throw new Error("Meshy sent a file link from somewhere else.");
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`Couldn't download a file from Meshy (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > MAX_FILE) throw new Error("That model is too big to bring in.");
  return bytes;
}

function readState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch { return {}; }
}
function writeState(dir, s) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json.tmp"), JSON.stringify(s, null, 1));
  fs.renameSync(path.join(dir, "state.json.tmp"), path.join(dir, "state.json"));
}

// One pass: hello (with the balance now and then), send waiting jobs, check running ones.
export async function runOnce({ engine, cli = meshyCli, fetchImpl = fetch, dir = WORK, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const state = readState(dir);
  state.sent ??= {};
  const q = new URLSearchParams({ v: "1" });
  if (!state.balanceAt || now - state.balanceAt > BALANCE_EVERY_MS) {
    try {
      const b = cli(["api", "GET", "/balance"]);
      if (Number.isFinite(b?.balance)) { q.set("balance", String(b.balance)); q.set("signedIn", "1"); state.balanceAt = now; }
    } catch (e) { q.set("signedIn", "0"); log(`balance: ${e.message}`); }
  }
  const { send = [], watch = [] } = await engine(`/api/meshy/runner?${q}`);
  let worked = false;

  for (const id of send) {
    // Sent already (the engine didn't hear back last time)? Tell it again; never send twice.
    if (state.sent[id] === "unknown") { await postJson(engine, `/api/meshy/runner/sent/${id}`, { error: "Couldn't tell if Meshy started it. Check meshy.ai before trying again." }); continue; }
    if (state.sent[id]) { await postJson(engine, `/api/meshy/runner/sent/${id}`, { taskId: state.sent[id] }); continue; }
    const job = await engine(`/api/meshy/runner/req/${id}`);
    const route = ROUTES[job.path];
    if (!route) { await postJson(engine, `/api/meshy/runner/sent/${id}`, { error: "Unknown kind of Meshy job." }); continue; }
    const file = path.join(dir, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(job.body));
    try {
      const made = cli(["api", "POST", route.path, ...route.flags, "--data", `@${file}`], { timeout: 300_000 });
      const taskId = String(made?.result ?? "");
      if (!TASK_ID.test(taskId)) throw new CliError("Meshy didn't say which task it started.", { sure: false });
      state.sent[id] = taskId;
      writeState(dir, state);
      await postJson(engine, `/api/meshy/runner/sent/${id}`, { taskId });
      log(`sent ${id} -> ${taskId}`);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      const error = e.sure ? `Meshy refused it: ${e.message}` : `Couldn't tell if Meshy started it (${e.message}). Check meshy.ai before trying again.`;
      state.sent[id] = "unknown";
      writeState(dir, state);
      await postJson(engine, `/api/meshy/runner/sent/${id}`, { error });
      log(`not sent ${id}: ${e.message}`);
    } finally { fs.rmSync(file, { force: true }); }
    worked = true;
  }

  for (const w of watch) {
    const route = ROUTES[w.path];
    if (!route || !TASK_ID.test(w.taskId)) continue;
    let task;
    try { task = cli(["api", "GET", `${route.path}/${w.taskId}`, ...route.flags]); }
    catch (e) {
      if (e instanceof CliError && (e.status === 404 || e.status === 400)) await postJson(engine, `/api/meshy/runner/status/${w.id}`, { status: "EXPIRED" });
      log(`check ${w.id}: ${e.message}`);
      continue;
    }
    if (task.status !== "SUCCEEDED") {
      await postJson(engine, `/api/meshy/runner/status/${w.id}`, {
        status: task.status, progress: task.progress, queue: task.preceding_tasks,
        error: task.status === "FAILED" ? String(task.task_error?.message ?? "") : undefined,
      });
      continue;
    }
    const formats = [];
    for (const fmt of FILES) {
      const url = task.model_urls?.[fmt];
      if (typeof url !== "string") continue;
      try {
        const bytes = await download(url, fetchImpl);
        await engine(`/api/meshy/runner/file/${w.id}/${fmt}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes });
        formats.push(fmt);
      } catch (e) { log(`${fmt} for ${w.id}: ${e.message}`); }
    }
    let picture = false;
    if (typeof task.thumbnail_url === "string") {
      try {
        await engine(`/api/meshy/runner/file/${w.id}/picture`, { method: "PUT", headers: { "content-type": "image/png" }, body: await download(task.thumbnail_url, fetchImpl) });
        picture = true;
      } catch (e) { log(`picture for ${w.id}: ${e.message}`); }
    }
    if (!formats.length) { log(`no files yet for ${w.id}; trying again next run`); continue; }
    await postJson(engine, `/api/meshy/runner/status/${w.id}`, { status: "SUCCEEDED", progress: 100, formats, picture, credits: task.consumed_credits, expiresAt: task.expires_at });
    log(`done ${w.id} (${formats.join("+")})`);
    worked = true;
  }

  // A job that just used credits: read the balance again next run.
  if (worked) state.balanceAt = 0;
  // Keep the sent list short: the newest 500 ids.
  const ids = Object.keys(state.sent);
  if (ids.length > 500) for (const id of ids.slice(0, ids.length - 500)) delete state.sent[id];
  writeState(dir, state);
  return { sent: send.length, watched: watch.length };
}

async function main() {
  if (process.argv[2] === "--status") {
    try {
      const b = meshyCli(["api", "GET", "/balance"]);
      console.log(`Meshy is signed in on this PC: ${b.balance} credits.`);
    } catch (e) { console.log(`Meshy isn't ready here: ${e.message}`); process.exitCode = 1; }
    return;
  }
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); }
  catch {
    if (Date.now() - fs.statSync(LOCK).mtimeMs < 30 * 60 * 1000) return; // the last run is still working
    fs.writeFileSync(LOCK, String(process.pid));
  }
  try {
    const { readKey } = await import("../drive-server/key.mjs");
    const key = readKey();
    if (!key) { console.error("No console key on this PC yet: run drive-server\\setup.ps1 and type the key when asked."); process.exitCode = 1; return; }
    const out = await runOnce({ engine: engineClient(key) });
    if (out.sent || out.watched) console.log(`Sent ${out.sent}, checked ${out.watched}.`);
  } finally { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log("failed: " + e.message); console.error(e.message); process.exitCode = 1; });
}
