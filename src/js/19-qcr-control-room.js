/* 19-qcr-control-room.js — Quality Control Room: loaders and renderers. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
function qcrRenderHealthReasons(intel){
  const btn=document.getElementById('qcrHealthWhyBtn'), box=document.getElementById('qcrHealthReasons'); if(!btn||!box)return;
  const reasons=Array.isArray(intel?.health_score?.reasons)?intel.health_score.reasons:[];
  if(!reasons.length){btn.classList.add('qcr-hidden'); box.classList.add('qcr-hidden'); box.innerHTML=''; return;}
  btn.classList.remove('qcr-hidden'); btn.textContent='Why? ▾'; box.classList.add('qcr-hidden');
  box.innerHTML=reasons.map(r=>{const n=Math.abs(Number(r[1]||0));return `<span class="negative">-${n.toFixed(1)} pts <b>${escQcr(r[0])}</b></span>`;}).join('');
}
function qcrRenderComparison(rows){
  const el=document.getElementById('qcrComparison'); if(!rows.length){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Monthly comparison is not available.')+'</div>';return;}
  const cur=rows[rows.length-1], prev=rows.length>1?rows[rows.length-2]:null;
  const metrics=[['Defect %','defect_pct',true,'lower'],['First Pass Yield % (Prime%)','first_pass_yield_pct',true,'higher'],['Reject % Qty','reject_pct_qty',true,'lower'],['Output Qty (MT)','output_qty',false,'higher'],['Coils','coils',false,'higher']];
  const cell=(m,row)=>m[2] ? (Number(row?.[m[1]]||0)*100).toFixed(2)+'%' : Number(row?.[m[1]]||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const delta=(m)=>{if(!prev)return '—'; const a=Number(prev[m[1]]||0),b=Number(cur[m[1]]||0),diff=b-a; if(m[2]){const pp=diff*100; const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(pp)<0.005?'equal':good?'good':'bad'}">${pp>=0?'+':''}${pp.toFixed(2)} pp ${Math.abs(pp)<0.005?'→':good?'↑':'↓'}</span>`;} const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(diff)<0.000001?'equal':good?'good':'bad'}">${diff>=0?'+':''}${diff.toFixed(2)} ${Math.abs(diff)<0.000001?'→':good?'↑':'↓'}</span>`;};
  el.innerHTML=`<table class="qcr-compare"><thead><tr><th>Metric</th><th>${escQcr(prev?prev.name:'Previous')}</th><th>${escQcr(cur.name)}</th><th>Change</th></tr></thead><tbody>${metrics.map(m=>`<tr><td>${m[0]}</td><td>${prev?cell(m,prev):'—'}</td><td>${cell(m,cur)}</td><td>${delta(m)}</td></tr>`).join('')}</tbody></table>`;
}
const qcrCoreCache = new Map();
window.qcrLoadToken=0;
function qcrCacheKey(filters){ return new URLSearchParams(filters).toString(); }
function qcrSessionKey(filters){ return 'qcr_last_good_v28_' + qcrCacheKey(filters); }
async function fetchQcrCore(filters, signal){
  const key=qcrCacheKey(filters); const cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return cached.data;
  const params=new URLSearchParams(filters).toString();
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch('/api/qcr?'+params+'&_qcr=28&_attempt='+(attempt+1),{signal,cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
      let data=null;
      try{data=await r.json();}catch(e){throw new Error('QCR server returned invalid JSON (HTTP '+r.status+')');}
      if(!r.ok || data?.error) throw new Error(data?.error || ('QCR request failed (HTTP '+r.status+')'));
      if(!data || !data.k || !data.d || !data.w){throw new Error('QCR response is incomplete');}
      qcrCoreCache.set(key,{ts:Date.now(),data});
      if(qcrCoreCache.size>15){
        const now=Date.now();
        for(const [k,v] of qcrCoreCache){
          if(now-v.ts>60000) qcrCoreCache.delete(k);
        }
        if(qcrCoreCache.size>15){
          const oldest=[...qcrCoreCache.entries()].sort((a,b)=>a[1].ts-b[1].ts)[0];
          if(oldest) qcrCoreCache.delete(oldest[0]);
        }
      }
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
      if(qcrCoreCache.size>15){
        const now=Date.now();
        for(const [k,v] of qcrCoreCache){
          if(now-v.ts>60000) qcrCoreCache.delete(k);
        }
        if(qcrCoreCache.size>15){
          const oldest=[...qcrCoreCache.entries()].sort((a,b)=>a[1].ts-b[1].ts)[0];
          if(oldest) qcrCoreCache.delete(oldest[0]);
        }
      }
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
    if(recent.length<3){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Need at least 3 monthly periods for trend intelligence.')+'</div>';return;}
    const fpy=recent.map(r=>Number(r.first_pass_yield_pct)||0), rej=recent.map(r=>Number(r.reject_pct_qty)||0);
    const slope=a=>{const n=a.length,xm=(n-1)/2,ym=a.reduce((x,y)=>x+y,0)/n,den=a.reduce((x,_,i)=>x+(i-xm)*(i-xm),0);return den? a.reduce((x,y,i)=>x+(i-xm)*(y-ym),0)/den:0;};
    const sf=slope(fpy),sr=slope(rej),deteriorating=sf<-0.001||sr>0.001,stable=!deteriorating&&Math.abs(sf)<0.0005&&Math.abs(sr)<0.0005;
    const status=deteriorating?'⚠️ Deteriorating Trend':stable?'✓ Stable Trend':'↕ Mixed Trend',cls=deteriorating?'bad':stable?'good':'amber',next=Math.max(0,Math.min(1,fpy[fpy.length-1]+sf));
    // Contributors (Grade/Defect/Work Center) are intentionally not repeated
    // here — they're already ranked in "Top Contributors" above.
    el.innerHTML=`<div class="qcr-intel-status ${cls}">${status}</div><div class="qcr-intel-main">FPY ${ (fpy[fpy.length-1]*100).toFixed(2)}% <span>→ projected ${(next*100).toFixed(2)}%</span></div><div class="qcr-intel-meta">Last ${recent.length} months: ${recent.map(r=>escQcr(r.name)).join(' → ')}</div><div class="qcr-intel-meta">${sf<0?'FPY is trending down.':'FPY is not declining.'} ${sr>0?'Reject % is increasing.':'Reject % is not increasing.'}</div>`;
  }catch(e){console.error('QCR trend intelligence',e);el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Trend intelligence unavailable.',null,'error')+'</div>';}
}
document.getElementById('qcrRootCause')?.addEventListener('click',e=>{const b=e.target.closest('.qcr-root-link');if(!b)return; const container=document.getElementById('qcrRootCause'); const defect=container?.dataset.defect||''; openDrilldown('defect_category',`Root Cause: ${b.dataset.rootGrade||'—'} → ${b.dataset.rootWc||'—'}`,{drill_value:defect,grade:b.dataset.rootGrade||'All',work_center:b.dataset.rootWc||'All'});});
function loadRootCause(defect){
  const el=document.getElementById('qcrRootCause'); if(!el||!defect)return Promise.resolve(); el.innerHTML='<div class="qcr-empty">'+loadingStateMarkup('Loading root-cause path…')+'</div>';
  // The defect this panel is currently showing has to be recoverable later
  // when a path button is clicked (see the click handler below) — stash it
  // on the container itself instead of relying on a CSS class that was
  // never actually present in the rendered markup.
  el.dataset.defect=defect;
  const p=new URLSearchParams(currentFilters);p.set('defect',defect); return fetch('/api/root_cause?'+p.toString(),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error)throw new Error(d.error); const paths=d.paths||[]; const rec=d.records||[];
    const top=paths[0]; let html=`<div class="qcr-root-title">${escQcr(defect)}</div>`;
    if(top) html+=`<div class="qcr-root-path"><span>Defect<br><b>${escQcr(defect)}</b></span><i>→</i><span>Grade<br><b>${escQcr(top.grade)}</b></span><i>→</i><span>Work Center<br><b>${escQcr(top.work_center)}</b></span><i>→</i><span>Heat / Batch<br><b>${escQcr(rec[0]?.heat_no||'—')} / ${escQcr(rec[0]?.batch_no||'—')}</b></span></div>`;
    html+=`<div class="qcr-root-meta">Top contributing combinations — click to investigate records</div><div class="qcr-root-list">${paths.slice(0,6).map((x,i)=>`<button class="qcr-root-link" data-root-grade="${escQcr(x.grade)}" data-root-wc="${escQcr(x.work_center)}"><b>#${i+1} ${escQcr(x.grade)}</b><span>${escQcr(x.work_center)} • ${x.qty.toFixed(2)} MT • ${x.coils.toLocaleString()} coils</span></button>`).join('')}</div>`;
    el.innerHTML=html;
    // innerHTML replacement above wipes any dataset previously set on `el`
    // itself? No — dataset lives on the element node, not its innerHTML, so
    // it survives. Kept here as a defensive re-set in case that ever changes.
    el.dataset.defect=defect;
  }).catch(()=>{el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Root-cause data unavailable.',null,'error')+'</div>';});
}
// NOTE: Grade Concentration and "Why changed?" used to also be computed here
// via extra client-side API calls. That logic is dead weight now — the
// consolidated intel endpoint (qcrRenderWhyDecomposition + the grade
// concentration block in loadControlRoom) already provides a richer version
// of the same insight, so the duplicate implementation was removed.
function escQcr(v){return String(v??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function qcrRenderProblemFinder(intel, intelError){
  const el=document.getElementById('qcrProblemFinder'), count=document.getElementById('qcrProblemCount'); if(!el)return;
  // An intel_error means the engine that finds problems never actually ran
  // for this request — so there is no confirmed "no issues" result to
  // report. Saying "0 issues / ✓ No material quality problem detected" here
  // reads as a completed, reassuring analysis and directly contradicts the
  // Biggest Problem card showing "Analysis unavailable" right above it.
  if(intelError){
    if(count){count.textContent='Unavailable';}
    el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Quality analysis could not run for this request.','This is a temporary error, not a confirmed zero-issue result — refresh to retry.','error')+'</div>';
    return;
  }
  const all=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const rows=all.slice(0,5);
  const critCount=all.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const shownNote=all.length>rows.length?` · top ${rows.length} shown`:'';
  if(count)count.textContent=all.length?(critCount>0?`${critCount} critical issue${critCount===1?'':'s'}${shownNote}`:`${all.length} issue${all.length===1?'':'s'}${shownNote}`):'0 issues';
  if(!rows.length){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No material quality problem detected for the current selection.','Continue monitoring.','success')+'</div>';return;}
  el.innerHTML=rows.map((x,i)=>{
    const sev=String(x.severity||'Observation').toUpperCase(); const conf=String(x.confidence||'MEDIUM').toUpperCase();
    const driver=x.driver_path||x.where||'—'; const change=x.change|| (x.impact_qty?`${Number(x.impact_qty).toFixed(2)} MT`:'—');
    return `<div class="qcr-problem-row ${sev.toLowerCase()}"><div class="qcr-problem-rank">${i+1}</div><div class="qcr-problem-main"><b>${escQcr(x.title||x.what||'Quality issue')}</b><span>${escQcr(x.detail||'Material quality signal detected.')}</span><div class="qcr-problem-fields"><span><small>DRIVER</small>${escQcr(driver)}</span><span><small>CHANGE</small>${escQcr(change)}</span><span><small>CONFIDENCE</small>${conf} · ${Number(x.records||0).toLocaleString()} records</span></div></div><div class="qcr-problem-action"><em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em><button class="qcr-investigate-btn" type="button" data-qcr-where="${escQcr(x.where||'')}" data-qcr-grade="${escQcr(x.grade||'')}" data-qcr-defect="${escQcr(x.defect||'')}" data-qcr-period="${escQcr(x.period||'')}">Investigate →</button></div></div>`;
  }).join('');
}

function qcrRenderQualityStory(intel, intelError){
  // Where/Grade/Defect/Confidence used to repeat here as pill tags, but that's
  // the exact same info already shown in the "What Needs Attention" row right
  // above this card — dropped to avoid saying the same thing twice.
  const el=document.getElementById('qcrQualityStory');if(!el)return;
  if(intelError){
    // Surface the actual server-side error (truncated server-side to 240
    // chars already) instead of a generic message, so a recurring failure
    // is diagnosable from the page itself rather than requiring server logs.
    el.innerHTML=`<div class="qcr-story-label">📋 Quality Story</div><div class="qcr-story-text">Unavailable — the analysis engine hit a temporary error and will retry automatically on next refresh.</div><div class="qcr-story-text" style="margin-top:6px;font-family:monospace;font-size:11px;opacity:.65;">${escQcr(intelError)}</div>`;
    return;
  }
  const story=String(intel?.quality_story||'No quality story available.');
  el.innerHTML=`<div class="qcr-story-label">📋 Quality Story</div><div class="qcr-story-text">${escQcr(story)}</div>`;
}
function qcrRenderQualityImprovements(intel){
  // Compact single line under the Quality Story — no longer a whole extra
  // card of its own; the improvement names/details were the only new
  // information here, so we keep just that, in one line.
  const el=document.getElementById('qcrQualityImprovements');if(!el)return;const rows=Array.isArray(intel?.improvements)?intel.improvements:[];
  if(!rows.length){el.innerHTML='';return;}
  el.innerHTML=`<span class="qcr-improving-label">🟢 Improving:</span> `+rows.slice(0,3).map(x=>`<b>${escQcr(x.name||'Quality improvement')}</b> <small>(${escQcr(x.detail||'positive movement')})</small>`).join(' • ');
}
function qcrRenderWhyDecomposition(intel){
  // Trimmed to the two headline deltas + the one-line explanation — the
  // Grade/Defect/Work Center names it used to repeat here are already
  // ranked in "Top Contributors" above, so they're not re-listed.
  const el=document.getElementById('qcrWhyChanged');if(!el)return; const z=intel?.why_changed;
  if(!z||!z.current||!z.previous){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Previous period comparison is not available for this selection.')+'</div>';return;}
  el.innerHTML=`<div class="qcr-why-grid"><div><b>FPY ${Number(z.fpy_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.fpy_change_pp||0)).toFixed(2)} pp</b></div><div><b>Reject ${Number(z.reject_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.reject_change_pp||0)).toFixed(2)} pp</b></div></div><div class="qcr-story-text">${escQcr(z.statement||'')}</div>`;
}
function qcrInvestigation(extra={}, title='QCR Investigation'){
  const p={};
  Object.entries(extra||{}).forEach(([k,v])=>{
    if(v===undefined||v===null) return;
    const s=String(v).trim();
    if(!s || s==='—') return;
    // "month" is allowed through even when explicitly "All" — What Needs
    // Attention findings are computed independently of the currently
    // selected month filter, so an explicit month override (including a
    // reset to "All") must not be silently dropped, or the investigate
    // drilldown ends up combining a finding's Work Center/Grade/Defect with
    // an unrelated month and returns zero records.
    if(k!=='month' && s.toLowerCase()==='all') return;
    p[k]=v;
  });
  openDrilldown('quality_investigation',title,p);
}
function qcrWireProblemActions(){
  document.getElementById('qcrProblemFinder')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-investigate-btn'); if(!b)return;
    const defect=b.dataset.qcrDefect, where=b.dataset.qcrWhere, grade=b.dataset.qcrGrade, period=b.dataset.qcrPeriod;
    // Findings here are detected across the full trend history (independent
    // of whichever month happens to be selected on the page), so the
    // investigation must use the finding's own period rather than inherit
    // the page's current month filter — otherwise the two can point to
    // different months and the drilldown comes back empty.
    qcrInvestigation({work_center:where,grade,drill_value:defect,month:(period&&period!=='—'?period:'All')},`QCR Investigation — ${defect&&defect!=='—'?defect:'Quality issue'}`);
  });
  // Top Contributors: tab switching + investigate/root-cause wiring (event
  // delegation, since each tab's rows are re-rendered on every load).
  document.getElementById('qcrContribTabs')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-tab-btn'); if(!b)return;
    const tab=b.dataset.contribTab;
    document.querySelectorAll('#qcrContribTabs .qcr-tab-btn').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.qcr-tab-panel-c').forEach(p=>p.classList.toggle('qcr-hidden',p.dataset.contribPanel!==tab));
  });
  document.querySelector('.qcr-contrib-card')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-contrib-btn'); if(!b)return;
    if(b.dataset.defect){ loadRootCause(b.dataset.defect); return; }
    if(b.dataset.qcrWc){ qcrInvestigation({work_center:b.dataset.qcrWc},`Work Center Investigation — ${b.dataset.qcrWc}`); return; }
    if(b.dataset.qcrGrade){ qcrInvestigation({grade:b.dataset.qcrGrade},`Grade Investigation — ${b.dataset.qcrGrade}`); return; }
  });
  // Quality Health "Why?" toggle in the executive strip (replaces the old
  // standalone Quality Health Score card — same reasons, one click away).
  document.getElementById('qcrHealthWhyBtn')?.addEventListener('click',()=>{
    const box=document.getElementById('qcrHealthReasons'); if(!box)return;
    const nowHidden=box.classList.toggle('qcr-hidden');
    const btn=document.getElementById('qcrHealthWhyBtn'); if(btn)btn.textContent=nowHidden?'Why? ▾':'Why? ▴';
  });
}
function qcrRenderTargetHistory(rows,target){
  const el=document.getElementById('qcrTargetHistory'); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No historical monthly data available.')+'</div>';return;}
  el.innerHTML=`<div class="qcr-target-summary">Target <b>${(Number(target||0)*100).toFixed(1)}%</b> • % Target Achieved shows how much of the target was reached each period (100% = target fully met)</div><div class="qcr-target-table"><table class="qcr-compare"><thead><tr><th>Period</th><th>Target</th><th>Actual</th><th>% Target Achieved</th><th>Gap</th></tr></thead><tbody>${rows.map(r=>{const a=Number(r.actual||0),t=Number(r.target||0),att=Number(r.attainment||0);const cls=att>=0.97?'good':att>=0.90?'amber':'bad';return `<tr><td>${escQcr(r.period)}</td><td>${(t*100).toFixed(1)}%</td><td>${(a*100).toFixed(2)}%</td><td><span class="qcr-delta ${cls}">${(att*100).toFixed(1)}%</span></td><td>${Number(r.gap_pp||0)>=0?'+':''}${Number(r.gap_pp||0).toFixed(2)} pp</td></tr>`}).join('')}</tbody></table></div>`;
}

function qcrRenderExecutive(intel, critical, comparisonRows, intelError){
  const health=intel?.health_score||{}; const h=Number(health.score||0); const pf=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const crit=pf.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const top=pf[0];
  const prev=comparisonRows?.length>1?comparisonRows[comparisonRows.length-2]:null, cur=comparisonRows?.length?comparisonRows[comparisonRows.length-1]:null;
  let trend='●', trendText='Stable', trendClass='neutral';
  if(prev&&cur){const a=Number(prev.fpy||prev.fpy_pct||0),b=Number(cur.fpy||cur.fpy_pct||0);if(b<a){trend='▼';trendText='Quality declining';trendClass='bad';}else if(b>a){trend='▲';trendText='Quality improving';trendClass='good';}}
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const breaches=critical.filter(k=>{const s=qcrStatus(k.label,k.value);return s==='amber'||s==='bad';}).length;
  if(intelError){
    set('qcrExecHealth','—/100');set('qcrExecHealthState','Unavailable');
    set('qcrExecCritical','—');set('qcrExecBreaches',breaches);
    set('qcrExecProblem','Analysis unavailable');set('qcrExecDriver',(String(intelError).slice(0,90))||'Temporary error — refresh to retry');
    set('qcrExecTrend','●');set('qcrExecTrendText','Unavailable');
    const trendEl=document.getElementById('qcrExecTrend'); if(trendEl)trendEl.className='qcr-trend-symbol neutral';
    return;
  }
  set('qcrExecHealth',`${h.toFixed(0)}/100`);set('qcrExecHealthState',health.status==='good'?'Healthy':health.status==='bad'?'Critical':'Attention');set('qcrExecCritical',crit);set('qcrExecBreaches',breaches);set('qcrExecProblem',top?.title||'No material issue');set('qcrExecDriver',top?.driver_path||top?.where||'Continue monitoring');set('qcrExecTrend',trend);set('qcrExecTrendText',trendText);
  const trendEl=document.getElementById('qcrExecTrend'); if(trendEl)trendEl.className='qcr-trend-symbol '+trendClass;
}
async function loadControlRoom(signal){
  const filterSnapshot={...currentFilters};
  const params=new URLSearchParams(filterSnapshot).toString();
  try{
    const data=await fetchQcrCore(filterSnapshot,signal); const {k,d,w,m,fr}=data;
    document.getElementById('qcrFreshness').textContent=`Data Through: ${fr.data_through_display||'—'} • Filtered Records: ${Number(fr.filtered_records||0).toLocaleString()}`;
    const dssThrough=document.getElementById('statusDataThrough'); if(dssThrough) dssThrough.textContent=fr.data_through_display||'—';
    const criticalLabels=['First Pass Yield % (Prime%)','Defect Rate','Reject % Qty','Hold for Decision % Qty','Salvage % Qty','Rework % Qty'];
    const critical=(k.kpis||[]).filter(x=>criticalLabels.includes(x.label));
    // Worst-first ordering + inline target/gap folds in what used to be a
    // separate "KPI Target Intelligence" ranking card — same numbers, one place.
    const qcrStatusOrder={bad:0,amber:1,good:2,neutral:3};
    const criticalSorted=[...critical].sort((a,b)=>(qcrStatusOrder[qcrStatus(a.label,a.value)]??3)-(qcrStatusOrder[qcrStatus(b.label,b.value)]??3));
    const qcrGrid=document.getElementById('qcrCriticalKpis');
    const nextQcrValues=new Map(); qcrGrid.innerHTML='';
    criticalSorted.forEach(x=>{
      const st=qcrStatus(x.label,x.value), cur=Number(x.value)||0, old=window.qcrPreviousKpiValues?.get(x.label);
      const changed=Number.isFinite(old)&&Math.abs(old-cur)>1e-12;
      const card=document.createElement('div'); card.className='qcr-kpi';
      const cfg=KPI_TARGETS[x.label];
      const targetLine=(cfg&&cfg.target!=null)?`<div class="qcr-kpi-target">Target ${qcrTargetText(x.label)} • Gap ${((cur-Number(cfg.target))*100)>=0?'+':''}${((cur-Number(cfg.target))*100).toFixed(3)} pp</div>`:'';
      card.innerHTML=`<div class="qcr-kpi-name">${KPI_ICONS[x.label]||'📊'} ${escQcr(x.label)}</div><div class="qcr-kpi-value ${st}">${qcrFmtKpi(x)}</div>${targetLine}<span class="qcr-status ${st}">${st==='good'?'ON TARGET':st==='amber'?'WATCH':st==='bad'?'CRITICAL':'REFERENCE'}</span>`;
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

    const defectTotalQty=Number(d.totals?.qty||0); const topDefects=(d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>Number(b.qty||0)-Number(a.qty||0)).slice(0,5);
    const worstWc=[...(w.by_work_center||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    const worstGr=[...(w.by_grade||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    // All QCR intelligence is now returned by the consolidated endpoint so these
    // sections never depend on a chain of secondary browser requests.
    qcrRenderComparison((m&&m.rows)||[]);
    qcrRenderExecutive(data?.intel||{},critical,(m&&m.rows)||[],data?.intel_error||'');
    qcrRenderTrendPrediction((m&&m.rows)||[],d,w);
    fetch('/api/qcr_target_history?'+params,{signal}).then(r=>r.json()).then(th=>{if(!th.error){qcrRenderTargetHistory(th.rows||[],th.target); scheduleQcrLayout();}}).catch(()=>{});
    const intel=data?.intel||{}; const intelErr=data?.intel_error||'';
    qcrRenderProblemFinder(intel,intelErr);
    qcrRenderQualityStory(intel,intelErr);
    qcrRenderQualityImprovements(intel);
    qcrRenderWhyDecomposition(intel);
    qcrRenderHealthReasons(intel);
    qcrRenderTopContributors(topDefects,defectTotalQty,worstWc,worstGr,intel);
    ++window.qcrLoadToken;
    if(topDefects[0]?.defect) loadRootCause(topDefects[0].defect).finally(scheduleQcrLayout);

    markChartsReady();
    scheduleQcrLayout();
  }catch(e){
    if(e.name!=='AbortError'){
      console.error('QCR load failed',e);
      const msg=String(e?.message||'Unable to load Control Room data');
      const ids=['qcrProblemFinder','qcrQualityStory','qcrQualityImprovements','qcrCriticalKpis','qcrContribDefect','qcrContribWc','qcrContribGrade','qcrComparison','qcrWhyChanged','qcrTrendPrediction','qcrTargetHistory'];
      ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Unable to load this QCR section.',escQcr(msg),'error',{rawSub:true})+'</div>';});
      const root=document.getElementById('qcrRootCause');if(root)root.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('Root-cause data unavailable until QCR data reconnects.',null,'error')+'</div>';
      const qs=document.getElementById('qcrQualityStatus');if(qs){qs.className='qcr-quality-status amber';const st=qs.querySelector('strong');if(st)st.textContent='UNAVAILABLE';}
    }
  }
}

