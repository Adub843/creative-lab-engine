/* ---------- Pricing & fees + upcoming charges ---------- */
const FEE={ /* per-sale fee model, US seller; source: pricing/fees doc (Oct 2026) */
  "Etsy":{f:(item,ship)=>0.20+0.065*(item+ship)+0.03*(item+ship)+0.25, note:"$0.20 listing + 6.5% transaction + 3% + $0.25 processing (Offsite Ads +15% if a sale comes from one)"},
  "Shopify Basic":{f:(item,ship)=>0.029*(item+ship)+0.30, monthly:39, note:"2.9% + $0.30 card fee with Shopify Payments, plus $39/mo plan ($29 yearly; $1/mo first 3 months)"},
  "TikTok Shop":{f:(item,ship)=>0.06*(item+ship), note:"~6% of order incl. shipping (2026 rate unconfirmed; affiliate commissions extra)"},
  "eBay":{f:(item,ship)=>0.136*(item+ship)+0.40, note:"13.6% final value fee + $0.40 per order"},
  "Amazon Handmade":{f:(item,ship)=>Math.max(1,0.15*(item+ship)), note:"15% referral (min $1), plan fee waived after approval"},
  "Amazon Professional":{f:(item,ship,cat)=>(cat==="jewelry"?0.20:cat==="home"?0.15:0.17)*(item+ship), monthly:39.99, note:"17% clothing / 20% jewelry / 15% home referral + $39.99/mo"},
  "Walmart":{f:(item,ship,cat)=>(cat==="jewelry"?0.20:0.15)*(item+ship), note:"15% apparel & home / 20% jewelry referral; approval needs sales history"},
  "In person (Square)":{f:(item)=>0.026*item+0.15, note:"2.6% + $0.15 per tap/dip; no shipping"}};
function money$(n){ return (n<0?"-$":"$")+Math.abs(n).toFixed(2); }
function upcomingCharges(){ const now=new Date(); now.setHours(0,0,0,0); const lim=new Date(now.getTime()+7*864e5);
  const due=S.bills.filter(b=>b.status!=="canceled"&&b.nextCharge&&new Date(b.nextCharge+"T12:00")>=now&&new Date(b.nextCharge+"T12:00")<=lim).sort((a,b)=>a.nextCharge.localeCompare(b.nextCharge));
  const trials=S.bills.filter(b=>b.status==="trial"); const pend=S.billchanges.filter(c=>c.status==="pending");
  if(!due.length&&!trials.length&&!pend.length) return "";
  const items=[...due.map(b=>`<li>${esc(b.service)} · ${esc(b.amount||"")} on ${esc(b.nextCharge)} (${esc(cardLabel(b.paidWith))})</li>`),
    ...trials.map(b=>`<li>${esc(b.service)} is on a trial and starts charging when it ends${b.nextCharge?" ("+esc(b.nextCharge)+")":""}</li>`)].join("");
  return `<div class="alertbar" id="billing" role="status"><span class="ic" aria-hidden="true">$</span><div style="flex:1;min-width:0"><b>Before anything is billed</b>
    ${items?`<ul class="small">${items}</ul>`:""}${billChangesCard()}</div></div>`; }
function vPricing(){
  const d=S.pricing; if(!d) return `<section class="card" style="margin-top:20px"><div class="empty">Loading the fee research…</div></section>`;
  const prods=d.products||[]; const pi=Math.min(S.priceProd||0,Math.max(0,prods.length-1)); const pr=prods[pi];
  const rows=pr?pr.perPlatform.slice().sort((a,b)=>b.profit-a.profit):[]; const pmax=Math.max(1,...rows.map(r=>r.profit));
  const cats={0:"apparel",1:"apparel",2:"home",3:"jewelry"};
  const c=S.calc||{plat:"Etsy",price:28,ship:5,cost:11.7,label:5.75,cat:"apparel",qty:20}; S.calc=c;
  const fee=FEE[c.plat].f(+c.price||0,c.plat.startsWith("In person")?0:(+c.ship||0),c.cat); const inPerson=c.plat.startsWith("In person");
  const revenue=(+c.price||0)+(inPerson?0:(+c.ship||0)); const profit=revenue-fee-(+c.cost||0)-(inPerson?0:(+c.label||0)); const margin=revenue?profit/revenue*100:0;
  const monthly=FEE[c.plat].monthly||0; const be=profit>0?Math.ceil(monthly/profit):null;
  const sortKey=S.platSort||"name";
  const plats=(d.platforms||[]).slice().sort((a,b)=>String(a[sortKey]||a.name).localeCompare(String(b[sortKey]||b.name)));
  const mtext=v=>v==null?"—":typeof v==="number"?(v?"$"+v:"$0"):typeof v==="object"?Object.entries(v).map(([k,x])=>k+": "+(typeof x==="object"?Object.entries(x).map(([a,b])=>a.replace("Billing","")+" $"+b).join(" / "):(typeof x==="number"?"$"+x:x))).join(" · "):String(v);
  return `<section class="card" style="margin-top:20px"><div class="card-head"><h2>Profit calculator</h2><span class="eyebrow">change any number · fees update live</span></div>
    <form class="calc" id="calcForm" onsubmit="return false">
      <label>Where it sells<select id="cPlat">${Object.keys(FEE).map(k=>`<option ${k===c.plat?"selected":""}>${k}</option>`).join("")}</select></label>
      <label>Product type<select id="cCat">${[["apparel","Shirts & hoodies"],["home","Home & decor"],["jewelry","Jewelry & pendants"]].map(([k,l])=>`<option value="${k}" ${k===c.cat?"selected":""}>${l}</option>`).join("")}</select></label>
      <label>Price ($)<input type="number" step="0.5" min="0" id="cPrice" value="${esc(c.price)}"></label>
      <label>Shipping charged ($)<input type="number" step="0.5" min="0" id="cShip" value="${esc(c.ship)}" ${inPerson?"disabled":""}></label>
      <label>Your cost per item ($)<input type="number" step="0.1" min="0" id="cCost" value="${esc(c.cost)}"></label>
      <label>Shipping label ($)<input type="number" step="0.25" min="0" id="cLabel" value="${esc(c.label)}" ${inPerson?"disabled":""}></label>
      <label>Sales per month<input type="number" step="1" min="0" id="cQty" value="${esc(c.qty)}"></label>
    </form>
    <div class="calc-out">
      <div class="kpi" data-tip="${esc(FEE[c.plat].note)}"><div class="eyebrow">Platform fees</div><div class="v">${money$(fee)}</div><div class="small muted">${revenue?(fee/revenue*100).toFixed(1):0}% of the order</div></div>
      <div class="kpi"><div class="eyebrow">Profit per sale</div><div class="v" style="color:${profit>=0?"var(--ok)":"var(--bad)"}">${money$(profit)}</div><div class="small muted">${margin.toFixed(0)}% margin</div></div>
      <div class="kpi"><div class="eyebrow">Profit per month</div><div class="v">${money$(profit*(+c.qty||0)-monthly)}</div><div class="small muted">${monthly?"after $"+monthly+"/mo plan":"no monthly plan"}</div></div>
      <div class="kpi"><div class="eyebrow">Break-even</div><div class="v">${monthly?(be?be+" sales":"never"):"—"}</div><div class="small muted">${monthly?"to cover the monthly plan":"no plan fee to cover"}</div></div>
    </div><p class="small muted" style="margin:10px 0 0">${esc(FEE[c.plat].note)}. Estimates for planning — confirm on the platform before pricing.</p></section>
  <div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2>Where each product makes the most</h2><span class="eyebrow">profit after fees, item cost & shipping label</span></div>
      <div class="chips" style="margin-bottom:12px">${prods.map((p,i)=>`<button class="chip" type="button" data-prod="${i}" aria-pressed="${i===pi}">${esc(p.name.replace(/\s*\(.*\)/,""))} · $${esc(p.price)}</button>`).join("")}</div>
      ${pr?`<div class="small muted" style="margin-bottom:8px">Sold at $${esc(pr.price)}${pr.shipping?" + $"+esc(pr.shipping)+" shipping":""} · costs you about $${esc(pr.unitCost)} to make</div>
      ${rows.map(r=>`<div class="hbar" style="grid-template-columns:170px 1fr 90px" data-tip="${esc(r.platform)}: fees ${money$(r.fees)}${r.feePct?" ("+r.feePct+"%)":""} · profit ${money$(r.profit)}${r.feeBasis?" — "+esc(r.feeBasis):""}"><span>${esc(r.platform)}</span><span class="t"><i style="width:${Math.max(2,Math.round(r.profit/pmax*100))}%"></i></span><span class="n">${money$(r.profit)}</span></div>`).join("")}`:""}
    </section>
    <section class="card"><div class="card-head"><h2>Platform costs</h2><span class="eyebrow">tap a column to sort · as of ${esc(d.asOf||"")}</span></div><div class="tablewrap"><table class="ptable">
      <thead><tr><th data-psort="name">Platform</th><th>Monthly</th><th data-psort="perSale">Per sale</th><th>Payments</th></tr></thead>
      <tbody>${plats.map(p=>`<tr><td><b>${esc(p.name)}</b>${(p.sources||[]).length?`<div class="small"><a href="${esc(safeUrl(p.sources[0])||"#")}" target="_blank" rel="noopener">source</a></div>`:""}</td><td>${esc(mtext(p.monthly))}</td><td>${esc(String(p.perSale||""))}</td><td class="small">${esc(String(p.payment||""))}${p.notes?`<div class="muted">${esc(String(p.notes).slice(0,220))}</div>`:""}</td></tr>`).join("")}</tbody></table></div></section>
  </div><div class="col">
    <section class="card"><div class="card-head"><h2>What small shops charge</h2><span class="eyebrow">low · typical · high</span></div>
      ${(d.market||[]).map(m=>{ const hi=Math.max(+m.high||0,1); return `<div style="margin-bottom:14px" data-tip="${esc(m.category)}: $${esc(m.low)}–$${esc(m.high)}, typical $${esc(m.typical)}"><div style="display:flex;justify-content:space-between;gap:8px"><b class="small">${esc(m.category)}</b><span class="small muted">$${esc(m.low)} · <b style="color:var(--fg)">$${esc(m.typical)}</b> · $${esc(m.high)}</span></div>
        <div class="range"><i style="left:${(+m.low/hi*100).toFixed(1)}%;right:0"></i><b style="left:calc(${(+m.typical/hi*100).toFixed(1)}% - 2px)"></b></div>
        <details><summary class="small muted" style="cursor:pointer">${(m.examples||[]).length} examples</summary><ul class="small" style="margin:4px 0 0;padding-left:18px">${(m.examples||[]).slice(0,5).map(e=>`<li>${safeUrl(e.url)?`<a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">${esc(String(e.title).slice(0,70))}</a>`:esc(String(e.title).slice(0,70))} · $${esc(e.price)}</li>`).join("")}</ul></details></div>`; }).join("")}
    </section>
    <section class="card"><div class="card-head"><h2>What it costs to grow</h2><span class="eyebrow">each step, with break-even</span></div>
      <div style="display:flex;flex-direction:column;gap:10px">${(d.phases||[]).map(ph=>`<div class="phase"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(ph.name)}</b><span class="small">One-time <b>$${esc(ph.oneTime&&ph.oneTime.low)}–${esc(ph.oneTime&&ph.oneTime.high)}</b> · Monthly <b>$${esc(ph.monthly&&ph.monthly.low)}–${esc(ph.monthly&&ph.monthly.high)}</b></span></div>
        <p class="small" style="margin:6px 0">${esc(String(ph.breakEven||""))}</p>
        <details><summary class="small muted" style="cursor:pointer">What's included (${(ph.items||[]).length})</summary><ul class="small" style="margin:4px 0 0;padding-left:18px">${(ph.items||[]).map(it=>`<li>${esc(String(it).replace(/\s-\shttps?:\S+/,""))}</li>`).join("")}</ul></details></div>`).join("")}</div>
    </section>
  </div></div>`;
}
/* ---------- Team Room ---------- */
function standup(){
  const since=Date.now()-864e5;
  return `<div class="list">${MANAGERS.map(m=>{ const a=TEAM_BY[m.key]; const st=S.agents[m.key]||{}; const keys=[m.key,...m.team];
    const done=S.activity.filter(x=>keys.includes(x.agent)&&new Date(x.at).getTime()>since&&["done","posted","idea"].includes(x.kind)).length;
    const alerts=S.activity.filter(x=>keys.includes(x.agent)&&new Date(x.at).getTime()>since&&x.kind==="alert").length;
    return `<div class="row">${av(a.key,"sm")}<div class="body"><div class="t">${esc(a.name)} <span class="muted small" style="font-weight:400">${esc(m.area)}</span></div>
      <div class="detail">${st.lastSummary?esc(st.lastSummary):'<span class="muted">No update yet.</span>'}</div>
      <div class="meta">last 24h: ${done} finished · ${alerts} alerts · team ${m.team.length}</div></div>
      <button class="btn" type="button" data-pick="${esc(m.key)}">Talk</button></div>`; }).join("")}</div>`;
}
function leaderboard(){
  const b=board();
  return `<div class="list">${b.map((a,i)=>`<div class="row"><div class="avatar sm">${i===0&&a.pts?"★":esc(a.name[0])}</div><div class="body"><div class="t">${esc(a.name)} <span class="muted small" style="font-weight:400">${esc(a.role)}</span></div>
    <div class="meta">${a.work} jobs${a.kudos?` · ${a.kudos} kudos`:""} this week</div></div><span class="pill ${i<3&&a.pts?"acc":""}" style="font-variant-numeric:tabular-nums">${a.pts} pts</span></div>`).join("")}</div>`;
}
function teamChat(){
  const items=[...S.messages.map(m=>({at:m.at,from:m.from,to:m.to,text:m.text})),
    ...S.requests.map(r=>({at:r.at,from:r.by||"aaron",to:r.for,text:r.what+(r.status==="done"&&r.result?` → ${r.result}`:"")}))]
    .filter(x=>x.at).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,30);
  const nm=k=>k===me().toLowerCase()?"You":k==="aaron"?"Aaron":k==="shana"?"Shana":k==="josh"?"Josh":(TEAM_BY[k]?TEAM_BY[k].name:k);
  if(!items.length) return `<div class="empty">Handoffs and messages between the team show up here: who asked whom for what, and what came back.</div>`;
  return `<div class="list">${items.map(x=>`<div class="row"><div class="body"><div class="meta">${esc(nm(x.from))} → ${esc(nm(x.to))} · ${ago(x.at)}</div><div class="detail">${esc(x.text)}</div></div></div>`).join("")}</div>`;
}
function roomPanel(compact){
  const a=(TEAM.some(x=>x.key===S.roomSel)&&TEAM_BY[S.roomSel])||TEAM_BY.steve; const st=S.agents[a.key]||{}; const pt=points(a.key);
  const log=(S.roomLog[a.key]||[]);
  const recent=S.activity.filter(x=>x.agent===a.key).slice(0,4);
  return `${compact?"<div>":'<section class="card">'}<div class="card-head"><div style="display:flex;gap:10px;align-items:center">${av(a.key)}<div><h2>${esc(a.name)}</h2><div class="small muted">${esc(a.role)} · reports to ${esc(a.reports)}</div></div></div><span class="pill acc">${pt.pts} pts</span></div>
    <div class="detail" style="margin-bottom:10px">${st.lastSummary?esc(st.lastSummary):'<span class="muted">Hasn\'t reported yet.</span>'} <span class="muted small">· ${ago(st.lastRun)}</span></div>
    ${recent.length?`<div class="eyebrow" style="margin-bottom:4px">Recent work</div><ul class="small" style="margin:0 0 10px;padding-left:18px">${recent.map(r=>`<li>${esc(r.title)} <span class="muted">· ${ago(r.at)}</span></li>`).join("")}</ul>`:""}
    <div class="answer" id="roomLog" ${log.length?"":"hidden"} style="max-height:none;margin-bottom:8px">${log.map(m=>`<div style="margin-bottom:8px"><b>${m.who==="you"?"You":esc(a.name)}:</b> ${esc(m.text)}</div>`).join("")}</div>
    <form class="ask" id="roomForm"><input type="text" id="roomInput" placeholder="Talk to ${esc(a.name)}…" autocomplete="off" aria-label="Message ${esc(a.name)}"><button class="btn primary" type="submit" id="roomBtn">Send</button></form>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" id="roomUpdate">Get an update</button><button class="btn" type="button" data-kudos="${esc(a.key)}">Give kudos</button>
      ${IS_OWNER?`<button class="btn" type="button" data-run="${esc(a.key)}" ${st.triggerId?"":"disabled"}>${busyKey(a.key)?"Already running · queue":"Put them to work now"}</button>`:""}</div>${compact?"</div>":"</section>"}`;
}
function vRoom(){
  return `<div class="grid"><div class="col">
    ${meetingCard()}
    <section class="card"><div class="card-head"><h2>Daily standup</h2><button class="btn" type="button" id="hearStandup">Hear the standup</button></div>${standup()}</section>
    ${roomPanel()}
    </div>
  <div class="col"><section class="card"><div class="card-head"><h2>Leaderboard</h2><span class="eyebrow">this week</span></div>
    <p class="small muted" style="margin:0 0 8px">Points are free: no money and nothing for you to manage. 5 points per finished job, plus kudos from teammates for standout work. Top scorer is MVP of the week.</p>${leaderboard()}</section>
    ${trainingCard()}
    <section class="card"><div class="card-head"><h2>Walk the floor</h2></div><div class="links">${TEAM.map(a=>`<button class="btn" type="button" data-pick="${esc(a.key)}" ${a.key===S.roomSel?'style="border-color:var(--accent);color:var(--accent)"':""}>${esc(a.name)}</button>`).join("")}</div></section></div></div>`;
}
function vIdeas(){
  const ideas = S.ideas;
  const stc={new:"warn",working:"acc",done:"ok"};
  const list = ideas.length ? ideas.map(i=>{ const u=safeImg(i.imageUrl); const a=i.analysis||{};
    return `<details class="idea" ${i.status==="done"&&ideas.indexOf(i)===0?"open":""}><summary><div class="stripe ${stc[i.status]||""}"></div><div class="body" style="min-width:0;flex:1">
        <div class="t">${esc(a.title||String(i.text||"").slice(0,90))}</div><div class="meta">${ago(i.at)} · ${i.status==="done"?"Nora replied":i.status==="working"?"Nora is on it":"waiting for Nora"}</div></div>
        <span class="pill ${stc[i.status]||""}">${esc(i.status||"new")}</span></summary>
      <div class="an"><div><h4>What you said</h4><p>${esc(i.text)}</p>${u?`<img class="thumb" src="${esc(u)}" alt="Photo you attached" style="margin-top:6px">`:""}</div>
        ${a.meaning?`<div><h4>What Nora thinks you mean</h4><p>${esc(a.meaning)}</p></div>`:""}
        ${a.verdict?`<div><h4>Honest take</h4><p>${esc(a.verdict)}</p></div>`:""}
        ${a.nextStep?`<div><h4>Best next step</h4><p>${esc(a.nextStep)}</p></div>`:""}
        ${(a.alternatives||[]).length?`<div><h4>Alternatives</h4><ul>${a.alternatives.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}
        ${a.research?`<div><h4>Research</h4><p style="white-space:pre-wrap">${esc(a.research)}</p></div>`:""}
        ${a.costEffort?`<div><h4>Cost & effort</h4><p>${esc(a.costEffort)}</p></div>`:""}
        ${(a.sources||[]).length?`<div><h4>Sources</h4><ul>${a.sources.map(s=>{const su=safeUrl(s.u);return su?`<li><a href="${esc(su)}" target="_blank" rel="noopener">${esc(s.t||su)}</a></li>`:""}).join("")}</ul></div>`:""}
        ${a.verdict?`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-say="${esc(i.id)}" type="button">Read Nora's take aloud</button>${S.apps.some(x=>x.ideaId===i.id)?`<span class="pill acc">In the app pipeline</span>`:`<button class="btn primary" data-toapp="${esc(i.id)}" type="button">Build this as an app</button>`}</div>`:""}
      </div></details>`; }).join("")
    : `<div class="empty">No ideas yet. Drop your first one above. Nora checks every 3 hours, figures out what you mean, researches it, and replies right here.</div>`;
  return `<div class="grid"><div class="col">
    <section class="card"><div class="card-head"><h2>Drop an idea</h2><span class="eyebrow">Nora · Idea Lab</span></div>
      <form class="drop" id="ideaForm"><textarea id="ideaText" placeholder="Type it or tap your keyboard's mic and just talk. Rough is fine: Nora figures out what you mean."></textarea>
        <div class="actions"><label class="btn" for="ideaPhoto" id="photoLbl">Add a photo</label><input type="file" id="ideaPhoto" accept="image/*" hidden>
          <span class="small muted" id="photoName"></span><span style="flex:1"></span>
          <button class="btn" type="button" id="ideaNow">Send & ask Nora now</button><button class="btn primary" type="submit">Send to Nora</button></div></form></section>
    <section class="card"><div class="card-head"><h2>Your ideas</h2></div>${list}</section></div>
  <div class="col">${desk("ideas")}<section class="card"><div class="card-head"><h2>How Nora works</h2></div>
    <ol class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Reads your words and photo, and works out what you're actually after.</li>
      <li>Researches it: competitors, costs, demand, rules and risks.</li>
      <li>Gives you an honest verdict, the best next step and two or three alternatives.</li>
      <li>Hands anything worth building to Stephanie so the team picks it up.</li></ol></section>
    ${teamCards("lab")}</div></div>`;
}
/* Taps never get lost: hold re-renders while a finger/mouse is down, and skip identical repaints */
let PTR_DOWN=false, RENDER_PENDING=false, LAST_MAIN="";
document.addEventListener("pointerdown",e=>{ if(e.target.closest&&e.target.closest("#main")) PTR_DOWN=true; },true);
function releasePtr(){ if(!PTR_DOWN) return; PTR_DOWN=false; if(RENDER_PENDING){ RENDER_PENDING=false; render(); } }
document.addEventListener("click",()=>setTimeout(releasePtr,0),true);
["pointercancel","pointerup"].forEach(ev=>document.addEventListener(ev,()=>setTimeout(releasePtr,350),true));
function render(){
  if(PTR_DOWN){ RENDER_PENDING=true; return; }
  const act=document.activeElement; const focusKeep=act&&act.id&&$("#main").contains(act)&&/^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)?{id:act.id,v:act.value,c:act.checked,s:act.selectionStart,e:act.selectionEnd}:null;
  const v={launch:(typeof vLaunchpad==="function"?vLaunchpad:vOverview),share:(typeof vShare==="function"?vShare:vOverview),quotes:(typeof vQuotes==="function"?vQuotes:vOverview),redesign:(typeof vRedesign==="function"?vRedesign:vOverview),library:vLibrary,designer:vDesigner,lightbox:(typeof vLightbox==="function"?vLightbox:vOverview),hype:(typeof vMakerApp==="function"?()=>vMakerApp("hype"):vOverview),nameplate:(typeof vMakerApp==="function"?()=>vMakerApp("nameplate"):vOverview),code:(typeof vCode==="function"?vCode:vOverview),agents:(typeof vAgentStudio==="function"?vAgentStudio:vOverview),knowledge:vKnowledge,designlab:vDesignLab,schedules:vSchedules,research:vResearch,rsettings:vRSettings,sellers:vSellers,print3d:vPrint3d,filament:(typeof vFilament==="function"?vFilament:vOverview),markets:vMarkets,catalog:vCatalog,docs:vDocs,overview:vOverview,elevated:vElevated,studio:vStudio,listings:vListings,apps:vApps,money:vMoney,legal:vLegal,ideas:vIdeas,team:vRoomPlus,comms:vCommsPlus,design:vDesign,pricing:vPricing,c3d:vC3D,growth:vGrowth,sysmap:(typeof vSysmap==="function"?vSysmap:vOverview),ai:(typeof vAI==="function"?vAI:vOverview),deepdive:(typeof vDeep==="function"?vDeep:vOverview),rules:(typeof vRules==="function"?vRules:vOverview),website:(typeof vWebsite==="function"?vWebsite:vOverview),social:(typeof vSocial==="function"?vSocial:vOverview),holo:(typeof vHolo==="function"?vHolo:vOverview),reviews:(typeof vReviews==="function"?vReviews:vOverview)}[S.tab]||vOverview;
  const keepIdea = $("#ideaText") ? $("#ideaText").value : null; const keepList = $("#lstNote") ? $("#lstNote").value : null; const keepRoom = $("#roomInput") ? $("#roomInput").value : null; const keepBoard = $("#boardInput") ? $("#boardInput").value : null; const keepAsk=$("#qaskInput")?$("#qaskInput").value:null; const keepChg=$("#chgInput")?$("#chgInput").value:null; const keepBug=$("#bugInput")?$("#bugInput").value:null; const keepJob=$("#jobText")?$("#jobText").value:null; const fo=document.activeElement&&document.activeElement.id; const keepApp=[$("#appName")?.value,$("#appPitch")?.value]; const keepM=[$("#mTitle")?.value,$("#mDetail")?.value];
  paintSubjectTheme(); const html=subjectHead()+v()+subjectResearch(); const keepMakerFrame=(S.tab==="hype"||S.tab==="nameplate")&&window.LAST_MAIN_TAB===S.tab&&!!document.querySelector(".mkif"); const same=html===LAST_MAIN||keepMakerFrame; if(!same){ $("#main").innerHTML = html; LAST_MAIN=html; clampLists(); keepFolds(); } window.LAST_MAIN_TAB=S.tab; paintAttach(); sizeHeader();
  if(!same&&focusKeep){ const f=document.getElementById(focusKeep.id); if(f){ if(f.type==="checkbox") f.checked=focusKeep.c; else f.value=focusKeep.v; f.focus(); try{ if(focusKeep.s!=null) f.setSelectionRange(focusKeep.s,focusKeep.e); }catch{} } }
  if(keepIdea && $("#ideaText")) $("#ideaText").value = keepIdea; if(keepList && $("#lstNote")) $("#lstNote").value = keepList; if(keepRoom && $("#roomInput")) $("#roomInput").value = keepRoom; if(keepBoard && $("#boardInput")) $("#boardInput").value = keepBoard; if(keepAsk&&$("#qaskInput")) $("#qaskInput").value=keepAsk; if(keepChg&&$("#chgInput")) $("#chgInput").value=keepChg; if(keepBug&&$("#bugInput")) $("#bugInput").value=keepBug; if(keepJob!==null&&$("#jobText")) $("#jobText").value=keepJob; if(fo&&["boardInput","roomInput","qaskInput","chgInput","bugInput","jobText"].includes(fo)&&$("#"+fo)) $("#"+fo).focus({preventScroll:true}); if($("#appName")&&keepApp[0]) $("#appName").value=keepApp[0]; if($("#mTitle")&&keepM[0]) $("#mTitle").value=keepM[0]; if($("#mDetail")&&keepM[1]) $("#mDetail").value=keepM[1]; if($("#appPitch")&&keepApp[1]) $("#appPitch").value=keepApp[1];
  if(S.tab==="ideas" && db){ S.ideas.filter(i=>i.status==="done" && !i.seen && !SEEN.has(i.id)).forEach(i=>{ SEEN.add(i.id); db.doc("ideas/"+i.id).update({seen:true}).catch(()=>{}); }); }
  bindView(); bindHQX(); bindSubject(); if(SHEET) paintSheet(); paintSubjects(); watchAutoload();
}

/* ---------- interactions ---------- */
let pendingPhoto=null;
function goTo(dest){ let [tab,anc]=String(dest||"").split("#"); let biz=""; if(tab&&tab.includes(":")) [tab,biz]=tab.split(":");
  if((tab==="design"||tab==="listings")&&!biz){ const waiting=k=>tab==="design"?S.designs.some(d=>d.status==="proposed"&&designBiz(d)===k):S.listings.some(l=>l.status==="ready"&&listingBiz(l)===k); biz=waiting(S.biz||"ed")?(S.biz||"ed"):waiting("ed")?"ed":waiting("c3d")?"c3d":(S.biz||"ed"); }
  if(tab&&(S.tab!==tab||(biz&&S.biz!==biz))) go(tab+(biz?":"+biz:""),{keepScroll:!!anc});
  const jump=()=>{ const el=anc?document.getElementById(anc):null; if(!el){ window.scrollTo({top:0}); return; }
    for(let d=el.closest("details");d;d=d.parentElement&&d.parentElement.closest("details")) d.open=true;
    const h=(document.querySelector("header.top")||{offsetHeight:0}).offsetHeight; const y=el.getBoundingClientRect().top+window.scrollY-h-12;
    window.scrollTo({top:Math.max(0,y),behavior:"smooth"}); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); };
  setTimeout(jump,80); }
function bindView(){
  const pb=$("#playBrief"); if(pb) pb.onclick=()=>{ if(!voiceOn){ voiceOn=true; ls("hq-voice","1"); paintVoice(); } const b=S.brief; speak(`${b.summary} ${(b.priorities||[]).map((p,i)=>`Priority ${i+1}: ${p}.`).join(" ")}`); };
  document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>goTo(b.dataset.goto)); bindActx();
  const aa=$("#actAsk"); if(aa) aa.onclick=()=>{ const i=$("#askInput"); if(i){ i.focus(); i.scrollIntoView({block:"center"}); } };
  document.querySelectorAll(".bizsw").forEach(w=>{ if(w.dataset.pos!==w.dataset.to) requestAnimationFrame(()=>requestAnimationFrame(()=>{ w.dataset.pos=w.dataset.to; })); });
  document.querySelectorAll("[data-run]").forEach(b=>b.onclick=()=>runAgent(b.dataset.run,b));
  document.querySelectorAll("[data-say]").forEach(b=>b.onclick=()=>{ const i=S.ideas.find(x=>x.id===b.dataset.say); if(!i) return; if(!voiceOn){voiceOn=true; ls("hq-voice","1"); paintVoice();} const a=i.analysis||{}; speak(`${a.verdict||""} Best next step: ${a.nextStep||""}`); });
  document.querySelectorAll("[data-setup]").forEach(cb=>cb.onchange=async()=>{ if(!db) return; try{ await db.doc("setup/"+cb.dataset.setup).update({done:cb.checked, doneAt:new Date().toISOString()}); }catch(e){ cb.checked=!cb.checked; toast("Couldn't save that. Try again."); } });


  document.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{ S.roomSel=b.dataset.pick; if(S.tab!=="team") go("team"); else render(); setTimeout(()=>{ const i=$("#roomInput"); if(i) i.focus(); },50); });
  document.querySelectorAll("[data-kudos]").forEach(b=>b.onclick=()=>giveKudos(b.dataset.kudos));
  document.querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>answerQ(b.dataset.answer));
  document.querySelectorAll("[data-toapp]").forEach(b=>b.onclick=()=>ideaToApp(b.dataset.toapp,b));
  const af=$("#appForm"); if(af) af.onsubmit=e=>{ e.preventDefault(); newApp(); };
  const rf=$("#roomForm"); if(rf) rf.onsubmit=e=>{ e.preventDefault(); const v=$("#roomInput").value.trim(); const n=(ATT.roomInput||[]).length; if(v||n) talkTo(S.roomSel, v||"Take a look at this picture.", false, n?takeAtt("roomInput"):[]); };
  const ru=$("#roomUpdate"); if(ru) ru.onclick=()=>talkTo(S.roomSel, "Give me your update: what you did since your last run, what's next, and anything you need from me. Keep it to a few sentences.", true);
  const hs=$("#hearStandup"); if(hs) hs.onclick=()=>{ if(!voiceOn){voiceOn=true; ls("hq-voice","1"); paintVoice();} speak("Here's the standup. "+MANAGERS.map(m=>{ const st=S.agents[m.key]||{}; return `${TEAM_BY[m.key].name}, ${m.area}: ${st.lastSummary||"no update yet"}.`; }).join(" ")); };
  document.querySelectorAll("[data-formdone]").forEach(cb=>cb.onchange=async()=>{ if(!db) return; try{ await db.doc(cb.dataset.formdone).update({status:cb.checked?"done":"todo", doneAt:new Date().toISOString()}); toast(cb.checked?"Marked done":"Marked not done"); }catch{ cb.checked=!cb.checked; toast("Couldn't save that. Try again."); } });
  document.querySelectorAll("[data-dm]").forEach(r=>{ const go=(ev)=>{ const k=r.dataset.dm, t=Date.now(); const dbl=ev&&ev.type==="click"&&LASTDM.k===k&&t-LASTDM.t<450; LASTDM={k,t:dbl?0:t};
      if(dbl){ openChat(k); return; } S.dmSel=r.dataset.dm; S.jobEdit=null; if(S.tab!=="comms") go("comms"); else render(); setTimeout(()=>{ if(CHAT) return; const l=$("#dmLog"); if(l&&innerWidth<900) l.closest("section").scrollIntoView({behavior:"smooth",block:"start"}); const i=$("#roomInput"); if(i&&innerWidth>=900) i.focus({preventScroll:true}); },50); };
    r.onclick=go; r.ondblclick=e=>{ e.preventDefault(); openChat(r.dataset.dm); }; r.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }; if(!r.title) r.title="Double-click to open a chat"; });
  const qf=$("#qaskForm"); if(qf) qf.onsubmit=e=>{ e.preventDefault(); quickAsk(); };
  const qd=$("#qaskDeep"); if(qd) qd.onclick=deepResearch; const qc=$("#qaskClear"); if(qc) qc.onclick=()=>{ S.askLog=[]; render(); };
  const bgf=$("#bugForm"); if(bgf) bgf.onsubmit=e=>{ e.preventDefault(); reportBug(); };
  const cf=$("#chgForm"); if(cf) cf.onsubmit=e=>{ e.preventDefault(); requestChange(); };
  document.querySelectorAll("[data-chgnow]").forEach(b=>b.onclick=async()=>{ const tid=tidOf("max"); if(!tid){ toast("Max isn't set up yet."); return; } b.disabled=true; if(await fire(tid,`Build change request changes/${b.dataset.chgnow} now.`)) toast("Max is starting now."); b.disabled=false; });
  const al=$("#askLog"); if(al) al.scrollTop=al.scrollHeight;
  document.querySelectorAll("[data-iapprove]").forEach(b=>b.onclick=()=>decideIdea(b.dataset.iapprove,true));
  document.querySelectorAll("[data-ipass]").forEach(b=>b.onclick=()=>decideIdea(b.dataset.ipass,false));
  document.querySelectorAll("[data-iround]").forEach(b=>b.onclick=()=>{ S.ideaRound=b.dataset.iround; render(); });
  document.querySelectorAll("[data-dapprove]").forEach(b=>b.onclick=()=>decideDesign(b.dataset.dapprove,true));
  document.querySelectorAll("[data-dpass]").forEach(b=>b.onclick=()=>decideDesign(b.dataset.dpass,false));
  document.querySelectorAll("[data-dchange]").forEach(b=>b.onclick=()=>openDesignChange(b.dataset.dchange));
  document.querySelectorAll("[data-dchform]").forEach(f=>f.onsubmit=e=>{ e.preventDefault(); submitDesignChangeInline(f); });
  document.querySelectorAll("[data-dopen]").forEach(t=>t.onclick=()=>openDesignCard(t.dataset.dopen));
  document.querySelectorAll("[data-dexport]").forEach(t=>t.onclick=e=>{ e.stopPropagation(); exportDesign(t.dataset.dexport,t.dataset.fmt,t); });
  document.querySelectorAll("[data-seotool]").forEach(b=>b.onclick=()=>{ S.seoTool=b.dataset.seotool; render(); });
  document.querySelectorAll("[data-adok]").forEach(b=>b.onclick=()=>decideAd(b.dataset.adok,true));
  document.querySelectorAll("[data-adno]").forEach(b=>b.onclick=()=>decideAd(b.dataset.adno,false));
  { const c=$("#stCheck"); if(c) c.onclick=()=>{ const h=($("#stHtml").value||"").trim(); const o=$("#stOut"); if(!h){ toast("Paste the page HTML first."); return; } const r=seoCheckHtml(h);
      o.innerHTML=`<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">${ring(r.score,64)}<div><b>${r.R.filter(x=>x.ok).length} of ${r.R.length} checks pass</b><div class="small muted">Fix the red ones first, top to bottom.</div></div></div><ul class="small" style="list-style:none;padding:0;margin:0;display:grid;gap:4px">${r.R.sort((a,b)=>a.ok-b.ok).map(x=>`<li><span style="color:${x.ok?"var(--ok)":"var(--bad)"}">${x.ok?"✓":"✗"}</span> <b>${esc(x.rule)}</b> <span class="muted">· ${esc(x.area)}${x.note?" · "+esc(x.note):""}</span></li>`).join("")}</ul>`; }; }
  { const b=$("#stSage"); if(b) b.onclick=sendUrlToSage; }
  ["#snT","#snD","#snU","#snK"].forEach(id=>{ const e=$(id); if(e) e.oninput=snippetOut; }); if($("#snOut")) snippetOut();
  { const b=$("#scGo"); if(b) b.onclick=schemaOut; } { const b=$("#ytGo"); if(b) b.onclick=videoOut; } { const b=$("#utGo"); if(b) b.onclick=utmOut; }
  document.querySelectorAll("[data-chat]").forEach(b=>b.onclick=e=>{ e.preventDefault(); e.stopPropagation(); openChat(b.dataset.chat); });
  document.querySelectorAll("[data-piok]").forEach(b=>b.onclick=()=>decidePrintIdea(b.dataset.piok,true));
  document.querySelectorAll("[data-pino]").forEach(b=>b.onclick=()=>decidePrintIdea(b.dataset.pino,false));
  document.querySelectorAll("[data-dfilter]").forEach(b=>b.onclick=()=>{ S.designFilter=b.dataset.dfilter; render(); });
  document.querySelectorAll("[data-bcok]").forEach(b=>b.onclick=()=>decideBillChange(b.dataset.bcok,true));
  document.querySelectorAll("[data-bcno]").forEach(b=>b.onclick=()=>decideBillChange(b.dataset.bcno,false));
  const bfm=$("#billForm"); if(bfm) bfm.onsubmit=e=>{ e.preventDefault(); saveBill(); };
  document.querySelectorAll("[data-billedit]").forEach(b=>b.onclick=()=>{ S.billEdit=b.dataset.billedit; render(); const f=$("#billForm"); if(f) f.scrollIntoView({behavior:"smooth",block:"center"}); });
  const bce=$("#bCancelEdit"); if(bce) bce.onclick=()=>{ S.billEdit=null; render(); };
  document.querySelectorAll("[data-prod]").forEach(b=>b.onclick=()=>{ S.priceProd=+b.dataset.prod; render(); });
  document.querySelectorAll("[data-psort]").forEach(b=>b.onclick=()=>{ S.platSort=b.dataset.psort; render(); });
  const cf2=$("#calcForm"); if(cf2) cf2.oninput=()=>{ S.calc={plat:$("#cPlat").value,cat:$("#cCat").value,price:$("#cPrice").value,ship:$("#cShip").value,cost:$("#cCost").value,label:$("#cLabel").value,qty:$("#cQty").value}; const f=document.activeElement&&document.activeElement.id; const pos=document.activeElement&&document.activeElement.selectionStart; render(); const el=f&&$("#"+f); if(el){ el.focus({preventScroll:true}); try{ if(pos!=null) el.setSelectionRange(pos,pos); }catch{} } };
  const hp=$("#hearPaper"); if(hp) hp.onclick=()=>{ if(!voiceOn){ voiceOn=true; ls("hq-voice","1"); paintVoice(); } const n=S.news||{}; speak(`The Lab Daily. ${n.headline||""}. ${n.summary||""}`); };
  const je=$("#jobEditBtn"); if(je) je.onclick=()=>{ S.jobEdit=S.dmSel; render(); setTimeout(()=>{ const t=$("#jobText"); if(t) t.focus(); },30); };
  const jc=$("#jobCancel"); if(jc) jc.onclick=()=>{ S.jobEdit=null; render(); };
  const jf=$("#jobForm"); if(jf) jf.onsubmit=e=>{ e.preventDefault(); saveJob(S.dmSel); };
  const bf=$("#boardForm"); if(bf) bf.onsubmit=e=>{ e.preventDefault(); postBoard(); };
  const dl=$("#dmLog"); if(dl) dl.scrollTop=dl.scrollHeight; paintChat();
  document.querySelectorAll("[data-deskpick]").forEach(b=>b.onclick=()=>{ S.roomSel=b.dataset.deskpick; render(); });
  const mf=$("#matterForm"); if(mf) mf.onsubmit=e=>{ e.preventDefault(); newMatter(); };
  document.querySelectorAll("[data-mreply]").forEach(b=>b.onclick=()=>matterReply(b.dataset.mreply,false));
  document.querySelectorAll("[data-mdone]").forEach(b=>b.onclick=()=>matterReply(b.dataset.mdone,true));
  document.querySelectorAll("[data-stepdone]").forEach(b=>b.onclick=()=>{ b.disabled=true; stepDone(b.dataset.stepdone); });
  const wm=$("#walkMe"); if(wm) wm.onclick=()=>{ S.roomSel="steve"; render(); talkTo("steve","Walk me through my current roadmap step like I've never done it before: what to click, what to have ready, and how long it takes.",false); };
  const hst=$("#hearStep"); if(hst) hst.onclick=()=>{ if(!voiceOn){voiceOn=true; ls("hq-voice","1"); paintVoice();} const c=S.roadmap.slice().sort((a,b)=>(a.order??999)-(b.order??999)).find(x=>x.status!=="done"); if(c) speak(`Your next step: ${c.title}. ${c.why||""} ${(c.how||[]).map((h,i)=>`Step ${i+1}: ${h}.`).join(" ")}`); };
  const pmt=$("#playMeeting"); if(pmt) pmt.onclick=()=>{ if(!voiceOn){voiceOn=true; ls("hq-voice","1"); paintVoice();} const m=S.meetings[0]; speak(`${m.summary} ${(m.decisions||[]).map((d,i)=>`Decision ${i+1}: ${d}.`).join(" ")}`); };
  const pm=$("#playMoney"); if(pm) pm.onclick=()=>{ if(!voiceOn){voiceOn=true; ls("hq-voice","1"); paintVoice();} const p=S.moneyPlan; speak(`${p.summary} ${(p.priorities||[]).map((x,i)=>`Move ${i+1}: ${x}.`).join(" ")}`); };
  const lf=$("#lstForm"); if(lf){
    lf.onsubmit=e=>{ e.preventDefault(); submitListing(); };
    const lp=$("#lstPhotos"); lp.onchange=()=>{ pendingListPhotos=[...lp.files].slice(0,10); $("#lstNames").textContent = pendingListPhotos.length?pendingListPhotos.length+" photo"+(pendingListPhotos.length>1?"s":""):""; };
    if(!assets){ $("#lstLbl").hidden=true; }
  }
  document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async ev=>{ ev.preventDefault(); const [id,k]=b.dataset.copy.split("|"); const l=S.listings.find(x=>x.id===id); if(!l) return; let v=(l.draft||{})[k]; if(Array.isArray(v)) v=v.join(", ");
    try{ await navigator.clipboard.writeText(String(v)); toast("Copied"); }catch{ const p=b.closest("div").querySelector("p"); const r=document.createRange(); r.selectNodeContents(p); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Selected. Copy it from here."); } });
  const f=$("#ideaForm"); if(f){
    f.onsubmit=e=>{ e.preventDefault(); submitIdea(false); };
    $("#ideaNow").onclick=()=>submitIdea(true);
    const ph=$("#ideaPhoto"); ph.onchange=()=>{ pendingPhoto=ph.files[0]||null; $("#photoName").textContent = pendingPhoto?pendingPhoto.name:""; };
    if(!assets){ $("#photoLbl").hidden=true; }
  }
}

let pendingListPhotos=[];
async function submitListing(){
  const note=($("#lstNote").value||"").trim(); if(!note && !pendingListPhotos.length){ toast("Add a photo or a note first."); return; }
  if(!db){ toast("Listings can't be saved in this view. Open the page in Claude."); return; }
  const photos=[], photoIds=[];
  for(const f of pendingListPhotos){ try{ const r=await assets.upload(f); photos.push(r.url); photoIds.push(r.id); }catch{ toast("A photo didn't upload: "+f.name); } }
  const biz=S.biz==="c3d"?"c3d":"ed", brand=biz==="c3d"?"charleston-3d-prints":"elevated-designs";
  try{ await db.collection("listings").add({note: note||"(photos only)", photos, photoIds, channel:$("#lstChan").value, biz, brand, status:"new", at:new Date().toISOString()});
    $("#lstNote").value=""; pendingListPhotos=[]; const n=$("#lstNames"); if(n) n.textContent="";
    toast("Sent to Carla. She's starting now."); const tid=tidOf("carla"); if(tid) fire(tid,`A new ${BIZ_NAME[biz]} listing request (brand ${brand}) was just submitted. Handle it now.`);
  }catch{ toast("Couldn't save the listing. Try again."); }
}
async function submitIdea(now){
  const text=($("#ideaText").value||"").trim(); if(!text && !pendingPhoto){ toast("Type or say your idea first."); return; }
  if(!db){ toast("Ideas can't be saved in this view. Open the page in Claude."); return; }
  let imageUrl=null, imageId=null;
  try{ if(pendingPhoto && assets){ const r=await assets.upload(pendingPhoto); imageUrl=r.url; imageId=r.id; } }catch(e){ toast("The photo didn't upload. Sending the text only."); }
  try{
    const ref = await db.collection("ideas").add({text: text||"(photo only)", by:me().toLowerCase(), imageUrl, imageId, status:"new", at:new Date().toISOString()});
    $("#ideaText").value=""; pendingPhoto=null; const pn=$("#photoName"); if(pn) pn.textContent="";
    toast(now?"Sent. Nora's starting now.":"Sent to Nora. She'll reply within 3 hours.");
    if(now){ const tid=tidOf("nora"); if(tid) fire(tid, `New idea ${ref.id} was just submitted. Handle it first.`); }
  }catch(e){ toast("Couldn't save the idea. Check your connection and try again."); }
}
/* Rapid taps: write each request once, and fire each agent at most once per 5 minutes */
const FIRE_GAP=5*60*1000; const REQ_SEEN=new Map(); const FIRE_Q={};
function addReq(data){ data={...data, for:live(data.for)}; const k=String(data.for||"")+"|"+String(data.what||"").slice(0,400); const now=Date.now();
  for(const [kk,t] of REQ_SEEN) if(now-t>FIRE_GAP) REQ_SEEN.delete(kk);
  const dup=REQ_SEEN.has(k)||S.requests.some(r=>r.status!=="done"&&r.for===data.for&&String(r.what||"").slice(0,400)===String(data.what||"").slice(0,400)&&now-new Date(r.at).getTime()<FIRE_GAP);
  if(dup) return Promise.resolve({id:null,duplicate:true}); REQ_SEEN.set(k,now); return db.collection("requests").add(data); }
function keyOfTrigger(tid){ return Object.keys(S.agents).find(k=>tidOf(k)===tid)||null; }
function lastFired(tid){ let t=0; try{ t=+localStorage.getItem("hq-fired-"+tid)||0; }catch{} return Math.max(t,(FIRE_Q[tid]&&FIRE_Q[tid].firedAt)||0); }
function agentBusy(tid){ const now=Date.now(); if(now-lastFired(tid)<FIRE_GAP) return true;
  const k=keyOfTrigger(tid), st=k?S.agents[k]||{}:{}; const lr=st.lastRun?new Date(st.lastRun).getTime():0;
  if(st.status==="running"&&lr&&now-lr<2*3600e3) return true;
  const tr=S.triggers[tid], r=tr&&tr.last_run; const fa=r&&r.fired_at?new Date(r.fired_at).getTime():0;
  return !!(r&&/PEND|RUNN/.test(r.status||"")&&fa&&now-fa<2*3600e3); }
function busyKey(k){ const tid=tidOf(k); return !!tid&&agentBusy(tid); }
function queueFire(tid,text){ const q=FIRE_Q[tid]=FIRE_Q[tid]||{texts:[],firedAt:0,timer:null,tries:0}; if(text&&!q.texts.includes(text)) q.texts.push(text);
  if(!q.timer){ const wait=Math.max(30000,FIRE_GAP-(Date.now()-lastFired(tid))+5000);
    q.timer=setTimeout(()=>{ q.timer=null; if(++q.tries>6){ q.texts=[]; q.tries=0; return; } const all=q.texts.splice(0); fire(tid, all.length>1?"Several requests came in while you were running:\n- "+all.join("\n- "):(all[0]||"")); }, wait); } }
async function fire(triggerId, text){
  if(!IS_OWNER) return false;
  if(agentBusy(triggerId)){ queueFire(triggerId,text); const k=keyOfTrigger(triggerId); toast(`${TEAM_BY[k]?TEAM_BY[k].name:"That teammate"} is already running. Queued for the next run.`); return false; }
  return fireNow(triggerId,text); }
async function fireNow(triggerId, text){
  if(!IS_OWNER) return false; /* only the owner's account runs the team; others' requests are picked up on the next scheduled run */
  if(!mcp){ /* on Cloudflare there's no scheduler connector: leave it as a request for their next run */
    const k=keyOfTrigger(triggerId); if(!db||!k){ toast("Run now needs the Claude Code Remote connector."); return false; }
    try{ await db.collection("requests").add({for:k,by:String(CUR||"Aaron").toLowerCase(),status:"open",at:new Date().toISOString(),what:text||"Run now: do your full run as soon as you start next."});
      toast(`Sent to ${TEAM_BY[k]?TEAM_BY[k].name:"them"}. They'll pick it up on their next run.`); return false; }
    catch{ toast("Couldn't send that. Try again in a minute."); return false; } }
  try{ await mcp.callTool("Claude Code Remote","fire_trigger", text?{trigger_id:triggerId, text}:{trigger_id:triggerId});
    const now=Date.now(); try{ localStorage.setItem("hq-fired-"+triggerId,String(now)); }catch{} const q=FIRE_Q[triggerId]=FIRE_Q[triggerId]||{texts:[],firedAt:0,timer:null,tries:0}; q.firedAt=now; q.tries=0; refreshTriggers(); setTimeout(render,0); return true; }
  catch(e){ const m={server_not_connected:"Connect Claude Code Remote in Settings → Connectors.",needs_reauth:"Reconnect Claude Code Remote in Settings → Connectors.",not_in_manifest:"You turned off Claude Code Remote for this page.",approval_required:"That needs your approval. Tap Run now again and allow it."}[e&&e.code];
    toast(m||"Couldn't start that run. Try again in a minute."); return false; }
}
async function runAgent(key,btn){
  const st=S.agents[key]||{}; if(!st.triggerId) return; btn.disabled=true; const ok=await fire(st.triggerId); btn.disabled=false;
  if(ok){ toast(`${TEAM_BY[key].name} is on it. Results land here in a few minutes.`); refreshTriggers(); }
}


async function giveKudos(key){
  const a=TEAM_BY[key]; if(!db){ toast("Kudos can't be saved in this view."); return; }
  try{ await db.collection("kudos").add({to:key, by:me().toLowerCase(), note:"", at:new Date().toISOString()}); toast(`Kudos sent to ${a.name}. +10 points`); }catch{ toast("Couldn't send kudos. Try again."); }
}
async function answerQ(id){
  const t=$("#ans-"+id); const v=(t&&t.value||"").trim(); if(!v){ toast("Type an answer first."); return; }
  try{ await db.doc("questions/"+id).update({status:"answered", answer:v, answeredAt:new Date().toISOString()});
    toast("Sent. Stephanie will pass it to the team."); const q=S.questions.find(x=>x.id===id);
    const tid=tidOf((q&&q.from)||"steve")||tidOf("steve"); if(tid) fire(tid,`${me()} answered question ${id}: "${v}". Pass it on and continue the work.`);
  }catch{ toast("Couldn't save the answer. Try again."); }
}
async function newApp(){
  const name=($("#appName").value||"").trim(), pitch=($("#appPitch").value||"").trim(); if(!pitch && !name){ toast("Describe the app first."); return; }
  if(!db){ toast("Apps can't be saved in this view."); return; }
  try{ const ref=await db.collection("apps").add({name:name||"New app", pitch, stage:"idea", owner:"sam", at:new Date().toISOString(), updatedAt:new Date().toISOString()});
    $("#appName").value=""; $("#appPitch").value=""; toast("Sam has it. He'll spec it and Stephanie will ask you anything missing.");
    const tid=tidOf("ray"); if(tid) fire(tid,`New app request ${ref.id} from Aaron. Start it now.`);
  }catch{ toast("Couldn't save the app. Try again."); }
}
async function ideaToApp(id,btn){
  const i=S.ideas.find(x=>x.id===id); if(!i||!db) return; btn.disabled=true; const a=i.analysis||{};
  try{ const ref=await db.collection("apps").add({name:a.title||"New app", pitch:(a.meaning||i.text), ideaId:id, stage:"idea", owner:"sam", at:new Date().toISOString(), updatedAt:new Date().toISOString()});
    toast("Sent to Sam's app team."); const tid=tidOf("ray"); if(tid) fire(tid,`Aaron wants idea ${id} built as an app (apps/${ref.id}). Start it now.`);
  }catch{ btn.disabled=false; toast("Couldn't send it. Try again."); }
}
/* Where things really are on this dashboard. Every AI answer that tells someone where to click uses only these names (Aaron, Oct 14: never give unverified steps). */
const NAV_GUIDE="DASHBOARD MAP (the only names you may use when telling someone where to click): the list of subjects down the left side (on a phone, the colored subject button at the top) has Home · Elevated Designs · Charleston 3D · Create · Studio · Apps & Agents · Legal · Money · Team · Research. Picking a subject changes the whole page to that subject's color, its numbers and its page tabs, shown along the bottom of the subject banner. Home: Today (big action tiles: New shirt design, Generate art, Make a light box, New 3D product, New listing, Post a video, Design library, Fix the console; Needs you; the daily brief), Launchpad, Share links & QR, Rules & decisions. Elevated Designs: Overview, Designs, Listings, Custom orders, Design Lab (chat with Vera and generate design images), Marketing, Reviews, Shirt market. Charleston 3D: Overview (3D ideas, website, launch checklist, products & profit), 3D designs, Listings, Custom quotes, Redesign Studio, Marketing, Reviews, Filament (every filament brand, color with real hex code, and the 3 cheapest places to buy, plus the Excel download; mockups use Polymaker PLA colors first), 3D trends. Create is one page with every tool as a button on a bench, and the picked tool opens right below it: Design (Design library: every design, DTF print, SVG, 3D file and Kittl project from Aaron's E drive; Design Studio: shirt editor with templates, text effects, image tools, vector export and an auto-checker that must pass before saving or printing; AI art; Design catalog), Maker (Light box, Keychain, Sign, Lithophane: drop a picture, export a 3MF for Bambu Studio, export only; Hype chains; Nameplates; 3D redesign) and Code (Aaron's GitHub repos mirrored by Sam: browse, edit and Save so Sam commits, export, or re-engineer any repo, app or link). Studio: the YouTube studio for Released Footage, Funny Video Clips and ElevatedNewsflash. Apps & Agents: Apps, Idea Lab, Agent Studio (describe an agent to sell; it builds the full package), AI models, Idea research. Legal: Legal & paperwork (every form, license application, agreement and policy as a Word/PDF to download, sign and upload back; Helen drafts and reviews; mirrored to Desktop ▸ Elevated Designs Paperwork) and Business docs. Money: Money & bills, Pricing & fees. Team: Messages, Team Room, Schedules (Run now, Pause, Edit; only Aaron with his PIN) and System map. Research: Research, Search jobs (every source and search phrase each task uses), SEO & knowledge, Markets & events, Shirt sellers, 3D trends. The search box (Ctrl K) finds any page, person, schedule, design or file.";
function personaFor(key){
  const a=TEAM_BY[key];
  const scope={brooke:"brands, names, websites and social handles", vera:"design direction: color schemes, imagery, brand consistency and design skills", lisa:"drawing daily designs from the team's findings", ava:"daily ads and short videos for every brand and app, with tracked links (never spends money)", sage:"SEO and search visibility for every site, app, shop, YouTube channel and social profile", iris:"new design ideas and improving designs with the team", cole:"new 3D print ideas, sales spikes, and legal ready-to-print files (licensed for sale or re-engineered originals)", zoe:"finding app ideas from what people want and market data", tina:"social media for every brand", andy:"Charleston 3D: the charleston3d.com launch, products, local market and competition", jake:"Released Footage breaking releases", megan:"Funny Video Clips", sam:"building apps and the Charleston 3D website", kim:"testing apps", leo:"launching apps", max:"bugs, failed runs, fixes, security and changes to this dashboard", hannah:"team happiness, communication, rewards and training", helen:"running the business day to day: the nightly manager meeting, decisions while Aaron is away, legal and licensing, trademarks and domains", linda:"bills, subscriptions, taxes, fees and business paperwork", steve:"everything — she is Aaron's only point of contact and keeps his roadmap; for roadmap questions explain like a patient mentor, with concrete clicks and numbers", mike:"the Studio, video quality checks and YouTube views", carla:"Shopify, Etsy and listings", ray:"the app pipeline and the app idea of the day", diane:"money across every platform, grants and vendor events", nora:"research and The Lab Daily"}[key]||a.role;
  return `You are ${a.name}, ${a.role} on Aaron Lewis's team (you report to ${a.reports}). Your focus: ${scope}. Your job duties: ${dutiesOf(key).join("; ")}. The team: ${TEAM.map(x=>x.name+" ("+x.role+")").join(", ")}.
You're talking face to face with ${me()==="Aaron"?"Aaron, the owner":me()+", who helps Aaron run the business (treat their requests like Aaron's)"}. Be warm, upbeat and direct, like a good coworker who likes this job; plain spoken sentences, no markdown, no bullet symbols, under 110 words unless he asks for detail. Use only the dashboard data below for facts; if you don't have something, say you'll find out. Never invent numbers or claim work you didn't do.
${NAV_GUIDE}
If Aaron asks you (or the team) to do something, agree, say who will do it and set "task".
Reply as JSON only: {"reply": string, "task": null | {"for": one of ${TEAM.map(x=>x.key).join("|")}, "what": string}}
DASHBOARD DATA:
${snapshotForSteve()}
YOUR OWN RECENT WORK: ${JSON.stringify(S.activity.filter(x=>x.agent===key).slice(0,12).map(x=>({at:x.at,title:x.title,detail:x.detail})))}
${["sam","nora"].includes(key)?"APPS: "+JSON.stringify(S.apps.slice(0,20).map(x=>({name:x.name,stage:x.stage,next:x.next,qa:x.qa&&x.qa.verdict}))) + " OPEN QUESTIONS: "+JSON.stringify(S.questions.filter(q=>q.status!=="answered").map(q=>q.text)):""}
${key==="steve"?"ROADMAP: "+JSON.stringify(S.roadmap.slice().sort((a,b)=>(a.order??999)-(b.order??999)).map(x=>({title:x.title,phase:x.phase,status:x.status,why:x.why,how:x.how,owner:x.owner}))):""}
${key==="helen"?"MATTERS: "+JSON.stringify(S.matters.slice(0,15).map(m=>({title:m.title,status:m.status,plan:m.plan,needsYou:m.needsYou})))+" LEGAL: "+JSON.stringify(S.legal)+" LAST MEETINGS: "+JSON.stringify(S.meetings.slice(0,3)):""}
${["steve","helen"].includes(key)?"BILLS: "+JSON.stringify(S.bills.map(b=>({service:b.service,amount:b.amount,cycle:b.cycle,nextCharge:b.nextCharge,card:cardLabel(b.paidWith),status:b.status,business:b.business,flag:b.flag})))+" TAX: "+JSON.stringify(S.tax):""}
${key==="nora"?"PLATFORMS: "+JSON.stringify(S.platforms)+" PLAN: "+JSON.stringify(S.moneyPlan):""}`;
}
/* Chat window: double-click any teammate (Comms map, job list, Home tiles) to open your full chat log with them. */
let LASTDM={k:"",t:0}, CHAT=null;
function openChat(k){ if(!TEAM_BY[k]) return; CHAT={key:k, ret:CHAT?CHAT.ret:document.activeElement}; markDMSeen(k); paintChat(true); }
function closeChat(){ const r=CHAT&&CHAT.ret; CHAT=null; const b=$("#chatPop"); if(b) b.remove(); document.removeEventListener("keydown",chatKey); try{ if(r&&document.contains(r)) r.focus(); }catch{} }
function chatKey(e){ if(e.key==="Escape"&&CHAT) closeChat(); }
function paintChat(first){
  const old=$("#chatPop"); if(!CHAT){ if(old) old.remove(); return; }
  const a=TEAM_BY[CHAT.key]; const draft=old?($("#chatInput")||{}).value||"":""; const hadFocus=old&&document.activeElement&&document.activeElement.id==="chatInput";
  const u=me().toLowerCase(); const th=S.messages.filter(m=>(m.from===u&&m.to===a.key)||(m.from===a.key&&m.to===u)).sort((x,y)=>String(x.at).localeCompare(String(y.at)));
  const rl=S.roomLog[a.key]||[]; const pend=rl.slice(-1)[0]; const typing=pend&&pend.who==="you";
  const last2=rl.slice(-2); const unsaved=!typing&&last2.length===2&&last2[0].who==="you"&&last2[1].who==="them"&&!th.slice(-2).some(m=>m.text===last2[1].text);
  const bub=(mine,text,at)=>`<div style="display:flex;justify-content:${mine?"flex-end":"flex-start"};margin:6px 0"><div style="max-width:82%;padding:8px 12px;border-radius:14px;${mine?"background:var(--accent-strong);color:var(--accent-ink);border-bottom-right-radius:4px":"background:var(--raise);border:1px solid var(--line);border-bottom-left-radius:4px"}"><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(text)}</div>${at?`<div class="small" style="opacity:.7;margin-top:2px">${ago(at)}</div>`:""}</div></div>`;
  const box=document.createElement("div"); box.id="chatPop"; box.className="sheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-labelledby","chatTitle");
  box.innerHTML=`<div class="sheet-panel" style="width:min(620px,100%);display:flex;flex-direction:column;max-height:92vh">
    <div class="sheet-head" style="margin-bottom:8px">${av(a.key)}<div style="flex:1;min-width:0"><h2 id="chatTitle" style="margin:0;font:700 19px var(--f-display)">${esc(a.name)}</h2><div class="small muted">${esc(a.role)} · ${th.length} message${th.length===1?"":"s"}</div></div><button class="btn" type="button" id="chatClose">Close</button></div>
    <div id="chatLog" style="flex:1;min-height:220px;overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 2px">${th.length?th.map(m=>bub(m.from===u,m.text,m.at)).join(""):`<div class="empty" style="margin:8px 0">No messages with ${esc(a.name)} yet. Say hi, ask for an update, or give a job.</div>`}${unsaved?bub(true,last2[0].text,"")+bub(false,last2[1].text,""):""}${typing?bub(true,pend.text,"")+`<div class="small muted">${esc(a.name)} is typing…</div>`:""}</div>
    <form class="ask" id="chatForm" style="margin-top:10px"><input type="text" id="chatInput" placeholder="Message ${esc(a.name)}…" autocomplete="off" aria-label="Message ${esc(a.name)}" maxlength="1500"><button class="btn primary" type="submit" ${typing?"disabled":""}>Send</button></form>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" id="chatUpdate" ${typing?"disabled":""}>Get an update</button></div></div>`;
  if(old) old.replaceWith(box); else document.body.appendChild(box);
  document.removeEventListener("keydown",chatKey); document.addEventListener("keydown",chatKey);
  const inp=$("#chatInput"); inp.value=draft; paintAttach(); const log=$("#chatLog"); log.scrollTop=log.scrollHeight;
  if(first||hadFocus) setTimeout(()=>{ const i=$("#chatInput"); if(i) i.focus({preventScroll:true}); },30);
  $("#chatClose").onclick=closeChat; box.addEventListener("click",e=>{ if(e.target===box) closeChat(); });
  $("#chatForm").onsubmit=e=>{ e.preventDefault(); const v=$("#chatInput").value.trim(); const n=(ATT.chatInput||[]).length; if((!v&&!n)||typing) return; $("#chatInput").value=""; talkTo(a.key,v||"Take a look at this picture.",false,n?takeAtt("chatInput"):[]); };
  $("#chatUpdate").onclick=()=>{ if(!typing) talkTo(a.key,"Give me your update: what you did since your last run, what's next, and anything you need from me. Keep it to a few sentences.",true); };
}
async function talkTo(key, text, isUpdate, pics){ pics=pics||[];
  const a=TEAM_BY[key]; if(!sample){ toast(`Open Creative Lab Studios inside Claude to talk to ${a.name}.`); return; }
  const log=S.roomLog[key]=S.roomLog[key]||[]; if(!isUpdate) log.push({who:"you",text:text+(pics.length?` 📷×${pics.length}`:"")}); else log.push({who:"you",text:"What's your update?"});
  const inp=$("#roomInput"); if(inp) inp.value=""; render(); const btn=$("#roomBtn"); if(btn) btn.disabled=true;
  const convo=log.slice(-8).map(m=>`${m.who==="you"?me().toUpperCase():a.name.toUpperCase()}: ${m.text}`).join("\n");
  try{
    let out; const prompt=personaFor(key)+"\n\nCONVERSATION SO FAR:\n"+convo+"\n\n"+me().toUpperCase()+" SAYS: "+text+picNote(pics.length); const io=pics.length?{modelTier:"default",images:pics}:{modelTier:"default"};
    try{ out=await sample.json([{role:"user",content:prompt}],io); }
    catch(err){ if(err&&err.code==="not_granted") throw err; const r=await sample(prompt+"\n\nReply with the JSON only.",io); try{ out=JSON.parse((r.text||"").replace(/^[^{]*/,"").replace(/[^}]*$/,"")); }catch{ out={reply:r.text,task:null}; } }
    const reply=(out&&out.reply)||"Sorry, say that again?"; log.push({who:"them",text:reply}); speak(reply);
    if(db){ try{ const now=new Date().toISOString(); await db.collection("messages").add({from:me().toLowerCase(),to:key,text:isUpdate?"Asked for an update":text+(pics.length?` (sent ${pics.length} picture${pics.length===1?"":"s"})`:""),at:now}); await db.collection("messages").add({from:key,to:me().toLowerCase(),text:reply,at:new Date(Date.now()+1).toISOString()}); }catch{} }
    if(out&&out.task&&out.task.what&&db){ try{ const f=TEAM_BY[out.task.for]?out.task.for:key;
      await addReq({for:f, by:key, what:out.task.what, asked:text, status:"open", at:new Date().toISOString()});
      const tid=tidOf(f); if(tid) fire(tid,`${me()} asked ${a.name} in the Team Room: "${text}". Task for you: ${out.task.what}. Do it now, then mark the request done in "requests".`);
      toast(`${TEAM_BY[f].name} is on it.`); }catch{} }
  }catch(err){ log.push({who:"them",text: err&&err.code==="not_granted" ? "I need permission to talk. Allow Claude for this page in the Permissions menu." : "I couldn't answer just now. Try again in a moment."}); }
  finally{ render(); const b=$("#roomBtn"); if(b) b.disabled=false; }
}


async function newMatter(){
  const t=($("#mTitle").value||"").trim(), d=($("#mDetail").value||"").trim(); if(!t&&!d){ toast("Describe the matter first."); return; }
  if(!db){ toast("Can't save in this view."); return; }
  const now=new Date().toISOString();
  try{ const ref=await db.collection("matters").add({title:t||d.slice(0,80), detail:d, from:me().toLowerCase(), status:"new", owner:"helen", at:now, updatedAt:now, log:[{at:now,text:me()+" sent this to Helen"}]});
    $("#mTitle").value=""; $("#mDetail").value=""; toast("Helen has it. She's starting now.");
    const tid=tidOf("helen"); if(tid) fire(tid,`New legal matter matters/${ref.id} from ${me()}: "${t}". Review it now: set a plan, assign steps, and update its status.`);
  }catch{ toast("Couldn't save. Try again."); }
}
async function matterReply(id, done){
  const t=$("#mreply-"+id); const v=(t&&t.value||"").trim(); if(!v&&!done){ toast("Type a reply first."); return; }
  const m=S.matters.find(x=>x.id===id); if(!m||!db) return; const now=new Date().toISOString();
  const text=done?(me()+" marked their part done"+(v?": "+v:"")):(me()+": "+v);
  try{ await db.doc("matters/"+id).update({log:[...(m.log||[]),{at:now,text}], updatedAt:now, ...(done?{status:"in progress", aaronDoneAt:now}:{})});
    toast("Sent to Helen."); const tid=tidOf("helen"); if(tid) fire(tid,`${me()} replied on legal matter matters/${id}: "${text}". Continue it now.`);
  }catch{ toast("Couldn't send. Try again."); }
}
/* ---------- Pictures in chat: paste (Ctrl+V), drop, or tap the camera button ---------- */
let IMG_CAPS=null; const ATT={}; const ATT_IDS=["askInput","chatInput","roomInput","qaskInput"];
function attMax(){ return IMG_CAPS&&IMG_CAPS.maxCount||4; }
function attOk(f){ return f&&/^image\/(png|jpe?g|webp|gif)$/i.test(f.type||""); }
function addAtt(id,files){ if(!IMG_CAPS){ toast("Pictures need Claude to be allowed for this page (Permissions menu)."); return; }
  const list=ATT[id]=ATT[id]||[]; let skipped=0;
  [...files].forEach(f=>{ if(!attOk(f)){ skipped++; return; } if(list.length>=attMax()){ skipped++; return; } list.push({f, url:URL.createObjectURL(f)}); });
  if(skipped) toast(list.length>=attMax()?`Up to ${attMax()} pictures per message.`:"Only PNG, JPG, WebP or GIF pictures.");
  paintAttach(); const i=document.getElementById(id); if(i) i.focus({preventScroll:true}); }
function takeAtt(id){ const list=ATT[id]||[]; ATT[id]=[]; const files=list.map(x=>x.f); setTimeout(()=>list.forEach(x=>URL.revokeObjectURL(x.url)),60000); paintAttach(); return files; }
function paintAttach(){ ATT_IDS.forEach(id=>{ const inp=document.getElementById(id); if(!inp) return; const form=inp.closest("form"); if(!form) return;
  if(IMG_CAPS&&!form.querySelector(".attachbtn")){ const b=document.createElement("button"); b.type="button"; b.className="btn attachbtn"; b.title="Add a picture (or paste one with Ctrl+V)"; b.setAttribute("aria-label","Add a picture"); b.textContent="📷";
    const fi=document.createElement("input"); fi.type="file"; fi.accept=(IMG_CAPS.mediaTypes||["image/png","image/jpeg","image/webp","image/gif"]).join(","); fi.multiple=true; fi.hidden=true;
    b.onclick=()=>fi.click(); fi.onchange=()=>{ addAtt(id,fi.files); fi.value=""; }; inp.after(b); b.after(fi); }
  let strip=form.previousElementSibling; if(!strip||!strip.classList.contains("attstrip")){ strip=document.createElement("div"); strip.className="attstrip"; form.before(strip); }
  const list=ATT[id]||[]; strip.hidden=!list.length;
  strip.innerHTML=list.map((x,i)=>`<span class="attthumb"><img src="${x.url}" alt="Picture ${i+1} to send"><button type="button" aria-label="Remove picture ${i+1}" data-attrm="${id}|${i}">✕</button></span>`).join("")+(list.length?`<span class="small muted">${list.length} picture${list.length===1?"":"s"} will go with your message</span>`:"");
  strip.querySelectorAll("[data-attrm]").forEach(b=>b.onclick=()=>{ const [k,n]=b.dataset.attrm.split("|"); const it=(ATT[k]||[]).splice(+n,1)[0]; if(it) URL.revokeObjectURL(it.url); paintAttach(); }); }); }
document.addEventListener("paste",e=>{ const t=e.target; if(!t||!ATT_IDS.includes(t.id)) return; const files=[...(e.clipboardData&&e.clipboardData.files||[])].filter(attOk); if(!files.length) return; e.preventDefault(); addAtt(t.id,files); });
document.addEventListener("dragover",e=>{ const f=e.target.closest&&e.target.closest("form"); if(f&&ATT_IDS.some(id=>f.querySelector("#"+id))&&IMG_CAPS){ e.preventDefault(); f.classList.add("dropover"); } });
document.addEventListener("dragleave",e=>{ const f=e.target.closest&&e.target.closest("form"); if(f) f.classList.remove("dropover"); });
document.addEventListener("drop",e=>{ const f=e.target.closest&&e.target.closest("form"); if(!f) return; const id=ATT_IDS.find(k=>f.querySelector("#"+k)); if(!id||!IMG_CAPS) return; e.preventDefault(); f.classList.remove("dropover"); addAtt(id,e.dataTransfer.files); });
const picNote=n=>n?`\n\n${me()} attached ${n} picture${n===1?"":"s"} to this message. Look at ${n===1?"it":"them"} carefully and use what you see in your answer.`:"";
/* ---------- Ask Stephanie ---------- */
function snapshotForSteve(){
  return JSON.stringify({ today:new Date().toString(), brief:S.brief, metrics:S.metrics.slice(0,30), recentActivity:S.activity.slice(0,25).map(a=>({agent:a.agent,at:a.at,kind:a.kind,title:a.title,detail:a.detail})),
    queue:S.queue.slice(0,20).map(q=>({platform:q.platform,title:q.title,status:q.status,when:q.when,metrics:q.metrics})), openSetup:S.setup.filter(s=>!s.done).map(s=>s.title),
    listings:S.listings.slice(0,10).map(l=>({note:l.note,status:l.status,title:l.draft&&l.draft.title})), apps:S.apps.slice(0,15).map(a=>({name:a.name,stage:a.stage,next:a.next})), money:S.moneyPlan&&S.moneyPlan.summary, ideas:S.ideas.slice(0,10).map(i=>({text:i.text,status:i.status,title:i.analysis&&i.analysis.title,nextStep:i.analysis&&i.analysis.nextStep})),
    team:TEAM.map(a=>({name:a.name,role:a.role,schedule:a.schedule,lastRun:(S.agents[a.key]||{}).lastRun,last:(S.agents[a.key]||{}).lastSummary})) });
}
function closeAns(){ const b=$("#ansBox"); if(b) b.hidden=true; try{speechSynthesis.cancel()}catch{} }
$("#ansClose").onclick=closeAns; document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#ansBox").hidden&&!SHEET) closeAns(); });
$("#askForm").addEventListener("submit", async e=>{
  e.preventDefault(); let q=$("#askInput").value.trim(); const pics=(ATT.askInput||[]).length?takeAtt("askInput"):[]; if(!q&&!pics.length) return; if(!q) q="Take a look at this picture.";
  if(typeof stephAgent==="function"){ try{ if(await stephAgent(q,pics)) return; }catch(err){ console.warn("stephanie agent",err); } }
  const ans=$("#answer"); $("#ansBox").hidden=false;
  if(!sample){ ans.textContent="Stephanie can't answer in this view. Open Creative Lab Studios inside Claude to talk to her."; return; }
  $("#askBtn").disabled=true; ans.textContent="Stephanie is thinking…";
  const sys = `You are Stephanie, chief of staff for Aaron's businesses: Elevated Designs LLC (Charleston SC; DTF shirts + 3D prints; considering the name Creative Lab Studios; brands include Little Porch Apparel; Shopify store; Facebook/TikTok via Holo; goal $500k/yr in 2-5 years) and two YouTube channels run from Studio (Released Footage: official police bodycam releases, daily 6 AM; Funny Video Clips: daily 7 AM compilations + Shorts). Your team: ${TEAM.filter(x=>x.key!=="steve").map(x=>x.name+" ("+x.role+", reports to "+x.reports+")").join("; ")}. The channels are built around views.
When you tell Aaron to do something, say exactly where on this dashboard, or give the full link. ${NAV_GUIDE} Never say "open X's task" without saying where it is. Answer in a warm, plain, direct voice, as if talking out loud: short sentences, no markdown, no bullet symbols, under 120 words unless asked for more. Use only the dashboard data below for facts about the business; if something isn't in it, say you'll have the team find out. Never invent numbers.
If Aaron asks for something to be done, say who on the team will handle it and set "task".
Reply as JSON only: {"reply": string, "task": null | {"for": one of ${TEAM.map(x=>x.key).join("|")}, "what": string}}
DASHBOARD DATA:
${snapshotForSteve()}`;
  try{
    let out;
    const io=pics.length?{modelTier:"default",images:pics}:{modelTier:"default"};
    try{ out = await sample.json([{role:"user",content: sys+"\n\n"+me().toUpperCase()+" SAYS: "+q+picNote(pics.length)}], io); }
    catch(err){ if(err && err.code==="not_granted") throw err; const r=await sample(sys+"\n\n"+me().toUpperCase()+" SAYS: "+q+picNote(pics.length)+"\n\nReply with the JSON only.",io); try{ out=JSON.parse((r.text||"").replace(/^[^{]*/,"").replace(/[^}]*$/,"")); }catch{ out={reply:r.text,task:null}; } }
    const reply = (out && out.reply) || "I didn't catch that. Try asking another way.";
    ans.textContent = reply; speak(reply); $("#askInput").value="";
    if(out && out.task && out.task.what && db){
      try{ const tf=TEAM_BY[out.task.for]?out.task.for:"steve";
        await addReq({for:tf, by:me().toLowerCase(), what:String(out.task.what).slice(0,600), asked:q, status:"open", at:new Date().toISOString()});
        const tid=tidOf(tf); if(tid) fire(tid, `${me()} just asked from the dashboard: "${q}". Task: ${out.task.what}. Handle it now, then mark the request done in the "requests" collection.`);
      }catch{}
    }
  }catch(err){
    ans.textContent = err && err.code==="not_granted" ? "Allow Stephanie to use Claude for this page to talk to her (Permissions menu)." : err && err.code==="rate_limited" ? "Stephanie needs a minute. Try again shortly." : "Stephanie couldn't answer just now. Try again.";
  }finally{ $("#askBtn").disabled=false; }
});


/* ---------- Quick access drawer ---------- */
const LINK_GROUPS=["Workspace","Studio","Store & social","Money & legal","My apps"];
const QA={open:false, tab:"links", noteSel:null, editLinks:false, armDel:null};
let uid=null, userNs=null, downloads=null, saveTimer=null;
function qaLinks(){
  const items=S.links.slice().sort((a,b)=>(a.order??99)-(b.order??99));
  const groups=LINK_GROUPS.concat([...new Set(items.map(l=>l.group).filter(g=>g&&!LINK_GROUPS.includes(g)))]);
  const body = items.length ? groups.map(g=>{ const ls=items.filter(l=>(l.group||"Workspace")===g); if(!ls.length) return "";
    return `<div class="lgrp"><div class="eyebrow">${esc(g)}</div><div class="lgrid">${ls.map(l=>{ const u=safeUrl(l.url); if(!u) return ""; const ini=(l.name||"?").replace(/[^A-Za-z0-9]/g,"").slice(0,2)||"?";
      return `<a class="ltile" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(l.note||l.name)}"><span class="ic" style="background:var(--raise);color:var(--fg);border:1px solid var(--line)">${esc(ini)}</span><span class="nm">${esc(l.name)}</span>${QA.editLinks?`<button class="x" type="button" data-ldel="${esc(l.id)}" aria-label="Remove ${esc(l.name)}">${QA.armDel===l.id?"Sure?":"✕"}</button>`:""}</a>`; }).join("")}</div></div>`; }).join("")
    : `<div class="empty">Your quick links load here.</div>`;
  return `${body}
    <form class="drop" id="linkForm" style="border-top:1px solid var(--line);padding-top:12px"><div class="eyebrow">Add a link</div>
      <input type="text" id="lName" placeholder="Name, e.g. Shopify admin" autocomplete="off">
      <input type="text" id="lUrl" placeholder="https://…" autocomplete="off" inputmode="url">
      <div class="actions"><select id="lGroup" style="width:auto">${LINK_GROUPS.map(g=>`<option>${esc(g)}</option>`).join("")}</select><span style="flex:1"></span>
        <button class="btn" type="button" id="lEdit">${QA.editLinks?"Done editing":"Edit"}</button><button class="btn primary" type="submit">Add</button></div></form>`;
}
function qaNotes(){
  if(!S.notes.length) return `<div class="empty">${db&&uid?"Starting your first note…":"Your notepad works when Creative Lab Studios is open inside Claude."}</div>`;
  if(!S.notes.find(n=>n.id===QA.noteSel)) QA.noteSel=S.notes[0].id;
  const n=S.notes.find(x=>x.id===QA.noteSel);
  return `<div class="np-tabs">${S.notes.map(x=>`<button class="btn" type="button" data-nsel="${esc(x.id)}" ${x.id===QA.noteSel?'style="border-color:var(--accent);color:var(--accent)"':""}>${esc(x.title||"Untitled")}</button>`).join("")}<button class="btn" type="button" id="nNew" aria-label="New note">+ New</button></div>
    <input type="text" id="nTitle" value="${esc(n.title||"")}" placeholder="Note title" aria-label="Note title">
    <textarea class="np-area" id="nBody" placeholder="Type, paste, or drop a text file here. Saves automatically." aria-label="Note">${esc(n.body||"")}</textarea>
    <div class="np-drop" id="nDrop">Drop text files here to add them to this note${assets?", or images to attach them":""}. Or <label for="nFile" style="color:var(--accent);cursor:pointer">choose a file</label><input type="file" id="nFile" hidden multiple></div>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><span class="small muted" id="nSaved" style="flex:1">${n.updatedAt?"Saved "+ago(n.updatedAt):""}</span>
      <button class="btn" type="button" id="nCopy">Copy</button>${downloads?`<button class="btn" type="button" id="nTxt">Save as .txt</button>`:""}<button class="btn" type="button" id="nDel">${QA.armDel==="note:"+n.id?"Tap again to delete":"Delete"}</button></div>
    <p class="small muted" style="margin:0">Private to you. Don't keep passwords here; use a password manager.</p>`;
}
function renderQA(){
  const keep={t:$("#nTitle")?.value, b:$("#nBody")?.value, f:document.activeElement&&document.activeElement.id};
  $("#qaBody").innerHTML = QA.tab==="links"?qaLinks():qaNotes();
  document.querySelectorAll(".qa-tabs [data-qtab]").forEach(b=>b.setAttribute("aria-selected", b.dataset.qtab===QA.tab?"true":"false"));
  if(QA.tab==="notes" && keep.f && (keep.f==="nBody"||keep.f==="nTitle")){ const e=$("#"+keep.f); if(e){ if(keep.f==="nBody"&&keep.b!=null) e.value=keep.b; if(keep.f==="nTitle"&&keep.t!=null) e.value=keep.t; e.focus(); } }
  bindQA();
}
function setQA(open){ QA.open=open; $("#qa").classList.toggle("open",open); $("#qa").setAttribute("aria-hidden",open?"false":"true"); if(open) $("#qa").removeAttribute("inert"); else $("#qa").setAttribute("inert",""); $("#qaScrim").hidden=!open; if(open) renderQA(); }
$("#qaOpen").onclick=()=>{ hmenu(false); setQA(true); };
function hmenu(open){ const p=$("#hmenuPop"), b=$("#hmenuBtn"); if(!p) return; p.hidden=!open; b.setAttribute("aria-expanded",open?"true":"false"); }
$("#hmenuBtn").onclick=e=>{ e.stopPropagation(); hmenu($("#hmenuPop").hidden); };
document.addEventListener("click",e=>{ if(!e.target.closest(".hmenu")) hmenu(false); else if(e.target.closest("#pinBtn,#lockBtn,#themeBtn")) setTimeout(()=>hmenu(false),0); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") hmenu(false); }); $("#qaClose").onclick=()=>setQA(false); $("#qaScrim").onclick=()=>setQA(false);
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&QA.open) setQA(false); });
document.querySelectorAll(".qa-tabs [data-qtab]").forEach(b=>b.onclick=()=>{ QA.tab=b.dataset.qtab; renderQA(); });
function notesCol(){ return db&&uid?db.collection("data/users/"+uid):null; }
function scheduleSave(){ clearTimeout(saveTimer); const sv=$("#nSaved"); if(sv) sv.textContent="Saving…"; saveTimer=setTimeout(saveNote,700); }
async function saveNote(){ const c=notesCol(); if(!c||!QA.noteSel) return; const t=$("#nTitle"), b=$("#nBody"); if(!t||!b) return;
  try{ await c.doc(QA.noteSel).update({title:t.value, body:b.value, updatedAt:new Date().toISOString()}); const sv=$("#nSaved"); if(sv) sv.textContent="Saved just now"; }catch{ const sv=$("#nSaved"); if(sv) sv.textContent="Couldn't save. Check your connection."; } }
async function newNote(title, body){ const c=notesCol(); if(!c){ toast("Open Creative Lab Studios in Claude to use the notepad."); return; }
  try{ const ref=await c.add({kind:"note", title:title||"New note", body:body||"", at:new Date().toISOString(), updatedAt:new Date().toISOString()}); QA.noteSel=ref.id; }catch{ toast("Couldn't create a note."); } }
async function addFiles(files){
  const b=$("#nBody"); if(!b) return; let add="";
  for(const f of files){
    if(/^text\/|json|csv|xml|markdown/.test(f.type) || /\.(txt|md|csv|json|log)$/i.test(f.name)){ try{ add+=`\n\n--- ${f.name} ---\n`+(await f.text()); }catch{ toast("Couldn't read "+f.name); } }
    else if(assets && /^image\/|pdf/.test(f.type)){ try{ const r=await assets.upload(f); add+=`\n[${f.name}](${r.url})`; }catch{ toast("Couldn't attach "+f.name); } }
    else toast(f.name+" isn't a text file.");
  }
  if(add){ b.value=(b.value||"")+add; scheduleSave(); toast("Added to your note"); }
}
function bindQA(){
  const lf=$("#linkForm"); if(lf) lf.onsubmit=async e=>{ e.preventDefault(); const n=$("#lName").value.trim(); let u=$("#lUrl").value.trim(); if(u&&!/^https?:\/\//i.test(u)) u="https://"+u;
    if(!n||!safeUrl(u)){ toast("Add a name and a web address."); return; } if(!db){ toast("Open Creative Lab Studios in Claude to save links."); return; }
    try{ await db.collection("links").add({name:n,url:u,group:$("#lGroup").value,order:100+S.links.length,at:new Date().toISOString()}); $("#lName").value=""; $("#lUrl").value=""; toast("Link added"); }catch{ toast("Couldn't save the link."); } };
  const le=$("#lEdit"); if(le) le.onclick=()=>{ QA.editLinks=!QA.editLinks; QA.armDel=null; renderQA(); };
  document.querySelectorAll("[data-ldel]").forEach(b=>b.onclick=async e=>{ e.preventDefault(); e.stopPropagation(); const id=b.dataset.ldel; if(QA.armDel!==id){ QA.armDel=id; renderQA(); return; }
    try{ await db.doc("links/"+id).delete(); QA.armDel=null; toast("Link removed"); }catch{ toast("Couldn't remove it."); } });
  document.querySelectorAll("[data-nsel]").forEach(b=>b.onclick=async()=>{ await saveNote(); QA.noteSel=b.dataset.nsel; QA.armDel=null; renderQA(); });
  const nn=$("#nNew"); if(nn) nn.onclick=async()=>{ await saveNote(); await newNote(); };
  const nt=$("#nTitle"), nb=$("#nBody"); if(nt) nt.oninput=scheduleSave; if(nb) nb.oninput=scheduleSave;
  const nd=$("#nDrop"); if(nd){ ["dragover","dragenter"].forEach(ev=>nd.addEventListener(ev,e=>{e.preventDefault(); nd.classList.add("over");})); ["dragleave","drop"].forEach(ev=>nd.addEventListener(ev,()=>nd.classList.remove("over")));
    nd.addEventListener("drop",e=>{ e.preventDefault(); const fs=[...(e.dataTransfer.files||[])]; if(fs.length) addFiles(fs); else { const t=e.dataTransfer.getData("text"); if(t&&nb){ nb.value+=(nb.value?"\n":"")+t; scheduleSave(); } } }); }
  if(nb){ nb.addEventListener("drop",e=>{ const fs=[...(e.dataTransfer.files||[])]; if(fs.length){ e.preventDefault(); addFiles(fs); } }); }
  const nf=$("#nFile"); if(nf) nf.onchange=()=>{ addFiles([...nf.files]); nf.value=""; };
  const nc=$("#nCopy"); if(nc) nc.onclick=async()=>{ try{ await navigator.clipboard.writeText($("#nBody").value); toast("Copied"); }catch{ $("#nBody").select(); toast("Selected. Copy it from here."); } };
  const ntx=$("#nTxt"); if(ntx) ntx.onclick=async()=>{ const t=($("#nTitle").value||"note").replace(/[^\w\- ]+/g,"").trim()||"note";
    try{ await downloads.save({filename:t+".txt", data:new Blob([$("#nBody").value],{type:"text/plain"})}); }catch(e){ if(!e||e.code!=="cancelled") toast("Couldn't save the file."); } };
  const ndl=$("#nDel"); if(ndl) ndl.onclick=async()=>{ const id=QA.noteSel; if(QA.armDel!=="note:"+id){ QA.armDel="note:"+id; renderQA(); return; }
    try{ await notesCol().doc(id).delete(); QA.armDel=null; QA.noteSel=null; toast("Note deleted"); }catch{ toast("Couldn't delete."); } };
}

/* ---------- Sign-in (3 people) ----------
   A privacy screen on top of Claude's own sharing. Only people you share this page with can open it at all;
   the PIN picks who is using it and keeps it locked on a shared or unattended screen. PINs are stored only as
   salted PBKDF2 hashes. Nothing loads until someone unlocks, and every reload asks for the PIN again. */
const USERS={Aaron:{salt:"50b226d94d73a0796d8ca51878d2968c",hash:"1e7beca31efa795fc8f54a0de898358cb2bb4ee8f7a1ad215c71aba0abd5278a"},
             Shana:{salt:"382bec956966f97c69228e71149119b3",hash:"0f1525373fe7468f2958af14773450e2d5edde881eeefd616f548256dc350661",mustChange:true},
             Josh:{salt:"dabb5fd41df90074b16578bda54e00e2",hash:"d303d224057f48a8ca8e72c01c8591643ca897ae533938084853f0796d967d4a",mustChange:true}};
/* PIN changes are saved per Claude account in pins/<account id> = {names:{<name>:{salt,hash,at}}}. Once anyone changes a name's PIN,
   the starter PIN for that name stops working everywhere, and the new PIN works only on the account that set it. */
let PINS=null;
async function loadPins(){ try{ if(!db||!uid) return; PINS={}; const d=await db.doc("data/users/"+uid+"/pin").get(); if(d.exists) PINS[uid]=(d.data()||{}).names||{}; }catch{ PINS=null; } }
function pinRecord(name){
  if(PINS){ const mine=uid&&PINS[uid]&&PINS[uid][name]; if(mine) return {rec:mine, custom:true};
  }
  return {rec:USERS[name], custom:false};
}
let CUR=null, pinWho=null, pinBuf="", fails=0, lockedUntil=0, idleTimer=null;
const IDLE_MS=30*60*1000;
function ss(k,v){ try{ if(v===undefined) return sessionStorage.getItem(k); if(v===null) sessionStorage.removeItem(k); else sessionStorage.setItem(k,v); }catch{ return null; } }
async function pinHash(name,pin,u){ try{ u=u||USERS[name]; const salt=new Uint8Array(u.salt.match(/../g).map(h=>parseInt(h,16)));
  const key=await crypto.subtle.importKey("raw", new TextEncoder().encode("ehq|"+name.toLowerCase()+"|"+pin), "PBKDF2", false, ["deriveBits"]);
  const b=await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations:210000}, key, 256);
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }catch{ return null; } }
function setInert(on){ ["#main",".dock","header.top","#qa","#qaOpen",".pinbox"].forEach(sel=>{ const e=document.querySelector(sel); if(e){ if(on||(sel==="#qa"&&!QA.open)) e.setAttribute("inert",""); else e.removeAttribute("inert"); } }); }
function paintPin(){ document.querySelectorAll("#dots i").forEach((d,i)=>d.classList.toggle("on", i<pinBuf.length)); }
function showLock(msg){ try{ closeChat(); }catch{} try{ schClose(); }catch{} try{ catClose(); }catch{} document.querySelectorAll(".xsheet,.cmdk").forEach(x=>x.remove()); try{ dlReset(); }catch{} try{ stephReset(); const a=document.getElementById("answer"); if(a) a.textContent=""; const ab=document.getElementById("ansBox"); if(ab) ab.hidden=true; }catch{} try{ if(typeof CMDK!=="undefined") CMDK=null; }catch{} CUR=null; ss("ehq-user",null); ss("ehq-fails",null); $("#lock").hidden=false; setInert(true); pinBuf=""; paintPin(); $("#lockMsg").textContent=msg||""; $("#whoami").textContent=""; try{speechSynthesis.cancel()}catch{} }
let booted=false;
function unlock(name){ CUR=name; $("#lock").hidden=true; setInert(false); $("#whoami").textContent=name; bumpIdle(); if(!booted){ booted=true; boot(); } else render(); }
function bumpIdle(){ clearTimeout(idleTimer); if(CUR) idleTimer=setTimeout(()=>showLock("Locked after 30 minutes idle."), IDLE_MS); }
["click","keydown","touchstart"].forEach(ev=>document.addEventListener(ev,()=>{ if(CUR) bumpIdle(); },{passive:true}));
async function pressKey(k){
  if(!pinWho){ $("#lockMsg").textContent="Pick your name first."; return; }
  if(Date.now()<lockedUntil){ $("#lockMsg").textContent=`Too many tries. Wait ${Math.ceil((lockedUntil-Date.now())/1000)} seconds.`; return; }
  if(k==="del"){ pinBuf=pinBuf.slice(0,-1); paintPin(); return; }
  if(pinBuf.length>=4) return; pinBuf+=k; paintPin();
  if(pinBuf.length===4){
    const pr=pinRecord(pinWho);
    if(pr.moved){ pinBuf=""; paintPin(); $("#lockMsg").textContent=pinWho+"'s PIN was changed on a different Claude account. Sign in there."; return; }
    const h=await pinHash(pinWho,pinBuf,pr.rec);
    if(h && h===pr.rec.hash){ fails=0; unlock(pinWho); if(!pr.custom && USERS[pinWho].mustChange) setTimeout(()=>openPinChange(true),300); }
    else { fails++; pinBuf=""; paintPin(); const c=$(".lock-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
      if(!h){ $("#lockMsg").textContent="This browser can't check the PIN. Open the page in Claude."; return; }
      if(fails>=5){ lockedUntil=Date.now()+60000; fails=0; try{localStorage.setItem("ehq-wait",String(lockedUntil))}catch{} $("#lockMsg").textContent="Too many tries. Locked for 1 minute."; }
      else $("#lockMsg").textContent="Wrong PIN. Try again."; }
  }
}
(function initLock(){
  const keys=$("#keys"); keys.innerHTML=[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join("")+`<span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Delete">⌫</button>`;
  keys.addEventListener("click",e=>{ const b=e.target.closest("[data-k]"); if(b) pressKey(b.dataset.k); });
  document.querySelectorAll("#whoPick [data-who]").forEach(b=>b.onclick=()=>{ pinWho=b.dataset.who; pinBuf=""; paintPin(); document.querySelectorAll("#whoPick [data-who]").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false")); $("#lockHint").textContent=`Hi ${pinWho}. Enter your 4-digit PIN.`; $("#lockMsg").textContent=""; });
  document.addEventListener("keydown",e=>{ if($("#lock").hidden) return; if(/^[0-9]$/.test(e.key)) pressKey(e.key); else if(e.key==="Backspace") pressKey("del"); });
  $("#lockBtn").onclick=()=>showLock(""); $("#themeBtn").onclick=toggleTheme; paintTheme(); $("#cmdkBtn").onclick=openCmdk; $("#pinBtn").onclick=()=>openPinChange(false);
  try{ const w=+localStorage.getItem("ehq-wait")||0; if(w>Date.now()) lockedUntil=w; }catch{}
  showLock("");
})();
function me(){ return CUR||"Aaron"; }
function openPinChange(required){
  if(!db||!uid){ if(required) toast("Open Creative Lab Studios inside Claude to set your own PIN."); else toast("Changing your PIN works inside Claude."); return; }
  const box=document.createElement("div"); box.className="pinbox"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true");
  box.innerHTML=`<section class="card" style="width:min(380px,100%)"><div class="card-head"><h2>${required?"Welcome, "+esc(CUR)+". Set your own PIN":"Change your PIN"}</h2></div>
    <p class="small muted" style="margin:0 0 10px">${required?"Your starter PIN only works once. Pick 4 digits only you know.":"Pick 4 new digits. The old PIN stops working."}</p>
    <form id="pinForm" style="display:flex;flex-direction:column;gap:8px"><input id="pin1" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" type="password" placeholder="New 4-digit PIN" aria-label="New PIN" autocomplete="new-password">
    <input id="pin2" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" type="password" placeholder="Type it again" aria-label="Repeat new PIN" autocomplete="new-password">
    <div class="lock-msg" id="pinMsg"></div><div style="display:flex;gap:8px"><button class="btn primary" type="submit">Save PIN</button>${required?"":'<button class="btn" type="button" id="pinCancel">Cancel</button>'}</div></form></section>`;
  document.body.appendChild(box); setTimeout(()=>{ const i=$("#pin1"); if(i) i.focus(); },50);
  const pc=$("#pinCancel"); if(pc) pc.onclick=()=>box.remove();
  $("#pinForm").onsubmit=async e=>{ e.preventDefault(); const a=$("#pin1").value, b=$("#pin2").value, m=$("#pinMsg");
    if(!/^[0-9]{4}$/.test(a)){ m.textContent="Use exactly 4 digits."; return; } if(a!==b){ m.textContent="Those don't match."; return; }
    if(USERS[CUR] && await pinHash(CUR,a)===USERS[CUR].hash){ m.textContent="Pick something other than the starter PIN."; return; }
    const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,"0")).join("");
    const hash=await pinHash(CUR,a,{salt}); if(!hash){ m.textContent="This browser can't save a PIN."; return; }
    try{ const ref=db.doc("data/users/"+uid+"/pin"); const cur=await ref.get(); const names={...((cur.exists&&cur.data().names)||{})}; names[CUR]={salt,hash,at:new Date().toISOString()};
      await ref.set({names}); await loadPins(); box.remove(); toast("PIN saved. Use it next time you sign in."); }
    catch(err){ console.error("pin save",err); m.textContent="Couldn't save. Try again, or tell Aaron (code: "+((err&&err.code)||"save")+")."; } };
}
