// Charleston 3D products: pick which designs are on charleston3d.com.
// Flipping a switch makes the product active in Shopify, publishes it to the site's sales channel
// and rebuilds the site, which takes a couple of minutes to go live.
import { el, store, toast } from "./app.js";

const API = "/api/products";
const keyHeader = () => { const k = store.get("bc-key", ""); return k ? { "x-console-key": k } : {}; };
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const SITE = "https://charleston3d.com";

export async function renderProducts() {
  const wrap = el("section", { class: "panel brand-c3d" });
  const filter = el("select", { class: "field", "aria-label": "Show" },
    el("option", { value: "all" }, "All products"), el("option", { value: "live" }, "On the site"), el("option", { value: "off" }, "Not on the site"));
  const search = el("input", { class: "field", type: "search", placeholder: "Search products", "aria-label": "Search products" });
  const summary = el("p", { class: "muted small" });
  const body = el("tbody");
  wrap.append(
    el("div", { class: "panel-head" }, el("h2", {}, "Products on charleston3d.com"), el("div", { class: "row" }, search, filter)),
    summary,
    el("div", { class: "tbl" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Product"), el("th", {}, "Price"), el("th", {}, "Shopify"), el("th", {}, "On the site"))),
      body)),
  );

  let products = [];
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = products.filter((p) =>
      (filter.value === "all" || (filter.value === "live") === p.live) &&
      (!q || `${p.title} ${p.type}`.toLowerCase().includes(q)));
    summary.textContent = `${products.filter((p) => p.live).length} of ${products.length} products are on the site. Changes go live in about two minutes.`;
    body.replaceChildren(...shown.map((p) => {
      const toggle = el("input", { type: "checkbox", role: "switch", "aria-label": `Show ${p.title} on the site` });
      toggle.checked = p.live;
      toggle.addEventListener("change", async () => {
        toggle.disabled = true;
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json", ...keyHeader() },
            body: JSON.stringify({ id: p.id, live: toggle.checked }),
          });
          const out = await res.json();
          if (!res.ok) throw new Error(out.error ?? `Error ${res.status}`);
          p.live = toggle.checked;
          if (p.live) p.status = "ACTIVE";
          toast(p.live ? `${p.title} is going live` : `${p.title} is coming off the site`);
          draw();
        } catch (e) {
          toggle.checked = !toggle.checked;
          toast(e.message);
        } finally {
          toggle.disabled = false;
        }
      });
      return el("tr", {},
        el("td", {}, p.image ? el("img", { src: `${p.image}&width=96`, alt: "", width: "48", height: "48", loading: "lazy", style: "border-radius:8px;object-fit:cover" }) : ""),
        el("td", {}, p.live
          ? el("a", { href: `${SITE}/products/${p.handle}/`, target: "_blank", rel: "noopener" }, p.title)
          : p.title, el("div", { class: "muted small" }, p.type)),
        el("td", {}, money(p.price)),
        el("td", {}, el("span", { class: `pill ${p.status === "ACTIVE" ? "s-live" : "s-empty"}` }, p.status === "ACTIVE" ? "Active" : "Draft")),
        el("td", {}, el("label", { class: "row" }, toggle, p.live ? "Live" : "Off")));
    }));
  };
  search.addEventListener("input", draw);
  filter.addEventListener("change", draw);

  try {
    const res = await fetch(API, { headers: { accept: "application/json" } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `The products API isn't reachable (${res.status}).`);
    products = out.products;
    draw();
  } catch (e) {
    wrap.append(el("p", { class: "alert" }, e.message));
  }
  return wrap;
}
