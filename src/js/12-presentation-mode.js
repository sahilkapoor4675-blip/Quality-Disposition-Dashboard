/* 12-presentation-mode.js — Analytics presentation (full-screen) mode. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------------------------------------------------------------------
// ANALYTICS PRESENTATION MODE
// Opens one analytics panel in a focused, fullscreen-style overlay without
// creating a second chart instance or making another API request. The real
// panel node is moved into the overlay and restored to the exact DOM position
// on close, so existing delegated drill-down handlers, ResizeObserver wiring,
// live data updates, filters and chart state remain intact.
let _analyticsPresentation = null;
let _analyticsPresentationState = null;

function ensureAnalyticsPresentation(){
  if(_analyticsPresentation) return _analyticsPresentation;
  const overlay=document.createElement('div');
  overlay.id='analyticsPresentation';
  overlay.className='analytics-presentation';
  overlay.hidden=true;
  overlay.innerHTML=`<div class="analytics-presentation-backdrop" data-presentation-close="1"></div>
    <section class="analytics-presentation-shell" role="dialog" aria-modal="true" aria-labelledby="analyticsPresentationTitle">
      <div class="analytics-presentation-toolbar">
        <div class="analytics-presentation-meta">
          <span class="analytics-presentation-kicker">${qdIc('maximize')}PRESENTATION MODE</span>
          <h2 id="analyticsPresentationTitle"></h2>
        </div>
        <button type="button" class="analytics-presentation-close" aria-label="Close presentation mode" title="Close presentation mode (Esc)">${qdIc('x')}</button>
      </div>
      <div class="analytics-presentation-stage" tabindex="-1"></div>
    </section>`;
  document.body.appendChild(overlay);
  const closeBtn=overlay.querySelector('.analytics-presentation-close');
  closeBtn.addEventListener('click',closeAnalyticsPresentation);
  overlay.addEventListener('click',e=>{ if(e.target.matches('[data-presentation-close]')) closeAnalyticsPresentation(); });
  // Keep keyboard focus inside the presentation overlay while it is open.
  overlay.addEventListener('keydown',e=>{
    if(e.key!=="Tab" || !_analyticsPresentationState) return;
    const focusables=[...overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=="hidden";
    });
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1], active=document.activeElement;
    if(e.shiftKey){
      if(active===first || !overlay.contains(active)){e.preventDefault();last.focus();}
    }else if(active===last){e.preventDefault();first.focus();}
  });
  _analyticsPresentation=overlay;
  return overlay;
}

function analyticsPanelTitle(panel){
  const heading=panel?.querySelector(':scope > h3');
  if(!heading) return 'Analytics';
  const clone=heading.cloneNode(true);
  clone.querySelector('.analytics-expand-btn')?.remove();
  return clone.textContent.trim() || 'Analytics';
}

function openAnalyticsPresentation(panel){
  if(!panel || _analyticsPresentationState) return;
  const overlay=ensureAnalyticsPresentation();
  const stage=overlay.querySelector('.analytics-presentation-stage');
  const title=overlay.querySelector('#analyticsPresentationTitle');
  const closeBtn=overlay.querySelector('.analytics-presentation-close');
  const parent=panel.parentNode;
  const placeholder=document.createComment('qdash-analytics-presentation-placeholder');
  const previousActive=document.activeElement;
  panel.parentNode.insertBefore(placeholder,panel);
  title.textContent=analyticsPanelTitle(panel);
  _analyticsPresentationState={panel,placeholder,parent,previousActive};
  panel.classList.add('analytics-presentation-panel');
  stage.appendChild(panel);
  document.documentElement.classList.add('analytics-presentation-open');
  document.body.classList.add('analytics-presentation-open');
  overlay.hidden=false;
  requestAnimationFrame(()=>{
    overlay.classList.add('is-open');
    closeBtn.focus({preventScroll:true});
    // Moving the real chart container changes its size: redraw every chart at the
    // presentation size and reshape it to fit the screen (no zooming out needed).
    fitPresentationCharts(panel);
  });
}

// Presentation fit: the chart's SVG is letterboxed (never cropped) inside the space left after the
// legend and table. To also FILL that space, redraw once with a canvas whose aspect ratio matches it.
function fitPresentationCharts(panel){
  if(!panel) return;
  panel.querySelectorAll('.chart-scroll').forEach(c=>{
    if(!c._qdRedraw) return;
    try{
      c._qdFit=1; c._qdRedraw();
      const svg=c.querySelector(':scope > .chart-svg');
      const vb=svg && svg.viewBox && svg.viewBox.baseVal;
      if(!vb || !vb.width || !vb.height || !svg.clientWidth || !svg.clientHeight) return;
      const fit=Math.max(0.55,Math.min(2.2,(vb.width/vb.height)/(svg.clientWidth/svg.clientHeight)));
      if(Math.abs(fit-1)<0.06) return;
      c._qdFit=fit; c._qdRedraw();
    }catch(err){ console.error('Presentation fit failed',err); }
  });
}
let _presFitTimer=null;
window.addEventListener('resize',()=>{
  if(!_analyticsPresentationState) return;
  clearTimeout(_presFitTimer);
  _presFitTimer=setTimeout(()=>{ if(_analyticsPresentationState) fitPresentationCharts(_analyticsPresentationState.panel); },220);
});

function closeAnalyticsPresentation(){
  const state=_analyticsPresentationState;
  if(!state) return;
  const overlay=_analyticsPresentation;
  const panel=state.panel;
  try{
    state.placeholder.parentNode?.insertBefore(panel,state.placeholder);
    state.placeholder.remove();
  }catch(e){
    try{state.parent.appendChild(panel);}catch(_e){}
  }
  panel.classList.remove('analytics-presentation-panel');
  panel.querySelectorAll('.chart-scroll').forEach(c=>{ c._qdFit=1; });
  _analyticsPresentationState=null;
  document.documentElement.classList.remove('analytics-presentation-open');
  document.body.classList.remove('analytics-presentation-open');
  overlay?.classList.remove('is-open');
  if(overlay){
    setTimeout(()=>{ if(!_analyticsPresentationState) overlay.hidden=true; },180);
  }
  requestAnimationFrame(()=>panel.querySelectorAll('.chart-scroll').forEach(c=>{ c._qdRedraw?.(); }));
  const restore=state.previousActive;
  if(restore && typeof restore.focus==='function' && document.contains(restore)){
    requestAnimationFrame(()=>restore.focus({preventScroll:true}));
  }
}

function wireAnalyticsPresentation(){
  if(wireAnalyticsPresentation._wired) return;
  wireAnalyticsPresentation._wired=true;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && _analyticsPresentationState){
      if(document.getElementById('drillModal')?.classList.contains('open')) return;
      e.preventDefault(); closeAnalyticsPresentation();
    }
  });
  document.querySelectorAll('.tab-panel .panel').forEach(panel=>{
    if(!panel.querySelector('.chart-scroll,.qcr-fishbone-diagram')) return;
    const heading=panel.querySelector(':scope > h3');
    if(!heading || heading.querySelector('.analytics-expand-btn')) return;
    heading.classList.add('analytics-panel-title');
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='analytics-expand-btn';
    btn.setAttribute('aria-label',`Open ${analyticsPanelTitle(panel)} in presentation mode`);
    btn.title='Open in presentation mode';
    btn.innerHTML=qdIc('maximize');
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openAnalyticsPresentation(panel);});
    heading.appendChild(btn);
  });
}

