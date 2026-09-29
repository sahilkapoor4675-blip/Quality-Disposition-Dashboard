/* 09-saved-views-url-state.js — Saved views, URL state, filter summary. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
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
function renderSavedViews(){const sel=document.getElementById('savedViewSelect'); if(!sel)return; const views=savedViews(); sel.innerHTML='<option value="">Saved Views</option>'+Object.keys(views).sort().map(n=>`<option value="${escQcr(n)}">${escQcr(n)}</option>`).join('');}
function saveCurrentView(){
  // Replaces the old window.prompt() flow with an inline, named-preset
  // popover: type a name, hit Save — no browser dialog.
  const pop=document.getElementById('viewPopover'); if(!pop) return;
  pop.innerHTML=`<div class="view-pop-title">${qdIc('bookmark-plus')}Save current filters as…</div><input type="text" id="viewPopSaveName" maxlength="60" placeholder="e.g. This Month + Work Center A + PRIME"><div class="view-pop-actions"><button class="btn" id="viewPopCancelBtn" type="button">Cancel</button><button class="btn primary" id="viewPopSaveBtn" type="button">${qdIc('bookmark-plus')}Save Preset</button></div>`;
  pop.classList.remove('hidden');
  const input=document.getElementById('viewPopSaveName'); input.focus();
  function doSave(){
    const name=input.value.trim(); if(!name) { input.focus(); return; }
    const views=savedViews(); views[name]=Object.assign({},currentFilters);
    try{ localStorage.setItem('qdash_saved_views',JSON.stringify(views)); }catch(e){}
    renderSavedViews(); document.getElementById('savedViewSelect').value=name; closeViewPopover();
  }
  document.getElementById('viewPopSaveBtn').onclick=doSave;
  document.getElementById('viewPopCancelBtn').onclick=closeViewPopover;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSave(); } else if(e.key==='Escape'){ closeViewPopover(); } });
}
function closeViewPopover(){ document.getElementById('viewPopover')?.classList.add('hidden'); }
function renderManagePresetsList(){
  const pop=document.getElementById('viewPopover'); if(!pop) return;
  const views=savedViews(); const names=Object.keys(views).sort();
  const listHtml = names.length
    ? `<div class="view-pop-list">${names.map(n=>`<div class="view-pop-row" data-name="${escQcr(n)}"><span class="view-pop-name">${escQcr(n)}</span><button class="view-pop-load" type="button" title="Load this preset">Load</button><button class="view-pop-del" type="button" title="Delete this preset">🗑</button></div>`).join('')}</div>`
    : `<div class="view-pop-empty">No saved presets yet — use “Save Preset” to name your current filter combination.</div>`;
  pop.innerHTML=`<div class="view-pop-title">${qdIc('list-edit')}Saved filter presets</div>${listHtml}<div class="view-pop-actions"><button class="btn" id="viewPopCloseBtn" type="button">Close</button></div>`;
  pop.classList.remove('hidden');
  pop.querySelectorAll('.view-pop-load').forEach(b=>b.addEventListener('click',e=>{
    const name=e.target.closest('.view-pop-row').dataset.name;
    applySavedView(name); const sel=document.getElementById('savedViewSelect'); if(sel) sel.value=name;
    closeViewPopover();
  }));
  pop.querySelectorAll('.view-pop-del').forEach(b=>b.addEventListener('click',e=>{
    const row=e.target.closest('.view-pop-row'); const name=row.dataset.name;
    const v=savedViews(); delete v[name];
    try{ localStorage.setItem('qdash_saved_views',JSON.stringify(v)); }catch(err){}
    renderSavedViews(); renderManagePresetsList();
  }));
  document.getElementById('viewPopCloseBtn').onclick=closeViewPopover;
}
function manageSavedViews(){ renderManagePresetsList(); }
document.addEventListener('click',e=>{
  const pop=document.getElementById('viewPopover'); if(!pop || pop.classList.contains('hidden')) return;
  if(pop.contains(e.target) || e.target.closest('#saveViewBtn,#clearViewsBtn')) return;
  closeViewPopover();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeViewPopover(); });
// ---- URL state: the current tab and every non-"All" filter are reflected
// in the address bar (?tab=...&work_center=...), so the browser's own
// back/forward buttons work between tabs/filter changes, and a person can
// bookmark or paste a link to a colleague that opens straight into the
// exact view they were looking at. Filter tweaks use replaceState (one
// URL update, no extra back-button stop per click); switching tabs uses
// pushState (each tab is a distinct "page" worth a back-button stop).
const TAB_KEYS=['dashboard','controlroom','wcgrade','defects','weekly'];
function readUrlState(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab');
  const filters={};
  FILTER_DEFS.forEach(f=>{ const v=params.get(f.key); if(v) filters[f.key]=v; });
  return { tab: TAB_KEYS.includes(tab)?tab:null, filters };
}
function writeUrlState(push){
  const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
  const params=new URLSearchParams();
  if(tab!=='dashboard') params.set('tab',tab);
  FILTER_DEFS.forEach(f=>{ if(currentFilters[f.key] && currentFilters[f.key]!=='All') params.set(f.key,currentFilters[f.key]); });
  const qs=params.toString(), url=location.pathname+(qs?('?'+qs):'');
  const state={tab,filters:Object.assign({},currentFilters)};
  if(push) history.pushState(state,'',url); else history.replaceState(state,'',url);
}
// Syncs the filter dropdown UI (trigger label text + the "active" pill
// styling) to whatever is currently in currentFilters. Used whenever
// currentFilters is changed from somewhere other than a direct dropdown
// click — restoring from the URL on load, the back/forward buttons, and
// applying a saved view all funnel through here instead of duplicating
// this DOM-sync logic three times.
function syncFilterUiFromState(){
  document.querySelectorAll('.filter-field').forEach(field=>{
    const key=field.dataset.filterKey, val=currentFilters[key]||'All';
    const span=field.querySelector('.filter-trigger span');
    if(span){ const opts=[...field.querySelectorAll('.filter-option')]; const match=opts.find(o=>o.dataset.value===val); span.textContent=match?match.textContent:val; }
    field.classList.toggle('filter-active', val!=='All');
  });
  updateActiveFilterBadge();
}
function applySavedView(name){const views=savedViews(); if(!name||!views[name])return; Object.assign(currentFilters,views[name]); syncFilterUiFromState(); writeUrlState(false); triggerFilterRefresh(); refreshCascadeFilters();}
