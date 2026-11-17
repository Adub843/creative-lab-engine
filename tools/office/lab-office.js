/* ---------- Office suite: Documents, Spreadsheets and the Photo editor (Aaron 2026-11-15) ----------
   Published in the Lab as js/office.js (source: Adub843/creative-lab-engine tools/office/lab-office.js).
   The three editors are open-source programs that run right in this page, no server needed:
     Documents     SuperDoc (AGPL-3.0)  real Word .docx: pages, tables, headers, comments, track changes
     Spreadsheets  Univer (Apache-2.0) + SheetJS  Excel-style sheets, 400+ formulas, .xlsx/.xls/.csv
     Photo editor  miniPaint (MIT)      Photoshop-style layers, selections, brushes, clone, effects
   Their pages live in engine/tools/office/ and open in a frame on Office ▸ Office suite (Photo editor also on Make).
   Kittl stays the main design tool; these are for everyday office work and quick picture fixes.

   Files are rows in the db collection "office" (so Stacy, Alice and Claude can list, read and write them):
     {kind:"doc"|"sheet"|"image", title, by, byName, at, updatedAt, size, fileName,
      fileId   asset id of the file (.docx/.xlsx wrapped as JSON {name,type,b64} because the asset store takes no
               Office types; .png stored as is), extraId  asset id of the full-fidelity copy (sheet workbook / photo
               layers, JSON), previewId  small picture, text  plain text of the file for agents (60k chars max)}
   An agent makes a draft by writing a row with no fileId: doc {html} or {markdown}; sheet {rows:[[...]]} or
   {sheets:[{name,rows}]} (cells starting with "=" are formulas); image {src:"/_blob/<id>" or https link}.
   It opens in the editor and Save turns it into a real file. */
(function(){
  const OFF_KIND={doc:{t:"Documents",page:"offdocs",ext:"docx",type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    sheet:{t:"Spreadsheets",page:"offsheets",ext:"xlsx",type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    image:{t:"Photo editor",page:"offphoto",ext:"png",type:"image/png"}};
  const TEXT_MAX=60000;
  const ready=async()=>{ try{ if(typeof init==="function") await init(); }catch(e){} if(!db) throw Object.assign(new Error("Open the Lab on claude.ai to use Lab files."),{code:"no_db"}); };
  const b64=async blob=>{ const u8=new Uint8Array(await blob.arrayBuffer()); let s=""; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return btoa(s); };
  const unb64=(s,type)=>{ const bin=atob(s); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return new Blob([u],{type}); };
  async function put(blob,type){ if(!assets) throw Object.assign(new Error("Saving files needs editor access to the Lab."),{code:"no_assets"});
    const r=await assets.upload(blob,{type}); return r.id; }
  async function drop(id){ if(id&&assets) try{ await assets.delete(id); }catch(e){ console.warn("office: old file not removed",id,e); } }
  async function getJson(id){ const r=await fetch("/_blob/"+id); if(!r.ok) throw new Error("file "+r.status); return r.json(); }
  async function sampleNs(){ if(typeof sample!=="undefined"&&sample) return sample; try{ return await window.claude.use("sample"); }catch{ return null; } }

  window.LAB_OFFICE={
    me:()=>{ try{ return me(); }catch{ return "Aaron"; } },
    async list(kind){ await ready(); const s=await db.collection("office").limit(500).get();
      return s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.kind===kind&&!x.removed).sort((a,b)=>String(b.updatedAt||b.at||"").localeCompare(String(a.updatedAt||a.at||""))); },
    async load(id){ await ready(); const d=await db.doc("office/"+id).get(); if(!d.exists) throw new Error("That file is gone.");
      const row={id,...d.data()}; let blob=null, extra=null;
      if(row.extraId) try{ extra=await getJson(row.extraId); }catch(e){ console.warn("office: full copy missing, using the file",e); }
      if(row.fileId&&!extra){ if(row.wrapped){ const w=await getJson(row.fileId); blob=unb64(w.b64,w.type); } else { const r=await fetch("/_blob/"+row.fileId); if(!r.ok) throw new Error("file "+r.status); blob=await r.blob(); } }
      return {row,blob,extra}; },
    async save(o){ await ready(); const K=OFF_KIND[o.kind]; if(!K) throw new Error("Unknown file kind.");
      const now=new Date().toISOString(), who=LAB_OFFICE.me();
      const old=o.id?await db.doc("office/"+o.id).get().then(d=>d.exists?d.data():null).catch(()=>null):null;
      const wrapped=o.kind!=="image";
      const fileId=wrapped?await put(new Blob([JSON.stringify({name:o.title+"."+K.ext,type:o.type||K.type,b64:await b64(o.blob)})],{type:"application/json"}),"application/json"):await put(o.blob,"image/png");
      let extraId=null, previewId=null;
      try{ if(o.extra) extraId=await put(new Blob([JSON.stringify(o.extra)],{type:"application/json"}),"application/json"); }catch(e){ console.warn("office: full copy not saved",e); }
      try{ if(o.preview) previewId=await put(o.preview,o.preview.type||"image/webp"); }catch(e){ console.warn("office: preview not saved",e); }
      const row={kind:o.kind,title:String(o.title||"Untitled").slice(0,120),fileId,wrapped,extraId,previewId,fileName:String(o.title||"Untitled").slice(0,120)+"."+K.ext,
        size:o.blob.size,type:o.type||K.type,text:String(o.text||"").slice(0,TEXT_MAX),updatedAt:now,updatedBy:who.toLowerCase(),
        html:null,markdown:null,rows:null,sheets:null,csv:null,src:null};
      let id=o.id;
      if(id&&old){ await db.doc("office/"+id).update(row); }
      else { const ref=await db.collection("office").add({...row,at:now,by:who.toLowerCase(),byName:who}); id=ref.id; }
      if(old){ await drop(old.fileId!==fileId?old.fileId:null); await drop(old.extraId); await drop(old.previewId); }
      if(typeof logAct==="function") try{ logAct(who.toLowerCase(),`saved ${K.t.toLowerCase().replace(/s$/,"")} "${row.title}" in Lab files`); }catch{}
      return {id,at:now}; },
    async remove(id){ await ready(); const d=await db.doc("office/"+id).get(); if(!d.exists) return; const x=d.data();
      await db.doc("office/"+id).delete(); await drop(x.fileId); await drop(x.extraId); await drop(x.previewId); },
    async download(blob,filename){ if(typeof downloads!=="undefined"&&downloads) return downloads.save({filename,data:blob});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },4000); },
    async fetchImage(src){ src=String(src||"");
      if(/^[0-9a-f]{32}$/.test(src)) src="/_blob/"+src;
      if(src.startsWith("/_blob/")){ const r=await fetch(src); if(!r.ok) throw new Error("picture "+r.status); return r.blob(); }
      try{ const r=await fetch(src); if(r.ok) return await r.blob(); }catch{}
      if(window.ENGINE){ const r=await ENGINE.fetch("/api/picture?u="+encodeURIComponent(src)+"&w=4000"); if(r.ok) return r.blob(); }
      throw new Error("That picture can't be reached from here."); },
    async ai(prompt){ const s=await sampleNs(); if(!s) throw Object.assign(new Error("AI isn't available here."),{code:"not_granted"});
      const r=await s(prompt,{modelTier:"default",cache:false}); return String(r&&r.text||""); },
    async aiJson(prompt){ const s=await sampleNs(); if(!s) throw Object.assign(new Error("AI isn't available here."),{code:"not_granted"});
      return s.json(prompt,{modelTier:"default",cache:false}); },
    takeOpen(kind){ const k=OFF_OPEN[kind]; delete OFF_OPEN[kind]; return k||""; },
  };
  /* other pages can open a Lab file in its editor: offOpen("abc123","doc") */
  const OFF_OPEN={};
  window.offOpen=function(id,kind){ const K=OFF_KIND[kind]; if(!K) return; OFF_OPEN[kind]=id;
    for(const k of [...ENG.nodes.keys()]) if(k.startsWith(K.page+"/")) ENG.nodes.delete(k); go(K.page); };

  /* ---------- the pages ---------- */
  if(typeof ENG_PAGES!=="object") return;
  ENG_BRAND.lab="Lab files · both businesses";
  ENG_PAGES.offdocs={t:"Documents",d:"Write and edit Word documents (.docx) with pages, tables, headers, comments and track changes. Write with AI drafts text for you. Saved files sit in Lab files on every device, and Stacy, Alice and Claude can read and draft them too.",stores:["lab"],frame:"engine/tools/office/docs.html",office:true};
  ENG_PAGES.offsheets={t:"Spreadsheets",d:"Excel-style workbooks with formulas, formatting and many sheets. Opens .xlsx, .xls and .csv and downloads .xlsx. Fill with AI builds a table where you click.",stores:["lab"],frame:"engine/tools/office/sheets.html",office:true};
  ENG_PAGES.offphoto={t:"Photo editor",d:"A Photoshop-style editor: layers, selections, brush, clone, magic eraser, text, crop, resize, color adjustments and 40+ effects. Saves a flat PNG plus a layered copy you can keep editing. Kittl stays the main place for designs and mockups.",stores:["lab"],frame:"engine/tools/office/photo.html",office:true};
  for(const k of ["offdocs","offsheets","offphoto"]) ENG_VIEWS[k]=()=>vEngine(k);
  const s=SUBJ_BY.apps; if(s){ const add=[["Documents","offdocs","Office suite"],["Spreadsheets","offsheets","Office suite"],["Photo editor","offphoto","Office suite"]];
    let at=s.pages.findIndex(([,,g])=>g==="Systems"); if(at<0) at=s.pages.length;
    for(const p of add) if(!s.pages.some(([,d])=>d===p[1])) s.pages.splice(at++,0,p); }
  const mk=SUBJ_BY.create; if(mk&&!mk.pages.some(([,d])=>d==="offphoto")){ const i=mk.pages.findIndex(([,d])=>d==="designer"); mk.pages.splice(i<0?mk.pages.length:i+1,0,["Photo editor","offphoto"]); }
  if(typeof TABS!=="undefined") for(const [k,l] of [["offdocs","Office ▸ Documents"],["offsheets","Office ▸ Spreadsheets"],["offphoto","Office ▸ Photo editor"]]) if(!TABS.some(([x])=>x===k)) TABS.push([k,l]);
  /* an open editor is never rebuilt by the Lab's live updates (that would reload it and lose typing): while you stay
     on the page, the page around it is left as it is */
  const OFF_TABS=new Set(["offdocs","offsheets","offphoto"]); let OFF_LAST=null;
  if(typeof render==="function"){ const render0=render;
    render=function(){ try{ if(OFF_TABS.has(S.tab)&&OFF_LAST===S.tab&&document.querySelector("#engSlot .eng-host")&&typeof subjectHead==="function") LAST_MAIN=subjectHead()+ENG_VIEWS[S.tab]()+(typeof subjectResearch==="function"?subjectResearch():""); }catch(e){ console.warn("office: keep editor",e); }
      OFF_LAST=S.tab; return render0.apply(this,arguments); }; }
  /* the store chip means nothing here; on a phone the editor gets the room instead of the description */
  const st=document.createElement("style"); st.textContent=`.eng-one.eng-lab{display:none!important}
    @media (max-width:700px){.eng-card:has(.eng-lab) .eng-ht p{display:none}.eng-card:has(.eng-lab){padding:10px!important}.eng-card:has(.eng-lab) h2.big{font-size:20px;margin:0}}`;
  document.head.appendChild(st);
  /* editors get the full height of the screen instead of a short box */
  const build0=engBuild;
  engBuild=async function(k,st,node){ const r=await build0.apply(this,arguments); const p=ENG_PAGES[k];
    if(p&&p.office){ const f=node.querySelector("iframe.eng-frame"); if(f){ f.classList.add("off-frame"); f.style.height="max(560px, calc(100dvh - 210px))"; f.setAttribute("allow","clipboard-read; clipboard-write; fullscreen"); } }
    return r; };
})();
