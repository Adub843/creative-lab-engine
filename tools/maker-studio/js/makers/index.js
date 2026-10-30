// Every maker in the studio. `form` makers use the settings-form editor; the others open their own app.
import keychain from "./keychain.js";

export const CATALOG = [
  { id: "sign", kind: "app", group: "Practical and useful", name: "Sign maker", blurb: "Name plates, badges, door signs, tags, anything flat.",
    icon: "M3 6h18v10H3zM8 20h8M12 16v4M7 11h10" },
  { ...keychain, kind: "form", group: "Names and gifts" },
];

const FORM = CATALOG.filter((m) => m.kind === "form");
export const MAKERS = FORM;
export const GROUPS = [...new Set(CATALOG.map((m) => m.group))].map((title) => ({ title, makers: CATALOG.filter((m) => m.group === title) }));
