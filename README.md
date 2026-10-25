# Business Console

One place to run Charleston 3D and Elevated Designs: dashboard, brand pages, a map of every connected service, and a design studio with an image library and shirt designer.

Static site (no build step) plus one Netlify function for image storage.

- `index.html`: app shell
- `assets/`: styles, data and page scripts
- `netlify/functions/images.mjs`: image library storage (Netlify Blobs), served at `/api/images`

Run locally with `npx netlify dev`, or open `index.html` directly (the library then keeps images in the browser only).

## Charleston 3D products

The **C3D Products** page (`#products`) lists every Shopify product and has a switch to put each one on charleston3d.com. Switching one on sets it active in Shopify, publishes it to the site's sales channel and calls the site's Netlify build hook; it's live in about two minutes. `netlify/functions/products.mjs` serves `/api/products`.

Set these in Netlify (Site configuration > Environment variables), never in code or chat:

- `SHOPIFY_STORE_DOMAIN`: the store's `.myshopify.com` domain
- `SHOPIFY_ADMIN_TOKEN`: Admin API token from a Shopify custom app with `read_products`, `write_products` and `write_publications`
- `SITE_PUBLICATION_ID`: the publication ID of the sales channel the site reads (the Headless or custom-app channel)
- `SITE_BUILD_HOOK`: the charleston3d-site Netlify build hook URL
- `CONSOLE_KEY`: required for switches to work once set; enter the same key in the Design Studio's key box
