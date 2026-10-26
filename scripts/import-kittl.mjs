// Copies Kittl images into the console's image library so the shirt app can show them.
// Usage: CONSOLE_URL=https://<console-worker-address> CONSOLE_KEY=... node scripts/import-kittl.mjs <manifest.json> [category]
// The manifest is a JSON array of { uploadId, mimeType, downloadUrl } (as listed from a Kittl folder).
// Each image is saved public, with x-source "kittl" and the name "kittl-<uploadId>", and images whose
// name is already in the library are skipped, so it is safe to run again after adding images in Kittl.
import { readFile } from "node:fs/promises";

const [manifestPath, category = "Clipped Images"] = process.argv.slice(2);
const base = (process.env.CONSOLE_URL ?? "").replace(/\/+$/, "");
const key = process.env.CONSOLE_KEY ?? "";
if (!manifestPath || !base || !key) {
  console.error("Usage: CONSOLE_URL=... CONSOLE_KEY=... node scripts/import-kittl.mjs <manifest.json> [category]");
  process.exit(1);
}

const MAX_BYTES = 20 * 1024 * 1024; // the library's upload limit (lib/images.mjs)
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const api = `${base}/api/images`;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const listed = await fetch(api, { headers: { "x-console-key": key } });
if (!listed.ok) throw new Error(`Listing the library failed: ${listed.status} ${await listed.text()}`);
const have = new Set(((await listed.json()).items ?? []).map((item) => item.name));

const todo = manifest.filter((img) => !have.has(`kittl-${img.uploadId}`));
console.log(`${manifest.length} in manifest, ${manifest.length - todo.length} already imported, ${todo.length} to copy`);

let done = 0;
const failed = [];
async function copy(img) {
  const name = `kittl-${img.uploadId}`;
  try {
    if (!TYPES.has(img.mimeType)) throw new Error(`unsupported type ${img.mimeType}`);
    const file = await fetch(img.downloadUrl);
    if (!file.ok) throw new Error(`download ${file.status}`);
    const body = await file.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new Error(`${(body.byteLength / 1048576).toFixed(1)} MB is over the 20 MB limit`);
    const saved = await fetch(api, {
      method: "POST",
      headers: {
        "x-console-key": key, "content-type": img.mimeType, "x-filename": name,
        "x-public": "1", "x-category": category, "x-source": "kittl",
        "x-kind": img.mimeType === "image/svg+xml" ? "svg" : "png",
      },
      body,
    });
    if (!saved.ok) throw new Error(`upload ${saved.status} ${(await saved.text()).slice(0, 120)}`);
    done++;
  } catch (err) {
    failed.push(`${name}: ${err.message}`);
  }
}

// Four at a time keeps it quick without hammering either side.
for (let i = 0; i < todo.length; i += 4) {
  await Promise.all(todo.slice(i, i + 4).map(copy));
  if ((i / 4) % 25 === 0) console.log(`${Math.min(i + 4, todo.length)}/${todo.length}`);
}
console.log(`Copied ${done}, failed ${failed.length}`);
for (const line of failed) console.log(`  ${line}`);
process.exitCode = failed.length ? 1 : 0;
