# Business Console

One place to run Charleston 3D and Elevated Designs: dashboard, brand pages, a map of every connected service, product publishing and insights for both Shopify stores, and a design studio with an image library and shirt designer.

Static site (no build step) plus small serverless functions.

- `index.html`: app shell
- `assets/`: styles, data and page scripts (`products.js`, `insights.js`, `studio.js`; `api.js` holds the shared store switcher, console key and API calls)
- `lib/shopify.mjs`, `lib/insights.mjs`: the API logic as plain functions with no hosting code. `lib/netlify.mjs` is the only Netlify glue.
- `netlify/functions/products.mjs` (`/api/products`), `insights.mjs` (`/api/insights`), `images.mjs` (`/api/images`, image library in Netlify Blobs)

Run locally with `npx netlify dev`, or open `index.html` directly (the library then keeps images in the browser only, and Products and Insights say the API isn't running).

## The store sites

charleston3d.com and theelevateddesignsllc.com are **Shopify themes** on their own Shopify stores. They are not hosted on Netlify and have no build step: products, prices and checkout come live from Shopify. The theme code is in `Adub843/charleston3d-site` (branch `claude/shopify-theme`), one theme with a preset per store.

The Elevated Designs **design app** (charlestonprintdesigns.netlify.app) is a separate tool for designs and listings, not the store.

## Products

`#products` lists every product in the chosen store (Charleston 3D or Elevated Designs) with a **Live** switch. Switching one on sets it to Active and publishes it to the store's Online Store channel, so it's on the site straight away; switching it off unpublishes it from the Online Store (it stays in Shopify). Each row links to the live product page and to the product in Shopify admin. If `INDEXNOW_KEY` is set, each change is also sent to IndexNow (Bing and others) so search engines pick it up sooner.

## Insights

`#insights` shows, per store: revenue, orders and average order for the last 7, 30 and 90 days against the period before, daily revenue, repeat customer rate, online store sessions and conversion, best sellers, products gaining or losing momentum, a 30-day revenue forecast and plain-English next steps.

The forecast fits a straight line through the last 12 weeks of revenue (least squares) and continues it for 30 days; the range around it is the usual week-to-week wobble. With under 4 weeks of sales it repeats the last 30 days instead. When the next 30 days reach into November or December it says so, because holiday sales normally beat the trend.

If a scope is missing, that part of the page says which scope to add and the rest still works.

## Connect a store

Set these in Netlify (Site configuration > Environment variables). Never put them in code, in chat, or in the theme.

| Variable | What it is |
| --- | --- |
| `C3D_SHOPIFY_DOMAIN` | Charleston 3D's `something.myshopify.com` domain (not charleston3d.com) |
| `C3D_ADMIN_TOKEN` | Admin API access token for Charleston 3D (see below), **or** `C3D_CLIENT_ID` + `C3D_CLIENT_SECRET` |
| `ED_SHOPIFY_DOMAIN` | Elevated Designs' `something.myshopify.com` domain |
| `ED_ADMIN_TOKEN` | Admin API access token for Elevated Designs, **or** `ED_CLIENT_ID` + `ED_CLIENT_SECRET` |
| `C3D_SITE_URL` | Optional. Public site address, default `https://charleston3d.com` |
| `ED_SITE_URL` | Optional. Public site address, default `https://theelevateddesignsllc.com` |
| `CONSOLE_KEY` | **Required.** A long random password. Publishing, uploads and Insights are refused until it's set; enter the same value when the console asks for it (kept for that browser tab only). |
| `INDEXNOW_KEY` | Optional. An IndexNow key; the theme must serve it at `https://<site>/pages/indexnow-key`. |

### Admin API access scopes

Give each store's app these scopes:

- `read_products`, `write_products`: list products and make them Active
- `read_publications`, `write_publications`: find the Online Store channel and publish to it
- `read_orders`: sales, best sellers and the forecast
- `read_reports`: sessions and conversion (ShopifyQL)

Optional: `read_customers` (repeat customer rate across a customer's whole history; without it, repeats are counted within the period) and `read_all_orders` (orders older than 60 days, needed for the 90-day comparisons).

### Getting the credentials (do this in each store)

**If the store already has a custom app made in the admin**: in Shopify admin, go to **Settings > Apps and sales channels > Develop apps**, open the app, choose **Configuration**, edit **Admin API integration**, tick the scopes above and save. Then on **API credentials**, install or reinstall the app. If the Admin API access token is still shown, copy it straight into `C3D_ADMIN_TOKEN` or `ED_ADMIN_TOKEN` in Netlify; if not, use the option on that page to generate a new one. The token is only shown once.

**If there is no app yet**: Shopify no longer lets you create new custom apps in the admin's Develop apps page, so create one in the **Dev Dashboard** instead (from the Develop apps page, or dev.shopify.com): create an app, add the scopes above to its version, release it, and install it on the store. Then in **App settings**, copy the **Client ID** and **Client secret** into `C3D_CLIENT_ID` / `C3D_CLIENT_SECRET` (or the `ED_` pair). The console swaps them for a 24-hour access token by itself.

After saving the variables, redeploy the console once so the functions pick them up.

## Tests

- `npm run check`: syntax check of every script
- `npm test` (`node scripts/test-api.mjs`): the API with Shopify mocked (listing, publishing, unpublishing, bad input, keys, missing settings, Shopify errors, IndexNow failures, insights maths)
- `npm run test:ui` (`NODE_PATH=$(npm root -g) node scripts/test-ui.cjs`): Products and Insights in a real browser with `/api/*` mocked; needs Playwright and python3. Set `SCREENS=<folder>` to save screenshots.

## Moving off Netlify later

`lib/` has no Netlify code. A new host needs a small adapter like `lib/netlify.mjs` that passes `{ method, query, header(name), text() }` and `{ env(name), fetch }` to `handleProducts` / `handleInsights` and sends back `{ status, body }` as JSON. The image library (`images.mjs`) still uses Netlify Blobs and would need a new store.
