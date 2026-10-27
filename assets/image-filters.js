// One filter bar for every panel that shows Elevated Designs images: the shirt designer's library,
// the Design library page and List a design. Search, a category row and (optionally) where an image
// shows, all applied the same way, so an image is found the same way everywhere.
import { el } from "./app.js";

// Brand logos come from Kittl marked private, so they stay out of the shirt app and aren't designs to sell.
export const isLogo = (i) => i.source === "kittl" && i.public !== true;
// Charleston 3D art never shows in Elevated Designs (the two brands stay separate).
export const isOtherBrand = (i) => /charleston\s*3d/i.test(i.category ?? "");
export const LOGOS = "Brand logos", SAVED = "Saved designs", OTHER = "No category";
export function categoryOf(i) {
  if (isLogo(i)) return LOGOS;
  if (i.category) return i.category;
  return /(^|\s)studio(\s|$)/.test(i.tags ?? "") ? SAVED : OTHER;
}
// What a person sees for an image: its name, or for a Kittl import with no name yet, its category and a number.
export const displayName = (i) => /^kittl-c[a-z0-9]+$/.test(i.name ?? "") ? `${categoryOf(i)} ${i.key.slice(-4).toUpperCase()}` : (i.name || "Untitled").replace(/\.(png|jpe?g|webp|gif|svg)$/i, "");

const SHOWS = [["", "Everywhere"], ["app", "In the shirt app"], ["private", "Private"]];

// filterBar({ onChange, shows }) -> { el, apply(items), setItems(items), state }
export function filterBar({ onChange, shows = false, placeholder = "Search by name, tag or category", id = "img" } = {}) {
  const state = { q: "", cat: "", show: "" };
  const search = el("input", { class: "field", type: "search", id: `${id}-q`, placeholder, "aria-label": "Search images" });
  const cats = el("div", { class: "cat-row", role: "group", "aria-label": "Category" });
  const show = shows ? el("select", { class: "field", id: `${id}-show`, "aria-label": "Where it shows" }, SHOWS.map(([v, l]) => el("option", { value: v }, l))) : null;
  let items = [];
  const drawCats = () => {
    const counts = new Map();
    for (const i of items) counts.set(categoryOf(i), (counts.get(categoryOf(i)) ?? 0) + 1);
    if (state.cat && !counts.has(state.cat)) state.cat = "";
    const list = [...counts.keys()].sort((a, b) => (a === LOGOS) - (b === LOGOS) || a.localeCompare(b));
    cats.hidden = list.length < 2;
    cats.replaceChildren(...["", ...list].map((c) => el("button", { class: "chip", type: "button", "data-cat": c, "aria-pressed": String(c === state.cat),
      onclick: () => { state.cat = c; drawCats(); onChange?.(); } }, c || "All", el("span", { class: "chip-n" }, String(c ? counts.get(c) : items.length)))));
  };
  search.addEventListener("input", () => { state.q = search.value; onChange?.(); });
  show?.addEventListener("change", () => { state.show = show.value; onChange?.(); });
  return {
    state,
    el: el("div", { class: "filter-bar" }, el("div", { class: "toolbar" }, search, show), cats),
    setItems(list) { items = list; drawCats(); },
    apply(list) {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      return list.filter((i) => (!state.cat || categoryOf(i) === state.cat)
        && (!state.show || (state.show === "app" ? i.public === true : i.public !== true))
        && words.every((w) => `${displayName(i)} ${i.name ?? ""} ${i.tags ?? ""} ${categoryOf(i)}`.toLowerCase().includes(w)));
    },
  };
}
