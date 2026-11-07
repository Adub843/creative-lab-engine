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
  { id: "makerstudio", group: "make", store: "c3d", name: "Maker Studio", ico: "⬡",
    sub: "Every maker in one place: nameplates, hype chains, light boxes, keychains, signs and plate frames",
    frame: "tools/maker-studio/" },
  { id: "maker3d", group: "make", store: "c3d", name: "3D maker", ico: "◈", page: "maker3d",
    sub: "Photos or a few words in, a printable 3D model out (Meshy)" },

  // Library: the art library and the E: drive came over from the Design Studio on 2026-11-07. Each store's
  // Art library shows only its own brand's art (Elevated Designs includes its EPIX3D label).
  { id: "library", group: "library", store: "ed", name: "Art library", ico: "▦", page: "designs",
    sub: "Every Elevated Designs and EPIX3D image, with categories and brands; ticked ones feed the shirt app" },
  { id: "artc3d", group: "library", store: "c3d", name: "Art library", ico: "▦", page: "designs",
    sub: "Charleston 3D's logos, photos and art, private to the team" },
  { id: "files", group: "library", store: "c3d", name: "3D file library", ico: "▦", page: "files",
    sub: "Every print file (STL, 3MF, OBJ, STEP) and photo, with a preview of each model" },
  { id: "drive", group: "library", name: "E: drive", ico: "◫", page: "drive",
    sub: "Every design file on the E: drive, with previews, while Aaron's PC is on" },

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
