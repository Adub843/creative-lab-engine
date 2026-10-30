/* ---------- Charleston 3D · Supplies sheet (filament, light box parts, packing & shipping, Bambu Lab printers) ----------
   Reads data/filament.json, built by hq/scripts/build-filament.py and refreshed weekly.
   Polymaker PLA comes first: mockups use its real hex codes, other brands only when Polymaker doesn't make the color. */
const FIL={data:null, loading:false, err:"", brand:"Polymaker", type:"PLA", q:"", pbrand:"all", limit:120, hist:"Filament"};
function filLoad(){ if(FIL.data||FIL.loading) return; FIL.loading=true;
  fetch("data/filament.json",{cache:"no-cache"}).then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d=>{ FIL.data=d; FIL.loading=false; if(S.tab==="filament") render(); })
    .catch(()=>{ FIL.loading=false; FIL.err="Couldn't load the supplies sheet. Try again in a minute."; if(S.tab==="filament") render(); }); }
const filMoney=v=>"$"+(v<1?v.toFixed(3):v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
/* Price history graph: one line per item, one point per weekly refresh. */
function filChart(d,group){
  const rows=(d.history||[]).filter(h=>h[1]===group); if(!rows.length) return `<p class="muted">No history yet.</p>`;
  const order=[...d.prices.map(p=>p.brand+" "+p.type),...(d.supplies||[]).map(x=>x.item)], rank=i=>{const k=order.indexOf(i);return k<0?999:k};
  const dates=[...new Set(rows.map(h=>h[0]))].sort(), items=[...new Set(rows.map(h=>h[2]))].sort((a,b)=>rank(a)-rank(b));
  const narrow=innerWidth<600, W=narrow?360:640,H=narrow?240:230,L=58,R=12,T=12,B=28, vals=rows.map(h=>h[3]); let lo=Math.min(...vals), hi=Math.max(...vals); if(hi===lo){hi*=1.1;lo*=0.9;} lo=Math.max(0,lo-(hi-lo)*.08);
  const x=i=>dates.length===1?L+(W-L-R)/2:L+i*(W-L-R)/(dates.length-1), y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  const pal=["#0f766e","#b4533f","#1e3a5f","#8a6a2f","#6d5bd0","#2f855a","#c05621","#2b6cb0","#97266d","#4a5568","#d69e2e","#319795"];
  const lines=items.map((it,k)=>{const pts=dates.map((dt,i)=>{const r=rows.find(h=>h[0]===dt&&h[2]===it);return r?[x(i),y(r[3]),r[3]]:null}).filter(Boolean);const c=pal[k%pal.length];
    return `<g><title>${esc(it)}</title>${pts.length>1?`<polyline fill="none" stroke="${c}" stroke-width="2" points="${pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ")}"/>`:""}${pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${c}"><title>${esc(it)}: ${filMoney(p[2])}</title></circle>`).join("")}</g>`}).join("");
  const ticks=[0,.25,.5,.75,1].map(f=>lo+(hi-lo)*f).map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/><text x="${L-6}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${filMoney(v)}</text>`).join("");
  const xl=dates.map((dt,i)=>`<text x="${x(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">${esc(dt.slice(5))}</text>`).join("");
  const key=items.map((it,k)=>`<span class="fil-key"><i style="background:${pal[k%pal.length]}"></i>${esc(it)}</span>`).join("");
  return `<svg class="fil-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(group)} price history">${ticks}${lines}${xl}</svg><div class="fil-keys">${key}</div>${dates.length===1?`<p class="small muted">First week of tracking. A new point is added every Sunday.</p>`:""}`; }
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
  const lnk=(o,t)=>`<a href="${esc(safeUrl(o.url)||"#")}" target="_blank" rel="noopener">${t}</a>`;
  const cell=o=>o?`<td>${lnk(o,`<b>$${o.per_kg.toFixed(2)}/kg</b>`)}<div class="small muted">${esc(o.store)} · ${esc(o.kg+" kg")} $${o.price.toFixed(2)}</div></td>`:`<td class="muted">—</td>`;
  const stars=p=>p.rating?`<b>${p.rating.toFixed(1)}★</b><div class="small muted">${p.reviews.toLocaleString()} reviews</div>`:`<span class="muted">—</span>`;
  const sup=(d.suppliers||[]).map(x=>`<tr><td><a href="${esc(safeUrl(x.url)||"#")}" target="_blank" rel="noopener"><b>${esc(x.company)}</b></a><div class="small muted">${esc(x.brands)}</div></td><td>${esc(x.best_price_per_kg)}</td><td>${esc(x.minimum_order)}</td><td class="small">${esc(x.what_you_need)}</td></tr>`).join("");
  const pbrands=[...new Set(d.prices.map(p=>p.brand))];
  const G=d.groups||{}, sup2=d.supplies||[];
  const groups=[...new Set(sup2.map(x=>x.group))];
  const ocell=o=>o?`<td>${lnk(o,`<b>${filMoney(o.unit==="printer"?o.price:o.per_unit)}</b>${o.unit==="printer"?"":`<span class="small">/${esc(o.unit)}</span>`}`)}<div class="small muted">${esc(o.store)} · ${esc(o.pack)} ${o.unit==="printer"?"":filMoney(o.price)}${o.rating?` · ${o.rating}★ (${o.reviews.toLocaleString()})`:""}</div></td>`:`<td class="muted">—</td>`;
  const gsec=g=>`<section class="card fil-group" style="--g:${esc(G[g]||"var(--accent)")}"><div class="card-head"><h2>${esc(g)}</h2><span class="eyebrow">${g==="Bambu Lab printers"?"base model price, Bambu Lab store":"cheapest per unit first · listings rated 4.3 stars or more"}</span></div>
      <div class="tblwrap"><table class="tbl"><tr><th>Item</th><th>Best</th><th>2nd</th><th>3rd</th></tr>${sup2.filter(x=>x.group===g).map(x=>`<tr><td><b>${esc(x.item)}</b>${g==="Bambu Lab printers"&&x.top[0]?`<div class="small muted">${esc(x.top[0].product)}</div>`:""}</td>${ocell(x.top[0])}${g==="Bambu Lab printers"?`<td class="muted">—</td><td class="muted">—</td>`:ocell(x.top[1])+ocell(x.top[2])}</tr>`).join("")}</table></div></section>`;
  const hg=["Filament",...groups];
  return `<section class="card"><div class="card-head"><h2 class="big">Supplies sheet</h2><span class="eyebrow">filament (${esc(d.brands.join(", "))}) · ${sup2.length} supplies · updated ${esc(d.updated)} · refreshes every Sunday</span></div>
      <p class="small" style="margin:0 0 10px">Best prices for filament, light box parts, packing and shipping, and Bambu Lab printers, with a price graph that grows every week. Mockups use <b>Polymaker PLA</b> colors first.</p>
      <div class="fil-legend">${Object.entries(G).map(([g,c])=>`<span class="fil-key"><i style="background:${esc(c)}"></i>${esc(g)}</span>`).join("")}</div>
      <a class="btn primary" href="data/c3d-supplies-sheet.xlsx" download="Charleston 3D supplies sheet.xlsx">Download the Excel sheet</a></section>
    <section class="card"><div class="card-head"><h2>Price history</h2><span class="eyebrow">best price each week</span></div>
      <div class="fil-tabs" role="tablist">${hg.map(g=>`<button type="button" role="tab" class="fil-tab${g===FIL.hist?" on":""}" data-filhist="${esc(g)}" style="--g:${esc(G[g]||"var(--accent)")}" aria-selected="${g===FIL.hist}">${esc(g)}</button>`).join("")}</div>
      ${filChart(d,FIL.hist)}</section>
    ${groups.map(gsec).join("")}
    <section class="card"><div class="card-head"><h2>Mockup colors</h2><span class="eyebrow">tap one to copy its hex</span></div><div class="fil-pal">${pal}</div></section>
    <section class="card fil-group" style="--g:${esc(G.Filament||"var(--accent)")}"><div class="card-head"><h2>Filament, best prices per kg</h2><span class="eyebrow">3 cheapest stores, bulk and wholesale included · prices move daily, check the link</span></div>
      <div class="schbar"><select id="filPB" aria-label="Brand">${opt("all","All brands",FIL.pbrand)}${pbrands.map(b=>opt(b,b,FIL.pbrand)).join("")}</select></div>
      <div class="tblwrap"><table class="tbl"><tr><th>Brand</th><th>Type</th><th>Stars</th><th>Best</th><th>2nd</th><th>3rd</th><th>Cheapest 1 kg</th></tr>${pr.map(p=>`<tr><td>${esc(p.brand)}</td><td>${esc(p.type)}</td><td>${stars(p)}</td>${cell(p.top[0])}${cell(p.top[1])}${cell(p.top[2])}<td>${p.single?lnk(p.single,`<b>$${p.single.price.toFixed(2)}</b>`)+`<div class="small muted">${esc(p.single.store)}</div>`:`<span class="muted">—</span>`}</td></tr>`).join("")}</table></div></section>
    ${sup?`<section class="card"><div class="card-head"><h2>Wholesale &amp; bulk</h2><span class="eyebrow">open to you with a reseller certificate</span></div>
      <div class="tblwrap"><table class="tbl"><tr><th>Company</th><th>Best price</th><th>Minimum</th><th>What you need</th></tr>${sup}</table></div></section>`:""}
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
  document.querySelectorAll("[data-filhist]").forEach(b=>b.onclick=()=>{ FIL.hist=b.dataset.filhist; render(); });
  const m=$("#filMore"); if(m) m.onclick=()=>{ FIL.limit+=240; render(); };
  document.querySelectorAll("[data-filhex]").forEach(c=>c.onclick=()=>{ const h=c.dataset.filhex; if(!h) return;
    (navigator.clipboard?navigator.clipboard.writeText(h):Promise.reject()).then(()=>toast("Copied "+h),()=>toast(h)); }); }
