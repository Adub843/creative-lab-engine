// GET  /api/listings?store=ed   listing template defaults (needs the console key)
// POST /api/listings            list a library design on Elevated Designs in one go (needs the key)
// Logic lives in lib/listings.mjs; this file only adapts it to Netlify. The design is read from the
// same Netlify Blobs store the image library uses, through lib/images.mjs's own read route.
import { getStore } from "@netlify/blobs";
import { handleListings, libraryReader } from "../../lib/listings.mjs";
import { netlifyHandler } from "../../lib/netlify.mjs";

const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];

export default netlifyHandler((req, ctx) => handleListings(req, {
  ...ctx,
  readImage: libraryReader({ blobs: getStore({ name: "image-library", consistency: "strong" }), env }),
}));
export const config = { path: "/api/listings" };
