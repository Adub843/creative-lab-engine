// Shared by the Products and Insights pages: the two stores, the console key (kept for this
// browser session only), calls to the console API, and the store switcher.
import { el, store } from "./app.js";
import { BRANDS } from "./data.js";

// Names and sites come from data.js; the keys match lib/shopify.mjs STORES.
export const STORES = Object.fromEntries(["c3d", "ed"].map((k) => [k, { name: BRANDS[k].name, site: BRANDS[k].site }]));
export const SETUP_URL = "https://github.com/Adub843/Business-console#connect-a-store";
export const host = (url) => { try { return new URL(url).host; } catch { return url; } };

// ---------- console key: sessionStorage only, gone when the tab closes ----------
const KEY = "bc-console-key";
export const consoleKey = {
  get() { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } },
  set(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } },
  clear() { this.set(""); },
};
try { localStorage.removeItem("bc-key"); } catch { /* older versions kept the key here */ }

let dlg = null;
export function askForKey(reason = "Changes to the stores need the console key (the CONSOLE_KEY value set for this console).") {
  if (!dlg) {
    const input = el("input", { class: "field", id: "key-in", type: "password", autocomplete: "off", required: true });
    const msg = el("p", { class: "muted small", id: "key-msg" });
    const cancel = el("button", { class: "btn", type: "button", id: "key-cancel" }, "Cancel");
    const form = el("form", { method: "dialog", class: "stack" },
      el("h2", { id: "key-title" }, "Console key"), msg,
      el("label", { class: "stack", style: "gap:4px", for: "key-in" }, "Key", input),
      el("p", { class: "muted small" }, "Kept for this browser tab only, and cleared when you close it."),
      el("div", { class: "row", style: "justify-content:flex-end" }, cancel, el("button", { class: "btn primary", type: "submit", id: "key-save" }, "Use key")));
    dlg = el("dialog", { class: "palette keydlg", "aria-labelledby": "key-title", "aria-describedby": "key-msg" }, form);
    document.body.append(dlg);
    cancel.addEventListener("click", () => dlg.close(""));
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) dlg.close(v); });
  }
  dlg.querySelector("#key-msg").textContent = reason;
  const input = dlg.querySelector("#key-in");
  input.value = "";
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      const v = dlg.returnValue;
      dlg.returnValue = "";
      if (v) consoleKey.set(v);
      resolve(v || null);
    }, { once: true });
    dlg.showModal();
    input.focus();
  });
}

// ---------- API calls ----------
export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export async function api(path, { method = "GET", body, key = false, reason } = {}) {
  let k = consoleKey.get();
  if (key && !k) {
    k = await askForKey(reason);
    if (!k) throw new ApiError(0, "cancelled", "No console key entered, so nothing was changed.");
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(k ? { "x-console-key": k } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "offline", "Couldn't reach the console API. Check your connection and try again.");
    }
    const out = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
    if (res.ok && out) return out;
    if (res.status === 401 && key && attempt === 0) {
      consoleKey.clear();
      k = await askForKey("That key didn't work. Check it and try again.");
      if (!k) throw new ApiError(401, "cancelled", "No console key entered, so nothing was changed.");
      continue;
    }
    if (res.status === 401) consoleKey.clear(); // never keep a key the server refused
    if (!out) throw new ApiError(res.status, "no_api", res.status === 404
      ? "The console API isn't running here. Open the deployed console, or run it with netlify dev."
      : `The console API answered with an error (${res.status}).`);
    throw new ApiError(res.status, out.code ?? "error", out.error ?? `Error ${res.status}`, out.details);
  }
}

// ---------- store switcher ----------
export function initialStore() {
  const fromHash = location.hash.slice(1).split("/")[1];
  if (STORES[fromHash]) return fromHash;
  const saved = store.get("bc-store", "c3d");
  return STORES[saved] ? saved : "c3d";
}
export function storeSwitcher(current, onChange) {
  const group = el("div", { class: "seg", role: "group", "aria-label": "Store" });
  const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.store === current)));
  for (const [k, s] of Object.entries(STORES))
    group.append(el("button", { type: "button", class: `seg-btn brand-${k}`, "data-store": k, onclick: () => {
      if (k === current) return;
      current = k; store.set("bc-store", k); paint();
      const [route] = location.hash.slice(1).split("/");
      history.replaceState(null, "", `#${route || "products"}/${k}`);
      onChange(k);
    } }, s.name));
  paint();
  return group;
}

export const money = (n, currency = "USD", digits = 2) => n == null ? "–"
  : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits === 0 ? 0 : undefined }).format(n);
