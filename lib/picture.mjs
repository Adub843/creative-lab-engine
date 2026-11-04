// GET /api/picture?u=<Shopify CDN picture>&w=<width>   key
// A product picture for the Creative Lab Studios console, which can't load pictures from other sites itself.
// Only Shopify's own picture addresses are fetched (never any other site), resized by Shopify's CDN.
import { HttpError, requireKey } from "./shopify.mjs";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = (u) => u.protocol === "https:" && (u.hostname === "cdn.shopify.com" || /^(www\.)?(elevatedshirts|charleston3d)\.com$/.test(u.hostname) && u.pathname.startsWith("/cdn/shop/"));

export async function handlePicture(req, { env, fetch }) {
  if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
  requireKey(req, env, "Pictures");
  let u;
  try { u = new URL(req.query.get("u") ?? ""); } catch { throw new HttpError(400, "bad_input", "u must be a picture address."); }
  if (!ALLOWED(u)) throw new HttpError(400, "bad_input", "Only Shopify picture addresses can be shown.");
  const w = Math.round(Number(req.query.get("w")));
  if (w >= 40 && w <= 2048) u.searchParams.set("width", String(w));
  const res = await fetch(u.toString(), { headers: { accept: "image/*" } }).catch(() => null);
  if (!res || !res.ok) throw new HttpError(404, "image_not_found", "Shopify didn't return that picture.");
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new HttpError(415, "bad_image_type", "That address isn't a picture.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "too_large", "That picture is too large to show.");
  return new Response(bytes, { status: 200, headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
