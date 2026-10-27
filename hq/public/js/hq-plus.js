/* ================= MARKETING: Websites, Social media and Holo, the Back button on every page, and the Go to menu.
   Links live in HQ_SITES / HQ_GOTO below (one list each, so a changed address is fixed in one place).
   Holo (tryholo.ai) has no public API for social posts: the team writes post briefs here (`holoposts`),
   Tina schedules them in Holo from Aaron's Chrome and marks them, and Holo's SEO articles are logged in
   `holoarticles`. Setup progress is the `holo/setup` doc. ================= */
ICON.megaphone=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

const HQ_SITES={
  ed:{name:"Elevated Designs", color:"var(--c-ed)", store:"https://elevatedshirts.com", app:"https://design.elevatedshirts.com", appName:"Shirt app",
    admin:"https://admin.shopify.com/store/xzqxnd-er", instagram:"https://www.instagram.com/elevated_designs_sc", ig:"@elevated_designs_sc",
    facebook:"https://www.facebook.com/profile.php?id=61595574075753", etsy:"https://www.etsy.com/shop/ElevatedDesignsSC"},
  c3d:{name:"Charleston3D", color:"var(--c-c3d)", store:"https://charleston3d.com", app:"https://app.charleston3d.com", appName:"Order app",
    admin:"https://admin.shopify.com/store/nu2xws-gy", instagram:"https://www.instagram.com/charleston3d", ig:"@charleston3d",
    facebook:"https://www.facebook.com/profile.php?id=61596093833204", etsy:"https://www.etsy.com/shop/Charleston3DCo"}
};
const HQ_ENGINE="https://business-console.business-console.workers.dev";
const HQ_GOTO=[
  ["Studio & back office",[["Design Studio","https://epix3d.com"],["Store engine (products, prices, promotions)",HQ_ENGINE],["Holo","https://tryholo.ai"]]],
  ["Elevated Designs",[["elevatedshirts.com",HQ_SITES.ed.store],["Shirt app",HQ_SITES.ed.app],["Shopify admin",HQ_SITES.ed.admin]]],
  ["Charleston3D",[["charleston3d.com",HQ_SITES.c3d.store],["Order app",HQ_SITES.c3d.app],["Shopify admin",HQ_SITES.c3d.admin]]],
  ["Reference",[["Accounts and connections","https://claude.ai/artifact/Xek7W6RMuhNjUHaPmoRtuY"],["Master links (sheet)","https://docs.google.com/spreadsheets/d/11SqwifuaDQjHgIGcuaZNRkdkG7JxfQacmT-7sEAH7Y4/edit"],["Price sheet","https://docs.google.com/spreadsheets/d/11G7MyaGqSaz3WCd21etMYc-YebpAbyKzmvE1aqNWpy8/edit"]]]
];

/* ---------- Back: every page change is remembered, so Back always returns to the page you came from ---------- */
let HQ_HIST=[]; try{ HQ_HIST=JSON.parse(sessionStorage.getItem("hq-hist")||"[]"); }catch{ HQ_HIST=[]; }
function hqSaveHist(){ try{ sessionStorage.setItem("hq-hist",JSON.stringify(HQ_HIST.slice(-30))); }catch{} }
function hqRemember(opts){ if(opts&&opts.back) return; if(!S||!S.tab) return; const here=destOf(); if(HQ_HIST[HQ_HIST.length-1]!==here) HQ_HIST.push(here); HQ_HIST=HQ_HIST.slice(-30); hqSaveHist(); }
function hqBackBtn(){ const here=destOf(); if(!HQ_HIST.filter(d=>d!==here).length&&S.tab==="overview") return "";
  return `<div class="hq-back"><button type="button" class="btn ghost small" data-hqback aria-label="Back to the previous page"><span aria-hidden="true">←</span> Back</button></div>`; }
function hqBack(){ const here=destOf(); let dest=null; while(HQ_HIST.length){ const d=HQ_HIST.pop(); if(d&&d!==here){ dest=d; break; } } hqSaveHist(); go(dest||"overview",{back:true}); }

/* ---------- Go to: the same outside links as the Store engine and the Design Studio menus ---------- */
function hqGotoMenu(){ const hctl=document.querySelector(".hctl"); if(!hctl||document.getElementById("hqGoBtn")) return;
  const wrap=document.createElement("div"); wrap.className="hmenu hq-go";
  wrap.innerHTML=`<button class="btn" type="button" id="hqGoBtn" aria-haspopup="true" aria-expanded="false" aria-controls="hqGoPop"><span aria-hidden="true">⊞</span><span class="hq-go-l">Go to</span></button>
    <div class="hmenu-pop hq-go-pop" id="hqGoPop" role="menu" hidden>${HQ_GOTO.map(([g,ls])=>`<div class="hq-go-g">${esc(g)}</div>${ls.map(([l,u])=>`<a role="menuitem" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}<span aria-hidden="true">↗</span></a>`).join("")}`).join("")}</div>`;
  hctl.insertBefore(wrap,hctl.firstChild);
  const b=wrap.querySelector("#hqGoBtn"), pop=wrap.querySelector("#hqGoPop");
  const close=()=>{ pop.hidden=true; b.setAttribute("aria-expanded","false"); };
  b.addEventListener("click",e=>{ e.stopPropagation(); const open=pop.hidden; pop.hidden=!open; b.setAttribute("aria-expanded",String(open)); });
  document.addEventListener("click",e=>{ if(!wrap.contains(e.target)) close(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!pop.hidden){ close(); b.focus(); } }); }

/* ---------- small pieces ---------- */
function hqLink(name,url,note){ const u=safeUrl(url); if(!u) return ""; return `<div class="lp-card"><a class="lp-main" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(name)}</b><span class="muted small">${esc(lpHost(u)+(new URL(u).pathname.length>1?new URL(u).pathname:""))}</span>${note?`<span class="lp-note">${esc(note)}</span>`:""}</a></div>`; }
function hqBrandHead(k){ const b=HQ_SITES[k]; return `<h3 class="hq-bh" style="--bc:${b.color}"><span class="hq-dot" aria-hidden="true"></span>${esc(b.name)}</h3>`; }
const hqEnc=u=>encodeURIComponent(u);

/* ---------- Websites ---------- */
function vWebsite(){ const st=S.seoStatus;
  const brand=k=>{ const b=HQ_SITES[k]; return `<section class="lp-group">${hqBrandHead(k)}<div class="lp-grid">
      ${hqLink("Live store",b.store,"Shopify")}${hqLink(b.appName,b.app,"Get the app button goes here")}${hqLink("Shopify admin",b.admin,"Products, pages, themes")}
      ${hqLink("Sitemap",b.store+"/sitemap.xml","What search engines read")}${hqLink("Speed and Core Web Vitals","https://pagespeed.web.dev/analysis?url="+hqEnc(b.store),"PageSpeed Insights")}
      ${hqLink("Rich results test","https://search.google.com/test/rich-results?url="+hqEnc(b.store),"Checks the product and business markup")}
      ${hqLink("Marketing checks and fixes",HQ_ENGINE+"/#marketing/"+k,"Daily site check, SEO fixes, change log with Undo")}
    </div></section>`; };
  return `<div class="lp">
    <div class="lp-head"><div><h2>Websites</h2><p class="muted">Both stores, their apps and the tools that keep them healthy. Each brand stays separate.</p></div></div>
    ${st?`<div class="card hq-status"><div class="hq-status-k"><b>${esc(String(st.avgScore??"—"))}</b><span class="muted small">SEO score (avg)</span></div><div class="hq-status-k"><b>${esc(String(st.fixesDone7d??"—"))}</b><span class="muted small">fixes this week</span></div><div class="hq-status-k"><b>${esc(String(st.fixesOpen??"—"))}</b><span class="muted small">fixes open</span></div><div class="hq-status-t"><p>${esc(st.summary||"")}</p>${st.nextFocus?`<p class="muted small">Next: ${esc(st.nextFocus)}</p>`:""}<p class="muted small">Sage · updated ${ago(st.at)}</p></div></div>`:""}
    ${brand("ed")}${brand("c3d")}
    <section class="lp-group"><h3>Search engines (both sites)</h3><div class="lp-grid">
      ${hqLink("Google Search Console","https://search.google.com/search-console")}${hqLink("Bing Webmaster Tools","https://www.bing.com/webmasters")}${hqLink("Design Studio","https://epix3d.com","Every brand's art and the shirt designer")}
    </div></section></div>`; }

/* ---------- Social media ---------- */
function vSocial(){ const plat=(Array.isArray(S.platforms)?S.platforms:[]).filter(p=>["social","video"].includes(p.kind));
  const brand=k=>{ const b=HQ_SITES[k]; return `<section class="lp-group">${hqBrandHead(k)}<div class="lp-grid">
      ${hqLink("Instagram "+b.ig,b.instagram)}${hqLink("Facebook page",b.facebook)}${hqLink("Etsy shop",b.etsy)}
      <div class="lp-card"><button type="button" class="lp-main hq-btnlink" data-goto="holo"><b>Plan a post in Holo</b><span class="muted small">Write it here, Tina schedules it</span></button></div>
    </div></section>`; };
  return `<div class="lp">
    <div class="lp-head"><div><h2>Social media</h2><p class="muted">Every account per brand. Posts are planned on the Holo page and scheduled in Holo, so Instagram, Facebook and TikTok go out from one place.</p></div></div>
    ${brand("ed")}${brand("c3d")}
    <section class="lp-group"><h3>Tools</h3><div class="lp-grid">${hqLink("Holo","https://tryholo.ai","Schedules posts for both brands")}${hqLink("Meta Business Suite","https://business.facebook.com","Facebook and Instagram inbox")}${hqLink("TikTok Studio","https://www.tiktok.com/tiktokstudio")}${hqLink("YouTube Studio","https://studio.youtube.com")}</div></section>
    ${plat.length?`<section class="lp-group"><h3>Where each channel stands</h3><div class="hq-plat">${plat.sort((a,b)=>(+a.order||99)-(+b.order||99)).map(p=>`<div class="card hq-pl"><div><b>${esc(p.name||p.id)}</b> <span class="pill">${esc(p.status||"")}</span></div>${p.nextUnlock?`<p class="muted small">${esc(String(p.nextUnlock).slice(0,220))}</p>`:""}${p.note?`<p class="muted small">${esc(String(p.note).slice(0,220))}</p>`:""}</div>`).join("")}</div></section>`:""}
  </div>`; }

/* ---------- Holo ---------- */
const HOLO={posts:[],articles:[],setup:null,subbed:false,draft:{brand:"ed",nets:["instagram","facebook"],when:"",caption:"",image:""},busy:false};
const HOLO_STEPS=[["edBlog","Elevated Designs blog connected","In Holo, connect Shopify for the Elevated Designs brand (store xzqxnd-er), then approve the Holo app in Shopify."],
  ["c3dBlog","Charleston3D blog connected","Same for the Charleston3D brand in Holo (store nu2xws-gy). Keep the two brands separate."],
  ["socials","Instagram, Facebook and TikTok connected in Holo","In Holo, connect each brand's own social accounts. Tina then schedules the Ready posts there."]];
const HOLO_NETS=[["instagram","Instagram"],["facebook","Facebook"],["tiktok","TikTok"]];
const HOLO_STATUS=[["ready","Ready for Holo"],["scheduled","Scheduled in Holo"],["posted","Posted"]];
function holoSubscribe(){ if(HOLO.subbed||!db) return; HOLO.subbed=true;
  db.collection("holoposts").orderBy("at","desc").limit(120).onSnapshot(s=>{ HOLO.posts=s.docs.map(d=>({id:d.id,...d.data()})); if(S.tab==="holo") render(); },()=>{});
  db.collection("holoarticles").limit(200).onSnapshot(s=>{ HOLO.articles=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.publishedAt||b.at||"").localeCompare(String(a.publishedAt||a.at||""))).slice(0,60); if(S.tab==="holo") render(); },()=>{});
  db.doc("holo/setup").onSnapshot(d=>{ HOLO.setup=d.exists?d.data():null; if(S.tab==="holo") render(); },()=>{}); }
function holoPost(p){ const b=HQ_SITES[p.brand]||{name:p.brand}; const st=p.status||"ready"; const nets=(Array.isArray(p.nets)?p.nets:[]).map(n=>(HOLO_NETS.find(x=>x[0]===n)||[n,n])[1]).join(" · ");
  return `<div class="card hq-post" data-hpid="${esc(p.id)}"><div class="hq-post-h"><span class="hq-dot" style="--bc:${HQ_SITES[p.brand]?HQ_SITES[p.brand].color:"var(--line)"}" aria-hidden="true"></span><b>${esc(b.name)}</b><span class="muted small">${esc(nets)}${p.when?" · "+esc(when(p.when)):""}</span></div>
    <p class="hq-cap">${esc(p.caption||"")}</p>${p.image&&safeImg(p.image)?`<img class="hq-img" src="${esc(safeImg(p.image))}" alt="" loading="lazy">`:""}
    <div class="hq-post-a"><span class="muted small">${esc(p.by||"")} · ${ago(p.at)}</span><span class="hq-sp"></span>
      <button type="button" class="btn ghost small" data-hpcopy="${esc(p.id)}">Copy caption</button>
      ${st==="ready"?`<button type="button" class="btn ghost small" data-hpset="scheduled" data-hp="${esc(p.id)}">Mark scheduled</button>`:""}
      ${st!=="posted"?`<button type="button" class="btn ghost small" data-hpset="posted" data-hp="${esc(p.id)}">Mark posted</button>`:""}
      <button type="button" class="btn ghost small" data-hpdel="${esc(p.id)}" aria-label="Remove this post">×</button></div></div>`; }
function vHolo(){ holoSubscribe(); const su=HOLO.setup||{}; const d=HOLO.draft;
  const steps=HOLO_STEPS.map(([k,l,how])=>`<label class="hq-step"><input type="checkbox" data-hstep="${k}" ${su[k]?"checked":""}${IS_OWNER?"":" disabled"}><span><b>${esc(l)}</b><span class="muted small">${esc(how)}</span></span></label>`).join("");
  const done=HOLO_STEPS.filter(([k])=>su[k]).length;
  const cols=HOLO_STATUS.map(([k,l])=>{ const ps=HOLO.posts.filter(p=>(p.status||"ready")===k); return `<section class="hq-col"><h3>${esc(l)} <span class="count">${ps.length}</span></h3>${ps.map(holoPost).join("")||`<p class="muted small">Nothing here.</p>`}</section>`; }).join("");
  return `<div class="lp">
    <div class="lp-head"><div><h2>Holo</h2><p class="muted">Holo makes and schedules posts and SEO articles for both brands. Write a post here (or let Tina draft it), and Tina schedules it in Holo, then marks it here. Holo's blog articles land in each store's blog and show up below.</p></div>
      <a class="btn" href="https://tryholo.ai" target="_blank" rel="noopener">Open Holo ↗</a></div>
    <section class="lp-group"><h3>Setup <span class="count">${done}/${HOLO_STEPS.length}</span></h3><div class="hq-steps">${steps}</div></section>
    <section class="lp-group"><h3>Plan a post</h3><div class="card hq-form">
      <div class="hq-row"><label>Brand<select id="hpBrand">${Object.entries(HQ_SITES).map(([k,b])=>`<option value="${k}"${d.brand===k?" selected":""}>${esc(b.name)}</option>`).join("")}</select></label>
        <fieldset class="hq-nets"><legend>Post to</legend>${HOLO_NETS.map(([k,l])=>`<label><input type="checkbox" data-hpnet="${k}"${d.nets.includes(k)?" checked":""}> ${l}</label>`).join("")}</fieldset>
        <label>When<input type="datetime-local" id="hpWhen" value="${esc(d.when)}"></label></div>
      <label>Caption<textarea id="hpCap" rows="4" placeholder="What the post says">${esc(d.caption)}</textarea></label>
      <label>Image link (optional)<input id="hpImg" type="url" placeholder="https://… or a design from the library" value="${esc(d.image)}"></label>
      <div class="hq-row hq-end">${sample?`<button type="button" class="btn ghost" id="hpDraft"${HOLO.busy?" disabled":""}>${HOLO.busy?"Tina is writing…":"Draft it with Tina"}</button>`:""}<button type="button" class="btn primary" id="hpSave">Add to Holo plan</button></div>
    </div></section>
    <div class="hq-cols">${cols}</div>
    <section class="lp-group"><h3>Holo blog articles <span class="count">${HOLO.articles.length}</span></h3>${HOLO.articles.length?`<div class="lp-grid">${HOLO.articles.map(a=>hqLink(a.title||"Article",a.url||(HQ_SITES[a.brand]||{}).store,(HQ_SITES[a.brand]||{}).name+" · "+ago(a.at))).join("")}</div>`:`<p class="muted small">None yet. They appear here once a store's blog is connected in Holo.</p>`}</section>
  </div>`; }
function holoReadForm(){ const d=HOLO.draft; const g=id=>document.getElementById(id);
  if(g("hpBrand")) d.brand=g("hpBrand").value; if(g("hpWhen")) d.when=g("hpWhen").value; if(g("hpCap")) d.caption=g("hpCap").value; if(g("hpImg")) d.image=g("hpImg").value.trim();
  d.nets=[...document.querySelectorAll("[data-hpnet]")].filter(x=>x.checked).map(x=>x.dataset.hpnet); return d; }
async function holoDraft(){ if(!sample||HOLO.busy) return; const d=holoReadForm(); const b=HQ_SITES[d.brand];
  HOLO.busy=true; render();
  try{ const j=await sample.json(`You are Tina, marketing lead for ${b.name} in Charleston, SC (${d.brand==="ed"?"shirts printed to order, elevatedshirts.com":"3D printed gifts and custom prints, charleston3d.com"}). Write one social post for ${d.nets.join(", ")||"Instagram"}. Never mention any other brand. Plain, warm, local; one short hook line, 1-3 sentences, a call to action with the store link, then 5-8 relevant hashtags. No emoji spam, no made-up prices or offers. ${d.caption?`Build on this idea: """${d.caption.slice(0,800)}"""`:""}
Reply with JSON only: {"caption": "..."}`,{modelTier:"quick"});
    if(j&&j.caption) HOLO.draft.caption=String(j.caption).slice(0,2200); }
  catch(e){ toast(e&&e.code==="not_granted"?"Tina can't write here until AI is allowed for this page.":"Couldn't draft it. Try again."); }
  HOLO.busy=false; render(); }
async function holoSave(){ if(!db) return toast("Saving needs the console's database."); const d=holoReadForm();
  if(!d.caption.trim()) return toast("Add a caption first."); if(!d.nets.length) return toast("Pick at least one place to post.");
  if(d.image&&!safeImg(d.image)) return toast("The image link has to start with https://");
  try{ await db.collection("holoposts").add({brand:d.brand,nets:d.nets,when:d.when?new Date(d.when).toISOString():"",caption:d.caption.trim().slice(0,2200),image:d.image||"",status:"ready",by:(typeof me==="function"?me():"")||"",at:new Date().toISOString()});
    HOLO.draft={brand:d.brand,nets:d.nets,when:"",caption:"",image:""}; toast("Added. Tina schedules it in Holo."); render(); }
  catch{ toast("Couldn't save it. Try again."); } }

/* one click handler for everything above (pages re-render, so it is delegated) */
document.addEventListener("click",async e=>{ const t=e.target.closest&&e.target.closest("[data-hqback],#hpDraft,#hpSave,[data-hpcopy],[data-hpset],[data-hpdel]"); if(!t) return;
  if(t.hasAttribute("data-hqback")) return hqBack();
  if(t.id==="hpDraft") return holoDraft(); if(t.id==="hpSave") return holoSave();
  if(t.dataset.hpcopy){ const p=HOLO.posts.find(x=>x.id===t.dataset.hpcopy); if(p){ try{ await navigator.clipboard.writeText(p.caption||""); toast("Caption copied."); }catch{ toast("Couldn't copy. Select the text instead."); } } return; }
  if(t.dataset.hpset&&db){ try{ await db.doc("holoposts/"+t.dataset.hp).update({status:t.dataset.hpset,[t.dataset.hpset+"At"]:new Date().toISOString()}); }catch{ toast("Couldn't update it."); } return; }
  if(t.dataset.hpdel&&db){ try{ await db.doc("holoposts/"+t.dataset.hpdel).delete(); toast("Removed."); }catch{ toast("Couldn't remove it."); } return; }
});
document.addEventListener("change",async e=>{ const t=e.target; if(!t||!t.dataset) return;
  if(t.dataset.hstep&&db&&IS_OWNER){ const ref=db.doc("holo/setup"); try{ const cur=await ref.get(); const patch={[t.dataset.hstep]:t.checked,at:new Date().toISOString()}; if(cur.exists) await ref.update(patch); else await ref.set(patch); }catch{ toast("Couldn't save that step."); t.checked=!t.checked; } }
  if(t.id==="hpBrand"||t.dataset.hpnet) holoReadForm(); });
document.addEventListener("input",e=>{ if(e.target&&["hpCap","hpImg","hpWhen"].includes(e.target.id)) holoReadForm(); });

hqGotoMenu();
