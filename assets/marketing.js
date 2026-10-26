// Marketing: per-store SEO, local (GEO), Bing, AI-assistant and analytics health from /api/marketing,
// with fixes made right here (product and collection SEO, alt text, theme settings, IndexNow) and
// traffic by source and UTM campaign. Each store is checked and changed on its own.
import { el, store, toast } from "./app.js";
import { SETUP_URL, STORES, api, host, initialStore, storeSwitcher } from "./api.js";

const AREAS = [["seo", "Google search"], ["geo", "Local (Charleston)"], ["bing", "Bing + IndexNow"], ["ai", "AI assistants"], ["analytics", "Analytics"]];
const LEVEL = { fail: ["Fix", "s-blind"], warn: ["Improve", "s-attn"], pass: ["OK", "s-live"] };
const num = (n) => (n ?? 0).toLocaleString("en-US");
const ext = (href, label, cls = "btn") => el("a", { class: cls, href, target: "_blank", rel: "noopener" }, label, el("span", { class: "ext", "aria-hidden": "true" }, "↗"));
const KEY_REASON = "Marketing checks and changes need the console key (the CONSOLE_KEY value set for this console).";

function errorState(e, what, retry) {
  const setup = e.code === "not_connected" || e.code === "bad_config";
  const scopes = e.details?.scopes;
  return el("div", { class: `state state-${setup || scopes ? "setup" : "error"}`, role: setup ? null : "alert" },
    el("strong", {}, setup ? "This store isn't connected yet" : `Couldn't load ${what}`),
    el("p", {}, e.message),
    el("div", { class: "row" },
      setup || scopes ? ext(SETUP_URL, "How to connect a store") : null,
      el("button", { class: "btn", type: "button", onclick: retry }, e.code === "cancelled" ? "Enter key" : "Try again")));
}
const loading = (t) => el("p", { class: "muted" }, t);
function counter(input, max, ideal) {
  const out = el("span", { class: "muted small num", "aria-live": "polite" });
  const paint = () => {
    const n = input.value.trim().length;
    out.textContent = `${n} / ${max}`;
    out.style.color = n > max ? "var(--bad)" : ideal && n && (n < ideal[0] || n > ideal[1]) ? "var(--warn)" : "";
  };
  input.addEventListener("input", paint);
  paint();
  return out;
}

// ---------- score trend (tiny inline SVG) ----------
function spark(values) {
  const vals = values.filter((v) => v != null);
  if (vals.length < 2) return null;
  const W = 120, H = 28;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 2 - (v / 100) * (H - 4)).toFixed(1)}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("aria-hidden", "true"); svg.classList.add("spark");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", pts);
  svg.append(line);
  return svg;
}

// ---------- page ----------
export async function renderMarketing() {
  const state = { store: initialStore(), req: 0 };
  const root = el("div", { class: "stack marketing", style: "gap:16px" });
  const run = el("button", { class: "btn ghost", type: "button", id: "mk-run" }, "Check again");
  const body = el("div", { class: "stack", style: "gap:16px" });
  root.append(el("div", { class: "toolbar" }, storeSwitcher(state.store, (k) => { state.store = k; load(); }), run), body);
  run.addEventListener("click", () => load());

  function load() {
    const id = ++state.req;
    const s = state.store, st = STORES[s];
    const live = () => id === state.req;
    const section = (title, sub, cls = "") => {
      const content = el("div", { class: "stack", "aria-live": "polite" }, loading(`Loading ${title.toLowerCase()}…`));
      return [el("section", { class: `panel brand-${s} ${cls}` }, el("div", { class: "panel-head" }, el("h2", {}, title), sub ?? null), content), content];
    };
    const [auditPanel, auditBox] = section("Health check", el("span", { class: "muted small" }, host(st.site)), "brand-band");
    const [catPanel, catBox] = section("Products and collections");
    const [setPanel, setBox] = section("Site settings", el("span", { class: "muted small" }, "Changes the live theme"));
    const [trafPanel, trafBox] = section("Where visitors come from", el("span", { class: "muted small" }, "Last 90 days"));
    const [searchPanel, searchBox] = section("Search queries");
    body.replaceChildren(auditPanel, catPanel, setPanel, trafPanel, searchPanel, utmPanel(s), toolsPanel(s));

    const fetchPart = (part) => api(`/api/marketing?store=${s}&part=${part}`, { key: true, reason: KEY_REASON });
    // The audit first (it can ask for the key once); the others follow with the key in hand.
    fetchPart("audit").then((a) => live() && auditBox.replaceChildren(...auditView(a)))
      .catch((e) => live() && auditBox.replaceChildren(errorState(e, "the health check", load)))
      .finally(() => {
        if (!live()) return;
        fetchPart("catalog").then((c) => live() && catBox.replaceChildren(...catalogView(s, c))).catch((e) => live() && catBox.replaceChildren(errorState(e, "products and collections", load)));
        fetchPart("settings").then((c) => live() && setBox.replaceChildren(settingsView(s, c))).catch((e) => live() && setBox.replaceChildren(errorState(e, "the site settings", load)));
        fetchPart("traffic").then((t) => { if (!live()) return; trafBox.replaceChildren(...trafficView(t)); searchBox.replaceChildren(...queriesView(t)); })
          .catch((e) => { if (!live()) return; trafBox.replaceChildren(errorState(e, "traffic", load)); searchBox.replaceChildren(el("p", { class: "muted" }, "Needs the store connected first.")); });
      });
  }

  // ---------- health check ----------
  function auditView(a) {
    const out = [];
    const prev = a.previous?.scores ?? null;
    const series = (k) => a.history.map((h) => h.scores?.[k]);
    out.push(el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "Overall"), el("b", { class: "num" }, a.scores.overall == null ? "–" : `${a.scores.overall}`),
        trend(a.scores.overall, prev?.overall), spark(series("overall"))),
      ...AREAS.map(([k, label]) => el("div", { class: "tile" }, el("span", { class: "eyebrow" }, label),
        el("b", { class: "num" }, a.scores[k] == null ? "–" : `${a.scores[k]}`), trend(a.scores[k], prev?.[k]), spark(series(k))))));
    if (a.newProblems.length || a.fixed.length)
      out.push(el("p", { class: "small" },
        a.newProblems.length ? el("span", { class: "delta down" }, `▼ ${a.newProblems.length} new problem${a.newProblems.length === 1 ? "" : "s"} since ${a.previous.date}. `) : null,
        a.fixed.length ? el("span", { class: "delta up" }, `▲ ${a.fixed.length} fixed since ${a.previous.date}.`) : null));
    const fails = a.checks.filter((c) => c.level !== "pass");
    const order = { fail: 0, warn: 1 };
    out.push(el("h3", {}, fails.length ? `${fails.length} thing${fails.length === 1 ? "" : "s"} to fix or improve` : "Everything checked is in order"));
    if (fails.length)
      out.push(el("ul", { class: "checks" }, fails.sort((x, y) => order[x.level] - order[y.level]).map((c) => checkRow(c, a.newProblems.includes(c.id)))));
    const passed = a.checks.filter((c) => c.level === "pass");
    out.push(el("details", {}, el("summary", {}, `${passed.length} checks passed`), el("ul", { class: "checks" }, passed.map((c) => checkRow(c)))));
    const home = a.pages.find((p) => p.kind === "home");
    if (home) out.push(el("div", { class: "stack", style: "gap:6px" }, el("span", { class: "eyebrow" }, "How the home page looks in search"),
      el("div", { class: "serp" }, el("span", { class: "serp-url" }, host(home.url)), el("span", { class: "serp-title" }, home.title || "(no title)"), el("span", { class: "serp-desc" }, home.description || "(no description)"))));
    out.push(el("p", { class: "muted small" }, `Checked ${new Date(a.checkedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. `,
      a.historyAvailable ? "Both sites are checked again every morning, and the trend builds up here." : "History isn't kept yet: deploy with the MARKETING KV binding (see the README)."));
    return out;
  }
  const trend = (now, before) => {
    if (now == null || before == null) return el("span", { class: "muted small" }, "First check");
    const d = now - before;
    return el("span", { class: `delta ${d > 0 ? "up" : d < 0 ? "down" : "flat"}` }, d === 0 ? "■ No change" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} since last check`);
  };
  const checkRow = (c, isNew = false) => el("li", { class: `check lv-${c.level}` },
    el("span", { class: `pill ${LEVEL[c.level][1]}` }, LEVEL[c.level][0]),
    el("div", { class: "stack", style: "gap:2px" },
      el("strong", {}, c.title, isNew ? el("span", { class: "pill s-blind", style: "margin-left:6px" }, "New") : null),
      c.detail ? el("span", { class: "muted small wrap" }, c.detail) : null,
      c.fix ? el("span", { class: "small" }, c.fix) : null),
    el("span", { class: "pill b-other" }, (AREAS.find(([k]) => k === c.area) ?? [, c.area])[1]));

  // ---------- products and collections ----------
  function catalogView(s, c) {
    const out = [];
    const sum = c.summary;
    out.push(el("div", { class: "tiles" },
      el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "Ready for search"), el("b", { class: "num" }, `${num(sum.ok)} / ${num(sum.total)}`), el("span", { class: "muted small" }, "active products and collections with no issues")),
      el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "No SEO title"), el("b", { class: "num" }, num(sum.noSeoTitle))),
      el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "No SEO description"), el("b", { class: "num" }, num(sum.noSeoDescription))),
      el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "Photo without alt text"), el("b", { class: "num" }, num(sum.noAlt)))));
    let filter = store.get("bc-mk-filter", "issues");
    const list = el("div", { class: "seo-list" });
    const chips = el("div", { class: "toolbar", role: "group", "aria-label": "Show" },
      [["issues", "Needs work"], ["product", "Products"], ["collection", "Collections"], ["all", "All"]].map(([k, l]) =>
        el("button", { class: "chip", type: "button", "data-k": k, onclick: () => { filter = k; store.set("bc-mk-filter", k); draw(); } }, l)));
    function draw() {
      chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === filter)));
      const items = c.items.filter((i) => filter === "all" || (filter === "issues" ? i.issues.length : i.kind === filter));
      list.replaceChildren(...(items.length ? items.slice(0, 150).map((i) => seoRow(s, i, draw)) : [el("p", { class: "muted" }, filter === "issues" ? "Nothing needs work. Nice." : "Nothing here yet.")]));
    }
    draw();
    out.push(chips, list);
    if (c.truncated) out.push(el("p", { class: "muted small" }, "Showing the 300 most recently updated active products."));
    return out;
  }
  function seoRow(s, item, redraw) {
    const t = el("input", { class: "field", value: item.seoTitle, maxlength: "70", "aria-label": `SEO title for ${item.title}`, placeholder: item.suggestion.title });
    const d = el("textarea", { class: "field", rows: "3", maxlength: "320", "aria-label": `SEO description for ${item.title}`, placeholder: item.suggestion.description }, item.seoDescription);
    const save = el("button", { class: "btn brand", type: "button" }, "Save");
    const suggest = el("button", { class: "btn ghost", type: "button", onclick: () => { t.value = item.suggestion.title; d.value = item.suggestion.description; t.dispatchEvent(new Event("input")); d.dispatchEvent(new Event("input")); } }, "Use suggestion");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "seo", id: item.id, seoTitle: t.value, seoDescription: d.value } });
        item.seoTitle = r.seoTitle; item.seoDescription = r.seoDescription;
        item.issues = item.issues.filter((x) => x.field !== "title" && x.field !== "description");
        toast(`Saved${r.indexNow?.sent ? " and sent to Bing" : ""}: ${item.title}`);
        redraw();
      } catch (e) { toast(e.message); } finally { save.disabled = false; }
    });
    const pTitle = el("span", { class: "serp-title" }), pDesc = el("span", { class: "serp-desc" });
    const paint = () => { pTitle.textContent = t.value.trim() || item.shownTitle; pDesc.textContent = d.value.trim() || "(Google picks text from the page)"; };
    t.addEventListener("input", paint); d.addEventListener("input", paint); paint();
    const preview = el("div", { class: "serp" }, el("span", { class: "serp-url" }, item.url.replace(/^https:\/\//, "")), pTitle, pDesc);
    let altRow = null;
    if (item.mediaId) {
      const a = el("input", { class: "field", value: item.alt, maxlength: "250", "aria-label": `Alt text for ${item.title}'s photo`, placeholder: `${item.title}: what the photo shows` });
      const altSave = el("button", { class: "btn", type: "button" }, "Save alt text");
      altSave.addEventListener("click", async () => {
        altSave.disabled = true;
        try {
          const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "alt", mediaId: item.mediaId, alt: a.value } });
          item.alt = r.alt; item.issues = item.issues.filter((x) => x.field !== "alt");
          toast(`Alt text saved: ${item.title}`);
          redraw();
        } catch (e) { toast(e.message); } finally { altSave.disabled = false; }
      });
      altRow = el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, "Photo alt text"), el("div", { class: "add-row" }, a, altSave));
    }
    return el("details", { class: "seo-row" },
      el("summary", {},
        item.image ? el("img", { src: `${item.image}${item.image.includes("?") ? "&" : "?"}width=96`, alt: "", loading: "lazy" }) : el("span", { class: "noimg", "aria-hidden": "true" }),
        el("span", { class: "stack", style: "gap:2px;min-width:0" },
          el("strong", { class: "wrap" }, item.title),
          el("span", { class: "muted small" }, item.kind === "product" ? "Product" : "Collection", " · ", item.issues.length ? item.issues.map((x) => x.text).join(" · ") : "Ready for search")),
        el("span", { class: `pill ${item.issues.some((x) => x.level === "fail") ? "s-blind" : item.issues.length ? "s-attn" : "s-live"}` }, item.issues.length ? `${item.issues.length} to fix` : "OK")),
      el("div", { class: "stack seo-edit" },
        preview,
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "row small muted", style: "justify-content:space-between" }, "SEO title (30 to 60 characters)", counter(t, 70, [30, 60])), t),
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "row small muted", style: "justify-content:space-between" }, "SEO description (70 to 160 characters)", counter(d, 320, [70, 160])), d),
        el("div", { class: "row" }, save, suggest, ext(item.url, "Open page", "btn ghost")),
        altRow));
  }

  // ---------- site settings ----------
  function settingsView(s, c) {
    const form = el("form", { class: "stack" });
    const inputs = {};
    const groups = [["search", "Search and AI"], ["geo", "Location (city only, never a street address)"], ["analytics", "Analytics"]];
    for (const [g, title] of groups) {
      const fs = el("fieldset", { class: "stack fs" }, el("legend", {}, title));
      for (const [k, f] of Object.entries(c.fields).filter(([, f]) => f.group === g)) {
        const attrs = { class: "field", id: `mk-${k}`, name: k, maxlength: String(f.max), autocomplete: "off", spellcheck: f.multiline ? "true" : "false" };
        const input = f.multiline ? el("textarea", { ...attrs, rows: k === "brand_description" ? "3" : "4" }, c.settings[k]) : el("input", { ...attrs, value: c.settings[k] });
        inputs[k] = input;
        fs.append(el("label", { class: "stack", style: "gap:4px", for: `mk-${k}` }, el("span", { class: "small muted" }, f.label), input));
      }
      form.append(fs);
    }
    const save = el("button", { class: "btn brand", type: "submit" }, "Save to the live site");
    const msg = el("p", { class: "small", role: "status" });
    form.append(el("p", { class: "muted small" }, `Saved straight into the published theme "${c.theme.name}" (the same fields as Theme settings in Shopify). Shopify copies the change back to the theme's GitHub branch.`),
      el("div", { class: "row" }, save, msg));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = {};
      for (const [k, input] of Object.entries(inputs)) if (input.value.trim() !== (c.settings[k] ?? "").trim()) values[k] = input.value;
      if (!Object.keys(values).length) { msg.textContent = "Nothing changed."; return; }
      save.disabled = true; msg.textContent = "Saving…";
      try {
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "settings", values } });
        c.settings = r.settings;
        for (const [k, input] of Object.entries(inputs)) input.value = r.settings[k] ?? "";
        msg.textContent = r.changed.length ? `Saved ${r.changed.length} setting${r.changed.length === 1 ? "" : "s"}. Press Check again in a minute to see the result.` : "Saved (nothing was different).";
      } catch (err) { msg.textContent = err.message; }
      finally { save.disabled = false; }
    });
    return form;
  }

  // ---------- traffic ----------
  function trafficView(t) {
    if (!t.shop.available) return [el("p", { class: "muted" }, t.shop.note)];
    const total = t.shop.sources.reduce((a, r) => a + r.sessions, 0);
    const rate = (r) => (r.conversionRate == null ? "–" : `${r.conversionRate}%`);
    return [
      el("div", { class: "grid-2" },
        el("div", { class: "stack" }, el("h3", {}, "By source"),
          t.shop.sources.length ? el("div", { class: "tbl" }, el("table", {},
            el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Source"), el("th", { scope: "col" }, "Visits"), el("th", { scope: "col" }, "Ordered"))),
            el("tbody", {}, t.shop.sources.map((r) => el("tr", {},
              el("td", {}, r.name ? `${r.name} ` : "", el("span", { class: "muted small" }, r.source)),
              el("td", { class: "num" }, num(r.sessions), el("div", { class: "muted small" }, total ? `${Math.round((r.sessions / total) * 100)}%` : "")),
              el("td", { class: "num" }, rate(r)))))))
            : el("p", { class: "muted" }, "No visits recorded yet.")),
        el("div", { class: "stack" }, el("h3", {}, "QR codes and campaigns (UTM)"),
          t.shop.campaigns.length ? el("div", { class: "tbl" }, el("table", {},
            el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Campaign"), el("th", { scope: "col" }, "Visits"), el("th", { scope: "col" }, "Ordered"))),
            el("tbody", {}, t.shop.campaigns.map((r) => el("tr", {},
              el("td", {}, r.campaign, el("div", { class: "muted small" }, [r.source, r.medium].filter(Boolean).join(" / "))),
              el("td", { class: "num" }, num(r.sessions)), el("td", { class: "num" }, rate(r)))))))
            : el("p", { class: "muted" }, "No tagged visits yet. Scans of the QR codes and links made below show up here."))),
    ];
  }
  function queriesView(t) {
    const block = (name, d, setup) => {
      const head = el("h3", {}, name);
      if (!d.connected) return el("div", { class: "stack" }, head, el("p", { class: "muted small" }, d.note), setup);
      if (d.error) return el("div", { class: "stack" }, head, el("div", { class: "state state-setup" }, el("p", {}, d.error)));
      return el("div", { class: "stack" }, head,
        el("p", { class: "small" }, el("strong", {}, num(d.clicks)), " clicks from ", el("strong", {}, num(d.impressions)), " times in search results", d.start ? el("span", { class: "muted" }, ` (${d.start} to ${d.end})`) : null),
        d.queries.length ? el("div", { class: "tbl" }, el("table", {},
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Search"), el("th", { scope: "col" }, "Shown"), el("th", { scope: "col" }, "Clicks"), el("th", { scope: "col" }, "Position"))),
          el("tbody", {}, d.queries.map((q) => el("tr", {}, el("td", { class: "wrap" }, q.query), el("td", { class: "num" }, num(q.impressions)), el("td", { class: "num" }, num(q.clicks)), el("td", { class: "num" }, q.position ?? "–"))))))
          : el("p", { class: "muted small" }, "No searches recorded yet. New sites take a few weeks."),
        d.opportunities.length ? el("p", { class: "small" }, el("strong", {}, "Closest to page 1: "), d.opportunities.map((q) => `“${q.query}” (#${q.position})`).join(", "), ". Improve the titles and descriptions of the pages that match.") : null);
    };
    return [el("div", { class: "grid-2" },
      block("Google", t.google, ext("https://search.google.com/search-console", "Open Search Console", "btn ghost")),
      block("Bing (also feeds ChatGPT search and Copilot)", t.bing, ext("https://www.bing.com/webmasters", "Open Bing Webmaster Tools", "btn ghost")))];
  }

  // ---------- UTM link builder ----------
  function utmPanel(s) {
    const site = STORES[s].site;
    const PRESETS = [["QR code (print)", "qr", "print"], ["Instagram bio", "instagram", "social"], ["Facebook post", "facebook", "social"], ["Email", "newsletter", "email"], ["Business card", "card", "print"]];
    const page = el("input", { class: "field", id: "utm-page", value: `${site}/`, "aria-label": "Page address" });
    const source = el("input", { class: "field", id: "utm-source", value: "qr", "aria-label": "Source" });
    const medium = el("input", { class: "field", id: "utm-medium", value: "print", "aria-label": "Medium" });
    const campaign = el("input", { class: "field", id: "utm-campaign", value: "", placeholder: "e.g. holiday-market", "aria-label": "Campaign" });
    const out = el("output", { class: "utm-out", for: "utm-page utm-source utm-medium utm-campaign" });
    const copy = el("button", { class: "btn", type: "button" }, "Copy link");
    const slug = (v) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const build = () => {
      let u;
      try { u = new URL(page.value.trim()); } catch { out.textContent = "Enter a full page address."; copy.disabled = true; return; }
      if (u.host !== new URL(site).host) { out.textContent = `Use a page on ${host(site)}.`; copy.disabled = true; return; }
      for (const [k, v] of [["utm_source", source.value], ["utm_medium", medium.value], ["utm_campaign", campaign.value]]) slug(v) ? u.searchParams.set(k, slug(v)) : u.searchParams.delete(k);
      out.textContent = u.toString();
      copy.disabled = !slug(campaign.value);
    };
    [page, source, medium, campaign].forEach((i) => i.addEventListener("input", build));
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(out.textContent); toast("Link copied"); } catch { toast("Couldn't copy; select the link and copy it."); } });
    build();
    return el("section", { class: `panel brand-${s}` },
      el("div", { class: "panel-head" }, el("h2", {}, "Make a tracked link"), el("span", { class: "muted small" }, "For QR codes, posts and emails")),
      el("div", { class: "toolbar" }, PRESETS.map(([l, so, me]) => el("button", { class: "chip", type: "button", onclick: () => { source.value = so; medium.value = me; build(); campaign.focus(); } }, l))),
      el("div", { class: "grid-2" },
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, "Page"), page),
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, "Campaign name (required)"), campaign),
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, "Source"), source),
        el("label", { class: "stack", style: "gap:4px" }, el("span", { class: "small muted" }, "Medium"), medium)),
      out, el("div", { class: "row" }, copy, el("span", { class: "muted small" }, "Visits from the link show under QR codes and campaigns above.")));
  }

  // ---------- tools and the monthly routine ----------
  function toolsPanel(s) {
    const site = STORES[s].site, h = host(site);
    const send = el("button", { class: "btn brand", type: "button" }, "Send every page to Bing (IndexNow)");
    const sent = el("span", { class: "small muted", role: "status" });
    send.addEventListener("click", async () => {
      send.disabled = true; sent.textContent = "Sending…";
      try {
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "indexnow" } });
        sent.textContent = `Sent ${num(r.indexNow.count)} pages to IndexNow (Bing, Yandex, Seznam, Naver).`;
      } catch (e) { sent.textContent = e.message; } finally { send.disabled = false; }
    });
    const KEY = `bc-mk-routine-${s}`;
    const ROUTINE = ["Fix everything marked Fix in the health check", "Give every product an SEO title, description and alt text",
      "Search Console: improve pages that rank 5 to 20", "Bing Webmaster Tools: check Site Scan and IndexNow",
      "Ask ChatGPT, Claude and Perplexity where to buy what you sell in Charleston; fix llms.txt if they're wrong",
      "Run the Rich Results Test on a product and a collection", "Add new reviews and photos", "Plan the next season's collection 6 to 8 weeks ahead"];
    const month = new Date().toISOString().slice(0, 7);
    let done = store.get(KEY, { month, done: [] });
    if (done.month !== month) done = { month, done: [] };
    const list = el("div", { class: "todo" }, ROUTINE.map((t, i) => el("label", { class: done.done.includes(i) ? "done" : "" },
      el("input", { type: "checkbox", checked: done.done.includes(i), onchange: (e) => {
        done.done = e.target.checked ? [...new Set([...done.done, i])] : done.done.filter((x) => x !== i);
        store.set(KEY, done); e.target.closest("label").className = e.target.checked ? "done" : "";
      } }), el("span", {}, t))));
    return el("div", { class: "grid-2" },
      el("section", { class: `panel brand-${s}` }, el("h2", {}, "Tools"),
        el("div", { class: "row" }, send, sent),
        el("div", { class: "links" },
          ext("https://search.google.com/search-console", "Google Search Console", ""),
          ext("https://www.bing.com/webmasters", "Bing Webmaster Tools", ""),
          ext(`https://search.google.com/test/rich-results?url=${encodeURIComponent(`${site}/`)}`, "Rich Results Test (home page)", ""),
          ext(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(`${site}/`)}`, "PageSpeed Insights", ""),
          ext(`https://validator.schema.org/#url=${encodeURIComponent(`${site}/`)}`, "Schema validator", ""),
          ext(`https://clarity.microsoft.com/projects`, "Microsoft Clarity", ""),
          ext(`https://analytics.google.com/`, "Google Analytics", ""),
          ext(`${site}/robots.txt`, `${h}/robots.txt`, ""), ext(`${site}/sitemap.xml`, `${h}/sitemap.xml`, ""), ext(`${site}/llms.txt`, `${h}/llms.txt`, ""))),
      el("section", { class: `panel brand-${s}` }, el("h2", {}, "Monthly routine"), el("p", { class: "muted small" }, "About an hour per store. Resets each month; saved on this device."), list));
  }

  load();
  return root;
}
