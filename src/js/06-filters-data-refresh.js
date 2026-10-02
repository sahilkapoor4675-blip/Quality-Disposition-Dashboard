/* 06-filters-data-refresh.js — Filter loading, data-revision polling, refresh. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---- Report exports (Excel / PDF / PPT / raw CSV) ----
// Triggered from the header's "⬇ Export" button via the export dialog.
// Progress is shown as a toast with a live percentage + a "~Ns left" ETA, since large
// reports can take a while:
//  - A fast ticker (every 80ms) drives the NUMBER shown: it always counts up by at least
//    1% per tick toward a moving "target" percent, so it visibly climbs quickly one step
//    at a time rather than jumping straight to a new value.
//  - The target itself comes from two phases: 0→90% is a smooth easing curve while the
//    server assembles the report (there's no real signal yet at that point — the export
//    endpoints build the whole file before sending a single byte), then 90→99% switches
//    to real bytes received vs. the response's Content-Length once headers arrive, so the
//    last stretch reflects the actual download instead of a guess.
//  - The ETA is derived from elapsed time vs. percent-so-far (estTotal = elapsed/pct%),
//    so it updates in real time and self-corrects as the real download phase kicks in.
const EXPORT_LABELS={excel:'Excel report',pdf:'PDF report',pptx:'PowerPoint report',csv:'Raw data (CSV)'};
const _exportBusy={};
function exportDashboard(format){
  const label=EXPORT_LABELS[format]||format;
  if(_exportBusy[format]){ showToast('info',label+' is already being generated','Please wait — the download starts automatically.'); return; }
  _exportBusy[format]=true;
  const params=new URLSearchParams(currentFilters).toString();
  const url=`/api/export/${format}?${params}`;
  const endProgress=showToast('info','Generating '+label+'…','The download starts automatically once it\'s ready.',{duration:300000,progress:true});

  const startedAt=performance.now();
  let targetPct=0;     // where the bar is heading — set by the phases below
  let displayedPct=0;  // what's actually shown; always counts up toward targetPct
  const render=()=>{
    const elapsedMs=performance.now()-startedAt;
    let etaSeconds=null;
    if(displayedPct>=3 && displayedPct<100){
      const estTotalMs=elapsedMs/(displayedPct/100);
      etaSeconds=Math.max(0,(estTotalMs-elapsedMs)/1000);
    }
    endProgress.setProgress(displayedPct,displayedPct>=100?0:etaSeconds);
  };
  // Both loops below used to be independent setInterval() timers (80ms /
  // 200ms). setInterval fires on its own clock, not synced to the browser's
  // paint cycle, so the bar could visibly micro-stutter under any load.
  // Driving both from one requestAnimationFrame loop — using elapsed real
  // time to decide when each logical "tick" is due — keeps the exact same
  // pacing/math but renders every update right before a repaint.
  let lastTickAt=performance.now();
  let lastSimAt=performance.now();
  let simTarget=0;
  let rafId=null;
  const frame=(now)=>{
    if(now-lastSimAt>=200){
      lastSimAt=now;
      simTarget+=(90-simTarget)*0.05;
      targetPct=Math.max(targetPct,simTarget);
    }
    if(now-lastTickAt>=80){
      lastTickAt=now;
      if(displayedPct<targetPct){
        // Catch up faster when the gap is big (real bytes can jump ahead of the sim curve),
        // but always by a visible step of at least 1 — never a silent instant jump.
        displayedPct=Math.min(targetPct,displayedPct+Math.max(1,Math.round((targetPct-displayedPct)/4)));
      }
      render();
    }
    rafId=requestAnimationFrame(frame);
  };
  rafId=requestAnimationFrame(frame);
  const stopTicker=()=>{ if(rafId!=null){ cancelAnimationFrame(rafId); rafId=null; } };
  const stopSim=stopTicker; // one shared loop now drives both phases

  fetch(url,{cache:'no-store'}).then(res=>{
    if(!res.ok) return res.json().catch(()=>null).then(j=>{ throw new Error((j&&j.error)?j.error:('Export failed (HTTP '+res.status+').')); });
    stopSim();
    const cd=res.headers.get('Content-Disposition')||'';
    const m=/filename="?([^";]+)"?/i.exec(cd);
    const filename=m?m[1]:(`export.${format==='pptx'?'pptx':format}`);
    const contentType=res.headers.get('Content-Type')||'';
    const total=parseInt(res.headers.get('Content-Length')||'0',10);
    // Some export paths (e.g. streamed CSV) don't send a Content-Length, or the browser
    // may not expose a readable stream — fall back to a simple blob() read in that case,
    // just letting the target sit just-short-of-done until the file is actually in hand.
    if(!total || !res.body || !res.body.getReader){
      targetPct=96;
      return res.blob().then(blob=>({blob,filename}));
    }
    const reader=res.body.getReader();
    const chunks=[];
    let received=0;
    const pump=()=>reader.read().then(({done,value})=>{
      if(done) return;
      chunks.push(value);
      received+=value.length;
      targetPct=90+Math.min(9,(received/total)*9);
      return pump();
    });
    return pump().then(()=>({blob:new Blob(chunks,{type:contentType}),filename}));
  }).then(({blob,filename})=>{
    stopTicker(); stopSim();
    displayedPct=100; targetPct=100;
    endProgress.setProgress(100,0);
    const dlUrl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=dlUrl; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(dlUrl),4000);
    endProgress();
    showToast('success','Export ready',filename+' has finished downloading.');
    if(window.SFX) SFX.play('success');
  }).catch(e=>{
    stopSim(); stopTicker();
    endProgress();
    showToast('error','Export failed',String(e.message||e));
    if(window.SFX) SFX.play('error');
  }).finally(()=>{ _exportBusy[format]=false; });
}

async function loadFilters(){
  const res = await fetch("/api/filters");
  const options = await res.json();
  window._filterOptionsCache = options;
  const container = document.getElementById("filters");
  container.innerHTML = `<div class="filter-toolbar"><div class="filter-toolbar-title">${qdIc('filter')}Dashboard Filters</div><div class="filter-actions"><span id="activeFilterBadge" class="active-filter-badge">0 Active</span><button id="compareModeBtn" class="reset-all" type="button">${qdIc('compare')}Compare Periods</button><button id="resetAllBtn" class="reset-all" type="button">${qdIc('reset')}Reset All</button></div></div>`;
  FILTER_DEFS.forEach(f => {
    const field = document.createElement("div"); field.className = "filter-field"; field.dataset.filterKey = f.key;
    const label = document.createElement("label"); label.textContent = f.label;
    const control = document.createElement("div"); control.className = "filter-control";
    const trigger = document.createElement("button"); trigger.type="button"; trigger.className="filter-trigger";
    const valueSpan = document.createElement("span"); valueSpan.textContent="All";
    trigger.appendChild(valueSpan); trigger.insertAdjacentHTML("beforeend",`<span class='chevron'>${qdIc('chevron-down')}</span>`);
    const menu = document.createElement("div"); menu.className="filter-menu";
    const search = document.createElement("input"); search.className="filter-search"; search.placeholder="Search options…"; search.type="text";
    const list = document.createElement("div"); list.className="filter-options";
    menu.appendChild(search); menu.appendChild(list); control.appendChild(trigger); control.appendChild(menu); field.appendChild(label); field.appendChild(control); container.appendChild(field);
    const raw = options[f.key] || ["All"];
    const items = raw.map(item => ({value:(item&&typeof item==='object')?item.value:item, label:(item&&typeof item==='object')?item.label:item}));
    if(!items.some(x=>x.value==="All")) items.unshift({value:"All",label:"All"});
    field._filterItems = items;
    const renderOptions = (term="") => {
      const q=term.trim().toLowerCase(); list.innerHTML="";
      const source=field._filterItems || items;
      const filtered=source.filter(x=>String(x.label).toLowerCase().includes(q));
      filtered.forEach((x)=>{
        const opt=document.createElement("div"); opt.dataset.value=x.value; opt.className="filter-option"+(x.value==="All"?" all-option":"")+(currentFilters[f.key]===x.value?" selected":"");
        opt.textContent=x.label;
        opt.addEventListener("click",()=>{
          currentFilters[f.key]=x.value; valueSpan.textContent=x.label; control.classList.remove("open"); search.value=""; renderOptions(); field.classList.toggle("filter-active", x.value!=="All"); updateActiveFilterBadge(); writeUrlState(false); triggerFilterRefresh(); refreshCascadeFilters();
        }); list.appendChild(opt);
      });
      if(!filtered.length) list.innerHTML='<div class="filter-empty">No matching options</div>';
    };
    field._filterRenderOptions = renderOptions;
    trigger.addEventListener("click",()=>{document.querySelectorAll('.filter-control.open').forEach(c=>{if(c!==control)c.classList.remove('open')}); control.classList.toggle('open'); if(control.classList.contains('open')){search.focus();renderOptions(search.value);}});
    search.addEventListener("input",()=>renderOptions(search.value));
    renderOptions();
    field.classList.toggle("filter-active", currentFilters[f.key]!=="All");
  });
  document.getElementById("resetAllBtn").addEventListener("click",()=>{FILTER_DEFS.forEach(f=>currentFilters[f.key]="All"); document.querySelectorAll('#filters .filter-control').forEach(c=>{c.classList.remove('open'); const s=c.querySelector('.filter-trigger span'); if(s)s.textContent='All';}); document.querySelectorAll('#filters .filter-field').forEach(f=>f.classList.remove('filter-active')); updateActiveFilterBadge(); writeUrlState(false); triggerFilterRefresh(); refreshCascadeFilters();});
  document.addEventListener("click", e=>{if(!e.target.closest('.filter-control')) document.querySelectorAll('.filter-control.open').forEach(c=>c.classList.remove('open'));});
  updateActiveFilterBadge();
}
function updateActiveFilterBadge(){
  const n=FILTER_DEFS.filter(f=>currentFilters[f.key] && currentFilters[f.key]!=="All").length;
  const b=document.getElementById('activeFilterBadge'); if(b){ b.textContent=`${n} Active`; b.classList.toggle('show',n>0); }
  const s=document.getElementById('statusActiveFilters'); if(s) s.textContent=String(n);
}

let _dataRevision = null;
let _dataRevisionTimer = null;
let _dataRevisionChecking = false;

async function fetchDataRevision(){
  const res = await fetch('/api/data_revision',{cache:'no-store'});
  if(!res.ok) throw new Error(`Revision check failed (HTTP ${res.status}).`);
  return res.json();
}

function _normaliseFilterItems(raw){
  const items=(raw||['All']).map(item => ({
    value:(item&&typeof item==='object')?String(item.value):String(item),
    label:(item&&typeof item==='object')?String(item.label):String(item)
  }));
  if(!items.some(x=>x.value==='All')) items.unshift({value:'All',label:'All'});
  return items;
}

// Fire-and-forget cascade refresh after any filter change. Errors are swallowed:
// this only narrows dropdown lists, so a transient failure should never block the
// actual data refresh (triggerFilterRefresh), which already has its own error handling.
function refreshCascadeFilters(){
  refreshFilterOptionsAfterDataChange(true).catch(()=>{});
}

let _cascadeSeq=0;
async function refreshFilterOptionsAfterDataChange(cascade=false){
  // Only the newest request may update the dropdowns: a slower, older response (scoped to a previous
  // selection) must never overwrite the lists or reset a value the user picked in the meantime.
  const mySeq=++_cascadeSeq;
  // cascade=true (called after the user changes a filter) scopes every OTHER
  // dropdown's options to what actually co-occurs with the current selection,
  // so picking Month=Jun then Quarter can't offer a Q2 that has zero overlap
  // with June -- the combination that used to silently show "0 coils".
  const qs = cascade ? ('?'+new URLSearchParams(currentFilters).toString()) : '';
  const res=await fetch('/api/filters'+qs,{cache:'no-store'});
  if(!res.ok) throw new Error(`Filter refresh failed (HTTP ${res.status}).`);
  const options=await res.json();
  if(mySeq!==_cascadeSeq) return false;
  window._filterOptionsCache=options;
  let selectionChanged=false;

  FILTER_DEFS.forEach(f=>{
    const items=_normaliseFilterItems(options[f.key]);
    const valid=new Set(items.map(x=>x.value));
    if(currentFilters[f.key]!=="All" && !valid.has(String(currentFilters[f.key]))){
      currentFilters[f.key]="All";
      selectionChanged=true;
    }
    const field=document.querySelector(`.filter-field[data-filter-key="${f.key}"]`);
    if(!field) return;
    field._filterItems=items;
    const search=field.querySelector('.filter-search');
    if(typeof field._filterRenderOptions==='function') field._filterRenderOptions(search?search.value:'');
    const span=field.querySelector('.filter-trigger span');
    const selected=items.find(x=>x.value===String(currentFilters[f.key]||'All')) || items[0] || {label:'All'};
    if(span) span.textContent=selected.label;
    field.classList.toggle('filter-active', currentFilters[f.key]!=="All");
  });

  updateActiveFilterBadge();
  if(selectionChanged) writeUrlState(false);
  window.dispatchEvent(new CustomEvent('qdash:data-revision-changed'));
  return selectionChanged;
}

async function checkDataRevision(){
  if(_dataRevisionChecking) return;
  _dataRevisionChecking=true;
  try{
    const state=await fetchDataRevision();
    if(state && state.available===false) return;
    const revision=Number(state?.revision);
    if(!Number.isFinite(revision)) return;
    if(_dataRevision===null){
      _dataRevision=revision;
      return;
    }
    if(revision===_dataRevision) return;
    const previous=_dataRevision;
    _dataRevision=revision;
    try{
      await refreshFilterOptionsAfterDataChange();
      showToast('info','Data updated','New or changed records are now reflected in this dashboard.');
      await triggerFilterRefresh();
    }catch(err){
      console.warn('Live data refresh failed',err);
      // Roll back only the observed marker so the next poll retries the refresh.
      _dataRevision=previous;
    }
  }catch(e){
    // Background freshness is best-effort; never surface polling noise to users.
  }finally{
    _dataRevisionChecking=false;
  }
}

async function startDataRevisionPolling(){
  if(_dataRevisionTimer) clearInterval(_dataRevisionTimer);
  try{
    const state=await fetchDataRevision();
    const revision=Number(state?.revision);
    if(Number.isFinite(revision)) _dataRevision=revision;
  }catch(e){}
  _dataRevisionTimer=setInterval(()=>{
    if(document.visibilityState==='visible') checkDataRevision();
  },30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible') checkDataRevision();
  });
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
  const filterBar=document.querySelector('.filters');
  if(filterBar){ filterBar.classList.remove('filter-pulse'); void filterBar.offsetWidth; filterBar.classList.add('filter-pulse'); }
  const t0=performance.now();
  try{await TAB_LOADERS[activeTab](signal); if(activeTab==='dashboard') prefetchQcrCore({...currentFilters}); finishTabLoad(activeTab);}catch(e){finishTabLoad(activeTab,e);}finally{
    const elapsed=performance.now()-t0; const wait=Math.max(0,250-elapsed);
    setTimeout(()=>{document.querySelectorAll('.kpi-card').forEach(c=>c.classList.remove('shimmering')); document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-refreshing');c.classList.add('chart-ready');setTimeout(()=>c.classList.remove('chart-ready'),700)}); if(page)page.classList.remove('dashboard-refreshing');},wait);
  }
}


