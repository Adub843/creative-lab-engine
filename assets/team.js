// Team: who does what (Aaron and the OpenClaw agents), when each agent's jobs run, and the shared
// task board for the selected store (/api/team, lib/team.mjs). The board is saved online, so it's
// the same on every device; tasks from the old Home to-do list (saved in one browser) move onto it
// the first time this page opens in that browser.
import { el, store, toast } from "./app.js";
import { STORES, api, initialStore, storeSwitcher } from "./api.js";

const API = "/api/team";
const KEY_REASON = "The task board is private, so it needs the console key (the CONSOLE_KEY value set for this console).";
// The old Home list's starter tasks; only tasks Aaron typed himself are worth moving.
const SEEDS = new Set(["List a new design", "Check Insights", "Check new custom requests"]);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

// Tasks from the old device-only lists: "bc-todo-<store>", and the oldest single "bc-todo" list.
function oldTasks(k) {
  const out = [];
  for (const key of [`bc-todo-${k}`, "bc-todo"]) {
    const items = store.get(key, null);
    if (!Array.isArray(items)) continue;
    for (const it of items) if (it && typeof it.t === "string" && it.t.trim() && !SEEDS.has(it.t.trim())) out.push({ key, text: it.t.trim().slice(0, 200), done: !!it.d });
  }
  return out;
}
async function moveOldTasks(k) {
  const found = oldTasks(k);
  const keys = new Set([`bc-todo-${k}`, "bc-todo"]);
  if (found.length) await api(API, { method: "POST", key: true, reason: KEY_REASON, body: { store: k, tasks: found.slice(0, 50).map(({ text, done }) => ({ text, done })) } });
  for (const key of keys) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } }
  return found.length;
}

export async function renderTeam() {
  const state = { store: initialStore(), tasks: [], roster: [], jobs: [], who: "all", showDone: false, loading: true, error: null, req: 0 };
  const root = el("div", { class: "stack team", style: "gap:16px" });
  const status = el("p", { class: "sr", role: "status" });

  const text = el("input", { class: "field", id: "task-new", maxlength: "200", placeholder: "Add a task", "aria-label": "New task" });
  const owner = el("select", { class: "field", id: "task-owner", "aria-label": "Who does it" });
  const addBtn = el("button", { class: "btn primary", type: "submit", id: "task-add" }, "Add");
  const who = el("select", { class: "field", id: "task-who", "aria-label": "Show tasks for" });
  const list = el("div", { class: "todo tasks", role: "list", "aria-labelledby": "board-title" });
  const doneToggle = el("button", { class: "btn ghost", type: "button", id: "task-done-toggle" });
  const boardTitle = el("h2", { id: "board-title" });
  const board = el("section", { class: "panel", "aria-labelledby": "board-title" },
    el("div", { class: "panel-head" }, boardTitle, el("span", { class: "muted small" }, "Saved online: the same on every device")),
    el("form", { class: "add-row task-add", onsubmit: (e) => { e.preventDefault(); add(); } }, text, owner, addBtn),
    el("div", { class: "toolbar" }, who, doneToggle),
    list);
  const team = el("section", { class: "panel", "aria-labelledby": "team-title" },
    el("div", { class: "panel-head" }, el("h2", { id: "team-title" }, "Who does what"), el("span", { class: "muted small" }, "Times are Charleston time")));
  root.append(storeSwitcher(state.store, (k) => { state.store = k; state.who = "all"; load(); }), status, el("div", { class: "team-cols" }, board, team), handoffBoard());

  const nameOf = (id) => state.roster.find((m) => m.id === id)?.name ?? id;
  const openFor = (id) => state.tasks.filter((t) => !t.done && t.owner === id).length;

  function ownerSelect(t) {
    return el("select", { class: "field owner", "aria-label": `Who does it: ${t.text}`, onchange: (e) => change(t, { owner: e.target.value }) },
      state.roster.map((m) => el("option", { value: m.id, selected: m.id === t.owner }, m.name)));
  }
  function row(t) {
    return el("div", { class: `task${t.done ? " done" : ""}`, role: "listitem", "data-id": t.id },
      el("input", { type: "checkbox", checked: t.done, "aria-label": `Done: ${t.text}`, onchange: () => change(t, { done: !t.done }) }),
      el("span", { class: "task-t" }, t.text, el("small", { class: "muted" }, t.done ? `Done ${day(t.doneAt)}` : `Added ${day(t.createdAt)}`)),
      ownerSelect(t),
      el("button", { class: "x", type: "button", "aria-label": `Remove ${t.text}`, onclick: () => remove(t) }, "×"));
  }

  function drawTeam() {
    team.replaceChildren(team.firstChild, el("div", { class: "roster" }, state.roster.map((m) =>
      el("article", { class: "member", "data-id": m.id },
        el("div", { class: "member-head" }, el("strong", {}, m.name), el("span", { class: "pill b-other" }, m.runs),
          el("button", { class: "btn ghost small", type: "button", onclick: () => { state.who = m.id; draw(); } }, `${openFor(m.id)} open`)),
        el("p", { class: "muted small" }, m.role),
        m.jobs.length ? el("ul", { class: "jobs" }, m.jobs.map((j) => el("li", {}, j))) : null)),
      el("article", { class: "member" },
        el("div", { class: "member-head" }, el("strong", {}, "Console"), el("span", { class: "pill b-other" }, "Cloudflare")),
        el("p", { class: "muted small" }, "Runs on its own; nothing to assign"),
        el("ul", { class: "jobs" }, state.jobs.map((j) => el("li", {}, j))))));
  }

  function draw() {
    const s = STORES[state.store];
    boardTitle.textContent = `${s.name} tasks`;
    if (state.loading) { list.replaceChildren(el("p", { class: "muted" }, "Loading…")); return; }
    if (state.error) {
      list.replaceChildren(el("div", { class: "state state-error", role: "alert" }, el("strong", {}, "Couldn't load the board"), el("p", {}, state.error.message),
        el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: load }, "Try again"))));
      return;
    }
    owner.replaceChildren(...state.roster.map((m) => el("option", { value: m.id }, m.id === "aaron" ? "For me" : `For ${m.name}`)));
    who.replaceChildren(el("option", { value: "all" }, "Everyone"), ...state.roster.map((m) => el("option", { value: m.id }, m.name)));
    who.value = state.who;
    const mine = state.tasks.filter((t) => state.who === "all" || t.owner === state.who);
    const open = mine.filter((t) => !t.done);
    const done = mine.filter((t) => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    doneToggle.textContent = state.showDone ? "Hide done" : `Show done (${done.length})`;
    doneToggle.hidden = !done.length;
    const rows = [...open.map(row), ...(state.showDone ? done.slice(0, 30).map(row) : [])];
    list.replaceChildren(...(rows.length ? rows : [el("p", { class: "muted" }, state.who === "all" ? "Nothing on the board. Add the first task above." : `Nothing open for ${nameOf(state.who)}.`)]));
    drawTeam();
  }

  async function send(method, body, okMsg) {
    const at = state.store;
    try {
      const out = await api(API, { method, key: true, reason: KEY_REASON, body: { store: at, ...body } });
      if (state.store !== at) return;
      state.tasks = out.tasks ?? state.tasks;
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.code === "cancelled" ? e.message : `Couldn't save: ${e.message}`);
    }
    draw();
  }
  async function add() {
    const t = text.value.trim();
    if (!t) { text.focus(); return; }
    addBtn.disabled = true;
    await send("POST", { text: t, owner: owner.value }, owner.value === "aaron" ? "Added" : `Added for ${nameOf(owner.value)}`);
    addBtn.disabled = false;
    text.value = ""; text.focus();
  }
  const change = (t, patch) => send("PATCH", { id: t.id, ...patch });
  const remove = (t) => send("DELETE", { id: t.id }, "Removed");

  async function load() {
    const id = ++state.req, k = state.store;
    state.loading = true; state.error = null; draw();
    status.textContent = `Loading ${STORES[k].name} tasks…`;
    try {
      let out = await api(`${API}?store=${k}`, { key: true, reason: KEY_REASON });
      if (id !== state.req) return;
      const moved = await moveOldTasks(k).catch(() => 0);
      if (moved) { out = await api(`${API}?store=${k}`, { key: true }); toast(`Moved ${moved} task${moved === 1 ? "" : "s"} from this device onto the board`); }
      if (id !== state.req) return;
      Object.assign(state, { tasks: out.tasks ?? [], roster: out.roster ?? [], jobs: out.consoleJobs ?? [] });
    } catch (e) {
      if (id !== state.req) return;
      state.error = e;
    }
    state.loading = false;
    status.textContent = "";
    draw();
  }

  who.addEventListener("change", () => { state.who = who.value; draw(); });
  doneToggle.addEventListener("click", () => { state.showDone = !state.showDone; draw(); });
  load();
  return root;
}

// Home's short version: Aaron's open tasks for this store. Never asks for the key on Home.
export async function homeTasks(k, hasKey) {
  const box = el("div", { class: "stack", style: "gap:8px" });
  const link = el("a", { class: "btn ghost", href: `#team/${k}`, style: "justify-self:start" }, "Open the board");
  if (!hasKey) return [el("p", { class: "muted" }, "Your tasks and the agents' are on the Team board."), link];
  try {
    const out = await api(`/api/team?store=${k}`);
    const open = (out.tasks ?? []).filter((t) => !t.done);
    const mine = open.filter((t) => t.owner === "aaron");
    const agents = open.length - mine.length;
    box.append(mine.length
      ? el("ul", { class: "home-tasks" }, mine.slice(0, 6).map((t) => el("li", {}, t.text)))
      : el("p", { class: "muted" }, "Nothing on your list."),
      el("p", { class: "muted small" }, `${mine.length} for you, ${agents} with the agents.`), link);
  } catch {
    box.append(el("p", { class: "muted" }, "Couldn't load the board."), link);
  }
  return box;
}

// ---------- handoff board (/api/handoffs, lib/handoffs.mjs) ----------
// Every agent run writes one note here; the ops manager run reads them twice a day and writes the
// brief (Needs you, Fixed, Watching) that Home shows.
const HO_API = "/api/handoffs";
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const STATUS_PILL = { ok: "s-live", partial: "s-attn", failed: "s-blind" };

function briefLists(brief) {
  const part = (title, items, id) => el("div", { class: "brief-part", "data-part": id }, el("h3", {}, title),
    items?.length ? el("ul", {}, items.map((t) => el("li", {}, t))) : el("p", { class: "muted small" }, "Nothing."));
  return el("div", { class: "brief" }, part("Needs you", brief.needsYou, "needs"), part("Fixed", brief.fixed, "fixed"), part("Watching", brief.watching, "watching"));
}

function handoffBoard() {
  const st = { lane: "all", items: [], stale: [], lanes: [], error: null, loading: true };
  const laneSel = el("select", { class: "field", id: "handoff-lane", "aria-label": "Show handoffs from" });
  const list = el("div", { class: "handoffs", role: "list", "aria-labelledby": "handoff-title" });
  const panel = el("section", { class: "panel", "aria-labelledby": "handoff-title" },
    el("div", { class: "panel-head" }, el("h2", { id: "handoff-title" }, "Handoff board"), el("span", { class: "muted small" }, "One note per agent run, kept 30 days")),
    el("div", { class: "toolbar" }, laneSel), list);
  const card = (h) => el("article", { class: "handoff", role: "listitem", "data-lane": h.lane },
    el("div", { class: "member-head" }, el("strong", {}, `${h.lane}: ${h.task}`), el("span", { class: `pill ${STATUS_PILL[h.status] ?? "b-other"}` }, h.status),
      el("span", { class: "muted small" }, when(h.at))),
    el("p", {}, h.did),
    h.changed ? el("p", { class: "muted small" }, `Changed: ${h.changed}`) : null,
    h.next ? el("p", { class: "muted small" }, `Next: ${h.next}`) : null,
    h.needsAaron ? el("p", { class: "small" }, el("strong", {}, "Needs you: "), h.needsAaron) : null,
    h.headsUp?.length ? el("ul", { class: "jobs" }, h.headsUp.map((x) => el("li", {}, `Heads-up to ${x.to}: ${x.text}`))) : null);
  function draw() {
    if (st.loading) { list.replaceChildren(el("p", { class: "muted" }, "Loading…")); return; }
    if (st.error) { list.replaceChildren(el("p", { class: "muted" }, `Couldn't load the handoff board: ${st.error.message}`)); return; }
    laneSel.replaceChildren(el("option", { value: "all" }, "Every lane"), ...st.lanes.map((l) => el("option", { value: l, selected: l === st.lane }, l)));
    const shown = st.items.filter((h) => st.lane === "all" || h.lane === st.lane || h.headsUpTo?.includes(st.lane));
    list.replaceChildren(
      ...(st.stale.length ? [el("p", { class: "state state-stale", role: "status" }, `No note in the last 36 hours from: ${st.stale.join(", ")}. Check that their jobs ran.`)] : []),
      ...(shown.length ? shown.slice(0, 40).map(card) : [el("p", { class: "muted" }, "No handoffs yet. Each agent writes one at the end of every run.")]));
  }
  async function load() {
    try {
      const out = await api(`${HO_API}?limit=200`, { key: true, reason: KEY_REASON });
      Object.assign(st, { items: out.handoffs ?? [], stale: out.stale ?? [], lanes: out.lanes ?? [] });
    } catch (e) { st.error = e; }
    st.loading = false;
    draw();
  }
  laneSel.addEventListener("change", () => { st.lane = laneSel.value; draw(); });
  draw();
  load();
  return panel;
}

// Home's short version: the manager run's latest brief. Never asks for the key on Home.
export async function homeBrief(hasKey) {
  const link = el("a", { class: "btn ghost", href: "#team", style: "justify-self:start" }, "Handoff board");
  if (!hasKey) return [el("p", { class: "muted" }, "The agents' twice-daily report is on the Team page."), link];
  try {
    const out = await api(`${HO_API}?limit=1`);
    const b = out.brief;
    const parts = [b ? briefLists(b) : el("p", { class: "muted" }, "No report yet. The ops manager run writes one at 6:30 AM and 5:30 PM.")];
    if (b) parts.push(el("p", { class: "muted small" }, `From the manager run, ${when(b.at)}`));
    if (out.stale?.length) parts.push(el("p", { class: "small" }, `No note in 36 hours from: ${out.stale.join(", ")}.`));
    return [...parts, link];
  } catch {
    return [el("p", { class: "muted" }, "Couldn't load the agents' report."), link];
  }
}
