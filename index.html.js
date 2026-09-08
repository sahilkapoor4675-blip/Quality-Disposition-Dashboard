
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
  container.innerHTML = `<div class="filter-toolbar"><div class="filter-toolbar-title">Dashboard Filters</div><div class="filter-actions"><button id="exportExcelBtn" class="export-btn" type="button">📊 Excel</button><button id="exportPdfBtn" class="export-btn" type="button">📄 PDF</button><button id="exportCsvBtn" class="export-btn" type="button">📋 CSV</button><span id="activeFilterBadge" class="active-filter-badge">0 Active</span><button id="resetAllBtn" class="reset-all" type="button">Reset All</button></div></div>`;
  FILTER_DEFS.forEach(f => {
    const field = document.createElement("div"); field.className = "filter-field";
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
        const opt=document.createElement("div"); opt.className="filter-option"+(x.value==="All"?" all-option":"")+(currentFilters[f.key]===x.value?" selected":"");
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
  try{await TAB_LOADERS[activeTab](signal);}catch(e){if(e.name!=="AbortError") console.error(e);}finally{
    const elapsed=performance.now()-t0; const wait=Math.max(0,250-elapsed);
    setTimeout(()=>{document.querySelectorAll('.kpi-card').forEach(c=>c.classList.remove('shimmering')); document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-refreshing');c.classList.add('chart-ready');setTimeout(()=>c.classList.remove('chart-ready'),350)}); if(page)page.classList.remove('dashboard-refreshing');},wait);
  }
}


// Icon shown before each KPI card's name — purely cosmetic, keyed by label.
const KPI_ICONS = {
  "Total Coils": "📦",
  "Defect Coils": "⚠️",
  "First Pass Yield %": "✅",
  "Hold for Decision % Qty": "⏳",
  "Output Quantity (MT)": "🏭",
  "PPM Defective": "📉",
  "Salvage % Qty": "♻️",
  "Intensity Tagging %": "🏷️",
  "Salvage + Divert Qty (MT)": "🔀",
  "Defect Rate": "🔻",
  "Reject % Qty": "🚫",
  "Process Sigma Level (Approx.)": "🎯",
  "Hold For Decision Qty (MT)": "🕒",
  "Reject Qty (MT)": "❌",
  "Rework % Qty": "🔧",
  "Without Intensity %": "❔",
};

function kpiTarget(label,k){ return (k&&k.target_text) || "Target: Not set"; }
function kpiStatus(label,k){ if(k&&k.target_status) return k.target_status; return "neutral"; }
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
    const statusText=status==='good'?'On Target':status==='amber'?'Watch':status==='bad'?'Action':'Neutral';
    card.innerHTML=`<div class="kpi-top"><div class="label"><span class="kpi-icon">${KPI_ICONS[k.label]||'📊'}</span>${k.label}</div><span class="kpi-status ${status}">${statusText}</span></div><div class="value" data-target="${cur}" style="color:${k.color||'#0f2a4a'}">${fmtValue(cur,k.fmt)}</div><div class="kpi-bottom"><div class="kpi-meta"><div class="kpi-target">${kpiTarget(k.label,k)}</div><div class="kpi-trendline">${trendHtml}</div></div>${sparklineSvg(oldValue,cur,status)}</div>`;
    grid.appendChild(card); const valueEl=card.querySelector('.value'); if(changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)animateKpiValue(valueEl,oldValue,cur,k.fmt,token); nextValues.set(k.label,cur);
  }); previousKpiValues=nextValues;
}

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
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${fmtNum2(total.qty)}</td>
      <td>${fmtPct(total.pct)}</td><td>${fmtPct(total.cum_pct)}</td>`;
    tbody.appendChild(tr);
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

function renderMetricsTable(tableId, rows, total){
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.name}</td><td>${r.coils.toLocaleString()}</td>
      <td>${fmtNum2(r.output_qty)}</td><td>${r.defect_coils.toLocaleString()}</td>
      <td>${fmtPct(r.defect_pct)}</td><td>${fmtNum2(r.reject_qty)}</td>
      <td>${fmtPct(r.reject_pct_qty)}</td><td>${fmtPct(r.first_pass_yield_pct)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${total.coils.toLocaleString()}</td>
      <td>${fmtNum2(total.output_qty)}</td><td>${total.defect_coils.toLocaleString()}</td>
      <td>${fmtPct(total.defect_pct)}</td><td>${fmtNum2(total.reject_qty)}</td>
      <td>${fmtPct(total.reject_pct_qty)}</td><td>${fmtPct(total.first_pass_yield_pct)}</td>`;
    tbody.appendChild(tr);
  }
}

async function loadKpis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  // Dashboard KPI and monthly trend are independent; fetch them together.
  const monthlyPromise = loadMonthlyTrend(signal);
  const res = await fetch("/api/kpis?" + params, {signal});
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  renderKpis(data.kpis);
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
    slices += `<path d="M${ox1},${oy1} A${r},${r} 0 ${largeArc} 1 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${s.color}" stroke="#fff" stroke-width="2.5"><title>${s.d[labelKey]}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${(s.frac*100).toFixed(1)}%)</title></path>`;
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

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${slices}${centerLabel}${sliceLabels}</svg>
    <div class="legend" style="justify-content:center;">${legend}</div>`;
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
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${x + barW/2}" y="${y - 8}" font-size="14.5" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${x + barW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${x+barW/2} ${h-padB+20})">${truncateLabel(d[labelKey], 12)}</text>`;
  });
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
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
  const w = DESIGN_W;
  const rowH = 40, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = items.length * rowH + padT + padB;
  const maxV = niceMax(Math.max(...items.map(d => d[valueKey]), 0));
  const plotW = w - padL - padR;
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="#6b7c93">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  items.forEach((d, i) => {
    const val = d[valueKey];
    const barW = (val / maxV) * plotW;
    const y = padT + i * rowH + rowH*0.2;
    const barH = rowH * 0.6;
    const barColor = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${padL + barW + 8}" y="${y + barH/2 + 4}" font-size="14.5" font-weight="700" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${padL - 10}" y="${y + barH/2 + 4}" font-size="12" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}<title>${d[labelKey]}</title></text>`;
  });
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
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

  const maxes = seriesDefs.map(s => niceMax(Math.max(...items.map(d => d[s.key]), 0)));

  let bars = "", labels = "", legend = "";
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupY = padT + i * rowH + rowH*0.15;
    seriesDefs.forEach((s, si) => {
      const val = d[s.key];
      const maxV = maxes[si];
      const barW = (val / maxV) * plotW;
      const y = groupY + si * (barH + 5);
      bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${s.color}" rx="3"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${padL + barW + 10}" y="${y + barH/2 + 5}" font-size="16.5" font-weight="700" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${padL - 12}" y="${groupY + (barH+5)*nSeries/2 + 2}" font-size="12.5" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}</text>`;
  });

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg><div class="legend">${legend}</div>`;
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

  const maxes = seriesDefs.map(s => niceMax(Math.max(...items.map(d => d[s.key]), 0)));

  let bars = "", labels = "", legend = "", gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
  }
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupX = padL + i * gap + (gap - groupW) / 2;
    seriesDefs.forEach((s, si) => {
      const val = d[s.key];
      const maxV = maxes[si];
      const barH = (val / maxV) * (h - padT - padB);
      const x = groupX + si * (barW + 6);
      const y = h - padB - barH;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${s.color}" rx="2"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 6}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${groupX + groupW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${groupX+groupW/2} ${h-padB+20})">${truncateLabel(d[labelKey], truncLen)}<title>${d[labelKey]}</title></text>`;
  });

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg><div class="legend">${legend}</div>`;
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

  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${svgParts}${xLabels}
  </svg><div class="legend">${legend}</div>`;
}

function makeComboChart(container, items, labelKey, barKey, lineKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 420, padL = 65, padR = 45, padT = 30, padB = 110;
  const maxBar = niceMax(Math.max(...items.map(d => d[barKey]), 0));
  const plotW = w - padL - padR;
  const gap = plotW / items.length;
  const barW = Math.min(50, gap * 0.5);
  let bars = "", labels = "", points = "", dots = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${(opts.barFmt ? opts.barFmt(maxBar*g/4) : (maxBar*g/4).toFixed(0))}</text>`;
  }

  items.forEach((d, i) => {
    const val = d[barKey];
    const barH = (val / maxBar) * (h - padT - padB);
    const x = padL + i * gap + (gap - barW) / 2;
    const y = h - padB - barH;
    const barColor = opts.colorful ? CHART_COLORS[i % CHART_COLORS.length] : "#118DFF";
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.barFmt ? opts.barFmt(val) : val}</title></rect>`;
    bars += `<text x="${x+barW/2}" y="${y-8}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.barFmt ? opts.barFmt(val) : val}</text>`;
    labels += `<text x="${x+barW/2}" y="${h-padB+20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-35 ${x+barW/2} ${h-padB+20})">${truncateLabel(d[labelKey],16)}</text>`;
    const lineY = h - padB - (d[lineKey]) * (h - padT - padB);
    points += `${x+barW/2},${lineY} `;
    dots += `<circle cx="${x+barW/2}" cy="${lineY}" r="4" fill="#DC2626" stroke="#fff" stroke-width="1.5"><title>Cumulative: ${opts.lineFmt ? opts.lineFmt(d[lineKey]) : d[lineKey]}</title></circle>`;
    dots += `<text x="${x+barW/2}" y="${lineY-10}" font-size="14" font-weight="700" text-anchor="middle" fill="#DC2626">${opts.lineFmt ? opts.lineFmt(d[lineKey]) : d[lineKey]}</text>`;
  });
  container.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${yAxisTitle("Qty (MT)", h, padT, padB)}
    ${xAxisTitleV(opts.xLabel || "Main Defect", w, h, padL, padR)}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}<polyline points="${points}" fill="none" stroke="#DC2626" stroke-width="2.5"/>${dots}${labels}
  </svg>
  <div class="legend">
    <div class="legend-item"><span class="legend-dot" style="background:#118DFF"></span>Qty (MT)</div>
    <div class="legend-item"><span class="legend-dot" style="background:#DC2626"></span>Cumulative %</div>
  </div>`;
}

// ---------- Tab: Work Center & Grade ----------
async function loadWcGrade(){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/work_center_grade?" + params);
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  makeHBarChart(document.getElementById("wcChart"), data.by_work_center, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Work Center"});
  renderMetricsTable("wcTable", data.by_work_center, data.total_work_center);
  makeHBarChart(document.getElementById("gradeChart"), data.by_grade, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Grade"});
  renderMetricsTable("gradeTable", data.by_grade, data.total_grade); markChartsReady();
}

// ---------- Tab: Defect Analysis ----------
async function loadDefectAnalysis(){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/defect_analysis?" + params);
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }
  makeComboChart(document.getElementById("paretoChart"), data.pareto, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Main Defect", colorful: true});
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
    {key:"first_pass_yield_pct", label:"First Pass Yield %", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Month"});
  makeGroupedBarChart(document.getElementById("monthlyBarChart"), data.rows, "name", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"output_qty", label:"Output Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(0)},
  ], {yLabel: "Coils / Qty (MT)", xLabel: "Month"});
  renderMetricsTable("monthlyTable", data.rows, data.total); markChartsReady();
}

// ---------- Tab: Period Trend (Weekly / Quarterly / Yearly) ----------
async function loadPeriodTrend(){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/period_trend?" + params);
  const data = await res.json();
  if(data.error){ console.error(data.error); return; }

  makeLineChart(document.getElementById("weeklyChart"), data.weekly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Week"});
  renderMetricsTable("weeklyTable", data.weekly, data.weekly_total);

  makeLineChart(document.getElementById("quarterlyChart"), data.quarterly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"first_pass_yield_pct", label:"First Pass Yield %", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Quarter"});
  renderMetricsTable("quarterlyTable", data.quarterly, data.quarterly_total);

  makeLineChart(document.getElementById("yearlyChart"), data.yearly, "name", [
    {key:"first_pass_yield_pct", label:"First Pass Yield %", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Financial Year"});
  renderMetricsTable("yearlyTable", data.yearly, data.yearly_total); markChartsReady();
}

// ---------- Tab switching ----------
const TAB_LOADERS = {
  dashboard: loadKpis,
  wcgrade: loadWcGrade,
  defects: loadDefectAnalysis,
  weekly: loadPeriodTrend,
};

function activateTab(tabName){
  fetch("/api/activity/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"tab_open",tab:tabName,filters:currentFilters})}).catch(()=>{});
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + tabName));
  TAB_LOADERS[tabName]();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  activateTab(btn.dataset.tab);
});

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
  // Dashboard is intentionally public for now. No username/password is required.
  // Every dashboard page load is logged server-side with the visitor IP address.
  await loadFilters();
  await loadKpis();
}
init();
