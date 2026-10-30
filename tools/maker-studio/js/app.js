// Maker Studio: one editor for every maker. The rail picks a maker, the panel edits its settings,
// the stage shows the design preview, and the bar downloads the print file once it passes the checks.
import { GROUPS, MAKERS } from "./makers/index.js";
import { FONTS } from "./geom.js";
import { FILAMENTS } from "./print.js";
import { Preview } from "./preview.js";
import { stl, threeMF, download } from "./export.js";

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
function toast(msg) {
  const t = h("div", { class: "toast" }, msg); $("#toasts").append(t); setTimeout(() => t.remove(), 3500);
}
const icon = (d) => h("span", { class: "mk-ico", html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
const slug = (s) => String(s || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "design";

const state = { maker: null, values: {}, result: null, seq: 0, building: false };
const preview = new Preview($("#view"));

// ---------- rail ----------
function paintRail() {
  const rail = $("#rail"); rail.replaceChildren();
  for (const g of GROUPS) {
    rail.append(h("h3", {}, g.title));
    for (const m of g.makers) {
      rail.append(h("button", { type: "button", class: "mk", "aria-current": state.maker === m ? "true" : "false", onclick: () => pick(m.id) },
        icon(m.icon), h("span", { class: "mk-txt" }, h("span", { class: "mk-name" }, m.name), h("span", { class: "mk-sub" }, m.blurb))));
    }
  }
}

// ---------- settings panel ----------
function field(f) {
  const v = state.values;
  const set = (val) => { v[f.key] = val; changed(); };
  const top = (extra) => h("div", { class: "fld-top" }, h("span", { class: "fld-label" }, f.label), extra || null);
  switch (f.type) {
    case "text": {
      const inp = f.lines > 1
        ? h("textarea", { class: "inp", rows: 1, maxlength: f.max, "aria-label": f.label, oninput: (e) => set(e.target.value) })
        : h("input", { class: "inp", type: "text", maxlength: f.max, "aria-label": f.label, oninput: (e) => set(e.target.value) });
      inp.value = v[f.key] ?? "";
      return h("div", { class: "fld" }, top(f.lines > 1 ? h("span", { class: "fld-val" }, "Enter for a second line") : null), inp);
    }
    case "range": {
      const out = h("span", { class: "fld-val" });
      const show = () => { out.textContent = `${(+v[f.key]).toFixed(f.step < 0.5 ? (f.step < 0.1 ? 2 : 1) : f.step < 1 ? 1 : 0)} ${f.unit || ""}`.trim(); };
      const inp = h("input", { type: "range", min: f.min, max: f.max, step: f.step, "aria-label": f.label,
        oninput: (e) => { v[f.key] = +e.target.value; show(); changed(); } });
      inp.value = v[f.key]; show();
      return h("div", { class: "fld" }, top(out), inp);
    }
    case "segment":
      return h("div", { class: "fld" }, top(), h("div", { class: "seg", role: "group", "aria-label": f.label },
        f.options.map(([val, label]) => h("button", { type: "button", "aria-pressed": v[f.key] === val ? "true" : "false", onclick: () => set(val) }, label))));
    case "toggle": {
      const inp = h("input", { type: "checkbox", role: "switch", onchange: (e) => set(e.target.checked) });
      inp.checked = !!v[f.key];
      return h("label", { class: "fld tgl" }, h("span", { class: "fld-label" }, f.label), inp);
    }
    case "font":
      return h("div", { class: "fld" }, top(h("span", { class: "fld-val" }, (FONTS.find((x) => x.id === v[f.key]) || FONTS[0]).name)),
        h("div", { class: "fonts", role: "group", "aria-label": f.label },
          FONTS.map((x) => h("button", { type: "button", title: x.name, style: `font-family:"ms-${x.id}"`, "aria-pressed": v[f.key] === x.id ? "true" : "false", onclick: () => set(x.id) },
            (String(v.text || "").split("\n")[0].trim() || x.name).slice(0, 14)))));
    case "filament": {
      const cur = FILAMENTS.find((x) => x.id === v[f.key]) || FILAMENTS[0];
      return h("div", { class: "fld" }, top(h("span", { class: "sw-name" }, cur.name)),
        h("div", { class: "swatches", role: "group", "aria-label": `${f.label} colour` },
          FILAMENTS.map((x) => h("button", { type: "button", class: "sw", title: x.name, "aria-label": x.name, style: `background:${x.hex}`, "aria-pressed": x.id === cur.id ? "true" : "false", onclick: () => set(x.id) }))));
    }
  }
  return null;
}

function paintPanel(focusKey) {
  const box = $("#fields"); const active = document.activeElement;
  const keep = focusKey && active && active.matches("input[type=text],textarea") ? { key: focusKey, s: active.selectionStart, e: active.selectionEnd } : null;
  box.replaceChildren(...state.maker.sections.map((sec) => {
    const fields = sec.fields.filter((f) => !f.show || f.show(state.values)).map((f) => { const el = field(f); if (el) el.dataset.key = f.key; return el; });
    return fields.length ? h("section", { class: "sec" }, h("h2", {}, sec.title), fields) : null;
  }).filter(Boolean));
  if (keep) {
    const el = box.querySelector(`[data-key="${keep.key}"] .inp`);
    if (el) { el.focus(); el.setSelectionRange(keep.s, keep.e); }
  }
}

// ---------- build ----------
let timer = null;
function changed() {
  store.set(`ms-${state.maker.id}`, state.values);
  const a = document.activeElement; const key = a && a.closest("[data-key]") && a.closest("[data-key]").dataset.key;
  // repaint only when something other than typing/sliding changed what's shown
  if (!(a && a.matches("input[type=text],textarea,input[type=range]"))) paintPanel();
  else if (a.matches("input[type=text],textarea")) refreshFontLabels();
  clearTimeout(timer); timer = setTimeout(build, 140);
  void key;
}
function refreshFontLabels() {
  const t = (String(state.values.text || "").split("\n")[0].trim());
  document.querySelectorAll(".fonts button").forEach((b) => { b.textContent = (t || b.title).slice(0, 14); });
}

async function build(refit = false) {
  const seq = ++state.seq; const m = state.maker;
  $("#busy").hidden = false;
  try {
    const r = await m.build({ ...state.values });
    if (seq !== state.seq) return;
    state.result = r;
    preview.show(r.parts, { refit });
    paintChecks(r.checks);
    const z = Math.max(...r.parts.map((p) => p.z1));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of r.parts) for (let i = 0; i < p.tris.length; i += 3) { const x = p.tris[i], y = p.tris[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    $("#dims").textContent = `${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} × ${z.toFixed(1)} mm`;
  } catch (e) {
    if (seq !== state.seq) return;
    console.error(e); toast(e.message || "That design couldn't be built.");
  } finally { if (seq === state.seq) $("#busy").hidden = true; }
}

function paintChecks(checks) {
  $("#checks").replaceChildren(...checks.map((c) => h("li", { class: c.level }, c.text)));
  const bad = checks.some((c) => c.level === "bad");
  $("#dl3mf").disabled = bad; $("#dlStl").disabled = bad;
}

function exportFile(kind) {
  const r = state.result;
  if (!r) return;
  if (r.checks.some((c) => c.level === "bad")) { toast("Fix the red print check first."); setTab("check"); return; }
  const name = slug(r.title);
  if (kind === "stl") download(`${name}.stl`, stl(r.parts, r.title));
  else download(`${name}.3mf`, threeMF(r.parts, r.title));
}

// ---------- maker switching ----------
function pick(id, first = false) {
  const m = MAKERS.find((x) => x.id === id) || MAKERS[0];
  state.maker = m;
  state.values = { ...m.defaults, ...(store.get(`ms-${m.id}`) || {}) };
  $("#makerName").textContent = m.name;
  document.title = `${m.name} · Maker Studio`;
  if (location.hash.slice(1) !== m.id) history.replaceState(null, "", `#${m.id}`);
  paintRail(); paintPanel();
  if (!first) setTab("settings");
  build(true);
}

function setTab(t) {
  $("#studio").dataset.tab = t;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.tab === "download") exportFile("3mf"); else setTab(b.dataset.tab);
}));
$("#dl3mf").addEventListener("click", () => exportFile("3mf"));
$("#dlStl").addEventListener("click", () => exportFile("stl"));
$("#fit").addEventListener("click", () => preview.fit());
window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (id && id !== state.maker.id) pick(id); });

setTab("settings");
pick(location.hash.slice(1), true);
