// Money ideas: low-effort, low-cost ways to earn more, one card per idea, for the selected store only
// (CLAUDE.md rule 3). Steve keeps this list: add a card, move its status, write the result each week.
// An idea with no sale after 30 days of testing gets marked dropped so the list stays short.
// Source: project files revenue-ideas/low-effort-ideas.md (Oct 29 2026). Prices always come from the price sheet.
import { el } from "./app.js";

const STATUS = {
  new: ["s-empty", "New"],
  testing: ["s-attn", "Testing"],
  earning: ["s-live", "Earning"],
  dropped: ["s-blind", "Dropped"],
};

export const IDEAS = [
  { id: "IDEA-001", store: "c3d", status: "testing", name: "Rainbow Row Christmas ornaments",
    pitch: "A flat Rainbow Row ornament with the family name and 2026. Sells in November and December.",
    time: "2 to 3 hrs a week, Nov to Dec", cost: "Filament only", first: "2 to 3 weeks",
    uses: "Nameplate maker text engine, mockups",
    next: "Aaron picks style A, B or C from the samples; Steve makes the print file and listing. Last order about Dec 12." },
  { id: "IDEA-002", store: "c3d", status: "new", name: "Sell CAD files as downloads",
    pitch: "List the best tool and part designs on Printables, Cults3D and Etsy. No printing, no shipping.",
    time: "1 hr per file, then none", cost: "$0 to $5", first: "1 to 4 weeks",
    uses: "3D file library",
    next: "Aaron names 5 designs; Steve writes titles, photos list and descriptions." },
  { id: "IDEA-003", store: "ed", status: "new", name: "Ship-anywhere custom tees",
    pitch: "Aaron prints every shirt in-house. Push the shirt app to visitors who already flew home: they design online, Aaron prints and ships.",
    time: "Print time per order only", cost: "Under $20 for QR cards", first: "2 to 4 weeks",
    uses: "Shirt app, Share & QR",
    next: "A QR card to the shirt app in every bag and order, plus one post a week pointing to the app." },
  { id: "IDEA-004", store: "c3d", status: "new", name: "Short-term rental host kit",
    pitch: "House name sign plus Wi-Fi QR plaque for Charleston, Folly and Isle of Palms hosts. Hosts reorder for every property.",
    time: "1 hr per order", cost: "Filament only", first: "2 to 4 weeks",
    uses: "Maker (signs), Share & QR",
    next: "One listing, then a post in local host Facebook groups." },
  { id: "IDEA-005", store: "ed", status: "new", name: "Crew packs",
    pitch: "Matching tees for bachelorettes, weddings and reunions, three set tiers, one order form.",
    time: "1 to 2 hrs per order", cost: "$0", first: "When asked",
    uses: "Shirt designer, List a design",
    next: "Steve builds a Crew Pack product page with 3 template designs." },
  { id: "IDEA-006", store: "c3d", status: "new", name: "Gift shop consignment",
    pitch: "A small rack of Rainbow Row keychains, magnets and nameplates in 2 or 3 local boutiques and coffee shops.",
    time: "1 visit a month", cost: "About $30 of stock", first: "1 to 2 months",
    uses: "Nameplate maker, Hype chain maker",
    next: "Steve drafts a one-page pitch sheet; Aaron drops it off." },
  { id: "IDEA-007", store: "ed", status: "new", name: "Cut-file packs for Cricut",
    pitch: "Lowcountry art as SVG/PNG packs on Etsy and Creative Fabrica. Same art, no printing.",
    time: "1 hr per pack, then none", cost: "$0", first: "1 to 2 months",
    uses: "Design library",
    next: "Pick one series (Holy City or 843) and export a 10-design pack." },
];

const fact = (label, value) => el("div", {}, el("span", { class: "eyebrow" }, label), el("div", {}, value));

export function renderIdeas(k) {
  const order = ["testing", "earning", "new", "dropped"];
  const list = IDEAS.filter((i) => i.store === k).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  if (!list.length) return el("p", { class: "muted" }, "No ideas for this store yet.");
  return el("div", { class: "grid-2" }, list.map((i) => {
    const [cls, label] = STATUS[i.status];
    return el("section", { class: "panel", id: i.id },
      el("div", { class: "panel-head" }, el("h2", {}, i.name), el("span", { class: `pill ${cls}` }, label)),
      el("p", {}, i.pitch),
      el("div", { class: "grid-3", style: "grid-template-columns:repeat(auto-fit,minmax(120px,1fr))" }, fact("Hands-on time", i.time), fact("Start cost", i.cost), fact("First money", i.first)),
      fact("Uses", i.uses),
      fact("Next step", i.next),
      i.result ? fact("Result", i.result) : null);
  }));
}
