// Cloudflare Worker entry point (wrangler.toml `main`). Everything is in worker/app.mjs; a Worker's
// entry module may only export handlers, so the helpers the tests use are exported from there.
import { handleRequest, handleScheduled } from "./app.mjs";

export default {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(handleScheduled(env)),
};
