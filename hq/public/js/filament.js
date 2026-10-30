/* ---------- Charleston 3D · Filament colors & prices ----------
   Reads data/filament.json, built by hq/scripts/build-filament.py and refreshed weekly.
   Polymaker PLA comes first: mockups use its real hex codes, other brands only when Polymaker doesn't make the color. */
const FIL={data:null, loading:false, err:"", brand:"Polymaker", type:"PLA", q:"", pbrand:"all", limit:120};
function filLoad(){ if(FIL.data||FIL.loading) return; FIL.loading=true;
  fetch("data/filament.json",{cache:"no-cache"}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d=>{ FIL.data=d; FIL.loading=false; if(S.tab==="filament") render(); })
    .catch(()=>{ FIL.loading=false; FIL.err="Couldn't load the filament list. Try again in a minute."; if(S.tab==="filament") render(); }); }
const filSw=(hex,hex2)=>hex?`<span class="fil-sw" style="background:${hex2?`linear-gradient(135deg,${esc(hex)} 50%,${esc(hex2)} 50%)`:esc(hex)}"></span>`:`<span class="fil-sw fil-none" title="No single color">—</span>`;
function vFilament(){ filLoad(); const d=FIL.data;
  if(!d) return `<section class="card"><h2 class="big">Filament colors &amp; prices</h2><p class="muted">${esc(FIL.err||"Loading every brand, color and price…")}</p></section>`;
  const K=Object.fromEntries(d.keys.map((k,i)=>[k,i])); const rows=d.colors;
  const types=[...new Set(rows.filter(r=>FIL.brand==="all"||r[K.brand]===FIL.brand).map(r=>r[K.type]))].sort((a,b)=>(a==="PLA"?-1:b==="PLA"?1:a.localeCompare(b)));
  if(FIL.type!=="all"&&!types.includes(FIL.type)) FIL.type="all";
  const q=FIL.q.trim().toLowerCase();
  const hits=rows.filter(r=>(FIL.brand==="all"||r[K.brand]===FIL.brand)&&(FIL.type==="all"||r[K.type]===FIL.type)&&(!q||(r[K.color]+" "+r[K.line]+" "+r[K.finish]+" "+r[K.hex]).toLowerCase().includes(q)));
  const opt=(v,l,cur)=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(l)}</option>`;
  const pal=d.palette.map(p=>`<button type="button" class="fil-chip" data-filhex="${esc(p.hex)}" title="${esc(p.brand+" "+p.line+" · "+p.color)}">${filSw(p.hex)}<span><b>${esc(p.name)}</b><span class="small muted">${esc(p.hex)} · ${esc(p.brand==="Polymaker"?p.color:p.brand+" "+p.color)}</span></span></button>`).join("");
  const pr=d.prices.filter(p=>FIL.pbrand==="all"||p.brand===FIL.pbrand);
  const cell=o=>o?`<td><a href="${esc(safeUrl(o.url)||"#")}" target="_blank" rel="noopener"><b>$${o.price.toFixed(2)}</b></a><div class="small muted">${esc(o.store)}</div></td>`:`<td class="muted">—</td>`;
  const pbrands=[...new Set(d.prices.map(p=>p.brand))];
  return `<section class="card"><div class="card-head"><h2 class="big">Filament colors &amp; prices</h2><span class="eyebrow">${d.brands.length} brands · ${rows.length.toLocaleString()} colors · updated ${esc(d.updated)} · refreshes every Sunday</span></div>
      <p class="small" style="margin:0 0 10px">Mockups and product images use <b>Polymaker PLA</b> colors and their real hex codes first. Another brand's color is used only when Polymaker doesn't make it.</p>
      <a class="btn primary" href="data/filament-tracker.xlsx" download="Charleston 3D filament tracker.xlsx">Download the Excel sheet</a></section>
    <section class="card"><div class="card-head"><h2>Mockup colors</h2><span class="eyebrow">tap one to copy its hex</span></div><div class="fil-pal">${pal}</div></section>
    <section class="card"><div class="card-head"><h2>Best prices, 1 kg spool</h2><span class="eyebrow">3 cheapest stores found · prices move daily, check the link</span></div>
      <div class="schbar"><select id="filPB" aria-label="Brand">${opt("all","All brands",FIL.pbrand)}${pbrands.map(b=>opt(b,b,FIL.pbrand)).join("")}</select></div>
      <div class="tblwrap"><table class="tbl"><tr><th>Brand</th><th>Type</th><th>Best</th><th>2nd</th><th>3rd</th></tr>${pr.map(p=>`<tr><td>${esc(p.brand)}</td><td>${esc(p.type)}</td>${cell(p.top[0])}${cell(p.top[1])}${cell(p.top[2])}</tr>`).join("")}</table></div></section>
    <section class="card"><div class="card-head"><h2>Every color</h2><span class="eyebrow">${hits.length.toLocaleString()} match</span></div>
      <div class="schbar"><select id="filB" aria-label="Brand">${opt("all","All brands",FIL.brand)}${d.brands.map(b=>opt(b,b,FIL.brand)).join("")}</select>
        <select id="filT" aria-label="Type">${opt("all","All types",FIL.type)}${types.map(t=>opt(t,t,FIL.type)).join("")}</select>
        <input type="search" id="filQ" placeholder="Search a color, like teal or navy" value="${esc(FIL.q)}"></div>
      <div class="fil-grid">${hits.slice(0,FIL.limit).map(r=>`<button type="button" class="fil-chip" data-filhex="${esc(r[K.hex])}" title="${esc(r[K.source])}">${filSw(r[K.hex],r[K.hex2])}<span><b>${esc(r[K.color])}</b><span class="small muted">${esc((FIL.brand==="all"?r[K.brand]+" · ":"")+r[K.line])}${r[K.hex]?" · "+esc(r[K.hex]):""}</span></span></button>`).join("")||`<p class="muted">No colors match.</p>`}</div>
      ${hits.length>FIL.limit?`<button type="button" class="btn" id="filMore" style="margin-top:10px">Show more (${(hits.length-FIL.limit).toLocaleString()} left)</button>`:""}</section>`; }
function bindFilament(){ if(S.tab!=="filament") return;
  const b=$("#filB"); if(b) b.onchange=()=>{ FIL.brand=b.value; FIL.limit=120; render(); };
  const t=$("#filT"); if(t) t.onchange=()=>{ FIL.type=t.value; FIL.limit=120; render(); };
  const pb=$("#filPB"); if(pb) pb.onchange=()=>{ FIL.pbrand=pb.value; render(); };
  const q=$("#filQ"); if(q) q.oninput=()=>{ FIL.q=q.value; FIL.limit=120; render(); };
  const m=$("#filMore"); if(m) m.onclick=()=>{ FIL.limit+=240; render(); };
  document.querySelectorAll("[data-filhex]").forEach(c=>c.onclick=()=>{ const h=c.dataset.filhex; if(!h) return;
    (navigator.clipboard?navigator.clipboard.writeText(h):Promise.reject()).then(()=>toast("Copied "+h),()=>toast(h)); }); }
