// Sign maker start screen: hero with "Create from blank" and a short how-it-works carousel, then
// "My list" of saved projects (open, rename, duplicate, delete).
import { h, icon, toast } from "../ui.js";
import { projects, uid, MAX_PROJECTS } from "./model.js";

const STEPS = [
  ["Step 1", "Pick a plate", "Choose a shape, its size, colour and border."],
  ["Step 2", "Add your design", "Text in any font, icons, shapes, your own SVG and holes."],
  ["Step 3", "Set the thickness", "Raise each part, or set it all flush for a face-down print."],
  ["Step 4", "Download", "A 3MF with one part per colour, ready for the AMS."],
];

export function openSignStart(root, { onOpen, onHome }) {
  let step = 0, expanded = false;
  const stepBox = h("div", { class: "st-steps" });
  function paintStep() {
    const [n, t, s] = STEPS[step];
    stepBox.replaceChildren(
      h("button", { type: "button", class: "st-arrow", "aria-label": "Previous step", onclick: () => { step = (step + STEPS.length - 1) % STEPS.length; paintStep(); } }, icon("back")),
      h("div", { class: "st-step" }, h("div", { class: "st-step-title" }, h("span", {}, `${n}: `), t), stepArt(step), h("p", {}, s)),
      h("button", { type: "button", class: "st-arrow next", "aria-label": "Next step", onclick: () => { step = (step + 1) % STEPS.length; paintStep(); } }, icon("back")));
  }
  const list = h("div", { class: "st-grid" });
  const count = h("span", {});
  const expandBtn = h("button", { type: "button", class: "st-expand", onclick: () => { expanded = !expanded; paintList(); } });
  function paintList() {
    const all = projects.list();
    count.textContent = `My list (${all.length} / ${MAX_PROJECTS})`;
    const cards = all.map((p) => {
      const menu = h("div", { class: "st-menu", hidden: true },
        h("button", { type: "button", onclick: (ev) => { ev.stopPropagation(); rename(p); } }, "Rename"),
        h("button", { type: "button", onclick: (ev) => { ev.stopPropagation(); if (projects.full()) return toast("My list is full. Delete a project first."); projects.save({ ...p, id: uid(), name: `${p.name} copy` }); paintList(); } }, "Duplicate"),
        h("button", { type: "button", class: "danger", onclick: (ev) => { ev.stopPropagation(); if (confirmDel(p)) { projects.remove(p.id); paintList(); } } }, "Delete"));
      return h("div", { class: "st-card", role: "button", tabindex: "0", onclick: () => onOpen(p.id), onkeydown: (ev) => { if (ev.key === "Enter") onOpen(p.id); } },
        h("div", { class: "st-pic", html: p.thumb && p.thumb.startsWith("<svg") ? p.thumb : "" }),
        h("button", { type: "button", class: "st-more", "aria-label": `More for ${p.name}`, onclick: (ev) => { ev.stopPropagation(); for (const m of list.querySelectorAll(".st-menu")) if (m !== menu) m.hidden = true; menu.hidden = !menu.hidden; } }, icon("more")),
        menu,
        h("div", { class: "st-meta" }, h("strong", {}, p.name), h("span", {}, `Last updated ${new Date(p.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`)));
    });
    const perRow = Math.max(1, Math.floor((list.clientWidth || 1200) / 250));
    const shown = expanded ? cards : cards.slice(0, perRow - 1);
    list.replaceChildren(h("button", { type: "button", class: "st-card st-new", onclick: create }, icon("plus"), h("span", {}, "New project")), ...shown);
    expandBtn.hidden = cards.length <= perRow - 1;
    expandBtn.textContent = expanded ? "Show less" : "Expand all";
  }
  function create() {
    if (projects.full()) { toast("My list is full. Delete a project first."); return; }
    onOpen(uid());
  }
  function rename(p) {
    const n = prompt("Project name", p.name);
    if (n && n.trim()) { projects.save({ ...p, name: n.trim().slice(0, 60), doc: { ...p.doc, name: n.trim().slice(0, 60) } }); paintList(); }
  }
  function confirmDel(p) { return confirm(`Delete “${p.name}”? This can't be undone.`); }

  root.replaceChildren(h("div", { class: "st" },
    h("header", { class: "st-bar" }, h("button", { type: "button", class: "st-back", onclick: onHome }, icon("back"), "All makers"), h("span", { class: "st-bar-title" }, "Sign maker")),
    h("section", { class: "st-hero" },
      h("div", { class: "st-hero-txt" }, h("h1", {}, "Sign maker"), h("p", {}, "Name plates, badges, door signs, tags, anything flat."),
        h("button", { type: "button", class: "st-cta", onclick: create }, "Create from blank", icon("back", "ico flip"))),
      stepBox),
    h("section", { class: "st-list" }, h("div", { class: "st-list-head" }, h("h2", {}, icon("grid", "ico sm"), count)), list, expandBtn)));
  paintStep(); paintList();
  document.addEventListener("click", () => { for (const m of list.querySelectorAll(".st-menu")) m.hidden = true; });
}

// Small line drawings for each step (ours).
function stepArt(i) {
  const s = (...k) => h("svg", { viewBox: "0 0 220 120", class: "st-art", "aria-hidden": "true" }, ...k);
  const plate = h("rect", { x: 40, y: 20, width: 140, height: 80, rx: 12, fill: "#f2f1ec", stroke: "#1f2b50", "stroke-width": 4 });
  if (i === 0) return s(h("rect", { x: 30, y: 30, width: 60, height: 60, rx: 8, fill: "#1f2b50" }), h("circle", { cx: 125, cy: 60, r: 30, fill: "#0e7c74" }), h("path", { d: "M180 30l24 60h-48z", fill: "#c09437" }));
  if (i === 1) return s(plate, h("text", { x: 110, y: 70, "text-anchor": "middle", "font-size": 26, "font-weight": 700, fill: "#0e7c74", "font-family": "ms-montserrat, sans-serif" }, "Hello"), h("circle", { cx: 58, cy: 38, r: 6, fill: "#fff", stroke: "#1f2b50", "stroke-width": 3 }));
  if (i === 2) return s(h("path", { d: "M30 80l80-30 80 30-80 30z", fill: "#f2f1ec", stroke: "#1f2b50", "stroke-width": 3 }), h("path", { d: "M30 80v10l80 30 80-30V80", fill: "none", stroke: "#1f2b50", "stroke-width": 3 }), h("path", { d: "M80 70l30-12 30 12-30 12z", fill: "#0e7c74" }), h("path", { d: "M110 10v34M100 32l10 12 10-12", stroke: "#c09437", "stroke-width": 4, fill: "none" }));
  return s(h("rect", { x: 70, y: 18, width: 80, height: 84, rx: 8, fill: "#f2f1ec", stroke: "#1f2b50", "stroke-width": 3 }), h("path", { d: "M110 34v40M94 60l16 16 16-16", stroke: "#0e7c74", "stroke-width": 6, fill: "none", "stroke-linecap": "round" }), h("text", { x: 110, y: 96, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "#1f2b50" }, "3MF"));
}
