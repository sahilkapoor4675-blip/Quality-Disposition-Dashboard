const FILTER_DEFS = [
  {key:"month", label:"📅 Month"},
  {key:"work_center", label:"🏭 Work Center"},
  {key:"grade", label:"🧪 Grade"},
  {key:"quality_decision", label:"⚖️ Quality Decision"},
  {key:"week", label:"🗓️ Week"},
  {key:"quarter", label:"📊 Quarter"},
  {key:"financial_year", label:"📆 Financial Year"},
  {key:"defect_intensity", label:"🏷️ Defect Intensity"},
];

let currentFilters = {};
FILTER_DEFS.forEach(f => currentFilters[f.key] = "All");
let previousKpiValues = new Map();
let kpiAnimationToken = 0;
let refreshController = null;

// Used ONLY for KPI cards — 3 decimal places after the point, per request.
function fmtValue(v, fmt){
  if(fmt === "int") return Math.round(v).toLocaleString();
  if(fmt === "pct") return (v*100).toFixed(3) + "%";
  if(fmt === "num2") return v.toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3});
  if(fmt === "num3") return v.toFixed(3);
  return v;
}
// Used for table cells (Decision table, Defect table, trend tables, etc.)
function fmtNum2(v){ return v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtPct(v){ return (v*100).toFixed(2) + "%"; }

async function loadFilters(){
  const res = await fetch("/api/filters");
  const options = await res.json();
  const container = document.getElementById("filters");
  container.innerHTML = `<div class="filter-toolbar"><div class="filter-toolbar-title">Dashboard Filters</div><div class="filter-actions"><button id="exportExcelBtn" class="export-btn" type="button">📊 Quality Report • Excel</button><button id="exportPdfBtn" class="export-btn" type="button">📄 Quality Report • PDF</button><button id="exportPptBtn" class="export-btn" type="button">📽️ Quality Report • PPT</button><button id="exportCsvBtn" class="export-btn" type="button">📋 Raw Data • CSV</button><span id="activeFilterBadge" class="active-filter-badge">0 Active</span><button id="resetAllBtn" class="reset-all" type="button">Reset All</button></div></div>`;
  FILTER_DEFS.forEach(f => {
    const field = document.createElement("div"); field.className = "filter-field"; field.dataset.filterKey = f.key;
    const label = document.createElement("label"); label.textContent = f.label;
    const control = document.createElement("div"); control.className = "filter-control";
    const trigger = document.createElement("button"); trigger.type="button"; trigger.className="filter-trigger";
    const valueSpan = document.createElement("span"); valueSpan.textContent="All";
    trigger.appendChild(valueSpan); trigger.insertAdjacentHTML("beforeend","<span class='chevron'>▼</span>");
    const menu = document.createElement("div"); menu.className="filter-menu";
    const search = document.createElement("input"); search.className="filter-search"; search.placeholder="Search options…"; search.type="text";
    const list = document.createElement("div"); list.className="filter-options";
    menu.appendChild(search); menu.appendChild(list); control.appendChild(trigger); control.appendChild(menu); field.appendChild(label); field.appendChild(control); container.appendChild(field);
    const raw = options[f.key] || ["All"];
    const items = raw.map(item => ({value:(item&&typeof item==='object')?item.value:item, label:(item&&typeof item==='object')?item.label:item}));
    if(!items.some(x=>x.value==="All")) items.unshift({value:"All",label:"All"});
    const renderOptions = (term="") => {
      const q=term.trim().toLowerCase(); list.innerHTML="";
      const filtered=items.filter(x=>String(x.label).toLowerCase().includes(q));
      filtered.forEach((x,i)=>{
        const opt=document.createElement("div"); opt.dataset.value=x.value; opt.className="filter-option"+(x.value==="All"?" all-option":"")+(currentFilters[f.key]===x.value?" selected":"");
        opt.textContent=x.label;
        opt.addEventListener("click",()=>{
          currentFilters[f.key]=x.value; valueSpan.textContent=x.label; control.classList.remove("open"); search.value=""; renderOptions(); field.classList.toggle("filter-active", x.value!=="All"); updateActiveFilterBadge(); triggerFilterRefresh();
        }); list.appendChild(opt);
      });
      if(!filtered.length) list.innerHTML='<div class="filter-empty">No matching options</div>';
    };
    trigger.addEventListener("click",()=>{document.querySelectorAll('.filter-control.open').forEach(c=>{if(c!==control)c.classList.remove('open')}); control.classList.toggle('open'); if(control.classList.contains('open')){search.focus();renderOptions(search.value);}});
    search.addEventListener("input",()=>renderOptions(search.value));
    renderOptions();
    field.classList.toggle("filter-active", currentFilters[f.key]!=="All");
  });
  document.getElementById("resetAllBtn").addEventListener("click",()=>{FILTER_DEFS.forEach(f=>currentFilters[f.key]="All"); document.querySelectorAll('.filter-control').forEach(c=>{c.classList.remove('open'); const s=c.querySelector('.filter-trigger span'); if(s)s.textContent='All';}); document.querySelectorAll('.filter-field').forEach(f=>f.classList.remove('filter-active')); updateActiveFilterBadge(); triggerFilterRefresh();});
  function exportDashboard(format){ const params=new URLSearchParams(currentFilters).toString(); window.location.href=`/api/export/${format}?${params}`; }
  document.getElementById("exportExcelBtn").addEventListener("click",()=>exportDashboard("excel"));
  document.getElementById("exportPdfBtn").addEventListener("click",()=>exportDashboard("pdf"));
  document.getElementById("exportPptBtn").addEventListener("click",()=>exportDashboard("pptx"));
  document.getElementById("exportCsvBtn").addEventListener("click",()=>exportDashboard("csv"));
  document.addEventListener("click", e=>{if(!e.target.closest('.filter-control')) document.querySelectorAll('.filter-control.open').forEach(c=>c.classList.remove('open'));},{once:true});
  updateActiveFilterBadge();
}
function updateActiveFilterBadge(){
  const n=FILTER_DEFS.filter(f=>currentFilters[f.key] && currentFilters[f.key]!=="All").length;
  const b=document.getElementById('activeFilterBadge'); if(!b)return; b.textContent=`${n} Active`; b.classList.toggle('show',n>0);
}
async function triggerFilterRefresh(){
  // Cancel an older in-flight dashboard request when filters are changed again.
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  const activeBtn=document.querySelector('.tab-btn.active'); const activeTab=activeBtn?activeBtn.dataset.tab:'dashboard';
  const page=document.querySelector('.container'); if(page) page.classList.add('dashboard-refreshing');
  document.querySelectorAll('.kpi-card').forEach(c=>c.classList.add('shimmering'));
  document.querySelectorAll('.chart-scroll').forEach(c=>c.classList.add('chart-refreshing'));
  document.querySelector('.filters')?.classList.add('filter-pulse');
  const t0=performance.now();
  try{await TAB_LOADERS[activeTab](signal); if(activeTab==='dashboard') prefetchQcrCore({...currentFilters});}catch(e){if(e.name!=="AbortError") console.error(e);}finally{
    const elapsed=performance.now()-t0; const wait=Math.max(0,250-elapsed);
    setTimeout(()=>{document.querySelectorAll('.kpi-card').forEach(c=>c.classList.remove('shimmering')); document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-refreshing');c.classList.add('chart-ready');setTimeout(()=>c.classList.remove('chart-ready'),350)}); if(page)page.classList.remove('dashboard-refreshing');},wait);
  }
}


// Icon shown before each KPI card's name — purely cosmetic, keyed by label.
const KPI_ICONS = {
  "Total Coils": "📦",
  "Defect Coils": "⚠️",
  "First Pass Yield % (Prime%)": "✅",
  "Hold for Decision % Qty": "⏳",
  "Output Quantity (MT)": "🏭",
  "Salvage % Qty": "♻️",
  "Salvage + Divert Qty (MT)": "🔀",
  "Defect Rate": "🔻",
  "Reject % Qty": "🚫",
  "Hold For Decision Qty (MT)": "🕒",
  "Reject Qty (MT)": "❌",
  "Rework % Qty": "🔧",
};

let KPI_TARGETS={};
let qcrAnimationToken=0;
function fmtTarget(v,fmt){
  if(v===null||v===undefined||v==='') return '—';
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(fmt==='pct') return (n*100).toFixed(1)+'%';
  if(fmt==='int') return Math.round(n).toLocaleString();
  if(fmt==='num3') return n.toFixed(2);
  return n.toFixed(2);
}
function kpiTargetData(label){return KPI_TARGETS[label]||null;}
function kpiTargetMarkup(label,fmt){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return '<div class="kpi-target-none">No Target Setting</div>';
  const dir=(c.direction||'higher').toLowerCase();
  const low=dir==='lower'?c.target:c.critical;
  const mid=c.warning;
  const high=dir==='lower'?c.critical:c.target;
  const lowClass=dir==='lower'?'target-good':'target-bad';
  const highClass=dir==='lower'?'target-bad':'target-good';
  return `<div class="kpi-targets"><div class="kpi-target-item ${lowClass}"><span>LOW</span><b>${fmtTarget(low,fmt)}</b></div><div class="kpi-target-item target-amber"><span>MID</span><b>${fmtTarget(mid,fmt)}</b></div><div class="kpi-target-item ${highClass}"><span>HIGH</span><b>${fmtTarget(high,fmt)}</b></div></div><div class="kpi-target"><span>${dir==='higher'?'↑ Higher is better':dir==='lower'?'↓ Lower is better':'Neutral'}</span></div>`;
}
function kpiStatus(label,k){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(k.value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  if(d==='higher') return v>=t?'good':v>=w?'amber':'bad';
  return 'neutral';
}
function sparklineSvg(oldValue,currentValue,status){
  const a=Number.isFinite(oldValue)?oldValue:Number(currentValue); const b=Number(currentValue)||0; const pts=[]; for(let i=0;i<6;i++){const t=i/5; const v=a+(b-a)*t; pts.push(v)}
  let min=Math.min(...pts),max=Math.max(...pts); if(min===max){min-=1;max+=1;} const points=pts.map((v,i)=>`${(i*15.2).toFixed(1)},${(24-(v-min)/(max-min)*20).toFixed(1)}`).join(' ');
  const stroke=status==='good'?'#16a34a':status==='bad'?'#dc2626':status==='amber'?'#d97706':'#118dff';
  return `<svg class="sparkline" viewBox="0 0 76 28" preserveAspectRatio="none"><polyline points="${points}" stroke="${stroke}"/><circle cx="76" cy="${(24-(b-min)/(max-min)*20).toFixed(1)}" r="2.2" fill="${stroke}"/></svg>`;
}
function renderKpis(kpis){
  const grid=document.getElementById('kpiGrid'); const nextValues=new Map(); const token=++kpiAnimationToken; grid.innerHTML='';
  kpis.forEach(k=>{
    const card=document.createElement('div'); const oldValue=previousKpiValues.get(k.label); const cur=Number(k.value)||0; const changed=Number.isFinite(oldValue)&&Math.abs(oldValue-cur)>1e-12; const direction=changed?(cur>oldValue?'up':'down'):''; const status=kpiStatus(k.label,k);
    card.className=`kpi-card status-${status} kpi-pulse`; if(direction)card.classList.add(direction==='up'?'kpi-up':'kpi-down');
    let trendHtml=''; if(k.arrow!==null && k.arrow!==undefined){const arrowChar=k.arrow==='up'?'▲':k.arrow==='down'?'▼':'▬'; let changeText=''; if(k.change_type==='pts') changeText=`${k.change_value>=0?'+':''}${(k.change_value*100).toFixed(3)} pts`; else if(k.change_type==='new') changeText='New'; else if(k.change_type==='pct') changeText=`${k.change_value>=0?'+':''}${(k.change_value*100).toFixed(3)}%`; else changeText='No change'; trendHtml=`<span class="prev">Prev: ${fmtValue(k.prev,k.fmt)}</span><span class="trend ${k.trend_color}">${arrowChar} ${changeText}</span>`;}
    const statusText=status==='good'?'ON TARGET':status==='amber'?'WATCH':status==='bad'?'ACTION':'REFERENCE';
    const valueColor=(k.label==='Total Coils'||k.label==='Output Quantity (MT)')?'#2388C9':(k.color||'#16324F');
    const targetCfg=KPI_TARGETS[k.label]||null;
    const directionText=targetCfg ? ((targetCfg.direction||'higher').toLowerCase()==='lower'?'Lower is better':'Higher is better') : 'Reference KPI';
    const targetText=targetCfg ? fmtValue(targetCfg.target,k.fmt) : 'Not set';
    const prevText=(k.prev!==null && k.prev!==undefined) ? fmtValue(k.prev,k.fmt) : 'N/A';
    card.innerHTML=`<div class="kpi-top"><div class="label"><span class="kpi-icon">${KPI_ICONS[k.label]||'📊'}</span>${k.label}</div><span class="kpi-status ${status}">${statusText}</span></div><div class="value" data-target="${cur}" style="color:${valueColor}">${fmtValue(cur,k.fmt)}</div><div class="kpi-bottom"><div class="kpi-meta">${kpiTargetMarkup(k.label,k.fmt)}<div class="kpi-trendline">${trendHtml}</div></div>${sparklineSvg(oldValue,cur,status)}</div>`;
    card.setAttribute('role','button'); card.setAttribute('tabindex','0'); card.setAttribute('aria-label',`Drill down into ${k.label}`); card.addEventListener('click',()=>openDrilldown(k.label,`${k.label} — Underlying Records`)); card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrilldown(k.label,`${k.label} — Underlying Records`);}}); grid.appendChild(card); const valueEl=card.querySelector('.value'); if(changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)animateKpiValue(valueEl,oldValue,cur,k.fmt,token); nextValues.set(k.label,cur);
  }); previousKpiValues=nextValues;
}
async function loadKpiTargets(){try{const d=await fetch('/api/kpi_targets',{cache:'no-store'}).then(r=>r.json());KPI_TARGETS=d.targets||{};}catch(e){KPI_TARGETS={};}}

function animateKpiValue(el, from, to, fmt, token){
  const start = performance.now();
  const duration = 620;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    if(token !== kpiAnimationToken) return;
    const p = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * ease(p);
    el.textContent = fmtValue(v, fmt);
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = fmtValue(to, fmt);
  };
  requestAnimationFrame(step);
}

function renderPeriodBanner(period){
  const el = document.getElementById("periodBanner");
  if(!period){ el.textContent = ""; return; }
  const cur = period.current || "All Periods";
  const prev = period.previous;
  el.innerHTML = prev
    ? `📅 <b>Current Period:</b> ${cur} &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> ${prev}`
    : `📅 <b>Current Period:</b> ${cur} &nbsp;&nbsp;|&nbsp;&nbsp; <i>Select a single Month/Week/Quarter/FY filter to see period-over-period comparison</i>`;
}

function renderDecisionTable(rows, total){
  const tbody = document.querySelector("#decisionTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.decision}</td><td>${r.coils.toLocaleString()}</td>
      <td>${fmtPct(r.pct_coils)}</td><td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_qty)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${total.coils.toLocaleString()}</td>
      <td>${fmtPct(total.pct_coils)}</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_qty)}</td>`;
    tbody.appendChild(tr);
  }
}

function renderDefectTable(rows, total){
  const tbody = document.querySelector("#defectTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.defect}</td><td>${fmtNum2(r.qty)}</td>
      <td>${fmtPct(r.pct)}</td><td>${fmtPct(r.cum_pct)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const topQty=rows.reduce((s,r)=>s+Number(r.qty||0),0);
    const topPct=total.qty?topQty/Number(total.qty):0;
    const tr=document.createElement("tr"); tr.className="grand-total-row";
    tr.innerHTML=`<td>Top 5 Total</td><td>${fmtNum2(topQty)}</td><td>${fmtPct(topPct)}</td><td>${fmtPct(topPct)}</td>`; tbody.appendChild(tr);
    const gt=document.createElement("tr"); gt.className="grand-total-row";
    gt.innerHTML=`<td>Grand Total</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(1)}</td><td>${fmtPct(1)}</td>`; tbody.appendChild(gt);
  }
}

function renderIntensityTable(rows, total){
  const tbody = document.querySelector("#intensityTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.intensity}</td><td>${r.coils.toLocaleString()}</td>
      <td>${fmtPct(r.pct_coils)}</td><td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_qty)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${total.coils.toLocaleString()}</td>
      <td>${fmtPct(total.pct_coils)}</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_qty)}</td>`;
    tbody.appendChild(tr);
  }
}

function renderMetricsTable(tableId, rows, total, ranked=false){
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  rows.forEach((r,idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `${ranked ? `<td><strong>${idx+1}</strong></td>` : ""}<td>${r.name}</td><td>${Number(r.coils||0).toLocaleString()}</td>
      <td>${fmtNum2(Number(r.output_qty||0))}</td><td>${Number(r.defect_coils||0).toLocaleString()}</td>
      <td>${fmtPct(Number(r.defect_pct||0))}</td><td>${fmtNum2(Number(r.reject_qty||0))}</td>
      <td>${fmtPct(Number(r.reject_pct_qty||0))}</td><td>${fmtPct(Number(r.first_pass_yield_pct||0))}</td>`;
    tbody.appendChild(tr);
  });
  /* Grand Total is recalculated from the actual displayed groups. Percentages
     are recomputed from aggregate counts/quantities, never averaged. */
  const agg = rows.reduce((a,r)=>{
    a.coils += Number(r.coils||0); a.output_qty += Number(r.output_qty||0);
    a.defect_coils += Number(r.defect_coils||0); a.reject_qty += Number(r.reject_qty||0);
    a.prime_qty += Number(r.prime_qty||0); return a;
  },{coils:0,output_qty:0,defect_coils:0,reject_qty:0,prime_qty:0});
  const gt = total || agg;
  const tr = document.createElement("tr");
  tr.className = "grand-total-row";
  tr.innerHTML = `${ranked ? "<td></td>" : ""}<td>Grand Total</td><td>${Number(gt.coils||0).toLocaleString()}</td>
    <td>${fmtNum2(Number(gt.output_qty||0))}</td><td>${Number(gt.defect_coils||0).toLocaleString()}</td>
    <td>${fmtPct(Number(gt.coils)?Number(gt.defect_coils||0)/Number(gt.coils):0)}</td><td>${fmtNum2(Number(gt.reject_qty||0))}</td>
    <td>${fmtPct(Number(gt.output_qty)?Number(gt.reject_qty||0)/Number(gt.output_qty):0)}</td>
    <td>${fmtPct(Number(gt.output_qty)?Number(gt.prime_qty||0)/Number(gt.output_qty):0)}</td>`;
  tbody.appendChild(tr);
}


function activeFilterSummary(){
  const parts=[];
  const labels={month:'Month',work_center:'Work Center',grade:'Grade',quality_decision:'Quality Decision',week:'Week',quarter:'Quarter',financial_year:'Financial Year',defect_intensity:'Defect Intensity'};
  Object.keys(currentFilters).forEach(k=>{const v=currentFilters[k]; if(v && v!=='All') parts.push(`${labels[k]||k}: ${v}`);});
  return parts.length?parts.join(' | '):'All Data';
}
function refreshFilterSummary(recordCount){
  const el=document.getElementById('filterSummaryText'); if(el)el.textContent=activeFilterSummary();
  const c=document.getElementById('filterRecordCount'); if(c)c.textContent=(recordCount===undefined?'--':Number(recordCount).toLocaleString())+' coils';
  renderSavedViews();
}
function savedViews(){try{return JSON.parse(localStorage.getItem('qdash_saved_views')||'{}')}catch(e){return {}}}
function renderSavedViews(){const sel=document.getElementById('savedViewSelect'); if(!sel)return; const views=savedViews(); sel.innerHTML='<option value="">Saved Views</option>'+Object.keys(views).sort().map(n=>`<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');}
function saveCurrentView(){const name=prompt('Enter a name for this filter view:'); if(!name||!name.trim())return; const views=savedViews(); views[name.trim()]=Object.assign({},currentFilters); localStorage.setItem('qdash_saved_views',JSON.stringify(views)); renderSavedViews(); document.getElementById('savedViewSelect').value=name.trim();}
function manageSavedViews(){const views=savedViews(); const names=Object.keys(views); if(!names.length){alert('No saved views yet.');return;} const name=prompt('Enter the exact saved view name to delete:\n\n'+names.join('\n')); if(name&&views[name]){delete views[name];localStorage.setItem('qdash_saved_views',JSON.stringify(views));renderSavedViews();}}
function applySavedView(name){const views=savedViews(); if(!name||!views[name])return; Object.assign(currentFilters,views[name]); document.querySelectorAll('.filter-field').forEach(field=>{const key=field.dataset.filterKey; const val=currentFilters[key]||'All'; const span=field.querySelector('.filter-trigger span'); if(span){const opts=[...field.querySelectorAll('.filter-option')]; const match=opts.find(o=>o.dataset.value===val); span.textContent=match?match.textContent:val;} field.classList.toggle('filter-active', val!=='All');}); updateActiveFilterBadge(); triggerFilterRefresh();}
function drilldownFiltersQuery(extra={}){const p=new URLSearchParams(currentFilters); Object.keys(extra).forEach(k=>p.set(k,extra[k])); return p.toString();}
let drillState={metric:'',title:'',extra:{},page:1};
function renderDrillPage(page=1){
  const {metric,title,extra}=drillState, modal=document.getElementById('drillModal'), content=document.getElementById('drillContent'); if(!modal||!content)return;
  drillState.page=page; document.getElementById('drillTitle').textContent=title||'Underlying Records'; document.getElementById('drillSubtitle').textContent=activeFilterSummary();
  content.innerHTML='<div class="drill-empty">Loading underlying records…</div>'; document.getElementById('drillCount').textContent='Loading…';
  const qs=drilldownFiltersQuery(Object.assign({metric,page,page_size:250},extra)); document.getElementById('drillExportBtn').href='/api/drilldown/export?'+drilldownFiltersQuery(Object.assign({metric},extra));
  fetch('/api/drilldown?'+qs,{cache:'no-store'}).then(r=>r.json()).then(data=>{
    if(data.error)throw new Error(data.error); document.getElementById('drillCount').textContent=Number(data.count||0).toLocaleString()+' coils'; document.getElementById('drillScope').textContent=(data.scope||'')+' • '+Number(data.row_count||data.rows?.length||0).toLocaleString()+' records';
    if(!data.rows||!data.rows.length){content.innerHTML='<div class="drill-empty">No underlying records found for this KPI/selection.</div>';return;}
    const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const fmtDate=v=>{const s=String(v||''); if(/^\d{4}-\d{2}-\d{2}/.test(s)){const [y,m,d]=s.slice(0,10).split('-'); return `${d}-${m}-${y}`;} return s;};
    const heads=['Date','Heat No','Batch No','Work Center','Grade','Main Defect','Defect Intensity','Decision','Weight (MT)'];
    let html='<div class="table-scroll"><table class="drill-table"><thead><tr>'+heads.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>';
    data.rows.forEach(r=>{const heat=esc(r.heat_no); html+=`<tr><td>${esc(fmtDate(r.insp_lot_date))}</td><td><button class="heat-detail-btn" type="button" data-heat="${heat}">${heat||'—'}</button></td><td>${esc(r.batch_no||r.coil_lot)}</td><td>${esc(r.work_center)}</td><td>${esc(r.grade)}</td><td>${esc(r.main_defect)}</td><td>${esc(r.defect_intensity||'—')}</td><td>${esc(r.quality_decision)}</td><td>${Number(r.output_weight||0).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3})}</td></tr>`});
    html+=`</tbody><tfoot><tr class="grand-total-row"><td colspan="2">Grand Total — ${Number(data.count||0).toLocaleString()} coils</td><td></td><td></td><td></td><td></td><td></td><td>Records: ${Number(data.row_count||0).toLocaleString()}</td><td>${Number(data.total_weight||0).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3})}</td></tr></tfoot></table></div>`;
    if(Number(data.total_pages||1)>1) html+=`<div class="drill-pagination"><button type="button" data-drill-page="${Math.max(1,Number(data.page||1)-1)}" ${Number(data.page||1)<=1?'disabled':''}>‹ Previous</button><span>Page ${Number(data.page||1)} of ${Number(data.total_pages||1)}</span><button type="button" data-drill-page="${Math.min(Number(data.total_pages||1),Number(data.page||1)+1)}" ${Number(data.page||1)>=Number(data.total_pages||1)?'disabled':''}>Next ›</button></div>`;
    content.innerHTML=html;
  }).catch(e=>{content.innerHTML='<div class="drill-empty">Unable to load records. '+String(e.message||e)+'</div>';document.getElementById('drillCount').textContent='Error';});
}
function openDrilldown(metric,title,extra={}){ drillState={metric,title,extra,page:1}; const modal=document.getElementById('drillModal'); if(!modal)return; modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('drill-modal-open'); renderDrillPage(1); }

function closeDrilldown(){const m=document.getElementById('drillModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');} document.body.classList.remove('drill-modal-open');}
qcrWireProblemActions();
function wireDrilldown(){
  document.getElementById('drillCloseBtn')?.addEventListener('click',closeDrilldown);
  document.getElementById('drillModal')?.addEventListener('click',e=>{if(e.target.id==='drillModal')closeDrilldown();});
document.getElementById('drillContent')?.addEventListener('click',e=>{const b=e.target.closest('.heat-detail-btn');if(b){const heat=b.dataset.heat;if(heat)openDrilldown('heat_detail',`Heat ${heat} — Complete History`,{drill_value:heat});return;} const pg=e.target.closest('[data-drill-page]');if(pg&&!pg.disabled)renderDrillPage(Number(pg.dataset.drillPage));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrilldown();});
  document.getElementById('saveViewBtn')?.addEventListener('click',saveCurrentView);
  document.getElementById('clearViewsBtn')?.addEventListener('click',manageSavedViews);
  document.getElementById('savedViewSelect')?.addEventListener('change',e=>applySavedView(e.target.value));
  renderSavedViews();
}
async function loadKpis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  // Dashboard KPI and monthly trend are independent; fetch them together.
  const monthlyPromise = loadMonthlyTrend(signal);
  const res = await fetch("/api/kpis?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  renderKpis(data.kpis);
  const totalKpi = (data.kpis||[]).find(x=>x.label==='Total Coils'); refreshFilterSummary(totalKpi ? totalKpi.value : 0);
  renderPeriodBanner(data.period);
  renderDecisionTable(data.decision_table, data.decision_total);
  renderDefectTable(data.top_defects, data.top_defects_total);
  renderIntensityTable(data.intensity_table, data.intensity_total);
  dashLoadFishbone(data.top_defects);

  const decisionRows = data.decision_table.filter(r => r.qty > 0);
  makePieChart(document.getElementById("decisionPie"), decisionRows, "qty", "decision",
    {valFmt: v => v.toFixed(2) + " MT"});
  makeGroupedBarChart(document.getElementById("decisionBarChart"), data.decision_table, "decision", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {yLabel: "Coils  /  Qty (MT)", xLabel: "Quality Decision", labelTruncate: 16});
  makeComboChart(document.getElementById("pareto5Chart"), data.top_defects, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Defect Type", colorful: true});
  makeHGroupedBarChart(document.getElementById("intensityChart"), data.intensity_table, "intensity", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {xLabel: "Coils  /  Qty (MT)", yLabel: "Defect Intensity"});

  wireChartDrilldown('decisionPie','decision'); wireChartDrilldown('decisionBarChart','decision'); wireChartDrilldown('pareto5Chart','defect');
  await monthlyPromise;
}


function markChartsReady(){document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-ready'); void c.offsetWidth; c.classList.remove('chart-refreshing'); c.classList.add('chart-ready'); setTimeout(()=>c.classList.remove('chart-ready'),700);});}
// =====================================================================
// SVG CHART HELPERS (no external libraries). All charts use a FIXED
// design width that scales responsively to the container (CSS width:100%)
// — no horizontal scrolling, everything visible at once. Long category
// names use horizontal bar orientation so labels are never cut off.
// =====================================================================
// Note: NO red in bar/fill palettes — red is reserved exclusively for trend
// lines (e.g. Defect % line, Pareto cumulative-% line), never for bars.
const CHART_COLORS = ["#118DFF", "#16A34A", "#D97706", "#7C3AED", "#64748B", "#0EA5E9", "#EC4899", "#6366F1", "#0891B2", "#84CC16"];
const DECISION_COLORS = {
  "PRIME": "#16A34A", "FOR NEXT PROCESS": "#118DFF", "SALVAGE": "#7C3AED",
  "HOLD FOR DECISION": "#D97706", "REJECT": "#0891B2", "RE-WORK": "#64748B", "DIVERT": "#6366F1",
};
const DESIGN_W = 720;

function truncateLabel(s, n){
  if(!s) return "";
  return s.length > n ? s.substring(0, n-1) + "…" : s;
}
function niceMax(v){
  // Adds headroom and guards against a near-zero max (percentages 0-1 etc.)
  if(!isFinite(v) || v <= 0) return 1;
  return v * 1.2;
}
// Y-axis title for VERTICAL charts (rotated, placed at far left)
function yAxisTitle(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}
// X-axis title for VERTICAL charts (centered, placed at bottom)
function xAxisTitleV(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle">${text}</text>`;
}
// X-axis title (value axis) for HORIZONTAL bar charts (centered, at bottom)
function xAxisTitleH(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle">${text}</text>`;
}
// Y-axis title (category axis) for HORIZONTAL bar charts (rotated, far left)
function yAxisTitleH(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}

function makePieChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const sorted = [...items].sort((a,b) => b[valueKey]-a[valueKey]);
  // Wider viewBox gives outside labels enough room; CSS still scales it responsively.
  const w = 1500, h = 820, cx = 750, cy = 380, r = 280, innerR = 145;
  const gapDeg = 0.018;
  const total = sorted.reduce((s,d) => s + d[valueKey], 0);

  // Pass 1: compute each slice's geometry + mid-angle (needed before placing labels)
  let angle = -Math.PI/2;
  const slicesData = sorted.map((d, i) => {
    const val = d[valueKey];
    const frac = total ? val/total : 0;
    const sweep = frac * 2 * Math.PI;
    const a0 = angle + gapDeg/2;
    const a1 = angle + sweep - gapDeg/2;
    const midAngle = (a0 + a1) / 2;
    angle += sweep;
    const color = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    return {d, val, frac, a0, a1, midAngle, color};
  });

  // Pass 2: draw donut segments (outer arc out, inner arc back)
  let slices = "";
  slicesData.forEach(s => {
    const ox1 = cx + r*Math.cos(s.a0), oy1 = cy + r*Math.sin(s.a0);
    const ox2 = cx + r*Math.cos(s.a1), oy2 = cy + r*Math.sin(s.a1);
    const ix1 = cx + innerR*Math.cos(s.a1), iy1 = cy + innerR*Math.sin(s.a1);
    const ix2 = cx + innerR*Math.cos(s.a0), iy2 = cy + innerR*Math.sin(s.a0);
    const largeArc = (s.a1 - s.a0) > Math.PI ? 1 : 0;
    slices += `<path data-drill-category="${s.d[labelKey]}" data-drill-kind="decision" d="M${ox1},${oy1} A${r},${r} 0 ${largeArc} 1 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${s.color}" stroke="#fff" stroke-width="2.5"><title>${s.d[labelKey]}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${(s.frac*100).toFixed(1)}%)</title></path>`;
  });

  // Center label: grand total
  const totalText = opts.valFmt ? opts.valFmt(total) : total.toFixed(2);
  const centerLabel = `
    <text x="${cx}" y="${cy-10}" font-size="21" font-weight="700" text-anchor="middle" fill="#6b7c93">TOTAL</text>
    <text x="${cx}" y="${cy+16}" font-size="29" font-weight="700" text-anchor="middle" fill="#1c2b3a">${totalText}</text>`;

  // Pass 3: place outside labels. To keep both sides visually balanced,
  // slices are assigned to left/right by rank (alternating) so neither
  // side gets overloaded. Each leader line still starts from the slice's
  // TRUE position on the ring.
  const rightSlices = [], leftSlices = [];
  slicesData.forEach((s, i) => (i % 2 === 0 ? rightSlices : leftSlices).push(s));
  rightSlices.sort((a,b) => a.midAngle - b.midAngle);
  leftSlices.sort((a,b) => a.midAngle - b.midAngle);

  const rowSpacing = 58;
  const elbowOffset = 44;
  const labelOffset = 250;

  function layoutSide(list, side){
    const n = list.length;
    if(n === 0) return "";
    const totalH = (n-1) * rowSpacing;
    let startY = cy - totalH/2;
    startY = Math.max(40, Math.min(startY, h - 40 - totalH));
    let out = "";
    list.forEach((s, idx) => {
      const targetY = startY + idx*rowSpacing;
      const edgeX = cx + r*Math.cos(s.midAngle), edgeY = cy + r*Math.sin(s.midAngle);
      const elbowX = cx + side*(r+elbowOffset);
      const labelX = cx + side*(r+labelOffset);
      const anchor = side > 0 ? "start" : "end";
      const valText = opts.valFmt ? opts.valFmt(s.val) : s.val.toFixed(2);
      out += `<polyline points="${edgeX},${edgeY} ${elbowX},${targetY} ${labelX-side*4},${targetY}" fill="none" stroke="#94a3b8" stroke-width="1.2"/>`;
      out += `<circle cx="${edgeX}" cy="${edgeY}" r="3" fill="${s.color}"/>`;
      out += `<text x="${labelX}" y="${targetY-6}" font-size="21" font-weight="700" text-anchor="${anchor}" fill="#1c2b3a">${s.d[labelKey]}<title>${s.d[labelKey]}</title></text>`;
      out += `<text x="${labelX}" y="${targetY+11}" font-size="19" font-weight="700" text-anchor="${anchor}" fill="${s.color}">${valText} (${(s.frac*100).toFixed(1)}%)</text>`;
    });
    return out;
  }

  const sliceLabels = layoutSide(rightSlices, 1) + layoutSide(leftSlices, -1);

  // Bottom legend: name-only (with color swatch), separate from the
  // detailed outside labels above.
  let legend = "";
  sorted.forEach((d, i) => {
    const color = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span>${d[labelKey]}</div>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${slices}${centerLabel}${sliceLabels}</svg>`;
}

/* Vertical bar chart — used for SHORT category names only (Months etc). */
function makeBarChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 380, padL = 65, padR = 20, padT = 30, padB = 95;
  const maxV = niceMax(Math.max(...items.map(d => d[valueKey]), 0));
  const plotW = w - padL - padR;
  const gap = plotW / items.length;
  const barW = Math.min(56, gap * 0.55);
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  items.forEach((d, i) => {
    const val = d[valueKey];
    const barH = (val / maxV) * (h - padT - padB);
    const x = padL + i * gap + (gap - barW) / 2;
    const y = h - padB - barH;
    const barColor = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${x + barW/2}" y="${y - 8}" font-size="14.5" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${x + barW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${x+barW/2} ${h-padB+20})">${truncateLabel(d[labelKey], 12)}</text>`;
  });
  const legend = `<div class="legend-item"><span class="legend-dot" style="background:#118DFF"></span>${opts.legend || opts.yLabel || valueKey}</div>`;
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Horizontal bar chart — used for LONG category names (Grades, Defects,
   Work Centers, Intensity levels) so labels never get cut off. */
function makeHBarChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  // Always order horizontal bars from highest to lowest value. This prevents a
  // low-value bar from appearing above a higher-value bar and makes the chart
  // read like a proper ranked analysis. Keep a stable secondary sort by name.
  const rows = [...items].sort((a,b) => {
    const dv = (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0);
    return dv || String(a[labelKey] || '').localeCompare(String(b[labelKey] || ''));
  });
  const w = DESIGN_W;
  const rowH = 40, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = rows.length * rowH + padT + padB;
  const maxV = niceMax(Math.max(...rows.map(d => Number(d[valueKey]) || 0), 0));
  const plotW = w - padL - padR;
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="#6b7c93">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  rows.forEach((d, i) => {
    const val = Number(d[valueKey]) || 0;
    const barW = (val / maxV) * plotW;
    const y = padT + i * rowH + rowH*0.2;
    const barH = rowH * 0.6;
    const barColor = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${padL + barW + 8}" y="${y + barH/2 + 4}" font-size="14.5" font-weight="700" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${padL - 10}" y="${y + barH/2 + 4}" font-size="12" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}<title>${d[labelKey]}</title></text>`;
  });
  // Each category gets the same color as its bar so the legend is a true
  // key for the colorful Work Center / Grade chart (not a generic metric legend).
  const legend = rows.map((d,i) => {
    const c = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    return `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${d[labelKey]}</div>`;
  }).join("");
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Horizontal GROUPED bar chart — e.g. Intensity: Coils + Qty side-by-side. */
function makeHGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W;
  const rowH = opts.rowH || 58, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = items.length * rowH + padT + padB;
  const plotW = w - padL - padR;
  const nSeries = seriesDefs.length;
  const barH = (rowH * 0.7) / nSeries;

  // Use ONE common value scale across all grouped series. Separate per-series
  // maxima make a smaller value appear visually taller than a larger value.
  const commonMax = niceMax(Math.max(...seriesDefs.flatMap(s => items.map(d => Number(d[s.key]) || 0)), 0));
  const maxes = seriesDefs.map(() => commonMax);

  let bars = "", labels = "", legend = "", gridlines = "";
  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    const gv = commonMax * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupY = padT + i * rowH + rowH*0.15;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barW = Math.max(0, (val / maxV) * plotW);
      const y = groupY + si * (barH + 5);
      bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${s.color}" rx="3"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${padL + barW + 10}" y="${y + barH/2 + 5}" font-size="16.5" font-weight="700" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${padL - 12}" y="${groupY + (barH+5)*nSeries/2 + 2}" font-size="12.5" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}</text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Vertical grouped bar chart — for time-series with SHORT labels (Months). */
function makeGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 430, padL = 70, padR = 20, padT = 30, padB = 115;
  const plotW = w - padL - padR;
  const gap = plotW / items.length;
  const nSeries = seriesDefs.length;
  const groupW = Math.min(gap * 0.7, 90);
  const barW = groupW / nSeries - 6;
  const truncLen = opts.labelTruncate || 12;

  // Use ONE common value scale across all grouped series. Separate per-series
  // maxima make a smaller value appear visually taller than a larger value.
  const commonMax = niceMax(Math.max(...seriesDefs.flatMap(s => items.map(d => Number(d[s.key]) || 0)), 0));
  const maxes = seriesDefs.map(() => commonMax);

  let bars = "", labels = "", legend = "", gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    const gv = Math.max(...maxes) * g/4;
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupX = padL + i * gap + (gap - groupW) / 2;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barH = Math.max(0, (val / maxV) * (h - padT - padB));
      const x = groupX + si * (barW + 6);
      const y = h - padB - barH;
      bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="decision" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${s.color}" rx="2"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 6}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${groupX + groupW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${groupX+groupW/2} ${h-padB+20})">${truncateLabel(d[labelKey], truncLen)}<title>${d[labelKey]}</title></text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

function makeLineChart(container, items, labelKey, series, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 400, padL = 65, padR = 30, padT = 45, padB = 95;
  const n = items.length;
  const stepX = n > 1 ? (w - padL - padR) / (n - 1) : 0;
  const maxV = opts.max !== undefined ? opts.max :
    niceMax(Math.max(...series.flatMap(s => items.map(d => d[s.key])), 0));

  let gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    const gv = maxV*g/4;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(2)}</text>`;
  }

  let svgParts = "", legend = "";
  const maxLabels = 10;
  const skip = Math.max(1, Math.ceil(n / maxLabels));
  series.forEach((s, si) => {
    const vals = items.map(d => d[s.key]);
    let points = "", dots = "", valueLabels = "";
    vals.forEach((v, i) => {
      const x = padL + (n > 1 ? i * stepX : (w-padL-padR)/2);
      const y = h - padB - (v / maxV) * (h - padT - padB);
      points += `${x},${y} `;
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${s.label} — ${items[i][labelKey]}: ${s.fmt ? s.fmt(v) : v}</title></circle>`;
      // Show the actual value in bold near the point (skip some when crowded)
      if(i % skip === 0 || i === n-1){
        const labelY = y - 10 - (si * 14);
        valueLabels += `<text x="${x}" y="${labelY}" font-size="14" font-weight="700" text-anchor="middle" fill="${s.color}">${s.fmt ? s.fmt(v) : v}</text>`;
      }
    });
    svgParts += `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2.5"/>${dots}${valueLabels}`;
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  let xLabels = "";
  items.forEach((d, i) => {
    if(i % skip !== 0 && i !== n-1) return;
    const x = padL + (n > 1 ? i * stepX : (w-padL-padR)/2);
    xLabels += `<text x="${x}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${x} ${h-padB+20})">${truncateLabel((d[labelKey]||"").replace("Wk of ",""), 12)}</text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${svgParts}${xLabels}
  </svg>`;
}

function makeComboChart(container, items, labelKey, barKey, lineKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 430, padL = 72, padR = 72, padT = 34, padB = 110;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxBar = niceMax(Math.max(...items.map(d => Number(d[barKey])||0), 0));
  const maxLine = opts.lineMax !== undefined ? opts.lineMax : 1;
  const gap = plotW / items.length;
  const barW = Math.min(52, gap * 0.58);
  let bars="", labels="", points="", dots="", gridlines="";
  for(let g=0; g<=4; g++){
    const ratio=g/4, gy=padT+plotH*(1-ratio);
    const bv=maxBar*ratio, lv=maxLine*ratio;
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-9}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.barFmt?opts.barFmt(bv):bv.toFixed(0)}</text>`;
    gridlines += `<text x="${w-padR+9}" y="${gy+4}" font-size="10.5" text-anchor="start" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lv):lv.toFixed(0)}</text>`;
  }
  items.forEach((d,i)=>{
    const val=Number(d[barKey])||0, barH=(val/maxBar)*plotH;
    const x=padL+i*gap+(gap-barW)/2, y=h-padB-barH;
    const barColor = opts.barColor && !opts.colorful ? opts.barColor : CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,0)}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.barFmt?opts.barFmt(val):val}</title></rect>`;
    bars += `<text x="${x+barW/2}" y="${Math.max(y-8,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.barFmt?opts.barFmt(val):val}</text>`;
    const lineVal=Math.max(0,Math.min(maxLine,Number(d[lineKey])||0));
    const lineY=h-padB-(lineVal/maxLine)*plotH, px=x+barW/2;
    points += `${px},${lineY} `;
    dots += `<circle cx="${px}" cy="${lineY}" r="4" fill="#DC2626" stroke="#fff" stroke-width="1.5"><title>Cumulative: ${opts.lineFmt?opts.lineFmt(lineVal):lineVal}</title></circle>`;
    dots += `<text x="${px}" y="${Math.max(lineY-10,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lineVal):lineVal}</text>`;
    labels += `<text x="${px}" y="${h-padB+20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-35 ${px} ${h-padB+20})">${truncateLabel(d[labelKey],16)}<title>${d[labelKey]}</title></text>`;
  });
  const legend=`<div class="legend-item"><span class="legend-dot" style="background:${CHART_COLORS[0]}"></span>${opts.barLegend||"Qty (MT)"}</div><div class="legend-item"><span class="legend-dot" style="background:#DC2626"></span>${opts.lineLegend||"Cumulative %"}</div>`;
  container.innerHTML=`<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${yAxisTitle(opts.barAxisLabel||"Qty (MT)",h,padT,padB)}
    <text x="${w-16}" y="${padT+plotH/2}" font-size="11.5" font-weight="700" fill="#DC2626" text-anchor="middle" transform="rotate(-90 ${w-16} ${padT+plotH/2})">${opts.lineAxisLabel||"Cumulative %"}</text>
    ${xAxisTitleV(opts.xLabel||"Main Defect",w,h,padL,padR)}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}<polyline points="${points}" fill="none" stroke="#DC2626" stroke-width="2.5"/>${dots}${labels}
  </svg>`;
}

function wireChartDrilldown(containerId, kind){
  const c=document.getElementById(containerId); if(!c||c.dataset.drillWired)return; c.dataset.drillWired='1'; c.classList.add('drillable-chart');
  c.addEventListener('click',e=>{const el=e.target.closest('[data-drill-category]'); if(!el)return; const cat=el.getAttribute('data-drill-category'); if(kind==='decision')openDrilldown('decision_category',`Quality Decision: ${cat} — Underlying Records`,{drill_value:cat}); else if(kind==='defect')openDrilldown('defect_category',`Defect: ${cat} — Underlying Records`,{drill_value:cat});});
}

// ---------- Tab: Work Center & Grade ----------
async function loadWcGrade(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/work_center_grade?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  makeHBarChart(document.getElementById("wcChart"), data.by_work_center, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Work Center"});
  renderMetricsTable("wcTable", [...data.by_work_center].sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)), data.total_work_center, true);
  makeHBarChart(document.getElementById("gradeChart"), data.by_grade, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Grade"});
  renderMetricsTable("gradeTable", [...data.by_grade].sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)), data.total_grade, true); markChartsReady();
}

// ---------- Tab: Defect Analysis ----------
async function loadDefectAnalysis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/defect_analysis?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  makeComboChart(document.getElementById("paretoChart"), data.pareto, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Main Defect", colorful: true, barAxisLabel: "Qty (MT)", lineAxisLabel: "Cumulative %", barLegend: "Qty (MT)", lineLegend: "Cumulative %"});
  const tbody = document.querySelector("#registerTable tbody");
  tbody.innerHTML = "";
  data.register.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.rank}</td><td>${r.defect}</td><td>${r.records.toLocaleString()}</td>
      <td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_records)}</td>`;
    tbody.appendChild(tr);
  });
  if(data.register_total){
    const total = data.register_total;
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td></td><td>Total</td><td>${total.records.toLocaleString()}</td>
      <td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_records)}</td>`;
    tbody.appendChild(tr);
  }

  markChartsReady();
}

// ---------- Tab: Monthly Trend ----------
async function loadMonthlyTrend(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/monthly_trend?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  makeLineChart(document.getElementById("monthlyLineChart"), data.rows, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Month"});
  makeGroupedBarChart(document.getElementById("monthlyBarChart"), data.rows, "name", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"output_qty", label:"Output Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(0)},
  ], {yLabel: "Coils / Qty (MT)", xLabel: "Month", axisFmt: v => v.toFixed(0)});
  renderMetricsTable("monthlyTable", data.rows, data.total); markChartsReady();
}

// ---------- Tab: Period Trend (Weekly / Quarterly / Yearly) ----------
async function loadPeriodTrend(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/period_trend?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }

  makeLineChart(document.getElementById("weeklyChart"), data.weekly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Week"});
  renderMetricsTable("weeklyTable", data.weekly, data.weekly_total);

  makeLineChart(document.getElementById("quarterlyChart"), data.quarterly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Quarter"});
  renderMetricsTable("quarterlyTable", data.quarterly, data.quarterly_total);

  makeLineChart(document.getElementById("yearlyChart"), data.yearly, "name", [
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Financial Year"});
  renderMetricsTable("yearlyTable", data.yearly, data.yearly_total); markChartsReady();
}

// ---------- Tab: Quality Control Room ----------
function qcrStatus(label, value){
  const c=KPI_TARGETS[label]; if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  return v>=t?'good':v>=w?'amber':'bad';
}
function qcrFmtKpi(k){ return k.fmt==='pct' ? (Number(k.value||0)*100).toFixed(2)+'%' : k.fmt==='int' ? Math.round(Number(k.value||0)).toLocaleString() : Number(k.value||0).toFixed(2); }
function qcrTargetText(label){ const c=KPI_TARGETS[label]; if(!c)return 'Target not set'; return `${c.direction==='lower'?'≤':'≥'} ${fmtTarget(c.target,'pct')}`; }
// Top Contributors: Defects / Work Centers / Grades in one tabbed card.
// Replaces the old separate Top 5 Defects, Worst Work Centers, Worst Grades,
// Grade Concentration, Work Center & Grade Risk and Recurring Quality
// Problems cards — same underlying rows, shown once each, with a
// "Recurring" / risk badge inline instead of a whole extra card.
function qcrRenderContribPanel(id, rows, kind, meta){
  const el=document.getElementById(id); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">No data available for current selection.</div>';return;}
  el.innerHTML=rows.map((r,i)=>{
    let name,metricText,sev,attrs,action,badges='';
    if(kind==='defect'){
      name=String(r.defect??'—'); const qty=Number(r.qty||0); const pct=meta.total?qty/meta.total:0;
      sev=pct>=0.35?'CRITICAL':pct>=0.20?'ATTENTION':'NORMAL';
      metricText=`${qty.toFixed(2)} MT • ${(pct*100).toFixed(2)}% of defect qty • ${Number(r.records||0).toLocaleString()} coils`;
      attrs=`data-defect="${escQcr(name)}"`; action='View Pareto';
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
    }else{
      name=String(r.name??'—'); const reject=Number(r.reject_pct_qty||0), coils=Number(r.coils||0);
      sev=reject>=0.05?'CRITICAL':reject>=0.03?'ATTENTION':'NORMAL';
      metricText=`${(reject*100).toFixed(2)}% Reject${coils?` • ${coils.toLocaleString()} coils`:''}`;
      attrs= kind==='wc' ? `data-qcr-wc="${escQcr(name)}"` : `data-qcr-grade="${escQcr(name)}"`;
      action= kind==='wc' ? `Investigate ${name}` : `Review ${name}`;
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
      const risk=meta.risk?meta.risk[name]:null; if(risk&&risk!=='Low') badges+=`<span class="qcr-badge qcr-badge-risk-${risk.toLowerCase()}">${risk} risk</span>`;
    }
    return `<div class="qcr-ranked-row"><div class="qcr-rank">${i+1}</div><div class="qcr-ranked-main"><b>${escQcr(name)}</b><span>${metricText}</span>${badges?`<div class="qcr-badges">${badges}</div>`:''}<em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em></div><button class="qcr-mini-investigate qcr-contrib-btn" type="button" ${attrs}>${action} →</button></div>`;
  }).join('');
}
function qcrRenderTopContributors(topDefects, defectTotalQty, worstWc, worstGr, intel){
  const patterns=Array.isArray(intel?.recurring_patterns)?intel.recurring_patterns:[];
  const recDefects=new Set(patterns.map(x=>x.defect).filter(Boolean));
  const recWc=new Set(patterns.map(x=>x.work_center).filter(Boolean));
  const recGrade=new Set(patterns.map(x=>x.grade).filter(Boolean));
  const riskWc={}; (intel?.risk_matrix?.work_centers||[]).forEach(x=>{riskWc[x.name]=x.risk;});
  const riskGrade={}; (intel?.risk_matrix?.grades||[]).forEach(x=>{riskGrade[x.name]=x.risk;});
  qcrRenderContribPanel('qcrContribDefect', topDefects, 'defect', {total:defectTotalQty, recurring:recDefects});
  qcrRenderContribPanel('qcrContribWc', worstWc, 'wc', {recurring:recWc, risk:riskWc});
  qcrRenderContribPanel('qcrContribGrade', worstGr, 'grade', {recurring:recGrade, risk:riskGrade});
  qcrLoadFishbone(topDefects);
  const footer=document.getElementById('qcrContribFooter');
  if(footer){
    const gc=Array.isArray(intel?.grade_concentration)?intel.grade_concentration:[]; const top=gc[0];
    footer.innerHTML=top?`<div class="qcr-hot-combo">🔥 Hottest combination: <b>${escQcr(top.grade||'—')}</b> grade • <b>${escQcr(top.defect||'—')}</b> defect • <b>${escQcr(top.wc||'—')}</b> work center — ${(Number(top.reject_pct||0)*100).toFixed(2)}% reject</div>`:'';
  }
}
// ---------- 6M Fishbone Analysis (Top Contributors → 6M Fishbone tab) ----------
// Pulls Man/Machine/Material/Method/Measurement/Environment causes for the
// current Top 5 Defects from /api/fishbone, which matches disposition
// defect names against the admin-imported 6M Fishbone Master workbook.
let qcrFishboneData = {items:[]};
function qcrRenderFishboneChips(items){
  const chipsEl=document.getElementById('qcrFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
function qcrFishboneCard(field,label,icon,items){
  const list=Array.isArray(items)?items:(items?[items]:[]);
  const body=list.length?`<ul class="qcr-fb-ul">${list.map(t=>`<li>${escQcr(t)}</li>`).join('')}</ul>`:'<div class="qcr-fb-empty">No cause on file</div>';
  return `<div class="qcr-fb-branch qcr-fb-${field}"><div class="qcr-fb-head"><span class="qcr-fb-icon">${icon}</span>${label}<span class="qcr-fb-count">${list.length||''}</span></div>${body}</div>`;
}
function qcrRenderFishboneDiagram(item){
  const el=document.getElementById('qcrFishboneDiagram'); if(!el) return;
  if(!item){ el.innerHTML='<div class="qcr-empty">No defect selected.</div>'; return; }
  if(!item.matched){
    el.innerHTML=`<div class="qcr-empty">No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet. Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.</div>`;
    return;
  }
  const c=item.causes||{};
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  el.innerHTML = `
    <div class="qcr-fb-title">🐟 6M Fishbone — ${escQcr(item.defect)}</div>
    ${note}
    <div class="qcr-fb-grid">
      ${qcrFishboneCard('man','Man','👤',c.man)}
      ${qcrFishboneCard('machine','Machine','⚙️',c.machine)}
      ${qcrFishboneCard('material','Material','🧱',c.material)}
      ${qcrFishboneCard('method','Method','📋',c.method)}
      ${qcrFishboneCard('measurement','Measurement','📏',c.measurement)}
      ${qcrFishboneCard('environment','Environment','🌤️',c.environment)}
    </div>
    <div class="qcr-fb-spine"><span>${escQcr(item.defect)}</span></div>`;
}
function qcrLoadFishbone(topDefects){
  const chipsEl=document.getElementById('qcrFishboneChips'), diagEl=document.getElementById('qcrFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">Loading 6M fishbone analysis…</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    qcrFishboneData=d;
    qcrRenderFishboneChips(d.items||[]);
    qcrRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">6M fishbone data unavailable.</div>'; });
}
document.getElementById('qcrFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#qcrFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  qcrRenderFishboneDiagram((qcrFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
// ---------- 6M Fishbone Analysis (Dashboard tab → below Top 5 Defects Pareto) ----------
// Same /api/fishbone source as the Quality Control Room tab, but driven by the
// Dashboard's own filtered Top 5 Defects (data.top_defects from /api/kpis), so it
// reacts to every filter change on the Dashboard tab independently of the QCR tab.
let dashFishboneData = {items:[]};
function dashRenderFishboneChips(items){
  const chipsEl=document.getElementById('dashFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
// True Ishikawa/fishbone skeleton (spine + 6 angled bones converging on the
// defect "head"), built as one SVG — as opposed to the qcr-fb-grid card
// layout used on the Quality Control Room tab. Same underlying causes data.
// Design goals: show EVERY cause (no 5-item cap, no truncation) and never let
// text collide — font-size auto-shrinks and wraps per label, and the whole
// diagram's height auto-grows to fit however many causes a branch has.
function fbList(v){ return Array.isArray(v) ? v.filter(x=>x!==null && x!==undefined && String(x).trim()!=='') : (v?[v]:[]); }
// Wrap `text` into at most `maxLines` lines of at most `maxChars` each
// (word-based). Only the last resort truncates (with an ellipsis) if even
// after the max number of lines the text still won't fit.
function fbWrapGeneric(text,maxChars,maxLines){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean);
  const lines=[]; let cur='';
  for(const w of words){
    if(!cur){ cur=w; continue; }
    if((cur+' '+w).length<=maxChars) cur=cur+' '+w;
    else { lines.push(cur); cur=w; }
  }
  if(cur) lines.push(cur);
  if(!lines.length) lines.push('');
  if(lines.length>maxLines){
    const head=lines.slice(0,maxLines-1);
    let rest=lines.slice(maxLines-1).join(' ');
    if(rest.length>maxChars) rest=rest.slice(0,Math.max(1,maxChars-1))+'…';
    head.push(rest);
    return head;
  }
  return lines;
}
// Fit `text` into a box of width `boxW`: keep a single, CONSISTENT font size
// for every label (so no cause looks bigger/smaller than another) and wrap
// across up to `maxLines` lines to make long text fit instead of shrinking
// it. Only shrinks as a last resort, if even wrapping can't make it fit.
function fbFitBox(text, boxW, opts){
  const o=Object.assign({pad:14, baseSize:13, minSize:9.5, maxLines:2, charW:0.66, lineH:1.2}, opts||{});
  text=String(text||'').trim();
  const avail=Math.max(24, boxW-o.pad);
  const fs=o.baseSize;
  if(text.length*fs*o.charW<=avail) return {fontSize:fs, lines:[text], lineHeight:fs*o.lineH};
  const maxChars=Math.max(4,Math.floor(avail/(fs*o.charW)));
  const lines=fbWrapGeneric(text,maxChars,o.maxLines);
  if(lines.every(l=>l.length*fs*o.charW<=avail)) return {fontSize:fs, lines, lineHeight:fs*o.lineH};
  for(let fs2=fs-0.5; fs2>=o.minSize; fs2-=0.5){
    const maxChars2=Math.max(4,Math.floor(avail/(fs2*o.charW)));
    const lines2=fbWrapGeneric(text,maxChars2,o.maxLines);
    if(lines2.every(l=>l.length*fs2*o.charW<=avail)) return {fontSize:fs2, lines:lines2, lineHeight:fs2*o.lineH};
  }
  const fsMin=o.minSize, maxCharsMin=Math.max(4,Math.floor(avail/(fsMin*o.charW)));
  return {fontSize:fsMin, lines:fbWrapGeneric(text,maxCharsMin,o.maxLines), lineHeight:fsMin*o.lineH};
}
// Evenly spread n points along the usable middle span of a bone (leaving
// a little clearance near the spine and near the category label box).
function fbSpreadT(n){
  if(n<=1) return [0.56];
  const startFrac=0.14, endFrac=0.82, out=[];
  for(let i=0;i<n;i++) out.push(startFrac + i*(endFrac-startFrac)/(n-1));
  return out;
}
const FISHBONE_BRANCH_DEFS = [
  {key:'man',         label:'Man',         icon:'👤', color:'#118DFF', side:'top',    lane:0},
  {key:'machine',     label:'Machine',     icon:'⚙️', color:'#16A34A', side:'top',    lane:1},
  {key:'material',    label:'Material',    icon:'🧱', color:'#D97706', side:'top',    lane:2},
  {key:'method',      label:'Method',      icon:'📋', color:'#7C3AED', side:'bottom', lane:0},
  {key:'measurement', label:'Measurement', icon:'📏', color:'#DB2777', side:'bottom', lane:1},
  {key:'environment', label:'Environment', icon:'🌤️', color:'#0891B2', side:'bottom', lane:2},
];
function buildFishboneSvg(item){
  const causes=item.causes||{};
  const LANE=380, TIP_DX=-160, ROW_GAP=48, BOX_H=42;
  const anchors=[210, 210+LANE, 210+LANE*2];
  const spineX1=30, spineX2=anchors[2]+260;
  const headW=232;
  const availCauseW=LANE-130; // horizontal room before the next lane / head box

  // Pre-fit every cause label (per branch) so we know how tall each side
  // of the diagram actually needs to be before we draw anything.
  const branchData=FISHBONE_BRANCH_DEFS.map(b=>{
    const list=fbList(causes[b.key]);
    const items=(list.length?list:['No cause on file']).map(txt=>({
      text:txt, missing:!list.length,
      fit:fbFitBox(txt, availCauseW, {baseSize:12.5, minSize:8.5, maxLines:3, charW:0.64})
    }));
    return Object.assign({}, b, {anchorX:anchors[b.lane], items});
  });
  const nMax=side=>Math.max(1,...branchData.filter(b=>b.side===side).map(b=>b.items.length));
  const tipDyFor=n=>Math.max(150, Math.round(ROW_GAP*(n-1)+90));
  const TIP_DY_TOP=tipDyFor(nMax('top')), TIP_DY_BOT=tipDyFor(nMax('bottom'));

  const spineY=TIP_DY_TOP+BOX_H+26;
  const H=spineY+TIP_DY_BOT+BOX_H+26;
  const W=spineX2+headW+30;

  let svg='';
  svg+=`<line x1="${spineX1}" y1="${spineY}" x2="${spineX2}" y2="${spineY}" stroke="#243B53" stroke-width="3"/>`;
  svg+=`<polygon points="${spineX2},${spineY} ${spineX2-20},${spineY-13} ${spineX2-20},${spineY+13}" fill="#243B53"/>`;

  // ---- head box (the defect / effect) ----
  const headFit=fbFitBox(item.defect, headW, {pad:22, baseSize:16, minSize:9, maxLines:4, charW:0.66, lineH:1.2});
  const headH=Math.max(80, 30+headFit.lines.length*headFit.lineHeight+18);
  const headY=spineY-headH/2;
  svg+=`<rect x="${spineX2}" y="${headY}" width="${headW}" height="${headH}" rx="12" fill="#16324F"/>`;
  const hMidOffset=(headFit.lines.length-1)*headFit.lineHeight/2;
  svg+=headFit.lines.map((ln,i)=>`<text x="${spineX2+headW/2}" y="${spineY - hMidOffset + i*headFit.lineHeight + 5}" font-size="${headFit.fontSize}" font-weight="800" fill="#fff" text-anchor="middle">${escQcr(ln)}</text>`).join('');

  // ---- 6 angled bones, each carrying every cause for that branch ----
  branchData.forEach(b=>{
    const TIP_DY = b.side==='top' ? TIP_DY_TOP : TIP_DY_BOT;
    const tipX=b.anchorX+TIP_DX, tipY = b.side==='top' ? spineY-TIP_DY : spineY+TIP_DY;
    const dx=tipX-b.anchorX, dy=tipY-spineY;
    const len=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/len, uy=dy/len;
    let px=-uy, py=ux; if(px<0){ px=uy; py=-ux; } // perpendicular leaning toward the head (right)
    svg+=`<line x1="${b.anchorX}" y1="${spineY}" x2="${tipX}" y2="${tipY}" stroke="${b.color}" stroke-width="2.5"/>`;
    svg+=`<circle cx="${b.anchorX}" cy="${spineY}" r="4" fill="${b.color}"/>`;
    const ts=fbSpreadT(b.items.length);
    b.items.forEach((it,i)=>{
      const t=ts[i];
      const bx=b.anchorX+dx*t, by=spineY+dy*t;
      const ex=bx+px*14, ey=by+py*14;
      svg+=`<line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${it.missing?'#c3cdd8':b.color}" stroke-width="1.5"/>`;
      const anchor = px>=0 ? 'start':'end';
      const tx = ex + (px>=0?5:-5);
      const {fontSize,lines,lineHeight}=it.fit;
      const midOffset=(lines.length-1)*lineHeight/2;
      lines.forEach((ln,li)=>{
        svg+=`<text x="${tx}" y="${ey - midOffset + li*lineHeight + 4}" font-size="${fontSize}" font-weight="${it.missing?'600':'700'}" font-style="${it.missing?'italic':'normal'}" fill="${it.missing?'#9aa7b4':'#243B53'}" text-anchor="${anchor}">${escQcr(ln)}</text>`;
      });
    });
    const boxW=176,boxX=tipX-boxW/2, boxY=b.side==='top'?tipY-BOX_H:tipY;
    svg+=`<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${BOX_H}" rx="10" fill="${b.color}"/>`;
    svg+=`<text x="${tipX}" y="${boxY+BOX_H/2+6}" font-size="17" font-weight="800" fill="#fff" text-anchor="middle">${b.icon} ${b.label}</text>`;
  });
  const SHIFT_X=70; // nudge the whole diagram right within its frame, per feedback
  return `<svg class="chart-svg fishbone-svg" viewBox="0 0 ${W+SHIFT_X} ${H}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${SHIFT_X},0)">${svg}</g></svg>`;
}
function dashRenderFishboneDiagram(item){
  const el=document.getElementById('dashFishboneDiagram'); if(!el) return;
  if(!item){ el.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  if(!item.matched){
    el.innerHTML=`<div class="qcr-empty">No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet. Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.</div>`;
    return;
  }
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  el.innerHTML = `${note}${buildFishboneSvg(item)}`;
}
function dashLoadFishbone(topDefects){
  const chipsEl=document.getElementById('dashFishboneChips'), diagEl=document.getElementById('dashFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">Loading 6M fishbone analysis…</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    dashFishboneData=d;
    dashRenderFishboneChips(d.items||[]);
    dashRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">6M fishbone data unavailable.</div>'; });
}
document.getElementById('dashFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#dashFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  dashRenderFishboneDiagram((dashFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
function qcrRenderHealthReasons(intel){
  const btn=document.getElementById('qcrHealthWhyBtn'), box=document.getElementById('qcrHealthReasons'); if(!btn||!box)return;
  const reasons=Array.isArray(intel?.health_score?.reasons)?intel.health_score.reasons:[];
  if(!reasons.length){btn.classList.add('qcr-hidden'); box.classList.add('qcr-hidden'); box.innerHTML=''; return;}
  btn.classList.remove('qcr-hidden'); btn.textContent='Why? ▾'; box.classList.add('qcr-hidden');
  box.innerHTML=reasons.map(r=>{const n=Math.abs(Number(r[1]||0));return `<span class="negative">-${n.toFixed(1)} pts <b>${escQcr(r[0])}</b></span>`;}).join('');
}
function qcrRenderComparison(rows){
  const el=document.getElementById('qcrComparison'); if(!rows.length){el.innerHTML='<div class="qcr-empty">Monthly comparison is not available.</div>';return;}
  const cur=rows[rows.length-1], prev=rows.length>1?rows[rows.length-2]:null;
  const metrics=[['Defect %','defect_pct',true,'lower'],['First Pass Yield % (Prime%)','first_pass_yield_pct',true,'higher'],['Reject % Qty','reject_pct_qty',true,'lower'],['Output Qty (MT)','output_qty',false,'higher'],['Coils','coils',false,'higher']];
  const cell=(m,row)=>m[2] ? (Number(row?.[m[1]]||0)*100).toFixed(2)+'%' : Number(row?.[m[1]]||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const delta=(m)=>{if(!prev)return '—'; const a=Number(prev[m[1]]||0),b=Number(cur[m[1]]||0),diff=b-a; if(m[2]){const pp=diff*100; const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(pp)<0.005?'equal':good?'good':'bad'}">${pp>=0?'+':''}${pp.toFixed(2)} pp ${Math.abs(pp)<0.005?'→':good?'↑':'↓'}</span>`;} const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(diff)<0.000001?'equal':good?'good':'bad'}">${diff>=0?'+':''}${diff.toFixed(2)} ${Math.abs(diff)<0.000001?'→':good?'↑':'↓'}</span>`;};
  el.innerHTML=`<table class="qcr-compare"><thead><tr><th>Metric</th><th>${prev?prev.name:'Previous'}</th><th>${cur.name}</th><th>Change</th></tr></thead><tbody>${metrics.map(m=>`<tr><td>${m[0]}</td><td>${prev?cell(m,prev):'—'}</td><td>${cell(m,cur)}</td><td>${delta(m)}</td></tr>`).join('')}</tbody></table>`;
}
const qcrCoreCache = new Map();
window.qcrLoadToken=0;
function qcrCacheKey(filters){ return new URLSearchParams(filters).toString(); }
function qcrSessionKey(filters){ return 'qcr_last_good_v28_' + qcrCacheKey(filters); }
async function fetchQcrCore(filters, signal){
  const key=qcrCacheKey(filters); const cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return cached.data;
  const params=new URLSearchParams(filters).toString();
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch('/api/qcr?'+params+'&_qcr=28&_attempt='+(attempt+1),{signal,cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
      let data=null;
      try{data=await r.json();}catch(e){throw new Error('QCR server returned invalid JSON (HTTP '+r.status+')');}
      if(!r.ok || data?.error) throw new Error(data?.error || ('QCR request failed (HTTP '+r.status+')'));
      if(!data || !data.k || !data.d || !data.w){throw new Error('QCR response is incomplete');}
      qcrCoreCache.set(key,{ts:Date.now(),data});
      try{sessionStorage.setItem(qcrSessionKey(filters),JSON.stringify({ts:Date.now(),data}));}catch(_){}
      return data;
    }catch(e){
      if(e.name==='AbortError') throw e;
      lastError=e;
      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  // A transient API failure must never turn a working QCR into a blank screen.
  try{
    const saved=JSON.parse(sessionStorage.getItem(qcrSessionKey(filters))||'null');
    if(saved?.data?.k && saved?.data?.d && saved?.data?.w){
      qcrCoreCache.set(key,{ts:Date.now(),data:saved.data});
      return saved.data;
    }
  }catch(_){}
  throw lastError || new Error('Unable to load Control Room data');
}
function prefetchQcrCore(filters){
  const key=qcrCacheKey(filters), cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return;
  fetchQcrCore(filters).catch(()=>{});
}
function qcrRenderTrendPrediction(rows,d,w){
  const el=document.getElementById('qcrTrendPrediction'); if(!el)return;
  try{
    const valid=Array.isArray(rows)?rows.filter(r=>Number.isFinite(Number(r?.first_pass_yield_pct))):[];
    const recent=valid.slice(-4);
    if(recent.length<3){el.innerHTML='<div class="qcr-empty">Need at least 3 monthly periods for trend intelligence.</div>';return;}
    const fpy=recent.map(r=>Number(r.first_pass_yield_pct)||0), rej=recent.map(r=>Number(r.reject_pct_qty)||0);
    const slope=a=>{const n=a.length,xm=(n-1)/2,ym=a.reduce((x,y)=>x+y,0)/n,den=a.reduce((x,_,i)=>x+(i-xm)*(i-xm),0);return den? a.reduce((x,y,i)=>x+(i-xm)*(y-ym),0)/den:0;};
    const sf=slope(fpy),sr=slope(rej),deteriorating=sf<-0.001||sr>0.001,stable=!deteriorating&&Math.abs(sf)<0.0005&&Math.abs(sr)<0.0005;
    const status=deteriorating?'⚠️ Deteriorating Trend':stable?'✓ Stable Trend':'↕ Mixed Trend',cls=deteriorating?'bad':stable?'good':'amber',next=Math.max(0,Math.min(1,fpy[fpy.length-1]+sf));
    // Contributors (Grade/Defect/Work Center) are intentionally not repeated
    // here — they're already ranked in "Top Contributors" above.
    el.innerHTML=`<div class="qcr-intel-status ${cls}">${status}</div><div class="qcr-intel-main">FPY ${ (fpy[fpy.length-1]*100).toFixed(2)}% <span>→ projected ${(next*100).toFixed(2)}%</span></div><div class="qcr-intel-meta">Last ${recent.length} months: ${recent.map(r=>r.name).join(' → ')}</div><div class="qcr-intel-meta">${sf<0?'FPY is trending down.':'FPY is not declining.'} ${sr>0?'Reject % is increasing.':'Reject % is not increasing.'}</div>`;
  }catch(e){console.error('QCR trend intelligence',e);el.innerHTML='<div class="qcr-empty">Trend intelligence unavailable.</div>';}
}
document.getElementById('qcrRootCause')?.addEventListener('click',e=>{const b=e.target.closest('.qcr-root-link');if(!b)return; const p=new URLSearchParams(currentFilters);p.set('grade',b.dataset.rootGrade||'All');p.set('work_center',b.dataset.rootWc||'All');openDrilldown('defect_category',`Root Cause: ${b.dataset.rootGrade||'—'} → ${b.dataset.rootWc||'—'}`,{drill_value:document.querySelector('.qcr-defect-btn')?.dataset.defect||'',grade:b.dataset.rootGrade||'All',work_center:b.dataset.rootWc||'All'});});
function loadRootCause(defect){
  const el=document.getElementById('qcrRootCause'); if(!el||!defect)return Promise.resolve(); el.innerHTML='<div class="qcr-empty">Loading root-cause path…</div>';
  const p=new URLSearchParams(currentFilters);p.set('defect',defect); return fetch('/api/root_cause?'+p.toString(),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error)throw new Error(d.error); const paths=d.paths||[]; const rec=d.records||[];
    const top=paths[0]; let html=`<div class="qcr-root-title">${defect}</div>`;
    if(top) html+=`<div class="qcr-root-path"><span>Defect<br><b>${defect}</b></span><i>→</i><span>Grade<br><b>${top.grade}</b></span><i>→</i><span>Work Center<br><b>${top.work_center}</b></span><i>→</i><span>Heat / Batch<br><b>${rec[0]?.heat_no||'—'} / ${rec[0]?.batch_no||'—'}</b></span></div>`;
    html+=`<div class="qcr-root-meta">Top contributing combinations — click to investigate records</div><div class="qcr-root-list">${paths.slice(0,6).map((x,i)=>`<button class="qcr-root-link" data-root-grade="${escQcr(x.grade)}" data-root-wc="${escQcr(x.work_center)}"><b>#${i+1} ${escQcr(x.grade)}</b><span>${escQcr(x.work_center)} • ${x.qty.toFixed(2)} MT • ${x.coils.toLocaleString()} coils</span></button>`).join('')}</div>`;
    el.innerHTML=html;
  }).catch(e=>{el.innerHTML='<div class="qcr-empty">Root-cause data unavailable.</div>';});
}
// NOTE: Grade Concentration and "Why changed?" used to also be computed here
// via extra client-side API calls. That logic is dead weight now — the
// consolidated intel endpoint (qcrRenderWhyDecomposition + the grade
// concentration block in loadControlRoom) already provides a richer version
// of the same insight, so the duplicate implementation was removed.
function escQcr(v){return String(v??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function qcrRenderProblemFinder(intel){
  const el=document.getElementById('qcrProblemFinder'), count=document.getElementById('qcrProblemCount'); if(!el)return;
  const all=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const rows=all.slice(0,5);
  const critCount=all.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const shownNote=all.length>rows.length?` · top ${rows.length} shown`:'';
  if(count)count.textContent=all.length?(critCount>0?`${critCount} critical issue${critCount===1?'':'s'}${shownNote}`:`${all.length} issue${all.length===1?'':'s'}${shownNote}`):'0 issues';
  if(!rows.length){el.innerHTML='<div class="qcr-empty">✓ No material quality problem detected for the current selection. Continue monitoring.</div>';return;}
  el.innerHTML=rows.map((x,i)=>{
    const sev=String(x.severity||'Observation').toUpperCase(); const conf=String(x.confidence||'MEDIUM').toUpperCase();
    const driver=x.driver_path||x.where||'—'; const change=x.change|| (x.impact_qty?`${Number(x.impact_qty).toFixed(2)} MT`:'—');
    return `<div class="qcr-problem-row ${sev.toLowerCase()}"><div class="qcr-problem-rank">${i+1}</div><div class="qcr-problem-main"><b>${escQcr(x.title||x.what||'Quality issue')}</b><span>${escQcr(x.detail||'Material quality signal detected.')}</span><div class="qcr-problem-fields"><span><small>DRIVER</small>${escQcr(driver)}</span><span><small>CHANGE</small>${escQcr(change)}</span><span><small>CONFIDENCE</small>${conf} · ${Number(x.records||0).toLocaleString()} records</span></div></div><div class="qcr-problem-action"><em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em><button class="qcr-investigate-btn" type="button" data-qcr-where="${escQcr(x.where||'')}" data-qcr-grade="${escQcr(x.grade||'')}" data-qcr-defect="${escQcr(x.defect||'')}" data-qcr-period="${escQcr(x.period||'')}">Investigate →</button></div></div>`;
  }).join('');
}

function qcrRenderQualityStory(intel){
  // Where/Grade/Defect/Confidence used to repeat here as pill tags, but that's
  // the exact same info already shown in the "What Needs Attention" row right
  // above this card — dropped to avoid saying the same thing twice.
  const el=document.getElementById('qcrQualityStory');if(!el)return; const story=String(intel?.quality_story||'No quality story available.');
  el.innerHTML=`<div class="qcr-story-label">📋 Quality Story</div><div class="qcr-story-text">${escQcr(story)}</div>`;
}
function qcrRenderQualityImprovements(intel){
  // Compact single line under the Quality Story — no longer a whole extra
  // card of its own; the improvement names/details were the only new
  // information here, so we keep just that, in one line.
  const el=document.getElementById('qcrQualityImprovements');if(!el)return;const rows=Array.isArray(intel?.improvements)?intel.improvements:[];
  if(!rows.length){el.innerHTML='';return;}
  el.innerHTML=`<span class="qcr-improving-label">🟢 Improving:</span> `+rows.slice(0,3).map(x=>`<b>${escQcr(x.name||'Quality improvement')}</b> <small>(${escQcr(x.detail||'positive movement')})</small>`).join(' • ');
}
function qcrRenderWhyDecomposition(intel){
  // Trimmed to the two headline deltas + the one-line explanation — the
  // Grade/Defect/Work Center names it used to repeat here are already
  // ranked in "Top Contributors" above, so they're not re-listed.
  const el=document.getElementById('qcrWhyChanged');if(!el)return; const z=intel?.why_changed;
  if(!z||!z.current||!z.previous){el.innerHTML='<div class="qcr-empty">Previous period comparison is not available for this selection.</div>';return;}
  el.innerHTML=`<div class="qcr-why-grid"><div><b>FPY ${Number(z.fpy_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.fpy_change_pp||0)).toFixed(2)} pp</b></div><div><b>Reject ${Number(z.reject_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.reject_change_pp||0)).toFixed(2)} pp</b></div></div><div class="qcr-story-text">${escQcr(z.statement||'')}</div>`;
}
function qcrInvestigation(extra={}, title='QCR Investigation'){
  const p={};
  Object.entries(extra||{}).forEach(([k,v])=>{
    if(v===undefined||v===null) return;
    const s=String(v).trim();
    if(!s || s==='—') return;
    // "month" is allowed through even when explicitly "All" — What Needs
    // Attention findings are computed independently of the currently
    // selected month filter, so an explicit month override (including a
    // reset to "All") must not be silently dropped, or the investigate
    // drilldown ends up combining a finding's Work Center/Grade/Defect with
    // an unrelated month and returns zero records.
    if(k!=='month' && s.toLowerCase()==='all') return;
    p[k]=v;
  });
  openDrilldown('quality_investigation',title,p);
}
function qcrWireProblemActions(){
  document.getElementById('qcrProblemFinder')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-investigate-btn'); if(!b)return;
    const defect=b.dataset.qcrDefect, where=b.dataset.qcrWhere, grade=b.dataset.qcrGrade, period=b.dataset.qcrPeriod;
    // Findings here are detected across the full trend history (independent
    // of whichever month happens to be selected on the page), so the
    // investigation must use the finding's own period rather than inherit
    // the page's current month filter — otherwise the two can point to
    // different months and the drilldown comes back empty.
    qcrInvestigation({work_center:where,grade,drill_value:defect,month:(period&&period!=='—'?period:'All')},`QCR Investigation — ${defect&&defect!=='—'?defect:'Quality issue'}`);
  });
  // Top Contributors: tab switching + investigate/root-cause wiring (event
  // delegation, since each tab's rows are re-rendered on every load).
  document.getElementById('qcrContribTabs')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-tab-btn'); if(!b)return;
    const tab=b.dataset.contribTab;
    document.querySelectorAll('#qcrContribTabs .qcr-tab-btn').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.qcr-tab-panel-c').forEach(p=>p.classList.toggle('qcr-hidden',p.dataset.contribPanel!==tab));
  });
  document.querySelector('.qcr-contrib-card')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-contrib-btn'); if(!b)return;
    if(b.dataset.defect){ loadRootCause(b.dataset.defect); return; }
    if(b.dataset.qcrWc){ qcrInvestigation({work_center:b.dataset.qcrWc},`Work Center Investigation — ${b.dataset.qcrWc}`); return; }
    if(b.dataset.qcrGrade){ qcrInvestigation({grade:b.dataset.qcrGrade},`Grade Investigation — ${b.dataset.qcrGrade}`); return; }
  });
  // Quality Health "Why?" toggle in the executive strip (replaces the old
  // standalone Quality Health Score card — same reasons, one click away).
  document.getElementById('qcrHealthWhyBtn')?.addEventListener('click',()=>{
    const box=document.getElementById('qcrHealthReasons'); if(!box)return;
    const nowHidden=box.classList.toggle('qcr-hidden');
    const btn=document.getElementById('qcrHealthWhyBtn'); if(btn)btn.textContent=nowHidden?'Why? ▾':'Why? ▴';
  });
}
function qcrRenderTargetHistory(rows,target){
  const el=document.getElementById('qcrTargetHistory'); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">No historical monthly data available.</div>';return;}
  el.innerHTML=`<div class="qcr-target-summary">Target <b>${(Number(target||0)*100).toFixed(1)}%</b> • % Target Achieved shows how much of the target was reached each period (100% = target fully met)</div><div class="qcr-target-table"><table class="qcr-compare"><thead><tr><th>Period</th><th>Target</th><th>Actual</th><th>% Target Achieved</th><th>Gap</th></tr></thead><tbody>${rows.map(r=>{const a=Number(r.actual||0),t=Number(r.target||0),att=Number(r.attainment||0);const cls=att>=0.97?'good':att>=0.90?'amber':'bad';return `<tr><td>${escQcr(r.period)}</td><td>${(t*100).toFixed(1)}%</td><td>${(a*100).toFixed(2)}%</td><td><span class="qcr-delta ${cls}">${(att*100).toFixed(1)}%</span></td><td>${Number(r.gap_pp||0)>=0?'+':''}${Number(r.gap_pp||0).toFixed(2)} pp</td></tr>`}).join('')}</tbody></table></div>`;
}

function qcrRenderExecutive(intel, critical, comparisonRows){
  const health=intel?.health_score||{}; const h=Number(health.score||0); const pf=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const crit=pf.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const att=pf.filter(x=>String(x.severity||'').toLowerCase()==='attention').length;
  const top=pf[0];
  const prev=comparisonRows?.length>1?comparisonRows[comparisonRows.length-2]:null, cur=comparisonRows?.length?comparisonRows[comparisonRows.length-1]:null;
  let trend='●', trendText='Stable', trendClass='neutral';
  if(prev&&cur){const a=Number(prev.fpy||prev.fpy_pct||0),b=Number(cur.fpy||cur.fpy_pct||0);if(b<a){trend='▼';trendText='Quality declining';trendClass='bad';}else if(b>a){trend='▲';trendText='Quality improving';trendClass='good';}}
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('qcrExecHealth',`${h.toFixed(0)}/100`);set('qcrExecHealthState',health.status==='good'?'Healthy':health.status==='bad'?'Critical':'Attention');set('qcrExecCritical',crit);set('qcrExecBreaches',critical.filter(k=>qcrStatus(k.label,k.value)!=='good').length);set('qcrExecProblem',top?.title||'No material issue');set('qcrExecDriver',top?.driver_path||top?.where||'Continue monitoring');set('qcrExecTrend',trend);set('qcrExecTrendText',trendText);
  const trendEl=document.getElementById('qcrExecTrend'); if(trendEl)trendEl.className='qcr-trend-symbol '+trendClass;
}
async function loadControlRoom(signal){
  const filterSnapshot={...currentFilters};
  const params=new URLSearchParams(filterSnapshot).toString();
  try{
    const data=await fetchQcrCore(filterSnapshot,signal); const {k,d,w,m,fr}=data;
    document.getElementById('qcrFreshness').textContent=`Data Through: ${fr.data_through_display||'—'} • Filtered Records: ${Number(fr.filtered_records||0).toLocaleString()}`;
    const criticalLabels=['First Pass Yield % (Prime%)','Defect Rate','Reject % Qty','Hold for Decision % Qty','Salvage % Qty','Rework % Qty'];
    const critical=(k.kpis||[]).filter(x=>criticalLabels.includes(x.label));
    // Worst-first ordering + inline target/gap folds in what used to be a
    // separate "KPI Target Intelligence" ranking card — same numbers, one place.
    const qcrStatusOrder={bad:0,amber:1,good:2,neutral:3};
    const criticalSorted=[...critical].sort((a,b)=>(qcrStatusOrder[qcrStatus(a.label,a.value)]??3)-(qcrStatusOrder[qcrStatus(b.label,b.value)]??3));
    const qcrGrid=document.getElementById('qcrCriticalKpis');
    const nextQcrValues=new Map(); qcrGrid.innerHTML='';
    criticalSorted.forEach(x=>{
      const st=qcrStatus(x.label,x.value), cur=Number(x.value)||0, old=window.qcrPreviousKpiValues?.get(x.label);
      const changed=Number.isFinite(old)&&Math.abs(old-cur)>1e-12;
      const card=document.createElement('div'); card.className='qcr-kpi';
      const cfg=KPI_TARGETS[x.label];
      const targetLine=(cfg&&cfg.target!=null)?`<div class="qcr-kpi-target">Target ${qcrTargetText(x.label)} • Gap ${((cur-Number(cfg.target))*100)>=0?'+':''}${((cur-Number(cfg.target))*100).toFixed(2)} pp</div>`:'';
      card.innerHTML=`<div class="qcr-kpi-name">${KPI_ICONS[x.label]||'📊'} ${x.label}</div><div class="qcr-kpi-value ${st}">${qcrFmtKpi(x)}</div>${targetLine}<span class="qcr-status ${st}">${st==='good'?'ON TARGET':st==='amber'?'WATCH':st==='bad'?'CRITICAL':'REFERENCE'}</span>`;
      qcrGrid.appendChild(card); nextQcrValues.set(x.label,cur);
      if(changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const el=card.querySelector('.qcr-kpi-value'); el.classList.add(cur>old?'value-change-up':'value-change-down');
        animateKpiValue(el,old,cur,x.fmt,++qcrAnimationToken); setTimeout(()=>el.classList.remove('value-change-up','value-change-down'),700);
      }
    });
    window.qcrPreviousKpiValues=nextQcrValues;

    // Overall Quality Status: target breaches + reject/FPY + major concentration signals.
    const badKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='bad').length;
    const amberKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='amber').length;
    const maxWc=Math.max(0,...(w.by_work_center||[]).map(x=>Number(x.reject_pct_qty)||0));
    const maxGr=Math.max(0,...(w.by_grade||[]).map(x=>Number(x.reject_pct_qty)||0));
    const topDefPct=d.totals?.qty ? Number((d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>b.qty-a.qty)[0]?.qty||0)/Number(d.totals.qty) : 0;
    let overall='STABLE', overallClass='good';
    if(badKpis>0 || maxWc>0.05 || maxGr>0.05 || topDefPct>=0.35){ overall='CRITICAL'; overallClass='bad'; }
    else if(amberKpis>0 || maxWc>0.03 || maxGr>0.03 || topDefPct>=0.25){ overall='ATTENTION REQUIRED'; overallClass='amber'; }
    const qs=document.getElementById('qcrQualityStatus'); if(qs){qs.className='qcr-quality-status '+overallClass;qs.querySelector('strong').textContent=overall;}

    const defectTotalQty=Number(d.totals?.qty||0); const topDefects=(d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>Number(b.qty||0)-Number(a.qty||0)).slice(0,5);
    const worstWc=[...(w.by_work_center||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    const worstGr=[...(w.by_grade||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    // All QCR intelligence is now returned by the consolidated endpoint so these
    // sections never depend on a chain of secondary browser requests.
    qcrRenderComparison((m&&m.rows)||[]);
    qcrRenderExecutive(data?.intel||{},critical,(m&&m.rows)||[]);
    qcrRenderTrendPrediction((m&&m.rows)||[],d,w);
    fetch('/api/qcr_target_history?'+params,{signal}).then(r=>r.json()).then(th=>{if(!th.error){qcrRenderTargetHistory(th.rows||[],th.target); scheduleQcrLayout();}}).catch(()=>{});
    const intel=data?.intel||{};
    qcrRenderProblemFinder(intel);
    qcrRenderQualityStory(intel);
    qcrRenderQualityImprovements(intel);
    qcrRenderWhyDecomposition(intel);
    qcrRenderHealthReasons(intel);
    qcrRenderTopContributors(topDefects,defectTotalQty,worstWc,worstGr,intel);
    const loadToken=++window.qcrLoadToken;
    if(topDefects[0]?.defect) loadRootCause(topDefects[0].defect).finally(scheduleQcrLayout);

    markChartsReady();
    scheduleQcrLayout();
  }catch(e){
    if(e.name!=='AbortError'){
      console.error('QCR load failed',e);
      const msg=String(e?.message||'Unable to load Control Room data');
      const ids=['qcrProblemFinder','qcrQualityStory','qcrQualityImprovements','qcrCriticalKpis','qcrContribDefect','qcrContribWc','qcrContribGrade','qcrComparison','qcrWhyChanged','qcrTrendPrediction','qcrTargetHistory'];
      ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="qcr-empty">Unable to load this QCR section. <span class="qcr-error-detail">'+escQcr(msg)+'</span></div>';});
      const root=document.getElementById('qcrRootCause');if(root)root.innerHTML='<div class="qcr-empty">Root-cause data unavailable until QCR data reconnects.</div>';
      const qs=document.getElementById('qcrQualityStatus');if(qs){qs.className='qcr-quality-status amber';const st=qs.querySelector('strong');if(st)st.textContent='UNAVAILABLE';}
    }
  }
}

// ---------- QCR stable layout ----------
// QCR uses native CSS grid only. No JS card positioning is used; this keeps
// the tab responsive and prevents ResizeObserver/layout feedback loops.
function layoutQcrCards(){ return; }
function scheduleQcrLayout(){ return; }

// ---------- Tab switching ----------
const TAB_LOADERS = {
  dashboard: loadKpis,
  controlroom: loadControlRoom,
  wcgrade: loadWcGrade,
  defects: loadDefectAnalysis,
  weekly: loadPeriodTrend,
};

async function activateTab(tabName){
  fetch("/api/activity/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"tab_open",tab:tabName,filters:currentFilters})}).catch(()=>{});
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + tabName));
  try { await TAB_LOADERS[tabName](signal); if(tabName==='controlroom') scheduleQcrLayout(); } catch(e) { if(e.name!=="AbortError") console.error(e); }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  activateTab(btn.dataset.tab);
});

const VISITOR_ID_KEY = "qdash_visitor_id_v1";
function getVisitorId(){
  try{
    let id=localStorage.getItem(VISITOR_ID_KEY);
    if(!id){id=(crypto&&crypto.randomUUID)?crypto.randomUUID():"v-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,12);localStorage.setItem(VISITOR_ID_KEY,id);}
    return id;
  }catch(e){return "v-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,12);}
}
async function sendLiveHeartbeat(){
  try{
    const visitor_id=getVisitorId();
    const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    await fetch('/api/activity/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitor_id,tab}),keepalive:true});
  }catch(e){}
}
async function refreshLiveUsers(){
  try{
    const r=await fetch('/api/activity/live',{cache:'no-store'}); const d=await r.json();
    const el=document.getElementById('liveUsersCount'); if(el) el.textContent=Number(d.active_users||0).toLocaleString();
  }catch(e){}
}
function startLiveUserTracking(){
  sendLiveHeartbeat(); refreshLiveUsers();
  setInterval(()=>{sendLiveHeartbeat();refreshLiveUsers();},20000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){sendLiveHeartbeat();refreshLiveUsers();}});
}

function setRefreshed(){
  const now = new Date();
  const d = String(now.getDate()).padStart(2,"0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  const hh = String(now.getHours()).padStart(2,"0");
  const mm = String(now.getMinutes()).padStart(2,"0");
  document.getElementById("refreshed").textContent = `${d} ${m} ${y} • ${hh}:${mm}`;
  document.getElementById("liveLabel").textContent = "LIVE DATA";
}

async function init(){
  setRefreshed();
  startLiveUserTracking();
  // Dashboard is intentionally public for now. No username/password is required.
  // Every dashboard page load is logged server-side with the visitor IP address.
  await loadKpiTargets();
  wireDrilldown();
  await loadFilters();
  await loadKpis();
}
init();
