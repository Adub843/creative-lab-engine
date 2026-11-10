# Creative Lab engine (formerly the Business Console, now retired)

**2026-10-30:** this is now the background engine behind the Creative Lab Studios console (https://claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK). It has no pages of its own; the console runs every action below through the `creative-lab-actions` queue (see `worker/queue.mjs`). The rest of this README describes each function as it was built in the Creative Lab engine.

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
- `wrangler.toml`: the Worker's settings (files in `dist/`, the `IMAGES` and `MARKETING` KV namespaces, the daily 11:00 UTC health check and 11:30 UTC safe fixes, `nodejs_compat`). No secrets in it.

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
- **Growth.** Visits, visitors, time on site, add to cart, checkouts, orders and sales per day from Shopify (needs `read_reports`), plus Google clicks (Search Console), Bing clicks and GA4 engagement when those are connected, and the health score. Tiles compare the last 30 days with the 30 before. The chart (30, 90 or 180 days) puts a flag on each day something was changed, so each change can be read against what the site did next.
- **Changes and what they did.** Every change made by the console or from this page (SEO titles and descriptions, alt text, site settings) is logged in the `MARKETING` KV namespace (`changes:<store>`, latest 300) with its old and new value. Each one shows its page's visits per day in the 14 days before against the days since (whole-site visits for settings), and has an **Undo** that writes the old value back.
- **Safe fixes, every morning.** At 11:30 UTC the Worker fixes what the checks find, on each store separately, up to 12 writes per store per run: an empty or too-long (over 60) SEO title, an empty, too-long (over 160) or too-short SEO description (replaced only by a longer suggestion), and empty photo alt text. Wording within the limits is never touched, and changed pages go to IndexNow. Fourteen days later each automatic change is reviewed: if its page's visits fell by 30% or more (from at least one a day), the old value goes back by itself and that page is left alone afterwards. "Apply safe fixes now" runs the same thing on demand. Set `MARKETING_AUTOFIX=off` to stop the morning run.
- **Keywords.** Up to 30 phrases per store (sensible defaults for each brand) with their average Google position, movement against the 28 days before, clicks, impressions, the page that ranks, and Bing clicks. A search counts for a keyword when it contains all its words.
- **Products and collections.** Every active product and collection with its SEO title, description and photo alt text, flagged when missing, too long, too short or duplicated, with a search preview and a suggested title and description to use. Saving updates Shopify and sends the page to IndexNow.
- **Site settings.** The live theme's marketing settings (home title, brand description, verification codes, IndexNow key, social profiles, city, region, map position, areas served, GA4, Clarity, Meta pixel, TikTok pixel and Pinterest tag IDs; the pixels load only after a visitor allows marketing cookies), saved straight into the published theme's `settings_data.json`. Only those fields can be changed; street addresses and phone numbers are refused.
- **Where visitors come from.** Sessions and conversion for the last 90 days by referrer and by UTM source, medium and campaign (the QR codes show up here).
- **Google Search Console.** Top pages (shown, clicks, click rate, position), clicks by device, whether Google has indexed the home page (URL Inspection), the sitemaps Google has with their errors, a **Submit sitemap to Google** button, and **Is it in Google?** for any page on the store's own site. Links to Merchant Center, GA4, Business Profile and PageSpeed Insights. Needs `GSC_SERVICE_ACCOUNT`; submitting a sitemap needs that account to be an **Owner** on the property (reading needs any user).
- **Holo AI marketing.** [Holo](https://tryholo.ai) makes ads, social posts, emails and blog posts, and publishes blog posts straight to each store's Shopify blog with its own connector (Holo: Brand DNA > Integrations > Shopify, enter the store's `.myshopify.com` domain, pick the blog). Holo has no public API, so the panel reads that blog's public feed (`/blogs/news.atom`, no extra scopes), lists the latest posts, and logs every new post in the change log (marked **Blog post**) so Growth shows what it did to visits. The daily site check picks up new posts too. `C3D_HOLO_BLOG` / `ED_HOLO_BLOG` set another blog handle (default `news`).
- **Search queries.** Google (Search Console) and Bing searches, clicks, impressions and position, plus the searches closest to page 1. Needs `GSC_SERVICE_ACCOUNT` and `BING_WEBMASTER_API_KEY`; without them that block says what to connect.
- **Getting around.** Jump links at the top go to each section. "Apply safe fixes now" and "Undo" ask for a second click before they change the live site, and each refreshes only the panels it changed.
- **Plain words on the page.** The page never shows setting names. "Connect Google Search Console" means `GSC_SERVICE_ACCOUNT` (and `<PREFIX>_GSC_PROPERTY` if the property isn't the domain), "Connect Google Analytics" means `C3D_GA4_PROPERTY` / `ED_GA4_PROPERTY`, "Connect Bing Webmaster Tools" means `BING_WEBMASTER_API_KEY`, "the console's storage" means the `MARKETING` KV binding, an IndexNow key means `C3D_INDEXNOW_KEY` / `ED_INDEXNOW_KEY`, and "automatic morning fixes are switched off" means `MARKETING_AUTOFIX=off`.
- **UTM link builder and Tools.** Tagged links for the store's own pages, a button to send the whole sitemap to IndexNow, links to the outside tools, and a monthly routine checklist (kept in that browser).

## 3D maker (Charleston 3D)

`#maker3d/c3d` turns 1 to 4 photos of one object, or a short description, into a printable model with [Meshy](https://www.meshy.ai) (`lib/meshy.mjs`, `assets/meshy.js`). It uses Aaron's Meshy credits: shape only 20, photos with color 30, color added to a words model later 10, high detail +5. The start button asks twice before spending. Every model comes back as a 3MF and an STL for Bambu Studio and a GLB, turns in a 3D view, and saves into the 3D file library with one click. Meshy deletes models after 3 days, so save the ones worth keeping.

Turn it on once with `npx wrangler secret put MESHY_API_KEY` (the key from meshy.ai › API). The key stays in the Worker; the page only ever talks to the console. Jobs are listed under `c3d-meshy:` in the IMAGES KV namespace.

## Art library, E: drive and shirt designer

These came over from the Design Studio on 7 Nov 2026 (epix3d.com is now a separate 3D maker site), so the console is the one place for art and shirts.

- **Art library** (Library, on both stores): every image in the online library. Each image belongs to one brand: `ed`, `epix3d` (an Elevated Designs label) or `c3d`. Elevated Designs shows its own and EPIX3D's art; Charleston 3D shows only its own. Open an image to rename it, tag it, change its category or brand, show it in the shirt app, put it on a shirt, list it or delete it; select several to do it at once. Charleston 3D art is never public and never reaches the shirt app or the shirt designer (the server enforces this on upload, on every change and in the public feed). Images saved before brands existed count as Elevated Designs, or Charleston 3D when their category names it.
- **E: drive** (Library, on both stores): every design file on Aaron's E: drive (plus Kittl and the old design lab images), searched with previews, read from his PC through a Cloudflare Tunnel while it's on. Each store sees its own files. The PC side is `drive-server/` (see its README); the console signs every request with CONSOLE_KEY and the PC checks it. `DRIVE_ORIGIN` in `wrangler.toml` is the tunnel's address (`https://library.epix3d.com`, a name from the Design Studio days that can later move to a console hostname).
- **Shirt designer** (Make, Elevated Designs): uploads and saved designs go to Elevated Designs or EPIX3D. Home has "Start a design" tiles on the real shirt photos.

## Kittl library sync

The image library follows the Kittl "Clipped Images" folder by itself, so the shirt apps' designs stay current.
- Once a night at 04:45 UTC (11:45 PM Eastern in standard time, 12:45 AM in daylight time), after the 11:30 PM task pushes the list, on the 04:45 run of the hourly `45 * * * *` cron (the account has no free cron slot for its own), the Worker reads the list at https://design.elevatedshirts.com/library/kittl.json (lib/kittl-sync.mjs).
- **Sync now:** the console can run it at once with `POST /api/library-sync` (console key; through the queue: `{"id": "<id>", "method": "POST", "path": "/api/library-sync"}`). It answers with the same counts as the GET. A second press within 60 seconds gets the last result back (marked `debounced`) instead of running again.
- The hourly `45 * * * *` cron's other 23 runs don't sync. They only renew the shirt apps' saved public art list (`snapshot:public-images`) when it's missing or over 5 hours old. Every run prunes old queue answers. At 04:45 the sync saves the fresh list itself.
- New Kittl images are copied in, up to 30 per run, from Kittl's image host only.
- Images that left Kittl are removed. Only Kittl images in a listed category are ever removed. If more than 10% would go at once, nothing is removed and the run reports a warning.
- Console uploads, other categories, and your edits (name, tags, hidden or shown) are never touched.
- A scheduled Claude task writes the list after reading Kittl. It marks brand logos (Charleston3D and Elevated Designs marks) hidden, so they never show in a customer library.
- The last run's counts are at /api/library-sync. No key is needed. `stale: true` means no sync in over 26 hours (a missed night).
- No key or secret is involved anywhere in this sync.

## Taxi (taxes)

Taxi is the tax agent, in Creative Lab Studios under Money > Taxi · taxes (page code `assets/taxes.js`, published to the console as `engine/taxes.js`; API `/api/taxes`, `lib/taxes.mjs`). Both stores belong to Elevated Designs LLC and one Schedule C, so she shows both, each in its own column. Every morning on the 10:00 UTC tick of the 15-minute cron she reads both stores' paid orders (no customer details are kept) and works out for each sale: the SC sales tax collected (goes to the sales tax account), card fee, material cost, the income tax reserve (her calculated rate on the sale's profit, for the IRS and SC) and what's left for Aaron. The page has the Friday-to-Thursday weekly totals to move, SC sales tax by month with due dates, the year's tax so far, deadlines with links, receipts and screenshots by week (photos and PDFs up to 10 MB, kept in IMAGES under `tax-file:`), her daily log, settings and every assumption with its source. Her report and, on Fridays, the week's summary with the amount to move go into the daily digest (`taxi`) for Stacy. Ledger, reports and settings live in MARKETING under `tax:*`. She's guidance, not a CPA: the 2026 rules are in `lib/taxes.mjs` (`TAX_RULES`) and are updated each January. Aaron's personal taxes live in the Pocket Ledger app, never here.

For Taxi's exact numbers (optional; without them she estimates): `read_shopify_payments_payouts` (the real card fee on each order), `read_inventory` (each product's cost per item) and `read_all_orders` (sales older than 60 days, so the whole tax year stays in her ledger after February).

## Put the console online (Cloudflare)

The console runs as one Cloudflare Worker on Cloudflare's free plan: the pages, the API and the image library (in Workers KV) all live there. You only do steps 1 to 5 once.

**1. A Cloudflare account.** If you don't have one yet, sign up for free at https://dash.cloudflare.com/sign-up (no card needed, no domain needed). You don't need to turn on R2 or anything else: the first deploy makes the one thing the console needs (a KV namespace for images).

**2. Node.js on your computer.** Install the LTS version (22 or newer) from https://nodejs.org. Then open a terminal (Windows: PowerShell; Mac: Terminal) in this folder. If you don't have the code yet: on GitHub open `Adub843/creative-lab-engine`, choose **Code > Download ZIP**, unzip it, and open the terminal in that folder.

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

Use `C3D_CLIENT_ID` and `C3D_CLIENT_SECRET` (or the `ED_` pair) instead of the `_ADMIN_TOKEN` if the store's app gives you a Client ID and secret; add the optional ones (`C3D_INDEXNOW_KEY`, `ED_INDEXNOW_KEY`, `BING_WEBMASTER_API_KEY`, `GSC_SERVICE_ACCOUNT`, `ED_HANDLING_DAYS`, `C3D_SITE_URL`, `ED_SITE_URL`, `MESHY_API_KEY`) the same way. The full list is in [Connect a store](#connect-a-store). Each secret works straight away.

- See which are set: `npx wrangler secret list` (names only, never values)
- Change one: run `npx wrangler secret put NAME` again
- Remove one: `npx wrangler secret delete NAME`

Then open the console's address and enter the console key when it asks.

**The shirt app's art library.** In the Studio, images uploaded with **Show new uploads in the shirt builder app** ticked (or switched on later) are public: the Elevated Designs shirt app lists them from `/api/images?public=1` and loads them without the key. Everything else stays private to the console. The app's addresses (elevatedshirts.com, www.elevatedshirts.com and its GitHub Pages test address) are allowed to read the library already; add any other address with `npx wrangler secret put BUILDER_ORIGINS` (comma-separated, like `https://example.com`). To copy Kittl art in: `CONSOLE_URL=<the console's address> CONSOLE_KEY=<the key> node scripts/import-kittl.mjs <manifest.json> [category] [--ordered]` (`--ordered` keeps the manifest's order in the app; run the collection you want on top last).

**Store sign-in for the shirt app.** Customers sign in to the shirt app with their elevatedshirts.com customer account, and their Shopify customer tags unlock private art. Give a private image an **access** list of tags (`PATCH /api/images/:key` with `{"access": "pro, designs:benz1"}`, or the `x-access` upload header); a signed-in customer with any of those tags sees it. `members` means any signed-in customer. The app asks `/api/member/config` for the sign-in addresses and `/api/member` (with the customer's token) for what they've unlocked. Setup: in the ED store's Headless channel, set the Customer Account API to a public client with `https://design.elevatedshirts.com/` as callback and logout URI and `https://design.elevatedshirts.com` as JavaScript origin, its client ID is built into `lib/members.mjs` (it isn't a secret; `ED_CUSTOMER_CLIENT_ID` overrides it), and add the `read_customers` scope to the ED store's app.

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
| `CONSOLE_KEY` | **Required.** A long random password, at least 16 characters (there's no lockout on wrong guesses, so make it long). The product list, publishing, the image library list, uploads and Insights are refused until it's set; enter the same value when the console asks for it (remembered on that device, so it's typed once). |
| `ED_HANDLING_DAYS` | Optional. Business days to ship, used in new Elevated Designs listings, like `5-7` (the default) or `3-5`. |
| `C3D_INDEXNOW_KEY`, `ED_INDEXNOW_KEY` | Recommended. Each store's own IndexNow key (8 to 128 letters, digits or dashes); the brands never share one. `INDEXNOW_KEY` still works as a fallback for a store without its own. In each store add a page with handle `indexnow-key` and template `page.indexnow`, paste the same key in Theme settings > Search and AI, and add a URL redirect from `/<key>.txt` to `/pages/indexnow-key`. Pings use `keyLocation=https://<site>/<key>.txt`, because a key under `/pages/` would only cover `/pages/` URLs, not products. |
| `BING_WEBMASTER_API_KEY` | Optional. Shows Bing search queries on Marketing. Bing Webmaster Tools > Settings (gear) > API access > API key. One key covers every site verified in that account. |
| `GSC_SERVICE_ACCOUNT` | Optional. Brings Google Search Console into Marketing (queries, pages, sitemaps, indexing, keywords, Google clicks on Growth): the whole JSON key file of a Google Cloud service account with the Search Console API turned on. Add the account's `client_email` as a user on each Search Console property; make it an **Owner** to let the console submit sitemaps. |
| `C3D_HOLO_BLOG`, `ED_HOLO_BLOG` | Optional. The blog handle Holo publishes to, if it isn't `news`. |
| `C3D_GA4_PROPERTY`, `ED_GA4_PROPERTY` | Optional. The numeric GA4 property ID (Admin > Property details, not the G- measurement ID) for engagement on the Growth chart. Uses `GSC_SERVICE_ACCOUNT`: turn on the Google Analytics Data API for that Cloud project and add its `client_email` as a Viewer on the property. |
| `MARKETING_AUTOFIX` | Optional. `off` stops the 11:30 UTC safe fixes (the button on Marketing still works, and changes are still logged). |
| `C3D_GSC_PROPERTY`, `ED_GSC_PROPERTY` | Optional. The Search Console property, when it isn't the domain property `sc-domain:<host>` (for example `https://charleston3d.com/`). |

## Promotions

`#promote` runs Shopify's marketing tools for one store at a time, through the Admin API:

- **Discounts.** Every code and automatic discount with its code, status, uses and dates; turn one on or off, or delete it (two clicks). New discounts: percent off, dollars off or free shipping, as a code or automatic, with an optional minimum order, start and end, total uses, one use per customer (codes) and a customer group. They apply to every product, and amount-off discounts still allow free shipping.
- **Gift cards.** Balances, and new gift cards (amount, note, expiry). The full code is shown once when it's made, as Shopify only returns the last four characters after that. Turning a card off is permanent.
- **Customer groups.** Shopify segments, and new ones from a rule or a ready-made template (loyal, lapsed, top spenders, subscribed but never bought, South Carolina). A group can be the audience of a discount.
- **Campaigns and marketing activity.** What Shopify tracks from Shopify Email and the ad channel apps: channel, status, ad spend and UTM campaign.
- **Sales channels.** Where the store sells, and whether Google & YouTube, Facebook & Instagram, TikTok and Pinterest are connected (with a link to add each).
- **Abandoned checkouts.** The latest 25, the total left behind, and each cart's recovery link.

Each change goes in the Marketing change log (kind "Promotion"), so the Growth chart shows it against visits and sales. Every section loads on its own: a missing scope only empties its own section and names the scope.

**Only in Shopify's admin.** Shopify keeps these out of its API, so the page links straight to them: Shopify Email campaigns, marketing automations (abandoned cart, welcome and browse emails), Shopify Flow workflows, creating campaigns, and connecting ad accounts and buying ads in the channel apps.

### Admin API access scopes

Give each store's app these scopes:

- `read_products`, `write_products`: list products, make them Active, add or remove the `customizable` tag (`tagsAdd`/`tagsRemove`), and create listings (`productSet` and the image upload through `stagedUploadsCreate`)
- `read_publications`, `write_publications`: find the Online Store channel and publish to it
- `read_orders`: sales, best sellers and the forecast
- `read_reports`: sessions and conversion, visits by source and UTM campaign (ShopifyQL)
- `read_themes`, `write_themes`: Marketing's Site settings (read and save the live theme's search, location and analytics settings)
- `write_files`: Marketing's photo alt text (`fileUpdate`)
- `read_discounts`, `write_discounts`: Promotions' discounts
- `read_gift_cards`, `write_gift_cards`: Promotions' gift cards
- `read_customers`, `write_customers`: Promotions' customer groups (segments)
- `read_marketing_events`: Promotions' campaigns and marketing activity
- `read_orders`: also Promotions' abandoned checkouts

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
| `GET /api/marketing?store=c3d\|ed&part=audit\|catalog\|settings\|traffic\|history\|changes\|growth\|keywords` | Marketing: health check (with history), product and collection SEO, theme settings, traffic and search queries, the change log, daily growth (`&days=14..180`) and keywords |
| `POST /api/marketing {store, action: "seo", id, seoTitle, seoDescription}` | Save a product's or collection's SEO title and description (and ping IndexNow) |
| `POST /api/marketing {store, action: "alt", mediaId, alt, productId?}` | Save a photo's alt text |
| `POST /api/marketing {store, action: "autofix"}` | Apply the safe fixes now |
| `POST /api/marketing {store, action: "undo", changeId}` | Put back the old value of a logged change |
| `POST /api/marketing {store, action: "keywords", keywords}` | Save the store's tracked keywords |
| `POST /api/marketing {store, action: "settings", values}` | Save marketing settings to the live theme |
| `POST /api/marketing {store, action: "indexnow", urls?}` | Send pages (or the whole sitemap) to IndexNow with the store's own key |
| `GET /api/marketing?store=c3d\|ed&part=google` | Search Console: top pages, devices, sitemaps and the home page's index status |
| `POST /api/marketing {store, action: "sitemap"}` | Submit the store's `sitemap.xml` to Google Search Console |
| `POST /api/marketing {store, action: "inspect", url}` | Ask Google whether a page on the store's own site is indexed |
| `GET /api/promotions?store=c3d\|ed` | Promotions: discounts, gift cards, segments, campaigns, channels, abandoned checkouts, segment templates and the admin-only tools |
| `POST /api/promotions {store, action: "discount", method: "code"\|"automatic", type: "percentage"\|"amount"\|"shipping", title, code?, value?, minSubtotal?, startsAt?, endsAt?, usageLimit?, oncePerCustomer?, segmentId?}` | Create a discount |
| `POST /api/promotions {store, action: "discountStatus", id, active}` / `{..., action: "discountDelete", id}` | Turn a discount on or off, or delete it |
| `POST /api/promotions {store, action: "giftcard", amount, note?, expiresOn?}` / `{..., action: "giftcardDisable", id}` | Create a gift card (the code comes back once), or turn one off for good |
| `POST /api/promotions {store, action: "segment", name, query}` | Create a customer group |
| `GET /api/images` | Image library list: `{items: [{key, name, type, size, tags, added, brand, url}]}` |
| `GET /api/images?public=1[&brand=ed\|epix3d]` | No key: the shirt app's art, never private or Charleston 3D art: `{items: [{key, name, type, tags, category, kind, added, brand}]}`, CORS for the app's origins |
| `PATCH /api/images/<key>` | Change `name`, `tags`, `category`, `kind`, `public`, `access` or `brand` (`c3d`, `ed`, `epix3d`; moving to `c3d` turns public off) |
| `GET /api/drive/search?q=&brand=ed\|c3d&kind=&page=&per=` / `GET /api/drive/stats` | The E: drive library (needs the key); each file comes with signed `thumbUrl` and `fileUrl` links |
| `GET /api/drive/thumb/<id>`, `GET /api/drive/file/<id>` | A preview or the file itself, with the key or a signed link |
| `GET /api/drive/public?q=&folder=&type=&page=&per=` | No key: the E: drive pictures the shirt app may show (`SHIRT_APP_FOLDERS` in `drive-server/config.mjs`, about 151,000), one page at a time (per up to 1,000): `{page, per, total, items: [{id, name, folder, ext, kind, thumbUrl, fileUrl}], folders: [{name, count}]}` with absolute signed links, CORS for the app's origins. `q` searches every picture's name and folder path, `folder` is one top folder, `type` is `png`, `svg` or `dtf`; `folders` gives each top folder's true count. 503 `pc_offline` while the PC is off |
| `GET /api/images/<key>` | The image file (no key needed; keys are unguessable) |
| `POST /api/images` | Save one image: the raw file as the body, its type in `content-type` (PNG, JPEG, WebP, GIF or SVG, checked against the file), `x-filename`, optional `x-tags`, `x-brand`, `x-public`, `x-category`; 20 MB at most |
| `DELETE /api/images/<key>` | Remove one image |
| `GET /api/library-sync` | The last Kittl library sync's counts (no key needed) |
| `POST /api/library-sync` | Sync now: run the Kittl library sync at once (at most once a minute) and return its counts |
| `GET /api/digest` (`?date=YYYY-MM-DD` for an earlier day) | The daily digest: per store (`c3d`, `ed`) the site check scores and fails/warns, automatic fixes made and undone in the last 24 hours, the rank snapshot, last 7 days' sessions/orders/sales, each store's 7-day marketing scorecard (trimmed), and (ED) the price sync and Kittl library sync state. Written at 11:30 UTC to the RESULTS bucket as `digest/latest.json` and `digest/<date>.json` (kept 30 days) |
| `GET /api/scorecard?store=c3d\|ed&days=2\|7` | The marketing scorecard (lib/scorecard.mjs, no AI): per UTM campaign the visits, add-to-carts, checkouts (ShopifyQL, `read_reports`), orders and sales (orders credited by their visit's UTM campaign, `read_orders`), cost from the optional R2 file `ads/spend-<store>.json`, cost per visit and per order, a winner/average/loser label against the store's own average, pause flags (no visits after 3 days, cost per visit over `config/marketing-limits.json`'s limit, default $0.50) and the $2/day cap. The thresholds are documented at the top of lib/scorecard.mjs. The AI steps that read it are in `ai-jobs/` |

All of them need the console key (`x-console-key`), except fetching an image file by its key and the shirt app's public feeds marked "No key". Only those public reads get CORS, and only for the shirt app's own addresses; everything else can only be called from the console's own pages. A listing makes several Shopify calls including an image upload of up to 20 MB. If one is cut off after the product was made, List it again finds it by its `design:` tag and finishes publishing it instead of making a second one.

## Moving to another host later

`lib/` has no hosting code. A new host needs a small adapter like `worker/app.mjs` that passes `{ method, query, header(name), text() }` and `{ env(name), fetch }` to `handleProducts` / `handleInsights` / `handleListings` and sends back `{ status, body }` as JSON. The image library (`lib/images.mjs`) takes any blob store with the same few methods (`list`, `getWithMetadata`, `set`, `delete`); `lib/kv-store.mjs` makes one from Workers KV.
