/* ================= LAUNCHPAD: one page, one click to every store, site, app, channel, tool and PC path the business uses. Rows live in the `links` collection (editable); apps and console pages are added automatically ================= */
const LP_GROUPS=["Stores","Sites & apps","Studio","Workspace","Money & legal","PC & terminals","Console pages","Other"];
const LP_ALIAS={"Store & social":"Stores","My apps":"Sites & apps"};
function lpGroup(g){ g=String(g||"Other").trim(); return LP_ALIAS[g]||(LP_GROUPS.includes(g)?g:"Other"); }
function lpHost(u){ try{ return new URL(u).host.replace(/^www\./,""); }catch{ return ""; } }
function lpRows(){ const rows=(Array.isArray(S.links)?S.links:[]).map(l=>({id:l.id,name:String(l.name||l.url||""),url:String(l.url||""),group:lpGroup(l.group),order:+l.order||99,note:String(l.note||""),cmd:String(l.cmd||""),src:"links"}));
  const have=new Set(rows.map(r=>r.url.replace(/\/$/,"")));
  (Array.isArray(S.apps)?S.apps:[]).forEach(a=>{ const u=String(a.liveUrl||a.url||""); if(!/^https?:/.test(u)||have.has(u.replace(/\/$/,""))) return; if(!["live","launching","review"].includes(String(a.status||a.stage||""))) return; have.add(u.replace(/\/$/,"")); rows.push({id:"app:"+a.id,name:String(a.name||a.id),url:u,group:"Sites & apps",order:60,note:String(a.status||""),src:"apps"}); });
  return rows; }
function lpCard(r){ const u=safeUrl(r.url); const host=lpHost(u); const ed=r.src==="links";
  return `<div class="lp-card" data-lpid="${esc(r.id)}">
    ${u?`<a class="lp-main" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(r.name)}</b><span class="muted small">${esc(host||u)}</span>${r.note?`<span class="lp-note">${esc(r.note)}</span>`:""}</a>`
       :`<div class="lp-main"><b>${esc(r.name)}</b>${r.cmd?`<code class="lp-cmd">${esc(r.cmd)}</code>`:""}${r.note?`<span class="lp-note">${esc(r.note)}</span>`:""}</div>`}
    <div class="lp-acts">${r.cmd?`<button type="button" class="btn ghost small" data-lpcopy="${esc(r.cmd)}" title="Copy">Copy</button>`:""}${ed?`<button type="button" class="btn ghost small" data-lpedit="${esc(r.id)}" title="Edit">✎</button><button type="button" class="btn ghost small" data-lpdel="${esc(r.id)}" title="Remove">×</button>`:""}</div>
  </div>`; }
function lpPages(){ const seen=new Set(); return (typeof TABS!=="undefined"?TABS:[]).filter(([k])=>{ if(seen.has(k)||k==="launch") return false; seen.add(k); return true; })
  .map(([k,l])=>`<button type="button" class="lp-page" data-goto="${esc(k)}"><b>${esc(l.split(" ▸ ").pop())}</b><span class="muted small">${esc(l.includes(" ▸ ")?l.split(" ▸ ")[0]:"Home")}</span></button>`).join(""); }
function vLaunchpad(){ const rows=lpRows(); const q=(S.lpq||"").trim().toLowerCase(); const by={}; rows.filter(r=>!q||(r.name+" "+r.url+" "+r.note+" "+r.group).toLowerCase().includes(q)).forEach(r=>(by[r.group]=by[r.group]||[]).push(r));
  const groups=LP_GROUPS.filter(g=>g!=="Console pages"&&by[g]).map(g=>`<section class="lp-group"><h3>${esc(g)} <span class="count">${by[g].length}</span></h3><div class="lp-grid">${by[g].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name)).map(lpCard).join("")}</div></section>`).join("");
  return `<div class="lp">
    <div class="lp-head"><div><h2>Launchpad</h2><p class="muted">Every store, site, app, channel, tool and PC path in one place. One click opens it in a new tab. Edit or add links below — they save to the console for everyone.</p></div>
      <input id="lpq" type="search" placeholder="Find a link…" value="${esc(S.lpq||"")}" aria-label="Find a link"></div>
    ${groups||`<p class="muted">No links match.</p>`}
    ${!q?`<section class="lp-group"><h3>Console pages</h3><div class="lp-pages">${lpPages()}</div></section>`:""}
    <section class="lp-group lp-add"><h3>Add a link</h3><div class="lp-form">
      <input id="lpName" placeholder="Name" aria-label="Name"><input id="lpUrl" placeholder="https://… (leave blank for a PC path or command)" aria-label="URL">
      <select id="lpGroup" aria-label="Group">${LP_GROUPS.filter(g=>g!=="Console pages").map(g=>`<option>${g}</option>`).join("")}</select>
      <input id="lpCmd" placeholder="PC path or command (optional)" aria-label="Command"><input id="lpNote" placeholder="Note (optional)" aria-label="Note">
      <button type="button" class="btn" id="lpAddBtn">Add</button></div></section>
  </div>`; }
async function lpSave(id,data){ try{ if(!db) throw 0; const ref=db.collection("links").doc(id); const cur=(S.links||[]).find(x=>x.id===id); if(cur) await ref.update({...data,at:new Date().toISOString()}); else await ref.set({...data,at:new Date().toISOString()}); toast("Saved."); }catch(e){ console.error("launchpad",e); toast("Couldn't save the link."); } }
function bindLaunchpad(){ if(window.LP_BOUND) return; window.LP_BOUND=true;
  document.addEventListener("input",e=>{ if(e.target&&e.target.id==="lpq"){ S.lpq=e.target.value; render(); } });
  document.addEventListener("click",async e=>{ const c=e.target.closest("[data-lpcopy]"); if(c){ try{ await navigator.clipboard.writeText(c.dataset.lpcopy); toast("Copied."); }catch{ toast("Select and copy it by hand."); } return; }
    const d=e.target.closest("[data-lpdel]"); if(d){ const l=(S.links||[]).find(x=>x.id===d.dataset.lpdel); if(!l||!(await hqConfirm(`Remove “${l.name}” from the Launchpad?`,{ok:"Remove",danger:true}))) return; try{ await db.collection("links").doc(l.id).delete(); toast("Removed."); }catch{ toast("Couldn't remove it."); } return; }
    const ed=e.target.closest("[data-lpedit]"); if(ed){ const l=(S.links||[]).find(x=>x.id===ed.dataset.lpedit); if(!l) return; const vals=await hqDialog({title:"Edit link",fields:[{label:"Name",value:l.name||""},{label:"Link (https://…) — blank for a PC path/command",value:l.url||""},{label:"Group: "+LP_GROUPS.filter(g=>g!=="Console pages").join(" · "),value:lpGroup(l.group)},{label:"Note (optional)",value:l.note||""}],ok:"Save"}); if(!vals) return; const [name,url,group,note]=vals;
      if(url&&!/^https?:\/\//i.test(url)){ toast("Links must start with https://"); return; } await lpSave(l.id,{name:name.trim(),url:url.trim(),group:lpGroup(group),note:note.trim()}); return; }
    if(e.target.id==="lpAddBtn"){ const name=($("#lpName").value||"").trim(), url=($("#lpUrl").value||"").trim(), cmd=($("#lpCmd").value||"").trim(), note=($("#lpNote").value||"").trim(), group=$("#lpGroup").value; if(!name||(!url&&!cmd)){ toast("Give it a name and a link or a PC path."); return; } if(url&&!/^https?:\/\//i.test(url)){ toast("Links must start with https://"); return; }
      const id=(name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"link")+"-"+Math.random().toString(36).slice(2,6); await lpSave(id,{name,url,cmd,note,group,order:100+(S.links||[]).length}); } });
}

/* ================= BUILD IT: one tap on anything in "What's selling" / "Moves to make" starts the right teammate immediately and shows live progress on the card ================= */
const BUILD_FOR={ed:"lisa",tees:"lisa",c3d:"andy",prints3d:"andy",apps:"sam",studio:"mike",youtube:"mike"};
const BUILD_ASK={
  lisa:"Design 3 original shirt designs for Elevated Designs from this selling trend. Straight-on front image showing the whole design first. Save them to designs with status \"review\" and log what you made.",
  andy:"Design this Charleston 3D product now: concept, the print file (.3mf/.stl) and straight-on listing photos, saved to printideas with status \"review\". Use the locked SC flag palmetto from library/sc-palmetto if a palmetto appears. Etsy only.",
  sam:"Spec and start building this app idea now. Put it in apps with status \"building\" and post progress there.",
  mike:"Make this video idea now for the right channel. Add it to the Studio queue and post progress."
};
function buildKey(kind,item){ return ("b-"+kind+"-"+String(item||"").toLowerCase().replace(/[^a-z0-9]+/g,"-")).slice(0,90); }
function buildReq(key){ return (S.requests||[]).find(r=>r.buildKey===key); }
function buildBtn(kind,item,owner){ const who=live(owner||BUILD_FOR[kind]||"vera"); const key=buildKey(kind,item); const r=buildReq(key); const nm=(TEAM_BY[who]||{}).name||"The team";
  if(r){ const st=r.status==="done"?["ok","Built ✓"]:r.status==="running"||r.status==="in-progress"?["acc",nm+" is building…"]:r.status==="failed"?["bad","Failed — tap to retry"]:["warn","Started · "+nm];
    if(r.status==="failed") return `<button type="button" class="btn small" data-buildit="${esc(kind)}" data-bitem="${esc(item)}" data-bowner="${esc(who)}">Retry build</button>`;
    return `<span class="pill ${st[0]}" title="${esc(r.result||"")}">${esc(st[1])}</span>${r.status==="done"&&r.result?` <span class="small muted">${esc(String(r.result).slice(0,120))}</span>`:""}`; }
  return `<button type="button" class="btn primary small" data-buildit="${esc(kind)}" data-bitem="${esc(item)}" data-bowner="${esc(who)}" title="${esc(nm)} starts on it right now">Build it</button>`; }
async function buildIt(kind,item,owner,btn){ if(!db){ toast("Building needs the live console."); return; }
  if(!IS_OWNER){ toast("Only Aaron can start builds."); return; }
  const who=live(owner||BUILD_FOR[kind]||"vera"); const key=buildKey(kind,item); if(buildReq(key)&&buildReq(key).status!=="failed"){ toast("Already building."); return; }
  if(btn){ btn.disabled=true; btn.textContent="Starting…"; }
  const what=`BUILD NOW (Aaron tapped Build it on Marketing): "${item}". ${BUILD_ASK[who]||"Do this now and report the result."} When finished, set this request's status to "done" with a one-line result that says where the finished item is.`;
  try{ const ref=await db.collection("requests").add({for:who,by:"aaron",what,status:"open",kind:"build",buildKey:key,src:"marketing",item:String(item).slice(0,200),urgent:true,at:new Date().toISOString()});
    const tid=tidOf(who); let ok=false; if(tid) ok=await fireNow(tid,`Aaron just tapped BUILD IT. Do request ${ref.id||""} in collection "requests" first: ${what}`);
    toast(ok?`${(TEAM_BY[who]||{}).name} started building it now.`:`Saved. ${(TEAM_BY[who]||{}).name} builds it on the next run.`); }
  catch(e){ console.error("buildit",e); toast("Couldn't start the build. Try again."); if(btn){ btn.disabled=false; btn.textContent="Build it"; } } }
function bindBuildIt(){ if(window.BI_BOUND) return; window.BI_BOUND=true;
  document.addEventListener("click",e=>{ const b=e.target.closest("[data-buildit]"); if(!b) return; e.preventDefault(); e.stopPropagation(); buildIt(b.dataset.buildit,b.dataset.bitem,b.dataset.bowner,b); },true); }

/* ================= 3D → ETSY: every 3D print Andy designs is filed here; tick the ones to list on the Charleston3D Etsy shop and post them in one click ($0.20 each, confirmed first). Live listings can be taken off Etsy (paused) or put back with one click. Each card shows where its Etsy listing is, and has a box to ask Andy for a change. ================= */
const E3={sel:new Set(), busy:false, msg:"", show:"ready", log:null, pack:{}, packSub:false};
const E3_SHOP="charleston3d", E3_SHOPNAME="Charleston3D";
const E3_SKIP=/^(dropped|scrapped|rejected|merged|superseded|revised)$/;
/* the written Etsy copy (SEO title, 13 tags, price, personalization, colors, photos) for each item, from etsypack/<printidea id> */
function e3Pack(x){ return E3.pack[x.id]||null; }
function e3SubPack(){ if(E3.packSub||!db) return; E3.packSub=true; try{ db.collection("etsypack").onSnapshot(s=>{ const m={}; s.docs.forEach(d=>{ m[d.id]=d.data(); }); E3.pack=m; render(); }, ()=>{ E3.packSub=false; }); }catch{ E3.packSub=false; } }
/* Aaron said no to it (status passed by Aaron): never offer it for Etsy */
function e3Declined(x){ return x.status==="passed"&&String(x.decidedBy||"").toLowerCase()==="aaron"; }
function e3Img(x){ const pk=e3Pack(x); const u=(pk&&pk.hero)||x.previewUrl||(Array.isArray(x.renders)&&x.renders[0])||(x.previewId?"/_blob/"+x.previewId:""); return typeof safeImg==="function"?safeImg(u):u; }
function e3Has3mf(x){ return (Array.isArray(x.files)&&x.files.some(f=>/3mf|stl/i.test(String(f.kind||f.name||""))))||e3AllFiles(x).length>0; }
/* the print files for this item (.3mf/.stl hosted on charleston3d.pages.dev or the console store) + Aaron's own Post button; nothing posts unless Aaron picks it */
function e3FileUrl(f){ const u=String((f&&(f.url||f.asset||f.driveUrl))||""); if(/^https:\/\/charleston3d\.pages\.dev\//.test(u)) return u; if(/^\/_blob\/[0-9a-f]{32}$/.test(u)) return u; return ""; }
function e3AllFiles(x){ const out=[], seen=new Set(); const add=(u,n)=>{ if(!u||seen.has(u)) return; seen.add(u); out.push({u,n:n||decodeURIComponent(u.split("/").pop()).replace(/^[0-9a-f]{8}-/,"")}); };
  (Array.isArray(x.files)?x.files:[]).forEach(f=>{ const u=e3FileUrl(f); if(u&&/3mf|stl|step|obj|scad/i.test(String(f.kind||f.name||u))) add(u,f.name); });
  (JSON.stringify(x).match(/https:\/\/charleston3d\.pages\.dev\/m\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+\.(?:3mf|stl|step|obj)/g)||[]).forEach(u=>add(u));
  return out; }
function e3PcFiles(x){ return (Array.isArray(x.files)?x.files:[]).filter(f=>!e3FileUrl(f)&&f&&f.name&&/3mf|stl/i.test(String(f.kind||f.name))).map(f=>String(f.name)); }
function e3Files(x){ const fs=e3AllFiles(x).slice(0,8), pc=fs.length?[]:e3PcFiles(x).slice(0,3);
  return `<div class="e3files">${fs.length?fs.map(f=>`<a class="btn" href="${esc(f.u)}" target="_blank" rel="noopener" download>⬇ ${esc(String(f.n).slice(0,40))}</a>`).join(""):pc.length?`<span class="small muted">On the PC: ${esc(pc.join(", ").slice(0,120))}</span>`:`<span class="small muted">No print file yet</span>`}${IS_OWNER?`<button type="button" class="btn" data-ptpi="${esc(x.id)}">Post to stores…</button>`:""}</div>`; }
function e3Ready(x){ const miss=[]; if(!e3Img(x)) miss.push("photos"); if(!e3Has3mf(x)) miss.push("print file"); if(x.legal&&!/^(cleared|ok|approved)$/i.test(String(x.legal))) miss.push("legal OK"); return miss; }
/* the newest Etsy listing doc made for this 3D item, if any */
function e3Listing(x){ return (S.listings||[]).filter(l=>(l.printidea===x.id||l.design==="printideas/"+x.id)&&/etsy/i.test(String(l.channel||""))).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")))[0]||null; }
function e3State(l){ if(!l) return null; const s=String(l.status||"").toLowerCase(), es=String(l.etsyStatus||"").toLowerCase(), url=typeof safeUrl==="function"?safeUrl(l.etsyUrl||l.url||""):"";
  if(/fail|error|rejected/.test(s+" "+es)) return {k:"bad", t:"Didn't post: "+String(l.etsyError||l.etsyStatus||l.error||"Carla hit a problem").slice(0,140)};
  if(/taking off/.test(es)) return {k:"warn", t:"Taking it off Etsy…", url};
  if(/putting back/.test(es)) return {k:"warn", t:"Putting it back on Etsy…", url};
  if(/needs aaron/.test(es)) return {k:"warn", t:String(l.etsyStatus).slice(0,120), url};
  if(/inactive|paused|off etsy/.test(s+" "+es)) return {k:"off", t:"Off Etsy (paused). Put it back any time.", url};
  if(/live|active|posted/.test(s+" "+es)) return {k:"ok", t:"Live on Etsy", url};
  if(/waiting.*etsy|connection|export/.test(es)) return {k:"warn", t:"Ready, waiting for the Etsy connection. Carla built the listing; it goes live as soon as Etsy is connected."};
  if(/draft/.test(s+" "+es)) return {k:"warn", t:"Carla is writing the listing"};
  if(s==="new") return {k:"warn", t:"Sent "+(typeof ago==="function"?ago(l.at):"")+". Waiting for Carla to pick it up"};
  return {k:"warn", t:"Carla: "+String(l.etsyStatus||l.status).slice(0,120)}; }
function e3Posting(x){ const st=e3State(e3Listing(x)); return !!st&&st.k==="warn"; }
function e3Live(x){ const st=e3State(e3Listing(x)); return !!st&&st.k==="ok"; }
function e3Off(x){ const st=e3State(e3Listing(x)); return !!st&&st.k==="off"; }
function e3Listed(x){ return e3Posting(x)||e3Live(x)||e3Off(x); }
function e3Items(){ e3SubPack(); return (S.printideas||[]).filter(x=>!E3_SKIP.test(String(x.status||""))&&!e3Declined(x)).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))); }
function e3ChangeAsked(x){ return (S.requests||[]).find(r=>r.printidea===x.id&&r.kind==="3dchange"&&r.status!=="done")||null; }
function v3dEtsy(){ const all=e3Items(); const groups={ready:all.filter(x=>!e3Listed(x)&&!e3Ready(x).length), need:all.filter(x=>!e3Listed(x)&&e3Ready(x).length), live:all.filter(e3Listed)};
  const list=groups[E3.show]||[]; const n=[...E3.sel].filter(id=>all.some(x=>x.id===id)).length;
  const failed=all.filter(x=>{ const s=e3State(e3Listing(x)); return s&&s.k==="bad"; });
  const card=x=>{ const miss=e3Ready(x), img=e3Img(x), on=E3.sel.has(x.id), pr=x.price||{}; const pk=e3Pack(x); const price=pk&&pk.price?"$"+Number(pk.price).toFixed(2):(pr.sell||pr.price||x.sellPrice||""); const st=e3State(e3Listing(x)); const chg=e3ChangeAsked(x);
    const canPick=E3.show!=="live"&&!miss.length;
    return `<div class="e3card ${on?"on":""}"><label class="e3pick">${canPick?`<input type="checkbox" data-e3sel="${esc(x.id)}" ${on?"checked":""} aria-label="Select ${esc(x.title||"item")}">`:""}
      ${img?`<img src="${esc(img)}" alt="${esc(x.title||"3D print")}" loading="lazy">`:`<div class="noimg">No photo yet</div>`}
      <b>${esc(x.title||"Untitled")}</b>${pk&&pk.title?`<span class="small muted e3seo">Etsy title: ${esc(String(pk.title).slice(0,90))}…</span>`:""}</label><span class="small muted">${price?esc(String(price)):""}${x.shopify==="live"?`${price?" · ":""}on charleston3d.com`:""}</span>
      ${e3Files(x)}
      ${st?`<div class="e3st ${st.k}">${st.url?`<a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.t)}</a>`:esc(st.t)}</div>`:miss.length?`<span class="pill warn">needs ${esc(miss.join(", "))}</span>`:`<span class="pill ok">ready</span>`}
      ${st&&(st.k==="ok"||st.k==="off")?`<div class="e3act">${st.k==="ok"?`<button type="button" class="btn" data-e3state="off" data-id="${esc(x.id)}">Take off Etsy</button>`:`<button type="button" class="btn primary" data-e3state="on" data-id="${esc(x.id)}">Put back on Etsy</button>`}</div>`:""}
      ${chg?`<div class="e3st warn">Change asked ${esc(typeof ago==="function"?ago(chg.at):"")}: ${esc(String(chg.note||"").slice(0,120))}</div>`:""}
      <form class="e3chg" data-e3chg="${esc(x.id)}"><input type="text" id="e3c-${esc(String(x.id).replace(/[^A-Za-z0-9_-]/g,"_"))}" maxlength="600" placeholder="Ask for a change…" aria-label="Ask Andy to change ${esc(x.title||"this item")}"><button class="btn" type="submit">Send</button></form></div>`; };
  const log=E3.log?`<div class="e3log" role="status"><b>${esc(E3.log.head)}</b>${(E3.log.lines||[]).length?`<ul>${E3.log.lines.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}</div>`:"";
  return `<section class="card" id="c3d-etsy"><div class="card-head"><h2 class="big">3D files · pick what to post</h2><span class="eyebrow">Every Charleston 3D model file is here. Nothing goes to a store unless you pick it.</span></div>
    <div class="chips" style="margin-bottom:10px">${[["ready","Ready to list",groups.ready.length],["need","Needs photos / file",groups.need.length],["live","On Etsy / paused",groups.live.length]].map(([k,l,c])=>`<button type="button" class="chip" data-e3show="${k}" aria-pressed="${E3.show===k}">${l} · ${c}</button>`).join("")}</div>
    ${failed.length?`<div class="e3st bad" style="margin-bottom:10px">${failed.length} listing${failed.length===1?"":"s"} didn't post. Open "On Etsy / posting" to see why.</div>`:""}
    ${E3.show!=="live"?`<div class="qpbulk"><button type="button" class="btn" data-e3all>Select all ready (${groups.ready.length})</button><button type="button" class="btn" data-e3none ${n?"":"disabled"}>Clear</button>
      <button type="button" class="btn primary" data-e3post ${n&&!E3.busy?"":"disabled"}>${E3.busy?"Sending…":`Post ${n} to Etsy · $${(n*0.2).toFixed(2)}`}</button>${E3.msg?`<span class="small muted">${esc(E3.msg)}</span>`:""}</div>`:""}
    ${log}
    ${list.length?`<div class="e3grid">${list.slice(0,200).map(card).join("")}</div>`:`<div class="empty">${E3.show==="ready"?"Nothing ready yet. Items need a photo and a print file first; Andy adds them.":E3.show==="need"?"Everything has photos and print files.":"Nothing sent to Etsy yet."}</div>`}
    <p class="small muted" style="margin:10px 0 0">SEO titles, 13 tags, prices, personalization boxes and colors are already written for each item. "Take off Etsy" pauses a listing (nothing is deleted) and "Put back on Etsy" brings it back. Etsy charges $0.20 per listing; you confirm the total first. Each card shows where its listing is. Type in "Ask for a change" on any card and Andy starts on it right away.</p></section>`; }
async function e3Post(){ if(E3.busy) return; if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can post."); return; }
  const items=e3Items().filter(x=>E3.sel.has(x.id)&&!e3Ready(x).length&&!e3Listed(x)); if(!items.length){ toast("Those are already sent. Check On Etsy / posting."); return; }
  const ok=await hqConfirm(`Post ${items.length} 3D listing${items.length===1?"":"s"} to the ${E3_SHOPNAME} Etsy shop?\n\nEtsy charges $0.20 each = $${(items.length*0.2).toFixed(2)}, billed to your Etsy shop. Auto-renew stays off.`,{title:"Post to Etsy",ok:`Post ${items.length} for $${(items.length*0.2).toFixed(2)}`});
  if(!ok){ E3.log={head:"Nothing was posted. You canceled."}; render(); return; }
  E3.busy=true; E3.msg="Writing titles and tags…"; E3.log={head:`Sending ${items.length} to Etsy…`}; render();
  try{ let copies={}; const nopack=items.filter(x=>!e3Pack(x)); if(sample&&nopack.length){ try{ const list=nopack.slice(0,40).map(x=>({id:x.id,title:x.title||"",notes:String(x.concept||"").slice(0,240),specs:String(JSON.stringify(x.printSpecs||{})).slice(0,160)}));
      const j=await sample.json(`You write Etsy listings for Charleston3DWorks (3D-printed gifts and decor made in Charleston, SC). For each item write: title (under 140 chars, front-loaded keywords, no all caps, no brand or character names we don't own), 13 lowercase Etsy tags under 20 chars each, a 150-200 word description (what it is, size, colours, personalization if any, who it's for, made to order in Charleston SC, care line), one alt text line. Items: ${JSON.stringify(list)}. Reply with JSON only: {"<id>":{"title":"","tags":[],"description":"","altText":""}}`,{modelTier:"quick"}); if(j&&typeof j==="object") copies=j; }catch{ /* Carla writes the words instead */ } }
    const now=new Date().toISOString(); const ids=[];
    for(const x of items){ const pk=e3Pack(x)||{}; const c=pk.title?pk:(copies[x.id]||{}); const photos=(Array.isArray(pk.photos)&&pk.photos.length?pk.photos.map(p=>p.url||p.path):(Array.isArray(x.renders)?x.renders:[]).concat(x.previewUrl?[x.previewUrl]:[])).filter((u,i,a)=>u&&a.indexOf(u)===i).slice(0,10);
      const ref=await db.collection("listings").add({quick:true,bulk:true,biz:"c3d",brand:"charleston-3d-prints",design:"printideas/"+x.id,printidea:x.id,channel:"etsy",etsyShop:E3_SHOP,pack:pk.title?"etsypack/"+x.id:null,price:pk.price||null,personalization:pk.personalization||null,variations:pk.variations||[],section:pk.section||null,category:pk.category||null,materials:pk.materials||[],photoAlts:Array.isArray(pk.photos)?pk.photos.map(p=>p.alt||""):[],feeOk:{by:"aaron",at:now,perListing:0.2},status:"new",etsyStatus:"sent to Carla",at:now,by:"aaron",approval:"Aaron approved posting this to Etsy (Charleston3D) from the 3D → Etsy page on "+now.slice(0,10),
        title:c.title||x.title||"Untitled",description:c.description||"",tags:Array.isArray(c.tags)?c.tags.slice(0,13):[],altText:c.altText||"",photos,
        note:`3D → ETSY from Aaron (printideas/${x.id}). Post live on the Charleston3D Etsy shop (bridge shop key \"charleston3d\") through the Etsy bridge (one-click poster) using the written copy in etsypack/${x.id} exactly (title, tags, description, price, personalization, variations, section, photos+alt in order); Aaron OK'd the $0.20 fee; auto-renew off. First photo straight-on and showing the whole piece. Keep etsyStatus current so Aaron sees progress on the card: "drafting" while you work, "live" with etsyUrl when posted, "waiting for Etsy connection" if the bridge isn't connected yet (and build the Export pack), or "failed" with etsyError in plain words. Never post 3D items to the Elevated Designs shirt store.`}); ids.push(ref.id); }
    const tid=tidOf("carla"); let fired=false, queued=false;
    const txt=`3D → ETSY from Aaron, do it now: ${ids.length} listing${ids.length===1?"":"s"} (${ids.map(i=>"listings/"+i).join(", ")}) approved for the Charleston3D Etsy shop ($0.20 fee OK'd; bridge shop key charleston3d; copy in etsypack/<printidea>). Post them, keep each listing's etsyStatus current (drafting → live + etsyUrl, or "waiting for Etsy connection", or failed + etsyError), and send Aaron the links.`;
    if(tid){ if(typeof agentBusy==="function"&&agentBusy(tid)){ queueFire(tid,txt); queued=true; } else fired=await fireNow(tid,txt); }
    E3.sel.clear(); E3.show="live";
    E3.log={head:`${ids.length} sent to Etsy at ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}.`, lines:[
      fired?"Carla started now. Each card below updates as she works.":queued?"Carla is finishing another job; these are next in her line and start automatically when she's done.":"Carla couldn't be started from here; she picks these up on her next run.",
      ...items.slice(0,8).map(x=>x.title||"Untitled"), items.length>8?`+${items.length-8} more`:""].filter(Boolean)};
    E3.msg=""; toast(fired?"Sent. Carla is posting them now.":"Sent. Carla posts them next."); }
  catch(e){ console.error("e3",e); E3.log={head:"Stopped: nothing more was sent.", lines:[e&&e.message?e.message:"Something went wrong saving the listings. Try again."]}; E3.msg=""; }
  E3.busy=false; render(); }
async function e3Change(id,text){ const x=(S.printideas||[]).find(p=>p.id===id); if(!x||!db) return false;
  if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can send changes."); return false; }
  const now=new Date().toISOString(); const t=String(text).trim().slice(0,600);
  const what=`CHANGE ON A 3D ITEM from Aaron: "${x.title||"Untitled"}" (printideas/${x.id}). He wants: ${t}\nIf it is only an idea so far (no .3mf yet), update the concept with the change and make a realistic concept render so Aaron can see it. Otherwise rebuild the .3mf and the straight-on renders with the change (any palmetto = the locked SC flag palmetto from library/sc-palmetto, scale/recolor only), keep everything else he approved as is, set the item back to status "review", note what changed on the item, and mark this request done with a one-line result. If the item is already on Shopify or Etsy, have the new photos swapped in there too.`;
  try{ const ref=await db.collection("requests").add({for:"andy",by:"aaron",what,kind:"3dchange",printidea:x.id,note:t,status:"open",urgent:true,at:now});
    const tid=tidOf("andy"); let fired=false, queued=false; const msg=`Change request from Aaron, do it now: requests/${ref.id} (${x.title||"3D item"}).`;
    if(tid){ if(typeof agentBusy==="function"&&agentBusy(tid)){ queueFire(tid,msg); queued=true; } else fired=await fireNow(tid,msg); }
    toast(fired?"Sent to Andy. He's starting now.":queued?"Sent. Andy is mid-run; he does it next.":"Sent. Andy does it on his next run."); return true; }
  catch(e){ console.error("e3chg",e); toast("Couldn't send that. Try again."); return false; } }
function bindEtsy3d(){ if(window.E3_BOUND) return; window.E3_BOUND=true;
  document.addEventListener("change",e=>{ const c=e.target.closest&&e.target.closest("[data-e3sel]"); if(!c) return; if(c.checked) E3.sel.add(c.dataset.e3sel); else E3.sel.delete(c.dataset.e3sel); render(); });
  document.addEventListener("submit",async e=>{ const f=e.target.closest&&e.target.closest("[data-e3chg]"); if(!f) return; e.preventDefault(); const i=f.querySelector("input"); const v=(i&&i.value||"").trim(); if(!v) { i&&i.focus(); return; }
    const b=f.querySelector("button"); if(b){ b.disabled=true; b.textContent="Sending…"; } const ok=await e3Change(f.dataset.e3chg,v); if(ok&&i) i.value=""; if(b){ b.disabled=false; b.textContent="Send"; } render(); });
  document.addEventListener("click",e=>{ const t=e.target.closest&&e.target.closest("[data-e3show],[data-e3all],[data-e3none],[data-e3post],[data-e3state]"); if(!t) return; e.preventDefault();
    if(t.dataset.e3state){ e3SetState(t.dataset.id,t.dataset.e3state==="on",t); return; }
    if(t.dataset.e3show){ E3.show=t.dataset.e3show; render(); return; }
    if(t.hasAttribute("data-e3all")){ e3Items().filter(x=>!e3Listed(x)&&!e3Ready(x).length).forEach(x=>E3.sel.add(x.id)); render(); return; }
    if(t.hasAttribute("data-e3none")){ E3.sel.clear(); render(); return; }
    if(t.hasAttribute("data-e3post")) e3Post(); }); }
/* Take a live listing off Etsy (pause, nothing deleted) or put it back. Carla runs it through the Etsy bridge right away; the card shows progress. */
async function e3SetState(id,on,btn){ const x=(S.printideas||[]).find(p=>p.id===id); const l=x&&e3Listing(x); if(!l||!db) return;
  if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can change Etsy listings."); return; }
  if(!on){ const ok=await hqConfirm(`Take "${x.title||"this item"}" off Etsy?\n\nIt's paused, not deleted. You can put it back any time.`,{title:"Take off Etsy",ok:"Take it off"}); if(!ok) return; }
  if(btn){ btn.disabled=true; btn.textContent=on?"Putting back…":"Taking off…"; }
  const now=new Date().toISOString();
  try{ await db.doc("listings/"+l.id).update({etsyStatus:on?"putting back":"taking off",stateAskedAt:now});
    const what=`ETSY ${on?"PUT BACK":"TAKE OFF"} from Aaron, do it now: listings/${l.id} ("${x.title||""}", Etsy listing ${l.etsyListingId||l.listing_id||"(see etsyUrl)"}). ${on?"Set it active again":"Set it inactive (pause; never delete)"} on the Charleston3D shop through the Etsy bridge (POST /api/etsy/listing {shop:"charleston3d", listing_id, action:"${on?"activate":"deactivate"}"} via etsy-state.ps1). Then set listings/${l.id} etsyStatus to "${on?"live":"paused"}" (or "failed" + etsyError in plain words). If reactivating would cost a renewal fee, don't do it; set etsyStatus "needs Aaron OK: $0.20 renewal" instead.`;
    const ref=await db.collection("requests").add({for:"carla",by:"aaron",what,kind:"etsystate",listing:l.id,printidea:id,to:on?"active":"inactive",status:"open",urgent:true,at:now});
    const tid=tidOf("carla"); let fired=false, queued=false; const msg=`Etsy ${on?"put back":"take off"} from Aaron, do it now: requests/${ref.id}.`;
    if(tid){ if(typeof agentBusy==="function"&&agentBusy(tid)){ queueFire(tid,msg); queued=true; } else fired=await fireNow(tid,msg); }
    toast(fired?(on?"Putting it back on Etsy now.":"Taking it off Etsy now."):queued?"Sent. Carla does it next.":"Sent. Carla does it on her next run."); }
  catch(e){ console.error("e3state",e); toast("Couldn't send that. Try again."); }
  render(); }

/* Home "Needs you" cards: inline box to tell the team what to change (3D ideas go to Andy, designs to Lisa). */
function bindPickChange(){ if(window.PCCHG_BOUND) return; window.PCCHG_BOUND=true;
  document.addEventListener("submit",async e=>{ const f=e.target.closest&&e.target.closest("[data-pcchg]"); if(!f) return; e.preventDefault();
    const i=f.querySelector("input"); const v=(i&&i.value||"").trim(); if(!v){ i&&i.focus(); return; }
    const [kind,id]=[f.dataset.pcchg.split(":")[0],f.dataset.pcchg.slice(f.dataset.pcchg.indexOf(":")+1)];
    const b=f.querySelector("button"); if(b){ b.disabled=true; b.textContent="Sending…"; }
    let ok=false;
    try{ if(kind==="pi") ok=await e3Change(id,v);
      else if(kind==="d"&&typeof sendDesignChange==="function"){ if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can send changes."); } else { const woke=await sendDesignChange(id,v); ok=true; toast(woke?"Sent. Lisa is redrawing it now.":"Sent. Lisa redraws it on her next run."); } } }
    catch(x){ console.error("pcchg",x); toast("Couldn't send that. Try again."); }
    if(ok&&i) i.value=""; if(b){ b.disabled=false; b.textContent=ok?"Sent ✓":"Send"; } });
}

/* ================= AI: local model library (repo catalog + what's installed on the PC), AI docs & how-to sheets, and Idea Research (deep research on anything) ================= */
const AI={q:"",use:"all",doc:null,rep:null,busy:false,subbed:false};
const DEEP_TRIGGER="trig_012YdhN228zjWqDMABiZ6bKN";
function aiSub(){ if(AI.subbed||!db) return; AI.subbed=true;
  db.doc("aihub/catalog").onSnapshot(d=>{ S.aiCatalog=d.exists?d.data():null; render(); },()=>{});
  db.doc("aihub/installed").onSnapshot(d=>{ S.aiInstalled=d.exists?d.data():null; render(); },()=>{});
  db.collection("aidocs").onSnapshot(s=>{ S.aiDocs=s.docs.map(x=>({id:x.id,...x.data()})); render(); },()=>{});
  db.collection("idearesearch").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.ideaResearch=s.docs.map(x=>({id:x.id,...x.data()})); render(); },()=>{}); }
/* tiny safe markdown → HTML (escape first, then format) */
function mdHtml(src){ const lines=String(src||"").replace(/\r/g,"").split("\n"); let out="", inList=null, inCode=false, code=[], tbl=[];
  const inline=t=>esc(t).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g,"$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m,a,u)=>{ const s=safeUrl(u.replace(/&amp;/g,"&")); return s?`<a href="${esc(s)}" target="_blank" rel="noopener">${a}</a>`:a; })
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,(m,p,u)=>{ const s=safeUrl(u.replace(/&amp;/g,"&")); return s?`${p}<a href="${esc(s)}" target="_blank" rel="noopener">${u}</a>`:m; });
  const flushList=()=>{ if(inList){ out+=`</${inList}>`; inList=null; } };
  const flushTbl=()=>{ if(!tbl.length) return; const rows=tbl.filter(r=>!/^\s*\|?\s*:?-{2,}/.test(r)).map(r=>r.replace(/^\s*\||\|\s*$/g,"").split("|").map(c=>c.trim()));
    out+=`<div class="tablewrap"><table class="ptable"><thead><tr>${(rows[0]||[]).map(c=>`<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; tbl=[]; };
  for(const l of lines){
    if(/^```/.test(l)){ if(inCode){ out+=`<pre class="code">${esc(code.join("\n"))}</pre>`; code=[]; inCode=false; } else { flushList(); flushTbl(); inCode=true; } continue; }
    if(inCode){ code.push(l); continue; }
    if(/^\s*\|.*\|\s*$/.test(l)){ flushList(); tbl.push(l); continue; } else flushTbl();
    let m;
    if((m=l.match(/^(#{1,4})\s+(.*)/))){ flushList(); const n=Math.min(4,m[1].length+1); out+=`<h${n} class="md-h">${inline(m[2])}</h${n}>`; continue; }
    if((m=l.match(/^\s*[-*]\s+(.*)/))){ if(inList!=="ul"){ flushList(); out+="<ul>"; inList="ul"; } out+=`<li>${inline(m[1])}</li>`; continue; }
    if((m=l.match(/^\s*\d+[.)]\s+(.*)/))){ if(inList!=="ol"){ flushList(); out+="<ol>"; inList="ol"; } out+=`<li>${inline(m[1])}</li>`; continue; }
    if(!l.trim()){ flushList(); continue; }
    flushList(); out+=`<p>${inline(l)}</p>`; }
  if(inCode) out+=`<pre class="code">${esc(code.join("\n"))}</pre>`; flushList(); flushTbl(); return `<div class="md">${out}</div>`; }
function aiModelRow(m,inst){ const on=inst.has(String(m.tag||m.name||"").toLowerCase());
  return `<div class="aim"><div class="aim-h"><b>${esc(m.name||m.tag||"")}</b>${on?`<span class="pill ok">on your PC</span>`:`<span class="pill">not downloaded</span>`}${m.commercialOk===false?`<span class="pill warn">non-commercial license</span>`:""}</div>
    <div class="meta">${esc(m.use||"")}${m.sizeGB?` · ${esc(String(m.sizeGB))} GB download`:""}${m.ramGB?` · needs ~${esc(String(m.ramGB))} GB RAM`:""}${m.license?` · ${esc(m.license)}`:""}</div>
    <div class="aim-a">${m.tag?`<code class="lp-cmd">ollama pull ${esc(m.tag)}</code><button type="button" class="btn ghost small" data-lpcopy="ollama pull ${esc(m.tag)}">Copy</button>`:""}${safeUrl(m.url)?`<a class="btn ghost small" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">Model page</a>`:""}</div></div>`; }
function vAI(){ aiSub(); const c=S.aiCatalog, inst=new Set(((S.aiInstalled&&S.aiInstalled.models)||[]).map(x=>String(x.name||x).toLowerCase().replace(/:latest$/,"")));
  const all=c?(c.all||c.recommended||[]):[]; const rec=c?(c.recommended||[]):[]; const uses=[...new Set(all.map(m=>m.use).filter(Boolean))];
  const q=AI.q.trim().toLowerCase(); const shown=(AI.use==="recommended"?rec:all).filter(m=>(AI.use==="all"||AI.use==="recommended"||m.use===AI.use)&&(!q||JSON.stringify(m).toLowerCase().includes(q)));
  const docs=(S.aiDocs||[]).slice().sort((a,b)=>String(a.topic||"").localeCompare(String(b.topic||""))||String(a.title||"").localeCompare(String(b.title||"")));
  const totalRec=rec.reduce((s,m)=>s+(+m.sizeGB||0),0);
  return `<div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2 class="big">Local AI models</h2><span class="eyebrow">${c?`catalog updated ${esc(ago(c.updatedAt))}`:"catalog loading"} · run free on your PC with Ollama</span></div>
      <p class="small muted" style="margin:0 0 10px">The model files live on your PC's D: drive (D:\\AI\\models). GitHub can't hold multi-gigabyte model files, so the repository keeps the catalog, install scripts and docs.${S.aiInstalled?` ${inst.size} installed, last checked ${esc(ago(S.aiInstalled.at))}.`:" Nothing installed yet."}</p>
      <div class="chips" style="margin-bottom:10px">${[["recommended",`Recommended for your PC${rec.length?` · ${rec.length} · ${Math.round(totalRec)} GB`:""}`],["all","All"],...uses.map(u=>[u,u])].map(([k,l])=>`<button type="button" class="chip" data-aiuse="${esc(k)}" aria-pressed="${AI.use===k}">${esc(l)}</button>`).join("")}</div>
      <input id="aiq" type="search" placeholder="Find a model…" value="${esc(AI.q)}" aria-label="Find a model" style="margin-bottom:10px">
      ${shown.length?`<div class="aigrid">${shown.slice(0,80).map(m=>aiModelRow(m,inst)).join("")}</div>`:`<div class="empty">${c?"No models match.":"The model catalog is being researched and will appear here."}</div>`}
      <h3 class="sub">On your PC</h3>
      <div class="lp-card"><div class="lp-main"><b>Install Ollama, then download the recommended set</b><code class="lp-cmd">powershell -ExecutionPolicy Bypass -File "D:\\AI\\local-ai-hub\\scripts\\pull-recommended.ps1"</code><span class="lp-note">Run once Ollama is installed (scripts\\install-ollama.ps1). Big download; it skips models you already have.</span></div><div class="lp-acts"><button type="button" class="btn ghost small" data-lpcopy="powershell -ExecutionPolicy Bypass -File &quot;D:\\AI\\local-ai-hub\\scripts\\pull-recommended.ps1&quot;">Copy</button></div></div>
    </section></div><div class="col">
    <section class="card"><div class="card-head"><h2>AI docs & how-to sheets</h2><span class="eyebrow">${docs.length} sheets · official sources linked</span></div>
      ${docs.length?`<div class="list">${docs.map(d=>`<div class="row clickable" data-aidoc="${esc(d.id)}" role="button" tabindex="0"><div class="body"><div class="t">${esc(d.title||d.id)}</div><div class="meta">${esc(d.topic||"")}${d.summary?` · ${esc(String(d.summary).slice(0,120))}`:""}</div></div></div>`).join("")}</div>`:`<div class="empty">The docs library is being written from official guides and will appear here.</div>`}
    </section>
    <section class="card"><div class="card-head"><h2>Idea Research</h2><span class="eyebrow">deep research on anything</span></div><p class="small muted" style="margin:0 0 8px">Type an idea — an app, a car, a gadget, a product — and get a full sourced report: competitors, market, patents, trademarks, domains, how to build it.</p><button type="button" class="btn primary" data-goto="deepdive">Open Idea Research</button></section>
  </div></div>
  ${AI.doc?aiDocSheet(AI.doc):""}`; }
function aiDocSheet(id){ const d=(S.aiDocs||[]).find(x=>x.id===id); if(!d) return "";
  return `<div class="sheet" data-aiclose><div class="sheet-panel" role="dialog" aria-label="${esc(d.title||"Doc")}"><div class="sheet-head"><div style="flex:1"><h2 style="margin:0">${esc(d.title||d.id)}</h2><div class="meta">${esc(d.topic||"")}</div></div><button type="button" class="btn" data-aidl="${esc(d.id)}">Download .md</button><button type="button" class="btn" data-aiclose>Close</button></div>
    ${mdHtml(d.md||d.content||d.summary||"")}${(d.sources||[]).length?`<div class="sheet-sec"><h3>Sources</h3><ul class="small">${d.sources.map(u=>{ const s=safeUrl(u.url||u); return s?`<li><a href="${esc(s)}" target="_blank" rel="noopener">${esc(u.title||s)}</a></li>`:""; }).join("")}</ul></div>`:""}</div></div>`; }
/* ---- Idea Research ---- */
function vDeep(){ aiSub(); const list=S.ideaResearch||[];
  const pill=r=>r.status==="done"?`<span class="pill ok">report ready</span>`:r.status==="researching"?`<span class="pill acc">researching…</span>`:r.status==="failed"?`<span class="pill bad">failed</span>`:`<span class="pill warn">queued</span>`;
  return `<div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2 class="big">Idea Research</h2><span class="eyebrow">deep research on anything in the world</span></div>
      <p class="small muted" style="margin:0 0 10px">Describe the idea. The research desk digs up everything: what exists, competitors and prices, market size, patents, trademarks, available domains and social handles, how to build or make it, rules and certifications, and next steps — every fact with its link.</p>
      <div class="calc" style="grid-template-columns:1fr">
        <label>Name or short title<input type="text" id="drTitle" maxlength="120" placeholder="e.g. Solar golf-cart canopy"></label>
        <label>Kind<select id="drKind"><option>App or software</option><option>Physical product</option><option>Electronic device</option><option>Vehicle</option><option>Business or service</option><option>3D print product</option><option>Other</option></select></label>
        <label>The idea — what it is, who it's for, anything you know<textarea id="drIdea" rows="5" maxlength="4000" placeholder="Describe it in your own words."></textarea></label>
        <label>Anything specific to check (optional)<input type="text" id="drNotes" maxlength="600" placeholder="e.g. Is the name taken? Who makes the parts?"></label>
      </div>
      <div class="need-act" style="margin-top:10px"><button type="button" class="btn primary" id="drGo" ${AI.busy?"disabled":""}>${AI.busy?"Starting…":"Research it"}</button><span class="small muted">Reports usually land in 10–30 minutes.</span></div>
    </section></div><div class="col">
    <section class="card"><div class="card-head"><h2>Reports</h2><span class="eyebrow">${list.length}</span></div>
      ${list.length?`<div class="list">${list.map(r=>`<div class="row clickable" data-drrep="${esc(r.id)}" role="button" tabindex="0"><div class="body"><div class="t">${esc(r.title||"Untitled")} ${pill(r)}</div><div class="meta">${esc(r.kind||"")} · ${esc(ago(r.at))}${r.sections&&r.sections.score!=null?` · score ${esc(String(r.sections.score).slice(0,40))}`:""}</div>${r.summary?`<div class="detail small">${esc(String(r.summary).slice(0,240))}</div>`:""}</div></div>`).join("")}</div>`:`<div class="empty">No research yet. Describe an idea on the left.</div>`}
    </section></div></div>
  ${AI.rep?drSheet(AI.rep):""}`; }
function drList(arr,f){ arr=Array.isArray(arr)?arr:[]; if(!arr.length) return ""; return `<ul class="small">${arr.slice(0,40).map(x=>{ if(typeof x!=="object") return `<li>${esc(String(x))}</li>`; const u=safeUrl(x.url||x.link); const name=x.name||x.title||x.number||x.domain||x.handle||""; return `<li>${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(name||u)}</a>`:esc(name)}${f?f(x):""}${x.note?` — ${esc(String(x.note).slice(0,300))}`:""}</li>`; }).join("")}</ul>`; }
function drSheet(id){ const r=(S.ideaResearch||[]).find(x=>x.id===id); if(!r) return ""; const s=r.sections||{};
  const body=r.reportMd?mdHtml(r.reportMd):`${s.overview?mdHtml(s.overview):""}
    ${(s.competitors||[]).length?`<div class="sheet-sec"><h3>Competitors</h3>${drList(s.competitors,x=>x.price?` · ${esc(String(x.price))}`:"")}</div>`:""}
    ${s.market?`<div class="sheet-sec"><h3>Market</h3>${mdHtml(s.market)}</div>`:""}
    ${(s.patents||[]).length?`<div class="sheet-sec"><h3>Patents</h3>${drList(s.patents,x=>`${x.assignee?` · ${esc(x.assignee)}`:""}${x.status?` · ${esc(x.status)}`:""}`)}</div>`:""}
    ${(s.trademarks||[]).length?`<div class="sheet-sec"><h3>Trademarks</h3>${drList(s.trademarks,x=>x.status?` · ${esc(x.status)}`:"")}</div>`:""}
    ${(s.domains||[]).length?`<div class="sheet-sec"><h3>Domains</h3>${drList(s.domains,x=>x.status?` · ${esc(x.status)}`:"")}</div>`:""}
    ${s.build?`<div class="sheet-sec"><h3>How to build it</h3>${mdHtml(s.build)}</div>`:""}
    ${s.regulations?`<div class="sheet-sec"><h3>Rules & certifications</h3>${mdHtml(s.regulations)}</div>`:""}
    ${s.risks?`<div class="sheet-sec"><h3>Risks</h3>${mdHtml(s.risks)}</div>`:""}
    ${(s.nextSteps||[]).length?`<div class="sheet-sec"><h3>Next steps</h3>${drList(s.nextSteps)}</div>`:""}`;
  return `<div class="sheet" data-aiclose><div class="sheet-panel" role="dialog" aria-label="${esc(r.title||"Report")}"><div class="sheet-head"><div style="flex:1"><h2 style="margin:0">${esc(r.title||"Untitled")}</h2><div class="meta">${esc(r.kind||"")} · ${esc(r.status||"")}${r.doneAt?` · finished ${esc(ago(r.doneAt))}`:""}</div></div>${r.status==="done"?`<button type="button" class="btn" data-drdl="${esc(r.id)}">Download report</button>`:""}<button type="button" class="btn" data-aiclose>Close</button></div>
    <div class="sheet-sec" style="border-top:0;margin-top:0"><h3>Your idea</h3><p class="small">${esc(r.idea||"")}</p>${r.notes?`<p class="small muted">Check: ${esc(r.notes)}</p>`:""}</div>
    ${r.status==="done"?body:r.status==="failed"?`<div class="empty">The research hit a problem: ${esc(r.error||"unknown")}. <button type="button" class="btn small" data-drretry="${esc(r.id)}">Try again</button></div>`:`<div class="empty"><span class="spin"></span> ${r.status==="researching"?"Researching now — this page updates by itself.":"Queued — starting shortly."}</div>`}
    ${(r.sources||[]).length?`<div class="sheet-sec"><h3>Sources (${r.sources.length})</h3>${drList(r.sources)}</div>`:""}</div></div>`; }
async function drStart(){ if(AI.busy) return; if(!db){ toast("Research needs the live console."); return; } if(!IS_OWNER){ toast("Only Aaron can start research."); return; }
  const title=($("#drTitle").value||"").trim(), idea=($("#drIdea").value||"").trim(), notes=($("#drNotes").value||"").trim(), kind=$("#drKind").value;
  if(title.length<2||idea.length<10){ toast("Give it a name and a sentence or two about the idea."); return; }
  AI.busy=true; render();
  try{ const ref=await db.collection("idearesearch").add({title,idea,notes,kind,by:"aaron",status:"open",at:new Date().toISOString()});
    const ok=await fireNow(DEEP_TRIGGER,`New idea to research: idearesearch/${ref.id} ("${title.slice(0,80)}"). Research it now per your instructions.`);
    toast(ok?"Research started. The report shows here when it's ready.":"Saved. Research starts on the next run."); AI.rep=ref.id; }
  catch(e){ console.error("deep",e); toast("Couldn't start the research. Try again."); }
  AI.busy=false; render(); }
function bindAI(){ if(window.AI_BOUND) return; window.AI_BOUND=true;
  document.addEventListener("input",e=>{ if(e.target&&e.target.id==="aiq"){ AI.q=e.target.value; render(); const i=$("#aiq"); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } } });
  document.addEventListener("click",async e=>{ const t=e.target;
    const u=t.closest&&t.closest("[data-aiuse]"); if(u){ AI.use=u.dataset.aiuse; render(); return; }
    const d=t.closest&&t.closest("[data-aidoc]"); if(d){ AI.doc=d.dataset.aidoc; render(); return; }
    const rp=t.closest&&t.closest("[data-drrep]"); if(rp){ AI.rep=rp.dataset.drrep; render(); return; }
    if((t.classList&&t.classList.contains("sheet")&&t.hasAttribute("data-aiclose"))||(t.closest&&t.closest("button[data-aiclose]"))){ AI.doc=null; AI.rep=null; render(); return; }
    if(t.id==="drGo"){ drStart(); return; }
    const dl=t.closest&&t.closest("[data-aidl]"); if(dl){ const x=(S.aiDocs||[]).find(y=>y.id===dl.dataset.aidl); if(x&&typeof dlBlob==="function") dlBlob((x.file||x.id).replace(/\.md$/,"")+".md",new Blob([x.md||""],{type:"text/markdown"})); return; }
    const dd=t.closest&&t.closest("[data-drdl]"); if(dd){ const r=(S.ideaResearch||[]).find(y=>y.id===dd.dataset.drdl); if(r&&typeof dlBlob==="function") dlBlob(String(r.title||"report").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").slice(0,60)+"-research.md",new Blob([r.reportMd||JSON.stringify(r.sections||{},null,2)],{type:"text/markdown"})); return; }
    const rt=t.closest&&t.closest("[data-drretry]"); if(rt){ const r=(S.ideaResearch||[]).find(y=>y.id===rt.dataset.drretry); if(!r) return; try{ await db.collection("idearesearch").doc(r.id).update({status:"open",error:null,retryAt:new Date().toISOString()}); await fireNow(DEEP_TRIGGER,`Retry idearesearch/${r.id}.`); toast("Retrying."); }catch{ toast("Couldn't retry."); } return; }
  });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&(AI.doc||AI.rep)){ AI.doc=null; AI.rep=null; render(); } }); }

/* ================= RULES & DECISIONS: the one rulebook every teammate and Claude checks before acting (HQ doc shop/rules) + a dated decisions log ================= */
const RU={subbed:false, adding:null};
function ruSub(){ if(RU.subbed||!db) return; RU.subbed=true;
  db.doc("shop/rules").onSnapshot(d=>{ S.rulesDoc=d.exists?d.data():null; render(); },()=>{});
  db.collection("decisions").orderBy("at","desc").limit(80).onSnapshot(s=>{ S.decisions=s.docs.map(x=>({id:x.id,...x.data()})); render(); },()=>{}); }
function vRules(){ ruSub(); const r=S.rulesDoc; const secs=(r&&Array.isArray(r.sections)&&r.sections.length)?r.sections:(r&&r.rules?[{title:"Rules",rules:r.rules}]:[]); const owner=IS_OWNER;
  return `<div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2 class="big">Rules & decisions</h2><span class="eyebrow">${r?`updated ${esc(ago(r.updatedAt))}`:"loading"} · every teammate and Claude check this before acting</span></div>
      <p class="small muted" style="margin:0 0 12px">Your standing orders in one place. Add or change a rule here and the whole team follows it from their next run.</p>
      ${secs.map((s,si)=>`<div class="rusec"><h3 class="sub">${esc(s.title||"Rules")}</h3><ol class="rulist">${(s.rules||[]).map((t,ri)=>`<li><span>${esc(t)}</span>${owner?`<span class="ruacts"><button type="button" class="btn ghost small" data-ruedit="${si}:${ri}" aria-label="Edit rule">✎</button><button type="button" class="btn ghost small" data-rudel="${si}:${ri}" aria-label="Remove rule">×</button></span>`:""}</li>`).join("")}</ol>
        ${owner?`<button type="button" class="btn small" data-ruadd="${si}">+ Add a rule here</button>`:""}</div>`).join("")||`<div class="empty">No rules yet.</div>`}
      ${owner?`<div style="margin-top:12px"><button type="button" class="btn" data-rusec>+ New section</button></div>`:""}
    </section></div><div class="col">
    <section class="card"><div class="card-head"><h2>Decisions log</h2><span class="eyebrow">what you decided, by date</span></div>
      ${owner?`<div class="ask" style="margin-bottom:10px"><input type="text" id="ruDec" maxlength="400" placeholder="Log a decision, e.g. Hoodies are Bella+Canvas 3719"><button type="button" class="btn primary" id="ruDecGo">Log it</button></div>`:""}
      ${(S.decisions||[]).length?`<div class="list">${S.decisions.map(d=>`<div class="row"><div class="body"><div class="t" style="font-weight:500">${esc(d.text||"")}</div><div class="meta">${esc(d.by||"")} · ${esc(ago(d.at))}${d.area?` · ${esc(d.area)}`:""}</div></div></div>`).join("")}</div>`:`<div class="empty">Decisions you log show here, newest first.</div>`}
    </section></div></div>`; }
async function ruSave(mut,msg){ if(!db||!IS_OWNER){ toast("Only Aaron can change the rules."); return; } const cur=S.rulesDoc||{}; const secs=JSON.parse(JSON.stringify(cur.sections&&cur.sections.length?cur.sections:[{title:"Rules",rules:cur.rules||[]}]));
  mut(secs); const flat=secs.flatMap(s=>s.rules||[]);
  try{ await db.doc("shop/rules").set({...cur, sections:secs, rules:flat, updatedAt:new Date().toISOString(), updatedBy:"aaron"}); toast(msg||"Saved. The team follows it from their next run."); }catch(e){ console.error("rules",e); toast("Couldn't save. Try again."); } }
function bindRules(){ if(window.RU_BOUND) return; window.RU_BOUND=true;
  document.addEventListener("click",async e=>{ const t=e.target; if(!t.closest) return;
    const a=t.closest("[data-ruadd]"); if(a){ const v=await hqPrompt("New rule (plain words)","",{title:"Add a rule",ok:"Add",multi:true}); if(!v||!v.trim()) return; const si=+a.dataset.ruadd; await ruSave(s=>{ (s[si].rules=s[si].rules||[]).push(v.trim().slice(0,800)); }); return; }
    const ed=t.closest("[data-ruedit]"); if(ed){ const [si,ri]=ed.dataset.ruedit.split(":").map(Number); const cur=((S.rulesDoc.sections||[])[si]||{}).rules||[]; const v=await hqPrompt("Rule","" + (cur[ri]||""),{title:"Edit rule",ok:"Save",multi:true}); if(v==null) return; if(!v.trim()) return; await ruSave(s=>{ s[si].rules[ri]=v.trim().slice(0,800); }); return; }
    const del=t.closest("[data-rudel]"); if(del){ const [si,ri]=del.dataset.rudel.split(":").map(Number); if(!(await hqConfirm("Remove this rule? The team stops following it.",{ok:"Remove",danger:true}))) return; await ruSave(s=>{ s[si].rules.splice(ri,1); },"Removed."); return; }
    if(t.closest("[data-rusec]")){ const v=await hqPrompt("Section name","",{title:"New section",ok:"Add"}); if(!v||!v.trim()) return; await ruSave(s=>{ s.push({title:v.trim().slice(0,80),rules:[]}); }); return; }
    if(t.id==="ruDecGo"){ const i=$("#ruDec"); const v=(i&&i.value||"").trim(); if(!v||!db) return; try{ await db.collection("decisions").add({text:v.slice(0,400),by:"aaron",at:new Date().toISOString()}); i.value=""; toast("Logged."); }catch{ toast("Couldn't log it."); } return; }
  }); }

/* ================= REVIEWS: every customer review for both businesses in one place + the weekly "what customers say → SEO & listing changes" report (scheduled task "Reviews watch", Mondays 8:47 AM ET) ================= */
const RV_TRIGGER="trig_01VkSUwdomjAzQd5xdDWKzzC";
const RVW={subbed:false, biz:"all", stars:"all", q:"", busy:false, msg:"", week:0};
function rvSub(){ if(RVW.subbed||!db) return; RVW.subbed=true;
  db.collection("reviews").orderBy("date","desc").limit(1000).onSnapshot(s=>{ S.reviews=s.docs.map(d=>({id:d.id,...d.data()})); render(); },()=>{});
  db.collection("reviewsreport").orderBy("weekOf","desc").limit(12).onSnapshot(s=>{ S.reviewsReports=s.docs.map(d=>({id:d.id,...d.data()})); render(); },()=>{}); }
const RV_BIZ={ed:"Elevated Designs",c3d:"Charleston3D"};
function rvStars(n){ n=Math.max(0,Math.min(5,Math.round(+n||0))); return `<span class="rvstars" aria-label="${n} out of 5 stars">${"★".repeat(n)}<span class="off">${"★".repeat(5-n)}</span></span>`; }
function rvFiltered(){ const q=RVW.q.trim().toLowerCase(); return (S.reviews||[]).filter(r=>(RVW.biz==="all"||r.biz===RVW.biz)&&(RVW.stars==="all"||(RVW.stars==="low"?(+r.rating<=3):String(Math.round(+r.rating))===RVW.stars))&&(!q||(`${r.product||""} ${r.title||""} ${r.text||""}`).toLowerCase().includes(q))); }
function rvStats(list){ const n=list.length; const avg=n?list.reduce((t,r)=>t+(+r.rating||0),0)/n:0; const wk=Date.now()-7*864e5; const week=list.filter(r=>new Date(r.date||r.addedAt||0).getTime()>=wk); const mix=[5,4,3,2,1].map(k=>list.filter(r=>Math.round(+r.rating)===k).length); return {n,avg,week:week.length,mix}; }
function vReviews(){ rvSub(); const all=(S.reviews||[]).filter(r=>RVW.biz==="all"||r.biz===RVW.biz); const st=rvStats(all); const list=rvFiltered();
  const reps=S.reviewsReports||[]; const rep=reps[Math.min(RVW.week,Math.max(0,reps.length-1))]||null;
  const k=(l,v,s)=>`<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s?`<div class="d muted">${s}</div>`:""}</div>`;
  const mixBars=st.n?`<div class="rvmix">${[5,4,3,2,1].map((s,i)=>`<div class="rvbar"><span>${s}★</span><div class="rvtrack"><i style="width:${(st.mix[i]/st.n*100).toFixed(0)}%"></i></div><span class="muted">${st.mix[i]}</span></div>`).join("")}</div>`:"";
  const repHtml=!rep?`<div class="empty">The first weekly report arrives Monday 8:47 AM, or tap "Run the review check now". It reads every review, finds the words customers use, and suggests keyword, title and description changes for each listing.</div>`
    :`<div class="small muted" style="margin-bottom:8px">Week of ${esc(String(rep.weekOf||"").slice(0,10))} · ${esc(ago(rep.at))}${reps.length>1?` · <button type="button" class="btn ghost small" data-rvweek="${RVW.week+1}" ${RVW.week+1>=reps.length?"disabled":""}>Older</button> <button type="button" class="btn ghost small" data-rvweek="${RVW.week-1}" ${RVW.week<=0?"disabled":""}>Newer</button>`:""}</div>
      <p style="margin:0 0 10px">${esc(rep.summary||"")}</p>
      ${(rep.urgent||[]).length?`<div class="e3st bad" style="margin-bottom:10px"><b>Needs attention:</b> ${(rep.urgent||[]).map(u=>esc(u.why||"")).join(" · ")}</div>`:""}
      ${(rep.sources||[]).length?`<div class="links" style="margin-bottom:10px">${rep.sources.map(s=>`<span class="pill ${s.status==="ok"?"ok":s.status==="none yet"?"":"warn"}" title="${esc(s.note||"")}">${esc(s.name)}: ${esc(s.status)}</span>`).join("")}</div>`:""}
      ${(rep.praise||[]).length?`<h3 class="sub">What they love</h3><ul class="rvul">${rep.praise.map(p=>`<li><b>${esc(p.theme)}</b> <span class="muted small">${esc(RV_BIZ[p.biz]||"")}</span>${(p.quotes||[]).length?`<div class="small muted">“${(p.quotes||[]).slice(0,3).map(esc).join("” · “")}”</div>`:""}</li>`).join("")}</ul>`:""}
      ${(rep.complaints||[]).length?`<h3 class="sub">What they don't like</h3><ul class="rvul">${rep.complaints.map(p=>`<li><b>${esc(p.theme)}</b>${p.urgent?` <span class="pill bad">urgent</span>`:""} <span class="muted small">${esc(RV_BIZ[p.biz]||"")}</span>${(p.quotes||[]).length?`<div class="small muted">“${(p.quotes||[]).slice(0,3).map(esc).join("” · “")}”</div>`:""}</li>`).join("")}</ul>`:""}
      ${(rep.customerWords||[]).length?`<h3 class="sub">Words customers use</h3><div class="links">${rep.customerWords.slice(0,30).map(w=>`<span class="pill">${esc(w.phrase)}${w.count>1?` ×${+w.count}`:""}</span>`).join("")}</div>`:""}
      ${(rep.suggestions||[]).length?`<h3 class="sub">Suggested listing & SEO changes</h3><div class="list">${rep.suggestions.map(s=>{ const sent=(S.requests||[]).find(r=>r.rvSuggestion===rep.id+"/"+s.id); return `<div class="row"><div class="body"><div class="t">${esc(s.product||"All listings")} <span class="pill">${esc(s.type||"")}</span> <span class="muted small">${esc(RV_BIZ[s.biz]||"")}</span></div>
        ${s.current?`<div class="small muted">Now: ${esc(String(s.current).slice(0,240))}</div>`:""}<div class="small"><b>Change to:</b> ${esc(String(s.proposed||"").slice(0,400))}</div>${s.why?`<div class="small muted">Why: ${esc(String(s.why).slice(0,240))}</div>`:""}</div>
        ${sent?`<span class="pill ${sent.status==="done"?"ok":"acc"}">${sent.status==="done"?"applied":"sent"}</span>`:`<button type="button" class="btn primary" data-rvapply="${esc(rep.id)}|${esc(s.id)}">Apply</button>`}</div>`; }).join("")}</div>`:""}`;
  const rows=list.length?`<div class="list">${list.slice(0,200).map(r=>`<div class="row"><div class="body"><div class="t">${rvStars(r.rating)} ${esc(r.title||"")} <span class="muted small" style="font-weight:400">${esc(r.product||"")}</span></div>
      <div class="meta">${esc(r.reviewer||"Verified buyer")} · ${esc(String(r.date||"").slice(0,10))} · ${esc(RV_BIZ[r.biz]||"")} · ${esc(r.source||"")}</div>${r.text?`<div class="detail small">${esc(String(r.text).slice(0,600))}</div>`:""}</div>${typeof safeImg==="function"&&r.photo&&safeImg(r.photo)?`<img src="${esc(safeImg(r.photo))}" alt="Customer photo" class="rvph" loading="lazy">`:""}</div>`).join("")}</div>`
    :`<div class="empty">${(S.reviews||[]).length?"No reviews match these filters.":"No reviews yet. They come in from Etsy and the Shopify stores (once the free Judge.me app is installed) every Monday, or add them below."}</div>`;
  return `<div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2 class="big">Reviews</h2><span class="eyebrow">both businesses · checked every Monday</span></div>
      <div class="chips" style="margin-bottom:10px">${[["all","Both"],["ed","Elevated Designs"],["c3d","Charleston3D"]].map(([k,l])=>`<button type="button" class="chip" data-rvbiz="${k}" aria-pressed="${RVW.biz===k}">${l}</button>`).join("")}</div>
      <div class="kpis" style="margin-bottom:10px">${k("Reviews",st.n)}${k("Average",st.n?st.avg.toFixed(1)+"★":"—")}${k("Last 7 days",st.week)}</div>${mixBars}
      <div class="ask" style="margin:12px 0 8px"><input type="text" id="rwq" placeholder="Search reviews (product, words…)" value="${esc(RVW.q)}" aria-label="Search reviews"><select id="rwstars" class="rvsel" aria-label="Filter by stars"><option value="all">All stars</option>${["5","4","3","2","1"].map(s=>`<option value="${s}" ${RVW.stars===s?"selected":""}>${s}★</option>`).join("")}<option value="low" ${RVW.stars==="low"?"selected":""}>3★ and below</option></select></div>
      ${rows}</section>
    <section class="card"><div class="card-head"><h2>Add reviews</h2><span class="eyebrow">from anywhere</span></div>
      <p class="small muted" style="margin:0 0 8px">Paste one review, or upload a CSV export (Judge.me, Etsy or a spreadsheet with columns like product, rating, review, date, name). Only first names and last initials are kept.</p>
      <div class="rvform"><select id="rvfBiz" aria-label="Business"><option value="c3d">Charleston3D</option><option value="ed">Elevated Designs</option></select><input type="text" id="rvfProd" placeholder="Product"><select id="rvfStars" aria-label="Stars">${[5,4,3,2,1].map(s=>`<option value="${s}">${s}★</option>`).join("")}</select><input type="text" id="rvfName" placeholder="Name (first + initial)"><textarea id="rvfText" rows="3" placeholder="What the customer wrote"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" id="rvfAdd">Add review</button><label class="btn" style="cursor:pointer">Upload CSV<input type="file" id="rvCsv" accept=".csv,text/csv" hidden></label></div></div>
      ${RVW.msg?`<p class="small" role="status" style="margin:8px 0 0">${esc(RVW.msg)}</p>`:""}</section>
  </div><div class="col">
    <section class="card"><div class="card-head"><h2>Weekly report</h2><button type="button" class="btn" id="rvRun" ${RVW.busy?"disabled":""}>${RVW.busy?"Starting…":"Run the review check now"}</button></div>${repHtml}</section>
  </div></div>`; }
function rvCsvParse(txt){ const rows=[]; let row=[],f="",q=false; for(let i=0;i<txt.length;i++){ const c=txt[i]; if(q){ if(c==='"'&&txt[i+1]==='"'){ f+='"'; i++; } else if(c==='"') q=false; else f+=c; } else if(c==='"') q=true; else if(c===','){ row.push(f); f=""; } else if(c==='\n'||c==='\r'){ if(c==='\r'&&txt[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f=""; } else f+=c; } if(f||row.length){ row.push(f); rows.push(row); } return rows.filter(r=>r.some(x=>String(x).trim())); }
function rvName(n){ const p=String(n||"").trim().split(/\s+/).filter(Boolean); if(!p.length) return "Verified buyer"; return p[0].slice(0,30)+(p.length>1?" "+p[p.length-1][0].toUpperCase()+".":""); }
function rvId(r){ return (`${r.source}-${r.product}-${String(r.date).slice(0,10)}-${String(r.text).slice(0,20)}`).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120)||("rv-"+Date.now()); }
async function rvSave(list){ if(!db||!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can add reviews."); return 0; } let n=0; for(const r of list){ try{ await db.doc("reviews/"+rvId(r)).set(r); n++; }catch(e){ console.error("rv",e); } } return n; }
function bindReviews(){ if(window.RV_BOUND) return; window.RV_BOUND=true;
  document.addEventListener("click",async e=>{ const t=e.target; if(!t.closest) return;
    const b=t.closest("[data-rvbiz]"); if(b){ RVW.biz=b.dataset.rvbiz; render(); return; }
    const w=t.closest("[data-rvweek]"); if(w){ RVW.week=Math.max(0,+w.dataset.rvweek||0); render(); return; }
    if(t.id==="rvRun"){ if(!IS_OWNER){ toast("Only Aaron can start the review check."); return; } RVW.busy=true; render(); const ok=await fireNow(RV_TRIGGER,"Run now from the console's Reviews page: collect new reviews and write this week's report."); RVW.busy=false; RVW.msg=ok?"The review check started. The report updates here when it finishes (usually 10–20 minutes).":"Couldn't start it from here; it runs Monday 8:47 AM."; render(); return; }
    if(t.id==="rvfAdd"){ const text=($("#rvfText").value||"").trim(); const product=($("#rvfProd").value||"").trim(); if(!text||!product){ toast("Add the product and what the customer wrote."); return; }
      const now=new Date().toISOString(); const n=await rvSave([{biz:$("#rvfBiz").value,source:"manual",product:product.slice(0,160),rating:+$("#rvfStars").value,text:text.slice(0,2000),title:"",reviewer:rvName($("#rvfName").value),date:now,addedAt:now,addedBy:"aaron"}]);
      if(n){ RVW.msg="Review added."; ["#rvfText","#rvfProd","#rvfName"].forEach(s=>{ const el=$(s); if(el) el.value=""; }); } render(); return; }
    const ap=t.closest("[data-rvapply]"); if(ap){ if(!IS_OWNER){ toast("Only Aaron can apply changes."); return; } const [rid,sid]=ap.dataset.rvapply.split("|"); const rep=(S.reviewsReports||[]).find(x=>x.id===rid); const s=rep&&(rep.suggestions||[]).find(x=>x.id===sid); if(!s) return;
      const who=(s.type==="seo"||s.type==="keywords")?"sage":"carla"; const now=new Date().toISOString();
      try{ const ref=await db.collection("requests").add({for:who,by:"aaron",status:"open",at:now,rvSuggestion:rid+"/"+sid,biz:s.biz,
          what:`REVIEW-BASED CHANGE approved by Aaron (${RV_BIZ[s.biz]||s.biz}, ${s.product||"all listings"}, ${s.type}). Change to: ${s.proposed}. Current: ${s.current||"-"}. Why (from customer reviews ${(s.reviewIds||[]).join(", ")}): ${s.why||""}. Apply it on the right store only (Charleston3D = 3D prints, Elevated Designs = shirts) and on the matching Etsy listing if there is one; keep prices and approved art unchanged; ${who==="sage"?"update seo/keywords and the product SEO fields":"update the listing title/description/tags/photos"}; mark this request done with what changed.`});
        const tid=tidOf(who); if(tid) await fire(tid,`Review-based change from Aaron: requests/${ref.id}.`); toast("Sent. It'll show as applied when it's done."); }catch{ toast("Couldn't send that."); } return; }
  });
  document.addEventListener("input",e=>{ if(e.target&&e.target.id==="rwq"){ RVW.q=e.target.value; clearTimeout(RVW.t); RVW.t=setTimeout(render,200); } });
  document.addEventListener("change",async e=>{ const t=e.target; if(!t) return;
    if(t.id==="rwstars"){ RVW.stars=t.value; render(); return; }
    if(t.id==="rvCsv"&&t.files&&t.files[0]){ const f=t.files[0]; if(f.size>5e6){ toast("That file is over 5 MB."); return; } const rows=rvCsvParse(await f.text()); if(rows.length<2){ toast("No rows found in that CSV."); return; }
      const h=rows[0].map(x=>String(x).toLowerCase().trim()); const col=(...names)=>h.findIndex(x=>names.some(n=>x.includes(n)));
      const ci={text:col("body","review","message","comment","content"),title:col("title"),rating:col("rating","stars","score"),date:col("date","created"),name:col("reviewer","name","author"),product:col("product","listing","item"),biz:-1};
      if(ci.text<0||ci.rating<0){ toast("The CSV needs a review text column and a rating column."); return; }
      const biz=$("#rvfBiz")?$("#rvfBiz").value:"c3d"; const now=new Date().toISOString();
      const list=rows.slice(1,1001).map(r=>({biz,source:/judge/i.test(f.name)?"judgeme":/etsy/i.test(f.name)?"etsy":"csv",product:String(ci.product>=0?r[ci.product]:"").slice(0,160)||"(not given)",rating:Math.max(1,Math.min(5,Math.round(parseFloat(r[ci.rating])||0))),title:String(ci.title>=0&&ci.title!==ci.product?r[ci.title]:"").slice(0,160),text:String(r[ci.text]||"").slice(0,2000),reviewer:rvName(ci.name>=0?r[ci.name]:""),date:(()=>{ const d=new Date(ci.date>=0?r[ci.date]:""); return isNaN(d)?now:d.toISOString(); })(),addedAt:now,addedBy:"aaron"})).filter(r=>r.text&&r.rating);
      const n=await rvSave(list); RVW.msg=`${n} review${n===1?"":"s"} imported to ${RV_BIZ[biz]}.`; t.value=""; render(); }
  }); }

/* ================= SHARE LINKS: one-click quick links to every shop, each with a QR code, a copy button, an editable message and share buttons (text, email, Facebook, X, WhatsApp, Pinterest, Threads, Reddit, LinkedIn) ================= */
const SHARE_SHOPS=[
  {id:"c3d-etsy",biz:"c3d",kind:"Etsy shop · 3D prints",name:"Charleston3DWorks",what:"Personalized ornaments, Lowcountry gifts and desk fidgets, 3D printed to order in Charleston.",url:"https://www.etsy.com/shop/Charleston3DWorks",band:"#bfe1e4",msg:"Personalized 3D printed gifts from Charleston, SC. Ornaments, Lowcountry decor and more:"},
  {id:"c3d-site",biz:"c3d",kind:"Website · 3D prints",name:"charleston3d.com",what:"The Charleston3D store on Shopify.",url:"https://charleston3d.com",band:"#cbe5d1",msg:"Shop Charleston3D: 3D printed gifts made in Charleston, SC:"},
  {id:"c3d-app",biz:"c3d",kind:"Order app · 3D prints",name:"Charleston3D app",what:"Shop and send a custom request from your phone.",url:"https://app.charleston3d.com",band:"#cbe5d1",msg:"Order custom 3D prints from Charleston3D:"},
  {id:"c3d-custom",biz:"c3d",kind:"Custom orders · 3D prints",name:"Custom 3D Print Quote",what:"Customers describe their idea; you quote price and shipping first, then send a checkout link.",url:"https://charleston3d.com/products/custom-3d-print-quote",band:"#bfe1e4",msg:"Want something custom 3D printed? Tell us your idea and we'll quote it first:"},
  {id:"ed-etsy",biz:"ed",kind:"Etsy shop · shirts",name:"ElevatedDesignsSC",what:"Charleston and 843 tees, Christmas and family shirts, DTF printed to order in Charleston.",url:"https://www.etsy.com/shop/ElevatedDesignsSC",band:"#f3c6c1",msg:"Charleston SC shirts, 843 tees and hoodies, made to order:"},
  {id:"ed-site",biz:"ed",kind:"Website · shirts",name:"elevatedshirts.com",what:"Top quality shirts that last, printed in the Charleston area.",url:"https://elevatedshirts.com",band:"#f3c6c1",msg:"Elevated Designs: top quality shirts that last, printed in Charleston, SC:"},
  {id:"ed-app",biz:"ed",kind:"Shirt builder",name:"Design Your Shirt",what:"Pick a design and build your own shirt, then order with your design code.",url:"https://design.elevatedshirts.com",band:"#f3c6c1",msg:"Build your own Elevated Designs shirt:"}
];
const SHARE_QR={"https://www.etsy.com/shop/ElevatedDesignsSC": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPYAAAD2CAIAAABqcO2fAAAFK0lEQVR4nO3dS47cOBQAwenB3P/KngNoQxD8dTpi3ZYKrgSBepDInz9//vwDXf/e/gCwl8SJkzhxEidO4sRJnDiJEydx4iROnMSJkzhxEidO4sRJnDiJEydx4iROnMSJkzhxEidO4sRJnDiJE/ffqgv9/PysutSEkd1gvp9w1b9a9Tcjd1/l7t1HrNrhxypOnMSJkzhxEidO4sQtm6h87dvzdu6X/r6py8j8ZMTcZGbk86zy2nc6wipOnMSJkzhxEidO4sRtnKh87ZuEjNzr/WnAycnMKie/0zlWceIkTpzEiZM4cRIn7uhE5a5904mT7/jsu1f1HG2rOHESJ07ixEmcOIkT9xdNVL5OTkLmJjN379VgFSdO4sRJnDiJEydx4o5OVO7+ip/bEeVr1U4mq96XmZuxjFx57vO8xipOnMSJkzhxEidO4sRtnKjcPSlmxL5zfE7ea99n/nr/O/2yihMnceIkTpzEiZM4ccsmKu8/qzDi7j6rd2c1I5/nN7KKEydx4iROnMSJkzhxP6t+Ne97LmLEa2/ZrNobdt++Ll+vfV+rWMWJkzhxEidO4sRJnLjIPir79gk5uWvKyXdq7j5X87Xv7CGrOHESJ07ixEmcOIkTd3kflX17gOx7tuTr/VOPX3vS5uTZzVZx4iROnMSJkzhxEifu6Fs/J698cjKz732Zk3OYfXOqESYqMEnixEmcOIkTJ3HifsE+KqumCiNOziv27Yiyym/8Br+s4sRJnDiJEydx4iRO3LKJymtOPn9y8t2lr+oUyD4qMETixEmcOIkTJ3HiNj6jMqLxFMTJz3zy+Zyvu7v7zrGKEydx4iROnMSJkzhxv+AZlX1PSpzcI+Xk0ybvc3oyLCNx4iROnMSJkzhxR8/6mZtgvHZOzb6zkufmDO+fl3Tyf+PLKk6cxImTOHESJ07ixG2cqOx7q2XVb/ZVTu6sMmfuyndP/1nFKk6cxImTOHESJ07ixB196+e139qv7Tp7cj/br5MnPo/8q1Ws4sRJnDiJEydx4iRO3MaJyt39WuecfOvn7h4p7999Fas4cRInTuLESZw4iRN3eWfauyftnnyr5e5uuvvuNeLuSUxWceIkTpzEiZM4cRInbuPpye+faHxyYjB3na+7u+m+NhcaYRUnTuLESZw4iRMnceI27kw74uR5wSNXnrv73fOA9s0i9k14PKMCy0icOIkTJ3HiJE7c5YnK3V1M5+5193Tgk6canXzOxzMqMEnixEmcOIkTJ3Hijk5Uqm8YjVj1CU9Ok+auc/ekoS+rOHESJ07ixEmcOIkTt2yicvJNkzmr3s25e0rO3T1S5q5899RsqzhxEidO4sRJnDiJE7dsonL3V/PIuzkj7u5Mu+rKrz1/MsI+KjBJ4sRJnDiJEydx4o6e9bPK3Fs/Xyd3wf2N50SvuvIIExWYJHHiJE6cxImTOHFH91HZd0bPKq+dPbTvXiPn76xydwcbqzhxEidO4sRJnDiJE3f5rJ+T9j038rVvz5ZVc5hVO+W+fwa0VZw4iRMnceIkTpzEifuLJipz9p1lc3I2MnKdub9ZNafy1g9MkjhxEidO4sRJnLhfeXryvnutepJk3xMXc/d6fx+VfazixEmcOIkTJ3HiJE7cxonK3d/a7+8Kcvc8oK99O7ScnDh9WcWJkzhxEidO4sRJnLhlZ/3Am6zixEmcOIkTJ3HiJE6cxImTOHESJ07ixEmcOIkTJ3HiJE6cxImTOHESJ07ixEmcOIkTJ3HiJE6cxImTOHH/A3F6/xVZLvgYAAAAAElFTkSuQmCC", "https://www.etsy.com/shop/Charleston3DWorks": "data:image/png;base64,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", "https://charleston3d.com": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMYAAADGCAIAAAAG+WgKAAADB0lEQVR42u3dMW7kMAxA0SiY+195UqZwIwgkRcnv1dlJ7P2QQNgej+/3+wNxfp0CJIWkkBRICkkhKZAUkkJSICkkhaSQFEgKSSEpkBSSQlIgKSSFpODfJ+qDxhgbD+P5NOLz75n5mZlPnjn2tacju51DqxQ2PiQFkkJSmPiyJ4ioySjqXz2PK28q7HYOrVLY+JAUSApJYeKLnTIqv0105jrg3tmt/zm0SiEpJIWkQFK8c+KrFHWf59oM2G0Ks0ohKZAUkkJSmPhuMjOFrf3Mic/oWaWQFEgKSSEpTHzZut2fufb8XdQM2P8cWqWQFJICSSEpTHzzs1KlqHs482bJ/ufQKoWkkBRICklxuHHr02SV01PlGxysUtj4QFJICknBtMT38a3NQXvlPaOXd5fp2nsGo47dKoWND0khKZAUb5j48qbCqE/Om7Dypsuo75/Jm++sUtj4kBSSAknR2Ng7c1Xq//xd3hslKidZqxQ2PiSFpEBStHHA2xkqr4XtfdrujjdBWKWQFJJCUiAp2ii9xpc3raxdT6y8ohc1t3b7/7JKYeNDUkgKJMU7J76ouSxq6sn7fpW9R9Htm0KtUkgKSSEpkBTvnPgqp547rvFVPgvpGh82PiQFkkJSXCfxOb6ZaaXyPelR01zUb496rrDy6qpVChsfkgJJISmOMrq9H6HbG/qiZttuv91dndj4kBRICklh4jv4wNrf+XnHHa1WKWx8SApJgaRoLOyuzm7v2ov6V3n3neZNhd7Hh40PJIWkkBTETnxRU1jedJl33+neb++0SmHjA0khKSQF9RNf1KS2dw7Km+9OvCpqlcLGh6RAUkgKE9+51r5fdO1zKueyyif7rFLY+JAUkgJJYeKrn92i5qDKp+3W/marFDY+kBSSQlJQP/F1uz8z6ihmZsC8Nzh0e8OFVQpJISkkBZLiDRPf3rmj8vsz864n5h2pN7Bj40NSICkkxQtc+z4+rFJICiSFpJAUknIKkBSSQlIgKSSFpEBSSApJgaSQFJJCUiApJIWkQFI08Ac4b42fsxwu8gAAAABJRU5ErkJggg==", "https://charleston3d.com/products/custom-3d-print-quote": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPYAAAD2CAIAAABqcO2fAAAEsUlEQVR42u3dQY7rOAwFwHiQ+1+55wDZGPp8JJ1Urbud2HkQZEKirr+/vxd8r/88AkQcRBxEHEQcRBxEHEQcEQcRBxEHEQcRBxEHEUfEQcRBxEHEQcRBxEHEQcT5fu+qC13XNXgbd7rB3PmGZ11lPq/8eZ3O53Pn06ue2OxvahQHEUfEQcRBxGHIO3fpXM/bszf9XLXkrIJxVuU4expVn77tNzWKg4gj4iDiIOIw5N35YbOVkLMrV63l2LZKpKo20vmbGsVBxBFxEHEQcVjj/cs3n6u65NaozO5vMoqDiIOIg4iDiMPr9fqpisrsvpvOz8IojoiDiIOIg4hDWGtFZXZdxFnd4+wucitJtu2y2b/WxSiOiQqIOIg4iDgEBCsq21ZTVO3NqXoauWrJE/u6GMVBxEHEEXEQcXiUsorKE/ty5PYBdT7D3KqV7+i1YhTHRAVEHEQcRBwCrtyZL7n1HrPv/lU7g3LVm861Lvt/L6M4Jiog4iDiIOIQEFyj0vk+PttdpKp+8sTOKlXfJ1dfMopjogIiDiIOIg4B1/7VHbk1IZ0Vg7PvPPtbnD2NbXupjOKYqICIg4iDiEPixbpz10/ndc4+60xujcrsOpbOK589VaM4iDgiDiIOIg5DHtCZdtvuoao1GFW1o/2VmdnVOEZxTFRAxEHEQcQh4Nq292S2MvOtfXq3VYo6fwujOCYqIOIg4iDiEFC2RqVz189sR5Tcf+VWtty59zvfMFcBy1XSjOKYqICIg4iDiEPAO3fp2Q4b206cmT1b5/O/OteN6EwLIg4iDiKOiMPXCVZUqt6+c2/6ucrM2Z3m+qhU/YJPrLoYxTFRAREHEQcRh4D37Md37oXJ7Zc5+6/Ovq93Pn3buUJGcRBxEHFEHEQcFgue9dNZH6iSq7qcXefON8x1sKl6Yp19aI3imKiAiIOIg4hDi2Bn2qqKwZ3rbFsXMXtm0OzpybP1E6M4Jiog4iDiIOLQorWPSlXdo7N+0llDqNq7lFsdNHsus1EcRBwRBxEHEYc1rtxqijOdqxc676tTVQVj9kRsnWlBxEHEEXEQcVhseI3K7Bv6/rOS79z72fOpugtrVMBEBUQcRBxEnJ+07qyfzjN6cnWGszut0tln5qyvS+fzMYpjogIiDiIOIg4B12wP1dypNJ27Wqq+85nOXiud39AoDiIOIo6Ig4jDYte2viVlNzZ6ZlDnlaueT+cOrM47NYpjogIiDiIOIg4Bracn53y+fVftRsl1aMmt08idqdS5U8koDiIOIo6Ig4jDYq2daat09uXo3EGzbYVMbk9W7vcyimOiAiIOIg4iDi1aO9PO7v7oPNnnznqYXKeXsypQZ6cXoziIOIg4iDgiDg/3/p1bne1VO9sbtvOJnf3N2acbxUHEEXEQcRBxGPJDFZU71ZKzukdV5aFzLUfuO2+7U6M4Jiog4iDiIOIQ0FpR2VYx+JTbLzPbdbaqG8wTV9oYxTFRAREHEQcRh4Br2/kyZzpP0sk9jc6OMd96zpFRHBMVEHEQcRBx6Hn1n+0aCkZxEHEQcUQcRBxEHEQcRBxEHEQcRBwRBxEHEQcRBxEHEQcRR8RBxEHEQcRBxOGf/Q8kkOn0X/XU9gAAAABJRU5ErkJggg==", "https://theelevateddesignsllc.com": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAN4AAADeCAIAAADdBSngAAADpklEQVR42u3dy27jMBBFwSjw//+ysw2gjUDzdrfkqvVMYjsHJNp6He/3+wfm+fURIE2QJtIEaSJNkCZIE2mCNJEmSBOkiTRBmkgTpIk0QZogTaQJ0kSa0OO16wcdx9H4Nq5cTb/2Cteu06/8NM6vcP7fwqqJDR2kiTRBmpCb0HOTWm7Wzk2yu+b6Xa952t/CqokNHaSJNEGaUDmh5ybrXdNu7n1dmazP/2btf83/W1g1saGDNJEmSBOmTei97njEvHJmt2qCNJEmSBNpggm9xq4zxnNHn3uvH7dqgjSRJkgTacL3TOi9R3t7jz5fmb4rp/j5R96tmkgTpIk0QZqY0Ctn0t7vB3ZdP175b57xt7BqYkMHaSJNkCacR7enXsWcO9Y8bdZ2HTpIE6SJNEGamNA/n1t32XV+eO7p5884Yu5e7iBNpAnSRJoQ03wdeu7J5pXfPFx5PVfeae+56NOeamfVxIYO0kSaIE2+zA3Ocp925H3++erzn3Vu1cSGDtJEmiBNyE3oubulXZkl16bd3P3VK+8mt/b5rM3slVfBWzWxoYM0kSZIExN68JcNm2TX5vHKT6M0hdh1+lZNbOggTaQJ0oTKCb13Iu49Gp57p5VXprsOHaSJNEGaSBNM6J/PyL1ng0+bmnOTvmPoIE2kCdJEmhATvJf7rqm5d7Ku/H5gbdbeNTX33jfPqokNHaSJNEGafL1j2rXPlWeV994/zXXoVk1s6CBNpAnShH+2HUOvvBK88hXm3lflNwa5n+M6dGzoIE2QJtKEaRP62txaOfvnjqrnXnPuJ8+/Mt2qiQ0dpIk0QZqY0CtVnjGeO4a+67dXPtV91/X+JnRs6CBNkCbShE2C93KfP1nv+lah9xPLva/eJ+hZNbGhgzSRJkgTE/pD3ljr7F95bfi0J62b0LGhgzRBmkgTeif03ieJ9x597n3NuefB5aZvqyY2dJAm0gRpwskN7hS3NrdWnkM+7VuOtdcz7WwKqyY2dJAm0gRpYkLPmX/ctvL+6ru+Q8idG9D7hHSrJjZ0kCbSBGliQn+qac9DX5vZe89MWHtfVk1s6CBNpAnSBBP659N35Tye+zmVn6pVExs6SBOkiTRh/oTee7565STbe0575T3orJrY0EGaIE2kCfMn9N5ju5UT6NrZ6ZVX5U87g92qiQ0dpIk0QZpwHsKe+jx0rJogTaQJ0gRpIk2QJtIEaYI0kSZIE2mCNJEmSBOkiTRBmkgTpAnSRJqw5A8f1ibFpCF1NAAAAABJRU5ErkJggg==", "https://elevated-designs.pages.dev": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAN4AAADeCAIAAADdBSngAAADqklEQVR42u3dS04DQQxFUYLY/5bDAjJplexnp/ucMQqQXFXJ6d/r/X7/wD6/3gKkCdJEmiBNpAnSBGkiTZAm0gRpgjSRJkgTaYI0kSZIE6SJNEGaSBNm/FW90Ov1Gvw3Pq+m//x7zq64r3qds3es6m+e/SysmtjQQZpIE6QJyQm9b1Krmm3P5tbZebzq+4HZz8KqiQ0dpIk0QZowO6FXTXN90+WViTj5bcDZe5g8zp68879VExs6SBNpgjQxod/DlQm0akrte50nPwvPqok0QZpIE6SJCf3JrkzEfUfVPZveqok0QZpIE6SJCX3P/DsreX+52fPM938WVk2kCdJEmiBNTOh90+6ss7PKv/Fn9n8WVk1s6CBNpAnShM/R7a5nViePUPdNza5DB2mCNJEmSJPHaHwe+rbzw6/Mv1W/ffYp6lXOvmfwPHRs6CBNkCbShNkJPanqCHXfWeX7//dt3wZYNbGhgzSRJkiTx4ue5Z48zp787VWzdvL8gbPZv+9dtWpiQwdpIk2QJo/XeJb72UzaN0smz5avmm2T30XMfj9g1cSGDtJEmiBNTOh9L933XLC+2bZvJu2bbavejarvPaya2NBBmiBNpAln413fHcyS13R/49PE7vq/O8sdGzpIE6SJNOHI8J3i9p8bnzxjfNsr930WVk1s6CBNpAnShL4Jve8c8qp5s2+unz2Knbya3nXoIE2kCdJEmrB/Qq+af2efNl71n86ewZ58N1yHjg0dpAnSRJpQNW7OXodeNQMmvx9InjG+/3lwfTO7VRMbOkgTaYI0MaFHf33btc/f+Hyx5JH32WverZrY0EGaSBOkCbMT+rYrpvuO8lfN/n1PmkveTc6qiQ0dpIk0QZqQnNDver+y5Lnos0fwqz4LEzo2dJAmSBNpwpHovdxnJ8c+yavgq9752bvtWTWxoYM0kSZIE/om9P1He89m5L6zwZPfGGw7g92qiQ0dpIk0QZrQN6Enp7nZO64nJ+LkOz97TrtVExs6SBNpgjQxoSd/2exZ3Ge/6+x1zibZqqfDV306n3+PY+ggTaQJ0kSacI8JPalv2p19Hvq2c9HdKQ4bOkgTpIk0wYT+7ZLHx6v+HqsmSBNpgjSRJtxjQt92t/C+q8W3PWm97056Vk1s6CBNkCbShP0T+v77mSev4N4211dxpzhs6CBNkCbShKpBdttxbbBqIk2QJtIEaSJNkCZIE2mCNJEmSBOkiTRBmkgTpIk0QZogTaQJ0kSaMOofH2UL6dADU3wAAAAASUVORK5CYII="};
const SHR={f:"all", qrLoading:false, msg:{}};
try{ SHR.f=localStorage.getItem("hq-share-f")||"all"; }catch(e){}
function shrQrLib(){ if(typeof qrcode==="function"||SHR.qrLoading) return; SHR.qrLoading=true;
  const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload=()=>{ render(); }; s.onerror=()=>{ SHR.qrLoading=false; }; document.head.appendChild(s); }
function shrQr(url){ if(SHARE_QR[url]) return SHARE_QR[url]; if(typeof qrcode!=="function") return ""; try{ const q=qrcode(0,"M"); q.addData(url); q.make(); return q.createDataURL(6,2); }catch(e){ return ""; } }
function shrWays(s,text){ const E=encodeURIComponent, u=E(s.url), t=E(text), tu=E(text+" "+s.url); return [
  ["Text","sms:?&body="+tu],["Email","mailto:?subject="+E(s.name)+"&body="+tu],
  ["Facebook","https://www.facebook.com/sharer/sharer.php?u="+u],["X","https://twitter.com/intent/tweet?text="+t+"&url="+u],
  ["WhatsApp","https://wa.me/?text="+tu],["Pinterest","https://pinterest.com/pin/create/button/?url="+u+"&description="+t],
  ["Threads","https://www.threads.net/intent/post?text="+tu],["Reddit","https://www.reddit.com/submit?url="+u+"&title="+t],
  ["LinkedIn","https://www.linkedin.com/sharing/share-offsite/?url="+u]]; }
function shrWaysHtml(s){ const text=SHR.msg[s.id]||s.msg; return shrWays(s,text).map(([n,h])=>`<a class="btn shrw" href="${esc(h)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(""); }
function vShare(){ if(SHARE_SHOPS.some(x=>!SHARE_QR[x.url])) shrQrLib();
  const list=SHARE_SHOPS.filter(s=>SHR.f==="all"||s.biz===SHR.f);
  const card=s=>{ const q=shrQr(s.url); return `<section class="card shrcard" id="shr-${s.id}"><div class="shrband" style="background:${s.band}"></div>
    <div class="shrmain"><div><span class="eyebrow">${esc(s.kind)}</span><h2 class="big" style="margin:2px 0 0">${esc(s.name)}</h2><p class="small muted" style="margin:2px 0 0">${esc(s.what)}</p></div>
      <div class="shrurl"><span class="shru" id="shru-${s.id}">${esc(s.url)}</span><button class="btn primary" type="button" data-shrcopy="${s.id}">Copy link</button></div>
      <div class="shrrow"><a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">Open shop</a><button class="btn" type="button" data-shrshare="${s.id}">Share…</button><button class="btn" type="button" data-shrcopymsg="${s.id}">Copy message + link</button></div>
      <label class="small muted" for="shrm-${s.id}" style="font-weight:600">Message to send</label>
      <textarea class="shrmsg" id="shrm-${s.id}" data-shrmsg="${s.id}" rows="2">${esc(SHR.msg[s.id]||s.msg)}</textarea>
      <div class="shrrow" id="shrw-${s.id}">${shrWaysHtml(s)}</div>
      <div class="small" id="shrs-${s.id}" role="status" style="min-height:18px;color:var(--ok,#1b7f3b)"></div></div>
    <div class="shrqr"><div class="shrqrbox">${q?`<img src="${q}" alt="QR code for ${esc(s.url)}" id="shrq-${s.id}">`:`<span class="small muted">Loading QR…</span>`}</div>
      <button class="btn" type="button" data-shrsave="${s.id}">Save QR image</button><span class="small muted" style="text-align:center">Or press and hold the code to save it.</span></div></section>`; };
  return `<section class="card"><div class="card-head"><h2 class="big">Share links</h2><span class="eyebrow">every shop · QR · copy · send</span></div>
    <p class="small muted" style="margin:0 0 10px">Tap a link to open it, copy it, show its QR code, or send it by text, email or social. Edit the message on any card and the share buttons use your words.</p>
    <div class="chips">${[["all","All shops"],["c3d","Charleston3D (3D prints)"],["ed","Elevated Designs (shirts)"]].map(([k,l])=>`<button type="button" class="chip" data-shrf="${k}" aria-pressed="${SHR.f===k}">${l}</button>`).join("")}</div></section>
    ${list.map(card).join("")}
    <p class="small muted">QR codes go straight to each shop. Print them on market signs, packing slips or the thank-you card. Text and Email open your phone's apps; if nothing happens, use Copy and paste it.</p>`; }
function shrSay(id,t){ const e=document.getElementById("shrs-"+id); if(!e) return; e.textContent=t; clearTimeout(e._t); e._t=setTimeout(()=>{ e.textContent=""; },3500); }
async function shrCopy(id,text){ try{ await navigator.clipboard.writeText(text); shrSay(id,"Copied."); }
  catch(e){ const u=document.getElementById("shru-"+id); if(u){ const r=document.createRange(); r.selectNodeContents(u); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); } shrSay(id,"Link selected. Press Ctrl+C, or long-press and Copy."); } }
function bindShare(){ if(window.SHR_BOUND) return; window.SHR_BOUND=true;
  document.addEventListener("input",e=>{ const id=e.target&&e.target.dataset&&e.target.dataset.shrmsg; if(!id) return; SHR.msg[id]=e.target.value; const s=SHARE_SHOPS.find(x=>x.id===id); const w=document.getElementById("shrw-"+id); if(s&&w) w.innerHTML=shrWaysHtml(s); });
  document.addEventListener("click",async e=>{ const t=e.target.closest&&e.target.closest("[data-shrf],[data-shrcopy],[data-shrcopymsg],[data-shrshare],[data-shrsave]"); if(!t) return;
    if(t.dataset.shrf){ SHR.f=t.dataset.shrf; try{ localStorage.setItem("hq-share-f",SHR.f); }catch(x){} render(); return; }
    const id=t.dataset.shrcopy||t.dataset.shrcopymsg||t.dataset.shrshare||t.dataset.shrsave; const s=SHARE_SHOPS.find(x=>x.id===id); if(!s) return;
    const msg=SHR.msg[id]||s.msg;
    if(t.dataset.shrcopy) return shrCopy(id,s.url);
    if(t.dataset.shrcopymsg) return shrCopy(id,msg+" "+s.url);
    if(t.dataset.shrshare){ if(navigator.share){ try{ await navigator.share({title:s.name,text:msg,url:s.url}); shrSay(id,"Shared."); return; }catch(x){ if(x&&x.name==="AbortError") return; } }
      const w=document.getElementById("shrw-"+id); if(w){ w.scrollIntoView({block:"nearest",behavior:"smooth"}); const a=w.querySelector("a"); if(a) a.focus(); } shrSay(id,"Pick where to send it below."); return; }
    if(t.dataset.shrsave){ const img=document.getElementById("shrq-"+id); if(!img){ shrSay(id,"The QR code is still loading."); return; }
      let dl=null; try{ dl=window.claude&&await window.claude.use("downloads"); }catch(x){}
      if(!dl){ shrSay(id,"Press and hold (or right-click) the code to save it."); return; }
      try{ const blob=await (await fetch(img.src)).blob(); await dl.save({filename:s.name.replace(/[^A-Za-z0-9]+/g,"-")+"-QR.png",data:blob}); shrSay(id,"QR code saved."); }
      catch(x){ shrSay(id,x&&x.code==="declined"?"Not saved.":"Couldn't save here. Press and hold the code instead."); } } }); }

/* ================= CUSTOM QUOTES: custom-order requests for Charleston3D (Shopify + Etsy). Aaron talks it through with the customer, sets the price and shipping, approves with his PIN, and the invoicer sends a Shopify checkout link for exactly that amount (Etsy: he sends a custom listing from Etsy Messages). ================= */
const QT_TRIGGER="trig_01JkWByKd7vsR4RMxNvW3Awz";
const QT_ETSY={c3d:"Charleston3DWorks",ed:"ElevatedDesignsSC"};
const QT={rows:[], sub:false, f:"open", add:false, busy:{}};
const QT_ST={new:["New request","warn"],talking:["Talking it through","warn"],quoted:["Price set · waiting on you","warn"],approved:["Approved · sending invoice","warn"],"needs Aaron":["Needs you","bad"],invoiced:["Invoice sent · waiting to pay","warn"],paid:["Paid · print it","ok"],declined:["Declined","off"],done:["Shipped","ok"]};
function qtSub(){ if(QT.sub||!db) return; QT.sub=true; try{ db.collection("quotes").orderBy("at","desc").limit(200).onSnapshot(s=>{ QT.rows=s.docs.map(d=>({id:d.id,...d.data()})); render(); },()=>{ QT.sub=false; }); }catch(e){ QT.sub=false; } }
function qtMoney(n){ const v=Number(n); return isFinite(v)&&v>0?"$"+v.toFixed(2):"—"; }
function qtOpen(q){ return !["paid","declined","done"].includes(q.status); }
function vQuotes(){ qtSub();
  const rows=QT.rows; const open=rows.filter(qtOpen);
  const list=QT.f==="open"?open:QT.f==="paid"?rows.filter(q=>q.status==="paid"||q.status==="done"):rows;
  const kp=(n,l)=>`<div class="qtk"><b>${n}</b><span class="small muted">${l}</span></div>`;
  const card=q=>{ const st=QT_ST[q.status]||[q.status||"new","warn"]; const sh=q.channel==="etsy"; const tot=(Number(q.price)||0)+(Number(q.shipping)||0); const id=esc(q.id);
    const locked=["approved","invoiced","paid","done","declined"].includes(q.status);
    return `<section class="card qtcard" id="qt-${id}"><div class="qthead"><div><span class="eyebrow">${sh?"Etsy · "+(QT_ETSY[q.biz==="ed"?"ed":"c3d"]):"Shopify · charleston3d.com"} · ${esc(typeof ago==="function"?ago(q.at):"")}</span>
      <h3 style="margin:2px 0 0">${esc(q.title||"Custom request")}</h3><span class="small muted">${esc(q.name||"")}${q.email?` · <a href="mailto:${esc(q.email)}">${esc(q.email)}</a>`:""}${q.zip?` · ZIP ${esc(q.zip)}`:""}${q.needBy?` · needs it by ${esc(q.needBy)}`:""}</span></div>
      <span class="e3st ${st[1]}">${esc(st[0])}</span></div>
      <p style="margin:8px 0;white-space:pre-wrap">${esc(q.request||"")}</p>
      ${q.note?`<div class="e3st warn" style="margin-bottom:8px">${esc(q.note)}</div>`:""}
      <form class="qtform" data-qtform="${id}">
        <label>Price (item)<input type="number" min="0" step="0.01" name="price" value="${q.price!=null?esc(String(q.price)):""}" ${locked?"disabled":""} placeholder="e.g. 34.00"></label>
        <label>Shipping<input type="number" min="0" step="0.01" name="shipping" value="${q.shipping!=null?esc(String(q.shipping)):""}" ${locked?"disabled":""} placeholder="e.g. 5.99"></label>
        <label>Shipping method<select name="shippingMethod" ${locked?"disabled":""}>${["USPS Ground Advantage","USPS Priority Mail","Local pickup (Charleston)"].map(m=>`<option ${q.shippingMethod===m?"selected":""}>${m}</option>`).join("")}</select></label>
        <label class="qtwide">Message on the invoice email (optional)<textarea name="invoiceMessage" rows="2" ${locked?"disabled":""} placeholder="Thanks for working with us on this! …">${esc(q.invoiceMessage||"")}</textarea></label>
        <label class="qtwide">Your notes (what you agreed by email)<textarea name="notes" rows="2">${esc(q.notes||"")}</textarea></label>
        <div class="qtwide qtacts"><span class="small"><b>Total the customer pays: ${qtMoney(tot)}</b>${tot?` <span class="muted">(${qtMoney(q.price)} + ${qtMoney(q.shipping)} shipping)</span>`:""}</span>
          ${locked?"":`<button class="btn" type="submit">Save</button>`}
          ${!locked&&q.status!=="talking"?`<button class="btn" type="button" data-qtset="talking" data-id="${id}">Mark: talking with customer</button>`:""}
          ${!locked?`<button class="btn primary" type="button" data-qtapprove="${id}">${sh?"Approve price":"Approve & send invoice"}</button><button class="btn" type="button" data-qtset="declined" data-id="${id}">Decline</button>`:""}
          ${q.status==="needs Aaron"?`<button class="btn primary" type="button" data-qtset="quoted" data-id="${id}">Fix and re-approve</button>`:""}
          ${q.status==="paid"?`<button class="btn" type="button" data-qtset="done" data-id="${id}">Mark shipped</button>`:""}</div>
      </form>
      ${sh&&q.status==="approved"?`<div class="e3st warn">Next step on Etsy: open <a href="https://www.etsy.com/messages" target="_blank" rel="noopener">Etsy Messages</a>, open ${esc(q.name||"the buyer")}'s conversation and tap "Create a custom order" with ${qtMoney(q.price)} + ${qtMoney(q.shipping)} shipping. Etsy charges them that exact amount.</div>`:""}
      ${q.invoiceUrl?`<div class="small">Invoice: <a href="${esc(q.invoiceUrl)}" target="_blank" rel="noopener">checkout link sent to ${esc(q.email||"customer")}</a>${q.orderName?` · paid as order ${esc(q.orderName)}`:""}</div>`:""}
      ${(q.history||[]).length?`<details class="small muted"><summary>History (${q.history.length})</summary><ul>${q.history.slice(-12).map(h=>`<li>${esc(String(h.at||"").slice(0,16).replace("T"," "))} · ${esc(h.what||"")}</li>`).join("")}</ul></details>`:""}
    </section>`; };
  const addForm=`<form class="card qtform qtadd" id="qtAdd" ${QT.add?"":"hidden"}><h3 class="qtwide" style="margin:0">Add a custom request</h3>
    <label>Where it came from<select name="channel"><option value="shopify">Shopify (charleston3d.com / email)</option><option value="etsy">Etsy · Charleston 3D (3D prints)</option><option value="etsy-ed">Etsy · ElevatedDesignsSC (shirts)</option></select></label>
    <label>Customer name<input name="name" maxlength="80" placeholder="Jamie R."></label>
    <label>Customer email<input name="email" type="email" maxlength="120" placeholder="jamie@example.com"></label>
    <label>Short title<input name="title" maxlength="80" placeholder="Wedding favor name keychains (40)"></label>
    <label>ZIP code<input name="zip" maxlength="10" placeholder="29464"></label>
    <label>Needed by<input name="needBy" maxlength="40" placeholder="Nov 30"></label>
    <label class="qtwide">What they want (paste their email)<textarea name="request" rows="4" maxlength="3000" placeholder="Colors, size, names or text, quantity, photos or links they sent…"></textarea></label>
    <div class="qtwide qtacts"><button class="btn primary" type="submit">Add request</button><button class="btn" type="button" data-qtadd="0">Cancel</button></div></form>`;
  return `<section class="card"><div class="card-head"><h2 class="big">Custom quotes</h2><span class="eyebrow">Charleston3D · you approve every custom order</span></div>
    <p class="small muted" style="margin:0 0 10px">1. A customer asks for something custom: the <a href="https://charleston3d.com/products/custom-3d-print-quote" target="_blank" rel="noopener">Custom 3D Print</a> page or contact form emails you, and Etsy's <b>Request Custom Order</b> button opens a conversation in Etsy Messages. 2. Work it out with them by email or Etsy message. 3. Enter the price and shipping here and approve. Shopify customers get a secure checkout link for exactly that amount; on Etsy you send a custom listing from Messages. Nothing is charged until they pay that amount.</p>
    <div class="qtkpis">${kp(rows.filter(q=>["new","talking","quoted","needs Aaron"].includes(q.status)).length,"need you")}${kp(rows.filter(q=>q.status==="invoiced"||q.status==="approved").length,"waiting on customer")}${kp(rows.filter(q=>q.status==="paid").length,"paid · to print")}${kp(qtMoney(rows.filter(q=>q.status==="paid"||q.status==="done").reduce((a,q)=>a+(Number(q.total)||((Number(q.price)||0)+(Number(q.shipping)||0))),0)),"custom sales")}</div>
    <div class="chips" style="margin-top:10px">${[["open","Open",open.length],["paid","Paid & shipped",rows.filter(q=>q.status==="paid"||q.status==="done").length],["all","All",rows.length]].map(([k,l,c])=>`<button type="button" class="chip" data-qtf="${k}" aria-pressed="${QT.f===k}">${l} · ${c}</button>`).join("")}
      <button type="button" class="btn primary" data-qtadd="1" style="margin-left:auto">+ Add request</button></div></section>
    ${addForm}
    ${list.length?list.map(card).join(""):`<section class="card"><div class="empty">${QT.f==="open"?"No open custom requests. When someone asks for something custom, add it here with + Add request.":"Nothing here yet."}</div></section>`}`; }
async function qtSave(id,f,extra){ const q=QT.rows.find(r=>r.id===id); if(!q||!db) return false; const g=n=>f&&f.elements[n]?f.elements[n].value:undefined;
  const upd={}; ["price","shipping"].forEach(k=>{ const v=g(k); if(v!==undefined&&v!=="") upd[k]=Math.round(Number(v)*100)/100; });
  ["shippingMethod","invoiceMessage","notes"].forEach(k=>{ const v=g(k); if(v!==undefined) upd[k]=String(v).slice(0,1500); });
  Object.assign(upd,extra||{}); if(upd.price!=null||upd.shipping!=null){ const p=upd.price!=null?upd.price:q.price, s=upd.shipping!=null?upd.shipping:q.shipping; upd.total=Math.round(((Number(p)||0)+(Number(s)||0))*100)/100; }
  try{ await db.doc("quotes/"+id).update(upd); return true; }catch(e){ console.error("qt",e); toast("Couldn't save that. Try again."); return false; } }
function bindQuotes(){ if(window.QT_BOUND) return; window.QT_BOUND=true;
  document.addEventListener("submit",async e=>{ const f=e.target;
    if(f.id==="qtAdd"){ e.preventDefault(); if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can add custom requests."); return; }
      const g=n=>String(f.elements[n].value||"").trim(); if(!g("request")&&!g("title")){ f.elements.request.focus(); toast("Add what the customer wants."); return; }
      const now=new Date().toISOString();
      try{ await db.collection("quotes").add({biz:g("channel")==="etsy-ed"?"ed":"c3d",channel:(g("channel")==="etsy-ed"?"etsy":g("channel"))||"shopify",name:g("name"),email:g("email"),title:g("title")||g("request").slice(0,60),zip:g("zip"),needBy:g("needBy"),request:g("request"),status:"new",at:now,by:"aaron",shippingMethod:"USPS Ground Advantage",history:[{at:now,what:"Request added"}]}); QT.add=false; QT.f="open"; toast("Request added."); render(); }
      catch(x){ console.error(x); toast("Couldn't add it. Try again."); } return; }
    const qf=f.closest&&f.closest("[data-qtform]"); if(!qf) return; e.preventDefault(); if(!IS_OWNER){ toast("Only Aaron can change quotes."); return; }
    const id=qf.dataset.qtform; const q=QT.rows.find(r=>r.id===id); const p=Number(qf.elements.price&&qf.elements.price.value);
    if(await qtSave(id,qf,q&&["new","talking"].includes(q.status)&&p>0?{status:"quoted"}:{})) toast("Saved."); });
  document.addEventListener("click",async e=>{ const t=e.target.closest&&e.target.closest("[data-qtf],[data-qtadd],[data-qtset],[data-qtapprove]"); if(!t) return;
    if(t.dataset.qtf){ QT.f=t.dataset.qtf; render(); return; }
    if(t.dataset.qtadd){ QT.add=t.dataset.qtadd==="1"; render(); if(QT.add){ const n=document.querySelector("#qtAdd [name=name]"); if(n) n.focus(); } return; }
    if(!IS_OWNER){ toast("Only Aaron, signed in with his PIN, can change quotes."); return; }
    const id=t.dataset.qtset?t.dataset.id:t.dataset.qtapprove; const q=QT.rows.find(r=>r.id===id); if(!q) return; const now=new Date().toISOString();
    const form=document.querySelector(`[data-qtform="${CSS.escape(id)}"]`);
    if(t.dataset.qtset){ const to=t.dataset.qtset;
      if(to==="declined"){ const ok=await hqConfirm(`Decline "${q.title||"this request"}"?\n\nNothing is charged. Let the customer know by email or Etsy message.`,{title:"Decline request",ok:"Decline",danger:true}); if(!ok) return; }
      await qtSave(id,form,{status:to,history:[...(q.history||[]),{at:now,what:{talking:"Talking it through with the customer",declined:"Declined",quoted:"Fixed; ready to approve again",done:"Marked shipped"}[to]||to}]}); render(); return; }
    // approve
    const g=n=>form&&form.elements[n]?form.elements[n].value:""; const price=Math.round(Number(g("price"))*100)/100, ship=Math.round(Number(g("shipping"))*100)/100;
    if(!(price>0)){ toast("Enter the agreed price first."); form&&form.elements.price&&form.elements.price.focus(); return; }
    if(!(ship>=0)||g("shipping")===""){ toast("Enter the shipping amount (0 for local pickup)."); form&&form.elements.shipping&&form.elements.shipping.focus(); return; }
    const etsy=q.channel==="etsy";
    if(!etsy&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q.email||"")){ toast("This request needs the customer's email before an invoice can be sent."); return; }
    const total=(price+ship).toFixed(2);
    const ok=await hqConfirm(etsy?`Approve $${price.toFixed(2)} + $${ship.toFixed(2)} shipping = $${total} for "${q.title}"?\n\nNext you'll send ${q.name||"the buyer"} a custom listing from Etsy Messages for that amount.`:`Send ${q.email} a checkout link for $${total}?\n\n$${price.toFixed(2)} for "${q.title}" + $${ship.toFixed(2)} shipping. They're charged only if they pay the invoice.`,{title:etsy?"Approve price":"Approve & send invoice",ok:etsy?"Approve":"Send invoice for $"+total});
    if(!ok) return;
    if(t){ t.disabled=true; t.textContent=etsy?"Approving…":"Sending…"; }
    const saved=await qtSave(id,form,{status:"approved",approvedBy:"aaron",approvedAt:now,price,shipping:ship,history:[...(q.history||[]),{at:now,what:`Approved by Aaron: $${price.toFixed(2)} + $${ship.toFixed(2)} shipping`}]});
    if(!saved) return;
    if(!etsy){ let fired=false; try{ fired=typeof fireNow==="function"?await fireNow(QT_TRIGGER,`Custom quote approved by Aaron, invoice it now: quotes/${id} ($${total} to ${q.email}).`):false; }catch(x){}
      toast(fired?"Approved. The invoice email goes out in a minute or two.":"Approved. The invoice goes out within the hour."); }
    else toast("Approved. Now send the custom listing from Etsy Messages.");
    render(); }); }

/* ================= 3D REDESIGN STUDIO: drag & drop a photo, sketch or 3D file (STL/3MF/OBJ/GLB), say what you want, and either
   send it to Meshy on Aaron's PC (redesign from a photo, new model from a description, repair for printing) or add your own file as-is.
   Jobs live in the "redesign" collection; the PC worker (scheduled task RD_TRIGGER) runs Meshy and sends back renders + print files.
   Nothing is listed anywhere until Aaron adds a result to the 3D designs. ================= */
const RD_TRIGGER="trig_01GJd9rWMPJB5bSc7VGZMk8D";
const RD={rows:[], sub:false, files:[], busy:false, mode:"meshy-image", f:"open", prev:{}};
const RD_MODES={
  "meshy-image":["Redesign with Meshy","Turns your photo, sketch or render into a detailed 3D model."],
  "meshy-text":["New model from a description","Meshy builds a model from your words (a photo helps but isn't needed)."],
  "clone":["Re-engineer / clone with a change","Keep your file's design and change it: resize, add a name, new base or hanger, mirror, merge parts. Simple edits are done free in code; Meshy only when needed."],
  "repair":["Clean up for printing","Meshy repairs and remeshes your STL/3MF so it prints cleanly."],
  "own":["Add my own file as-is","No AI. Your file and pictures go straight into the 3D designs for review."]
};
const RD_PAL=[[52,74,110],[224,96,72],[236,208,96],[96,160,120],[200,140,90],[120,120,120]];
const RD_ST={queued:["Waiting for your PC","warn"],running:["Meshy is working","warn"],review:["Ready for you","ok"],added:["Added to 3D designs","ok"],failed:["Didn't work","bad"],cancelled:["Cancelled","off"]};
function rdSub(){ if(RD.sub||!db) return; RD.sub=true; try{ db.doc("rdsettings/meshy").onSnapshot(d=>{ RD.set=d.exists?d.data():null; render(); },()=>{}); }catch(e){} try{ db.collection("redesign").orderBy("at","desc").limit(100).onSnapshot(s=>{ RD.rows=s.docs.map(d=>({id:d.id,...d.data()})); render(); },()=>{ RD.sub=false; }); }catch(e){ RD.sub=false; } }
function rdKind(f){ return /\.(stl|3mf|obj|glb|gltf|ply)$/i.test(f.name)?"model":/^image\//.test(f.type)||/\.(png|jpe?g|webp|gif)$/i.test(f.name)?"image":""; }
function rdSize(n){ return n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"; }
function vRedesign(){ rdSub(); const own=typeof qpCan==="function"&&qpCan();
  const open=RD.rows.filter(r=>["queued","running","review","failed"].includes(r.status)); const list=RD.f==="open"?open:RD.rows;
  const fileChips=RD.files.map((f,i)=>`<span class="rdfile">${RD.prev[i]?`<img src="${RD.prev[i]}" alt="">`:`<i>${esc(rdKind(f)==="model"?"3D":"IMG")}</i>`}<span><b>${esc(f.name)}</b><small>${rdSize(f.size)}</small></span><button type="button" class="x" data-rdrm="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join("");
  const job=r=>{ const st=RD_ST[r.status]||[r.status||"",""]; const res=r.results||{}; const pics=(res.previews||[]).slice(0,8); const id=esc(r.id);
    return `<section class="card rdjob"><div class="qthead"><div><span class="eyebrow">${esc((RD_MODES[r.mode]||[r.mode])[0])} · ${esc(typeof ago==="function"?ago(r.at):"")}</span><h3 style="margin:2px 0 0">${esc(r.title||"Untitled")}</h3></div><span class="e3st ${st[1]}">${esc(st[0])}</span></div>
      ${r.prompt?`<p class="small" style="white-space:pre-wrap;margin:6px 0">${esc(r.prompt)}</p>`:""}
      <div class="rdthumbs">${(r.inputs||[]).filter(x=>x.kind==="image"&&x.url).map(x=>`<img src="${esc(x.url)}" alt="Your upload ${esc(x.name||"")}" loading="lazy">`).join("")}${(r.inputs||[]).filter(x=>x.kind==="model").map(x=>`<span class="rdchip">3D · ${esc(x.name)}</span>`).join("")}</div>
      ${pics.length?`<div class="rdres">${pics.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Result render" loading="lazy"></a>`).join("")}</div>`:""}
      ${res.note?`<p class="small muted">${esc(res.note)}</p>`:""}${r.error?`<div class="e3st bad">${esc(r.error)}</div>`:""}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        ${(res.files||[]).map((f,i)=>`<button type="button" class="btn" data-rddl="${id}" data-i="${i}">Download ${esc(f.name||"file")}</button>`).join("")}
        ${own&&r.status==="review"?`<button type="button" class="btn primary" data-rdadd="${id}">Add to 3D designs</button><button type="button" class="btn" data-rdagain="${id}">Try again with a change</button>`:""}
        ${own&&["queued","failed"].includes(r.status)?`<button type="button" class="btn" data-rdcancel="${id}">Cancel</button>`:""}
        ${own&&r.status==="failed"?`<button type="button" class="btn" data-rdretry="${id}">Run again</button>`:""}
        ${res.credits!=null?`<span class="small muted">Meshy credits used: ${esc(String(res.credits))}</span>`:""}</div>
    </section>`; };
  return `<section class="card rdstudio"><div class="card-head"><h2 class="big">3D Redesign Studio</h2><span class="eyebrow">drop a photo or 3D file · say what you want · approve the result</span></div>
    <div class="rdmodes" role="radiogroup" aria-label="What to do">${Object.entries(RD_MODES).map(([k,[l,d]])=>`<button type="button" role="radio" class="rdmode" data-rdmode="${k}" aria-checked="${RD.mode===k}"><b>${l}</b><small>${d}</small></button>`).join("")}</div>
    <div class="rddrop" data-rddrop tabindex="0" role="button" aria-label="Drop files here or press Enter to choose files"><b>Drop photos, sketches or 3D files here</b><span class="small muted">PNG, JPG, WEBP · STL, 3MF, OBJ, GLB · up to 15 MB each</span><input type="file" data-rdfile multiple accept="image/*,.stl,.3mf,.obj,.glb,.gltf,.ply" hidden></div>
    ${RD.files.length?`<div class="rdfiles">${fileChips}</div>`:""}
    <div class="rdform"><label>Name<input data-rdtitle maxlength="80" value="${esc(RD.title||"")}" placeholder="e.g. Folly Beach pier ornament"></label>
      ${RD.mode==="clone"?`<label>Where is this file from?<select data-rdsrc><option value="mine">My own design</option><option value="licensed">Bought/downloaded with a license that allows selling prints</option><option value="inspiration">Someone else's design (inspiration only, make an original)</option></select></label>`:""}
      <label class="rdwide">What do you want?<textarea data-rdprompt rows="3" maxlength="1500" placeholder="e.g. Make this a premium Christmas ornament, 3 inches, with a name banner across the bottom · keep the shape, smooth the surface, print without supports · a sea turtle night light with a shell-pattern lampshade">${esc(RD.prompt||"")}</textarea></label></div>
    <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">${own?`<button type="button" class="btn primary" data-rdgo ${RD.busy?"disabled":""}>${RD.busy?"Sending…":RD.mode==="own"?"Add to 3D designs":RD.mode==="clone"?"Send to re-engineer":"Send to Meshy"}</button>`:`<span class="small muted">Sign in with your PIN to send jobs.</span>`}
      <span class="small muted">${RD.mode==="own"?"No credits used.":"Runs on your PC with your Meshy account. Credits are used per model."}</span>${own?`<label class="small muted" style="margin-left:auto">Meshy jobs per day <select data-rdcap>${[1,2,3,5,10].map(n=>`<option ${((RD.set&&RD.set.jobsPerDay)||1)===n?"selected":""}>${n}</option>`).join("")}</select></label>`:""}</div></section>
    <div class="chips" style="margin:4px 0 10px">${[["open","In progress & ready",open.length],["all","All jobs",RD.rows.length]].map(([k,l,c])=>`<button type="button" class="chip" data-rdf="${k}" aria-pressed="${RD.f===k}">${l} · ${c}</button>`).join("")}</div>
    ${list.length?list.map(job).join(""):`<section class="card"><div class="empty">No jobs yet. Drop a photo or 3D file above to start.</div></section>`}`; }
function rdSet(files){ const ok=[...(files||[])].filter(f=>{ const k=rdKind(f); if(!k){ toast(f.name+": use a photo or an STL/3MF/OBJ/GLB file."); return false; } if(f.size>15*1048576){ toast(f.name+" is over 15 MB."); return false; } return true; });
  RD.files=RD.files.concat(ok).slice(0,8); RD.prev={}; RD.files.forEach((f,i)=>{ if(rdKind(f)==="image") RD.prev[i]=URL.createObjectURL(f); });
  render(); rdPreviewModels(); }
async function rdPreviewModels(){ for(let i=0;i<RD.files.length;i++){ const f=RD.files[i]; if(RD.prev[i]||!/\.(stl|3mf)$/i.test(f.name)||typeof qpRead3D!=="function") continue;
  try{ const parts=await qpRead3D(f); const bb=qpBBox(parts); const cv=qpRender3D(parts,bb,-0.6,0.35,240,240,RD_PAL); RD.prev[i]=cv.toDataURL("image/png"); render(); }catch(e){} } }
function rdB64(buf){ const u8=new Uint8Array(buf); let s=""; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return btoa(s); }
async function rdUpload(f){ if(!assets) throw new Error("Uploads aren't available in this view.");
  if(rdKind(f)==="image"){ const a=await assets.upload(f,f.type?undefined:{type:"image/png"}); return {kind:"image",name:f.name,assetId:a.id,url:a.url,bytes:f.size}; }
  const b64=rdB64(await f.arrayBuffer()); const a=await assets.upload(new Blob([b64],{type:"text/plain"}),{type:"text/plain"}); return {kind:"model",name:f.name,assetId:a.id,url:a.url,encoding:"base64",bytes:f.size}; }
async function rdRenders(f){ if(!/\.(stl|3mf)$/i.test(f.name)||typeof qpRead3D!=="function") return [];
  const parts=await qpRead3D(f); const bb=qpBBox(parts); const out=[]; for(const [yaw,tilt] of [[0,0.12],[-0.7,0.35],[0.7,0.35],[0,1.2]]){ const cv=qpRender3D(parts,bb,yaw,tilt,1600,1600,RD_PAL); const b=await new Promise(r=>cv.toBlob(r,"image/jpeg",0.9)); const a=await assets.upload(b); out.push(a.url); } return out; }
async function rdGo(){ if(RD.busy) return; if(!(typeof qpCan==="function"&&qpCan())){ toast("Only Aaron, signed in with his PIN, can send jobs."); return; }
  const title=(document.querySelector("[data-rdtitle]")||{}).value||""; const prompt=(document.querySelector("[data-rdprompt]")||{}).value||"";
  if(RD.mode!=="meshy-text"&&!RD.files.length){ toast("Drop a photo or 3D file first."); return; }
  if(RD.mode==="meshy-text"&&prompt.trim().length<8){ toast("Describe the model you want."); return; }
  if((RD.mode==="repair"||RD.mode==="clone")&&!RD.files.some(f=>rdKind(f)==="model")){ toast("This needs an STL, 3MF, OBJ or GLB file."); return; }
  if(RD.mode==="clone"&&prompt.trim().length<4){ toast("Say what to change."); return; }
  const srcSel=document.querySelector("[data-rdsrc]"); const source=RD.mode==="clone"&&srcSel?srcSel.value:null;
  if(RD.mode!=="own"&&!(await hqConfirm(RD.mode==="clone"?`Send "${title||"this job"}" to your PC to re-engineer?\n\nSimple changes are made free in code. If it needs Meshy, it uses credits (about 10–30).`:`Send "${title||"this job"}" to Meshy on your PC?\n\nThis uses Meshy credits (about 30 per new model).`,{title:"Send job",ok:"Send"}))) return;
  RD.busy=true; render(); const now=new Date().toISOString();
  try{ const inputs=[]; for(const f of RD.files) inputs.push(await rdUpload(f));
    if(RD.mode==="own"){ let renders=[]; for(const f of RD.files){ if(rdKind(f)==="model") renders=renders.concat(await rdRenders(f)); }
      const imgs=inputs.filter(x=>x.kind==="image").map(x=>x.url); const pics=imgs.concat(renders);
      const ref=await db.collection("printideas").add({title:title||RD.files[0].name.replace(/\.[^.]+$/,""),concept:prompt,kind:"own",path:"aaron-upload",status:"review",legal:"ok",by:"aaron",at:now,round:now.slice(0,10),source:"Aaron's own file (3D Redesign Studio)",previewUrl:pics[0]||"",renders:pics,files:inputs.filter(x=>x.kind==="model").map(x=>({name:x.name,assetId:x.assetId,url:x.url,encoding:"base64",kind:/\.3mf$/i.test(x.name)?"3mf":"stl",bytes:x.bytes})),tags:["aaron-upload"]});
      await db.collection("redesign").add({mode:"own",title,prompt,inputs,status:"added",printidea:ref.id,at:now,by:"aaron",results:{previews:pics,note:"Added straight to the 3D designs."}});
      toast("Added to your 3D designs.");
    } else {
      const ref=await db.collection("redesign").add({mode:RD.mode,title,prompt,inputs,source,status:"queued",at:now,by:"aaron"});
      let fired=false; try{ if(RD_TRIGGER&&typeof fireNow==="function") fired=await fireNow(RD_TRIGGER,`3D Redesign Studio job queued by Aaron: redesign/${ref.id}. Run it now.`); }catch(x){}
      toast(fired?"Sent. Your PC starts it in a minute.":"Queued. Your PC picks it up on its next run.");
    }
    RD.files=[]; RD.prev={}; RD.title=""; RD.prompt=""; const t=document.querySelector("[data-rdtitle]"), p=document.querySelector("[data-rdprompt]"); if(t) t.value=""; if(p) p.value="";
  }catch(e){ console.error("rd",e); toast("Couldn't send that: "+(e&&e.message?e.message:"try again")); }
  RD.busy=false; render(); }
async function rdDownload(r,i){ const f=((r.results||{}).files||[])[i]; if(!f) return; const ext=/^https:\/\/charleston3d\.pages\.dev\//.test(String(f.url||"")); try{ const id=f.assetId||(String(f.url||"").match(/[0-9a-f]{32}/)||[])[0]; const res=await fetch(f.url||("/_blob/"+id)); if(!res.ok) throw new Error("HTTP "+res.status); let blob=await res.blob();
    if(f.encoding==="base64"){ const s=atob((await blob.text()).trim()); const u8=new Uint8Array(s.length); for(let k=0;k<s.length;k++) u8[k]=s.charCodeAt(k); blob=new Blob([u8],{type:"application/octet-stream"}); }
    if(downloads){ await downloads.save({filename:f.name||"model.3mf",data:blob}); } else { const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=f.name||"model"; a.click(); } }catch(e){ if(ext){ window.open(f.url,"_blank","noopener"); return; } toast("Couldn't download that file."); } }
async function rdAdd(r){ const res=r.results||{}; const now=new Date().toISOString();
  try{ const ref=await db.collection("printideas").add({title:r.title||"Meshy design",concept:r.prompt||"",kind:"meshy",path:"meshy",status:"review",legal:"pending",by:"aaron",at:now,round:now.slice(0,10),source:"3D Redesign Studio (Meshy)",previewUrl:(res.previews||[])[0]||"",renders:res.previews||[],files:(res.files||[]).map(f=>({name:f.name,assetId:f.assetId,url:f.url,encoding:f.encoding||null,kind:f.kind||(/\.3mf$/i.test(f.name||"")?"3mf":"stl")})),printSpecs:res.printSpecs||null,meshy:{credits:res.credits,taskIds:res.taskIds||[]},tags:["meshy"]});
    await db.doc("redesign/"+r.id).update({status:"added",printidea:ref.id,addedAt:now}); toast("Added to your 3D designs."); }catch(e){ toast("Couldn't add it. Try again."); } }
function bindRedesign(){ if(window.RD_BOUND) return; window.RD_BOUND=true;
  document.addEventListener("click",async e=>{ const t=e.target.closest&&e.target.closest("[data-rdmode],[data-rdrm],[data-rdgo],[data-rdf],[data-rddl],[data-rdadd],[data-rdcancel],[data-rdretry],[data-rdagain],[data-rddrop]"); if(!t) return;
    if(t.dataset.rdmode){ RD.mode=t.dataset.rdmode; render(); return; }
    if(t.dataset.rdrm!=null){ RD.files.splice(+t.dataset.rdrm,1); RD.prev={}; RD.files.forEach((f,i)=>{ if(rdKind(f)==="image") RD.prev[i]=URL.createObjectURL(f); }); render(); rdPreviewModels(); return; }
    if(t.hasAttribute("data-rddrop")){ const i=t.querySelector("[data-rdfile]"); if(i&&e.target!==i) i.click(); return; }
    if(t.hasAttribute("data-rdgo")){ rdGo(); return; }
    if(t.dataset.rdf){ RD.f=t.dataset.rdf; render(); return; }
    const id=t.dataset.rddl||t.dataset.rdadd||t.dataset.rdcancel||t.dataset.rdretry||t.dataset.rdagain; const r=RD.rows.find(x=>x.id===id); if(!r) return;
    if(t.dataset.rddl){ rdDownload(r,+t.dataset.i); return; }
    if(!(typeof qpCan==="function"&&qpCan())){ toast("Only Aaron, signed in with his PIN, can do that."); return; }
    if(t.dataset.rdadd){ rdAdd(r); return; }
    if(t.dataset.rdcancel){ await db.doc("redesign/"+id).update({status:"cancelled"}); return; }
    if(t.dataset.rdretry){ await db.doc("redesign/"+id).update({status:"queued",error:null}); try{ if(RD_TRIGGER) await fireNow(RD_TRIGGER,`3D Redesign Studio job re-queued: redesign/${id}.`); }catch(x){} toast("Queued again."); return; }
    if(t.dataset.rdagain){ const vals=await hqDialog({title:"Try again with a change",body:"What should be different this time? This uses Meshy credits.",fields:[{label:"Change",multi:true,placeholder:"e.g. thicker base, bigger name banner, less detail on the leaves"}],ok:"Send to Meshy"}); const what=vals&&vals[0]; if(!what||!what.trim()) return; const now=new Date().toISOString();
      const ref=await db.collection("redesign").add({mode:r.mode,title:r.title,prompt:(r.prompt?r.prompt+"\n\nChange: ":"")+String(what).slice(0,800),inputs:r.inputs||[],parent:r.id,status:"queued",at:now,by:"aaron"});
      try{ if(RD_TRIGGER) await fireNow(RD_TRIGGER,`3D Redesign Studio job queued: redesign/${ref.id}.`); }catch(x){} toast("Sent with your change."); } });
  document.addEventListener("change",async e=>{ if(e.target.matches&&e.target.matches("[data-rdfile]")){ rdSet(e.target.files); e.target.value=""; } if(e.target.matches&&e.target.matches("[data-rdcap]")){ if(!(typeof qpCan==="function"&&qpCan())) return; try{ await db.doc("rdsettings/meshy").set({jobsPerDay:+e.target.value,by:"aaron",at:new Date().toISOString()}); toast("Meshy limit saved: "+e.target.value+" a day."); }catch(x){ toast("Couldn't save that."); } } });
  document.addEventListener("input",e=>{ if(e.target.matches&&e.target.matches("[data-rdtitle]")) RD.title=e.target.value; if(e.target.matches&&e.target.matches("[data-rdprompt]")) RD.prompt=e.target.value; });
  document.addEventListener("keydown",e=>{ if((e.key==="Enter"||e.key===" ")&&e.target.matches&&e.target.matches("[data-rddrop]")){ e.preventDefault(); const i=e.target.querySelector("[data-rdfile]"); if(i) i.click(); } });
  ["dragenter","dragover"].forEach(ev=>document.addEventListener(ev,e=>{ const d=e.target.closest&&e.target.closest("[data-rddrop]"); if(d){ e.preventDefault(); d.classList.add("over"); } }));
  document.addEventListener("dragleave",e=>{ const d=e.target.closest&&e.target.closest("[data-rddrop]"); if(d) d.classList.remove("over"); });
  document.addEventListener("drop",e=>{ const d=e.target.closest&&e.target.closest("[data-rddrop]"); if(d){ e.preventDefault(); d.classList.remove("over"); rdSet(e.dataTransfer.files); } }); }

/* ---------- data ---------- */
function refreshTriggers(){ if(mcp) mcp.invalidate("Claude Code Remote","list_triggers").catch(()=>{}); }
function watchTriggers(){
  if(!mcp) { S.trigState="off"; return; }
  mcp.watchTool("Claude Code Remote","list_triggers",{limit:100}, ev=>{
    if(ev.type==="data"){ let p=ev.result.payload; if(typeof p==="string"){ try{p=JSON.parse(p)}catch{p=null} }
      let arr = p && (p.data||p.triggers) || []; let cur = p && p.next_cursor; const seen=new Set();
      (async()=>{ while(cur && !seen.has(cur) && seen.size<10){ seen.add(cur);
          try{ const r=await mcp.callTool("Claude Code Remote","list_triggers",{limit:100,cursor:cur}); let q=r&&r.payload; if(typeof q==="string"){ try{q=JSON.parse(q)}catch{q=null} }
            arr=arr.concat(q&&(q.data||q.triggers)||[]); cur=q&&q.next_cursor; }catch{ break; } }
        S.triggers=Object.fromEntries(arr.map(t=>[t.id,t])); S.trigState="on"; render(); })(); }
    else { const c=ev.error&&ev.error.code; if(["needs_reauth","server_not_connected","not_in_manifest","blocked_by_policy","not_granted","capability_disabled"].includes(c)){ S.triggers={}; S.trigState="off"; render(); } }
  }, {refetchInterval:120000});
}
