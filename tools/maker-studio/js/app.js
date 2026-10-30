// Maker Studio router.
//   #            all makers (gallery with category tabs)
//   #sign        sign maker start screen ("My list")
//   #sign/<id>   sign maker editor for one project
//   #<maker>     a settings-form maker
import { h, icon } from "./ui.js";
import { CATALOG, GROUPS } from "./makers/index.js";
import { openForm } from "./form.js";
import { openSignStart } from "./sign/start.js";
import { openSignEditor } from "./sign/editor.js";

const root = document.getElementById("app");
let current = null;

function go(hash) { location.hash = hash ? `#${hash}` : ""; }

function route() {
  if (current && current.save) current.save();
  if (current && current.close) current.close();
  current = null;
  const [id, sub] = location.hash.slice(1).split("/");
  document.body.className = "";
  if (!id) { home(); document.title = "Maker Studio · Charleston3D"; return; }
  const m = CATALOG.find((x) => x.id === id);
  if (!m) { go(""); return; }
  document.title = `${m.name} · Maker Studio`;
  if (m.id === "sign") {
    document.body.className = "page-sign";
    if (sub) { const ed = openSignEditor(root, sub, { onExit: () => go("sign") }); current = ed; }
    else openSignStart(root, { onOpen: (pid) => go(`sign/${pid}`), onHome: () => go("") });
    return;
  }
  current = openForm(root, m.id, { onPick: (x) => go(x) });
}

let tab = "All";
function home() {
  const tabs = ["All", ...GROUPS.map((g) => g.title)];
  const grid = h("div", { class: "hm-grid" });
  const bar = h("div", { class: "hm-tabs", role: "tablist" });
  function paint() {
    bar.replaceChildren(...tabs.map((t) => h("button", { type: "button", role: "tab", "aria-selected": t === tab ? "true" : "false", onclick: () => { tab = t; paint(); } }, t)));
    grid.replaceChildren(...CATALOG.filter((m) => tab === "All" || m.group === tab).map((m) =>
      h("button", { type: "button", class: "hm-card", onclick: () => go(m.id) },
        h("span", { class: "hm-pic", html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${m.icon}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
        h("span", { class: "hm-txt" }, h("strong", {}, m.name), h("span", {}, m.blurb)),
        h("span", { class: "hm-go", "aria-hidden": "true" }, icon("back", "ico flip")))));
  }
  paint();
  root.replaceChildren(h("div", { class: "hm" },
    h("header", { class: "hm-head" },
      h("svg", { class: "mark", viewBox: "0 0 24 24", "aria-hidden": "true", html: '<path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 7l9 5 9-5M12 12v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' }),
      h("div", {}, h("h1", {}, "Maker Studio"), h("p", {}, "Design it here, download a print-ready file. Made in Charleston, SC."))),
    h("h2", { class: "hm-h2" }, "Modeling tools"), bar, grid));
}

window.addEventListener("hashchange", route);
route();
