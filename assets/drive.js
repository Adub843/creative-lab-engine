// E: drive (moved here from the Design Studio, 2026-11-07): every design file on Aaron's E: drive (plus Kittl and the
// old design lab images), searchable with previews. The files never leave the drive: the console reads them from his
// PC through the Cloudflare Tunnel (lib/drive.mjs, drive-server/), so this page works while the PC is on.
// Each store sees only its own files: Elevated Designs its art, Charleston 3D its 3D models and photos.
import { el, toast } from "./app.js";
import { askForKey, consoleKey } from "./api.js";

const PER = 60;
const KEY_REASON = "The E: drive library needs the console key (the CONSOLE_KEY value set for this console).";
const KINDS = {
  ed: [["", "All"], ["image", "Images"], ["svg", "SVG"], ["dtf", "DTF and halftone"], ["logo", "Logos"], ["source", "Source files"], ["kittl", "Kittl"]],
  c3d: [["", "All"], ["3d", "3D models"], ["image", "Photos and art"], ["logo", "Logos"], ["source", "Source files"], ["kittl", "Kittl"]],
};
const size = (b) => b == null ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const extLabel = (e = "") => e.replace(".", "").toUpperCase() || "Kittl";
const where = (i) => i.src === "e" ? `E:\\${i.folder ?? ""}` : i.src === "kittl" ? "Kittl" : i.folder ?? "";

export function drivePage(header, store) {
  const brand = store === "c3d" ? "c3d" : "ed";
  const state = { q: "", kind: "", page: 0, total: 0, items: [], seq: 0 };
  const search = el("input", { class: "field", type: "search", id: "dv-q", placeholder: "Search file and folder names", "aria-label": "Search the E: drive" });
  const kinds = el("div", { class: "cat-row", role: "group", "aria-label": "File type" });
  const count = el("p", { class: "muted small", id: "dv-count", role: "status" });
  const grid = el("div", { class: "dl-grid", role: "list", "aria-label": "Files" });
  const pager = el("div", { class: "row dv-pager" });
  const dlg = el("dialog", { class: "sheet dl-sheet", id: "dv-sheet", "aria-labelledby": "dv-title" });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  const preview = (i, cls = "") => i.thumbUrl
    ? el("img", { src: i.thumbUrl, alt: "", loading: "lazy", decoding: "async", onerror: (e) => e.target.replaceWith(el("span", { class: `dv-ext ${cls}` }, extLabel(i.ext))) })
    : el("span", { class: `dv-ext ${cls}` }, extLabel(i.ext));
  const card = (i) => el("button", { class: "dl-tile", type: "button", role: "listitem", "data-id": i.id, onclick: () => openDetail(i) },
    el("span", { class: "dl-pic" }, preview(i)),
    el("span", { class: "dl-meta" }, el("strong", { title: i.name }, i.name),
      i.folder ? el("span", { class: "muted small dv-folder", title: where(i) }, String(i.folder).split("\\").slice(-2).join(" / ")) : null,
      el("span", { class: "muted small" }, [extLabel(i.ext), size(i.size), i.copies > 1 ? `${i.copies} copies` : ""].filter(Boolean).join(" · "))));

  function openDetail(i) {
    dlg.replaceChildren(el("div", { class: "dl-sheet-grid" },
      el("div", { class: "dl-big" }, preview(i, "big")),
      el("div", { class: "stack" },
        el("div", { class: "row", style: "justify-content:space-between;align-items:start" },
          el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "eyebrow" }, extLabel(i.ext)), el("h2", { id: "dv-title", class: "wrap" }, i.name),
            el("span", { class: "muted small" }, [size(i.size), i.copies > 1 ? `${i.copies} copies on the drive, listed once` : ""].filter(Boolean).join(" · "))),
          el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
        el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "eyebrow" }, "Where it is"), el("p", { class: "small wrap dv-path" }, where(i))),
        el("hr"),
        el("div", { class: "dl-acts" },
          i.fileUrl ? el("a", { class: "btn primary", href: i.fileUrl, download: i.name }, "Download") : null,
          i.link ? el("a", { class: "btn", href: i.link, target: "_blank", rel: "noopener" }, "Open in Kittl", el("span", { class: "ext", "aria-hidden": "true" }, "↗")) : null),
        el("p", { class: "muted small" }, brand === "ed"
          ? "To use it on a shirt or list it, download it and upload it to the Art library."
          : "To sell it or print it, download it and add it to the 3D file library."))));
    dlg.showModal();
  }

  async function load() {
    const seq = ++state.seq;
    if (!consoleKey.get() && !(await askForKey(KEY_REASON))) { count.textContent = ""; grid.replaceChildren(locked()); pager.replaceChildren(); return; }
    count.textContent = "Loading…";
    const qs = new URLSearchParams({ brand, page: String(state.page), per: String(PER) });
    if (state.q) qs.set("q", state.q);
    if (state.kind) qs.set("kind", state.kind);
    let res, body;
    try { res = await fetch(`/api/drive/search?${qs}`, { headers: { accept: "application/json", "x-console-key": consoleKey.get() } }); body = await res.json(); }
    catch { body = { error: res ? "The console API answered with something unexpected." : "Couldn't reach the console API. Check your connection and try again." }; }
    if (seq !== state.seq) return;
    if (res?.status === 401) { consoleKey.clear(); return load(); }
    if (!res?.ok) {
      state.items = []; state.total = 0; count.textContent = "";
      const offline = body?.code === "pc_offline";
      grid.replaceChildren(el("div", { class: `state ${offline ? "state-setup" : "state-error"}`, role: "alert", style: "grid-column:1/-1" },
        el("strong", {}, offline ? "The E: drive is offline" : body?.code === "drive_not_set_up" ? "The E: drive isn't connected yet" : "Couldn't load the E: drive"),
        el("p", {}, body?.error ?? "Something went wrong."),
        el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: load }, "Try again"))));
      pager.replaceChildren();
      return;
    }
    state.items = body.items ?? []; state.total = body.total ?? 0;
    draw();
    return true;
  }
  const locked = () => el("div", { class: "state", style: "grid-column:1/-1" }, el("strong", {}, "The E: drive needs the console key"),
    el("p", {}, "It lists private files from Aaron's PC."), el("div", { class: "row" }, el("button", { class: "btn primary", type: "button", onclick: load }, "Enter key")));
  function draw() {
    kinds.replaceChildren(...KINDS[brand].map(([k, label]) => el("button", { class: "chip", type: "button", "data-kind": k, "aria-pressed": String(k === state.kind),
      onclick: () => { state.kind = k; state.page = 0; draw(); load(); } }, label)));
    const from = state.page * PER;
    count.textContent = state.total ? `${(from + 1).toLocaleString()} to ${(from + state.items.length).toLocaleString()} of ${state.total.toLocaleString()} files` : "";
    grid.replaceChildren(...state.items.map(card));
    if (!state.items.length && state.seq) grid.append(el("p", { class: "muted", style: "grid-column:1/-1" }, "Nothing matches. Try another search or file type."));
    const pages = Math.ceil(state.total / PER);
    pager.replaceChildren(
      el("button", { class: "btn ghost", type: "button", id: "dv-prev", disabled: state.page === 0, onclick: () => { state.page--; load(); scrollTo(0, 0); } }, "Previous"),
      el("span", { class: "muted small" }, pages ? `Page ${state.page + 1} of ${pages.toLocaleString()}` : ""),
      el("button", { class: "btn ghost", type: "button", id: "dv-next", disabled: state.page + 1 >= pages, onclick: () => { state.page++; load(); scrollTo(0, 0); } }, "Next"));
  }
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim(); state.page = 0; load(); }, 300); });

  const head = header(store === "c3d" ? "Charleston 3D" : "Elevated Designs", "E: drive", brand === "c3d"
    ? "Every Charleston 3D model, print file and photo on the E: drive. Private to the team. Opens while Aaron's PC is on."
    : "Every Elevated Designs image, SVG, DTF print, logo and source file on the E: drive, plus Kittl. Opens while Aaron's PC is on.",
  [el("button", { class: "btn", type: "button", id: "dv-refresh", onclick: () => load().then((ok) => ok && toast("Refreshed")) }, "Refresh")]);
  draw();
  load();
  return [head, el("section", { class: "panel stack dv" }, el("div", { class: "toolbar" }, search), kinds, count, grid, pager), dlg];
}
