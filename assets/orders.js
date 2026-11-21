// Sales ▸ Orders: every order on both Shopify stores, newest first, with what each one needs next and
// the actions Aaron takes from here (mark fulfilled with tracking, a staff note, email the customer,
// open it in Shopify). Data: GET/POST /api/orders on the engine (lib/orders.mjs). Payments stay in
// Shopify checkout; nothing here charges or refunds.
import { el, toast, store } from "./app.js";
import { api, money } from "./api.js";

const CACHE = "lab-orders-v1";
const STORE_NAME = { c3d: "Charleston3D", ed: "Elevated Designs" };
const ETSY = [["Etsy sold orders", "https://www.etsy.com/your/orders/sold"]];
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL Express", "Other"];
const GATEWAY = { shopify_payments: "Shopify Payments", shop_pay_installments: "Shop Pay Installments", paypal: "PayPal", manual: "Manual", gift_card: "Gift card" };
// Emails, phones and addresses are shown live only, never kept in this browser's storage.
const scrub = (d) => ({ ...d, stores: d.stores.map((s) => ({ ...s, orders: (s.orders ?? []).map((o) => ({ ...o, email: null, phone: null, shipTo: null, billTo: null, note: null, cached: true })) })) });
const NEXT_LABEL = { quote: "Reply with a quote", payment: "Waiting on payment", address: "Needs a shipping address", ship: "Make and ship", done: "Done", none: "Cancelled" };
const FIN = { PAID: "Paid", PENDING: "Payment pending", AUTHORIZED: "Authorized", PARTIALLY_PAID: "Partly paid", REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partly refunded", VOIDED: "Voided", EXPIRED: "Expired" };
const FUL = { UNFULFILLED: "Unfulfilled", FULFILLED: "Fulfilled", PARTIALLY_FULFILLED: "Partly fulfilled", ON_HOLD: "On hold", IN_PROGRESS: "In progress", SCHEDULED: "Scheduled", RESTOCKED: "Restocked" };

const when = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso) => { const d = Math.round((Date.now() - Date.parse(iso)) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const isImg = (u) => /^https:\/\/(cdn\.shopify\.com|[a-z0-9.-]*(charleston3d|elevatedshirts)\.com)\//i.test(u) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u);

const CSS = `
.ord{display:grid;gap:16px}
.ord .ord-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.ord .ord-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.ord .ord-store{display:grid;gap:10px;border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:10px;padding:14px;background:var(--surface)}
.ord .ord-store h3{display:flex;align-items:center;gap:8px}
.ord .ord-store h3 .dot{width:9px;height:9px;border-radius:50%;background:var(--brand)}
.ord .ord-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.ord .ord-k div{background:var(--sunk);border-radius:8px;padding:8px 10px;display:grid;gap:2px;min-width:0}
.ord .ord-k b{font-family:var(--f-display);font-size:20px;font-variant-numeric:tabular-nums;line-height:1.2}
.ord .ord-k span{font-size:12px;color:var(--muted)}
.ord .ord-k .hot b{color:var(--warn)}
.ord .ord-list{display:grid;gap:12px}
.ord .ocard{display:grid;grid-template-columns:112px minmax(0,1fr);gap:14px;border:1px solid var(--line);border-left:4px solid var(--brand);border-radius:10px;padding:14px;background:var(--surface)}
.ord .ocard.is-done{border-left-color:var(--line);opacity:.92}
.ord .opic{width:112px;height:112px;border-radius:8px;object-fit:cover;background:var(--sunk);display:block}
.ord .opic.blank{display:grid;place-items:center;color:var(--muted);font-size:12px;text-align:center;padding:6px}
.ord .ohead{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
.ord .ohead h3{font-size:18px}
.ord .ohead .tot{margin-left:auto;font-family:var(--f-display);font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.ord .obody{display:grid;gap:8px;min-width:0}
.ord .tagrow{display:flex;flex-wrap:wrap;gap:6px}
.ord .t{font-size:12px;border-radius:999px;padding:2px 9px;background:var(--sunk);color:var(--muted);white-space:nowrap}
.ord .t.store{background:var(--brand-soft);color:var(--fg)}
.ord .t.paid{background:var(--ok-soft);color:var(--fg)}
.ord .t.warn{background:var(--warn-soft);color:var(--fg)}
.ord .onext{display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:9px 12px;background:var(--warn-soft);font-weight:600}
.ord .onext.ok{background:var(--ok-soft);font-weight:500}
.ord .onext .ic{flex:none;font-size:15px;line-height:1.4}
.ord .items{margin:0;padding:0;list-style:none;display:grid;gap:4px}
.ord .items li{display:flex;gap:8px;justify-content:space-between;font-size:14px}
.ord .items li span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}
.ord details.req{font-size:14px;border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:var(--sunk)}
.ord details.req summary{cursor:pointer;font-weight:600}
.ord .req dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:8px 0 0}
.ord .req dt{color:var(--muted)}
.ord .req dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.ord .files{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.ord .files img{width:84px;height:84px;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
.ord .who{font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px}
.ord .who b{color:var(--fg);font-weight:600}
.ord .cust{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.ord .cbox{display:grid;align-content:start;gap:4px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14px;min-width:0}
.ord .cbox h4{margin:0 0 2px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.ord .cbox address{font-style:normal;display:grid;gap:1px;color:var(--fg)}
.ord .cbox .btn{justify-self:start;margin-top:4px}
.ord .cbox .warn{margin:0;color:var(--warn,#d4a017)}
.ord .cline{display:flex;gap:8px;align-items:baseline;min-width:0}
.ord .cline a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ord .linkbtn{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px}
.ord .pr{display:flex;justify-content:space-between;gap:10px;font-variant-numeric:tabular-nums}
.ord .pr.tot{font-weight:700;border-top:1px solid var(--line);padding-top:4px;margin-top:2px}
.ord .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.ord .ffl{display:grid;gap:10px;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--sunk)}
.ord .ffl .grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px}
.ord .ffl label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
.ord .ffl .chk{display:flex;gap:8px;align-items:center;color:var(--fg)}
.ord .ffl textarea{min-height:70px;resize:vertical}
.ord .empty{padding:18px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);text-align:center}
.ord .err{border-left:4px solid var(--bad);background:var(--sunk);border-radius:8px;padding:10px 12px;font-size:14px}
.ord .rec td,.ord .rec th{padding:7px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:14px;white-space:nowrap}
.ord .rec{width:100%;border-collapse:collapse}
.ord .rec td.r{text-align:right;font-variant-numeric:tabular-nums}
.ord .links{display:flex;flex-wrap:wrap;gap:8px}
@media (max-width:640px){
  .ord .ocard{grid-template-columns:minmax(0,1fr);gap:10px;padding:12px}
  .ord .opic{width:100%;height:180px}
  .ord .ord-k{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ord .ohead .tot{margin-left:0;width:100%}
  .ord .ffl .grid{grid-template-columns:1fr}
  .ord .acts .btn{flex:1 1 auto;justify-content:center}
  .ord .rec .hide-sm{display:none}
}`;

// The customer's own photo first (a custom request's picture of what they want), then the product photo.
function picOf(o) {
  for (const i of o.items) for (const f of i.files) if (isImg(f.url)) return f.url;
  for (const i of o.items) if (i.image) return i.image;
  return null;
}

export async function renderOrders() {
  const root = el("div", { class: "ord" });
  root.append(el("style", {}, CSS));
  const status = el("p", { class: "sr", role: "status" });
  const refresh = el("button", { class: "btn ghost", type: "button" }, "Refresh");
  const stamp = el("span", { class: "muted small" });
  const filters = el("div", { class: "toolbar", role: "group", "aria-label": "Show" });
  const sum = el("div", { class: "ord-sum" });
  const listHead = el("h2", {}, "Needs you");
  const list = el("div", { class: "ord-list" });
  const recentWrap = el("section", { class: "panel" });
  const view = { filter: store.get("lab-orders-filter", "open"), data: null, busy: false };
  const FILTERS = [["open", "Needs you"], ["all", "All orders"], ["c3d", "Charleston3D"], ["ed", "Elevated Designs"]];
  for (const [k, l] of FILTERS) {
    const b = el("button", { class: "chip", type: "button", "aria-pressed": String(view.filter === k) }, l);
    b.addEventListener("click", () => { view.filter = k; store.set("lab-orders-filter", k); filters.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); paint(); });
    filters.append(b);
  }
  root.append(
    el("div", { class: "ord-bar" }, filters, el("div", { class: "row" }, stamp, refresh)),
    status, sum,
    el("section", { class: "panel" }, el("div", { class: "panel-head" }, listHead, el("span", { class: "muted small" }, "Newest first · last 60 days plus anything still open")), list),
    recentWrap,
    el("section", { class: "panel" }, el("h2", {}, "Etsy orders"),
      el("p", { class: "muted small" }, "Etsy doesn't share orders with the Lab yet. Etsy emails every sale to your Gmail. This opens the sold orders of whichever Etsy shop is signed in (Charleston3DWorks or ElevatedTransfersCo)."),
      el("div", { class: "links" }, ETSY.map(([l, u]) => el("a", { class: "btn ghost", href: u, target: "_blank", rel: "noopener" }, l, el("span", { class: "ext", "aria-hidden": "true" }, "↗"))))));
  refresh.addEventListener("click", () => load());

  function paintSummary(d) {
    sum.replaceChildren(...d.stores.map((s) => {
      const box = el("section", { class: `ord-store brand-${s.store}` }, el("h3", {}, el("span", { class: "dot", "aria-hidden": "true" }), STORE_NAME[s.store]));
      if (!s.ok) {
        box.append(el("div", { class: "err" }, el("strong", {}, "Couldn't read orders. "), s.error, s.scopes?.length ? ` Add the ${s.scopes.join(", ")} scope to the store's Lab app in the Shopify Dev Dashboard.` : ""));
        return box;
      }
      const t = s.totals, c = s.currency;
      box.append(el("div", { class: "ord-k" },
        el("div", {}, el("b", {}, money(t.today.revenue, c, 0)), el("span", {}, `Today · ${t.today.orders} ${t.today.orders === 1 ? "order" : "orders"}`)),
        el("div", {}, el("b", {}, money(t.d7.revenue, c, 0)), el("span", {}, `7 days · ${t.d7.orders}`)),
        el("div", {}, el("b", {}, money(t.d30.revenue, c, 0)), el("span", {}, `30 days · ${t.d30.orders}`)),
        el("div", { class: t.open ? "hot" : "" }, el("b", {}, String(t.open)), el("span", {}, t.open ? `Need you${t.toShip ? ` · ${t.toShip} to ship` : ""}` : "Nothing open"))),
        el("a", { class: "btn ghost small", href: s.ordersAdminUrl, target: "_blank", rel: "noopener" }, "All orders in Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗")));
      if (s.notes?.length) box.append(el("p", { class: "muted small" }, s.notes.join(" ")));
      return box;
    }));
  }

  function orderCard(o, s) {
    const pic = picOf(o);
    const done = !o.open;
    const card = el("article", { class: `ocard brand-${o.store}${done ? " is-done" : ""}`, "aria-label": `Order ${o.name}` });
    card.append(pic ? el("img", { class: "opic", src: pic, alt: o.items[0]?.title ? `Picture: ${o.items[0].title}` : "Order item", loading: "lazy" })
      : el("div", { class: "opic blank", "aria-hidden": "true" }, "No picture"));
    const body = el("div", { class: "obody" });
    body.append(el("div", { class: "ohead" }, el("h3", {}, `Order ${o.name}`),
      el("span", { class: "muted small" }, `${when(o.createdAt)} · ${ago(o.createdAt)}`),
      el("span", { class: "tot" }, money(o.total, o.currency))));
    body.append(el("div", { class: "tagrow" },
      el("span", { class: "t store" }, STORE_NAME[o.store]),
      o.financial ? el("span", { class: `t ${o.financial === "PAID" ? "paid" : "warn"}` }, FIN[o.financial] ?? o.financial) : null,
      o.fulfillment ? el("span", { class: `t ${o.fulfillment === "FULFILLED" ? "paid" : "warn"}` }, FUL[o.fulfillment] ?? o.fulfillment) : null,
      o.isRequest ? el("span", { class: "t" }, "Custom request") : null));
    body.append(el("div", { class: `onext${done ? " ok" : ""}` }, el("span", { class: "ic", "aria-hidden": "true" }, done ? "✓" : "→"),
      el("span", {}, el("span", { class: "sr" }, "Next: "), o.next.text)));
    body.append(el("ul", { class: "items" }, o.items.map((i) => el("li", {}, el("span", {}, `${i.qty} × ${i.title}${i.variant ? ` (${i.variant})` : ""}`), el("span", {}, i.price ? money(i.price * i.qty, o.currency) : "")))));
    const reqItems = o.items.filter((i) => i.details.length || i.files.length);
    if (reqItems.length) {
      const d = el("details", { class: "req" }, el("summary", {}, o.isRequest ? "What they asked for" : "Personalization"));
      for (const i of reqItems) {
        d.append(el("dl", {}, i.details.flatMap((a) => [el("dt", {}, a.key), el("dd", {}, a.value)])));
        if (i.files.length) d.append(el("div", { class: "files" }, i.files.map((f) => isImg(f.url)
          ? el("a", { href: f.url, target: "_blank", rel: "noopener", title: f.key }, el("img", { src: f.url, alt: f.key, loading: "lazy" }))
          : el("a", { class: "btn ghost small", href: f.url, target: "_blank", rel: "noopener" }, f.key))));
      }
      if (o.next.code === "quote") d.open = true;
      body.append(d);
    }
    if (o.cached) body.append(el("p", { class: "muted small" }, "Loading the customer's details…"));
    else if (o.personVisible === false) body.append(el("p", { class: "muted small" }, "Shopify hides this customer's name and address from the Lab. Open the order in Shopify to see them."));
    else body.append(customerPanel(o));
    const extra = el("div", { class: "who" });
    if (o.tracking.length) extra.append(el("span", {}, "Tracking: ", o.tracking.map((t) => t.url ? el("a", { href: t.url, target: "_blank", rel: "noopener" }, `${t.company ?? ""} ${t.number ?? ""}`.trim()) : `${t.company ?? ""} ${t.number ?? ""}`.trim())));
    if (o.note) extra.append(el("span", {}, `Note: ${o.note}`));
    if (extra.childNodes.length) body.append(extra);

    const acts = el("div", { class: "acts" });
    const panel = el("div", { hidden: true });
    const shipBox = !done && o.next.code !== "quote" && o.next.code !== "payment" && o.fulfillment !== "FULFILLED";
    if (shipBox && s.can?.fulfill === false) acts.append(el("p", { class: "muted small" }, "To add tracking from here, the Lab's Shopify app needs fulfillment access. Until then use Open in Shopify."));
    if (o.email) {
      const subj = `Your ${STORE_NAME[o.store]} order ${o.name}`;
      acts.append(el("a", { class: "btn ghost", href: `mailto:${encodeURIComponent(o.email)}?subject=${encodeURIComponent(subj)}` }, o.next.code === "quote" ? "Email a quote" : o.next.code === "address" ? "Ask for the address" : "Email customer"));
    }
    const nb = el("button", { class: "btn ghost", type: "button" }, o.note ? "Edit note" : "Add note");
    if (s.can?.note === false) { nb.disabled = true; nb.title = "The Lab's Shopify app needs the write_orders scope."; }
    nb.addEventListener("click", () => { panel.hidden = false; panel.replaceChildren(noteForm(o, () => { panel.hidden = true; })); panel.querySelector("textarea")?.focus(); });
    acts.append(nb, el("a", { class: "btn ghost", href: o.adminUrl, target: "_blank", rel: "noopener" }, "Open in Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗")));
    body.append(acts, panel);
    if (shipBox && s.can?.fulfill !== false) body.append(fulfillForm(o, null));
    card.append(body);
    return card;
  }

  const addrLines = (a) => [a.name, a.company, a.address1, a.address2, [[a.city, a.province].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" "), a.country && a.country !== "US" ? a.country : null].filter(Boolean);
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = el("textarea", { class: "sr" }); ta.value = text; btn.after(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* blocked */ } ta.remove();
      if (!ok) { toast("Copy is blocked here. Select the address and copy it."); return; }
    }
    const was = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = was; }, 1500);
  }
  function addrBlock(title, a, note) {
    const lines = addrLines(a);
    const cp = el("button", { class: "btn ghost small", type: "button" }, "Copy address");
    cp.addEventListener("click", () => copyText(lines.join("\n"), cp));
    return el("div", { class: "cbox" }, el("h4", {}, title), note ? el("p", { class: "warn small" }, note) : null,
      el("address", {}, lines.map((l) => el("span", {}, l))), a.phone ? el("span", { class: "muted small" }, a.phone) : null, cp);
  }
  function customerPanel(o) {
    const c = el("div", { class: "cbox" }, el("h4", {}, "Customer"), el("b", {}, o.customer ?? "No name on the order"),
      o.customerOrders ? el("span", { class: "muted small" }, o.customerOrders === 1 ? "First order" : `${o.customerOrders} orders`) : null);
    for (const [v, href] of [[o.email, o.email && `mailto:${o.email}`], [o.phone, o.phone && `tel:${o.phone.replace(/[^\d+]/g, "")}`]]) {
      if (!v) continue;
      const cp = el("button", { class: "linkbtn small", type: "button", "aria-label": `Copy ${v}` }, "Copy");
      cp.addEventListener("click", () => copyText(v, cp));
      c.append(el("span", { class: "cline" }, el("a", { href }, v), cp));
    }
    const boxes = [c];
    if (o.shipTo) boxes.push(addrBlock("Ship to", o.shipTo));
    else if (o.requiresShipping && o.billTo) boxes.push(addrBlock("Ship to", o.billTo, "No shipping address on the order. This is the billing address: confirm it with the customer before you ship."));
    else if (o.requiresShipping) boxes.push(el("div", { class: "cbox" }, el("h4", {}, "Ship to"), el("p", { class: "warn small" }, "No address on the order. Ask the customer where to ship.")));
    if (o.billTo && o.shipTo) boxes.push(addrBlock("Billing", o.billTo));
    const row = (k, v, strong) => el("div", { class: strong ? "pr tot" : "pr" }, el("span", {}, k), el("span", {}, v));
    const pay = el("div", { class: "cbox" }, el("h4", {}, "Payment"),
      o.subtotal != null ? row("Subtotal", money(o.subtotal, o.currency)) : null,
      o.discounts ? row("Discounts", "−" + money(o.discounts, o.currency)) : null,
      o.shippingCost != null ? row(`Shipping${o.shipping ? ` (${o.shipping})` : ""}`, money(o.shippingCost, o.currency)) : null,
      o.tax ? row("Tax", money(o.tax, o.currency)) : null,
      row("Total", money(o.total, o.currency), true),
      o.outstanding ? row("Still owed", money(o.outstanding, o.currency), true) : null,
      el("span", { class: "muted small" }, [FIN[o.financial] ?? o.financial, o.paidWith?.length ? `via ${o.paidWith.map((g) => GATEWAY[g] ?? g.replace(/_/g, " ")).join(", ")}` : null].filter(Boolean).join(" ")));
    boxes.push(pay);
    return el("div", { class: "cust" }, boxes);
  }

  function fulfillForm(o, close) {
    const num = el("input", { class: "field", type: "text", inputmode: "text", autocomplete: "off", placeholder: "e.g. 9400 1000 0000 0000 0000 00", maxlength: "40" });
    const car = el("select", { class: "field" }, CARRIERS.map((c) => el("option", { value: c }, c)));
    const notify = el("input", { type: "checkbox", checked: true });
    const go = el("button", { class: "btn brand", type: "button" }, "Save tracking and mark fulfilled");
    const msg = el("p", { class: "small", role: "alert" });
    const f = el("div", { class: "ffl" },
      el("strong", {}, "Shipped it? Add the tracking"),
      el("div", { class: "grid" }, el("label", {}, "Tracking number (optional)", num), el("label", {}, "Carrier", car)),
      el("label", { class: "chk" }, notify, `Email ${o.customer ?? "the customer"} that it shipped`),
      el("p", { class: "muted small" }, "This marks the order fulfilled in Shopify right away, with the tracking on it. It can be undone from the order in Shopify."),
      el("div", { class: "row" }, go, close ? el("button", { class: "btn ghost", type: "button", onclick: close }, "Cancel") : null), msg);
    go.addEventListener("click", async () => {
      const n = num.value.trim();
      if (n && !/^[A-Za-z0-9 -]{4,40}$/.test(n)) { num.setAttribute("aria-invalid", "true"); msg.textContent = "Check the tracking number: letters and digits only."; return; }
      go.disabled = true; msg.textContent = "Saving in Shopify…";
      try {
        await api("/api/orders", { method: "POST", body: { store: o.store, id: o.id, action: "fulfill", notify: notify.checked, tracking: n ? { number: n, company: car.value === "Other" ? null : car.value } : null } });
        toast(`${o.name} marked fulfilled${notify.checked ? " and the customer was emailed" : ""}.`);
        if (close) close(); load();
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    });
    return f;
  }

  function noteForm(o, close) {
    const ta = el("textarea", { class: "field", maxlength: "2000", "aria-label": "Staff note" });
    ta.value = o.note ?? "";
    const go = el("button", { class: "btn brand", type: "button" }, "Save note");
    const msg = el("p", { class: "small", role: "alert" });
    go.addEventListener("click", async () => {
      go.disabled = true; msg.textContent = "Saving…";
      try { await api("/api/orders", { method: "POST", body: { store: o.store, id: o.id, action: "note", note: ta.value } }); toast("Note saved."); close(); load(); }
      catch (e) { msg.textContent = e.message; go.disabled = false; }
    });
    return el("div", { class: "ffl" }, el("strong", {}, `Staff note on ${o.name}`), el("p", { class: "muted small" }, "Only you and staff see this, in Shopify and here."), ta,
      el("div", { class: "row" }, go, el("button", { class: "btn ghost", type: "button", onclick: close }, "Cancel")), msg);
  }

  function paint() {
    const d = view.data;
    if (!d) return;
    paintSummary(d);
    const all = d.stores.flatMap((s) => s.orders.map((o) => ({ o, s })));
    const f = view.filter;
    const shown = all.filter(({ o }) => f === "open" ? o.open : f === "all" ? true : o.store === f)
      .sort((a, b) => (b.o.open - a.o.open) || b.o.createdAt.localeCompare(a.o.createdAt));
    listHead.textContent = f === "open" ? "Needs you" : f === "all" ? "All orders" : `${STORE_NAME[f]} orders`;
    list.replaceChildren(...(shown.length ? shown.map(({ o, s }) => orderCard(o, s))
      : [el("p", { class: "empty" }, f === "open" ? "Nothing needs you right now. New orders show here as soon as they come in." : "No orders in the last 60 days.")]));
    const recent = all.filter(({ o }) => !o.open).sort((a, b) => b.o.createdAt.localeCompare(a.o.createdAt)).slice(0, 25);
    recentWrap.hidden = f !== "open" || !recent.length;
    recentWrap.replaceChildren(el("h2", {}, "Recently done"), el("div", { class: "tbl" }, el("table", { class: "rec" },
      el("thead", {}, el("tr", {}, ["Order", "Store", "Date", "Total", "Status"].map((h, i) => el("th", { scope: "col", class: i === 1 || i === 2 ? "hide-sm" : null }, h)))),
      el("tbody", {}, recent.map(({ o }) => el("tr", {},
        el("td", {}, el("a", { href: o.adminUrl, target: "_blank", rel: "noopener" }, o.name)),
        el("td", { class: "hide-sm" }, STORE_NAME[o.store]), el("td", { class: "hide-sm" }, when(o.createdAt)),
        el("td", { class: "r" }, money(o.total, o.currency)), el("td", {}, o.next.text)))))));
    stamp.textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  async function load() {
    if (view.busy) return;
    view.busy = true; refresh.disabled = true; status.textContent = "Loading orders…";
    if (!view.data) list.replaceChildren(el("p", { class: "muted" }, "Asking both stores for orders…"));
    try {
      const d = await api("/api/orders?store=all&days=60");
      view.data = d;
      try { localStorage.setItem(CACHE, JSON.stringify(scrub(d))); } catch { /* storage blocked */ }
      paint(); status.textContent = "Orders loaded.";
    } catch (e) {
      status.textContent = "Couldn't load orders.";
      const box = el("div", { class: "err", role: "alert" }, el("strong", {}, "Couldn't load orders. "), e.message,
        e.status === 404 || e.code === "no_api" ? " The engine needs its latest update (Desktop\\creative-lab-engine\\redeploy-engine.ps1)." : "");
      if (view.data) list.prepend(box); else list.replaceChildren(box);
    } finally { view.busy = false; refresh.disabled = false; }
  }

  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && Array.isArray(c.stores)) { view.data = c; paint(); stamp.textContent += " · refreshing…"; } } catch { /* ignore */ }
  load();
  return root;
}
