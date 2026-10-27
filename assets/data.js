// Everything the console knows about the two businesses and the services behind them.
// 27 Oct 2026: nothing runs on Netlify any more; the old Netlify apps and links were taken out.
// Both store sites are Shopify themes on their own stores, the apps are on GitHub Pages, and
// each brand has its own theme repo: Charleston 3D in charleston3d-site, Elevated Designs in
// elevated-designs-site. Nothing here is shared between the two brands.
// "probably" in a description means it was inferred from a name or setup, not opened.

export const BRANDS = {
  c3d: {
    name: "Charleston 3D",
    tagline: "Personalized 3D printed gifts, sold on a hand-coded Shopify theme with Shopify checkout",
    site: "https://charleston3d.com",
    app: "https://app.charleston3d.com",
    logo: "assets/brand/c3d-wordmark.png",
    admin: { label: "Shopify admin", url: "https://charleston3d.com/admin" },
  },
  ed: {
    name: "Elevated Designs",
    tagline: "Custom apparel and print designs, sold on a hand-coded Shopify theme with Shopify checkout",
    site: "https://elevatedshirts.com",
    app: "https://design.elevatedshirts.com",
    logo: "assets/brand/ed-script.png",
    admin: { label: "Shopify admin", url: "https://elevatedshirts.com/admin" },
  },
  other: { name: "Other projects", tagline: "Video, content and personal apps" },
};

export const STATUS = {
  attn: "Needs attention",
  blind: "Can't see",
  live: "Live",
  empty: "Never launched",
};

export const SERVICES = [
  // Charleston 3D
  { id: "c3dsite", name: "charleston3d.com", brand: "c3d", kind: "Website · Shopify theme", status: "live",
    does: "Charleston 3D's storefront: a hand-coded Shopify theme running on the Charleston3D store. Products, prices and checkout come live from Shopify, so a product switched on in Products shows up at once. No build step.",
    source: "GitHub: Adub843/charleston3d-site, branch claude/shopify-theme (Charleston 3D only)",
    note: "Live since 26 Oct 2026. Shopify's GitHub sync publishes new commits on claude/shopify-theme. The old Wix plan was canceled on 8 Oct.",
    links: [{ label: "Products on the site", url: "#products/c3d" }, { label: "Insights", url: "#insights/c3d" },
      { label: "Open live site", url: BRANDS.c3d.site }, { label: "Themes in Shopify", url: `${BRANDS.c3d.site}/admin/themes` }] },
  { id: "c3dshop", name: "Charleston3D store", brand: "c3d", kind: "Store backend · Shopify", status: "live",
    does: "Shopify store (Basic plan) that holds the Charleston 3D catalog, hosts the site, takes payment and sends order emails.",
    links: [BRANDS.c3d.admin, { label: "Orders", url: `${BRANDS.c3d.site}/admin/orders` }, { label: "Products", url: `${BRANDS.c3d.site}/admin/products` }] },
  { id: "c3dapp", name: "Charleston3D app", brand: "c3d", kind: "Web app · GitHub Pages", status: "live",
    does: "app.charleston3d.com: customers shop, ask for an item that isn't listed, or send a free custom print request with photos or a 3D file. It reads the same Charleston3D catalog, so a product switched on in Products shows up in the app within 15 minutes, and \"customizable\" adds the name-to-print box there too. Every order and request checks out through the Charleston3D Shopify store, so it lands in Orders (requests as $0 \"Custom request\" orders).",
    source: "GitHub: Adub843/charleston3d-app (main publishes to GitHub Pages)",
    links: [{ label: "Open the app", url: BRANDS.c3d.app }, { label: "Request page", url: `${BRANDS.c3d.app}/#request` },
      { label: "Products in the app", url: "#products/c3d" }, { label: "Orders and requests", url: `${BRANDS.c3d.site}/admin/orders` },
      { label: "Open repository", url: "https://github.com/Adub843/charleston3d-app" }] },

  // Elevated Designs
  { id: "edsite", name: "elevatedshirts.com", brand: "ed", kind: "Website · Shopify theme", status: "live",
    does: "Elevated Designs' storefront: its own hand-coded Shopify theme, separate from Charleston 3D, running on the Elevated Designs Shopify store. Products and checkout come live from Shopify.",
    source: "GitHub: Adub843/elevated-designs-site (branch claude/ed-theme)",
    note: "Live since 26 Oct 2026. The live theme was uploaded, so new commits on claude/ed-theme need a re-upload until Shopify's GitHub sync is connected.",
    links: [{ label: "Products on the site", url: "#products/ed" }, { label: "Insights", url: "#insights/ed" },
      { label: "Open live site", url: BRANDS.ed.site }, { label: "Themes in Shopify", url: `${BRANDS.ed.site}/admin/themes` }] },
  { id: "shop", name: "Elevated Designs store", brand: "ed", kind: "Store backend · Shopify", status: "live",
    does: "Shopify store (Basic plan) that holds the Elevated Designs catalog, hosts elevatedshirts.com and takes payment.",
    note: "The store's contact email is staticupload170@gmail.com, not the main Gmail.",
    links: [BRANDS.ed.admin, { label: "Open live store", url: BRANDS.ed.site },
      { label: "Products", url: `${BRANDS.ed.site}/admin/products` },
      { label: "Orders", url: `${BRANDS.ed.site}/admin/orders` }] },
  { id: "shirtapp", name: "Elevated Designs shirt app", brand: "ed", kind: "Web app · GitHub Pages", status: "live",
    does: "design.elevatedshirts.com: customers design a shirt from the public part of the image library; their orders are paid through the Elevated Designs Shopify checkout, so they land in the Elevated Designs orders.",
    source: "GitHub: Adub843/elevated-shirt-app (main publishes to GitHub Pages)",
    links: [{ label: "Open the app", url: BRANDS.ed.app }, { label: "Orders in Shopify", url: `${BRANDS.ed.site}/admin/orders` },
      { label: "Open repository", url: "https://github.com/Adub843/elevated-shirt-app" }] },
  { id: "ghedtheme", name: "GitHub · elevated-designs-site", brand: "ed", kind: "Code storage · GitHub", status: "attn",
    does: "The single home for Elevated Designs' own Shopify theme.",
    note: "Not connected to the store yet, so theme changes are uploaded by hand. Connect it in Shopify (Online Store, Themes, Add theme, Connect from GitHub) to deploy on every commit.",
    links: [{ label: "Open repository", url: "https://github.com/Adub843/elevated-designs-site" }] },
  { id: "studio", name: "Design Studio", brand: "ed", kind: "Web app · Cloudflare Worker", status: "attn",
    does: "The art library and shirt designer for every brand, each with its own library, on its own address. It shares this console's image library, so a design saved there shows up here and in the shirt apps. It moves to epix3d.com once that domain is on Cloudflare.",
    note: "Set its key once: in Desktop\\design-studio run npx.cmd wrangler secret put CONSOLE_KEY and type the console's key.",
    source: "GitHub: Adub843/design-studio (deployed by hand from the PC)",
    links: [{ label: "Open Design Studio", url: "https://design-studio.business-console.workers.dev" }, { label: "Design library in this console", url: "#designs/ed" }, { label: "Shirt designer in this console", url: "#studio/ed" },
      { label: "Open repository", url: "https://github.com/Adub843/design-studio" }] },
  { id: "publish", name: "Products and Insights", brand: "other", kind: "In this console · both stores", status: "live",
    does: "Switch products on or off each store's Shopify site, choose which Charleston 3D products are customizable (the theme then asks for a name to print), list a library design on Elevated Designs in one click, and see sales, visits, a 30-day forecast and next steps for each store.",
    links: [{ label: "Products", url: "#products" }, { label: "List a design (Elevated Designs)", url: "#products/ed/list" }, { label: "Insights", url: "#insights" }] },

  // Video
  { id: "yt", name: "YouTube", brand: "other", kind: "Video · YouTube", status: "blind",
    does: "Final home for videos. Not connected yet, so the console can't see the channel.",
    links: [{ label: "Open YouTube Studio", url: "https://studio.youtube.com" }] },

  // Accounts
  { id: "gh", name: "GitHub · Business-console", brand: "other", kind: "Code storage · GitHub", status: "live",
    does: "The single home for this console's code.",
    links: [{ label: "Open repository", url: "https://github.com/Adub843/Business-console" }] },
  { id: "ghtheme", name: "GitHub · charleston3d-site", brand: "c3d", kind: "Code storage · GitHub", status: "live",
    does: "The single home for Charleston 3D's Shopify theme. Charleston 3D only; Elevated Designs gets its own repo.",
    links: [{ label: "Open theme code", url: "https://github.com/Adub843/charleston3d-site/tree/claude/shopify-theme" }] },
];

export const ROUTES = [
  { brand: "c3d", hops: [["Pick products, set customizable", "publish"], ["Catalog and checkout", "c3dshop"], ["Customers shop", "c3dsite"], ["Order and request app", "c3dapp"], ["Theme code", "ghtheme"]] },
  { brand: "ed", hops: [["Design", "studio"], ["List in one click", "publish"], ["Catalog and checkout", "shop"], ["Customers shop", "edsite"], ["Design your own", "shirtapp"], ["Theme code", "ghedtheme"]] },
];

export const CLEANUP = [
  { what: "Old Netlify account and its sites", why: "Nothing in the business uses Netlify any more; everything moved to Shopify, GitHub Pages and Cloudflare", fix: "Download anything you still want, then close the account" },
  { what: "Documents\\PrintRoomDeploy (31 MB zip plus copies)", why: "The old Print Room, no longer used", fix: "Delete the folder after a last look" },
  { what: "Old Wix site for charleston3d.com", why: "Plan canceled 8 Oct; the domain now points at the Shopify store, where the coded theme runs", fix: "Let the Wix site lapse" },
];

// How the whole system fits together, layer by layer (26 Oct 2026). Each node lists what it feeds
// and how, so the Service Map can draw the chain and every link opens the real thing.
// "planned" nodes don't exist yet (the OpenClaw node and the home server).
const CONSOLE_URL = "https://business-console.business-console.workers.dev";
export const TOPOLOGY = [
  { layer: "Domains and DNS", nodes: [
    { id: "dns-c3d", name: "charleston3d.com", where: "DNS managed at Wix", brand: "c3d",
      does: "Points the root and www at the Charleston3D Shopify store, and app. at GitHub Pages.",
      to: [["site-c3d", "root and www"], ["app-c3d", "app. CNAME"]],
      links: [{ label: "Wix domains", url: "https://manage.wix.com/account/domains" }, { label: "Shopify domains", url: `${BRANDS.c3d.site}/admin/settings/domains` }] },
    { id: "dns-ed", name: "elevatedshirts.com", where: "Primary domain on the Elevated Designs store", brand: "ed",
      does: "The store's primary domain (SSL on). design. points at GitHub Pages for the shirt app.",
      to: [["site-ed", "root and www"], ["app-ed", "design. CNAME"]],
      links: [{ label: "Shopify domains", url: `${BRANDS.ed.site}/admin/settings/domains` }] },
  ] },
  { layer: "What customers use", nodes: [
    { id: "site-c3d", name: "Charleston3D site", where: "Shopify theme", brand: "c3d",
      does: "Shop plus the Custom tab for custom requests.", to: [["store-c3d", "catalog, cart, checkout"]],
      links: [{ label: "Open site", url: BRANDS.c3d.site }] },
    { id: "app-c3d", name: "Charleston3D app", where: "GitHub Pages", brand: "c3d",
      does: "app.charleston3d.com: shop and the combined request page (photo and 3D file upload).", to: [["store-c3d", "Storefront API, checkout"]],
      links: [{ label: "Open app", url: BRANDS.c3d.app }] },
    { id: "site-ed", name: "Elevated Designs site", where: "Shopify theme (live since 26 Oct)", brand: "ed",
      does: "Shirts in auto-updating collections, with SEO and AI-crawler support built in.", to: [["store-ed", "catalog, cart, checkout"]],
      links: [{ label: "Open site", url: BRANDS.ed.site }] },
    { id: "app-ed", name: "Shirt design app", where: "GitHub Pages", brand: "ed",
      does: "design.elevatedshirts.com: people design a shirt and share it; orders pay through the Elevated Designs checkout.", to: [["store-ed", "cart permalink, checkout"]],
      links: [{ label: "Open app", url: BRANDS.ed.app }] },
  ] },
  { layer: "Stores (all payments)", nodes: [
    { id: "store-c3d", name: "Charleston3D store", where: "Shopify Basic", brand: "c3d",
      does: "Catalog, orders, payments and order emails. Custom requests land here as $0 orders.", to: [],
      links: [BRANDS.c3d.admin, { label: "Orders", url: `${BRANDS.c3d.site}/admin/orders` }] },
    { id: "store-ed", name: "Elevated Designs store", where: "Shopify Basic", brand: "ed",
      does: "Catalog, orders and payments. Store email staticupload170@gmail.com.", to: [],
      links: [BRANDS.ed.admin, { label: "Orders", url: `${BRANDS.ed.site}/admin/orders` }] },
  ] },
  { layer: "Back office (Cloudflare)", nodes: [
    { id: "console", name: "Business Console", where: "Cloudflare Worker, free plan", brand: "other",
      does: "This console. Behind CONSOLE_KEY. Publishes products, lists designs, prices, insights and marketing for both stores, each store on its own.",
      to: [["store-c3d", "Admin API"], ["store-ed", "Admin API"], ["kv", "reads and writes"], ["search", "Search Console, GA4, Bing, IndexNow"]],
      links: [{ label: "Open console", url: CONSOLE_URL }, { label: "Cloudflare dashboard", url: "https://dash.cloudflare.com" }] },
    { id: "kv", name: "Workers KV", where: "Same Cloudflare account", brand: "other",
      does: "IMAGES (design library), PRICING (price sync state), MARKETING (scores, change log, keywords).", to: [],
      links: [{ label: "KV in Cloudflare", url: "https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces" }] },
    { id: "crons", name: "Scheduled jobs", where: "Worker cron triggers (UTC)", brand: "other",
      does: "11:00 daily health check of both sites. 11:30 daily safe SEO fixes. Every 15 minutes the shirt price sync steps on. Hourly at :45 the image library follows the Kittl library.",
      to: [["console", "runs inside the Worker"]], links: [] },
  ] },
  { layer: "Code and deploys (GitHub)", nodes: [
    { id: "gh-console", name: "Business-console", where: "GitHub Actions deploys main to Cloudflare", brand: "other",
      does: "Console code. Tests run before every deploy.", to: [["console", "wrangler deploy"]],
      links: [{ label: "Repository", url: "https://github.com/Adub843/Business-console" }, { label: "Actions", url: "https://github.com/Adub843/Business-console/actions" }] },
    { id: "gh-c3d", name: "charleston3d-site", where: "Shopify GitHub integration", brand: "c3d",
      does: "Charleston3D theme.", to: [["site-c3d", "theme sync"]],
      links: [{ label: "Repository", url: "https://github.com/Adub843/charleston3d-site" }] },
    { id: "gh-c3dapp", name: "charleston3d-app", where: "GitHub Pages", brand: "c3d",
      does: "Charleston3D order app.", to: [["app-c3d", "Pages"]],
      links: [{ label: "Repository", url: "https://github.com/Adub843/charleston3d-app" }] },
    { id: "gh-ed", name: "elevated-designs-site", where: "Theme uploaded to Shopify", brand: "ed",
      does: "Elevated Designs theme. The live theme was uploaded, so new commits need a re-upload until GitHub sync is connected.", to: [["site-ed", "theme upload"]],
      links: [{ label: "Repository", url: "https://github.com/Adub843/elevated-designs-site" }] },
    { id: "gh-edapp", name: "elevated-shirt-app", where: "GitHub Actions to Pages", brand: "ed",
      does: "Shirt design app.", to: [["app-ed", "Pages"]],
      links: [{ label: "Repository", url: "https://github.com/Adub843/elevated-shirt-app" }] },
  ] },
  { layer: "Outside tools", nodes: [
    { id: "kittl", name: "Kittl", where: "Design library (about 5,190 images)", brand: "ed",
      does: "Where shirt art is made. The hourly sync copies new library art into the console's image library and removes deleted art.", to: [["kv", "hourly sync to IMAGES"]],
      links: [{ label: "Open Kittl", url: "https://www.kittl.com" }] },
    { id: "sheet", name: "Shirt price sheet", where: "Google Sheets", brand: "ed",
      does: "Blank cost per brand, style and size. The 15-minute sync reprices every Elevated Designs shirt from it.", to: [["console", "read by the price sync"]],
      links: [{ label: "Open sheet", url: "https://docs.google.com/spreadsheets/d/11G7MyaGqSaz3WCd21etMYc-YebpAbyKzmvE1aqNWpy8/edit" }] },
    { id: "search", name: "Google and Bing", where: "Search Console, GA4, Bing Webmaster, IndexNow", brand: "other",
      does: "Search clicks, positions and engagement for the Marketing page; IndexNow tells Bing about changed pages.", to: [],
      links: [{ label: "Search Console", url: "https://search.google.com/search-console" }, { label: "Google Analytics", url: "https://analytics.google.com" }, { label: "Bing Webmaster", url: "https://www.bing.com/webmasters" }] },
    { id: "suppliers", name: "Blank suppliers", where: "BulkApparel and ShirtSpace", brand: "ed",
      does: "Where the blank shirts are bought. Their costs feed the price sheet.", to: [["sheet", "blank costs"]],
      links: [{ label: "BulkApparel", url: "https://www.bulkapparel.com" }, { label: "ShirtSpace", url: "https://www.shirtspace.com" }] },
  ] },
  { layer: "Planned: home lab", planned: true, nodes: [
    { id: "openclaw", name: "OpenClaw node", where: "Beelink SER9 Pro mini PC, local model", brand: "other", planned: true,
      does: "Local agents that take over routine work: checking the Marketing page, the price sync and orders through the console's API, with the console key kept on that machine only.",
      to: [["console", "HTTPS API with CONSOLE_KEY"], ["tailnet", "remote access"]], links: [] },
    { id: "server", name: "Home server", where: "Current PC, after the move", brand: "other", planned: true,
      does: "Backups of the repos, image library export and business files; file share for the small network.", to: [["tailnet", "remote access"]], links: [] },
    { id: "tailnet", name: "Tailscale", where: "Private network between your machines", brand: "other", planned: true,
      does: "Lets the mini PC, the server and your laptop reach each other without opening ports.", to: [],
      links: [{ label: "Tailscale machines", url: "https://login.tailscale.com/admin/machines" }] },
  ] },
];
