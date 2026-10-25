// Everything the console knows about the two businesses and the services behind them.
// Mapped 18 Oct 2026 from the connected Netlify, Wix and Shopify accounts and account emails.
// 25 Oct 2026: both store sites are Shopify themes on their own stores (no Netlify hosting), and
// each brand has its own theme repo: Charleston 3D in charleston3d-site, Elevated Designs in
// elevated-designs-site (not created yet). Nothing here is shared between the two brands.
// "probably" in a description means it was inferred from a name or setup, not opened.

const nl = (n) => [
  { label: "Open in Netlify", url: `https://app.netlify.com/projects/${n}` },
  { label: "Open live site", url: `https://${n}.netlify.app` },
];
const nlAdmin = (n) => [{ label: "Open in Netlify", url: `https://app.netlify.com/projects/${n}` }];

export const BRANDS = {
  c3d: {
    name: "Charleston 3D",
    tagline: "Personalized 3D printed gifts, sold on a hand-coded Shopify theme with Shopify checkout",
    site: "https://charleston3d.com",
    admin: { label: "Shopify admin", url: "https://charleston3d.com/admin" },
  },
  ed: {
    name: "Elevated Designs",
    tagline: "Custom apparel and print designs, sold on a hand-coded Shopify theme with Shopify checkout",
    site: "https://theelevateddesignsllc.com",
    admin: { label: "Shopify admin", url: "https://theelevateddesignsllc.com/admin" },
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
  { id: "c3dsite", name: "charleston3d.com", brand: "c3d", kind: "Website · Shopify theme", status: "attn",
    does: "Charleston 3D's storefront: a hand-coded Shopify theme running on the Charleston3D store. Products, prices and checkout come live from Shopify, so a product switched on in Products shows up at once. No Netlify, no build step.",
    source: "GitHub: Adub843/charleston3d-site, branch claude/shopify-theme (Charleston 3D only)",
    note: "The coded theme is being finished in Oct 2026; the live theme is still \"Charleston3D Lowcountry\" until it's published. The old Wix plan was canceled on 8 Oct.",
    links: [{ label: "Products on the site", url: "#products/c3d" }, { label: "Insights", url: "#insights/c3d" },
      { label: "Open live site", url: BRANDS.c3d.site }, { label: "Themes in Shopify", url: `${BRANDS.c3d.site}/admin/themes` }] },
  { id: "c3dshop", name: "Charleston3D store", brand: "c3d", kind: "Store backend · Shopify", status: "live",
    does: "Shopify store (Basic plan) that holds the Charleston 3D catalog, hosts the site, takes payment and sends order emails.",
    links: [BRANDS.c3d.admin, { label: "Orders", url: `${BRANDS.c3d.site}/admin/orders` }, { label: "Products", url: `${BRANDS.c3d.site}/admin/products` }] },
  { id: "hype", source: "Your PC: Documents\\hype-chain-maker-site", name: "hype-chain-maker", brand: "c3d", kind: "Web app · Netlify", status: "live",
    does: "3D-print maker tool that exports .3MF files, with an order form and library and orders functions.",
    links: nl("hype-chain-maker") },
  { id: "npm", name: "nameplate-maker", brand: "c3d", kind: "Web app · Netlify", status: "live",
    does: "Probably a nameplate design tool for printing.", links: nl("nameplate-maker") },
  { id: "ff", name: "3d-print-file-finder", brand: "c3d", kind: "Web app · Netlify", status: "live",
    does: "Probably a tool for finding 3D-print files.", links: nl("3d-print-file-finder") },
  { id: "pt", source: "Your PC: Documents\\print-trends", name: "print-trends", brand: "c3d", kind: "Web app · Netlify", status: "live",
    does: "Probably tracks what's selling in 3D prints.", links: nl("print-trends") },
  { id: "noz", name: "nozzlelog", brand: "c3d", kind: "Placeholder · Netlify", status: "empty",
    does: "Created but never launched. Probably meant as a printer log.", links: nlAdmin("nozzlelog") },
  { id: "ll", name: "layerledger-agxn", brand: "c3d", kind: "Placeholder · Netlify", status: "empty",
    does: "Created but never launched. Probably meant as a print cost ledger.", links: nlAdmin("layerledger-agxn") },

  // Elevated Designs
  { id: "edsite", name: "theelevateddesignsllc.com", brand: "ed", kind: "Website · Shopify theme", status: "attn",
    does: "Elevated Designs' storefront: its own hand-coded Shopify theme, separate from Charleston 3D, running on the Elevated Designs Shopify store. Products and checkout come live from Shopify.",
    source: "GitHub: Adub843/elevated-designs-site (not created yet)",
    note: "Not built yet; the store keeps its current theme until then. The new theme can start from the Charleston3D theme as it was at commit 9020272, before the Elevated Designs preset was taken out.",
    links: [{ label: "Products on the site", url: "#products/ed" }, { label: "Insights", url: "#insights/ed" },
      { label: "Open live site", url: BRANDS.ed.site }, { label: "Themes in Shopify", url: `${BRANDS.ed.site}/admin/themes` }] },
  { id: "shop", name: "Elevated Designs store", brand: "ed", kind: "Store backend · Shopify", status: "live",
    does: "Shopify store (Basic plan) that holds the Elevated Designs catalog, hosts theelevateddesignsllc.com and takes payment.",
    note: "The store's contact email is staticupload170@gmail.com, not the main Gmail.",
    links: [BRANDS.ed.admin, { label: "Open live store", url: BRANDS.ed.site },
      { label: "Products", url: `${BRANDS.ed.site}/admin/products` },
      { label: "Orders", url: `${BRANDS.ed.site}/admin/orders` }] },
  { id: "cpd", name: "Elevated Designs app", brand: "ed", kind: "Design app · Netlify (not the store)", status: "live",
    does: "Your previous console, at charlestonprintdesigns.netlify.app. Every design with its Etsy listing text and photos, the 30-day launch plan, the Charleston market calendar and your business docs. It syncs between devices with a passcode.",
    source: "Your PC: Documents\\GitHub\\elevated -designs (a local git copy, not on GitHub yet). Its README says it is the only source for this site.",
    note: "Its 330 MB of design photos only exist on your PC and in the live site, so there is no backup of this app's code or images online.",
    links: [{ label: "Designs", url: "https://charlestonprintdesigns.netlify.app/#/" },
      { label: "Launch plan", url: "https://charlestonprintdesigns.netlify.app/#/plan" },
      { label: "Market calendar", url: "https://charlestonprintdesigns.netlify.app/#/cal" },
      { label: "Docs", url: "https://charlestonprintdesigns.netlify.app/#/docs" },
      ...nlAdmin("charlestonprintdesigns")] },
  { id: "shirtapp", name: "Elevated Designs shirt app", brand: "ed", kind: "Web app · in progress", status: "empty",
    does: "Customers design a shirt from the public part of the image library; their orders are paid through the Elevated Designs Shopify checkout, so they land in the Elevated Designs orders.",
    note: "Being built separately. Add its address here once it's live.",
    links: [{ label: "Orders in Shopify", url: `${BRANDS.ed.site}/admin/orders` }] },
  { id: "ghedtheme", name: "GitHub · elevated-designs-site", brand: "ed", kind: "Code storage · GitHub", status: "empty",
    does: "Will be the single home for Elevated Designs' own Shopify theme. Not created yet.",
    links: [{ label: "Your GitHub repositories", url: "https://github.com/Adub843?tab=repositories" }] },
  { id: "studio", name: "Design Studio", brand: "ed", kind: "In this console", status: "live",
    does: "Image library and shirt designer. Images are stored online, so your PC doesn't need to be on. Any library design can be listed on the Elevated Designs store in one click from Products (Elevated Designs).",
    links: [{ label: "Open Design Studio", url: "#studio" }] },
  { id: "publish", name: "Products and Insights", brand: "other", kind: "In this console · both stores", status: "live",
    does: "Switch products on or off each store's Shopify site, choose which Charleston 3D products are customizable (the theme then asks for a name to print), list a library design on Elevated Designs in one click, and see sales, visits, a 30-day forecast and next steps for each store.",
    links: [{ label: "Products", url: "#products" }, { label: "List a design (Elevated Designs)", url: "#products/ed/list" }, { label: "Insights", url: "#insights" }] },

  // Content and video
  { id: "btd", source: "Your PC: Documents\\briefline-trend-desk", name: "briefline-trend-desk", brand: "other", kind: "Web app · Netlify", status: "attn",
    does: "Trend dashboard. Two functions (scan-a, scan-b) run by themselves every 3 hours.",
    note: "Scheduled scans use Netlify credits around the clock. The team hit 75% of 3,000 credits by 12 Oct.",
    links: nl("briefline-trend-desk") },
  { id: "vs", source: "Your PC: Documents\\video-studio", name: "video-studio-hq", brand: "other", kind: "Web app · Netlify", status: "live",
    does: "Single-page video studio tool.", links: nl("video-studio-hq") },
  { id: "fvc", name: "funnyvideoclips-submit", brand: "other", kind: "Website · Netlify", status: "live",
    does: "Clip submission page with terms and privacy pages.", links: nl("funnyvideoclips-submit") },
  { id: "kc", name: "keen-churros-30a1df", brand: "other", kind: "Website · Netlify", status: "attn",
    does: "Looks like an exact copy of funnyvideoclips-submit.", links: nl("keen-churros-30a1df") },
  { id: "yt", name: "YouTube", brand: "other", kind: "Video · YouTube", status: "blind",
    does: "Final home for videos. Not connected yet, so the console can't see the channel.",
    links: [{ label: "Open YouTube Studio", url: "https://studio.youtube.com" }] },

  // Other apps
  { id: "oops", source: "Your PC: Documents\\oops-i-bought-a-house", name: "oops-i-bought-a-house", brand: "other", kind: "Web app · Netlify", status: "live",
    does: "Two-page app with identify and vision functions.", links: nl("oops-i-bought-a-house") },
  { id: "pr", name: "partreiver", brand: "other", kind: "Web app · Netlify", status: "attn",
    does: "Same two functions as oops-i-bought-a-house, byte for byte. Probably a copy.", links: nl("partreiver") },
  { id: "care", name: "carelinked", brand: "other", kind: "Web app · Netlify", status: "live", does: "Static app.", links: nl("carelinked") },
  { id: "pw", name: "penny-wise-app", brand: "other", kind: "Web app · Netlify", status: "live", does: "Budget app.", links: nl("penny-wise-app") },
  { id: "wn", name: "workflow-notes", brand: "other", kind: "Web app · Netlify", status: "attn",
    does: "Notes app. Overlaps with workflow-journal.", links: nl("workflow-notes") },
  { id: "wj", name: "workflow-journal", brand: "other", kind: "Web app · Netlify", status: "live",
    does: "Journal app. Its deploy is locked, so new uploads won't go live until it's unlocked.", links: nl("workflow-journal") },
  { id: "ronchi", name: "ronchi-service-workbook", brand: "other", kind: "Web app · Netlify", status: "live",
    does: "Service workbook with an expense page.", links: nl("ronchi-service-workbook") },
  { id: "cl", name: "creative-lab-hq", brand: "other", kind: "Placeholder · Netlify", status: "empty",
    does: "Created but never launched.", links: nlAdmin("creative-lab-hq") },
  { id: "cll", name: "creativelab-links", brand: "other", kind: "Placeholder · Netlify", status: "empty",
    does: "Created but never launched. A second copy of creative-lab-hq.", links: nlAdmin("creativelab-links") },

  // Accounts
  { id: "gh", name: "GitHub · Business-console", brand: "other", kind: "Code storage · GitHub", status: "live",
    does: "The single home for this console's code.",
    links: [{ label: "Open repository", url: "https://github.com/Adub843/Business-console" }] },
  { id: "ghtheme", name: "GitHub · charleston3d-site", brand: "c3d", kind: "Code storage · GitHub", status: "live",
    does: "The single home for Charleston 3D's Shopify theme. Charleston 3D only; Elevated Designs gets its own repo.",
    links: [{ label: "Open theme code", url: "https://github.com/Adub843/charleston3d-site/tree/claude/shopify-theme" }] },
  { id: "nlteam", name: "Netlify team", brand: "other", kind: "Hosting account · Netlify", status: "attn",
    does: "Hosts 30 sites on the Pro plan: 16 live, 14 never launched.",
    note: "75% of this month's 3,000 credits used by 12 Oct. The cycle runs to 5 Nov.",
    links: [{ label: "Open Netlify", url: "https://app.netlify.com" }] },
  { id: "ts", name: "Tailscale", brand: "other", kind: "Private network · Tailscale", status: "blind",
    does: "Probably links your computers together. Not connected to the console.",
    links: [{ label: "Open Tailscale machines", url: "https://login.tailscale.com/admin/machines" }] },
];

["tokentab-y54f", "seasontab", "stewardbook", "clipreceipt", "enrollmath", "jobsheetly", "hophaul", "slotsheet", "presslist-pi9y", "proofshot-zd4k"]
  .forEach((n) => SERVICES.push({ id: n, name: n, brand: "other", kind: "Placeholder · Netlify", status: "empty",
    does: "Created but never launched.", links: nlAdmin(n) }));

export const ROUTES = [
  { brand: "c3d", hops: [["Pick products, set customizable", "publish"], ["Catalog and checkout", "c3dshop"], ["Customers shop", "c3dsite"], ["Theme code", "ghtheme"]] },
  { brand: "ed", hops: [["Design ideas", "cpd"], ["Design", "studio"], ["List in one click", "publish"], ["Catalog and checkout", "shop"], ["Customers shop", "edsite"], ["Theme code", "ghedtheme"]] },
  { brand: "other", hops: [["Spot trends", "btd"], ["Make videos", "vs"], ["Collect clips", "fvc"], ["Publish", "yt"]] },
];

export const CLEANUP = [
  { what: "14 sites that never launched", why: "Empty placeholders cluttering the account", fix: "Delete after you confirm none are planned" },
  { what: "keen-churros-30a1df", why: "Same as funnyvideoclips-submit", fix: "Delete the copy" },
  { what: "partreiver and oops-i-bought-a-house", why: "Identical functions and layout", fix: "Keep one" },
  { what: "workflow-notes and workflow-journal", why: "Two note apps", fix: "Merge into one" },
  { what: "creative-lab-hq and creativelab-links", why: "Two empty versions of one idea", fix: "Delete both" },
  { what: "briefline-trend-desk scans every 3 hours", why: "Likely the biggest drain on Netlify credits", fix: "Slow to once or twice a day" },
  { what: "Documents\\PrintRoomDeploy (31 MB zip plus copies)", why: "The old Print Room, already merged into the Elevated Designs app", fix: "Delete the folder after a last look" },
  { what: "Elevated Designs app has no online backup", why: "Code and 330 MB of photos live only on your PC and the live site", fix: "Push its code to GitHub and keep photos in cloud storage" },
  { what: "Old Wix site for charleston3d.com", why: "Plan canceled 8 Oct; the domain now points at the Shopify store, where the coded theme runs", fix: "Let the Wix site lapse" },
  { what: "charleston3d-site Astro build on Netlify", why: "Replaced by the Shopify theme; the store sites are no longer hosted on Netlify", fix: "Delete the Netlify site and its build hook once the theme is live" },
];
