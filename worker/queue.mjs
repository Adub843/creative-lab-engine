// The bridge between the Creative Lab Studios console and this engine.
//
// The console is a claude.ai page: it can't call this Worker's address, but it can reach Aaron's
// Cloudflare account through his Cloudflare connector. So every console action is one message on the
// ACTIONS queue, and its answer is one object in the RESULTS bucket:
//
//   1. the console writes a large body (an upload) to RESULTS as  uploads/<id>  when it has one;
//   2. it pushes  { id, method, path, query?, body?, bodyRef?, contentType?, filename?, tags? }  to the queue;
//   3. this consumer wakes at once (max_batch_timeout 0), runs the request through the same
//      handleRequest as the old /api/* routes, signed with the engine's own CONSOLE_KEY, and writes
//      results/<id>  (the answer's bytes, with status and content type in its custom metadata);
//   4. the console reads results/<id> and shows it.
//
// Only someone who can write to Aaron's Cloudflare account can push a message, so the key never
// leaves the engine. Results and uploads are removed after a day (pruneResults, on the hourly cron).
import { handleRequest } from "./app.mjs";

export const RESULT_PREFIX = "results/";
export const UPLOAD_PREFIX = "uploads/";
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DAY = 24 * 60 * 60 * 1000;

// Turns one queue message into a Request for handleRequest, or throws with a plain reason.
export async function actionRequest(msg, env) {
  if (!msg || typeof msg !== "object") throw new Error("The action is empty.");
  if (!ID.test(String(msg.id ?? ""))) throw new Error("The action needs an id of 8 to 64 letters, digits, - or _.");
  const method = String(msg.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new Error(`Unknown method ${method}.`);
  const path = String(msg.path ?? "");
  if (!path.startsWith("/api/")) throw new Error("Only /api/ paths can be run.");
  const url = new URL(path, "https://engine.internal");
  for (const [k, v] of Object.entries(msg.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = new Headers();
  const key = env?.CONSOLE_KEY;
  if (key) headers.set("x-console-key", String(key));
  if (msg.filename) headers.set("x-filename", String(msg.filename));
  if (msg.tags) headers.set("x-tags", String(msg.tags));
  let body;
  if (msg.bodyRef) {
    const ref = String(msg.bodyRef);
    if (!ref.startsWith(UPLOAD_PREFIX) || ref.includes("..")) throw new Error("bodyRef must point into uploads/.");
    const obj = await env.RESULTS.get(ref);
    if (!obj) throw new Error("The upload for this action wasn't found.");
    body = await obj.arrayBuffer();
    headers.set("content-type", msg.contentType ?? obj.httpMetadata?.contentType ?? "application/octet-stream");
  } else if (msg.body !== undefined && msg.body !== null && method !== "GET") {
    body = typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body);
    headers.set("content-type", msg.contentType ?? "application/json");
  }
  return new Request(url, { method, headers, body });
}

// Runs one action and saves its answer. Never throws: a failure is saved as the answer.
export async function runAction(msg, env, handler = handleRequest) {
  const id = ID.test(String(msg?.id ?? "")) ? msg.id : null;
  let status = 500;
  let contentType = "application/json";
  let bytes;
  try {
    const res = await handler(await actionRequest(msg, env), env);
    status = res.status;
    contentType = res.headers.get("content-type") ?? "application/octet-stream";
    bytes = await res.arrayBuffer();
  } catch (e) {
    status = 400;
    bytes = new TextEncoder().encode(JSON.stringify({ error: e?.message ?? "The action failed." }));
  }
  if (id) {
    await env.RESULTS.put(RESULT_PREFIX + id, bytes, {
      httpMetadata: { contentType },
      customMetadata: { status: String(status), path: String(msg.path ?? ""), at: new Date().toISOString() },
    });
    if (msg.bodyRef) await env.RESULTS.delete(String(msg.bodyRef)).catch(() => null);
  }
  return { id, status };
}

export async function handleQueue(batch, env) {
  for (const m of batch.messages) {
    await runAction(m.body, env);
    m.ack();
  }
}

// Removes answers and uploads older than a day.
export async function pruneResults(env, now = Date.now()) {
  if (!env?.RESULTS) return 0;
  let removed = 0;
  for (const prefix of [RESULT_PREFIX, UPLOAD_PREFIX]) {
    let cursor;
    do {
      const page = await env.RESULTS.list({ prefix, cursor });
      const old = page.objects.filter((o) => now - new Date(o.uploaded).getTime() > DAY).map((o) => o.key);
      if (old.length) { await env.RESULTS.delete(old); removed += old.length; }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return removed;
}
