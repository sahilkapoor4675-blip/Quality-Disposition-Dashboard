/* 07-kpis.js — KPI cards, targets, animations, period banner. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// Icon shown before each KPI card's name — purely cosmetic, keyed by label.
const KPI_ICONS = {
  "Total Coils": "📦",
  "Defect Coils": "⚠️",
  "First Pass Yield % (Prime%)": "✅",
  "Hold for Decision % Qty": "⏳",
  "Output Quantity (MT)": "🏭",
  "Salvage % Qty": "♻️",
  "Salvage + Divert Qty (MT)": "🔀",
  "Defect Rate": "🔻",
  "Reject % Qty": "🚫",
  "Hold For Decision Qty (MT)": "🕒",
  "Reject Qty (MT)": "❌",
  "Rework % Qty": "🔧",
};

let KPI_TARGETS={};
let qcrAnimationToken=0;
function fmtTarget(v,fmt){
  if(v===null||v===undefined||v==='') return '—';
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(fmt==='pct') return (n*100).toFixed(1)+'%';
  if(fmt==='int') return Math.round(n).toLocaleString();
  if(fmt==='num3') return n.toFixed(3);
  return n.toFixed(2);
}
function kpiTargetData(label){return KPI_TARGETS[label]||null;}
function kpiTargetMarkup(label,fmt){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return '<div class="kpi-target-none">No Target Setting</div>';
  const dir=(c.direction||'higher').toLowerCase();
  const low=dir==='lower'?c.target:c.critical;
  const mid=c.warning;
  const high=dir==='lower'?c.critical:c.target;
  const lowClass=dir==='lower'?'target-good':'target-bad';
  const highClass=dir==='lower'?'target-bad':'target-good';
  return `<div class="kpi-targets"><div class="kpi-target-item ${lowClass}"><span>LOW</span><b>${fmtTarget(low,fmt)}</b></div><div class="kpi-target-item target-amber"><span>MID</span><b>${fmtTarget(mid,fmt)}</b></div><div class="kpi-target-item ${highClass}"><span>HIGH</span><b>${fmtTarget(high,fmt)}</b></div></div><div class="kpi-target"><span>${dir==='higher'?'↑ Higher is better':dir==='lower'?'↓ Lower is better':'Neutral'}</span></div>`;
}
function kpiStatus(label,k){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(k.value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  if(d==='higher') return v>=t?'good':v>=w?'amber':'bad';
  return 'neutral';
}
function sparklineSvg(oldValue,currentValue,status){
  const a=Number.isFinite(oldValue)?oldValue:Number(currentValue); const b=Number(currentValue)||0; const pts=[]; for(let i=0;i<6;i++){const t=i/5; const v=a+(b-a)*t; pts.push(v)}
  let min=Math.min(...pts),max=Math.max(...pts); if(min===max){min-=1;max+=1;} const points=pts.map((v,i)=>`${(i*15.2).toFixed(1)},${(24-(v-min)/(max-min)*20).toFixed(1)}`).join(' ');
  const stroke=status==='good'?'#16a34a':status==='bad'?'#dc2626':status==='amber'?'#d97706':'#118dff';
  return `<svg class="sparkline" viewBox="0 0 76 28" preserveAspectRatio="none"><polyline points="${points}" stroke="${stroke}"/><circle cx="76" cy="${(24-(b-min)/(max-min)*20).toFixed(1)}" r="2.2" fill="${stroke}"/></svg>`;
}
function renderKpis(kpis){
  const grid=document.getElementById('kpiGrid'); const nextValues=new Map(); const nextTrend=new Map(); const token=++kpiAnimationToken; grid.innerHTML='';
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isFirstPaint=!kpiFirstPaintDone;
  kpis.forEach((k,idx)=>{
    const card=document.createElement('div'); const oldValue=previousKpiValues.get(k.label); const cur=Number(k.value)||0; const changed=Number.isFinite(oldValue)&&Math.abs(oldValue-cur)>1e-12; const direction=changed?(cur>oldValue?'up':'down'):''; const status=kpiStatus(k.label,k);
    card.className=`kpi-card status-${status} kpi-pulse`; if(direction)card.classList.add(direction==='up'?'kpi-up':'kpi-down');
    // Stagger each card's entrance/refresh animation so a full-grid refresh reads as a
    // gentle left-to-right ripple instead of every card flashing in lockstep.
    const staggerMs=reduceMotion?0:Math.min(idx,7)*65;
    if(staggerMs) card.style.setProperty('--kpi-stagger',`${staggerMs}ms`);
    let trendHtml=''; let trendMeta=null;
    if(k.arrow!==null && k.arrow!==undefined){
      const arrowChar=k.arrow==='up'?'▲':k.arrow==='down'?'▼':'▬';
      const changeType=k.change_type;
      let changeInner='';
      if(changeType==='pts'||changeType==='pct'){
        const unit=changeType==='pts'?' pts':'%';
        changeInner=`<span class="kpi-change-val">${k.change_value>=0?'+':''}${(k.change_value*100).toFixed(3)}${unit}</span>`;
      } else if(changeType==='new'){ changeInner='New'; }
      else { changeInner='No change'; }
      let deltaInner=''; let deltaKind=null, deltaRaw=null; const absUnit=k.fmt==='int'?'coils':(k.fmt==='num2'?'MT':'');
      if(k.change_value_pp!==null && k.change_value_pp!==undefined){
        deltaKind='pp'; deltaRaw=Number(k.change_value_pp); const ppVal=deltaRaw*100;
        deltaInner=` (<span class="kpi-delta-val">${ppVal>=0?'+':''}${ppVal.toFixed(3)} pp</span>)`;
      } else if(k.change_value_abs!==null && k.change_value_abs!==undefined){
        deltaKind='abs'; deltaRaw=Number(k.change_value_abs);
        deltaInner=` (<span class="kpi-delta-val">${deltaRaw>=0?'+':''}${fmtValue(deltaRaw,k.fmt)}${absUnit?' '+absUnit:''}</span>)`;
      }
      const prevRaw=(k.prev!==null && k.prev!==undefined)?Number(k.prev):null;
      const prevInner = prevRaw!==null ? `<span class="kpi-prev-val">${fmtValue(prevRaw,k.fmt)}</span>` : 'N/A';
      trendHtml=`<span class="prev">Prev: ${prevInner}</span><span class="trend ${k.trend_color}">${arrowChar} ${changeInner}${deltaInner}</span>`;
      trendMeta={
        fmt:k.fmt, prevRaw,
        changeType:(changeType==='pts'||changeType==='pct')?changeType:null,
        changeRaw:(changeType==='pts'||changeType==='pct')?Number(k.change_value):null,
        deltaKind, deltaRaw, absUnit
      };
    }
    const statusText=status==='good'?'ON TARGET':status==='amber'?'WATCH':status==='bad'?'ACTION':'REFERENCE';
    const valueColor=(k.label==='Total Coils'||k.label==='Output Quantity (MT)')?'#2388C9':(k.color||'#16324F');
    card.innerHTML=`<div class="kpi-top"><div class="label"><span class="kpi-icon">${KPI_ICONS[k.label]||'📊'}</span>${escQcr(k.label)}</div><span class="kpi-status ${status}">${statusText}</span></div><div class="value" data-target="${cur}" style="color:${valueColor}">${fmtValue(cur,k.fmt)}</div><div class="kpi-bottom"><div class="kpi-meta">${kpiTargetMarkup(k.label,k.fmt)}<div class="kpi-trendline">${trendHtml}</div></div>${sparklineSvg(oldValue,cur,status)}</div>`;
    card.setAttribute('role','button'); card.setAttribute('tabindex','0'); card.setAttribute('aria-label',`Drill down into ${k.label}`); card.addEventListener('click',()=>openDrilldown(k.label,`${k.label} — Underlying Records`)); card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrilldown(k.label,`${k.label} — Underlying Records`);}}); grid.appendChild(card); const valueEl=card.querySelector('.value');
    if(_kpiTiltEnabled) attachKpiTilt(card);
    if(changed&&!reduceMotion){ if(staggerMs) setTimeout(()=>{ if(token===kpiAnimationToken) animateKpiValue(valueEl,oldValue,cur,k.fmt,token); },staggerMs); else animateKpiValue(valueEl,oldValue,cur,k.fmt,token); }
    else if(isFirstPaint&&!reduceMotion){ if(staggerMs) setTimeout(()=>{ if(token===kpiAnimationToken) animateKpiValue(valueEl,0,cur,k.fmt,token); },staggerMs); else animateKpiValue(valueEl,0,cur,k.fmt,token); }
    // Prev value / % trend / delta (pp or MT/coils) count up in step with the
    // headline value, instead of just snapping to their new text.
    if(trendMeta && !reduceMotion && (changed||isFirstPaint)){
      const oldTrend=previousKpiTrend.get(k.label);
      const runTrendAnim=()=>{
        if(token!==kpiAnimationToken) return;
        const prevEl=card.querySelector('.kpi-prev-val');
        if(prevEl && trendMeta.prevRaw!==null){
          const fromPrev=(oldTrend&&oldTrend.prevRaw!==null&&oldTrend.prevRaw!==undefined)?oldTrend.prevRaw:(isFirstPaint?0:trendMeta.prevRaw);
          if(fromPrev!==trendMeta.prevRaw) animateNumericSpan(prevEl,fromPrev,trendMeta.prevRaw,v=>fmtValue(v,trendMeta.fmt),token);
        }
        const changeEl=card.querySelector('.kpi-change-val');
        if(changeEl && trendMeta.changeType){
          const sameType=oldTrend&&oldTrend.changeType===trendMeta.changeType;
          const fromChange=sameType?oldTrend.changeRaw:(isFirstPaint?0:trendMeta.changeRaw);
          if(fromChange!==trendMeta.changeRaw){
            const unit=trendMeta.changeType==='pts'?' pts':'%';
            animateNumericSpan(changeEl,fromChange,trendMeta.changeRaw,v=>`${v>=0?'+':''}${(v*100).toFixed(3)}${unit}`,token);
          }
        }
        const deltaEl=card.querySelector('.kpi-delta-val');
        if(deltaEl && trendMeta.deltaKind){
          const sameKind=oldTrend&&oldTrend.deltaKind===trendMeta.deltaKind;
          const fromDelta=sameKind?oldTrend.deltaRaw:(isFirstPaint?0:trendMeta.deltaRaw);
          if(fromDelta!==trendMeta.deltaRaw){
            if(trendMeta.deltaKind==='pp') animateNumericSpan(deltaEl,fromDelta,trendMeta.deltaRaw,v=>`${(v*100)>=0?'+':''}${(v*100).toFixed(3)} pp`,token);
            else animateNumericSpan(deltaEl,fromDelta,trendMeta.deltaRaw,v=>`${v>=0?'+':''}${fmtValue(v,trendMeta.fmt)}${trendMeta.absUnit?' '+trendMeta.absUnit:''}`,token);
          }
        }
      };
      if(staggerMs) setTimeout(runTrendAnim,staggerMs); else runTrendAnim();
    }
    nextValues.set(k.label,cur); nextTrend.set(k.label,trendMeta);
  }); previousKpiValues=nextValues; previousKpiTrend=nextTrend; kpiFirstPaintDone=true;
}
async function loadKpiTargets(){try{const d=await fetch('/api/kpi_targets',{cache:'no-store'}).then(r=>r.json());KPI_TARGETS=d.targets||{};}catch(e){KPI_TARGETS={};}}

// Shared "spring" easing for the KPI count-up animations (headline value and
// the Prev/%/pp trend spans below it): a classic easeOutBack curve, so the
// number overshoots the target slightly and settles back instead of just
// decelerating smoothly into it — reads as a springy bounce, not a linear/
// ease-out crawl.
function easeSpringOut(t){
  const c1=1.70158, c3=c1+1, p=t-1;
  return 1 + c3*p*p*p + c1*p*p;
}
function animateKpiValue(el, from, to, fmt, token){
  const start = performance.now();
  const duration = 680;
  const step = now => {
    if(token !== kpiAnimationToken && token !== qcrAnimationToken) return;
    const p = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * easeSpringOut(p);
    el.textContent = fmtValue(v, fmt);
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = fmtValue(to, fmt);
  };
  requestAnimationFrame(step);
}
// Same count-up used for the headline KPI value, generalized with a custom
// formatter so the Prev/% trend/delta (pp or MT/coils) numbers underneath
// can count up too instead of just snapping to their new text.
function animateNumericSpan(el, from, to, formatFn, token){
  const start = performance.now();
  const duration = 680;
  const step = now => {
    if(token !== kpiAnimationToken) return;
    const p = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * easeSpringOut(p);
    el.textContent = formatFn(v);
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = formatFn(to);
  };
  requestAnimationFrame(step);
}

function renderPeriodBanner(period){
  const el = document.getElementById("periodBanner");
  if(!period){ el.textContent = ""; return; }
  const cur = period.current || "All Periods";
  const prev = period.previous;
  el.innerHTML = prev
    ? `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> ${escQcr(prev)}`
    : `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; <i>Select a single Month/Week/Quarter/FY filter to see period-over-period comparison</i>`;
}

