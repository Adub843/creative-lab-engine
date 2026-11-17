// Cloudflare Worker entry point (wrangler.toml `main`). Everything is in worker/app.mjs; a Worker's
// entry module may only export handlers, so the helpers the tests use are exported from there.
// queue: the Creative Lab Studios console's actions (worker/queue.mjs).
import { handleRequest, handleScheduled, UPKEEP_CRON } from "./app.mjs";
import { handleQueue, pruneResults } from "./queue.mjs";
import { recordRun } from "../lib/system-map.mjs";

export default {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (event, env, ctx) => {
    // Every run is written down (status/cron-<job>.json in RESULTS) so the console's System map can show it,
    // and raise an alarm when a job fails or misses its time. A job that answers null or {ok:false} failed.
    ctx.waitUntil(handleScheduled(env, event.cron, event.scheduledTime)
      .then((result) => recordRun(env?.RESULTS, event.cron, { ok: result != null && result.ok !== false, result, error: result?.error }))
      .catch((error) => recordRun(env?.RESULTS, event.cron, { ok: false, error })));
    // Old queue answers and uploads go once an hour (never the digest/ files).
    if (event.cron === UPKEEP_CRON) ctx.waitUntil(pruneResults(env).catch(() => 0));
  },
  queue: (batch, env) => handleQueue(batch, env),
};
