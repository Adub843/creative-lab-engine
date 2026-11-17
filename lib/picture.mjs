// GET /api/picture?u=<picture address>&w=<width>   key
// A picture for the Creative Lab Studios console, which can't load pictures from other sites itself.
// Any public https picture is fetched (Shopify, Kittl, Printful, a supplier...), so a linked picture always shows.
// Never private addresses: no IP numbers, localhost, .local/.internal names, odd ports or logins in the address.
// Only real raster pictures come back (no SVG, which can carry script), 3 MB at most. Shopify's CDN resizes to w.
import { HttpError, requireKey } from "./shopify.mjs";

const MAX_BYTES = 3 * 1024 * 1024;
const SHOPIFY = (h) => h === "cdn.shopify.com" || /^(www\.)?(elevatedshirts|charleston3d)\.com$/.test(h) || h.endsWith(".myshopify.com");
export const PUBLIC_PICTURE = (u) =>
  u.protocol === "https:" && !u.port && !u.username && !u.password &&
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && !/^[\d.]+$/.test(u.hostname) &&
  !/(^|\.)(localhost|local|internal|lan|home|arpa|test|invalid)$/i.test(u.hostname);

export async function handlePicture(req, { env, fetch }) {
  if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
  requireKey(req, env, "Pictures");
  let u;
  try { u = new URL(req.query.get("u") ?? ""); } catch { throw new HttpError(400, "bad_input", "u must be a picture address."); }
  if (!PUBLIC_PICTURE(u)) throw new HttpError(400, "bad_input", "Only public https picture addresses can be shown.");
  const w = Math.round(Number(req.query.get("w")));
  if (SHOPIFY(u.hostname) && w >= 40 && w <= 2048) u.searchParams.set("width", String(w));
  const res = await fetch(u.toString(), { headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8", "user-agent": "CreativeLabStudios/1.0 (picture preview)" } }).catch(() => null);
  if (!res || !res.ok) throw new HttpError(404, "image_not_found", "That site didn't return the picture.");
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("image/") || type.includes("svg")) throw new HttpError(415, "bad_image_type", "That address isn't a picture.");
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new HttpError(413, "too_large", "That picture is too large to show.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "too_large", "That picture is too large to show.");
  return new Response(bytes, { status: 200, headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
