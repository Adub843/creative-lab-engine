// The `lab` MCP server for Stacy's shifts on the server: the Claude Code command line starts it (stdio) and
// gets the Lab's database and file store as tools, in place of the ArtifactData tool the claude.ai tasks used.
// It talks to the Lab server with a narrow agent key (LAB_AGENT_KEY, made with `npm run agent-key`).
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const URL_ = (process.env.LAB_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const KEY = process.env.LAB_AGENT_KEY || "";
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown", ".mp4": "video/mp4", ".webm": "video/webm", ".stl": "model/stl", ".3mf": "model/3mf", ".glb": "model/gltf-binary", ".obj": "model/obj" };

async function lab(path, init) {
  const r = await fetch(URL_ + "/_lab/api/" + path, { ...init, headers: { authorization: "Bearer " + KEY, ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || `Lab answered ${r.status}`);
  return j;
}
const db = b => lab("db", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const TOOLS = [
  { name: "get", description: "Read one Lab document (even-segment path such as brief/todo).", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, run: a => db({ op: "get", path: a.path }) },
  { name: "list", description: "List documents in a Lab collection (odd-segment path such as reqs). Optional where [[field,op,value]], orderBy [field,'asc'|'desc'], limit.", inputSchema: { type: "object", properties: { collection: { type: "string" }, where: { type: "array" }, orderBy: { type: "array" }, limit: { type: "number" } }, required: ["collection"] }, run: a => db({ op: "query", path: a.collection, where: a.where, orderBy: a.orderBy, limit: a.limit || 200 }) },
  { name: "set", description: "Replace a Lab document with data.", inputSchema: { type: "object", properties: { path: { type: "string" }, data: { type: "object" } }, required: ["path", "data"] }, run: a => db({ op: "set", path: a.path, data: a.data }) },
  { name: "update", description: "Merge fields into an existing Lab document.", inputSchema: { type: "object", properties: { path: { type: "string" }, data: { type: "object" } }, required: ["path", "data"] }, run: a => db({ op: "update", path: a.path, data: a.data }) },
  { name: "delete", description: "Delete a Lab document.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, run: a => db({ op: "delete", path: a.path }) },
  { name: "upload_file", description: "Add a file from this computer to the Lab's file store. Returns {id,url}; use url (/_blob/<id>) in a document's image field.", inputSchema: { type: "object", properties: { file: { type: "string" }, type: { type: "string" } }, required: ["file"] }, run: a => lab("assets?name=" + encodeURIComponent(basename(a.file)), { method: "PUT", headers: { "content-type": a.type || TYPES[extname(a.file).toLowerCase()] || "application/octet-stream" }, body: readFileSync(a.file) }) },
];

const out = m => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const reply = result => m.id !== undefined && out({ jsonrpc: "2.0", id: m.id, result });
  try {
    if (m.method === "initialize") return reply({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lab", version: "1" } });
    if (m.method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    if (m.method === "tools/call") {
      const t = TOOLS.find(x => x.name === m.params?.name);
      if (!t) return reply({ content: [{ type: "text", text: "No such tool" }], isError: true });
      try { const r = await t.run(m.params.arguments || {}); return reply({ content: [{ type: "text", text: JSON.stringify(r) }] }); }
      catch (e) { return reply({ content: [{ type: "text", text: e.message }], isError: true }); }
    }
    if (m.method === "ping") return reply({});
    if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
  } catch (e) { if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } }); }
});
