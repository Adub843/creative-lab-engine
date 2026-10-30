// Cloudflare Worker entry point (wrangler.toml `main`). Everything is in worker/app.mjs; a Worker's
// entry module may only export handlers, so the helpers the tests use are exported from there.
// queue: the Creative Lab Studios console's actions (worker/queue.mjs).
import { handleRequest, handleScheduled, KITTL_CRON } from "./app.mjs";
import { handleQueue, pruneResults } from "./queue.mjs";

export default {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(handleScheduled(env, event.cron));
    if (event.cron === KITTL_CRON) ctx.waitUntil(pruneResults(env).catch(() => 0));
  },
  queue: (batch, env) => handleQueue(batch, env),
};
