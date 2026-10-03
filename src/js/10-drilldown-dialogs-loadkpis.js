/* 10-drilldown-dialogs-loadkpis.js — Drill-down modal, export/compare dialogs, loadKpis. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
function drilldownFiltersQuery(extra={}){const p=new URLSearchParams(currentFilters); Object.keys(extra).forEach(k=>p.set(k,extra[k])); return p.toString();}
let drillStack=[];
let _presentationDrillState=null;
function currentDrill(){return drillStack[drillStack.length-1]||{metric:'',title:'',extra:{},page:1};}

function elevateDrillModalForPresentation(){
  const modal=document.getElementById('drillModal');
  if(!modal || !_analyticsPresentationState || modal.parentNode===document.body || _presentationDrillState) return;
  const placeholder=document.createComment('qdash-presentation-drill-placeholder');
  modal.parentNode.insertBefore(placeholder,modal);
  document.body.appendChild(modal);
  _presentationDrillState={modal,placeholder};
}

function restoreDrillModalAfterPresentation(){
  const state=_presentationDrillState;
  if(!state) return;
  try{
    state.placeholder.parentNode?.insertBefore(state.modal,state.placeholder);
    state.placeholder.remove();
  }catch(e){}
  _presentationDrillState=null;
}
function renderDrillBreadcrumb(){
  const nav=document.getElementById('drillBreadcrumb'); if(!nav)return;
  if(drillStack.length<2){nav.innerHTML='';nav.style.display='none';return;}
  nav.style.display='flex';
  nav.innerHTML=drillStack.map((lvl,i)=>{
    const isLast=i===drillStack.length-1;
    const label=escQcr(lvl.crumb||lvl.title||'Level '+(i+1));
    return (i>0?'<span class="drill-breadcrumb-sep" aria-hidden="true">›</span>':'')+
      (isLast
        ? `<span class="drill-breadcrumb-crumb current" aria-current="page">${label}</span>`
        : `<button type="button" class="drill-breadcrumb-crumb" data-drill-level="${i}">${label}</button>`);
  }).join('');
}
function goToDrillLevel(i){
  if(i<0||i>=drillStack.length)return;
  drillStack=drillStack.slice(0,i+1);
  renderDrillBreadcrumb();
  renderDrillPage(currentDrill().page||1);
}
function renderDrillPage(page=1){
  const {metric,title,extra}=currentDrill(), modal=document.getElementById('drillModal'), content=document.getElementById('drillContent'); if(!modal||!content)return;
  currentDrill().page=page;
  if(typeof QDHF!=='undefined') QDHF.resetDrill();   // header filters belong to one loaded drill-down: drop them while a new one loads
  const dt=document.getElementById('drillTitle');
  if(dt){ const dtt=dt.querySelector('.drill-title-text'); (dtt||dt).textContent=title||'Underlying Records'; }
  const subEl=document.getElementById('drillSubtitle'); if(subEl) subEl.textContent=activeFilterSummary();
  content.innerHTML='<div class="drill-empty">'+loadingStateMarkup('Loading underlying records…')+'</div>';
  const cntEl=document.getElementById('drillCount'); if(cntEl){ cntEl.textContent='Loading…'; cntEl.classList.add('loading-pulse-text'); }
  const qs=drilldownFiltersQuery(Object.assign({metric,page,page_size:250},extra));
  const expEl=document.getElementById('drillExportBtn');
  if(expEl) expEl.href='/api/drilldown/export?'+drilldownFiltersQuery(Object.assign({metric,fmt:'xlsx',title:(t=>/Underlying Records/i.test(t)?t:'Underlying Records — '+t)(title||metric||'Current selection')},extra));
  const expCsv=document.getElementById('drillExportCsvBtn');
  if(expCsv) expCsv.href='/api/drilldown/export?'+drilldownFiltersQuery(Object.assign({metric,fmt:'csv'},extra));
  fetch('/api/drilldown?'+qs,{cache:'no-store'}).then(r=>r.json()).then(data=>{
    if(data.error)throw new Error(data.error);
    if(cntEl){ cntEl.textContent=Number(data.count||0).toLocaleString()+' coils'; cntEl.classList.remove('loading-pulse-text'); }
    const scEl=document.getElementById('drillScope');
    if(scEl) scEl.textContent=(data.scope||'')+' • '+Number(data.row_count||data.rows?.length||0).toLocaleString()+' records';
    if(!data.rows||!data.rows.length){content.innerHTML='<div class="drill-empty">'+emptyStateMarkup('No underlying records found for this KPI/selection.','Try a wider date range or clear a filter.')+'</div>';return;}
    // Table + Excel-style header filters (src/js/21-drill-header-filters.js) — same columns, rows, totals and pagination as before.
    QDHF.renderDrill(content,data,{metric,extra,cntEl});
  }).catch(e=>{
    content.innerHTML='<div class="drill-empty">'+emptyStateMarkup('Unable to load records.',String(e.message||e),'error')+'</div>';
    if(cntEl){ cntEl.textContent='Error'; cntEl.classList.remove('loading-pulse-text'); }
  });
}
// Opens a fresh drill-down as the FIRST level (e.g. clicking a defect bar on
// a chart) — resets any previous breadcrumb trail, since this is a new,
// unrelated drill starting over from the top.
function openDrilldown(metric,title,extra={},crumb){ drillStack=[{metric,title,extra,page:1,crumb:crumb||title}]; const modal=document.getElementById('drillModal'); if(!modal)return; elevateDrillModalForPresentation(); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('drill-modal-open'); renderDrillBreadcrumb(); renderDrillPage(1); }
// Pushes ONE LEVEL DEEPER onto the existing trail (e.g. clicking a Heat No.
// inside an already-open drill-down) — so "Defect: X" > "Heat H12345" both
// stay visible and clickable in the breadcrumb, instead of the first level
// being silently replaced and losing its context.
function pushDrilldown(metric,title,extra={},crumb){ drillStack.push({metric,title,extra,page:1,crumb:crumb||title}); renderDrillBreadcrumb(); renderDrillPage(1); }

function closeDrilldown(){const m=document.getElementById('drillModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');} document.body.classList.remove('drill-modal-open'); drillStack=[]; const d=document.getElementById('drillDialog'); if(d){d.style.cssText='';} restoreDrillModalAfterPresentation(); /* reset any drag/resize back to default centered size for next open */}
qcrWireProblemActions();
// Desktop convenience: the drill-down modal can be dragged by its header
// and resized from its bottom-right corner, like a real window, instead of
// being a fixed-size overlay. Pure pointer-event math — no library.
function wireDrillDialogDragResize(){
  const dialog=document.getElementById('drillDialog'), head=document.getElementById('drillHead'), handle=document.getElementById('drillResizeHandle');
  if(!dialog||!head||!handle) return;
  let mode=null, startX=0, startY=0, startRect=null;
  function onMove(e){
    if(!mode) return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    if(mode==='drag'){
      dialog.style.position='fixed'; dialog.style.margin='0';
      dialog.style.left=Math.max(0,Math.min(window.innerWidth-80,startRect.left+dx))+'px';
      dialog.style.top=Math.max(0,Math.min(window.innerHeight-40,startRect.top+dy))+'px';
    } else if(mode==='resize'){
      dialog.style.width=Math.max(480,startRect.width+dx)+'px';
      dialog.style.height=Math.max(320,startRect.height+dy)+'px';
    }
  }
  function onUp(){ mode=null; dialog.classList.remove('dragging'); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
  head.addEventListener('mousedown',e=>{
    if(e.target.closest('#drillCloseBtn,#drillExportBtn,#drillExportCsvBtn')) return; // don't start a drag from the action buttons
    mode='drag'; startX=e.clientX; startY=e.clientY; startRect=dialog.getBoundingClientRect(); dialog.classList.add('dragging');
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
  });
  handle.addEventListener('mousedown',e=>{
    e.preventDefault(); mode='resize'; startX=e.clientX; startY=e.clientY; startRect=dialog.getBoundingClientRect(); dialog.classList.add('dragging');
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
  });
}
// Side-by-side compare: reuses the URL-state feature (?tab=...&<dim>=...)
// so each pane is a fully live, independent copy of this same dashboard at
// a different filter value — not a simplified summary that needs its own
// rendering path to maintain.
function wireExportDialog(){
  const btn=document.getElementById('exportMenuBtn');
  const modal=document.getElementById('exportDialogModal');
  const closeBtn=document.getElementById('exportDialogCloseBtn');
  const options=[...document.querySelectorAll('.export-dialog-option[data-fmt]')];
  if(!btn||!modal||!closeBtn||!options.length) return;
  // The Chemistry SPC tab adds its own downloads to this SAME dialog (Cpk table, heat data, out-of-spec heats); the disposition reports stay
  // below them. They are only shown while the Chemistry tab is open.
  const chemGroup=document.getElementById('exportChemGroup'), dispTitle=document.getElementById('exportDispTitle');
  const chemOptions=[...document.querySelectorAll('.export-dialog-option[data-chem-export]')];
  const onChem=()=>document.querySelector('.tab-btn.active')?.dataset.tab==='chem';

  let restoreFocusEl=null;
  const setOpenState=(open)=>{
    modal.classList.toggle('open',open);
    modal.setAttribute('aria-hidden',open?'false':'true');
    btn.setAttribute('aria-expanded',open?'true':'false');
  };
  const close=({restoreFocus=false}={})=>{
    const wasOpen=modal.classList.contains('open');
    setOpenState(false);
    if(restoreFocus && wasOpen){
      const target=restoreFocusEl||btn;
      try{ target.focus({preventScroll:true}); }catch(e){ target.focus(); }
    }
    restoreFocusEl=null;
  };
  const open=()=>{
    restoreFocusEl=document.activeElement;
    // Disposition reports are built from the disposition data and the DASHBOARD filters. While the Chemistry SPC tab is open those
    // filters are hidden, so say so; the Chemistry downloads (current Chemistry selection) are listed first.
    const chem=onChem();
    const _desc=document.getElementById('exportDialogDesc');
    if(_desc){
      if(!_desc.dataset.base) _desc.dataset.base=_desc.textContent;
      _desc.textContent=chem
        ? 'Chemistry downloads use the current Chemistry selection (grade, parameter, period). The disposition reports below cover the disposition data with the dashboard filters.'
        : _desc.dataset.base;
    }
    if(chemGroup) chemGroup.classList.toggle('hidden',!chem);
    if(dispTitle) dispTitle.classList.toggle('hidden',!chem);
    setOpenState(true);
    requestAnimationFrame(()=>(chem&&chemOptions[0]?chemOptions[0]:options[0])?.focus());
  };
  const runExport=(format)=>{
    close();
    exportDashboard(format);
  };
  const runChemExport=(kind)=>{
    close();
    if(typeof chemRunExport==='function') chemRunExport(kind);
  };

  btn.addEventListener('click',e=>{ e.stopPropagation(); modal.classList.contains('open') ? close({restoreFocus:true}) : open(); });
  closeBtn.addEventListener('click',()=>close({restoreFocus:true}));
  options.forEach(item=>item.addEventListener('click',()=>runExport(item.dataset.fmt)));
  chemOptions.forEach(item=>item.addEventListener('click',()=>runChemExport(item.dataset.chemExport)));
  modal.addEventListener('click',e=>{ if(e.target===modal) close({restoreFocus:true}); });
  modal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ e.preventDefault(); close({restoreFocus:true}); return; }
    if(e.key!=='Tab') return;
    const focusables=[closeBtn,...(onChem()?chemOptions:[]),...options];
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && modal.classList.contains('open')){ e.preventDefault(); close({restoreFocus:true}); }
  });
}
function wireCompareMode(){
  const btn=document.getElementById('compareModeBtn'), modal=document.getElementById('compareModal');
  if(!btn||!modal) return;
  const dimSelect=document.getElementById('compareDimSelect'), valA=document.getElementById('compareValueA'), valB=document.getElementById('compareValueB');
  // Compare works on whichever tab is open: the dashboard tabs compare a dashboard filter (Month, Work Center, ...); the Chemistry SPC tab
  // compares a Chemistry filter (Month, Week, Quarter, Fin. Year, Grade, Parameter). Both ride on the URL-state feature, so each pane is a live copy of the page.
  const onChem=()=>document.querySelector('.tab-btn.active')?.dataset.tab==='chem' && typeof chemCompareDims==='function';
  let shownMode=null;
  function dims(){ return onChem() ? chemCompareDims() : FILTER_DEFS.map(f=>({key:f.key,label:f.label.replace(/^\S+\s/,'')})); }
  function itemsFor(key){
    if(onChem()) return chemCompareItems(key);
    const raw=(window._filterOptionsCache&&window._filterOptionsCache[key])||[];
    return raw.map(item=>(item&&typeof item==='object')?item:{value:item,label:item}).filter(x=>x.value!=='All');
  }
  function populateValues(){
    const items=itemsFor(dimSelect.value);
    const optionsHtml=items.map(x=>`<option value="${escQcr(x.value)}">${escQcr(x.label)}</option>`).join('');
    valA.innerHTML=optionsHtml; valB.innerHTML=optionsHtml;
    if(items.length>1) valB.selectedIndex=1; // default to two different values instead of the same one twice
  }
  function fillDims(){
    const keep=dimSelect.value, list=dims();
    dimSelect.innerHTML=list.map(d=>`<option value="${d.key}">${escQcr(d.label)}</option>`).join('');
    if(onChem()){
      // A dimension with fewer than two values cannot be compared (e.g. Month when no cast dates are stored): say so and start on one that can.
      const n=d=>chemCompareItems(d.key).length;
      dimSelect.innerHTML=list.map(d=>`<option value="${d.key}">${escQcr(d.label)}${n(d)<2?' (not enough data)':''}</option>`).join('');
      const ok=list.filter(d=>n(d)>=2);
      dimSelect.value=(list.some(d=>d.key===keep)&&n(list.find(d=>d.key===keep))>=2)?keep:(ok[0]?ok[0].key:list[0].key);
    } else dimSelect.value=list.some(d=>d.key===keep)?keep:'month';
    populateValues();
  }
  dimSelect.addEventListener('change',populateValues);
  fillDims(); shownMode=onChem()?'chem':'dash';
  // fresh=true: opened from a Compare button (re-read the lists, they depend on the current grade / filters on the Chemistry tab);
  // fresh=false: "Change" inside the open comparison, which keeps the choices already made.
  function openSetup(fresh){
    const mode=onChem()?'chem':'dash';
    if(fresh===true && (mode==='chem' || mode!==shownMode)){ shownMode=mode; fillDims(); }
    else if(mode!==shownMode){ shownMode=mode; fillDims(); }
    modal.classList.add('open'); document.getElementById('compareView').classList.add('hidden'); document.getElementById('compareSetup').style.display='block';
  }
  window.qdOpenCompare=()=>openSetup(true);
  function clearComparingToStatus(){ const s=document.getElementById('statusComparingTo'); if(s) s.textContent='None'; }
  btn.addEventListener('click',()=>openSetup(true));
  document.getElementById('compareCancelBtn').addEventListener('click',()=>{ modal.classList.remove('open'); clearComparingToStatus(); });
  document.getElementById('compareCloseBtn').addEventListener('click',()=>{ modal.classList.remove('open'); clearComparingToStatus(); });
  document.getElementById('compareEditBtn').addEventListener('click',()=>openSetup(false));
  document.getElementById('compareGoBtn').addEventListener('click',()=>{
    const key=dimSelect.value, a=valA.value, b=valB.value;
    if(!a||!b){ showToast('error','Pick both values',onChem()?'This filter has no values to compare yet. If Month / Week / Quarter / Fin. Year are empty, re-import the chemistry file (Admin → Cast Chemistry) so its Date column is stored.':'Choose a value for both the left and right side.'); return; }
    const chem=onChem();
    const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    function buildUrl(val){
      const params=new URLSearchParams();
      if(tab!=='dashboard') params.set('tab',tab);
      if(chem){
        // Chemistry tab: carry the current Chemistry selection, with the compared filter set to this pane's value
        const snap=chemSelSnapshot();
        if(['month','week','quarter','fy'].includes(key)) ['month','week','quarter','fy'].forEach(k=>{ snap[k]=''; });   // an old Month would blank a pane that compares Quarters
        snap[key]=key==='last_n'?(Number(val)||0):val;
        chemWriteUrl(params,snap);
        return location.pathname+'?'+params.toString();
      }
      FILTER_DEFS.forEach(f=>{ if(f.key===key) return; if(currentFilters[f.key]&&currentFilters[f.key]!=='All') params.set(f.key,currentFilters[f.key]); });
      params.set(key,val);
      return location.pathname+'?'+params.toString();
    }
    document.getElementById('compareFrameA').src=buildUrl(a);
    document.getElementById('compareFrameB').src=buildUrl(b);
    const dimLabel=(dims().find(d=>d.key===key)||{}).label||key;
    const items=chem?itemsFor(key):[], lab=v=>chem?((items.find(x=>String(x.value)===String(v))||{}).label||v):v;
    document.getElementById('compareViewTitle').textContent=`Comparing ${chem?'Chemistry ':''}${dimLabel}: ${lab(a)}  vs  ${lab(b)}`;
    document.getElementById('compareSetup').style.display='none';
    document.getElementById('compareView').classList.remove('hidden');
    const s=document.getElementById('statusComparingTo'); if(s) s.textContent=`${lab(a)} vs ${lab(b)}`;
  });
}
function wireDrilldown(){
  document.getElementById('drillCloseBtn')?.addEventListener('click',closeDrilldown);
  document.getElementById('drillModal')?.addEventListener('click',e=>{if(e.target.id==='drillModal')closeDrilldown();});
document.getElementById('drillBreadcrumb')?.addEventListener('click',e=>{const b=e.target.closest('[data-drill-level]');if(b)goToDrillLevel(Number(b.dataset.drillLevel));});
document.getElementById('drillContent')?.addEventListener('click',e=>{const b=e.target.closest('.heat-detail-btn');if(b){const heat=b.dataset.heat;if(heat)pushDrilldown('heat_detail',`Heat ${heat} — Complete History`,{drill_value:heat},`Heat ${heat}`);return;} const pg=e.target.closest('[data-drill-page]');if(pg&&!pg.disabled)renderDrillPage(Number(pg.dataset.drillPage));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && document.getElementById('drillModal')?.classList.contains('open')){e.preventDefault();e.stopImmediatePropagation();closeDrilldown();}});
  document.getElementById('saveViewBtn')?.addEventListener('click',()=>saveCurrentView('dash'));
  document.getElementById('clearViewsBtn')?.addEventListener('click',()=>manageSavedViews('dash'));
  document.getElementById('savedViewSelect')?.addEventListener('change',e=>applySavedView(e.target.value,'dash'));
  renderSavedViews('dash');
  // Chemistry SPC has its own Saved Views strip (own list of presets, stored separately from the dashboard's)
  document.getElementById('chemSaveViewBtn')?.addEventListener('click',()=>saveCurrentView('chem'));
  document.getElementById('chemClearViewsBtn')?.addEventListener('click',()=>manageSavedViews('chem'));
  document.getElementById('chemSavedViewSelect')?.addEventListener('change',e=>applySavedView(e.target.value,'chem'));
  renderSavedViews('chem');
  wireDrillDialogDragResize();
}
// When the selected filters match no coils (e.g. Month=Jun with Quarter=Q2), every KPI
// would otherwise show 0.000% in green/red status colours and a misleading "-100%" trend
// against the previous period. Say so plainly and neutralise the cards instead.
function applyEmptySelectionState(isEmpty){
  const banner=document.getElementById('periodBanner'), grid=document.getElementById('kpiGrid');
  if(!banner||!grid) return;
  grid.classList.toggle('kpi-grid-empty', !!isEmpty);
  if(!isEmpty) return;
  banner.innerHTML='⚠️ <b>No records match the selected filters.</b> &nbsp;These filters don\u2019t overlap (for example a Month outside the chosen Quarter). Change a filter or use <b>Reset All</b>.';
  grid.querySelectorAll('.kpi-card').forEach(card=>{
    card.className=card.className.replace(/\bstatus-\w+\b/g,'').trim()+' status-neutral';
    const st=card.querySelector('.kpi-status'); if(st){ st.className='kpi-status neutral'; st.textContent='NO DATA'; }
    const tl=card.querySelector('.kpi-trendline'); if(tl) tl.innerHTML='';
    const v=card.querySelector('.value'); if(v) v.style.color='#7B8A9A';
  });
}
async function loadKpis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  // Dashboard KPI and monthly trend are independent; fetch them together.
  const monthlyPromise = loadMonthlyTrend(signal);
  monthlyPromise.catch(()=>{}); // observed below by "await monthlyPromise"; avoids an unhandled-rejection if /api/kpis fails first
  const res = await fetch("/api/kpis?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }
  renderKpis(data.kpis);
  const totalKpi = (data.kpis||[]).find(x=>x.label==='Total Coils'); refreshFilterSummary(totalKpi ? totalKpi.value : 0);
  renderPeriodBanner(data.period);
  applyEmptySelectionState(!totalKpi || Number(totalKpi.value)===0);
  renderDecisionTable(data.decision_table, data.decision_total);
  renderDefectTable(data.top_defects, data.top_defects_total);
  renderIntensityTable(data.intensity_table, data.intensity_total);
  dashLoadFishbone(data.top_defects);

  const decisionRows = data.decision_table.filter(r => r.qty > 0);
  makePieChart(document.getElementById("decisionPie"), decisionRows, "qty", "decision",
    {valFmt: fmtDonutQty3});
  makeGroupedBarChart(document.getElementById("decisionBarChart"), data.decision_table, "decision", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {yLabel: "Coils  /  Qty (MT)", xLabel: "Quality Decision", labelTruncate: 16});
  makeComboChart(document.getElementById("pareto5Chart"), data.top_defects, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Defect Type", colorful: true});
  makeHGroupedBarChart(document.getElementById("intensityChart"), data.intensity_table, "intensity", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {xLabel: "Coils  /  Qty (MT)", yLabel: "Defect Intensity", drillKind: 'intensity'});

  wireChartDrilldown('decisionPie','decision'); wireChartDrilldown('decisionBarChart','decision'); wireChartDrilldown('pareto5Chart','defect'); wireChartDrilldown('intensityChart','intensity');
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
