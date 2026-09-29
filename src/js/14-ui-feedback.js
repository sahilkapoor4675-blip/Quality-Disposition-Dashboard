/* 14-ui-feedback.js — Empty/loading states, top loading bar, toasts, ripple. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// Friendly empty-state markup shared by every chart and the drill-down
// modal, instead of a bare line of text. `sub` is optional supporting text
// (e.g. a hint to widen the filter); an inline SVG icon keeps this
// dependency-free and themeable via currentColor.
// ---- Empty / error / success placeholder states, used anywhere a panel has
// nothing to show (no data, a defect not mapped, a load failure, etc). One
// consistent icon+title(+sub) layout with a kind-based icon/colour so every
// such message reads the same way instead of each spot being plain text:
//   'empty'   (default) — neutral, nothing to show right now
//   'error'   — something failed to load; ⚠ the reader should know why
//   'success' — an explicitly good "nothing wrong found" result
// opts.rawTitle/opts.rawSub let a caller pass pre-built HTML (e.g. a <b> name
// or a nested <span>) instead of having it escaped, for the couple of call
// sites that need inline markup inside the message.
const EMPTY_STATE_ICONS={
  empty:'<svg class="empty-state-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 5"/><path d="M20 40 L28 30 L36 35 L44 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="44" cy="22" r="2.8" fill="currentColor"/><circle cx="36" cy="35" r="2.8" fill="currentColor"/><circle cx="28" cy="30" r="2.8" fill="currentColor"/><circle cx="20" cy="40" r="2.8" fill="currentColor"/></svg>',
  error:'<svg class="empty-state-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 9 L59 55 L5 55 Z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><path d="M32 26 L32 39" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="46.5" r="2.7" fill="currentColor"/></svg>',
  success:'<svg class="empty-state-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" stroke="currentColor" stroke-width="2.5"/><path d="M20 33 L28 41 L45 23" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
function emptyStateMarkup(title, sub, kind, opts){
  kind = EMPTY_STATE_ICONS[kind] ? kind : 'empty';
  opts = opts||{};
  const titleHtml = opts.rawTitle ? title : escQcr(title);
  const subHtml = sub ? (opts.rawSub ? sub : escQcr(sub)) : '';
  return `<div class="empty-state empty-state-${kind}">${EMPTY_STATE_ICONS[kind]}<div class="empty-state-title">${titleHtml}</div>${subHtml?`<div class="empty-state-sub">${subHtml}</div>`:''}</div>`;
}
// A loading placeholder for spots that used to just show plain "Loading…"
// text — now a couple of shimmering skeleton lines (reusing the same
// .skeleton-line shimmer as the chart/table skeletons) plus a caption, so a
// text-only loading state gets the same shimmer treatment as the rest of the
// app instead of sitting there static.
function loadingStateMarkup(caption){
  return `<div class="empty-state empty-state-loading"><div class="loading-skel-lines" aria-hidden="true"><div class="skeleton-line" style="width:78%"></div><div class="skeleton-line" style="width:56%"></div><div class="skeleton-line" style="width:40%"></div></div><div class="empty-state-sub">${escQcr(caption||'Loading…')}</div></div>`;
}

// ---- Global top-of-page loading bar: a thin YouTube-style strip that fills
// in while dashboard data is loading (filter change, tab switch, initial
// load) and sweeps to 100% + fades out once every in-flight request settles.
// Implemented as a fetch() wrapper so every current and future data loader
// (loadKpis, loadFilters, fetchQcrCore, drilldown, fishbone, root_cause,
// qcr_target_history, kpi_targets, ...) is covered automatically without
// each call site having to remember to start/stop it. Background polling
// (heartbeat/live-user pings, the silent data-revision check) and the
// export flow (which already drives its own detailed progress toast, see
// runExport above) are excluded so the bar only appears for the kind of
// load that actually blocks what's on screen.
(function(){
  const EXCLUDE=[/\/api\/activity\//,/\/api\/data_revision/,/\/api\/export\//];
  let active=0,bar,fillEl,hideTimer,trickleTimer,pct=0;
  function ensureBar(){
    if(bar) return bar;
    bar=document.createElement('div'); bar.className='page-progress-bar';
    fillEl=document.createElement('div'); fillEl.className='page-progress-fill';
    bar.appendChild(fillEl); document.body.appendChild(bar);
    return bar;
  }
  function setPct(p,animated){
    pct=p; if(!fillEl) return;
    fillEl.style.transition=animated===false?'none':'width .3s ease';
    fillEl.style.width=p+'%';
  }
  function start(){
    active++; if(active>1) return;
    ensureBar(); clearTimeout(hideTimer); clearInterval(trickleTimer);
    bar.classList.remove('done'); void bar.offsetWidth; bar.classList.add('visible');
    setPct(0,false); requestAnimationFrame(()=>setPct(20));
    trickleTimer=setInterval(()=>{ setPct(Math.min(88,pct+(88-pct)*0.15)); },350);
  }
  function done(){
    active=Math.max(0,active-1); if(active>0) return;
    clearInterval(trickleTimer); if(!bar) return;
    setPct(100);
    hideTimer=setTimeout(()=>{
      bar.classList.remove('visible');
      setTimeout(()=>setPct(0,false),200);
    },200);
  }
  const origFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const track=url.indexOf('/api/')!==-1 && !EXCLUDE.some(re=>re.test(url));
    if(track) start();
    const p=origFetch(input,init);
    if(track) p.then(done,done);
    return p;
  };
})();

// ---- Toast notifications: a visual, top-right sliding confirmation for
// success/error/info, so people who keep sound muted (see sfx.js) still get
// a clear confirmation an action finished — sound and toast are independent
// of each other, neither depends on the other being on. ----
function ensureToastHost(){
  let host=document.getElementById('toastHost');
  if(!host){ host=document.createElement('div'); host.id='toastHost'; host.className='toast-host'; host.setAttribute('aria-live','polite'); host.setAttribute('role','status'); document.body.appendChild(host); }
  return host;
}
function showToast(kind,title,message,opts={}){
  const host=ensureToastHost();
  const el=document.createElement('div');
  el.className='toast toast-'+(kind||'info')+(opts.progress?' toast-has-progress':'');
  const icon=kind==='success'?'✅':kind==='error'?'⚠️':'ℹ️';
  const progressMarkup=opts.progress?'<div class="toast-progress-row"><div class="toast-progress-track"><div class="toast-progress-fill"></div></div><div class="toast-progress-meta"><span class="toast-progress-pct">0%</span><span class="toast-progress-eta">Calculating…</span></div></div>':'';
  el.innerHTML=`<span class="toast-icon" aria-hidden="true">${icon}</span><div class="toast-body"><div class="toast-title"></div><div class="toast-msg"></div>${progressMarkup}</div><button class="toast-close" type="button" aria-label="Dismiss notification">✕</button>`;
  el.querySelector('.toast-title').textContent=title||'';
  const msgEl=el.querySelector('.toast-msg');
  if(message) msgEl.textContent=message; else msgEl.remove();
  host.appendChild(el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
  const dur=opts.duration||(kind==='error'?6500:4200);
  let dismissed=false;
  const dismiss=()=>{ if(dismissed)return; dismissed=true; el.classList.remove('show'); el.classList.add('hide'); setTimeout(()=>el.remove(),260); };
  el._dismiss=dismiss;
  // Cap how many toasts can be stacked/visible at once — if a burst of calls fires in quick
  // succession (bulk export, multiple failed rows, etc.) the oldest ones are dismissed early
  // instead of silently piling up the whole screen height.
  const MAX_VISIBLE_TOASTS=4;
  const active=[...host.children].filter(c=>c!==el&&!c.classList.contains('hide'));
  if(active.length>=MAX_VISIBLE_TOASTS){ active.slice(0,active.length-MAX_VISIBLE_TOASTS+1).forEach(old=>{ if(old._dismiss) old._dismiss(); }); }
  const timer=setTimeout(dismiss,dur);
  el.querySelector('.toast-close').addEventListener('click',()=>{clearTimeout(timer);dismiss();});
  const endFn=()=>{clearTimeout(timer);dismiss();};
  // Progress-enabled toasts (currently just the export flow) get a .setProgress(pct, etaSeconds)
  // method attached to the same function the caller already holds for dismissing — no new
  // return shape, so every existing showToast() call site is unaffected.
  if(opts.progress){
    const fill=el.querySelector('.toast-progress-fill');
    const pctEl=el.querySelector('.toast-progress-pct');
    const etaEl=el.querySelector('.toast-progress-eta');
    endFn.setProgress=(pct,etaSeconds)=>{
      const p=Math.max(0,Math.min(100,Math.round(pct)));
      if(fill) fill.style.width=p+'%';
      if(pctEl) pctEl.textContent=p+'%';
      if(etaEl){
        if(p>=100) etaEl.textContent='Done';
        else if(etaSeconds==null) etaEl.textContent='Calculating…';
        else if(etaSeconds<1) etaEl.textContent='Almost done…';
        else if(etaSeconds<60) etaEl.textContent='~'+Math.ceil(etaSeconds)+'s left';
        else etaEl.textContent='~'+Math.floor(etaSeconds/60)+'m '+Math.round(etaSeconds%60)+'s left';
      }
    };
  }
  return endFn;
}

// ---- Button click ripple: a small expanding circle from the click point, on
// every real <button> plus the drill-modal's anchor-styled export link — see
// the shared hover-lift/ripple CSS block at the end of app.css. Delegated on
// document so it also covers buttons created later (filter triggers, dialog
// buttons, saved-view popover buttons, etc.) without needing individual
// listeners wired up at each creation site.
document.addEventListener('click',e=>{
  const target=e.target.closest('button,.drill-export');
  if(!target) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect=target.getBoundingClientRect();
  const size=Math.max(rect.width,rect.height)*1.6;
  const ripple=document.createElement('span');
  ripple.className='ripple-effect';
  const cx=(typeof e.clientX==='number'&&(e.clientX||e.clientY))?e.clientX:rect.left+rect.width/2;
  const cy=(typeof e.clientY==='number'&&(e.clientX||e.clientY))?e.clientY:rect.top+rect.height/2;
  ripple.style.width=ripple.style.height=size+'px';
  ripple.style.left=(cx-rect.left-size/2)+'px';
  ripple.style.top=(cy-rect.top-size/2)+'px';
  target.appendChild(ripple);
  ripple.addEventListener('animationend',()=>ripple.remove());
  setTimeout(()=>ripple.remove(),700); // safety net if animationend doesn't fire (e.g. element removed mid-animation)
});

