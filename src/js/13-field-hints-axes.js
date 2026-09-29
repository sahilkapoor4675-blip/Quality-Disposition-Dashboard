/* 13-field-hints-axes.js — Field-name hints, offline banner, axis helpers. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------------------------------------------------------------------
// FIELD HINTS (V65.0)
// A small tag follows the mouse and names the field under it: KPI parts, table columns
// (+ row), filters, legends and icon-only buttons. Chart shapes keep their own tooltip
// (above). Toggle from Ctrl+K; the choice is remembered.
const FIELD_HINT_KEY='qdash_field_hints';
function fieldHintsOn(){ try{ return localStorage.getItem(FIELD_HINT_KEY)!=='off'; }catch(e){ return true; } }
function toggleFieldHints(){ const on=!fieldHintsOn(); try{ localStorage.setItem(FIELD_HINT_KEY,on?'on':'off'); }catch(e){} if(!on) hideFieldTag(); return on; }
let _fieldTagEl=null, _fieldTagTarget=null, _fieldTagTitleEl=null, _fieldTagRaf=0, _fieldTagXY=null;
function fieldTagEl(){
  if(!_fieldTagEl){
    _fieldTagEl=document.createElement('div');
    _fieldTagEl.className='qd-field-tag'; _fieldTagEl.setAttribute('role','tooltip');
    _fieldTagEl.innerHTML=qdIc('tag')+'<div class="qft-copy"><b class="qft-name"></b><small class="qft-meta"></small></div>';
    document.body.appendChild(_fieldTagEl);
  }
  return _fieldTagEl;
}
function _fhClean(s){ return String(s||'').replace(/[\u2191\u2193\u2195\u25B2\u25BC\u21C5]/g,'').replace(/\s+/g,' ').trim(); }
function _fhCell(table,idx){
  const rows=table.tHead&&table.tHead.rows.length?table.tHead.rows:table.rows;
  const r=rows[rows.length?(table.tHead&&table.tHead.rows.length?rows.length-1:0):0]; return r&&r.cells[idx]?_fhClean(r.cells[idx].textContent):'';
}
function resolveFieldInfo(t){
  if(!(t instanceof Element)) return null;
  // The intro/splash screen is presentation-only; field-name hover tags should not appear there.
  if(t.closest('#introScreen')) return null;
  if(t.closest('[data-tip],.qd-field-tag,.chart-tooltip,.analytics-presentation-backdrop')) return null;
  const ex=t.closest('[data-field]');
  if(ex) return {name:ex.getAttribute('data-field'),meta:ex.getAttribute('data-field-meta')||'Field'};
  const cell=t.closest('td,th');
  if(cell && cell.closest('table')){
    const table=cell.closest('table'); const idx=cell.cellIndex; const head=_fhCell(table,idx);
    if(cell.tagName==='TH') return head?{name:head,meta:'Table column'}:null;
    if(!head) return null;
    let rowLabel=''; for(const c of cell.parentElement.cells){ const h=_fhCell(table,c.cellIndex); const tx=_fhClean(c.textContent); if(c!==cell && tx && !/^(rank|#|sr\.?|s\.?no\.?)$/i.test(h) && !/^[\d.,%\s-]+$/.test(tx)){ rowLabel=tx; break; } }
    return {name:head,meta:rowLabel?('Row: '+(rowLabel.length>34?rowLabel.slice(0,33)+'…':rowLabel)):'Table value'};
  }
  const kpi=t.closest('.kpi-card');
  if(kpi){
    const name=_fhClean(kpi.querySelector('.label')&&kpi.querySelector('.label').textContent.replace(kpi.querySelector('.kpi-icon')?.textContent||'',''))||'KPI';
    if(t.closest('.kpi-status')) return {name:'Status vs target',meta:name};
    if(t.closest('.value')) return {name:name,meta:'Current value'};
    if(t.closest('.prev')) return {name:'Previous period value',meta:name};
    if(t.closest('.trend')) return {name:'Change vs previous period',meta:name};
    if(t.closest('.kpi-targets,.kpi-target,.kpi-target-item')) return {name:'Target thresholds',meta:name};
    return {name:name,meta:'KPI'};
  }
  const ff=t.closest('.filter-field');
  if(ff){ const lab=_fhClean(ff.querySelector('label')&&ff.querySelector('label').textContent).replace(/^\P{L}+/u,''); const opt=t.closest('.filter-option,.filter-options > *'); return {name:lab||'Filter',meta:opt?('Option: '+_fhClean(opt.textContent)):'Filter'}; }
  const li=t.closest('.legend-item'); if(li) return {name:_fhClean(li.textContent),meta:'Legend'};
  const ex2=t.closest('.qcr-exec-item'); if(ex2){ const sm=ex2.querySelector('small'); if(sm) return {name:_fhClean(sm.textContent),meta:'Summary'}; }

  // Generic field coverage: keep the hint working on controls/labels added later
  // without requiring every new element to be manually decorated with data-field.
  const formCtl=t.closest('input,select,textarea');
  if(formCtl){
    const id=formCtl.id;
    const lab=(id&&document.querySelector('label[for=\"'+CSS.escape(id)+'\"]'))||formCtl.closest('.field,.filter-field')?.querySelector('label');
    const nm=_fhClean(lab?.textContent||formCtl.getAttribute('aria-label')||formCtl.getAttribute('name')||formCtl.getAttribute('placeholder'));
    if(nm) return {name:nm,meta:formCtl.tagName==='SELECT'?'Dropdown':formCtl.tagName==='TEXTAREA'?'Text field':'Input'};
  }
  const tab=t.closest('.tab-btn'); if(tab){ const nm=_fhClean(tab.textContent); if(nm) return {name:nm,meta:'Dashboard section'}; }

  const ti=t.closest('[title],[aria-label]');
  if(ti && (ti.tagName==='BUTTON'||ti.hasAttribute('title')||ti.getAttribute('role')==='button') && !ti.closest('.cmdk-dialog')){
    const nm=_fhClean(ti.getAttribute('title')||ti.getAttribute('data-qd-title')||ti.getAttribute('aria-label')); if(nm) return {name:nm,meta:ti.tagName==='BUTTON'?'Button':'Info',_titleEl:ti.hasAttribute('title')?ti:null};
  }

  const action=t.closest('button,a,[role=\"button\"]');
  if(action && !action.closest('.cmdk-dialog')){
    const nm=_fhClean(action.getAttribute('data-field')||action.textContent);
    if(nm && nm.length<=80) return {name:nm,meta:action.tagName==='A'?'Link':'Button'};
  }

  const sectionTitle=t.closest('h1,h2,h3,h4,h5,h6');
  if(sectionTitle){ const nm=_fhClean(sectionTitle.textContent); if(nm) return {name:nm,meta:'Section'}; }

  const ui=t.closest('.stat,.quality-score,.result,.connection-box,.filebox,.shortcut-panel,.activity-event,.recovery-card,.command-card,.admin-kpi,.admin-prod-card,.prod-metrics > div,.integrity-grid > div,.issue,.wizard .step');
  if(ui){
    const own=_fhClean(ui.getAttribute('data-field')||ui.querySelector('.label,.prod-head b,.prod-metrics span,.integrity-grid span,.activity-main b,.command-card b,.recovery-card b')?.textContent||ui.textContent);
    if(own){ const clipped=own.length>70?own.slice(0,69)+'…':own; return {name:clipped,meta:'Field'}; }
  }
  return null;
}
function hideFieldTag(){
  if(_fieldTagEl) _fieldTagEl.classList.remove('show');
  if(_fieldTagTitleEl){ const v=_fieldTagTitleEl.getAttribute('data-qd-title'); if(v!==null){ _fieldTagTitleEl.setAttribute('title',v); _fieldTagTitleEl.removeAttribute('data-qd-title'); } _fieldTagTitleEl=null; }
  _fieldTagTarget=null;
}
function placeFieldTag(x,y){
  const el=fieldTagEl(); const r=el.getBoundingClientRect(); let L=x+14,T=y+20;
  if(L+r.width>innerWidth-8) L=x-r.width-12; if(T+r.height>innerHeight-8) T=y-r.height-14;
  el.style.transform='translate3d('+Math.max(6,L)+'px,'+Math.max(6,T)+'px,0)';
}
// Shows/hides the "You're offline" banner using the browser's online/offline
// events. Purely a UI signal — the service worker (sw.js) is what actually
// keeps the last-loaded dashboard data visible while offline; this just
// tells the person why numbers may be stale.
function initOfflineBanner(){
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const update = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function initFieldHints(){
  if(initFieldHints._wired) return; initFieldHints._wired=true;
  if(!window.matchMedia('(pointer: fine)').matches) return;
  document.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse' || !fieldHintsOn()) return;
    _fieldTagXY=[e.clientX,e.clientY];
    if(_fieldTagRaf) return;
    _fieldTagRaf=requestAnimationFrame(()=>{
      _fieldTagRaf=0; const [x,y]=_fieldTagXY; const tg=e.target;
      if(tg!==_fieldTagTarget){
        hideFieldTag(); _fieldTagTarget=tg; const info=resolveFieldInfo(tg);
        if(!info){ return; }
        if(info._titleEl){ _fieldTagTitleEl=info._titleEl; info._titleEl.setAttribute('data-qd-title',info._titleEl.getAttribute('title')); info._titleEl.removeAttribute('title'); }
        const el=fieldTagEl(); el.querySelector('.qft-name').textContent=info.name; el.querySelector('.qft-meta').textContent=info.meta||''; el.classList.add('show');
      }
      if(_fieldTagEl && _fieldTagEl.classList.contains('show')) placeFieldTag(x,y);
    });
  },{passive:true});
  document.addEventListener('pointerleave',hideFieldTag,true);
  document.documentElement.addEventListener('mouseleave',hideFieldTag);
  window.addEventListener('scroll',hideFieldTag,{passive:true,capture:true});
  document.addEventListener('pointerdown',hideFieldTag,true);
}

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
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}
// X-axis title for VERTICAL charts (centered, placed at bottom)
function xAxisTitleV(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle">${text}</text>`;
}
// X-axis title (value axis) for HORIZONTAL bar charts (centered, at bottom)
function xAxisTitleH(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle">${text}</text>`;
}
// Y-axis title (category axis) for HORIZONTAL bar charts (rotated, far left)
function yAxisTitleH(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}

