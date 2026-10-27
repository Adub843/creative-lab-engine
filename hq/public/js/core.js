(function(){ try{ if(localStorage.getItem("hq-theme")==="light") document.documentElement.setAttribute("data-theme","light"); }catch{} })();
function paintTheme(){ const light=document.documentElement.getAttribute("data-theme")==="light"; const b=document.getElementById("themeBtn"); if(!b) return;
  document.getElementById("themeIcon").textContent=light?"☾":"☀"; document.getElementById("themeTxt").textContent=light?"Dark":"Light"; b.setAttribute("aria-label",light?"Switch to dark mode":"Switch to light mode"); }
function toggleTheme(){ const light=document.documentElement.getAttribute("data-theme")!=="light"; if(light) document.documentElement.setAttribute("data-theme","light"); else document.documentElement.removeAttribute("data-theme");
  try{ localStorage.setItem("hq-theme", light?"light":"dark"); }catch{} paintTheme(); }

/* ---------- The team (structure is design, status comes from the database) ---------- */
const TEAM = [
  {key:"steve", name:"Stephanie", role:"Chief of Staff · your only contact · bills & taxes", division:"hq", reports:"You", schedule:"6:50 AM list · 6:50 PM wrap-up"},
  {key:"helen", name:"Helen", role:"Legal gate, pricing & the nightly meeting", division:"hq", reports:"Stephanie", schedule:"Nightly meeting 10:05 PM + gate checks"},
  {key:"vera",  name:"Vera",  role:"GM Elevated Designs · quality gate & idea briefs", division:"brand", reports:"Stephanie", schedule:"Daily · ideas, reviews"},
  {key:"lisa",  name:"Lisa",  role:"Designer", division:"brand", reports:"Vera", schedule:"Daily 8:45 AM · 6 designs"},
  {key:"carla", name:"Carla", role:"Commerce · Shopify & Etsy · brand profiles", division:"elevated", reports:"Vera", schedule:"Twice daily"},
  {key:"tina",  name:"Tina",  role:"Marketing lead · posts, ads & short video", division:"marketing", reports:"Stephanie", schedule:"Daily · ads, posts, videos Mon/Wed/Fri"},
  {key:"sage",  name:"Sage",  role:"SEO & team training", division:"marketing", reports:"Tina", schedule:"7:05 AM & 9:05 PM · settings Mondays"},
  {key:"andy",  name:"Andy",  role:"GM Charleston 3D · 3D ideas & print files", division:"c3d", reports:"Stephanie", schedule:"Twice daily"},
  {key:"mike",  name:"Mike",  role:"GM Studio · both YouTube channels", division:"studio", reports:"Stephanie", schedule:"Through the day · 6 AM & 7 AM posts"},
  {key:"sam",   name:"Sam",   role:"Apps lead · build, test & launch · 3D website", division:"apps", reports:"Stephanie", schedule:"Daily + on demand"},
  {key:"nora",  name:"Nora",  role:"Research, money tracking & app ideas", division:"lab", reports:"Stephanie", schedule:"Every 3 hours · paper after midnight"},
  {key:"max",   name:"Max",   role:"Tech, security & this HQ", division:"hq", reports:"Helen", schedule:"Hourly · security sweep 3 AM"}
];
/* Paused Oct 14 (team cut to 12). Kept so old records still show a name; their work goes to ROUTE[key]. */
const FORMER = [["linda","Linda"],["iris","Iris"],["brooke","Brooke"],["ava","Ava"],["cole","Cole"],["jake","Jake"],["megan","Megan"],["ray","Ray"],["zoe","Zoe"],["kim","Kim"],["leo","Leo"],["diane","Diane"],["hannah","Hannah"]];
const ROUTE = {linda:"steve", iris:"vera", brooke:"carla", ava:"tina", cole:"andy", jake:"mike", megan:"mike", ray:"sam", zoe:"nora", kim:"sam", leo:"sam", diane:"nora", hannah:"max"};
const live = k=>ROUTE[k]||k;
const MANAGERS = [
  {key:"steve", team:["helen","vera","tina","andy","mike","sam","nora"], area:"the whole operation"},
  {key:"helen", team:["max"], area:"Legal, pricing & the nightly meeting"},
  {key:"vera",  team:["lisa","carla"], area:"Elevated Designs"},
  {key:"tina",  team:["sage"], area:"Marketing & growth"},
];
const TEAM_BY = Object.fromEntries(TEAM.map(a=>[a.key,a]).concat(FORMER.map(([k,n])=>[k,{key:k,name:n,role:"paused · now "+(ROUTE[k]==="steve"?"Stephanie":(ROUTE[k]||"").replace(/^./,c=>c.toUpperCase())),division:"former",reports:"",schedule:"paused"}])));
const tidOf = k=>(S.agents[live(k)]||{}).triggerId;

function av(k,cls){ const a=TEAM_BY[k]; return k==="steve"?`<span class="avatar ${cls||""} av-steph" role="img" aria-label="Stephanie">S</span>`:`<span class="avatar ${cls||""}">${esc(a?a.name[0]:"?")}</span>`; }
var IS_OWNER=false; const SEEN=new Set();
const S = { c3d:{}, replies:[], agents:{}, activity:[], metrics:[], brief:null, bills:[], tax:[], legal:[], matters:[], roadmap:[], training:[], meetings:[], links:[], notes:[], ideas:[], listings:[], apps:[], questions:[], platforms:[], moneyPlan:null, kudos:[], messages:[], requests:[], roomSel:"steve", dmSel:"steve", pricing:null, priceProd:0, calc:null, platSort:"name", billEdit:null, billsReview:null, billchanges:[], news:null, appideas:[], printideas:[], huddle:[], designIdeas:0, market:null, seoStatus:null, seoKeywords:[], playbook:null, seoProps:[], seoaudit:[], seotrack:[], curriculum:{}, ads:[], videos:[], seoTool:"page", ideaRound:"all", brands:[], designs:[], designFilter:"all", jobs:{}, jobEdit:null, changes:[], bugs:[], hr:null, maint:null, askLog:[], roomLog:{}, queue:[], setup:[], triggers:{}, trigState:"loading", tab:"overview" };
let db=null, mcp=null, sample=null, assets=null;

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function ago(iso){ if(!iso) return "never"; const t=new Date(iso).getTime(); if(isNaN(t)) return esc(iso);
  const m=Math.round((Date.now()-t)/60000); if(m<1) return "just now"; if(m<60) return m+"m ago"; const h=Math.round(m/60); if(h<36) return h+"h ago"; return Math.round(h/24)+"d ago"; }
function when(iso){ if(!iso) return ""; const d=new Date(iso); if(isNaN(d)) return esc(iso);
  return d.toLocaleString([], {weekday:"short", hour:"numeric", minute:"2-digit"}); }
function safeImg(u){ if(typeof u!=="string") return null; if(u.startsWith("/_blob/")) return u; try{ const x=new URL(u); return x.protocol==="https:"?x.href:null; }catch{ return null; } }
function safeUrl(u){ try{ const x=new URL(u); return x.protocol==="https:" ? x.href : null; }catch{ return null; } }
function toast(msg){ let box=document.getElementById("toasts"); if(!box){ box=document.createElement("div"); box.id="toasts"; box.className="toasts"; box.setAttribute("role","status"); document.body.appendChild(box); }
  if([...box.children].some(x=>x.textContent===msg)) return; const t=document.createElement("div"); t.className="toast"; t.textContent=msg; box.appendChild(t); setTimeout(()=>t.remove(),3200); }
function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v);}catch{ return null; } }
const KIND = {done:"ok", posted:"acc", alert:"bad", warn:"warn", idea:"acc", info:""};
/* Activity docs written as {by,text,type} get the same shape as {agent,title,detail,kind} */
function normAct(a){ const x={...a}; const txt=typeof a.text==="string"?a.text.trim():"";
  if(!x.agent){ const pre=String(a.id||"").split(/[-_]/)[0].toLowerCase(); x.agent=String(a.by||"").toLowerCase()||(TEAM_BY[pre]?pre:""); }
  if(!x.title&&txt){ const m=txt.match(/^.*?[.!?](?=\s|$)/); x.title=(m?m[0]:txt).slice(0,160); }
  if(!x.detail&&txt&&txt!==x.title) x.detail=txt;
  if(!x.kind&&a.type) x.kind=String(a.type);
  return x; }

/* ---------- voice (text to speech, runs on this device) ---------- */
let voiceOn = ls("hq-voice")==="1", chosenVoice=null;
function pickVoice(){
  if(!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang));
  const prefs=["Samantha","Ava","Allison","Serena","Jenny","Aria","Google US English","Zira","Karen","Moira","Tessa","Female"]; /* female voices first */
  for(const p of prefs){ const v=vs.find(v=>v.name.includes(p)); if(v) return v; }
  return vs[0]||null;
}
if("speechSynthesis" in window){ speechSynthesis.onvoiceschanged=()=>{ chosenVoice=pickVoice(); }; chosenVoice=pickVoice(); }
function speak(text){
  if(!voiceOn || !("speechSynthesis" in window) || !text) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(String(text).replace(/[#*_`>]/g,""));
    chosenVoice = chosenVoice||pickVoice(); if(chosenVoice) u.voice=chosenVoice; u.rate=0.95; u.pitch=1.1; speechSynthesis.speak(u); }catch{}
}
function paintVoice(){ const b=$("#voiceBtn"); b.setAttribute("aria-pressed", voiceOn?"true":"false"); $("#voiceLabel").textContent = voiceOn ? "Stephanie's voice on" : "Stephanie's voice off";
  if(!("speechSynthesis" in window)){ b.disabled=true; $("#voiceLabel").textContent="Voice not supported here"; } }
$("#voiceBtn").addEventListener("click",()=>{ voiceOn=!voiceOn; ls("hq-voice",voiceOn?"1":"0"); paintVoice(); if(voiceOn) speak("Hi, it's Stephanie. I'll read you the brief and answer whatever you ask."); else try{speechSynthesis.cancel()}catch{} });

/* ================= SUBJECTS: one switch picks what you're working on, and the whole page follows it —
   its color, its header, its numbers, its pages and its research. This replaces the old icon rail, the row of
   business switches and the page chips (three navigation systems that disagreed with each other). ================= */
const SUBJECTS=[
  {k:"home", name:"Home", tag:"Today across every business", c:"#3b82f6", rgb:"59,130,246", icon:"home", agents:["steve"],
    pages:[["Today","overview"],["Launchpad","launch"],["Share links & QR","share"],["Rules & decisions","rules"]]},
  {k:"ed", name:"Elevated Designs", tag:"Apparel · shirts · Shopify & Etsy", c:"#8b5cf6", rgb:"139,92,246", icon:"shirt", agents:["vera","lisa","carla","tina"],
    pages:[["Overview","elevated"],["Designs","design:ed"],["Listings","listings:ed"],["Custom orders","quotes"],["Design Lab","designlab"],["Marketing","growth:ed"],["Reviews","reviews"],["Shirt market","sellers"]]},
  {k:"c3d", name:"Charleston 3D", tag:"3D prints · makers · custom orders", c:"#14b8a6", rgb:"20,184,166", icon:"cube", agents:["andy","nora","carla"],
    pages:[["Overview","c3d"],["3D designs","design:c3d"],["Listings","listings:c3d"],["Custom quotes","quotes"],["Redesign Studio","redesign"],["Marketing","growth:c3d"],["Reviews","reviews"],["3D trends","print3d"]]},
  {k:"mkt", name:"Marketing", tag:"Websites · social media · Holo", c:"#f43f5e", rgb:"244,63,94", icon:"megaphone", agents:["tina","sage"],
    pages:[["Websites","website"],["Social media","social"],["Holo","holo"],["ED marketing","growth:ed"],["C3D marketing","growth:c3d"]]},
  {k:"create", name:"Create", tag:"Design · maker · code, all on one bench", c:"#ec4899", rgb:"236,72,153", icon:"brush", agents:["vera","andy","sam"], bench:true,
    pages:[["Design library","library"],["Design Studio","designer"],["AI art","designlab"],["Design catalog","catalog"],["Maker","lightbox"],["Hype chains","hype"],["Nameplates","nameplate"],["3D redesign","redesign"],["Code","code"]]},
  {k:"studio", name:"Studio", tag:"YouTube · Released Footage · Funny Video Clips · Newsflash", c:"#ef4444", rgb:"239,68,68", icon:"play", agents:["mike"],
    pages:[["Channels","studio"]]},
  {k:"apps", name:"Apps & Agents", tag:"Build · test · ship", c:"#0ea5e9", rgb:"14,165,233", icon:"apps", agents:["sam","nora","max"],
    pages:[["Apps","apps"],["Idea Lab","ideas"],["Agent Studio","agents"],["AI models","ai"],["Idea research","deepdive"]]},
  {k:"legal", name:"Legal", tag:"Paperwork · taxes · Elevated Designs LLC", c:"#eab308", rgb:"234,179,8", icon:"scale", agents:["helen","steve"],
    pages:[["Legal & paperwork","legal"],["Business docs","docs"]]},
  {k:"money", name:"Money", tag:"Bills · pricing · platform fees", c:"#22c55e", rgb:"34,197,94", icon:"money", agents:["steve","helen"],
    pages:[["Money & bills","money"],["Pricing & fees","pricing"]]},
  {k:"team", name:"Team", tag:"Messages · meetings · schedules", c:"#f97316", rgb:"249,115,22", icon:"people", agents:["steve","max","helen"],
    pages:[["Messages","comms"],["Team Room","team"],["Schedules","schedules"],["System map","sysmap"]]},
  {k:"research", name:"Research", tag:"Markets · SEO · trends", c:"#84cc16", rgb:"132,204,22", icon:"scope", agents:["nora","sage"],
    pages:[["Research","research"],["Search jobs","rsettings"],["SEO & knowledge","knowledge"],["Markets & events","markets"],["Shirt sellers","sellers"],["3D trends","print3d"]]}
];
const SUBJ_BY=Object.fromEntries(SUBJECTS.map(s=>[s.k,s]));
const BIZ_TABS=["design","listings","growth"];
const destOf=()=>S.tab+(BIZ_TABS.includes(S.tab)?":"+(S.biz||"ed"):"");
const hasPage=(s,dest)=>s.pages.some(([,g])=>g===dest||(!g.includes(":")&&g===dest.split(":")[0]));
/* which subject owns the page: the one you picked if it lists this page, else the first one that does */
function subjectOf(){ const d=destOf(); const cur=SUBJ_BY[S.subj];
  if(cur&&hasPage(cur,d)) return cur; return SUBJECTS.find(s=>hasPage(s,d))||SUBJECTS[0]; }

/* the one way to change pages. dest looks like "legal", "design:c3d" or "legal#paperwork" */
function go(dest,opts){ opts=opts||{}; try{ hqRemember(opts); }catch{} let [tab]=String(dest||"overview").split("#"); let biz="";
  if(tab.includes(":")) [tab,biz]=tab.split(":");
  if(biz){ S.biz=biz; ls("hq-biz",biz); }
  S.tab=tab||"overview"; ls("hq-tab",S.tab);
  if(opts.subj) S.subj=opts.subj; S.subj=subjectOf().k; ls("hq-subj",S.subj);
  try{ const m=JSON.parse(ls("hq-last")||"{}"); m[S.subj]=destOf(); ls("hq-last",JSON.stringify(m)); }catch{}
  try{ closeAns(); }catch{} closeSubjSheet(); render(); if(!opts.keepScroll) window.scrollTo({top:0}); }
/* picking a subject opens the page you were last on there */
function goSubject(k){ const s=SUBJ_BY[k]; if(!s) return; let last=""; try{ last=(JSON.parse(ls("hq-last")||"{}"))[k]||""; }catch{}
  go(last&&hasPage(s,last)?last:s.pages[0][1],{subj:k}); }
function goTab(k){ go(k); }

/* numbers on the nav: what's waiting for you, per page and per subject */
function pageCount(dest){ const [t,b]=dest.split(":");
  try{ switch(t){
    case "design": return S.designs.filter(d=>d.status==="proposed"&&designBiz(d)===b).length;
    case "listings": return S.listings.filter(l=>l.status==="ready"&&listingBiz(l)===b).length;
    case "legal": return [...S.legal,...S.tax].filter(x=>["due","overdue"].includes(x.status)).length+S.matters.filter(m=>m.status==="needs you").length;
    case "apps": return S.questions.filter(q=>q.status!=="answered").length;
    case "ideas": return S.ideas.filter(i=>i.status==="done"&&!i.seen&&!SEEN.has(i.id)).length;
    case "comms": return S.tab==="comms"?0:unreadDM();
    case "schedules": return trigList().filter(t=>t.enabled&&trigProblem(t)).length;
  } }catch{ } return 0; }
function subjCount(s){ return s.pages.reduce((n,[,g])=>n+pageCount(g),0); }
const badge=n=>n?`<span class="count">${n}</span>`:"";

/* the left list of subjects (a sheet on phones) */
function paintSubjects(){ const on=subjectOf(); const el=$("#subjects"); if(!el) return;
  el.innerHTML=SUBJECTS.map(s=>`<button type="button" class="subj${s.k===on.k?" on":""}" data-subj="${s.k}" style="--sc:${s.c}" aria-current="${s.k===on.k?"page":"false"}"><i class="nic">${ICON[s.icon]||""}</i><span class="sn">${esc(s.name)}</span>${badge(subjCount(s))}</button>`).join("");
  const sb=$("#subjBtn"); if(sb) sb.innerHTML=`<i class="nic">${ICON[on.icon]||""}</i><span>${esc(on.name)}</span>${badge(SUBJECTS.reduce((n,s)=>n+(s.k===on.k?0:subjCount(s)),0))}<span aria-hidden="true" class="car">▾</span>`; }
function paintSubjectTheme(){ const s=subjectOf(); const r=document.documentElement;
  if(r.dataset.subject!==s.k){ r.dataset.subject=s.k; r.style.setProperty("--sc",s.c); r.style.setProperty("--mode-rgb",s.rgb); document.title=s.k==="home"?"Creative Lab Studios":s.name+" · Creative Lab Studios"; } }
function openSubjSheet(){ document.body.classList.add("subj-open"); $("#subjBtn").setAttribute("aria-expanded","true"); }
function closeSubjSheet(){ document.body.classList.remove("subj-open"); const b=$("#subjBtn"); if(b) b.setAttribute("aria-expanded","false"); }
$("#subjects").addEventListener("click",e=>{ const b=e.target.closest("[data-subj]"); if(b) goSubject(b.dataset.subj); });
$("#subjBtn").onclick=()=>document.body.classList.contains("subj-open")?closeSubjSheet():openSubjSheet();
$("#subjScrim").onclick=closeSubjSheet;
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeSubjSheet(); });

/* the top of every page: the subject's banner, its numbers and its pages */
function subjectHead(){ const s=subjectOf(); const d=destOf(); const k=subjKpis(s);
  const tabs=s.bench?createBench():`<nav class="ptabs" aria-label="${esc(s.name)} pages">${s.pages.map(([l,g])=>`<button type="button" class="ptab" data-goto="${esc(g)}" aria-current="${g===d||g===S.tab?"page":"false"}">${esc(l)}${badge(pageCount(g))}</button>`).join("")}${exportMenu()}</nav>`;
  return `<section class="shero">${typeof hqBackBtn==="function"?hqBackBtn():""}<div class="shero-in"><div class="shero-id"><i class="nic shero-ic">${ICON[s.icon]||""}</i><div><h1 class="shero-t">${esc(s.name)}</h1><div class="shero-tag">${esc(s.tag)}</div></div></div>
    ${k.length?`<dl class="shero-k">${k.map(([v,l])=>`<div><dt>${esc(l)}</dt><dd>${esc(String(v))}</dd></div>`).join("")}</dl>`:""}</div>${tabs}</section>`; }

/* Create is one page: every design, maker and code tool sits on this bench, and the tool you pick opens right under it */
const CREATE_TOOLS=[
  ["Design",[["library","Design library","Every design, print file and Kittl project","image"],["designer","Design Studio","Put art and text on any shirt","shirt"],["designlab","AI art","Talk it through with Vera, generate images","spark"],["catalog","Design catalog","Saved looks and templates","list"]]],
  ["Maker",[["lightbox:lightbox","Light box","Picture front, LED box, snap lid","cube"],["lightbox:keychain","Keychain","Multi-color tag with a ring hole","link"],["lightbox:sign","Sign","Raised lettering on a plate","list"],["lightbox:litho","Lithophane","Photo that shows when lit","image"],["hype","Hype chains","Pendants and chains, Bambu-ready","link"],["nameplate","Nameplates","Desk nameplates with the SC palmetto","cube"],["redesign","3D redesign","Photo or 3D file in, new model out","wrench"]]],
  ["Code",[["code","Code & re-engineer","Your GitHub repos: browse, edit, ship","wrench"]]]
];
function createBench(){ const cur=S.tab==="lightbox"?"lightbox:"+((typeof MK!=="undefined"&&MK.mode)||"lightbox"):S.tab;
  return `<div class="bench">${CREATE_TOOLS.map(([g,ts])=>`<div class="bench-g"><div class="bench-h">${g}</div><div class="bench-row">${ts.map(([id,l,d,ic])=>`<button type="button" class="tool" data-tool="${id}" data-tip="${esc(d)}" aria-pressed="${id===cur}"><i class="nic">${ICON[ic]||""}</i><span class="tool-n">${esc(l)}</span></button>`).join("")}</div></div>`).join("")}${exportMenu()}</div>`; }
function bindBench(){ document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{ const [t,m]=b.dataset.tool.split(":");
  if(m&&typeof MK!=="undefined"){ MK.mode=m; } go(t,{subj:"create",keepScroll:true}); const w=$("#main .bench"); if(w){ const y=w.getBoundingClientRect().bottom+scrollY-90; if(scrollY>y) scrollTo({top:y}); } }); }

/* the three or four numbers that matter for each subject */
function subjKpis(s){ const A=S.activity||[]; const since=new Date(Date.now()-864e5).toISOString(); const did=ks=>A.filter(a=>ks.includes(a.agent)&&String(a.at)>since).length; const L=S.listings||[], D=S.designs||[];
  try{ switch(s.k){
    case "home": return [[SUBJECTS.reduce((n,x)=>n+subjCount(x),0),"waiting on you"],[A.filter(a=>String(a.at)>since).length,"team actions 24h"],[(S.listings||[]).filter(l=>l.status==="posted").length,"live listings"]];
    case "ed": return [[D.filter(d=>d.status==="proposed"&&designBiz(d)==="ed").length,"to approve"],[L.filter(l=>l.status==="ready"&&listingBiz(l)==="ed").length,"ready to list"],[L.filter(l=>l.status==="posted"&&listingBiz(l)==="ed").length,"live"],[did(s.agents),"team actions 24h"]];
    case "c3d": return [[D.filter(d=>d.status==="proposed"&&designBiz(d)==="c3d").length,"to approve"],[L.filter(l=>l.status==="ready"&&listingBiz(l)==="c3d").length,"ready to list"],[L.filter(l=>l.status==="posted"&&listingBiz(l)==="c3d").length,"live"],[(S.printideas||[]).length,"print ideas"]];
    case "create": return [[D.length,"designs"],[(S.repos||[]).length,"repos"],[CREATE_TOOLS.reduce((n,[,t])=>n+t.length,0),"tools"]];
    case "studio": { const yi=(typeof S.ytitems!=="undefined"&&S.ytitems)||[]; return [[(S.ytchannels||[]).length||3,"channels"],[yi.filter(i=>i.kind==="queue").length||(S.queue||[]).filter(q=>q.status==="scheduled").length,"queued"],[(S.queue||[]).filter(q=>q.status==="needs fix"||q.status==="blocked").length,"need fixes"],[did(s.agents),"team actions 24h"]]; }
    case "apps": return [[(S.apps||[]).length,"apps"],[(S.apps||[]).filter(a=>appStage(a)==="review").length,"need your call"],[(S.repos||[]).length,"repos"],[(S.agentproducts||[]).length,"agents built"]];
    case "legal": return [[(S.paperwork||[]).filter(p=>p.status==="ready"||p.status==="needs").length,"docs to sign"],[[...(S.legal||[]),...(S.tax||[])].filter(x=>["due","overdue"].includes(x.status)).length,"due"],[(S.matters||[]).filter(m=>m.status==="needs you").length,"matters need you"]];
    case "money": return [[(S.bills||[]).filter(b=>b.status!=="cancelled").length,"subscriptions"],[(S.billchanges||[]).length,"bill changes"],[(S.tax||[]).filter(x=>x.status!=="done").length,"tax items"]];
    case "team": return [[TEAM.length,"teammates"],[unreadDM(),"unread"],[trigList().filter(t=>t.enabled).length,"schedules on"],[trigList().filter(t=>t.enabled&&trigProblem(t)).length,"need a look"]];
    case "research": { const R=(S.research||[]).filter(r=>!r.removed); return [[R.length,"search jobs"],[R.filter(r=>r.enabled!==false).length,"on"],[(S.ideas||[]).filter(i=>i.status!=="done").length,"ideas in the lab"]]; }
  } }catch(e){ console.warn("kpis",e); } return []; }

/* research for this subject: every search job its agents run, on/off right here */
const SUBJ_JOBS={ed:/tee|shirt|apparel|design|etsy-numbers|handle|brand|whats-selling|seller|listing-price|thread-scout/i,c3d:/3d|print|nameplate|hype|spike|license|patent|market-competition|c3d|product-ideas|new-ideas/i,apps:/app|repo|code|uptime|vet/i,legal:/legal|tax|trademark|tm-|domain|grant/i,money:/bill|fee|platform|money/i,studio:/youtube|clip|news|release|funny|channel|qc|niche/i,research:/market-weekly|idea-lab|money-platforms|guideline|keyword-repick|lab-daily|events|ads|seo|rank|pagespeed|keyword|ai-visib|indexed|page-audit|competitor/i};
function subjectResearch(){ const s=subjectOf(); if(S.tab!==s.pages[0][1]||s.k==="research") return ""; const re=SUBJ_JOBS[s.k]; if(!re) return "";
  const R=(S.research||[]).filter(r=>!r.removed&&re.test(r.id+" "+(r.label||""))); if(!R.length) return "";
  const ed=typeof canEditSched==="function"&&canEditSched();
  return `<details class="card mres"><summary><h2>Research for ${esc(s.name)}</h2><span class="eyebrow">${R.filter(r=>r.enabled!==false).length} of ${R.length} on</span></summary>
    <div class="mres-l">${R.sort((a,b)=>String(a.agent).localeCompare(String(b.agent))||String(a.label).localeCompare(String(b.label))).map(r=>`<div class="mres-r ${r.enabled===false?"off":""}"><label class="mres-t"><input type="checkbox" data-mron="${esc(r.id)}" ${r.enabled===false?"":"checked"} ${ed?"":"disabled"} aria-label="${esc(r.label||r.id)}"><span></span></label><div class="body"><div class="t">${esc(r.label||r.id)} <span class="muted small">· ${esc(TEAM_BY[agentOfJob(r)]?TEAM_BY[agentOfJob(r)].name:agentOfJob(r))}</span></div><div class="meta">${esc(String(r.when||"every run").slice(0,110))}${r.lastRun&&r.lastRun.at?` · last ${ago(r.lastRun.at)}${r.lastRun.found!=null?` · ${esc(String(r.lastRun.found))} found`:""}`:""}</div></div></div>`).join("")}</div>
    <p class="small"><button type="button" class="linkbtn" data-goto="rsettings">Edit sources and search terms</button></p></details>`; }
function agentOfJob(r){ if(r.agent) return String(r.agent).toLowerCase(); const t=S.triggers&&S.triggers[r.trigger]; return t?String(t.name||"").split(" ·")[0].trim().toLowerCase():""; }
function bindSubject(){ bindBench(); bindExportMenu();
  document.querySelectorAll("[data-mron]").forEach(i=>i.onchange=async()=>{ const r=(S.research||[]).find(x=>x.id===i.dataset.mron); if(!r) return; const t=(S.triggers&&S.triggers[r.trigger])||{id:r.trigger,name:r.agent}; const ok=await researchSave(t,r.id,{enabled:i.checked},i.checked?"On. Runs next time.":"Off. The task skips it."); if(ok) render(); }); }

/* where you start: a #link, else where you were last time */
(function(){ const h=(location.hash||"").slice(1); const sub=SUBJ_BY[h];
  S.biz=ls("hq-biz")==="c3d"?"c3d":"ed"; S.subj=ls("hq-subj")||"";
  if(sub){ S.subj=sub.k; S.tab=sub.pages[0][1].split(":")[0]; return; }
  const known=SUBJECTS.some(s=>s.pages.some(([,g])=>g.split(":")[0]===h));
  S.tab=known?h:(ls("hq-tab")||"overview"); })();

/* ---------- render pieces ---------- */
function kpis(div){
  const ms = S.metrics.filter(m=>div==="overview" ? m.pinned : m.division===div);
  if(!ms.length) return `<div class="empty">No numbers yet. ${div==="studio"?"Mike":div==="elevated"?"Andy":"Stephanie"} fills these in on the first run, with the source next to each one.</div>`;
  return `<div class="kpis">${ms.sort((a,b)=>(a.order??99)-(b.order??99)).map(m=>{
    const d = typeof m.delta==="number" ? m.delta : null; const cls = d==null?"flat":d>0?"up":d<0?"down":"flat";
    return `<div class="kpi" title="${esc(m.source||"")}"><div class="eyebrow">${esc(m.label)}</div><div class="v">${esc(m.value??"—")}${m.unit?`<span class="small muted"> ${esc(m.unit)}</span>`:""}</div>
      <div class="d ${cls}">${d==null?(m.note?esc(m.note):"&nbsp;"):(d>0?"▲ ":d<0?"▼ ":"")+esc(Math.abs(d))+(m.deltaUnit?esc(m.deltaUnit):"")+" "+esc(m.period||"")}</div></div>`; }).join("")}</div>`;
}
function feed(filter, n=25){
  const items = S.activity.filter(a=>!filter || filter(a)).slice(0,n);
  if(!items.length) return `<div class="empty">Nothing logged yet. Every agent writes a line here each time it runs: what it did, what it posted, and anything that needs you.</div>`;
  return `<div class="list">${items.map(a=>{ const ag=TEAM_BY[a.agent]; const u=safeUrl(a.link);
    return `<div class="row"><div class="stripe ${KIND[a.kind]||""}"></div><div class="body">
      <div class="t">${esc(a.title)}</div>
      <div class="meta">${esc(ag?ag.name:String(a.agent||"").replace(/^./,c=>c.toUpperCase()))} · ${ago(a.at)}${a.kind?` · ${esc(a.kind)}`:""}</div>
      ${a.detail?`<div class="detail">${esc(a.detail)}</div>`:""}
      ${u?`<div class="small" style="margin-top:4px"><a href="${esc(u)}" target="_blank" rel="noopener">Open →</a></div>`:""}
    </div></div>`; }).join("")}</div>`;
}
function queueList(platforms){
  const items = S.queue.filter(q=>platforms.includes(q.platform)).slice(0,20);
  if(!items.length) return `<div class="empty">The posting queue is empty. Drafts, scheduled posts and published posts show up here with their numbers.</div>`;
  const st={draft:"warn",scheduled:"acc",posted:"ok",blocked:"bad",waiting:"warn"};
  return `<div class="list">${items.map(q=>{ const u=safeUrl(q.link); const m=q.metrics||{};
    const stats=[m.views!=null?`${m.views} views`:"", m.likes!=null?`${m.likes} likes`:"", m.comments!=null?`${m.comments} comments`:""].filter(Boolean).join(" · ");
    return `<div class="row"><div class="body"><div class="queue-plat">${esc(q.platform)}</div><div class="t">${esc(q.title)}</div>
      <div class="meta">${when(q.when)}${stats?" · "+esc(stats):""}</div>
      ${q.caption?`<div class="detail muted">${esc(String(q.caption).slice(0,220))}</div>`:""}
      ${u?`<div class="small" style="margin-top:4px"><a href="${esc(u)}" target="_blank" rel="noopener">View post →</a></div>`:""}
    </div><span class="pill ${st[q.status]||""}">${esc(q.status||"draft")}</span></div>`; }).join("")}</div>`;
}
function needsYou(){
  const open = S.setup.filter(s=>!s.done).sort((a,b)=>(a.order??99)-(b.order??99));
  const done = S.setup.filter(s=>s.done);
  if(!S.setup.length) return `<div class="empty">Stephanie lists anything only you can do here, like creating an account or approving a cost.</div>`;
  return `<div class="list">${open.concat(done).map(s=>{ const u=safeUrl(s.link);
    return `<div class="row"><label class="check ${s.done?"done":""}" style="flex:1;min-width:0"><input type="checkbox" data-setup="${esc(s.id)}" ${s.done?"checked":""} id="setup-${esc(s.id)}">
      <span class="body"><span class="t">${esc(s.title)}</span>${s.why?`<span class="detail muted" style="display:block">${esc(s.why)}</span>`:""}
      ${u?`<a class="small" href="${esc(u)}" target="_blank" rel="noopener">Go there →</a>`:""}</span></label></div>${s.done?"":`<div style="padding:0 0 10px 26px">${replyBox("setup-"+s.id,s.title)}</div>`}`; }).join("")}</div>`;
}
function teamCards(div){
  const list = TEAM.filter(a=>div==="all" || a.division===div || (div==="store" && ["carla"].includes(a.key)));
  if(div==="legal"){ const l=["helen","steve"].map(k=>TEAM_BY[k]); return `<section class="card"><div class="card-head"><h2>Legal team</h2></div><div class="team" style="grid-template-columns:1fr">${l.map(a=>agentCard(a)).join("")}</div></section>`; }
  if(div==="apps"||div==="money") return `<section class="card"><div class="card-head"><h2>${div==="apps"?"The app team":"Money"}</h2></div><div class="team" style="grid-template-columns:1fr">${list.map(a=>agentCard(a)).join("")}</div></section>`;
  return `<div class="team">${list.map(a=>agentCard(a)).join("")}</div>
    ${S.trigState==="off"?`<p class="small muted" style="margin-top:10px">Live run status needs the Claude Code Remote connector. You can still run agents from the chat.</p>`:""}`;
}
function agentCard(a){ { const st=S.agents[a.key]||{}; const tr = st.triggerId ? S.triggers[st.triggerId] : null;
    let pill = `<span class="pill">not scheduled</span>`;
    if(tr){ const ls_=tr.last_run&&tr.last_run.status||""; pill = !tr.enabled ? `<span class="pill warn">paused</span>` : /FAIL/.test(ls_) ? `<span class="pill bad">last run failed</span>` : /SUCC/.test(ls_) ? `<span class="pill ok">on duty</span>` : /PEND|RUNN/.test(ls_) ? `<span class="pill warn">running</span>` : `<span class="pill acc">scheduled</span>`; }
    else if(st.triggerId){ pill = `<span class="pill acc">scheduled</span>`; }
    const next = tr && tr.next_run_at ? `Next: ${when(tr.next_run_at)}` : esc(a.schedule);
    return `<div class="agent"><div class="top">${av(a.key,"sm")}<div style="min-width:0;flex:1"><div class="nm">${esc(a.name)}</div><div class="rl">${esc(a.role)}</div></div><button class="btn" type="button" data-pick="${esc(a.key)}" style="padding:4px 10px">Talk</button></div>
      <div class="reports">Reports to ${esc(a.reports)} · ${next}</div>
      <div class="last">${st.lastSummary?esc(st.lastSummary):'<span class="muted">Hasn\'t reported yet.</span>'}</div>
      <div class="foot"><span class="small muted">Last run ${ago(st.lastRun)}</span>${pill}
        ${IS_OWNER?`<button class="btn" data-run="${esc(a.key)}" ${st.triggerId?"":"disabled"} type="button">${busyKey(a.key)?"Already running · queue":"Run now"}</button>`:""}</div></div>`; }
}

/* ---------- views ---------- */
function vOverview(){
  const b=S.brief; const needs=[];
  S.apps.filter(a=>appStage(a)==="review").forEach(a=>needs.push({k:"app-"+a.id, t:`Approve or change the app: ${a.name}`, why:a.next||"It passed testing. Try it, then approve the launch or send changes.", btn:`<button class="btn primary" type="button" data-appopen="${esc(a.id)}">Open ${esc(a.name)}</button>`}));
  const prop=S.designs.filter(d=>d.status==="proposed").length; if(prop) needs.push({k:"designs-"+dayKey(new Date()), t:`Pick today's shirt and print designs (${prop} waiting)`, why:"Helen narrowed them down. Approve the ones you like; the rest stay in the library.", btn:`<button class="btn primary" type="button" data-goto="design">See the designs</button>`});
  const topIdea=S.appideas.find(x=>x.status==="top"); if(topIdea) needs.push({k:"idea-"+topIdea.id, t:`Today's app idea: ${topIdea.name}`, why:topIdea.oneLiner||"", btn:`<button class="btn primary" type="button" data-ideaopen="${esc(topIdea.id)}">Look at it</button>`});
  S.questions.filter(q=>q.status!=="answered").slice(0,5).forEach(q=>needs.push({k:"q-"+q.id, q:q.id, t:q.text, why:`The app team needs this answered`, btn:`<button class="btn primary" type="button" data-goto="apps">Answer it</button>`}));
  S.matters.filter(m=>m.status==="needs you").forEach(m=>needs.push({k:"legal-"+m.id, t:`Legal: ${m.title||m.name||"a matter needs you"}`, why:m.next||m.summary||"", btn:`<button class="btn primary" type="button" data-goto="legal">Open Legal</button>`}));
  S.setup.filter(x=>!x.done).sort((a,b)=>(a.order??99)-(b.order??99)).forEach(x=>{ const u=safeUrl(x.link); needs.push({k:"setup-"+x.id, t:x.title, why:x.why, btn:`${u?`<a class="btn primary" href="${esc(u)}" target="_blank" rel="noopener">Go there</a>`:""}<label class="check small" style="margin-left:4px"><input type="checkbox" data-setup="${esc(x.id)}" id="setup-${esc(x.id)}"> Done</label>`}); });
  const needRow=(n)=>`<div class="todo"><div class="todo-h"><span class="todo-t">${esc(n.t)}</span><span class="todo-act">${n.btn}</span></div>
      <div class="todo-body">${n.why?`<details class="todo-why"><summary>Details</summary><p class="need-why">${esc(n.why)}</p></details>`:""}${replyBox(n.k,n.t,n.q)}</div></div>`;
  const today=dayKey(new Date());
  const isToday=x=>(x.round||dayKey(x.at||0))===today;
  /* decide-today cards with pictures */
  const pick=[];
  S.designs.filter(d=>d.status==="proposed").forEach(d=>pick.push({chg:"d:"+d.id, desc:d.concept||d.note||d.description||"", img:assetSrc(d.imageId,d.imageUrl), t:d.title, sub:BRANDS[d.brand]||d.brand, tag:designBiz(d)==="c3d"?["c3d","3D design"]:["ed","Design"],
    acts:`<button class="btn primary" type="button" data-dapprove="${esc(d.id)}">Approve</button><button class="btn" type="button" data-dchange="${esc(d.id)}">Change</button><button class="btn" type="button" data-dpass="${esc(d.id)}">Pass</button>`}));
  S.printideas.filter(x=>x.status==="shortlisted"||(x.status==="new"&&x.legal==="ok")).forEach(x=>pick.push({chg:"pi:"+x.id, desc:x.concept||"", img:assetSrc(x.previewId,x.previewUrl)||(Array.isArray(x.renders)&&x.renders[0]?(typeof safeImg==="function"?safeImg(x.renders[0]):x.renders[0]):""), t:x.title, sub:(x.kind==="spike"?"Sales spike · ":"")+((x.price&&x.price.suggested)?"$"+x.price.suggested:"3D print"), tag:["c3d","3D print"],
    acts:`<button class="btn primary" type="button" data-piok="${esc(x.id)}">Approve</button><button class="btn" type="button" data-pino="${esc(x.id)}">Pass</button>`}));
  S.apps.filter(a=>appStage(a)==="review").forEach(a=>pick.push({img:safeImg(a.iconUrl)||(a.iconId?assetSrc(a.iconId):""), t:a.name, sub:"Ready for your launch OK", tag:["apps","App"], acts:`<button class="btn primary" type="button" data-appopen="${esc(a.id)}">Open</button>`}));
  if(topIdea) pick.push({img:assetSrc(topIdea.iconId,topIdea.iconUrl), t:topIdea.name, sub:"Today's app idea", tag:["apps","App idea"], acts:`<button class="btn primary" type="button" data-ideaopen="${esc(topIdea.id)}">Look</button>`});
  const pickHtml=pick.length?`<div class="hscroll">${pick.map(c=>`<div class="pcard" style="--tag:var(--c-${c.tag[0]})">${c.img?`<img src="${esc(c.img)}" alt="${esc(c.t||"")}" loading="lazy">`:`<div class="noimg nopic"><span class="nopic-h">Idea only · no picture yet</span><span class="nopic-t">${esc(String(c.desc||"Ask the team for a picture below.").slice(0,260))}</span></div>`}<div class="pc-b"><span class="tagchip">${esc(c.tag[1])}</span><b>${esc(String(c.t||"").slice(0,60))}</b><span class="meta">${esc(String(c.sub||"").slice(0,60))}</span>${c.desc?`<details class="pc-desc"><summary>Read the full idea</summary><p>${esc(String(c.desc).slice(0,1200))}</p></details>`:""}<div class="pc-a">${c.acts}</div>${c.chg?`<form class="pcchg" data-pcchg="${esc(c.chg)}"><input type="text" maxlength="600" id="pcchg-${esc(c.chg.replace(/[^A-Za-z0-9_-]/g,"_"))}" placeholder="Tell the team what to change…" aria-label="Tell the team what to change on ${esc(c.t||"this")}"><button class="btn" type="submit">Send</button></form>`:""}</div></div>`).join("")}</div>`
    :`<div class="empty">Nothing to approve right now. New designs land after Helen's 10 PM meeting; Andy's 3D ideas after his 9:25 AM run.</div>`;
  const otherNeeds=needs.filter(n=>!/^designs-|^app-|^idea-/.test(n.k));
  const todoHtml=otherNeeds.length?`<details class="todos" id="todos"${S.todosOpen?" open":""}><summary><b>Other to-dos</b> <span class="pill warn">${otherNeeds.length}</span><span class="muted small"> · setup, legal, questions · tap to open</span></summary><div class="todo-list">${otherNeeds.map(needRow).join("")}</div></details>`:"";
  /* fresh today gallery: designs + 3D previews */
  const fresh=[...S.designs.filter(d=>assetSrc(d.imageId,d.imageUrl)).map(d=>({img:assetSrc(d.imageId,d.imageUrl),t:d.title,b:designBiz(d),at:d.at||d.round,go:"design:"+designBiz(d)+"#d-new",lab:BRANDS[d.brand]||""})),
    ...S.printideas.filter(x=>assetSrc(x.previewId,x.previewUrl)).map(x=>({img:assetSrc(x.previewId,x.previewUrl),t:x.title,b:"c3d",at:x.at,go:"c3d#c3d-ideas",lab:x.path==="re-engineered"?"Re-engineered 3D":"3D print idea"}))]
    .sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,innerWidth<600?6:12);
  const freshHtml=fresh.length?`<div class="fgrid">${fresh.map(f=>`<button class="fcard" type="button" data-goto="${esc(f.go)}" style="--tag:var(--c-${f.b})"><img src="${esc(f.img)}" alt="${esc(f.t||"")}" loading="lazy"><span class="fc-t">${esc(String(f.t||"").slice(0,48))}</span><span class="fc-l">${esc(f.lab)}</span></button>`).join("")}</div>`:`<div class="empty">Today's designs and 3D renders show up here as they're made.</div>`;
  /* product pipelines */
  const stage=(lab,n,go)=>`<button class="pstage" type="button" data-goto="${go}"><span class="pn">${n}</span><span class="pl">${esc(lab)}</span></button>`;
  const edD=S.designs.filter(d=>designBiz(d)==="ed"), c3D=S.designs.filter(d=>designBiz(d)==="c3d");
  const edL=S.listings.filter(l=>listingBiz(l)==="ed"), c3L=S.listings.filter(l=>listingBiz(l)==="c3d");
  const cnt=(arr,sts)=>arr.filter(x=>sts.includes(x.status||"")).length;
  const pipeHtml=`<div class="pipe" style="--tag:var(--c-ed)"><div class="pipe-h">Elevated Designs</div><div class="pstages">
      ${stage("Ideas (Vera)",(S.designIdeas||0),"design:ed#d-new")}${stage("Drawn",cnt(edD,["submitted","shortlisted"]),"design:ed#d-new")}${stage("Your pick",cnt(edD,["proposed"]),"design:ed#d-new")}${stage("Being changed",cnt(edD,["changes"]),"design:ed#d-new")}${stage("Approved",cnt(edD,["approved"]),"design:ed#d-new")}${stage("Listing ready",cnt(edL,["ready"]),"listings:ed#l-list")}${stage("Live",cnt(edL,["posted"]),"listings:ed#l-list")}</div></div>
    <div class="pipe" style="--tag:var(--c-c3d)"><div class="pipe-h">Charleston 3D</div><div class="pstages">
      ${stage("3D ideas",cnt(S.printideas,["new"]),"c3d#c3d-ideas")}${stage("Files built",S.printideas.filter(x=>(x.files||[]).length).length,"c3d#c3d-ideas")}${stage("Legal OK",S.printideas.filter(x=>x.legal==="ok"&&["new","shortlisted"].includes(x.status)).length,"c3d#c3d-ideas")}${stage("Your pick",cnt(S.printideas,["shortlisted"])+cnt(c3D,["proposed"]),"c3d#c3d-ideas")}${stage("Approved",cnt(S.printideas,["approved"])+cnt(c3D,["approved"]),"c3d#c3d-ideas")}${stage("Listing ready",cnt(c3L,["ready"]),"listings:c3d#l-list")}${stage("Live",cnt(c3L,["posted"])+cnt(S.printideas,["listed"]),"listings:c3d#l-list")}</div></div>`;
  /* studio panel */
  const chan=(name,key,cls)=>{ const q=S.queue.filter(x=>String(x.platform||"").includes(name)); const next=q.filter(x=>["scheduled","draft"].includes(x.status)&&x.when).sort((a,b)=>String(a.when).localeCompare(String(b.when)))[0];
    const m=id=>S.metrics.find(x=>x.id===id); const subs=m(key+"-subs"), ready=m("mike-"+key+"-ready");
    const shorts=q.filter(x=>/Shorts/.test(x.platform)&&["scheduled","draft"].includes(x.status)).length, longs=q.filter(x=>/^YouTube/.test(x.platform)&&["scheduled","draft"].includes(x.status)).length, blocked=q.filter(x=>["blocked","needs fix"].includes(x.status)).length;
    return `<div class="chan ${cls}"><div class="chan-h"><span class="yt" aria-hidden="true">▶</span><b>${esc(name)}</b></div>
      <div class="chan-k"><div><span class="v">${subs&&subs.value!=null?esc(String(subs.value)):"—"}</span><span class="l">subscribers</span></div><div><span class="v">${longs}</span><span class="l">videos queued</span></div><div><span class="v">${shorts}</span><span class="l">Shorts queued</span></div><div><span class="v ${blocked?"dn":""}">${blocked}</span><span class="l">need fixes</span></div></div>
      <div class="meta">${next?`Next: ${esc(String(next.title||"").slice(0,70))} · ${when(next.when)}`:"Nothing scheduled yet"}${ready&&ready.value!=null?` · ${esc(String(ready.value))} ready today`:""}</div></div>`; };
  const studioHtml=`<div class="chans">${chan("Released Footage","rf","rf")}${chan("Funny Video Clips","fvc","fvc")}${chan("ElevatedNewsflash","enf","enf")}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" type="button" data-goto="studio#s-queue">Open Studio</button><a class="btn" href="https://studio.youtube.com" target="_blank" rel="noopener">YouTube Studio</a></div>`;
  const briefHtml=b?`<details class="card brief-d"><summary><span class="avatar av-steph" role="img" aria-label="Stephanie">S</span><span><b>Stephanie's brief</b><span class="small muted"> · ${ago(b.at)} · tap to read</span><br><span class="small">${esc(String(b.summary||"").split(/(?<=[.!?])\s/)[0])}</span></span></summary>
      <p class="summary">${esc(b.summary)}</p>${(b.priorities||[]).length?`<ol class="prios">${b.priorities.map((p,i)=>`<li>${esc(p)}${replyBox("brief-"+String(b.date||dayKey(new Date())).replace(/[^0-9a-z-]/gi,"")+"-"+i,p)}</li>`).join("")}</ol>`:""}<button class="btn" id="playBrief" type="button">Read it to me</button></details>`:"";
  const top=tickerStrip(); const hr=new Date().getHours(); const hi=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  const fold=(title,sub,inner,id)=>`<details class="card fold"${id?` id="${id}"`:""}><summary><span class="fold-t"><b>${title}</b>${sub?`<span class="small muted"> · ${sub}</span>`:""}</span></summary><div class="fold-b">${inner}</div></details>`;
  const liveN=S.listings.filter(l=>l.status==="posted").length;
  const bizTile=(key,name,img,nums,go,sub)=>`<button class="biztile" type="button" data-goto="${go}" style="--tag:var(--c-${key})">${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<span class="biztile-ph">${ICON[key==="ed"?"shirt":key==="c3d"?"cube":"play"]}</span>`}<span class="biztile-b"><b>${esc(name)}</b><span class="biztile-n">${nums.map(([v,l])=>`<span><i>${esc(String(v))}</i>${esc(l)}</span>`).join("")}</span>${sub?`<span class="meta">${esc(sub)}</span>`:""}</span></button>`;
  const lastImg=(arr,f)=>{ const x=arr.slice().sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))).find(f); return x?f(x):""; };
  const edImg=lastImg(S.designs.filter(d=>designBiz(d)==="ed"),d=>assetSrc(d.imageId,d.imageUrl));
  const c3Img=lastImg(S.designs.filter(d=>designBiz(d)==="c3d"),d=>assetSrc(d.imageId,d.imageUrl))||lastImg(S.printideas,x=>assetSrc(x.previewId,x.previewUrl));
  const vidImg=lastImg(S.ytitems||[],i=>safeImg(i.thumbUrl));
  const vq=S.queue.filter(q=>/YouTube/.test(q.platform||"")&&["scheduled","draft"].includes(q.status)).length;
  const subsOf=k=>{ const m=S.metrics.find(x=>x.id===k+"-subs"); return m&&m.value!=null?m.value:"—"; };
  const act=(label,icon,go,extra)=>`<button class="acttile" type="button" ${go?`data-goto="${go}"`:""} ${extra||""}><i>${ICON[icon]}</i><span>${label}</span></button>`;
  const actions=`<div class="acts">
    ${act("New shirt design","shirt","designer")}${act("Generate art","spark","designlab")}${act("Make a light box","cube","lightbox")}${act("New 3D product","cube","c3d#c3d-ideas")}${act("New listing","list","listings:ed#l-new")}
    ${act("Post a video","play","studio")}${act("Design library","image","library")}${act("Fix the console","wrench","team#changes")}</div>`;
  const biz=`<div class="biztiles">
    ${bizTile("ed","Elevated Designs",edImg,[[cnt(edD,["proposed"]),"to approve"],[cnt(edL,["ready"]),"ready to list"],[cnt(edL,["posted"]),"live"]],"elevated")}
    ${bizTile("c3d","Charleston 3D",c3Img,[[cnt(S.printideas,["shortlisted"])+cnt(c3D,["proposed"]),"to approve"],[S.printideas.filter(x=>(x.files||[]).length).length,"files built"],[cnt(c3L,["posted"])+cnt(S.printideas,["listed"]),"live"]],"c3d")}
    ${bizTile("studio","Video · 3 channels",vidImg,[[subsOf("rf"),"RF subs"],[subsOf("fvc"),"FVC subs"],[vq,"queued"]],"studio")}</div>`;
  return `<div class="homewrap">${homeRailLeft()}<div class="home">
  <div class="home-head"><div class="eyebrow">${hi}${CUR?", "+esc(CUR):""}</div><h2 class="hero-h">${top.approvals?`${top.approvals} decision${top.approvals===1?"":"s"} waiting on you`:"You're all caught up"}</h2></div>
  ${actions}
  ${upcomingCharges()}
  <section class="card" id="decide"><div class="card-head"><h2 class="big">Needs you</h2><span class="pill ${pick.length?"warn":"ok"}">${pick.length}</span></div>${pickHtml}${todoHtml}</section>
  ${biz}
  ${top.kpis}
  <div class="folds">
    ${briefHtml}
    ${fold("What's selling","Nora's market research",marketPulse())}
    ${fold("Product pipeline",`${liveN} live · idea → your pick → live`,pipeHtml)}
    ${fold("Today's output",`${top.done} of ${top.total} goals hit`,top.goals)}
    ${fold("The team",`${TEAM.length} teammates · tap a face to chat`,podsCard(),"team-fold")}
    ${fold("Team health","bugs & fixes · Max",healthCard().replace(/^<section class="card" id="health">/,'<div id="health">').replace(/<\/section>$/,"</div>"))}
    ${fold("Your roadmap","step by step",roadmapCard())}
  </div></div>${homeRailRight(fresh)}</div>`;
}
/* "Just happened" items: one tap expands the story in place, two taps jump to the page that activity belongs to */
const ACT_OPEN=new Set();
const ACT_LABEL={design:"Designs",listings:"Listings",c3d:"Charleston 3D",studio:"Studio",growth:"Growth",research:"Research",apps:"Apps",legal:"Legal",money:"Money",comms:"Team",elevated:"Elevated Designs",schedules:"Schedules",agents:"Agents",code:"Code",lightbox:"Maker",ideas:"Ideas",paperwork:"Paperwork"};
function actDest(a){ const t=(String(a.title||"")+" "+String(a.detail||"")).toLowerCase(); const k=String(a.agent||"");
  const by={lisa:"design:ed",vera:"design:ed",iris:"design:ed",carla:"listings:ed#l-list",brooke:"listings:ed#l-list",andy:"c3d",cole:"c3d",mike:"studio",jake:"studio",megan:"studio",sage:"growth#g-market",tina:"growth",ava:"growth",nora:"research",zoe:"apps",sam:"apps",ray:"apps",kim:"apps",leo:"apps",helen:"legal",linda:"money",steve:"comms",max:"comms",diane:"money"};
  if(/\b3d\b|nameplate|hype chain|light ?box|lithophane|\.3mf|\.stl/.test(t)) return "c3d";
  if(/paperwork|signed|filed|trademark|uspto|llc|license|legal|tax|1099|w-9/.test(t)) return "legal";
  if(/\bbill|subscription|charge|invoice|revenue|run-rate|money/.test(t)) return "money";
  if(/listing|shopify|etsy|store|thumbnail/.test(t)) return k==="andy"?"listings:c3d#l-list":"listings:ed#l-list";
  if(/\bdesign|shirt|mockup|print file|dtf|art\b/.test(t)) return "design:ed";
  if(/youtube|video|short|clip|bodycam|channel|views/.test(t)) return "studio";
  if(/\bseo\b|pagespeed|ranking|keyword/.test(t)) return "growth#g-market";
  if(/\bapp\b|apps\b|pwa|netlify|deploy|repo|github/.test(t)) return "apps";
  if(/market report|lab daily|research|trend/.test(t)) return "research";
  if(/bug|console|dashboard|security|maintenance/.test(t)) return "comms";
  return by[k]||"comms#feed"; }
function bindActx(){ document.querySelectorAll("[data-actx]").forEach(el=>{ let timer=null;
    el.onclick=e=>{ if(e.target.closest("a,button")) return; if(timer){ clearTimeout(timer); timer=null; return; } timer=setTimeout(()=>{ timer=null; const id=el.dataset.actx; if(ACT_OPEN.has(id)) ACT_OPEN.delete(id); else ACT_OPEN.add(id); render(); },260); };
    el.ondblclick=e=>{ if(e.target.closest("a,button")) return; if(timer){ clearTimeout(timer); timer=null; } const a=S.activity.find(x=>x.id===el.dataset.actx); if(a) goTo(actDest(a)); };
    el.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); const a=S.activity.find(x=>x.id===el.dataset.actx); if(a) goTo(actDest(a)); } if(e.key===" "){ e.preventDefault(); el.onclick({target:el}); } }; }); }
/* side rails on wide screens: who's working, what just happened, what runs next, today's newest art */
function homeRailLeft(){
  const team=TEAM.map(a=>{ const [st,lab]=agentState(a.key); const h=huddleLine(a.key);
    return `<button type="button" class="rrow" data-chat="${esc(a.key)}" title="Chat with ${esc(a.name)}">${av(a.key,"sm")}<span class="rb"><span class="rt"><b>${esc(a.name)}</b> <i class="sdot ${st}"></i><span class="muted small">${esc(lab)}</span></span><span class="rm">${esc(String(h.done||a.role||"").slice(0,70))}</span></span></button>`; }).join("");
  const act=S.activity.slice(0,8).map(a=>{ const ag=TEAM_BY[a.agent]; const open=ACT_OPEN.has(a.id); const u=safeUrl(a.link); const dest=actDest(a);
    return `<div class="ract actx ${open?"open":""}" data-actx="${esc(a.id)}" role="button" tabindex="0" title="Tap to expand · tap twice to open ${esc(ACT_LABEL[dest.split(/[:#]/)[0]]||"the page")}">
      <span class="rt">${esc(open?String(a.title||""):String(a.title||"").slice(0,80))}</span><span class="rm">${esc(ag?ag.name:String(a.agent||""))} · ${ago(a.at)}${a.kind?` · ${esc(a.kind)}`:""}</span>
      ${open?`<div class="rx">${a.detail?`<div class="small">${esc(a.detail)}</div>`:`<div class="small muted">No more detail on this one.</div>`}<div class="rx-act"><button type="button" class="linkbtn" data-goto="${esc(dest)}">Go to ${esc(ACT_LABEL[dest.split(/[:#]/)[0]]||"page")} →</button>${u?`<a href="${esc(u)}" target="_blank" rel="noopener">Open link ↗</a>`:""}</div></div>`:""}</div>`; }).join("");
  return `<aside class="hrail" aria-label="Team right now">
    <section class="card rcard"><div class="card-head"><h2>Just happened</h2><button class="btn rlink" type="button" data-goto="comms#feed">Feed</button></div>${act||`<div class="empty small">Nothing logged yet today.</div>`}<div class="small muted" style="padding-top:6px">Tap once to read · twice to jump there</div></section>
    <section class="card rcard"><div class="card-head"><h2>Team right now</h2><button class="btn rlink" type="button" data-goto="comms">All</button></div>${team}</section></aside>`; }
function homeRailRight(fresh){
  const next=Object.values(S.triggers||{}).filter(t=>t&&t.enabled&&t.next_run_at).sort((a,b)=>String(a.next_run_at).localeCompare(String(b.next_run_at))).slice(0,6)
    .map(t=>`<div class="ract"><span class="rt">${esc(String(t.name||"").split(" · ")[0].slice(0,40))}</span><span class="rm">${when(t.next_run_at)}</span></div>`).join("");
  const L=S.listings, c=st=>L.filter(l=>l.status===st).length;
  const art=(fresh||[]).slice(0,6).map(f=>`<button class="rthumb" type="button" data-goto="${esc(f.go)}" title="${esc(f.t||"")}"><img src="${esc(f.img)}" alt="${esc(f.t||"")}" loading="lazy"></button>`).join("");
  return `<aside class="hrail" aria-label="Coming up">
    <section class="card rcard"><div class="card-head"><h2>Newest art</h2><button class="btn rlink" type="button" data-goto="design:ed#d-new">Designs</button></div>${art?`<div class="rgrid">${art}</div>`:`<div class="empty small">Today's designs show up here.</div>`}</section>
    <section class="card rcard"><div class="card-head"><h2>Listings</h2><button class="btn rlink" type="button" data-goto="listings:ed#l-list">Open</button></div>
      <div class="rkpi"><div><b>${c("ready")}</b><span>ready</span></div><div><b>${c("posted")}</b><span>live</span></div><div><b class="${c("needs")?"dn":""}">${c("needs")}</b><span>need info</span></div></div></section>
    <section class="card rcard"><div class="card-head"><h2>Coming up</h2><button class="btn rlink" type="button" data-goto="schedules">Schedules</button></div>${next||`<div class="empty small">Schedules load when connected.</div>`}</section></aside>`; }
/* Pods: the org at a glance — each pod's lead, members, live status and their latest huddle line (tap to expand). */
const PODS=[["exec","Executive","steve",["helen","max"],"ops"],["ed","Elevated Designs","vera",["lisa","carla"],"ed"],["mkt","Marketing & growth","tina",["sage"],"apps"],["c3d","Charleston 3D","andy",[],"c3d"],["studio","Studio · YouTube","mike",[],"studio"],["apps","Apps","sam",["nora"],"apps"]];
function huddleLine(k){ const t=dayKey(new Date()); const h=S.huddle.find(x=>x.agent===k&&x.date===t)||S.huddle.filter(x=>x.agent===k).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]; const st=S.agents[k]||{};
  if(h) return {done:h.done, next:h.next, blocked:h.blocked, at:h.at}; return {done:st.lastSummary, at:st.lastRun}; }
function trendChip(t){ const m={hot:["bad","hot"],rising:["ok","rising"],steady:["","steady"],cooling:["warn","cooling"]}[t]||["",t||""]; return t?`<span class="pill ${m[0]}" style="font-size:12px;padding:0 6px">${esc(m[1])}</span>`:""; }
function marketPulse(){
  const m=S.market; const col=(title,c,arr,key)=>`<div class="mcol" style="--tag:var(--c-${c})"><div class="mcol-h">${esc(title)}</div>${(arr||[]).slice(0,4).map(x=>{ const u=safeUrl(x.url); return `<div class="mitem"><div class="mi-t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(String(x.item||x.what||"").slice(0,70))}</a>`:esc(String(x.item||x.what||"").slice(0,70))} ${trendChip(x.trend)}</div>${x.metric?`<div class="meta">${esc(String(x.metric).slice(0,80))}${x.price?` · ${esc(String(x.price))}`:""}</div>`:""}</div>`; }).join("")||`<div class="small muted">No data yet.</div>`}</div>`;
  if(!m) return `<section class="card" id="market"><div class="card-head"><h2 class="big">What's selling</h2><span class="eyebrow">Nora · market research</span></div><div class="empty">Nora's first market report lands after 5 AM: what's selling in tees, 3D prints and YouTube, with sources and the moves to make.</div></section>`;
  const todo=(m.whatToDo||[]).slice(0,3);
  return `<section class="card" id="market"><div class="card-head"><h2 class="big">What's selling</h2><span class="eyebrow">Nora · ${ago(m.at)} · <button type="button" class="btn" style="padding:1px 8px;font-size:13px" data-goto="growth#g-market">Full report</button></span></div>
    ${m.headline?`<p style="margin:0 0 10px;font-weight:600">${esc(m.headline)}</p>`:""}
    <div class="mcols">${col("T-shirts","ed",(m.tees||{}).selling)}${col("YouTube","studio",(m.youtube||{}).working)}</div>
    ${todo.length?`<div class="mtodo"><div class="eyebrow" style="margin-bottom:4px">Moves to make</div>${todo.map((t,i)=>`<div class="small"><b>${i+1}.</b> ${esc(t.action||"")} <span class="muted">· ${esc(TEAM_BY[t.owner]?TEAM_BY[t.owner].name:t.owner||"")}</span></div>`).join("")}</div>`:""}</section>`;
}
function podsCard(){
  const dot=k=>{ const s=agentState(k)[0]; return `<i class="sdot ${s}"></i>`; };
  const blockedN=TEAM.filter(a=>{ const h=huddleLine(a.key); return h.blocked&&String(h.blocked).trim(); }).length;
  return `<section class="card" id="team"><div class="card-head"><h2>The team</h2><span class="eyebrow">${TEAM.length} · ${blockedN?`<span style="color:var(--bad)">${blockedN} blocked</span>`:"no blockers"} · tap a face to chat</span></div>
    <div class="pods">${PODS.map(([id,label,lead,mem,col])=>{ const lh=huddleLine(lead);
      return `<details class="pod" style="--tag:var(--c-${col})"><summary><span class="pod-h">${esc(label)}</span><span class="pod-av">${[lead,...mem].map(k=>`<button type="button" class="pav" data-chat="${esc(k)}" title="Chat with ${esc(TEAM_BY[k].name)} · ${esc(TEAM_BY[k].role)}">${av(k,"sm")}${dot(k)}</button>`).join("")}</span></summary>
        <div class="pod-b">${[lead,...mem].map(k=>{ const h=huddleLine(k); return `<div class="hud"><b>${esc(TEAM_BY[k].name)}</b>${k===lead?' <span class="tagchip">lead</span>':""} <span class="muted small">${h.at?ago(h.at):"not yet"}</span>
          ${h.done?`<div class="small">${esc(String(h.done).slice(0,220))}</div>`:`<div class="small muted">No update yet.</div>`}${h.next?`<div class="small muted">Next: ${esc(String(h.next).slice(0,140))}</div>`:""}${h.blocked&&String(h.blocked).trim()?`<div class="small" style="color:var(--bad)">Blocked: ${esc(String(h.blocked).slice(0,140))}</div>`:""}</div>`; }).join("")}</div></details>`; }).join("")}</div></section>`;
}
function replyBox(k,title,qid){ if(!k) return ""; const id=String(k).replace(/[^A-Za-z0-9_-]/g,"_").slice(0,120); const r=S.replies.find(x=>x.id===id);
  return `<div class="replybox">${r?`<div class="replied"><b>You:</b> ${esc(r.text)} <span class="muted small">· ${ago(r.at)}${r.answer?"":" · Stephanie has it"}</span>${r.answer?`<div><b>Stephanie:</b> ${esc(r.answer)}</div>`:""}</div>`:""}
    <div class="replyrow"><input type="text" id="rp-${id}" placeholder="${r?"Add more for Stephanie…":"Reply to Stephanie…"}" aria-label="Reply about: ${esc(String(title).slice(0,80))}" maxlength="1500"><button class="btn" type="button" data-reply="${id}" data-rtitle="${esc(String(title).slice(0,200))}" ${qid?`data-rq="${esc(qid)}"`:""}>Send</button></div></div>`; }
async function sendReply(id,title,qid){ const inp=$("#rp-"+id); const v=(inp&&inp.value||"").trim(); if(!v){ toast("Type your reply first."); if(inp) inp.focus(); return; } if(!db){ toast("Can't save in this view."); return; }
  const now=new Date().toISOString(), who=me();
  try{ const cur=S.replies.find(x=>x.id===id); const text=cur?cur.text+" / "+v:v;
    await db.doc("replies/"+id).set({item:title, text:text.slice(0,3000), by:who.toLowerCase(), at:now, answer:"", status:"open"});
    await addReq({for:"steve", by:who.toLowerCase(), what:`${who} replied about "${title}": ${v}`, reply:id, status:"open", at:now});
    if(qid){ try{ await db.doc("questions/"+qid).update({status:"answered", answer:v, answeredAt:now}); }catch{} }
    const tid=tidOf("steve"); const woke=tid?await fire(tid,`${who} replied on the dashboard about "${title}": "${v}". Route it to whoever needs it, then write your answer to replies/${id}.answer (one or two sentences) and close the request.`):false;
    if(inp) inp.value=""; toast(woke?"Sent. Stephanie is on it now.":"Sent to Stephanie."); }catch{ toast("Couldn't send. Try again."); } }
/* Keep every fold (details) the way the user left it when the page re-renders after a tap or a live update */
const OPEN_STATE=new Map();
/* Long lists start with 5 rows and fill in 20 at a time as you scroll down to them; how far each list is open is remembered, so live updates never shrink it under you */
const LIST_SHOWN=new Map();
/* any button marked data-autoload presses itself when it scrolls within ~one screen of view, so lists and grids load as you scroll */
const AUTOLOAD=("IntersectionObserver" in window)?new IntersectionObserver(es=>es.forEach(e=>{ if(!e.isIntersecting) return; const b=e.target; AUTOLOAD.unobserve(b); if(b.isConnected&&!b.disabled&&!b.hidden) b.click(); }),{rootMargin:"0px 0px 900px 0px"}):null;
function watchAutoload(){ if(!AUTOLOAD) return; document.querySelectorAll("#main [data-autoload]").forEach(b=>{ if(b.dataset.alw) return; b.dataset.alw="1"; AUTOLOAD.observe(b); }); }
function clampLists(){ document.querySelectorAll("#main .list").forEach((l,i)=>{ const rows=[...l.children].filter(c=>c.classList&&c.classList.contains("row")); if(rows.length<=6) return;
  const card=l.closest("section,details,.card"); const h=card&&card.querySelector("h2,summary b,h3"); const key=S.tab+"|"+(h?h.textContent.replace(/[0-9]+/g,"#").trim().slice(0,60):"")+"|"+i;
  let n=Math.max(5,LIST_SHOWN.get(key)||5); if(n>=rows.length) return; rows.slice(n).forEach(r=>r.hidden=true);
  const b=document.createElement("button"); b.type="button"; b.className="btn showall"; b.dataset.autoload="1";
  const label=()=>{ b.textContent=`Show more · ${rows.length-n} left`; }; label();
  b.onclick=()=>{ n=Math.min(rows.length,n+20); LIST_SHOWN.set(key,n); rows.forEach((r,k)=>{ if(k<n) r.hidden=false; }); if(n>=rows.length){ b.remove(); return; } l.appendChild(b); label(); delete b.dataset.alw; watchAutoload(); };
  l.appendChild(b); }); }
function detKeys(){ const seen={}; return [...document.querySelectorAll("#main details")].map(d=>{ const sm=d.querySelector(":scope>summary"); const base=S.tab+"|"+String(sm?sm.textContent:"").replace(/[0-9]+/g,"#").replace(/\s+/g," ").trim().slice(0,80); seen[base]=(seen[base]||0)+1; return [d,base+"|"+seen[base]]; }); }
function keepFolds(){ detKeys().forEach(([d,k])=>{ if(OPEN_STATE.has(k)&&d.open!==OPEN_STATE.get(k)) d.open=OPEN_STATE.get(k); }); }
document.addEventListener("toggle",e=>{ const t=e.target; if(!t||t.tagName!=="DETAILS") return; if(t.id==="todos") S.todosOpen=t.open; if(!t.closest("#main")) return; const hit=detKeys().find(([d])=>d===t); if(hit) OPEN_STATE.set(hit[1],t.open); },true);
document.addEventListener("click",e=>{ const b=e.target.closest&&e.target.closest("[data-reply]"); if(b) sendReply(b.dataset.reply,b.dataset.rtitle||"",b.dataset.rq||""); });
document.addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target&&e.target.id&&e.target.id.startsWith("rp-")){ e.preventDefault(); const b=e.target.parentElement.querySelector("[data-reply]"); if(b) b.click(); } });
async function c3dStep(id,on){ const site=S.c3d.site; if(!site||!db) return; const steps=(site.launchSteps||[]).map(x=>x.id===id?{...x,done:on,doneAt:on?new Date().toISOString():null,doneBy:on?me().toLowerCase():null}:x);
  try{ await db.doc("c3d/site").update({launchSteps:steps}); toast(on?"Checked off.":"Unchecked."); }catch{ toast("Couldn't save. Try again."); } }
async function queueSet(id,status){ if(!db) return; const q=S.queue.find(x=>x.id===id); if(!q) return; const now=new Date().toISOString();
  try{ await db.doc("queue/"+id).update({status, decidedBy:me().toLowerCase(), decidedAt:now});
    await addReq({for:"tina", by:me().toLowerCase(), what:`${me()} ${status==="approved"?"APPROVED":"put on HOLD"} the post "${q.title}" (queue/${id}).${status==="approved"?" Schedule/post it when the channel is connected.":" Don't post it; ask Stephanie what to change."}`, status:"open", at:now}); fire(tidOf("tina"),`Aaron just ${status==="approved"?"approved":"held"} the post "${q.title}" (queue/${id}). Act on it now.`);
    toast(status==="approved"?"Approved. Tina will post it.":"On hold."); }catch{ toast("Couldn't save. Try again."); } }
async function siteRequest(){ const i=$("#siteReq"); const v=(i&&i.value||"").trim(); if(!v){ toast("Type the change first."); return; } if(!db) return; const now=new Date().toISOString();
  try{ await addReq({for:"sam", by:me().toLowerCase(), what:`Charleston 3D website change from ${me()}: ${v}. Edit the charleston3d-site repo, check it on phone and desktop, then tell Stephanie.`, status:"open", at:now});
    await addReq({for:"steve", by:me().toLowerCase(), what:`FYI ${me()} asked Sam for a website change: ${v}`, status:"open", at:now});
    const tid=tidOf("sam"); const woke=tid?await fire(tid,`Website change request from ${me()}: ${v}`):false; i.value=""; toast(woke?"Sent. Sam is on it now.":"Sent to the team."); }catch{ toast("Couldn't send. Try again."); } }
document.addEventListener("click",e=>{ const t=e.target.closest&&e.target.closest("[data-qok],[data-qhold],#siteReqBtn"); if(!t) return;
  if(t.id==="siteReqBtn") siteRequest(); else if(t.dataset.qok) queueSet(t.dataset.qok,"approved"); else queueSet(t.dataset.qhold,"hold"); });
document.addEventListener("change",e=>{ const t=e.target; if(t&&t.dataset&&t.dataset.c3dstep) c3dStep(t.dataset.c3dstep,t.checked); });
function vCommsPlus(){ return vComms()+`<div class="grid" style="margin-top:20px"><div class="col">${pulseCard()}</div><div class="col"><section class="card" id="feed"><div class="card-head"><h2>What the team did</h2><span class="eyebrow">latest first</span></div>${feed(null,20)}</section></div></div>`; }
function vRoomPlus(){ return vRoom()+`<div style="margin-top:20px">${paperCard()}</div>`; }
function vElevated(){
  const edD=S.designs.filter(d=>designBiz(d)==="ed"), edL=S.listings.filter(l=>listingBiz(l)==="ed");
  const cnt=(arr,sts)=>arr.filter(x=>sts.includes(x.status||"")).length;
  const stage=(lab,n,go)=>`<button class="pstage" type="button" data-goto="${go}"><span class="pn">${n}</span><span class="pl">${esc(lab)}</span></button>`;
  const pipe=`<div class="pipe" style="--tag:var(--c-ed)"><div class="pstages">
      ${stage("Ideas",(S.designIdeas||0),"design:ed#d-new")}${stage("Drawn",cnt(edD,["submitted","shortlisted"]),"design:ed#d-new")}${stage("Your pick",cnt(edD,["proposed"]),"design:ed#d-picks")}${stage("Being changed",cnt(edD,["changes"]),"design:ed#d-new")}${stage("Approved",cnt(edD,["approved"]),"design:ed#d-new")}${stage("Listing ready",cnt(edL,["ready"]),"listings:ed#l-list")}${stage("Live",cnt(edL,["posted"]),"listings:ed#l-list")}</div></div>`;
  const latest=edD.slice().sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))).slice(0,8);
  const picks=edD.filter(d=>d.status==="proposed");
  const act=(label,icon,go)=>`<button class="acttile" type="button" data-goto="${go}"><i>${ICON[icon]}</i><span>${label}</span></button>`;
  return `<div class="acts acts-biz">${act("New shirt design","shirt","designer")}${act("Generate art","spark","designlab")}${act("New listing","list","listings:ed#l-new")}${act("Design library","image","library")}${act("See all designs","plus","design:ed")}</div>${typeof qpCard==="function"?qpCard("ed"):""}
    ${pipe}
    <div class="grid"><div class="col">
    ${picks.length?`<section class="card" id="ed-picks" style="border-color:color-mix(in srgb,var(--c-ed) 45%,var(--line))"><div class="card-head"><h2 class="big">Your picks</h2><span class="pill warn">${picks.length}</span></div><div class="dgrid dbig">${picks.map(d=>dcard(d,designReview(d))).join("")}</div></section>`:""}
    <section class="card"><div class="card-head"><h2>Latest designs</h2><button class="btn" type="button" data-goto="design:ed">All designs</button></div>${latest.length?`<div class="ltiles">${latest.map(dtile).join("")}</div>`:`<div class="empty">Lisa draws 6 designs every morning at 8:45.</div>`}</section>
    <section class="card"><div class="card-head"><h2>Listings</h2><button class="btn" type="button" data-goto="listings:ed">Open</button></div><div class="rkpi" style="max-width:360px"><div><b>${cnt(edL,["ready"])}</b><span>ready</span></div><div><b>${cnt(edL,["posted"])}</b><span>live</span></div><div><b class="${cnt(edL,["needs"])?"dn":""}">${cnt(edL,["needs"])}</b><span>need info</span></div></div></section>
    <section class="card"><div class="card-head"><h2>Social posts</h2><span class="eyebrow">Tina</span></div>${queueList(["Facebook · Elevated Designs","TikTok · Elevated Designs","Instagram"])}</section>
    <section class="card"><div class="card-head"><h2>Numbers</h2><span class="eyebrow">Andy</span></div>${kpis("elevated")}</section>
    <section class="card"><div class="card-head"><h2>Activity</h2></div>${feed(a=>["lisa","tina","carla","brooke","vera"].includes(a.agent)&&!IS3D(txt3(a)),20)}</section></div>
  <div class="col">${desk("elevated")}${brandsCard()}<section class="card"><div class="card-head"><h2>The Elevated team</h2></div>${teamCards("elevated")}</section></div></div>`;
}
/* best picture for a listing: its mockup, its own photos, then the design or 3D idea it came from */
function listingImg(l){ const ids=Array.isArray(l.photoIds)?l.photoIds:[];
  const own=assetSrc(null,l.mockupUrl)||assetSrc(ids.find(x=>/^[0-9a-f]{32}$/.test(String(x))),null)||(l.photos||[]).map(safeImg).find(Boolean); if(own) return own;
  const ref=String(l.design||"").trim().split(/\s/)[0]; if(!ref) return "";
  if(/^printideas\//.test(ref)){ const x=S.printideas.find(p=>p.id===ref.slice(11)); return x?assetSrc(x.previewId,x.previewUrl):""; }
  const d=S.designs.find(x=>x.id===ref.replace(/^designs\//,"")); return d?assetSrc(d.imageId,d.imageUrl):""; }
function vListings(){
  const stc={new:"warn",drafting:"acc",ready:"ok",posted:"ok",needs:"bad"};
  const biz=S.biz==="c3d"?"c3d":"ed", bn=BIZ_NAME[biz]; const mine=S.listings.filter(l=>listingBiz(l)===biz);
  const list = mine.length ? mine.map(l=>{ const d=l.draft||{}; const pics=(l.photos||[]).map(safeImg).filter(Boolean);
    const field=(label,val,k)=> val?`<div><h4>${label} <button class="btn" type="button" data-copy="${esc(l.id)}|${k}" style="padding:2px 8px;font-size:14px;margin-left:6px">Copy</button></h4><p style="white-space:pre-wrap">${esc(Array.isArray(val)?val.join(", "):val)}</p></div>`:"";
    const im=listingImg(l);
    return `<details class="idea"><summary><div class="stripe ${stc[l.status]||""}"></div>${im?`<img class="lthumb" src="${esc(im)}" alt="" loading="lazy">`:`<span class="lthumb lnone" aria-hidden="true">no image</span>`}<div class="body" style="min-width:0;flex:1">
        <div class="t">${esc(d.title||String(l.note||"").slice(0,90)||"New listing")}</div><div class="meta">${ago(l.at)} · ${esc(l.channel||"Etsy")} · ${l.status==="ready"?"ready to post":l.status==="posted"?"live":l.status==="drafting"?"Carla is writing it":l.status==="needs"?"Carla needs something":"waiting for Carla"}</div></div>
        <span class="pill ${stc[l.status]||""}">${esc(l.status||"new")}</span></summary>
      <div class="an">${im&&!pics.length?`<img src="${esc(im)}" alt="${esc(d.title||"Listing image")}" loading="lazy" class="lbig">`:""}${pics.length?`<div style="display:flex;gap:6px;flex-wrap:wrap">${pics.map(u=>`<img class="thumb" src="${esc(u)}" alt="Listing photo">`).join("")}</div>`:""}
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:6px">${typeof packBtn==="function"?packBtn("listing",l.id,"Export pack (files · photos · copy)"):""}</div>
        <div><h4>Your note</h4><p>${esc(l.note||"")}</p></div>
        ${l.question?`<div><h4>Carla needs</h4><p>${esc(l.question)}</p></div>`:""}
        ${field("Title",d.title,"title")}${field("Price",d.price,"price")}${field("Tags (13)",d.tags,"tags")}${field("Description",d.description,"description")}
        ${field("Materials",d.materials,"materials")}${field("Category",d.category,"category")}${field("Shipping & processing",d.shipping,"shipping")}${field("Photo order & alt text",d.photoNotes,"photoNotes")}
        ${safeUrl(l.link)?`<div><a href="${esc(safeUrl(l.link))}" target="_blank" rel="noopener">Open the listing →</a></div>`:""}
      </div></details>`; }).join("")
    : `<div class="empty">No ${esc(bn)} listings yet. Drop photos and a one-line note above, like ${biz==="c3d"?'"same as the dragon fidget but a turtle, 4 colors"':'"palmetto crest tee, Comfort Colors, 4 colors"'}. Carla writes the whole listing.</div>`;
  return `<div class="grid"><div class="col">
    ${typeof storeCard==="function"?storeCard(biz):""}
    <section class="card" id="l-list"><div class="card-head"><h2 class="big">${esc(bn)} listings</h2><span class="eyebrow">tap one to copy fields · <button type="button" class="linkbtn" data-packall="${biz}">Export all packs (one zip, a folder per item)</button></span></div>${biz==="c3d"?`<p class="small" style="margin:0 0 8px;color:var(--warn)">Charleston 3D sells on Etsy only. Nothing 3D goes on the Elevated Designs Shopify store.</p>`:""}${list}</section>
    <section class="card" id="l-new"><div class="card-head"><h2>New ${esc(bn)} listing</h2><span class="eyebrow">Carla · Etsy & Shopify</span></div>
      <form class="drop" id="lstForm"><textarea id="lstNote" placeholder="What is it? Anything different from your last one? Size, colors, price idea. One line is enough."></textarea>
        <div class="actions"><label class="btn" for="lstPhotos" id="lstLbl">Add photos</label><input type="file" id="lstPhotos" accept="image/*" multiple hidden>
          <select id="lstChan" style="width:auto" aria-label="Where to list it"><option>Etsy</option><option>Shopify</option><option>Etsy + Shopify</option></select>
          <span class="small muted" id="lstNames"></span><span style="flex:1"></span>
          <button class="btn primary" type="submit">Send to Carla</button></div></form></section></div>
  <div class="col">${desk("listings")}<section class="card"><div class="card-head"><h2>Store numbers</h2><span class="eyebrow">Carla</span></div>${kpis("store")}</section>
    ${teamCards("store")}</div></div>`;
}

/* ---------- points & rewards ---------- */
function weekAgo(){ return Date.now()-7*864e5; }
function points(key){
  const t=weekAgo();
  const work=S.activity.filter(a=>a.agent===key && ["done","posted","idea"].includes(a.kind) && new Date(a.at).getTime()>t).length;
  const wk=S.kudos.filter(x=>x.to===key && new Date(x.at).getTime()>t); const val=x=>{ const n=+x.points; return n>0?Math.min(25,n):10; };
  return {work, kudos:wk.length, pts: work*5 + wk.reduce((s,x)=>s+val(x),0), allKudos:S.kudos.filter(x=>x.to===key).length};
}
function board(){ return TEAM.map(a=>({...a, ...points(a.key)})).sort((x,y)=>y.pts-x.pts); }


/* ---------- questions for Aaron ---------- */
function questionsCard(n){
  const open=S.questions.filter(q=>q.status!=="answered");
  if(!open.length) return n ? "" : `<div class="empty">No open questions. When the app team needs a decision or info from you, Stephanie puts it here.</div>`;
  const list=(n?open.slice(0,n):open).map(q=>{ const ag=TEAM_BY[q.from]||{name:q.from||"Stephanie"};
    return `<div class="row"><div class="stripe warn"></div><div class="body"><div class="t">${esc(q.text)}</div><div class="meta">${esc(ag.name)} · ${esc(q.about||"")} · ${ago(q.at)}</div>
      ${n?"":`<div class="drop" style="margin-top:8px"><textarea id="ans-${esc(q.id)}" style="min-height:60px" placeholder="Type or dictate your answer"></textarea><div class="actions"><span style="flex:1"></span><button class="btn primary" type="button" data-answer="${esc(q.id)}">Send answer</button></div></div>`}
    </div></div>`; }).join("");
  if(n) return `<section class="card"><div class="card-head"><h2>Questions for you</h2><button class="btn" data-goto="apps" type="button">Answer</button></div><div class="list">${list}</div></section>`;
  return `<div class="list">${list}</div>`;
}

/* ---------- Apps ---------- */
const STAGES=[["review","Waiting on your OK"],["idea","Idea"],["spec","Spec"],["building","Building"],["testing","Testing"],["launching","Launching"],["live","Live"],["paused","Paused"]];
function vApps(){
  const stc={review:"warn",idea:"warn",spec:"warn",building:"acc",testing:"acc",launching:"acc",live:"ok",paused:""};
  const byStage = STAGES.map(([k,label])=>{ const items=S.apps.filter(a=>appStage(a)===k); if(!items.length) return "";
    return `<div><div class="eyebrow" style="margin:12px 0 6px">${label} · ${items.length}</div><div class="list">${items.map(a=>{ const qc=a.qa||{}; const pu=safeUrl(a.prototypeUrl), lu=safeUrl(a.liveUrl);
      return `<div class="row clickable" data-appopen="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.name)}: open details"><div class="stripe ${stc[k]||""}"></div><div class="body"><div class="t">${esc(a.name)}</div>
        <div class="meta">${esc(TEAM_BY[a.owner]?TEAM_BY[a.owner].name:"Sam")} · updated ${ago(a.updatedAt||a.at)}${qc.verdict?` · QA ${esc(qc.verdict)}`:""}</div>
        ${a.pitch?`<div class="detail muted">${esc(a.pitch)}</div>`:""}
        ${a.next?`<div class="detail"><b>Next:</b> ${esc(a.next)}</div>`:""}
        ${a.money?`<div class="detail muted">💲 ${esc(a.money)}</div>`:""}
        <div class="links" style="margin-top:6px">${pu?`<a href="${esc(pu)}" target="_blank" rel="noopener">Try prototype</a>`:""}${lu?`<a href="${esc(lu)}" target="_blank" rel="noopener">Open live app</a>`:""}</div>
      </div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="pill ${stc[k]||""}">${esc(label)}</span><span class="small" style="color:var(--accent)">Details ›</span></div></div>`; }).join("")}</div></div>`; }).join("");
  return `<div id="a-ideas">${appIdeasCard()}</div><div class="grid" style="margin-top:20px"><div class="col">
    <section class="card"><div class="card-head"><h2>Start a new app</h2><span class="eyebrow">Sam's team takes it from here</span></div>
      <form class="drop" id="appForm"><input type="text" id="appName" placeholder="Name (or leave blank and Sam will name it)">
        <textarea id="appPitch" placeholder="What should it do, and who is it for? Talk it through like you would with a friend."></textarea>
        <div class="actions"><span class="small muted">Idea → spec → build → test → launch. Stephanie brings you anything the team needs.</span><span style="flex:1"></span><button class="btn primary" type="submit">Hand it to Sam</button></div></form></section>
    <section class="card"><div class="card-head"><h2>App pipeline</h2><span class="eyebrow">${S.apps.length} apps</span></div>${S.apps.length?byStage:`<div class="empty">Sam takes inventory of your existing apps (Video Studio, 3D Print Trends, Hype Chain Maker and the rest) on his first run, and new ones land here as you send them.</div>`}</section>
    <section class="card"><div class="card-head"><h2>Activity</h2></div>${feed(a=>["ray","zoe","sam","kim","leo"].includes(a.agent),20)}</section></div>
  <div class="col">${desk("apps")}${marketBlock("apps")}<section class="card"><div class="card-head"><h2>Questions for you</h2><span class="eyebrow">from Stephanie</span></div>${questionsCard(0)}</section>
    ${teamCards("apps")}</div></div>`;
}

/* ---------- App detail sheet: idea → spec → build → test → your OK → launch → market ---------- */
const APP_FLOW=[["spec","Spec"],["building","Build"],["testing","Test"],["review","Your OK"],["launching","Launch"],["live","Market"]];
function appStage(a){ const s=String((a&&a.stage)||"idea").toLowerCase().trim();
  if(/ready|review|approv|waiting/.test(s)) return "review"; if(s==="launching"||/^launch/.test(s)) return "launching";
  if(/build/.test(s)) return "building"; if(/test|qa/.test(s)) return "testing"; if(/live|market/.test(s)) return "live";
  if(/pause|park|hold/.test(s)) return "paused"; return ["idea","spec"].includes(s)?s:"idea"; }
const HIDE_KEYS=new Set(["id","name","stage","owner","at","updatedAt","pitch","next","money","prototypeUrl","liveUrl","iconUrl","iconId","ideaId","netlifySiteId","oldNetlify","updates","changes","decision","prevStage","log","source","version","description","monetization"]);
const nice=k=>String(k).replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]+/g," ").replace(/^./,c=>c.toUpperCase());
function showVal(v,depth=0){
  if(v==null||v==="") return "";
  if(typeof v==="string"||typeof v==="number"||typeof v==="boolean"){ const u=typeof v==="string"&&/^https?:\/\//.test(v)?safeUrl(v):null;
    return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(v)}</a>`:`<span>${esc(String(v))}</span>`; }
  if(Array.isArray(v)) return v.length?`<ul class="small" style="margin:4px 0;padding-left:18px">${v.map(x=>`<li>${showVal(x,depth+1)}</li>`).join("")}</ul>`:"";
  if(typeof v==="object"){ const ents=Object.entries(v).filter(([,x])=>x!=null&&x!==""); if(!ents.length) return "";
    return `<div class="kv">${ents.map(([k,x])=>`<div class="kv-row"><div class="kv-k">${esc(nice(k))}</div><div class="kv-v">${showVal(x,depth+1)}</div></div>`).join("")}</div>`; }
  return "";
}
function appSteps(st){ const order=APP_FLOW.map(x=>x[0]); const cur=st==="idea"?-1:order.indexOf(st);
  return `<ol class="steps" aria-label="Progress">${APP_FLOW.map(([k,l],i)=>`<li class="${i<cur?"done":i===cur?"cur":""}"><span>${i<cur?"✓":i+1}</span>${l}</li>`).join("")}</ol>`; }
function appSheetHtml(a){
  const st=appStage(a); const pu=safeUrl(a.prototypeUrl), lu=safeUrl(a.liveUrl); const ic=assetSrc(a.iconId,a.iconUrl);
  const ups=(a.updates||[]).slice().sort((x,y)=>String(y.at).localeCompare(String(x.at)));
  const chg=(a.changes||[]).slice().sort((x,y)=>String(y.at).localeCompare(String(x.at)));
  const feedItems=S.activity.filter(x=>a.name&&(String(x.title||"")+" "+String(x.detail||"")).toLowerCase().includes(String(a.name).toLowerCase())).slice(0,8);
  const extra=Object.entries(a).filter(([k,v])=>!HIDE_KEYS.has(k)&&v!=null&&v!=="");
  const draft=esc(S.appDraft||"");
  const act={
    idea:`<p class="small muted" style="margin:0 0 8px">Approving sends it to Sam: spec, build, then test. You'll be asked again before anything launches.</p><div class="sheet-acts"><button class="btn primary" type="button" data-appact="build">Approve: build and test it</button></div>`,
    spec:`<p class="small muted" style="margin:0 0 8px">Approving sends it to Sam: spec, build, then test. You'll be asked again before anything launches.</p><div class="sheet-acts"><button class="btn primary" type="button" data-appact="build">Approve: build and test it</button></div>`,
    building:`<p class="small" style="margin:0">Sam is building it. Testing comes next, then it comes back here for your OK.</p>`,
    testing:`<p class="small" style="margin:0">Sam is testing it. When it passes it comes back here for your OK to launch.</p>`,
    review:`<p class="small" style="margin:0 0 8px"><b>Your call:</b> try it${pu?" with the prototype link above":""}, then launch it or send it back with changes.</p><div class="sheet-acts"><button class="btn primary" type="button" data-appact="launch">Approve launch</button><button class="btn" type="button" data-appact="park">Don't launch (park it)</button></div>`,
    launching:`<p class="small" style="margin:0">Sam is launching it. Nora runs the market launch and posts a daily update below.</p>`,
    live:`<p class="small" style="margin:0 0 8px">It's live. Nora posts a daily update below on what's being done to get it in front of buyers.</p><div class="sheet-acts"><button class="btn" type="button" data-appact="pause">Pause it</button></div>`,
    paused:`<div class="sheet-acts"><button class="btn primary" type="button" data-appact="resume">Resume work on it</button></div>`
  }[st]||"";
  return `<div class="sheet-panel" role="document">
    <div class="sheet-head">${ic?`<img src="${esc(ic)}" alt="" class="sheet-ic">`:`<span class="avatar">${esc(String(a.name||"?")[0])}</span>`}
      <div style="flex:1;min-width:0"><h2 id="sheetTitle" style="margin:0">${esc(a.name||"App")}</h2><div class="meta">${esc(TEAM_BY[a.owner]?TEAM_BY[a.owner].name:"Sam")} · updated ${ago(a.updatedAt||a.at)}</div></div>
      <button class="btn" type="button" data-sheetclose aria-label="Close">Close</button></div>
    ${st==="paused"?`<p class="pill">Paused</p>`:appSteps(st)}
    ${a.pitch?`<p style="font-size:18px;margin:12px 0 6px">${esc(a.pitch)}</p>`:""}
    ${a.description&&a.description!==a.pitch?`<p class="small">${esc(a.description)}</p>`:""}
    <div class="kv">${a.next?`<div class="kv-row"><div class="kv-k">Next step</div><div class="kv-v">${esc(a.next)}</div></div>`:""}${a.money||a.monetization?`<div class="kv-row"><div class="kv-k">How it makes money</div><div class="kv-v">${esc(a.money||a.monetization)}</div></div>`:""}</div>
    ${pu||lu?`<div class="links" style="margin:10px 0">${pu?`<a href="${esc(pu)}" target="_blank" rel="noopener">Try the prototype</a>`:""}${lu?`<a href="${esc(lu)}" target="_blank" rel="noopener">Open the live app</a>`:""}</div>`:""}
    <section class="sheet-sec sheet-act"><h3>What happens next</h3>${act}
      <label class="small muted" for="appChg" style="display:block;margin-top:12px">Want something changed? Tell the team here.</label>
      <textarea id="appChg" rows="3" placeholder="e.g. Make the free tier 3 proofs, add a dark-mode preview…">${draft}</textarea>
      <div class="sheet-acts"><button class="btn" type="button" data-appact="changes">Send changes to the team</button></div></section>
    ${extra.map(([k,v])=>`<section class="sheet-sec"><h3>${esc(nice(k))}</h3>${showVal(v)}</section>`).join("")}
    <section class="sheet-sec"><h3>Daily launch updates</h3>${ups.length?`<div class="list">${ups.map(u=>`<div class="row"><div class="body"><div class="meta">${esc(TEAM_BY[u.by]?TEAM_BY[u.by].name:u.by||"")} · ${ago(u.at)}</div><div class="detail">${showVal(u.text||u.note||u)}</div></div></div>`).join("")}</div>`:`<p class="small muted" style="margin:0">Once you approve the launch, Nora posts an update here every day: what to expect, what's being done, and the numbers.</p>`}</section>
    ${chg.length?`<section class="sheet-sec"><h3>Changes you asked for</h3><div class="list">${chg.map(c=>`<div class="row"><div class="body"><div class="meta">${esc(c.by||"")} · ${ago(c.at)}${c.done?" · done":""}</div><div class="detail">${esc(c.text||"")}</div></div></div>`).join("")}</div></section>`:""}
    ${feedItems.length?`<section class="sheet-sec"><h3>Team activity on this app</h3><div class="list">${feedItems.map(x=>`<div class="row"><div class="body"><div class="t">${esc(x.title||"")}</div><div class="meta">${esc(TEAM_BY[x.agent]?TEAM_BY[x.agent].name:x.agent||"")} · ${ago(x.at)}</div></div></div>`).join("")}</div></section>`:""}
  </div>`;
}
function ideaSheetHtml(x){ const ic=assetSrc(x.iconId,x.iconUrl); const app=S.apps.find(a=>a.id===x.appId||a.ideaId===x.id); const open=!app&&["top","shortlisted","new","passed"].includes(x.status||"new");
  const extra=Object.entries(x).filter(([k,v])=>!["id","name","oneLiner","description","iconId","iconUrl","status","at","round","by","appId","decidedBy","decidedAt"].includes(k)&&v!=null&&v!=="");
  return `<div class="sheet-panel" role="document">
    <div class="sheet-head">${ic?`<img src="${esc(ic)}" alt="" class="sheet-ic">`:`<span class="avatar">${esc(String(x.name||"?")[0])}</span>`}
      <div style="flex:1;min-width:0"><h2 id="sheetTitle" style="margin:0">${esc(x.name||"App idea")}</h2><div class="meta">App idea · ${esc(TEAM_BY[x.by]?TEAM_BY[x.by].name:x.by||"")} · ${esc(x.status||"new")}</div></div>
      <button class="btn" type="button" data-sheetclose aria-label="Close">Close</button></div>
    ${x.oneLiner?`<p style="font-size:18px;margin:12px 0 6px">${esc(x.oneLiner)}</p>`:""}${x.description?`<p class="small">${esc(x.description)}</p>`:""}
    <section class="sheet-sec sheet-act"><h3>What happens next</h3>${open?`<p class="small muted" style="margin:0 0 8px">Approving sends it to Sam to spec, build and test. It comes back to you before it launches.</p><div class="sheet-acts"><button class="btn primary" type="button" data-iapprove="${esc(x.id)}">Approve: build and test it</button>${x.status==="passed"?"":`<button class="btn" type="button" data-ipass="${esc(x.id)}">Pass</button>`}</div>`:app?`<p class="small" style="margin:0 0 8px">Approved. ${esc(app.name)} is at: <b>${esc((STAGES.find(z=>z[0]===appStage(app))||["",""])[1])}</b>.</p><div class="sheet-acts"><button class="btn primary" type="button" data-appopen="${esc(app.id)}">Open the app's progress</button></div>`:`<p class="small" style="margin:0">${esc(x.status||"")}</p>`}</section>
    ${extra.map(([k,v])=>`<section class="sheet-sec"><h3>${esc(nice(k))}</h3>${showVal(v)}</section>`).join("")}
  </div>`; }
let SHEET=null;
function openSheet(kind,id){ SHEET={kind,id,ret:document.activeElement}; S.appDraft=""; paintSheet(true); }
function closeSheet(){ const b=$("#sheet"); if(b) b.remove(); const r=SHEET&&SHEET.ret; SHEET=null; ["#main",".dock","header.top"].forEach(s=>{ const e=document.querySelector(s); if(e) e.removeAttribute("inert"); }); if(r&&r.focus&&document.contains(r)) r.focus(); }
function paintSheet(first){ if(!SHEET) return; const item=SHEET.kind==="app"?S.apps.find(a=>a.id===SHEET.id):S.appideas.find(a=>a.id===SHEET.id);
  if(!item){ if(first) toast("That item isn't loaded yet."); closeSheet(); return; }
  let box=$("#sheet"); const ta=$("#appChg"); if(ta) S.appDraft=ta.value; const sc=box?box.scrollTop:0;
  if(!box){ box=document.createElement("div"); box.id="sheet"; box.className="sheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-labelledby","sheetTitle"); document.body.appendChild(box);
    box.addEventListener("click",e=>{ if(e.target===box) closeSheet(); });
    ["#main",".dock","header.top"].forEach(s=>{ const e=document.querySelector(s); if(e) e.setAttribute("inert",""); }); }
  const focusedId=document.activeElement&&box.contains(document.activeElement)?document.activeElement.id:null;
  box.innerHTML=SHEET.kind==="app"?appSheetHtml(item):ideaSheetHtml(item); box.scrollTop=sc;
  if(first){ const c=box.querySelector("[data-sheetclose]"); if(c) c.focus(); } else if(focusedId){ const f=document.getElementById(focusedId); if(f){ f.focus(); if(f.setSelectionRange) f.setSelectionRange(f.value.length,f.value.length); } }
}
async function appAction(act){
  if(!SHEET||SHEET.kind!=="app") return; const a=S.apps.find(x=>x.id===SHEET.id); if(!a) return; if(!db){ toast("Can't save in this view."); return; }
  const lockK="app:"+a.id+":"+act; if(INFLIGHT.has(lockK)) return; INFLIGHT.add(lockK); setTimeout(()=>INFLIGHT.delete(lockK),8000);
  const now=new Date().toISOString(), who=me(), whoKey=who.toLowerCase(); const st=appStage(a); const text=($("#appChg")&&$("#appChg").value.trim())||"";
  const dec={...(a.decision||{})}; let upd={updatedAt:now}; let req=null, wake=[];
  if(act==="build"){ upd={...upd,stage:"building",next:"Approved by "+who+". Sam finishes the spec, builds and tests it, then it comes back for your launch OK.",decision:{...dec,build:{by:whoKey,at:now}}};
    req=`BUILD NOW: ${who} approved "${a.name}" (apps/${a.id}). Finish/confirm the spec, Sam builds and tests it today. Set stage "building" → "testing" → "review" when it passes the test checklist; put the prototype link in prototypeUrl.`; wake=["ray","sam"]; }
  else if(act==="changes"){ if(!text){ toast("Type the changes first."); const t=$("#appChg"); if(t) t.focus(); return; }
    upd={...upd,changes:[...(a.changes||[]),{text:text.slice(0,2000),by:whoKey,at:now,done:false}],next:"Changes requested by "+who+": "+text.slice(0,140),...(["review","launching","live"].includes(st)?{stage:st==="review"?"building":a.stage}:{})};
    req=`CHANGES for "${a.name}" (apps/${a.id}) from ${who}: ${text.slice(0,1500)}. Make them, retest, mark the change done:true in apps/${a.id}.changes, then set stage "review" so ${who} can approve.`; wake=["ray"]; }
  else if(act==="launch"){ upd={...upd,stage:"launching",next:"Launch approved by "+who+". Sam launches it; Nora runs the market launch with daily updates.",decision:{...dec,launch:{ok:true,by:whoKey,at:now}}};
    req=`LAUNCH APPROVED: ${who} approved launching "${a.name}" (apps/${a.id}). Sam: deploy it, put the URL in liveUrl, set stage "live". Nora: take over monetization — write apps/${a.id}.launchPlan (what to expect, timeline, pricing, channels, first-30-day targets, what Aaron must do) and append a daily entry to apps/${a.id}.updates [{at,by:"nora",text}] every run.`; wake=["leo","nora"]; }
  else if(act==="park"){ upd={...upd,stage:"paused",prevStage:a.stage,next:"Parked by "+who+" — not launching for now.",decision:{...dec,launch:{ok:false,by:whoKey,at:now}}}; req=`PARKED: ${who} chose not to launch "${a.name}" (apps/${a.id}) for now. No more work unless resumed.`; wake=[]; }
  else if(act==="pause"){ upd={...upd,stage:"paused",prevStage:a.stage,next:"Paused by "+who+"."}; req=`PAUSED: ${who} paused "${a.name}" (apps/${a.id}). Stop marketing work until resumed.`; }
  else if(act==="resume"){ const back=a.prevStage&&appStage({stage:a.prevStage})!=="paused"?a.prevStage:"spec"; upd={...upd,stage:back,next:"Resumed by "+who+"."}; req=`RESUMED: ${who} resumed "${a.name}" (apps/${a.id}) at stage "${back}". Pick it up this run.`; wake=["ray"]; }
  else return;
  try{
    await db.doc("apps/"+a.id).update(upd);
    if(req){ const owner=act==="launch"?"leo":"ray"; await addReq({for:owner, by:whoKey, what:req, app:a.id, status:"open", at:now});
      if(act==="launch") await addReq({for:"nora", by:whoKey, what:req, app:a.id, status:"open", at:now}); }
    let woke=0; for(const k of [...new Set(wake.map(live))]){ const tid=tidOf(k); if(tid&&await fire(tid,req)) woke++; }
    if(act==="changes"){ S.appDraft=""; const t=$("#appChg"); if(t) t.value=""; }
    toast({build:"Approved. The team is building it",changes:"Changes sent to the team",launch:"Launch approved. Sam and Nora are on it",park:"Parked. It won't launch",pause:"Paused",resume:"Resumed"}[act]+(wake.length?(woke?" now.":" on their next run."):"."));
  }catch(e){ toast("Couldn't save that. Try again."); }
}
document.addEventListener("click",e=>{ const el=e.target; if(!el.closest) return;
  if(el.closest("a")) return;
  if(el.closest("[data-sheetclose]")){ closeSheet(); return; }
  const ac=el.closest("[data-appact]"); if(ac){ appAction(ac.dataset.appact); return; }
  const inSheet=el.closest("#sheet");
  if(inSheet){ const ap=el.closest("[data-iapprove]"), ps=el.closest("[data-ipass]");
    if(ap){ decideIdea(ap.dataset.iapprove,true).then(()=>paintSheet()); return; } if(ps){ decideIdea(ps.dataset.ipass,false).then(()=>closeSheet()); return; } }
  const op=el.closest("[data-appopen],[data-ideaopen]"); if(!op) return;
  const ctl=el.closest("button,input,textarea,select,summary,label"); if(ctl&&ctl!==op&&op.contains(ctl)) return;
  if(SHEET) closeSheet();
  if(op.dataset.appopen) openSheet("app",op.dataset.appopen); else openSheet("idea",op.dataset.ideaopen); });
document.addEventListener("keydown",e=>{ if(!SHEET) return; const t=e.target;
  if(e.key==="Escape"){ e.preventDefault(); closeSheet(); return; }
  if((e.key==="Enter"||e.key===" ")&&t.matches&&t.matches("[data-appopen],[data-ideaopen]")&&t.tagName!=="BUTTON"){ e.preventDefault(); t.click(); } });
document.addEventListener("keydown",e=>{ if(SHEET) return; const t=e.target; if((e.key==="Enter"||e.key===" ")&&t.matches&&t.matches("[data-appopen],[data-ideaopen]")&&t.tagName!=="BUTTON"){ e.preventDefault(); t.click(); } });

/* ---------- Charleston 3D (everything 3D printing) ---------- */
const IS3D=s=>/\b3d\b|3-d|3d[- ]print|nameplate|name plate|hype chain|pendant|c3dp|charleston ?3d|charelston ?3d|print trends|filament|bambu|\bpla\b/i.test(String(s||""));
const txt3=o=>{ try{ return JSON.stringify(o); }catch{ return ""; } };
/* Andy's 3D print ideas: spikes and new products, each with a legal path; Aaron approves before anything is listed. */
function printIdeasCard(){
  const rank={shortlisted:0,new:1,approved:2,listed:3,passed:4}; const all=S.printideas.slice().sort((a,b)=>(rank[a.status]??5)-(rank[b.status]??5)||String(b.at).localeCompare(String(a.at)));
  const open=all.filter(x=>["new","shortlisted"].includes(x.status||"new")); const done=all.filter(x=>!["new","shortlisted"].includes(x.status||"new")).slice(0,6);
  const money=n=>n==null||n===""?"—":"$"+(+n).toFixed(2).replace(/\.00$/,"");
  const pathLbl={licensed:"Licensed file",["re-engineered"]:"Re-engineered original",original:"Original design"};
  const legalPill=l=>l==="ok"?`<span class="pill ok">legal OK</span>`:l==="legal check"?`<span class="pill bad">legal check</span>`:`<span class="pill warn">legal pending</span>`;
  const card=(x,acts)=>{ const img=assetSrc(x.previewId,x.previewUrl); const sig=x.signal||{}; const su=safeUrl(sig.url||sig.source); const pr=x.price||{};
    const files=(x.files||[]).map(f=>{ const u=safeUrl(f.driveUrl||f.url); return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(f.name||f.kind||"file")}</a>`:""; }).filter(Boolean);
    return `<div class="dcard">${img?`<img src="${esc(img)}" alt="${esc(x.title||"3D print idea")}" loading="lazy">`:`<div class="noimg">${x.kind==="spike"?"spike · file coming":"no preview yet"}</div>`}
      <div class="dt"><b>${esc(x.title||"3D idea")}</b>
      <div class="links" style="gap:4px">${x.kind==="spike"?`<span class="pill acc">sales spike</span>`:`<span class="pill">new idea</span>`}${legalPill(x.legal)}</div>
      ${x.concept?`<div class="small">${esc(String(x.concept).slice(0,160))}</div>`:""}
      <div class="meta">${esc(pathLbl[x.path]||x.path||"path not set")} · sell ${money(pr.suggested)}${x.unitCost!=null?` · costs ${money(x.unitCost)}`:""}</div>
      ${sig.metric||sig.what?`<div class="meta">${su?`<a href="${esc(su)}" target="_blank" rel="noopener">${esc(String(sig.metric||sig.what).slice(0,110))}</a>`:esc(String(sig.metric||sig.what).slice(0,110))}</div>`:""}
      ${files.length?`<div class="meta">Files: ${files.join(" · ")}</div>`:""}
      <div class="meta">${typeof packBtn==="function"?packBtn("print",x.id,"Export pack"):""}</div>
      ${x.legalNote?`<details class="small"><summary class="muted" style="cursor:pointer">Legal note</summary>${esc(String(x.legalNote).slice(0,500))}</details>`:""}
      ${acts||""}</div></div>`; };
  return `<section class="card" id="c3d-ideas" style="border-color:color-mix(in srgb,var(--c-c3d) 40%,var(--line))"><div class="card-head"><h2 class="big">New 3D print ideas</h2><span class="eyebrow">Andy · spikes &amp; new products · ${open.length} to decide</span></div>
    ${open.length?`<div class="dgrid">${open.map(x=>card(x,`<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn primary" type="button" data-piok="${esc(x.id)}" ${x.legal==="ok"?"":'title="Helen hasn\'t cleared this yet"'}>Approve</button><button class="btn" type="button" data-pino="${esc(x.id)}">Pass</button></div>${x.legal==="ok"?"":`<div class="meta">Wait for Helen's legal OK before listing.</div>`}`)).join("")}</div>`
      :`<div class="empty">Andy checks for sales spikes at 9:25 AM and 4:25 PM and brings 3–5 new print ideas each morning. Each one comes with a file that's licensed for sale or his own re-engineered design, plus Helen's legal check.</div>`}
    ${done.length?`<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Decided (${done.length})</summary><div class="dgrid" style="margin-top:8px">${done.map(x=>card(x,`<div class="meta">${esc(x.status)}</div>`)).join("")}</div></details>`:""}</section>`;
}
async function decidePrintIdea(id, ok){
  if(!db) return; const x=S.printideas.find(i=>i.id===id); if(!x) return; const k="pi:"+id; if(INFLIGHT.has(k)) return; INFLIGHT.add(k); setTimeout(()=>INFLIGHT.delete(k),8000);
  if(ok&&x.legal!=="ok"&&!confirmLegal(x)) { INFLIGHT.delete(k); return; }
  const now=new Date().toISOString(), who=me(), whoKey=who.toLowerCase();
  try{ await db.doc("printideas/"+id).update({status:ok?"approved":"passed", decidedBy:whoKey, decidedAt:now});
    if(ok){ const what=`${who} APPROVED 3D product "${x.title}" (printideas/${id}). Andy: add it to the product line and c3d catalog (Sam for catalog.json). Carla: draft the listing + Shopify draft product. Helen: add unit cost to pricing/fees.${x.legal==="ok"?"":" NOTE: Helen hasn't cleared it yet — don't list until legal is \"ok\"."}`;
      for(const f of ["andy","carla","cole"]) await addReq({for:f, by:whoKey, what, printidea:id, status:"open", at:now});
      const tid=tidOf("andy"); if(tid) fire(tid,what); toast("Approved. Andy and Carla will set it up."); }
    else toast("Passed. Andy will learn from it.");
  }catch(err){ console.error("print idea",err); toast("Couldn't save. Try again."); INFLIGHT.delete(k); }
}
function confirmLegal(x){ const b=document.querySelector(`[data-piok="${CSS.escape(x.id)}"]`); if(b&&b.dataset.armed==="1") return true; if(b){ b.dataset.armed="1"; b.textContent="Approve anyway?"; setTimeout(()=>{ if(b.isConnected){ b.dataset.armed=""; b.textContent="Approve"; } },5000); } toast("Helen hasn't cleared this one yet. Tap again to approve anyway; it won't be listed until she does."); return false; }

/* ---------- Growth: market research (Nora), SEO (Sage), ads & short videos (Tina), and the SEO tool ---------- */
function scoreColor(n){ return n==null?"var(--muted)":n>=80?"var(--ok)":n>=50?"var(--warn)":"var(--bad)"; }
function ring(n,size){ size=size||56; const r=size/2-5, c=2*Math.PI*r, v=Math.max(0,Math.min(100,+n||0));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Score ${n==null?"not checked":v+" of 100"}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>${n==null?"":`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${scoreColor(v)}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(v/100*c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/>`}<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="${size/3.6}" font-weight="800" fill="var(--fg)">${n==null?"—":v}</text></svg>`; }
function seoTrendChart(){
  const pts=S.seotrack.filter(x=>x.avgScore!=null).sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-28);
  if(pts.length<2) return `<div class="empty">The morning (7:05) and night (9:05) checks will chart here once there are two of them.</div>`;
  const W=640,H=180,pl=34,pr=10,pt=10,pb=24, x=i=>pl+i*(W-pl-pr)/(pts.length-1), y=v=>pt+(100-v)*(H-pt-pb)/100;
  const d=pts.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.avgScore).toFixed(1)}`).join("");
  const grid=[0,50,100].map(v=>`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-soft)"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`).join("");
  const lab=[0,pts.length-1].map(i=>`<text x="${x(i)}" y="${H-6}" text-anchor="${i?"end":"start"}" font-size="11" fill="var(--muted)">${esc(String(pts[i].date||"").slice(5))} ${esc(pts[i].slot||"")}</text>`).join("");
  const dots=pts.map((p,i)=>`<g><circle cx="${x(i)}" cy="${y(p.avgScore)}" r="10" fill="transparent" data-tip="${esc(String(p.date||""))} ${p.slot==="pm"?"night":"morning"} · ${p.avgScore}/100${p.summary?" · "+esc(String(p.summary).slice(0,90)):""}"/><circle cx="${x(i)}" cy="${y(p.avgScore)}" r="4" fill="var(--chart)" stroke="var(--surface)" stroke-width="2" pointer-events="none"/></g>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:220px" role="img" aria-label="Average SEO score over the last ${pts.length} checks">${grid}<path d="${d}" fill="none" stroke="var(--chart)" stroke-width="2"/>${dots}${lab}</svg>`;
}
function marketFull(only3d){
  const m=S.market; if(!m) return `<div class="empty">Nora writes the full market report every morning after 5 AM: what's selling in tees, 3D prints, YouTube and apps, with sources and the moves to make.</div>`;
  const list=(arr,kind)=>`<div class="list">${(arr||[]).map(x=>{ const u=safeUrl(x.url); return `<div class="row"><div class="body"><div class="t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(x.item||x.what||x.category||"")}</a>`:esc(x.item||x.what||x.category||"")} ${trendChip(x.trend)}</div>
      ${x.metric?`<div class="meta">${esc(x.metric)}${x.price?` · ${esc(String(x.price))}`:""}${x.forChannel?` · ${esc(x.forChannel)}`:""}</div>`:""}${x.evidence?`<div class="detail small muted">${esc(String(x.evidence).slice(0,220))}</div>`:""}${kind?`<div class="need-act" style="margin-top:6px">${buildBtn(kind,x.item||x.what||x.category||"")}</div>`:""}</div></div>`; }).join("")||`<div class="small muted">Nothing yet.</div>`}</div>`;
  const blk=(title,c,o,arrKey)=>`<div class="mblk" style="--tag:var(--c-${c})"><h3 class="sub" style="color:var(--tag)">${title}</h3>${o&&o.summary?`<p class="small" style="margin:0 0 6px">${esc(o.summary)}</p>`:""}${list(o&&o[arrKey],c)}${o&&o.prices?`<div class="meta">Prices: ${esc(String(o.prices.low??"—"))}–${esc(String(o.prices.high??"—"))} (typical ${esc(String(o.prices.typical??"—"))})</div>`:""}${o&&(o.themes||o.tips)?`<div class="links" style="margin-top:6px">${(o.themes||o.tips||[]).slice(0,8).map(t=>`<span class="pill">${esc(String(t).slice(0,60))}</span>`).join("")}</div>`:""}</div>`;
  if(only3d) return `${blk("What's selling in 3D prints","c3d",m.prints3d,"selling")}<div class="meta" style="margin-top:6px">Nora · updated ${ago(m.at)}</div>`;
  return `${m.headline?`<p style="font-weight:700;margin:0 0 4px">${esc(m.headline)}</p>`:""}${m.summary?`<p class="small muted" style="margin:0 0 12px">${esc(m.summary)}</p>`:""}
    ${(m.whatToDo||[]).length?`<div class="mtodo" style="margin-bottom:14px"><div class="eyebrow">Moves to make · ranked by money for the least cost</div><ol style="margin:6px 0 0;padding-left:20px">${m.whatToDo.map(t=>`<li class="small" style="margin-bottom:4px"><b>${esc(t.action||"")}</b> <span class="muted">· ${esc(TEAM_BY[t.owner]?TEAM_BY[t.owner].name:t.owner||"")}${t.expected?` · ${esc(t.expected)}`:""}</span>${t.why?`<div class="muted">${esc(String(t.why).slice(0,200))}</div>`:""}<div class="need-act" style="margin-top:4px">${buildBtn("move",t.action||"",t.owner)}</div></li>`).join("")}</ol></div>`:""}
    <div class="mgrid">${blk("T-shirts & apparel","ed",m.tees,"selling")}</div>
    ${(m.sources||[]).length?`<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Sources (${m.sources.length})</summary><ul class="small">${m.sources.map(x=>{ const u=safeUrl(x.u); return `<li>${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(x.t||u)}</a>`:esc(x.t||"")}</li>`; }).join("")}</ul></details>`:""}
    <div class="meta" style="margin-top:6px">Updated ${ago(m.at)}</div>`;
}
function marketBlock(which){ const m=S.market; if(!m) return ""; const o=which==="youtube"?m.youtube:m.apps; if(!o) return "";
  const list=(o.working||o.rising||o.selling||[]).slice(0,5); const col=which==="youtube"?"studio":"apps";
  return `<section class="card"><div class="card-head"><h2>${which==="youtube"?"What's working on YouTube":"What's rising in apps"}</h2><span class="eyebrow">Nora · ${ago(m.at)}</span></div>${o.summary?`<p class="small" style="margin:0 0 8px">${esc(o.summary)}</p>`:""}
    <div class="list">${list.map(x=>{ const u=safeUrl(x.url); return `<div class="row"><div class="stripe" style="background:var(--c-${col})"></div><div class="body"><div class="t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(x.item||x.what||"")}</a>`:esc(x.item||x.what||"")} ${trendChip(x.trend)}</div>${x.metric?`<div class="meta">${esc(x.metric)}</div>`:""}</div></div>`; }).join("")||`<div class="small muted">Nothing yet.</div>`}</div></section>`; }
function seoCards(biz){
  const props=S.seoProps.length?S.seoProps:[]; const byId=Object.fromEntries(S.seoaudit.map(a=>[a.id,a]));
  const rows=(props.length?props:S.seoaudit.map(a=>({id:a.id,name:a.name||a.id,url:a.url}))).filter(p=>!biz||bizOf({...p,business:p.business||p.biz})===biz).map(p=>({p,a:byId[p.id]})).sort((x,y)=>((x.a&&x.a.score)??-1)-((y.a&&y.a.score)??-1));
  if(!rows.length) return `<div class="empty">Sage's first full check runs at 7:05 AM.</div>`;
  return `<div class="seogrid">${rows.map(({p,a})=>{ const u=safeUrl(p.url||(a&&a.url)); const psi=a&&a.psi||{}; const own=TEAM_BY[p.owner]?TEAM_BY[p.owner].name:"";
    return `<div class="seocard">${ring(a?a.score:null)}<div style="min-width:0;flex:1"><div class="t" style="font-weight:700">${esc(p.name||p.id)}</div>
      <div class="meta">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//,"").slice(0,40))}</a>`:"no link yet"}${own?` · ${esc(own)}`:""}</div>
      ${a?`<div class="meta">${psi.mobile!=null?`PageSpeed ${esc(String(psi.mobile))} mobile`:"PageSpeed —"}${psi.lcp!=null?` · LCP ${esc(String(psi.lcp))}`:""} · checked ${ago(a.checkedAt)}</div>
      ${(a.top3||[]).length?`<ul class="small" style="margin:4px 0 0;padding-left:18px">${a.top3.slice(0,3).map(f=>`<li>${esc(String(f.what||f).slice(0,120))}</li>`).join("")}</ul>`:""}`:`<div class="meta">Not checked yet</div>`}</div></div>`; }).join("")}</div>`;
}
function keywordTable(){
  const k=S.seoKeywords.slice(0,40); if(!k.length) return `<div class="empty">Target keywords and their Google positions show here after Sage's first check.</div>`;
  return `<div class="tablewrap"><table class="ptable"><thead><tr><th>Keyword</th><th>Property</th><th class="num">Position</th><th class="num">Change</th></tr></thead><tbody>${k.map(r=>{ const d=(r.prevPosition&&r.position)?r.prevPosition-r.position:null;
    return `<tr><td>${esc(r.keyword||"")}</td><td>${esc(r.property||"")}</td><td class="num">${r.position==null?"—":esc(String(r.position))}</td><td class="num" style="color:${d>0?"var(--ok)":d<0?"var(--bad)":"var(--muted)"}">${d==null?"":(d>0?"▲ "+d:d<0?"▼ "+(-d):"–")}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function adsGallery(biz){
  const today=dayKey(new Date()); const list=S.ads.filter(a=>!biz||bizOf(a)===biz).slice(0,24);
  if(!list.length) return `<div class="empty">Tina builds a new ad for every brand and app every day at 11:15 AM. Nothing is ever paid for without your OK.</div>`;
  return `<div class="fgrid adgrid">${list.map(a=>{ const img=assetSrc(a.imageId,a.imageUrl); const lu=safeUrl(a.linkUrl); const b=a.business||"ed";
    return `<div class="adcard" style="--tag:var(--c-${b==="apps"?"apps":b})">${img?`<img src="${esc(img)}" alt="${esc(a.headline||"Ad")}" loading="lazy">`:`<div class="noimg">Ad</div>`}<div class="pc-b"><span class="tagchip">${esc(a.property||"")}</span><b>${esc(String(a.headline||"").slice(0,60))}</b>
      ${a.primaryText?`<span class="small">${esc(String(a.primaryText).slice(0,125))}</span>`:""}<span class="meta">${(a.round||dayKey(a.at||0))===today?"today":ago(a.at)} · ${esc(a.status||"draft")}${a.suggestedBudget?` · test ${esc(String(a.suggestedBudget))}`:""}</span>
      ${lu?`<a class="small" href="${esc(lu)}" target="_blank" rel="noopener">Tracked link ↗</a>`:""}
      ${a.status==="draft"?`<div class="pc-a"><button class="btn primary" type="button" data-adok="${esc(a.id)}">Approve</button><button class="btn" type="button" data-adno="${esc(a.id)}">Pass</button></div>`:""}</div></div>`; }).join("")}</div>`;
}
function videoGallery(biz){
  const list=S.videos.filter(v=>!biz||bizOf(v)===biz).slice(0,12);
  if(!list.length) return `<div class="empty">Tina makes a short video for every brand and app on Mondays, Wednesdays and Fridays at 3:15 PM.</div>`;
  return `<div class="fgrid vidgrid">${list.map(v=>{ const src=assetSrc(v.videoId,v.videoUrl); const th=assetSrc(v.thumbId,v.thumbUrl); const lu=safeUrl(v.linkUrl);
    return `<div class="adcard" style="--tag:var(--c-studio)">${src?`<video src="${esc(src)}" ${th?`poster="${esc(th)}"`:""} controls preload="none" playsinline></video>`:`<div class="noimg">Video</div>`}<div class="pc-b"><span class="tagchip">${esc(v.property||"")}</span><b>${esc(String(v.title||v.hook||"").slice(0,60))}</b><span class="meta">${v.durationSec?esc(String(v.durationSec))+"s · ":""}${ago(v.at)} · ${esc(v.status||"draft")}</span>${lu?`<a class="small" href="${esc(lu)}" target="_blank" rel="noopener">Tracked link ↗</a>`:""}</div></div>`; }).join("")}</div>`;
}
function playbookView(){
  const pb=S.playbook; if(!pb) return `<div class="empty">The SEO playbook loads here.</div>`;
  return `<p class="small muted" style="margin:0 0 8px">${esc(pb.summary||"")} <span class="muted">· version ${esc(pb.version||"")}</span></p>${(pb.sections||[]).map(sec=>`<details class="pbsec"><summary><b>${esc(sec.title)}</b> <span class="muted small">· ${sec.items.length} rules</span></summary><ul class="small">${sec.items.map(it=>`<li><b>${esc(it.rule)}</b><div class="muted">${esc(it.how)}</div></li>`).join("")}</ul></details>`).join("")}
    ${(pb.sources||[]).length?`<div class="meta" style="margin-top:6px">Sources: ${pb.sources.map(x=>{ const u=safeUrl(x.u); return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(x.t)}</a>`:esc(x.t); }).join(" · ")}</div>`:""}`;
}
/* The SEO tool: offline checks that run in the page (no data leaves it) + a "send to Sage" handoff. */
const SEO_TOOLS=[["page","Page checker"],["snippet","Search snippet"],["schema","Schema maker"],["video","YouTube & social"],["utm","Tracked link"]];
function seoTool(){
  const t=S.seoTool||"page"; const tabs=`<div class="chips" role="tablist" style="margin-bottom:12px">${SEO_TOOLS.map(([k,l])=>`<button type="button" class="chip" role="tab" aria-pressed="${t===k}" data-seotool="${k}">${l}</button>`).join("")}</div>`;
  const body={
    page:`<p class="small muted" style="margin:0 0 8px">Paste a page's HTML (right-click → View page source → copy all). It's checked right here against the playbook.</p>
      <textarea id="stHtml" rows="6" placeholder="<!doctype html>..."></textarea><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn primary" type="button" id="stCheck">Check page</button><input type="text" id="stUrl" placeholder="…or a URL for Sage to check" style="flex:1;min-width:180px"><button class="btn" type="button" id="stSage">Send to Sage</button></div><div id="stOut" style="margin-top:10px"></div>`,
    snippet:`<div class="calc"><label>Page title<input type="text" id="snT" maxlength="120" placeholder="Custom 3D Printed Nameplates | Charleston 3D Prints"></label><label>Meta description<input type="text" id="snD" maxlength="300" placeholder="Personalized desk and door nameplates printed in Charleston, SC…"></label><label>URL<input type="text" id="snU" placeholder="https://charleston3d.com/custom-nameplates"></label><label>Main keyword<input type="text" id="snK" placeholder="custom nameplate"></label></div><div id="snOut" style="margin-top:12px"></div>`,
    schema:`<div class="calc"><label>Type<select id="scT"><option>LocalBusiness</option><option>Organization</option><option>Product</option><option>SoftwareApplication</option><option>FAQPage</option><option>VideoObject</option></select></label><label>Name<input type="text" id="scN" placeholder="Charleston 3D Prints"></label><label>URL<input type="text" id="scU" placeholder="https://charleston3d.com"></label><label>Image URL<input type="text" id="scI"></label><label>Description<input type="text" id="scD"></label><label>Price (Product/App)<input type="text" id="scP" placeholder="25.00"></label><label>City / area<input type="text" id="scC" placeholder="Charleston, SC"></label><label>Profiles (comma-separated links)<input type="text" id="scS" placeholder="https://facebook.com/…, https://www.etsy.com/shop/…"></label><label>FAQ (Q? A | Q? A)<input type="text" id="scF" placeholder="How long does it take? 3–5 days | Can I pick colors? Yes"></label></div><button class="btn primary" type="button" id="scGo" style="margin-top:8px">Make schema</button><div id="scOut" style="margin-top:10px"></div>`,
    video:`<div class="calc"><label>Title<input type="text" id="ytT" placeholder="Charleston Police Release Bodycam of …"></label><label>Main keyword<input type="text" id="ytK" placeholder="bodycam"></label><label>Platform<select id="ytP"><option value="yt">YouTube video</option><option value="short">YouTube Short</option><option value="tiktok">TikTok / Reels</option><option value="etsy">Etsy listing</option></select></label></div><label class="small" style="display:block;margin-top:8px">Description / caption<textarea id="ytD" rows="4"></textarea></label><label class="small" style="display:block">Tags (comma-separated)<input type="text" id="ytG"></label><button class="btn primary" type="button" id="ytGo" style="margin-top:8px">Check</button><div id="ytOut" style="margin-top:10px"></div>`,
    utm:`<div class="calc"><label>Destination URL<input type="text" id="utU" placeholder="https://charleston3d.com"></label><label>Source<select id="utS"><option>facebook</option><option>instagram</option><option>tiktok</option><option>youtube</option><option>pinterest</option><option>google</option><option>etsy</option></select></label><label>Medium<select id="utM"><option>social</option><option>paid</option><option>video</option><option>email</option></select></label><label>Campaign<input type="text" id="utC" placeholder="nameplate-maker-202610"></label><label>Content (post id)<input type="text" id="utX" placeholder="reel-01"></label></div><button class="btn primary" type="button" id="utGo" style="margin-top:8px">Build link</button><div id="utOut" style="margin-top:10px"></div>`}[t];
  return tabs+body;
}
function seoCheckHtml(html){
  const doc=new DOMParser().parseFromString(html,"text/html"); const R=[]; const add=(area,ok,rule,note)=>R.push({area,ok,rule,note});
  const title=(doc.querySelector("title")||{}).textContent||""; const md=(doc.querySelector('meta[name="description"]')||{getAttribute:()=>""}).getAttribute("content")||"";
  add("Tags",title.length>0&&title.length<=60,"Title tag under 60 characters",title?`${title.length} chars: "${title.slice(0,80)}"`:"missing");
  add("Tags",md.length>=50&&md.length<=160,"Meta description 50–160 characters",md?`${md.length} chars`:"missing");
  const h1=doc.querySelectorAll("h1").length; add("Tags",h1===1,"Exactly one H1",`${h1} found`);
  const hs=[...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h=>+h.tagName[1]); let skip=0; for(let i=1;i<hs.length;i++) if(hs[i]-hs[i-1]>1) skip++; add("Tags",skip===0,"No skipped heading levels",skip?`${skip} jump(s), e.g. H2→H4`:"ok");
  const imgs=[...doc.querySelectorAll("img")]; const noAlt=imgs.filter(i=>!(i.getAttribute("alt")||"").trim()).length; add("Images",noAlt===0,"Alt text on every image",`${noAlt} of ${imgs.length} missing`);
  const lazy=imgs.filter(i=>i.getAttribute("loading")==="lazy").length; add("Speed",imgs.length<3||lazy>0,"Lazy-load images below the fold",`${lazy} of ${imgs.length} lazy`);
  const webp=imgs.filter(i=>/\.(webp|avif|svg)(\?|$)/i.test(i.getAttribute("src")||"")).length; add("Speed",imgs.length===0||webp/imgs.length>=.5,"Modern image formats (WebP/AVIF/SVG)",`${webp} of ${imgs.length}`);
  const dims=imgs.filter(i=>i.getAttribute("width")&&i.getAttribute("height")).length; add("Speed",imgs.length===0||dims===imgs.length,"Width/height on images (stops layout shift)",`${dims} of ${imgs.length}`);
  add("Technical",!!doc.querySelector('link[rel="canonical"]'),"Canonical tag","");
  add("Technical",!!doc.querySelector('meta[name="viewport"]'),"Mobile viewport tag","");
  add("Technical",!!(doc.documentElement.getAttribute("lang")),"Language set on <html>","");
  const robots=(doc.querySelector('meta[name="robots"]')||{getAttribute:()=>""}).getAttribute("content")||""; add("Technical",!/noindex/i.test(robots),"Page is indexable (no noindex)",robots||"no robots meta");
  const og=["og:title","og:description","og:image"].filter(k=>doc.querySelector(`meta[property="${k}"]`)).length; add("Social",og===3,"Open Graph title, description and image",`${og} of 3`);
  add("Social",!!doc.querySelector('meta[name="twitter:card"]'),"Twitter/X card","");
  const ld=[...doc.querySelectorAll('script[type="application/ld+json"]')]; let types=[]; ld.forEach(x=>{ try{ const j=JSON.parse(x.textContent); (Array.isArray(j)?j:[j]).forEach(o=>{ if(o["@graph"]) o["@graph"].forEach(g=>types.push(g["@type"])); else types.push(o["@type"]); }); }catch{ types.push("invalid JSON"); } });
  add("Schema",ld.length>0&&!types.includes("invalid JSON"),"Valid JSON-LD structured data",types.length?types.flat().join(", "):"none");
  const text=(doc.body&&doc.body.textContent||"").replace(/\s+/g," ").trim(); const words=text?text.split(" ").length:0; add("Content",words>=250,"Enough crawlable text (250+ words)",`${words} words`);
  const links=[...doc.querySelectorAll("a[href]")]; const internal=links.filter(a=>/^\/(?!\/)|^#|^\.\//.test(a.getAttribute("href"))).length; add("Content",internal>=3,"Internal links (3+)",`${internal} internal of ${links.length}`);
  const q=[...doc.querySelectorAll("h2,h3")].filter(h=>/\?$/.test(h.textContent.trim())).length; add("AI search",q>0,"Question-style headings for AI answers",`${q} found`);
  const score=Math.round(R.filter(r=>r.ok).length/R.length*100);
  return {score,R};
}
function snippetOut(){ const T=($("#snT")||{}).value||"", D=($("#snD")||{}).value||"", U=($("#snU")||{}).value||"", K=(($("#snK")||{}).value||"").toLowerCase();
  const bar=(n,max)=>`<span style="color:${n===0?"var(--muted)":n<=max?"var(--ok)":"var(--bad)"}">${n}/${max}</span>`;
  const slug=T.toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9\s-]/g,"").trim().split(/\s+/).filter(w=>!["a","an","the","of","and","or","for","to","in","on","with"].includes(w)).join("-").slice(0,60);
  const host=(()=>{ try{ return new URL(U).host; }catch{ return "your-site.com"; } })(); const path=(()=>{ try{ return new URL(U).pathname.replace(/\//g," › ").trim(); }catch{ return ""; } })();
  const out=$("#snOut"); if(!out) return;
  out.innerHTML=`<div class="serp"><div class="serp-u">${esc(host)} ${esc(path)}</div><div class="serp-t">${esc(T.length>60?T.slice(0,57)+"…":T||"Your page title")}</div><div class="serp-d">${esc(D.length>160?D.slice(0,157)+"…":D||"Your meta description shows here.")}</div></div>
    <div class="small" style="margin-top:8px">Title ${bar(T.length,60)} · Description ${bar(D.length,160)} · URL ${bar(U.length,70)}${K?` · keyword in title: ${T.toLowerCase().includes(K)?"✓":"✗"} · in description: ${D.toLowerCase().includes(K)?"✓":"✗"} · in URL: ${U.toLowerCase().includes(K.replace(/\s+/g,"-"))?"✓":"✗"}`:""}</div>
    ${slug?`<div class="small" style="margin-top:4px">Suggested URL slug: <code>/${esc(slug)}</code></div>`:""}`; }
function schemaOut(){ const v=id=>(($(id)||{}).value||"").trim(); const T=v("#scT"), N=v("#scN"), U=v("#scU"), I=v("#scI"), D=v("#scD"), P=v("#scP"), C=v("#scC"), sameAs=v("#scS").split(",").map(x=>x.trim()).filter(Boolean);
  let o={"@context":"https://schema.org","@type":T};
  if(T==="FAQPage"){ o.mainEntity=v("#scF").split("|").map(x=>x.trim()).filter(Boolean).map(pair=>{ const i=pair.indexOf("?"); return {"@type":"Question",name:(i>0?pair.slice(0,i+1):pair).trim(),acceptedAnswer:{"@type":"Answer",text:(i>0?pair.slice(i+1):"").trim()}}; }); }
  else { if(N) o.name=N; if(U) o.url=U; if(I) o.image=I; if(D) o.description=D; if(sameAs.length) o.sameAs=sameAs; }
  if(T==="LocalBusiness"&&C) o.areaServed=C, o.address={"@type":"PostalAddress",addressLocality:C.split(",")[0].trim(),addressRegion:(C.split(",")[1]||"SC").trim(),addressCountry:"US"};
  if(T==="Product"&&P) o.offers={"@type":"Offer",price:P,priceCurrency:"USD",availability:"https://schema.org/InStock",url:U||undefined};
  if(T==="SoftwareApplication"){ o.applicationCategory="LifestyleApplication"; o.operatingSystem="Web, iOS, Android (PWA)"; o.offers={"@type":"Offer",price:P||"0",priceCurrency:"USD"}; }
  if(T==="VideoObject"){ o.thumbnailUrl=I||undefined; o.uploadDate=new Date().toISOString().slice(0,10); o.contentUrl=U||undefined; delete o.image; }
  const code=`<script type="application/ld+json">\n${JSON.stringify(o,null,2)}\n</`+`script>`;
  const out=$("#scOut"); if(out){ out.innerHTML=`<pre class="code">${esc(code)}</pre><button class="btn" type="button" id="scCopy">Copy</button> <a class="small" href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Test it in Google's Rich Results Test ↗</a>`; $("#scCopy").onclick=()=>copyText(code); } }
function videoOut(){ const v=id=>(($(id)||{}).value||""); const T=v("#ytT"), K=v("#ytK").toLowerCase().trim(), P=v("#ytP"), D=v("#ytD"), G=v("#ytG").split(",").map(x=>x.trim()).filter(Boolean);
  const max={yt:95,short:70,tiktok:100,etsy:140}[P]; const R=[]; const add=(ok,t)=>R.push(`<li style="color:${ok?"var(--ok)":"var(--bad)"}">${ok?"✓":"✗"} <span style="color:var(--fg)">${esc(t)}</span></li>`);
  add(T.length>0&&T.length<=max,`Title ${T.length}/${max} characters`); if(K){ add(T.toLowerCase().indexOf(K)>-1&&T.toLowerCase().indexOf(K)<40,"Keyword near the start of the title"); add(D.split("\n").slice(0,2).join(" ").toLowerCase().includes(K),"Keyword in the first 2 lines of the description/caption"); }
  const tags=(D.match(/#\w+/g)||[]).length; if(P==="etsy"){ add(G.length===13,`Etsy uses all 13 tags (${G.length})`); add(G.every(x=>x.length<=20),"Every Etsy tag is 20 characters or less"); }
  else { add(P==="yt"?G.length>=10&&G.length<=15:true,P==="yt"?`10–15 tags (${G.length})`:"Tags optional on this platform"); add(tags>=3&&tags<=6,`3–6 hashtags (${tags})`); }
  add(/https?:\/\//.test(D),"A link to our site or app in the description"); add(!/https?:\/\/\S+/.test(D)||/utm_source=/.test(D),"Links carry UTM tracking");
  if(P==="yt") add(/\d{1,2}:\d{2}/.test(D),"Chapters/timestamps in the description");
  const out=$("#ytOut"); if(out) out.innerHTML=`<ul class="small" style="list-style:none;padding:0;margin:0;display:grid;gap:4px">${R.join("")}</ul>`; }
function utmOut(){ const v=id=>(($(id)||{}).value||"").trim(); let u; try{ u=new URL(v("#utU")); }catch{ const o=$("#utOut"); if(o) o.innerHTML=`<div class="small" style="color:var(--bad)">Enter a full URL starting with https://</div>`; return; }
  const slug=x=>x.toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,"");
  u.searchParams.set("utm_source",v("#utS")); u.searchParams.set("utm_medium",v("#utM")); if(v("#utC")) u.searchParams.set("utm_campaign",slug(v("#utC"))); if(v("#utX")) u.searchParams.set("utm_content",slug(v("#utX")));
  const link=u.toString(); const o=$("#utOut"); if(o){ o.innerHTML=`<pre class="code">${esc(link)}</pre><button class="btn" type="button" id="utCopy">Copy</button>`; $("#utCopy").onclick=()=>copyText(link); } }
function copyText(t){ try{ navigator.clipboard.writeText(t).then(()=>toast("Copied."),()=>toast("Select and copy it manually.")); }catch{ toast("Select and copy it manually."); } }
async function decideAd(id,ok){ if(!db) return; const a=S.ads.find(x=>x.id===id); if(!a) return; const k="ad:"+id; if(INFLIGHT.has(k)) return; INFLIGHT.add(k); setTimeout(()=>INFLIGHT.delete(k),8000);
  const now=new Date().toISOString(), who=me(), whoKey=who.toLowerCase();
  try{ await db.doc("ads/"+id).update({status:ok?"approved":"passed", decidedBy:whoKey, decidedAt:now});
    if(ok){ await addReq({for:"tina", by:whoKey, what:`${who} approved ad "${a.headline}" for ${a.property} (ads/${id}). Post the organic version on the right channels with its tracked link. Paid spend still needs ${who}'s separate OK — don't boost.`, ad:id, status:"open", at:now}); fire(tidOf("tina"),`Aaron approved ad "${a.headline}" (ads/${id}). Post the organic version now.`);
      await addReq({for:"tina", by:whoKey, what:`${who} liked ad "${a.headline}" (ads/${id}) — make more in this angle.`, ad:id, status:"open", at:now}); toast("Approved. Tina will post it organically."); }
    else { await addReq({for:"tina", by:whoKey, what:`${who} passed on ad "${a.headline}" (ads/${id}) — try a different angle next time.`, ad:id, status:"open", at:now}); toast("Passed. Tina will try another angle."); }
  }catch{ toast("Couldn't save. Try again."); INFLIGHT.delete(k); } }
async function sendUrlToSage(){ const i=$("#stUrl"); const v=(i&&i.value||"").trim(); if(!/^https?:\/\//.test(v)){ toast("Enter a full URL starting with https://"); return; } if(!db) return;
  const now=new Date().toISOString(); try{ await addReq({for:"sage", by:me().toLowerCase(), what:`SEO check requested by ${me()}: ${v} — full playbook check, PageSpeed, fixes to the owner, and write the result to seoaudit.`, status:"open", at:now});
    const tid=tidOf("sage"); const woke=tid?await fire(tid,`SEO check requested by ${me()}: ${v}`):false; i.value=""; toast(woke?"Sent. Sage is checking it now.":"Sent to Sage."); }catch{ toast("Couldn't send. Try again."); } }
/* which business a marketing item belongs to: explicit business field, else by name */
function bizOf(x){ const b=String((x&&(x.business||x.biz||x.brand))||"").toLowerCase(); if(/c3d|charleston.?3d|3d/.test(b)) return "c3d"; if(/app/.test(b)) return "apps"; if(/studio|youtube|video|funny|released|newsflash/.test(b)) return "studio"; if(b) return "ed";
  const t=String((x&&(x.property||x.name||x.id||x.title))||"").toLowerCase(); if(/charleston.?3d|3d|nameplate|hype.?chain/.test(t)) return "c3d"; if(/youtube|funny|released|newsflash|video/.test(t)) return "studio"; if(/netlify|app\b|fieldnote|partriever|caresync|carelinked|workbook|oops|tokentab/.test(t)) return "apps"; return "ed"; }
function vGrowth(){
  const biz=S.biz==="c3d"?"c3d":"ed", bn=BIZ_NAME[biz];
  const st=S.seoStatus; const avg=st&&st.avgScore!=null?st.avgScore:null; const today=dayKey(new Date());
  const adsToday=S.ads.filter(a=>bizOf(a)===biz&&(a.round||dayKey(a.at||0))===today).length, vids=S.videos.filter(v=>bizOf(v)===biz&&(v.round||dayKey(v.at||0))===today).length;
  return `<div class="ticker ops gops" style="margin-top:0;margin-bottom:16px">
      <button class="tk mini" type="button" data-goto="growth#g-market"><span class="l">Market report</span><span class="v">${S.market?esc(ago(S.market.at)):"—"}</span><span class="s">Nora</span></button>
      <button class="tk mini" type="button" data-goto="growth#g-seo"><span class="l">SEO score</span><span class="v" style="color:${scoreColor(avg)}">${avg==null?"—":avg+"/100"}</span><span class="s">${st?`${st.fixesOpen||0} fixes open`:"first check 7:05 AM"}</span></button>
      <button class="tk mini" type="button" data-goto="growth#g-ads"><span class="l">Ads today</span><span class="v">${adsToday}</span><span class="s">Tina · goal 10</span></button>
      <button class="tk mini" type="button" data-goto="growth#g-videos"><span class="l">Short videos</span><span class="v">${vids}</span><span class="s">Mon · Wed · Fri</span></button>
      <button class="tk mini" type="button" data-goto="growth#g-tool"><span class="l">SEO tool</span><span class="v">Open</span><span class="s">check any page</span></button></div>
    <div class="grid"><div class="col">
      <section class="card" id="g-market" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))"><div class="card-head"><h2 class="big">What's selling now</h2><span class="eyebrow">Nora · ${esc(bn)}</span></div>${marketFull(biz==="c3d")}</section>
      <section class="card" id="g-seo"><div class="card-head"><h2 class="big">Search visibility</h2><span class="eyebrow">Sage · checks 7:05 AM & 9:05 PM · settings refreshed Mondays</span></div>
        ${st?`<p class="small" style="margin:0 0 10px">${esc(st.summary||"")}${st.nextFocus?` <b>Next:</b> ${esc(st.nextFocus)}`:""}</p>`:""}
        <h3 class="sub">Average score, morning and night</h3>${seoTrendChart()}
        <h3 class="sub">${esc(bn)} sites and shops</h3>${seoCards(biz)}
        <h3 class="sub">Keyword positions on Google</h3>${keywordTable()}</section>
      <section class="card" id="g-ads"><div class="card-head"><h2 class="big">${esc(bn)} ads</h2><span class="eyebrow">Tina · nothing is paid without your OK</span></div>${adsGallery(biz)}</section>
      <section class="card" id="g-videos"><div class="card-head"><h2 class="big">${esc(bn)} short videos</h2><span class="eyebrow">Tina · Mon/Wed/Fri</span></div>${videoGallery(biz)}</section>
    </div><div class="col">
      <section class="card" id="g-tool"><div class="card-head"><h2>SEO tool</h2><span class="eyebrow">built on the team playbook</span></div>${seoTool()}</section>
      ${desk("growth")}
      <section class="card"><div class="card-head"><h2>SEO playbook</h2><span class="eyebrow">the rules every teammate follows</span></div>${playbookView()}</section>
    </div></div>`;
}
function vC3D(){
  const br=S.brands.find(b=>b.id==="charleston-3d-prints")||{};
  const prods=((S.pricing&&S.pricing.products)||[]).filter(p=>IS3D(p.name));
  const market=((S.pricing&&S.pricing.market)||[]).filter(m=>IS3D(m.category));
  const designs=S.designs.filter(d=>d.brand==="charleston-3d-prints"||IS3D(d.product));
  const apps=S.apps.filter(a=>IS3D(a.name+" "+(a.pitch||"")));
  const bills=S.bills.filter(b=>IS3D(b.service));
  const setIds=new Set(S.setup.map(x=>x.id));
  const todo=[...S.setup.filter(x=>!x.done&&IS3D(x.title)).map(x=>({t:x.title,why:x.why,link:x.link,src:"Setup"})),
              ...S.roadmap.filter(x=>x.status!=="done"&&!setIds.has(x.id)&&IS3D(x.title)).map(x=>({t:x.title,why:x.why,link:x.link,src:x.phase||"Roadmap"}))]
              .filter((x,i,arr)=>arr.findIndex(y=>y.t===x.t)===i);
  const money=n=>n==null||n===""?"—":"$"+(+n).toFixed(2).replace(/\.00$/,"");
  const prodHtml=prods.length?`<div class="list">${prods.map(p=>{ const pp=(p.perPlatform||[]).filter(x=>x.profit!=null).sort((a,b)=>b.profit-a.profit); const best=pp[0];
      return `<div class="row"><div class="body"><div class="t">${esc(p.name)} <span class="muted small" style="font-weight:400">sells ${money(p.price)} + ${money(p.shipping)} ship</span></div>
        <div class="meta">Cost to make ${money(p.unitCost)}${best?` · best on ${esc(best.platform)}: you keep ${money(best.profit)}`:""}</div>
        ${pp.length?`<div class="links" style="margin-top:6px">${pp.map(x=>`<span class="pill">${esc(x.platform)} ${money(x.profit)}</span>`).join("")}</div>`:""}
        ${p.unitCostNotes?`<div class="detail small muted">${esc(String(p.unitCostNotes).slice(0,220))}</div>`:""}</div></div>`; }).join("")}</div>
      <div style="margin-top:8px"><button class="btn" type="button" data-goto="pricing">Full fee breakdown</button></div>`
    :`<div class="empty">Helen adds 3D products (nameplates, hype chains, prints) to the pricing research with cost and profit per platform.</div>`;
  const mkHtml=market.length?market.map(m=>{ const ex=(m.examples||[]).filter(e=>e.price!=null); const ps=ex.map(e=>+e.price).sort((a,b)=>a-b);
      return `<div style="margin-bottom:10px"><div class="t" style="font-weight:600">${esc(m.category)}${ps.length?` <span class="muted small" style="font-weight:400">${money(ps[0])}–${money(ps[ps.length-1])}</span>`:""}</div>
        <ul class="small" style="margin:4px 0;padding-left:18px">${ex.slice(0,4).map(e=>{ const u=safeUrl(e.url); return `<li>${money(e.price)} · ${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(String(e.title||"").slice(0,70))}</a>`:esc(String(e.title||"").slice(0,70))}</li>`; }).join("")}</ul></div>`; }).join("")
    :`<div class="empty">Andy refreshes what small shops charge for 3D prints every week.</div>`;
  const brandHtml=`<div class="kv">
      <div class="kv-row"><div class="kv-k">Status</div><div class="kv-v">${esc(br.status||"setting up")}</div></div>
      ${br.website?`<div class="kv-row"><div class="kv-k">Website</div><div class="kv-v">${showVal(br.website)}</div></div>`:""}
      ${(br.domains||[]).length?`<div class="kv-row"><div class="kv-k">Domains</div><div class="kv-v">${br.domains.map(d=>`<div><b>${esc(d.domain)}</b> · ${esc(d.status||"")}${d.note?`<div class="small muted">${esc(d.note)}</div>`:""}</div>`).join("")}</div></div>`:""}
      ${(br.handles||[]).length?`<div class="kv-row"><div class="kv-k">Social</div><div class="kv-v">${br.handles.map(h=>`${esc(h.platform)}: ${esc(h.handle)} (${esc(h.status||"")})`).join("<br>")}</div></div>`:""}
      ${br.trademark?`<div class="kv-row"><div class="kv-k">Trademark</div><div class="kv-v">${esc(br.trademark.status||"")}${br.trademark.notes?` · <span class="small muted">${esc(br.trademark.notes)}</span>`:""}</div></div>`:""}
      ${(br.risks||[]).length?`<div class="kv-row"><div class="kv-k">Watch out</div><div class="kv-v">${showVal(br.risks)}</div></div>`:""}
    </div>`;
  const todoHtml=todo.length?`<div class="list">${todo.map(x=>{ const u=safeUrl(x.link); return `<div class="row"><div class="stripe warn"></div><div class="body"><div class="t">${esc(x.t)}</div><div class="meta">${esc(x.src)}</div>${x.why?`<div class="detail small">${esc(x.why)}</div>`:""}</div>${u?`<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Open</a>`:""}</div>`; }).join("")}</div>`:`<div class="empty">Nothing waiting on you for Charleston 3D.</div>`;
  const appsHtml=apps.length?`<div class="list">${apps.map(a=>{ const lu=safeUrl(a.liveUrl); return `<div class="row clickable" data-appopen="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.name)}: open details"><div class="body"><div class="t">${esc(a.name)}</div>${a.pitch?`<div class="detail small">${esc(a.pitch)}</div>`:""}${lu?`<div class="links" style="margin-top:6px"><a href="${esc(lu)}" target="_blank" rel="noopener">Open app</a></div>`:""}</div><span class="small" style="color:var(--accent)">Details ›</span></div>`; }).join("")}</div>`:`<div class="empty">No 3D tools yet.</div>`;
  const billsHtml=bills.length?`<div class="list">${bills.map(b=>`<div class="row"><div class="stripe ${b.flag?"warn":""}"></div><div class="body"><div class="t">${esc(b.service)} <span class="muted small" style="font-weight:400">${esc(b.amount||"")} / ${esc(b.cycle||"")}</span></div><div class="meta">${b.nextCharge?"renews "+esc(b.nextCharge):""}</div>${b.flag?`<div class="detail small" style="color:var(--warn)">${esc(b.flag)}</div>`:""}</div><span class="pill ${b.status==="canceled"?"":"ok"}">${esc(b.status||"active")}</span></div>`).join("")}</div>`:`<div class="empty">No 3D subscriptions.</div>`;
  const site=S.c3d.site||{}, mk=S.c3d.market||{};
  const steps=(site.launchSteps||[]); const doneN=steps.filter(x=>x.done).length;
  const siteHtml=`<div class="kv">
      <div class="kv-row"><div class="kv-k">Status</div><div class="kv-v"><span class="pill ${site.status==="live"?"ok":"warn"}">${esc(site.status||"not started")}</span></div></div>
      <div class="kv-row"><div class="kv-k">Domain</div><div class="kv-v">${esc(site.domain||"")}</div></div>
      <div class="kv-row"><div class="kv-k">Checkout</div><div class="kv-v">${esc(site.checkout||"")}</div></div>
      ${site.wixSite?`<div class="kv-row"><div class="kv-k">Old site</div><div class="kv-v">${esc(site.wixSite)}</div></div>`:""}</div>
    <div class="links" style="margin:10px 0">${safeUrl(site.liveUrl)?`<a href="${esc(safeUrl(site.liveUrl))}" target="_blank" rel="noopener">Open live site</a>`:""}${safeUrl(site.previewUrl)?`<a href="${esc(safeUrl(site.previewUrl))}" target="_blank" rel="noopener">Open preview</a>`:""}</div>
    ${steps.length?`<h3 class="sub">Launch checklist · ${doneN} of ${steps.length}</h3><div class="list">${steps.map(x=>`<label class="row check ${x.done?"done":""}" style="align-items:flex-start"><input type="checkbox" data-c3dstep="${esc(x.id)}" ${x.done?"checked":""}><span class="body"><span class="t">${esc(x.title)}</span><span class="meta" style="display:block">${x.owner==="aaron"?"You":esc((TEAM_BY[x.owner]||{name:x.owner}).name)}</span></span></label>`).join("")}</div>`:""}
    <div class="replyrow" style="margin-top:12px"><input type="text" id="siteReq" placeholder="Change something on the website…" aria-label="Request a website change"><button class="btn" type="button" id="siteReqBtn">Send to the team</button></div>`;
  const c3dPosts=S.queue.filter(q=>/Charleston 3D/i.test(q.platform||"")).slice(0,12);
  const qst={draft:"warn",waiting:"warn",approved:"acc",scheduled:"acc",posted:"ok",hold:"",blocked:"bad"};
  const chan=[["Facebook page","fb-c3dp"],["TikTok","tiktok"],["Google Business Profile","gbp-c3d"],["Instagram","ig-c3d"]].map(([n,id])=>{ const st=S.setup.find(x=>x.id===id); return `<span class="pill ${st?(st.done?"ok":"warn"):""}">${esc(n)}: ${st?(st.done?"live":"to set up"):"not started"}</span>`; }).join(" ");
  const mktHtml=`<div class="links" style="margin-bottom:10px">${chan}</div>${c3dPosts.length?`<div class="list">${c3dPosts.map(q=>`<div class="row" style="flex-wrap:wrap"><div class="stripe ${qst[q.status]||""}"></div><div class="body" style="flex:1 1 240px"><div class="t">${esc(q.title||"")}</div><div class="meta">${esc(q.platform||"")} · ${esc(q.status||"")}${q.when?" · "+esc(String(q.when).slice(0,16).replace("T"," ")):""}</div>${q.caption?`<details><summary class="small">Caption</summary><p class="small" style="white-space:pre-wrap">${esc(q.caption)}</p></details>`:""}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${["draft","waiting","hold"].includes(q.status||"draft")?`<button class="btn primary" type="button" data-qok="${esc(q.id)}">Approve</button>`:""}${q.status!=="hold"&&q.status!=="posted"?`<button class="btn" type="button" data-qhold="${esc(q.id)}">Hold</button>`:""}</div></div>`).join("")}</div>`:`<div class="empty">Tina drafts Charleston 3D posts here for your approval.</div>`}`;
  const mkComp=(mk.competitors||[]); const mkLoc=(mk.localDemand||[]);
  const marketHtml=`${mk.status?`<p class="small muted" style="margin:0 0 8px">${esc(mk.status)} · ${ago(mk.at)}</p>`:""}
    ${mkComp.length?`<h3 class="sub">Competition</h3><div class="list">${mkComp.map(c=>{ const u=safeUrl(c.url); return `<div class="row"><div class="body"><div class="t">${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(c.name)}</a>`:esc(c.name)} <span class="muted small" style="font-weight:400">${esc(c.type||"")}</span></div><div class="meta">${[c.area,c.focus,c.priceRange,c.rating?("★ "+c.rating+(c.reviews?" ("+c.reviews+")":"")):""].filter(Boolean).map(esc).join(" · ")}</div>${c.threat?`<div class="detail small">Threat: ${esc(c.threat)}</div>`:""}</div></div>`; }).join("")}</div>`:""}
    ${mkLoc.length?`<h3 class="sub">Local demand</h3><div class="kv">${mkLoc.map(m=>`<div class="kv-row"><div class="kv-k">${esc(m.metric||"")}</div><div class="kv-v">${esc(String(m.value??""))} <span class="small muted">${esc(m.source||"")}</span></div></div>`).join("")}</div>`:""}
    ${(mk.opportunities||[]).length?`<h3 class="sub">Openings for us</h3>${showVal(mk.opportunities)}`:""}
    ${(mk.todo||[]).length?`<details><summary class="small">Research the team is doing next</summary>${showVal(mk.todo)}</details>`:""}`;
  const c3D=S.designs.filter(d=>designBiz(d)==="c3d"), c3L=S.listings.filter(l=>listingBiz(l)==="c3d"); const cnt=(arr,sts)=>arr.filter(x=>sts.includes(x.status||"")).length;
  const stage=(lab,n,go)=>`<button class="pstage" type="button" data-goto="${go}"><span class="pn">${n}</span><span class="pl">${esc(lab)}</span></button>`;
  const act=(label,icon,go)=>`<button class="acttile" type="button" data-goto="${go}"><i>${ICON[icon]}</i><span>${label}</span></button>`;
  return `<div class="acts acts-biz">${act("Make a light box","image","lightbox")}${act("New 3D product","cube","c3d#c3d-ideas")}${act("3D designs","image","design:c3d")}${act("New listing","list","listings:c3d#l-new")}${act("Website change","wrench","c3d#c3d-site")}${act("3D files in library","plus","library")}</div>${typeof qpCard==="function"?qpCard("c3d"):""}
    <div class="pipe" style="--tag:var(--c-c3d)"><div class="pstages">
      ${stage("3D ideas",cnt(S.printideas,["new"]),"c3d#c3d-ideas")}${stage("Files built",S.printideas.filter(x=>(x.files||[]).length).length,"c3d#c3d-ideas")}${stage("Legal OK",S.printideas.filter(x=>x.legal==="ok"&&["new","shortlisted"].includes(x.status)).length,"c3d#c3d-ideas")}${stage("Your pick",cnt(S.printideas,["shortlisted"])+cnt(c3D,["proposed"]),"c3d#c3d-ideas")}${stage("Approved",cnt(S.printideas,["approved"])+cnt(c3D,["approved"]),"c3d#c3d-ideas")}${stage("Listing ready",cnt(c3L,["ready"]),"listings:c3d#l-list")}${stage("Live",cnt(c3L,["posted"])+cnt(S.printideas,["listed"]),"listings:c3d#l-list")}</div></div>
    ${typeof v3dEtsy==="function"?v3dEtsy():""}<div class="grid" style="margin-top:20px"><div class="col">
    ${printIdeasCard()}
    <section class="card" id="c3d-site"><div class="card-head"><h2>Website · charleston3d.com</h2><span class="eyebrow">leaving Wix</span></div>${siteHtml}</section>
    <section class="card"><div class="card-head"><h2>Charleston 3D Prints</h2><span class="eyebrow">brand · Carla</span></div>${brandHtml}</section>
    <section class="card"><div class="card-head"><h2>Waiting on you</h2><span class="eyebrow">${todo.length} for 3D</span></div>${todoHtml}</section>

    <section class="card"><div class="card-head"><h2>Products & profit</h2><span class="eyebrow">what you keep per sale</span></div>${prodHtml}</section>
    <section class="card"><div class="card-head"><h2>3D designs</h2><span class="eyebrow">${designs.length} · from the design team</span></div>${designs.length?`<div class="ltiles">${designs.slice(0,12).map(dtile).join("")}</div><div style="margin-top:8px"><button class="btn" type="button" data-goto="design">Pick designs on the Designs tab</button></div>`:`<div class="empty">Lisa adds 3D print designs every morning.</div>`}</section>
    <section class="card"><div class="card-head"><h2>Marketing & social</h2><span class="eyebrow">Tina · approve before anything posts</span></div>${mktHtml}</section>
    <section class="card"><div class="card-head"><h2>Activity</h2></div>${feed(a=>IS3D(txt3(a)),20)}</section></div>
  <div class="col">${desk("c3d")}
    <section class="card" id="c3d-selling"><div class="card-head"><h2>What's selling in 3D</h2><span class="eyebrow">Nora · market research</span></div>${S.market?marketFull(true):`<div class="empty">Nora's 3D market report lands every morning after 5 AM.</div>`}</section>
    <section class="card"><div class="card-head"><h2>Local market & competition</h2><span class="eyebrow">Andy · Carla</span></div>${marketHtml}</section>
    <section class="card"><div class="card-head"><h2>3D tools & apps</h2></div>${appsHtml}</section>
    <section class="card"><div class="card-head"><h2>What small shops charge</h2></div>${mkHtml}</section>
    <section class="card"><div class="card-head"><h2>Website & subscriptions</h2></div>${billsHtml}</section></div></div>`;
}
/* ---------- Money ---------- */
function vMoney(){
  const p=S.moneyPlan; const stc={"not set up":"","growing":"warn","eligible":"acc","monetized":"ok"};
  const plats = S.platforms.length ? `<div class="team">${S.platforms.sort((a,b)=>(a.order??99)-(b.order??99)).map(x=>{ const u=safeUrl(x.url);
    return `<div class="agent"><div class="top"><div style="min-width:0;flex:1"><div class="nm">${esc(x.name)}</div><div class="rl">${esc(x.kind||"")}</div></div><span class="pill ${stc[x.status]||""}">${esc(x.status||"not set up")}</span></div>
      <div class="kpis" style="grid-template-columns:1fr 1fr"><div class="kpi"><div class="eyebrow">Revenue 30d</div><div class="v" style="font-size:20px">${esc(x.revenue30d??"—")}</div></div><div class="kpi"><div class="eyebrow">Audience</div><div class="v" style="font-size:20px">${esc(x.audience??"—")}</div></div></div>
      ${x.nextUnlock?`<div class="last"><b>Next unlock:</b> ${esc(x.nextUnlock)}</div>`:""}
      ${(x.actions||[]).length?`<ul class="small" style="margin:0;padding-left:18px">${x.actions.slice(0,3).map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}
      <div class="foot"><span class="small muted">${x.source?esc(x.source)+" · ":""}${ago(x.at)}</span>${u?`<a class="small" href="${esc(u)}" target="_blank" rel="noopener">Open →</a>`:""}</div></div>`; }).join("")}</div>`
    : `<div class="empty">Nora builds a card for every place you can earn: Shopify, Etsy, both Facebook pages, TikTok, both YouTube channels and your apps. Each shows its money status, audience and the next thing that unlocks more income.</div>`;
  return `${upcomingCharges()}<div class="grid"><div class="col">
    <section class="card brief"><div class="who"><div class="avatar">N</div><div><div style="font:700 17px var(--f-display)">Nora's money plan</div><div class="small muted">${p?ago(p.at):"Nora writes the first plan on her next run"}</div></div>${p?`<button class="btn" id="playMoney" type="button" style="margin-left:auto">Read it to me</button>`:""}</div>
      <p class="summary">${p?esc(p.summary):"Nora tracks every dollar: what each platform earns now, what unlocks the next revenue stream, and which three moves make the most money this week."}</p>
      ${p&&(p.priorities||[]).length?`<div class="eyebrow" style="margin-bottom:6px">Highest-value moves</div><ol>${p.priorities.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`:""}</section>
    <section class="card"><div class="card-head"><h2>Totals</h2><span class="eyebrow">every number has a source</span></div>${kpis("money")}</section>
    <section class="card"><div class="card-head"><h2>Every platform</h2></div>${plats}</section>
    <section class="card"><div class="card-head"><h2>Bills & subscriptions</h2><span class="eyebrow">Stephanie</span></div>${billsList()}</section>
    <section class="card"><div class="card-head"><h2>Taxes, licenses & forms</h2><button class="btn" data-goto="legal" type="button">Open Legal</button></div><p class="small muted" style="margin:0">Everything you need to file or fill out lives in Money ▸ Legal &amp; taxes.</p></section></div>
  <div class="col">${desk("money")}${teamCards("money")}<section class="card"><div class="card-head"><h2>Activity</h2></div>${feed(a=>["nora","linda","helen"].includes(a.agent),14)}</section>
    <p class="small muted">Nora and Helen give information, not tax, legal or investment advice. Check big decisions with a CPA.</p></div></div>`;
}


function billsList(){
  const canBill=CUR==="Aaron"&&IS_OWNER; const rv=S.billsReview;
  const form=canBill?billForm():`<p class="small muted" style="margin:0 0 10px">Only Aaron can add or change subscriptions and billing (signed in with his PIN).</p>`;
  const review=rv&&rv.summary?`<div class="answer" style="max-height:none;margin-bottom:10px"><b>Stephanie:</b> ${esc(rv.summary)}${(rv.flags||[]).length?`<ul class="small" style="margin:6px 0 0;padding-left:18px">${rv.flags.slice(0,8).map(f=>`<li>${esc(f.note||"")}</li>`).join("")}</ul>`:""}</div>`:"";
  if(!S.bills.length) return form+`<div class="empty">Add each subscription and bill here. Stephanie reviews these every Monday and suggests changes for you to approve. Only the card brand and last 4 digits are ever stored.</div>`;
  const mo=b=>{ const n=parseFloat(String(b.amount).replace(/[^0-9.]/g,"")); if(isNaN(n)) return 0; return b.cycle==="yearly"?n/12:b.cycle==="weekly"?n*4.33:n; };
  const total=S.bills.filter(b=>b.status!=="canceled").reduce((t,b)=>t+mo(b),0);
  const biz=S.bills.filter(b=>b.status!=="canceled"&&b.business).reduce((t,b)=>t+mo(b),0);
  return form+review+`<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="eyebrow">Per month, all</div><div class="v">$${total.toFixed(0)}</div></div><div class="kpi"><div class="eyebrow">Business (deductible)</div><div class="v">$${biz.toFixed(0)}</div></div><div class="kpi"><div class="eyebrow">Subscriptions</div><div class="v">${S.bills.filter(b=>b.status!=="canceled").length}</div></div></div>
  <div class="list">${S.bills.sort((a,b)=>String(a.nextCharge||"9").localeCompare(String(b.nextCharge||"9"))).map(b=>`<div class="row"><div class="stripe ${b.flag?"warn":b.business?"acc":""}"></div><div class="body"><div class="t">${esc(b.service)} <span class="muted small" style="font-weight:400">${esc(b.amount||"")} / ${esc(b.cycle||"month")}</span></div>
    <div class="meta">${b.nextCharge?"renews "+esc(b.nextCharge)+" · ":""}${esc(cardLabel(b.paidWith))}${b.business?" · business":""}</div>${b.flag?`<div class="detail" style="color:var(--warn)">${esc(b.flag)}</div>`:""}</div><span class="pill ${b.status==="canceled"?"":"ok"}">${esc(b.status||"active")}</span>${canBill?`<button class="btn" type="button" data-billedit="${esc(b.id)}" style="margin-left:6px">Edit</button>`:""}</div>`).join("")}</div>`;
}

function cardLabel(v){ const raw=String(v||""); const m=raw.match(/[•*xX]{2}\s?(\d{4})(?!\d)/); const brand=raw.replace(/[•*xX]{2,}\s*\d+/g,"").replace(/\d/g,"").replace(/\b(ending|ends)(\s+(in|with))?\b/gi,"").replace(/[\s,:#-]+$/,"").replace(/\s{2,}/g," ").trim();
  return (brand||(m?"Card":"card not set"))+(m?" ••"+m[1]:""); }
function billForm(){ const e=S.billEdit?S.bills.find(b=>b.id===S.billEdit):null; const v=e||{};
  return `<form id="billForm" class="card" style="padding:12px;margin:0 0 12px;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
    <div style="grid-column:1/-1;font-weight:700">${e?"Edit "+esc(v.service||""):"Add a subscription or bill"} <span class="small muted" style="font-weight:400">· Aaron only</span></div>
    <input type="text" id="bService" placeholder="Service (e.g. Shopify)" value="${esc(v.service||"")}" aria-label="Service" maxlength="80">
    <input type="text" id="bAmount" placeholder="Amount (e.g. $19)" value="${esc(v.amount||"")}" aria-label="Amount" maxlength="20">
    <select id="bCycle" aria-label="Billing cycle">${["monthly","yearly","weekly"].map(c=>`<option ${v.cycle===c?"selected":""}>${c}</option>`).join("")}</select>
    <input type="text" id="bNext" placeholder="Next charge YYYY-MM-DD" value="${esc(v.nextCharge||"")}" aria-label="Next charge date" maxlength="10">
    <select id="bCard" aria-label="Card brand">${["","Visa","Mastercard","Amex","Discover","Debit card","PayPal","Bank transfer"].map(c=>`<option value="${c}" ${cardLabel(v.paidWith).replace(/ ••\d{4}$/,"")===c?"selected":""}>${c||"Card brand"}</option>`).join("")}</select>
    <input type="text" id="bLast4" inputmode="numeric" maxlength="4" placeholder="Last 4 (optional)" value="${esc((cardLabel(v.paidWith).match(/••(\d{4})/)||[])[1]||"")}" aria-label="Card last 4 digits (optional)">
    <select id="bStatus" aria-label="Status">${["active","trial","canceled"].map(c=>`<option ${v.status===c?"selected":""}>${c}</option>`).join("")}</select>
    <label class="check small" style="align-items:center"><input type="checkbox" id="bBiz" ${v.business?"checked":""}> Business expense</label>
    <div style="display:flex;gap:6px;grid-column:1/-1"><button class="btn primary" type="submit">${e?"Save changes":"Add bill"}</button>${e?`<button class="btn" type="button" id="bCancelEdit">Cancel</button>`:""}</div>
    <p class="small muted" style="grid-column:1/-1;margin:0">Card brand and, if you like, the last 4 digits. Full card numbers are never saved.</p></form>`; }
async function saveBill(){
  if(!(CUR==="Aaron"&&IS_OWNER)){ toast("Only Aaron can change billing."); return; } if(!db) return;
  const service=$("#bService").value.trim(); if(!service){ toast("Add the service name."); return; }
  const amount=$("#bAmount").value.replace(/[^0-9.$]/g,"").slice(0,12); const next=$("#bNext").value.trim();
  if(next && !/^\d{4}-\d{2}-\d{2}$/.test(next)){ toast("Use YYYY-MM-DD for the date."); return; }
  const data={service:service.replace(/\d{6,}/g,"").slice(0,80), amount:amount?(amount.startsWith("$")?amount:"$"+amount):"", cycle:$("#bCycle").value, nextCharge:next, paidWith:cardLabel(($("#bCard").value||"")+(/^\d{4}$/.test($("#bLast4").value.trim())?" ••"+$("#bLast4").value.trim():"")), status:$("#bStatus").value, business:$("#bBiz").checked, source:"entered by Aaron", updatedAt:new Date().toISOString()};
  try{ if(S.billEdit){ await db.doc("bills/"+S.billEdit).update(data); } else { await db.collection("bills").add({...data, at:new Date().toISOString()}); }
    S.billEdit=null; toast("Saved."); render(); }catch{ toast("Couldn't save. Only Aaron's own account can change billing."); }
}

function billChangesCard(){
  const pend=S.billchanges.filter(c=>c.status==="pending"); const can=CUR==="Aaron"&&IS_OWNER;
  if(!pend.length) return "";
  const lbl={add:"New subscription",update:"Change",["cancel-candidate"]:"Maybe cancel"};
  return `<div style="margin-top:10px"><div style="font-weight:700;margin-bottom:6px">Stephanie's suggestions · ${pend.length} waiting${can?"":" for Aaron"}</div><div class="list">${pend.map(c=>{ const p=c.proposed||{}; const cur=c.bill?S.bills.find(b=>b.id===c.bill):null;
    return `<div class="row" style="flex-wrap:wrap;gap:8px"><div class="body" style="flex:1 1 240px"><div class="t">${esc(lbl[c.kind]||c.kind||"")}: ${esc(p.service||(cur&&cur.service)||"")}</div>
      <div class="meta">${p.amount?esc(p.amount)+" / "+esc(p.cycle||""):""}${p.nextCharge?" · renews "+esc(p.nextCharge):""}${p.paidWith?" · "+esc(cardLabel(p.paidWith)):""}${cur&&cur.amount&&p.amount&&cur.amount!==p.amount?` · was ${esc(cur.amount)}`:""}</div>
      ${c.reason?`<div class="detail small">${esc(c.reason)}</div>`:""}${c.source?`<div class="meta">From ${esc(c.source)}</div>`:""}</div>
      ${can?`<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary" type="button" data-bcok="${esc(c.id)}">Approve</button><button class="btn" type="button" data-bcno="${esc(c.id)}">Dismiss</button></div>`:""}</div>`; }).join("")}</div></div>`;
}
async function decideBillChange(id, ok){
  if(!(CUR==="Aaron"&&IS_OWNER)){ toast("Only Aaron can approve billing changes."); return; } if(!db) return;
  const c=S.billchanges.find(x=>x.id===id); if(!c) return; const p=c.proposed||{}; const now=new Date().toISOString();
  try{
    if(ok){ const data={}; ["service","amount","cycle","nextCharge","status","business"].forEach(k=>{ if(p[k]!==undefined&&p[k]!=="") data[k]=k==="service"?String(p[k]).slice(0,80):p[k]; });
      if(p.paidWith) data.paidWith=cardLabel(p.paidWith); if(c.kind==="cancel-candidate") data.status="canceled"; data.updatedAt=now; data.source="approved by Aaron";
      if(c.bill && S.bills.find(b=>b.id===c.bill)) await db.doc("bills/"+c.bill).update(data); else await db.collection("bills").add({...data, at:now}); }
    await db.doc("billchanges/"+id).update({status:ok?"approved":"dismissed", decidedAt:now});
    toast(ok?"Approved and saved to your bills.":"Dismissed.");
  }catch{ toast("Couldn't save. Try again."); }
}
function taxList(){
  if(!S.tax.length) return `<div class="empty">Stephanie keeps the tax and compliance checklist here: quarterly estimates, 1099s from Etsy and Shopify, SC sales tax, LLC filings and deadlines, with dates and links.</div>`;
  const stc={done:"ok",due:"warn",overdue:"bad",todo:""};
  return `<div class="list">${S.tax.sort((a,b)=>String(a.due||"9").localeCompare(String(b.due||"9"))).map(t=>{ const u=safeUrl(t.link); return `<div class="row"><div class="stripe ${stc[t.status]||""}"></div><div class="body"><div class="t">${esc(t.title)}</div><div class="meta">${t.due?"due "+esc(t.due):""}</div>${t.note?`<div class="detail muted">${esc(t.note)}</div>`:""}${u?`<a class="small" href="${esc(u)}" target="_blank" rel="noopener">Details →</a>`:""}</div><span class="pill ${stc[t.status]||""}">${esc(t.status||"todo")}</span></div>`; }).join("")}</div>`;
}

function legalList(){
  if(!S.legal.length) return `<div class="empty">Helen builds your licensing and legal checklist: City or County of Charleston business license, SC retail license, LLC good standing, privacy policies for the apps, copyright rules for the channels, and trademark checks for brand names. Each has a status, due date and official link.</div>`;
  const stc={done:"ok",due:"warn",overdue:"bad",todo:"",ok:"ok"};
  return `<div class="list">${S.legal.sort((a,b)=>(a.order??99)-(b.order??99)).map(t=>{ const u=safeUrl(t.link); return `<div class="row"><div class="stripe ${stc[t.status]||""}"></div><div class="body"><div class="t">${esc(t.title)}</div><div class="meta">${t.area?esc(t.area)+" · ":""}${t.due?"due "+esc(t.due):""}${t.cost?" · "+esc(t.cost):""}</div>${t.note?`<div class="detail muted">${esc(t.note)}</div>`:""}${u?`<a class="small" href="${esc(u)}" target="_blank" rel="noopener">Official source →</a>`:""}</div><span class="pill ${stc[t.status]||""}">${esc(t.status||"todo")}</span></div>`; }).join("")}</div>`;
}
function meetingCard(){
  const m=S.meetings[0];
  if(!m) return `<section class="card brief"><div class="who"><div class="avatar">H</div><div><div style="font:700 17px var(--f-display)">Manager meeting</div><div class="small muted">First meeting tonight at 10:05 PM</div></div></div><p class="summary">Every night Helen meets with Stephanie, Vera, Carla, Tina, Andy, Mike, Sam and Nora: what got done, what's stuck, and what happens next. She makes the decisions so work keeps moving when you step away, and logs every call here.</p></section>`;
  return `<section class="card brief"><div class="who"><div class="avatar">H</div><div><div style="font:700 17px var(--f-display)">Manager meeting · ${esc(m.date||"")}</div><div class="small muted">${ago(m.at)}</div></div><button class="btn" id="playMeeting" type="button" style="margin-left:auto">Read it to me</button></div>
    <p class="summary">${esc(m.summary||"")}</p>
    ${(m.decisions||[]).length?`<div class="eyebrow" style="margin-bottom:6px">Decisions</div><ol>${m.decisions.map(d=>`<li>${esc(d)}</li>`).join("")}</ol>`:""}
    ${(m.assignments||[]).length?`<div class="eyebrow" style="margin:10px 0 6px">Assignments</div><ul class="small" style="margin:0;padding-left:18px">${m.assignments.map(a=>`<li><b>${esc(TEAM_BY[a.to]?TEAM_BY[a.to].name:a.to)}:</b> ${esc(a.what)}</li>`).join("")}</ul>`:""}
    ${(m.needsAaron||[]).length?`<div class="eyebrow" style="margin:10px 0 6px">Needs you</div><ul class="small" style="margin:0;padding-left:18px">${m.needsAaron.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
    ${S.meetings.length>1?`<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Earlier meetings</summary>${S.meetings.slice(1,8).map(x=>`<div class="row"><div class="body"><div class="t">${esc(x.date)}</div><div class="detail muted">${esc(x.summary||"")}</div></div></div>`).join("")}</details>`:""}</section>`;
}

function formsList(){
  const forms=[...S.legal.filter(x=>x.kind==="form"), ...S.tax.filter(x=>x.kind==="form")];
  if(!forms.length) return `<div class="empty">Every form you need to fill out or file shows up here in one list: what it is, why you need it, where to file it, when it's due, and what info to have ready. Helen and Stephanie add them as they find them.</div>`;
  const stc={done:"ok",due:"warn",overdue:"bad",todo:""};
  return `<div class="list">${forms.sort((a,b)=>String(a.due||"9").localeCompare(String(b.due||"9"))).map(f=>{ const u=safeUrl(f.link); return `<div class="row"><div class="stripe ${stc[f.status]||""}"></div><div class="body">
    <div class="t">${esc(f.title)}</div><div class="meta">${f.due?"due "+esc(f.due)+" · ":""}${f.fileWhere?esc(f.fileWhere):""}${f.cost?" · "+esc(f.cost):""}</div>
    ${f.note?`<div class="detail">${esc(f.note)}</div>`:""}
    ${(f.haveReady||[]).length?`<div class="detail muted"><b>Have ready:</b> ${f.haveReady.map(esc).join(", ")}</div>`:""}
    ${u?`<a class="small" href="${esc(u)}" target="_blank" rel="noopener">Get the form →</a>`:""}</div>
    <label class="check" style="align-items:center"><input type="checkbox" data-formdone="${esc((S.legal.includes(f)?"legal":"tax")+"/"+f.id)}" ${f.status==="done"?"checked":""} id="fd-${esc((S.legal.includes(f)?"l-":"t-")+f.id)}"><span class="small">Done</span></label></div>`; }).join("")}</div>`;
}
const MSTAGES=[["new","Received"],["reviewing","Helen reviewing"],["assigned","Assigned"],["in progress","In progress"],["needs you","Needs you"],["done","Done"]];
function mattersList(){
  if(!S.matters.length) return `<div class="empty">Nothing open. Anything legal (a license, a form, a contract, a copyright question, a takedown, a letter you got) goes here. Helen reviews it, assigns the work, drafts or fills out the documents, and brings back only what needs your signature or decision.</div>`;
  const order=k=>MSTAGES.findIndex(x=>x[0]===k);
  const stc={"new":"warn","reviewing":"acc","assigned":"acc","in progress":"acc","needs you":"bad","done":"ok"};
  return `<div class="list">${S.matters.slice().sort((a,b)=>(a.status==="done")-(b.status==="done")||new Date(b.updatedAt||b.at)-new Date(a.updatedAt||a.at)).map(m=>{ const i=order(m.status||"new");
    return `<details class="idea" ${m.status==="needs you"?"open":""}><summary><div class="stripe ${stc[m.status]||""}"></div><div class="body" style="min-width:0;flex:1"><div class="t">${esc(m.title)}</div>
      <div class="meta">${esc(TEAM_BY[m.owner]?TEAM_BY[m.owner].name:"Helen")} · ${ago(m.updatedAt||m.at)}${m.due?" · due "+esc(m.due):""}</div></div><span class="pill ${stc[m.status]||""}">${esc((MSTAGES[i]||MSTAGES[0])[1])}</span></summary>
      <div class="an">
        <div style="display:flex;gap:4px;flex-wrap:wrap">${MSTAGES.map(([k,l],j)=>`<span class="pill ${j<i?"ok":j===i?(stc[k]||"acc"):""}" style="${j>i?"opacity:.5":""}">${j<i?"✓ ":""}${esc(l)}</span>`).join("")}</div>
        ${m.detail?`<div><h4>What it's about</h4><p>${esc(m.detail)}</p></div>`:""}
        ${m.plan?`<div><h4>Helen's plan</h4><p>${esc(m.plan)}</p></div>`:""}
        ${(m.steps||[]).length?`<div><h4>Steps</h4><ul>${m.steps.map(x=>`<li>${x.done?"✓ ":""}${esc(x.what||x)}${x.who?` <span class="muted">(${esc(TEAM_BY[x.who]?TEAM_BY[x.who].name:x.who)})</span>`:""}</li>`).join("")}</ul></div>`:""}
        ${m.needsYou?`<div><h4>What you need to do</h4><p>${esc(m.needsYou)}</p></div>`:""}
        ${(m.docs||[]).length?`<div><h4>Documents</h4><div class="links">${m.docs.map(d=>{const u=safeUrl(d.url);return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(d.name||"Document")}</a>`:""}).join("")}</div></div>`:""}
        <div class="drop"><textarea id="mreply-${esc(m.id)}" style="min-height:56px" placeholder="Reply to Helen about this, or tell her it's done"></textarea>
          <div class="actions"><span style="flex:1"></span>${m.status==="needs you"?`<button class="btn" type="button" data-mdone="${esc(m.id)}">I did my part</button>`:""}<button class="btn primary" type="button" data-mreply="${esc(m.id)}">Send to Helen</button></div></div>
        ${(m.log||[]).length?`<div><h4>History</h4><ul class="small">${m.log.slice(-8).map(x=>`<li><span class="muted">${ago(x.at)}</span> ${esc(x.text)}</li>`).join("")}</ul></div>`:""}
      </div></details>`; }).join("")}</div>`;
}
function vLegal(){
  return `<div class="grid"><div class="col">
    ${typeof paperworkCard==="function"?paperworkCard():""}
    <section class="card"><div class="card-head"><h2>Bring Helen a legal matter</h2><span class="eyebrow">anything legal goes here</span></div>
      <form class="drop" id="matterForm"><input type="text" id="mTitle" placeholder="What is it? e.g. Do I need a Charleston business license?">
        <textarea id="mDetail" placeholder="Details, what you know, deadlines. Talk it through."></textarea>
        <div class="actions"><span class="small muted">Received → Helen reviews → assigned → in progress → needs you (only if a signature or decision is needed) → done</span><span style="flex:1"></span><button class="btn primary" type="submit">Send to Helen</button></div></form></section>
    <section class="card"><div class="card-head"><h2>Legal matters</h2><span class="eyebrow">${S.matters.filter(m=>m.status!=="done").length} open</span></div>${mattersList()}</section>
    <section class="card brief"><div class="who"><div class="avatar">H</div><div><div style="font:700 17px var(--f-display)">Where you stand</div><div class="small muted">Elevated Designs LLC · Charleston, SC</div></div></div>
      <p class="summary">Your business income is taxable from the first dollar. The $600 figure was only about when Etsy or a client sends you a form, and that threshold for Etsy-type platforms is now $20,000. Self-employment tax kicks in once your net profit for the year reaches $400. Helen and Stephanie keep every license, tax date and form for selling on Etsy, Shopify, at markets, on YouTube and in your apps on this one page.</p></section>
    <section class="card"><div class="card-head"><h2>Forms to fill out</h2><span class="eyebrow">one list</span></div>${formsList()}</section>
    <section class="card"><div class="card-head"><h2>Licenses & legal</h2><span class="eyebrow">Helen</span></div>${legalList()}</section>
    <section class="card"><div class="card-head"><h2>Taxes & deadlines</h2><span class="eyebrow">Stephanie</span></div>${taxList()}</section></div>
  <div class="col">${desk("legal")}${teamCards("legal")}
    <p class="small muted">Helen and Stephanie give information, not legal or tax advice. Have a CPA look over anything you file. Your EIN, SSN and account numbers are never stored on this dashboard.</p></div></div>`;
}

const DESKS={overview:["steve","helen"], elevated:["vera","lisa","carla","tina"], studio:["mike"], listings:["carla"], apps:["sam","nora"], design:["vera","lisa"], money:["steve","helen","nora"], legal:["helen","steve"], ideas:["nora"], c3d:["andy","sam","carla","tina"], growth:["nora","sage","tina"]};
function desk(tab){
  const keys=(S.biz==="c3d"&&["design","listings","c3d"].includes(tab))?["andy"]:(DESKS[tab]||["steve"]); if(!keys.includes(S.roomSel)) S.roomSel=keys[0];
  return `<section class="card" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))"><div class="card-head"><h2>Talk to the team here</h2><span class="eyebrow">their answers are read aloud when voice is on</span></div>
    <div class="links" style="margin-bottom:10px">${keys.map(k=>`<button class="btn" type="button" data-deskpick="${esc(k)}" ${k===S.roomSel?'style="border-color:var(--accent);color:var(--accent)"':""}>${esc(TEAM_BY[k].name)} <span class="muted small">${esc(TEAM_BY[k].role.split(" ·")[0])}</span></button>`).join("")}</div>
    ${roomPanel(true)}</section>`;
}

function roadmapCard(){
  const steps=S.roadmap.slice().sort((a,b)=>(a.order??999)-(b.order??999));
  if(!steps.length) return `<section class="card brief"><div class="who"><div class="avatar av-steph">S</div><div><div style="font:700 17px var(--f-display)">Your roadmap</div><div class="small muted">Stephanie builds it this Sunday</div></div></div><p class="summary">Stephanie lays out building this business properly, in the order that makes the most money soonest: foundation, storefronts, content, monetization, then scale. He shows you one step at a time, explains why it matters and exactly how to do it, and moves on when you tap Done.</p></section>`;
  const done=steps.filter(x=>x.status==="done").length; const cur=steps.find(x=>x.status!=="done"); const pct=Math.round(done/steps.length*100);
  const phases=[...new Set(steps.map(x=>x.phase||"Plan"))];
  return `<section class="card brief"><div class="who"><div class="avatar">M</div><div style="flex:1;min-width:0"><div style="font:700 17px var(--f-display)">Your roadmap · ${done} of ${steps.length} steps</div>
      <div style="height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div></div></div>
    ${cur?`<div class="eyebrow" style="margin-bottom:4px">${esc(cur.phase||"")} · next step${cur.owner&&cur.owner!=="aaron"?" · "+esc(TEAM_BY[cur.owner]?TEAM_BY[cur.owner].name+" is on it":""):" · yours"}</div>
      <p class="summary" style="font-weight:600;margin-bottom:6px">${esc(cur.title)}</p>
      ${cur.why?`<p class="small" style="margin:0 0 8px;max-width:70ch">${esc(cur.why)}${cur.impact?` <b>${esc(cur.impact)}</b>`:""}</p>`:""}
      ${(cur.how||[]).length?`<ol class="small">${cur.how.map(h=>`<li>${esc(h)}</li>`).join("")}</ol>`:""}
      ${safeUrl(cur.link)?`<a class="small" href="${esc(safeUrl(cur.link))}" target="_blank" rel="noopener">Start here →</a>`:""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" type="button" data-stepdone="${esc(cur.id)}">Done, what's next?</button><button class="btn" type="button" id="walkMe">Walk me through it</button><button class="btn" type="button" id="hearStep">Read it to me</button></div>`
      :`<p class="summary">Every step is done. Stephanie is planning the next stage.</p>`}
    <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">See the whole roadmap</summary>${phases.map(ph=>`<div class="eyebrow" style="margin:10px 0 4px">${esc(ph)}</div><ul class="small" style="margin:0;padding-left:18px">${steps.filter(x=>(x.phase||"Plan")===ph).map(x=>`<li style="${x.status==="done"?"color:var(--muted);text-decoration:line-through":""}">${esc(x.title)}${x.owner&&x.owner!=="aaron"?` <span class="muted">(${esc(TEAM_BY[x.owner]?TEAM_BY[x.owner].name:x.owner)})</span>`:""}</li>`).join("")}</ul>`).join("")}</details></section>`;
}
async function stepDone(id){
  if(!db) return; const st=S.roadmap.find(x=>x.id===id); if(!st) return;
  try{ await db.doc("roadmap/"+id).update({status:"done", doneAt:new Date().toISOString()}); toast("Nice work. Stephanie is lining up your next step.");
    const tid=tidOf("steve"); if(tid) fire(tid,`${me()} finished roadmap step roadmap/${id}: "${st.title}". Review it, adjust the roadmap if needed, and make sure the next step is ready.`);
  }catch{ toast("Couldn't save. Try again."); }
}


/* ---------- Comms: who does what + direct messages + team board ---------- */
const JOBS={
  steve:["Your only point of contact: one list at 7 AM and a wrap-up at 6:50 PM","Runs the company day to day and pushes anything stuck","Bills, taxes and fees (took over from Linda): warns you before any charge"],
  helen:["Legal gate on every design, 3D product and app","Prices every product from the price table (took over from Linda)","Runs the nightly meeting and clears blockers"],
  vera:["GM of Elevated Designs and quality gate for every design","Writes the daily idea brief and fixes designs you sent back (took over from Iris)","Keeps the pod at 6 designs a day reaching the store"],
  lisa:["Draws 6 new designs every day from Vera's brief","Realistic mockups and print-ready files","Fixes Vera's notes the same day"],
  carla:["Publishes approved products live on Shopify (Etsy within your budget)","Listing SEO, collections and fast edits when you veto","Brand names, handles and profiles (took over from Brooke)"],
  tina:["Posts organic content for every brand once the channels exist","Builds ads daily and short videos Mon/Wed/Fri (took over from Ava)","Leads marketing with Sage"],
  sage:["Gets every site, shop, channel and profile to the top of search","Checks SEO every morning and night; settings refresh Mondays","Trains the team: lessons per teammate and checks they stick"],
  andy:["Runs Charleston 3D: product line, local market and the site launch","Finds 3D print ideas and builds legal print files (took over from Cole)","Passes products to Helen and Carla so they go live"],
  mike:["Runs both YouTube channels: Released Footage 6 AM and Funny Video Clips 7 AM (took over from Jake and Megan)","Checks every video for rights, accuracy and policy","Makes Shorts and tracks what's working"],
  sam:["Apps lead: specs, builds, tests and launches (took over from Ray, Kim and Leo)","Builds the Charleston 3D website and adds new products","Fixes bugs fast and keeps one app moving every day"],
  nora:["Market research every morning and The Lab Daily","Money tracking, launched-app updates, grants and events","Finds 5 app ideas a day with real demand (took over from Zoe)"],
  max:["Fixes bugs every hour and keeps this HQ working","Security sweep every night","Updates everyone's skills on Saturdays"]};
const DIVS=[["hq","Leadership"],["brand","Brand & Design"],["elevated","Elevated Designs & stores"],["c3d","Charleston 3D"],["studio","Studio · YouTube"],["apps","Apps"],["money","Money"],["marketing","Marketing & growth"],["lab","Research"]];
function dutiesOf(k){ const j=S.jobs[k]; return (j&&Array.isArray(j.duties)&&j.duties.length)?j.duties:(JOBS[k]||[(TEAM_BY[k]||{}).role||""]); }
function dmThread(key){
  const u=me().toLowerCase();
  return S.messages.filter(m=>(m.from===u&&m.to===key)||(m.from===key&&m.to===u)).sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-40);
}
function unreadDM(){ const u=me().toLowerCase(); let seen={}; try{ seen=JSON.parse(localStorage.getItem("ehq-dmseen-"+u)||"{}"); }catch{}
  return S.messages.filter(m=>m.to===u&&m.from==="steve"&&String(m.at)>(seen[m.from]||"")).length; }
function markDMSeen(key){ const u=me().toLowerCase(); try{ const seen=JSON.parse(localStorage.getItem("ehq-dmseen-"+u)||"{}"); seen[key]=new Date().toISOString(); localStorage.setItem("ehq-dmseen-"+u,JSON.stringify(seen)); }catch{} }

function onode(k){ const a=TEAM_BY[k]; if(!a) return ""; const st=S.agents[k]||{}; const live=st.lastRun&&(Date.now()-new Date(st.lastRun).getTime()<26*3600e3);
  return `<button type="button" class="onode ${S.dmSel===k?"sel":""}" data-dm="${esc(k)}" title="${esc((JOBS[k]||[a.role])[0])}"><span class="avatar${k==="steve"?" av-steph":""}">${esc(a.name[0])}<i class="dot ${live?"on":""}"></i></span><span style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="rl">${esc(a.role.split(" · ")[0])}</div></span></button>`; }
function orgMap(){
  const grp=(label,mgr,kids,subs="")=>`<div class="dl">${esc(label)}</div>${mgr?onode(mgr):""}${kids.length?`<div class="kids">${kids.map(onode).join("")}</div>`:""}${subs}`;
  const sub=(label,mgr,kids,subs="")=>`<div class="osub">${grp(label,mgr,kids,subs)}</div>`;
  const dept=(label,mgr,kids,subs="")=>`<div class="odept">${grp(label,mgr,kids,subs)}</div>`;
  return `<div class="omap"><div class="oyou">Aaron (owner) · Shana · Josh</div><div class="olink"></div>
    <div class="orow">${onode("steve")}</div>
    <div class="small muted" style="margin-top:8px;text-align:center">Everything reaches you through Stephanie · Helen chairs the nightly manager meeting</div>
    <div class="odepts">
      ${dept("Legal, money & tech","helen",["max"])}
      ${dept("Elevated Designs","vera",["lisa","carla"])}
      ${dept("Marketing & growth","tina",["sage"])}
      ${dept("Apps & research","sam",["nora"])}
      ${dept("Studio · YouTube","mike",[])}
      ${dept("Charleston 3D","andy",[])}
    </div></div>`;
}
function vComms(){
  if(!TEAM.some(x=>x.key===S.dmSel)) S.dmSel="steve"; S.roomSel=S.dmSel; const a=TEAM_BY[S.dmSel]; const st=S.agents[a.key]||{}; markDMSeen(a.key);
  const th=dmThread(a.key); const pending=(S.roomLog[a.key]||[]).slice(-1)[0];
  const board=S.messages.filter(m=>m.to==="all").sort((x,y)=>String(y.at).localeCompare(String(x.at))).slice(0,25);
  const nm=k=>k===me().toLowerCase()?"You":k==="aaron"?"Aaron":k==="shana"?"Shana":k==="josh"?"Josh":(TEAM_BY[k]?TEAM_BY[k].name:k);
  const dir=DIVS.map(([d,label])=>{ const people=TEAM.filter(x=>x.division===d); if(!people.length) return "";
    return `<div class="eyebrow" style="margin:14px 0 6px">${esc(label)}</div><div class="list">${people.map(p=>{ const ps=S.agents[p.key]||{};
      return `<div class="row" style="${p.key===a.key?"border-color:var(--accent);":""}cursor:pointer" data-dm="${esc(p.key)}" role="button" tabindex="0" aria-label="Message ${esc(p.name)}">
        ${av(p.key,"sm")}<div class="body"><div class="t">${esc(p.name)} <span class="muted small" style="font-weight:400">${esc(p.role)}</span></div>
        <div class="detail small">${esc(dutiesOf(p.key)[0]||"")}</div>
        <div class="meta">reports to ${esc(p.reports)} · ${esc(p.schedule)}${ps.lastRun?` · last worked ${ago(ps.lastRun)}`:""}</div></div></div>`; }).join("")}</div>`; }).join("");
  return `<section class="card" style="margin-bottom:20px"><div class="card-head"><h2>The team map</h2><span class="eyebrow">${TEAM.length} teammates · tap anyone to talk to them · green dot = worked today</span></div>${orgMap()}
    <details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Full job list</summary>${dir}</details></section>
  <div class="grid"><div class="col">
    <section class="card" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))"><div class="card-head"><div style="display:flex;gap:10px;align-items:center">${av(a.key)}<div><h2>${esc(a.name)}</h2><div class="small muted">${esc(a.role)} · reports to ${esc(a.reports)}</div></div></div></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><div class="eyebrow">What ${esc(a.name)} does</div>${S.jobEdit===a.key?"":`<button class="btn" type="button" id="jobEditBtn" style="margin-left:auto;padding:4px 10px;font-size:14px">Edit job</button>`}</div>
      ${S.jobEdit===a.key?`<form id="jobForm"><textarea id="jobText" rows="6" style="width:100%;box-sizing:border-box" aria-label="Job duties, one per line">${esc(dutiesOf(a.key).join("\n"))}</textarea>
        <p class="small muted" style="margin:4px 0 6px">One duty per line. Add, change or remove anything. When you save, Max rewrites ${esc(a.name)}'s instructions and picks the right skills for the new work, usually within the hour.</p>
        <div style="display:flex;gap:8px"><button class="btn primary" type="submit">Save job</button><button class="btn" type="button" id="jobCancel">Cancel</button></div></form>`
      :`<ul class="small" style="margin:0 0 4px;padding-left:18px">${dutiesOf(a.key).map(j=>`<li>${esc(j)}</li>`).join("")}</ul>
      ${S.jobs[a.key]?`<div class="meta" style="margin-bottom:8px">${S.jobs[a.key].status==="applied"?`Instructions updated ${ago(S.jobs[a.key].appliedAt)}${S.jobs[a.key].skills&&S.jobs[a.key].skills.length?" · skills: "+esc(S.jobs[a.key].skills.slice(0,5).join(", ")):""}`:S.jobs[a.key].status==="pending"?`Edited by ${esc(S.jobs[a.key].by||"")} · Max is updating ${esc(a.name)}'s instructions`:esc(S.jobs[a.key].note||"")}</div>`:""}`}
      <div class="meta" style="margin-bottom:10px">Works ${esc(a.schedule)}${st.lastSummary?` · latest: ${esc(st.lastSummary)}`:""}</div>
      <div class="answer" style="max-height:340px;overflow:auto;margin-bottom:8px" id="dmLog">${th.length?th.map(m=>`<div style="margin-bottom:8px"><b>${esc(nm(m.from))}:</b> ${esc(m.text)} <span class="muted small">· ${ago(m.at)}</span></div>`).join(""):`<span class="muted">No messages yet. Say hi, ask for an update, or give ${esc(a.name)} a job.</span>`}${pending&&pending.who==="you"?`<div class="muted small">${esc(a.name)} is typing…</div>`:""}</div>
      <form class="ask" id="roomForm"><input type="text" id="roomInput" placeholder="Message ${esc(a.name)}…" autocomplete="off" aria-label="Message ${esc(a.name)}"><button class="btn primary" type="submit" id="roomBtn">Send</button></form>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" type="button" id="roomUpdate">Get an update</button><button class="btn" type="button" data-kudos="${esc(a.key)}">Give kudos</button></div>
      <p class="small muted" style="margin:8px 0 0">${esc(a.name)} answers right away. Jobs you give get done on ${me()==="Aaron"?"the spot":"their next scheduled run"}.</p></section>
  </div><div class="col">
    <section class="card"><div class="card-head"><h2>Team board</h2><span class="eyebrow">posts everyone sees</span></div>
      <form class="ask" id="boardForm"><input type="text" id="boardInput" placeholder="Post to the whole team…" autocomplete="off" aria-label="Post to the whole team" maxlength="600"><button class="btn primary" type="submit">Post</button></form>
      <div class="list" style="margin-top:10px">${board.length?board.map(m=>`<div class="row"><div class="body"><div class="meta">${esc(nm(m.from))} · ${ago(m.at)}</div><div class="detail">${esc(m.text)}</div></div></div>`).join(""):`<div class="empty">Announcements for everyone go here. Stephanie reads the board every morning and passes jobs to the right people.</div>`}</div></section>
    ${changesCard()}
    <section class="card"><div class="card-head"><h2>Team chatter</h2><span class="eyebrow">handoffs between teammates</span></div>${teamChat()}</section>
  </div></div>`;
}

async function saveJob(key){
  const t=$("#jobText"); const lines=(t&&t.value||"").split("\n").map(x=>x.trim().replace(/^[-•*]\s*/,"")).filter(Boolean).slice(0,12).map(x=>x.slice(0,300));
  if(!lines.length){ toast("Add at least one duty."); return; } if(!db){ toast("Can't save in this view."); return; }
  try{ const ref=db.doc("jobs/"+key); const cur=await ref.get(); const prev=cur.exists?cur.data():null;
    await ref.set({duties:lines, previous:(prev&&prev.duties)||JOBS[key]||[], by:me().toLowerCase(), status:"pending", at:new Date().toISOString()});
    S.jobEdit=null; toast(`Saved. Max will update ${TEAM_BY[key].name}'s instructions.`);
    const tid=tidOf("max"); if(tid) fire(tid,`Job description change for ${key} (jobs/${key}) — apply it now.`); render();
  }catch{ toast("Couldn't save. Try again."); }
}
async function postBoard(){
  const i=$("#boardInput"); const t=(i&&i.value||"").trim(); if(!t) return; if(!db){ toast("Can't post in this view."); return; }
  try{ await db.collection("messages").add({from:me().toLowerCase(), to:"all", text:t.slice(0,600), at:new Date().toISOString()}); i.value=""; toast("Posted for the whole team.");
    const tid=tidOf("steve"); if(tid) fire(tid, `${me()} posted on the team board: "${t.slice(0,600)}". Route any jobs in it to the right teammates (requests), then reply on the board (messages to:"all").`);
  }catch{ toast("Couldn't post. Try again."); }
}

/* ---------- Ask Claude (quick personal questions) + Change requests ---------- */
const ABOUT_AARON=`About Aaron Lewis: a field service engineer (Italian machine manufacturer) in the Charleston, South Carolina area. He owns Elevated Designs LLC (single-member LLC with an IRS EIN) selling DTF-printed shirts and 3D prints on Etsy, a Shopify store that is opening, and local Charleston markets; about $200/month now, goal about $500k/year in 2 to 5 years. He is considering renaming or adding a DBA "Creative Lab Studios". He runs two YouTube channels: Released Footage (official police bodycam releases, daily 6 AM uploads, focused on views) and Funny Video Clips (daily 7 AM compilation plus Shorts). He builds phone-first web apps hosted on Cloudflare Pages (Hype Chain Maker, CareSync, Home Appliances, Nameplate Maker, Penny Wise, Fieldnote and others). He uses Holo for social posting, Kittl for design, Claude for an AI team of agents. He works as a field service engineer for an Italian machine manufacturer, is very tech-savvy, likes clean, dark, neutral interfaces packed with live stats, wants direct, practical answers and to be told exactly what to do next. Shana helps him run the business.`;

async function quickAsk(){
  const i=$("#qaskInput"); let q=(i&&i.value||"").trim(); const np=(ATT.qaskInput||[]).length; if(!q&&!np) return; if(!sample){ toast("Open Creative Lab Studios inside Claude to ask."); return; }
  if(!q) q="Take a look at this picture."; const pics=np?takeAtt("qaskInput"):[];
  S.askLog.push({who:"you",text:q+(pics.length?` 📷×${pics.length}`:"")}); i.value=""; render(); const b=$("#qaskBtn"); if(b) b.disabled=true;
  const convo=S.askLog.slice(-8).map(m=>(m.who==="you"?me():"Claude")+": "+m.text).join("\n");
  try{ const r=await sample(`You are Claude, answering a quick question from ${me()} inside their business HQ. ${ABOUT_AARON}
${me()==="Aaron"?"":me()+" helps Aaron run the business."} Use what's relevant about them to tailor the answer; ignore it when the question has nothing to do with them. Be direct and practical, plain sentences, under 160 words unless they ask for more. You cannot browse the web: if the answer depends on current prices, laws, availability or news, say what you know, say it may be out of date, and suggest tapping "Research it".
Conversation:
${convo}${picNote(pics.length)}
Claude:`,pics.length?{modelTier:"default",images:pics}:{modelTier:"default"});
    S.askLog.push({who:"claude",text:(r&&r.text||"").trim()||"I couldn't answer that. Try rephrasing."}); }
  catch(e){ S.askLog.push({who:"claude",text:e&&e.code==="not_granted"?"Allow Claude for this page in the Permissions menu, then ask again.":"I couldn't answer just now. Try again in a moment."}); }
  finally{ render(); const bb=$("#qaskBtn"); if(bb) bb.disabled=false; const l=$("#askLog"); if(l) l.scrollTop=l.scrollHeight; }
}
async function deepResearch(){
  const i=$("#qaskInput"); let q=(i&&i.value||"").trim(); if(!q){ const last=[...S.askLog].reverse().find(m=>m.who==="you"); q=last?last.text:""; }
  if(!q){ toast("Type what you want researched first."); return; } if(!db){ toast("Can't send in this view."); return; }
  try{ const ref=await db.collection("ideas").add({text:"Research request: "+q.slice(0,1000), kind:"research", by:me().toLowerCase(), status:"new", at:new Date().toISOString()}); if(i) i.value="";
    toast("Sent to Nora. Her answer lands in the Idea Lab."); const tid=tidOf("nora"); if(tid) fire(tid,`Research request ideas/${ref.id} from ${me()}: "${q.slice(0,500)}". This is a research question, not a product idea: research it on the web with current sources and answer it directly in the analysis (verdict = the answer, with sources). Handle it first.`); }
  catch{ toast("Couldn't send. Try again."); }
}
function changesCard(){
  const st={new:"waiting for Max",building:"Max is building it",done:"done",cant:"can't be done",needs:"Max has a question"};
  return `<section class="card" id="changes"><div class="card-head"><h2>Change this HQ</h2><span class="eyebrow">Max builds it</span></div>
    <form class="ask" id="chgForm"><input type="text" id="chgInput" placeholder="Describe a change: a new tab, a button, a layout fix…" autocomplete="off" maxlength="1500" aria-label="Describe a change to the HQ"><button class="btn primary" type="submit">Request</button></form>
    <p class="small muted" style="margin:6px 0 0">Max picks up requests within the hour, tests them on phone and desktop, then publishes.${IS_OWNER?" Urgent? Tap Build now on a request.":""}</p>
    ${S.changes.length?`<div class="list" style="margin-top:10px">${S.changes.slice(0,10).map(c=>`<div class="row"><div class="body"><div class="t" style="font-weight:500">${esc(String(c.text||"").slice(0,200))}</div>
      <div class="meta">${esc(c.by||"")} · ${ago(c.at)} · ${esc(st[c.status]||c.status||"")}</div>${c.result?`<div class="detail small">${esc(c.result)}</div>`:""}</div>
      ${IS_OWNER&&c.status==="new"?`<button class="btn" type="button" data-chgnow="${esc(c.id)}">${busyKey("max")?"Already running · queue":"Build now"}</button>`:""}</div>`).join("")}</div>`:""}</section>`;
}
async function requestChange(){
  const i=$("#chgInput"); const t=(i&&i.value||"").trim(); if(!t) return; if(!db){ toast("Can't save in this view."); return; }
  try{ await db.collection("changes").add({text:t.slice(0,1500), by:me().toLowerCase(), status:"new", at:new Date().toISOString()}); i.value=""; const ok=await fire(tidOf("max"),"Aaron just sent a console change request from the console box (collection changes, status new). Do it now."); toast(ok?"Max started on it now.":"Got it. Max picks it up on his next run."); }catch{ toast("Couldn't save. Try again."); }
}


function paperCard(){
  const n=S.news;
  if(!n) return `<section class="card"><div class="card-head"><h2>The Lab Daily</h2><span class="eyebrow">Nora · after midnight</span></div><div class="empty">Nora's next paper comes out after midnight: everything the team learned today, routed to who needs it. Every agent reads it before starting work.</div></section>`;
  return `<section class="card"><div class="card-head"><h2>The Lab Daily</h2><span class="eyebrow">${esc(n.date||"")} · Nora</span></div>
    <p style="font:700 18px/1.3 var(--f-display);margin:0 0 6px">${esc(n.headline||"")}</p><p class="small" style="margin:0 0 8px">${esc(n.summary||"")}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px"><button class="btn" type="button" id="hearPaper">Read it to me</button></div>
    <details><summary class="small muted" style="cursor:pointer">Full paper</summary>${(n.sections||[]).map(sec=>`<div class="eyebrow" style="margin:10px 0 4px">${esc(sec.title||"")}</div><ul class="small" style="margin:0;padding-left:18px">${(sec.items||[]).map(it=>{ const u=safeUrl(it.source); return `<li style="margin-bottom:4px">${esc(it.text||"")}${it.by&&TEAM_BY[it.by]?` <span class="muted">— ${esc(TEAM_BY[it.by].name)}</span>`:""}${u?` <a href="${esc(u)}" target="_blank" rel="noopener">source</a>`:""}</li>`; }).join("")}</ul>`).join("")}
    ${(n.watch||[]).length?`<div class="eyebrow" style="margin:10px 0 4px">Watching today</div><ul class="small" style="margin:0;padding-left:18px">${n.watch.map(w=>`<li>${esc(w)}</li>`).join("")}</ul>`:""}</details></section>`;
}

function appIdeasCard(){
  const all=S.appideas; const top=all.find(x=>x.status==="top"); const short=all.filter(x=>x.status==="shortlisted").sort((a,b)=>(a.rank||9)-(b.rank||9));
  const f=S.ideaRound||"all"; const rounds=[...new Set(all.map(x=>x.round||""))].sort().reverse();
  const tile=(x,big)=>{ const u=assetSrc(x.iconId,x.iconUrl); const sc=x.score||{}; const tot=["demand","money","ease","fit"].reduce((t,k)=>t+(+sc[k]||0),0);
    return `<div class="row clickable" data-ideaopen="${esc(x.id)}" role="button" tabindex="0" aria-label="${esc(x.name||"App idea")}: open details" style="align-items:flex-start">${u?`<img src="${esc(u)}" alt="" style="width:${big?64:44}px;height:${big?64:44}px;border-radius:${big?16:11}px;flex:none;object-fit:cover">`:`<span class="avatar">${esc(String(x.name||"?")[0])}</span>`}
      <div class="body"><div class="t">${esc(x.name||"")} ${tot?`<span class="pill">${Math.min(20,tot)}/20</span>`:""}</div><div class="detail small">${esc(x.oneLiner||"")}</div>
      ${big&&x.description?`<p class="small" style="margin:6px 0">${esc(x.description)}</p>`:""}
      ${x.theoNote?`<div class="meta"><b>Sam:</b> ${esc(String(x.theoNote).slice(0,240))}</div>`:""}
      <div class="meta">${esc(TEAM_BY[x.by]?TEAM_BY[x.by].name:x.by||"")} · ${esc(x.effort||"")}${x.monetization?` · ${esc(String(x.monetization).slice(0,80))}`:""}</div>
      ${["top","shortlisted","new"].includes(x.status||"new")?`<div style="display:flex;gap:6px;margin-top:6px"><button class="btn ${x.status==="new"?"":"primary"}" type="button" data-iapprove="${esc(x.id)}">Build it</button>${x.status==="new"?"":`<button class="btn" type="button" data-ipass="${esc(x.id)}">Pass</button>`}</div>`:x.status==="building"||x.status==="approved"?`<div class="meta" style="color:var(--accent)">Building · ${esc((S.apps.find(a=>a.ideaId===x.id)||{}).next||"Sam is on it")}</div>`:x.status?`<div class="meta">${esc(x.status)}</div>`:""}</div></div>`; };
  return `<section class="card" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))"><div class="card-head"><h2>App idea of the day</h2><span class="eyebrow">Nora → Sam → Stephanie</span></div>
    ${top?tile(top,true):`<div class="empty">Every evening Nora brings 5 app ideas with icons, backed by what people ask for and market data. Sam vets them at 6:30 AM and Stephanie presents the winner in your morning brief.</div>`}
    ${short.length?`<div class="eyebrow" style="margin:12px 0 4px">Runners-up</div><div class="list">${short.map(x=>tile(x)).join("")}</div>`:""}
    ${all.length?`<details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Idea library · ${all.length} ideas, all kept</summary>
      <div class="links" style="margin:8px 0">${["all",...rounds.slice(0,10)].map(r=>`<button class="btn" type="button" data-iround="${esc(r)}" ${f===r?'style="border-color:var(--accent);color:var(--accent)"':""}>${esc(r==="all"?"All":r)}</button>`).join("")}</div>
      <div class="list">${all.filter(x=>f==="all"||x.round===f).slice(0,60).map(x=>tile(x)).join("")}</div></details>`:""}</section>`;
}
const INFLIGHT=new Set();
async function decideIdea(id, ok){
  if(!db) return; if(INFLIGHT.has("idea:"+id)) return; INFLIGHT.add("idea:"+id); setTimeout(()=>INFLIGHT.delete("idea:"+id),8000); const x=S.appideas.find(i=>i.id===id); if(!x) return;
  const now=new Date().toISOString();
  try{
    if(!ok){ await db.doc("appideas/"+id).update({status:"passed", decidedBy:me().toLowerCase(), decidedAt:now}); toast("Passed. It stays in the idea library."); return; }
    const existing=S.apps.find(a=>a.ideaId===id);
    const appRef=existing?{id:existing.id}:await db.collection("apps").add({name:x.name||"New app", pitch:x.oneLiner||"", description:x.description||"", monetization:x.monetization||"", iconUrl:x.iconUrl||"", iconId:x.iconId||"", ideaId:id, source:"app idea of the day", stage:"idea", owner:"sam", next:"Sam is writing the spec", at:now, updatedAt:now});
    await db.doc("appideas/"+id).update({status:"building", appId:appRef.id, decidedBy:me().toLowerCase(), decidedAt:now});
    await addReq({for:"sam", by:me().toLowerCase(), what:`BUILD NOW: ${me()} tapped Build on app idea "${x.name}" (appideas/${id}, apps/${appRef.id}). Spec it this run and hand it to Sam.`, status:"open", at:now});
    const tid=tidOf("ray"); const started=tid?await fire(tid,`BUILD NOW: ${me()} approved app idea "${x.name}" (appideas/${id}). The apps doc apps/${appRef.id} is created at stage "idea". Write the spec this run, then assign Sam and fire him so building starts today.`):false;
    toast(started?`Sam is starting ${x.name} now.`:`Approved. Sam starts ${x.name} on his next run.`);
  }catch{ toast("Couldn't save. Try again."); }
}
function brandsCard(){
  const b=S.brands.slice().sort((x,y)=>(x.status==="considering"?0:1)-(y.status==="considering"?0:1));
  if(!b.length) return `<section class="card"><div class="card-head"><h2>Brands & names</h2><span class="eyebrow">Carla</span></div><div class="empty">Carla's brand register appears here: trademarks, domains and social handles for every brand.</div></section>`;
  const tmc=st=>/none found|ours/.test(st||"")?"ok":/possible/.test(st||"")?"warn":/registered/.test(st||"")?"bad":"";
  return `<details class="card bfold"><summary><span><b>Brands & names</b> <span class="muted small">· ${b.length} names · trademarks & domains · Carla & Helen</span></span></summary>
    <div class="bgrid">${b.map(x=>{ const tm=x.trademark||{}; const doms=(x.domains||[]).filter(d=>d.status==="available").map(d=>d.domain).slice(0,2);
      return `<div class="bcell"><div class="bn">${esc(x.name||"")}</div><div class="meta">${esc(x.kind||"")}${x.status?" · "+esc(x.status):""}</div>
        <span class="pill ${tmc(tm.status)}">${esc(tm.status||"not checked")}</span>${doms.length?`<div class="meta">Open: ${esc(doms.join(", "))}</div>`:""}
        ${x.verdict?`<div class="small muted">${esc(String(x.verdict).slice(0,120))}</div>`:""}</div>`; }).join("")}</div></details>`;
}
function trainingCard(){
  const tr=Object.fromEntries(S.training.map(t=>[t.id,t]));
  const keys=TEAM.map(a=>a.key).filter(k=>S.curriculum[k]||tr[k]);
  const head=`<div class="card-head"><h2>Training & skills</h2><span class="eyebrow">plans by role · coaches review Fridays · Sage SEO · Max skills Saturdays</span></div>`;
  if(!keys.length) return `<section class="card" id="training">${head}<div class="empty">Each teammate's training plan, coach notes and SEO lessons show here.</div></section>`;
  return `<section class="card" id="training">${head}<div class="list">${keys.map(k=>{ const a=TEAM_BY[k], t=tr[k]||{}, c=S.curriculum[k]||{}; const L=(t.seoLessons&&Array.isArray(t.seoLessons.lessons))?t.seoLessons.lessons:[]; const ck=Array.isArray(t.seoChecks)?t.seoChecks.slice(-10):[]; const pass=ck.filter(x=>x.pass).length; const cn=t.coachNotes||null; const coach=TEAM_BY[c.coach]?TEAM_BY[c.coach].name:"";
    return `<div class="row">${av(k,"sm")}<div class="body"><div class="t">${esc(a.name)} <span class="muted small" style="font-weight:400">${esc(c.role||a.role)}${coach?` · coach ${esc(coach)}`:""}${cn?` · coached ${ago(cn.at)}`:""}${ck.length?` · SEO checks ${pass}/${ck.length}`:""}</span></div>
      ${c.measure?`<div class="meta">Measured by: ${esc(c.measure)}</div>`:""}
      <details style="margin-top:4px"><summary class="small" style="cursor:pointer;color:var(--accent)">Training plan${L.length?` · ${L.length} SEO lessons`:""}${cn&&(cn.fixes||[]).length?` · ${cn.fixes.length} coach fixes`:""}</summary>
        ${(c.competencies||[]).length?`<div class="small" style="margin-top:4px"><b>Learns</b></div><ul class="small" style="margin:2px 0;padding-left:18px">${c.competencies.map(x=>`<li>${esc(String(x))}</li>`).join("")}</ul>`:""}
        ${(c.skills||t.skills||[]).length?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0">${(c.skills||t.skills).slice(0,8).map(x=>`<span class="pill">${esc(String(x))}</span>`).join("")}</div>`:""}
        ${cn&&(cn.fixes||[]).length?`<div class="small"><b>Coach's fixes</b></div><ul class="small" style="margin:2px 0;padding-left:18px">${cn.fixes.slice(0,3).map(x=>`<li>${esc(String(x))}</li>`).join("")}</ul>`:""}
        ${L.length?`<div class="small"><b>SEO lessons</b></div><ul class="small" style="margin:2px 0;padding-left:18px">${L.map(x=>`<li>${esc(String(x.title||""))}</li>`).join("")}</ul>`:""}
      </details></div></div>`; }).join("")}</div></section>`;
}
function healthCard(){
  const mt=S.maint; const {open,waiting}=bugSplit();
  return `<section class="card" id="health"><div class="card-head"><h2>Team health</h2><span class="eyebrow">Max</span></div>
    <div class="row" style="border:0;padding:0">${av("max","sm")}<div class="body"><div class="t">Maintenance · ${open.length} open${waiting.length?` · ${waiting.length} waiting on you`:""}</div><div class="detail small">${mt&&mt.summary?esc(mt.summary):"Max checks for bugs every hour and runs a security sweep nightly."}</div>
    ${open.concat(waiting).slice(0,3).map(b=>`<div class="meta">• ${esc(String(b.title||"").slice(0,90))} · ${b.status==="needs-aaron"?"waiting on you":esc(b.status||"open")}</div>`).join("")}</div></div>
    <form class="ask" id="bugForm" style="margin-top:10px"><input type="text" id="bugInput" placeholder="Report a bug or problem for Max…" autocomplete="off" maxlength="800" aria-label="Report a bug"><button class="btn" type="submit">Report</button></form></section>`;
}
function bugSplit(){ const open=[], waiting=[]; S.bugs.forEach(b=>{ const st=String(b.status||"open"); if(st==="needs-aaron") waiting.push(b); else if(st!=="fixed"&&st!=="wontfix") open.push(b); }); return {open,waiting}; }
async function reportBug(){ const i=$("#bugInput"); const t=(i&&i.value||"").trim(); if(!t) return; if(!db){ toast("Can't save in this view."); return; }
  try{ await db.collection("bugs").add({title:t.slice(0,120), detail:t.slice(0,800), where:"reported from the HQ", reportedBy:me().toLowerCase(), severity:"med", status:"open", at:new Date().toISOString()}); i.value=""; toast("Max has it. He checks every hour."); }catch{ toast("Couldn't save. Try again."); } }

/* ---------- Designs: daily drops → Vera shortlists → Helen proposes → you decide ---------- */
/* Each business owns its own listings and designs: Charleston 3D = charleston-3d-prints, Elevated Designs = everything else (apparel brands). */
const BIZ_NAME={ed:"Elevated Designs",c3d:"Charleston 3D"};
function designBiz(d){ return d&&d.brand==="charleston-3d-prints"?"c3d":"ed"; }
function listingBiz(l){ return l&&(l.biz==="c3d"||l.brand==="charleston-3d-prints")?"c3d":"ed"; }
const BRANDS={"elevated-designs":"Elevated Designs","little-porch-apparel":"Little Porch Apparel","charleston-3d-prints":"Charleston 3D Prints","creative-lab-studios":"Creative Lab Studios","funny-video-clips":"Funny Video Clips"};
function assetSrc(id,url){ const m=String(id||"").match(/^[0-9a-f]{32}$/)||String(url||"").match(/[0-9a-f]{32}/); return m?"/_blob/"+m[0]:safeImg(url); }
function dcard(d,actions){ const u=assetSrc(d.imageId,d.imageUrl); const who=TEAM_BY[d.by]?TEAM_BY[d.by].name:(d.by||"");
  return `<div class="dcard">${u?`<img src="${esc(u)}" alt="${esc(d.title||"Design")}" loading="lazy">`:`<div class="noimg">no image yet</div>`}
    <div class="dt"><b>${esc(d.title||"Untitled")}</b><div class="meta">${[BRANDS[d.brand]||d.brand,d.product,d.style,who].filter(Boolean).map(x=>esc(String(x))).join(" · ")}</div>
    ${actions||""}
    ${d.concept?`<div class="small">${esc(String(d.concept).slice(0,160))}</div>`:""}
    ${d.basedOn?`<div class="meta">Inspired by: ${esc(String(d.basedOn).slice(0,120))}</div>`:""}
    ${d.veraNote?`<div class="meta"><b>Vera:</b> ${esc(String(d.veraNote).slice(0,160))}</div>`:""}
    ${d.helenNote?`<div class="meta"><b>Helen:</b> ${esc(String(d.helenNote).slice(0,160))}</div>`:""}
    <div class="dexp"><span class="meta">Export</span><button class="btn" type="button" data-dexport="${esc(d.id)}" data-fmt="png">PNG</button><button class="btn" type="button" data-dexport="${esc(d.id)}" data-fmt="svg">${d.svgId||d.svgUrl?"SVG vector":d.vectorAskedAt?"SVG (making…)":"SVG vector"}</button></div></div></div>`; }
/* compact library tile: picture, title, status; tap opens the full card with the review controls */
const DSTAT={approved:"ok",passed:"",changes:"warn",proposed:"acc",shortlisted:"acc",submitted:"",revised:""};
function dtile(d){ const u=assetSrc(d.imageId,d.imageUrl);
  return `<button type="button" class="ltile2" data-dopen="${esc(d.id)}">${u?`<img src="${esc(u)}" alt="" loading="lazy">`:`<span class="noimg">no image</span>`}<span class="lt-t">${esc(String(d.title||"Untitled").slice(0,60))}</span><span class="pill ${DSTAT[d.status]||""}">${esc(d.status||"new")}</span></button>`; }
function openDesignCard(id){ const d=S.designs.find(x=>x.id===id); if(!d) return; const prev=document.activeElement;
  const box=document.createElement("div"); box.className="pinbox"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-label",d.title||"Design");
  const paint=()=>{ box.innerHTML=`<section class="card dmodal"><div class="card-head"><h2>${esc(d.title||"Design")}</h2>${typeof packBtn==="function"?packBtn("design",id,"Export pack"):""}<button class="btn" type="button" data-dclose>Close</button></div>${dcard(S.designs.find(x=>x.id===id)||d,designReview(S.designs.find(x=>x.id===id)||d))}</section>`;
    box.querySelector("[data-dclose]").onclick=close;
    box.querySelectorAll("[data-dapprove]").forEach(b=>b.onclick=async()=>{ await decideDesign(b.dataset.dapprove,true); close(); });
    box.querySelectorAll("[data-dpass]").forEach(b=>b.onclick=async()=>{ await decideDesign(b.dataset.dpass,false); close(); });
    box.querySelectorAll("[data-dchform]").forEach(f=>f.onsubmit=async e=>{ e.preventDefault(); await submitDesignChangeInline(f); close(); });
    box.querySelectorAll("[data-dexport]").forEach(t=>t.onclick=()=>exportDesign(t.dataset.dexport,t.dataset.fmt,t)); };
  const onKey=e=>{ if(e.key==="Escape") close(); };
  const close=()=>{ document.removeEventListener("keydown",onKey); box.remove(); try{prev&&prev.focus()}catch{} };
  paint(); document.body.appendChild(box); document.addEventListener("keydown",onKey); box.addEventListener("click",e=>{ if(e.target===box) close(); });
  setTimeout(()=>{ const c=box.querySelector("[data-dclose]"); if(c) c.focus(); },30); }
/* export a design: PNG at its full stored size, or the max-size SVG vector (made by Lisa with Kittl's free vectorizer when it doesn't exist yet) */
function dslug(d){ return String(d.title||"design").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").slice(0,60)||"design"; }
async function exportDesign(id,fmt,btn){ const d=S.designs.find(x=>x.id===id); if(!d) return;
  if(!downloads){ toast("Downloads work when the console is open in Claude."); return; }
  const k="dexp:"+id+fmt; if(INFLIGHT.has(k)) return; INFLIGHT.add(k); if(btn) btn.disabled=true;
  try{
    let src=fmt==="svg"?assetSrc(d.svgId,d.svgUrl):assetSrc(d.printId||d.imageId,d.printUrl||d.imageUrl);
    if(fmt==="svg"&&!src){
      if(!db){ toast("Can't save from this view."); return; }
      if(d.vectorAskedAt&&Date.now()-new Date(d.vectorAskedAt).getTime()<3*3600e3){ toast("Lisa is still making the vector. It downloads from here once it's ready."); return; }
      const now=new Date().toISOString(); await db.doc("designs/"+id).update({vectorAskedAt:now, vectorAskedBy:me().toLowerCase()});
      const what=`VECTOR EXPORT for ${me()}: make a maximum-size SVG of design "${d.title}" (designs/${id}). Start from the largest version you have (the original print file, else the image; if it's under 3000 px on its long side, upscale it first with kittl-upscale-image). Vectorize with kittl-vectorize-image (color solver, colorCount 16; it's free), check the SVG keeps the lettering and fine lines clean (redo with fewer colors if it's noisy), upload the SVG to the console assets, then update only designs/${id}.svgId (asset id) and svgUrl (/_blob/... exactly) and vectorAt. Never spend Kittl tokens without saying so in the request result.`;
      await addReq({for:"lisa", by:me().toLowerCase(), what, design:id, status:"open", at:now});
      const t=tidOf("lisa"); const woke=t?await fire(t,what):false; toast(woke?"Lisa is making the full-size vector now. Tap SVG again when it's ready.":"Sent to Lisa for her next run. Tap SVG again when it's ready."); return; }
    if(!src){ toast("This design has no image yet."); return; }
    const r=await fetch(src); if(!r.ok) throw new Error("fetch "+r.status); const b=await r.blob();
    const ext=fmt==="svg"?"svg":(/jpe?g/.test(b.type)?"jpg":/webp/.test(b.type)?"webp":"png");
    await downloads.save({filename:dslug(d)+(fmt==="svg"?"-vector":"-full")+"."+ext, data:b});
  }catch(e){ if(!e||e.code!=="cancelled"){ console.error("export",e); toast("Couldn't export that. Try again."); } }
  finally{ INFLIGHT.delete(k); if(btn) btn.disabled=false; } }
function vDesign(){
  const biz=S.biz==="c3d"?"c3d":"ed", bn=BIZ_NAME[biz]; const all=S.designs.filter(d=>designBiz(d)===biz);
  const scopeBrands=Object.entries(BRANDS).filter(([k])=>designBiz({brand:k})===biz); if(S.designFilter&&S.designFilter!=="all"&&!scopeBrands.some(([k])=>k===S.designFilter)) S.designFilter="all";
  const proposed=all.filter(d=>d.status==="proposed"); const short=all.filter(d=>d.status==="shortlisted"); const approved=all.filter(d=>d.status==="approved"); const changing=all.filter(d=>d.status==="changes");
  const today=dayKey(new Date()); const fresh=all.filter(d=>(d.round||dayKey(d.at||0))===today).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const latest=fresh.length?fresh:all.slice().sort((a,b)=>String(b.at||b.round).localeCompare(String(a.at||a.round))).slice(0,6);
  const f=S.designFilter||"all"; const lib=all.filter(d=>f==="all"||d.brand===f);
  const rounds=[...new Set(all.map(d=>d.round||""))].sort().reverse();
  const stat=d=>designReview(d);
  return `<div class="grid"><div class="col">
      <section class="card" id="d-new" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))"><div class="card-head"><h2 class="big">${fresh.length?`New today · ${esc(bn)}`:`Latest ${esc(bn)} designs`}</h2><span class="eyebrow">${fresh.length?`${fresh.length} made today`:"nothing new yet today"} · ${biz==="c3d"?"Andy":"Lisa & Vera"}</span></div>
        ${latest.length?`<div class="dgrid dbig">${latest.map(d=>dcard(d,stat(d))).join("")}</div>`:`<div class="empty">${biz==="c3d"?"Andy brings new 3D print ideas every morning.":"Lisa draws 6 designs every morning at 8:45 and Vera brings fresh ideas."}</div>`}</section>
      <section class="card" id="d-picks"><div class="card-head"><h2>Your ${esc(bn)} picks to decide</h2><span class="eyebrow">Helen narrowed these from Vera's shortlist</span></div>
        ${proposed.length?`<div class="dgrid dbig">${proposed.map(d=>dcard(d,stat(d))).join("")}</div>`:`<div class="empty">Nothing waiting. Helen brings the final 1–3 after her 10 PM meeting.</div>`}</section>
    </div><div class="col">
      ${changing.length?`<section class="card"><div class="card-head"><h2>Being changed</h2><span class="eyebrow">back to you when redrawn</span></div><div class="dgrid">${changing.map(d=>dcard(d,`<div class="meta" style="margin-top:4px"><b>You asked:</b> ${esc(String(d.aaronNote||"").slice(0,200))}</div>`)).join("")}</div></section>`:""}
      <section class="card"><div class="card-head"><h2>${biz==="c3d"?"Andy's shortlist":"Vera's shortlist"}</h2><span class="eyebrow">${short.length} waiting on Helen</span></div>${short.length?`<div class="dgrid">${short.map(d=>dcard(d)).join("")}</div>`:`<div class="empty">${biz==="c3d"?"Andy shortlists the best 3D ideas after his morning run.":"Vera shortlists every day at 11:40 AM."}</div>`}</section>
      <section class="card"><div class="card-head"><h2>Approved</h2><span class="eyebrow">going to the shops</span></div>${approved.length?`<div class="dgrid">${approved.slice(0,12).map(d=>dcard(d)).join("")}</div>`:`<div class="empty">${biz==="c3d"?"3D designs you approve land here; Andy gets them listed.":"Designs you approve land here; Carla lists them."}</div>`}</section>
      ${desk("design")}
    </div></div>
    <section class="card" id="d-lib" style="margin-top:20px"><div class="card-head"><h2>${esc(bn)} design library</h2><span class="eyebrow">${all.length} designs · everything is kept</span></div>
      <div class="links" style="margin-bottom:10px">${scopeBrands.length<2?"":[["all","All brands"],...scopeBrands].map(([k,v])=>`<button class="btn" type="button" data-dfilter="${esc(k)}" ${f===k?'style="border-color:var(--accent);color:var(--accent)"':""}>${esc(v)}</button>`).join("")}</div>
      ${typeof qpBulkBar==="function"?qpBulkBar(biz,lib):""}
      ${lib.length?rounds.map((r,ri)=>{ const items=lib.filter(d=>(d.round||"")===r); if(!items.length) return ""; return `<details class="lround"${ri===0?" open":""}><summary><b>${esc(r||"Earlier")}</b> <span class="muted small">· ${items.length} design${items.length===1?"":"s"}</span></summary><div class="ltiles">${items.map(d=>typeof dtileSel==="function"?dtileSel(d):dtile(d)).join("")}</div></details>`; }).join("")
      :`<div class="empty">The next designs arrive tomorrow at 8:45 AM from Lisa.</div>`}</section>`;
}
/* review controls on a design card: Approve, Pass, or type what to change right on the card */
function designReview(d){ const id=esc(d.id), st=String(d.status||"");
  if(st==="changes") return `<div class="drev"><span class="pill warn">being changed</span>${d.aaronNote?`<div class="meta"><b>You asked:</b> ${esc(String(d.aaronNote).slice(0,200))}</div>`:""}</div>`;
  if(st==="revised") return `<div class="drev"><span class="meta">replaced by a revised version</span></div>`;
  const done=st==="approved"?`<span class="pill ok">approved</span>`:st==="passed"?`<span class="pill">passed</span>`:"";
  const btns=st==="approved"?"":`<button class="btn primary" type="button" data-dapprove="${id}">Approve</button>`+(st==="passed"?"":`<button class="btn" type="button" data-dpass="${id}">Pass</button>`);
  return `<div class="drev">${done||btns?`<div class="drevb">${done}${btns}</div>`:""}
    <form class="drevf" data-dchform="${id}"><input type="text" maxlength="1200" placeholder="Ask for a change…" aria-label="Ask for a change to ${esc(d.title||"this design")}"><button class="btn" type="submit">Send</button></form></div>`; }
async function sendDesignChange(id,t){
  const d=S.designs.find(x=>x.id===id); if(!d||!db) throw new Error("unavailable");
  const now=new Date().toISOString(), who=me(), whoKey=who.toLowerCase();
  const hist=Array.isArray(d.changeRequests)?d.changeRequests.slice(-9):[];
  await db.doc("designs/"+id).update({status:"changes", aaronNote:t.slice(0,1200), changeRequests:[...hist,{text:t.slice(0,1200),by:whoKey,at:now}], decidedBy:whoKey, decidedAt:now});
  const req=`CHANGE REQUEST from ${who} on design "${d.title}" (designs/${id}): ${t.slice(0,1200)}. ${who} likes this design: keep everything else the same and fix only what's asked. Draw the revised version, look at it closely, upload it, and save it as a NEW designs doc (id like lisa-YYYYMMDD-c1) with the same brand/product, title "${String(d.title||"").replace(/\s*v\d+.*$/,"")} (revised)", redoOf:"${id}", basedOn "Change request from ${who}", status:"proposed" (it goes straight back to ${who}'s picks, skipping the shortlist), and a helenNote line saying what changed. Then set designs/${id}.status to "revised" and tell Vera what changed.`;
  await addReq({for:"lisa", by:whoKey, what:req, design:id, status:"open", at:now});
  const tid=tidOf("lisa"); return tid?await fire(tid,req):false; }
async function submitDesignChangeInline(f){ const id=f.dataset.dchform, inp=f.querySelector("input"), t=(inp.value||"").trim();
  if(!t){ inp.focus(); toast("Type what should change first."); return; } if(!db){ toast("Can't save in this view."); return; }
  const k="dch:"+id; if(INFLIGHT.has(k)) return; INFLIGHT.add(k); setTimeout(()=>INFLIGHT.delete(k),8000);
  const b=f.querySelector("button"); b.disabled=true;
  try{ const woke=await sendDesignChange(id,t); inp.value=""; toast(woke?"Sent. Lisa is redrawing it now.":"Sent. Lisa redraws it on her next run."); }
  catch(err){ console.error("design change",err); toast("Couldn't save. Try again."); INFLIGHT.delete(k); }
  finally{ b.disabled=false; } }
async function decideDesign(id, ok){
  if(!db) return; const d=S.designs.find(x=>x.id===id); if(!d) return;
  try{ await db.doc("designs/"+id).update({status:ok?"approved":"passed", decidedBy:me().toLowerCase(), decidedAt:new Date().toISOString()});
    toast(ok?"Approved. Helen will send it to Carla.":"Passed. It stays in the library.");
    if(ok){ await addReq({for:"helen", by:me().toLowerCase(), what:`${me()} approved design "${d.title}" (designs/${id}). Send it to Carla to list and add to the web page.`, status:"open", at:new Date().toISOString()}); fire(tidOf("carla"),`Aaron approved design "${d.title}" (designs/${id}). Prepare its listing now (draft; Etsy posting needs Aaron's fee OK).`); }
  }catch{ toast("Couldn't save. Try again."); }
}

/* Change it: keep the design, send it back to Lisa with what to fix; the redraw comes straight back to "Your picks". */
function openDesignChange(id){
  const d=S.designs.find(x=>x.id===id); if(!d) return; if(!db){ toast("Can't save in this view."); return; }
  const u=assetSrc(d.imageId,d.imageUrl); const prev=document.activeElement;
  const box=document.createElement("div"); box.className="pinbox"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-labelledby","dchTitle");
  box.innerHTML=`<section class="card" style="width:min(460px,100%)"><div class="card-head"><h2 id="dchTitle">Change "${esc(d.title||"this design")}"</h2></div>
    ${u?`<img src="${esc(u)}" alt="" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px;background:var(--raise);margin-bottom:10px">`:""}
    <p class="small muted" style="margin:0 0 8px">Say what to fix. Lisa keeps everything else the same and brings the new version back to you.</p>
    <form id="dchForm" style="display:flex;flex-direction:column;gap:8px"><textarea id="dchText" maxlength="1200" aria-label="What should change?" placeholder="e.g. Love it, but the tree is wrong. Make it a real palmetto like the SC flag."></textarea>
    <div class="lock-msg" id="dchMsg"></div><div style="display:flex;gap:8px"><button class="btn primary" type="submit">Send to Lisa</button><button class="btn" type="button" id="dchCancel">Cancel</button></div></form></section>`;
  document.body.appendChild(box); setTimeout(()=>{ const t=$("#dchText"); if(t) t.focus(); },50);
  const onKey=e=>{ if(e.key==="Escape") close(); };
  const close=()=>{ document.removeEventListener("keydown",onKey); box.remove(); try{prev&&prev.focus()}catch{} };
  $("#dchCancel").onclick=close; document.addEventListener("keydown",onKey); box.addEventListener("click",e=>{ if(e.target===box) close(); });
  $("#dchForm").onsubmit=async e=>{ e.preventDefault(); const t=$("#dchText").value.trim(); if(!t){ $("#dchMsg").textContent="Type what should change first."; return; }
    const k="dch:"+id; if(INFLIGHT.has(k)) return; INFLIGHT.add(k); setTimeout(()=>INFLIGHT.delete(k),8000);
    try{ const woke=await sendDesignChange(id,t);
      close(); toast(woke?"Sent. Lisa is redrawing it now.":"Sent. Lisa redraws it on her next run.");
    }catch(err){ console.error("design change",err); $("#dchMsg").textContent="Couldn't save. Try again."; INFLIGHT.delete(k); } };
}

/* ---------- live stats: ticker, pulse charts, agent status ---------- */
function agentState(k){ const st=S.agents[k]||{}; const tr=st.triggerId?S.triggers[st.triggerId]:null; const ls_=tr&&tr.last_run&&tr.last_run.status||"";
  if(tr&&!tr.enabled) return ["idle","Paused"]; if(/FAIL/.test(ls_)) return ["bad","Last run failed"]; if(/PEND|RUNN/.test(ls_)) return ["run","Running now"];
  const t=st.lastRun?new Date(st.lastRun).getTime():0; if(/SUCC/.test(ls_)||(t&&Date.now()-t<26*3600e3)) return ["ok","Worked recently"]; return ["idle","Waiting for first run"]; }
const ST_ICON={ok:"✓",run:"↻",bad:"!",idle:""};
function dayKey(d){ const x=new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); }
function tickerStrip(){
  const now=Date.now(), today=dayKey(now); const isT=x=>(x.round||dayKey(x.at||0))===today;
  const states=TEAM.map(a=>agentState(a.key)[0]); const onDuty=states.filter(x=>x==="ok"||x==="run").length; const failing=states.filter(x=>x==="bad").length;
  const approvals=S.designs.filter(d=>d.status==="proposed").length+S.printideas.filter(x=>x.status==="shortlisted").length+S.appideas.filter(x=>x.status==="top").length+S.billchanges.filter(c=>c.status==="pending").length+S.questions.filter(q=>q.status!=="answered").length+S.apps.filter(x=>appStage(x)==="review").length;
  const bs=bugSplit(); const blocked=S.huddle.filter(h=>h.date===today&&h.blocked&&String(h.blocked).trim()).length;
  const mo=b=>{ const n=parseFloat(String(b.amount).replace(/[^0-9.]/g,"")); if(isNaN(n)) return 0; return b.cycle==="yearly"?n/12:b.cycle==="weekly"?n*4.33:n; };
  const spend=S.bills.filter(b=>b.status!=="canceled").reduce((t,b)=>t+mo(b),0);
  const pi=S.printideas.filter(isT);
  const vids=S.queue.filter(q=>/Released Footage|Funny Video Clips|ElevatedNewsflash/.test(q.platform||"")&&dayKey(q.at||q.when||0)===today).length;
  const G=[ ["Designs today", S.designs.filter(isT).length, 6, "ed", "design:ed#d-new"],
    ["3D print ideas", pi.length, 8, "c3d", "c3d#c3d-ideas"],
    ["3D files built", pi.filter(x=>(x.files||[]).length).length, 3, "c3d", "c3d#c3d-ideas", pi.filter(x=>x.path==="re-engineered"&&(x.files||[]).length).length+" re-engineered"],
    ["Ads built", S.ads.filter(isT).length, 10, "money", "growth#g-ads", S.videos.filter(isT).length+" short videos"],
    ["Listings ready", S.listings.filter(l=>l.status==="ready"&&dayKey(l.at||0)===today).length, 2, "ed", "listings#l-list"],
    ["Videos & Shorts", vids, 6, "studio", "studio#s-queue"],
    ["App ideas", S.appideas.filter(isT).length, 5, "apps", "apps#a-ideas"] ];
  const tile=([l,v,goal,c,go,sub])=>{ const pct=Math.min(100,Math.round(v/goal*100)); return `<button class="sc" type="button" data-goto="${go}" style="--tag:var(--c-${c})" data-tip="${esc(l)}: ${v} of ${goal} today">
      <span class="sc-l">${esc(l)}</span><span class="sc-v">${v}<small>/${goal}</small></span><span class="sc-bar"><i style="width:${pct}%"></i></span><span class="sc-s">${sub?esc(sub):pct>=100?"goal hit ✓":`${goal-v} to go today`}</span></button>`; };
  const t=(label,val,sub,go,cls)=>`<button class="tk mini" type="button" data-goto="${go}"><span class="l">${esc(label)}</span><span class="v">${esc(String(val))}</span>${sub?`<span class="s ${cls||""}">${esc(sub)}</span>`:""}</button>`;
  const done=G.filter(g=>g[1]>=g[2]).length;
  const live=S.listings.filter(l=>l.status==="posted").length;
  /* Simplified Home: four numbers that matter; everything else lives in folds below */
  const kpis=`<div class="kpi4">${t("Waiting on you",approvals,approvals?"tap to review":"all clear","overview#decide",approvals?"dn":"up")}${t("Listings live",live,"on your stores","listings#l-list")}${t("Team on duty",`${onDuty}/${TEAM.length}`,failing?`${failing} failing`:blocked?`${blocked} blocked`:bs.open.length?`${bs.open.length} open bugs`:"no problems","overview#team",(failing||blocked)?"dn":"up")}${t("Monthly spend","$"+spend.toFixed(0),"all subscriptions","money")}</div>`;
  const goals=`<div class="score" role="list" aria-label="Today's output">${G.map(tile).join("")}</div>`;
  return {kpis, goals, done, total:G.length, approvals};
}
function pulseCard(){
  const now=new Date(); const days=[...Array(14)].map((_,i)=>{ const d=new Date(now); d.setDate(d.getDate()-13+i); return dayKey(d); });
  const counts=days.map(k=>S.activity.filter(a=>dayKey(a.at)===k).length); const max=Math.max(1,...counts); const tot=counts.reduce((a,b)=>a+b,0);
  const fmt=k=>new Date(k+"T12:00").toLocaleDateString([], {month:"short",day:"numeric"});
  const bars=`<div class="bars" role="img" aria-label="Work logged per day, last 14 days, total ${tot}">${days.map((k,i)=>`<div class="b" data-tip="${fmt(k)}: ${counts[i]} item${counts[i]===1?"":"s"} logged"><i style="height:${Math.round(counts[i]/max*100)}%"></i></div>`).join("")}</div>
    <div class="bars-x"><span>${fmt(days[0])}</span><span>${fmt(days[7])}</span><span>Today</span></div>`;
  const wk=S.activity.filter(a=>Date.now()-new Date(a.at).getTime()<7*864e5);
  const divs=[["hq","Leadership"],["studio","Studio"],["elevated","Elevated & stores"],["c3d","Charleston 3D"],["apps","Apps"],["brand","Brand & design"],["money","Money"],["lab","Research"]].map(([d,l])=>[l,wk.filter(a=>(TEAM_BY[a.agent]||{}).division===d).length]).sort((a,b)=>b[1]-a[1]);
  const dmax=Math.max(1,...divs.map(x=>x[1]));
  const hb=divs.map(([l,n])=>`<div class="hbar" data-tip="${esc(l)}: ${n} this week"><span>${esc(l)}</span><span class="t"><i style="width:${Math.round(n/dmax*100)}%"></i></span><span class="n">${n}</span></div>`).join("");
  const tiles=TEAM.map(a=>{ const [c,lab]=agentState(a.key); const st=S.agents[a.key]||{};
    return `<button class="atile" type="button" data-dm="${esc(a.key)}" data-tip="${esc(a.name)} · ${esc(a.role.split(" · ")[0])} — ${esc(lab)}${st.lastRun?" · "+esc(ago(st.lastRun)):""}"><span class="st ${c}" aria-hidden="true">${ST_ICON[c]}</span><span class="nm">${esc(a.name)}</span><span class="sr-only">${esc(lab)}</span></button>`; }).join("");
  return `<section class="card"><div class="card-head"><h2>System pulse</h2><span class="eyebrow">live · hover any bar or tile</span></div>
    <div class="pulse"><div><div class="eyebrow" style="margin-bottom:4px">Work logged per day · last 14 days · ${tot} total</div>${bars}</div>
      <div><div class="eyebrow" style="margin-bottom:4px">This week by department</div>${hb}</div></div>
    <div class="eyebrow" style="margin:18px 0 8px">Agent status · tap anyone to talk to them</div><div class="agrid">${tiles}</div>
    <div class="legend"><span><i class="st ok" style="width:14px;height:14px;border-radius:50%;display:inline-flex;font-size:9px;align-items:center;justify-content:center;color:#fff">✓</i>Worked recently</span><span><i class="st run" style="width:14px;height:14px;border-radius:50%;display:inline-flex;font-size:9px;align-items:center;justify-content:center;color:#fff">↻</i>Running now</span><span><i class="st bad" style="width:14px;height:14px;border-radius:50%;display:inline-flex;font-size:9px;align-items:center;justify-content:center;color:#fff">!</i>Last run failed</span><span><i class="st idle" style="width:14px;height:14px;border-radius:50%;display:inline-block"></i>Waiting</span></div></section>`;
}
/* ---------- command palette (Ctrl/Cmd + K) ---------- */
const TABS=(()=>{ const out=[], seen=new Set(); const add=(k,l)=>{ if(seen.has(k)) return; seen.add(k); out.push([k,l]); };
  SUBJECTS.forEach(sj=>sj.pages.forEach(([l,d])=>add(d,(sj.k==="home"&&d==="overview")?"Home":sj.name+" ▸ "+l)));
  [["schedules","Team ▸ Schedules"],["comms","Team ▸ Messages"],["sysmap","Team ▸ System map"],["research","Research ▸ Overview"]].forEach(([k,l])=>add(k,l));
  return out; })();
let CMDK=null;
function cmdkItems(q){ q=q.trim().toLowerCase();
  const items=[...TABS.map(([k,l])=>({label:l,kind:"Go to",run:()=>goTab(k)})),
    ...TEAM.map(a=>({label:a.name+" — "+a.role.split(" · ")[0],kind:"Talk to",run:()=>{ S.dmSel=a.key; goTab("comms"); }})),
    {label:"Switch light / dark mode",kind:"Action",run:toggleTheme},{label:"Ask Claude a quick question",kind:"Action",run:()=>{ goTab("overview"); setTimeout(()=>{ const i=$("#qaskInput"); if(i) i.focus(); },60); }},
    {label:"Report a bug",kind:"Action",run:()=>{ goTab("overview"); setTimeout(()=>{ const i=$("#bugInput"); if(i){ i.scrollIntoView({block:"center"}); i.focus(); } },60); }},
    {label:"Open quick access (links & notepad)",kind:"Action",run:()=>{ const b=$("#qaOpen"); if(b) b.click(); }},
    {label:"Lock the screen",kind:"Action",run:()=>showLock("")}];
  const base=q?items.filter(x=>(x.label+" "+x.kind).toLowerCase().includes(q)):items; if(!q) return base;
  const raw=($("#cmdkIn")||{value:q}).value.trim();
  return [...base,...cmdkExtra(q),{label:`Ask Claude: "${raw.slice(0,80)}"`,kind:"Ask",run:()=>{ goTab("overview"); setTimeout(()=>{ const i=$("#qaskInput"); if(i){ i.value=raw; const f=$("#qaskForm"); if(f) f.requestSubmit(); } },120); }}]; }
function openCmdk(){ if(CMDK||!CUR) return; try{ schClose(); }catch{} try{ catClose(); }catch{} const box=document.createElement("div"); box.className="cmdk"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-label","Search");
  box.innerHTML=`<div class="cmdk-box"><input type="text" id="cmdkIn" placeholder="Search everything: pages, schedules, research, designs, docs…" autocomplete="off" aria-label="Search"><div class="cmdk-list" id="cmdkList" role="listbox"></div></div>`;
  document.body.appendChild(box); CMDK={el:box,sel:0,items:[]};
  const paint=()=>{ CMDK.items=cmdkItems($("#cmdkIn").value).slice(0,40); if(CMDK.sel>=CMDK.items.length) CMDK.sel=0;
    $("#cmdkList").innerHTML=CMDK.items.length?CMDK.items.map((x,i)=>`<button class="cmdk-item" role="option" type="button" data-ci="${i}" aria-selected="${i===CMDK.sel}"><span>${esc(x.label)}</span><span class="k">${esc(x.kind)}</span></button>`).join(""):`<div class="empty">No matches</div>`; };
  const run=i=>{ const it=CMDK.items[i]; closeCmdk(); if(it) it.run(); };
  box.addEventListener("click",e=>{ const b=e.target.closest("[data-ci]"); if(b) run(+b.dataset.ci); else if(e.target===box) closeCmdk(); });
  $("#cmdkIn").addEventListener("input",()=>{ CMDK.sel=0; paint(); });
  $("#cmdkIn").addEventListener("keydown",e=>{ if(e.key==="ArrowDown"){ e.preventDefault(); CMDK.sel=Math.min(CMDK.sel+1,CMDK.items.length-1); paint(); } else if(e.key==="ArrowUp"){ e.preventDefault(); CMDK.sel=Math.max(CMDK.sel-1,0); paint(); } else if(e.key==="Enter"){ e.preventDefault(); run(CMDK.sel); } else if(e.key==="Escape"){ closeCmdk(); } });
  paint(); setTimeout(()=>{ const i=$("#cmdkIn"); if(i) i.focus(); },20); }
function closeCmdk(){ if(CMDK){ CMDK.el.remove(); CMDK=null; } }
document.addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); CMDK?closeCmdk():openCmdk(); } });
/* ---------- tooltip ---------- */
(function(){ const tip=document.createElement("div"); tip.id="tip"; tip.setAttribute("role","tooltip"); document.body.appendChild(tip);
  const show=(el,x,y)=>{ tip.textContent=el.dataset.tip; tip.classList.add("on"); const r=tip.getBoundingClientRect(); let L=x+14, T=y+16; if(L+r.width>innerWidth-8) L=x-r.width-14; if(T+r.height>innerHeight-8) T=y-r.height-12; tip.style.left=Math.max(8,L)+"px"; tip.style.top=Math.max(8,T)+"px"; };
  document.addEventListener("mousemove",e=>{ const el=e.target.closest&&e.target.closest("[data-tip]"); if(el) show(el,e.clientX,e.clientY); else tip.classList.remove("on"); },{passive:true});
  document.addEventListener("focusin",e=>{ const el=e.target.closest&&e.target.closest("[data-tip]"); if(el){ const r=el.getBoundingClientRect(); show(el,r.left,r.bottom); } });
  document.addEventListener("focusout",()=>tip.classList.remove("on"));
  addEventListener("scroll",()=>tip.classList.remove("on"),{passive:true}); })();
function sizeHeader(){ const h=document.querySelector("header.top"); if(h) document.documentElement.style.setProperty("--hdr",(h.getBoundingClientRect().height)+"px"); }
addEventListener("resize",sizeHeader);
