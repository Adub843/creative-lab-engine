// What the Lab reached through claude.ai connectors (the `mcp` capability), answered by the server:
//  - "Claude Code Remote": Stacy's shifts, run by the server's runner (runner.mjs)
//  - "cloudflare" execute: the page's engine code runs in the browser as before; its cloudflare.request calls
//    come here and go to Cloudflare's API with the token Aaron typed at install, limited to the engine's
//    queue and buckets (cfRequest below)
//  - "Kittl": Kittl's own MCP server, signed in once at install (kittlCall below); unavailable until then
const CF_API = "https://api.cloudflare.com/client/v4";

export function makeConnectors(cfg, runner) {
  const cf = {
    token: process.env.CF_API_TOKEN || (cfg.cloudflare?.apiBase ? "test-only" : ""), account: cfg.cloudflare?.accountId || process.env.CF_ACCOUNT_ID || "",
    queue: cfg.cloudflare?.queueId || "", buckets: cfg.cloudflare?.buckets || ["creative-lab-engine", "c3d-files"],
  };
  // only the paths the Lab's engine page uses; anything else is refused
  function cfAllowed(method, path) {
    const A = `/accounts/${cf.account}`;
    if (method === "POST" && path === `${A}/queues/${cf.queue}/messages`) return true;
    const m = /^\/accounts\/([^/]+)\/r2\/buckets\/([^/]+)\/objects\/(.+)$/.exec(path);
    return !!m && m[1] === cf.account && cf.buckets.includes(m[2]) && ["GET", "PUT", "DELETE", "HEAD"].includes(method) && !m[3].includes("..");
  }
  async function cfRequest({ method = "GET", path, body, contentType }) {
    method = String(method).toUpperCase();
    if (!cf.token || !cf.account) throw err("server_not_connected", "The Cloudflare token isn't set on the server yet.");
    if (!cfAllowed(method, String(path || ""))) throw err("blocked_by_policy", `The Lab server doesn't allow ${method} ${path}`);
    const headers = { authorization: `Bearer ${cf.token}` };
    let payload;
    if (body !== undefined && body !== null) {
      if (body.__bytes) { payload = Buffer.from(body.__bytes, "base64"); headers["content-type"] = contentType || "application/octet-stream"; }
      else if (typeof body === "string") { payload = body; headers["content-type"] = contentType || "text/plain"; }
      else { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
    }
    const r = await fetch((cfg.cloudflare?.apiBase || CF_API) + path, { method, headers, body: payload });
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) throw Object.assign(err("tool_error", `Cloudflare answered ${r.status}`), { status: r.status, body: buf.toString("utf8").slice(0, 500) });
    if (/json/.test(ct)) return { kind: "json", value: JSON.parse(buf.toString("utf8") || "null") };
    if (/^text\//.test(ct)) return { kind: "text", value: buf.toString("utf8") };
    return { kind: "bytes", value: buf.toString("base64") };
  }

  /* ---- Kittl: a plain MCP-over-HTTP client using the token saved at install ---- */
  const kittl = { url: cfg.kittl?.url || "", token: process.env.KITTL_MCP_TOKEN || "" };
  let rpcId = 0, kittlSession = null;
  async function kittlRpc(method, params) {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${kittl.token}` };
    if (kittlSession) headers["mcp-session-id"] = kittlSession;
    const r = await fetch(kittl.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
    if (r.status === 401) throw err("needs_reauth", "Kittl needs signing in again on the server.");
    if (!r.ok) throw err("server_unavailable", `Kittl answered ${r.status}`);
    kittlSession = r.headers.get("mcp-session-id") || kittlSession;
    const text = await r.text();
    const json = /event-stream/.test(r.headers.get("content-type") || "") ? JSON.parse(text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5)).pop() || "{}") : JSON.parse(text);
    if (json.error) throw err("tool_error", json.error.message || "Kittl error");
    return json.result;
  }
  async function kittlCall(tool, input) {
    if (!kittl.url || !kittl.token) throw err("server_not_connected", "Kittl isn't connected to the Lab server yet.");
    if (!kittlSession) await kittlRpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lab-server", version: "1" } });
    return kittlRpc("tools/call", { name: tool, arguments: input || {} });
  }

  const KITTL_TOOLS = ["kittl-generate-media", "kittl-get-media-generation-status", "kittl-get-token-balance"];
  const TRIG_TOOLS = ["list_triggers", "fire_trigger", "update_trigger", "delete_trigger"];

  async function call(server, tool, input = {}) {
    if (server === "Claude Code Remote") {
      if (!TRIG_TOOLS.includes(tool)) throw err("not_in_manifest", `${tool} isn't offered`);
      if (tool === "list_triggers") return wrap(runner.list(input));
      if (tool === "fire_trigger") return wrap(runner.fire(input.trigger_id, input.text));
      if (tool === "update_trigger") { const { trigger_id, ...patch } = input; return wrap(runner.update(trigger_id, patch)); }
      if (tool === "delete_trigger") return wrap(runner.remove(input.trigger_id));
    }
    if (server === "Kittl") {
      if (!KITTL_TOOLS.includes(tool)) throw err("not_in_manifest", `${tool} isn't offered`);
      const r = await kittlCall(tool, input);
      return { content: r.content || [], structuredContent: r.structuredContent, payload: r.structuredContent ?? parseText(r.content) };
    }
    throw err("server_not_found", `No connector called ${server} on the Lab server`);
  }
  function tools() {
    return {
      cloudflare: { accountId: cf.account }, // not a secret; the engine page's code reads it as `accountId`
      servers: [
        { server: "Claude Code Remote", kind: "connector", authStatus: runner.cli ? "connected" : "unknown", tools: TRIG_TOOLS.map(name => ({ name, description: name })) },
        { server: "Kittl", kind: "connector", authStatus: kittl.url && kittl.token ? "connected" : "unknown", tools: KITTL_TOOLS.map(name => ({ name, description: name })) },
        { server: "cloudflare", kind: "connector", authStatus: cf.token ? "connected" : "unknown", tools: [{ name: "execute", description: "Runs the engine page's Cloudflare requests" }] },
      ],
    };
  }
  return { call, tools, cfRequest, cfReady: () => !!(cf.token && cf.account) };
}

function wrap(payload) { return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, payload }; }
function parseText(content) { const t = (content || []).filter(c => c.type === "text").map(c => c.text).join(""); try { return JSON.parse(t); } catch { return t; } }
export function err(code, message) { return Object.assign(new Error(message), { code }); }
