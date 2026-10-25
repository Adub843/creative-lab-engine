// GET  /api/products?store=c3d|ed   every product with whether it's live on the store's Shopify site
// POST /api/products {store,id,live} puts a product on the site (active + Online Store) or takes it off
// POST /api/products {store:'c3d',id,customizable} adds or removes the customizable tag (Charleston 3D only)
// Logic lives in lib/shopify.mjs; this file only adapts it to Netlify.
import { handleProducts } from "../../lib/shopify.mjs";
import { netlifyHandler } from "../../lib/netlify.mjs";

export default netlifyHandler(handleProducts);
export const config = { path: "/api/products" };
