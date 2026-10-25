# Business Console

One place to run Charleston 3D and Elevated Designs: dashboard, brand pages, a map of every connected service, product publishing and insights for both Shopify stores, and a design studio with an image library and shirt designer.

## How it all fits together

- **Charleston 3D** (charleston3d.com): everything 3D printing. Its own hand-coded Shopify theme in `Adub843/charleston3d-site` (branch `claude/shopify-theme`), Charleston 3D only. Products show a "Name to print" field only when this console marks them **Customizable** (the `customizable` tag); free custom requests come in through the theme's Custom request page as $0 orders.
- **Elevated Designs** (theelevateddesignsllc.com): apparel and prints. Its own Shopify store and its own theme, to live in `Adub843/elevated-designs-site` (not created yet). This console lists designs on it in one click (Blank x Color x Size).
- **The shirt app** (built separately) takes customers' shirt designs; its orders pay through the Elevated Designs Shopify checkout.
- **This console** is private (behind `CONSOLE_KEY`): one page per brand, one image library, publishing and Insights. The two brands never share a request: every call names its store (`c3d` or `ed`) and the server refuses brand-specific actions on the other store.

Neither store site is hosted on Netlify or has a build step: products, prices and checkout come live from Shopify, and every payment goes through Shopify checkout. Only this console runs on Netlify. The Elevated Designs **design app** (charlestonprintdesigns.netlify.app) is an older tool for designs and listings, not the store.

## Code

Static site plus small serverless functions. The only build step copies `index.html` and `assets/` into `dist/`, which is all that gets published, so `lib/`, `scripts/` and the rest of the repo are never downloadable from the site.

- `index.html`: app shell
- `assets/`: styles, data and page scripts (`products.js`, `insights.js`, `studio.js`; `api.js` holds the shared store switcher, console key and API calls). `data.js` is the one list of brands, services, quick links' sites and the cleanup list.
- `lib/shopify.mjs`, `lib/insights.mjs`, `lib/images.mjs`: the API logic as plain functions with no hosting code. `lib/netlify.mjs` is the only Netlify glue.
- `lib/listings.mjs`: one-click Elevated Designs listings; `assets/listing.js` builds the listing copy (title, description, SEO, tags) and `assets/list-design.js` is the panel and sheet.
- `netlify/functions/products.mjs` (`/api/products`), `insights.mjs` (`/api/insights`), `images.mjs` (`/api/images`, image library in Netlify Blobs), `listings.mjs` (`/api/listings`)

Run locally with `npm run dev` (`netlify dev`, needs the Netlify CLI), or serve the folder with any static server such as `python3 -m http.server` (the library then keeps images in the browser only, and Products and Insights say the API isn't running). Opening `index.html` straight from disk doesn't work: browsers block its module scripts on `file://`.

## Products

`#products` lists every product in the chosen store (Charleston 3D or Elevated Designs) with a **Live** switch. Switching one on sets it to Active and publishes it to the store's Online Store channel, so it's on the site straight away; switching it off unpublishes it from the Online Store (it stays in Shopify). Each row links to the live product page and to the product in Shopify admin. If `INDEXNOW_KEY` is set, each change is also sent to IndexNow (Bing and others) so search engines pick it up sooner.

If making a product Active works but publishing to the Online Store doesn't, the row shows what Shopify now has (Active, not on the site) with Shopify's reason, instead of flipping back to Draft.

The two brands are kept apart on the server: a store id must be `c3d` or `ed`, Customizable is refused for Elevated Designs, and listings are refused for Charleston 3D.

### Charleston 3D: Customizable

Each Charleston 3D product also has a **Customizable** switch. Some 3D files can't be personalized, so this is chosen per product: on adds the Shopify tag `customizable`, off removes it (any capitalisation, and the older `personalized` / `personalised` tags the theme also honours, which the console shows as on). The Charleston 3D theme shows the "Name to print" field only on products with that tag. Elevated Designs products have no such switch.

### Elevated Designs: List a design

On the Elevated Designs Products page (also **List a design** on the Elevated Designs page), every PNG, JPEG, WebP or GIF in the online image library has an **Add to Elevated Designs** button. It opens a sheet filled in from the listing template and the blank catalog (`data/blanks.json`):

- **Shirts to offer**: every blank in the catalog, grouped by type (T-shirts, long sleeve, hoodies...), each with its tier, brand, style, fit, fabric and lowest price. Ticking a shirt shows its colors. By default the cheapest tee in each tier (value, standard, premium) is ticked, in black, white, navy and a grey/heather where it has them, otherwise its first 4 colors.
- **Markup**: dollars added to every catalog price (0 uses the catalog; -10 to 100). Each size's price comes from the blank's `prices` in the catalog. Those prices are still placeholders in the catalog (`pricing.placeholder`), and the sheet says so.
- A live **variant counter** (shirts x colors x sizes). It turns amber over 100 and red over 2,048, Shopify's limit per product, where List it is switched off. The server checks the same limit and rejects unknown shirts, colors or sizes.
- Under **More**: sizes (XS to 5XL; a shirt only gets the sizes it comes in), product type, tags, description and SEO title (60 characters at most) and description (155 at most). The description and SEO follow the shirts you pick until you edit them by hand.

**List it** then, in one go:

1. looks for a product tagged `design:<image key>`, so a design is never listed twice (an existing one is returned with its link, and put back on the site if it was off);
2. reads the image from the library and uploads it to Shopify (`stagedUploadsCreate`, then a POST to the staged address);
3. creates the product with `productSet`: vendor Elevated Designs, Active, three options **Blank** ("Gildan 5000 – Heavy Cotton Tee"), **Color** and **Size**, one variant per shirt, color and size with SKU `<design key>-<blank id>-<color slug>-<size>` (for example `palmetto-moon-gildan-5000-sport-grey-2XL`), stock not tracked (printed to order), description, SEO and tags;
4. publishes it to the Online Store and pings IndexNow;
5. shows the live link (`https://theelevateddesignsllc.com/products/<handle>`) and the Shopify admin link.

The description has a short intro, a **Choose your shirt** list of the offered blanks with their fabric, weight and fit (from the catalog), the size range, and says the shirt is printed to order and ships in `ED_HANDLING_DAYS` business days. It makes no other claims. SVG designs can't be Shopify product photos; export them as PNG first.

**Big listings.** Netlify functions stop after 10 seconds. Up to 100 variants, `productSet` runs synchronously (one call, the product comes back). Above 100 it runs with `synchronous: false`: the console polls `productOperation` for about 4 seconds; if Shopify is still working, it answers 202 with the operation id and the sheet shows **Check again**, which polls the same operation and finishes (publish, IndexNow) without making a second product. Stores without Shopify's extended variants allow 100 variants per product, so the sheet warns above 100: if Shopify refuses, offer fewer shirts, colors or sizes.

### The blank catalog (`data/blanks.json`)

`data/blanks.json` is a copy of the shared catalog the shirt app keeps at `/mnt/project-files/elevated-designs/blanks.json` (its source of truth). The console reads its own copy (bundled into the functions by `included_files` in `netlify.toml`), so it never depends on that folder at run time. To refresh it after the catalog changes:

```sh
cp /mnt/project-files/elevated-designs/blanks.json data/blanks.json
sha256sum /mnt/project-files/elevated-designs/blanks.json data/blanks.json   # should match
npm test && npm run test:ui                                                  # the tests check the catalog is well formed
```

Then commit and deploy. Listings already in Shopify keep the prices and blanks they were made with.

## Insights

`#insights` shows, per store: revenue, orders and average order for the last 7, 30 and 90 days against the period before, daily revenue, repeat customer rate, online store sessions and conversion, best sellers, products gaining or losing momentum, a 30-day revenue forecast and plain-English next steps.

The forecast fits a straight line through the last 12 weeks of revenue (least squares) and continues it for 30 days; the range around it is the usual week-to-week wobble. With under 4 weeks of sales it repeats the last 30 days instead. When the next 30 days reach into November or December it says so, because holiday sales normally beat the trend. Next steps don't call sales up or down with under 5 orders in the previous 30 days, or say one product carries the store with under 10 orders.

Cancelled, test and $0 orders are left out ($0 orders are Charleston 3D's free custom print requests, which are quote requests, not sales).

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
| `CONSOLE_KEY` | **Required.** A long random password, at least 16 characters (there's no lockout on wrong guesses, so make it long). The product list, publishing, the image library list, uploads and Insights are refused until it's set; enter the same value when the console asks for it (kept for that browser tab only). |
| `ED_HANDLING_DAYS` | Optional. Business days to ship, used in new Elevated Designs listings, like `5-7` (the default) or `3-5`. |
| `INDEXNOW_KEY` | Optional. An IndexNow key, used for both stores. In each store add a page with handle `indexnow-key` and template `page.indexnow`, paste the same key in Theme settings > Search and AI, and add a URL redirect from `/<key>.txt` to `/pages/indexnow-key`. Pings use `keyLocation=https://<site>/<key>.txt`, because a key under `/pages/` would only cover `/pages/` URLs, not products. |

### Admin API access scopes

Give each store's app these scopes:

- `read_products`, `write_products`: list products, make them Active, add or remove the `customizable` tag (`tagsAdd`/`tagsRemove`), and create listings (`productSet` and the image upload through `stagedUploadsCreate`)
- `read_publications`, `write_publications`: find the Online Store channel and publish to it
- `read_orders`: sales, best sellers and the forecast
- `read_reports`: sessions and conversion (ShopifyQL)

If Elevated Designs answers a listing with "access denied" for the product image, also add `write_files` (the image becomes a Shopify file); Shopify's docs list only `write_products` for `productSet` and staged uploads.

Optional: `read_customers` (repeat customer rate across a customer's whole history; without it, repeats are counted within the period) and `read_all_orders` (orders older than 60 days, needed for the 90-day comparisons).

### Getting the credentials (do this in each store)

**If the store already has a custom app made in the admin**: in Shopify admin, go to **Settings > Apps and sales channels > Develop apps**, open the app, choose **Configuration**, edit **Admin API integration**, tick the scopes above and save. Then on **API credentials**, install or reinstall the app. If the Admin API access token is still shown, copy it straight into `C3D_ADMIN_TOKEN` or `ED_ADMIN_TOKEN` in Netlify; if not, use the option on that page to generate a new one. The token is only shown once.

**If there is no app yet**: Shopify no longer lets you create new custom apps in the admin's Develop apps page, so create one in the **Dev Dashboard** instead (from the Develop apps page, or dev.shopify.com): create an app, add the scopes above to its version, release it, and install it on the store. Then in **App settings**, copy the **Client ID** and **Client secret** into `C3D_CLIENT_ID` / `C3D_CLIENT_SECRET` (or the `ED_` pair). The console swaps them for a 24-hour access token by itself.

After saving the variables, redeploy the console once so the functions pick them up.

## Tests

Run `npm install` once first (the API tests use `graphql` as a dev dependency).

- `npm run check`: syntax check of every script
- `npm test` (`node scripts/test-api.mjs`): the API with Shopify mocked (listing, publishing, unpublishing, customizable, one-click listings, bad input, keys, missing settings, Shopify errors, IndexNow failures, insights maths). Every GraphQL query and mutation the mock receives, and its variables, is validated against the Admin API 2025-10 schema in `scripts/schema/` (the introspection file from `@shopify/dev-mcp@1.5.0`).
- `npm run test:ui` (`NODE_PATH=$(npm root -g) node scripts/test-ui.cjs`): Products and Insights in a real browser with `/api/*` mocked; needs Playwright (installed globally or in the project) and python3. Set `SCREENS=<folder>` to save screenshots.

### API

| Route | What it does |
| --- | --- |
| `GET /api/products?store=c3d\|ed` | Every product, with `live` and (Charleston 3D) `customizable` |
| `POST /api/products {store, id, live}` | Put a product on the site or take it off |
| `POST /api/products {store: "c3d", id, customizable}` | Add or remove the `customizable` tag (Charleston 3D only) |
| `GET /api/listings?store=ed` | Listing template: defaults, limits and the blank catalog (without costs or suppliers) |
| `POST /api/listings {store: "ed", imageKey, title, blanks: [{id, colors}], sizes, markup, productType, tags, descriptionHtml, seoTitle, seoDescription}` | List a library design on Elevated Designs (201 new, 200 already listed, 202 `{pending, operationId}` while Shopify is still making a big one) |
| `POST /api/listings {store: "ed", imageKey, ..., operationId}` | Finish a pending listing (same body plus the operation id from the 202) |
| `GET /api/insights?store=c3d\|ed&days=90` | Insights |
| `/api/images` | Image library (see `lib/images.mjs`) |

All of them need the console key (`x-console-key`), except fetching an image file by its key. A listing makes several Shopify calls including a 6 MB upload at most; on Netlify's default 10-second function limit a very large image may time out. If that happens after the product was made, List it again finds it by its `design:` tag and finishes publishing it instead of making a second one.

## Moving off Netlify later

`lib/` has no Netlify code. A new host needs a small adapter like `lib/netlify.mjs` that passes `{ method, query, header(name), text() }` and `{ env(name), fetch }` to `handleProducts` / `handleInsights` and sends back `{ status, body }` as JSON. The image library (`lib/images.mjs`) takes any blob store with the same few methods; `netlify/functions/images.mjs` passes it Netlify Blobs.
