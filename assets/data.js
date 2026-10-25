// Everything the console knows about the two businesses and the services behind them.
// Mapped 18 Oct 2026 from the connected Netlify, Wix and Shopify accounts and account emails.
// "probably" in a description means it was inferred from a name or setup, not opened.

const nl = (n) => [
  { label: "Open in Netlify", url: `https://app.netlify.com/projects/${n}` },
  { label: "Open live site", url: `https://${n}.netlify.app` },
];
const nlAdmin = (n) => [{ label: "Open in Netlify", url: `https://app.netlify.com/projects/${n}` }];

export const BRANDS = {
  c3d: {
    name: "Charleston 3D",
    tagline: "Personalized 3D printed gifts, sold on a coded site with Shopify checkout",
    site: "https://charleston3d.com",
    admin: { label: "Shopify admin", url: "https://admin.shopify.com/" },
  },
  ed: {
    name: "Elevated Designs",
    tagline: "Custom apparel and designs, sold on Shopify",
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
  { id: "c3dsite", name: "charleston3d.com", brand: "c3d", kind: "Website · Netlify + Shopify", status: "attn",
    does: "Charleston 3D's coded storefront (Astro on Netlify). Products come from Shopify and checkout is Shopify's. Pick what's on it from the Products page.",
    source: "GitHub: Adub843/charleston3d-site",
    note: "Being built in Oct 2026. charleston3d.com is set as the Shopify store's domain until the new site goes live. The old Wix plan was canceled on 8 Oct.",
    links: [{ label: "Products on the site", url: "#products" }, { label: "Open live site", url: BRANDS.c3d.site }] },
  { id: "c3dshop", name: "Charleston3D store", brand: "c3d", kind: "Store backend · Shopify", status: "live",
    does: "Shopify store (Basic plan) that holds the Charleston 3D catalog, takes payment and sends order emails. Moving checkout to Stripe is planned for January.",
    links: [BRANDS.c3d.admin] },
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
  { id: "shop", name: "Elevated Designs store", brand: "ed", kind: "Online store · Shopify", status: "live",
    does: "Shopify store at theelevateddesignsllc.com on the Basic plan.",
    note: "The store's contact email is staticupload170@gmail.com, not the main Gmail.",
    links: [BRANDS.ed.admin, { label: "Open live store", url: BRANDS.ed.site },
      { label: "Products", url: "https://theelevateddesignsllc.com/admin/products" },
      { label: "Orders", url: "https://theelevateddesignsllc.com/admin/orders" }] },
  { id: "cpd", name: "Elevated Designs app", brand: "ed", kind: "Web app · Netlify", status: "live",
    does: "Your previous console, at charlestonprintdesigns.netlify.app. Every design with its Etsy listing text and photos, the 30-day launch plan, the Charleston market calendar and your business docs. It syncs between devices with a passcode.",
    source: "Your PC: Documents\\GitHub\\elevated -designs (a local git copy, not on GitHub yet). Its README says it is the only source for this site.",
    note: "Its 330 MB of design photos only exist on your PC and in the live site, so there is no backup of this app's code or images online.",
    links: [{ label: "Designs", url: "https://charlestonprintdesigns.netlify.app/#/" },
      { label: "Launch plan", url: "https://charlestonprintdesigns.netlify.app/#/plan" },
      { label: "Market calendar", url: "https://charlestonprintdesigns.netlify.app/#/cal" },
      { label: "Docs", url: "https://charlestonprintdesigns.netlify.app/#/docs" },
      ...nlAdmin("charlestonprintdesigns")] },
  { id: "studio", name: "Design Studio", brand: "ed", kind: "In this console", status: "live",
    does: "Image library and shirt designer. Images are stored online, so your PC doesn't need to be on.",
    links: [{ label: "Open Design Studio", url: "#studio" }] },

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
  { brand: "c3d", hops: [["Pick products", "c3dsite"], ["Catalog and checkout", "c3dshop"], ["Customers find you", "c3dsite"], ["Code", "gh"]] },
  { brand: "ed", hops: [["Design", "studio"], ["Catalog and listings", "cpd"], ["Sell", "shop"], ["Code", "gh"]] },
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
  { what: "Old Wix site for charleston3d.com", why: "Plan canceled 8 Oct; the domain is now set up in Shopify and will move to the new coded site", fix: "Let the Wix site lapse once the new site is live" },
];
