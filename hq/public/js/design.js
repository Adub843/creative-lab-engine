/* ================= DESIGN LAB: chat with Vera, generate images, send keepers to her queue ================= */
const KITTL_WS="cmg2xuxy59gcc0h7o81r9dnid";
const DS_WORKER="trig_01SLZ9zmqvtwtKw7CJHeDzbU";
/* [id, label, cost, takes reference images, engine] — Meshy runs on the PC worker with Aaron's paid Meshy credits; Kittl uses Kittl tokens */
const DL_MODELS=[
  ["meshy:nano-banana-pro","Best detail — Nano Banana Pro (Meshy)",9,false,"meshy"],
  ["meshy:gpt-image-2","Lettering & layout — GPT Image 2 (Meshy)",9,false,"meshy"],
  ["meshy:nano-banana-2","Good, cheaper — Nano Banana 2 (Meshy)",6,false,"meshy"],
  ["meshy:nano-banana-2-lite","Quick test — Nano Banana 2 Lite (Meshy)",3,false,"meshy"],
  ["cmu0vjlusgqok0k924ypfh67k","Realistic — GPT Image 2.5 HQ",20,true],
  ["cmm3wc5922u3a8u0i2rcvu4kf","Photo mockup — Nano Banana 2",24,true],
  ["cmq12jnlo0clz0k5xid02wraz","Lettering & logos — Ideogram 4",15,false],
  ["cmo9rwwlo5rl90iajpc6o45tx","Final, highest detail — GPT Image 2 HD",30,true],
  ["cmkwr4rin0s11df0iqwaibffd","Quick sketch — Flux.2 klein",2,true]];
const DL_ASPECTS=["1:1","4:5","3:4","2:3","16:9"];
const DL={msgs:null, busy:false, files:[], node:null, model:DL_MODELS[0][0], aspect:"1:1", refs:[], balance:null, balAt:0, jobs:{}};
const dlCan=()=>canEditSched();
function dlKey(){ return "hq-dl-chat-"+String(CUR||"").toLowerCase(); }
function dlLoad(){ if(DL.msgs&&DL.user===CUR) return; DL.user=CUR; DL.files=[]; DL.refs=[]; try{ DL.msgs=JSON.parse(localStorage.getItem(dlKey())||"[]"); }catch{ DL.msgs=[]; } if(!Array.isArray(DL.msgs)) DL.msgs=[]; if(DL.node){ dlPaint(); dlPaintRefs(); dlPaintBar(); } }
function dlSave(){ try{ localStorage.setItem(dlKey(),JSON.stringify(DL.msgs.slice(-40))); }catch{} }
function dlReset(){ DL.msgs=null; DL.user=null; DL.files=[]; DL.refs=[]; DL.busy=false; if(DL.node){ const m=DL.node.querySelector("#dlMsgs"); if(m) m.innerHTML=""; } }
function dlModel(id){ return DL_MODELS.find(m=>m[0]===id)||DL_MODELS[0]; }
const dlUnit=m=>m[4]==="meshy"?"Meshy credits":"Kittl tokens";
function kittlCall(tool,args){ if(!mcp) return Promise.reject({code:"no_mcp"}); return mcp.callTool("Kittl",tool,args).then(payloadOf); }
function dlErr(e){ const c=e&&e.code; return ({no_mcp:"Image generation needs this console open on claude.ai.",server_not_connected:"Connect Kittl in Settings → Connectors.",needs_reauth:"Reconnect Kittl in Settings → Connectors.",not_granted:"Allow the console to use Kittl, then try again.",not_in_manifest:"Image generation is switched off for this page.",rate_limited:"Too many requests. Wait a minute."}[c])||("Couldn't generate. "+(e&&e.message?String(e.message).slice(0,140):"Try again.")); }
async function dlBalance(force){ if(!dlCan()||!mcp) return; if(!force&&Date.now()-DL.balAt<120e3) return; DL.balAt=Date.now();
  try{ const p=await kittlCall("kittl-get-token-balance",{workspaceId:KITTL_WS}); const b=p&&p.balance; DL.balance=b&&typeof b.totalAvailable==="number"?b.totalAvailable:(p&&typeof p.totalAvailable==="number"?p.totalAvailable:null); dlPaintBar(); }catch(e){ DL.balance=null; } }
/* ---- page ---- */
function vDesignLab(){ dlLoad(); const ed=dlCan(); const G=(S.designlab||[]).slice(0,30);
  return `<section class="card"><div class="card-head"><h2 class="big">Design Lab</h2><span class="eyebrow">Elevated Designs · talk ideas through with Vera, then generate</span></div>
    <p class="small muted" style="margin-top:0">Describe a new idea or a style change, or attach pictures you like. Vera answers and turns ideas into image prompts you can generate here. ${ed?"Send the ones you like to Vera's queue and she builds them on her next run.":"Only Aaron, signed in with his PIN, can generate images or send ideas to the team."} Generated images also appear in the <button type="button" class="linkbtn" data-goto="designer">Design Studio</button>.</p>
    <div id="dlMount"></div></section>
    <section class="card"><div class="card-head"><h2>Generated</h2><span class="eyebrow">${G.length?`newest ${G.length}`:"nothing yet"}</span></div>
      ${G.length?`<div class="dlgrid">${G.map(dlCard).join("")}</div>`:`<p class="muted small">Images you generate show up here and stay saved.</p>`}</section>`; }
function dlImg(g){ return g&&/^[0-9a-f]{32}$/.test(String(g.assetId||""))?"/_blob/"+g.assetId:safeImg(g&&g.url); }
function dlCard(g){ const img=dlImg(g), st=g.status||"new"; const pend=/queued|running/i.test(st);
  return `<div class="dlcard" data-dlid="${esc(g.id)}">${img?`<img src="${esc(img)}" alt="${esc(String(g.title||g.prompt||"Generated design").slice(0,90))}" loading="lazy">`:`<div class="noimg">${pend?"Making it…":"No image"}</div>`}
    <div class="pc-b"><b>${esc(String(g.title||"Untitled idea").slice(0,60))}</b><span class="meta">${esc(dlModel(g.model)[1].split(" — ")[1]||dlModel(g.model)[1])} · ${esc(ago(g.at))}${g.cost!=null?` · ${esc(String(g.cost))} ${dlModel(g.model)[4]==="meshy"?"credits":"tokens"}`:""}</span>
      ${g.check?`<span class="pill ${g.check.pass?"ok":"bad"}" title="${esc(String(g.check.notes||"").slice(0,300))}">${g.check.pass?"Checker passed":"Checker failed"}</span>`:""}${g.check&&g.check.notes?`<span class="small muted">${esc(String(g.check.notes).slice(0,220))}</span>`:""}<span class="pill ${st==="sent"?"ok":st==="failed"?"bad":""}">${st==="sent"?"In Vera's queue":st==="failed"?"Failed":pend?"Generating":"New"}</span>
      ${g.error?`<span class="small bad">${esc(String(g.error).slice(0,140))}</span>`:""}
      <div class="row" style="gap:6px;flex-wrap:wrap">${img&&dlCan()?`<button class="btn" data-dlref="${esc(g.id)}">Use as reference</button>`:""}${img&&dlCan()&&st!=="sent"?`<button class="btn primary" data-dlsend="${esc(g.id)}">Send to Vera</button>`:""}${safeUrl(g.editUrl)?`<a class="btn ghost" href="${esc(safeUrl(g.editUrl))}" target="_blank" rel="noopener">Open in Kittl ↗</a>`:""}${pend&&g.jobId&&dlCan()?`<button class="btn ghost" data-dlcheck="${esc(g.id)}">Check</button>`:""}</div>
      <details class="small"><summary>Prompt</summary><p>${esc(g.prompt||"")}</p></details></div></div>`; }
/* the chat panel is one persistent element, re-attached after each page render so typing and replies survive */
function dlBuild(){ const n=document.createElement("div"); n.className="dlchat";
  n.innerHTML=`<div class="dlmsgs" id="dlMsgs" aria-live="polite"></div>
    <div class="dlrefs" id="dlRefs"></div>
    <form class="dlform" id="dlForm"><textarea id="dlIn" rows="2" placeholder="e.g. Lowcountry shrimp boat line art for the summer drop, cream ink on a dark navy tee" aria-label="Message to Vera"></textarea>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><label class="btn ghost" id="dlAttachL">Attach pictures<input type="file" id="dlFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label><button class="btn ghost" type="button" id="dlClear">New chat</button><span style="flex:1"></span><button class="btn primary" type="submit" id="dlGo">Send to Vera</button></div></form>
    <div class="dlbar" id="dlBar"></div>`;
  n.querySelector("#dlForm").onsubmit=e=>{ e.preventDefault(); dlAsk(); };
  n.querySelector("#dlIn").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); dlAsk(); } });
  n.querySelector("#dlFile").onchange=e=>{ dlAddFiles([...e.target.files]); e.target.value=""; };
  n.querySelector("#dlClear").onclick=()=>{ const b=n.querySelector("#dlClear"); if(!DL.msgs.length||confirmInline(b,"Tap again to clear")){ DL.msgs=[]; DL.files=[]; DL.refs=[]; dlSave(); dlPaint(); } };
  return n; }
async function dlAddFiles(files){ let lim=null; try{ lim=sample&&sample.limits?await sample.limits():null; }catch{}
  const im=lim&&lim.images; if(!im){ toast("This view can't send pictures to Vera."); return; }
  for(const f of files){ if(DL.files.length>=Math.min(4,im.maxCount||4)){ toast("Up to 4 pictures at a time."); break; } if(im.mediaTypes&&!im.mediaTypes.includes(f.type)){ toast(f.name+" isn't a supported picture type."); continue; } if(im.maxBytes&&f.size>im.maxBytes){ toast(f.name+" is too large."); continue; } DL.files.push(f); }
  dlPaintRefs(); }
function dlPaintRefs(){ const box=DL.node&&DL.node.querySelector("#dlRefs"); if(!box) return; (box._urls||[]).forEach(u=>URL.revokeObjectURL(u)); box._urls=[];
  const chips=[...DL.files.map((f,i)=>{ const u=URL.createObjectURL(f); box._urls.push(u); return `<span class="dlref"><img src="${u}" alt="Attached picture ${i+1}"><button type="button" data-dlrmf="${i}" aria-label="Remove attached picture ${i+1}">✕</button></span>`; }),
    ...DL.refs.map((r,i)=>{ const img=dlImg(r); return `<span class="dlref" title="Reference for the next image">${img?`<img src="${esc(img)}" alt="Reference ${i+1}">`:""}<button type="button" data-dlrmr="${i}" aria-label="Remove reference ${i+1}">✕</button></span>`; })];
  box.innerHTML=chips.length?`<span class="small muted">${DL.files.length?"Pictures for Vera":""}${DL.files.length&&DL.refs.length?" · ":""}${DL.refs.length?"References for the next image":""}</span>${chips.join("")}`:"";
  box.querySelectorAll("[data-dlrmf]").forEach(b=>b.onclick=()=>{ DL.files.splice(+b.dataset.dlrmf,1); dlPaintRefs(); });
  box.querySelectorAll("[data-dlrmr]").forEach(b=>b.onclick=()=>{ DL.refs.splice(+b.dataset.dlrmr,1); dlPaintRefs(); }); }
function dlPaintBar(){ const b=DL.node&&DL.node.querySelector("#dlBar"); if(!b) return; const ed=dlCan(), m=dlModel(DL.model);
  b.innerHTML=ed?`<label class="small">Image style <select id="dlModel">${DL_MODELS.map(x=>`<option value="${x[0]}" ${x[0]===DL.model?"selected":""}>${esc(x[1])} · ${x[2]} ${x[4]==="meshy"?"credits":"tokens"}</option>`).join("")}</select></label>
    <label class="small">Shape <select id="dlAspect">${DL_ASPECTS.map(a=>`<option ${a===DL.aspect?"selected":""}>${a}</option>`).join("")}</select></label>
    <span class="small muted">${DL.balance!=null?`Kittl tokens left: <b>${esc(String(DL.balance))}</b>`:"Kittl tokens: checking…"} · Meshy credits: <b>${S.meshybal&&S.meshybal.balance!=null?esc(String(S.meshybal.balance)):"checked by the PC on each run"}</b>${!m[3]&&DL.refs.length?" · this style ignores references":""}</span>`:"";
  const ms=b.querySelector("#dlModel"); if(ms) ms.onchange=()=>{ DL.model=ms.value; dlPaintBar(); dlPaint(); };
  const as=b.querySelector("#dlAspect"); if(as) as.onchange=()=>{ DL.aspect=as.value; }; }
function dlPaint(){ const box=DL.node&&DL.node.querySelector("#dlMsgs"); if(!box) return; const ed=dlCan(), m=dlModel(DL.model);
  box.innerHTML=(DL.msgs.length?DL.msgs:[{role:"assistant",text:"Hi"+(CUR?" "+CUR:"")+", it's Vera. Tell me what you're picturing: a new design, a style change for a collection, or something you saw that you liked. Attach pictures if you have them, and I'll write image prompts we can generate right here."}]).map((x,mi)=>`<div class="dlmsg ${x.role==="user"?"me":""}"><div class="dlb">${esc(x.text)}${x.pics?`<div class="small muted">📎 ${x.pics} picture${x.pics>1?"s":""}</div>`:""}</div>
      ${(x.ideas||[]).map((it,ii)=>`<div class="dlidea"><b>${esc(it.title||"Idea")}</b><p class="small">${esc(it.prompt)}</p>${ed?`<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn primary" data-dlgen="${mi}.${ii}">Generate · ${m[2]} ${m[4]==="meshy"?"credits":"tokens"}</button><button class="btn ghost" data-dledit="${mi}.${ii}">Edit prompt</button></div>`:""}</div>`).join("")}</div>`).join("")
    +(DL.busy?`<div class="dlmsg"><div class="dlb muted" id="dlTyping">${esc(DL.typing||"Vera is thinking…")}</div></div>`:"");
  box.scrollTop=box.scrollHeight;
  box.querySelectorAll("[data-dlgen]").forEach(b=>b.onclick=()=>{ const [mi,ii]=b.dataset.dlgen.split(".").map(Number); const it=((DL.msgs[mi]||{}).ideas||[])[ii]; if(it) dlGenerate(it,b); });
  box.querySelectorAll("[data-dledit]").forEach(b=>b.onclick=()=>{ const [mi,ii]=b.dataset.dledit.split(".").map(Number); const it=((DL.msgs[mi]||{}).ideas||[])[ii]; if(!it) return; const ta=DL.node.querySelector("#dlIn"); ta.value="Change this prompt: "+it.prompt+"\n\nWhat to change: "; ta.focus(); });
  const go=DL.node.querySelector("#dlGo"); if(go) go.disabled=DL.busy; }
function dlMount(){ const host=$("#dlMount"); if(!host) return; dlLoad(); if(!DL.node){ DL.node=dlBuild(); } if(DL.node.parentNode!==host){ host.appendChild(DL.node); dlPaint(); dlPaintRefs(); dlPaintBar(); } dlBalance(); }
/* ---- talk to Vera ---- */
function dlContext(){ const ed=(S.designs||[]).filter(d=>typeof designBiz!=="function"||designBiz(d)==="ed").slice(0,15).map(d=>`- ${String(d.title||d.name||"untitled").slice(0,70)} (${d.status||"?"})`).join("\n");
  const st=(S.styletrends||[]).slice(0,7).map(s=>`- ${String(s.name||s.id).slice(0,60)}${s.summary?": "+String(s.summary).slice(0,120):""}`).join("\n");
  return `Elevated Designs is Aaron Lewis's small shirt business in the Charleston, SC area (tees, hoodies, crewnecks; Southern / Lowcountry style among others).\nRecent designs:\n${ed||"- none listed"}\nStyle trends the team tracks:\n${st||"- none listed"}\nAaron's standing preferences: visuals must look realistic from the first pass (real fabric, real print texture, natural light — never flat or fake). If lettering is hard to read on a dark shirt, lighten the art/lettering instead of switching to a lighter shirt. Use original art only: no copyrighted characters, logos, brand names, team marks or real people.`; }
async function dlAsk(){ if(DL.busy) return; const ta=DL.node.querySelector("#dlIn"); const text=ta.value.trim(); if(!text&&!DL.files.length){ ta.focus(); return; }
  if(!sample){ toast("Chatting with Vera needs this console open on claude.ai."); return; }
  const files=DL.files.slice(); DL.msgs.push({role:"user",text:text||"(see the attached pictures)",pics:files.length||undefined}); ta.value=""; DL.files=[]; dlPaintRefs(); DL.busy=true; DL.typing=""; dlPaint(); dlSave();
  const hist=DL.msgs.slice(-12).map(x=>`${x.role==="user"?"AARON":"VERA"}: ${x.text}${(x.ideas||[]).length?"\n(prompts offered: "+x.ideas.map(i=>i.title).join("; ")+")":""}`).join("\n\n");
  const ins=`You are VERA, General Manager and design lead of Elevated Designs, talking with the owner, Aaron, inside his HQ console's Design Lab. Be warm, brief and concrete, like a sharp creative director. Help him shape new design ideas or style changes; ask at most one question when something important is unclear.\n\n${dlContext()}\n\nWhen an idea is ready to see, write 1–3 image prompts for a text-to-image model. Each prompt is one paragraph of plain prose (no keyword lists) that describes: a photorealistic product shot of the garment (type, exact shirt color), how it is displayed (flat lay on a surface, hanger, or a person wearing it, with no recognizable real person), the printed art itself (subject, style, ink colors, print method like screen print or DTG, where it sits on the shirt), any lettering in "straight double quotes" with its font style, lighting and camera. Prefer realistic fabric texture and natural light. If he only wants artwork, describe the art on a plain background instead.\n\nConversation so far:\n${hist}\n\nReply ONLY with JSON: {"reply": "<what Vera says, 1–5 short sentences>", "ideas": [{"title": "<3–6 words>", "prompt": "<the image prompt>"}]} — use "ideas": [] when nothing is ready to generate.`;
  try{ const opts={modelTier:"default",cache:false}; if(files.length) opts.images=files;
    const out=await sample.json(ins,opts); const reply=String((out&&out.reply)||"").slice(0,2000)||"Got it.";
    const ideas=(Array.isArray(out&&out.ideas)?out.ideas:[]).filter(i=>i&&typeof i.prompt==="string"&&i.prompt.trim().length>20).slice(0,3).map(i=>({title:String(i.title||"Idea").slice(0,60),prompt:String(i.prompt).slice(0,1800)}));
    DL.msgs.push({role:"assistant",text:reply,ideas}); }
  catch(e){ console.warn("vera",e); DL.msgs.push({role:"assistant",text:e&&e.code==="not_granted"?"I can't reply until you allow the console to ask Claude. Try again and allow it.":e&&e.code==="rate_limited"?"Too many messages at once. Give me a minute.":"Sorry, I lost that one. Try again."}); }
  finally{ DL.busy=false; dlPaint(); dlSave(); } }
/* ---- generate with Kittl (owner only; shows the token cost on the button) ---- */
async function dlGenerate(it,btn){ if(!dlCan()){ toast("Only Aaron, signed in with his PIN, can generate images."); return; } if(!db){ toast("Can't save from this view."); return; }
  const m=dlModel(DL.model); if(m[4]!=="meshy"&&DL.balance!=null&&DL.balance<m[2]){ toast(`Not enough Kittl tokens (${DL.balance} left, this needs ${m[2]}). Pick a Meshy model instead.`); return; }
  /* pre-flight: research + brief + cost approval before anything is spent */
  const br=await hqDialog({title:"Before spending: the brief",body:`This uses ${m[2]} ${dlUnit(m)} (${m[1].split(" — ")[1]||m[1]}). Fill in the brief so the image matches what sells. The checker reviews the result before it's shown.`,
    fields:[{label:"What's selling that this follows (listing link or note)",placeholder:"e.g. Etsy 'Charleston Comfort Colors' varsity tee, 8.3k reviews"},{label:"Style",placeholder:"e.g. one-color white varsity arch lettering, worn print"},{label:"Exact words on the shirt (or 'none')",placeholder:"e.g. CHARLESTON / South Carolina"},{label:"Ink colors and shirt color",placeholder:"e.g. white ink on Blue Spruce"},{label:"Type YES to approve the cost",placeholder:"YES"}],ok:`Generate · ${m[2]} ${m[4]==="meshy"?"credits":"tokens"}`});
  if(!br) return; const [why,style,words,colors,yes]=br.map(x=>String(x||"").trim());
  if(!why||!style||!words||!colors){ toast("Fill in every line of the brief first."); return; } if(!/^yes$/i.test(yes)){ toast("Type YES to approve the cost."); return; }
  const brief={why:why.slice(0,300),style:style.slice(0,200),words:words.slice(0,200),colors:colors.slice(0,120)};
  if(btn){ if(btn.dataset.busy) return; btn.dataset.busy="1"; btn.disabled=true; btn.textContent="Starting…"; }
  const args={type:"image",modelId:m[0],workspaceId:KITTL_WS,prompt:it.prompt,aspectRatio:DL.aspect}; const refs=m[3]?DL.refs.map(r=>r.uploadId||r.url).filter(Boolean).slice(0,4):[]; if(refs.length) args.referenceImages=refs;
  let ref=null;
  if(m[4]==="meshy"){ try{ ref=await db.collection("designlab").add({title:it.title,prompt:it.prompt,model:m[0],engine:"meshy",meshyModel:m[0].slice(6),aspect:["1:1","3:4","4:3","16:9","9:16"].includes(DL.aspect)?DL.aspect:"3:4",brief,estCost:m[2],status:"queued",at:new Date().toISOString(),by:CUR});
      let fired=false; try{ fired=await fireNow(DS_WORKER,`Design Studio image job queued by Aaron: designlab/${ref.id}. Run it now.`); }catch(x){}
      toast(fired?"Sent to the PC. The image shows under Generated after the checker reviews it (a few minutes).":"Queued. The PC picks it up on its next run."); }
    catch(e){ console.error(e); toast("Couldn't queue it. Try again."); }
    finally{ if(btn&&btn.isConnected){ delete btn.dataset.busy; btn.disabled=false; btn.textContent=`Generate · ${m[2]} credits`; } } return; }
  try{ ref=await db.collection("designlab").add({title:it.title,prompt:it.prompt,model:m[0],aspect:DL.aspect,refs:DL.refs.map(r=>r.url).slice(0,4),brief,status:"queued",at:new Date().toISOString(),by:CUR});
    const p=await kittlCall("kittl-generate-media",args); if(!p||!p.jobId) throw {message:(p&&p.message)||"No job started."};
    await db.doc("designlab/"+ref.id).update({jobId:p.jobId,cost:p.creditCost!=null?p.creditCost:m[2],status:"running"});
    toast("Generating. It shows under Generated in about a minute."); DL.balAt=0; dlWatch(ref.id,p.jobId); }
  catch(e){ console.error("kittl",e); const msg=dlErr(e); toast(msg); if(ref) try{ await db.doc("designlab/"+ref.id).update({status:"failed",error:msg}); }catch{} }
  finally{ if(btn&&btn.isConnected){ delete btn.dataset.busy; btn.disabled=false; btn.textContent=`Generate · ${m[2]} ${m[4]==="meshy"?"credits":"tokens"}`; } } }
function dlWatch(id,jobId,tries=0){ if(DL.jobs[id]&&tries===0) return; DL.jobs[id]=1;
  setTimeout(async()=>{ try{ const p=await kittlCall("kittl-get-media-generation-status",{jobId});
      if(p&&p.terminal){ delete DL.jobs[id]; const ok=/COMPLETE|SUCC/i.test(p.status||"")&&safeImg(p.url);
        let asset=null; if(ok&&assets) try{ const r=await fetch(p.url,{mode:"cors"}); if(r.ok){ const a=await assets.upload(await r.blob()); if(a&&a.id) asset=a.id; } }catch(e){ /* keep the Kittl link */ }
        await db.doc("designlab/"+id).update(ok?{status:"new",url:p.url,assetId:asset,uploadId:p.uploadId||null,editUrl:p.editUrl||null,doneAt:new Date().toISOString()}:{status:"failed",error:p.message||("Kittl said: "+(p.status||"failed"))}); dlBalance(true); return; }
      if(tries<40) dlWatch(id,jobId,tries+1); else delete DL.jobs[id]; }
    catch(e){ if(tries<40) dlWatch(id,jobId,tries+1); else delete DL.jobs[id]; } }, tries===0?8000:Math.min(15000,5000+tries*1000)); }
async function dlSend(id,btn){ const g=(S.designlab||[]).find(x=>x.id===id); if(!g||!dlCan()) return; if(btn) btn.disabled=true;
  try{ await addReq({for:"vera",by:"aaron",what:`Design Lab idea from Aaron: "${String(g.title||"Untitled").slice(0,60)}". Build it into a proper design for Elevated Designs (follow the house rules and quality gate). Prompt used: ${String(g.prompt||"").slice(0,900)} Image: ${g.url} (Kittl: ${g.editUrl||"n/a"}). Details in HQ doc designlab/${id}.`,status:"open",at:new Date().toISOString()});
    await db.doc("designlab/"+id).update({status:"sent",sentAt:new Date().toISOString()});
    const tid=tidOf("vera"); if(tid) await fireNow(tid,`Aaron just sent you a Design Lab idea: designlab/${id}. Pick it up from your requests now.`);
    toast("Sent to Vera. She picks it up now."); }
  catch(e){ console.error(e); toast("Couldn't send it. Try again."); if(btn&&btn.isConnected) btn.disabled=false; } }
function bindDesignLab(){ if(S.tab!=="designlab") return; dlMount();
  document.querySelectorAll("[data-dlsend]").forEach(b=>b.onclick=()=>dlSend(b.dataset.dlsend,b));
  document.querySelectorAll("[data-dlref]").forEach(b=>b.onclick=()=>{ const g=(S.designlab||[]).find(x=>x.id===b.dataset.dlref); if(!g) return; if(DL.refs.some(r=>r.url===g.url)){ toast("Already a reference."); return; } if(DL.refs.length>=4){ toast("Up to 4 references."); return; } DL.refs.push({url:g.url,uploadId:g.uploadId,assetId:g.assetId}); dlPaintRefs(); dlPaintBar(); toast("Added as a reference for the next image."); });
  document.querySelectorAll("[data-dlcheck]").forEach(b=>b.onclick=()=>{ const g=(S.designlab||[]).find(x=>x.id===b.dataset.dlcheck); if(g&&g.jobId){ delete DL.jobs[g.id]; dlWatch(g.id,g.jobId); toast("Checking…"); } });
  if(dlCan()) (S.designlab||[]).filter(g=>/running/.test(g.status||"")&&g.jobId&&!DL.jobs[g.id]&&Date.now()-new Date(g.at).getTime()<30*60e3).forEach(g=>dlWatch(g.id,g.jobId)); }

/* ================= DESIGN LIBRARY: every design, DTF print, vector, 3D file and Kittl project, searchable with thumbnails ================= */
const LIB={q:"", kind:"all", fmt:"", top:"", shown:96, loading:false, loaded:0, rows:null, err:null, sel:null, idx:{}};
const LIB_KINDS=[["all","All"],["design","Designs"],["dtf","DTF-ready"],["vector","SVG & vector"],["3d","3D models"],["pack","Bundles & packs"],["kittl","Kittl projects"],["tumbler","Tumblers"],["coaster","Coasters"],["logo","Logos"],["journal","Junk journal"]];
const LIB_VEC=new Set(["svg","eps","ai","pdf","dxf","cdr","wmf","cmx","emf"]);
/* the manifest stores lists (db keys can't start or end with "__"), turn them back into lookups */
let LIB_MN=null, LIB_MR=null;
function libMan(){ const r=S.libManifest||null; if(!r) return null; if(r===LIB_MR) return LIB_MN;
  const m=Object.assign({},r), ch={}, ct={};
  if(Array.isArray(r.chunks)) r.chunks.forEach(c=>{ if(c&&typeof c.top==="string") ch[c.top]=c; }); else if(r.chunks&&typeof r.chunks==="object") Object.assign(ch,r.chunks);
  if(Array.isArray(r.counts)) r.counts.forEach(c=>{ if(c&&typeof c.k==="string") ct[c.k]=Number(c.n)||0; }); else if(r.counts&&typeof r.counts==="object") Object.assign(ct,r.counts);
  m.chunks=ch; m.counts=ct; m.sheets=Array.isArray(r.sheets)?r.sheets:(r.sheets&&typeof r.sheets==="object"?r.sheets:{});
  LIB_MR=r; LIB_MN=m; return m; }
/* load every index chunk once (they are plain JSON files in the console's own storage) */
async function libLoad(){ const m=libMan(); if(!m||LIB.loading||LIB.rows) return; const ch=m.chunks||{}; const tops=Object.keys(ch); if(!tops.length) return;
  LIB.loading=true; LIB.loaded=0; LIB.err=null; LIB.idx={}; render(); const rows=[]; const sig=JSON.stringify(ch);
  try{ await Promise.all(tops.map(async top=>{ const c=ch[top]; if(!c||!c.url||!/^\/_blob\/[0-9a-f]{32}$/.test(c.url)) return;
      const ac=new AbortController(), tm=setTimeout(()=>ac.abort(),90000); let r; try{ r=await fetch(c.url,{signal:ac.signal}); }finally{ clearTimeout(tm); } if(!r.ok) throw new Error("index "+top+" "+r.status); const j=await r.json(); const dirs=Array.isArray(j.dirs)?j.dirs:[];
      (Array.isArray(j.items)?j.items:[]).forEach(it=>{ if(!Array.isArray(it)||typeof it[0]!=="string") return; const dir=String(dirs[it[3]]||"");
        const o={id:it[0],k:String(it[1]||"design"),t:String(it[2]||"Untitled"),dir,files:Array.isArray(it[4])?it[4].map(String):[],nf:Array.isArray(it[4])?it[4].length:(Number(it[4])||0),slot:Number.isInteger(it[5])?it[5]:-1,fm:Array.isArray(it[6])?it[6].map(String):[],x:it[7]&&typeof it[7]==="object"?it[7]:null,top};
        o.s=(o.t+" "+dir+" "+o.fm.join(" ")).toLowerCase(); rows.push(o); LIB.idx[o.id]=o; });
      LIB.loaded++; }));
    LIB.rows=rows; }
  catch(e){ console.error("library",e); LIB.err=e&&e.name==="AbortError"?"The library index took too long to load. Try again.":"Couldn't load the library index. Try again in a minute."; }
  finally{ LIB.loading=false; const m2=libMan(); if(!LIB.err&&m2&&JSON.stringify(m2.chunks||{})!==sig){ LIB.rows=null; setTimeout(libLoad,0); } render(); } }
function libFilter(){ const q=LIB.q.trim().toLowerCase().split(/\s+/).filter(Boolean); const k=LIB.kind;
  return (LIB.rows||[]).filter(o=>(k==="all"||(k==="vector"?o.fm.some(f=>LIB_VEC.has(f))&&o.k!=="3d"&&o.k!=="pack":o.k===k))&&(!LIB.fmt||o.fm.includes(LIB.fmt))&&(!LIB.top||o.top===LIB.top)&&q.every(w=>o.s.includes(w))); }
/* a thumbnail is one cell of a sprite sheet */
function libThumbStyle(o,px){ const m=libMan(); if(!m||o.slot<0) return ""; const g=m.grid||16, per=g*g, sh=Math.floor(o.slot/per), cell=o.slot%per; const url=(m.sheets||{})[sh];
  if(!url||!/^\/_blob\/[0-9a-f]{32}$/.test(url)) return ""; const x=(cell%g)*px, y=Math.floor(cell/g)*px;
  return `background-image:url('${url}');background-size:${g*px}px ${g*px}px;background-position:-${x}px -${y}px`; }
function libThumb(o,px,cls){ const st=libThumbStyle(o,px); return `<span class="libth ${cls||""}" style="width:${px}px;height:${px}px;${st}" role="img" aria-label="${esc(o.t)}">${st?"":`<span class="libno">${esc((o.fm[0]||o.k).toUpperCase())}</span>`}</span>`; }
const LIB_KLABEL={design:"Design",dtf:"DTF-ready",tumbler:"Tumbler",coaster:"Coaster",logo:"Logo",journal:"Junk journal","3d":"3D model",pack:"Bundle",kittl:"Kittl project"};
function vLibrary(){ const m=libMan();
  if(!m) return `<section class="card"><div class="card-head"><h2 class="big">Design library</h2></div><p class="muted">The library is being built from your PC's E drive (designs, DTF prints, SVGs, 3D files and Kittl projects). It shows up here as soon as the first upload finishes.</p>${typeof esCard==="function"?esCard():""}</section>${typeof ptQueueCard==="function"?ptQueueCard():""}`;
  if(!LIB.rows&&!LIB.loading&&!LIB.err) setTimeout(libLoad,0);
  const c=m.counts||{}; const kp=(k,l)=>c[k]?`<div class="kpi"><b>${Number(c[k]).toLocaleString()}</b><span>${l}</span></div>`:"";
  const list=LIB.rows?libFilter():[]; const shown=list.slice(0,LIB.shown);
  const tops=Object.keys(m.chunks||{}).sort();
  const fmts=["png","svg","eps","ai","pdf","dxf","jpg","stl","3mf","step","zip"];
  return `<section class="card"><div class="card-head"><h2 class="big">Design library</h2><span class="eyebrow">${Number(m.total||0).toLocaleString()} items from your E drive and Kittl · updated ${esc(ago(m.builtAt))}</span>${canEditSched()?`<button class="btn" id="libDesigner">Open Design Studio</button>`:""}</div>
    ${typeof esCard==="function"?esCard():""}
    <div class="kpi4 libk">${kp("design","designs")}${kp("dtf","DTF-ready prints")}${kp("3d","3D models")}${kp("pack","bundles & packs")}${kp("kittl","Kittl projects")}${kp("tumbler","tumbler wraps")}${kp("coaster","coaster designs")}${kp("logo","logos")}</div>
    <div class="schbar"><input type="search" id="libQ" placeholder="Search names and folders, e.g. halloween skull, jeep, fishing" value="${esc(LIB.q)}" aria-label="Search the design library">
      <select id="libFmt" aria-label="File type"><option value="">Any file type</option>${fmts.map(f=>`<option value="${f}" ${LIB.fmt===f?"selected":""}>${f.toUpperCase()}</option>`).join("")}</select>
      <select id="libTop" aria-label="Folder"><option value="">All folders</option>${tops.map(t=>`<option value="${esc(t)}" ${LIB.top===t?"selected":""}>${esc(t)}</option>`).join("")}</select></div>
    <div class="chips" style="margin:6px 0 12px">${LIB_KINDS.filter(([k])=>k==="all"||k==="vector"||c[k]).map(([k,l])=>`<button class="chip" data-libk="${k}" aria-pressed="${LIB.kind===k}">${l}</button>`).join("")}</div>
    ${LIB.err?`<p class="alertbar">${esc(LIB.err)} <button class="btn" id="libRetry">Try again</button></p>`:""}
    ${LIB.loading?`<p class="muted">Loading the library… ${LIB.loaded}/${tops.length} folders</p>`:""}
    ${LIB.rows?`<p class="small muted">${list.length.toLocaleString()} match${list.length===1?"":"es"}${list.length>shown.length?` · showing ${shown.length}`:""}</p>
      <div class="libgrid">${shown.map(o=>`<button type="button" class="libcard" data-libopen="${esc(o.id)}">${libThumb(o,112)}<span class="libt">${esc(o.t)}</span><span class="libm">${esc(LIB_KLABEL[o.k]||o.k)} · ${esc(o.fm.slice(0,4).join(", ").toUpperCase())}</span></button>`).join("")}</div>
      ${list.length>shown.length?`<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="libMore" data-autoload="1">Loading more…</button></div>`:""}`:""}
  </section>${typeof ptQueueCard==="function"?ptQueueCard():""}`; }
/* ---- item sheet ---- */
function libOpen(id){ const o=LIB.idx[id]; if(!o) return; const ed=canEditSched(); const opener=document.activeElement;
  const box=document.createElement("div"); box.id="libSheet"; box.className="xsheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-label",o.t);
  const x=o.x&&o.k!=="kittl"?Object.entries(o.x).map(([e,n])=>`${Number(n)||0} ${esc(String(e).toUpperCase())}`).join(" · "):"";
  const kurl=o.k==="kittl"&&o.x?safeUrl(o.x.url):null; const req=(S.libreq||[]).find(r=>r.item===o.id&&r.status!=="failed");
  const can3d=o.k==="3d"||(o.k==="pack"&&o.x&&(o.x.stl||o.x["3mf"]||o.x.obj));
  box.innerHTML=`<div class="xpanel"><div class="xhead"><h2>${esc(o.t)}</h2><button class="btn" data-x>Close</button></div>
    <div class="libbig">${libThumb(o,256,"big")}</div>
    <p class="small"><span class="pill">${esc(LIB_KLABEL[o.k]||o.k)}</span> ${o.fm.map(f=>`<span class="pill">${esc(f.toUpperCase())}</span>`).join(" ")}</p>
    ${o.k!=="kittl"?`<p class="small muted">E:\\${esc(o.dir.replace(/^\\\\\?\\E:\\?/,""))}</p>`:""}
    ${o.files.length?`<details class="small"><summary>${o.files.length} file${o.files.length>1?"s":""}</summary><ul>${o.files.map(f=>`<li>${esc(f)}</li>`).join("")}</ul></details>`:o.nf?`<p class="small muted">${o.nf} file${o.nf>1?"s":""} in this set</p>`:""}
    ${x?`<p class="small">Inside: ${x}</p>`:""}
    ${req?`<p class="small">${req.status==="done"?"Full-size copy ready.":"Getting the full-size file from your PC…"}</p>`:""}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">
      ${ed&&o.k!=="kittl"&&o.k!=="pack"?`<button class="btn primary" id="libUse">Use in shirt designer</button>`:""}
      ${ed&&o.k!=="kittl"&&o.k!=="pack"&&!req?`<button class="btn" id="libGet">Get full-size copy</button>`:""}
      ${req&&req.status==="done"&&/^\/_blob\/[0-9a-f]{32}$/.test(req.url||"")?`<a class="btn" href="${esc(req.url)}" target="_blank" rel="noopener">Open full size ↗</a>`:""}
      ${kurl?`<a class="btn primary" href="${esc(kurl)}" target="_blank" rel="noopener">Open in Kittl ↗</a>`:""}
      ${ed&&o.k!=="kittl"?`<button class="btn primary" id="libPost">Post to stores</button>`:""}
      ${ed&&can3d?`<button class="btn" id="libStore">Suggest for the 3D store</button>`:""}
    </div>
    ${can3d?`<p class="small muted">Andy checks the license before anything goes in the store: files downloaded for personal use can't be sold.</p>`:""}</div>`;
  document.body.appendChild(box);
  const close=()=>{ box.remove(); if(opener&&opener.isConnected) try{opener.focus({preventScroll:true})}catch{} };
  box.querySelector("[data-x]").onclick=close; box.onclick=e=>{ if(e.target===box) close(); };
  setTimeout(()=>{ const f=box.querySelector("button"); if(f) f.focus({preventScroll:true}); },30);
  const pst=box.querySelector("#libPost"); if(pst) pst.onclick=()=>{ close(); ptOpen({type:"library",id:o.id,name:o.t,kind:o.k,dir:o.dir,files:o.files,fm:o.fm}); };
  const use=box.querySelector("#libUse"); if(use) use.onclick=()=>{ close(); dzAddLibrary(o); goTab("designer"); };
  const get=box.querySelector("#libGet"); if(get) get.onclick=async()=>{ get.disabled=true; if(await libRequest(o,"download")){ get.textContent="Requested"; } else get.disabled=false; };
  const st=box.querySelector("#libStore"); if(st) st.onclick=async()=>{ st.disabled=true; try{ await addReq({for:"andy",by:"aaron",what:`Aaron suggests this 3D file from his library for the Charleston 3D store: "${o.t}" (E:\\${o.dir}, ${o.nf} files, types: ${o.fm.join(", ")}). First confirm the license allows selling prints (personal-use-only downloads can't be sold); if it's OK, plan it as a product the normal way.`,status:"open",at:new Date().toISOString()}); fire(tidOf("andy"),`Aaron sent a 3D file from his library: "${o.t}". Check it now (requests).`); toast("Sent to Andy. He checks the license first."); }catch(e){ st.disabled=false; toast("Couldn't send it. Try again."); } }; }
/* ask the PC for a web-ready full-size copy (the Library sync task makes it and uploads it here) */
const LIB_INFLIGHT=new Map();
function libRequest(o,purpose){ if(LIB_INFLIGHT.has(o.id)) return LIB_INFLIGHT.get(o.id); const p=libRequestNow(o,purpose).finally(()=>LIB_INFLIGHT.delete(o.id)); LIB_INFLIGHT.set(o.id,p); return p; }
async function libRequestNow(o,purpose){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can do that."); return null; } if(!db){ toast("Can't save from this view."); return null; }
  const have=(S.libreq||[]).find(r=>r.item===o.id&&(r.status==="done"||/open|running/.test(r.status||""))); if(have) return have.id;
  try{ const ref=await db.collection("libreq").add({item:o.id,title:o.t,top:o.top,purpose,status:"open",by:CUR,at:new Date().toISOString()});
    const tid=(S.platformCfg||{}).librarySyncTrigger; if(tid&&S.triggers[tid]) fireNow(tid,`Full-size copy requested: libreq/${ref.id}. Do just the requests step, then stop.`);
    else toast("Saved. Your PC picks it up on its next library sync.");
    return ref.id; }
  catch(e){ console.error(e); toast("Couldn't request it. Try again."); return null; } }
function bindLibrary(){ if(S.tab!=="library") return;
  const q=$("#libQ"); if(q) q.oninput=()=>{ LIB.q=q.value; LIB.shown=96; render(); };
  const f=$("#libFmt"); if(f) f.onchange=()=>{ LIB.fmt=f.value; LIB.shown=96; render(); };
  const t=$("#libTop"); if(t) t.onchange=()=>{ LIB.top=t.value; LIB.shown=96; render(); };
  document.querySelectorAll("[data-libk]").forEach(b=>b.onclick=()=>{ LIB.kind=b.dataset.libk; LIB.shown=96; render(); });
  document.querySelectorAll("[data-libopen]").forEach(b=>b.onclick=()=>libOpen(b.dataset.libopen));
  const m=$("#libMore"); if(m) m.onclick=()=>{ LIB.shown+=96; render(); };
  const r=$("#libRetry"); if(r) r.onclick=()=>{ LIB.err=null; LIB.rows=null; libLoad(); };
  const d=$("#libDesigner"); if(d) d.onclick=()=>goTab("designer"); }
/* search box hook */
function libSearch(q,n){ if(!LIB.rows){ if(libMan()&&!LIB.loading&&!LIB.err) libLoad(); return []; } const w=q.toLowerCase().split(/\s+/).filter(Boolean); const out=[];
  for(const o of LIB.rows){ if(w.every(x=>o.s.includes(x))){ out.push({label:o.t+" · "+(LIB_KLABEL[o.k]||o.k),run:()=>{ goTab("library"); setTimeout(()=>libOpen(o.id),80); }}); if(out.length>=n) break; } }
  return out; }

/* ================= DESIGN STUDIO tools: text effects, templates, image tools, vectorize, auto-checker ================= */
const DS_PRINT_IN=12; /* the dashed print area = 12 in wide on the shirt */
const DS_VOCAB=["CHARLESTON","SOUTH","CAROLINA","LOWCOUNTRY","PALMETTO","RAINBOW","BATTERY","RAVENEL","BRIDGE","MARKET","STREET","FOLLY","BEACH","SULLIVANS","ISLAND","PLEASANT","MOUNT","MARRIED","WEDDING","BACHELORETTE","BACH","BRIDE","GROOM","EXPLAIN","CHRISTMAS","HOLIDAY","FAMILY","CHAMPION","LINEMAN","RESTORING","POWER","ELEVATED","DESIGNS","SAVANNAH","SEABROOK","KIAWAH","SHRIMP","OYSTER","MAGNOLIA","PINEAPPLE","FOUNTAIN","COOPER","RIVER","HARBOR","DOWNTOWN","ESTABLISHED","SUMMERVILLE","NORTH","JAMES","JOHNS"];
const DS_TM=["disney","nike","adidas","comfort colors","gildan","bella canvas","harley","nfl","nba","mlb","ncaa","clemson","gamecocks","tigers paw","coca-cola","coke","pepsi","starbucks","marvel","pixar","barbie","snoopy","hello kitty","pokemon","mickey","yeti","stanley","jeep","ford","chevy","budweiser","yuengling","margaritaville","sonic","mario","taylor swift","eras tour","bluey"];
const DS={wear:0, check:null, lastTpl:null};
const DS_OK=new Set(["BACK","ROOM","TOWER","TOWERS","HARBOUR","SOUTHERN","CHARLESTONIAN","CHRISTMAS","MERRY","HAPPY","FAMILY","TRIP","SUMMER","SPRING","WINTER","GIRLS","BOYS"]);
function dsTmHit(text,m){ const re=new RegExp("(^|[^a-z0-9])"+m.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/ /g,"[\\s-]+")+"([^a-z0-9]|$)","i"); return re.test(String(text||"")); }
function dsLum(hex){ const m=String(hex).match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if(!m) return .5; const f=v=>{ v=parseInt(v,16)/255; return v<=.03928?v/12.92:((v+.055)/1.055)**2.4; }; return .2126*f(m[1])+.7152*f(m[2])+.0722*f(m[3]); }

function dsContrast(a,b){ const L1=dsLum(a)+.05, L2=dsLum(b)+.05; return Math.max(L1,L2)/Math.min(L1,L2); }
function dsLev(a,b){ if(a===b) return 0; const m=a.length,n=b.length; if(Math.abs(m-n)>2) return 9; let p=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){ const c=[i]; for(let j=1;j<=n;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)); p=c; } return p[n]; }
/* ---------- text: spacing, warp, shadow, case ---------- */
function dsTextStr(L){ const t=String(L.text||""); return L.caps?t.toUpperCase():t; }
function dsGlyphs(ctx,L,fs){ const t=dsTextStr(L), sp=(L.spacing||0)*fs/100; const ws=[...t].map(ch=>ctx.measureText(ch).width); const total=ws.reduce((a,b)=>a+b,0)+sp*Math.max(0,ws.length-1); return {chars:[...t],ws,sp,total}; }
function dsDrawText(ctx,L,sc){ const fs=(L.size||120)*L.scale*sc; ctx.font=`${fs}px "${L.font}"`; ctx.textAlign="center"; ctx.textBaseline="middle";
  const g=dsGlyphs(ctx,L,fs), warp=L.warp||"none", amt=(L.warpAmt==null?40:L.warpAmt)/100;
  const place=[]; let x=-g.total/2;
  g.chars.forEach((ch,i)=>{ const cx=x+g.ws[i]/2; x+=g.ws[i]+g.sp; const u=g.total?cx/(g.total/2):0; /* -1..1 */
    let px=cx, py=0, rot=0, sy=1;
    if(warp==="arc"||warp==="arcdown"){ const R=g.total/(Math.max(.05,amt)*Math.PI); const s=warp==="arc"?1:-1; const th=cx/R; px=R*Math.sin(th); py=s*(R-R*Math.cos(th)); rot=s*th; }
    else if(warp==="bridge"){ sy=1+amt*.9*(1-u*u); py=-(sy-1)*fs*.36; }
    else if(warp==="valley"){ py=amt*fs*.6*(1-u*u); sy=1-amt*.45*(1-u*u); }
    else if(warp==="wave"){ py=Math.sin(u*Math.PI*1.5)*amt*fs*.35; rot=Math.cos(u*Math.PI*1.5)*amt*.35; }
    else if(warp==="rise"){ sy=1+amt*(u+1)/2*1.2; py=-(sy-1)*fs*.36; }
    place.push({ch,px,py,rot,sy}); });
  const pass=(fn)=>place.forEach(p=>{ ctx.save(); ctx.translate(p.px,p.py); ctx.rotate(p.rot); if(p.sy!==1) ctx.scale(1,p.sy); fn(p.ch); ctx.restore(); });
  if(L.shadowOn){ ctx.save(); ctx.translate((L.shadowX==null?6:L.shadowX)*L.scale*sc,(L.shadowY==null?6:L.shadowY)*L.scale*sc); ctx.fillStyle=L.shadow||"#000000"; if(L.strokeW){ ctx.lineJoin="round"; ctx.lineWidth=L.strokeW*L.scale*sc*2; ctx.strokeStyle=L.shadow||"#000000"; pass(c=>ctx.strokeText(c,0,0)); } pass(c=>ctx.fillText(c,0,0)); ctx.restore(); }
  if(L.strokeW){ ctx.lineJoin="round"; ctx.lineWidth=L.strokeW*L.scale*sc*2; ctx.strokeStyle=L.stroke||"#000"; pass(c=>ctx.strokeText(c,0,0)); }
  ctx.fillStyle=L.color; pass(c=>ctx.fillText(c,0,0)); }
function dsTextSize(L){ const c=document.createElement("canvas").getContext("2d"); const fs=(L.size||120); c.font=`${fs}px "${L.font}"`; const g=dsGlyphs(c,L,fs); const amt=(L.warpAmt==null?40:L.warpAmt)/100;
  let w=g.total, h=fs*1.2; const wp=L.warp||"none";
  if(wp==="arc"||wp==="arcdown"){ const R=g.total/(Math.max(.05,amt)*Math.PI), th=g.total/2/R; w=2*R*Math.sin(Math.min(th,Math.PI/2))+fs; h=fs*1.2+(R-R*Math.cos(Math.min(th,Math.PI)))*1.0; }
  else if(wp==="bridge"||wp==="rise") h=fs*1.2*(1+amt*1.2); else if(wp==="wave") h=fs*(1.2+amt*.8);
  return {w:w*L.scale+(L.strokeW||0)*2*L.scale,h:h*L.scale}; }
/* ---------- vintage wear (applied to the whole print, mockup and print file) ---------- */
function dsWearTex(size){ const n=document.createElement("canvas"); n.width=n.height=256; const c=n.getContext("2d"); let s=12345; const r=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<1400;i++){ c.fillStyle=`rgba(0,0,0,${.35+r()*.65})`; const x=r()*256,y=r()*256,z=.6+r()*2.4; c.beginPath(); c.ellipse(x,y,z,z*(.4+r()),r()*3,0,7); c.fill(); }
  for(let i=0;i<40;i++){ c.strokeStyle=`rgba(0,0,0,${.2+r()*.5})`; c.lineWidth=.5+r(); c.beginPath(); const x=r()*256,y=r()*256; c.moveTo(x,y); c.lineTo(x+(r()-.5)*60,y+(r()-.5)*20); c.stroke(); }
  return n; }
function dsApplyWear(a,size,amount,sc,ox,oy){ if(!amount) return; const t=DS._tex||(DS._tex=dsWearTex()); a.save(); a.globalCompositeOperation="destination-out"; a.globalAlpha=Math.min(1,amount/100*1.25); const p=a.createPattern(t,"repeat"); const k=(sc||size/1000)*1.6; p.setTransform&&p.setTransform(new DOMMatrix().translate(-(ox||0),-(oy||0)).scale(k,k)); a.fillStyle=p; a.fillRect(0,0,size,size); a.restore(); }
/* ---------- templates (from what sells for Charleston on Etsy) ---------- */
const DS_TEMPLATES=[
  {id:"varsity",name:"Varsity arch",note:"Top Charleston seller style (8.3k reviews): arched collegiate letters, script underneath.",
    make:(ink,acc)=>[{text:"CHARLESTON",font:"Graduate",size:150,warp:"arc",warpAmt:38,spacing:4,color:ink,dy:-.12,w:.95},
      {text:"South Carolina",font:"Yellowtail",size:120,color:ink,dy:.14,w:.62},{text:"EST. 1670",font:"Big Shoulders Display",size:60,spacing:30,color:ink,dy:.33,w:.3}]},
  {id:"cityblock",name:"Plain city block",note:"Highest-review Charleston tee (13.4k): bold block name, small spaced state line.",
    make:(ink)=>[{text:"CHARLESTON",font:"Archivo Black",size:150,color:ink,dy:-.05,w:.96},{text:"SOUTH CAROLINA",font:"Big Shoulders Display",size:70,spacing:42,color:ink,dy:.13,w:.7}]},
  {id:"bachclub",name:"Bach Club (personalized)",note:"Bachelorette best seller pattern: one ink, script + block, name line. Add icons from the library.",
    make:(ink)=>[{text:"Charleston",font:"Yellowtail",size:150,color:ink,dy:-.2,w:.8},{text:"BACH CLUB",font:"Archivo Black",size:110,spacing:18,color:ink,dy:-.02,w:.7},{text:"SARAH'S LAST SAIL · 2026",font:"Big Shoulders Display",size:56,spacing:20,color:ink,dy:.13,w:.72}]},
  {id:"married",name:"Married in Charleston",note:"Wedding and anniversary line: script + block + date. Swap in your date.",
    make:(ink)=>[{text:"married in",font:"Yellowtail",size:110,color:ink,dy:-.18,w:.5},{text:"CHARLESTON",font:"Graduate",size:130,warp:"arc",warpAmt:22,spacing:6,color:ink,dy:-.01,w:.9},{text:"EST. 10.12.2024",font:"Big Shoulders Display",size:60,spacing:30,color:ink,dy:.17,w:.4}]},
  {id:"streetstack",name:"Street word stack",note:"Streetwear: words only, tight justified stack, worn print.",
    make:(ink)=>[{text:"HOLD UP,",font:"Big Shoulders Display",size:150,color:ink,dy:-.28,w:.95,caps:true},{text:"AYE",font:"Boldonse",size:150,color:ink,dy:-.04,w:.95},{text:"LET ME EXPLAIN",font:"Big Shoulders Display",size:120,color:ink,dy:.2,w:.95}],wear:35},
  {id:"familytrip",name:"Family trip (personalized)",note:"Family/group trip pattern: family name arched over the place and year.",
    make:(ink)=>[{text:"THE MILLER FAMILY",font:"Graduate",size:110,warp:"arc",warpAmt:30,spacing:6,color:ink,dy:-.14,w:.9},{text:"Charleston",font:"Yellowtail",size:150,color:ink,dy:.05,w:.75},{text:"SUMMER 2026",font:"Big Shoulders Display",size:64,spacing:30,color:ink,dy:.22,w:.4}]}];
function dsApplyTemplate(id){ const t=DS_TEMPLATES.find(x=>x.id===id); if(!t) return; const sh=dzShirts()[DZ.shirt]; const ink=sh.dark?"#f3ead7":"#1f3a5f"; const p=dzPrint();
  const keepImg=DZ.layers.filter(l=>l.type==="img"); DZ.layers=keepImg;
  const c=document.createElement("canvas").getContext("2d");
  t.make(ink).forEach(o=>{ const L={id:DZ.seq++,type:"text",text:o.text,font:o.font,color:o.color,stroke:"#000000",strokeW:0,size:o.size||120,x:p.x+p.w/2,y:p.y+p.h*(.42+o.dy),scale:1,rot:0,opacity:1,warp:o.warp||"none",warpAmt:o.warpAmt==null?40:o.warpAmt,spacing:o.spacing||0,caps:!!o.caps,tpl:t.id};
    const s=dsTextSize(L); L.scale=(p.w*(o.w||.9))/Math.max(1,s.w); DZ.layers.push(L); });
  DS.wear=t.wear||0; DS.lastTpl=t.id; DZ.sel=null; if(DZ.node){ const w=DZ.node.querySelector("#dsWear"); if(w) w.value=DS.wear; dzPaintAll(); }
  if(document.fonts) Promise.all([...new Set(t.make(ink).map(o=>o.font))].map(f=>document.fonts.load(`120px "${f}"`).catch(()=>{}))).then(()=>{ /* refit once fonts arrive */ DZ.layers.filter(l=>l.tpl===t.id).forEach(L=>{ const o=t.make(ink).find(q=>q.text===L.text); if(!o) return; L.scale=(p.w*(o.w||.9))/Math.max(1,dsTextSize({...L,scale:1}).w); }); dzDraw(); dsRunCheck(true); }); }
function dsTemplatesHtml(){ return `<p class="small muted">Starting layouts built from the Charleston shirts that sell most on Etsy. Pick one, then change the words, fonts and colors. Picking one replaces the text layers (your pictures stay).</p><div class="dstpl">${DS_TEMPLATES.map(t=>`<button type="button" class="dstplb" data-dstpl="${t.id}"><b>${esc(t.name)}</b><span class="small muted">${esc(t.note)}</span></button>`).join("")}</div>`; }
/* ---------- image tools ---------- */
async function dsLayerCanvas(L,max){ const sp=dzSprite(L.src); const im=dzImg(sp?sp.url:L.src); if(!im) throw new Error("no image");
  if(!im.complete||!im.naturalWidth) await new Promise((r,j)=>{ im.addEventListener("load",r,{once:true}); im.addEventListener("error",j,{once:true}); });
  const sw=sp?sp.s:im.naturalWidth, sh=sp?sp.s:im.naturalHeight; const k=Math.min(1,(max||3200)/Math.max(sw,sh)); const c=document.createElement("canvas"); c.width=Math.round(sw*k); c.height=Math.round(sh*k);
  const x=c.getContext("2d",{willReadFrequently:true}); if(sp) x.drawImage(im,sp.x,sp.y,sp.s,sp.s,0,0,c.width,c.height); else x.drawImage(im,0,0,c.width,c.height); return c; }
async function dsReplace(L,c,label){ const b=await dzBlob(c); const old=dzSize(L); const info0=dsImgInfo(L); if(!L.srcPx&&info0) L.srcPx=info0.w; const oldSrc=L.src; if(/^blob:/.test(oldSrc||"")){ try{ URL.revokeObjectURL(oldSrc); }catch{} delete DZ.imgs[oldSrc]; } L.src=URL.createObjectURL(b); L.file=b; L.pending=false; delete L.libId; const im=dzImg(L.src);
  const fit=()=>{ if(im.naturalWidth&&old) L.scale=old.w/im.naturalWidth; dzDraw(); dzPaintLayers(); dzPaintProps(); dsRunCheck(true); }; if(im.complete&&im.naturalWidth) fit(); else im.addEventListener("load",fit,{once:true}); toast(label); }
function dsRemoveBg(c,tol){ const x=c.getContext("2d"), W=c.width, H=c.height, d=x.getImageData(0,0,W,H), p=d.data; const seen=new Uint8Array(W*H); const q=new Int32Array(W*H); let qh=0, qt=0;
  const corners=[[0,0],[W-1,0],[0,H-1],[W-1,H-1]].map(([a,b])=>{ const i=(b*W+a)*4; return [p[i],p[i+1],p[i+2]]; }); const ref=corners.reduce((s,c)=>[s[0]+c[0]/4,s[1]+c[1]/4,s[2]+c[2]/4],[0,0,0]);
  const T=(tol||28)**2*3; const near=i=>{ const dr=p[i]-ref[0], dg=p[i+1]-ref[1], db=p[i+2]-ref[2]; return dr*dr+dg*dg+db*db<=T||p[i+3]<10; };
  const push=k=>{ if(!seen[k]&&near(k*4)){ seen[k]=1; q[qt++]=k; } };
  for(let i=0;i<W;i++){ push(i); push((H-1)*W+i); } for(let j=0;j<H;j++){ push(j*W); push(j*W+W-1); }
  while(qh<qt){ const k=q[qh++], a=k%W, b=(k-a)/W; if(a>0) push(k-1); if(a<W-1) push(k+1); if(b>0) push(k-W); if(b<H-1) push(k+W); }
  for(let k=0;k<W*H;k++){ if(seen[k]) p[k*4+3]=0; else { /* soften edge pixels touching background */ const a=k%W, b=(k-a)/W; if((a>0&&seen[k-1])||(a<W-1&&seen[k+1])||(b>0&&seen[k-W])||(b<H-1&&seen[k+W])) p[k*4+3]=Math.round(p[k*4+3]*.55); } }
  x.putImageData(d,0,0); return qt/(W*H); }
function dsKmeans(px,k){ /* px: array of [r,g,b]; returns centers */ let cs=[]; for(let i=0;i<k;i++) cs.push(px[Math.floor((i+.5)*px.length/k)].slice());
  for(let it=0;it<12;it++){ const sum=cs.map(()=>[0,0,0,0]); px.forEach(c=>{ let b=0,bd=1e9; cs.forEach((m,j)=>{ const d=(c[0]-m[0])**2+(c[1]-m[1])**2+(c[2]-m[2])**2; if(d<bd){ bd=d; b=j; } }); const s=sum[b]; s[0]+=c[0]; s[1]+=c[1]; s[2]+=c[2]; s[3]++; }); cs=cs.map((m,j)=>sum[j][3]?[sum[j][0]/sum[j][3],sum[j][1]/sum[j][3],sum[j][2]/sum[j][3]]:m); }
  return cs; }
function dsHex(c){ return "#"+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join(""); }
function dsRgb(h){ const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)||[0,"00","00","00"]; return [1,2,3].map(i=>parseInt(m[i],16)); }
function dsInk(c,n,oneInk){ const x=c.getContext("2d"), d=x.getImageData(0,0,c.width,c.height), p=d.data;
  if(n===1){ const ink=dsRgb(oneInk||"#1f3a5f"); for(let i=0;i<p.length;i+=4){ if(p[i+3]<8) continue; const l=(.299*p[i]+.587*p[i+1]+.114*p[i+2])/255; const a=Math.max(0,Math.min(1,(1-l-.08)/.62)); p[i]=ink[0]; p[i+1]=ink[1]; p[i+2]=ink[2]; p[i+3]=Math.round(p[i+3]*a); } x.putImageData(d,0,0); return [dsHex(ink)]; }
  const smp=[]; const step=Math.max(1,Math.floor(p.length/4/6000)); for(let i=0;i<p.length;i+=4*step) if(p[i+3]>128) smp.push([p[i],p[i+1],p[i+2]]); if(!smp.length) return [];
  const cs=dsKmeans(smp,n); for(let i=0;i<p.length;i+=4){ if(p[i+3]<8) continue; let b=0,bd=1e9; cs.forEach((m,j)=>{ const dd=(p[i]-m[0])**2+(p[i+1]-m[1])**2+(p[i+2]-m[2])**2; if(dd<bd){ bd=dd; b=j; } }); p[i]=cs[b][0]; p[i+1]=cs[b][1]; p[i+2]=cs[b][2]; p[i+3]=p[i+3]>110?255:0; }
  x.putImageData(d,0,0); return cs.map(dsHex); }
function dsEnlarge(c,f){ const o=document.createElement("canvas"); o.width=Math.min(8000,Math.round(c.width*f)); o.height=Math.min(8000,Math.round(c.height*f)); const x=o.getContext("2d"); x.imageSmoothingEnabled=true; x.imageSmoothingQuality="high"; x.drawImage(c,0,0,o.width,o.height); return o; }
/* trace a flat-color image into SVG: pixel-edge loops per color, simplified (Ramer–Douglas–Peucker) */
function dsRdp(pts,eps){ if(pts.length<4) return pts; const keep=new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1; const st=[[0,pts.length-1]];
  while(st.length){ const [a,b]=st.pop(); let md=0,mi=-1; const [ax,ay]=pts[a],[bx,by]=pts[b]; const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy)||1;
    for(let i=a+1;i<b;i++){ const d=Math.abs(dy*pts[i][0]-dx*pts[i][1]+bx*ay-by*ax)/L; if(d>md){ md=d; mi=i; } } if(md>eps&&mi>0){ keep[mi]=1; st.push([a,mi],[mi,b]); } }
  return pts.filter((_,i)=>keep[i]); }
function dsTraceMask(m,W,H){ const out=new Map(); const key=(x,y)=>y*(W+1)+x; const add=(x1,y1,x2,y2)=>{ const k=key(x1,y1); const a=out.get(k); if(a) a.push(key(x2,y2)); else out.set(k,[key(x2,y2)]); };
  const at=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&m[y*W+x];
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ if(!m[y*W+x]) continue; if(!at(x,y-1)) add(x,y,x+1,y); if(!at(x+1,y)) add(x+1,y,x+1,y+1); if(!at(x,y+1)) add(x+1,y+1,x,y+1); if(!at(x-1,y)) add(x,y+1,x,y); }
  const loops=[]; for(const [s] of out){ let arr=out.get(s); while(arr&&arr.length){ const loop=[s]; let cur=arr.pop(); let guard=0; while(cur!==s&&guard++<4e6){ loop.push(cur); const nx=out.get(cur); if(!nx||!nx.length) break; cur=nx.pop(); } if(loop.length>3) loops.push(loop.map(k=>[k%(W+1),Math.floor(k/(W+1))])); arr=out.get(s); } }
  return loops; }
function dsVectorize(c,colors){ const MAX=900; const k=Math.min(1,MAX/Math.max(c.width,c.height)); const W=Math.round(c.width*k), H=Math.round(c.height*k); const t=document.createElement("canvas"); t.width=W; t.height=H; const x=t.getContext("2d",{willReadFrequently:true}); x.drawImage(c,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data; const smp=[]; for(let i=0;i<d.length;i+=16) if(d[i+3]>128) smp.push([d[i],d[i+1],d[i+2]]); if(!smp.length) return null; const cs=dsKmeans(smp,Math.max(1,Math.min(6,colors||3)));
  const lab=new Int8Array(W*H).fill(-1); for(let i=0;i<W*H;i++){ if(d[i*4+3]<=128) continue; let b=0,bd=1e9; cs.forEach((m,j)=>{ const dd=(d[i*4]-m[0])**2+(d[i*4+1]-m[1])**2+(d[i*4+2]-m[2])**2; if(dd<bd){ bd=dd; b=j; } }); lab[i]=b; }
  const paths=cs.map((col,j)=>{ const m=new Uint8Array(W*H); for(let i=0;i<W*H;i++) m[i]=lab[i]===j?1:0; const closed=l=>{ let fi=0,fd=-1; l.forEach((q,i)=>{ const d=(q[0]-l[0][0])**2+(q[1]-l[0][1])**2; if(d>fd){ fd=d; fi=i; } }); if(fi<2) return l; const A=dsRdp(l.slice(0,fi+1),.9), B=dsRdp(l.slice(fi).concat([l[0]]),.9); return A.concat(B.slice(1,-1)); }; const loops=dsTraceMask(m,W,H).map(closed).filter(l=>l.length>=3);
    const dd=loops.map(l=>"M"+l.map(p=>p[0]+" "+p[1]).join("L")+"Z").join(""); return dd?`<path fill="${dsHex(col)}" fill-rule="evenodd" d="${dd}"/>`:""; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}</svg>`; }
async function dsTool(L,tool,btn){ if(!L||L.type!=="img") return; if(btn){ btn.disabled=true; btn.dataset.t=btn.textContent; btn.textContent="Working…"; }
  try{ const c=await dsLayerCanvas(L,tool==="vector"?1400:3200);
    if(tool==="bg"){ const f=dsRemoveBg(c,+(DZ.node.querySelector("#dsTol")||{value:28}).value); if(f<.01){ toast("Couldn't find a plain background around the edges."); return; } await dsReplace(L,c,"Background removed."); }
    else if(tool==="ink"){ const n=+(DZ.node.querySelector("#dsInkN")||{value:2}).value; const one=(DZ.node.querySelector("#dsInkC")||{value:"#1f3a5f"}).value; const used=dsInk(c,n,one); await dsReplace(L,c,`Reduced to ${used.length} ink color${used.length>1?"s":""}: ${used.join(", ")}.`); }
    else if(tool==="big"){ const o=dsEnlarge(c,2); await dsReplace(L,o,`Enlarged to ${o.width} × ${o.height} px. Smooth enlarge only adds pixels, not detail; check the print-size line in the checker.`); }
    else if(tool==="vector"){ const n=+(DZ.node.querySelector("#dsInkN")||{value:3}).value; const svg=dsVectorize(c,Math.max(1,n)); if(svg&&svg.length>6e6) toast("Big SVG ("+Math.round(svg.length/1e6)+" MB): reduce to fewer ink colors first for a cleaner vector."); if(!svg){ toast("Nothing to trace. Remove the background first?"); return; }
      if(!downloads){ toast("Downloads aren't available in this view."); return; } await downloads.save({filename:String(L.name||"art").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").slice(0,50)+"-vector.svg",data:new Blob([svg],{type:"image/svg+xml"})}); } }
  catch(e){ if(e&&e.code==="cancelled") return; console.error(e); toast(e&&e.name==="SecurityError"?"That picture came from another website, so it can't be edited. Use a library, Design Lab or uploaded image.":"Couldn't run that tool on this picture."); }
  finally{ if(btn&&btn.isConnected){ btn.disabled=false; btn.textContent=btn.dataset.t; } } }
function dsPropsExtra(L){ if(L.type==="text") return `<div class="dsfx"><b class="small">Text effects</b>
    <div class="row" style="gap:6px;flex-wrap:wrap"><label class="small">Shape <select data-dzt="warp">${[["none","Straight"],["arc","Arch up"],["arcdown","Arch down"],["bridge","Bridge"],["valley","Valley"],["wave","Wave"],["rise","Rise"]].map(([v,l])=>`<option value="${v}" ${(L.warp||"none")===v?"selected":""}>${l}</option>`).join("")}</select></label>
    <label class="small"><input type="checkbox" data-dzc="caps" ${L.caps?"checked":""}> ALL CAPS</label><label class="small"><input type="checkbox" data-dzc="shadowOn" ${L.shadowOn?"checked":""}> Drop shadow</label><label class="small">Shadow <input type="color" data-dzt="shadow" value="${esc(L.shadow||"#000000")}"></label></div>
    <label class="small dzrange">Shape amount <input type="range" data-dzk="warpAmt" min="0" max="100" step="1" value="${esc(String(+(L.warpAmt==null?40:L.warpAmt)||0))}"></label>
    <label class="small dzrange">Letter spacing <input type="range" data-dzk="spacing" min="-10" max="80" step="1" value="${esc(String(+L.spacing||0))}"></label>
    <label class="small dzrange">Shadow offset <input type="range" data-dzk="shadowX" min="-20" max="20" step="1" value="${esc(String(+(L.shadowX==null?6:L.shadowX)||0))}"></label></div>`;
  return `<div class="dsfx"><b class="small">Image tools</b><p class="small muted" style="margin:2px 0 6px">Run on this picture only. Saving keeps the edited copy.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><button type="button" class="btn" data-dstool="bg">Remove background</button><label class="small">Tolerance <input type="range" id="dsTol" min="6" max="80" value="28" style="width:90px"></label></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><label class="small">Ink colors <select id="dsInkN">${[1,2,3,4,5,6].map(n=>`<option ${n===2?"selected":""}>${n}</option>`).join("")}</select></label><label class="small">1-ink color <input type="color" id="dsInkC" value="${dzShirts()[DZ.shirt].dark?"#f3ead7":"#1f3a5f"}"></label><button type="button" class="btn" data-dstool="ink">Reduce to inks</button></div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" class="btn ghost" data-dstool="big">Enlarge 2×</button><button type="button" class="btn ghost" data-dstool="vector">Download as vector (SVG)</button></div></div>`; }
function dsBindProps(box,L){ box.querySelectorAll("[data-dzc]").forEach(i=>i.onchange=()=>{ L[i.dataset.dzc]=i.checked; dzDraw(); });
  box.querySelectorAll("[data-dstool]").forEach(b=>b.onclick=()=>dsTool(L,b.dataset.dstool,b)); }
/* ---------- AUTO-CHECKER ---------- */
function dsImgInfo(L){ const sp=dzSprite(L.src); if(sp) return {w:sp.s,h:sp.s,sprite:true}; const im=dzImg(L.src); return im&&im.naturalWidth?{w:im.naturalWidth,h:im.naturalHeight,im}:null; }
function dsSampleImg(L){ try{ const info=dsImgInfo(L); if(!info||!info.im) return null; const c=document.createElement("canvas"); c.width=c.height=48; const x=c.getContext("2d",{willReadFrequently:true}); x.drawImage(info.im,0,0,48,48); const d=x.getImageData(0,0,48,48).data;
    let n=0,l=0; for(let i=0;i<d.length;i+=4){ if(d[i+3]>140){ n++; l+=(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/255; } }
    const cor=[0,47,48*47,48*48-1].map(k=>[d[k*4],d[k*4+1],d[k*4+2],d[k*4+3]]); const box=cor.every(c=>c[3]>240)&&cor.every(c=>Math.abs(c[0]-cor[0][0])+Math.abs(c[1]-cor[0][1])+Math.abs(c[2]-cor[0][2])<40);
    return {lum:n?l/n:null,cover:n/(48*48),box}; }catch(e){ return {tainted:true}; } }
function dsRunCheck(quiet){ const sh=dzShirts()[DZ.shirt], p=dzPrint(), out=[]; const add=(lvl,what,fix)=>out.push({lvl,what,fix});
  if(!DZ.layers.length){ DS.check={items:[{lvl:"fail",what:"Nothing on the shirt yet.",fix:"Add art, text or a template."}],at:Date.now()}; if(!quiet) dsPaintCheck(); return DS.check; }
  const ppi=p.w/DS_PRINT_IN; /* designer px per printed inch */
  DZ.layers.forEach(L=>{ const nm=L.type==="text"?`"${dsTextStr(L).slice(0,30)}"`:`"${String(L.name||"picture").slice(0,30)}"`; const s=dzSize(L);
    /* inside the print area */
    const ox=Math.max(0,(p.x-(L.x-s.w/2)))+Math.max(0,(L.x+s.w/2)-(p.x+p.w)), oy=Math.max(0,(p.y-(L.y-s.h/2)))+Math.max(0,(L.y+s.h/2)-(p.y+p.h));
    if(ox>p.w*.03||oy>p.h*.03) add("warn",`${nm} runs outside the print area.`,"Make it smaller or move it inside the dashed box.");
    if(L.type==="text"){ const t=dsTextStr(L);
      const cr=Math.max(dsContrast(L.color,sh.hex),(L.strokeW||0)>=3?dsContrast(L.stroke||"#000000",sh.hex):0); if(cr<2) add("fail",`${nm} is hard to see on ${sh.name} (contrast ${cr.toFixed(1)} to 1).`,sh.dark?"Use a lighter ink color.":"Use a darker ink color."); else if(cr<3) add("warn",`${nm} is low contrast on ${sh.name} (${cr.toFixed(1)} to 1).`,"Aim for 3 to 1 or more.");
      const capIn=(L.size||120)*L.scale*.7/ppi; if(capIn<.28) add("warn",`${nm} prints only ${capIn.toFixed(2)} in tall and may be hard to read.`,"Make it bigger or bolder.");
      t.toUpperCase().split(/[^A-Z']+/).filter(w=>w.length>=5).forEach(w=>{ const clean=w.replace(/'S?$/,""); const base=clean.replace(/(ES|S)$/,""); if(DS_VOCAB.includes(clean)||DS_VOCAB.includes(base)||DS_VOCAB.includes(clean.replace(/S$/,""))||DS_OK.has(clean)) return; const near=DS_VOCAB.find(v=>v.length>=6&&dsLev(clean,v)<=(v.length>8?2:1)); if(near) add("warn",`Check spelling: "${w}" — did you mean "${near}"?`,"Ignore if it's spelled the way you want."); });
      DS_TM.forEach(m=>{ if(dsTmHit(t,m)) add("fail",`${nm} uses a brand or trademark ("${m}").`,"Remove it. Original wording only."); }); }
    else { const info=dsImgInfo(L); const im0=!dzSprite(L.src)&&dzImg(L.src);
      if(!info||(im0&&im0._bad)) add("fail",`${nm} didn't load, so it won't print.`,"Remove it and add the picture again.");
      if(L.pending) add("warn",`${nm} is still the small preview.`,"Wait for the full-size file before printing.");
      if(info){ const inW=s.w/ppi, px=Math.min(info.w,L.srcPx||info.w), dpi=px/Math.max(.1,inW); if(dpi<150) add("fail",`${nm} prints at ${Math.round(dpi)} DPI (${inW.toFixed(1)} in wide) and will look blurry.`,"Use a bigger file, or make it smaller on the shirt. 300 DPI is the goal.");
        else if(dpi<300) add("warn",`${nm} prints at ${Math.round(dpi)} DPI.`,"300 DPI is best; this is OK for most DTF prints.");
        else add("ok",`${nm} prints sharp (${Math.round(dpi)} DPI at ${inW.toFixed(1)} in).`); }
      const sm=dsSampleImg(L); if(sm&&sm.tainted) add("fail",`${nm} came from another website and can't be exported.`,"Use a library, Design Lab or uploaded image.");
      else if(sm){ if(sm.box) add("warn",`${nm} has a solid background box.`,"Use Image tools → Remove background.");
        if(sm.lum!=null){ const cr=(Math.max(sm.lum,dsLum(sh.hex))+.05)/(Math.min(sm.lum,dsLum(sh.hex))+.05); if(cr<1.5) add("warn",`${nm} blends into the ${sh.name} shirt.`,sh.dark?"Use Lighten (keep the shirt color).":"Darken the art."); } }
      if(/palmetto/i.test((L.name||"")+" "+(L.libId||""))&&!/sc-palmetto|palmetto-master/i.test(String(L.libId||""))) add("warn",`${nm} looks like a palmetto that isn't the SC flag master.`,"Every palmetto must be the SC flag master from the library (sc-palmetto).");
      DS_TM.forEach(m=>{ if(dsTmHit(String(L.name||""),m)) add("warn",`${nm} may be brand art ("${m}").`,"Original art only."); }); } });
  /* style repeat across saved designs */
  const tpl=DZ.layers.find(l=>l.tpl)&&DZ.layers.find(l=>l.tpl).tpl; if(tpl){ const same=(S.mydesigns||[]).slice(0,12).filter(d=>d.tpl===tpl&&d.id!==DZ.editing).length; if(same>=2) add("warn",`You've already saved ${same} designs with the "${(DS_TEMPLATES.find(t=>t.id===tpl)||{}).name}" layout.`,"Change the fonts, shape or colors so it doesn't look the same."); }
  const fonts=new Set(DZ.layers.filter(l=>l.type==="text").map(l=>l.font)); if(fonts.size>3) add("warn",`${fonts.size} different fonts.`,"2–3 fonts reads cleaner.");
  if(!out.some(o=>o.lvl!=="ok")) add("ok","No problems found.");
  DS.check={items:out,at:Date.now()}; if(!quiet) dsPaintCheck(); else dsPaintCheck(true); return DS.check; }
function dsCheckFails(){ return (DS.check?DS.check.items:[]).filter(i=>i.lvl==="fail"); }
function dsPaintCheck(){ const box=DZ.node&&DZ.node.querySelector("#dsCheck"); if(!box) return; const c=DS.check; if(!c){ box.innerHTML=`<p class="small muted">Runs automatically before saving or printing.</p>`; return; }
  const f=c.items.filter(i=>i.lvl==="fail").length, w=c.items.filter(i=>i.lvl==="warn").length;
  box.innerHTML=`<p class="small ${f?"bad":""}" style="margin:0 0 6px"><b>${f?`${f} must fix`:"Passes"}</b>${w?` · ${w} to look at`:""}</p><ul class="dschk">${c.items.map(i=>`<li class="${i.lvl}"><span class="dsdot" aria-hidden="true"></span><span><b>${i.lvl==="fail"?"Fix":i.lvl==="warn"?"Check":"OK"}:</b> ${esc(i.what)}${i.fix?` <span class="muted">${esc(i.fix)}</span>`:""}</span></li>`).join("")}</ul>
    <div class="dsread small"><b>Read every word back:</b> ${DZ.layers.filter(l=>l.type==="text").map(l=>`<code>${esc(dsTextStr(l))}</code>`).join(" · ")||"no text"}</div>`; }
function dsGate(action){ dsRunCheck(); const f=dsCheckFails(); if(f.length){ toast(`Checker found ${f.length} thing${f.length>1?"s":""} to fix before you ${action}.`); const b=DZ.node&&DZ.node.querySelector("#dsCheck"); if(b) b.scrollIntoView({behavior:"smooth",block:"center"}); return false; } return true; }

/* ================= SHIRT DESIGNER: put library art, team designs, Design Lab images, uploads and text on any shirt ================= */
const DZ_W=1000;
const DZ_FONTS=["Graduate","Archivo Black","Big Shoulders Display","Boldonse","Yellowtail","Kaushan Script","Sedgwick Ave Display","Rock Salt","Homemade Apple","Anton","Bebas Neue","Oswald","Alfa Slab One","Abril Fatface","Playfair Display","Rye","Special Elite","Bungee","Permanent Marker","Pacifico","Lobster","Satisfy","Caveat"];
const DZ_FALLBACK=[["Black","#1b1c1f"],["Navy","#1f2a44"],["Heather charcoal","#4a4c50"],["Forest green","#2f4a3a"],["Maroon","#5a2230"],["Sand","#d8c7a6"],["Heather grey","#b9bcc0"],["White","#f4f4f2"]];
const DZ={node:null, shirt:0, layers:[], sel:null, texture:true, guide:true, title:"", pick:"templates", pq:"", busy:false, imgs:{}, drag:null, editing:null, fontsLoaded:false, seq:1};
function dzShirts(){ const s=S.libShirts&&Array.isArray(S.libShirts.items)?S.libShirts.items.filter(x=>x&&/^[0-9a-f]{32}$/.test(String(x.assetId||""))):[];
  return s.length?s.map(x=>({name:String(x.name||"Shirt"),hex:String(x.hex||"#888"),url:"/_blob/"+x.assetId,print:dzOkPrint(x.print)?x.print:{x:.335,y:.235,w:.33,h:.43},dark:!!x.dark})):DZ_FALLBACK.map(([n,h])=>({name:n,hex:h,url:null,print:{x:.33,y:.26,w:.34,h:.44},dark:dzLum(h)<.45})); }
function dzOkPrint(p){ return p&&typeof p==="object"&&["x","y","w","h"].every(k=>typeof p[k]==="number"&&isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&p.w>.05&&p.h>.05; }
function dzLum(h){ const m=String(h).match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if(!m) return .5; const [r,g,b]=[m[1],m[2],m[3]].map(x=>parseInt(x,16)/255); return .2126*r+.7152*g+.0722*b; }
function dzImg(url){ if(!url) return null; let im=DZ.imgs[url]; if(im) return im; im=new Image(); if(/^https?:/i.test(url)) im.crossOrigin="anonymous"; im.onload=()=>dzDraw(); im.onerror=()=>{ im._bad=true; dzDraw(); }; im.src=url; DZ.imgs[url]=im; return im; }
function dzLoadFonts(){ if(DZ.fontsLoaded) return; DZ.fontsLoaded=true; const l=document.createElement("link"); l.rel="stylesheet"; l.href="https://fonts.googleapis.com/css2?"+DZ_FONTS.map(f=>"family="+f.replace(/ /g,"+")+(f==="Big Shoulders Display"?":wght@800":"")).join("&")+"&display=swap"; l.onload=()=>{ if(document.fonts) document.fonts.ready.then(dzDraw); }; document.head.appendChild(l); }
/* ---- page ---- */
function vDesigner(){ const ed=canEditSched(); const saved=(S.mydesigns||[]).slice(0,24);
  return `<section class="card"><div class="card-head"><h2 class="big">Design Studio</h2><span class="eyebrow">templates from what sells, text effects, image tools and an auto-checker</span></div>
    ${ed?`<div id="dzMount"></div>`:`<p class="muted">Only Aaron, signed in with his PIN, can make designs here. Saved designs are below.</p>`}</section>
    <section class="card"><div class="card-head"><h2>Saved designs</h2><span class="eyebrow">${saved.length?`newest ${saved.length}`:"none yet"}</span></div>
      ${saved.length?`<div class="dlgrid">${saved.map(d=>{ const mu=/^[0-9a-f]{32}$/.test(String(d.mockupId||""))?"/_blob/"+d.mockupId:null; return `<div class="dlcard">${mu?`<img src="${mu}" alt="${esc(String(d.title||"Saved design").slice(0,80))}" loading="lazy">`:`<div class="noimg">No preview</div>`}<div class="pc-b"><b>${esc(String(d.title||"Untitled").slice(0,60))}</b><span class="meta">${esc(String(d.shirt||""))} · ${esc(ago(d.at))}</span>${d.sentAt?`<span class="pill ok">Sent to Vera</span>`:""}<div class="row" style="gap:6px;flex-wrap:wrap">${ed?`<button class="btn" data-dzopen="${esc(d.id)}">Open</button>`:""}${/^[0-9a-f]{32}$/.test(String(d.printId||""))?`<a class="btn ghost" href="/_blob/${esc(d.printId)}" target="_blank" rel="noopener">Print file ↗</a>`:""}${ed?`<button class="btn primary" data-ptmy="${esc(d.id)}">Post to stores</button>`:""}</div></div></div>`; }).join("")}</div>`:`<p class="muted small">Designs you save show up here.</p>`}</section>${typeof ptQueueCard==="function"?ptQueueCard():""}`; }
function dzBuild(){ const n=document.createElement("div"); n.className="dz";
  n.innerHTML=`<div class="dzstage"><canvas id="dzCanvas" width="${DZ_W}" height="${DZ_W}" tabindex="0" aria-label="Shirt preview. Drag art to move it; arrow keys nudge the selected layer."></canvas>
      <div class="dzshirts" id="dzShirts" role="group" aria-label="Shirt color"></div>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><label class="small"><input type="checkbox" id="dzTex" checked> Print texture on fabric</label><label class="small"><input type="checkbox" id="dzGuide" checked> Show print area</label><label class="small dzrange" style="min-width:180px">Vintage wear <input type="range" id="dsWear" min="0" max="80" step="1" value="0"></label></div>
      <div class="dscheckbox"><div class="row" style="justify-content:space-between;align-items:center"><b>Auto-checker</b><button type="button" class="btn ghost" id="dsRun">Check now</button></div><div id="dsCheck"></div></div></div>
    <div class="dzside">
      <div class="dzlayers"><div class="row" style="justify-content:space-between;align-items:center"><b>Layers</b><span class="small muted">top layer first</span></div><div id="dzLayers"></div></div>
      <div id="dzProps" class="dzprops"></div>
      <div class="dzpick"><div class="chips" role="tablist">${[["templates","Templates"],["library","Library"],["team","Team designs"],["lab","Design Lab"],["upload","Upload"],["text","Text"]].map(([k,l])=>`<button class="chip" data-dzp="${k}">${l}</button>`).join("")}</div><div id="dzPick"></div></div>
      <div class="dzsave"><label class="fld">Design name <input id="dzTitle" maxlength="80" placeholder="e.g. Shrimp boat summer tee"></label>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn primary" id="dzSave">Save</button><button class="btn" id="dzSend">Save & send to Vera</button><button class="btn ghost" id="dzDl">Download mockup</button><button class="btn ghost" id="dzDlPrint">Download print file</button><button class="btn ghost" id="dzNew">Start over</button></div>
        <p class="small muted" id="dzMsg" role="status"></p></div></div>`;
  const cv=n.querySelector("#dzCanvas");
  cv.addEventListener("pointerdown",dzDown); cv.addEventListener("pointermove",dzMove); cv.addEventListener("pointerup",dzUp); cv.addEventListener("pointercancel",dzUp);
  cv.addEventListener("wheel",e=>{ const L=dzSel(); if(!L||!(e.ctrlKey||document.activeElement===cv)) return; e.preventDefault(); L.scale=Math.max(.05,Math.min(8,L.scale*(e.deltaY<0?1.06:1/1.06))); dzDraw(); dzPaintProps(); },{passive:false});
  cv.addEventListener("keydown",e=>{ const L=dzSel(); if(!L) return; const d=e.shiftKey?20:4; const k={ArrowLeft:[-d,0],ArrowRight:[d,0],ArrowUp:[0,-d],ArrowDown:[0,d]}[e.key]; if(k){ e.preventDefault(); L.x+=k[0]; L.y+=k[1]; dzDraw(); } else if(e.key==="Delete"||e.key==="Backspace"){ e.preventDefault(); dzRemove(L.id); } });
  n.querySelector("#dzTex").onchange=e=>{ DZ.texture=e.target.checked; dzDraw(); };
  n.querySelector("#dzGuide").onchange=e=>{ DZ.guide=e.target.checked; dzDraw(); };
  n.querySelector("#dsWear").oninput=e=>{ DS.wear=+e.target.value; dzDraw(); };
  n.querySelector("#dsRun").onclick=()=>dsRunCheck();
  n.querySelectorAll("[data-dzp]").forEach(b=>b.onclick=()=>{ DZ.pick=b.dataset.dzp; dzPaintPick(); });
  n.querySelector("#dzTitle").oninput=e=>{ DZ.title=e.target.value; };
  n.querySelector("#dzSave").onclick=()=>dzSave(false); n.querySelector("#dzSend").onclick=()=>dzSave(true);
  n.querySelector("#dzDl").onclick=()=>dzDownload(false); n.querySelector("#dzDlPrint").onclick=()=>dzDownload(true);
  n.querySelector("#dzNew").onclick=e=>{ if(!DZ.layers.length||confirmInline(e.target,"Tap again to clear")){ DZ.layers=[]; DZ.sel=null; DZ.title=""; DZ.editing=null; DS.wear=0; const w=n.querySelector("#dsWear"); if(w) w.value=0; DS.check=null; dsPaintCheck(); n.querySelector("#dzTitle").value=""; dzPaintAll(); } };
  return n; }
function dzMount(){ const host=$("#dzMount"); if(!host) return; dzLoadFonts(); if(!DZ.node) DZ.node=dzBuild(); if(DZ.node.parentNode!==host){ host.appendChild(DZ.node); dzPaintAll(); } dzUpgrade(); }
function dzPaintAll(){ dzPaintShirts(); dzPaintLayers(); dzPaintProps(); dzPaintPick(); dzDraw(); }
function dzPaintShirts(){ const box=DZ.node&&DZ.node.querySelector("#dzShirts"); if(!box) return; const sh=dzShirts(); if(DZ.shirt>=sh.length) DZ.shirt=0;
  box.innerHTML=sh.map((s,i)=>`<button type="button" class="dzsw" data-dzs="${i}" aria-pressed="${i===DZ.shirt}" title="${esc(s.name)}" style="background:${/^#[0-9a-f]{6}$/i.test(s.hex)?s.hex:"#888"}"><span class="sr">${esc(s.name)}</span></button>`).join("")+`<span class="small muted">${esc(sh[DZ.shirt].name)}${sh[0].url?"":" · realistic shirt photos are on the way"}</span>`;
  box.querySelectorAll("[data-dzs]").forEach(b=>b.onclick=()=>{ DZ.shirt=+b.dataset.dzs; dzPaintShirts(); dzDraw(); }); }
function dzSel(){ return DZ.layers.find(l=>l.id===DZ.sel)||null; }
function dzPaintLayers(){ const box=DZ.node&&DZ.node.querySelector("#dzLayers"); if(!box) return;
  box.innerHTML=DZ.layers.length?[...DZ.layers].reverse().map(l=>`<div class="dzlayer ${l.id===DZ.sel?"on":""}"><button type="button" class="dzlname" data-dzsel="${l.id}">${l.type==="text"?"T · "+esc(String(l.text).slice(0,24)):"🖼 "+esc(String(l.name||"Image").slice(0,28))}${l.pending?` <span class="small muted">(getting full size…)</span>`:""}</button><button type="button" class="btn ghost" data-dzup="${l.id}" aria-label="Move up">↑</button><button type="button" class="btn ghost" data-dzdown="${l.id}" aria-label="Move down">↓</button><button type="button" class="btn ghost" data-dzrm="${l.id}" aria-label="Remove layer">✕</button></div>`).join(""):`<p class="small muted">Add art or text from below.</p>`;
  box.querySelectorAll("[data-dzsel]").forEach(b=>b.onclick=()=>{ DZ.sel=+b.dataset.dzsel; dzPaintLayers(); dzPaintProps(); dzDraw(); });
  box.querySelectorAll("[data-dzrm]").forEach(b=>b.onclick=()=>dzRemove(+b.dataset.dzrm));
  const mv=(id,d)=>{ const i=DZ.layers.findIndex(l=>l.id===id), j=i+d; if(i<0||j<0||j>=DZ.layers.length) return; [DZ.layers[i],DZ.layers[j]]=[DZ.layers[j],DZ.layers[i]]; dzPaintLayers(); dzDraw(); };
  box.querySelectorAll("[data-dzup]").forEach(b=>b.onclick=()=>mv(+b.dataset.dzup,1)); box.querySelectorAll("[data-dzdown]").forEach(b=>b.onclick=()=>mv(+b.dataset.dzdown,-1)); }
function dzRemove(id){ DZ.layers=DZ.layers.filter(l=>l.id!==id); if(DZ.sel===id) DZ.sel=null; dzPaintLayers(); dzPaintProps(); dzDraw(); }
function dzPaintProps(){ const box=DZ.node&&DZ.node.querySelector("#dzProps"); if(!box) return; const L=dzSel(); if(!L){ box.innerHTML=""; return; }
  const sl=(k,l,min,max,step,v)=>`<label class="small dzrange">${l} <input type="range" data-dzk="${k}" min="${min}" max="${max}" step="${step}" value="${esc(String(+v||0))}"></label>`;
  box.innerHTML=`<b class="small">Selected layer</b>${L.type==="text"?`<label class="fld">Text <input data-dzt="text" value="${esc(L.text)}" maxlength="80"></label>
      <div class="row" style="gap:6px;flex-wrap:wrap"><label class="small">Font <select data-dzt="font">${DZ_FONTS.map(f=>`<option ${f===L.font?"selected":""}>${f}</option>`).join("")}</select></label><label class="small">Color <input type="color" data-dzt="color" value="${esc(L.color)}"></label><label class="small">Outline <input type="color" data-dzt="stroke" value="${esc(L.stroke||"#000000")}"></label></div>
      ${sl("strokeW","Outline width",0,20,1,L.strokeW||0)}`:""}
    ${sl("scale","Size",.05,4,.01,L.scale)}${sl("rot","Rotate",-180,180,1,L.rot)}${sl("opacity","Opacity",.1,1,.01,L.opacity)}${L.type==="img"?sl("bright","Lighten / darken art",-60,60,1,L.bright||0):""}
    <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" class="btn ghost" id="dzCenter">Center in print area</button><button type="button" class="btn ghost" id="dzFlip">Flip</button><button type="button" class="btn ghost" id="dzDup">Duplicate</button></div>
    ${dsPropsExtra(L)}
    ${L.type==="img"&&dzShirts()[DZ.shirt].dark?`<p class="small muted">Dark shirt: if dark parts of the art disappear, use "Lighten" instead of changing the shirt color.</p>`:""}`;
  box.querySelectorAll("[data-dzk]").forEach(i=>i.oninput=()=>{ L[i.dataset.dzk]=+i.value; dzDraw(); });
  box.querySelectorAll("[data-dzt]").forEach(i=>i.oninput=()=>{ L[i.dataset.dzt]=i.value; if(i.dataset.dzt==="text") dzPaintLayers(); dzDraw(); });
  dsBindProps(box,L);
  box.querySelector("#dzCenter").onclick=()=>{ const p=dzPrint(); L.x=p.x+p.w/2; L.y=p.y+p.h/2; dzDraw(); };
  box.querySelector("#dzFlip").onclick=()=>{ L.flip=!L.flip; dzDraw(); };
  box.querySelector("#dzDup").onclick=()=>{ const c={...L,id:DZ.seq++,x:L.x+30,y:L.y+30}; DZ.layers.push(c); DZ.sel=c.id; dzPaintLayers(); dzPaintProps(); dzDraw(); }; }
function dzPrint(){ const p=dzShirts()[DZ.shirt].print; return {x:p.x*DZ_W,y:p.y*DZ_W,w:p.w*DZ_W,h:p.h*DZ_W}; }
/* ---- adding layers ---- */
function dzAddImage(src,name,extra){ const p=dzPrint(); const L={id:DZ.seq++,type:"img",src,name:name||"Image",x:p.x+p.w/2,y:p.y+p.h/2,scale:1,rot:0,opacity:1,bright:0,flip:false,...(extra||{})};
  const sp=dzSprite(src); if(sp){ L.scale=Math.min(p.w*.8/sp.s,p.h*.8/sp.s); DZ.layers.push(L); DZ.sel=L.id; if(DZ.node){ dzPaintLayers(); dzPaintProps(); dzDraw(); } return L; }
  const im=dzImg(src); const fitScale=()=>{ if(!im.naturalWidth) return; L.scale=Math.min(p.w*.9/im.naturalWidth,p.h*.9/im.naturalHeight); L.baseW=im.naturalWidth; dzDraw(); dzPaintProps(); };
  if(im&&im.complete&&im.naturalWidth) fitScale(); else if(im) im.addEventListener("load",fitScale,{once:true});
  DZ.layers.push(L); DZ.sel=L.id; if(DZ.node){ dzPaintLayers(); dzPaintProps(); dzDraw(); } return L; }
/* library item: start with its thumbnail (cut from the sprite sheet), then swap in the full-size copy when the PC sends it */
function dzAddLibrary(o){ const m=libMan(); let src=null;
  if(m&&o.slot>=0){ const g=m.grid||16, T=m.thumb||128, per=g*g, sh=Math.floor(o.slot/per), cell=o.slot%per, url=(m.sheets||{})[sh];
    if(url){ src="sprite:"+url+"#"+((cell%g)*T)+","+(Math.floor(cell/g)*T)+","+T; } }
  const L=dzAddImage(src||"",o.t,{libId:o.id,pending:true});
  libRequest(o,"designer").then(id=>{ if(!id){ L.pending=false; dzPaintLayers(); } else { L.reqId=id; dzUpgrade(); } }); }
function dzUpgrade(){ let ch=false; DZ.layers.forEach(L=>{ if(!L.libId||!L.pending) return; const r=(S.libreq||[]).find(x=>(L.reqId&&x.id===L.reqId)||x.item===L.libId&&x.status==="done");
    if(r&&r.status==="done"&&/^\/_blob\/[0-9a-f]{32}$/.test(r.url||"")){ const old=dzSize(L); L.src=r.url; L.pending=false; ch=true; const im=dzImg(r.url); const keep=()=>{ if(im.naturalWidth&&old) L.scale=old.w/im.naturalWidth; dzDraw(); }; if(im.complete&&im.naturalWidth) keep(); else im.addEventListener("load",keep,{once:true}); }
    else if(r&&r.status==="failed"){ L.pending=false; ch=true; toast(r.error?String(r.error).slice(0,140):"Couldn't get the full-size file; the thumbnail stays."); } });
  if(ch&&DZ.node) dzPaintLayers(); }
function dzSize(L){ if(L.type==="text") return dsTextSize(L);
  const sp=dzSprite(L.src); if(sp) return {w:sp.s*L.scale,h:sp.s*L.scale}; const im=dzImg(L.src); if(!im||!im.naturalWidth) return {w:200*L.scale,h:200*L.scale}; return {w:im.naturalWidth*L.scale,h:im.naturalHeight*L.scale}; }
function dzSprite(src){ const m=/^sprite:(\/_blob\/[0-9a-f]{32})#(\d+),(\d+),(\d+)$/.exec(String(src||"")); return m?{url:m[1],x:+m[2],y:+m[3],s:+m[4]}:null; }
/* ---- picker ---- */
function dzPaintPick(){ const box=DZ.node&&DZ.node.querySelector("#dzPick"); if(!box) return; DZ.node.querySelectorAll("[data-dzp]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.dzp===DZ.pick?"true":"false"));
  const k=DZ.pick;
  if(k==="templates"){ box.innerHTML=dsTemplatesHtml(); box.querySelectorAll("[data-dstpl]").forEach(b=>b.onclick=()=>{ const go=()=>{ dsApplyTemplate(b.dataset.dstpl); dsRunCheck(true); }; if(DZ.layers.some(l=>l.type==="text")&&!confirmInline(b,"Tap again to replace the text")) return; go(); }); return; }
  if(k==="library"){ if(!libMan()){ box.innerHTML=`<p class="small muted">The library is still being built.</p>`; return; } if(!LIB.rows){ box.innerHTML=`<p class="small muted">Loading the library…</p>`; libLoad().then(()=>{ if(DZ.pick==="library") dzPaintPick(); }); return; }
    box.innerHTML=`<input type="search" id="dzPq" placeholder="Search your designs" value="${esc(DZ.pq)}" aria-label="Search your designs"><div class="dzpgrid" id="dzPres"></div>`;
    const res=()=>{ const w=DZ.pq.toLowerCase().split(/\s+/).filter(Boolean); const list=LIB.rows.filter(o=>o.k!=="kittl"&&o.k!=="pack"&&o.slot>=0&&w.every(x=>o.s.includes(x))).slice(0,60);
      const g=box.querySelector("#dzPres"); g.innerHTML=list.map(o=>`<button type="button" class="dzpitem" data-dzlib="${esc(o.id)}" title="${esc(o.t)}">${libThumb(o,72)}</button>`).join("")||`<p class="small muted">No matches.</p>`;
      g.querySelectorAll("[data-dzlib]").forEach(b=>b.onclick=()=>{ const o=LIB.idx[b.dataset.dzlib]; if(o) dzAddLibrary(o); }); };
    const q=box.querySelector("#dzPq"); q.oninput=()=>{ DZ.pq=q.value; res(); }; res(); return; }
  if(k==="team"){ const list=(S.designs||[]).map(d=>({d,u:assetSrc(d.imageId,d.imageUrl)})).filter(x=>x.u).slice(0,60);
    box.innerHTML=list.length?`<div class="dzpgrid">${list.map((x,i)=>`<button type="button" class="dzpitem" data-dzteam="${i}" title="${esc(String(x.d.title||"Design"))}"><img src="${esc(x.u)}" alt="${esc(String(x.d.title||"Design").slice(0,60))}" loading="lazy"></button>`).join("")}</div>`:`<p class="small muted">No team designs with pictures yet.</p>`;
    box.querySelectorAll("[data-dzteam]").forEach(b=>b.onclick=()=>{ const x=list[+b.dataset.dzteam]; dzAddImage(x.u,x.d.title||"Team design"); }); return; }
  if(k==="lab"){ const list=(S.designlab||[]).map(g=>({g,u:dlImg(g)})).filter(x=>x.u&&/^\/_blob\//.test(x.u)).slice(0,60);
    box.innerHTML=list.length?`<div class="dzpgrid">${list.map((x,i)=>`<button type="button" class="dzpitem" data-dzlab="${i}" title="${esc(String(x.g.title||"Image"))}"><img src="${esc(x.u)}" alt="${esc(String(x.g.title||"Design Lab image").slice(0,60))}" loading="lazy"></button>`).join("")}</div>`:`<p class="small muted">Images you generate in the Design Lab show up here.</p>`;
    box.querySelectorAll("[data-dzlab]").forEach(b=>b.onclick=()=>{ const x=list[+b.dataset.dzlab]; dzAddImage(x.u,x.g.title||"Design Lab image"); }); return; }
  if(k==="upload"){ box.innerHTML=`<label class="btn">Choose a picture<input type="file" id="dzFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label><p class="small muted">PNG with a transparent background works best.</p>`;
    box.querySelector("#dzFile").onchange=e=>{ const f=e.target.files[0]; if(!f) return; if(f.size>25e6){ toast("That picture is over 25 MB."); return; } const L=dzAddImage(URL.createObjectURL(f),f.name.replace(/\.[^.]+$/,"")); L.file=f; e.target.value=""; }; return; }
  if(k==="text"){ box.innerHTML=`<label class="fld">Text <input id="dzTxt" maxlength="80" placeholder="e.g. LOWCOUNTRY"></label><div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><select id="dzTxtFont" aria-label="Font">${DZ_FONTS.map(f=>`<option>${f}</option>`).join("")}</select><input type="color" id="dzTxtColor" value="${dzShirts()[DZ.shirt].dark?"#f3ead7":"#1b1c1f"}" aria-label="Text color"><button type="button" class="btn" id="dzTxtAdd">Add text</button></div>`;
    box.querySelector("#dzTxtAdd").onclick=()=>{ const t=box.querySelector("#dzTxt").value.trim(); if(!t){ toast("Type the text first."); return; } const p=dzPrint();
      const L={id:DZ.seq++,type:"text",text:t,font:box.querySelector("#dzTxtFont").value,color:box.querySelector("#dzTxtColor").value,stroke:"#000000",strokeW:0,size:120,x:p.x+p.w/2,y:p.y+p.h*.2,scale:1,rot:0,opacity:1};
      const c=document.createElement("canvas").getContext("2d"); c.font=`120px "${L.font}"`; const w=c.measureText(t).width; L.scale=Math.min(1,(p.w*.9)/Math.max(w,1));
      DZ.layers.push(L); DZ.sel=L.id; box.querySelector("#dzTxt").value=""; dzPaintLayers(); dzPaintProps(); dzDraw(); }; return; } }
/* ---- drawing ---- */
function dzDrawLayer(ctx,L,sc){ ctx.save(); ctx.globalAlpha=L.opacity; ctx.translate(L.x*sc,L.y*sc); ctx.rotate((L.rot||0)*Math.PI/180); if(L.flip) ctx.scale(-1,1);
  if(L.type==="text"){ dsDrawText(ctx,L,sc); }
  else { if(L.bright) ctx.filter=`brightness(${100+L.bright*1.5}%)`; const sp=dzSprite(L.src);
    if(sp){ const im=dzImg(sp.url); if(im&&im.complete&&im.naturalWidth){ const s=sp.s*L.scale*sc; ctx.drawImage(im,sp.x,sp.y,sp.s,sp.s,-s/2,-s/2,s,s); } }
    else { const im=dzImg(L.src); if(im&&im.complete&&im.naturalWidth&&!im._bad){ const w=im.naturalWidth*L.scale*sc, h=im.naturalHeight*L.scale*sc; ctx.drawImage(im,-w/2,-h/2,w,h); } } }
  ctx.restore(); }
function dzCompose(ctx,size,{guide,sel}){ const sh=dzShirts()[DZ.shirt], sc=size/DZ_W; ctx.clearRect(0,0,size,size);
  const shirtIm=sh.url?dzImg(sh.url):null;
  if(shirtIm&&shirtIm.complete&&shirtIm.naturalWidth) ctx.drawImage(shirtIm,0,0,size,size); else dzFallbackShirt(ctx,size,sh.hex);
  const art=document.createElement("canvas"); art.width=size; art.height=size; const a=art.getContext("2d"); DZ.layers.forEach(L=>dzDrawLayer(a,L,sc)); dsApplyWear(a,size,DS.wear,sc);
  if(DZ.texture){ a.globalCompositeOperation="source-atop"; a.globalAlpha=.32; if(shirtIm&&shirtIm.complete&&shirtIm.naturalWidth){ a.filter="grayscale(1) contrast(1.4)"; a.drawImage(shirtIm,0,0,size,size); a.filter="none"; } else { dzNoise(a,size); } a.globalAlpha=1; a.globalCompositeOperation="source-over"; }
  ctx.drawImage(art,0,0);
  if(guide){ const p=dzPrint(); ctx.save(); ctx.setLineDash([10*sc,8*sc]); ctx.lineWidth=2*sc; ctx.strokeStyle=sh.dark?"rgba(255,255,255,.45)":"rgba(0,0,0,.35)"; ctx.strokeRect(p.x*sc,p.y*sc,p.w*sc,p.h*sc); ctx.restore(); }
  if(sel){ const L=dzSel(); if(L){ const s=dzSize(L); ctx.save(); ctx.translate(L.x*sc,L.y*sc); ctx.rotate((L.rot||0)*Math.PI/180); ctx.strokeStyle="#3a82f6"; ctx.lineWidth=2*sc; ctx.strokeRect(-s.w/2*sc,-s.h/2*sc,s.w*sc,s.h*sc); ctx.fillStyle="#3a82f6"; const hs=dzHandle()*.8; ctx.fillRect((s.w/2-hs/2)*sc,(s.h/2-hs/2)*sc,hs*sc,hs*sc); ctx.restore(); } } }
function dzNoise(a,size){ const n=document.createElement("canvas"); n.width=n.height=64; const c=n.getContext("2d"), d=c.createImageData(64,64); for(let i=0;i<d.data.length;i+=4){ const v=110+Math.random()*90; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255; } c.putImageData(d,0,0); a.fillStyle=a.createPattern(n,"repeat"); a.fillRect(0,0,size,size); }
function dzFallbackShirt(ctx,s,hex){ const k=s/1000; ctx.fillStyle="#e9e6e1"; ctx.fillRect(0,0,s,s);
  const p=new Path2D(`M${330*k} ${110*k} L${420*k} ${80*k} Q${500*k} ${140*k} ${580*k} ${80*k} L${670*k} ${110*k} L${880*k} ${230*k} L${800*k} ${390*k} L${720*k} ${350*k} L${720*k} ${900*k} Q${500*k} ${925*k} ${280*k} ${900*k} L${280*k} ${350*k} L${200*k} ${390*k} L${120*k} ${230*k} Z`);
  ctx.save(); ctx.shadowColor="rgba(0,0,0,.25)"; ctx.shadowBlur=30*k; ctx.shadowOffsetY=12*k; ctx.fillStyle=hex; ctx.fill(p); ctx.restore();
  ctx.save(); ctx.clip(p); const g=ctx.createLinearGradient(0,0,s,0); g.addColorStop(0,"rgba(0,0,0,.18)"); g.addColorStop(.5,"rgba(255,255,255,.06)"); g.addColorStop(1,"rgba(0,0,0,.18)"); ctx.fillStyle=g; ctx.fillRect(0,0,s,s); ctx.restore(); }
/* corner handle: at least ~22 screen px on any screen size */
function dzHandle(){ const cv=DZ.node&&DZ.node.querySelector("#dzCanvas"); const w=cv&&cv.clientWidth||DZ_W; return Math.max(26,22*DZ_W/w); }
function dzDraw(){ const cv=DZ.node&&DZ.node.querySelector("#dzCanvas"); if(!cv) return; cancelAnimationFrame(DZ.raf); DZ.raf=requestAnimationFrame(()=>dzCompose(cv.getContext("2d"),DZ_W,{guide:DZ.guide,sel:true})); }
/* ---- pointer: select, drag, corner-scale ---- */
function dzPt(e){ const cv=e.currentTarget, r=cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*DZ_W/r.width,y:(e.clientY-r.top)*DZ_W/r.height}; }
function dzLocal(L,p){ const a=-(L.rot||0)*Math.PI/180, dx=p.x-L.x, dy=p.y-L.y; return {x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)}; }
function dzDown(e){ const p=dzPt(e); const cur=dzSel();
  if(cur){ const s=dzSize(cur), q=dzLocal(cur,p); const hk=dzHandle(); if(Math.abs(q.x-s.w/2)<hk&&Math.abs(q.y-s.h/2)<hk){ DZ.drag={mode:"scale",id:cur.id,d0:Math.hypot(q.x,q.y),s0:cur.scale}; e.currentTarget.setPointerCapture(e.pointerId); return; } }
  for(let i=DZ.layers.length-1;i>=0;i--){ const L=DZ.layers[i], s=dzSize(L), q=dzLocal(L,p); if(Math.abs(q.x)<=s.w/2&&Math.abs(q.y)<=s.h/2){ DZ.sel=L.id; DZ.drag={mode:"move",id:L.id,ox:p.x-L.x,oy:p.y-L.y}; e.currentTarget.setPointerCapture(e.pointerId); dzPaintLayers(); dzPaintProps(); dzDraw(); return; } }
  if(DZ.sel){ DZ.sel=null; dzPaintLayers(); dzPaintProps(); dzDraw(); } }
function dzMove(e){ const d=DZ.drag; if(!d) return; const L=DZ.layers.find(l=>l.id===d.id); if(!L) return; const p=dzPt(e);
  if(d.mode==="move"){ L.x=p.x-d.ox; L.y=p.y-d.oy; } else { const q=dzLocal(L,p); L.scale=Math.max(.03,Math.min(8,d.s0*Math.hypot(q.x,q.y)/Math.max(d.d0,1))); } dzDraw(); }
function dzUp(){ if(DZ.drag){ DZ.drag=null; dzPaintProps(); } }
/* ---- export ---- */
function dzBlob(cv){ return new Promise((res,rej)=>{ try{ cv.toBlob(b=>b?res(b):rej(new Error("empty")),"image/png"); }catch(e){ rej(e); } }); }
async function dzRender(print){ if(DZ.layers.some(l=>l.pending)) toast("Some art is still the small preview; the full-size copy is on its way.");
  if(!print){ const c=document.createElement("canvas"); c.width=c.height=DZ_W*1.6; dzCompose(c.getContext("2d"),c.width,{guide:false,sel:false}); return dzBlob(c); }
  const p=dzPrint(), k=300*DS_PRINT_IN/p.w; const c=document.createElement("canvas"); c.width=Math.round(p.w*k); c.height=Math.round(p.h*k); const ctx=c.getContext("2d"); ctx.translate(-p.x*k,-p.y*k); DZ.layers.forEach(L=>dzDrawLayer(ctx,L,k)); ctx.setTransform(1,0,0,1,0,0); dsApplyWear(ctx,Math.max(c.width,c.height),DS.wear,k,-p.x*k*0,0); return dzBlob(c); }
function dzMsg(t){ const m=DZ.node&&DZ.node.querySelector("#dzMsg"); if(m) m.textContent=t||""; }
async function dzDownload(print){ if(!DZ.layers.length){ toast("Add some art first."); return; } if(print&&!dsGate("download the print file")) return; if(!downloads){ toast("Downloads aren't available in this view."); return; }
  try{ const b=await dzRender(print); await downloads.save({filename:(DZ.title||"design").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-").slice(0,60)+(print?"-print.png":"-mockup.png"),data:b}); }
  catch(e){ if(e&&e.code==="cancelled") return; toast(e&&e.name==="SecurityError"?"One picture came from another website, so it can't be exported. Use a library, Design Lab or uploaded image.":"Couldn't make the file."); } }
async function dzSave(send){ if(!canEditSched()){ toast("Only Aaron, signed in with his PIN, can save designs."); return; } if(DZ.busy) return; if(!DZ.layers.length){ toast("Add some art first."); return; }
  if(!assets||!db){ toast("Saving needs this console open on claude.ai."); return; } const title=(DZ.title||"").trim(); if(!title){ toast("Give the design a name."); const t=DZ.node.querySelector("#dzTitle"); if(t) t.focus(); return; }
  if(!dsGate(send?"send it":"save")) return;
  const snap=JSON.stringify(DZ.layers.map(l=>{ const o={...l}; delete o.file; return o; }));
  DZ.busy=true; dzMsg("Saving…");
  try{ const mock=await dzRender(false), pr=await dzRender(true); const a1=await assets.upload(mock), a2=await assets.upload(pr);
    for(const l of DZ.layers){ if(l.file&&/^blob:/.test(l.src||"")){ const up=await assets.upload(l.file); l.src=up.url; delete l.file; } }
    const now=JSON.stringify(DZ.layers.map(l=>{ const o={...l}; delete o.file; return o; }));
    if(now!==snap.replace(/"src":"blob:[^"]*"/g,"")&&now.replace(/"src":"[^"]*"/g,"")!==snap.replace(/"src":"[^"]*"/g,"")){ dzMsg(""); toast("The design changed while saving. Check it and save again."); return; }
    const layers=DZ.layers.map(l=>{ const o={...l}; delete o.file; delete o.pending; if(/^blob:/.test(o.src||"")) o.src=""; return o; });
    const sh=dzShirts()[DZ.shirt]; const tplL=DZ.layers.find(l=>l.tpl); const data={title,shirt:sh.name,shirtHex:sh.hex,layers,mockupId:a1.id,printId:a2.id,at:new Date().toISOString(),by:CUR,wear:DS.wear||0,tpl:tplL?tplL.tpl:null,check:(DS.check?DS.check.items:[]).filter(i=>i.lvl!=="ok").map(i=>i.lvl+": "+i.what).slice(0,20)};
    let id=DZ.editing; const prev=id?(S.mydesigns||[]).find(x=>x.id===id):null; if(prev&&prev.sentAt&&!send) data.sentAt=prev.sentAt;
    if(id){ await db.doc("mydesigns/"+id).set(data); if(prev&&assets&&assets.delete){ for(const old of [prev.mockupId,prev.printId]) if(/^[0-9a-f]{32}$/.test(String(old||""))&&old!==a1.id&&old!==a2.id) assets.delete(old).catch(()=>{}); } } else { const r=await db.collection("mydesigns").add(data); id=r.id; DZ.editing=id; }
    if(send){ await addReq({for:"vera",by:"aaron",what:`Aaron made a shirt design in the console's Design Studio: "${title}" on a ${sh.name} shirt. Mockup: /_blob/${a1.id} · print file: /_blob/${a2.id} (HQ doc mydesigns/${id}). The console's auto-checker passed it (notes: ${(data.check||[]).join(" | ")||"none"}). Review it through your quality gate too, prepare it for listing, and tell Stephanie when it's ready.`,status:"open",at:new Date().toISOString()});
      await db.doc("mydesigns/"+id).update({sentAt:new Date().toISOString()}); const tid=tidOf("vera"); if(tid) fireNow(tid,`Aaron sent you a shirt design: mydesigns/${id}. Pick it up from your requests now.`); }
    dzMsg(send?"Saved and sent to Vera.":"Saved."); toast(send?"Saved and sent to Vera.":"Design saved."); }
  catch(e){ console.error(e); dzMsg(""); toast(e&&e.name==="SecurityError"?"One picture came from another website, so it can't be saved. Use a library, Design Lab or uploaded image.":e&&e.code==="quota_or_state"?"The console's storage is full. Remove old images first.":"Couldn't save. Try again."); }
  finally{ DZ.busy=false; } }
function dzClean(l){ const n=(v,d,lo,hi)=>{ v=+v; if(!isFinite(v)) v=d; return Math.max(lo,Math.min(hi,v)); }; const hex=(v,d)=>/^#[0-9a-f]{6}$/i.test(String(v||""))?String(v):d;
  const o={type:l.type==="text"?"text":"img",x:n(l.x,500,-2000,3000),y:n(l.y,500,-2000,3000),scale:n(l.scale,1,.01,20),rot:n(l.rot,0,-360,360),opacity:n(l.opacity,1,.05,1),flip:!!l.flip};
  if(o.type==="text") Object.assign(o,{text:String(l.text||"").slice(0,120),font:DZ_FONTS.includes(l.font)?l.font:DZ_FONTS[0],color:hex(l.color,"#ffffff"),stroke:hex(l.stroke,"#000000"),strokeW:n(l.strokeW,0,0,40),size:n(l.size,120,10,600),warp:["none","arc","arcdown","bridge","valley","wave","rise"].includes(l.warp)?l.warp:"none",warpAmt:n(l.warpAmt,40,0,100),spacing:n(l.spacing,0,-20,120),caps:!!l.caps,shadowOn:!!l.shadowOn,shadow:hex(l.shadow,"#000000"),shadowX:n(l.shadowX,6,-40,40),shadowY:n(l.shadowY,6,-40,40),tpl:DS_TEMPLATES.some(t=>t.id===l.tpl)?l.tpl:undefined});
  else Object.assign(o,{src:String(l.src||""),name:String(l.name||"Image").slice(0,80),bright:n(l.bright,0,-60,60),libId:l.libId?String(l.libId).slice(0,200):undefined,srcPx:l.srcPx?n(l.srcPx,0,1,20000):undefined});
  return o; }
function dzOpen(id){ const d=(S.mydesigns||[]).find(x=>x.id===id); if(!d) return; DZ.layers=(Array.isArray(d.layers)?d.layers:[]).filter(l=>l&&(l.type==="text"||/^(\/_blob\/[0-9a-f]{32}|sprite:\/_blob\/[0-9a-f]{32}#\d+,\d+,\d+)$/.test(String(l.src||"")))).map(l=>({...dzClean(l),id:DZ.seq++,pending:/^sprite:/.test(String(l.src))&&!!l.libId})); DZ.sel=null; DZ.title=String(d.title||""); DZ.editing=id; DS.wear=+d.wear||0; if(DZ.node){ const w=DZ.node.querySelector("#dsWear"); if(w) w.value=DS.wear; }
  const i=dzShirts().findIndex(s=>s.name===d.shirt); DZ.shirt=i>=0?i:0; if(DZ.node){ DZ.node.querySelector("#dzTitle").value=DZ.title; dzPaintAll(); }
  (Array.isArray(d.layers)?d.layers:[]).filter(l=>l&&l.type==="img"&&l.libId&&!/^(\/_blob\/|sprite:)/.test(String(l.src||""))).forEach(l=>{ DZ.layers.push({...dzClean(l),src:"",id:DZ.seq++,pending:true}); });
  if(DZ.node) dzPaintAll(); dzUpgrade();
  const lost=(Array.isArray(d.layers)?d.layers:[]).filter(l=>l&&l.type==="img"&&!l.libId&&!/^(\/_blob\/|sprite:)/.test(String(l.src||""))).length; if(lost) toast(lost+" uploaded picture"+(lost>1?"s":"")+" can't be reopened; add them again."); }
function bindDesigner(){ if(S.tab!=="designer") return; dzMount(); document.querySelectorAll("[data-dzopen]").forEach(b=>b.onclick=()=>{ dzOpen(b.dataset.dzopen); window.scrollTo({top:0,behavior:"smooth"}); }); }

/* ================= POST IT: one click from any library file, saved design or 3D item → Shopify + Etsy for Elevated Designs or Charleston 3D.
   The PC worker (PT_WORKER) copies the file (read-only from E:), makes realistic photos, writes the SEO copy, runs the independent checker,
   then hands a ready listing to Carla, who posts it. ===== E-DRIVE SYNC: console images ⇄ E:\Creative Lab Studios Console, plus a rescan. ================= */
const PT_WORKER="trig_01PhZRZUf8Rj25xPRHN3ga1a", ES_WORKER="trig_01Lpcqc1L484zxhH86VwxSwK";
const PT_BIZ={ed:{name:"Elevated Designs",shopify:"theelevateddesignsllc.com",etsy:"ElevatedDesignsSC"},c3d:{name:"Charleston 3D",shopify:"charleston3d.com",etsy:"Charleston3DWorks"}};
const PT_ST={queued:"Waiting for the PC",preparing:"Making photos & copy",checking:"Checker reviewing",license:"License check (Andy)",ready:"Sent to Carla to post",posted:"Live",failed:"Needs a fix"};
function ptCan(){ return typeof canEditSched==="function"&&canEditSched()&&!!db; }
function ptSheet(html){ const opener=document.activeElement; const box=document.createElement("div"); box.className="xsheet"; box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true"); box.setAttribute("aria-label","Post to stores");
  box.innerHTML=`<div class="xpanel">${html}</div>`; document.body.appendChild(box);
  const close=()=>{ box.remove(); if(opener&&opener.isConnected) try{opener.focus({preventScroll:true})}catch{} };
  box.onclick=e=>{ if(e.target===box) close(); }; box.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); close(); } });
  setTimeout(()=>{ const f=box.querySelector("select,input,button"); if(f) f.focus({preventScroll:true}); },30); return {box,close}; }
/* src: {type:"library"|"mydesign"|"printidea", id, name, kind, dir, files, fm, thumb} */
function ptOpen(src){ if(!ptCan()){ toast("Only Aaron, signed in with his PIN, can post to the stores."); return; }
  const is3d=src.kind==="3d"||(src.fm||[]).some(f=>/^(stl|3mf|obj|step)$/i.test(f)); const biz=is3d?"c3d":"ed";
  const prev=(S.postjobs||[]).find(j=>j.source&&j.source.id===src.id&&!/failed/.test(j.status||""));
  const {box,close}=ptSheet(`<div class="xhead"><h2>Post to stores</h2><button class="btn" data-x>Close</button></div>
    <p class="small"><b>${esc(String(src.name||"Item").slice(0,90))}</b>${src.dir?`<br><span class="muted">E:\\${esc(String(src.dir).replace(/^\\\\\?\\E:\\?/,"").slice(0,140))}</span>`:""}</p>
    ${prev?`<p class="alertbar small">Already sent on ${esc(ago(prev.at))} (${esc(PT_ST[prev.status]||prev.status)}). Sending again makes a second listing.</p>`:""}
    <div class="ptgrid">
      <label class="fld">Business <select id="ptBiz"><option value="ed" ${biz==="ed"?"selected":""}>Elevated Designs (shirts)</option><option value="c3d" ${biz==="c3d"?"selected":""}>Charleston 3D (3D prints)</option></select></label>
      <fieldset class="ptwhere"><legend class="small muted">Where</legend><label class="small"><input type="checkbox" id="ptShop" checked> <span id="ptShopL"></span></label><label class="small"><input type="checkbox" id="ptEtsy" checked> <span id="ptEtsyL"></span></label></fieldset>
      <label class="fld">Price (USD) <input id="ptPrice" inputmode="decimal" placeholder="${biz==="ed"?"28":"e.g. 18"}"></label>
      <label class="fld">Title idea (optional) <input id="ptTitle" maxlength="120" placeholder="Leave blank and the copywriter writes an SEO title"></label>
      <label class="fld" id="ptLicW">Who made this file? <select id="ptLic"><option value="">Choose…</option><option value="mine">My own design</option><option value="licensed">Bought with a license to sell prints</option><option value="unsure">Not sure (Andy checks the license first)</option></select></label>
      <label class="fld">Notes for the listing (optional) <textarea id="ptNote" rows="2" maxlength="400" placeholder="e.g. Christmas gift, comes in 3 colors, personalize with a name"></textarea></label>
    </div>
    <div class="ptfee small" id="ptFee"></div>
    <label class="small"><input type="checkbox" id="ptOk"> <span id="ptOkL"></span></label>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" id="ptGo">Post it</button><span class="small muted">The checker reviews the photos and copy before anything goes live.</span></div>`);
  const $b=s=>box.querySelector(s);
  const paint=()=>{ const b=$b("#ptBiz").value, P=PT_BIZ[b]; $b("#ptShopL").textContent="Shopify · "+P.shopify; $b("#ptEtsyL").textContent="Etsy · "+P.etsy;
    const etsy=$b("#ptEtsy").checked; $b("#ptFee").innerHTML=`Fees: ${etsy?"Etsy charges <b>$0.20</b> to list (plus its usual fees only when it sells).":"No Etsy listing fee."} Shopify has no listing fee.`;
    $b("#ptOkL").textContent=etsy?"I approve the $0.20 Etsy listing fee":"I approve posting this live"; $b("#ptLicW").hidden=b!=="c3d"; };
  ["#ptBiz","#ptEtsy","#ptShop"].forEach(s=>$b(s).onchange=paint); paint();
  $b("[data-x]").onclick=close;
  $b("#ptGo").onclick=async()=>{ const b=$b("#ptBiz").value, shop=$b("#ptShop").checked, etsy=$b("#ptEtsy").checked; const price=$b("#ptPrice").value.trim();
    if(!shop&&!etsy){ toast("Pick Shopify, Etsy or both."); return; } if(price&&!(+price>0&&+price<1000)){ toast("Price should be a number like 28."); return; }
    if(b==="c3d"&&!$b("#ptLic").value){ toast("Say who made the file first."); return; } if(!$b("#ptOk").checked){ toast(etsy?"Tick the box to approve the $0.20 Etsy fee.":"Tick the box to approve posting."); return; }
    if(b==="ed"&&is3d){ toast("3D files go to Charleston 3D, not the shirt shop."); return; }
    const go=$b("#ptGo"); go.disabled=true; go.textContent="Sending…";
    try{ const now=new Date().toISOString(); const ch=[shop?"shopify":null,etsy?"etsy":null].filter(Boolean);
      const doc={biz:b,channels:ch,price:price?Number(price):null,titleIdea:$b("#ptTitle").value.trim().slice(0,120),note:$b("#ptNote").value.trim().slice(0,400),license:b==="c3d"?$b("#ptLic").value:"mine",feeOk:etsy?0.20:0,
        source:{type:src.type,id:String(src.id||""),name:String(src.name||"").slice(0,160),kind:src.kind||"",dir:String(src.dir||"").slice(0,400),files:(src.files||[]).slice(0,40).map(f=>String(f).slice(0,200)),fm:(src.fm||[]).slice(0,12),mockupId:src.mockupId||null,printId:src.printId||null},
        status:"queued",at:now,by:"aaron"};
      const ref=await db.collection("postjobs").add(doc); let fired=false; try{ fired=await fireNow(PT_WORKER,`One-click post queued by Aaron: postjobs/${ref.id}. Run it now.`); }catch(x){}
      close(); toast(fired?"Sent. The PC makes the photos and copy, the checker reviews them, then Carla posts it.":"Queued. The PC picks it up on its next run."); }
    catch(e){ console.error(e); toast("Couldn't send it. Try again."); go.disabled=false; go.textContent="Post it"; } }; }
function ptQueueCard(){ const J=(S.postjobs||[]).slice(0,12); if(!J.length) return "";
  return `<section class="card"><div class="card-head"><h2>Posting queue</h2><span class="eyebrow">one-click posts to Shopify and Etsy</span></div>
    <div class="ptq">${J.map(j=>{ const s=j.status||"queued"; const links=[j.shopifyUrl&&safeUrl(j.shopifyUrl)?`<a href="${esc(safeUrl(j.shopifyUrl))}" target="_blank" rel="noopener">Shopify ↗</a>`:"",j.etsyUrl&&safeUrl(j.etsyUrl)?`<a href="${esc(safeUrl(j.etsyUrl))}" target="_blank" rel="noopener">Etsy ↗</a>`:""].filter(Boolean).join(" · ");
      const ph=j.photo&&/^\/_blob\/[0-9a-f]{32}$/.test(j.photo)?`<img src="${esc(j.photo)}" alt="" loading="lazy">`:`<span class="noimg"></span>`;
      return `<div class="ptrow">${ph}<div><b>${esc(String(j.title||(j.source&&j.source.name)||"Item").slice(0,80))}</b><span class="small muted">${esc((PT_BIZ[j.biz]||{}).name||"")} · ${esc((j.channels||[]).map(c=>c==="shopify"?"Shopify":"Etsy").join(" + "))} · ${esc(ago(j.at))}</span>
        <span class="pill ${s==="posted"?"ok":s==="failed"?"bad":""}">${esc(PT_ST[s]||s)}</span>${j.check?`<span class="small ${j.check.pass?"":"bad"}">Checker: ${j.check.pass?"passed":"failed"}${j.check.notes?" · "+esc(String(j.check.notes).slice(0,200)):""}</span>`:""}${j.error?`<span class="small bad">${esc(String(j.error).slice(0,200))}</span>`:""}${links?`<span class="small">${links}</span>`:""}</div></div>`; }).join("")}</div></section>`; }
/* ---- E drive sync ---- */
function esCard(){ const st=S.esync||{}; const ed=ptCan();
  return `<div class="essync"><div><b>E drive sync</b><span class="small muted"> New images made or dropped in the console are copied to E:\\Creative Lab Studios Console (new files only, nothing on E: is changed or deleted); new files you add to E: show up here after the rescan.${st.at?` Last sync ${esc(ago(st.at))}: ${Number(st.toE||0)} to E:, ${Number(st.fromE||0)} new from E:.`:""}${st.note?" "+esc(String(st.note).slice(0,160)):""}</span></div>
    ${ed?`<button class="btn" id="esGo" ${st.running?"disabled":""}>${st.running?"Syncing…":"Sync now"}</button>`:""}</div>`; }
async function esGo(btn){ if(!ptCan()) return; btn.disabled=true; btn.textContent="Starting…";
  try{ await db.doc("library/esyncreq").set({at:new Date().toISOString(),by:"aaron"}); const ok=await fireNow(ES_WORKER,"Aaron pressed Sync now in the Design library. Run a full two-way sync now."); toast(ok?"Sync started. New files show up as they finish.":"Queued for the next sync run."); }
  catch(e){ toast("Couldn't start the sync."); btn.disabled=false; btn.textContent="Sync now"; } }
function bindPostIt(){ const g=document.getElementById("esGo"); if(g) g.onclick=()=>esGo(g);
  document.querySelectorAll("[data-ptmy]").forEach(b=>b.onclick=()=>{ const d=(S.mydesigns||[]).find(x=>x.id===b.dataset.ptmy); if(d) ptOpen({type:"mydesign",id:d.id,name:d.title,kind:"design",mockupId:d.mockupId,printId:d.printId}); });
  document.querySelectorAll("[data-ptpi]").forEach(b=>b.onclick=()=>{ const d=(S.printideas||[]).find(x=>x.id===b.dataset.ptpi); if(d) ptOpen({type:"printidea",id:d.id,name:d.title,kind:"3d"}); }); }
