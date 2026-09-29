/* 02-core-state.js — Filter definitions, global state, KPI tilt. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
/* ==== Dashboard app ==== */
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

// V65.0 icon helper: <svg><use> reference into the sprite at the top of index.html.
function qdIc(name,cls){ return `<svg class="ic${cls?' '+cls:''}" aria-hidden="true"><use href="#ic-${name}"/></svg>`; }

let currentFilters = {};
FILTER_DEFS.forEach(f => currentFilters[f.key] = "All");
let previousKpiValues = new Map();
let previousKpiTrend = new Map();
let kpiAnimationToken = 0;
let kpiFirstPaintDone = false;
// Subtle 3D tilt on KPI cards (mouse-follow rotateX/rotateY), only for
// fine-pointer devices and when the user hasn't asked for reduced motion.
// Reads --tiltX/--tiltY, consumed by the .kpi-card:hover transform in app.css.
const _kpiTiltEnabled = window.matchMedia('(pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function attachKpiTilt(card){
  const maxDeg=5;
  let rect=null, pendingX=0, pendingY=0, rafId=null;
  const applyTilt=()=>{
    rafId=null;
    const px=(pendingX-rect.left)/rect.width, py=(pendingY-rect.top)/rect.height;
    card.style.setProperty('--tiltY',((px-0.5)*2*maxDeg).toFixed(2)+'deg');
    card.style.setProperty('--tiltX',((0.5-py)*2*maxDeg).toFixed(2)+'deg');
  };
  // getBoundingClientRect() forces a layout read — calling it on every single
  // mousemove (which can fire 60-120+ times/second) was the actual source of
  // jitter here. The card's size doesn't change mid-hover, so it's measured
  // once on entry and reused for the whole gesture; each mousemove after that
  // only stores the latest pointer position and schedules (at most) one
  // requestAnimationFrame callback to apply it, so a burst of mousemove
  // events between two frames collapses into a single style write instead of
  // one per event.
  card.addEventListener('mouseenter',()=>{ rect=card.getBoundingClientRect(); });
  card.addEventListener('mousemove',e=>{
    if(!rect) rect=card.getBoundingClientRect();
    pendingX=e.clientX; pendingY=e.clientY;
    if(rafId==null) rafId=requestAnimationFrame(applyTilt);
  });
  card.addEventListener('mouseleave',()=>{
    if(rafId!=null){ cancelAnimationFrame(rafId); rafId=null; }
    rect=null;
    card.style.setProperty('--tiltX','0deg'); card.style.setProperty('--tiltY','0deg');
  });
}

