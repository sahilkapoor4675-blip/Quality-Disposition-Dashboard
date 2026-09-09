// ---------- Tab: Quality Control Room ----------
function qcrStatus(label, value){
  const c=KPI_TARGETS[label]; if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  return v>=t?'good':v>=w?'amber':'bad';
}
function qcrFmtKpi(k){ return k.fmt==='pct' ? (Number(k.value||0)*100).toFixed(2)+'%' : k.fmt==='int' ? Math.round(Number(k.value||0)).toLocaleString() : Number(k.value||0).toFixed(2); }
function qcrTargetText(label){ const c=KPI_TARGETS[label]; if(!c)return 'Target not set'; return `${c.direction==='lower'?'≤':'≥'} ${fmtTarget(c.target,'pct')}`; }
function qcrRenderList(id, rows, nameKey, metricKey, metricFmt){
  const el=document.getElementById(id); if(!el)return; if(!rows.length){el.innerHTML='<div class="qcr-empty">No data available for current selection.</div>';return;}
  el.innerHTML=rows.map((r,i)=>`<div class="qcr-row"><div class="qcr-rank">${i+1}</div><div class="qcr-name">${String(r[nameKey]??'—')}</div><div class="qcr-metric">${metricFmt(Number(r[metricKey]||0))}</div></div>`).join('');
}
function qcrRenderBreaches(kpis){
  const el=document.getElementById('qcrBreaches'); const bad=kpis.filter(k=>qcrStatus(k.label,k.value)==='bad'); const amber=kpis.filter(k=>qcrStatus(k.label,k.value)==='amber'); const rows=[...bad,...amber];
  if(!rows.length){el.innerHTML='<div class="qcr-empty">✓ No KPI target breaches. All configured KPIs are on target.</div>';return;}
  el.innerHTML=rows.map(k=>`<div class="qcr-breach"><div><div class="qcr-breach-name">${k.label}</div><div class="qcr-breach-meta">${qcrStatus(k.label,k.value)==='bad'?'Critical breach':'Watch level'} • Target ${qcrTargetText(k.label)}</div></div><div class="qcr-breach-val">${qcrFmtKpi(k)}</div></div>`).join('');
}
function qcrRenderComparison(rows){
  const el=document.getElementById('qcrComparison'); if(!rows.length){el.innerHTML='<div class="qcr-empty">Monthly comparison is not available.</div>';return;}
  const cur=rows[rows.length-1], prev=rows.length>1?rows[rows.length-2]:null;
  const metrics=[['Defect %','defect_pct',true,'lower'],['First Pass Yield % (Prime%)','first_pass_yield_pct',true,'higher'],['Reject % Qty','reject_pct_qty',true,'lower'],['Output Qty (MT)','output_qty',false,'higher'],['Coils','coils',false,'higher']];
  const cell=(m,row)=>m[2] ? (Number(row?.[m[1]]||0)*100).toFixed(2)+'%' : Number(row?.[m[1]]||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const delta=(m)=>{if(!prev)return '—'; const a=Number(prev[m[1]]||0),b=Number(cur[m[1]]||0),diff=b-a; if(m[2]){const pp=diff*100; const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(pp)<0.005?'equal':good?'good':'bad'}">${pp>=0?'+':''}${pp.toFixed(2)} pp ${Math.abs(pp)<0.005?'→':good?'↑':'↓'}</span>`;} const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(diff)<0.000001?'equal':good?'good':'bad'}">${diff>=0?'+':''}${diff.toFixed(2)} ${Math.abs(diff)<0.000001?'→':good?'↑':'↓'}</span>`;};
  el.innerHTML=`<table class="qcr-compare"><thead><tr><th>Metric</th><th>${prev?prev.name:'Previous'}</th><th>${cur.name}</th><th>Change</th></tr></thead><tbody>${metrics.map(m=>`<tr><td>${m[0]}</td><td>${prev?cell(m,prev):'—'}</td><td>${cell(m,cur)}</td><td>${delta(m)}</td></tr>`).join('')}</tbody></table>`;
}
const qcrCoreCache = new Map();
window.qcrLoadToken=0;
function qcrCacheKey(filters){ return new URLSearchParams(filters).toString(); }
function qcrSessionKey(filters){ return 'qcr_last_good_v22_' + qcrCacheKey(filters); }
async function fetchQcrCore(filters, signal){
  const key=qcrCacheKey(filters); const cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return cached.data;
  const params=new URLSearchParams(filters).toString();
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch('/api/qcr?'+params+'&_qcr=22&_attempt='+(attempt+1),{signal,cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
      let data=null;
      try{data=await r.json();}catch(e){throw new Error('QCR server returned invalid JSON (HTTP '+r.status+')');}
      if(!r.ok || data?.error) throw new Error(data?.error || ('QCR request failed (HTTP '+r.status+')'));
      if(!data || !data.k || !data.d || !data.w){throw new Error('QCR response is incomplete');}
      qcrCoreCache.set(key,{ts:Date.now(),data});
      try{sessionStorage.setItem(qcrSessionKey(filters),JSON.stringify({ts:Date.now(),data}));}catch(_){}
      return data;
    }catch(e){
      if(e.name==='AbortError') throw e;
      lastError=e;
      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  // A transient API failure must never turn a working QCR into a blank screen.
  try{
    const saved=JSON.parse(sessionStorage.getItem(qcrSessionKey(filters))||'null');
    if(saved?.data?.k && saved?.data?.d && saved?.data?.w){
      qcrCoreCache.set(key,{ts:Date.now(),data:saved.data});
      return saved.data;
    }
  }catch(_){}
  throw lastError || new Error('Unable to load Control Room data');
}
function prefetchQcrCore(filters){
  const key=qcrCacheKey(filters), cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return;
  fetchQcrCore(filters).catch(()=>{});
}
function qcrRenderTrendPrediction(rows,d,w){
  const el=document.getElementById('qcrTrendPrediction'); if(!el)return;
  try{
    const valid=Array.isArray(rows)?rows.filter(r=>Number.isFinite(Number(r?.first_pass_yield_pct))):[];
    const recent=valid.slice(-4);
    if(recent.length<3){el.innerHTML='<div class="qcr-empty">Need at least 3 monthly periods for trend intelligence.</div>';return;}
    const fpy=recent.map(r=>Number(r.first_pass_yield_pct)||0), rej=recent.map(r=>Number(r.reject_pct_qty)||0);
    const slope=a=>{const n=a.length,xm=(n-1)/2,ym=a.reduce((x,y)=>x+y,0)/n,den=a.reduce((x,_,i)=>x+(i-xm)*(i-xm),0);return den? a.reduce((x,y,i)=>x+(i-xm)*(y-ym),0)/den:0;};
    const sf=slope(fpy),sr=slope(rej),deteriorating=sf<-0.001||sr>0.001,stable=!deteriorating&&Math.abs(sf)<0.0005&&Math.abs(sr)<0.0005;
    const status=deteriorating?'⚠️ Deteriorating Trend':stable?'✓ Stable Trend':'↕ Mixed Trend',cls=deteriorating?'bad':stable?'good':'amber',next=Math.max(0,Math.min(1,fpy[fpy.length-1]+sf));
    const grades=Array.isArray(w?.by_grade)?w.by_grade:[],wcs=Array.isArray(w?.by_work_center)?w.by_work_center:[],defs=Array.isArray(d?.register)?d.register:[];
    const gr=grades.filter(x=>Number(x?.coils||0)>0).sort((a,b)=>Number(b?.reject_pct_qty||0)-Number(a?.reject_pct_qty||0))[0];
    const wc=wcs.filter(x=>Number(x?.coils||0)>0).sort((a,b)=>Number(b?.reject_pct_qty||0)-Number(a?.reject_pct_qty||0))[0];
    const df=defs.filter(x=>Number(x?.qty||0)>0).sort((a,b)=>Number(b?.qty||0)-Number(a?.qty||0))[0];
    el.innerHTML=`<div class="qcr-intel-status ${cls}">${status}</div><div class="qcr-intel-main">FPY ${ (fpy[fpy.length-1]*100).toFixed(2)}% <span>→ projected ${(next*100).toFixed(2)}%</span></div><div class="qcr-intel-meta">Last ${recent.length} months: ${recent.map(r=>r.name).join(' → ')}</div><div class="qcr-intel-meta">${sf<0?'FPY is trending down.':'FPY is not declining.'} ${sr>0?'Reject % is increasing.':'Reject % is not increasing.'}</div><div class="qcr-contributor"><b>Main contributors:</b> Grade ${gr?.name||'—'} • Defect ${df?.defect||'—'} • Work Center ${wc?.name||'—'}</div>`;
  }catch(e){console.error('QCR trend intelligence',e);el.innerHTML='<div class="qcr-empty">Trend intelligence unavailable.</div>';}
}
function qcrRenderKpiRanking(kpis){
  const el=document.getElementById('qcrKpiRanking'); if(!el)return;
  try{
    const rows=(Array.isArray(kpis)?kpis:[]).map(k=>{const c=KPI_TARGETS[k.label];if(!c||c.target==null)return null;const v=Number(k.value||0),t=Number(c.target),status=qcrStatus(k.label,v),severity=status==='bad'?3:status==='amber'?2:1,gapPct=Math.abs(v-t)/(Math.abs(t)||1);return {...k,status,severity,gapPct};}).filter(Boolean).sort((a,b)=>b.severity-a.severity||b.gapPct-a.gapPct);
    el.innerHTML=rows.length?rows.map((k,i)=>`<div class="qcr-kpi-rank"><b>${i+1}. ${k.label}</b><span>Actual ${qcrFmtKpi(k)} • Target ${qcrTargetText(k.label)} • Gap ${k.gapPct>=0?'':''}${((Number(k.value||0)-Number(KPI_TARGETS[k.label].target||0))*100).toFixed(2)} pp</span><em class="${k.status}">${k.status==='bad'?'CRITICAL':k.status==='amber'?'WARNING':'ON TARGET'}</em></div>`).join(''):'<div class="qcr-empty">No target-configured KPIs.</div>';
  }catch(e){console.error('QCR KPI intelligence',e);el.innerHTML='<div class="qcr-empty">KPI target intelligence unavailable.</div>';}
}
document.getElementById('qcrRootCause')?.addEventListener('click',e=>{const b=e.target.closest('.qcr-root-link');if(!b)return; const p=new URLSearchParams(currentFilters);p.set('grade',b.dataset.rootGrade||'All');p.set('work_center',b.dataset.rootWc||'All');openDrilldown('defect_category',`Root Cause: ${b.dataset.rootGrade||'—'} → ${b.dataset.rootWc||'—'}`,{drill_value:document.querySelector('.qcr-defect-btn')?.dataset.defect||'',grade:b.dataset.rootGrade||'All',work_center:b.dataset.rootWc||'All'});});
function loadRootCause(defect){
  const el=document.getElementById('qcrRootCause'); if(!el||!defect)return Promise.resolve(); el.innerHTML='<div class="qcr-empty">Loading root-cause path…</div>';
  const p=new URLSearchParams(currentFilters);p.set('defect',defect); return fetch('/api/root_cause?'+p.toString(),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error)throw new Error(d.error); const paths=d.paths||[]; const rec=d.records||[];
    const top=paths[0]; let html=`<div class="qcr-root-title">${defect}</div>`;
    if(top) html+=`<div class="qcr-root-path"><span>Defect<br><b>${defect}</b></span><i>→</i><span>Grade<br><b>${top.grade}</b></span><i>→</i><span>Work Center<br><b>${top.work_center}</b></span><i>→</i><span>Heat / Batch<br><b>${rec[0]?.heat_no||'—'} / ${rec[0]?.batch_no||'—'}</b></span></div>`;
    html+=`<div class="qcr-root-meta">Top contributing combinations — click to investigate records</div><div class="qcr-root-list">${paths.slice(0,6).map((x,i)=>`<button class="qcr-root-link" data-root-grade="${escQcr(x.grade)}" data-root-wc="${escQcr(x.work_center)}"><b>#${i+1} ${escQcr(x.grade)}</b><span>${escQcr(x.work_center)} • ${x.qty.toFixed(2)} MT • ${x.coils.toLocaleString()} coils</span></button>`).join('')}</div>`;
    el.innerHTML=html;
  }).catch(e=>{el.innerHTML='<div class="qcr-empty">Root-cause data unavailable.</div>';});
}
async function loadQcrSecondary(filterSnapshot, d, w, m, signal, loadToken){
  try{
    const gc=document.getElementById('qcrGradeConcentration');
    if(gc){
      const gradesForDetail=([...((w.by_grade||[]))].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,3));
      const details=[];
      for(const gr of gradesForDetail){
        if(loadToken!==window.qcrLoadToken) return;
        const p=new URLSearchParams(filterSnapshot); p.set('grade',gr.name);
        const [dd,ww]=await Promise.all([
          fetch('/api/defect_analysis?'+p.toString(),{signal}).then(r=>r.json()),
          fetch('/api/work_center_grade?'+p.toString(),{signal}).then(r=>r.json())
        ]);
        const td=(dd.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>Number(b.qty||0)-Number(a.qty||0))[0];
        const mw=(ww.by_work_center||[]).filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0))[0];
        details.push({grade:gr.name,defect:td?.defect||'—',wc:mw?.name||'—',qty:Number(gr.output_qty||0),reject:Number(gr.reject_pct_qty||0)});
      }
      gc.innerHTML=details.length?`<div class="qcr-subtitle">Problem concentration</div>`+details.map(x=>`<div class="qcr-grade-item"><b>${x.grade}</b><span>Defect: ${x.defect}</span><span>WC: ${x.wc}</span><em>Reject ${(x.reject*100).toFixed(2)}%</em></div>`).join(''):'<div class="qcr-empty">No grade concentration available.</div>';
    }
    const why=document.getElementById('qcrWhyChanged');
    if(why){
      const rows=m.rows||[]; let idx=rows.length-1; const selectedMonth=filterSnapshot.month && filterSnapshot.month!=='All' ? filterSnapshot.month : ''; if(selectedMonth){ const found=rows.findIndex(r=>r.name===selectedMonth); if(found>=0) idx=found; } const cur=rows[idx], prev=idx>0?rows[idx-1]:null;
      if(!cur||!prev){why.innerHTML='';}
      else{
        const p1=new URLSearchParams(filterSnapshot); p1.set('month',cur.name);
        const p0=new URLSearchParams(filterSnapshot); p0.set('month',prev.name);
        const [dc,dp,wcC,wcP]=await Promise.all([
          fetch('/api/defect_analysis?'+p1.toString(),{signal}).then(r=>r.json()), fetch('/api/defect_analysis?'+p0.toString(),{signal}).then(r=>r.json()),
          fetch('/api/work_center_grade?'+p1.toString(),{signal}).then(r=>r.json()), fetch('/api/work_center_grade?'+p0.toString(),{signal}).then(r=>r.json())
        ]);
        if(loadToken!==window.qcrLoadToken)return;
        const defectDelta=(dc.register||[]).map(x=>{const old=(dp.register||[]).find(y=>y.defect===x.defect);const nowQty=Number(x.qty||0),oldQty=Number(old?.qty||0),outNow=Number(dc.totals?.qty||0),outOld=Number(dp.totals?.qty||0);return {name:x.defect,change:((outNow?nowQty/outNow:0)-(outOld?oldQty/outOld:0))*100};}).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change))[0];
        const wcDelta=(wcC.by_work_center||[]).map(x=>{const old=(wcP.by_work_center||[]).find(y=>y.name===x.name);return {name:x.name,change:(Number(x.reject_pct_qty||0)-Number(old?.reject_pct_qty||0))*100};}).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change))[0];
        const fpyd=(Number(cur.first_pass_yield_pct||0)-Number(prev.first_pass_yield_pct||0))*100, rejD=(Number(cur.reject_pct_qty||0)-Number(prev.reject_pct_qty||0))*100;
        const fpyContrib=defectDelta?.name?`Main contributor: <b>${defectDelta.name}</b> ${defectDelta.change>=0?'+':''}${defectDelta.change.toFixed(2)} pp defect share`:'No dominant defect contributor identified.';
        const rejContrib=wcDelta?.name?`Major contributor: <b>${wcDelta.name}</b> ${wcDelta.change>=0?'+':''}${wcDelta.change.toFixed(2)} pp Reject`:'No dominant work-center contributor identified.';
        why.innerHTML=`<div class="qcr-why-title">Why changed?</div><div class="qcr-why-grid"><div><b>FPY ${fpyd>=0?'↑':'↓'} ${Math.abs(fpyd).toFixed(2)} pp</b><span>${fpyContrib}</span></div><div><b>Reject ${rejD>=0?'↑':'↓'} ${Math.abs(rejD).toFixed(2)} pp</b><span>${rejContrib}</span></div></div>`;
      }
    }
  }catch(e){ if(e.name!=='AbortError') console.error(e); }
}
function escQcr(v){return String(v??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function qcrRenderAdvancedIntel(intel){
  const ew=document.getElementById('qcrEarlyWarnings');
  if(ew){const rows=intel?.early_warnings||[]; ew.innerHTML=rows.length?rows.map(x=>`<div class="qcr-alert ${x.severity}"><span>${x.severity==='high'?'🔴':'🟠'}</span><div><b>${escQcr(x.title)}</b><small>${escQcr(x.detail)}</small><em>Recommended: ${escQcr(x.action)}</em></div></div>`).join(''):'<div class="qcr-empty">✓ No early-warning condition detected.</div>';}
  const hs=document.getElementById('qcrHealthScore');
  if(hs){const h=intel?.health_score||{}; const reasons=(h.reasons||[]); hs.innerHTML=`<div class="qcr-health"><div class="qcr-health-score ${h.status||'amber'}">${Number(h.score||0).toFixed(1)}<small>/100</small></div><div class="qcr-health-label">${h.status==='good'?'🟢 Healthy':h.status==='bad'?'🔴 Critical':'🟠 Attention Required'}</div></div><div class="qcr-health-reasons">${reasons.length?reasons.map(r=>`<span>−${Number(r[1]||0).toFixed(1)} <b>${escQcr(r[0])}</b></span>`).join(''):'<span>All weighted quality components are performing within target.</span>'}</div>`;}
  const rm=document.getElementById('qcrRiskMatrix');
  if(rm){const wc=intel?.risk_matrix?.work_centers||[],gr=intel?.risk_matrix?.grades||[]; const block=(title,arr)=>`<div class="qcr-risk-block"><b>${title}</b>${arr.slice(0,4).map(x=>`<div class="qcr-risk-row"><span>${escQcr(x.name)}</span><small>${(Number(x.reject_pct||0)*100).toFixed(2)}% Reject • ${x.trend>=0?'+':''}${(Number(x.trend||0)*100).toFixed(2)} pp trend</small><em class="${String(x.risk).toLowerCase()}">${escQcr(x.risk)}</em></div>`).join('')}</div>`; rm.innerHTML=(wc.length||gr.length)?block('Work Center',wc)+block('Grade',gr):'<div class="qcr-empty">No risk data available.</div>';}
  const rp=document.getElementById('qcrRecurring');
  if(rp){const rows=intel?.recurring_patterns||[]; rp.innerHTML=rows.length?rows.slice(0,6).map((x,i)=>`<div class="qcr-repeat"><div><b>🔴 #${i+1} ${escQcr(x.defect)}</b><span>${escQcr(x.grade)} • ${escQcr(x.work_center)}</span></div><div class="qcr-repeat-months">${(x.months||[]).map(m=>`<span>${escQcr(m.month)}: <b>${Number(m.coils||0).toLocaleString()}</b> coils</span>`).join('')}</div><em>Recurring • ${x.period_count} periods • ${Number(x.qty||0).toFixed(2)} MT</em></div>`).join(''):'<div class="qcr-empty">✓ No recurring Grade + Defect + Work Center pattern found across multiple periods.</div>';}
}
function qcrRenderTargetHistory(rows,target){
  const el=document.getElementById('qcrTargetHistory'); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">No historical monthly data available.</div>';return;}
  el.innerHTML=`<div class="qcr-target-summary">Target <b>${(Number(target||0)*100).toFixed(1)}%</b> • Attainment = Actual ÷ Target</div><div class="qcr-target-table"><table class="qcr-compare"><thead><tr><th>Period</th><th>Target</th><th>Actual</th><th>Attainment</th><th>Gap</th></tr></thead><tbody>${rows.map(r=>{const a=Number(r.actual||0),t=Number(r.target||0),att=Number(r.attainment||0);const cls=a>=t?'good':a>=t*0.95?'amber':'bad';return `<tr><td>${escQcr(r.period)}</td><td>${(t*100).toFixed(1)}%</td><td>${(a*100).toFixed(2)}%</td><td><span class="qcr-delta ${cls}">${(att*100).toFixed(1)}%</span></td><td>${Number(r.gap_pp||0)>=0?'+':''}${Number(r.gap_pp||0).toFixed(2)} pp</td></tr>`}).join('')}</tbody></table></div>`;
}

async function loadControlRoom(signal){
  const filterSnapshot={...currentFilters};
  const params=new URLSearchParams(filterSnapshot).toString();
  try{
    const data=await fetchQcrCore(filterSnapshot,signal); const {k,d,w,m,fr}=data;
    document.getElementById('qcrFreshness').textContent=`Data Through: ${fr.data_through_display||'—'} • Filtered Records: ${Number(fr.filtered_records||0).toLocaleString()}`;
    const criticalLabels=['First Pass Yield % (Prime%)','Defect Rate','Reject % Qty','Hold for Decision % Qty','Salvage % Qty','Rework % Qty'];
    const critical=(k.kpis||[]).filter(x=>criticalLabels.includes(x.label));
    const qcrGrid=document.getElementById('qcrCriticalKpis');
    const nextQcrValues=new Map(); qcrGrid.innerHTML='';
    critical.forEach(x=>{
      const st=qcrStatus(x.label,x.value), cur=Number(x.value)||0, old=window.qcrPreviousKpiValues?.get(x.label);
      const changed=Number.isFinite(old)&&Math.abs(old-cur)>1e-12;
      const card=document.createElement('div'); card.className='qcr-kpi';
      card.innerHTML=`<div class="qcr-kpi-name">${KPI_ICONS[x.label]||'📊'} ${x.label}</div><div class="qcr-kpi-value">${qcrFmtKpi(x)}</div><span class="qcr-status ${st}">${st==='good'?'ON TARGET':st==='amber'?'WATCH':st==='bad'?'CRITICAL':'REFERENCE'}</span>`;
      qcrGrid.appendChild(card); nextQcrValues.set(x.label,cur);
      if(changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const el=card.querySelector('.qcr-kpi-value'); el.classList.add(cur>old?'value-change-up':'value-change-down');
        animateKpiValue(el,old,cur,x.fmt,++qcrAnimationToken); setTimeout(()=>el.classList.remove('value-change-up','value-change-down'),700);
      }
    });
    window.qcrPreviousKpiValues=nextQcrValues;

    // Overall Quality Status: target breaches + reject/FPY + major concentration signals.
    const badKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='bad').length;
    const amberKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='amber').length;
    const maxWc=Math.max(0,...(w.by_work_center||[]).map(x=>Number(x.reject_pct_qty)||0));
    const maxGr=Math.max(0,...(w.by_grade||[]).map(x=>Number(x.reject_pct_qty)||0));
    const topDefPct=d.totals?.qty ? Number((d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>b.qty-a.qty)[0]?.qty||0)/Number(d.totals.qty) : 0;
    let overall='STABLE', overallClass='good';
    if(badKpis>0 || maxWc>0.05 || maxGr>0.05 || topDefPct>=0.35){ overall='CRITICAL'; overallClass='bad'; }
    else if(amberKpis>0 || maxWc>0.03 || maxGr>0.03 || topDefPct>=0.25){ overall='ATTENTION REQUIRED'; overallClass='amber'; }
    const qs=document.getElementById('qcrQualityStatus'); if(qs){qs.className='qcr-quality-status '+overallClass;qs.querySelector('strong').textContent=overall;}

    qcrRenderBreaches(critical);
    const defectTotalQty=Number(d.totals?.qty||0); const topDefects=(d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>Number(b.qty||0)-Number(a.qty||0)).slice(0,5); const qcrDefEl=document.getElementById('qcrDefects');
    if(!topDefects.length){qcrDefEl.innerHTML='<div class="qcr-empty">No defect data available for current selection.</div>';}else{qcrDefEl.innerHTML=topDefects.map((r,i)=>{const qty=Number(r.qty||0);const pct=defectTotalQty?qty/defectTotalQty:0;return `<button class="qcr-row qcr-defect-btn" data-defect="${String(r.defect??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"><span class="qcr-rank">${i+1}</span><span class="qcr-name">${String(r.defect??'—')}</span><span class="qcr-metric"><span class="qcr-qty">${qty.toFixed(2)} MT</span><span class="qcr-pct">${(pct*100).toFixed(2)}% of Defect Qty • ${Number(r.records||0).toLocaleString()} coils</span></span></button>`;}).join('');}

    const worstWc=[...(w.by_work_center||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    const worstGr=[...(w.by_grade||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    qcrRenderList('qcrWorkCenters',worstWc,'name','reject_pct_qty',v=>(v*100).toFixed(2)+'% Reject');
    qcrRenderList('qcrGrades',worstGr,'name','reject_pct_qty',v=>(v*100).toFixed(2)+'% Reject');
    // All QCR intelligence is now returned by the consolidated endpoint so these
    // sections never depend on a chain of secondary browser requests.
    qcrRenderComparison((m&&m.rows)||[]);
    qcrRenderTrendPrediction((m&&m.rows)||[],d,w); qcrRenderKpiRanking(critical);
    fetch('/api/qcr_target_history?'+params,{signal}).then(r=>r.json()).then(th=>{if(!th.error){qcrRenderTargetHistory(th.rows||[],th.target); scheduleQcrLayout();}}).catch(()=>{});
    const intel=data?.intel||{};
    qcrRenderAdvancedIntel(intel);
    const gc=document.getElementById('qcrGradeConcentration');
    if(gc){const rows=Array.isArray(intel.grade_concentration)?intel.grade_concentration:[];gc.innerHTML=rows.length?'<div class="qcr-subtitle">Problem concentration</div>'+rows.map(x=>`<div class="qcr-grade-item"><b>${x.grade||'—'}</b><span>Defect: ${x.defect||'—'}</span><span>WC: ${x.wc||'—'}</span><em>Reject ${(Number(x.reject_pct||0)*100).toFixed(2)}%</em></div>`).join(''):'<div class="qcr-empty">No grade concentration available.</div>';}
    const why=document.getElementById('qcrWhyChanged');
    if(why){const z=intel.why_changed;if(z&&z.current&&z.previous){const fc=z.defect_contributor,fw=z.wc_contributor;why.innerHTML=`<div class="qcr-why-title">Why changed?</div><div class="qcr-why-grid"><div><b>FPY ${Number(z.fpy_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.fpy_change_pp||0)).toFixed(2)} pp</b><span>${fc?.name?`Main contributor: <b>${fc.name}</b> ${Number(fc.change_pp||0)>=0?'+':''}${Number(fc.change_pp||0).toFixed(2)} pp defect share`:'No dominant defect contributor identified.'}</span></div><div><b>Reject ${Number(z.reject_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.reject_change_pp||0)).toFixed(2)} pp</b><span>${fw?.name?`Major contributor: <b>${fw.name}</b> ${Number(fw.change_pp||0)>=0?'+':''}${Number(fw.change_pp||0).toFixed(2)} pp Reject`:'No dominant work-center contributor identified.'}</span></div></div>`;}else{why.innerHTML='<div class="qcr-why-title">Why changed?</div><div class="qcr-empty">Previous month comparison is not available for this selection.</div>';}}
    const loadToken=++window.qcrLoadToken;
    if(topDefects[0]?.defect) loadRootCause(topDefects[0].defect).finally(scheduleQcrLayout);

    // Improvement Opportunities: ranked, action-oriented and de-duplicated.
    const opp=[];
    critical.forEach(x=>{const st=qcrStatus(x.label,x.value);if(st==='good')return;const c=KPI_TARGETS[x.label]||{};opp.push({score:st==='bad'?100:60,icon:st==='bad'?'🚨':'👀',title:x.label,detail:`${qcrFmtKpi(x)} vs target ${qcrTargetText(x.label)}`,action:st==='bad'?'Investigate':'Review'});});
    worstWc.slice(0,3).forEach((x,i)=>opp.push({score:85-i*5,icon:'🏭',title:`${x.name}`,detail:`Reject ${((Number(x.reject_pct_qty)||0)*100).toFixed(2)}% • ${Number(x.coils||0).toLocaleString()} coils`,action:'Investigate'}));
    worstGr.slice(0,3).forEach((x,i)=>opp.push({score:80-i*5,icon:'🧪',title:`${x.name}`,detail:`Reject ${((Number(x.reject_pct_qty)||0)*100).toFixed(2)}% • ${Number(x.coils||0).toLocaleString()} coils`,action:'Review'}));
    topDefects.slice(0,3).forEach((x,i)=>opp.push({score:75-i*5,icon:'🎯',title:`${x.defect}`,detail:`${Number(x.qty||0).toFixed(2)} MT • ${defectTotalQty?(Number(x.qty||0)/defectTotalQty*100).toFixed(2):'0.00'}% of defect qty • ${Number(x.records||0).toLocaleString()} coils`,action:'Investigate'}));
    const seen=new Set(); const ranked=opp.sort((a,b)=>b.score-a.score).filter(o=>{const k=o.title.toUpperCase();if(seen.has(k))return false;seen.add(k);return true;}).slice(0,8);
    const oe=document.getElementById('qcrOpportunities');oe.innerHTML=ranked.length?ranked.map((o,i)=>`<div class="qcr-opportunity"><span class="qcr-opportunity-icon">${o.icon}</span><div class="qcr-opportunity-text"><b>#${i+1} ${o.title}</b><br><span>${o.detail}</span></div><span class="qcr-opportunity-action">Recommended: ${o.action}</span></div>`).join(''):'<div class="qcr-empty">✓ No improvement opportunity detected for the current selection.</div>';
    markChartsReady();
    scheduleQcrLayout();
  }catch(e){
    if(e.name!=='AbortError'){
      console.error('QCR load failed',e);
      const msg=String(e?.message||'Unable to load Control Room data');
      const ids=['qcrCriticalKpis','qcrBreaches','qcrDefects','qcrWorkCenters','qcrGrades','qcrComparison','qcrWhyChanged','qcrOpportunities','qcrTrendPrediction','qcrKpiRanking','qcrTargetHistory','qcrEarlyWarnings','qcrHealthScore','qcrRiskMatrix','qcrRecurring','qcrGradeConcentration'];
      ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="qcr-empty">Unable to load this QCR section. <span class="qcr-error-detail">'+escQcr(msg)+'</span></div>';});
      const root=document.getElementById('qcrRootCause');if(root)root.innerHTML='<div class="qcr-empty">Root-cause data unavailable until QCR data reconnects.</div>';
      const qs=document.getElementById('qcrQualityStatus');if(qs){qs.className='qcr-quality-status amber';const st=qs.querySelector('strong');if(st)st.textContent='UNAVAILABLE';}
    }
  }
}

// ---------- QCR stable layout ----------
// QCR uses native CSS grid only. No JS card positioning is used; this keeps
// the tab responsive and prevents ResizeObserver/layout feedback loops.
function layoutQcrCards(){ return; }
function scheduleQcrLayout(){ return; }

