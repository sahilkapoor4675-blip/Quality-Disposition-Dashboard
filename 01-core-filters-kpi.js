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
  container.innerHTML = `<div class="filter-toolbar"><div class="filter-toolbar-title">Dashboard Filters</div><div class="filter-actions"><button id="exportExcelBtn" class="export-btn" type="button">📊 Quality Report • Excel</button><button id="exportPdfBtn" class="export-btn" type="button">📄 Quality Report • PDF</button><button id="exportCsvBtn" class="export-btn" type="button">📋 Raw Data • CSV</button><span id="activeFilterBadge" class="active-filter-badge">0 Active</span><button id="resetAllBtn" class="reset-all" type="button">Reset All</button></div></div>`;
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
          currentFilters[f.key]=x.value; valueSpan.textContent=x.label; control.classList.remove("open"); search.value=""; renderOptions(); updateActiveFilterBadge(); triggerFilterRefresh();
        }); list.appendChild(opt);
      });
      if(!filtered.length) list.innerHTML='<div class="filter-empty">No matching options</div>';
    };
    trigger.addEventListener("click",()=>{document.querySelectorAll('.filter-control.open').forEach(c=>{if(c!==control)c.classList.remove('open')}); control.classList.toggle('open'); if(control.classList.contains('open')){search.focus();renderOptions(search.value);}});
    search.addEventListener("input",()=>renderOptions(search.value));
    renderOptions();
  });
  document.getElementById("resetAllBtn").addEventListener("click",()=>{FILTER_DEFS.forEach(f=>currentFilters[f.key]="All"); document.querySelectorAll('.filter-control').forEach(c=>{c.classList.remove('open'); const s=c.querySelector('.filter-trigger span'); if(s)s.textContent='All';}); updateActiveFilterBadge(); triggerFilterRefresh();});
  function exportDashboard(format){ const params=new URLSearchParams(currentFilters).toString(); window.location.href=`/api/export/${format}?${params}`; }
  document.getElementById("exportExcelBtn").addEventListener("click",()=>exportDashboard("excel"));
  document.getElementById("exportPdfBtn").addEventListener("click",()=>exportDashboard("pdf"));
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
function applySavedView(name){const views=savedViews(); if(!name||!views[name])return; Object.assign(currentFilters,views[name]); document.querySelectorAll('.filter-field').forEach(field=>{const key=field.dataset.filterKey; const val=currentFilters[key]||'All'; const span=field.querySelector('.filter-trigger span'); if(span){const opts=[...field.querySelectorAll('.filter-option')]; const match=opts.find(o=>o.dataset.value===val); span.textContent=match?match.textContent:val;}}); updateActiveFilterBadge(); triggerFilterRefresh();}
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
document.getElementById('qcrDefects')?.addEventListener('click',e=>{const b=e.target.closest('.qcr-defect-btn');if(b)loadRootCause(b.dataset.defect||'');});
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
