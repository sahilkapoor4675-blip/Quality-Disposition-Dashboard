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
// Saved views exist in two scopes that share the same code: 'dash' (the dashboard filters) and 'chem' (the Chemistry SPC filters, which
// have their own bar and their own list of presets, because the two filter sets mean different things). Every function takes the scope
// as its LAST argument and defaults to 'dash', so the original call sites (and button handlers that pass an Event) keep working.
const SV_SCOPES={
  dash:{store:'qdash_saved_views',sel:'savedViewSelect',pop:'viewPopover',btns:'#saveViewBtn,#clearViewsBtn',ph:'e.g. This Month + Work Center A + PRIME',title:'Save current filters as…',list:'Saved filter presets',
        snapshot:()=>Object.assign({},currentFilters), apply:(v)=>{ Object.assign(currentFilters,v); syncFilterUiFromState(); writeUrlState(false); triggerFilterRefresh(); refreshCascadeFilters(); }},
  chem:{store:'qdash_chem_saved_views',sel:'chemSavedViewSelect',pop:'chemViewPopover',btns:'#chemSaveViewBtn,#chemClearViewsBtn',ph:'e.g. Brass May-2026 Cu',title:'Save current Chemistry filters as…',list:'Saved Chemistry presets',
        snapshot:()=>(typeof chemSelSnapshot==='function'?chemSelSnapshot():{}), apply:(v)=>{ if(typeof chemApplyView==='function') chemApplyView(v); }},
};
function _svScope(scope){ return SV_SCOPES[scope==='chem'?'chem':'dash']; }
function savedViews(scope){const sc=_svScope(scope); try{return JSON.parse(localStorage.getItem(sc.store)||'{}')}catch(e){return {}}}
function _svStore(scope,views){ try{ localStorage.setItem(_svScope(scope).store,JSON.stringify(views)); }catch(e){} }
function renderSavedViews(scope){const sc=_svScope(scope); const sel=document.getElementById(sc.sel); if(!sel)return; const views=savedViews(scope); sel.innerHTML='<option value="">Saved Views</option>'+Object.keys(views).sort().map(n=>`<option value="${escQcr(n)}">${escQcr(n)}</option>`).join('');}
function saveCurrentView(scope){
  // Replaces the old window.prompt() flow with an inline, named-preset
  // popover: type a name, hit Save — no browser dialog.
  const sc=_svScope(scope), sk=sc===SV_SCOPES.chem?'chem':'dash';
  const pop=document.getElementById(sc.pop); if(!pop) return;
  const ids=sk==='chem'?{inp:'chemViewPopSaveName',cancel:'chemViewPopCancelBtn',save:'chemViewPopSaveBtn'}:{inp:'viewPopSaveName',cancel:'viewPopCancelBtn',save:'viewPopSaveBtn'};
  pop.innerHTML=`<div class="view-pop-title">${qdIc('bookmark-plus')}${sc.title}</div><input type="text" id="${ids.inp}" maxlength="60" placeholder="${escQcr(sc.ph)}"><div class="view-pop-actions"><button class="btn" id="${ids.cancel}" type="button">Cancel</button><button class="btn primary" id="${ids.save}" type="button">${qdIc('bookmark-plus')}Save Preset</button></div>`;
  pop.classList.remove('hidden');
  const input=document.getElementById(ids.inp); input.focus();
  function doSave(){
    const name=input.value.trim(); if(!name) { input.focus(); return; }
    const views=savedViews(sk); views[name]=sc.snapshot();
    _svStore(sk,views);
    renderSavedViews(sk); const sel=document.getElementById(sc.sel); if(sel) sel.value=name; closeViewPopover();
  }
  document.getElementById(ids.save).onclick=doSave;
  document.getElementById(ids.cancel).onclick=closeViewPopover;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSave(); } else if(e.key==='Escape'){ closeViewPopover(); } });
}
function closeViewPopover(){ Object.keys(SV_SCOPES).forEach(k=>document.getElementById(SV_SCOPES[k].pop)?.classList.add('hidden')); }
function renderManagePresetsList(scope){
  const sc=_svScope(scope), sk=sc===SV_SCOPES.chem?'chem':'dash';
  const pop=document.getElementById(sc.pop); if(!pop) return;
  const views=savedViews(sk); const names=Object.keys(views).sort();
  const listHtml = names.length
    ? `<div class="view-pop-list">${names.map(n=>`<div class="view-pop-row" data-name="${escQcr(n)}"><span class="view-pop-name">${escQcr(n)}</span><button class="view-pop-load" type="button" title="Load this preset">Load</button><button class="view-pop-del" type="button" title="Delete this preset">🗑</button></div>`).join('')}</div>`
    : `<div class="view-pop-empty">No saved presets yet — use “Save Preset” to name your current filter combination.</div>`;
  const closeId=sk==='chem'?'chemViewPopCloseBtn':'viewPopCloseBtn';
  pop.innerHTML=`<div class="view-pop-title">${qdIc('list-edit')}${sc.list}</div>${listHtml}<div class="view-pop-actions"><button class="btn" id="${closeId}" type="button">Close</button></div>`;
  pop.classList.remove('hidden');
  pop.querySelectorAll('.view-pop-load').forEach(b=>b.addEventListener('click',e=>{
    const name=e.target.closest('.view-pop-row').dataset.name;
    applySavedView(name,sk); const sel=document.getElementById(sc.sel); if(sel) sel.value=name;
    closeViewPopover();
  }));
  pop.querySelectorAll('.view-pop-del').forEach(b=>b.addEventListener('click',e=>{
    const row=e.target.closest('.view-pop-row'); const name=row.dataset.name;
    const v=savedViews(sk); delete v[name];
    _svStore(sk,v);
    renderSavedViews(sk); renderManagePresetsList(sk);
  }));
  document.getElementById(closeId).onclick=closeViewPopover;
}
function manageSavedViews(scope){ renderManagePresetsList(scope); }
document.addEventListener('click',e=>{
  Object.keys(SV_SCOPES).forEach(k=>{
    const sc=SV_SCOPES[k], pop=document.getElementById(sc.pop); if(!pop || pop.classList.contains('hidden')) return;
    // composedPath() is read at dispatch time, so a click on a button the popover just re-rendered (e.g. the 🗑 of a preset) still counts as inside it
    if(pop.contains(e.target) || e.composedPath().includes(pop) || e.target.closest(sc.btns)) return;
    pop.classList.add('hidden');
  });
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeViewPopover(); });
// ---- URL state: the current tab and every non-"All" filter are reflected
// in the address bar (?tab=...&work_center=...; on the Chemistry tab also ?chem_spec=...&chem_param=...), so the browser's own
// back/forward buttons work between tabs/filter changes, and a person can
// bookmark or paste a link to a colleague that opens straight into the
// exact view they were looking at. Filter tweaks use replaceState (one
// URL update, no extra back-button stop per click); switching tabs uses
// pushState (each tab is a distinct "page" worth a back-button stop).
const TAB_KEYS=['dashboard','controlroom','wcgrade','defects','weekly','chem'];
function readUrlState(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab');
  const filters={};
  FILTER_DEFS.forEach(f=>{ const v=params.get(f.key); if(v) filters[f.key]=v; });
  // Chemistry SPC selection (chem_spec / chem_param / chem_month / ...): null when the link carries none.
  const chem=(typeof chemReadUrl==='function')?chemReadUrl(params):null;
  return { tab: TAB_KEYS.includes(tab)?tab:null, filters, chem };
}
function writeUrlState(push){
  const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
  const params=new URLSearchParams();
  if(tab!=='dashboard') params.set('tab',tab);
  FILTER_DEFS.forEach(f=>{ if(currentFilters[f.key] && currentFilters[f.key]!=='All') params.set(f.key,currentFilters[f.key]); });
  // The Chemistry tab's own filters travel in the link too (only while that tab is open), so a Chemistry view can be shared like a dashboard view.
  const onChem=tab==='chem' && typeof chemWriteUrl==='function';
  if(onChem) chemWriteUrl(params);
  const qs=params.toString(), url=location.pathname+(qs?('?'+qs):'');
  const state={tab,filters:Object.assign({},currentFilters),chem:onChem&&typeof chemSelSnapshot==='function'?chemSelSnapshot():null};
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
    if(!field.dataset.filterKey) return;   // Chemistry SPC dropdowns (data-chem-key) are managed by 21-chem-spc.js
    const key=field.dataset.filterKey, val=currentFilters[key]||'All';
    const span=field.querySelector('.filter-trigger span');
    if(span){ const opts=[...field.querySelectorAll('.filter-option')]; const match=opts.find(o=>o.dataset.value===val); span.textContent=match?match.textContent:val; }
    field.classList.toggle('filter-active', val!=='All');
  });
  updateActiveFilterBadge();
}
function applySavedView(name,scope){const sc=_svScope(scope); const views=savedViews(scope); if(!name||!views[name])return; sc.apply(views[name]);}
