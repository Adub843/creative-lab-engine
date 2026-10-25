// Insights: sales, sessions, growth and a 30-day forecast for each store, from /api/insights.
// Charts are small inline SVGs drawn to the width of their box, with a hover/arrow-key readout and
// a "Show numbers" table under each one.
import { el } from "./app.js";
import { SETUP_URL, STORES, api, host, initialStore, money, storeSwitcher } from "./api.js";

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  kids.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(c)));
  return e;
};
const shortDate = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const num = (n) => (n ?? 0).toLocaleString("en-US");
const orders = (n) => `${num(n)} ${(n ?? 0) === 1 ? "order" : "orders"}`;

function delta(pct, label = "vs previous period") {
  if (pct == null) return el("span", { class: "delta flat" }, "New: nothing to compare yet");
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return el("span", { class: `delta ${dir}` },
    el("span", { "aria-hidden": "true" }, dir === "up" ? "▲ " : dir === "down" ? "▼ " : "■ "),
    `${dir === "down" ? "Down" : dir === "up" ? "Up" : "Flat"} ${Math.abs(pct)}% ${label}`);
}

// ---------- chart ----------
// points: [{ label, value, kind? }]; kind "forecast" draws a lighter, dashed bar.
function chart({ points, type = "bar", format, title, height = 200 }) {
  const box = el("div", { class: "chart", tabindex: "0", role: "img", "aria-label": title });
  const tip = el("div", { class: "tip", hidden: true, "aria-hidden": "true" });
  let active = -1, geom = null;

  function drawSvg() {
    const W = Math.max(260, Math.floor(box.clientWidth || 600));
    const H = height, L = 52, R = 8, T = 10, B = 24;
    const max = Math.max(1, ...points.map((p) => p.value ?? 0));
    const nice = niceMax(max);
    const x0 = L, x1 = W - R, y0 = H - B, y1 = T;
    const step = (x1 - x0) / Math.max(1, points.length);
    const y = (v) => y0 - ((v ?? 0) / nice) * (y0 - y1);
    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    for (const t of [0, 0.5, 1]) {
      const yy = y(nice * t);
      svg.append(s("line", { x1: x0, x2: x1, y1: yy, y2: yy, class: "grid" }), s("text", { x: x0 - 6, y: yy + 4, "text-anchor": "end", class: "axis" }, format(nice * t, true)));
    }
    const ticks = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
    for (const i of ticks) svg.append(s("text", { x: x0 + step * (i + 0.5), y: H - 6, "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle", class: "axis" }, points[i]?.label ?? ""));
    if (type === "bar") {
      const bw = Math.max(1, Math.min(28, step - 2));
      points.forEach((p, i) => {
        const h = Math.max(0, y0 - y(p.value));
        const x = x0 + step * i + (step - bw) / 2;
        const r = Math.min(4, bw / 2, h);
        svg.append(s("path", { class: `bar${p.kind === "forecast" ? " fc" : ""}`, d: h ? roundedTop(x, y0, bw, h, r) : `M${x} ${y0}h${bw}` }));
      });
    } else {
      const d = points.map((p, i) => `${i ? "L" : "M"}${(x0 + step * (i + 0.5)).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
      svg.append(s("path", { class: "area", d: `${d}L${(x0 + step * (points.length - 0.5)).toFixed(1)} ${y0}L${(x0 + step * 0.5).toFixed(1)} ${y0}Z` }), s("path", { class: "line", d }));
    }
    const cross = s("line", { class: "cross", y1: y1, y2: y0, x1: -10, x2: -10 });
    const dot = s("circle", { class: "dot", r: 4, cx: -10, cy: -10 });
    svg.append(cross, dot);
    geom = { x0, step, y, cross, dot, W };
    box.replaceChildren(svg, tip);
    if (active >= 0) show(active);
  }
  function show(i) {
    if (!geom || !points[i]) return;
    active = i;
    const p = points[i];
    const cx = geom.x0 + geom.step * (i + 0.5);
    geom.cross.setAttribute("x1", cx); geom.cross.setAttribute("x2", cx);
    geom.dot.setAttribute("cx", cx); geom.dot.setAttribute("cy", geom.y(p.value));
    tip.textContent = `${p.label}${p.kind === "forecast" ? " (forecast)" : ""}: ${format(p.value)}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(cx, 70), geom.W - 70)}px`;
  }
  function hide() { active = -1; tip.hidden = true; if (geom) { geom.cross.setAttribute("x1", -10); geom.cross.setAttribute("x2", -10); geom.dot.setAttribute("cx", -10); } }
  box.addEventListener("pointermove", (e) => {
    if (!geom) return;
    const r = box.getBoundingClientRect();
    show(Math.max(0, Math.min(points.length - 1, Math.floor((e.clientX - r.left - geom.x0) / geom.step))));
  });
  box.addEventListener("pointerleave", hide);
  box.addEventListener("blur", hide);
  box.addEventListener("keydown", (e) => {
    const k = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (k == null) return;
    e.preventDefault();
    const last = points.length - 1;
    const n = k === Infinity ? last : k === -Infinity ? 0 : active < 0 ? (k > 0 ? 0 : last) : active + k;
    show(Math.max(0, Math.min(last, n)));
  });
  const ro = new ResizeObserver(() => (box.isConnected ? drawSvg() : ro.disconnect()));
  ro.observe(box);
  return box;
}
const roundedTop = (x, y0, w, h, r) => `M${x} ${y0}V${y0 - h + r}Q${x} ${y0 - h} ${x + r} ${y0 - h}H${x + w - r}Q${x + w} ${y0 - h} ${x + w} ${y0 - h + r}V${y0}Z`;
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}
function numbersTable(caption, headers, rows) {
  return el("details", { class: "nums" }, el("summary", {}, "Show numbers"),
    el("div", { class: "tbl" }, el("table", {}, el("caption", { class: "sr" }, caption),
      el("thead", {}, el("tr", {}, headers.map((h) => el("th", { scope: "col" }, h)))),
      el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, c))))))));
}

// ---------- page ----------
export async function renderInsights() {
  const state = { store: initialStore(), days: "90", req: 0 };
  const root = el("div", { class: "stack insights", style: "gap:16px" });
  const days = el("select", { class: "field", id: "ins-days", "aria-label": "Period" },
    [["30", "Last 30 days"], ["90", "Last 90 days"], ["180", "Last 180 days"]].map(([v, l]) => el("option", { value: v, selected: v === state.days }, l)));
  const refresh = el("button", { class: "btn ghost", type: "button", id: "ins-refresh" }, "Refresh");
  const body = el("div", { class: "stack", style: "gap:16px", "aria-live": "polite" });
  const switcher = storeSwitcher(state.store, (k) => { state.store = k; load(); });
  root.append(el("div", { class: "toolbar" }, switcher, days, refresh), body);
  days.addEventListener("change", () => { state.days = days.value; load(); });
  refresh.addEventListener("click", () => load());

  async function load() {
    const id = ++state.req;
    const st = STORES[state.store];
    body.setAttribute("aria-busy", "true");
    body.replaceChildren(el("section", { class: "panel" }, el("p", { class: "muted" }, `Loading ${st.name} insights…`)));
    try {
      const data = await api(`/api/insights?store=${state.store}&days=${state.days}`, { key: true, reason: "Insights show sales figures, so they need the console key (the CONSOLE_KEY value set for this console)." });
      if (id !== state.req) return;
      body.replaceChildren(...view(data));
    } catch (e) {
      if (id !== state.req) return;
      const setup = e.code === "not_connected" || e.code === "bad_config";
      const keyed = e.code === "cancelled" || e.code === "key_not_set";
      body.replaceChildren(el("section", { class: "panel" }, el("div", { class: `state state-${setup ? "setup" : "error"}`, role: setup ? null : "alert" },
        el("strong", {}, setup ? `${st.name} isn't connected yet` : keyed ? "Insights need the console key" : `Couldn't load ${st.name} insights`),
        el("p", {}, e.message),
        el("div", { class: "row" },
          setup ? el("a", { class: "btn", href: SETUP_URL, target: "_blank", rel: "noopener" }, "How to connect a store", el("span", { class: "ext", "aria-hidden": "true" }, "↗")) : null,
          el("button", { class: "btn", type: "button", onclick: () => load() }, keyed && e.code === "cancelled" ? "Enter key" : "Try again")))));
    } finally {
      if (id === state.req) body.setAttribute("aria-busy", "false");
    }
  }

  function view(d) {
    const st = STORES[d.store];
    const cur = d.currency;
    const m0 = (v) => money(v, cur, 0);
    const out = [];

    if (d.missingScopes?.length)
      out.push(el("section", { class: "panel notice" }, el("h2", {}, "Add access to see everything"),
        el("p", {}, "Add these scopes to this store's console app, then reinstall it (in Shopify admin under Settings > Apps and sales channels > Develop apps, or in the app's version in the Dev Dashboard):"),
        el("ul", {}, d.missingScopes.map((m) => el("li", {}, el("code", {}, m.scope), ` for ${m.for}`)))));

    // KPIs
    const p = d.periods;
    const tile = (n) => el("div", { class: "tile" },
      el("span", { class: "eyebrow" }, `Last ${n} days`),
      el("b", { class: "num" }, m0(p[n].current.revenue)),
      delta(p[n].growth.revenue),
      el("span", { class: "muted small" }, `${orders(p[n].current.orders)} · ${money(p[n].current.aov, cur)} average`));
    const rc = d.repeatCustomers;
    out.push(el("section", { class: `panel brand-band brand-${d.store}` },
      el("div", { class: "panel-head" }, el("h2", {}, `${st.name} sales`), el("span", { class: "muted small" }, `Updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${d.timeZone}`)),
      d.orders.available ? el("div", { class: "tiles" }, tile("7"), tile("30"), tile("90"),
        el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "Repeat customers"),
          el("b", { class: "num" }, rc.rate == null ? "–" : `${rc.rate}%`),
          el("span", { class: "muted small" }, rc.customers ? `${rc.repeat} of ${rc.customers} customers in the period have ordered more than once${rc.basis === "window" ? " (within the period)" : ""}` : "No signed-in customers in the period")),
        el("div", { class: "tile" }, el("span", { class: "eyebrow" }, "Sessions"),
          d.sessions.available ? [el("b", { class: "num" }, num(d.sessions.total)), el("span", { class: "muted small" }, d.sessions.conversionRate == null ? "Conversion not reported" : `${d.sessions.conversionRate}% of visits ordered`)]
            : [el("b", {}, "–"), el("span", { class: "muted small" }, d.sessions.note ?? "Not available")]))
        : el("p", { class: "muted" }, "Sales aren't visible yet: add the read_orders scope (see above).")));

    if (d.orders.available) {
      // Daily revenue
      out.push(el("section", { class: `panel brand-${d.store}` },
        el("div", { class: "panel-head" }, el("h2", {}, "Revenue by day"), el("span", { class: "muted small" }, `${orders(d.orders.count)} in ${d.days} days`)),
        chart({ points: d.series.map((r) => ({ label: shortDate(r.date), value: r.revenue })), type: "bar", title: `Daily revenue for the last ${d.days} days`, format: (v, axis) => (axis ? m0(v) : money(v, cur)) }),
        numbersTable("Daily revenue", ["Day", "Revenue", "Orders"], d.series.slice().reverse().map((r) => [shortDate(r.date), money(r.revenue, cur), num(r.orders)]))));

      // Forecast
      const f = d.forecast;
      const fpoints = [...f.weekly.map((w) => ({ label: `Wk of ${shortDate(w.start)}`, value: w.revenue })),
        ...f.projected.map((w) => ({ label: `Wk of ${shortDate(w.start)}`, value: w.revenue, kind: "forecast" }))];
      out.push(el("section", { class: `panel brand-${d.store}` },
        el("div", { class: "panel-head" }, el("h2", {}, "Next 30 days"),
          el("div", { class: "legend", "aria-hidden": "true" }, el("span", { class: "key" }, "Actual week"), f.projected.length ? el("span", { class: "key fc" }, "Forecast week") : null)),
        el("p", { class: "big num" }, `About ${m0(f.next30)}`, f.low != null ? el("span", { class: "muted small" }, ` likely between ${m0(f.low)} and ${m0(f.high)}`) : null),
        chart({ points: fpoints, type: "bar", title: `Weekly revenue with a ${f.projected.length}-week forecast`, format: (v, axis) => (axis ? m0(v) : money(v, cur)), height: 180 }),
        el("p", { class: "muted small" }, el("strong", {}, "How it's worked out: "), f.explanation),
        f.seasonalNote ? el("p", { class: "seasonal small" }, el("span", { "aria-hidden": "true" }, "❄ "), f.seasonalNote) : null,
        numbersTable("Weekly revenue and forecast", ["Week", "Revenue", ""], fpoints.map((w) => [w.label, money(w.value, cur), w.kind === "forecast" ? "Forecast" : "Actual"]))));
    }

    // Sessions
    if (d.sessions.available && d.sessions.series.length)
      out.push(el("section", { class: `panel brand-${d.store}` },
        el("div", { class: "panel-head" }, el("h2", {}, "Online store visits"), el("span", { class: "muted small" }, `${num(d.sessions.total)} sessions`)),
        chart({ points: d.sessions.series.map((r) => ({ label: shortDate(r.date), value: r.sessions })), type: "line", title: "Daily online store sessions", format: (v) => num(Math.round(v)) }),
        numbersTable("Daily sessions", ["Day", "Sessions", "Conversion"], d.sessions.series.slice().reverse().map((r) => [shortDate(r.date), num(r.sessions), r.conversionRate == null ? "–" : String(r.conversionRate)]))));

    if (d.orders.available) {
      const link = (r) => r.handle ? el("a", { href: `${st.site}/products/${encodeURIComponent(r.handle)}`, target: "_blank", rel: "noopener" }, r.title) : r.title;
      out.push(el("div", { class: "grid-2" },
        el("section", { class: `panel brand-${d.store}` }, el("h2", {}, "Best sellers"),
          d.topProducts.length ? el("div", { class: "tbl" }, el("table", {},
            el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Product"), el("th", { scope: "col" }, "Sold"), el("th", { scope: "col" }, "Revenue"))),
            el("tbody", {}, d.topProducts.map((r) => el("tr", {},
              el("td", {}, link(r), el("span", { class: "share", "aria-hidden": "true" }, el("i", { style: `width:${Math.max(2, r.share)}%` }))),
              el("td", { class: "num" }, num(r.qty)),
              el("td", { class: "num" }, money(r.revenue, cur), el("div", { class: "muted small" }, `${r.share}%`)))))))
            : el("p", { class: "muted" }, `No sales in the last ${d.days} days.`)),
        el("section", { class: "panel" }, el("h2", {}, "Momentum, last 30 days vs the 30 before"),
          el("h3", {}, "Losing steam"),
          d.losingMomentum.length ? el("ul", { class: "mlist" }, d.losingMomentum.map((r) => el("li", {}, link(r), " ", el("span", { class: "delta down" }, `▼ ${m0(r.previousRevenue)} → ${m0(r.revenue)}`)))) : el("p", { class: "muted small" }, "Nothing has dropped off."),
          el("h3", {}, "Picking up"),
          d.rising.length ? el("ul", { class: "mlist" }, d.rising.map((r) => el("li", {}, link(r), " ", el("span", { class: "delta up" }, `▲ ${m0(r.previousRevenue)} → ${m0(r.revenue)}`)))) : el("p", { class: "muted small" }, "No clear risers yet."))));
    }

    out.push(el("section", { class: `panel brand-band brand-${d.store}` }, el("h2", {}, "What to do next"),
      el("ol", { class: "next" }, d.suggestions.map((t) => el("li", {}, t))),
      el("div", { class: "row" }, el("a", { class: "btn", href: `#products/${d.store}` }, "Open Products"),
        el("a", { class: "btn ghost", href: st.site, target: "_blank", rel: "noopener" }, `Open ${host(st.site)}`, el("span", { class: "ext", "aria-hidden": "true" }, "↗")))));
    if (d.notes?.length) out.push(el("p", { class: "muted small" }, d.notes.join(" ")));
    return out;
  }

  load();
  return root;
}
