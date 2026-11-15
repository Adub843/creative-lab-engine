/* Lab Office shell: the top bar, the Lab files drawer, Save/Open/Download and "Write with AI", shared by
   Documents (docs.html), Spreadsheets (sheets.html) and the Photo editor (photo.html).
   Each tool runs inside the Lab (same site), so it saves through the Lab's own storage: window.parent.LAB_OFFICE
   (js/office.js in the console). Files are rows in the Lab database collection "office", so Stacy, Alice and Claude
   can list, read and write them too (see tools/office/README.md for the row format). Opened on its own (outside
   the Lab), a tool still works: Open and Download use this computer, and Save to Lab is switched off. */
(function () {
  "use strict";
  const LAB = (() => { try { return window.parent !== window && window.parent.LAB_OFFICE ? window.parent.LAB_OFFICE : null; } catch { return null; } })();
  try { const t = window.parent.document.documentElement.dataset.theme; if (t === "light") document.documentElement.dataset.theme = "light"; } catch { /* standalone */ }

  const ICON = {
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', open: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>', down: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    ai: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  };
  const svg = (k) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const size = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");

  function toast(msg) {
    let t = document.querySelector(".ob-toast"); if (!t) { t = document.createElement("div"); t.className = "ob-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* cfg: { kind, label, ext, accept, untitled, mount(stage), newFile(), openBlob(blob,name), openRow(row) (a row an
     agent wrote without a file: html / rows / src), getFile() -> {blob,type}, getText() -> string, getPreview() -> Blob|null,
     ai: {title, placeholder, run(prompt, shell)} } */
  window.OfficeShell = function (cfg) {
    const S = { id: null, dirty: false, busy: false, title: cfg.untitled, rowFrom: null };
    document.body.innerHTML = `
      <header class="ob">
        <span class="ob-kind" title="${esc(cfg.label)}">${svg(cfg.kind)}</span>
        <input class="ob-name" id="obName" aria-label="File name" value="${esc(cfg.untitled)}" maxlength="120">
        <span class="ob-status" id="obStatus" role="status"></span>
        <span class="ob-sp"></span>
        <button class="ob-btn" type="button" id="obFiles" aria-expanded="false" aria-controls="obDrawer">${svg("files")}<span class="t">Lab files</span></button>
        <button class="ob-btn" type="button" id="obNew">${svg("plus")}<span class="t">New</span></button>
        <button class="ob-btn" type="button" id="obOpen">${svg("open")}<span class="t">Open</span></button>
        ${cfg.ai ? `<button class="ob-btn" type="button" id="obAi" aria-expanded="false">${svg("ai")}<span class="t">${esc(cfg.ai.title)}</span></button>` : ""}
        <button class="ob-btn" type="button" id="obDown">${svg("down")}<span class="t">.${esc(cfg.ext)}</span></button>
        <button class="ob-btn primary" type="button" id="obSave">${svg("save")}<span class="t">Save</span></button>
        <input type="file" id="obFile" accept="${esc(cfg.accept)}" hidden>
      </header>
      <div class="ob-main">
        <div class="ob-scrim" id="obScrim" hidden></div>
        <aside class="ob-drawer" id="obDrawer" hidden aria-label="Lab files">
          <div class="ob-dh"><b>Lab files · ${esc(cfg.label)}</b><button class="ob-btn icon" type="button" id="obDClose" aria-label="Close">${svg("x")}</button></div>
          <input class="ob-search" id="obSearch" type="search" placeholder="Find a file" aria-label="Find a file">
          <div class="ob-list" id="obList"></div>
        </aside>
        ${cfg.ai ? `<div class="ob-ai" id="obAiBox" hidden><label for="obAiText">${esc(cfg.ai.title)}</label>
          <textarea id="obAiText" placeholder="${esc(cfg.ai.placeholder)}"></textarea>
          <div class="row"><span class="hint" id="obAiHint">${esc(cfg.ai.hint || "")}</span><button class="ob-btn" type="button" id="obAiCancel">Close</button><button class="ob-btn primary" type="button" id="obAiGo">Go</button></div></div>` : ""}
        <div class="ob-stage" id="obStage"></div>
      </div>`;
    const $ = (id) => document.getElementById(id);
    const name = $("obName"), status = $("obStatus");
    const shell = {
      toast, esc,
      stage: $("obStage"),
      lab: LAB,
      get id() { return S.id; },
      title: () => (name.value.trim() || cfg.untitled),
      setTitle(t) { name.value = String(t || cfg.untitled).replace(/\.(docx|xlsx|xls|csv|png|jpe?g|webp|json)$/i, ""); },
      dirty() { if (!S.dirty) { S.dirty = true; paint(); } },
      clean() { S.dirty = false; paint(); },
      status(msg, bad) { status.textContent = msg; status.classList.toggle("bad", !!bad); },
      loading(on, msg) { let l = shell.stage.querySelector(":scope > .ob-loading"); if (!on) { if (l) l.remove(); return; }
        if (!l) { l = document.createElement("div"); l.className = "ob-loading"; shell.stage.appendChild(l); } l.innerHTML = `<span class="ob-spin" aria-hidden="true"></span>${esc(msg || "Opening…")}`; },
    };
    function paint() {
      const t = S.dirty ? "Unsaved changes" : S.savedAt ? "Saved to Lab files · " + when(S.savedAt) : S.id ? "From Lab files" : LAB ? "Not saved yet" : "Open on its own: Save to Lab works inside the Lab";
      shell.status(t);
      $("obSave").disabled = !LAB || S.busy;
      $("obFiles").disabled = !LAB;
    }
    name.addEventListener("input", () => shell.dirty());
    window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

    /* the file you were in comes back when you return to the page (this browser tab only) */
    const LASTK = "lab-office-last-" + cfg.kind;
    function remember(id) { try { sessionStorage.setItem(LASTK, id || ""); } catch { } }
    function lastId() { try { return sessionStorage.getItem(LASTK) || ""; } catch { return ""; } }

    /* ---------- save ---------- */
    async function save() {
      if (!LAB || S.busy) return;
      S.busy = true; paint(); shell.status("Saving…");
      try {
        const f = await cfg.getFile();
        const text = cfg.getText ? String((await cfg.getText()) || "") : "";
        let preview = null; try { preview = cfg.getPreview ? await cfg.getPreview() : null; } catch { preview = null; }
        const r = await LAB.save({ id: S.id, kind: cfg.kind, title: shell.title(), ext: cfg.ext, blob: f.blob, type: f.type, text, preview, extra: f.extra || null });
        S.id = r.id; S.savedAt = r.at; S.dirty = false; remember(r.id); toast("Saved to Lab files.");
      } catch (e) { console.error("save", e); toast(e && e.message ? e.message : "Couldn't save. Try again."); }
      finally { S.busy = false; paint(); }
    }
    $("obSave").onclick = save;
    document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } }, true);

    /* ---------- download to this computer ---------- */
    $("obDown").onclick = async () => {
      try {
        const f = await cfg.getFile(); const fn = shell.title().replace(/[\\/:*?"<>|]+/g, "-") + "." + cfg.ext;
        if (LAB && LAB.download) { await LAB.download(f.blob, fn); return; }
        const a = document.createElement("a"); a.href = URL.createObjectURL(f.blob); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      } catch (e) { if (!e || e.code !== "cancelled") { console.error("download", e); toast("Couldn't download that. Try again."); } }
    };

    /* ---------- new / open ---------- */
    const okToLeave = () => !S.dirty || confirmLeave();
    function confirmLeave() { if (confirmLeave.armed && Date.now() - confirmLeave.armed < 5000) { confirmLeave.armed = 0; return true; }
      confirmLeave.armed = Date.now(); toast("You have unsaved changes. Do it again to drop them."); return false; }
    $("obNew").onclick = async () => { if (!okToLeave()) return; remember(""); S.id = null; S.savedAt = null; shell.setTitle(cfg.untitled); await cfg.newFile(); shell.clean(); };
    $("obOpen").onclick = () => { if (okToLeave()) $("obFile").click(); };
    $("obFile").onchange = async (e) => {
      const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
      shell.loading(true, "Opening " + file.name + "…");
      try { await cfg.openBlob(file, file.name); S.id = null; S.savedAt = null; shell.setTitle(file.name); shell.clean(); shell.status("Opened from this computer. Save puts it in Lab files."); }
      catch (err) { console.error("open", err); toast("Couldn't open that file."); }
      finally { shell.loading(false); }
    };

    /* ---------- Lab files drawer ---------- */
    let FILES = [];
    const drawer = $("obDrawer"), scrim = $("obScrim");
    function showDrawer(on) { drawer.hidden = !on; scrim.hidden = !on; $("obFiles").setAttribute("aria-expanded", String(on)); if (on) { list(); $("obSearch").focus(); } }
    $("obFiles").onclick = () => showDrawer(drawer.hidden);
    $("obDClose").onclick = () => showDrawer(false); scrim.onclick = () => showDrawer(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) showDrawer(false); });
    $("obSearch").oninput = () => paintList();
    async function list() {
      if (!LAB) return; $("obList").innerHTML = `<div class="ob-empty">Loading…</div>`;
      try { FILES = await LAB.list(cfg.kind); paintList(); }
      catch (e) { console.error(e); $("obList").innerHTML = `<div class="ob-empty">Couldn't load Lab files. Try again.</div>`; }
    }
    function paintList() {
      const q = $("obSearch").value.trim().toLowerCase();
      const rows = FILES.filter((f) => !q || String(f.title || "").toLowerCase().includes(q));
      $("obList").innerHTML = rows.length ? rows.map((f) => `<div style="display:flex;align-items:center">
          <button class="ob-item" type="button" data-open="${esc(f.id)}" aria-current="${f.id === S.id}">
            ${f.previewId ? `<img class="ob-th" alt="" loading="lazy" src="/_blob/${esc(f.previewId)}">` : `<span class="ob-th">${svg(cfg.kind)}</span>`}
            <span class="ob-it"><b>${esc(f.title || "Untitled")}</b><span>${esc([when(f.updatedAt || f.at), f.byName || f.by, size(f.size)].filter(Boolean).join(" · "))}${f.fileId ? "" : " · from " + esc(f.byName || f.by || "an agent")}</span></span>
          </button><button class="ob-del" type="button" data-del="${esc(f.id)}" aria-label="Delete ${esc(f.title || "file")}">${svg("trash")}</button></div>`).join("")
        : `<div class="ob-empty">${FILES.length ? "Nothing matches." : "No " + esc(cfg.label.toLowerCase()) + " saved yet. Save one and it shows here, on every device."}</div>`;
    }
    $("obList").onclick = async (e) => {
      const o = e.target.closest("[data-open]"), d = e.target.closest("[data-del]");
      if (d) {
        if (!d.classList.contains("sure")) { d.classList.add("sure"); d.textContent = "Delete"; setTimeout(() => { if (d.isConnected) { d.classList.remove("sure"); d.innerHTML = svg("trash"); } }, 4000); return; }
        try { await LAB.remove(d.dataset.del); if (d.dataset.del === S.id) { S.id = null; S.savedAt = null; shell.dirty(); } toast("Deleted."); list(); } catch (err) { console.error(err); toast("Couldn't delete it."); }
        return;
      }
      if (o) { if (!okToLeave()) return; showDrawer(false); await openId(o.dataset.open); }
    };
    async function openId(id) {
      shell.loading(true);
      try {
        const r = await LAB.load(id);
        if (r.extra && cfg.openSnapshot) await cfg.openSnapshot(r.extra);
        else if (r.blob) await cfg.openBlob(r.blob, r.row.fileName || r.row.title || "");
        else await cfg.openRow(r.row);
        S.id = r.row.fileId ? id : null; /* an agent's draft (no file yet) is saved as a new file */
        S.savedAt = r.row.fileId ? (r.row.updatedAt || r.row.at) : null; S.rowFrom = id;
        shell.setTitle(r.row.title); S.dirty = !r.row.fileId; paint();
        if (!r.row.fileId) shell.status("Draft from " + (r.row.byName || r.row.by || "an agent") + ". Save keeps it as a real file.");
        try { history.replaceState(null, "", "#" + id); } catch { }
        if (r.row.fileId) remember(id);
      } catch (e) { console.error("open", e); toast("Couldn't open that file."); }
      finally { shell.loading(false); }
    }
    shell.openId = openId;

    /* ---------- Write with AI ---------- */
    if (cfg.ai) {
      const box = $("obAiBox");
      const showAi = (on) => { box.hidden = !on; $("obAi").setAttribute("aria-expanded", String(on)); if (on) $("obAiText").focus(); };
      $("obAi").onclick = () => showAi(box.hidden);
      $("obAiCancel").onclick = () => showAi(false);
      $("obAi").disabled = !(LAB && LAB.ai);
      if (!(LAB && LAB.ai)) $("obAi").title = "Works inside the Lab";
      $("obAiGo").onclick = async () => {
        const p = $("obAiText").value.trim(); if (!p) { $("obAiText").focus(); return; }
        const go = $("obAiGo"); go.disabled = true; $("obAiHint").textContent = "Writing…";
        try { await cfg.ai.run(p, shell); $("obAiText").value = ""; showAi(false); shell.dirty(); }
        catch (e) { console.error("ai", e); $("obAiHint").textContent = e && e.code === "not_granted" ? "AI is switched off for this page." : "Couldn't do that. Try again."; }
        finally { go.disabled = false; if (!box.hidden && $("obAiHint").textContent === "Writing…") $("obAiHint").textContent = cfg.ai.hint || ""; }
      };
    }

    /* ---------- start ---------- */
    shell.start = async () => {
      paint();
      shell.loading(true, "Starting " + cfg.label.toLowerCase() + "…");
      try { await cfg.mount(shell.stage, shell); } catch (e) { console.error("mount", e); shell.status("Couldn't start the editor. Reload the page.", true); shell.loading(false); return; }
      shell.loading(false);
      const want = (location.hash || "").slice(1) || (LAB && LAB.takeOpen ? LAB.takeOpen(cfg.kind) : "") || (LAB ? lastId() : "");
      if (want && LAB) { await openId(want); if (!S.id && !S.rowFrom) { await cfg.newFile(); shell.clean(); } } else { await cfg.newFile(); shell.clean(); }
    };
    return shell;
  };

  /* small helpers the tools share */
  window.OfficeUtil = {
    blobToDataUrl: (b) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); }),
    canvasBlob: (c, type = "image/png", q) => new Promise((ok) => c.toBlob(ok, type, q)),
    /* a small preview picture for the Lab files list */
    async thumb(source, w = 320) {
      const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height; if (!sw || !sh) return null;
      const s = Math.min(1, w / Math.max(sw, sh)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
      const x = c.getContext("2d"); x.drawImage(source, 0, 0, c.width, c.height); return await new Promise((ok) => c.toBlob(ok, "image/webp", 0.82));
    },
  };
})();
