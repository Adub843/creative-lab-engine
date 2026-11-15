// The Lab's file store: what the claude.ai `assets` capability did (upload, list, delete, /_blob/<id> links),
// but on the Synology with no 1 GB or 20 MB caps. Files stream in and out in pieces, so videos seek and
// big 3D models never sit in memory.
import { DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream, mkdirSync, statSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export const ID = /^[0-9a-f]{32}$/;
const SAFE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/(pdf|json|zip|octet-stream|vnd\.[a-z0-9.+-]+|x-(zip-compressed|7z-compressed|tar|gzip|blender|rar-compressed|photoshop|subrip|font-[a-z0-9]+|ndjson)|sla|step|iges|xml|gzip|postscript|illustrator)|model\/[a-z0-9.+-]+|font\/[a-z0-9.+-]+|text\/(plain|csv|markdown|css|javascript|xml)|text\/html)$/;

export class Assets {
  constructor(dir, dbFile, { maxBytes = 50 * 2 ** 30 } = {}) {
    this.dir = dir; this.maxBytes = maxBytes;
    mkdirSync(join(dir, "tmp"), { recursive: true });
    this.sql = new DatabaseSync(dbFile);
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL, by TEXT, name TEXT);`);
  }
  close() { this.sql.close(); }
  file(id) { return join(this.dir, id.slice(0, 2), id); }
  meta(id) { return ID.test(id) ? this.sql.prepare("SELECT * FROM assets WHERE id=?").get(id) || null : null; }

  // Streams a request body to disk; resolves {id,url,sizeBytes,contentType}.
  async put(stream, { type, by, name, id } = {}) {
    let ct = String(type || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!SAFE_TYPES.test(ct)) throw Object.assign(new Error(`files of type ${ct} aren't accepted`), { code: "unsupported_type" });
    id = id && ID.test(id) ? id : randomBytes(16).toString("hex");
    const tmp = join(this.dir, "tmp", id + "." + process.pid);
    let size = 0;
    const max = this.maxBytes;
    const counter = async function* (src) { for await (const chunk of src) { size += chunk.length; if (size > max) throw Object.assign(new Error("file is too large"), { code: "too_large" }); yield chunk; } };
    try { await pipeline(stream, counter, createWriteStream(tmp)); }
    catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
    mkdirSync(join(this.dir, id.slice(0, 2)), { recursive: true });
    renameSync(tmp, this.file(id));
    this.sql.prepare("INSERT OR REPLACE INTO assets VALUES(?,?,?,?,?,?)").run(id, ct, size, Date.now(), by || null, name || null);
    return { id, url: "/_blob/" + id, sizeBytes: size, contentType: ct };
  }

  list() {
    const assets = this.sql.prepare("SELECT id, type, size, created FROM assets ORDER BY created DESC").all()
      .map(a => ({ id: a.id, url: "/_blob/" + a.id, contentType: a.type, sizeBytes: a.size, createdAt: new Date(a.created).toISOString() }));
    const bytes = assets.reduce((n, a) => n + a.sizeBytes, 0);
    // usage keeps the old shape; the caps are now the NAS's size, reported as very large
    return { assets, usage: { files: assets.length, bytes, maxFiles: 10_000_000, maxBytes: this.maxBytes * 1000 } };
  }

  delete(id) {
    if (!ID.test(id) || !this.meta(id)) return { deleted: false };
    try { unlinkSync(this.file(id)); } catch {}
    this.sql.prepare("DELETE FROM assets WHERE id=?").run(id);
    return { deleted: true };
  }

  // Serves /_blob/<id> with Range support (videos seek, big models download in parts).
  serve(id, req, res) {
    const m = this.meta(id);
    if (!m || !existsSync(this.file(id))) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    sendRanged(this.file(id), m.type, req, res, "private, max-age=31536000, immutable");
  }
}

// Sends a file with Range support and headers that stop an uploaded SVG or HTML file running script in the Lab.
export function sendRanged(file, type, req, res, cache = "private, no-cache") {
  const size = statSync(file).size;
  const headers = {
    "content-type": type, "accept-ranges": "bytes", "cache-control": cache, "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
  };
  if (/^(text\/html|image\/svg\+xml)$/.test(type) && req.headers["sec-fetch-dest"] === "document") headers["content-disposition"] = "attachment";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? +range[1] : Math.max(0, size - +range[2]);
    const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}
