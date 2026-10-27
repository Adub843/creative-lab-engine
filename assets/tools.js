// Every tool in the console, grouped the way Aaron works: Research what to sell, Make it, keep it in the
// Library, then Stats & marketing. Each tool belongs to ONE store (CLAUDE.md rule 3: the brands never mix),
// so the sidebar only shows the selected store's tools.
//   page: an in-console page (route = id)
//   frame: a self-contained tool app served from /tools/<slug>/ and shown inside the console
//   url: an outside link that opens in a new tab
export const GROUPS = [
  { id: "research", name: "Research" },
  { id: "make", name: "Make" },
  { id: "library", name: "Library" },
  { id: "grow", name: "Stats & marketing" },
  { id: "store", name: "Store" },
  { id: "system", name: "System" },
];

export const TOOLS = [
  // Research
  { id: "trends", group: "research", store: "c3d", name: "Print trends", ico: "↗",
    sub: "What's selling in 3D prints: trending models, Etsy best sellers, rising searches",
    frame: "tools/print-trends/" },

  // Make
  { id: "studio", group: "make", store: "ed", name: "Shirt designer", ico: "✎", page: "studio",
    sub: "Place library art on a real shirt photo, export the print file and mockup" },
  { id: "list", group: "make", store: "ed", name: "List a design", ico: "＋", page: "products", path: "list",
    sub: "One click to the Elevated Designs store, with description, SEO and mockups" },
  { id: "nameplate", group: "make", store: "c3d", name: "Nameplate maker", ico: "▭",
    sub: "Type a name, pick a style, download a Bambu-ready 3MF or STL",
    frame: "tools/nameplate-maker/" },
  { id: "hypechain", group: "make", store: "c3d", name: "Hype chain maker", ico: "◇",
    sub: "Custom pendant designer: logo or text to a printable chain pendant",
    frame: "tools/hype-chain-maker/" },
  { id: "maker", group: "make", store: "c3d", name: "Maker", ico: "◫",
    sub: "Picture in, Bambu file out: light boxes, keychains, signs and lithophanes",
    frame: "tools/maker/" },

  // Library
  { id: "library", group: "library", store: "ed", name: "Design library", ico: "▦", page: "studio", path: "library",
    sub: "Every Elevated Designs image; ticked ones feed the shirt app" },
  { id: "files", group: "library", store: "c3d", name: "3D file library", ico: "▦", page: "files",
    sub: "Every print file (STL, 3MF, OBJ, STEP) and photo, with a preview of each model" },

  // Stats & marketing
  { id: "insights", group: "grow", name: "Insights", ico: "↗", page: "insights", sub: "Sales, visits and a 30-day forecast" },
  { id: "marketing", group: "grow", name: "Marketing", ico: "◎", page: "marketing", sub: "SEO, Bing and AI search, fixed every morning" },
  { id: "share", group: "grow", name: "Share & QR", ico: "▣", page: "share", sub: "Every link for this store, with a QR code to print, copy or send" },
  { id: "promote", group: "grow", name: "Promotions", ico: "%", page: "promote", sub: "Discounts, gift cards, customer groups, campaigns" },

  // Store
  { id: "products", group: "store", name: "Products", ico: "▤", page: "products", sub: "What's live on the site" },
  { id: "orders", group: "store", name: "Orders", ico: "▣", url: (b) => `${b.site}/admin/orders`, sub: "Shopify admin" },

  // System
  { id: "team", group: "system", name: "Team", ico: "☰", page: "team", sub: "Tasks for you and the agents, and when each job runs" },
  { id: "map", group: "system", name: "Service map", ico: "⇄", page: "map", sub: "Where every site, store and tool lives" },
];

export const toolsFor = (store) => TOOLS.filter((t) => !t.store || t.store === store);
export const toolById = (id) => TOOLS.find((t) => t.id === id);
