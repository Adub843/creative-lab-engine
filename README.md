# Business Console

One place to run Charleston 3D and Elevated Designs: dashboard, brand pages, a map of every connected service, product publishing and insights for both Shopify stores, and a design studio with an image library and shirt designer.

## How it all fits together

- **Charleston 3D** (charleston3d.com): everything 3D printing. Its own hand-coded Shopify theme in `Adub843/charleston3d-site` (branch `claude/shopify-theme`), Charleston 3D only. Products show a "Name to print" field only when this console marks them **Customizable** (the `customizable` tag); free custom requests come in through the theme's Custom request page as $0 orders.
- **Elevated Designs** (elevatedshirts.com): apparel and prints. Its own Shopify store and its own theme, in `Adub843/elevated-designs-site`. This console lists designs on it in one click (Blank x Color x Size).
- **The shirt app** (built separately) takes customers' shirt designs; its orders pay through the Elevated Designs Shopify checkout.
- **This console** is private (behind `CONSOLE_KEY`): one page per brand, one image library, publishing and Insights. The two brands never share a request: every call names its store (`c3d` or `ed`) and the server refuses brand-specific actions on the other store.

Neither store site has its own hosting or a build step: products, prices and checkout come live from Shopify, and every payment goes through Shopify checkout. This console runs on **Cloudflare Workers** (free plan): see [Put the console online (Cloudflare)](#put-the-console-online-cloudflare). The older Elevated Designs **design app** (on the Service Map) is a tool for designs and listings, not the store.

## Code

One Cloudflare Worker serves both the app's files and its API. The only build step (`scripts/build.mjs`, run by wrangler before `dev` and `deploy`) copies `index.html` and `assets/` into `dist/`, which is all that is served as files, so `lib/`, `scripts/`, `worker/`, `data/` and the rest of the repo are never downloadable from the site.

- `index.html`: app shell
- `assets/`: styles, data and page scripts (`products.js`, `insights.js`, `studio.js`; `api.js` holds the shared store switcher, console key and API calls). `data.js` is the one list of brands, services, quick links' sites and the cleanup list.
- `lib/shopify.mjs`, `lib/insights.mjs`, `lib/images.mjs`: the API logic as plain functions with no hosting code. `lib/kv-store.mjs` stores the image library in Workers KV.
- `lib/listings.mjs`: one-click Elevated Designs listings; `assets/listing.js` builds the listing copy (title, description, SEO, tags) and `assets/list-design.js` is the panel and sheet.
- `worker/index.mjs` (entry point) and `worker/app.mjs`: the Worker. It sends `/api/products`, `/api/insights`, `/api/listings`, `/api/marketing` and `/api/images` (and `/api/images/<key>`) to the handlers in `lib/`, reads settings from the Worker's secrets, and serves every other path from `dist/` with the security headers (CSP, no framing, nosniff).
- `wrangler.toml`: the Worker's settings (files in `dist/`, the `IMAGES` and `MARKETING` KV namespaces, the daily 11:00 UTC health check, `nodejs_compat`). No secrets in it.

Run locally with `npm run dev` (`wrangler dev`, installed by `npm install`): the console opens at http://localhost:8787 with its own local image library on your computer. For Products, Insights and listings locally, put the same settings in a `.dev.vars` file (one `NAME=value` per line; it is git-ignored, never commit it). Or serve the folder with any static server such as `python3 -m http.server` (the library then keeps images in the browser only, and Products and Insights say the API isn't running). Opening `index.html` straight from disk doesn't work: browsers block its module scripts on `file://`.

## Products

`#products` lists every product in the chosen store (Charleston 3D or Elevated Designs) with a **Live** switch. Switching one on sets it to Active and publishes it to the store's Online Store channel, so it's on the site straight away; switching it off unpublishes it from the Online Store (it stays in Shopify). Each row links to the live product page and to the product in Shopify admin. If the store's IndexNow key (`C3D_INDEXNOW_KEY` or `ED_INDEXNOW_KEY`, or the shared `INDEXNOW_KEY`) is set, each change is also sent to IndexNow (Bing and others) so search engines pick it up sooner.

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
5. shows the live link (`https://elevatedshirts.com/products/<handle>`) and the Shopify admin link.

The description has a short intro, a **Choose your shirt** list of the offered blanks with their fabric, weight and fit (from the catalog), the size range, and says the shirt is printed to order and ships in `ED_HANDLING_DAYS` business days. It makes no other claims. SVG designs can't be Shopify product photos; export them as PNG first.

**Big listings.** So the page never waits long, up to 100 variants, `productSet` runs synchronously (one call, the product comes back). Above 100 it runs with `synchronous: false`: the console polls `productOperation` for about 4 seconds; if Shopify is still working, it answers 202 with the operation id and the sheet shows **Check again**, which polls the same operation and finishes (publish, IndexNow) without making a second product. Stores without Shopify's extended variants allow 100 variants per product, so the sheet warns above 100: if Shopify refuses, offer fewer shirts, colors or sizes.

### The blank catalog (`data/blanks.json`)

`data/blanks.json` is a copy of the shared catalog the shirt app keeps at `/mnt/project-files/elevated-designs/blanks.json` (its source of truth). The console reads its own copy (bundled into the Worker when it is deployed), so it never depends on that folder at run time. To refresh it after the catalog changes:

```sh
cp /mnt/project-files/elevated-designs/blanks.json data/blanks.json
sha256sum /mnt/project-files/elevated-designs/blanks.json data/blanks.json   # should match
npm test && npm run test:ui                                                  # the tests check the catalog is well formed
```

Then commit and deploy (`npm run deploy`, or push to `main` if the GitHub Action is set up). Listings already in Shopify keep the prices and blanks they were made with.

## Insights

`#insights` shows, per store: revenue, orders and average order for the last 7, 30 and 90 days against the period before, daily revenue, repeat customer rate, online store sessions and conversion, best sellers, products gaining or losing momentum, a 30-day revenue forecast and plain-English next steps.

The forecast fits a straight line through the last 12 weeks of revenue (least squares) and continues it for 30 days; the range around it is the usual week-to-week wobble. With under 4 weeks of sales it repeats the last 30 days instead. When the next 30 days reach into November or December it says so, because holiday sales normally beat the trend. Next steps don't call sales up or down with under 5 orders in the previous 30 days, or say one product carries the store with under 10 orders.

Cancelled, test and $0 orders are left out ($0 orders are Charleston 3D's free custom print requests, which are quote requests, not sales).

If a scope is missing, that part of the page says which scope to add and the rest still works.

## Marketing

`#marketing` watches and adjusts search, AI search and Bing for one store at a time (switch at the top). The brands stay separate: each store has its own checks, history, IndexNow key and settings.

- **Health check.** Reads the live site the way a search engine does (no Shopify access needed): home page, one product, one collection, `robots.txt`, `sitemap.xml`, `llms.txt` and the IndexNow key file. Each check is scored under Search (SEO), Location (GEO), Bing, AI assistants or Analytics, and every problem says how to fix it: titles and descriptions, one H1, canonical, Open Graph image, structured data (and that it has no street address or phone), Google and Bing verification, AI crawlers allowed in `robots.txt`, `llms.txt`, a domain that redirects to another one, GA4 and Clarity. Both stores are checked every morning at 11:00 UTC by the Worker's cron; the last 120 days are kept in the `MARKETING` KV namespace, so the page shows a trend per area and what broke or got fixed since the last check. Without the KV binding the check still runs, with no history.
- **Products and collections.** Every active product and collection with its SEO title, description and photo alt text, flagged when missing, too long, too short or duplicated, with a search preview and a suggested title and description to use. Saving updates Shopify and sends the page to IndexNow.
- **Site settings.** The live theme's marketing settings (home title, brand description, verification codes, IndexNow key, social profiles, city, region, map position, areas served, GA4 and Clarity IDs), saved straight into the published theme's `settings_data.json`. Only those fields can be changed; street addresses and phone numbers are refused.
- **Where visitors come from.** Sessions and conversion for the last 90 days by referrer and by UTM source, medium and campaign (the QR codes show up here).
- **Search queries.** Google (Search Console) and Bing searches, clicks, impressions and position, plus the searches closest to page 1. Needs `GSC_SERVICE_ACCOUNT` and `BING_WEBMASTER_API_KEY`; without them that block says what to add.
- **UTM link builder and Tools.** Tagged links for the store's own pages, a button to send the whole sitemap to IndexNow, links to the outside tools, and a monthly routine checklist (kept in that browser).

## Put the console online (Cloudflare)

The console runs as one Cloudflare Worker on Cloudflare's free plan: the pages, the API and the image library (in Workers KV) all live there. You only do steps 1 to 5 once.

**1. A Cloudflare account.** If you don't have one yet, sign up for free at https://dash.cloudflare.com/sign-up (no card needed, no domain needed). You don't need to turn on R2 or anything else: the first deploy makes the one thing the console needs (a KV namespace for images).

**2. Node.js on your computer.** Install the LTS version (22 or newer) from https://nodejs.org. Then open a terminal (Windows: PowerShell; Mac: Terminal) in this folder. If you don't have the code yet: on GitHub open `Adub843/Business-console`, choose **Code > Download ZIP**, unzip it, and open the terminal in that folder.

**3. Install and sign in.** Type each line and press Enter:

```sh
npm install
npx wrangler login
```

`wrangler login` opens your browser: sign in to Cloudflare and press **Allow**. Then `npx wrangler whoami` should show your account.

**4. Put it online.**

```sh
npm run deploy
```

This runs the tests, then `wrangler deploy`. The first time, Cloudflare may ask you to choose a `workers.dev` subdomain (any name you like), and wrangler creates the `IMAGES` (image library) and `MARKETING` (health check history) KV namespaces by itself (if it asks for a name, press Enter to take the suggested one). At the end it prints the console's address, like `https://business-console.<your-subdomain>.workers.dev`.

**5. Add the settings (secrets).** Each one is one command; it asks for the value, and you paste it and press Enter. Nothing you type shows on screen, and the value is stored only in Cloudflare, encrypted. Start with the console key (make up a long random password, 16 characters or more):

```sh
npx wrangler secret put CONSOLE_KEY
npx wrangler secret put C3D_SHOPIFY_DOMAIN
npx wrangler secret put C3D_ADMIN_TOKEN
npx wrangler secret put ED_SHOPIFY_DOMAIN
npx wrangler secret put ED_ADMIN_TOKEN
```

Use `C3D_CLIENT_ID` and `C3D_CLIENT_SECRET` (or the `ED_` pair) instead of the `_ADMIN_TOKEN` if the store's app gives you a Client ID and secret; add the optional ones (`C3D_INDEXNOW_KEY`, `ED_INDEXNOW_KEY`, `BING_WEBMASTER_API_KEY`, `GSC_SERVICE_ACCOUNT`, `ED_HANDLING_DAYS`, `C3D_SITE_URL`, `ED_SITE_URL`) the same way. The full list is in [Connect a store](#connect-a-store). Each secret works straight away.

- See which are set: `npx wrangler secret list` (names only, never values)
- Change one: run `npx wrangler secret put NAME` again
- Remove one: `npx wrangler secret delete NAME`

Then open the console's address and enter the console key when it asks.

**The shirt app's art library.** In the Studio, images uploaded with **Show new uploads in the shirt builder app** ticked (or switched on later) are public: the Elevated Designs shirt app lists them from `/api/images?public=1` and loads them without the key. Everything else stays private to the console. The app's addresses (elevatedshirts.com, www.elevatedshirts.com and its GitHub Pages test address) are allowed to read the library already; add any other address with `npx wrangler secret put BUILDER_ORIGINS` (comma-separated, like `https://example.com`). To copy Kittl art in: `CONSOLE_URL=<the console's address> CONSOLE_KEY=<the key> node scripts/import-kittl.mjs <manifest.json> [category] [--ordered]` (`--ordered` keeps the manifest's order in the app; run the collection you want on top last).

**Updating later.** After changing the code, run `npm run deploy` again. Your secrets and images stay as they are.

### Deploy from GitHub instead (optional)

`.github/workflows/deploy.yml` runs the tests and deploys every time `main` changes on GitHub (and from the **Actions** tab with **Run workflow**). It needs two repository secrets, set once on GitHub under **Settings > Secrets and variables > Actions > New repository secret**:

- `CLOUDFLARE_API_TOKEN`: in Cloudflare, open **My Profile > API Tokens > Create Token**, use the **Edit Cloudflare Workers** template, pick your account under Account Resources (and **All zones** under Zone Resources), then **Continue to summary > Create Token**, and copy the token. It is shown only once.
- `CLOUDFLARE_ACCOUNT_ID`: the Account ID shown by `npx wrangler whoami`, or on the right of your account's **Workers & Pages** page.

The Action only deploys code. The console's own secrets (step 5) are set once with `wrangler secret put` and are kept by every deploy.

### What the free plan allows

Plenty for one person's console: 100,000 requests a day; image library storage up to 1 GB, 1,000 uploads, 1,000 deletes, 1,000 library list loads and 100,000 image reads a day; each image up to 20 MB. A new or deleted image can take up to a minute to show in the list on another device (Workers KV is eventually consistent; the tab you uploaded from shows it at once). Each request gets 10 ms of CPU time on the free plan (time spent waiting for Shopify doesn't count), which covers normal use; if Insights for a very busy store or a Marketing health check ever fails with a Cloudflare error, Workers Paid ($5 a month) lifts that limit. The daily health check uses 2 KV writes a day.

## Connect a store

Set each of these as a Worker secret, from the console's folder: `npx wrangler secret put NAME`, then paste the value when it asks (see [Put the console online](#put-the-console-online-cloudflare)). Never put them in code, in `wrangler.toml`, in chat, or in the theme.

| Variable | What it is |
| --- | --- |
| `C3D_SHOPIFY_DOMAIN` | Charleston 3D's `something.myshopify.com` domain (not charleston3d.com) |
| `C3D_ADMIN_TOKEN` | Admin API access token for Charleston 3D (see below), **or** `C3D_CLIENT_ID` + `C3D_CLIENT_SECRET` |
| `ED_SHOPIFY_DOMAIN` | Elevated Designs' `something.myshopify.com` domain |
| `ED_ADMIN_TOKEN` | Admin API access token for Elevated Designs, **or** `ED_CLIENT_ID` + `ED_CLIENT_SECRET` |
| `C3D_SITE_URL` | Optional. Public site address, default `https://charleston3d.com` |
| `ED_SITE_URL` | Optional. Public site address, default `https://elevatedshirts.com` |
| `CONSOLE_KEY` | **Required.** A long random password, at least 16 characters (there's no lockout on wrong guesses, so make it long). The product list, publishing, the image library list, uploads and Insights are refused until it's set; enter the same value when the console asks for it (kept for that browser tab only). |
| `ED_HANDLING_DAYS` | Optional. Business days to ship, used in new Elevated Designs listings, like `5-7` (the default) or `3-5`. |
| `C3D_INDEXNOW_KEY`, `ED_INDEXNOW_KEY` | Recommended. Each store's own IndexNow key (8 to 128 letters, digits or dashes); the brands never share one. `INDEXNOW_KEY` still works as a fallback for a store without its own. In each store add a page with handle `indexnow-key` and template `page.indexnow`, paste the same key in Theme settings > Search and AI, and add a URL redirect from `/<key>.txt` to `/pages/indexnow-key`. Pings use `keyLocation=https://<site>/<key>.txt`, because a key under `/pages/` would only cover `/pages/` URLs, not products. |
| `BING_WEBMASTER_API_KEY` | Optional. Shows Bing search queries on Marketing. Bing Webmaster Tools > Settings (gear) > API access > API key. One key covers every site verified in that account. |
| `GSC_SERVICE_ACCOUNT` | Optional. Shows Google search queries on Marketing: the whole JSON key file of a Google Cloud service account with the Search Console API turned on. Add the account's `client_email` as a user (Restricted is enough) on each Search Console property. |
| `C3D_GSC_PROPERTY`, `ED_GSC_PROPERTY` | Optional. The Search Console property, when it isn't the domain property `sc-domain:<host>` (for example `https://charleston3d.com/`). |

### Admin API access scopes

Give each store's app these scopes:

- `read_products`, `write_products`: list products, make them Active, add or remove the `customizable` tag (`tagsAdd`/`tagsRemove`), and create listings (`productSet` and the image upload through `stagedUploadsCreate`)
- `read_publications`, `write_publications`: find the Online Store channel and publish to it
- `read_orders`: sales, best sellers and the forecast
- `read_reports`: sessions and conversion, visits by source and UTM campaign (ShopifyQL)
- `read_themes`, `write_themes`: Marketing's Site settings (read and save the live theme's search, location and analytics settings)
- `write_files`: Marketing's photo alt text (`fileUpdate`)

If Elevated Designs answers a listing with "access denied" for the product image, also add `write_files` (the image becomes a Shopify file); Shopify's docs list only `write_products` for `productSet` and staged uploads.

Optional: `read_customers` (repeat customer rate across a customer's whole history; without it, repeats are counted within the period) and `read_all_orders` (orders older than 60 days, needed for the 90-day comparisons).

### Getting the credentials (do this in each store)

**If the store already has a custom app made in the admin**: in Shopify admin, go to **Settings > Apps and sales channels > Develop apps**, open the app, choose **Configuration**, edit **Admin API integration**, tick the scopes above and save. Then on **API credentials**, install or reinstall the app. If the Admin API access token is still shown, save it straight into `C3D_ADMIN_TOKEN` or `ED_ADMIN_TOKEN` with `npx wrangler secret put`; if not, use the option on that page to generate a new one. The token is only shown once.

**If there is no app yet**: Shopify no longer lets you create new custom apps in the admin's Develop apps page, so create one in the **Dev Dashboard** instead (from the Develop apps page, or dev.shopify.com): create an app, add the scopes above to its version, release it, and install it on the store. Then in **App settings**, copy the **Client ID** and **Client secret** into `C3D_CLIENT_ID` / `C3D_CLIENT_SECRET` (or the `ED_` pair). The console swaps them for a 24-hour access token by itself.

Each `wrangler secret put` takes effect straight away; there's no need to deploy again.

## Tests

Run `npm install` once first (the API tests use `graphql`, and `wrangler` runs the console locally).

- `npm run check`: syntax check of every script
- `npm test` (`node scripts/test-api.mjs`): the API with Shopify mocked, called through the Worker's own fetch handler with an in-memory Workers KV (same limits as the real one: 25 MiB values, 1024-byte metadata, paged lists) (listing, publishing, unpublishing, customizable, one-click listings, bad input, keys, missing settings, Shopify errors, IndexNow failures, insights maths, the Worker's routes, headers, body and upload limits, and that `dist/` holds only the app). Every GraphQL query and mutation the mock receives, and its variables, is validated against the Admin API 2025-10 schema in `scripts/schema/` (the introspection file from `@shopify/dev-mcp@1.5.0`).
- `npm run test:ui` (`NODE_PATH=$(npm root -g) node scripts/test-ui.cjs`): Products, Insights, Studio and Marketing in a real browser with `/api/*` mocked; needs Playwright (installed globally or in the project) and python3. Set `SCREENS=<folder>` to save screenshots.

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
| `GET /api/marketing?store=c3d\|ed&part=audit\|catalog\|settings\|traffic\|history` | Marketing: health check (with history), product and collection SEO, theme settings, traffic and search queries |
| `POST /api/marketing {store, action: "seo", id, seoTitle, seoDescription}` | Save a product's or collection's SEO title and description (and ping IndexNow) |
| `POST /api/marketing {store, action: "alt", mediaId, alt}` | Save a photo's alt text |
| `POST /api/marketing {store, action: "settings", values}` | Save marketing settings to the live theme |
| `POST /api/marketing {store, action: "indexnow", urls?}` | Send pages (or the whole sitemap) to IndexNow with the store's own key |
| `GET /api/images` | Image library list: `{items: [{key, name, type, size, tags, added}]}` |
| `GET /api/images/<key>` | The image file (no key needed; keys are unguessable) |
| `POST /api/images` | Save one image: the raw file as the body, its type in `content-type` (PNG, JPEG, WebP, GIF or SVG, checked against the file), `x-filename`, optional `x-tags`; 20 MB at most |
| `DELETE /api/images/<key>` | Remove one image |

All of them need the console key (`x-console-key`), except fetching an image file by its key. There is no CORS: only the console's own pages can call the API from a browser. A listing makes several Shopify calls including an image upload of up to 20 MB. If one is cut off after the product was made, List it again finds it by its `design:` tag and finishes publishing it instead of making a second one.

## Moving to another host later

`lib/` has no hosting code. A new host needs a small adapter like `worker/app.mjs` that passes `{ method, query, header(name), text() }` and `{ env(name), fetch }` to `handleProducts` / `handleInsights` / `handleListings` and sends back `{ status, body }` as JSON. The image library (`lib/images.mjs`) takes any blob store with the same few methods (`list`, `getWithMetadata`, `set`, `delete`); `lib/kv-store.mjs` makes one from Workers KV.
