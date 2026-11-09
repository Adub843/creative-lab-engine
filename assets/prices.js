// Price sheet: every Elevated Designs blank, size by size, read from the Google price sheet through
// GET /api/pricing?store=ed&view=sheet. Shows what each size costs from the suppliers, the price the
// store charges for the plain blank and for a printed design (+ the design markup), and the price sync.
// Read only: prices are changed in the sheet itself, and the 15-minute sync carries them to the store.
import { el } from "./app.js";
import { api, money } from "./api.js";

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const sizeRank = (s) => { const i = SIZE_ORDER.indexOf(String(s).toUpperCase()); return i < 0 ? 99 : i; };
const cash = (n) => (n == null ? "–" : money(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

function stateBox(kind, heading, text, actions = []) {
  return el("div", { class: `state state-${kind}`, role: kind === "error" ? "alert" : null },
    el("strong", {}, heading), el("p", {}, text), actions.length ? el("div", { class: "row" }, actions) : null);
}

// One blank per group, its sizes in order.
function groupRows(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.id)) by.set(r.id, { id: r.id, brand: r.brand, style: r.style, name: r.name, type: r.type, sizes: [] });
    by.get(r.id).sizes.push(r);
  }
  for (const g of by.values()) g.sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  return [...by.values()];
}

function syncPanel(sync) {
  if (!sync) return null;
  const r = sync.report;
  const line = sync.error ? `The last sync stopped: ${sync.error}`
    : sync.phase === "querying" ? "A sync is reading the store's shirts now."
    : sync.phase === "applying" ? "A sync is writing new prices to the store now."
    : sync.finishedAt ? `Last sync ${when(sync.finishedAt)}: ${r?.changed ?? 0} price${r?.changed === 1 ? "" : "s"} changed, ${r?.unchanged ?? 0} already right.`
    : "The sync hasn't run yet.";
  return el("p", { class: "muted small" }, line, " It checks the sheet every 15 minutes.");
}

export async function renderPrices() {
  const body = el("div", { class: "stack" }, el("p", { class: "muted" }, "Reading the price sheet…"));
  let data, sync = null;

  async function load() {
    body.replaceChildren(el("p", { class: "muted" }, "Reading the price sheet…"));
    try {
      [data, sync] = await Promise.all([
        api("/api/pricing?store=ed&view=sheet", { key: true, reason: "The price sheet shows supplier costs, so it needs the console key." }),
        api("/api/pricing?store=ed", { key: true }).catch(() => null),
      ]);
    } catch (e) {
      const setup = e.code === "sheet_not_set_up" || e.code === "sheet_access" || e.code === "no_api";
      body.replaceChildren(stateBox(setup ? "setup" : "error", "Couldn't read the price sheet", e.message,
        [el("button", { class: "btn", type: "button", onclick: load }, "Try again"),
          el("a", { class: "btn", href: SHEET_URL, target: "_blank", rel: "noopener" }, "Open the sheet in Google", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))]));
      return;
    }
    draw();
  }

  function draw() {
    const groups = groupRows(data.rows);
    const types = [...new Set(groups.map((g) => g.type).filter(Boolean))];
    let type = "all", q = "", offeredOnly = true;

    const offered = groups.filter((g) => g.sizes.some((s) => s.offered));
    const prices = data.rows.filter((r) => r.price != null).map((r) => r.price);
    const kpis = el("div", { class: "kpis" },
      el("div", { class: "kpi", style: "cursor:default" }, el("b", {}, String(offered.length)), el("span", {}, "blanks on offer")),
      el("div", { class: "kpi", style: "cursor:default" }, el("b", {}, String(data.rows.filter((r) => r.offered && r.price != null).length)), el("span", {}, "sizes with a price")),
      prices.length ? el("div", { class: "kpi", style: "cursor:default" }, el("b", {}, `${cash(Math.min(...prices))}–${cash(Math.max(...prices))}`), el("span", {}, "plain blank price range")) : null,
      el("div", { class: "kpi", style: "cursor:default" }, el("b", {}, `+${cash(data.markup)}`), el("span", {}, "added for a printed design")));

    const search = el("input", { class: "field", type: "search", placeholder: "Search brand, style or name", "aria-label": "Search the price sheet",
      oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
    const chips = el("div", { class: "toolbar", role: "group", "aria-label": "Type" },
      ["all", ...types].map((t) => el("button", { class: "chip", type: "button", "aria-pressed": String(t === type),
        onclick: (e) => { type = t; chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); paint(); } },
        t === "all" ? "All" : t)));
    const offerBox = el("label", { class: "row small", style: "gap:6px" },
      el("input", { type: "checkbox", checked: true, onchange: (e) => { offeredOnly = e.target.checked; paint(); } }), "Only blanks on offer");
    const out = el("div", { class: "stack" });

    function paint() {
      const show = groups.filter((g) => (type === "all" || g.type === type)
        && (!offeredOnly || g.sizes.some((s) => s.offered))
        && (!q || `${g.brand} ${g.style} ${g.name} ${g.id}`.toLowerCase().includes(q)));
      if (!show.length) { out.replaceChildren(stateBox("empty", "Nothing matches", "Try another search or type.")); return; }
      out.replaceChildren(el("div", { class: "tbl price-tbl" }, el("table", {},
        el("caption", { class: "sr" }, "Elevated Designs shirt prices by blank and size"),
        el("thead", {}, el("tr", {}, ["Size", "Cost", "Suggested", "Your price", "Blank sells at", "Design sells at", "On offer"].map((h, i) => el("th", { scope: "col", class: [2, 3, 6].includes(i) ? "opt" : null }, h)))),
        el("tbody", {}, show.flatMap((g) => [
          el("tr", { class: "price-group" }, el("th", { scope: "rowgroup", colspan: "7" },
            el("strong", {}, `${g.brand} ${g.style}`), " ", el("span", { class: "muted small" }, `${g.name}${g.type ? ` · ${g.type}` : ""}`))),
          ...g.sizes.map((s) => el("tr", { class: s.offered ? null : "muted" },
            el("td", { "data-label": "Size" }, s.size),
            el("td", { "data-label": "Cost", title: [s.shirtspace != null ? `ShirtSpace ${cash(s.shirtspace)}` : null, s.bulkapparel != null ? `BulkApparel ${cash(s.bulkapparel)}` : null].filter(Boolean).join(" · ") || null }, cash(s.cost)),
            el("td", { "data-label": "Suggested", class: "opt" }, cash(s.suggested)),
            el("td", { "data-label": "Your price", class: "opt" }, cash(s.yours)),
            el("td", { "data-label": "Blank sells at" }, s.offered ? el("strong", {}, cash(s.price)) : "–"),
            el("td", { "data-label": "Design sells at" }, s.offered ? cash(s.designPrice) : "–"),
            el("td", { "data-label": "On offer", class: "opt" }, s.offered ? "Yes" : "No")))])))));
    }
    paint();

    body.replaceChildren(...[
      data.source === "bundled" ? stateBox("setup", "Showing the copy saved with the console",
        "The console can't read the live sheet yet (no Google service account is set). These prices are the copy bundled with the console; the live sheet wins once it's connected.") : null,
      kpis,
      el("section", { class: "panel" },
        el("div", { class: "panel-head" },
          el("div", { class: "stack", style: "gap:2px" }, el("h2", {}, "Prices by blank and size"), syncPanel(sync)),
          el("div", { class: "row" },
            el("button", { class: "btn", type: "button", onclick: load }, "Reload"),
            el("a", { class: "btn primary", href: data.sheetUrl ?? SHEET_URL, target: "_blank", rel: "noopener" }, "Edit in Google Sheets", el("span", { class: "ext", "aria-hidden": "true" }, "↗")))),
        el("p", { class: "muted small" }, "Blank sells at = your price when you set one, else the suggested price (cost × 2 + $8 print fee, rounded up to .99). Design sells at adds the design markup. Change a price in the sheet and the store follows within 15 minutes."),
        el("div", { class: "toolbar" }, search, offerBox), chips, out)].filter(Boolean));
  }

  await load();
  return body;
}

const SHEET_URL = "https://docs.google.com/spreadsheets/d/11G7MyaGqSaz3WCd21etMYc-YebpAbyKzmvE1aqNWpy8/edit";
