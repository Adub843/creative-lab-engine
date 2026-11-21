/* ---------- Sales on Today: open orders and sales for both stores, right under the greeting ----------
   Reads the engine's /api/orders (the same answer the Sales ▸ Orders page keeps in this browser), at most
   once every 10 minutes, so Today shows a waiting order without anyone opening the Sales page. */
const SALES_CACHE="lab-orders-v1", SALES_EVERY=10*60*1000;
const SALES={busy:false,last:0,err:false};
if(typeof ICON==="object"&&ICON&&!ICON.sales) ICON.sales='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>';
(function(){ const st=document.createElement("style"); st.textContent=`
.eng-all .dot{background:linear-gradient(90deg,#14b8a6 50%,#c79a3a 50%)}
.ch-sales{display:grid;gap:12px}
.ch-sales .sl-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.ch-sales .sl-store{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;border:1px solid var(--line);border-top:3px solid var(--tag);border-radius:12px;padding:10px 12px;background:var(--surface);text-align:left;color:var(--fg);font:inherit;cursor:pointer}
.ch-sales .sl-store b{grid-column:1/-1;font-size:14px}
.ch-sales .sl-store span{display:grid;gap:1px;font-size:12px;color:var(--muted)}
.ch-sales .sl-store i{font-style:normal;font-size:18px;font-weight:700;color:var(--fg);font-variant-numeric:tabular-nums}
.ch-sales .sl-store .hot i{color:var(--warn,#d4a017)}
.ch-sales .sl-ord{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-left:4px solid var(--tag);border-radius:12px;padding:10px;background:var(--surface);text-align:left;color:var(--fg);font:inherit;cursor:pointer;width:100%}
.ch-sales .sl-ord img,.ch-sales .sl-ord .ph{width:64px;height:64px;border-radius:8px;object-fit:cover;background:color-mix(in srgb,var(--line) 40%,transparent)}
.ch-sales .sl-ord .t{display:grid;gap:2px;min-width:0}
.ch-sales .sl-ord .t b{font-size:15px}
.ch-sales .sl-ord .t span{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.ch-sales .sl-ord .n{font-weight:600;color:var(--fg)!important}
.ch-sales .sl-ord .v{font-weight:700;font-variant-numeric:tabular-nums}
@media (max-width:600px){.ch-sales .sl-ord{grid-template-columns:52px minmax(0,1fr)}.ch-sales .sl-ord img,.ch-sales .sl-ord .ph{width:52px;height:52px}.ch-sales .sl-ord .v{display:none}}
`; document.head.appendChild(st); })();
/* emails, phones and addresses are never kept in browser storage; the Orders page reads them live */
function salesScrub(d){ return {...d,stores:d.stores.map(s=>({...s,orders:(s.orders||[]).map(o=>({...o,email:null,phone:null,shipTo:null,billTo:null,note:null,cached:true}))}))}; }
function salesData(){ try{ const d=JSON.parse(localStorage.getItem(SALES_CACHE)||"null"); return d&&Array.isArray(d.stores)?d:null; }catch{ return null; } }
function salesOpenCount(){ const d=salesData(); return d?d.stores.reduce((n,s)=>n+(s.ok&&s.totals?s.totals.open:0),0):0; }
function salesRefresh(force){ const d=salesData(); const age=d?Date.now()-Date.parse(d.generatedAt||0):Infinity;
  if(SALES.busy||(!force&&(age<SALES_EVERY||Date.now()-SALES.last<SALES_EVERY))) return;
  if(!window.ENGINE||typeof mcp==="undefined"||!mcp) return;
  SALES.busy=true; SALES.last=Date.now();
  window.ENGINE.fetch("/api/orders?store=all&days=60").then(r=>r.ok?r.json():null).then(j=>{ const was=SALES.err; SALES.err=!(j&&Array.isArray(j.stores)); if(SALES.err&&!was&&typeof render==="function") render(); if(!SALES.err){ try{ localStorage.setItem(SALES_CACHE,JSON.stringify(salesScrub(j))); }catch{} if(typeof render==="function") render(); } })
    .catch(()=>{ if(!SALES.err){ SALES.err=true; if(typeof render==="function") render(); } }).finally(()=>{ SALES.busy=false; }); }
function salesHome(){ setTimeout(()=>salesRefresh(false),0); const d=salesData();
  const money=(n,c)=>new Intl.NumberFormat("en-US",{style:"currency",currency:c||"USD",maximumFractionDigits:n%1?2:0}).format(n||0);
  const NAME={c3d:"Charleston3D",ed:"Elevated Designs"};
  if(!d) return `<section class="ch-sec ch-sales"><h2 class="ch-h">Sales <button type="button" class="linkbtn" data-goto="sorders">Open orders</button></h2><div class="empty small">${SALES.err?"Orders from both stores show here once the engine update is installed. Open Sales ▸ Orders for details.":"Loading orders from both stores…"}</div></section>`;
  const stores=d.stores.map(s=>{ if(!s.ok) return `<button type="button" class="sl-store" data-goto="sorders" style="--tag:var(--c-${s.store})"><b>${esc(NAME[s.store])}</b><span style="grid-column:1/-1">Orders can't be read right now. Open Sales for the reason.</span></button>`;
    const t=s.totals; return `<button type="button" class="sl-store" data-goto="sorders" style="--tag:var(--c-${s.store})"><b>${esc(NAME[s.store])}</b><span><i>${money(t.today.revenue,s.currency)}</i>today</span><span><i>${money(t.d30.revenue,s.currency)}</i>30 days · ${t.d30.orders}</span><span class="${t.open?"hot":""}"><i>${t.open}</i>${t.open?"need you":"open"}</span></button>`; }).join("");
  const open=d.stores.flatMap(s=>(s.orders||[]).filter(o=>o.open)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,4);
  const pic=o=>{ for(const i of o.items||[]) for(const f of i.files||[]) if(/^https:\/\/cdn\.shopify\.com\//.test(f.url)) return f.url; for(const i of o.items||[]) if(i.image) return i.image; return ""; };
  const rows=open.map(o=>{ const p=pic(o); return `<button type="button" class="sl-ord" data-goto="sorders" style="--tag:var(--c-${o.store})">${p?`<img src="${esc(p)}" alt="${esc((o.items[0]||{}).title||"Order item")}" loading="lazy">`:`<span class="ph" aria-hidden="true"></span>`}<span class="t"><b>${esc(NAME[o.store])} order ${esc(o.name)}${o.customer?` · ${esc(o.customer)}`:""}</b><span class="n">${esc(o.next.text)}</span><span>${esc((o.items||[]).map(i=>`${i.qty} × ${i.title}`).join(", ").slice(0,120))}</span></span><span class="v">${money(o.total,o.currency)}</span></button>`; }).join("");
  const n=open.length;
  return `<section class="ch-sec ch-sales"><h2 class="ch-h">Sales${n?` <span class="count">${n}</span>`:""} <button type="button" class="linkbtn" data-goto="sorders">${n?"Open orders":"See orders"}</button></h2><div class="sl-k">${stores}</div>${rows}</section>`; }
