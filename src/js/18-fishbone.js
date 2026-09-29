/* 18-fishbone.js — 6M Fishbone (QCR + Dashboard) and RCA panel. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------- 6M Fishbone Analysis (Top Contributors → 6M Fishbone tab) ----------
// Pulls Man/Machine/Material/Method/Measurement/Environment causes for the
// current Top 5 Defects from /api/fishbone, which matches disposition
// defect names against the admin-imported 6M Fishbone Master workbook.
let qcrFishboneData = {items:[]};
// 6M category style (icon + color), imported from the workbook's own "Icon
// Color Coding" sheet via /api/fishbone. Falls back to these defaults until
// the first successful fetch fills it in, so nothing breaks on first paint.
let FISHBONE_STYLE = {
  man:         {label:'Man',         icon:'👤', color:'#118DFF'},
  machine:     {label:'Machine',     icon:'⚙️', color:'#16A34A'},
  material:    {label:'Material',    icon:'📦', color:'#D97706'},
  method:      {label:'Method',      icon:'📋', color:'#7C3AED'},
  measurement: {label:'Measurement', icon:'📏', color:'#DB2777'},
  environment: {label:'Environment', icon:'🌍', color:'#0891B2'},
};
function fbStyle(key){ return FISHBONE_STYLE[key] || {label:key,icon:'',color:'#64748B'}; }
function qcrRenderFishboneChips(items){
  const chipsEl=document.getElementById('qcrFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
function qcrFishboneCard(field,items){
  const st=fbStyle(field);
  const list=Array.isArray(items)?items:(items?[items]:[]);
  const body=list.length?`<ul class="qcr-fb-ul">${list.map(t=>`<li>${escQcr(t)}</li>`).join('')}</ul>`:'<div class="qcr-fb-empty">No cause on file</div>';
  return `<div class="qcr-fb-branch qcr-fb-${field}" style="--fb-color:${st.color}"><div class="qcr-fb-head"><span class="qcr-fb-icon">${st.icon}</span>${escQcr(st.label)}<span class="qcr-fb-count">${list.length||''}</span></div>${body}</div>`;
}
// Root Cause Analysis (5-Why + CAPA) table for whichever 6M categories have
// RCA data on file for the selected defect — sits under the fishbone diagram
// in both the QCR tab and the Dashboard tab (same underlying /api/fishbone data).
function renderRcaPanel(item){
  const rca = item && item.rca; if(!rca || !Object.keys(rca).length) return '';
  const order=['man','machine','material','method','measurement','environment'];
  const available = order.filter(k=>Array.isArray(rca[k]) && rca[k].length);
  if(!available.length) return '';
  // Each 6M category (Man/Machine/Material/...) can carry MORE THAN ONE
  // Why-Why/root-cause entry (e.g. two separate "Man" causes for the same
  // defect) — every entry imported for that category is rendered as its
  // own row, with the category chip row-spanned across them so it's clear
  // they all belong to the same 6M bucket.
  const rows = available.map(k=>{
    const st=fbStyle(k), entries=rca[k];
    return entries.map((r,i)=>{
      const chain=(r.why_chain||[]).map(escQcr).join(' <span class="qcr-rca-arrow">→</span> ');
      const catCell = i===0 ? `<td rowspan="${entries.length}"><span class="qcr-rca-chip" style="background:${st.color}">${st.icon} ${escQcr(st.label)}</span>${entries.length>1?`<div class="qcr-rca-count">${entries.length} causes</div>`:''}</td>` : '';
      return `<tr data-cause="${k}">
        ${catCell}
        <td class="qcr-rca-chain">${chain||'—'}</td>
        <td><b>${escQcr(r.root_cause)}</b></td>
        <td>${escQcr(r.action)}</td>
        <td>${escQcr(r.preventive_action)}</td>
        <td>${[r.role,r.responsibility].filter(Boolean).map(escQcr).join(' / ')||'—'}</td>
      </tr>`;
    }).join('');
  }).join('');
  if(!rows) return '';
  const causeOptions = ['<option value="all">All Causes</option>'].concat(
    available.map(k=>{const st=fbStyle(k); return `<option value="${k}">${st.icon} ${escQcr(st.label)} (${rca[k].length})</option>`;})
  ).join('');
  return `<div class="qcr-rca-panel">
    <div class="qcr-rca-head-row">
      <div class="qcr-fb-title">🧭 Root Cause Analysis (RCA) — ${escQcr(item.defect)}</div>
      <label class="qcr-rca-filter-label">Filter by Cause:
        <select class="qcr-rca-cause-filter" aria-label="Filter RCA by 6M cause category">${causeOptions}</select>
      </label>
    </div>
    <div class="qcr-rca-table-wrap"><table class="qcr-rca-table">
      <thead><tr><th>6M Category</th><th>5-Why Chain</th><th>Root Cause</th><th>Action</th><th>Preventive Action</th><th>Role / Responsibility</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
// Delegated listener: filtering by cause only ever hides/shows <tr> rows
// already rendered above, so it works no matter how many times the RCA
// panel gets re-rendered (new defect selected, filters changed, etc.).
document.addEventListener('change', e=>{
  const sel = e.target.closest('.qcr-rca-cause-filter'); if(!sel) return;
  const panel = sel.closest('.qcr-rca-panel'); if(!panel) return;
  const val = sel.value;
  panel.querySelectorAll('tbody tr[data-cause]').forEach(tr=>{
    tr.style.display = (val==='all' || tr.dataset.cause===val) ? '' : 'none';
  });
});
function qcrRenderFishboneDiagram(item){
  const el=document.getElementById('qcrFishboneDiagram'); if(!el) return;
  if(!item){ el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No defect selected.')+'</div>'; return; }
  if(!item.matched){
    el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup(`No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet.`, 'Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.', 'empty', {rawTitle:true})+'</div>';
    return;
  }
  const c=item.causes||{};
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  el.innerHTML = `
    <div class="qcr-fb-title">🐟 6M Fishbone — ${escQcr(item.defect)}</div>
    ${note}
    <div class="qcr-fb-grid">
      ${qcrFishboneCard('man',c.man)}
      ${qcrFishboneCard('machine',c.machine)}
      ${qcrFishboneCard('material',c.material)}
      ${qcrFishboneCard('method',c.method)}
      ${qcrFishboneCard('measurement',c.measurement)}
      ${qcrFishboneCard('environment',c.environment)}
    </div>
    <div class="qcr-fb-spine"><span>${escQcr(item.defect)}</span></div>
    ${renderRcaPanel(item)}`;
}
function qcrLoadFishbone(topDefects){
  const chipsEl=document.getElementById('qcrFishboneChips'), diagEl=document.getElementById('qcrFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No defect data available for the current selection.')+'</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">'+loadingStateMarkup('Loading 6M fishbone analysis…')+'</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    if(d.style) FISHBONE_STYLE=Object.assign({},FISHBONE_STYLE,d.style);
    qcrFishboneData=d;
    qcrRenderFishboneChips(d.items||[]);
    qcrRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('6M fishbone data unavailable.',null,'error')+'</div>'; });
}
document.getElementById('qcrFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#qcrFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  qcrRenderFishboneDiagram((qcrFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
// ---------- 6M Fishbone Analysis (Dashboard tab → below Top 5 Defects Pareto) ----------
// Same /api/fishbone source as the Quality Control Room tab, but driven by the
// Dashboard's own filtered Top 5 Defects (data.top_defects from /api/kpis), so it
// reacts to every filter change on the Dashboard tab independently of the QCR tab.
let dashFishboneData = {items:[]};
function dashRenderFishboneChips(items){
  const chipsEl=document.getElementById('dashFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
// True Ishikawa/fishbone skeleton (spine + 6 angled bones converging on the
// defect "head"), built as one SVG — as opposed to the qcr-fb-grid card
// layout used on the Quality Control Room tab. Same underlying causes data.
// Design goals: show EVERY cause (no 5-item cap, no truncation) and never let
// text collide — font-size auto-shrinks and wraps per label, and the whole
// diagram's height auto-grows to fit however many causes a branch has.
function fbList(v){ return Array.isArray(v) ? v.filter(x=>x!==null && x!==undefined && String(x).trim()!=='') : (v?[v]:[]); }
// Wrap `text` into at most `maxLines` lines of at most `maxChars` each
// (word-based). Only the last resort truncates (with an ellipsis) if even
// after the max number of lines the text still won't fit.
function fbWrapGeneric(text,maxChars,maxLines){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean);
  const lines=[]; let cur='';
  for(const w of words){
    if(!cur){ cur=w; continue; }
    if((cur+' '+w).length<=maxChars) cur=cur+' '+w;
    else { lines.push(cur); cur=w; }
  }
  if(cur) lines.push(cur);
  if(!lines.length) lines.push('');
  if(lines.length>maxLines){
    const head=lines.slice(0,maxLines-1);
    let rest=lines.slice(maxLines-1).join(' ');
    if(rest.length>maxChars) rest=rest.slice(0,Math.max(1,maxChars-1))+'…';
    head.push(rest);
    return head;
  }
  return lines;
}
// Fit `text` into a box of width `boxW`: keep a single, CONSISTENT font size
// for every label (so no cause looks bigger/smaller than another) and wrap
// across up to `maxLines` lines to make long text fit instead of shrinking
// it. Only shrinks as a last resort, if even wrapping can't make it fit.
function fbFitBox(text, boxW, opts){
  const o=Object.assign({pad:14, baseSize:13, minSize:9.5, maxLines:2, charW:0.66, lineH:1.2}, opts||{});
  text=String(text||'').trim();
  const avail=Math.max(24, boxW-o.pad);
  const fs=o.baseSize;
  if(text.length*fs*o.charW<=avail) return {fontSize:fs, lines:[text], lineHeight:fs*o.lineH};
  const maxChars=Math.max(4,Math.floor(avail/(fs*o.charW)));
  const lines=fbWrapGeneric(text,maxChars,o.maxLines);
  if(lines.every(l=>l.length*fs*o.charW<=avail)) return {fontSize:fs, lines, lineHeight:fs*o.lineH};
  for(let fs2=fs-0.5; fs2>=o.minSize; fs2-=0.5){
    const maxChars2=Math.max(4,Math.floor(avail/(fs2*o.charW)));
    const lines2=fbWrapGeneric(text,maxChars2,o.maxLines);
    if(lines2.every(l=>l.length*fs2*o.charW<=avail)) return {fontSize:fs2, lines:lines2, lineHeight:fs2*o.lineH};
  }
  const fsMin=o.minSize, maxCharsMin=Math.max(4,Math.floor(avail/(fsMin*o.charW)));
  return {fontSize:fsMin, lines:fbWrapGeneric(text,maxCharsMin,o.maxLines), lineHeight:fsMin*o.lineH};
}
// Evenly spread n points along the usable middle span of a bone (leaving
// a little clearance near the spine and near the category label box).
function fbSpreadT(n){
  if(n<=1) return [0.56];
  const startFrac=0.14, endFrac=0.82, out=[];
  for(let i=0;i<n;i++) out.push(startFrac + i*(endFrac-startFrac)/(n-1));
  return out;
}
const FISHBONE_BRANCH_DEFS = [
  {key:'man',         side:'top',    lane:0},
  {key:'machine',     side:'top',    lane:1},
  {key:'material',    side:'top',    lane:2},
  {key:'method',      side:'bottom', lane:0},
  {key:'measurement', side:'bottom', lane:1},
  {key:'environment', side:'bottom', lane:2},
];
function fishboneBranchDefs(){
  return FISHBONE_BRANCH_DEFS.map(b=>{
    const st=fbStyle(b.key);
    return Object.assign({},b,{label:st.label, icon:st.icon, color:st.color});
  });
}
// Fishbone canvas: 802 units of fixed margins/head + 2 lane gaps. At the full design
// (LANE 380) that is 1562 units, drawn at FISHBONE_PX_PER_UNIT CSS px per unit. When the
// container is narrower the lanes tighten (down to FISHBONE_LANE_MIN); below that the SVG keeps
// its natural CSS size and the card scrolls sideways, so the text never shrinks with the window
// and always follows browser zoom. `availUnits` = container width / FISHBONE_PX_PER_UNIT.
const FISHBONE_PX_PER_UNIT = 0.88, FISHBONE_LANE_MAX = 380, FISHBONE_LANE_MIN = 280, FISHBONE_FIXED_W = 802;
function buildFishboneSvg(item, availUnits){
  const causes=item.causes||{};
  const laneFor = Number.isFinite(availUnits) ? Math.floor((availUnits - FISHBONE_FIXED_W) / 2) : FISHBONE_LANE_MAX;
  const LANE=Math.max(FISHBONE_LANE_MIN, Math.min(FISHBONE_LANE_MAX, laneFor)), TIP_DX=-160, ROW_GAP=56, BOX_H=42;
  const anchors=[210, 210+LANE, 210+LANE*2];
  const spineX1=30, spineX2=anchors[2]+260;
  const headW=232;
  const availCauseW=LANE-130; // horizontal room before the next lane / head box

  // Pre-fit every cause label (per branch) so we know how tall each side
  // of the diagram actually needs to be before we draw anything.
  const branchData=fishboneBranchDefs().map(b=>{
    const list=fbList(causes[b.key]);
    const items=(list.length?list:['No cause on file']).map(txt=>({
      text:txt, missing:!list.length,
      fit:fbFitBox(txt, availCauseW, {baseSize:14, minSize:9.5, maxLines:(LANE<FISHBONE_LANE_MAX?5:3), charW:0.64})
    }));
    return Object.assign({}, b, {anchorX:anchors[b.lane], items});
  });
  const nMax=side=>Math.max(1,...branchData.filter(b=>b.side===side).map(b=>b.items.length));
  const tipDyFor=n=>Math.max(150, Math.round(ROW_GAP*(n-1)+90));
  const TIP_DY_TOP=tipDyFor(nMax('top')), TIP_DY_BOT=tipDyFor(nMax('bottom'));

  const spineY=TIP_DY_TOP+BOX_H+26;
  const H=spineY+TIP_DY_BOT+BOX_H+26;
  const W=spineX2+headW+30;

  const _fbTag = svgDepthTag();
  const branchDefs = svgDepthDefs(branchData.map(b => b.color), _fbTag);
  const fbHeadGrad = `<linearGradient id="fbHeadGrad-${_fbTag}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--fb-head);stop-opacity:1"/><stop offset="100%" style="stop-color:var(--fb-head);stop-opacity:.82"/></linearGradient>`;
  // A simple, static fish silhouette (body + tail) scaled to the diagram's own box and
  // held at very low opacity — a nod to the classic "fishbone" shape without competing
  // with the live data drawn on top of it.
  const wmCx = spineX1 + (spineX2 - spineX1) * 0.52, wmCy = spineY, wmRx = (spineX2 - spineX1) * 0.46, wmRy = Math.min(TIP_DY_TOP, TIP_DY_BOT) * 0.82;
  const watermark = `<g fill="var(--fb-spine)" fill-opacity=".05"><ellipse cx="${wmCx}" cy="${wmCy}" rx="${wmRx}" ry="${wmRy}"/><polygon points="${spineX1+8},${wmCy} ${spineX1-70},${wmCy-wmRy*0.55} ${spineX1-70},${wmCy+wmRy*0.55}"/></g>`;
  let svg=`<defs>${branchDefs.replace('<defs>','').replace('</defs>','')}${fbHeadGrad}</defs>${watermark}`;
  svg+=`<line x1="${spineX1}" y1="${spineY}" x2="${spineX2}" y2="${spineY}" stroke="var(--fb-spine)" stroke-width="3"/>`;
  svg+=`<polygon points="${spineX2},${spineY} ${spineX2-20},${spineY-13} ${spineX2-20},${spineY+13}" fill="var(--fb-spine)"/>`;

  // ---- head box (the defect / effect) ----
  const headFit=fbFitBox(item.defect, headW, {pad:22, baseSize:16, minSize:9, maxLines:4, charW:0.66, lineH:1.2});
  const headH=Math.max(80, 30+headFit.lines.length*headFit.lineHeight+18);
  const headY=spineY-headH/2;
  svg+=`<rect x="${spineX2}" y="${headY}" width="${headW}" height="${headH}" rx="12" fill="url(#fbHeadGrad-${_fbTag})" filter="${svgLift(_fbTag)}"/>`;
  const hMidOffset=(headFit.lines.length-1)*headFit.lineHeight/2;
  svg+=headFit.lines.map((ln,i)=>`<text x="${spineX2+headW/2}" y="${spineY - hMidOffset + i*headFit.lineHeight + 5}" font-size="${headFit.fontSize}" font-weight="800" fill="#fff" text-anchor="middle">${escQcr(ln)}</text>`).join('');

  // ---- 6 angled bones, each carrying every cause for that branch ----
  branchData.forEach(b=>{
    const TIP_DY = b.side==='top' ? TIP_DY_TOP : TIP_DY_BOT;
    const tipX=b.anchorX+TIP_DX, tipY = b.side==='top' ? spineY-TIP_DY : spineY+TIP_DY;
    const dx=tipX-b.anchorX, dy=tipY-spineY;
    const len=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/len, uy=dy/len;
    let px=-uy, py=ux; if(px<0){ px=uy; py=-ux; } // perpendicular leaning toward the head (right)
    svg+=`<line x1="${b.anchorX}" y1="${spineY}" x2="${tipX}" y2="${tipY}" stroke="${b.color}" stroke-width="2.5"/>`;
    svg+=`<circle cx="${b.anchorX}" cy="${spineY}" r="4" fill="${b.color}"/>`;
    const ts=fbSpreadT(b.items.length);
    b.items.forEach((it,i)=>{
      const t=ts[i];
      const bx=b.anchorX+dx*t, by=spineY+dy*t;
      const ex=bx+px*14, ey=by+py*14;
      svg+=`<line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${it.missing?'var(--fb-cause-muted-line)':b.color}" stroke-width="1.5"/>`;
      const anchor = px>=0 ? 'start':'end';
      const tx = ex + (px>=0?5:-5);
      const {fontSize,lines,lineHeight}=it.fit;
      const midOffset=(lines.length-1)*lineHeight/2;
      lines.forEach((ln,li)=>{
        svg+=`<text x="${tx}" y="${ey - midOffset + li*lineHeight + 4}" font-size="${fontSize}" font-weight="${it.missing?'600':'700'}" font-style="${it.missing?'italic':'normal'}" fill="${it.missing?'var(--fb-cause-muted)':'var(--fb-cause-text)'}" text-anchor="${anchor}">${escQcr(ln)}</text>`;
      });
    });
    const boxW=176,boxX=tipX-boxW/2, boxY=b.side==='top'?tipY-BOX_H:tipY;
    svg+=`<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${BOX_H}" rx="10" fill="${svgFill(b.color, _fbTag)}" filter="${svgLift(_fbTag)}"/>`;
    svg+=`<text x="${tipX}" y="${boxY+BOX_H/2+6}" font-size="17" font-weight="800" fill="#fff" text-anchor="middle">${b.icon} ${b.label}</text>`;
  });
  const SHIFT_X=70; // nudge the whole diagram right within its frame, per feedback
  const natW=Math.round((W+SHIFT_X)*FISHBONE_PX_PER_UNIT);
  return `<svg class="chart-svg fishbone-svg" viewBox="0 0 ${W+SHIFT_X} ${H}" style="--fb-natural-w:${natW}px" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${SHIFT_X},0)">${svg}</g></svg>`;
}
function dashRenderFishboneDiagram(item){
  const el=document.getElementById('dashFishboneDiagram'); if(!el) return;
  chartRemember(el, ()=>dashRenderFishboneDiagram(item));
  if(!item){ el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No defect data available for the current selection.')+'</div>'; return; }
  if(!item.matched){
    el.innerHTML='<div class="qcr-empty">'+emptyStateMarkup(`No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet.`, 'Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.', 'empty', {rawTitle:true})+'</div>';
    return;
  }
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  // Dashboard tab shows the fishbone diagram only — the detailed RCA
  // (5-Why / root cause / action) table stays exclusive to the QCR tab.
  const cw = chartAvailWidth(el);
  el.innerHTML = `${note}${buildFishboneSvg(item, cw ? cw / FISHBONE_PX_PER_UNIT : undefined)}`;
}
function dashLoadFishbone(topDefects){
  const chipsEl=document.getElementById('dashFishboneChips'), diagEl=document.getElementById('dashFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('No defect data available for the current selection.')+'</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">'+loadingStateMarkup('Loading 6M fishbone analysis…')+'</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    if(d.style) FISHBONE_STYLE=Object.assign({},FISHBONE_STYLE,d.style);
    dashFishboneData=d;
    dashRenderFishboneChips(d.items||[]);
    dashRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">'+emptyStateMarkup('6M fishbone data unavailable.',null,'error')+'</div>'; });
}
document.getElementById('dashFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#dashFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  dashRenderFishboneDiagram((dashFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
