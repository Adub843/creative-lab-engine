// Image library storage for the Design Studio.
// GET    /api/images        list every saved image (metadata only)
// GET    /api/images/:key   the image file itself
// POST   /api/images        save one image (raw body, filename in x-filename)
// DELETE /api/images/:key   remove one image
// Writes require the x-console-key header to match the CONSOLE_KEY env var when it is set.
import { getStore } from "@netlify/blobs";

const MAX_BYTES = 6 * 1024 * 1024; // Netlify function request bodies cap out around 6 MB
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const canWrite = (req) => {
  const key = Netlify.env.get("CONSOLE_KEY");
  return !key || req.headers.get("x-console-key") === key;
};

export default async (req) => {
  const store = getStore({ name: "image-library", consistency: "strong" });
  const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/images\/?/, ""));

  if (req.method === "GET" && !key) {
    const { blobs } = await store.list();
    const items = await Promise.all(
      blobs.map(async ({ key }) => ({ key, ...((await store.getMetadata(key))?.metadata ?? {}) }))
    );
    items.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
    return json({ items });
  }

  if (req.method === "GET") {
    const found = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!found) return json({ error: "Image not found" }, 404);
    return new Response(found.data, {
      headers: {
        "content-type": found.metadata?.type ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (!canWrite(req)) return json({ error: "Wrong or missing console key" }, 401);

  if (req.method === "POST") {
    const type = (req.headers.get("content-type") ?? "").split(";")[0];
    if (!TYPES.has(type)) return json({ error: `Unsupported file type: ${type || "unknown"}` }, 415);
    const body = await req.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return json({ error: "Image is larger than 6 MB" }, 413);
    const name = (req.headers.get("x-filename") ?? "image").slice(0, 200);
    const tags = (req.headers.get("x-tags") ?? "").slice(0, 200);
    const newKey = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const metadata = { name, type, size: body.byteLength, tags, added: Date.now() };
    await store.set(newKey, body, { metadata });
    return json({ item: { key: newKey, ...metadata } }, 201);
  }

  if (req.method === "DELETE" && key) {
    await store.delete(key);
    return json({ deleted: key });
  }

  return json({ error: "Not supported" }, 405);
};

export const config = { path: ["/api/images", "/api/images/*"] };
