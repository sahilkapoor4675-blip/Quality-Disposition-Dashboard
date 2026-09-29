/* 17-qcr-contributors.js — Quality Control Room: status helpers, top contributors. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------- Tab: Quality Control Room ----------
function qcrStatus(label, value){
  const c=KPI_TARGETS[label]; if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  return v>=t?'good':v>=w?'amber':'bad';
}
function qcrFmtKpi(k){ return k.fmt==='pct' ? (Number(k.value||0)*100).toFixed(3)+'%' : k.fmt==='int' ? Math.round(Number(k.value||0)).toLocaleString() : Number(k.value||0).toFixed(3); }
function qcrTargetText(label){ const c=KPI_TARGETS[label]; if(!c)return 'Target not set'; return `${c.direction==='lower'?'≤':'≥'} ${fmtTarget(c.target,'pct')}`; }
// Top Contributors: Defects / Work Centers / Grades in one tabbed card.
// Replaces the old separate Top 5 Defects, Worst Work Centers, Worst Grades,
// Grade Concentration, Work Center & Grade Risk and Recurring Quality
// Problems cards — same underlying rows, shown once each, with a
// "Recurring" / risk badge inline instead of a whole extra card.
function qcrRenderContribPanel(id, rows, kind, meta){
  const el=document.getElementById(id); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No data available for current selection.')+'</div>';return;}
  el.innerHTML=rows.map((r,i)=>{
    let name,metricText,sev,attrs,action,badges='';
    if(kind==='defect'){
      name=String(r.defect??'—'); const qty=Number(r.qty||0); const pct=meta.total?qty/meta.total:0;
      sev=pct>=0.35?'CRITICAL':pct>=0.20?'ATTENTION':'NORMAL';
      metricText=`${qty.toFixed(2)} MT • ${(pct*100).toFixed(2)}% of defect qty • ${Number(r.records||0).toLocaleString()} coils`;
      attrs=`data-defect="${escQcr(name)}"`; action='View Pareto';
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
    }else{
      name=String(r.name??'—'); const reject=Number(r.reject_pct_qty||0), coils=Number(r.coils||0);
      sev=reject>=0.05?'CRITICAL':reject>=0.03?'ATTENTION':'NORMAL';
      metricText=`${(reject*100).toFixed(2)}% Reject${coils?` • ${coils.toLocaleString()} coils`:''}`;
      attrs= kind==='wc' ? `data-qcr-wc="${escQcr(name)}"` : `data-qcr-grade="${escQcr(name)}"`;
      action= kind==='wc' ? `Investigate ${escQcr(name)}` : `Review ${escQcr(name)}`;
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
      const risk=meta.risk?meta.risk[name]:null; if(risk&&risk!=='Low') badges+=`<span class="qcr-badge qcr-badge-risk-${risk.toLowerCase()}">${risk} risk</span>`;
    }
    return `<div class="qcr-ranked-row"><div class="qcr-rank">${i+1}</div><div class="qcr-ranked-main"><b>${escQcr(name)}</b><span>${metricText}</span>${badges?`<div class="qcr-badges">${badges}</div>`:''}<em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em></div><button class="qcr-mini-investigate qcr-contrib-btn" type="button" ${attrs}>${action} →</button></div>`;
  }).join('');
}
function qcrRenderTopContributors(topDefects, defectTotalQty, worstWc, worstGr, intel){
  const patterns=Array.isArray(intel?.recurring_patterns)?intel.recurring_patterns:[];
  const recDefects=new Set(patterns.map(x=>x.defect).filter(Boolean));
  const recWc=new Set(patterns.map(x=>x.work_center).filter(Boolean));
  const recGrade=new Set(patterns.map(x=>x.grade).filter(Boolean));
  const riskWc={}; (intel?.risk_matrix?.work_centers||[]).forEach(x=>{riskWc[x.name]=x.risk;});
  const riskGrade={}; (intel?.risk_matrix?.grades||[]).forEach(x=>{riskGrade[x.name]=x.risk;});
  qcrRenderContribPanel('qcrContribDefect', topDefects, 'defect', {total:defectTotalQty, recurring:recDefects});
  qcrRenderContribPanel('qcrContribWc', worstWc, 'wc', {recurring:recWc, risk:riskWc});
  qcrRenderContribPanel('qcrContribGrade', worstGr, 'grade', {recurring:recGrade, risk:riskGrade});
  qcrLoadFishbone(topDefects);
  const footer=document.getElementById('qcrContribFooter');
  if(footer){
    const gc=Array.isArray(intel?.grade_concentration)?intel.grade_concentration:[]; const top=gc[0];
    footer.innerHTML=top?`<div class="qcr-hot-combo">🔥 Hottest combination: <b>${escQcr(top.grade||'—')}</b> grade • <b>${escQcr(top.defect||'—')}</b> defect • <b>${escQcr(top.wc||'—')}</b> work center — ${(Number(top.reject_pct||0)*100).toFixed(2)}% reject</div>`:'';
  }
}
