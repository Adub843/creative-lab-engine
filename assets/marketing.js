// Marketing: per-store SEO, local (GEO), Bing, AI-assistant and analytics health from /api/marketing,
// with fixes made right here (product and collection SEO, alt text, theme settings, IndexNow) and
// traffic by source and UTM campaign. Each store is checked and changed on its own.
import { el, store, toast } from "./app.js";
import { SETUP_URL, STORES, api, host, initialStore, money, storeSwitcher } from "./api.js";
import { chart, numbersTable } from "./insights.js";
import { confirmButton } from "./confirm.js";

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
  const out = el("span", { class: "muted small num" });
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
  const state = { store: initialStore(), req: 0, reload: {} };
  const root = el("div", { class: "stack marketing", style: "gap:16px" });
  const run = el("button", { class: "btn ghost", type: "button", id: "mk-run" }, "Check again");
  const body = el("div", { class: "stack", style: "gap:16px" });
  // One status for screen readers per page; the panels themselves are quiet.
  const status = el("p", { class: "sr", role: "status" });
  const jump = el("nav", { class: "jump", "aria-label": "Sections on this page" });
  root.append(el("div", { class: "toolbar" }, storeSwitcher(state.store, (k) => { state.store = k; load(); }), run), jump, status, body);
  run.addEventListener("click", () => load());

  function load() {
    const id = ++state.req;
    const s = state.store, st = STORES[s];
    const live = () => id === state.req;
    run.disabled = true;
    status.textContent = `Loading ${st.name} marketing…`;
    const panels = [];
    const section = (key, title, sub, cls = "") => {
      const content = el("div", { class: "stack" }, loading(`Loading ${title.toLowerCase()}…`));
      const panel = el("section", { class: `panel brand-${s} ${cls}`, id: `mk-${key}`, tabindex: "-1" }, el("div", { class: "panel-head" }, el("h2", {}, title), sub ?? null), content);
      panels.push([key, title]);
      return [panel, content];
    };
    const [auditPanel, auditBox] = section("health", "Health check", el("span", { class: "muted small" }, host(st.site)), "brand-band");
    const [growPanel, growBox] = section("growth", "Growth", el("span", { class: "muted small" }, "Visits, time on site, carts, sales and search clicks"));
    const [chgPanel, chgBox] = section("changes", "Changes and what they did", el("span", { class: "muted small" }, "Safe fixes run every morning, 11:30 UTC"));
    const [catPanel, catBox] = section("catalog", "Products and collections");
    const [kwPanel, kwBox] = section("keywords", "Keywords", el("span", { class: "muted small" }, "Google and Bing, last 28 days"));
    const [gscPanel, gscBox] = section("google", "Google Search Console", el("span", { class: "muted small" }, "Pages, devices, sitemaps and indexing"));
    const [holoPanel, holoBox] = section("holo", "Holo AI marketing", el("span", { class: "muted small" }, "Ads, social posts, emails and blog posts"));
    const [setPanel, setBox] = section("settings", "Site settings", el("span", { class: "muted small" }, "Changes the live theme"));
    const [trafPanel, trafBox] = section("traffic", "Where visitors come from", el("span", { class: "muted small" }, "Last 90 days"));
    const [searchPanel, searchBox] = section("searches", "Search queries");
    const utm = utmPanel(s), tools = toolsPanel(s);
    utm.id = "mk-links"; tools.id = "mk-tools";
    panels.push(["links", "Link builder"], ["tools", "Tools"]);
    body.replaceChildren(auditPanel, growPanel, chgPanel, catPanel, kwPanel, gscPanel, holoPanel, setPanel, trafPanel, searchPanel, utm, tools);
    jump.replaceChildren(...panels.map(([k, t]) => el("a", { href: `#mk-${k}`, onclick: (e) => {
      e.preventDefault(); // the hash is the page's route, so scroll instead
      const target = document.getElementById(`mk-${k}`);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
    } }, t)));

    const fetchPart = (part, extra = "") => api(`/api/marketing?store=${s}&part=${part}${extra}`, { key: true, reason: KEY_REASON });
    // Each panel can be loaded again on its own, so a change only refreshes what it touched.
    const days = () => Number(store.get("bc-mk-days", 90)) || 90;
    const reload = {
      // Growth and the change log share one growth request (the log shows each change's effect).
      growth: () => {
        const growth = fetchPart("growth", `&days=${days()}`);
        const a = growth.then((g) => live() && growBox.replaceChildren(...growthView(s, g, growBox, fetchPart, live))).catch((e) => live() && growBox.replaceChildren(errorState(e, "growth", () => reload.growth())));
        const b = Promise.all([fetchPart("changes"), growth.catch(() => null)])
          .then(([c, g]) => live() && chgBox.replaceChildren(...changesView(s, c, g)))
          .catch((e) => live() && chgBox.replaceChildren(errorState(e, "the change log", () => reload.growth())));
        return Promise.all([a, b]);
      },
      catalog: () => fetchPart("catalog").then((c) => live() && catBox.replaceChildren(...catalogView(s, c))).catch((e) => live() && catBox.replaceChildren(errorState(e, "products and collections", () => reload.catalog()))),
      keywords: () => fetchPart("keywords").then((k) => live() && kwBox.replaceChildren(...keywordsView(s, k))).catch((e) => live() && kwBox.replaceChildren(errorState(e, "keywords", () => reload.keywords()))),
      google: () => fetchPart("google").then((g) => live() && gscBox.replaceChildren(...googleView(s, g))).catch((e) => live() && gscBox.replaceChildren(errorState(e, "Search Console", () => reload.google()))),
      holo: () => fetchPart("holo").then((h) => live() && holoBox.replaceChildren(...holoView(s, h))).catch((e) => live() && holoBox.replaceChildren(errorState(e, "Holo", () => reload.holo()))),
      settings: () => fetchPart("settings").then((c) => live() && setBox.replaceChildren(settingsView(s, c))).catch((e) => live() && setBox.replaceChildren(errorState(e, "the site settings", () => reload.settings()))),
      traffic: () => fetchPart("traffic").then((t) => { if (!live()) return; trafBox.replaceChildren(...trafficView(t)); searchBox.replaceChildren(...queriesView(t)); })
        .catch((e) => { if (!live()) return; trafBox.replaceChildren(errorState(e, "traffic", () => reload.traffic())); searchBox.replaceChildren(el("p", { class: "muted" }, "Needs the store connected first.")); }),
    };
    state.reload = reload;
    // The audit first (it can ask for the key once); the others follow with the key in hand.
    fetchPart("audit").then((a) => live() && auditBox.replaceChildren(...auditView(a)))
      .catch((e) => live() && auditBox.replaceChildren(errorState(e, "the health check", load)))
      .finally(() => {
        if (!live()) return;
        Promise.all(Object.values(reload).map((f) => f())).finally(() => {
          if (!live()) return;
          run.disabled = false;
          status.textContent = `${st.name} marketing loaded.`;
        });
      });
  }

  // ---------- health check ----------
  function auditView(a) {
    const out = [];
    const prev = a.previous?.scores ?? null;
    const series = (k) => a.history.map((h) => h.scores?.[k]);
    out.push(el("div", { class: "tiles tiles-6" },
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
    out.push(el("details", {}, el("summary", {}, `${passed.length} check${passed.length === 1 ? "" : "s"} passed`), el("ul", { class: "checks" }, passed.map((c) => checkRow(c)))));
    const home = a.pages.find((p) => p.kind === "home");
    if (home) out.push(el("div", { class: "stack", style: "gap:6px" }, el("span", { class: "eyebrow" }, "How the home page looks in search"),
      el("div", { class: "serp" }, el("span", { class: "serp-url" }, host(home.url)), el("span", { class: "serp-title" }, home.title || "(no title)"), el("span", { class: "serp-desc" }, home.description || "(no description)"))));
    out.push(el("p", { class: "muted small" }, `Checked ${new Date(a.checkedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. `,
      a.historyAvailable ? "Both sites are checked again every morning, and the trend builds up here." : "History isn't kept yet: the console's storage isn't set up (see the setup guide)."));
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

  // ---------- growth ----------
  // Every metric by day, with a flag on each day something was changed, so a change can be read
  // against what the site did next.
  const secs = (v) => { const n = Math.round(v ?? 0); return n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`; };
  const METRICS = [
    ["sessions", "Visits", "line", num, "shop"], ["visitors", "Visitors", "line", num, "shop"], ["duration", "Time on site", "line", secs, "shop"],
    ["cartAdds", "Added to cart", "bar", num, "shop"], ["checkouts", "Reached checkout", "bar", num, "shop"], ["orders", "Orders", "bar", num, "shop"],
    ["revenue", "Sales", "bar", (v, axis) => money(v, "USD", axis ? 0 : 2), "shop"], ["googleClicks", "Google clicks", "bar", num, "google"],
    ["bingClicks", "Bing clicks", "bar", num, "bing"], ["ga4Engagement", "Engaged visits (GA4)", "line", (v) => `${Math.round(v ?? 0)}%`, "ga4"],
    ["health", "Health score", "bar", num, null],
  ];
  const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  function growthView(s, g, box, fetchPart, live) {
    const out = [];
    const T = g.totals;
    const tile = (label, t, fmt = num) => el("div", { class: "tile" }, el("span", { class: "eyebrow" }, label), el("b", { class: "num" }, t ? fmt(t.last30) : "–"),
      t?.change == null ? el("span", { class: "muted small" }, t?.prev30 ? "No change" : "Last 30 days") : el("span", { class: `delta ${t.change > 0 ? "up" : t.change < 0 ? "down" : "flat"}` }, `${t.change > 0 ? "▲" : t.change < 0 ? "▼" : "■"} ${Math.abs(t.change)}% vs the 30 days before`));
    out.push(el("div", { class: "tiles" },
      tile("Visits", T.sessions), tile("Added to cart", T.cartAdds), tile("Orders", T.orders), tile("Sales", T.revenue, (v) => money(v)),
      g.sources.google.connected ? tile("Google clicks", T.googleClicks) : null, g.sources.bing.connected ? tile("Bing clicks", T.bingClicks) : null));
    const has = (src) => src == null || (src === "shop" ? g.sources.shop.available : g.sources[src]?.connected && !g.sources[src]?.error);
    const metrics = METRICS.filter(([k, , , , src]) => has(src) && g.series.some((d) => d[k] != null));
    let pick = store.get("bc-mk-metric", "sessions");
    if (!metrics.some(([k]) => k === pick)) pick = metrics[0]?.[0];
    const marks = new Map();
    for (const c of g.changes ?? []) { const d = c.at.slice(0, 10); marks.set(d, [...(marks.get(d) ?? []), c]); }
    const markText = (list) => list.length === 1 ? `${list[0].kind === "revert" ? "Undone" : "Changed"}: ${list[0].title}` : `${list.length} changes`;
    const chartBox = el("div", { class: "stack", style: "gap:8px" });
    const chips = el("div", { class: "toolbar", role: "group", "aria-label": "Chart" }, metrics.map(([k, l]) =>
      el("button", { class: "chip", type: "button", "data-k": k, onclick: () => { pick = k; store.set("bc-mk-metric", k); draw(); } }, l)));
    const daysSel = el("div", { class: "toolbar", role: "group", "aria-label": "Days" }, [30, 90, 180].map((n) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(n === g.days), onclick: () => {
        store.set("bc-mk-days", n);
        box.replaceChildren(loading("Loading growth…"));
        fetchPart("growth", `&days=${n}`).then((x) => live() && box.replaceChildren(...growthView(s, x, box, fetchPart, live))).catch((e) => live() && box.replaceChildren(errorState(e, "growth", load)));
      } }, `${n} days`)));
    function draw() {
      chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === pick)));
      const m = metrics.find(([k]) => k === pick);
      if (!m) { chartBox.replaceChildren(el("p", { class: "muted" }, "No daily figures yet. They start once the store's visits report is readable (read_reports).")); return; }
      const [k, label, type, fmt] = m;
      const points = g.series.map((d) => ({ label: shortDay(d.date), value: d[k] ?? 0, mark: marks.has(d.date) ? markText(marks.get(d.date)) : null }));
      chartBox.replaceChildren(
        chart({ points, type, format: fmt, title: `${label} per day, last ${g.days} days, with changes flagged` }),
        el("p", { class: "muted small" }, el("span", { class: "legend-mark", "aria-hidden": "true" }), " Flags mark the days a title, description, alt text or setting was changed. Hover or use the arrow keys to read each day."),
        numbersTable(`${label} per day`, ["Day", label, "Changes"], g.series.slice().reverse().filter((d) => d[k] != null || marks.has(d.date)).slice(0, 120).map((d) => [shortDay(d.date), fmt(d[k] ?? 0), marks.has(d.date) ? markText(marks.get(d.date)) : ""])));
    }
    out.push(el("div", { class: "row", style: "justify-content:space-between;flex-wrap:wrap;gap:8px" }, chips, daysSel), chartBox);
    draw();
    const notes = [g.sources.shop.note, g.sources.google.note ?? g.sources.google.error, g.sources.bing.note ?? g.sources.bing.error,
      g.sources.ga4.note ?? g.sources.ga4.error].filter(Boolean);
    if (notes.length) out.push(el("ul", { class: "muted small notes" }, notes.map((n) => el("li", {}, n))));
    return out;
  }

  // ---------- changes and their effect ----------
  function changesView(s, c, g) {
    const effects = new Map((g?.changes ?? []).map((x) => [x.id, x.effect]));
    const msg = el("p", { class: "small", role: "status" });
    const run = confirmButton("Apply safe fixes now", "Click again to change the live site", async () => {
      msg.textContent = "Applying…";
      try {
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "autofix" } });
        const n = r.applied.length;
        toast(n ? `Applied ${n} fix${n === 1 ? "" : "es"}` : "Nothing to fix");
        if (r.failed.length) { msg.textContent = `${r.failed.length} couldn't be saved: ${r.failed[0].error}`; return; }
        state.reload.growth(); state.reload.catalog();
      } catch (e) { msg.textContent = e.message; }
    }, "btn brand");
    const FIELD = { seoTitle: "SEO title", seoDescription: "SEO description", alt: "Photo alt text" };
    const label = (k) => FIELD[k] ?? k.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
    const show = (v) => (v === true ? "on" : v === false ? "off" : String(v));
    const fields = (x) => Object.keys(x.after ?? {}).filter((k) => (x.before?.[k] ?? "") !== x.after[k]).map((k) =>
      el("div", { class: "small wrap" }, el("span", { class: "muted" }, `${label(k)}: `), x.before?.[k] !== "" && x.before?.[k] != null ? el("s", { class: "muted" }, show(x.before[k])) : el("span", { class: "muted" }, "(empty)"), " → ", x.after[k] === "" ? "(empty)" : show(x.after[k])));
    const effectLine = (x) => {
      const e = effects.get(x.id);
      if (!e) return g ? null : el("span", { class: "muted small" }, "The effect shows once the visits report loads.");
      const what = x.kind === "settings" ? "Visits to the site" : "Visits to this page";
      if (e.early) return el("span", { class: "muted small" }, `Too early to tell: ${e.days} day${e.days === 1 ? "" : "s"} so far, judged after 7.`);
      const dir = e.change == null ? "flat" : e.change > 0 ? "up" : e.change < 0 ? "down" : "flat";
      return el("span", { class: `small delta ${dir}` }, `${what}: ${e.beforePerDay ?? 0}/day before → ${e.afterPerDay ?? 0}/day since`, e.change == null ? "" : ` (${e.change > 0 ? "+" : ""}${e.change}%)`);
    };
    const pill = (x) => x.kind === "revert" ? ["Undone", "s-attn"] : x.kind === "promotion" ? ["Promotion", "s-attn"] : x.kind === "article" ? ["Blog post", "s-live"] : x.source === "auto" ? ["Auto", "s-live"] : ["You", "b-other"];
    const row = (x) => {
      const [t, cls] = pill(x);
      const undone = x.review?.verdict === "undo";
      let undo = null;
      if (c.logAvailable && x.kind !== "revert" && x.kind !== "promotion" && x.kind !== "article" && !undone) {
        undo = confirmButton("Undo", "Click again to put it back", async () => {
          try {
            await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "undo", changeId: x.id } });
            toast(`Put back: ${x.title}`);
            state.reload.growth(); state.reload.catalog();
          } catch (e) { toast(e.message); }
        });
      }
      return el("li", { class: `check lv-${x.kind === "revert" ? "warn" : "pass"}` },
        el("span", { class: `pill ${cls}` }, t),
        el("div", { class: "stack", style: "gap:2px;min-width:0" },
          el("strong", { class: "wrap" }, x.url ? el("a", { href: x.url, target: "_blank", rel: "noopener" }, x.title) : x.title),
          ...fields(x), x.note ? el("span", { class: "muted small wrap" }, x.note) : null,
          x.kind !== "revert" ? effectLine(x) : null,
          undone ? el("span", { class: "muted small" }, x.review.by === "you" ? "You undid this." : "Undone automatically: visits fell after it.") : null),
        el("div", { class: "stack", style: "gap:4px;align-items:flex-end" },
          el("span", { class: "muted small" }, new Date(x.at).toLocaleDateString([], { month: "short", day: "numeric" })), undo));
    };
    const list = c.changes ?? [];
    return [
      el("p", { class: "small" }, c.auto
        ? "Missing or too-long SEO titles and descriptions and missing photo alt text are fixed every morning, then sent to Bing. Wording already within the limits is never changed. Every change, by the console or by you, is logged here with the old value, and its page's visits are compared for 14 days before and after. If visits fall by 30% or more, the old wording goes back by itself."
        : "Automatic morning fixes are switched off in the console's settings. The button still applies them now, and every change is still logged."),
      el("div", { class: "row" }, run, msg),
      list.length
        ? el("ul", { class: "checks" }, list.slice(0, 60).map(row))
        : el("p", { class: "muted small" }, c.logAvailable ? "Nothing has been changed yet." : "The change log needs the console's storage, which isn't set up yet (see the setup guide)."),
      list.length > 60 ? el("p", { class: "muted small" }, `Showing the latest 60 of ${list.length} changes.`) : null,
    ].filter(Boolean);
  }

  // ---------- keywords ----------
  function keywordsView(s, k) {
    const out = [];
    const rows = k.keywords ?? [];
    const pos = (x) => (x?.position == null ? "–" : `${x.position}`);
    const moved = (m) => m == null ? el("span", { class: "muted" }, "–") : el("span", { class: `delta ${m > 0 ? "up" : m < 0 ? "down" : "flat"}` }, m === 0 ? "■ 0" : `${m > 0 ? "▲" : "▼"} ${Math.abs(m)}`);
    const page = (u) => { if (!u) return "–"; try { const p = new URL(u).pathname; return el("a", { href: u, target: "_blank", rel: "noopener", class: "wrap" }, p); } catch { return u; } };
    if (rows.length)
      out.push(el("div", { class: "tbl cards" }, el("table", {},
        el("caption", { class: "sr" }, "Tracked keywords"),
        el("thead", {}, el("tr", {}, ["Keyword", "Google position", "Moved", "Google clicks", "Shown in Google", "Bing clicks", "Top page"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, rows.map((r) => el("tr", {},
          el("td", { class: "lead" }, el("strong", {}, r.keyword)), el("td", { class: "num", "data-label": "Google position" }, pos(r.google)), el("td", { "data-label": "Moved" }, moved(r.moved)),
          el("td", { class: "num", "data-label": "Google clicks" }, r.google ? num(r.google.clicks) : "–"), el("td", { class: "num", "data-label": "Shown in Google" }, r.google ? num(r.google.impressions) : "–"),
          el("td", { class: "num", "data-label": "Bing clicks" }, r.bing ? num(r.bing.clicks) : "–"), el("td", { "data-label": "Top page" }, page(r.google?.page))))))));
    else out.push(el("p", { class: "muted" }, "No keywords tracked. Add some below."));
    out.push(el("p", { class: "muted small" }, "A search counts for a keyword when it contains all of its words. Position is the average spot in Google (1 is the top). Moved compares with the 28 days before; ▲ means higher up."));
    const notes = [k.sources?.google?.note ?? k.sources?.google?.error, k.sources?.bing?.note ?? k.sources?.bing?.error].filter(Boolean);
    if (notes.length) out.push(el("ul", { class: "muted small notes" }, notes.map((n) => el("li", {}, n))));
    const box = el("textarea", { class: "field", rows: "5", "aria-label": "Keywords to track, one per line" }, rows.map((r) => r.keyword).join("\n"));
    const save = el("button", { class: "btn brand", type: "button", disabled: k.saveAvailable ? null : "" }, "Save keywords");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const list = box.value.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "keywords", keywords: list } });
        toast(`Tracking ${r.keywords.length} keyword${r.keywords.length === 1 ? "" : "s"}`);
        state.reload.keywords();
      } catch (e) { toast(e.message); save.disabled = false; }
    });
    out.push(el("details", {}, el("summary", {}, "Change the keywords"),
      el("div", { class: "stack", style: "gap:8px" },
        el("span", { class: "small muted" }, "One per line, up to 30. Each store keeps its own list."), box,
        el("div", { class: "row" }, save, k.saveAvailable ? null : el("span", { class: "muted small" }, "Saving needs the console's storage, which isn't set up yet.")))));
    return out;
  }

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
          const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "alt", mediaId: item.mediaId, alt: a.value, ...(item.kind === "product" ? { productId: item.id } : {}) } });
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

  // ---------- Google Search Console ----------
  function googleView(s, g) {
    const site = STORES[s].site;
    if (!g.connected) return [el("p", { class: "muted small" }, g.note), googleLinks(s)];
    if (g.error) return [el("div", { class: "state state-setup" }, el("p", {}, g.error)), googleLinks(s)];
    const out = [];
    const total = g.devices.reduce((a, d) => a + d.clicks, 0);
    out.push(el("p", { class: "small" }, el("span", { class: "muted" }, `${g.property} · ${g.start} to ${g.end}. `),
      g.devices.length ? g.devices.map((d) => `${d.device}: ${num(d.clicks)} clicks${total ? ` (${Math.round((d.clicks / total) * 100)}%)` : ""}`).join(" · ") : "No clicks yet."));
    // Is the home page in Google?
    const h = g.home ?? {};
    const okIdx = h.verdict === "pass";
    out.push(el("div", { class: "row", style: "align-items:flex-start" },
      el("span", { class: `pill ${h.error ? "b-other" : okIdx ? "s-live" : "s-attn"}` }, h.error ? "Unknown" : okIdx ? "Indexed" : "Not indexed"),
      el("span", { class: "small wrap" }, el("strong", {}, "Home page: "), h.error ?? [h.coverage, h.lastCrawl ? `last crawled ${new Date(h.lastCrawl).toLocaleDateString()}` : null].filter(Boolean).join(", "),
        h.googleCanonical && h.userCanonical && h.googleCanonical !== h.userCanonical ? el("span", { class: "delta down" }, ` Google picked a different main address: ${h.googleCanonical}`) : null)));
    // Pages
    out.push(g.pages.length ? el("div", { class: "tbl" }, el("table", {},
      el("thead", {}, el("tr", {}, ["Page", "Shown", "Clicks", "Click rate", "Position"].map((x) => el("th", { scope: "col" }, x)))),
      el("tbody", {}, g.pages.map((p) => el("tr", {}, el("td", { class: "wrap" }, el("a", { href: p.page, target: "_blank", rel: "noopener" }, p.page.replace(site, "") || "/")),
        el("td", { class: "num" }, num(p.impressions)), el("td", { class: "num" }, num(p.clicks)), el("td", { class: "num" }, `${p.ctr}%`), el("td", { class: "num" }, p.position ?? "–"))))))
      : el("p", { class: "muted small" }, "No pages in Google results yet. New sites take a few weeks."));
    // Sitemaps
    const send = el("button", { class: "btn ghost", type: "button" }, "Submit sitemap to Google");
    const sent = el("span", { class: "small muted", role: "status" });
    send.addEventListener("click", async () => {
      send.disabled = true; sent.textContent = "Sending…";
      try { const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "sitemap" } }); sent.textContent = `Submitted ${r.submitted}.`; }
      catch (e) { sent.textContent = e.message; } finally { send.disabled = false; }
    });
    out.push(el("h3", {}, "Sitemaps"), g.sitemaps == null ? el("p", { class: "muted small" }, "Couldn't read the sitemaps.")
      : g.sitemaps.length ? el("ul", { class: "plain stack", style: "gap:4px" }, g.sitemaps.map((m) => el("li", { class: "small wrap" }, el("span", { class: "mono" }, m.path), ` · ${num(m.urls)} pages`,
        m.downloaded ? ` · read ${new Date(m.downloaded).toLocaleDateString()}` : " · not read yet", m.errors ? el("span", { class: "delta down" }, ` · ${m.errors} errors`) : null, m.warnings ? el("span", { class: "delta flat" }, ` · ${m.warnings} warnings`) : null)))
      : el("p", { class: "muted small" }, "Google has no sitemap for this site yet. Submit it."), el("div", { class: "row" }, send, sent));
    // Check any page
    const url = el("input", { class: "field", id: `gsc-url-${s}`, value: `${site}/`, "aria-label": "Page address to check" });
    const check = el("button", { class: "btn ghost", type: "button" }, "Is it in Google?");
    const res = el("p", { class: "small wrap", role: "status" });
    check.addEventListener("click", async () => {
      check.disabled = true; res.textContent = "Asking Google…";
      try {
        const r = await api("/api/marketing", { method: "POST", key: true, reason: KEY_REASON, body: { store: s, action: "inspect", url: url.value.trim() } });
        res.replaceChildren(el("span", { class: `pill ${r.verdict === "pass" ? "s-live" : "s-attn"}` }, r.verdict === "pass" ? "Indexed" : "Not indexed"), ` ${r.coverage || ""}`,
          r.lastCrawl ? ` · last crawled ${new Date(r.lastCrawl).toLocaleDateString()}` : "", r.link ? el("span", {}, " · ", el("a", { href: r.link, target: "_blank", rel: "noopener" }, "open in Search Console")) : null);
      } catch (e) { res.textContent = e.message; } finally { check.disabled = false; }
    });
    out.push(el("h3", {}, "Check a page"), el("div", { class: "row" }, url, check), res, googleLinks(s));
    return out;
  }
  // ---------- Holo (tryholo.ai) ----------
  // Holo publishes blog posts to the store's Shopify blog itself; the console lists them and logs
  // each new one in the change log. Ads, social posts and emails are made in Holo.
  const HOLO_SHOP = { c3d: "nu2xws-gy.myshopify.com", ed: "xzqxnd-er.myshopify.com" };
  function holoView(s, h) {
    const app = h.app || "https://app.tryholo.ai/";
    const out = [];
    if (h.error) out.push(el("div", { class: "state state-setup" }, el("p", {}, h.error)));
    if (h.posts?.length) {
      out.push(el("p", { class: "small muted" }, `${num(h.total)} post${h.total === 1 ? "" : "s"} on the ${h.blog} blog.`
        + (h.logged ? ` ${num(h.logged)} new, added to the change log.` : "")));
      out.push(el("ul", { class: "plain stack", style: "gap:6px" }, h.posts.map((p) => el("li", {},
        el("a", { href: p.url, target: "_blank", rel: "noopener" }, p.title),
        p.published ? el("span", { class: "muted small" }, ` · ${new Date(p.published).toLocaleDateString()}`) : null))));
    } else if (!h.error) {
      out.push(el("p", { class: "muted" }, `No blog posts yet. Once Holo publishes to the ${h.blog} blog, they show here and in the change log.`));
      out.push(el("ol", { class: "small stack", style: "gap:4px" },
        el("li", {}, "In Holo, open Brand DNA, then Integrations."),
        el("li", {}, `Choose Shopify and enter ${HOLO_SHOP[s]}.`),
        el("li", {}, `Install Holo's connector, then pick the "${h.blog}" blog.`)));
    }
    out.push(el("div", { class: "links" },
      ext(app, "Open Holo", ""),
      ext("https://docs.tryholo.ai/ads/ads-overview", "Ads (Meta)", ""),
      ext("https://docs.tryholo.ai/socials/socials-calendar", "Social calendar", ""),
      ext("https://docs.tryholo.ai/emails/emails-overview", "Emails", ""),
      ext("https://docs.tryholo.ai/seo/create-blog-posts", "Blog posts (SEO)", ""),
      ext(h.feed, "Blog feed", "")));
    return out;
  }

  // The other Google tools for a shop. GA4 already feeds the Growth chart.
  function googleLinks(s) {
    const site = STORES[s].site;
    return el("div", { class: "links" },
      ext("https://search.google.com/search-console", "Search Console", ""),
      ext("https://merchants.google.com/", "Merchant Center (free product listings, Shopping ads)", ""),
      ext("https://analytics.google.com/", "Google Analytics (GA4)", ""),
      ext("https://business.google.com/", "Business Profile (Maps, local search)", ""),
      ext(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(`${site}/`)}`, "PageSpeed Insights", ""));
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
