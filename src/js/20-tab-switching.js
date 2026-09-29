/* 20-tab-switching.js — QCR layout, tab switching, tab errors, skeletons. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------- QCR stable layout ----------
// QCR uses native CSS grid only. No JS card positioning is used; this keeps
// the tab responsive and prevents ResizeObserver/layout feedback loops.
function scheduleQcrLayout(){ return; }

// ---------- Tab switching ----------
const TAB_LOADERS = {
  dashboard: loadKpis,
  controlroom: loadControlRoom,
  wcgrade: loadWcGrade,
  defects: loadDefectAnalysis,
  weekly: loadPeriodTrend,
};

// Switching tabs must always start the new tab from the top. Without this the previous
// tab's scroll offset carried over (the page is one long scroller shared by every panel).
// The browser's own back/forward scroll restoration is switched off too, otherwise it
// re-applies the old offset right after our popstate handler has scrolled to the top.
try{ if('scrollRestoration' in history) history.scrollRestoration='manual'; }catch(e){}
function resetPageScroll(){
  const de=document.documentElement, prev=de.style.scrollBehavior;
  de.style.scrollBehavior='auto';                      // no smooth-scroll animation: jump straight to the top
  try{ window.scrollTo(0,0); }catch(e){}
  de.scrollTop=0; if(document.body) document.body.scrollTop=0;
  de.style.scrollBehavior=prev;
}
async function activateTab(tabName, fromHistory, opts){
  if(_analyticsPresentationState) closeAnalyticsPresentation();
  fetch("/api/activity/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"tab_open",tab:tabName,filters:currentFilters})}).catch(()=>{});
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + tabName));
  if(!(opts && opts.keepScroll)) resetPageScroll();
  showSkeletons(tabName);
  if(!fromHistory) writeUrlState(true); // fromHistory=true means popstate already changed the URL; don't push again
  try { await TAB_LOADERS[tabName](signal); if(tabName==='controlroom') scheduleQcrLayout(); finishTabLoad(tabName); } catch(e) { finishTabLoad(tabName, e); }
}
// Skeleton loaders: a shimmering placeholder shaped like a chart/table shows
// immediately when a tab becomes visible, replaced automatically the moment
// its real content is rendered (every chart/table function overwrites the
// container's innerHTML, so there's nothing to explicitly tear down here).
// Only fills containers that are genuinely empty — a filter-triggered
// refresh of an already-loaded tab keeps its existing dim/fade treatment
// (see triggerFilterRefresh) instead of flashing back to a skeleton.
// Error state for a tab whose data could not be loaded. Without this the shimmering placeholders
// above stayed on screen forever ("loading forever") while the real error only went to the console.
function clearTabError(tabName){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  panel.querySelector(':scope > .tab-load-error')?.remove();
}
function showTabError(tabName, err){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  const raw=(err&&err.message)?String(err.message):'';
  const msg=raw && !/^(Unexpected token|JSON|Failed to fetch|NetworkError|Load failed)/i.test(raw) ? raw : 'The server did not respond correctly. Check your connection and try again.';
  panel.querySelectorAll('.skeleton-chart').forEach(el=>{ el.outerHTML='<div class="load-error-inline">⚠️ Chart unavailable</div>'; });
  panel.querySelectorAll('.table-scroll tbody').forEach(tb=>{
    if(tb.querySelector('.skeleton-row')){
      const cols=tb.closest('table')?.querySelectorAll('thead th').length||6;
      tb.innerHTML=`<tr class="load-error-row"><td colspan="${cols}">⚠️ Table unavailable</td></tr>`;
    }
  });
  let b=panel.querySelector(':scope > .tab-load-error');
  if(!b){ b=document.createElement('div'); b.className='tab-load-error'; b.setAttribute('role','alert'); panel.prepend(b); }
  b.innerHTML=`<span>⚠️ <b>Couldn't load this view.</b> ${escQcr(msg)}</span><button type="button" class="tab-retry-btn">↻ Retry</button>`;
  b.querySelector('.tab-retry-btn').addEventListener('click',()=>{
    b.remove();
    panel.querySelectorAll('.load-error-inline').forEach(el=>{ el.parentElement && (el.parentElement.innerHTML=''); });
    panel.querySelectorAll('tbody .load-error-row').forEach(tr=>{ tr.closest('tbody').innerHTML=''; });
    activateTab(tabName, true, {keepScroll:true});
  });
}
// Called after every tab load attempt: shows the error state on failure, and also when a loader
// "succeeded" but left placeholders behind (nothing was ever rendered).
function finishTabLoad(tabName, err){
  if(err && err.name==='AbortError') return;
  if(err){ console.error(err); showTabError(tabName, err); return; }
  const panel=document.getElementById('tab-'+tabName);
  if(panel && panel.querySelector('.skeleton-chart,.skeleton-row')) showTabError(tabName, new Error('No data was returned for this view.'));
  else { clearTabError(tabName); setRefreshed(); }
}
const SKELETON_BAR_HEIGHTS=[58,88,42,96,68,52,80,64];
function showSkeletons(tabName){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  panel.querySelectorAll('.chart-scroll').forEach(c=>{
    if(!c.children.length) c.innerHTML=`<div class="skeleton-chart">${SKELETON_BAR_HEIGHTS.map(h=>`<div class="skeleton-bar" style="height:${h}%"></div>`).join('')}</div>`;
  });
  panel.querySelectorAll('.table-scroll tbody').forEach(tb=>{
    if(!tb.children.length){
      const cols=tb.closest('table')?.querySelectorAll('thead th').length||6;
      tb.innerHTML=Array.from({length:5}).map(()=>`<tr class="skeleton-row"><td colspan="${cols}"><div class="skeleton-line" style="width:${60+Math.random()*35|0}%"></div></td></tr>`).join('');
    }
  });
}
// Back/forward buttons: restore whichever tab+filters that history entry
// represents. history.state carries the exact filters we pushed; a manually
// edited/shared URL (no state, e.g. after a fresh navigation) falls back to
// re-parsing the query string.
window.addEventListener('popstate', (e)=>{
  const restored = e.state || readUrlState();
  const filters = restored.filters || {};
  FILTER_DEFS.forEach(f=>{ currentFilters[f.key] = filters[f.key] || "All"; });
  syncFilterUiFromState();
  refreshCascadeFilters();
  activateTab(restored.tab || 'dashboard', true);
});

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  activateTab(btn.dataset.tab);
});

const VISITOR_ID_KEY = "qdash_visitor_id_v1";
