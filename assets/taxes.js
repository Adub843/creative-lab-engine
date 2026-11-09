// Taxi: the tax agent page in Creative Lab Studios (Money > Taxi) (/api/taxes, lib/taxes.mjs). Both stores belong to one LLC and one tax
// return, so this page shows both, each in its own column and color. Everything is plain English and in grids:
// what to move this Friday, where every sale's money goes, weekly and monthly totals, the year, deadlines with
// links, receipts and screenshots by week, and Taxi's own daily log.
import { el, toast } from "./app.js";
import { STORES, api, consoleKey, money } from "./api.js";

const API = "/api/taxes";
// In Creative Lab Studios every call goes to the engine through Aaron's Cloudflare connector (window.ENGINE,
// js/engine.js), which signs it with the engine's own key; on the engine's own address it's a plain fetch.
const call = (url, init) => (window.ENGINE ? window.ENGINE.fetch(url, init) : fetch(url, init));
// Dialogs open inside the page's own spot in Creative Lab Studios, so they keep its look.
const portal = () => (typeof window.ENG_PORTAL === "function" && window.ENG_PORTAL()) || document.body;
const KEY_REASON = "Taxes are private, so Taxi needs the console key (the CONSOLE_KEY value set for this console).";
const day = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
const dayY = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const $ = (n) => money(n ?? 0);
const pct = (r) => `${Math.round((r ?? 0) * 1000) / 10}%`;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ext = (href, label) => el("a", { href, target: "_blank", rel: "noopener" }, label, el("span", { class: "ext", "aria-hidden": "true" }, " ↗"));
const td = (label, ...kids) => el("td", { "data-label": label }, ...kids);
const tdn = (label, n, cls = "") => el("td", { "data-label": label, class: `num ${cls}`.trim() }, $(n));
const storePill = (k) => el("span", { class: `pill b-${k === "both" ? "other" : k}` }, k === "both" ? "Both" : STORES[k]?.name ?? k);
const STATUS = { paid: ["s-live", "Paid"], due: ["s-attn", "Due"], late: ["s-blind", "Late"], collecting: ["s-empty", "Collecting"] };
const KIND_NAMES = { expense: "Receipt (expense)", screenshot: "Sales screenshot", payment: "Tax payment", transfer: "Money moved to tax account", document: "Other tax document" };
const PAY_NAMES = { salesTax: "SC sales tax (ST-3)", federal: "IRS estimated tax (1040-ES)", sc: "SC estimated tax (SC1040ES)" };

export async function renderTaxes() {
  const root = el("div", { class: "stack taxi", style: "gap:18px" });
  const status = el("p", { class: "sr", role: "status" });
  root.append(status, el("p", { class: "muted" }, "Loading Taxi…"));
  let data = null;

  async function load() {
    try {
      data = await api(API, { key: true, reason: KEY_REASON });
      draw();
    } catch (e) {
      root.replaceChildren(status, el("section", { class: "panel" }, el("h2", {}, "Taxi couldn't load"), el("p", { class: "muted" }, e.message),
        el("div", { class: "row" }, el("button", { class: "btn primary", type: "button", onclick: load }, "Try again"))));
    }
  }
  async function post(body, msg) {
    try {
      const out = await api(API, { method: "POST", key: true, reason: KEY_REASON, body });
      if (msg) toast(msg);
      await load();
      return out;
    } catch (e) { toast(e.message); return null; }
  }

  function draw() {
    const d = data;
    root.replaceChildren(status, intro(d), fridayPanel(d), nextPanel(d), splitPanel(d), weeksPanel(d), monthsPanel(d), yearPanel(d),
      deadlinesPanel(d), recordsPanel(d), logPanel(d), settingsPanel(d), aboutPanel(d));
  }

  // ---------- Taxi herself ----------
  function intro(d) {
    const st = d.state ?? {};
    const failed = Object.entries(st.stores ?? {}).filter(([, v]) => !v.ok);
    const runBtn = el("button", { class: "btn primary", type: "button", onclick: async (e) => { e.target.disabled = true; e.target.textContent = "Rounding up…"; await post({ action: "run" }, "Taxi rounded up both stores."); } }, "Round up sales now");
    return el("section", { class: "panel taxi-hero" },
      el("div", { class: "taxi-id" },
        el("div", { class: "taxi-seal", "aria-hidden": "true" }, el("span", {}, "T")),
        el("div", { class: "stack", style: "gap:4px" },
          el("span", { class: "eyebrow" }, "Your tax agent"),
          el("h2", {}, "Taxi"),
          el("p", { class: "muted small" }, "Business and personal tax specialist for Elevated Designs LLC: both stores, one Schedule C, South Carolina rules. She checks every sale each morning and reports to you on Fridays."))),
      el("div", { class: "taxi-run" },
        el("p", { class: "small" }, el("strong", {}, "Last roundup: "), when(st.lastRun)),
        failed.length ? el("p", { class: "small bad-text" }, `Couldn't read ${failed.map(([k, v]) => `${STORES[k].name} (${v.error})`).join(", ")}`) : null,
        ...(st.notes ?? []).map((n) => el("p", { class: "muted small" }, n)),
        el("div", { class: "row" }, runBtn)),
      el("p", { class: "taxi-note small" }, "Taxi is guidance built from IRS and SCDOR rules, not a licensed CPA. Have a CPA look over the year-end return. Every guess she makes is listed at the bottom of this page."));
  }

  // ---------- this Friday ----------
  function fridayPanel(d) {
    const w = d.lastWeek ?? d.week;
    const cur = d.week;
    const tile = (label, n, note, cls = "") => el("div", { class: `kpi static ${cls}` }, el("b", { class: "num" }, $(n)), el("span", {}, label), note ? el("small", { class: "muted" }, note) : null);
    const moveBtn = w && w.left > 0 ? el("button", { class: "btn primary", type: "button", onclick: () => post({ action: "record", kind: "transfer", date: todayIso(), week: w.start, amount: w.left, note: `Tax set-aside for the week of ${day(w.start)}` }, "Logged. Taxi marked the week as moved.") }, `I moved ${$(w.left)}`) : null;
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Move this Friday"), el("span", { class: "muted small" }, w ? `Week of ${day(w.start)} to ${day(w.end)} (Friday to Thursday)` : "")),
      w ? el("div", { class: "kpis" },
        tile("To the sales tax account", w.salesTax, "Collected from customers. Not yours, it goes to SCDOR."),
        tile("To the income tax account", w.reserve, `${pct(d.rate)} of the week's profit, for the IRS and SC.`),
        tile("Total to move", w.toTaxAccounts, w.moved ? `${$(w.moved)} already moved` : `${w.orders} sale${w.orders === 1 ? "" : "s"}, ${$(w.sales)} taken in`, "accent"),
        tile("Still to move", w.left, w.left ? "Tick it off once it's in the account." : "All moved. Nice.", w.left ? "warn" : "")) : el("p", { class: "muted" }, "No sales yet."),
      el("div", { class: "row" }, moveBtn, cur && w !== cur ? el("span", { class: "muted small" }, `This week so far (since ${day(cur.start)}): ${$(cur.toTaxAccounts)} to set aside from ${cur.orders} sale${cur.orders === 1 ? "" : "s"}.`) : null));
  }

  function nextPanel(d) {
    return el("section", { class: "panel" }, el("h2", {}, "Taxi's next actions"),
      el("ol", { class: "taxi-next" }, (d.next ?? []).map((t) => el("li", {}, t))));
  }

  // ---------- where every sale goes ----------
  function splitPanel(d) {
    const bar = (k) => {
      const p = d.per100[k];
      const parts = [["Sales tax", p.salesTax, "seg-tax"], ["Card fees", p.fees, "seg-fee"], ["Materials", p.cost, "seg-cost"], ["Income tax reserve", p.reserve, "seg-res"], ["Yours", p.yours, "seg-you"]];
      const total = p.customerPays || 1;
      return el("div", { class: `stack brand-${k}`, style: "gap:6px" },
        el("div", { class: "row", style: "justify-content:space-between" }, storePill(k), el("span", { class: "muted small" }, `Customer pays ${$(p.customerPays)} on a $100 item shipped in Charleston`)),
        el("div", { class: "split-bar", role: "img", "aria-label": parts.map(([n, v]) => `${n} ${$(v)}`).join(", ") },
          parts.map(([n, v, c]) => el("i", { class: c, style: `width:${Math.max(0, (v / total) * 100)}%`, title: `${n}: ${$(v)}` }))),
        el("div", { class: "split-legend" }, parts.map(([n, v, c]) => el("span", {}, el("b", { class: c }), `${n} ${$(v)}`))));
    };
    const est = (n, on) => [el("span", {}, $(n), on ? el("small", { class: "muted" }, " est.") : null)];
    const rows = (d.recent ?? []).slice(0, 25).map((o, i) => el("tr", { class: i >= 6 ? "more-row" : "" },
      td("Order", el("span", { class: "mono" }, o.name || "–")), td("Store", storePill(o.store)), td("Date", day(o.day)),
      tdn("Customer paid", o.total), tdn("Sales tax account", o.salesTax), el("td", { "data-label": "Card fee", class: "num" }, ...est(o.fees, o.feesEstimated)),
      el("td", { "data-label": "Materials", class: "num" }, ...est(o.cost, o.costEstimated)), tdn("Income tax account", o.reserve), tdn("Yours", o.yours, o.yours < 0 ? "bad-text" : "")));
    const table = el("div", { class: "tbl cards sales-tbl" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Order", "Store", "Date", "Customer paid", "Sales tax account", "Card fee", "Materials", "Income tax account", "Yours"].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows)));
    const moreBtn = rows.length > 6 ? el("button", { class: "btn ghost small show-more", type: "button", onclick: (e) => { table.classList.add("all"); e.target.remove(); } }, `Show all ${rows.length} recent sales`) : null;
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Where every sale goes"), el("span", { class: "muted small" }, `Income tax reserve: ${pct(d.rate)} of each sale's profit`)),
      el("p", { class: "muted small" }, d.rateExplained),
      el("div", { class: "grid-2" }, Object.keys(STORES).map(bar)),
      rows.length ? table : el("p", { class: "muted" }, "Sales show up here after Taxi's first roundup."), moreBtn,
      el("p", { class: "muted small" }, "\"est.\" means Shopify didn't give the real number, so Taxi used your settings. Shipping you charge is assumed to cover the label."));
  }

  // ---------- weeks ----------
  function weeksPanel(d) {
    const rows = d.weeks.map((w) => el("tr", { class: w.current ? "cur" : "" },
      td("Week", `${day(w.start)} to ${day(w.end)}`, w.current ? el("small", { class: "muted" }, " (so far)") : null),
      td("Sales", String(w.orders)), tdn("Taken in", w.sales),
      tdn(STORES.c3d.name, w.byStore.c3d.toTaxAccounts), tdn(STORES.ed.name, w.byStore.ed.toTaxAccounts),
      tdn("Sales tax", w.salesTax), tdn("Income tax", w.reserve), tdn("Total to move", w.toTaxAccounts, "strong"),
      td("Moved", w.toTaxAccounts <= 0 ? el("span", { class: "muted" }, "–") : w.left <= 0 ? el("span", { class: "pill s-live" }, "Moved") : el("span", { class: `pill ${w.current ? "s-empty" : "s-attn"}` }, `${$(w.left)} left`))));
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Week by week"), el("span", { class: "muted small" }, "Friday to Thursday. The two store columns are each store's total to move.")),
      el("div", { class: "tbl cards" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Week", "Sales", "Taken in", STORES.c3d.name, STORES.ed.name, "Sales tax", "Income tax", "Total to move", "Moved"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows))));
  }

  // ---------- months: SC sales tax ----------
  function monthsPanel(d) {
    const rows = d.months.map((m) => {
      const [cls, label] = STATUS[m.status];
      const payBtn = m.status === "due" || m.status === "late"
        ? el("button", { class: "btn small", type: "button", onclick: () => openPayment("salesTax", m.month, m.collected) }, "Log payment") : null;
      return el("tr", {},
        td("Month", m.name), td("Sales", String(m.orders)), tdn("Taxable sales", m.taxable),
        tdn(STORES.c3d.name, m.byStore.c3d), tdn(STORES.ed.name, m.byStore.ed), tdn("Collected", m.collected, "strong"),
        td("Due", dayY(m.due)), td("Status", el("span", { class: `pill ${cls}` }, m.paid ? `${label} ${$(m.paid)}` : label)), el("td", { class: "actions" }, payBtn));
    });
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "SC sales tax, month by month"), ext(d.links.mydorway, "File on MyDORWAY")),
      el("p", { class: "muted small" }, "File one return a month for the LLC (ST-3 with the local tax schedule), due the 20th of the next month, even when nothing sold. The money is already in the sales tax account if you moved it each Friday."),
      el("div", { class: "tbl cards" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Month", "Sales", "Taxable sales", STORES.c3d.name, STORES.ed.name, "Collected", "Due", "Status", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows))),
      el("p", { class: "muted small" }, "Check the taxes are on in both stores: ", ext(d.links.shopifyTaxC3D, "Charleston 3D tax settings"), " · ", ext(d.links.shopifyTaxED, "Elevated Designs tax settings")));
  }

  // ---------- the year ----------
  function yearPanel(d) {
    const y = d.year;
    const line = (label, value, note, cls = "") => el("div", { class: `yr-line ${cls}` }, el("span", {}, label, note ? el("small", { class: "muted" }, note) : null), el("b", { class: "num" }, value));
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, `${y.year} so far`), el("span", { class: "muted small" }, "Business only. Your job's tax is handled by your paycheck withholding.")),
      el("div", { class: "grid-3" },
        el("div", { class: "stack yr-col" }, el("h3", {}, "Money in"),
          line("Taken in (both stores)", $(y.sales)), line(STORES.c3d.name, $(y.byStore.c3d.sales)), line(STORES.ed.name, $(y.byStore.ed.sales)),
          line("Sales tax collected", $(y.salesTax), " not income"), line("Expenses from receipts", $(y.countedExpenses), y.expenses !== y.countedExpenses ? ` (${$(y.expenses - y.countedExpenses)} of materials left out, already in the estimate)` : ""),
          line("Profit so far", $(y.ytdProfit), null, "strong"), line("Profit by Dec 31 at this pace", $(y.projectedProfit))),
        el("div", { class: "stack yr-col" }, el("h3", {}, "Tax the business owes so far"),
          line("Self-employment tax", $(y.owedSoFar.se), " Social Security and Medicare"), line("Federal income tax", $(y.owedSoFar.federal)), line("SC income tax", $(y.owedSoFar.sc)),
          line("Total", $(y.owedSoFar.total), null, "strong"),
          line("Projected for the full year", $(y.projected.total))),
        el("div", { class: "stack yr-col" }, el("h3", {}, "Paid and set aside"),
          line("Set aside on sales so far", $(y.reservedYtd)), line("Paid to the IRS", $(y.paid.federal)), line("Paid to SC", $(y.paid.sc)),
          line("Still owed", $(y.stillOwed), null, y.stillOwed > 0 ? "strong warn-text" : "strong"),
          el("div", { class: "row" },
            el("button", { class: "btn small", type: "button", onclick: () => openPayment("federal", `${y.year}-Q${quarterOf(d.today)}`, 0) }, "Log IRS payment"),
            el("button", { class: "btn small", type: "button", onclick: () => openPayment("sc", `${y.year}-Q${quarterOf(d.today)}`, 0) }, "Log SC payment")))),
      el("p", { class: "muted small" }, "Paying four times a year is the IRS minimum; you can pay every month instead (it all counts). Simplest safe route: pay at least what the Year panel says is still owed by each due date below. If your W-2 withholding already covers all of last year's tax, the IRS won't charge an underpayment penalty this year, but you still owe the balance in April."));
  }
  const quarterOf = (iso) => { const m = Number(iso.slice(5, 7)); return m <= 3 ? 1 : m <= 5 ? 2 : m <= 8 ? 3 : 4; };

  // ---------- deadlines ----------
  function deadlinesPanel(d) {
    const today = d.today;
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Deadlines"), el("div", { class: "row" }, ext(d.links.irsPay, "IRS Direct Pay"), ext(d.links.mydorway, "SC MyDORWAY"))),
      el("div", { class: "tbl cards" }, el("table", {}, el("thead", {}, el("tr", {}, ["Date", "What", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, d.deadlines.map((x) => el("tr", { class: x.date < today ? "past" : "" },
          td("Date", dayY(x.date), x.date < today ? el("small", { class: "muted" }, " (past)") : null), td("What", x.what), el("td", {}, x.link ? ext(x.link, "Open") : null)))))));
  }

  // ---------- receipts, screenshots, payments ----------
  let recordForm = null;
  function openPayment(type, period, amount) {
    recordForm?.fill({ kind: "payment", type, period, amount: amount ? amount.toFixed(2) : "" });
    recordForm?.el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function recordsPanel(d) {
    const f = {
      kind: el("select", { class: "field", id: "tx-kind", "aria-label": "What is it" }, Object.entries(KIND_NAMES).map(([v, n]) => el("option", { value: v }, n))),
      date: el("input", { class: "field", id: "tx-date", type: "date", value: todayIso(), "aria-label": "Date", required: true }),
      amount: el("input", { class: "field", id: "tx-amount", type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "Amount", "aria-label": "Amount" }),
      vendor: el("input", { class: "field", id: "tx-vendor", maxlength: "80", placeholder: "Store or who it was paid to", "aria-label": "Vendor" }),
      category: el("select", { class: "field", id: "tx-cat", "aria-label": "Expense type" }, d.expenseCategories.map((c) => el("option", { value: c }, c))),
      type: el("select", { class: "field", id: "tx-type", "aria-label": "Which tax" }, Object.entries(PAY_NAMES).map(([v, n]) => el("option", { value: v }, n))),
      period: el("input", { class: "field", id: "tx-period", placeholder: "Period: 2026-11 or 2026-Q4", "aria-label": "Period" }),
      confirmation: el("input", { class: "field", id: "tx-conf", maxlength: "60", placeholder: "Confirmation number", "aria-label": "Confirmation number" }),
      store: el("select", { class: "field", id: "tx-store", "aria-label": "Store" }, [el("option", { value: "both" }, "Both stores"), ...Object.entries(STORES).map(([k, s]) => el("option", { value: k }, s.name))]),
      note: el("input", { class: "field", id: "tx-note", maxlength: "300", placeholder: "Note (optional)", "aria-label": "Note" }),
      file: el("input", { class: "field", id: "tx-file", type: "file", accept: "image/*,application/pdf", "aria-label": "Photo, screenshot or PDF" }),
    };
    const lbl = (text, input, cls = "") => el("label", { class: `stack fld ${cls}`, style: "gap:4px" }, el("span", { class: "small muted" }, text), input);
    const show = () => {
      const k = f.kind.value;
      wrap.cat.hidden = k !== "expense";
      wrap.type.hidden = wrap.period.hidden = wrap.conf.hidden = k !== "payment";
    };
    const wrap = { cat: lbl("Expense type", f.category), type: lbl("Which tax", f.type), period: lbl("Period", f.period), conf: lbl("Confirmation", f.confirmation) };
    f.kind.addEventListener("change", show);
    f.type.addEventListener("change", () => { if (!f.period.value) f.period.value = f.type.value === "salesTax" ? todayIso().slice(0, 7) : `${todayIso().slice(0, 4)}-Q${quarterOf(todayIso())}`; });
    const save = el("button", { class: "btn primary", type: "submit" }, "Save to Taxi");
    const form = el("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      const body = { action: "record", kind: f.kind.value, date: f.date.value, amount: f.amount.value, vendor: f.vendor.value, note: f.note.value, store: f.store.value,
        category: f.category.value, type: f.type.value, period: f.period.value, confirmation: f.confirmation.value };
      const file = f.file.files?.[0];
      try {
        if (file && file.size > 10 * 1024 * 1024) throw new Error("Files can be up to 10 MB.");
        const out = await api(API, { method: "POST", key: true, reason: KEY_REASON, body });
        if (file) {
          const res = await call(`${API}/file/${out.record.id}`, { method: "POST", headers: { "x-console-key": consoleKey.get(), "x-filename": encodeURIComponent(file.name), "content-type": "application/octet-stream" }, body: file });
          if (!res.ok) { const j = await res.json().catch(() => ({})); toast(`Saved, but the file didn't attach: ${j.error ?? res.status}`); }
        }
        toast("Saved to Taxi.");
        await load();
      } catch (err) { toast(err.message); save.disabled = false; }
    } },
      el("div", { class: "form-grid" }, lbl("What is it", f.kind), lbl("Date", f.date), lbl("Amount", f.amount), lbl("Store or payee", f.vendor), wrap.cat, wrap.type, wrap.period, wrap.conf, lbl("Store", f.store), lbl("Note", f.note), lbl("Photo, screenshot or PDF (10 MB max)", f.file)),
      el("div", { class: "row" }, save, el("span", { class: "muted small" }, "Snap receipts on your phone right here. Business receipts lower the tax Taxi reserves.")));
    show();
    recordForm = { el: form, fill: (v) => { for (const [k, val] of Object.entries(v)) if (f[k]) f[k].value = val; show(); } };

    // Records grouped by Taxi's week.
    const byWeek = new Map();
    for (const r of d.records) { if (!byWeek.has(r.week)) byWeek.set(r.week, []); byWeek.get(r.week).push(r); }
    const groups = [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([wk, list], i) => el("details", { class: "rec-week", open: i < 2 },
      el("summary", {}, el("span", {}, `Week of ${day(wk)} to ${day(addDaysLocal(wk, 6))}`), el("span", { class: "muted small" }, `${list.length} item${list.length === 1 ? "" : "s"} · ${$(list.filter((r) => r.kind === "expense").reduce((a, r) => a + r.amount, 0))} expenses`)),
      el("div", { class: "rec-list" }, list.map(recordRow))));
    return el("section", { class: "panel", id: "taxi-records" },
      el("div", { class: "panel-head" }, el("h2", {}, "Receipts, screenshots and payments"), el("span", { class: "muted small" }, "Saved online with the console, by week. Keep everything 7 years.")),
      form, groups.length ? el("div", { class: "stack", style: "gap:8px" }, groups) : el("p", { class: "muted" }, "Nothing saved yet."));
  }
  function recordRow(r) {
    const what = r.kind === "payment" ? `${PAY_NAMES[r.type]} for ${r.period}${r.confirmation ? ` (#${r.confirmation})` : ""}` : r.kind === "expense" ? r.category : KIND_NAMES[r.kind];
    const view = r.file ? el("button", { class: "btn small", type: "button", onclick: () => openFile(r) }, r.file.type === "application/pdf" ? "Open PDF" : "View") : null;
    const del = el("button", { class: "btn small danger", type: "button", onclick: async (e) => {
      if (e.target.dataset.armed !== "1") { e.target.dataset.armed = "1"; e.target.classList.add("armed"); e.target.textContent = "Tap again to delete"; return; }
      try { await api(API, { method: "DELETE", key: true, reason: KEY_REASON, body: { id: r.id } }); toast("Deleted."); await load(); } catch (err) { toast(err.message); }
    } }, "Delete");
    return el("div", { class: "rec" },
      el("div", { class: "stack", style: "gap:2px;min-width:0" },
        el("strong", {}, r.vendor || what), el("span", { class: "muted small" }, `${dayY(r.date)} · ${what}${r.note ? ` · ${r.note}` : ""}`)),
      storePill(r.store), el("b", { class: "num" }, r.amount ? $(r.amount) : ""), el("div", { class: "row" }, view, del));
  }
  async function openFile(r) {
    try {
      const res = await call(`${API}/file/${r.id}`, { headers: { "x-console-key": consoleKey.get() } });
      if (!res.ok) throw new Error("Couldn't open the file.");
      const url = URL.createObjectURL(await res.blob());
      if (r.file.type === "application/pdf") { window.open(url, "_blank", "noopener"); return; }
      const dlg = el("dialog", { class: "palette rec-view", "aria-label": r.vendor || "Receipt" },
        el("img", { src: url, alt: r.vendor ? `Receipt from ${r.vendor}` : "Receipt" }),
        el("div", { class: "row", style: "justify-content:flex-end" }, el("a", { class: "btn", href: url, download: r.file.name }, "Download"), el("button", { class: "btn primary", type: "button", onclick: () => dlg.close() }, "Close")));
      dlg.addEventListener("close", () => { dlg.remove(); URL.revokeObjectURL(url); });
      portal().append(dlg);
      dlg.showModal();
    } catch (e) { toast(e.message); }
  }
  const addDaysLocal = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  // ---------- Taxi's log ----------
  function logPanel(d) {
    const fr = (d.fridays ?? []).slice(0, 6);
    return el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Taxi's log"), el("span", { class: "muted small" }, "Stacy gets each report in the morning digest")),
      fr.length ? el("div", { class: "stack", style: "gap:6px" }, el("h3", {}, "Friday reports"),
        fr.map((w) => el("p", { class: "small" }, el("strong", {}, `${day(w.week)} to ${day(w.end)}: `), `${w.orders} sales, ${$(w.sales)} in. Moved to sales tax ${$(w.salesTax)}, to income tax ${$(w.reserve)} (${$(w.total)} total).`))) : null,
      el("h3", {}, "Daily reports"),
      d.reports.length ? el("div", { class: "log" }, d.reports.slice(0, 14).map((r) => el("div", { class: "log-row" },
        el("span", { class: `pill ${r.status === "ok" ? "s-live" : r.status === "partial" ? "s-attn" : "s-blind"}` }, r.status === "ok" ? "Done" : r.status === "partial" ? "Partly" : "Failed"),
        el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "small" }, el("strong", {}, `${day(r.day)}${r.reason === "manual" ? " (run by hand)" : ""}: `), r.did),
          el("span", { class: "muted small" }, `Next: ${r.next?.[0] ?? "nothing"}`))))) : el("p", { class: "muted" }, "Taxi writes here every morning after her roundup."));
  }

  // ---------- settings ----------
  function settingsPanel(d) {
    const s = d.settings;
    const f = {
      wages: el("input", { class: "field", type: "number", min: "0", step: "100", value: s.wages, id: "tx-wages" }),
      c3d: el("input", { class: "field", type: "number", min: "0", max: "95", step: "1", value: s.costPct.c3d, id: "tx-c3d" }),
      ed: el("input", { class: "field", type: "number", min: "0", max: "95", step: "1", value: s.costPct.ed, id: "tx-ed" }),
      costMode: el("select", { class: "field", id: "tx-mode" }, [["estimate", "Estimate from the % above"], ["receipts", "Count my material receipts instead"]].map(([v, n]) => el("option", { value: v, selected: s.costMode === v }, n))),
      feeRate: el("input", { class: "field", type: "number", min: "0", max: "10", step: "0.1", value: s.feeRate, id: "tx-fee" }),
      reserve: el("input", { class: "field", type: "number", min: "0", max: "80", step: "1", value: s.reserveRate ?? "", placeholder: `Taxi's math: ${Math.round(d.calcRate * 1000) / 10}%`, id: "tx-reserve" }),
    };
    const lbl = (text, input, help) => el("label", { class: "stack fld", style: "gap:4px" }, el("span", { class: "small" }, text), input, help ? el("span", { class: "muted small" }, help) : null);
    return el("details", { class: "panel taxi-settings" }, el("summary", {}, el("h2", {}, "Taxi's settings")),
      el("form", { class: "stack", onsubmit: (e) => { e.preventDefault(); post({ action: "settings", wages: f.wages.value, costPct: { c3d: f.c3d.value, ed: f.ed.value }, costMode: f.costMode.value, feeRate: f.feeRate.value, reserveRate: f.reserve.value === "" ? null : f.reserve.value }, "Settings saved. Taxi redid the math."); } },
        el("div", { class: "form-grid" },
          lbl("Your job's yearly pay before tax", f.wages, s.wagesConfirmed ? "From your W-2 (box 1)." : "A guess from your budget app. Put in your real W-2 box 1 number."),
          lbl(`${STORES.c3d.name} materials, % of sales`, f.c3d, "Filament, parts, packaging per item."),
          lbl(`${STORES.ed.name} materials, % of sales`, f.ed, "Blank shirt plus DTF transfer per item."),
          lbl("How to count materials", f.costMode),
          lbl("Card fee %", f.feeRate, "Only used when Shopify doesn't report the fee."),
          lbl("Fixed reserve % (optional)", f.reserve, "Leave empty to let Taxi work it out.")),
        el("div", { class: "row" }, el("button", { class: "btn primary", type: "submit" }, "Save settings"))));
  }

  // ---------- assumptions and sources ----------
  function aboutPanel(d) {
    const r = d.rules;
    return el("details", { class: "panel" }, el("summary", {}, el("h2", {}, "How Taxi works, her assumptions and sources")),
      el("div", { class: "grid-2" },
        el("div", { class: "stack" }, el("h3", {}, "The rules she uses (2026)"),
          el("ul", { class: "small" },
            el("li", {}, `SC sales tax: 6% state plus local tax by delivery address (9% in Charleston County). Filed monthly, due the 20th.`),
            el("li", {}, `Self-employment tax: 15.3% (12.4% Social Security up to $${r.se.wageBase.toLocaleString("en-US")} including your job pay, plus 2.9% Medicare) on 92.35% of profit.`),
            el("li", {}, `Federal income tax: 2026 single brackets, standard deduction $${r.federal.standardDeduction.toLocaleString("en-US")}, and the 20% qualified business income deduction. Half of SE tax is deducted.`),
            el("li", {}, "SC income tax (H.4216, 2026): starts from federal AGI, minus the SC income-adjusted deduction ($15,000, shrinking between $40,000 and $95,000), then 1.99% under $30,000 or 5.21% minus $966."),
            el("li", {}, "Estimated taxes: IRS 1040-ES and SC1040ES, due Apr 15, Jun 15, Sep 15 and Jan 15."),
            el("li", {}, "1099-K: Shopify sends one only when a store passes $20,000 and 200 payments in a year. All sales are taxable either way."))),
        el("div", { class: "stack" }, el("h3", {}, "Assumptions to check"), el("ul", { class: "small" }, d.assumptions.map((a) => el("li", {}, a))))),
      el("h3", {}, "Sources"), el("ul", { class: "small" }, d.sources.map((s) => el("li", {}, ext(s.url, s.label)))));
  }

  await load();
  return root;
}
