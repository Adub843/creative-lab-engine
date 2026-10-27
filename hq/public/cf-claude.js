/* Creative Lab Studios on Cloudflare: stands in for the claude.ai page runtime, so the console's own
   code (boot.js: claude.use("db"), "sample", "assets", "user", "downloads") runs unchanged. Data goes to
   this site's own API (worker.mjs). Pages refresh when anyone, or any agent, changes something. */
(function(){
  const API="/api";
  async function call(path,opt){
    const r=await fetch(API+path,Object.assign({credentials:"same-origin"},opt||{}));
    if(r.status===401){ location.href="/login"; throw {code:"signed_out",message:"Signed out"}; }
    let body=null; try{ body=await r.json(); }catch{}
    if(!r.ok) throw Object.assign(new Error((body&&(body.message||body.error))||("HTTP "+r.status)),{code:(body&&(body.code||body.error))||"http_"+r.status});
    return body;
  }
  const enc=p=>p.split("/").map(encodeURIComponent).join("/");
  const sendJSON=(method,v)=>({method,headers:{"content-type":"application/json"},body:JSON.stringify(v)});

  /* ---------- live refresh: one poll for every open listener ---------- */
  const LISTEN=new Set(); let since=0, timer=null, busy=false;
  const collOf=path=>{ const s=path.split("/").filter(Boolean); return s.length%2?s.join("/"):s.slice(0,-1).join("/"); };
  async function tick(){
    if(busy||!LISTEN.size) return; busy=true;
    try{ const r=await call("/changes?since="+since); since=r.now-1500; /* small overlap so nothing slips between polls */
      if(r.colls.length){ const hit=new Set(r.colls); for(const l of LISTEN) if(hit.has(l.coll)) l.refresh(); } }
    catch{} finally{ busy=false; }
  }
  function schedule(){ clearInterval(timer); timer=setInterval(()=>{ if(!document.hidden) tick(); },4000); }
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) tick(); });
  // After this page writes, look again right away instead of waiting for the next poll.
  function soon(){ setTimeout(tick,150); }
  function listen(coll,load,cb,err){
    const l={coll,stopped:false,last:"",refresh:async()=>{ if(l.stopped) return;
      try{ const snap=await load(); const sig=snap.__sig; if(sig===l.last) return; l.last=sig; cb(snap); }catch(e){ if(err) try{ err(e); }catch{} } }};
    LISTEN.add(l); if(!since) since=Date.now()-1500; schedule(); l.refresh();
    return ()=>{ l.stopped=true; LISTEN.delete(l); };
  }

  /* ---------- documents, in the same shape the console already uses ---------- */
  function docSnap(id,exists,data,path){ return {id,exists,ref:{id,path},data:()=>exists?JSON.parse(JSON.stringify(data)):undefined}; }
  function DocRef(path){
    const segs=path.split("/").filter(Boolean), id=segs[segs.length-1];
    const get=async()=>{ const r=await call("/db/"+enc(path)); const s=docSnap(id,!!r.exists,r.data,path); s.__sig=JSON.stringify(r); return s; };
    return { id, path,
      get,
      set:(data)=>call("/db/"+enc(path),sendJSON("PUT",clean(data))).then(soon),
      update:(data)=>call("/db/"+enc(path),sendJSON("PATCH",clean(data))).then(soon),
      delete:()=>call("/db/"+enc(path),{method:"DELETE"}).then(soon),
      collection:(name)=>Query(path+"/"+name),
      onSnapshot:(cb,err)=>listen(collOf(path),get,cb,err) };
  }
  function Query(path,ord,lim){
    const run=async()=>{ const q=new URLSearchParams(); if(ord){ q.set("orderBy",ord.f); q.set("dir",ord.d); } if(lim) q.set("limit",String(lim));
      const r=await call("/db/"+enc(path)+(q.toString()?"?"+q:""));
      const docs=r.docs.map(d=>docSnap(d.id,true,d.data,path+"/"+d.id));
      return {docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f),__sig:JSON.stringify(r.docs)}; };
    return { path,
      doc:(id)=>DocRef(path+"/"+id),
      add:(data)=>call("/db/"+enc(path),sendJSON("POST",clean(data))).then(r=>{ soon(); return DocRef(path+"/"+r.id); }),
      orderBy:(f,d)=>Query(path,{f,d:d==="desc"?"desc":"asc"},lim),
      limit:(n)=>Query(path,ord,n),
      get:run,
      onSnapshot:(cb,err)=>listen(path,run,cb,err) };
  }
  // undefined values are dropped, as the claude.ai store did.
  const clean=v=>JSON.parse(JSON.stringify(v===undefined?{}:v));
  const db={ collection:p=>Query(p), doc:p=>DocRef(p) };

  /* ---------- AI helpers (Ask Stephanie etc.) ---------- */
  const b64=blob=>new Promise((ok,no)=>{ const fr=new FileReader(); fr.onload=()=>ok(String(fr.result).split(",")[1]); fr.onerror=no; fr.readAsDataURL(blob); });
  async function ask(input,opts){
    opts=opts||{}; if(opts.onText) try{ opts.onText({text:"Thinking...",delta:""}); }catch{}
    const images=[]; for(const im of (opts.images||[]).slice(0,8)) images.push({type:im.type,data:await b64(im)});
    const r=await fetch(API+"/sample",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},signal:opts.signal,
      body:JSON.stringify({input,modelTier:opts.modelTier||"default",images})});
    let body=null; try{ body=await r.json(); }catch{}
    if(!r.ok) throw {code:(body&&body.code)||"upstream_error",message:(body&&body.message)||"The AI service didn't answer."};
    if(opts.onText) try{ opts.onText({text:body.text,delta:body.text}); }catch{}
    return {text:body.text,truncated:!!body.truncated,modelApplied:body.modelApplied};
  }
  const sample=(input,opts)=>ask(input,opts);
  sample.json=async(input,opts)=>{ const r=await ask(input,opts); const t=r.text.trim();
    const m=t.match(/```(?:json)?\s*([\s\S]*?)```/); const body=m?m[1]:t;
    try{ return JSON.parse(body); }catch{ const s=body.search(/[\[{]/), e=Math.max(body.lastIndexOf("}"),body.lastIndexOf("]")); if(s>=0&&e>s) return JSON.parse(body.slice(s,e+1)); throw {code:"bad_json",message:"The answer wasn't JSON.",text:t}; } };
  sample.limits=async()=>({images:{maxCount:8}});

  /* ---------- files ---------- */
  const assets={
    upload:async(blob)=>{ const r=await fetch(API+"/assets",{method:"POST",credentials:"same-origin",headers:{"content-type":blob.type||"application/octet-stream","x-file-name":encodeURIComponent(blob.name||"")},body:blob});
      let b=null; try{ b=await r.json(); }catch{} if(!r.ok) throw {code:(b&&b.code)||"upload_failed",message:(b&&b.error)||"Upload failed"}; return b; },
    list:()=>call("/assets"),
    delete:(id)=>call("/assets/"+encodeURIComponent(id),{method:"DELETE"}).then(()=>undefined)
  };
  const downloads={ save:async({filename,data})=>{ const blob=data instanceof Blob?data:new Blob([data]); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=filename||"download"; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },4000); } };
  // One shared team space: the key sign-in is the team, and the PIN screen picks the person.
  const user={ id:async()=>"team", isOwner:async()=>true, canEdit:async()=>true, can:async()=>true, me:async()=>({id:"team",name:""}), profiles:async()=>({}) };

  const NS={db,sample,assets,downloads,user};
  window.claude={ use:async(name)=>NS[name]||null };
  window.HQ_ON_CLOUDFLARE=true;
  window.hqSignOut=async()=>{ try{ await fetch(API+"/logout",{method:"POST",credentials:"same-origin"}); }catch{} location.href="/login"; };
})();
