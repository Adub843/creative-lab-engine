// Promotions: the marketing tools in each store's Shopify admin, run from the console through
// /api/promotions: discounts (code and automatic), gift cards, customer segments, campaigns and
// activity, sales channels and abandoned checkouts. What Shopify keeps out of its API (Shopify
// Email, automations, Flow, ad channel setup) is linked into the store's admin.
import { el, toast } from "./app.js";
import { SETUP_URL, STORES, api, initialStore, money, storeSwitcher } from "./api.js";
import { confirmButton } from "./confirm.js";

const KEY_REASON = "Promotions read and change the store, so they need the console key (the CONSOLE_KEY value set for this console).";
const ext = (href, label, cls = "btn") => el("a", { class: cls, href, target: "_blank", rel: "noopener" }, label, el("span", { class: "ext", "aria-hidden": "true" }, "↗"));
const num = (n) => (n ?? 0).toLocaleString("en-US");
const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "–");
const STATUS = { active: ["On", "s-live"], scheduled: ["Scheduled", "s-attn"], expired: ["Ended", "b-other"] };
const post = (body) => api("/api/promotions", { method: "POST", key: true, reason: KEY_REASON, body });
const field = (label, input, hint) => el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, label), input, hint ? el("span", { class: "muted small" }, hint) : null);
// Checks a form's visible fields in our own words, next to the button, instead of the browser's
// bubbles. Returns true when everything is fine; otherwise marks and focuses the first bad field.
function checkForm(form, msg) {
  let first = null;
  for (const f of form.querySelectorAll("input, select, textarea")) {
    const hidden = f.closest("[hidden]");
    f.removeAttribute("aria-invalid");
    if (hidden || f.checkValidity()) continue;
    f.setAttribute("aria-invalid", "true");
    if (!first) first = f;
  }
  if (!first) { msg.textContent = ""; return true; }
  const name = first.closest("label")?.querySelector("span")?.textContent ?? "This field";
  const v = first.validity;
  msg.textContent = v.valueMissing ? `${name} is needed.` : v.rangeUnderflow || v.rangeOverflow ? `${name} must be from ${first.min || "0"} to ${first.max}.`
    : v.tooLong ? `${name} is too long.` : first.dataset.hint ?? `${name} doesn't look right.`;
  first.focus();
  return false;
}
// datetime-local value -> ISO with the browser's offset, or "".
const iso = (v) => (v ? new Date(v).toISOString() : "");

function sectionError(d, what) {
  return el("div", { class: `state state-${d.code === "access_denied" ? "setup" : "error"}` },
    el("strong", {}, d.code === "access_denied" ? `${what} needs a permission` : `Couldn't load ${what.toLowerCase()}`),
    el("p", {}, d.error), d.scopes ? el("p", { class: "small mono" }, d.scopes.join(", ")) : null,
    d.code === "access_denied" ? ext(SETUP_URL, "How to add permissions", "btn ghost") : null);
}

export async function renderPromotions() {
  const state = { store: initialStore(), req: 0 };
  const root = el("div", { class: "stack promotions", style: "gap:16px" });
  const body = el("div", { class: "stack", style: "gap:16px" });
  const reload = el("button", { class: "btn ghost", type: "button" }, "Refresh");
  reload.addEventListener("click", () => load());
  const status = el("p", { class: "sr", role: "status" });
  root.append(el("div", { class: "toolbar" }, storeSwitcher(state.store, (k) => { state.store = k; load(); }), reload), status, body);

  async function load() {
    const id = ++state.req, s = state.store;
    body.replaceChildren(el("p", { class: "muted" }, `Loading ${STORES[s].name} promotions…`));
    reload.disabled = true;
    status.textContent = `Loading ${STORES[s].name} promotions…`;
    let d;
    try { d = await api(`/api/promotions?store=${s}`, { key: true, reason: KEY_REASON }); }
    catch (e) {
      if (id !== state.req) return;
      reload.disabled = false;
      status.textContent = `Couldn't load ${STORES[s].name} promotions.`;
      const setup = e.code === "not_connected" || e.code === "bad_config";
      body.replaceChildren(el("div", { class: `state state-${setup ? "setup" : "error"}` },
        el("strong", {}, setup ? "This store isn't connected yet" : "Couldn't load promotions"), el("p", {}, e.message),
        el("div", { class: "row" }, setup ? ext(SETUP_URL, "How to connect a store") : null,
          el("button", { class: "btn", type: "button", onclick: load }, e.code === "cancelled" ? "Enter key" : "Try again"))));
      return;
    }
    if (id !== state.req) return;
    const panel = (title, sub, ...kids) => el("section", { class: `panel brand-${s}` }, el("div", { class: "panel-head" }, el("h2", {}, title), sub ?? null), ...kids);
    body.replaceChildren(
      panel("Discounts", el("span", { class: "muted small" }, "Codes and automatic discounts"), ...discountsView(s, d)),
      el("div", { class: "grid-2" },
        panel("Gift cards", null, ...giftCardsView(s, d)),
        panel("Customer groups", el("span", { class: "muted small" }, "Shopify segments"), ...segmentsView(s, d))),
      panel("Campaigns and marketing activity", el("span", { class: "muted small" }, "Ads, emails and posts Shopify tracks"), ...campaignsView(d)),
      el("div", { class: "grid-2" },
        panel("Sales channels", null, ...channelsView(d)),
        panel("Abandoned checkouts", el("span", { class: "muted small" }, "Latest 25"), ...abandonedView(d))),
      panel("Only in Shopify's admin", el("span", { class: "muted small" }, "Shopify doesn't let apps run these"), adminOnlyView(d)));
    reload.disabled = false;
    status.textContent = `${STORES[s].name} promotions loaded.`;
  }

  // ---------- discounts ----------
  function discountsView(s, d) {
    const out = [];
    if (d.discounts.error) out.push(sectionError(d.discounts, "Discounts"));
    else if (!d.discounts.items.length) out.push(el("p", { class: "muted" }, "No discounts yet. Make the first one below."));
    else out.push(el("div", { class: "tbl cards" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Discount", "Code", "Status", "Used", "Runs", ""].map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, d.discounts.items.map((x) => {
        const [t, cls] = STATUS[x.status] ?? [x.status || "–", "b-other"];
        const on = x.status === "active" || x.status === "scheduled";
        const toggle = el("button", { class: "btn ghost", type: "button" }, on ? "Turn off" : "Turn on");
        toggle.addEventListener("click", async () => {
          toggle.disabled = true;
          try { await post({ store: s, action: "discountStatus", id: x.id, active: !on }); toast(`${x.title} turned ${on ? "off" : "on"}`); load(); }
          catch (e) { toast(e.message); toggle.disabled = false; }
        });
        const del = confirmButton("Delete", "Click again to delete", async () => {
          try { await post({ store: s, action: "discountDelete", id: x.id }); toast(`${x.title} deleted`); load(); } catch (e) { toast(e.message); }
        });
        return el("tr", {},
          el("td", { class: "wrap lead" }, el("a", { href: x.admin, target: "_blank", rel: "noopener" }, x.title || "(untitled)"), x.summary ? el("div", { class: "muted small" }, x.summary) : null),
          el("td", { class: "mono", "data-label": "Code" }, x.automatic ? el("span", { class: "muted" }, "Automatic") : x.code ?? "–"),
          el("td", { "data-label": "Status" }, el("span", { class: `pill ${cls}` }, t)),
          el("td", { class: "num", "data-label": "Used" }, num(x.used)),
          el("td", { class: "small", "data-label": "Runs" }, `${day(x.startsAt)} – ${x.endsAt ? day(x.endsAt) : "no end"}`),
          el("td", { class: "actions" }, el("div", { class: "row" }, x.kind === "app" || x.kind === "bxgy" ? null : toggle, del)));
      })))));
    if (!d.discounts.error || d.discounts.code !== "access_denied") out.push(discountForm(s, d));
    return out;
  }
  function discountForm(s, d) {
    const form = el("form", { class: "stack fs", id: "promo-discount", novalidate: true });
    const method = el("select", { class: "field", name: "method" }, el("option", { value: "code" }, "Code customers type in"), el("option", { value: "automatic" }, "Automatic (no code)"));
    const type = el("select", { class: "field", name: "type" }, el("option", { value: "percentage" }, "Percent off"), el("option", { value: "amount" }, "Dollars off the order"), el("option", { value: "shipping" }, "Free shipping"));
    const title = el("input", { class: "field", name: "title", maxlength: "255", placeholder: "e.g. Holiday market 15% off", required: true });
    const code = el("input", { class: "field mono", name: "code", maxlength: "40", pattern: "[A-Za-z0-9_\\-]{3,40}", "data-hint": "Code must be 3 to 40 letters, numbers, dashes or underscores.", placeholder: "e.g. MARKET15", autocapitalize: "characters", spellcheck: "false" });
    const value = el("input", { class: "field", name: "value", type: "number", min: "0.01", step: "0.01", placeholder: "15" });
    const min = el("input", { class: "field", name: "minSubtotal", type: "number", min: "0.01", step: "0.01", placeholder: "Optional" });
    const starts = el("input", { class: "field", name: "startsAt", type: "datetime-local" });
    const ends = el("input", { class: "field", name: "endsAt", type: "datetime-local" });
    const limit = el("input", { class: "field", name: "usageLimit", type: "number", min: "1", step: "1", placeholder: "No limit" });
    const once = el("input", { type: "checkbox", name: "oncePerCustomer" });
    const segments = d.segments.items ?? [];
    const who = el("select", { class: "field", name: "segmentId" }, el("option", { value: "" }, "Everyone"), segments.map((g) => el("option", { value: g.id }, g.name)));
    const valueLabel = el("span", { class: "small muted" }, "Percent off");
    const codeOnly = [field("Code", code), field("Total uses", limit), el("label", { class: "row small" }, once, "One use per customer")];
    const paint = () => {
      const auto = method.value === "automatic";
      codeOnly.forEach((n) => { n.hidden = auto; });
      value.closest("label").hidden = type.value === "shipping";
      valueLabel.textContent = type.value === "amount" ? "Dollars off" : "Percent off";
      value.max = type.value === "percentage" ? "100" : "100000";
      code.required = !auto;
      value.required = type.value !== "shipping";
    };
    method.addEventListener("change", paint); type.addEventListener("change", paint);
    const save = el("button", { class: "btn brand", type: "submit" }, "Create discount");
    const msg = el("p", { class: "small", role: "status" });
    form.append(el("legend", {}, "New discount"),
      el("div", { class: "form-grid" }, field("Kind", method), field("Gives", type), field("Name (shown at checkout)", title),
        el("label", { class: "stack", style: "gap:4px" }, valueLabel, value), ...codeOnly, field("Minimum order ($)", min),
        field("Starts", starts, "Leave empty to start now"), field("Ends", ends, "Leave empty for no end"), field("Who can use it", who)),
      el("p", { class: "muted small" }, "Applies to every product. Amount-off discounts still allow free shipping. Logged in the Marketing change log, so you can see what it did to visits and sales."),
      el("div", { class: "row" }, save, msg));
    paint();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!checkForm(form, msg)) return;
      const auto = method.value === "automatic";
      const b = { store: s, action: "discount", method: method.value, type: type.value, title: title.value.trim() };
      if (!auto) { b.code = code.value.trim(); b.oncePerCustomer = once.checked; if (limit.value) b.usageLimit = Number(limit.value); }
      if (type.value !== "shipping") b.value = Number(value.value);
      if (min.value) b.minSubtotal = Number(min.value);
      if (starts.value) b.startsAt = iso(starts.value);
      if (ends.value) b.endsAt = iso(ends.value);
      if (who.value) b.segmentId = who.value;
      save.disabled = true; msg.textContent = "Creating…";
      try { await post(b); toast(`Discount "${b.title}" created`); load(); }
      catch (err) { msg.textContent = err.message; save.disabled = false; }
    });
    return form;
  }

  // ---------- gift cards ----------
  function giftCardsView(s, d) {
    const out = [];
    const g = d.giftCards;
    if (g.error) out.push(sectionError(g, "Gift cards"));
    else if (!g.items.length) out.push(el("p", { class: "muted" }, "No gift cards yet."));
    else out.push(el("ul", { class: "plain stack", style: "gap:8px" }, g.items.map((c) => {
      const off = c.enabled ? confirmButton("Turn off", "Click again: this is permanent", async () => {
        try { await post({ store: s, action: "giftcardDisable", id: c.id }); toast("Gift card turned off"); load(); } catch (e) { toast(e.message); }
      }) : el("span", { class: "pill b-other" }, "Off");
      return el("li", { class: "row", style: "justify-content:space-between" },
        el("span", {}, el("a", { href: c.admin, target: "_blank", rel: "noopener", class: "mono" }, `•••• ${c.last4}`), " ",
          el("strong", {}, money(c.balance?.amount, c.balance?.currency)), el("span", { class: "muted small" }, ` of ${money(c.initial)}${c.customer ? ` · ${c.customer}` : ""}${c.expiresOn ? ` · expires ${day(c.expiresOn)}` : ""}`)),
        off);
    })));
    if (g.code === "access_denied") return out;
    const form = el("form", { class: "stack fs", id: "promo-giftcard", novalidate: true });
    const amount = el("input", { class: "field", type: "number", min: "1", max: "10000", step: "0.01", required: true, placeholder: "25" });
    const note = el("input", { class: "field", maxlength: "500", placeholder: "e.g. Market raffle prize (only you see this)" });
    const expires = el("input", { class: "field", type: "date" });
    const save = el("button", { class: "btn brand", type: "submit" }, "Create gift card");
    const msg = el("div", { class: "small", role: "status" });
    form.append(el("legend", {}, "New gift card"), el("div", { class: "form-grid" }, field("Amount ($)", amount), field("Expires", expires, "Optional")), field("Note", note), el("div", { class: "row" }, save), msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!checkForm(form, msg)) return;
      save.disabled = true; msg.textContent = "Creating…";
      try {
        const r = await post({ store: s, action: "giftcard", amount: Number(amount.value), note: note.value.trim(), ...(expires.value ? { expiresOn: expires.value } : {}) });
        // Shopify shows the full code only now; after this only the last 4 characters.
        msg.replaceChildren(el("div", { class: "state state-setup" }, el("strong", {}, "Gift card created. Copy the code now: Shopify won't show it in full again."),
          el("p", { class: "mono", style: "font-size:18px" }, r.code ?? `ending ${r.last4}`)));
        save.disabled = false;
      } catch (err) { msg.textContent = err.message; save.disabled = false; }
    });
    out.push(form);
    return out;
  }

  // ---------- segments ----------
  function segmentsView(s, d) {
    const out = [];
    const g = d.segments;
    if (g.error) { out.push(sectionError(g, "Customer groups")); return out; }
    out.push(g.items.length ? el("ul", { class: "plain stack", style: "gap:6px" }, g.items.map((x) => el("li", {},
      el("a", { href: x.admin, target: "_blank", rel: "noopener" }, x.name), el("div", { class: "muted small mono wrap" }, x.query))))
      : el("p", { class: "muted" }, "No customer groups yet. Start from a template below."));
    const have = new Set(g.items.map((x) => x.name));
    const name = el("input", { class: "field", maxlength: "255", required: true, placeholder: "e.g. Charleston locals" });
    const query = el("textarea", { class: "field mono", rows: "2", maxlength: "2000", required: true, placeholder: "number_of_orders >= 2" });
    const pick = el("select", { class: "field" }, el("option", { value: "" }, "Pick one (optional)"),
      (d.templates ?? []).filter((t) => !have.has(t.name)).map((t, i) => el("option", { value: String(i) }, t.name)));
    const usable = (d.templates ?? []).filter((t) => !have.has(t.name));
    pick.addEventListener("change", () => { const t = usable[Number(pick.value)]; if (t) { name.value = t.name; query.value = t.query; } });
    const save = el("button", { class: "btn brand", type: "submit" }, "Create group");
    const msg = el("p", { class: "small", role: "status" });
    const form = el("form", { class: "stack fs", id: "promo-segment", novalidate: true }, el("legend", {}, "New customer group"), field("Start from a template", pick), field("Name", name), field("Rule", query, "Shopify's segment rules. Use a group to aim a discount at it, or email it with Shopify Email."), el("div", { class: "row" }, save, msg));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!checkForm(form, msg)) return;
      save.disabled = true; msg.textContent = "Creating…";
      try { await post({ store: s, action: "segment", name: name.value.trim(), query: query.value.trim() }); toast(`Group "${name.value.trim()}" created`); load(); }
      catch (err) { msg.textContent = err.message; save.disabled = false; }
    });
    out.push(form);
    return out;
  }

  // ---------- campaigns ----------
  function campaignsView(d) {
    const g = d.campaigns;
    if (g.error) return [sectionError(g, "Campaigns")];
    if (!g.items.length) return [el("p", { class: "muted" }, "Nothing yet. Ads from the Google, Meta, TikTok or Pinterest apps and Shopify Email campaigns show up here once they run. For your own links (QR codes, posts), use the UTM link builder on the Marketing page."),
      el("div", { class: "row" }, el("a", { class: "btn ghost", href: `#marketing/${state.store}` }, "Open Marketing"), ext(`${d.admin}/marketing`, "Shopify marketing", "btn ghost"))];
    return [el("div", { class: "tbl cards" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Activity", "Channel", "Status", "Started", "Ad spend", "UTM campaign"].map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, g.items.map((a) => el("tr", {},
        el("td", { class: "wrap lead" }, a.title, a.app ? el("div", { class: "muted small" }, a.app) : null),
        el("td", { class: "small", "data-label": "Channel" }, [a.channel, a.tactic].filter(Boolean).join(" · ") || a.source || "–"),
        el("td", { "data-label": "Status" }, el("span", { class: `pill ${a.status === "active" ? "s-live" : "b-other"}` }, a.status || "–")),
        el("td", { class: "small", "data-label": "Started" }, day(a.createdAt)),
        el("td", { class: "num", "data-label": "Ad spend" }, a.adSpend ? money(a.adSpend.amount, a.adSpend.currency) : "–"),
        el("td", { class: "small mono", "data-label": "UTM campaign" }, a.utm?.campaign ?? "–"))))))];
  }

  // ---------- channels ----------
  function channelsView(d) {
    const g = d.channels;
    if (g.error) return [sectionError(g, "Sales channels")];
    const { installed, ads } = g.items;
    return [el("p", { class: "small" }, el("strong", {}, "Selling on: "), installed.join(", ") || "–"),
      el("ul", { class: "plain stack", style: "gap:6px" }, ads.map((c) => el("li", { class: "row", style: "justify-content:space-between" },
        el("span", {}, c.name), c.installed ? el("span", { class: "pill s-live" }, "Connected") : ext(c.app, "Add channel", "btn ghost")))),
      el("p", { class: "muted small" }, "Each channel app connects the ad account and syncs products. Ads are bought and run inside that app.")];
  }

  // ---------- abandoned ----------
  function abandonedView(d) {
    const g = d.abandoned;
    if (g.error) return [sectionError(g, "Abandoned checkouts")];
    if (!g.items.length) return [el("p", { class: "muted" }, "No abandoned checkouts right now.")];
    const total = g.items.reduce((a, c) => a + (c.total?.amount ?? 0), 0);
    return [el("p", { class: "small" }, el("strong", {}, money(total)), ` left in ${g.items.length} checkout${g.items.length === 1 ? "" : "s"}. The recovery email is Shopify's abandoned checkout automation (below); each link reopens that cart.`),
      el("ul", { class: "plain stack", style: "gap:6px" }, g.items.slice(0, 10).map((c) => el("li", {},
        el("span", { class: "small muted" }, `${day(c.createdAt)} · `), el("strong", {}, money(c.total?.amount, c.total?.currency)), c.customer ? ` · ${c.customer}` : "",
        el("div", { class: "small wrap" }, c.items.join(", ")),
        c.url ? el("button", { class: "btn ghost", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(c.url); toast("Recovery link copied"); } catch { toast(c.url); } } }, "Copy recovery link") : null))),
      ext(`${d.admin}/checkouts`, "All abandoned checkouts", "btn ghost")];
  }

  function adminOnlyView(d) {
    return el("ul", { class: "plain stack", style: "gap:8px" }, d.adminOnly.map((x) => el("li", { class: "row", style: "justify-content:space-between;align-items:flex-start" },
      el("span", {}, el("strong", {}, x.name), el("div", { class: "muted small" }, x.why)), ext(x.url, "Open", "btn ghost"))));
  }

  load();
  return root;
}
