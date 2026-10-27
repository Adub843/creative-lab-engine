/* ================= SCHEDULES: full control of the team's scheduled tasks ================= */
const TZ_DEF="America/New_York";
const DOW_N=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SCH={filter:"all", q:"", edit:null, busy:{}, newOpen:false, err:null};
/* --- cron <-> plain English. Supports: [CRON_TZ=zone] MIN HOURS * * DOWS --- */
function expandField(f,lo,hi){ if(f==="*") return null; const out=new Set();
  for(const part of String(f).split(",")){ const m=part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/); if(!m) return undefined;
    let a=m[1]==="*"?lo:+m[1], b=m[2]!=null?+m[2]:(m[1]==="*"||m[3]?hi:a); const st=m[3]?+m[3]:1; if(a<lo||b>hi||a>b||st<1) return undefined;
    for(let x=a;x<=b;x+=st) out.add(x===7&&hi===7?0:x); }
  return [...out].sort((x,y)=>x-y); }
function parseCron(expr){ const raw=String(expr||"").trim(); if(!raw) return {ok:false,raw};
  let tz="UTC", rest=raw; const m=raw.match(/^CRON_TZ=(\S+)\s+(.*)$/); if(m){ tz=m[1]; rest=m[2]; }
  const p=rest.split(/\s+/); if(p.length!==5) return {ok:false,raw,tz};
  const [mi,ho,dom,mon,dw]=p; const mins=expandField(mi,0,59), hours=expandField(ho,0,23), dowsR=expandField(dw,0,7), dows=dowsR?[...new Set(dowsR)].sort((a,b)=>a-b):dowsR;
  const simple = dom==="*"&&mon==="*"&&mins&&mins.length===1&&hours!==undefined&&dows!==undefined;
  if(!simple) return {ok:false,raw,tz};
  const step=ho.match(/^\*\/(\d+)$/); const everyH= step?+step[1]:(ho==="*"?1:null);
  return {ok:true,raw,tz,min:mins[0],hours:hours||[...Array(24).keys()],everyH,dows:dows||[0,1,2,3,4,5,6]}; }
function fmtTime(h,m){ const ap=h<12?"AM":"PM"; const hh=h%12||12; return `${hh}:${String(m).padStart(2,"0")} ${ap}`; }
function dowText(d){ const s=[...d].sort().join(","); if(d.length===7) return "Every day"; if(s==="1,2,3,4,5") return "Weekdays"; if(s==="0,6") return "Weekends"; return d.map(x=>DOW_N[x]).join(", "); }
function cronText(expr){ const c=parseCron(expr); if(!c.ok) return expr?("Custom: "+expr):"No schedule (runs only when started)";
  const tzn=c.tz===TZ_DEF?"":` (${c.tz==="UTC"?"UTC":c.tz.split("/").pop().replace(/_/g," ")} time)`;
  if(c.everyH) return `${dowText(c.dows)}, every ${c.everyH===1?"hour":c.everyH+" hours"} at :${String(c.min).padStart(2,"0")}${tzn}`;
  return `${dowText(c.dows)} at ${c.hours.map(h=>fmtTime(h,c.min)).join(" and ")}${tzn}`; }
function buildCron({min,hours,everyH,dows,tz}){ min=Math.max(0,Math.min(59,+min|0));
  const hf = everyH? (everyH===1?"*":`*/${everyH}`) : [...new Set(hours)].sort((a,b)=>a-b).join(",");
  const df = dows.length===7?"*":[...new Set(dows)].sort().join(",");
  return `CRON_TZ=${tz||TZ_DEF} ${min} ${hf} * * ${df}`; }
/* "7:05 AM, 9:05 PM" -> [{h,m}] or error */
function parseTimes(txt){ const out=[]; for(const raw of String(txt).split(/[,;]+|\band\b/i).map(s=>s.trim()).filter(Boolean)){
    const m=raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i); if(!m) return {err:`"${raw}" isn't a time like 7:05 AM`};
    let h=+m[1], mi=m[2]!=null?+m[2]:0; const ap=(m[3]||"").toLowerCase(); if(mi>59||h>23||(ap&&(h<1||h>12))) return {err:`"${raw}" isn't a real time`};
    if(ap.startsWith("p")&&h<12) h+=12; if(ap.startsWith("a")&&h===12) h=0; out.push({h,m:mi}); }
  if(!out.length) return {err:"Add at least one time"}; return {times:out}; }
/* --- data helpers --- */
function trigList(){ const rank=t=>t.enabled?(trigProblem(t)?0:1):2; return Object.values(S.triggers||{}).filter(t=>!(t.enabled===false&&(t.run_once_at||t.ended_reason||t.persistent_session_id))).sort((a,b)=>rank(a)-rank(b)||String(a.name).localeCompare(String(b.name))); }
function trigProblem(t){ if(!t||!t.enabled) return t&&t.suspension_reason?"Paused by Claude: "+t.suspension_reason.replace(/_/g," "):"";
  const r=t.last_run; if(r&&/FAIL|ERROR|TIMEOUT|CANCEL/.test(r.status||"")) return "Last run failed"+(r.failure_reason&&!/UNSPECIFIED/.test(r.failure_reason)?": "+r.failure_reason.replace(/ROUTINE_RUN_FAILURE_REASON_|_/g," ").trim().toLowerCase():"");
  if(t.next_run_at&&Date.now()-new Date(t.next_run_at).getTime()>45*60e3) return "Missed its last scheduled run";
  return ""; }
function trigRunState(t){ const r=t&&t.last_run; if(!r) return {txt:"Never ran",cls:""}; const s=r.status||"";
  if(/SUCC/.test(s)) return {txt:"OK · "+ago(r.finished_at||r.fired_at),cls:"ok"}; if(/PEND|RUNN/.test(s)) return {txt:"Running now",cls:"acc"};
  return {txt:"Failed · "+ago(r.fired_at),cls:"bad"}; }
function canEditSched(){ return IS_OWNER && CUR==="Aaron"; }
function trigCall(tool,args){ if(!mcp) return Promise.reject({code:"no_mcp"}); return mcp.callTool("Claude Code Remote",tool,args); }
function trigErrText(e,what){ const c=e&&e.code; return ({no_mcp:"This view can't reach the scheduler. Open the console on claude.ai.",server_not_connected:"Connect Claude Code Remote in Settings → Connectors.",needs_reauth:"Reconnect Claude Code Remote in Settings → Connectors.",not_in_manifest:"Scheduler controls are switched off for this page.",not_granted:"Allow the console to use Claude Code Remote, then try again.",approval_required:"That needs your OK. Try again and allow it.",blocked_by_policy:"Your organization blocks this action.",server_unavailable:"The scheduler didn't answer. Check the list in a minute before trying again.",upstream_error:"The scheduler didn't confirm. Check the list in a minute before trying again."}[c]) || `Couldn't ${what}. ${e&&e.message?String(e.message).slice(0,140):"Try again."}`; }
function payloadOf(r){ let p=r&&r.payload; if(typeof p==="string"){ try{p=JSON.parse(p)}catch{} } return p; }
async function schedLog(t,change,before,after){ if(!db) return; try{ await db.collection("schedlog").add({at:new Date().toISOString(),by:CUR||"",trigger:t.id,name:t.name||"",change,before:before==null?null:String(before).slice(0,120000),after:after==null?null:String(after).slice(0,120000)}); }catch(e){ console.warn("schedlog",e); } }
async function trigUpdate(t,patch,label){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can change schedules."); return false; }
  if(SCH.busy[t.id]){ toast("Still saving the last change…"); return false; }
  SCH.busy[t.id]=label; render();
  try{ const res=await trigCall("update_trigger",{trigger_id:t.id,...patch}); const p=payloadOf(res);
    if(p&&p.status==="needs_device_approval"){ toast("This task runs on your computer, so its instructions must be approved in the desktop app. Nothing changed."); return false; }
    const key=Object.keys(patch)[0]; await schedLog(t,label,key==="prompt"?(t.derived_state||{}).prompt:t[key==="cron_expression"?"cron_expression":key],patch[key]);
    const nt=p&&p.trigger; const merged={...t,...patch,...(nt&&nt.id?nt:{})}; if("prompt" in patch) merged.derived_state={...(t.derived_state||{}),...((nt&&nt.derived_state)||{}),prompt:patch.prompt}; S.triggers[t.id]=merged; toast(label+": saved."); refreshTriggers(); return true; }
  catch(e){ console.error("update_trigger",e); toast(trigErrText(e,"save that")); return false; }
  finally{ delete SCH.busy[t.id]; render(); } }
async function trigToggle(id){ const t=S.triggers[id]; if(!t) return; await trigUpdate(t,{enabled:!t.enabled}, t.enabled?"Paused":"Turned on"); }
async function trigRun(id,btn){ const t=S.triggers[id]; if(!t) return; if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can start runs."); return; }
  if(btn) btn.disabled=true; const ok=await fireNow(id); if(btn) btn.disabled=false; if(ok){ toast(`${t.name.split(" ·")[0]} started. Results show here when it finishes.`); schedLog(t,"Run now",null,null); } }
async function trigDelete(id){ const t=S.triggers[id]; if(!t||!canEditSched()||SCH.busy[id]) return;
  const box=$("#schDelName"); if(!box||box.value.trim().toLowerCase()!==String(t.name.split(" ·")[0]).trim().toLowerCase()){ toast("Type the task's first name exactly to confirm."); return; }
  SCH.busy[id]="Deleting"; render();
  try{ await trigCall("delete_trigger",{trigger_id:id}); await schedLog(t,"Deleted",JSON.stringify({name:t.name,cron:t.cron_expression,enabled:t.enabled,prompt:(t.derived_state||{}).prompt||""}),null);
    delete S.triggers[id]; schClose(); toast("Deleted. A backup of its instructions is in the change log."); refreshTriggers(); }
  catch(e){ toast(trigErrText(e,"delete it")); } finally{ delete SCH.busy[id]; render(); } }
/* --- views --- */
function schedHealth(){ const all=trigList(); const on=all.filter(t=>t.enabled), prob=all.filter(t=>trigProblem(t)&&t.enabled);
  const running=all.filter(t=>/PEND|RUNN/.test((t.last_run||{}).status||""));
  return `<div class="kpi4 schk">
    <button class="kpi" data-schf="on"><b>${on.length}</b><span>running on a schedule</span></button>
    <button class="kpi" data-schf="off"><b>${all.length-on.length}</b><span>paused</span></button>
    <button class="kpi ${prob.length?"bad":""}" data-schf="problems"><b>${prob.length}</b><span>need attention</span></button>
    <button class="kpi" data-schf="running"><b>${running.length}</b><span>working right now</span></button></div>`; }
function vSchedules(){
  if(S.trigState==="off") return `<section class="card"><div class="card-head"><h2 class="big">Schedules</h2></div><p>The console can't reach the scheduler from here. Open it on claude.ai with the Claude Code Remote connector on (Settings → Connectors), then come back.</p></section>`;
  if(S.trigState!=="on") return `<section class="card"><div class="card-head"><h2 class="big">Schedules</h2></div><p class="muted">Loading the team's schedules…</p></section>`;
  const q=SCH.q.trim().toLowerCase(); const f=SCH.filter;
  const rows=trigList().filter(t=>(f==="all"||(f==="on"&&t.enabled)||(f==="off"&&!t.enabled)||(f==="problems"&&t.enabled&&trigProblem(t))||(f==="running"&&/PEND|RUNN/.test((t.last_run||{}).status||"")))
    &&(!q||(t.name+" "+cronText(t.cron_expression)).toLowerCase().includes(q)));
  const chip=(k,l)=>`<button class="chip" data-schf="${k}" aria-pressed="${f===k}">${l}</button>`;
  const ed=canEditSched();
  return `<section class="card"><div class="card-head"><h2 class="big">Schedules</h2><span class="eyebrow">every automatic job the team runs</span>${ed?`<button class="btn primary" id="schNew">+ New scheduled task</button>`:""}</div>
    ${schedHealth()}
    <div class="schbar">${chip("all","All")}${chip("on","On")}${chip("off","Paused")}${chip("problems","Needs attention")}${chip("running","Working now")}
      <input type="search" id="schQ" placeholder="Search tasks" value="${esc(SCH.q)}" aria-label="Search scheduled tasks"></div>
    ${ed?"":`<p class="small muted">You can see every schedule. Only Aaron, signed in with his PIN, can change them.</p>`}
    <div class="schlist">${rows.length?rows.map(schRow).join(""):`<p class="muted">No tasks match.</p>`}</div>
  </section>${schLogCard()}`; }
function schRow(t){ const p=trigProblem(t), r=trigRunState(t), b=SCH.busy[t.id]; const [who,what]=String(t.name).split(" · ");
  return `<div class="schrow ${t.enabled?"":"off"}" data-id="${esc(t.id)}">
    <div class="schmain"><div class="schname"><b>${esc(who)}</b>${what?` <span class="muted">· ${esc(what)}</span>`:""}</div>
      <div class="small">${esc(cronText(t.cron_expression))}</div>
      <div class="small schmeta"><span class="pill ${t.enabled?"ok":""}">${t.enabled?"On":"Paused"}</span><span class="pill ${r.cls}">Last run: ${esc(r.txt)}</span>${t.enabled&&t.next_run_at?`<span class="muted">Next: ${esc(when(t.next_run_at))}</span>`:""}${p&&t.enabled?`<span class="pill bad">${esc(p)}</span>`:""}</div></div>
    <div class="schact">${b?`<span class="muted small">${esc(b)}…</span>`:`
      <button class="btn" data-schrun="${esc(t.id)}" ${canEditSched()?"":"disabled"}>Run now</button>
      ${canEditSched()?`<button class="btn" data-schtog="${esc(t.id)}">${t.enabled?"Pause":"Turn on"}</button><button class="btn" data-schedit="${esc(t.id)}">Edit</button>`:`<button class="btn" data-schedit="${esc(t.id)}">Details</button>`}`}</div></div>`; }
function schLogCard(){ const L=(S.schedlog||[]).slice(0,12); if(!L.length) return "";
  return `<details class="card fold"><summary><h2>Change log</h2><span class="eyebrow">last ${L.length} changes · undo from here</span></summary><div class="list">${L.map(l=>`<div class="row"><div style="flex:1;min-width:0"><b>${esc(l.change)}</b> · ${esc((l.name||"").split(" ·")[0])}<div class="small muted">${esc(ago(l.at))} by ${esc(l.by||"?")}${l.after&&l.change.startsWith("Schedule")?` · now ${esc(cronText(l.after))}`:""}</div></div>${canEditSched()&&l.before!=null&&/^(Schedule|Renamed|Instructions)/.test(l.change)&&S.triggers[l.trigger]?`<button class="btn" data-schundo="${esc(l.id)}">Undo</button>`:""}</div>`).join("")}</div></details>`; }
async function schUndo(id){ const l=(S.schedlog||[]).find(x=>x.id===id); const t=l&&S.triggers[l.trigger]; if(!t) return;
  const key=l.change.startsWith("Schedule")?"cron_expression":l.change.startsWith("Renamed")?"name":"prompt"; await trigUpdate(t,{[key]:l.before},"Undo: "+l.change); }
/* --- edit / new sheet (lives outside #main so renders don't wipe typing) --- */
function schOpen(id){ SCH.opener=document.activeElement; SCH.edit=id; SCH.err=null; paintSchSheet(true); }
function schClose(){ SCH.edit=null; SCH.newOpen=false; const x=$("#schSheet"); if(x) x.remove(); const o=SCH.opener; SCH.opener=null; if(o&&o.isConnected&&o.focus) try{o.focus({preventScroll:true})}catch{} }
/* every side sheet: Escape closes the top one, Tab stays inside it */
document.addEventListener("keydown",e=>{ if(document.querySelector(".cmdk")) return; const sheets=[...document.querySelectorAll(".xsheet")]; const sh=sheets[sheets.length-1]; if(!sh) return;
  if(e.key==="Escape"){ e.preventDefault(); if(sh.id==="schSheet") schClose(); else { const x=sh.querySelector("[data-x]"); if(x) x.click(); else sh.remove(); } return; }
  if(e.key==="Tab"){ const f=[...sh.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x=>x.offsetParent!==null); if(!f.length) return;
    const a=document.activeElement; if(!sh.contains(a)){ e.preventDefault(); f[0].focus(); } else if(e.shiftKey&&a===f[0]){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey&&a===f[f.length-1]){ e.preventDefault(); f[0].focus(); } } });
function schedEditorHTML(c,prefix){ const cr=c&&c.ok?c:{min:5,hours:[9],everyH:null,dows:[0,1,2,3,4,5,6],tz:TZ_DEF};
  const tz=cr.tz||TZ_DEF, tzLbl=tz===TZ_DEF?"Charleston time":(tz==="UTC"?"UTC time — this task's clock":tz.split("/").pop().replace(/_/g," ")+" time");
  const ev=[1,2,3,4,6,8,12]; if(cr.everyH&&!ev.includes(cr.everyH)) ev.push(cr.everyH); ev.sort((a,b)=>a-b);
  return `<fieldset class="schfs" data-tz="${esc(tz)}"><legend>When it runs</legend>
    <div class="seg" role="group"><button type="button" data-mode="times" aria-pressed="${!cr.everyH}">At set times</button><button type="button" data-mode="every" aria-pressed="${!!cr.everyH}">Every few hours</button></div>
    <div class="days">${DOW_N.map((d,i)=>`<label><input type="checkbox" name="${prefix}dow" value="${i}" ${cr.dows.includes(i)?"checked":""}>${d}</label>`).join("")}</div>
    <label class="fld" data-show="times" ${cr.everyH?"hidden":""}>Times (${esc(tzLbl)}) <input id="${prefix}Times" value="${esc(cr.everyH?"":cr.hours.map(h=>fmtTime(h,cr.min)).join(", "))}" placeholder="7:05 AM, 9:05 PM"></label>
    <div class="fld" data-show="every" ${cr.everyH?"":"hidden"}>Every <select id="${prefix}Every">${ev.map(n=>`<option value="${n}" ${cr.everyH===n?"selected":""}>${n===1?"hour":n+" hours"}</option>`).join("")}</select> at <input id="${prefix}Min" type="number" min="0" max="59" value="${cr.min}" style="width:5em"> minutes past</div>
    ${tz!==TZ_DEF?`<p class="small muted">This task keeps its own clock (${esc(tz)}), so times here are in that zone.</p>`:""}<p class="small muted" id="${prefix}Preview"></p></fieldset>`; }
function readSchedEditor(root,prefix){ const fs=root.querySelector(".schfs"); const tz=(fs&&fs.dataset.tz)||TZ_DEF; const mode=root.querySelector('[data-mode][aria-pressed="true"]').dataset.mode;
  const dows=[...root.querySelectorAll(`input[name="${prefix}dow"]:checked`)].map(x=>+x.value); if(!dows.length) return {err:"Pick at least one day."};
  if(mode==="every"){ const n=+root.querySelector("#"+prefix+"Every").value, m=+root.querySelector("#"+prefix+"Min").value; if(!(m>=0&&m<=59)) return {err:"Minutes past the hour must be 0–59."}; return {cron:buildCron({min:m,everyH:n,dows,tz})}; }
  const r=parseTimes(root.querySelector("#"+prefix+"Times").value); if(r.err) return r; const mins=[...new Set(r.times.map(t=>t.m))];
  if(mins.length>1) return {err:"All times in one task need the same minutes (like 7:05 and 9:05). Use two tasks for different minutes."};
  return {cron:buildCron({min:mins[0],hours:r.times.map(t=>t.h),dows,tz})}; }
function wireSchedEditor(root,prefix){ const pv=()=>{ const r=readSchedEditor(root,prefix); const el=root.querySelector("#"+prefix+"Preview"); if(el){ el.textContent=r.err?r.err:"Runs: "+cronText(r.cron); el.classList.toggle("bad",!!r.err); } };
  root.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ root.querySelectorAll("[data-mode]").forEach(x=>x.setAttribute("aria-pressed",x===b?"true":"false")); root.querySelectorAll("[data-show]").forEach(x=>x.hidden=x.dataset.show!==b.dataset.mode); pv(); });
  root.querySelectorAll("input,select").forEach(i=>i.addEventListener("input",pv)); pv(); }
function paintSchSheet(first){ const t=S.triggers[SCH.edit]; if(!t&&!SCH.newOpen){ schClose(); return; }
  let box=$("#schSheet"); if(box&&!first) return; const dirty=sheetDirty(box); const keepOpen=box?[...box.querySelectorAll("details")].map(d=>d.open):[]; const keepScroll=box?(box.querySelector(".xpanel")||{}).scrollTop||0:0; if(box) box.remove();
  box=document.createElement("div"); box.id="schSheet"; box.className="xsheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true");
  const ed=canEditSched();
  if(SCH.newOpen){ box.innerHTML=`<div class="xpanel"><div class="xhead"><h2>New scheduled task</h2><button class="btn" data-x>Close</button></div>
      <label class="fld">Name <input id="nwName" maxlength="80" placeholder="e.g. Nora · Weekend market check"></label>
      ${schedEditorHTML(null,"nw")}
      <label class="fld">What should it do? <textarea id="nwWhat" rows="8" placeholder="Plain English. Example: Every Saturday morning, check Charleston craft markets for next month's openings and add them to the Research page."></textarea></label>
      <label class="fld"><input type="checkbox" id="nwTeam" checked> Give it the team's standard rules (security, money, one voice to Aaron, dashboard links)</label>
      <p class="small muted">The console's builder creates the task with the same connections the team uses, then it shows up in the list (about a minute).</p>
      <div class="row"><button class="btn primary" id="nwGo">Create task</button><span class="small bad" id="nwErr"></span></div></div>`;
    document.body.appendChild(box); wireSchedEditor(box,"nw");
    box.querySelector("#nwGo").onclick=()=>schCreate(box); }
  else { const prompt=(t.derived_state||{}).prompt||""; const c=parseCron(t.cron_expression); const rs=researchFor(t);
    box.innerHTML=`<div class="xpanel"><div class="xhead"><h2>${esc(t.name)}</h2><button class="btn" data-x>Close</button></div>
      <div class="small schmeta"><span class="pill ${t.enabled?"ok":""}">${t.enabled?"On":"Paused"}</span><span class="pill ${trigRunState(t).cls}">Last run: ${esc(trigRunState(t).txt)}</span>${t.next_run_at&&t.enabled?`<span>Next: ${esc(when(t.next_run_at))}</span>`:""}</div>
      ${trigProblem(t)?`<p class="alertbar">${esc(trigProblem(t))}. Try Run now; if it fails again, ask Stephanie to check it.</p>`:""}
      ${ed?`<label class="fld">Name <input id="edName" value="${esc(t.name)}" maxlength="80"></label><div class="row"><button class="btn" id="edNameSave">Save name</button></div>`:""}
      ${ed?schedEditorHTML(c,"ed")+`${c.ok?"":`<p class="small muted">Current schedule is custom (${esc(t.cron_expression||"none")}). Saving here replaces it.</p>`}<div class="row"><button class="btn primary" id="edSchedSave">Save schedule</button></div>`:`<p><b>Schedule:</b> ${esc(cronText(t.cron_expression))}</p>`}
      <h3 style="margin-top:18px">Research & search settings</h3>${researchCardsHTML(t,rs,ed)}
      <details class="fold" style="margin-top:14px"><summary><b>Full instructions</b> <span class="small muted">(${prompt.length.toLocaleString()} characters)</span></summary>
        ${ed?`<textarea id="edPrompt" rows="16" spellcheck="false">${esc(prompt)}</textarea><div class="row"><button class="btn" id="edPromptSave">Save instructions</button><span class="small muted">The old version is kept in the change log.</span></div>`:`<pre class="pre">${esc(prompt)}</pre>`}</details>
      ${ed?`<details class="fold danger" style="margin-top:14px"><summary><b>Delete this task</b></summary><p class="small">This removes the task and its run history. Its instructions are saved in the change log first. Type <b>${esc(t.name.split(" ·")[0])}</b> to confirm.</p><input id="schDelName" autocomplete="off"><div class="row"><button class="btn bad" id="schDel">Delete task</button></div></details>`:""}
    </div>`;
    document.body.appendChild(box);
    if(ed){ wireSchedEditor(box,"ed");
      box.querySelector("#edSchedSave").onclick=async()=>{ const r=readSchedEditor(box,"ed"); if(r.err){ toast(r.err); return; } if(r.cron===t.cron_expression){ toast("That's already the schedule."); return; } if(await trigUpdate(t,{cron_expression:r.cron},"Schedule changed")) paintSchSheet(true); };
      box.querySelector("#edNameSave").onclick=async()=>{ const v=box.querySelector("#edName").value.trim(); if(!v){ toast("Name can't be empty."); return; } if(v!==t.name&&await trigUpdate(t,{name:v},"Renamed")) paintSchSheet(true); };
      box.querySelector("#edPromptSave").onclick=async()=>{ const v=box.querySelector("#edPrompt").value; if(v.trim().length<40){ toast("Instructions look empty. Not saved."); return; } if(v===prompt){ toast("No changes."); return; } if(await trigUpdate(t,{prompt:v},"Instructions edited")) paintSchSheet(true); };
      box.querySelector("#schDel").onclick=()=>trigDelete(t.id); wireResearchCards(box,t); } }
  sheetRestore(box,dirty);
  if(keepOpen.length){ box.querySelectorAll("details").forEach((d,i)=>{ if(keepOpen[i]) d.open=true; }); const xp=box.querySelector(".xpanel"); if(xp) xp.scrollTop=keepScroll; }
  box.querySelectorAll("[data-x]").forEach(b=>b.onclick=schClose); box.onclick=e=>{ if(e.target===box) schClose(); }; const f=box.querySelector("input,textarea,button"); if(f&&first&&!keepOpen.length) setTimeout(()=>f.focus({preventScroll:true}),30);
  else { const xp=box.querySelector(".xpanel"); if(xp){ xp.tabIndex=-1; if(!box.contains(document.activeElement)||document.activeElement===document.body) setTimeout(()=>xp.focus({preventScroll:true}),30); } } }
/* carry over fields the user changed but hasn't saved, when the sheet redraws (only if the saved value underneath didn't change) */
function sheetFieldKey(el){ const c=el.closest("[data-rid]"); if(el.dataset.rf) return (c?c.dataset.rid:"")+"|"+el.dataset.rf; if(el.hasAttribute("data-rladd")) return (c?c.dataset.rid:"")+"|add"; return el.id?"#"+el.id:null; }
function sheetDirty(box){ const out={}; if(!box) return out; box.querySelectorAll("input:not([type=checkbox]):not([type=number]),textarea").forEach(el=>{ const k=sheetFieldKey(el); if(k&&el.value!==el.defaultValue) out[k]={v:el.value,d:el.defaultValue}; }); return out; }
function sheetRestore(box,dirty){ box.querySelectorAll("input:not([type=checkbox]):not([type=number]),textarea").forEach(el=>{ const k=sheetFieldKey(el), o=k&&dirty[k]; if(o&&el.defaultValue===o.d){ el.value=o.v; el.dispatchEvent(new Event("input")); } }); }
/* --- new task: the console's builder (a scheduled task with no schedule) creates it --- */
async function schCreate(box){ const err=box.querySelector("#nwErr"); err.textContent="";
  if(!canEditSched()){ err.textContent="Only Aaron, signed in with his PIN, can create tasks."; return; }
  const name=box.querySelector("#nwName").value.trim(), what=box.querySelector("#nwWhat").value.trim(), team=box.querySelector("#nwTeam").checked; const r=readSchedEditor(box,"nw");
  if(!name){ err.textContent="Give it a name."; return; } if(r.err){ err.textContent=r.err; return; } if(what.length<20){ err.textContent="Describe what it should do (a sentence or two)."; return; }
  if(trigList().some(t=>t.name.toLowerCase()===name.toLowerCase())){ err.textContent="A task with that name already exists."; return; }
  const b=(S.platformCfg||{}).builderTrigger; if(!b||!S.triggers[b]){ err.textContent="The builder isn't set up yet. Ask Stephanie to add it."; return; }
  if(!db){ err.textContent="Can't save from this view."; return; }
  const go=box.querySelector("#nwGo"); go.disabled=true;
  try{ const ref=await db.collection("taskrequests").add({name,cron:r.cron,what,team,status:"open",by:CUR,at:new Date().toISOString()});
    const ok=await fireNow(b,`NEW TASK REQUEST taskrequests/${ref.id} from Aaron via the console. Read that doc and build it exactly as your instructions say.`);
    if(ok){ toast("Building it now. It appears in the list in a minute or two."); schClose(); } else { go.disabled=false; err.textContent="Saved the request, but couldn't start the builder. It will be picked up on retry."; } }
  catch(e){ go.disabled=false; err.textContent="Couldn't save the request. Try again."; } }
function bindSchedules(){
  document.querySelectorAll("[data-schf]").forEach(b=>b.onclick=()=>{ SCH.filter=b.dataset.schf; render(); });
  const q=$("#schQ"); if(q) q.oninput=()=>{ SCH.q=q.value; render(); };
  document.querySelectorAll("[data-schrun]").forEach(b=>b.onclick=()=>trigRun(b.dataset.schrun,b));
  document.querySelectorAll("[data-schtog]").forEach(b=>b.onclick=()=>trigToggle(b.dataset.schtog));
  document.querySelectorAll("[data-schedit]").forEach(b=>b.onclick=()=>schOpen(b.dataset.schedit));
  document.querySelectorAll("[data-schundo]").forEach(b=>b.onclick=()=>schUndo(b.dataset.schundo));
  const n=$("#schNew"); if(n) n.onclick=()=>{ SCH.newOpen=true; SCH.edit=null; paintSchSheet(true); }; }
/* ================= RESEARCH SETTINGS: editable search/crawl jobs each task reads every run ================= */
function agentKeyOf(t){ return String((t&&t.name)||"").split(" ·")[0].trim().toLowerCase(); }
function agentSlug(t){ return agentKeyOf(t).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"task"; }
const RBUSY=new Set(), RQ={};
function researchFor(t){ return (S.research||[]).filter(r=>!r.removed).filter(r=>r.trigger===t.id||(!r.trigger&&r.agent===agentKeyOf(t))).sort((a,b)=>String(a.label).localeCompare(String(b.label))); }
const listTxt=a=>(Array.isArray(a)?a:[]).join("\n");
const txtList=s=>String(s||"").split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,60);
function researchCardsHTML(t,rs,ed){
  const card=r=>{ const lr=r.lastRun||{};
    return `<div class="rcard ${r.enabled===false?"off":""}" data-rid="${esc(r.id)}">
      <div class="rhead"><b>${esc(r.label||r.id)}</b>${ed?`<label class="small"><input type="checkbox" data-ron ${r.enabled===false?"":"checked"}> On</label>`:`<span class="pill ${r.enabled===false?"":"ok"}">${r.enabled===false?"Off":"On"}</span>`}</div>
      <div class="small muted">Last done: ${lr.at?esc(ago(lr.at))+(lr.summary?" · "+esc(String(lr.summary).slice(0,160)):""):"not yet with these settings"}</div>
      ${ed?`<label class="fld">When (inside this task's runs) <input data-rf="when" value="${esc(r.when||"")}" placeholder="every run / Mondays / 7:05 AM run"></label>
      <div class="fld">Where to look <div class="rlinks">${(r.sources||[]).length?(r.sources||[]).map((u,i)=>`<span class="rlink">${safeUrl(u)?`<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/,"").slice(0,60))}</a>`:esc(String(u).slice(0,80))}<button type="button" data-rlrm="${i}" aria-label="Remove ${esc(u)}" title="Remove">✕</button></span>`).join(""):`<span class="small muted">No sites yet</span>`}</div>
        <div class="rladd"><input data-rladd placeholder="Add a link or site, e.g. https://www.etsy.com/market/shirts" aria-label="Add a research link"><button type="button" class="btn" data-rladdb>Add</button></div></div>
      <label class="fld">What to search for (one per line) <textarea data-rf="queries" rows="3">${esc(listTxt(r.queries))}</textarea></label>
      <label class="fld">How much <input data-rf="limits" value="${esc(r.limits||"")}" placeholder="e.g. top 30 results, 8 ideas a day"></label>
      <label class="fld">Extra notes for the agent <input data-rf="notes" value="${esc(r.notes||"")}" maxlength="400"></label>
      <div class="row"><button class="btn primary" data-rsave>Save</button>${(r.history||[]).length?`<button class="btn" data-rundo>Undo last change</button>`:""}<button class="btn" data-rrun>Save & run now</button><button class="btn ghost" data-rdel>Remove</button></div>`
      :`<div class="small"><b>When:</b> ${esc(r.when||"every run")}</div><div class="small"><b>Where:</b> ${esc((r.sources||[]).join(", ")||"—")}</div><div class="small"><b>Searches:</b> ${esc((r.queries||[]).join(", ")||"—")}</div>${r.limits?`<div class="small"><b>How much:</b> ${esc(r.limits)}</div>`:""}`}
    </div>`; };
  return `<div class="rcards">${rs.length?rs.map(card).join(""):`<p class="small muted">No search settings for this task yet.</p>`}</div>
    ${ed?`<details class="fold"><summary>+ Add a search job</summary><label class="fld">Name <input id="rnLabel" maxlength="60" placeholder="e.g. Etsy best sellers check"></label><label class="fld">Where to look (one per line) <textarea id="rnSources" rows="3"></textarea></label><label class="fld">What to search for (one per line) <textarea id="rnQueries" rows="2"></textarea></label><label class="fld">When <input id="rnWhen" placeholder="every run"></label><div class="row"><button class="btn primary" id="rnAdd">Add</button></div></details>`:""}`; }
const R_FIELDS=["when","sources","queries","limits","notes","enabled","label"];
/* patch may be a function(old) -> patch|{err}, so list edits apply to the latest saved data */
async function researchSave(t,id,patch,label,runAfter){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can change search settings."); return false; } if(!db) return false;
  const prev=RQ[id]||Promise.resolve(); let done; RQ[id]=new Promise(r=>done=r); await prev; try{ return await researchSaveNow(t,id,patch,label,runAfter); } finally{ done(); } }
async function researchSaveNow(t,id,patch,label,runAfter){
  const ref=db.doc("research/"+id); RBUSY.add(id);
  try{ const cur=await ref.get(); const old=cur.exists?cur.data():{}; if(typeof patch==="function"){ patch=patch(old); if(!patch||patch.err){ if(patch&&patch.err) toast(patch.err); return false; } } const snap={}; R_FIELDS.forEach(k=>{ if(k in old) snap[k]=old[k]; });
    const hist=[{at:new Date().toISOString(),by:CUR,snap},...(old.history||[])].slice(0,10);
    const nd={...old,...patch,history:hist,updatedAt:new Date().toISOString(),updatedBy:CUR}; await ref.set(nd);
    if(!S.research) S.research=[]; const ix=S.research.findIndex(x=>x.id===id); if(ix>=0) S.research[ix]={...S.research[ix],...nd}; else S.research.push({id,...nd});
    await schedLog(t,"Search settings: "+(patch.label||old.label||id),JSON.stringify(snap),JSON.stringify(patch));
    toast(label||"Saved. The next run uses it."); clearTimeout(RQ._paint); RQ._paint=setTimeout(()=>{ if(SCH.edit===t.id&&!RBUSY.size) paintSchSheet(true); },250);
    if(runAfter){ await fireNow(t.id,`Aaron changed your search settings (research/${id}) in the console. Run that search job now with the new settings, then finish normally.`); }
    return true; }
  catch(e){ console.error("research save",e); toast("Couldn't save the search settings. Try again."); return false; }
  finally{ RBUSY.delete(id); } }
async function researchUndo(t,id){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can change search settings."); return; } if(!db||RBUSY.has(id)) return;
  const ref=db.doc("research/"+id); RBUSY.add(id);
  try{ const cur=await ref.get(); const old=cur.exists?cur.data():null; const h=old&&(old.history||[])[0]; if(!h){ toast("Nothing to undo."); return; }
    const now={}; R_FIELDS.forEach(k=>{ if(k in old) now[k]=old[k]; });
    await ref.set({...old,...h.snap,history:(old.history||[]).slice(1),updatedAt:new Date().toISOString(),updatedBy:CUR});
    await schedLog(t,"Search settings undone: "+(old.label||id),JSON.stringify(now),JSON.stringify(h.snap));
    const i=(S.research||[]).findIndex(x=>x.id===id); if(i>=0) S.research[i]={...S.research[i],...h.snap,history:(old.history||[]).slice(1)};
    toast("Undone."); if(SCH.edit===t.id) paintSchSheet(true); }
  catch(e){ console.error("research undo",e); toast("Couldn't undo. Try again."); }
  finally{ RBUSY.delete(id); } }
function wireResearchCards(box,t){
  box.querySelectorAll(".rcard[data-rid]").forEach(c=>{ const id=c.dataset.rid; const r=(S.research||[]).find(x=>x.id===id)||{};
    const read=()=>{ const g=k=>c.querySelector(`[data-rf="${k}"]`); return {when:g("when").value.trim(),queries:txtList(g("queries").value),limits:g("limits").value.trim(),notes:g("notes").value.trim()}; };
    c.querySelectorAll("[data-rlrm]").forEach(b=>b.onclick=()=>{ const gone=(r.sources||[])[+b.dataset.rlrm]; if(gone==null) return; b.closest(".rlink").style.opacity=".4";
      researchSave(t,id,old=>({sources:(Array.isArray(old.sources)?old.sources:[]).filter(x=>x!==gone)}),`Removed ${String(gone).slice(0,40)}. Undo is on the card.`); });
    const ai=c.querySelector("[data-rladd]"), ab=c.querySelector("[data-rladdb]");
    const addLink=()=>{ let v=ai.value.trim(); if(!v){ toast("Type a link or site name first."); return; } if(/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) v="https://"+v; if(/^https?:/i.test(v)&&!safeUrl(v)){ toast("Links must start with https://"); return; }
      const vv=v; researchSave(t,id,old=>{ const src=Array.isArray(old.sources)?old.sources.slice():[]; if(src.some(x=>String(x).toLowerCase()===vv.toLowerCase())) return {err:"Already on the list."}; if(src.length>=60) return {err:"That's the limit of 60 places."}; src.push(vv); return {sources:src}; },"Added. The next run looks there too.").then(ok=>{ if(ok) ai.value=""; }); };
    if(ab) ab.onclick=addLink; if(ai) ai.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); addLink(); } };
    const on=c.querySelector("[data-ron]"); if(on) on.onchange=()=>researchSave(t,id,{enabled:on.checked},on.checked?"Turned on.":"Turned off. The task will skip this search.");
    const sv=c.querySelector("[data-rsave]"); if(sv) sv.onclick=()=>{ const p=read(); researchSave(t,id,old=>((Array.isArray(old.sources)&&old.sources.length)||p.queries.length)?p:{err:"Add at least one place to look or one search."}); };
    const rr=c.querySelector("[data-rrun]"); if(rr) rr.onclick=()=>{ const p=read(); researchSave(t,id,p,"Saved. Running it now.",true); };
    const ud=c.querySelector("[data-rundo]"); if(ud) ud.onclick=()=>researchUndo(t,id);
    const dl=c.querySelector("[data-rdel]"); if(dl) dl.onclick=async()=>{ if(!confirmInline(dl,"Tap again to remove")) return; try{ await researchSave(t,id,{enabled:false,removed:true},"Removed. (Kept in history.)"); }catch{} };
  });
  const add=box.querySelector("#rnAdd"); if(add) add.onclick=async()=>{ const label=box.querySelector("#rnLabel").value.trim(); if(!label){ toast("Name the search job."); return; }
    const id=(agentSlug(t)+"-"+label.toLowerCase().replace(/[^a-z0-9]+/g,"-")).replace(/^-|-$/g,"").slice(0,60);
    if((S.research||[]).some(x=>x.id===id)){ toast("A job with that name exists."); return; }
    const ok=await researchSave(t,id,{agent:agentKeyOf(t),trigger:t.id,label,sources:txtList(box.querySelector("#rnSources").value),queries:txtList(box.querySelector("#rnQueries").value),when:box.querySelector("#rnWhen").value.trim()||"every run",limits:"",notes:"",enabled:true,createdAt:new Date().toISOString()},"Added. The task picks it up next run.");
    if(ok) setTimeout(()=>paintSchSheet(true),400); };
}
/* two-tap confirm without browser dialogs */
function confirmInline(btn,msg){ if(btn.dataset.armed==="1"){ btn.dataset.armed=""; return true; } const old=btn.textContent; btn.dataset.armed="1"; btn.textContent=msg; setTimeout(()=>{ if(btn.isConnected){ btn.dataset.armed=""; btn.textContent=old; } },4000); return false; }

/* ================= RESEARCH section + shared HQX wiring ================= */
const RV={scope:"all",plat:"",garm:"",q:"",mreg:"local",mapp:false,mq:""};
function hqxSubscribe(){ if(!db) return;
  const col=(name,key,order,lim)=>{ let r=db.collection(name); if(order) r=r.orderBy(order,"desc"); if(lim) r=r.limit(lim); r.onSnapshot(s=>{ S[key]=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, e=>console.warn(name,e)); };
  col("research","research"); col("schedlog","schedlog","at",60); col("sellers","sellers"); col("styletrends","styletrends"); col("venues","venues"); col("events","events"); col("printtrends","printtrends"); col("docs","docs");
  col("ytchannels","ytchannels"); col("ytitems","ytitems","at",300); col("studiocmds","studiocmds","at",40); col("trenddesk","trenddesk","at",60);
  db.collection("knowledge").onSnapshot(s=>{ const k={}; s.docs.forEach(d=>{ k[d.id]=d.data(); }); S.knowledge=k; render(); },()=>{});
  col("designlab","designlab","at",60); col("mydesigns","mydesigns","at",60); col("postjobs","postjobs","at",60); db.doc("library/esync").onSnapshot(d=>{ S.esync=d.exists?d.data():null; render(); },()=>{}); db.doc("rdsettings/meshybal").onSnapshot(d=>{ S.meshybal=d.exists?d.data():null; try{ if(DL.node) dlPaintBar(); }catch{} },()=>{});
  db.collection("libreq").orderBy("at","desc").limit(120).onSnapshot(s=>{ S.libreq=s.docs.map(d=>({id:d.id,...d.data()})); try{ dzUpgrade(); }catch{} render(); },()=>{});
  db.doc("library/manifest").onSnapshot(d=>{ const m=d.exists?d.data():null; if(m&&S.libManifest&&(m.builtAt!==S.libManifest.builtAt||JSON.stringify(m.chunks||{})!==JSON.stringify(S.libManifest.chunks||{}))&&!LIB.loading){ LIB.rows=null; LIB.idx={}; LIB.err=null; } S.libManifest=m; render(); },()=>{});
  db.doc("library/shirts").onSnapshot(d=>{ S.libShirts=d.exists?d.data():null; try{ if(DZ.node){ dzPaintShirts(); dzDraw(); } }catch{} },()=>{});
  db.doc("platform/config").onSnapshot(d=>{ S.platformCfg=d.exists?d.data():{}; render(); },()=>{});
  db.doc("scout/status").onSnapshot(d=>{ S.scoutStatus=d.exists?d.data():{}; render(); },()=>{});
}

function bindHQX(){ if(typeof bindPostIt==="function") bindPostIt(); if(typeof bindLaunchpad==="function") bindLaunchpad(); if(typeof bindBuildIt==="function") bindBuildIt(); if(typeof bindEtsy3d==="function") bindEtsy3d(); if(typeof bindAI==="function") bindAI(); if(typeof bindRules==="function") bindRules(); if(typeof bindReviews==="function") bindReviews(); if(typeof bindShare==="function") bindShare(); if(typeof bindQuotes==="function") bindQuotes(); if(typeof bindRedesign==="function") bindRedesign(); if(typeof bindPickChange==="function") bindPickChange(); if(typeof bindMakerApps==="function") bindMakerApps(); if(typeof bindPacks==="function") bindPacks(); if(S.tab==="sysmap"&&typeof bindSysmap==="function") bindSysmap(); if(S.tab==="schedules") bindSchedules(); if(S.tab==="knowledge") bindKnowledge(); if(S.tab==="designlab") bindDesignLab(); if(S.tab==="library") bindLibrary(); if(S.tab==="designer") bindDesigner(); if(S.tab==="lightbox"&&typeof bindLightbox==="function") bindLightbox(); if(typeof bindQuickPost==="function") bindQuickPost(); if(typeof bindQuickBulk==="function") bindQuickBulk(); if(typeof bindStore==="function") bindStore(); if(S.tab==="code"&&typeof bindCode==="function") bindCode(); if(S.tab==="agents"&&typeof bindAgentStudio==="function") bindAgentStudio(); if(S.tab==="legal"&&typeof bindPaperwork==="function") bindPaperwork();
  document.querySelectorAll("[data-ropen]").forEach(b=>b.onclick=()=>schOpen(b.dataset.ropen));
  document.querySelectorAll("[data-rvscope]").forEach(b=>b.onclick=()=>{ RV.scope=b.dataset.rvscope; render(); });
  const pf=$("#rvPlat"); if(pf) pf.onchange=()=>{ RV.plat=pf.value; render(); };
  const gf=$("#rvGarm"); if(gf) gf.onchange=()=>{ RV.garm=gf.value; render(); };
  const rq=$("#rvQ"); if(rq) rq.oninput=()=>{ RV.q=rq.value; render(); };
  document.querySelectorAll("[data-seller]").forEach(c=>{ c.onclick=()=>openSeller(c.dataset.seller); c.onkeydown=e=>{ if(e.key==="Enter") openSeller(c.dataset.seller); }; });
  document.querySelectorAll("[data-mreg]").forEach(b=>b.onclick=()=>{ RV.mreg=b.dataset.mreg; render(); });
  const ma=$("#mApp"); if(ma) ma.onchange=()=>{ RV.mapp=ma.checked; render(); };
  const mq=$("#mQ"); if(mq) mq.oninput=()=>{ RV.mq=mq.value; render(); };
  if(typeof bindStudio==="function") bindStudio(); if(typeof bindCatalog==="function") bindCatalog(); if(typeof bindSearchX==="function") bindSearchX(); }
/* ---------- Overview ---------- */
function vResearch(){ const R=(S.research||[]).filter(r=>!r.removed); const on=R.filter(r=>r.enabled!==false&&S.triggers[r.trigger]&&S.triggers[r.trigger].enabled);
  const recent=R.filter(r=>r.lastRun&&r.lastRun.at).sort((a,b)=>String(b.lastRun.at).localeCompare(String(a.lastRun.at))).slice(0,8);
  const ss=S.scoutStatus||{}; const pt=(S.printtrends||[]).map(x=>x.capturedAt).filter(Boolean).sort().pop();
  const tile=(go,l,v,s)=>`<button class="tk mini" type="button" data-goto="${go}"><span class="l">${l}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  return `<div class="home"><div class="kpi4">
      ${tile("rsettings","Search jobs",on.length,`${R.length} total · edit any of them`)}
      ${tile("sellers","Shirt sellers",(S.sellers||[]).length,ss.localAt?"local "+ago(ss.localAt):"not run yet")}
      ${tile("print3d","3D trends",(S.printtrends||[]).length?"Ready":"—",pt?"data from "+ago(pt):"not run yet")}
      ${tile("markets","Upcoming markets",(S.events||[]).filter(e=>e.end>=new Date().toISOString().slice(0,10)).length,"SC markets & festivals")}</div>
    <section class="card"><div class="card-head"><h2 class="big">What's selling now</h2><span class="eyebrow">Nora's market report</span></div>${typeof marketFull==="function"?marketFull():""}</section>
    <section class="card"><div class="card-head"><h2>Latest research runs</h2><button class="btn" data-goto="rsettings">Edit search settings</button></div>
      ${recent.length?`<div class="list">${recent.map(r=>`<div class="row"><div style="flex:1;min-width:0"><b>${esc(r.label)}</b> <span class="muted small">· ${esc(String((S.triggers[r.trigger]||{}).name||r.agent||"").split(" ·")[0])}</span><div class="small muted">${esc(ago(r.lastRun.at))}${r.lastRun.summary?" · "+esc(String(r.lastRun.summary).slice(0,200)):""}</div></div></div>`).join("")}</div>`:`<p class="muted small">Each research job reports here after its next run.</p>`}</section></div>`; }
/* ---------- Search settings: every job, grouped by task; editing opens the task sheet ---------- */
function vRSettings(){ const R=(S.research||[]).filter(r=>!r.removed); const by={};
  R.forEach(r=>{ const k=r.trigger||r.agent||"other"; (by[k]=by[k]||[]).push(r); });
  const groups=Object.entries(by).map(([k,rs])=>({t:S.triggers[k],k,rs})).sort((a,b)=>((b.t&&b.t.enabled)?1:0)-((a.t&&a.t.enabled)?1:0)||String(a.t?a.t.name:a.k).localeCompare(String(b.t?b.t.name:b.k)));
  const ed=canEditSched();
  return `<section class="card"><div class="card-head"><h2 class="big">Sources &amp; search jobs</h2><span class="eyebrow">what each task searches, where, and when</span></div>
    <p class="small muted" style="margin-top:0">Every task reads these at the start of each run, so a change here applies to its next run. ${ed?"Tap Edit to change where it looks, what it searches for, how much, or when; the task's run times are in the same window.":"Only Aaron, signed in with his PIN, can change them."}</p>
    ${S.trigState!=="on"?`<p class="muted small">Loading schedules…</p>`:""}
    ${groups.length?groups.map(g=>`<div class="rgroup"><div class="row rghead"><h3>${esc(g.t?g.t.name:g.k)}</h3>${g.t?`<span class="pill ${g.t.enabled?"ok":""}">${g.t.enabled?"On":"Paused"}</span><span class="small muted">${esc(cronText(g.t.cron_expression))}</span><button class="btn" data-ropen="${esc(g.t.id)}">${ed?"Edit":"Details"}</button>`:`<span class="small muted">task not found</span>`}</div>
      <div class="rgrid">${g.rs.map(r=>`<div class="rcard ${r.enabled===false?"off":""}"><div class="rhead"><b>${esc(r.label)}</b><span class="pill ${r.enabled===false?"":"ok"}">${r.enabled===false?"Off":"On"}</span></div><div class="small"><b>When:</b> ${esc(r.when||"every run")}</div><div class="small"><b>Where:</b> ${esc((Array.isArray(r.sources)?r.sources:[]).slice(0,6).join(", ")||"—")}${(Array.isArray(r.sources)?r.sources:[]).length>6?" …":""}</div>${Array.isArray(r.queries)&&r.queries.length?`<div class="small"><b>Searches:</b> ${esc(r.queries.slice(0,5).join(", "))}${r.queries.length>5?" …":""}</div>`:""}<div class="small muted">${r.lastRun&&r.lastRun.at?"Last done "+esc(ago(r.lastRun.at)):"Not run with these settings yet"}</div></div>`).join("")}</div></div>`).join(""):`<p class="muted">No search jobs saved yet.</p>`}</section>`; }
/* ---------- Shirt sellers (was Thread Scout) ---------- */
const GARM={tee:"Tee",longsleeve:"L/S",hoodie:"Hoodie",crewneck:"Crew"};
const money=r=>{ if(!Array.isArray(r)) return null; const a=Number(r[0]), b=Number(r[1]); if(!isFinite(a)) return null; return (!isFinite(b)||a===b)?"$"+a:"$"+a+"–"+b; };
function median(a){ if(!a.length) return null; a=[...a].sort((x,y)=>x-y); const m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function vSellers(){ const all=S.sellers||[]; const ss=S.scoutStatus||{};
  const plats=[...new Set(all.flatMap(s=>s.platforms||[]))].sort(); const q=RV.q.trim().toLowerCase();
  const list=all.filter(s=>(RV.scope==="all"||s.scope===RV.scope)&&(!RV.plat||(s.platforms||[]).includes(RV.plat))&&(!RV.garm||(s.garments&&typeof s.garments==="object"&&RV.garm in s.garments))&&(!q||JSON.stringify([s.name,s.look,s.styles,s.city,s.print]).toLowerCase().includes(q)));
  const tees=all.map(s=>s.garments&&s.garments.tee).filter(Array.isArray).map(r=>(r[0]+r[1])/2), hoods=all.map(s=>s.garments&&s.garments.hoodie).filter(Array.isArray).map(r=>(r[0]+r[1])/2);
  const mt=median(tees), mh=median(hoods); const chip=(k,l)=>`<button class="chip" data-rvscope="${k}" aria-pressed="${RV.scope===k}">${l}</button>`;
  return `<section class="card"><div class="card-head"><h2 class="big">Who's selling shirts, and how</h2><span class="eyebrow">Charleston daily-ish · nationwide weekly · ${ss.localAt?"local updated "+esc(ago(ss.localAt)):"local not run yet"} · ${ss.nationalAt?"national "+esc(ago(ss.nationalAt)):"national not run yet"}</span></div>
    <div class="kpi4" style="margin-bottom:10px"><div class="kpi"><b>${all.length||"–"}</b><span class="small muted"> sellers tracked</span></div><div class="kpi"><b>${mt?"$"+Math.round(mt):"–"}</b><span class="small muted"> median tee</span></div><div class="kpi"><b>${mh?"$"+Math.round(mh):"–"}</b><span class="small muted"> median hoodie</span></div><div class="kpi"><b>${(S.styletrends||[]).length}</b><span class="small muted"> style trends</span></div></div>
    <div class="schbar">${chip("all","All")}${chip("local","Charleston")}${chip("national","Nationwide")}
      <select id="rvPlat" aria-label="Storefront"><option value="">Any storefront</option>${plats.map(p=>`<option ${p===RV.plat?"selected":""}>${esc(p)}</option>`).join("")}</select>
      <select id="rvGarm" aria-label="Garment"><option value="">Any garment</option>${Object.entries(GARM).map(([k,l])=>`<option value="${k}" ${k===RV.garm?"selected":""}>${l}</option>`).join("")}</select>
      <input type="search" id="rvQ" placeholder="Search style, theme, brand" value="${esc(RV.q)}"></div>
    <div class="rgrid">${!all.length?`<p class="muted">Seller research shows here after the next research run.</p>`:!list.length?`<p class="muted">No sellers match.</p>`:list.map(s=>{ const ads=s.ads||{}; const n=["meta","google","tiktok"].map(k=>ads[k]).filter(x=>typeof x==="number");
      return `<div class="rcard" tabindex="0" role="button" data-seller="${esc(s.id)}" style="cursor:pointer"><div class="rhead"><b>${esc(s.name)}</b><span class="pill">${s.scope==="local"?"Local":"National"}</span></div><div class="small muted">${esc(s.city||"")} · ${esc((s.platforms||[]).join(", "))}</div><div class="small">${esc(String(s.look||"").slice(0,180))}</div>
        <div class="small">${Object.keys(GARM).map(k=>s.garments&&money(s.garments[k])?`<span class="pill">${GARM[k]} ${money(s.garments[k])}</span>`:"").join(" ")}</div><div class="small muted">${n.length?n.reduce((a,b)=>a+b,0)+" live ads":"Ads not counted yet"}</div></div>`; }).join("")}</div></section>
    <section class="card"><div class="card-head"><h2>What the selling shirts look like</h2></div><div class="rgrid">${(S.styletrends||[]).slice().sort((a,b)=>(b.heat||0)-(a.heat||0)).map(t=>`<div class="rcard"><div class="rhead"><b>${esc(t.name)}</b><span class="pill">${"●".repeat(Math.max(0,Math.min(5,t.heat|0)))}</span></div><div class="small">${esc(t.what)}</div>${t.blanks?`<div class="small"><b>Blanks:</b> ${esc(t.blanks)}</div>`:""}${t.price?`<div class="small"><b>Typical price:</b> ${esc(t.price)}</div>`:""}${safeUrl(t.source)?`<a class="small" href="${esc(safeUrl(t.source))}" target="_blank" rel="noopener">Source ↗</a>`:""}</div>`).join("")||`<p class="muted small">None yet.</p>`}</div></section>
    <section class="card"><div class="card-head"><h2>Storefronts & markets</h2></div><div class="rgrid">${(S.venues||[]).map(v=>`<div class="rcard"><div class="rhead"><b>${esc(v.name)}</b><span class="pill">${esc(v.kind||"")}</span></div><div class="small">${esc(v.what)}</div>${v.when?`<div class="small"><b>When:</b> ${esc(v.when)}</div>`:""}${safeUrl(v.url)?`<a class="small" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">Open ↗</a>`:""}</div>`).join("")||`<p class="muted small">None yet.</p>`}</div></section>`; }
function openSeller(id){ const s=(S.sellers||[]).find(x=>x.id===id); if(!s) return; const ads=s.ads||{}; const num=v=>typeof v==="number"?v:"not counted";
  let box=$("#schSheet"); if(box) box.remove(); box=document.createElement("div"); box.id="schSheet"; box.className="xsheet"; box.setAttribute("role","dialog");
  const link=(u,l)=>safeUrl(u)?`<a class="btn" href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(l)} ↗</a>`:"";
  box.innerHTML=`<div class="xpanel"><div class="xhead"><h2>${esc(s.name)}</h2><button class="btn" data-x>Close</button></div><div class="small muted">${esc(s.city||"")} · ${s.scope==="local"?"Charleston area":"Nationwide"}</div>
    <h3>The look</h3><p>${esc(s.look||"")}</p><div class="small">${(s.styles||[]).map(x=>`<span class="pill">${esc(x)}</span>`).join(" ")}</div>
    <h3>Product & price</h3><table class="tbl">${Object.keys(GARM).filter(k=>s.garments&&typeof s.garments==="object"&&k in s.garments).map(k=>`<tr><th>${GARM[k]}</th><td>${money(s.garments[k])||"Sold, price not confirmed"}</td></tr>`).join("")}<tr><th>Print</th><td>${esc(s.print||"—")}</td></tr><tr><th>Blanks</th><td>${esc(s.blanks||"—")}</td></tr></table>
    <h3>Where it sells</h3><table class="tbl"><tr><th>Storefronts</th><td>${esc((s.platforms||[]).join(", "))}</td></tr><tr><th>Channels</th><td>${esc((s.channels||[]).join(", ")||"—")}</td></tr><tr><th>Hosting</th><td>${esc(s.hosting||"—")}</td></tr><tr><th>Size</th><td>${esc(s.revenue||"—")}</td></tr></table>
    <h3>Ads</h3><table class="tbl"><tr><th>Meta</th><td>${num(ads.meta)}</td></tr><tr><th>Google</th><td>${num(ads.google)}</td></tr><tr><th>TikTok</th><td>${num(ads.tiktok)}</td></tr><tr><th>Checked</th><td>${esc(ads.checked||"—")}</td></tr></table>
    ${s.notes?`<h3>Why it works</h3><p>${esc(s.notes)}</p>`:""}
    <div class="row" style="flex-wrap:wrap;gap:6px">${link(s.url,"Shop")}${(s.social||[]).map(x=>Array.isArray(x)?link(x[1],x[0]):"").join("")}</div>
    ${(s.sources||[]).length?`<h3>Sources ${s.verified?"· verified "+esc(s.verified):""}</h3><ul class="small">${s.sources.map(x=>safeUrl(x.u)?`<li><a href="${esc(safeUrl(x.u))}" target="_blank" rel="noopener">${esc(x.t||x.u)}</a></li>`:"").join("")}</ul>`:""}</div>`;
  document.body.appendChild(box); box.querySelector("[data-x]").onclick=()=>box.remove(); box.onclick=e=>{ if(e.target===box) box.remove(); }; box.querySelector("[data-x]").focus(); }
/* ---------- 3D trends (was the 3D Print Trend Tracker) ---------- */
function ptRows(id){ const d=(S.printtrends||[]).find(x=>x.id===id); return d&&Array.isArray(d.rows)?d.rows:[]; }
function bars(rows,label,val,fmt){ const mx=Math.max(1,...rows.map(r=>+r[val]||0)); return `<table class="tbl">${rows.map(r=>`<tr><td style="width:45%">${esc(r[label])}</td><td><div class="hbar" role="img" aria-label="${esc(r[label])}: ${esc(fmt?fmt(r[val]):r[val])}"><span style="width:${Math.max(2,(+r[val]||0)/mx*100)}%"></span></div></td><td class="small" style="white-space:nowrap">${esc(fmt?fmt(r[val]):r[val])}</td></tr>`).join("")}</table>`; }
function vPrint3d(){ const at=(S.printtrends||[]).map(x=>x.capturedAt).filter(Boolean).sort().pop();
  const cats=ptRows("categories"), models=ptRows("trending_models"), rq=ptRows("rising_queries").slice().sort((a,b)=>(b.growth_pct||0)-(a.growth_pct||0)), etsy=ptRows("etsy_signals"), st=ptRows("state_interest").slice().sort((a,b)=>(b.interest||b.value||0)-(a.interest||a.value||0)).slice(0,12);
  const stKey=st[0]?Object.keys(st[0]).find(k=>typeof st[0][k]==="number"):null, stLab=st[0]?Object.keys(st[0]).find(k=>typeof st[0][k]==="string"):null;
  if(!(S.printtrends||[]).length) return `<section class="card"><h2 class="big">3D trends</h2><p class="muted">3D print trend data shows here after its research run.</p></section>`;
  return `<section class="card"><div class="card-head"><h2 class="big">What's trending in 3D printing</h2><span class="eyebrow">${at?"data from "+esc(ago(at)):""} · Andy & Cole use this for product ideas</span></div>
    <div class="grid"><div class="col">
      <h3>Trending models (Printables)</h3><div class="tblwrap"><table class="tbl"><tr><th>Model</th><th>Category</th><th>Downloads</th><th>License</th></tr>${models.slice(0,24).map(m=>`<tr><td>${safeUrl(m.url)?`<a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.model)}</a>`:esc(m.model)}<div class="small muted">${esc(m.designer||"")}</div></td><td>${esc(m.category||"")}</td><td>${esc((+m.downloads||0).toLocaleString())}</td><td class="small">${esc(m.license||"")}</td></tr>`).join("")}</table></div>
      <p class="small muted">Only sell prints of a model when its own page shows a license that allows it.</p></div>
    <div class="col"><h3>Rising searches (US)</h3>${bars(rq,"query","growth_pct",v=>"+"+v+"%")}
      <h3>Price & margin by category</h3><table class="tbl"><tr><th>Category</th><th>Price</th><th>Margin</th></tr>${cats.map(c=>`<tr><td>${esc(c.category)}</td><td>${esc(c.price_range||"")}</td><td>${esc(c.margin_low_pct)}–${esc(c.margin_high_pct)}%</td></tr>`).join("")}</table>
      <h3>Etsy best sellers</h3><table class="tbl">${etsy.map(e=>`<tr><td>${esc(e.listing)}<div class="small muted">${esc(e.category||"")}</div></td><td>$${esc(e.sale_price_usd)}</td><td class="small">${esc((+e.shop_reviews||0).toLocaleString())} reviews</td></tr>`).join("")}</table>
      ${stKey?`<h3>Top states by interest</h3>${bars(st,stLab,stKey)}`:""}</div></div></section>`; }
/* ---------- Markets & events (was the Studio calendar) ---------- */
function vMarkets(){ const today=new Date().toISOString().slice(0,10); const q=RV.mq.trim().toLowerCase();
  const ev=(S.events||[]).filter(e=>e.end>=today&&(RV.mreg==="all"||e.region===RV.mreg||(RV.mreg==="local"&&!e.region))&&(!RV.mapp||/Yes|Unknown/.test(e.apparel_ok||""))&&(!q||JSON.stringify([e.name,e.city,e.type,e.venue]).toLowerCase().includes(q))).sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  const dl=(S.events||[]).filter(e=>e.apply_deadline&&e.apply_deadline>=today&&e.apply_status!=="Closed").sort((a,b)=>String(a.apply_deadline).localeCompare(String(b.apply_deadline))).slice(0,6);
  const fmt=d=>{ try{ return new Date(d+"T12:00:00").toLocaleDateString([], {month:"short",day:"numeric"}); }catch{ return d; } };
  const chip=(k,l)=>`<button class="chip" data-mreg="${k}" aria-pressed="${RV.mreg===k}">${l}</button>`;
  return `<section class="card"><div class="card-head"><h2 class="big">Markets & events</h2><span class="eyebrow">SC markets, fairs and festivals where you could sell</span></div>
    ${dl.length?`<h3>Application deadlines coming up</h3><div class="list">${dl.map(e=>`<div class="row"><div style="flex:1;min-width:0"><b>${esc(fmt(e.apply_deadline))}</b> · ${esc(e.name)} <span class="small muted">· ${esc(e.city||"")}</span></div>${safeUrl(e.apply_url||e.url)?`<a class="btn" href="${esc(safeUrl(e.apply_url||e.url))}" target="_blank" rel="noopener">Apply ↗</a>`:""}</div>`).join("")}</div>`:""}
    <div class="schbar" style="margin-top:12px">${chip("local","Charleston area")}${chip("all","All of SC")}<label class="small"><input type="checkbox" id="mApp" ${RV.mapp?"checked":""}> Apparel likely OK</label><input type="search" id="mQ" placeholder="Search events" value="${esc(RV.mq)}"></div>
    <div class="list">${ev.length?ev.map(e=>`<div class="row"><div style="width:84px;flex:none"><b>${esc(fmt(e.start))}</b>${e.end!==e.start?`<div class="small muted">to ${esc(fmt(e.end))}</div>`:""}</div><div style="flex:1;min-width:0"><b>${esc(e.name)}</b><div class="small muted">${esc(e.venue||"")}${e.city?", "+esc(e.city):""} · ${esc(e.type||"")}</div><div class="small">${e.apply_status?`<span class="pill ${e.apply_status==="Open"?"ok":""}">${esc(e.apply_status)}${e.apply_deadline?" · due "+esc(fmt(e.apply_deadline)):""}</span>`:""} ${e.apparel_ok?`<span class="pill">${esc(e.apparel_ok==="Yes"?"Apparel welcome":e.apparel_ok)}</span>`:""} ${e.booth_fee&&e.booth_fee!=="Not posted"?`<span class="pill">${esc(e.booth_fee)}</span>`:""}</div></div>${safeUrl(e.url)?`<a class="small" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">Event page ↗</a>`:""}</div>`).join(""):`<p class="muted">No upcoming events match.</p>`}</div></section>`; }

/* ================= STUDIO · YouTube (was the separate Video Studio site) ================= */
const STU={ch:"released-footage", view:"queue"};
const YT_CH=[{key:"released-footage",name:"Released Footage"},{key:"funny-video-clips",name:"Funny Video Clips"},{key:"elevated-newsflash",name:"ElevatedNewsflash"}];
function ytCh(k){ return (S.ytchannels||[]).find(c=>c.id===k||c.key===k)||null; }
function ytItems(k,kind){ return (S.ytitems||[]).filter(i=>i.channel===k&&i.kind===kind).sort((a,b)=>String(b.when||b.at||"").localeCompare(String(a.when||a.at||""))); }
function cmdPending(k,itemId,action){ return (S.studiocmds||[]).find(c=>c.channel===k&&(itemId==null?c.itemId==null:c.itemId===itemId)&&(!action||c.action===action)&&/open|running/.test(c.status||"")); }
function vStudio(){ const k=STU.ch, c=ytCh(k)||{}, ov=c.overview||{}; const syncTid=(S.platformCfg||{}).studioSyncTrigger;
  const stale=!c.syncedAt||Date.now()-new Date(c.syncedAt).getTime()>3*3600e3;
  const chip=(key,l)=>`<button class="chip" data-stuch="${key}" aria-pressed="${STU.ch===key}">${l}</button>`;
  const vchip=(v,l,n)=>`<button class="chip" data-stuv="${v}" aria-pressed="${STU.view===v}">${l}${n?` <span class="count">${n}</span>`:""}</button>`;
  const q=ytItems(k,"queue"), cand=ytItems(k,"candidate"), posted=ytItems(k,"posted");
  const tile=(l,v,s)=>`<div class="kpi"><b>${esc(v==null||v===""?"—":v)}</b><div class="small muted">${l}${s?" · "+esc(s):""}</div></div>`;
  const pend=(S.studiocmds||[]).filter(x=>x.channel===k&&/open|running/.test(x.status||""));
  const failed=(S.studiocmds||[]).filter(x=>x.channel===k&&x.status==="failed").slice(0,3);
  const list=STU.view==="queue"?q:STU.view==="candidates"?cand:posted;
  return `<section class="card"><div class="card-head"><h2 class="big">YouTube studio</h2><span class="eyebrow">3 channels · videos are built on your PC</span></div>
    <div class="schbar">${YT_CH.map(x=>chip(x.key,x.name)).join("")}</div>
    <div class="small ${stale?"bad":"muted"}" style="margin:2px 0 10px">${c.syncedAt?`Last synced with your PC ${esc(ago(c.syncedAt))}`:"Not synced yet"}${c.error?` · ${esc(String(c.error).slice(0,160))}`:""}${stale?" · if this stays old, the PC may be off or asleep":""}
      ${syncTid&&canEditSched()?` <button class="btn" data-stusync>Sync now</button>`:""}</div>
    <div class="kpi4">${tile("Subscribers",ov.subscribers!=null?(+ov.subscribers).toLocaleString():"")}${tile("Views (28 days)",ov.views28!=null?(+ov.views28).toLocaleString():"")}${tile("Last post",ov.lastPost?ago(ov.lastPost):"")}${tile("Next post",ov.nextPost?when(ov.nextPost):"",ov.autopilot||"")}</div>
    ${pend.length?`<p class="small" style="margin:10px 0 0">${pend.length} action${pend.length>1?"s":""} waiting for the PC: ${esc(pend.map(x=>x.action).join(", "))}</p>`:""}
    ${failed.length?`<p class="small bad" style="margin:6px 0 0">Didn't work: ${failed.map(x=>esc(x.action+": "+String(x.result||"failed").slice(0,90))).join(" · ")}</p>`:""}
    <div class="schbar" style="margin-top:12px">${vchip("queue","Ready to post",q.length)}${vchip("candidates","New finds",cand.length)}${vchip("posted","Posted",0)}
      ${canEditSched()?`<button class="btn" data-stucmd="find-more">Find more</button><button class="btn" data-stucmd="run-now">Build today's video now</button>`:""}</div>
    <div class="ytq">${list.length?list.slice(0,30).map(i=>ytCard(k,i)).join(""):`<p class="muted small">${STU.view==="queue"?"Nothing waiting to post.":STU.view==="candidates"?"No new finds right now.":"No posts synced yet."}</p>`}</div></section>
    ${trendDeskCard()}
    <div class="grid" style="margin-top:16px"><div class="col">
      <section class="card" id="s-queue"><div class="card-head"><h2>Team video queue</h2><span class="eyebrow">Mike's plan</span></div>${typeof queueList==="function"?queueList(["YouTube · Released Footage","YouTube · Funny Video Clips","Shorts · Released Footage","Shorts · Funny Video Clips"]):""}</section>
      ${typeof marketBlock==="function"?marketBlock("youtube"):""}
      <section class="card"><div class="card-head"><h2>Activity</h2></div>${typeof feed==="function"?feed(a=>["mike","jake","megan"].includes(a.agent),15):""}</section></div>
    <div class="col">${typeof desk==="function"?desk("studio"):""}<section class="card"><div class="card-head"><h2>The Studio team</h2></div>${typeof teamCards==="function"?teamCards("studio"):""}</section></div></div>`; }
function ytCard(k,i){ const img=safeImg(i.thumbUrl); const p=cmdPending(k,i.srcId);
  const acts = i.kind==="queue" ? [["post","Post now"],["skip","Skip"]] : i.kind==="candidate" ? [["build","Build video"],["skip","Skip"]] : [];
  return `<div class="ytc">${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<div style="aspect-ratio:16/9;background:var(--line)"></div>`}<div class="b"><b>${esc(i.title||"Untitled")}</b>
    <div class="small muted">${esc([i.source,i.when?when(i.when):"",i.duration].filter(Boolean).join(" · "))}</div>${i.notes?`<div class="small">${esc(String(i.notes).slice(0,200))}</div>`:""}
    <div class="a">${safeUrl(i.ytUrl)?`<a class="btn" href="${esc(safeUrl(i.ytUrl))}" target="_blank" rel="noopener">Watch ↗</a>`:""}${p?`<span class="pill acc">${esc(p.action)} waiting…</span>`:canEditSched()?acts.map(([a,l])=>`<button class="btn" data-stuact="${a}" data-stuid="${esc(i.srcId||"")}">${l}</button>`).join(""):""}</div></div></div>`; }
function trendDeskCard(){ const T=(S.trenddesk||[]).slice(0,12); if(!T.length) return "";
  return `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Breaking & trending</h2><span class="eyebrow">Trend Desk scans every 90 minutes</span></div><div class="list">${T.map(t=>`<div class="row"><div style="flex:1;min-width:0"><b>${esc(t.title)}</b><div class="small muted">${esc([t.source,t.channel,t.at?ago(t.at):""].filter(Boolean).join(" · "))}</div></div>${safeUrl(t.url)?`<a class="small" href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">Open ↗</a>`:""}</div>`).join("")}</div></section>`; }
async function studioCmd(action,itemId,btn){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can do that."); return; } if(!db){ toast("Can't save from this view."); return; }
  const tid=(S.platformCfg||{}).studioSyncTrigger; if(!tid||!S.triggers[tid]){ toast("The studio link to your PC isn't set up yet."); return; }
  if(cmdPending(STU.ch,itemId||null,action)){ toast("Already waiting for the PC."); return; }
  if(btn) btn.disabled=true;
  try{ await db.collection("studiocmds").add({channel:STU.ch,action,itemId:itemId||null,status:"open",by:CUR,at:new Date().toISOString()});
    const ok=await fireNow(tid,`Studio action from Aaron: ${action}${itemId?" on "+itemId:""} (${STU.ch}). Process all open studiocmds now.`);
    toast(ok?"Sent to your PC. It usually takes a minute or two.":"Saved. Your PC picks it up on the next sync."); }
  catch(e){ toast("Couldn't send that. Try again."); } finally{ if(btn) btn.disabled=false; } }
function bindStudio(){ if(S.tab!=="studio") return;
  document.querySelectorAll("[data-stuch]").forEach(b=>b.onclick=()=>{ STU.ch=b.dataset.stuch; render(); });
  document.querySelectorAll("[data-stuv]").forEach(b=>b.onclick=()=>{ STU.view=b.dataset.stuv; render(); });
  document.querySelectorAll("[data-stuact]").forEach(b=>b.onclick=()=>studioCmd(b.dataset.stuact,b.dataset.stuid,b));
  document.querySelectorAll("[data-stucmd]").forEach(b=>b.onclick=()=>studioCmd(b.dataset.stucmd,null,b));
  const sy=document.querySelector("[data-stusync]"); if(sy) sy.onclick=async()=>{ sy.disabled=true; const ok=await fireNow((S.platformCfg||{}).studioSyncTrigger,"Sync the studio now."); sy.disabled=false; if(ok) toast("Syncing with your PC…"); }; }

/* ================= DESIGN CATALOG + BUSINESS DOCS (ported from Elevated Designs Studio) ================= */
const CAT_ST={line:null,coll:"all",fam:"all",q:"",limit:120};
try{ const v=JSON.parse(localStorage.getItem("hq-cat-nav")||"null"); if(v&&typeof v==="object"){ if(typeof v.line==="string") CAT_ST.line=v.line; if(typeof v.coll==="string") CAT_ST.coll=v.coll; } }catch{}
let CAT_DATA=null, CAT_LOADING=null, CAT_ERR="", CAT_LINES={}, CAT_BYLINE={}, CAT_BYID={}, CAT_CACHE={k:"",html:""}, CAT_LIST=[], CAT_QT=0, CAT_DOCHTML={};
const CAT_SW={"White":"#FFFFFF","Ivory":"#E7CEB5","Pepper":"#4F4C48","Black":"#1E1E1E","Blue Jean":"#5E7C99","Bay":"#94A596","Chalky Mint":"#9ED6C7","Khaki":"#A09074","Brick":"#8E3B36","Soft Cream":"#EBDFC8","Athletic Heather":"#B5B5B3","Navy":"#1F2A44","Dark Grey Heather":"#3F3F41","Heather Forest":"#2F4A3A","True Royal":"#1F4FA3"};
const CAT_FAMS=[["all","All"],["light","Light shirts"],["dark","Dark shirts"],["pers","Personalized"]];
const CAT_GROUPS=["Plan","Brands","Selling","Costs","Funding","Other ideas","Weddings extras"];
const CAT_SHARED=[["img/shared/07_choose_your_shirt.webp","Choose your shirt"],["img/shared/08_color_options.webp","Color options"],["img/shared/09_size_chart.webp","Size chart"],["img/shared/10_care_and_made_in_charleston.webp","Care and made in Charleston"]];

function catSaveNav(){ try{ localStorage.setItem("hq-cat-nav",JSON.stringify({line:CAT_ST.line,coll:CAT_ST.coll})); }catch{} }
const catPad=n=>String(n).padStart(2,"0");
const catCap=s=>s?String(s)[0].toUpperCase()+String(s).slice(1):"";
const catPos=(i,n)=>n>1?(i/(n-1)*100).toFixed(4):0;
/* Sprite sheets: one image holds a grid of cells; show cell (c,r) of a cols x rows grid. Only our own relative img/ paths are allowed into CSS. */
function catSpr(f,c,r,cols,rows){ if(typeof f!=="string"||!/^img\/[\w.\/-]+\.webp$/.test(f)||f.includes("..")) return "";
  const v=CAT_DATA&&CAT_DATA.iv?"?v="+encodeURIComponent(CAT_DATA.iv):""; cols=+cols||1; rows=+rows||1;
  return `background-image:url('${f}${v}');background-size:${cols*100}% ${rows*100}%;background-position:${catPos(+c||0,cols)}% ${catPos(+r||0,rows)}%`; }
const catThumb=d=>{ const l=CAT_LINES[d.line]; return l&&l.tg&&d.t?catSpr(`img/${d.line}/thumbs.webp`,d.t[0],d.t[1],l.tg[0],l.tg[1]):""; };
const catCover=l=>l.c&&CAT_DATA.cg?catSpr("img/covers.webp",l.c[0],l.c[1],CAT_DATA.cg[0],CAT_DATA.cg[1]):"";
/* big gallery sheets for the niche lines (b28–b53, g01–g10) are 2 MB each and are not published; those designs show their thumbnail instead */
const CAT_NOGAL=/^img\/(b(2[89]|[34]\d|5[0-3])|g\d\d)\//;
const catHasGal=d=>Array.isArray(d.g)&&!CAT_NOGAL.test(String(d.g[0]));
const catGal=(d,i)=>catHasGal(d)?catSpr(d.g[0],i,d.g[1],6,d.g[2]):catThumb(d);
const catNo=d=>{ const l=CAT_LINES[d.line]; return (l&&l.kind==="brand"?"T":"No. ")+catPad(d.n); };
const catPlain=s=>String(s||"").replace(/\*\*(.+?)\*\*/g,"$1");
function catMd(s){ const out=[]; let list=false; const inl=t=>esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\*(.+?)\*/g,"<em>$1</em>");
  for(const raw of String(s||"").split("\n")){ const line=raw.trim();
    if(/^[-*] /.test(line)){ if(!list){ out.push("<ul>"); list=true; } out.push(`<li>${inl(line.slice(2))}</li>`); continue; }
    if(list){ out.push("</ul>"); list=false; } if(line) out.push(`<p>${inl(line)}</p>`); }
  if(list) out.push("</ul>"); return out.join(""); }
const catSwatch=c=>`<span class="cat-sw"><i style="background:${CAT_SW[c]||"#ccc"}"></i>${esc(c)}</span>`;

/* ---------- data ---------- */
function catLoad(){ if(CAT_LOADING) return CAT_LOADING; CAT_ERR="";
  CAT_LOADING=fetch("data/catalog.json").then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }).then(c=>{
    if(!c||!Array.isArray(c.lines)||!Array.isArray(c.designs)) throw new Error("the file isn't a design catalog");
    const L={},B={},I={}; for(const l of c.lines){ L[l.id]=l; B[l.id]=[]; }
    for(const d of c.designs){ if(!B[d.line]) continue; I[d.id]=d; B[d.line].push(d);
      d.tags=Array.isArray(d.tags)?d.tags:[]; d.fields=Array.isArray(d.fields)?d.fields:[]; d.cc=d.cc||[]; d.bc=d.bc||[]; d.printFiles=d.printFiles||[]; d.images=Array.isArray(d.images)&&d.images.length?d.images:[{k:"01",label:"Main photo"}];
      d._h=[d.name,d.title,d.tags.join(" "),L[d.line].name,L[d.line].niche,d.fields.join(" ")].join(" ").toLowerCase(); }
    for(const k in B) B[k].sort((a,b)=>a.n-b.n);
    CAT_DATA=c; CAT_LINES=L; CAT_BYLINE=B; CAT_BYID=I; CAT_CACHE.k="";
    if(CAT_ST.line&&!L[CAT_ST.line]){ CAT_ST.line=null; CAT_ST.coll="all"; }
  }).catch(e=>{ CAT_ERR=(e&&e.message)||String(e); CAT_LOADING=null; }).finally(()=>{ if(S.tab==="catalog") render(); });
  return CAT_LOADING; }
/* used by the console-wide search box */
function catSearch(q,n){ if(!CAT_DATA){ catLoad(); return []; } const t=String(q||"").toLowerCase().split(/\s+/).filter(Boolean); if(!t.length) return [];
  const out=[]; for(const d of CAT_DATA.designs){ if(t.every(x=>d._h.includes(x))){ out.push({label:d.name+" \u00b7 "+CAT_LINES[d.line].name,run:()=>{ catGoTab("catalog"); setTimeout(()=>catOpenDesign(d.id),60); }}); if(out.length>=(n||20)) break; } }
  return out; }
function catGoTab(t){ if(typeof goTab==="function") goTab(t); else { S.tab=t; render(); } }
function catFiltered(){ const k=[CAT_ST.q,CAT_ST.line,CAT_ST.coll,CAT_ST.fam].join("|"); if(catFiltered.k===k) return CAT_LIST; catFiltered.k=k;
  const t=CAT_ST.q.toLowerCase().split(/\s+/).filter(Boolean);
  if(t.length) CAT_LIST=CAT_DATA.designs.filter(d=>t.every(x=>d._h.includes(x)));
  else if(CAT_ST.line){ const l=CAT_LINES[CAT_ST.line], f=CAT_ST.fam, colls=(l&&Array.isArray(l.collections))?l.collections:[];
    CAT_LIST=(CAT_BYLINE[CAT_ST.line]||[]).filter(d=>(f==="all"||(f==="light"&&d.family!=="dark")||(f==="dark"&&d.family==="dark")||(f==="pers"&&d.fields.length))&&(!colls.length||CAT_ST.coll==="all"||d.coll===CAT_ST.coll)); }
  else CAT_LIST=[];
  return CAT_LIST; }

/* ---------- views ---------- */
function catLineTile(l){ const n=(CAT_BYLINE[l.id]||[]).length;
  return `<button type="button" class="cat-tile" data-cat-line="${esc(l.id)}"><span class="cat-ph" style="${catCover(l)}">${l.num?`<span class="cat-num">${catPad(l.num)}</span>`:""}</span>
    <b class="cat-tn">${esc(l.name)}</b><span class="cat-sub">${l.genre?esc(l.genre)+" \u00b7 ":""}${esc(catCap(l.niche))} \u00b7 ${n} designs</span></button>`; }
function catDesignTile(d,showLine){ const l=CAT_LINES[d.line];
  return `<button type="button" class="cat-tile" data-cat-d="${esc(d.id)}"><span class="cat-ph" style="${catThumb(d)}"></span>
    <b class="cat-tn"><span class="cat-no">${catNo(d)}</span> ${esc(d.name)}</b><span class="cat-sub">${showLine?esc(l.name)+" \u00b7 ":""}<i class="cat-dot" style="background:${CAT_SW[d.cc[0]]||"#ccc"}"></i>${d.family==="dark"?"Dark shirts":"Light shirts"}${d.fields.length?" \u00b7 Personalized":""}</span></button>`; }
function catMore(total){ return total>CAT_ST.limit?`<div class="cat-more"><span class="small muted">Showing ${CAT_ST.limit} of ${total}</span><button type="button" class="btn" data-cat="more" data-autoload="1">Loading more…</button></div>`:""; }
function catBody(){
  const q=CAT_ST.q.trim();
  if(q){ const res=catFiltered(); const t=q.toLowerCase().split(/\s+/).filter(Boolean);
    const lines=CAT_DATA.lines.filter(l=>t.every(x=>(l.name+" "+(l.niche||"")+" "+(l.genre||"")).toLowerCase().includes(x)));
    return `<div class="cat-crumb"><button type="button" class="btn ghost" data-cat="clear">\u2039 All lines</button><span class="muted">${res.length} design${res.length===1?"":"s"} match \u201c${esc(q)}\u201d</span></div>
      ${lines.length?`<h3 class="cat-h">Lines and brands</h3><div class="cat-grid">${lines.map(catLineTile).join("")}</div><h3 class="cat-h">Designs</h3>`:""}
      ${res.length?`<div class="cat-grid">${res.slice(0,CAT_ST.limit).map(d=>catDesignTile(d,true)).join("")}</div>${catMore(res.length)}`:`<div class="cat-empty"><b>Nothing matches \u201c${esc(q)}\u201d</b><span>Try one word, like heron, nurse or oyster, or a brand name.</span></div>`}`; }
  const l=CAT_ST.line&&CAT_LINES[CAT_ST.line];
  if(l){ const all=CAT_BYLINE[l.id]||[], list=catFiltered(), colls=Array.isArray(l.collections)?l.collections:[], cur=colls.find(c=>c.id===CAT_ST.coll);
    return `<div class="cat-crumb"><button type="button" class="btn ghost" data-cat="home">\u2039 All lines</button></div>
      <div class="cat-lhead"><span class="cat-ph cat-lcov" style="${catCover(l)}">${l.num?`<span class="cat-num">${catPad(l.num)}</span>`:""}</span><div class="cat-lmeta">
        <h3>${esc(l.name)}</h3><div class="row cat-pills">${l.series?`<span class="pill">Series ${esc(l.series)}${l.genre?" \u00b7 "+esc(l.genre):""}</span>`:""}<span class="pill">${all.length} designs</span><span class="pill">${all.filter(d=>d.family==="dark").length} dark-shirt</span><span class="pill">${all.filter(d=>d.fields.length).length} personalized</span></div>
        <p class="muted cat-niche">${esc(catCap(l.niche))}</p></div></div>
      ${l.blurb?`<p class="cat-blurb">${esc(l.blurb)}</p>`:""}
      ${l.folder?`<div class="cat-path"><code>${esc("Desktop\\"+l.folder)}</code><button type="button" class="btn" data-copy="${esc("Desktop\\"+l.folder)}">Copy folder path</button></div>`:""}
      ${colls.length?`<div class="schbar" role="group" aria-label="Collection">${[{id:"all",label:"All collections"},...colls].map(c=>`<button type="button" class="chip" data-cat-coll="${esc(c.id)}" aria-pressed="${CAT_ST.coll===c.id}">${esc(c.label)}${c.id==="all"?"":` (${all.filter(d=>d.coll===c.id).length})`}</button>`).join("")}</div>${cur&&cur.blurb?`<p class="small muted cat-cblurb">${esc(cur.blurb)}</p>`:""}`:""}
      <div class="schbar" role="group" aria-label="Filter designs">${CAT_FAMS.map(([k,t])=>`<button type="button" class="chip" data-cat-fam="${k}" aria-pressed="${CAT_ST.fam===k}">${t}</button>`).join("")}</div>
      ${list.length?`<div class="cat-grid">${list.slice(0,CAT_ST.limit).map(d=>catDesignTile(d)).join("")}</div>${catMore(list.length)}`:`<div class="cat-empty"><b>No designs match this filter</b><span>Pick \u201cAll\u201d to see every design in this line.</span></div>`}`; }
  const by=s=>CAT_DATA.lines.filter(x=>(x.series||1)===s), cnt=ls=>ls.reduce((a,x)=>a+(CAT_BYLINE[x.id]||[]).length,0);
  return [[3,"Newest niche brands"],[2,"Genre lines, each with two niche brands"],[1,"The house line, the original lines and niche brands 01\u201327"]].map(([s,sub])=>{ const ls=by(s); if(!ls.length) return "";
    return `<h3 class="cat-h">Series ${s} <span class="small muted">${cnt(ls)} designs \u00b7 ${ls.length} lines \u00b7 ${sub}</span></h3><div class="cat-grid cat-lines">${ls.map(catLineTile).join("")}</div>`; }).join(""); }
function vCatalog(){
  if(!CAT_DATA){ if(!CAT_LOADING&&!CAT_ERR) catLoad();
    return `<section class="card cat-root" id="catRoot"><div class="card-head"><div><div class="eyebrow">Elevated Designs</div><h2 class="big">Design catalog</h2></div></div>
      ${CAT_ERR?`<div class="cat-empty"><b>The design catalog didn't load</b><span>${esc(CAT_ERR)}. Check your connection, then try again.</span><button type="button" class="btn primary" data-cat="retry">Retry</button></div>`
        :`<div class="cat-loading" role="status"><span class="cat-spin" aria-hidden="true"></span>Loading designs\u2026</div>`}</section>`; }
  const k=[CAT_ST.q,CAT_ST.line,CAT_ST.coll,CAT_ST.fam,CAT_ST.limit].join("|");
  if(CAT_CACHE.k!==k){ CAT_CACHE.k=k; CAT_CACHE.html=catBody(); }
  const brands=CAT_DATA.lines.filter(l=>l.kind==="brand").length;
  return `<section class="card cat-root" id="catRoot"><div class="card-head cat-top"><div class="cat-brand"><span class="cat-crest" style="${catSpr("img/crest.webp",0,0,1,1)}" aria-hidden="true"></span><div><div class="eyebrow">Elevated Designs</div><h2 class="big">Design catalog</h2>
      <div class="small muted">${CAT_DATA.designs.length} designs \u00b7 ${CAT_DATA.lines.length} lines and brands (${brands} niche brands) \u00b7 open a design to copy its Etsy title, tags and description</div></div></div></div>
    <div class="schbar cat-search"><input id="catQ" type="search" placeholder="Search names, Etsy titles, tags, brands" aria-label="Search designs" value="${esc(CAT_ST.q)}" autocomplete="off"></div>
    ${CAT_CACHE.html}</section>`; }

function catDocList(){ const ds=Array.isArray(S.docs)?S.docs.filter(d=>d&&d.title):[]; const gi=g=>{ const i=CAT_GROUPS.indexOf(g); return i<0?99:i; };
  return ds.map((d,i)=>({d,i})).sort((a,b)=>gi(a.d.group)-gi(b.d.group)||String(a.d.group||"").localeCompare(String(b.d.group||""))||((+a.d.order||0)-(+b.d.order||0))||a.i-b.i).map(x=>x.d); }
function vDocs(){
  const ds=catDocList(); const groups=[...new Set(ds.map(d=>d.group||"Other"))];
  const body=!Array.isArray(S.docs)?`<div class="cat-loading" role="status"><span class="cat-spin" aria-hidden="true"></span>Loading documents\u2026</div>`
    :!ds.length?`<div class="cat-empty"><b>No documents yet</b><span>The business plan, research and guides show up here once they're in the console's database.</span></div>`
    :groups.map(g=>`<h3 class="cat-h">${esc(g)}</h3><div class="cat-docs">${ds.filter(d=>(d.group||"Other")===g).map(d=>`<button type="button" class="cat-doc" data-cat-doc="${esc(d.id)}"><b>${esc(d.title)}</b>${d.desc?`<span>${esc(d.desc)}</span>`:""}${d.minutes?`<em>${esc(d.minutes)} min read</em>`:""}</button>`).join("")}</div>`).join("");
  return `<section class="card cat-root" id="catRoot"><div class="card-head"><div><div class="eyebrow">Elevated Designs</div><h2 class="big">Business docs</h2><div class="small muted">The business plan, research, grants and how-to guides behind the designs${ds.length?` \u00b7 ${ds.length} documents`:""}</div></div></div>
    ${body}
    ${ds.length?`<h3 class="cat-h">Photos on every listing</h3><div class="cat-shared">${CAT_SHARED.map(([s,t])=>`<figure><span class="cat-ph" style="${catSpr(s,0,0,1,1)}"></span><figcaption>${esc(t)}</figcaption></figure>`).join("")}</div>`:""}</section>`; }

/* ---------- interactions ---------- */
function catTop(){ const m=document.getElementById("catRoot"); if(!m) return; const h=(document.querySelector("header.top")||{offsetHeight:0}).offsetHeight; const y=m.getBoundingClientRect().top+scrollY-h-12; if(scrollY>y) window.scrollTo({top:Math.max(0,y)}); }
function catClick(e){ const b=e.target.closest("button"); if(!b||!this.contains(b)) return;
  if(b.dataset.copy!=null){ catCopy(b.dataset.copy,b); return; }
  if(b.dataset.catLine){ CAT_ST.line=b.dataset.catLine; CAT_ST.coll="all"; CAT_ST.fam="all"; CAT_ST.q=""; CAT_ST.limit=120; catSaveNav(); render(); catTop(); return; }
  if(b.dataset.catD){ catOpenDesign(b.dataset.catD,b); return; }
  if(b.dataset.catDoc){ catOpenDoc(b.dataset.catDoc,b); return; }
  if(b.dataset.catColl){ CAT_ST.coll=b.dataset.catColl; CAT_ST.limit=120; catSaveNav(); render(); return; }
  if(b.dataset.catFam){ CAT_ST.fam=b.dataset.catFam; CAT_ST.limit=120; render(); return; }
  const a=b.dataset.cat;
  if(a==="retry"){ CAT_ERR=""; catLoad(); render(); }
  else if(a==="more"){ CAT_ST.limit+=120; render(); }
  else if(a==="home"){ CAT_ST.line=null; CAT_ST.coll="all"; CAT_ST.fam="all"; CAT_ST.limit=120; catSaveNav(); render(); catTop(); }
  else if(a==="clear"){ CAT_ST.q=""; CAT_ST.limit=120; render(); catTop(); } }
function bindCatalog(){
  const open=document.getElementById("catSheet"); if(open&&S.tab!=="catalog"&&S.tab!=="docs") catClose();
  if(S.tab!=="catalog"&&S.tab!=="docs") return;
  const r=document.getElementById("catRoot"); if(r) r.onclick=catClick;
  const q=document.getElementById("catQ"); if(q&&!q._cat){ q._cat=1; q.addEventListener("input",()=>{ clearTimeout(CAT_QT); CAT_QT=setTimeout(()=>{ const v=q.value; if(v.trim()===CAT_ST.q.trim()&&v.length) return; CAT_ST.q=v; CAT_ST.limit=120; render(); },200); });
    q.addEventListener("keydown",e=>{ if(e.key==="Escape"&&q.value){ e.stopPropagation(); q.value=""; CAT_ST.q=""; render(); } }); } }
async function catCopy(t,btn){ let ok=true;
  try{ if(!navigator.clipboard||!window.isSecureContext) throw 0; await navigator.clipboard.writeText(t); }
  catch{ const ta=document.createElement("textarea"); ta.value=t; ta.setAttribute("readonly",""); ta.style.cssText="position:fixed;top:0;left:0;opacity:0"; document.body.appendChild(ta); ta.select(); try{ ok=document.execCommand("copy"); }catch{ ok=false; } ta.remove(); }
  if(!ok){ toast("Couldn't copy \u2014 select the text instead"); return; }
  toast("Copied"); if(btn){ if(!btn._o) btn._o=btn.textContent; btn.textContent="Copied"; btn.classList.add("cat-done"); clearTimeout(btn._t); btn._t=setTimeout(()=>{ btn.textContent=btn._o; btn._o=""; btn.classList.remove("cat-done"); },1300); } }

/* ---------- side sheet (outside #main so re-renders never wipe it) ---------- */
let CAT_RET=null;
function catKey(e){ const box=document.getElementById("catSheet"); if(!box) return;
  if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); catClose(); return; }
  const d=box.dataset.design&&CAT_BYID[box.dataset.design]; if(!d||/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||"")) return;
  if(e.key==="ArrowRight"||e.key==="ArrowLeft"){ const b=box.querySelector(`[data-cs="${e.key==="ArrowRight"?"next":"prev"}"]`); if(b&&!b.disabled){ e.preventDefault(); b.click(); } } }
function catClose(){ const box=document.getElementById("catSheet"); document.removeEventListener("keydown",catKey,true); if(box) box.remove(); document.body.classList.remove("cat-lock");
  const r=CAT_RET; CAT_RET=null; try{ if(r&&document.contains(r)) r.focus({preventScroll:true}); }catch{} }
function catSheet(label,html,ret){ let box=document.getElementById("catSheet"); const fresh=!box;
  if(fresh){ CAT_RET=ret||document.activeElement; box=document.createElement("div"); box.id="catSheet"; box.className="xsheet cat-sheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true");
    box.addEventListener("click",e=>{ if(e.target===box) return catClose(); const b=e.target.closest("button"); if(!b) return; if(b.dataset.copy!=null) return catCopy(b.dataset.copy,b); catSheetBtn(b,box); });
    document.body.appendChild(box); document.addEventListener("keydown",catKey,true); document.body.classList.add("cat-lock"); }
  box.setAttribute("aria-label",label); box.innerHTML=`<div class="xpanel cat-panel" tabindex="-1">${html}</div>`;
  const p=box.firstElementChild; p.scrollTop=0; p.focus({preventScroll:true}); return box; }
function catSheetBtn(b,box){ const cs=b.dataset.cs;
  if(cs==="close") return catClose();
  if(cs==="prev"||cs==="next"){ if(b.dataset.id) catOpenDesign(b.dataset.id); return; }
  if(cs==="more"){ const el=box.querySelector(".cat-desc"); el.classList.toggle("open"); b.textContent=el.classList.contains("open")?"Show less":"Show full description"; return; }
  if(cs==="to"){ const h=box.querySelector("#"+CSS.escape(b.dataset.to)); if(h) h.scrollIntoView({behavior:"smooth",block:"start"}); return; }
  if(b.dataset.img!=null){ const d=CAT_BYID[box.dataset.design]; if(!d) return; const i=+b.dataset.img, im=d.images[i]||{}, big=box.querySelector(".cat-big");
    big.setAttribute("style",catGal(d,i)); big.setAttribute("aria-label",(d.alt&&d.alt[im.k])||d.name); box.querySelector(".cat-cap").textContent=im.label||"";
    box.querySelectorAll(".cat-th button").forEach((x,j)=>x.setAttribute("aria-current",String(j===i))); } }
function catOpenDesign(id,ret){ const d=CAT_BYID[id]; if(!d){ toast("That design isn't in the catalog"); return; }
  const l=CAT_LINES[d.line], sib=CAT_LIST.includes(d)?CAT_LIST:CAT_BYLINE[d.line], ix=sib.indexOf(d), prev=sib[ix-1], next=sib[ix+1];
  const path="Desktop\\"+d.folder+"\\Print Files", pr=d.price, alt=d.alt||{};
  const facts=[d.family==="dark"?"Dark shirts":"Light shirts",d.layout==="full"?"Full front print":"Chest print",d.backPrint?"Back print":"No back print"];
  const prow=(n,o)=>o?`<tr><td>${n}</td>${Object.values(o).map(v=>`<td>$${(+v).toFixed(2)}</td>`).join("")}</tr>`:"";
  const box=catSheet(d.name,`<div class="xhead"><div class="cat-shead"><div class="small muted">${esc(l.name)} \u00b7 ${catNo(d)} \u00b7 ${ix+1} of ${sib.length}</div><h2>${esc(d.name)}</h2></div>
      <div class="cat-nav"><button type="button" class="btn" data-cs="prev" ${prev?`data-id="${esc(prev.id)}"`:"disabled"} aria-label="Previous design">\u2039</button><button type="button" class="btn" data-cs="next" ${next?`data-id="${esc(next.id)}"`:"disabled"} aria-label="Next design">\u203a</button><button type="button" class="btn" data-cs="close" aria-label="Close">\u2715</button></div></div>
    <div class="cat-cols"><section class="cat-gal" aria-label="Photos"><div class="cat-ph cat-big" role="img" style="${catGal(d,0)}" aria-label="${esc(alt[d.images[0].k]||d.name)}"></div>
        <div class="small muted cat-cap">${esc(d.images[0].label||"")}</div>
        ${d.images.length>1&&catHasGal(d)?`<div class="cat-th">${d.images.map((im,i)=>`<button type="button" class="cat-ph" data-img="${i}" aria-current="${i===0}" aria-label="${esc(im.label||"Photo "+(i+1))}" style="${catGal(d,i)}"></button>`).join("")}</div>`:""}</section>
      <section class="cat-info"><div class="row cat-pills">${facts.map(f=>`<span class="pill">${f}</span>`).join("")}${d.fields.length?`<span class="pill acc">Personalized: ${esc(d.fields.map(f=>catCap(String(f).toLowerCase())).join(", "))}</span>`:""}</div>
        <div class="cat-blk"><div class="cat-bh"><h4>Etsy title</h4><button type="button" class="btn" data-copy="${esc(d.title)}" aria-label="Copy Etsy title">Copy</button></div><p class="cat-etitle">${esc(d.title)}</p><div class="small muted">${String(d.title||"").length} of 140 characters</div></div>
        <div class="cat-blk"><div class="cat-bh"><h4>Tags</h4><button type="button" class="btn" data-copy="${esc(d.tags.join(", "))}" aria-label="Copy all tags">Copy all</button></div><div class="cat-tags">${d.tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div><div class="small muted">${d.tags.length} of 13 tags</div></div>
        <div class="cat-blk"><div class="cat-bh"><h4>Description</h4><button type="button" class="btn" data-copy="${esc(catPlain(d.description))}" aria-label="Copy description">Copy</button></div><div class="cat-desc">${catMd(d.description)}</div><button type="button" class="btn ghost cat-link" data-cs="more">Show full description</button></div>
        ${d.personalization?`<div class="cat-blk"><div class="cat-bh"><h4>Personalization</h4><button type="button" class="btn" data-copy="${esc(d.personalization)}" aria-label="Copy personalization instructions">Copy</button></div><p>${esc(d.personalization)}</p></div>`:""}
        <div class="cat-blk"><h4>Shirt colors</h4><dl class="cat-colors"><dt>Comfort Colors 1717</dt><dd>${d.cc.map(catSwatch).join("")||"\u2014"}</dd><dt>Bella+Canvas 3001</dt><dd>${d.bc.map(catSwatch).join("")||"\u2014"}</dd></dl></div>
        ${pr&&(pr.cc1717||pr.bc3001)?`<div class="cat-blk"><h4>Minimum prices</h4><div class="tblwrap"><table class="tbl"><thead><tr><th>Shirt</th>${Object.keys(pr.cc1717||pr.bc3001).map(k=>`<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${prow("Comfort Colors 1717",pr.cc1717)}${prow("Bella+Canvas 3001",pr.bc3001)}</tbody></table></div></div>`:""}
        <div class="cat-blk"><h4>Print files</h4><div class="cat-path"><code>${esc(path)}</code><button type="button" class="btn" data-copy="${esc(path)}" aria-label="Copy folder path">Copy</button></div>
          <ul class="cat-files">${d.printFiles.map(f=>`<li>${esc(f)}</li>`).join("")}</ul><p class="small muted">300 DPI transparent PNGs live on your computer.</p></div>
      </section></div>`,ret);
  box.dataset.design=d.id; }
function catSanitize(html){ const t=document.createElement("template"); t.innerHTML=String(html||"");
  t.content.querySelectorAll("script,iframe,frame,frameset,object,embed,style,link,meta,base,form,svg,math,noscript,template").forEach(n=>n.remove());
  t.content.querySelectorAll("*").forEach(el=>{ for(const a of [...el.attributes]){ const n=a.name.toLowerCase(), v=a.value.replace(/[\s\u0000-\u001f]+/g,"").toLowerCase();
      if(n.startsWith("on")||n==="style"||n==="srcdoc"||n==="formaction"||n==="action") el.removeAttribute(a.name);
      else if(["href","src","xlink:href","poster","background","srcset"].includes(n)&&/^(javascript|vbscript|data):/.test(v)&&!(n==="src"&&el.tagName==="IMG"&&/^data:image\/(png|jpe?g|gif|webp);/.test(v))) el.removeAttribute(a.name);
      else if(n==="id") el.setAttribute("id","cd-"+a.value); }
    if(el.tagName==="A"){ const h=el.getAttribute("href")||""; if(/^https?:/i.test(h)){ el.target="_blank"; el.rel="noopener noreferrer"; } else if(h.startsWith("#")) el.setAttribute("href","#cd-"+h.slice(1)); }
    if(el.tagName==="INPUT"){ el.disabled=true; } });
  t.content.querySelectorAll("table").forEach(tb=>{ if(tb.parentElement&&tb.parentElement.classList&&tb.parentElement.classList.contains("cat-tw")) return; const w=document.createElement("div"); w.className="cat-tw"; tb.replaceWith(w); w.appendChild(tb); });
  return t.innerHTML; }
function catOpenDoc(id,ret){ const d=(Array.isArray(S.docs)?S.docs:[]).find(x=>x&&x.id===id); if(!d){ toast("That document isn't loaded yet"); return; }
  const key=d.id+":"+String(d.html||"").length; if(!CAT_DOCHTML[key]) CAT_DOCHTML[key]=catSanitize(d.html);
  const box=catSheet(d.title||"Document",`<div class="xhead"><div class="cat-shead"><div class="small muted">${esc(d.group||"Document")}${d.minutes?` \u00b7 ${esc(d.minutes)} min read`:""}</div><h2>${esc(d.title)}</h2></div><button type="button" class="btn" data-cs="close" aria-label="Close">\u2715</button></div>
    ${d.desc?`<p class="cat-lead">${esc(d.desc)}</p>`:""}<details class="cat-toc"></details><article class="cat-prose">${CAT_DOCHTML[key]}</article>`,ret);
  box.dataset.design=""; const hs=[...box.querySelectorAll(".cat-prose h2")]; hs.forEach((h,i)=>{ if(!h.id) h.id="cd-s"+i; });
  const toc=box.querySelector(".cat-toc"); if(hs.length>2) toc.innerHTML=`<summary>On this page (${hs.length} sections)</summary><div class="cat-tocl">${hs.map(h=>`<button type="button" class="chip" data-cs="to" data-to="${esc(h.id)}">${esc(h.textContent.trim().slice(0,60))}</button>`).join("")}</div>`; else toc.remove();
  box.querySelectorAll('.cat-prose a[href^="#"]').forEach(a=>a.addEventListener("click",e=>{ let h=null; try{ h=box.querySelector("#"+CSS.escape(a.getAttribute("href").slice(1))); }catch{} if(h){ e.preventDefault(); h.scrollIntoView({behavior:"smooth"}); } })); }

/* ================= SEO & KNOWLEDGE: what the team follows, uses and searches — editable by Aaron ================= */
const KX={view:"sources", q:""};
const KX_KINDS={
  sources:{doc:"knowledge/sources", title:"Data sources", one:"data source",
    fields:[["name","Name","text",1,"e.g. Google Search"],["kind","Type","select",0,["Search engine","Crawler / page fetch","API / data feed","Marketplace","Social platform","News / updates blog","Analytics","Other"]],["url","Link","url",0,"https://…"],["usedFor","Used for","text",0,"e.g. keyword rankings, competitor prices"],["who","Who uses it (names, comma separated)","text",0,"sage, nora"],["notes","Notes / limits","textarea",0,"e.g. max 30 results per keyword"],["enabled","On (the team may use it)","check"]]},
  skills:{doc:"knowledge/skills", title:"Skills & tools", one:"skill",
    fields:[["name","Skill name","text",1,"e.g. searchfit-seo:seo-audit"],["use","When to use it","textarea",0,"e.g. full audit of a site, monthly"],["who","Who uses it (names, comma separated)","text",0,"sage, carla"],["enabled","On (Max keeps it in the team's training)","check"]]},
  training:{doc:"knowledge/training", title:"Training & docs", one:"document",
    fields:[["title","Title","text",1,"e.g. Google SEO Starter Guide"],["url","Link","url",0,"https://…"],["kind","Type","select",0,["Official guide","Rulebook","Course / tutorial","Article","Internal doc","Other"]],["who","Who should learn from it","text",0,"everyone, or: sage, tina"],["notes","What to take from it","textarea",0,""],["preferred","Preferred — follow this first when sources disagree","check"]]},
  keywords:{doc:"seo/keywords", title:"Target keywords", one:"keyword",
    fields:[["keyword","Keyword or phrase","text",1,"e.g. charleston t shirts"],["property","Site / shop it's for","text",0,"e.g. xzqxnd-er.myshopify.com"],["intent","Searcher wants to","select",0,["buy","learn","find locally","find our brand","compare"]],["url","Page that should rank (optional)","url",0,"https://…"]]},
  rules:{doc:"seo/playbook", title:"SEO rulebook", one:"rule",
    fields:[["section","Section","text",1,"e.g. On-page tags"],["rule","Rule","text",1,"e.g. Title under 60 characters"],["how","How to apply / check it","textarea",0,""]]}
};
const kxCan=()=>canEditSched();
function kxDoc(kind){ return kind==="keywords"?{items:S.seoKeywords||[]}:kind==="rules"?(S.playbook||{}):((S.knowledge||{})[kind]||{}); }
function kxItems(kind){ if(kind==="rules"){ const out=[]; ((S.playbook||{}).sections||[]).forEach((sec,si)=>(Array.isArray(sec.items)?sec.items:[]).forEach((it,ii)=>{ if(it&&typeof it==="object") out.push({...it,section:String(sec.title||""),_si:si,_ii:ii}); })); return out; }
  const it=kxDoc(kind).items; return Array.isArray(it)?it.filter(x=>x&&typeof x==="object"):[]; }
const kxDomain=u=>{ try{ return new URL(/^https?:/i.test(u)?u:"https://"+u).hostname.replace(/^www\./,"").toLowerCase(); }catch{ return String(u||"").toLowerCase().slice(0,60); } };
/* every place the search jobs look, grouped by site */
function kxSites(){ const by={}; (S.research||[]).filter(r=>!r.removed).forEach(r=>(Array.isArray(r.sources)?r.sources:[]).forEach(u=>{ const d=kxDomain(u); if(!d) return; const e=by[d]=by[d]||{d,jobs:new Set(),tasks:new Set(),on:0}; e.jobs.add(r.label||r.id); const t=S.triggers[r.trigger]; e.tasks.add(t?String(t.name).split(" ·")[0]:(r.agent||"?")); if(r.enabled!==false) e.on++; }));
  return Object.values(by).map(e=>({...e,jobs:[...e.jobs],tasks:[...e.tasks]})).sort((a,b)=>b.jobs.length-a.jobs.length||a.d.localeCompare(b.d)); }
function vKnowledge(){ const ed=kxCan(), K=S.knowledge||{}; const blocked=new Set((K.sources&&Array.isArray(K.sources.blocked)?K.sources.blocked:[]).map(String));
  const n=k=>kxItems(k).length, sites=kxSites();
  const tab=(k,l,c)=>`<button class="chip" data-kxv="${k}" aria-pressed="${KX.view===k}">${l}${c!=null?` <span class="muted">${c}</span>`:""}</button>`;
  const q=KX.q.trim().toLowerCase(); const hit=o=>!q||JSON.stringify(o).toLowerCase().includes(q);
  let body="";
  if(KX.view==="sites"){ const rows=sites.filter(hit);
    body=`<p class="small muted">Every website the search jobs look at, from all tasks' search settings. Block a site to tell every task to skip it (you can unblock any time). To add or remove a site for one task, use Search settings.</p>
      <div class="tablewrap"><table class="tbl"><tr><th>Site</th><th>Search jobs</th><th>Tasks</th><th></th></tr>${rows.map(e=>`<tr class="${blocked.has(e.d)?"off":""}"><td><b>${esc(e.d)}</b>${blocked.has(e.d)?` <span class="pill bad">Blocked</span>`:""}</td><td class="small">${e.jobs.length} · ${esc(e.jobs.slice(0,3).join(", "))}${e.jobs.length>3?" …":""}</td><td class="small">${esc(e.tasks.join(", "))}</td><td>${ed?`<button class="btn" data-kxblock="${esc(e.d)}">${blocked.has(e.d)?"Unblock":"Block"}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="4" class="muted">No sites match.</td></tr>`}</table></div>`; }
  else if(KX.view==="rules"){ const pb=S.playbook||{}; const secs=Array.isArray(pb.sections)?pb.sections:[];
    body=`<p class="small muted">${esc(pb.summary||"The team's SEO rules. Sage reads this every run and trains the team from it.")}${pb.version?` · version ${esc(pb.version)}`:""}</p>
      ${secs.map((sec,si)=>{ const items=(Array.isArray(sec.items)?sec.items:[]).map((it,ii)=>({it,ii})).filter(x=>hit([sec.title,x.it])); if(q&&!items.length) return "";
        return `<details class="pbsec" ${q?"open":""}><summary><b>${esc(sec.title)}</b> <span class="muted small">· ${(sec.items||[]).length} rules</span></summary><div class="list">${items.map(({it,ii})=>`<div class="row"><div style="flex:1;min-width:0"><b>${esc(it.rule)}</b><div class="small muted">${esc(it.how||"")}</div></div>${ed?`<button class="btn" data-kxedit="rules:${si}.${ii}">Edit</button>`:""}</div>`).join("")}</div></details>`; }).join("")||`<p class="muted">No rules yet.</p>`}`; }
  else { const kind=KX.view, items=kxItems(kind).map((it,i)=>({it,i})).filter(x=>hit(x.it));
    const line={sources:it=>`<b>${esc(it.name)}</b> <span class="pill">${esc(it.kind||"Other")}</span>${it.enabled===false?` <span class="pill">Off</span>`:""}<div class="small muted">${esc([it.usedFor,it.who&&"used by "+it.who,it.notes].filter(Boolean).join(" · "))}</div>${safeUrl(it.url)?`<a class="small" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(String(it.url).replace(/^https?:\/\/(www\.)?/,"").slice(0,60))} ↗</a>`:""}`,
      skills:it=>`<b>${esc(it.name)}</b>${it.enabled===false?` <span class="pill">Off</span>`:""}<div class="small muted">${esc([it.use,it.who&&"used by "+it.who].filter(Boolean).join(" · "))}</div>`,
      training:it=>`<b>${esc(it.title)}</b> ${it.preferred?`<span class="pill ok">Preferred</span>`:""} <span class="pill">${esc(it.kind||"Doc")}</span><div class="small muted">${esc([it.who&&"for "+it.who,it.notes].filter(Boolean).join(" · "))}</div>${safeUrl(it.url)?`<a class="small" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(String(it.url).replace(/^https?:\/\/(www\.)?/,"").slice(0,60))} ↗</a>`:""}`,
      keywords:it=>`<b>${esc(it.keyword)}</b> <span class="pill">${esc(it.intent||"—")}</span><div class="small muted">${esc([it.property,it.position!=null?"Google position "+it.position:"not ranked yet"].filter(Boolean).join(" · "))}</div>`}[kind];
    body=`<div class="list">${items.map(({it,i})=>`<div class="row"><div style="flex:1;min-width:0">${line(it)}</div>${ed?`<button class="btn" data-kxedit="${kind}:${i}">Edit</button>`:""}</div>`).join("")||`<p class="muted">${q?"Nothing matches.":"Nothing here yet."}</p>`}</div>`; }
  const bak=K["bak_"+(KX.view==="sites"?"sources":KX.view)];
  return `<section class="card"><div class="card-head"><h2 class="big">SEO & knowledge</h2><span class="eyebrow">what the team follows, uses and searches</span>${ed&&KX.view!=="sites"?`<button class="btn primary" data-kxadd="${KX.view}">+ Add ${esc(KX_KINDS[KX.view].one)}</button>`:""}</div>
    <p class="small muted" style="margin-top:0">Every task reads this list at the start of each run: sources that are off or blocked are skipped, preferred documents win when advice disagrees, and Max trains the team on the skills here every Saturday. ${ed?"Changes apply to the next run.":"Only Aaron, signed in with his PIN, can change it."}</p>
    <div class="chips" role="tablist" style="margin:10px 0">${tab("sources","Data sources",n("sources"))}${tab("sites","Sites searched",sites.length)}${tab("rules","SEO rules",n("rules"))}${tab("keywords","Keywords",n("keywords"))}${tab("skills","Skills",n("skills"))}${tab("training","Training docs",n("training"))}</div>
    <div class="schbar"><input type="search" id="kxQ" placeholder="Search this list" value="${esc(KX.q)}" aria-label="Search this list">${ed&&bak&&KX.view!=="keywords"?`<button class="btn" data-kxundo="${KX.view==="sites"?"sources":KX.view}">Undo last change</button>`:""}</div>
    <div style="margin-top:12px">${body}</div></section>`; }
/* ---- writes (owner only, read-modify-write on the latest saved copy, one-step undo backup) ---- */
const KXQ={};
async function kxWrite(kind,fn,msg){ if(!kxCan()){ toast("Only Aaron, signed in with his PIN, can change this."); return false; } if(!db) return false;
  const prev=KXQ[kind]||Promise.resolve(); let done; KXQ[kind]=new Promise(r=>done=r); await prev;
  const path=KX_KINDS[kind].doc, ref=db.doc(path);
  try{ const cur=await ref.get(); const old=cur.exists?cur.data():{}; const next=fn(JSON.parse(JSON.stringify(old))); if(!next||next.err){ if(next&&next.err) toast(next.err); return next&&next.err?{err:next.err}:false; }
    next.updatedAt=new Date().toISOString(); next.updatedBy=CUR;
    await ref.set(next);
    if(kind!=="keywords"){ const bak={at:new Date().toISOString(),by:CUR,data:old,afterAt:next.updatedAt}; await db.doc("knowledge/bak_"+kind).set(bak); S.knowledge=S.knowledge||{}; S.knowledge["bak_"+kind]=bak; } kxLocal(kind,next); toast(msg||"Saved. The team uses it from the next run."); render(); return true; }
  catch(e){ console.error("knowledge save",e); toast("Couldn't save. Try again."); return false; }
  finally{ done(); } }
function kxLocal(kind,data){ if(kind==="keywords") S.seoKeywords=Array.isArray(data.items)?data.items:[]; else if(kind==="rules") S.playbook=data; else { S.knowledge=S.knowledge||{}; S.knowledge[kind]=data; } }
function kxBumpVersion(v){ const m=String(v||"").match(/^(\d+)\.(\d+)$/); return m?`${m[1]}.${+m[2]+1}`:(v?String(v)+"+":"1.0"); }
/* one-step undo, only while nobody has changed the list since that edit */
async function kxUndo(kind){ if(!kxCan()||!db) return; const prev=KXQ[kind]||Promise.resolve(); let done; KXQ[kind]=new Promise(r=>done=r); await prev;
  try{ const bref=db.doc("knowledge/bak_"+kind), bs=await bref.get(); const b=bs.exists?bs.data():null; if(!b){ toast("Nothing to undo."); return; }
    const ref=db.doc(KX_KINDS[kind].doc), cur=await ref.get(), now=cur.exists?cur.data():{};
    if(String(now.updatedAt||"")!==String(b.afterAt||"")){ toast("This list changed after your last edit, so that undo is no longer safe. Edit the item directly."); await bref.delete(); if(S.knowledge) delete S.knowledge["bak_"+kind]; render(); return; }
    const data={...(b.data||{}),updatedAt:new Date().toISOString(),updatedBy:CUR}; await ref.set(data); kxLocal(kind,data); await bref.delete(); if(S.knowledge) delete S.knowledge["bak_"+kind]; toast("Undone."); render(); }
  catch(e){ toast("Couldn't undo. Try again."); }
  finally{ done(); } }
async function kxBlock(d){ await kxWrite("sources",old=>{ const bl=new Set(Array.isArray(old.blocked)?old.blocked:[]); bl.has(d)?bl.delete(d):bl.add(d); return {...old,items:Array.isArray(old.items)?old.items:[],blocked:[...bl].sort()}; }, "Saved. Every task skips or uses that site from its next run."); }
/* ---- add / edit sheet ---- */
function kxOpen(kind,ref){ const K=KX_KINDS[kind]; let item={}; const isNew=ref==null;
  if(!isNew){ if(kind==="rules"){ const [si,ii]=String(ref).split(".").map(Number); const sec=((S.playbook||{}).sections||[])[si]; const it=sec&&(sec.items||[])[ii]; if(!it) return; item={...it,section:sec.title}; } else { item=kxItems(kind)[+ref]; if(!item) return; } }
  else if(kind==="sources"||kind==="skills") item={enabled:true};
  const opener=document.activeElement; const box=document.createElement("div"); box.id="kxSheet"; box.className="xsheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-label",(isNew?"Add ":"Edit ")+K.one);
  const secs=((S.playbook||{}).sections||[]).map(s=>s.title);
  const fld=([k,l,type,req,ph])=>{ const v=item[k]; const id="kx_"+k;
    if(type==="check") return `<label class="fld"><input type="checkbox" id="${id}" ${(k==="preferred"?v===true:(isNew||v!==false))?"checked":""}> ${esc(l)}</label>`;
    if(type==="select") return `<label class="fld">${esc(l)} <select id="${id}">${(ph||[]).map(o=>`<option ${String(v||"")===o?"selected":""}>${esc(o)}</option>`).join("")}</select></label>`;
    if(type==="textarea") return `<label class="fld">${esc(l)} <textarea id="${id}" rows="3" placeholder="${esc(ph||"")}">${esc(v||"")}</textarea></label>`;
    return `<label class="fld">${esc(l)}${req?" *":""} <input id="${id}" value="${esc(v||"")}" placeholder="${esc(ph||"")}" ${k==="section"?'list="kxSecs"':""} maxlength="${type==="url"?400:200}"></label>`; };
  box.innerHTML=`<div class="xpanel"><div class="xhead"><h2>${isNew?"Add":"Edit"} ${esc(K.one)}</h2><button class="btn" data-x>Close</button></div>
    ${kind==="rules"?`<datalist id="kxSecs">${secs.map(s=>`<option value="${esc(s)}">`).join("")}</datalist>`:""}
    ${K.fields.map(fld).join("")}
    <div class="row"><button class="btn primary" id="kxSave">Save</button>${isNew?"":`<button class="btn ghost" id="kxDel">Remove</button>`}<span class="small bad" id="kxErr" role="alert"></span></div></div>`;
  document.body.appendChild(box);
  const close=()=>{ box.remove(); if(opener&&opener.isConnected) try{opener.focus({preventScroll:true})}catch{} };
  box.querySelector("[data-x]").onclick=close; box.onclick=e=>{ if(e.target===box) close(); };
  setTimeout(()=>{ const f=box.querySelector("input,textarea,select"); if(f) f.focus({preventScroll:true}); },30);
  const read=()=>{ const o={}; for(const [k,l,type,req] of K.fields){ const el=box.querySelector("#kx_"+k); let v=type==="check"?el.checked:el.value.trim();
      if(req&&!v) return {err:`${l} is required.`}; if(type==="url"&&v){ if(!/^https?:\/\//i.test(v)) v="https://"+v; if(!safeUrl(v)) return {err:"Links must be web addresses (https://…)."}; } o[k]=v; } return o; };
  const err=box.querySelector("#kxErr"); let busy=false;
  box.querySelector("#kxSave").onclick=async()=>{ if(busy) return; const v=read(); if(v.err){ err.textContent=v.err; return; } err.textContent=""; busy=true;
    const ok=await kxWrite(kind,old=>kxApply(kind,old,ref,v,item),isNew?"Added. The team uses it from the next run.":"Saved. The team uses it from the next run."); busy=false; if(ok===true) close(); else if(ok&&ok.err) err.textContent=ok.err; };
  const del=box.querySelector("#kxDel"); if(del) del.onclick=async()=>{ if(!confirmInline(del,"Tap again to remove")) return; if(busy) return; busy=true; const ok=await kxWrite(kind,old=>kxApply(kind,old,ref,null,item),"Removed. Undo is at the top of the list."); busy=false; if(ok===true) close(); else if(ok&&ok.err) err.textContent=ok.err; }; }
/* apply an add/edit/remove to the latest saved doc; items are matched by content, not position, so a teammate's write in between isn't lost */
function kxApply(kind,old,ref,val,orig){
  if(kind==="rules"){ const secs=Array.isArray(old.sections)?old.sections:[]; old.sections=secs;
    if(ref!=null){ const s=secs.find(x=>x.title===orig.section); const ix=s?(s.items||[]).findIndex(x=>x.rule===orig.rule):-1; if(ix<0) return {err:"That rule changed since you opened it. Close and try again."}; s.items.splice(ix,1); if(!s.items.length) secs.splice(secs.indexOf(s),1); }
    if(val){ let s=secs.find(x=>x.title.toLowerCase()===val.section.toLowerCase()); if(!s){ s={title:val.section,items:[]}; secs.push(s); } s.items=Array.isArray(s.items)?s.items:[]; if(s.items.some(x=>x.rule.toLowerCase()===val.rule.toLowerCase())) return {err:"That rule is already in that section."}; s.items.push({rule:val.rule,how:val.how||""}); }
    old.version=kxBumpVersion(old.version); return old; }
  const key=kind==="sources"||kind==="skills"?"name":kind==="training"?"title":"keyword";
  const items=Array.isArray(old.items)?old.items:[]; old.items=items; let ix=-1;
  if(ref!=null){ ix=items.findIndex(x=>String(x[key]).toLowerCase()===String(orig[key]).toLowerCase()); if(ix<0) return {err:"That item changed since you opened it. Close and try again."}; }
  if(val&&items.some((x,i)=>i!==ix&&String(x[key]).toLowerCase()===String(val[key]).toLowerCase())) return {err:"That's already on the list."};
  if(!val){ items.splice(ix,1); return old; }
  const next={...(ix>=0?items[ix]:{}),...val}; if(kind==="keywords"&&ix<0){ next.position=null; next.prevPosition=null; }
  if(ix>=0) items[ix]=next; else items.push(next); return old; }
function bindKnowledge(){ document.querySelectorAll("[data-kxv]").forEach(b=>b.onclick=()=>{ KX.view=b.dataset.kxv; KX.q=""; render(); });
  const q=$("#kxQ"); if(q) q.oninput=()=>{ KX.q=q.value; render(); };
  document.querySelectorAll("[data-kxadd]").forEach(b=>b.onclick=()=>kxOpen(b.dataset.kxadd,null));
  document.querySelectorAll("[data-kxedit]").forEach(b=>b.onclick=()=>{ const [k,r]=b.dataset.kxedit.split(":"); kxOpen(k,r); });
  document.querySelectorAll("[data-kxblock]").forEach(b=>b.onclick=()=>{ b.disabled=true; kxBlock(b.dataset.kxblock); });
  document.querySelectorAll("[data-kxundo]").forEach(b=>b.onclick=()=>{ if(confirmInline(b,"Tap again to undo")) kxUndo(b.dataset.kxundo); }); }
