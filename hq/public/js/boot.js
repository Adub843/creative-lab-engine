let READY=null;
function init(){ if(READY) return READY; READY=(async()=>{
  const c = window.claude; if(!c || !c.use) return;
  [db, mcp, sample, assets, userNs, downloads] = await Promise.all(["db","mcp","sample","assets","user","downloads"].map(n=>c.use(n).catch(()=>null)));
  if(sample&&sample.limits){ try{ const lim=await sample.limits(); IMG_CAPS=lim&&lim.images||null; }catch{ IMG_CAPS=null; } } paintAttach();
  try{ uid = userNs ? await userNs.id() : null; }catch{ uid=null; }
  try{ IS_OWNER = userNs ? !!(await userNs.isOwner()) : false; }catch{ IS_OWNER=false; }
  await loadPins(); })(); return READY; }
init();
async function boot(){
  $("#today").textContent = new Date().toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"});
  paintVoice(); render();
  await init();
  if(db){
    db.collection("agents").onSnapshot(s=>{ S.agents=Object.fromEntries(s.docs.map(d=>[d.id,d.data()])); render(); }, ()=>{});
    db.collection("activity").orderBy("at","desc").limit(150).onSnapshot(s=>{ S.activity=s.docs.map(d=>normAct({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("metrics").onSnapshot(s=>{ S.metrics=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("brief/today").onSnapshot(d=>{ const was=S.brief&&S.brief.at; S.brief=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("ideas").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.ideas=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("listings").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.listings=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("links").onSnapshot(s=>{ S.links=s.docs.map(d=>({id:d.id,...d.data()})).filter(l=>!l.removed); if(QA.open&&QA.tab==="links") renderQA(); }, ()=>{});
    if(uid){ let first=true; db.collection("data/users/"+uid).onSnapshot(s=>{ S.notes=s.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.kind==="note").sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      if(first&&!S.notes.length){ first=false; newNote("Notes","Welcome to your notepad. Each tab is its own note, and everything saves on its own.\n\nDrop a .txt file in to add it, or tap Save as .txt to take a note with you."); return; }
      first=false; const typing=QA.open&&QA.tab==="notes"&&["nBody","nTitle"].includes(document.activeElement&&document.activeElement.id); if(QA.open&&QA.tab==="notes"&&!typing) renderQA(); }, ()=>{}); }
    hqxSubscribe();
    db.collection("training").onSnapshot(s=>{ S.training=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("roadmap").onSnapshot(s=>{ S.roadmap=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("matters").orderBy("at","desc").limit(100).onSnapshot(s=>{ S.matters=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("paperwork").onSnapshot(s=>{ S.paperwork=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("legal").onSnapshot(s=>{ S.legal=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("meetings").orderBy("at","desc").limit(14).onSnapshot(s=>{ S.meetings=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("bills").onSnapshot(s=>{ S.bills=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("tax").onSnapshot(s=>{ S.tax=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("apps").onSnapshot(s=>{ S.apps=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("questions").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.questions=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("platforms").onSnapshot(s=>{ S.platforms=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("pricing/fees").onSnapshot(d=>{ S.pricing=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("billchanges").orderBy("at","desc").limit(100).onSnapshot(s=>{ S.billchanges=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("money/bills-review").onSnapshot(d=>{ S.billsReview=d.exists?d.data():null; render(); }, ()=>{});
    db.doc("money/plan").onSnapshot(d=>{ S.moneyPlan=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("kudos").orderBy("at","desc").limit(500).onSnapshot(s=>{ S.kudos=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("messages").orderBy("at","desc").limit(400).onSnapshot(s=>{ S.messages=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("requests").orderBy("at","desc").limit(100).onSnapshot(s=>{ S.requests=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("queue").orderBy("when","desc").limit(80).onSnapshot(s=>{ S.queue=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("bugs").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.bugs=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("maintenance/today").onSnapshot(d=>{ S.maint=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("appideas").orderBy("at","desc").limit(300).onSnapshot(s=>{ S.appideas=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("printideas").orderBy("at","desc").limit(150).onSnapshot(s=>{ S.printideas=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("market/today").onSnapshot(d=>{ S.market=d.exists?d.data():null; render(); }, ()=>{});
    db.doc("seo/status").onSnapshot(d=>{ S.seoStatus=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("agentproducts").onSnapshot(s=>{ S.agentproducts=s.docs.map(d=>({id:d.id,...d.data()})); if(S.tab==="agents") render(); }, ()=>{});
    db.collection("repos").onSnapshot(s=>{ S.repos=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("repochanges").orderBy("at","desc").limit(30).onSnapshot(s=>{ S.repochanges=s.docs.map(d=>({id:d.id,...d.data()})); const done=S.repochanges.filter(c=>c.status==="done"); done.forEach(c=>{ const id=codeFileId(c.repo,c.path); if(S.repofiles&&S.repofiles[id]&&S.repofiles[id].pending) delete S.repofiles[id]; }); render(); }, ()=>{});
    S.shop=S.shop||{}; db.collection("shop").onSnapshot(s=>{ const parts={}; s.docs.forEach(d=>{ const m=d.id.match(/^(shopify|etsy)-(ed|c3d)(?:-(\d+))?$/); if(!m) return; const k=m[1]+"-"+m[2]; (parts[k]=parts[k]||[]).push({n:+(m[3]||1),d:d.data()}); }); ["shopify-ed","shopify-c3d","etsy-ed","etsy-c3d"].forEach(k=>{ const ps=(parts[k]||[]).sort((a,b)=>a.n-b.n); S.shop[k]=ps.length?{...ps[0].d,items:[].concat(...ps.map(p=>Array.isArray(p.d.items)?p.d.items:[])),parts:ps.length}:null; }); render(); }, ()=>{});
    db.collection("storeops").orderBy("at","desc").limit(40).onSnapshot(s=>{ S.storeops=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("seo/keywords").onSnapshot(d=>{ S.seoKeywords=d.exists&&Array.isArray(d.data().items)?d.data().items:[]; render(); }, ()=>{});
    db.doc("seo/playbook").onSnapshot(d=>{ S.playbook=d.exists?d.data():null; render(); }, ()=>{});
    db.doc("seo/properties").onSnapshot(d=>{ S.seoProps=d.exists&&Array.isArray(d.data().properties)?d.data().properties:[]; render(); }, ()=>{});
    db.collection("curriculum").limit(60).onSnapshot(s=>{ S.curriculum=Object.fromEntries(s.docs.map(d=>[d.id,d.data()])); render(); }, ()=>{});
    db.collection("seoaudit").limit(60).onSnapshot(s=>{ S.seoaudit=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("seotrack").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.seotrack=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("ads").orderBy("at","desc").limit(120).onSnapshot(s=>{ S.ads=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("videos").orderBy("at","desc").limit(60).onSnapshot(s=>{ S.videos=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("huddle").orderBy("at","desc").limit(200).onSnapshot(s=>{ S.huddle=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("design/ideas").onSnapshot(d=>{ const x=d.exists?d.data():null; S.designIdeas=x&&Array.isArray(x.ideas)?x.ideas.length:0; render(); }, ()=>{});
    db.collection("brands").onSnapshot(s=>{ S.brands=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("designs").orderBy("at","desc").limit(300).onSnapshot(s=>{ S.designs=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.doc("news/today").onSnapshot(d=>{ S.news=d.exists?d.data():null; render(); }, ()=>{});
    db.collection("jobs").onSnapshot(s=>{ S.jobs=Object.fromEntries(s.docs.map(d=>[d.id,d.data()])); render(); }, ()=>{});
    db.collection("changes").orderBy("at","desc").limit(40).onSnapshot(s=>{ S.changes=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("c3d").onSnapshot(s=>{ S.c3d=Object.fromEntries(s.docs.map(d=>[d.id,{id:d.id,...d.data()}])); render(); }, ()=>{});
    db.collection("replies").onSnapshot(s=>{ S.replies=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
    db.collection("setup").onSnapshot(s=>{ S.setup=s.docs.map(d=>({id:d.id,...d.data()})); render(); }, ()=>{});
  }
  watchTriggers(); render();
}

/* ---------- Circuit-board background: faint traces, colored pulses shoot along them every 90 s ---------- */
(function(){
  const cv=document.createElement("canvas"); cv.id="circuitBg"; cv.setAttribute("aria-hidden","true"); document.body.prepend(cv);
  const ctx=cv.getContext("2d"); if(!ctx) return; const base=document.createElement("canvas"); const bctx=base.getContext("2d");
  const reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  let traces=[], W=0, H=0, DPR=1, pulses=[], running=false;
  const G=26; const rnd=(a,b)=>a+Math.random()*(b-a); const pick=a=>a[Math.floor(Math.random()*a.length)];
  const light=()=>document.documentElement.getAttribute("data-theme")==="light"||(!document.documentElement.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme: light)").matches&&false);
  /* Dense, intercut board: a fine grid, many long traces that turn often, 45° jogs, branches that fork off existing
     traces, and perpendicular crossings allowed (drawn as tiny bridges) so the weave reads as layered copper. */
  function build(){
    DPR=Math.min(2,window.devicePixelRatio||1); W=innerWidth; H=innerHeight;
    for(const c of [cv,base]){ c.width=W*DPR; c.height=H*DPR; } cv.style.width=W+"px"; cv.style.height=H+"px";
    traces=[]; const cols=Math.ceil(W/G)+1, rows=Math.ceil(H/G)+1; const used=new Map(); const key=(x,y)=>x+","+y;
    const DIRS=[[1,0],[0,1],[-1,0],[0,-1]];
    function walk(x,y,dir,len,pts){
      for(let i=0;i<len;i++){
        if(Math.random()<0.34){ const turn=dir[0]?pick([[dir[0],1],[dir[0],-1],[0,1],[0,-1]]):pick([[1,dir[1]],[-1,dir[1]],[1,0],[-1,0]]); dir=turn; }
        const nx=x+dir[0], ny=y+dir[1]; if(nx<0||ny<0||nx>cols||ny>rows) break;
        const k=key(nx,ny), prev=used.get(k);
        if(prev){ /* crossing: only straight through a perpendicular trace, and not too often */
          const perp=(prev[0]===0)!==(dir[0]===0); if(!perp||Math.random()<0.45) break;
          const fx=nx+dir[0], fy=ny+dir[1]; if(fx<0||fy<0||fx>cols||fy>rows||used.has(key(fx,fy))) break;
          pts.push([nx,ny,1]); pts.push([fx,fy,0]); used.set(key(fx,fy),dir); x=fx; y=fy; continue; }
        used.set(k,dir); pts.push([nx,ny,0]); x=nx; y=ny; }
      return pts; }
    const n=Math.round(cols*rows/2.2);
    for(let t=0;t<n;t++){ const x=Math.floor(rnd(0,cols)), y=Math.floor(rnd(0,rows)); if(used.has(key(x,y))) continue;
      const dir=pick(DIRS); used.set(key(x,y),dir); const pts=walk(x,y,dir,Math.floor(rnd(5,22)),[[x,y,0]]); if(pts.length>2) traces.push(pts); }
    /* branches: fork off the middle of existing traces */
    const nb=Math.round(traces.length*0.45);
    for(let b=0;b<nb;b++){ const src=pick(traces); if(src.length<5) continue; const i=Math.floor(rnd(1,src.length-1)); const [x,y]=src[i]; const d0=used.get(key(x,y))||pick(DIRS);
      const dir=d0[0]?pick([[0,1],[0,-1]]):pick([[1,0],[-1,0]]); const pts=walk(x,y,dir,Math.floor(rnd(3,12)),[[x,y,2]]); if(pts.length>2) traces.push(pts); }
    for(const tr of traces) for(const p of tr){ p[0]=p[0]*G+0.5; p[1]=p[1]*G+0.5; }
    drawBase(); paint(0);
  }
  function drawBase(){ const lt=light(); bctx.setTransform(DPR,0,0,DPR,0,0); bctx.clearRect(0,0,W,H);
    const mv=getComputedStyle(document.documentElement).getPropertyValue("--mode-rgb").trim(); const ink=mv||(lt?"31,102,191":"90,160,240");
    bctx.lineCap="round"; bctx.lineJoin="round";
    /* faint ground grid */
    bctx.strokeStyle=`rgba(${ink},${lt?.035:.05})`; bctx.lineWidth=1; bctx.beginPath();
    for(let x=0.5;x<W;x+=G*2){ bctx.moveTo(x,0); bctx.lineTo(x,H); } for(let y=0.5;y<H;y+=G*2){ bctx.moveTo(0,y); bctx.lineTo(W,y); } bctx.stroke();
    /* traces */
    bctx.lineWidth=1.3; bctx.strokeStyle=`rgba(${ink},${lt?.12:.19})`; bctx.fillStyle=`rgba(${ink},${lt?.22:.34})`;
    for(const tr of traces){ bctx.beginPath(); tr.forEach(([x,y],i)=>i?bctx.lineTo(x,y):bctx.moveTo(x,y)); bctx.stroke(); }
    /* bridges where a trace jumps over another, pads at ends, vias at branch points */
    for(const tr of traces){ for(const [x,y,k] of tr){ if(k===1){ bctx.save(); bctx.strokeStyle=lt?"rgba(255,255,255,.9)":"rgba(14,18,26,.95)"; bctx.lineWidth=4; bctx.beginPath(); bctx.arc(x,y,3.2,0,6.283); bctx.stroke(); bctx.restore(); bctx.beginPath(); bctx.arc(x,y,2.2,0,6.283); bctx.fillStyle=`rgba(${ink},${lt?.16:.26})`; bctx.fill(); }
        if(k===2){ bctx.beginPath(); bctx.arc(x,y,3.4,0,6.283); bctx.fillStyle=`rgba(${ink},${lt?.26:.42})`; bctx.fill(); bctx.beginPath(); bctx.arc(x,y,1.3,0,6.283); bctx.fillStyle=lt?"#fff":"#0e121a"; bctx.fill(); } }
      bctx.fillStyle=`rgba(${ink},${lt?.22:.34})`;
      for(const [x,y] of [tr[0],tr[tr.length-1]]){ if(((x+y)/G|0)%2){ bctx.beginPath(); bctx.arc(x,y,2.4,0,6.283); bctx.fill(); } else { bctx.fillRect(x-2.6,y-2.6,5.2,5.2); } } } }
  function at(tr,f){ const seg=[]; let L=0; for(let i=1;i<tr.length;i++){ const d=Math.hypot(tr[i][0]-tr[i-1][0],tr[i][1]-tr[i-1][1]); seg.push(d); L+=d; }
    let want=f*L; for(let i=0;i<seg.length;i++){ if(want<=seg[i]){ const k=want/seg[i]; return [tr[i][0]+(tr[i+1][0]-tr[i][0])*k, tr[i][1]+(tr[i+1][1]-tr[i][1])*k]; } want-=seg[i]; } return tr[tr.length-1]; }
  const COLORS=["#4aa3ff","#36e0c2","#7cff6b","#ffb347","#ff5fa2","#b18cff"];
  function paint(now){ ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(base,0,0); ctx.setTransform(DPR,0,0,DPR,0,0);
    pulses=pulses.filter(p=>now-p.t0<p.dur+600);
    for(const p of pulses){ const f=Math.min(1,Math.max(0,(now-p.t0)/p.dur)); const fade=now-p.t0>p.dur?1-(now-p.t0-p.dur)/600:1;
      ctx.save(); ctx.globalAlpha=Math.max(0,fade); ctx.shadowColor=p.c; ctx.shadowBlur=18; ctx.strokeStyle=p.c; ctx.lineWidth=2.4; ctx.lineCap="round";
      ctx.beginPath(); const steps=24; for(let i=0;i<=steps;i++){ const g=Math.max(0,f-0.22)+(f-Math.max(0,f-0.22))*i/steps; const [x,y]=at(p.tr,g); i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke();
      const [hx,hy]=at(p.tr,f); ctx.fillStyle="#fff"; ctx.shadowBlur=22; ctx.beginPath(); ctx.arc(hx,hy,2.8,0,6.283); ctx.fill(); ctx.restore(); }
    if(pulses.length){ running=true; requestAnimationFrame(paint); } else running=false; }
  function burst(big){ if(reduce||document.hidden||!traces.length) return; const n=big?Math.floor(rnd(10,18)):Math.floor(rnd(4,9)); const now=performance.now();
    for(let i=0;i<n;i++){ const tr=pick(traces); const L=tr.length; pulses.push({tr:Math.random()<.5?tr:tr.slice().reverse(), c:Math.random()<.6&&getComputedStyle(document.documentElement).getPropertyValue("--sc").trim()||pick(COLORS), t0:now+i*rnd(80,420), dur:rnd(900,1800)*Math.max(0.6,Math.min(1.8,L/9))}); }
    if(!running) requestAnimationFrame(paint); }
  let rt; addEventListener("resize",()=>{ clearTimeout(rt); rt=setTimeout(build,200); });
  new MutationObserver(()=>{ drawBase(); if(!running) paint(performance.now()); }).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-subject"]});
  build(); setTimeout(()=>burst(true),1800); setInterval(()=>burst(Math.random()<0.25),15000);
  window.__circuitBurst=burst;
})();
