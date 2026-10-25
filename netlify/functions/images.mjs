// Image library storage for the Design Studio (see lib/images.mjs for the routes and rules).
// This file only adapts it to Netlify: Netlify Blobs for storage, Netlify env for CONSOLE_KEY.
import { getStore } from "@netlify/blobs";
import { handleImages } from "../../lib/images.mjs";

export default (req) => handleImages(req, {
  blobs: getStore({ name: "image-library", consistency: "strong" }),
  env: (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k],
});

export const config = { path: ["/api/images", "/api/images/*"] };
