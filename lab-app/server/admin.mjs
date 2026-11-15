// The Lab server's admin commands, typed at the server (they never go through the web page):
//   npm run setup-code -- aaron                  one-time code to add a passkey on a new device (30 min)
//   npm run agent-key -- stacy aaron db,assets   key for Stacy's runner / Alice's scripts (shown once)
//   npm run admin -- export-db backup.jsonl      every document, one per line
//   npm run admin -- import-db <file.jsonl|folder> [old=new,...]   documents from claude.ai (people's ids remapped);
//                                                a folder is the ArtifactData out_dir tree: <collection path>/<doc id>.json
//   npm run admin -- import-assets <folder>      files saved from the Lab's file store as <32-hex id>.<ext>
//   npm run admin -- import-jobs triggers.json   Stacy's shifts from the claude.ai scheduled tasks
//   npm run admin -- backup <folder>             consistent copies of every database file
import { readFileSync, writeFileSync, createReadStream, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig, LAB_RULES } from "./index.mjs";
import { Store } from "./db.mjs";
import { Auth } from "./auth.mjs";
import { Assets } from "./assets.mjs";
import { Runner } from "./runner.mjs";

const cfg = loadConfig();
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown", ".css": "text/css", ".js": "text/javascript",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".stl": "model/stl", ".3mf": "model/3mf", ".glb": "model/gltf-binary", ".obj": "model/obj", ".zip": "application/zip" };
// the ArtifactData export tree: <collection path>/<doc id>.json, with subcollections in folders beside them
function* walk(root, rel) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.name.endsWith(".json") && r.split("/").length % 2 === 0) yield { path: r.slice(0, -5), data: JSON.parse(readFileSync(join(root, r), "utf8")) };
  }
}
const [cmd, ...args] = process.argv.slice(2);
const store = () => new Store(join(cfg.dataDir, "lab.db"), cfg.dbRules || LAB_RULES);
const auth = () => new Auth(join(cfg.dataDir, "auth.db"), { rpID: cfg.rpID, origin: cfg.origin, people: cfg.people });
mkdirSync(cfg.dataDir, { recursive: true });

const run = {
  "setup-code"([person]) { const a = auth(); console.log(`Setup code for ${a.person(person)?.name || person}: ${a.newSetupCode(person)}\nOpen ${cfg.origin}/_lab/login#setup on the new device within 30 minutes.`); },
  "agent-key"([name, person, scopes = "db"]) {
    if (!name || !person) throw new Error("usage: agent-key <name> <person> <scopes>");
    console.log(`Key for ${name} (shown once; put it in that agent's environment as LAB_AGENT_KEY):\n${auth().newAgentKey(name, person, scopes.split(","))}`);
  },
  "export-db"([file]) { const s = store(); const lines = []; for (const d of s.dump()) lines.push(JSON.stringify(d)); writeFileSync(file, lines.join("\n") + "\n"); console.log(`${lines.length} documents written to ${file}`); },
  "import-db"([file, mapArg = ""]) {
    const map = Object.fromEntries(mapArg.split(",").filter(Boolean).map(x => x.split("=")));
    const remap = p => p.replace(/^(data\/users|pins)\/([^/]+)/, (m, a, id) => `${a}/${map[id] || id}`);
    const s = store(); let n = 0;
    const docs = statSync(file).isDirectory() ? walk(file, "") : readFileSync(file, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
    // claude.ai account ids (u_...) become the Lab's own person ids everywhere they appear, paths and fields alike
    const swap = data => { let t = JSON.stringify(data); for (const [o, nw] of Object.entries(map)) t = t.split(o).join(nw); return JSON.parse(t); };
    for (const { path, data } of docs) { s.importDoc(remap(path), swap(data)); n++; }
    console.log(`${n} documents imported`);
  },
  async "import-assets"([dir]) {
    const a = new Assets(cfg.filesDir, join(cfg.dataDir, "assets.db"), { maxBytes: cfg.maxUploadBytes });
    let n = 0, skipped = 0;
    for (const f of readdirSync(dir)) {
      const m = /^([0-9a-f]{32})(\.[a-z0-9]+)?$/i.exec(f); if (!m) continue;
      if (a.meta(m[1].toLowerCase())) { skipped++; continue; }
      await a.put(createReadStream(join(dir, f)), { type: TYPES[(m[2] || "").toLowerCase()] || "application/octet-stream", id: m[1].toLowerCase(), by: "import" }); n++;
    }
    console.log(`${n} files imported, ${skipped} skipped (already here or missing)`);
  },
  "import-jobs"([file]) {
    const r = new Runner(join(cfg.dataDir, "runner.db"), {}); const j = JSON.parse(readFileSync(file, "utf8"));
    let n = 0; for (const t of j.data || j) { r.upsert({ ...t, enabled: false }); n++; }
    console.log(`${n} shifts imported, all switched off. Turn each on from the Lab once its prompt uses the lab tools.`);
  },
  "backup"([dir]) {
    mkdirSync(dir, { recursive: true }); const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const f of ["lab.db", "auth.db", "assets.db", "runner.db"]) {
      if (!existsSync(join(cfg.dataDir, f))) continue;
      const d = new DatabaseSync(join(cfg.dataDir, f)); d.exec(`VACUUM INTO '${join(dir, stamp + "-" + f).replace(/'/g, "''")}'`); d.close();
    }
    console.log(`Database copies saved in ${dir} (files in ${cfg.filesDir} are backed up by the NAS snapshots).`);
  },
};
if (!run[cmd]) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).join("\n")); process.exit(cmd ? 1 : 0); }
await run[cmd](args);
