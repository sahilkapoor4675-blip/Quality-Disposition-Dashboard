/* 21-chem-spc.js — "Chemistry SPC" tab: one heat = one point, big element cards (symbol + picture, Cp/Cpk/Pp/Ppk and their Std. Dev.),
   Month/Week/Quarter/Fin.Year/Grade/Parameter/Heat-Qty filters, I-MR control charts and histogram with Standard AND Aim limits + mean,
   out-of-spec heat list joined to disposition defects/rejects by heat_no.
   Bundled into /app.js in filename order; see README ("Frontend source layout"). All maths is server-side (chem_spc.py). */
const CHEM_SEL_KEY = 'qdash_chem_sel_v1';
let chemMeta = null, chemData = null;
let chemSel = { spec: '', param: 'cu', last_n: 0, month: '', week: '', quarter: '', fy: '', ins_icon: true, ins_cl: true, ins_aim: true };
try { Object.assign(chemSel, JSON.parse(localStorage.getItem(CHEM_SEL_KEY) || '{}')); } catch (e) {}
delete chemSel.date_from; delete chemSel.date_to;   // older saved selections used a from/to date range; it was replaced by Month/Week/Quarter/Fin.Year

function chemNum(v, d){
  if(v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if(d == null) d = a >= 100 ? 3 : a >= 10 ? 3 : a >= 1 ? 3 : a >= 0.1 ? 4 : 5;
  return Number(v).toLocaleString(undefined, {minimumFractionDigits: d > 3 ? 3 : d, maximumFractionDigits: d});
}
function chemIdx(v){ return v == null || !isFinite(v) ? '—' : v.toFixed(2); }
// Copper-base industry practice: Cpk >= 1.67 excellent, >= 1.33 capable, >= 1.00 marginal, below 1.00 not capable.
function chemIdxClass(v){ return v == null ? '' : v >= 1.67 ? 'chem-great' : v >= 1.33 ? 'chem-good' : v >= 1 ? 'chem-warn' : 'chem-bad'; }
function chemIdxLabel(v){ return v == null ? '' : v >= 1.67 ? 'Excellent' : v >= 1.33 ? 'Capable' : v >= 1 ? 'Marginal' : 'Not capable'; }
function chemFetch(url, signal){
  return fetch(url, {signal}).then(async res => {
    const data = await res.json().catch(() => ({}));
    if(!res.ok || data.error) throw new Error(data.error || ('Request failed (HTTP ' + res.status + ').'));
    return data;
  });
}
function chemSaveSel(){ try { localStorage.setItem(CHEM_SEL_KEY, JSON.stringify(chemSel)); } catch (e) {} }
// Errors from a selector change (grade, parameter, dates, last-N) used to vanish into an unhandled promise
// rejection while the previous charts stayed on screen as if nothing had happened.
function chemShowError(msg){
  let b = document.getElementById('chemErr');
  if(!b){
    b = document.createElement('div'); b.id = 'chemErr'; b.className = 'chem-note-strip chem-err'; b.setAttribute('role', 'alert');
    const k = document.getElementById('chemNotes') || document.getElementById('chemMainBox'); if(k && k.parentNode) k.parentNode.insertBefore(b, k);
  }
  b.textContent = '⚠️ ' + msg + ' The charts below may show the previous selection.';
}
function chemClearError(){ const b = document.getElementById('chemErr'); if(b) b.remove(); }
function chemRefresh(){
  return refreshChemView().catch(e => { if(e && e.name === 'AbortError') return; console.error(e); chemShowError((e && e.message) || 'Could not load chemistry data.'); });
}
// A saved selection can be stale or hand-edited (localStorage): fall back to safe values instead of sending the API a 400.
// Periods (from the cast dates of the selected grade's heats) for the Month / Week / Quarter / Fin. Year filters.
function chemPeriods(){
  const s = chemMeta.specs.find(x => x.description === chemSel.spec);
  const p = chemSel.spec === '__none__' ? (chemMeta.unassigned && chemMeta.unassigned.periods) : (s && s.periods);
  return Object.assign({months: [], weeks: [], quarters: [], fys: [], undated: 0}, p || {});
}
function chemSanitiseSel(){
  if(!chemMeta.params.some(p => p.key === chemSel.param)) chemSel.param = 'cu';
  if(![0, 10, 20, 30, 50, 100, 200].includes(Number(chemSel.last_n))) chemSel.last_n = 0;
  chemSel.last_n = Number(chemSel.last_n) || 0;
  const per = chemPeriods();
  [['month', 'months'], ['week', 'weeks'], ['quarter', 'quarters'], ['fy', 'fys']].forEach(([k, l]) => { if(chemSel[k] && !per[l].includes(chemSel[k])) chemSel[k] = ''; });
}

// ---------------------------------------------------------------- loader
async function loadChemSpc(signal){
  chemMeta = await chemFetch('/api/chem/meta', signal);
  const usable = chemMeta.specs.filter(s => s.heats > 0);
  const groups = usable.map(s => s.description);
  if(chemMeta.unassigned) groups.push('__none__');
  if(!groups.length){ renderChemEmpty(); return; }
  if(!groups.includes(chemSel.spec)) chemSel.spec = groups[0];
  chemSanitiseSel();
  renderChemControls();
  await refreshChemView(signal);
}
function renderChemEmpty(){
  document.getElementById('chemControls').innerHTML = '<div class="chem-empty"><b>No chemistry data yet.</b><br>An admin can load cast chemistry from <a href="/admin#chemImportPanel">Admin → Import Cast Chemistry</a> and grade limits from <a href="/admin#chemSpecPanel">Admin → Chemistry Spec Limits</a>.</div>';
  ['chemMainBox','chemNotes','chemIChart','chemMRChart','chemHist','chemOverviewBox','chemCompareBox','chemOosBox'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
}
function chemGroupLabel(g){
  if(g === '__none__') return 'No spec assigned (' + chemMeta.unassigned.heats + ' heats)';
  const s = chemMeta.specs.find(x => x.description === g);
  return s ? s.description + ' — ' + s.heats + ' heats' : g;
}
function renderChemControls(){
  const groups = chemMeta.specs.filter(s => s.heats > 0).map(s => s.description).concat(chemMeta.unassigned ? ['__none__'] : []);
  const params = chemMeta.params;
  const per = chemPeriods();
  const opt = (v, t, cur) => `<option value="${escQcr(v)}"${v === cur ? ' selected' : ''}>${escQcr(t)}</option>`;
  const allOpt = (list, cur, label) => opt('', 'All', cur) + list.map(x => opt(x, x, cur)).join('');
  const chk = (id, label, on) => `<label class="chem-ins"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}</span></label>`;
  document.getElementById('chemControls').innerHTML = `
    <div class="chem-ctl-wrap">
      <div class="chem-box chem-filter-box">
        <div class="chem-box-h">Filter</div>
        <div class="chem-filter-grid">
          <label class="chem-ctl"><span>Month</span><select id="chemMonthSel">${allOpt(per.months, chemSel.month)}</select></label>
          <label class="chem-ctl"><span>Grade</span><select id="chemSpecSel">${groups.map(g => opt(g, chemGroupLabel(g), chemSel.spec)).join('')}</select></label>
          <label class="chem-ctl"><span>Week</span><select id="chemWeekSel">${allOpt(per.weeks, chemSel.week)}</select></label>
          <label class="chem-ctl"><span>Parameter</span><select id="chemParamSel">${params.map(p => opt(p.key, p.label, chemSel.param)).join('')}</select></label>
          <label class="chem-ctl"><span>Quarter</span><select id="chemQuarterSel">${allOpt(per.quarters, chemSel.quarter)}</select></label>
          <label class="chem-ctl"><span>Heat Qty (last N)</span><select id="chemLastN">${[[0,'All'],[10,'10'],[20,'20'],[30,'30'],[50,'50'],[100,'100'],[200,'200']].map(([v,t]) => opt(String(v), t, String(chemSel.last_n))).join('')}</select></label>
          <label class="chem-ctl"><span>Fin. Year</span><select id="chemFySel">${allOpt(per.fys, chemSel.fy)}</select></label>
          <label class="chem-ctl chem-find"><span>Heat No.</span><input type="search" id="chemFindHeat" placeholder="e.g. NBS6348 ↵" autocomplete="off"></label>
        </div>
      </div>
      <div class="chem-box chem-insert-box">
        <div class="chem-box-h">Insert</div>
        <div class="chem-insert-list">
          ${chk('chemInsIcon', 'Icon', chemSel.ins_icon)}
          ${chk('chemInsCL', 'Centre Line', chemSel.ins_cl)}
          ${chk('chemInsAim', 'Aim Chemistry', chemSel.ins_aim)}
        </div>
      </div>
    </div>
    <div class="chem-ctl-note">Month / Week / Quarter / Fin. Year come from the <b>Date</b> column of the chemistry file (financial year April–March, same labels as the main dashboard); heats without a readable date drop out while one of them is set${per.undated ? ` (<b>${per.undated}</b> heat(s) of this grade have no date)` : ''}. Charts always run in heat-number order; “Heat Qty” = the N highest heat numbers of the selection. Cp / Cpk / Pp / Ppk are measured against the <b>Standard</b> limits.</div>`;
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  const setPer = (k, id) => on(id, 'change', e => { chemSel[k] = e.target.value; chemSaveSel(); chemRefresh(); });
  on('chemSpecSel', 'change', e => { chemSel.spec = e.target.value; chemSanitiseSel(); chemSaveSel(); renderChemControls(); chemRefresh(); });
  on('chemParamSel', 'change', e => { chemSel.param = e.target.value; chemSaveSel(); chemRefresh(); });
  on('chemLastN', 'change', e => { chemSel.last_n = Number(e.target.value) || 0; chemSaveSel(); chemRefresh(); });
  setPer('month', 'chemMonthSel'); setPer('week', 'chemWeekSel'); setPer('quarter', 'chemQuarterSel'); setPer('fy', 'chemFySel');
  on('chemFindHeat', 'keydown', e => { if(e.key === 'Enter'){ const v = e.target.value.trim(); if(v) openChemHeat(v); } });
  [['chemInsIcon', 'ins_icon'], ['chemInsCL', 'ins_cl'], ['chemInsAim', 'ins_aim']].forEach(([id, k]) => on(id, 'change', e => { chemSel[k] = e.target.checked; chemSaveSel(); if(chemData) renderChemAll(); }));
}
let chemReqSeq = 0;
async function refreshChemView(signal){
  const seq = ++chemReqSeq;
  const q = new URLSearchParams({spec: chemSel.spec, param: chemSel.param, last_n: chemSel.last_n, month: chemSel.month, week: chemSel.week, quarter: chemSel.quarter, fy: chemSel.fy});
  const box = document.getElementById('tab-chem');
  box.classList.add('chem-loading');
  try {
    const d = await chemFetch('/api/chem/spc?' + q.toString(), signal);
    if(seq !== chemReqSeq) return;
    chemData = d; chemClearError();
    // if the chosen parameter has no data for this grade, fall back to the first parameter that has
    if(!d.n && d.overview && d.overview.length && !d.overview.some(o => o.param === chemSel.param)){
      chemSel.param = d.overview[0].param; chemSaveSel(); renderChemControls(); return refreshChemView(signal);
    }
    renderChemAll();
  } finally { if(seq === chemReqSeq) box.classList.remove('chem-loading'); }
}
function renderChemAll(){
  const d = chemData;
  document.getElementById('chemTitleParam').textContent = (chemMeta.params.find(p => p.key === d.param) || {}).label || d.param;
  renderChemMain(d);
  renderChemNotes(d);
  drawChemI(document.getElementById('chemIChart'), d);
  drawChemMR(document.getElementById('chemMRChart'), d);
  drawChemHist(document.getElementById('chemHist'), d);
  renderChemOverview(d); renderChemCompare(d); renderChemOos(d);
}

// ---------------------------------------------------------------- notes (no KPI cards any more)
function renderChemNotes(d){
  const el = document.getElementById('chemNotes'); if(!el) return;
  const c = d.capability || {};
  const notes = [].concat(d.summary.heats ? [] : ['No heats match this selection (check Month / Week / Quarter / Fin. Year, or the grade).'], d.warnings || [], c.note ? [c.note] : []);
  el.innerHTML = notes.length ? `<div class="chem-note-strip">${notes.map(n => 'ⓘ ' + escQcr(n)).join('<br>')}</div>` : '';
}

// ---------------------------------------------------------------- shared SVG helpers
function chemTicks(lo, hi, n){
  const span = hi - lo; if(!(span > 0)) return [lo];
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
  const out = []; for(let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
function chemTickFmt(step){ return v => Number(v).toLocaleString(undefined, {maximumFractionDigits: Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step || 1))))}); }
function chemEmptyChart(el, msg){ el.innerHTML = `<div class="chem-empty-chart">${escQcr(msg)}</div>`; el._qdRedraw = null; }

// Fixed-size box so labels stay readable; width follows the container like the other charts.
function chemBox(el, h){
  const W = chartUnits(el), m = {l: 64, r: 122, t: 16, b: 46};
  return {W, H: h, m, pw: W - m.l - m.r, ph: h - m.t - m.b};
}
function chemDomain(vals, d, extra){
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const im = d.imr;
  if(im){ lo = Math.min(lo, im.lcl); hi = Math.max(hi, im.ucl); }
  const off = {lsl: false, usl: false};
  const span0 = (hi - lo) || Math.abs(hi) * 0.02 || 0.01;
  [['lsl', d.lsl], ['usl', d.usl]].forEach(([k, v]) => {
    if(v == null) return;
    const dist = k === 'lsl' ? lo - v : v - hi;
    if(dist <= 2.5 * span0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } else off[k] = true;
  });
  if(chemSel.ins_aim) [d.aim_lsl, d.aim_usl].forEach(v => { if(v != null && v >= lo - 2.5 * span0 && v <= hi + 2.5 * span0){ lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const pad = ((hi - lo) || 0.02) * 0.06;
  return {lo: lo - pad, hi: hi + pad, off};
}

// ---------------------------------------------------------------- I chart
function drawChemI(el, d){
  if(!el) return;
  if(!d.series.length) return chemEmptyChart(el, 'No heats with this parameter in the selected range.');
  const redraw = () => {
    const B = chemBox(el, 340), {W, H, m, pw, ph} = B, s = d.series, n = s.length, im = d.imr;
    const dom = chemDomain(s.map(p => p.value), d);
    const X = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = v => m.t + ph - ((v - dom.lo) / (dom.hi - dom.lo)) * ph;
    const yt = chemTicks(dom.lo, dom.hi, 6), yf = chemTickFmt(yt.length > 1 ? yt[1] - yt[0] : 1);
    let g = '';
    yt.forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${yf(v)}</text>`; });
    const usedY = [];
    const line = (v, color, dash, label, sw) => {
      if(v == null || v < dom.lo || v > dom.hi) return '';
      let ty = Y(v) + 4;
      for(let k = 0; k < 4 && usedY.some(u => Math.abs(u - ty) < 12); k++) ty += 12;   // keep neighbouring labels (e.g. LSL vs LCL) readable
      usedY.push(ty);
      return `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${color}" stroke-width="${sw || 1.4}" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${m.l + pw + 6}" y="${ty}" font-size="11" font-weight="700" fill="${color}">${label} ${chemNum(v)}</text>`;
    };
    g += line(d.lsl, '#DC2626', '7 4', 'Std LSL', 1.8) + line(d.usl, '#DC2626', '7 4', 'Std USL', 1.8);
    if(chemSel.ins_aim) g += line(d.aim_lsl, '#0D9488', '3 3', 'Aim LSL', 1.7) + line(d.aim_usl, '#0D9488', '3 3', 'Aim USL', 1.7);
    if(im){ g += line(im.ucl, '#D97706', '5 4', 'UCL') + line(im.lcl, '#D97706', '5 4', 'LCL'); if(chemSel.ins_cl) g += line(im.cl, '#16A34A', '', 'Mean', 1.8); }
    if(dom.off.lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 6}" font-size="11" font-weight="700" fill="#DC2626">▼ Std LSL ${chemNum(d.lsl)} is far below this scale</text>`;
    if(dom.off.usl) g += `<text x="${m.l + 6}" y="${m.t + 12}" font-size="11" font-weight="700" fill="#DC2626">▲ Std USL ${chemNum(d.usl)} is far above this scale</text>`;
    g += `<polyline fill="none" stroke="#118DFF" stroke-opacity=".55" stroke-width="1.2" points="${s.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.4 : n > 120 ? 3 : 3.8;
    s.forEach((p, i) => {
      const cls = p.oos ? '#DC2626' : '#118DFF';
      const tip = `${p.heat_no}${p.cast_date ? ' · ' + p.cast_date : ''} — ${chemNum(p.value)}` + (p.oos ? ' · OUT OF SPEC' : '') +
        (p.disp ? ` · ${p.disp.coils} coils, reject ${p.disp.reject_pct}%${p.disp.top_defects[0] ? ', top defect ' + p.disp.top_defects[0].defect : ''}` : ' · no disposition data');
      g += `<circle class="chem-pt" data-heat="${escQcr(p.heat_no)}" data-tip="${escQcr(tip)}" cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${p.oos ? r + 1.8 : r}" fill="${cls}" ${p.oos ? 'stroke="#7f1d1d" stroke-width="1.6"' : 'stroke="var(--card)" stroke-width=".6"'}/>`;
    });
    const nt = Math.min(n, Math.max(2, Math.floor(pw / 120)));
    for(let k = 0; k < nt; k++){
      const i = nt === 1 ? 0 : Math.round(k * (n - 1) / (nt - 1)), p = s[i];
      g += `<text x="${X(i)}" y="${m.t + ph + 16}" text-anchor="${k === 0 ? 'start' : k === nt - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--chart-muted)">${escQcr(p.heat_no)}</text>`;
    }
    g += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">Heats in heat-number order (1 point = 1 heat)</text>`;
    g += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--chart-axis)"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Individuals control chart">${g}</svg>${chemLegend()}`;
  };
  redraw(); chartRemember(el, redraw);
}
function chemLegend(){
  return `<div class="chem-legend"><span><i class="chem-dot" style="background:#118DFF"></i>Heat (in spec)</span><span><i class="chem-dot" style="background:#DC2626;box-shadow:0 0 0 2px #7f1d1d"></i>Out of spec</span>${chemSel.ins_cl ? '<span><i class="chem-ln" style="border-color:#16A34A"></i>Mean (centre line)</span>' : ''}<span><i class="chem-ln chem-dash" style="border-color:#D97706"></i>UCL / LCL (3σ)</span><span><i class="chem-ln chem-dash" style="border-color:#DC2626"></i>Standard LSL / USL</span>${chemSel.ins_aim ? '<span><i class="chem-ln chem-dash" style="border-color:#0D9488"></i>Aim LSL / USL</span>' : ''}</div>`;
}

// ---------------------------------------------------------------- MR chart
function drawChemMR(el, d){
  if(!el) return;
  if(!d.mr || !d.mr.length || !d.imr) return chemEmptyChart(el, 'Need at least 2 heats for a moving-range chart.');
  const redraw = () => {
    const B = chemBox(el, 220), {W, H, m, pw, ph} = B, mr = d.mr, n = mr.length, im = d.imr;
    const hi0 = Math.max(im.mr_ucl, ...mr) * 1.08 || 0.01;
    const X = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), Y = v => m.t + ph - (v / hi0) * ph;
    const yt = chemTicks(0, hi0, 4), yf = chemTickFmt(yt.length > 1 ? yt[1] - yt[0] : 1);
    let g = '';
    yt.forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${yf(v)}</text>`; });
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(im.mr_ucl)}" y2="${Y(im.mr_ucl)}" stroke="#D97706" stroke-dasharray="5 4" stroke-width="1.4"/><text x="${m.l + pw + 6}" y="${Y(im.mr_ucl) + 4}" font-size="11" font-weight="700" fill="#D97706">UCL ${chemNum(im.mr_ucl)}</text>`;
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(im.mrbar)}" y2="${Y(im.mrbar)}" stroke="#16A34A" stroke-width="1.6"/><text x="${m.l + pw + 6}" y="${Y(im.mrbar) + 4}" font-size="11" font-weight="700" fill="#16A34A">MR̄ ${chemNum(im.mrbar)}</text>`;
    g += `<polyline fill="none" stroke="#7C3AED" stroke-opacity=".55" stroke-width="1.1" points="${mr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.2 : n > 120 ? 2.8 : 3.4;
    mr.forEach((v, i) => {
      const bad = v > im.mr_ucl, p = d.series[i + 1];
      g += `<circle class="chem-pt" data-heat="${escQcr(p.heat_no)}" data-tip="${escQcr(`MR ${d.series[i].heat_no} → ${p.heat_no}: ${chemNum(v)}${bad ? ' · above UCL (sudden jump)' : ''}`)}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${bad ? r + 1.2 : r}" fill="${bad ? '#D97706' : '#7C3AED'}" stroke="var(--card)" stroke-width=".6"/>`;
    });
    g += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">|Δ| between consecutive heats</text><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--chart-axis)"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Moving range chart">${g}</svg>`;
  };
  redraw(); chartRemember(el, redraw);
}

// ---------------------------------------------------------------- Histogram
function drawChemHist(el, d){
  if(!el) return;
  const h = d.histogram;
  if(!d.n || !h || !h.bins.length) return chemEmptyChart(el, 'No data to build a histogram.');
  const redraw = () => {
    const B = chemBox(el, 300), {W, H, m, pw, ph} = B, c = d.capability;
    const maxN = Math.max(...h.bins.map(b => b.n), 1) * 1.12;
    const X = v => m.l + ((v - h.xmin) / (h.xmax - h.xmin)) * pw, Y = v => m.t + ph - (v / maxN) * ph;
    const xt = chemTicks(h.xmin, h.xmax, Math.max(4, Math.floor(pw / 90))), xf = chemTickFmt(xt.length > 1 ? xt[1] - xt[0] : 1);
    let g = '';
    chemTicks(0, maxN, 4).forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${Math.round(v)}</text>`; });
    h.bins.forEach(b => {
      const out = (d.lsl != null && b.x1 <= d.lsl) || (d.usl != null && b.x0 >= d.usl);
      const x0 = X(b.x0), w = Math.max(1, X(b.x1) - X(b.x0) - 1);
      g += `<rect data-tip="${escQcr(`${chemNum(b.x0)} – ${chemNum(b.x1)}: ${b.n} heat${b.n === 1 ? '' : 's'}${out ? ' (out of spec)' : ''}`)}" x="${x0.toFixed(1)}" y="${Y(b.n).toFixed(1)}" width="${w.toFixed(1)}" height="${(m.t + ph - Y(b.n)).toFixed(1)}" fill="${out ? '#DC2626' : '#118DFF'}" fill-opacity=".78"/>`;
    });
    if(c && c.sigma_overall > 0 && c.mean != null){
      const area = d.n * h.width, pts = [];
      for(let i = 0; i <= 120; i++){ const v = h.xmin + (h.xmax - h.xmin) * i / 120, z = (v - c.mean) / c.sigma_overall; const y = area * Math.exp(-z * z / 2) / (c.sigma_overall * Math.sqrt(2 * Math.PI)); pts.push(`${X(v).toFixed(1)},${Math.max(m.t, Y(y)).toFixed(1)}`); }
      g += `<polyline fill="none" stroke="var(--text)" stroke-width="1.6" stroke-opacity=".8" points="${pts.join(' ')}"/>`;
    }
    // one label row per kind of line (Standard, Aim, Mean) so labels never run over each other
    // a label that would run into the y-axis / right margin flips to the other side of its line; a card-coloured halo keeps text readable over bars
    const vline = (v, color, label, side0, row, solid) => { if(v == null || v < h.xmin || v > h.xmax) return ''; const side = side0 === 'l' && X(v) - m.l < 112 ? 'r' : side0 === 'r' && m.l + pw - X(v) < 112 ? 'l' : side0; return `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}" stroke="${color}" stroke-width="${solid ? 2 : 1.8}" ${solid ? '' : 'stroke-dasharray="7 4"'}/><text x="${X(v) + (side === 'l' ? -4 : 4)}" y="${m.t + 12 + (row || 0) * 14}" text-anchor="${side === 'l' ? 'end' : 'start'}" font-size="11" font-weight="700" fill="${color}" stroke="var(--card)" stroke-width="3" paint-order="stroke">${label} ${chemNum(v)}</text>`; };
    const mv = c && c.mean;
    g += vline(d.lsl, '#DC2626', 'Std LSL', 'l', 0) + vline(d.usl, '#DC2626', 'Std USL', 'r', 0);
    if(chemSel.ins_aim) g += vline(d.aim_lsl, '#0D9488', 'Aim LSL', 'l', 1) + vline(d.aim_usl, '#0D9488', 'Aim USL', 'r', 1);
    if(chemSel.ins_cl) g += vline(mv, '#16A34A', 'Mean', mv != null && d.usl != null && d.lsl != null && (mv - d.lsl) > (d.usl - mv) ? 'l' : 'r', 2, true);
    if(h.lsl_off) g += `<text x="${m.l + 6}" y="${m.t + 60}" font-size="11" font-weight="700" fill="#DC2626">◀ Std LSL ${chemNum(d.lsl)} is far to the left of the data</text>`;
    if(h.usl_off) g += `<text x="${m.l + pw - 6}" y="${m.t + 60}" text-anchor="end" font-size="11" font-weight="700" fill="#DC2626">Std USL ${chemNum(d.usl)} is far to the right of the data ▶</text>`;
    xt.forEach(v => { g += `<text x="${X(v)}" y="${m.t + ph + 16}" text-anchor="middle" font-size="11" fill="var(--chart-muted)">${xf(v)}</text>`; });
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--chart-axis)"/><text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">Value (heats per bin; curve = normal fit on overall σ)</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Histogram with specification limits">${g}</svg>`;
  };
  redraw(); chartRemember(el, redraw);
}

// ---------------------------------------------------------------- tables / panels
function renderChemOverview(d){
  const rows = d.overview || [];
  const lim = v => v == null ? '—' : chemNum(v);
  const sd = v => v == null || !isFinite(v) ? '—' : chemNum(v, v >= 1 ? 3 : v >= 0.1 ? 4 : 5);
  const tr = r => `<tr class="chem-click${r.param === d.param ? ' chem-cur' : ''}${r.main ? ' chem-main-row' : ''}" data-param="${r.param}"><td><b>${r.main ? '★ ' : ''}${escQcr(r.label)}</b></td><td>${r.n}</td><td>${chemNum(r.mean)}</td><td>${lim(r.lsl)}</td><td>${lim(r.usl)}</td><td>${lim(r.aim_lsl)}</td><td>${lim(r.aim_usl)}</td><td class="${chemIdxClass(r.cp)}">${chemIdx(r.cp)}</td><td class="${chemIdxClass(r.cpk)}">${chemIdx(r.cpk)}</td><td>${sd(r.sigma_within)}</td><td class="${chemIdxClass(r.pp)}">${chemIdx(r.pp)}</td><td class="${chemIdxClass(r.ppk)}">${chemIdx(r.ppk)}</td><td>${sd(r.sigma_overall)}</td><td class="${r.oos ? 'chem-bad' : ''}">${r.oos}</td></tr>`;
  const mains = rows.filter(r => r.main), others = rows.filter(r => !r.main);
  const sep = t => `<tr class="chem-sep"><td colspan="14">${t}</td></tr>`;
  document.getElementById('chemOverviewBox').innerHTML = rows.length ? `<div class="chem-oos-bar"><button type="button" class="chem-btn" id="chemCpkCsv">⬇ Cpk table (CSV)</button><button type="button" class="chem-btn" id="chemHeatsCsv">⬇ Heat data — ${escQcr((chemMeta.params.find(p => p.key === d.param) || {}).label || d.param)} (CSV)</button></div><div class="chem-table-wrap"><table class="chem-table"><thead><tr><th>Parameter</th><th>Heats</th><th>Mean</th><th>Std LSL</th><th>Std USL</th><th>Aim LSL</th><th>Aim USL</th><th>Cp</th><th>Cpk</th><th>Std. Dev. (Cp/Cpk)</th><th>Pp</th><th>Ppk</th><th>Std. Dev. (Pp/Ppk)</th><th>Out of spec</th></tr></thead><tbody>${mains.length ? sep('★ Main elements') + mains.map(tr).join('') : ''}${others.length ? sep('Impurities &amp; other parameters') + others.map(tr).join('') : ''}</tbody></table></div><div class="chem-foot">Click a row to chart that parameter. Cp/Cpk use the within σ (moving range ÷ 1.128), Pp/Ppk the overall σ; both against the Standard limits. Rating: ≥ 1.67 excellent, ≥ 1.33 capable (green), 1.00–1.33 marginal (amber), below 1.00 not capable (red). Where the lower limit is 0 (impurity-type limits) only the upper limit is used.</div>` : '<div class="chem-empty-chart">No parameters with enough data.</div>';
  const b1 = document.getElementById('chemCpkCsv'), b2 = document.getElementById('chemHeatsCsv');
  if(b1) b1.addEventListener('click', () => chemExportCpk(d));
  if(b2) b2.addEventListener('click', () => chemExportHeats(d));
}
// ---------------------------------------------------------------- element cards (symbol + picture + Cp/Cpk/Pp/Ppk/Std. Dev.)
const CHEM_ELEMENTS = {
  cu: {sym: 'Cu', name: 'Copper',     z: 29, c: '#E2925A', d: '#93511F', kind: 'ingot'},
  ni: {sym: 'Ni', name: 'Nickel',     z: 28, c: '#CBD3DB', d: '#7C8894', kind: 'coin'},
  zn: {sym: 'Zn', name: 'Zinc',       z: 30, c: '#B3C7D4', d: '#5F7A8C', kind: 'ingot'},
  al: {sym: 'Al', name: 'Aluminium',  z: 13, c: '#E4E8ED', d: '#98A2B0', kind: 'ingot'},
  mn: {sym: 'Mn', name: 'Manganese',  z: 25, c: '#BE86D8', d: '#6B3D86', kind: 'crystal'},
  fe: {sym: 'Fe', name: 'Iron',       z: 26, c: '#95A1AE', d: '#434C57', kind: 'ingot'},
  pb: {sym: 'Pb', name: 'Lead',       z: 82, c: '#8A919C', d: '#3A404A', kind: 'ingot'},
  sn: {sym: 'Sn', name: 'Tin',        z: 50, c: '#EEF1F5', d: '#A0A9B5', kind: 'coin'},
  si: {sym: 'Si', name: 'Silicon',    z: 14, c: '#7C8FBA', d: '#2E3B5C', kind: 'crystal'},
  p:  {sym: 'P',  name: 'Phosphorus', z: 15, c: '#FF8A63', d: '#B02F12', kind: 'crystal'},
  s:  {sym: 'S',  name: 'Sulfur',     z: 16, c: '#F8DD54', d: '#B08F00', kind: 'crystal'},
  c:  {sym: 'C',  name: 'Carbon',     z: 6,  c: '#5A6574', d: '#141A22', kind: 'crystal'},
};
// Small drawn picture of the element's typical form (ingots / coin / crystal), coloured per element. Inline SVG: no image files, works offline.
function chemElemArt(key){
  const e = CHEM_ELEMENTS[key]; if(!e) return '';
  const gid = 'chemg-' + key;
  const defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${e.c}"/><stop offset="1" stop-color="${e.d}"/></linearGradient></defs>`;
  let body = '';
  if(e.kind === 'ingot'){
    const bar = (x, y, w, h) => { const t = h * 0.42; return `<path d="M${x} ${y + h} H${x + w} L${x + w - t} ${y} H${x + t} Z" fill="url(#${gid})" stroke="${e.d}" stroke-width="1.2" stroke-linejoin="round"/><path d="M${x + t} ${y + 2.5} H${x + w - t}" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>`; };
    body = bar(4, 44, 42, 20) + bar(50, 44, 42, 20) + bar(27, 22, 42, 20);
  } else if(e.kind === 'coin'){
    body = `<circle cx="58" cy="30" r="24" fill="${e.d}" fill-opacity=".35"/><circle cx="46" cy="38" r="27" fill="url(#${gid})" stroke="${e.d}" stroke-width="1.4"/><circle cx="46" cy="38" r="21" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.6"/><text x="46" y="46" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="22" font-weight="700" fill="${e.d}">${e.sym}</text>`;
  } else {
    const P = '48,6 80,26 80,50 48,68 16,50 16,26';
    body = `<polygon points="${P}" fill="url(#${gid})" stroke="${e.d}" stroke-width="1.4" stroke-linejoin="round"/><polygon points="48,6 80,26 48,34 16,26" fill="#fff" fill-opacity=".35"/><polygon points="48,34 80,26 80,50 48,68" fill="#000" fill-opacity=".18"/><path d="M16 26 L48 34 L80 26 M48 34 V68" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>`;
  }
  return `<svg class="chem-el-svg" viewBox="0 0 96 72" role="img" aria-label="${escQcr(e.name)}">${defs}${body}</svg>`;
}
// Main elements of the grade (Cu + its alloying elements), largest first. Each card: symbol, picture, then
// Cp | Pp, Cpk | Ppk, Std. Dev. | Std. Dev. (left column = within-subgroup σ from the moving range, right column = overall σ).
function renderChemMain(d){
  const box = document.getElementById('chemMainBox'); if(!box) return;
  const mains = (d.overview || []).filter(r => r.main);
  if(!mains.length){ box.innerHTML = ''; return; }
  const cell = (k, v, cls, cap) => `<div class="chem-el-cell"><span class="chem-el-k${cls === 'sd' ? ' sd' : ''}">${k}</span><span class="chem-el-v ${cls === 'sd' ? 'sd' : cls || ''}">${v}${cap ? `<small>${cap}</small>` : ''}</span></div>`;
  const sd = v => v == null || !isFinite(v) ? '—' : chemNum(v, v >= 1 ? 3 : v >= 0.1 ? 4 : 5);
  const card = r => {
    const e = CHEM_ELEMENTS[r.param] || {sym: String(r.label).replace('%', ''), name: r.label, z: ''};
    return `<button type="button" class="chem-el-card${r.param === d.param ? ' chem-cur' : ''}" data-param="${r.param}" title="Click to chart ${escQcr(e.name)}">
      <div class="chem-el-head">
        ${chemSel.ins_icon ? `<div class="chem-el-art">${chemElemArt(r.param)}</div>` : ''}
        <div class="chem-el-symbox"><span class="chem-el-z">${e.z}</span><span class="chem-el-sym">${escQcr(e.sym)}</span><span class="chem-el-name">${escQcr(e.name)}</span></div>
      </div>
      <div class="chem-el-grid">
        ${cell('Cp', chemIdx(r.cp), chemIdxClass(r.cp))}${cell('Pp', chemIdx(r.pp), chemIdxClass(r.pp))}
        ${cell('Cpk', chemIdx(r.cpk), chemIdxClass(r.cpk))}${cell('Ppk', chemIdx(r.ppk), chemIdxClass(r.ppk))}
        ${cell('Std. Dev.', sd(r.sigma_within), 'sd')}${cell('Std. Dev.', sd(r.sigma_overall), 'sd')}
      </div>
    </button>`;
  };
  box.innerHTML = `<div class="chem-el-grid-wrap">${mains.map(card).join('')}</div><div class="chem-foot">Left column: <b>Cp / Cpk</b> use the within (moving-range) σ; right column: <b>Pp / Ppk</b> use the overall σ; both against the <b>Standard</b> limits. Std. Dev. under each column is the σ that column uses. Green ≥ 1.33 · amber 1.00–1.33 · red &lt; 1.00. Click a card to chart that element.</div>`;
}

function chemCmpCard(title, a, tone, hint, noLimits){
  const has = !noLimits && a && a.heats > 0;
  return `<div class="chem-cmp ${tone}"><div class="chem-cmp-t">${escQcr(title)}</div><div class="chem-cmp-v">${has && a.reject_pct != null ? a.reject_pct.toFixed(2) + '%' : '—'}</div><div class="chem-cmp-s">reject (by MT)</div><div class="chem-cmp-v2">${has && a.defect_pct != null ? a.defect_pct + '%' : '—'} <span>coils with a defect</span></div><div class="chem-cmp-f">${has ? `${a.heats} heats · ${a.coils} coils` : noLimits ? 'no limits defined for this group' : 'no heats with disposition data'}${has && a.heats < 10 ? '<br><b>small sample — read with care</b>' : ''}</div><div class="chem-cmp-h">${escQcr(hint)}</div></div>`;
}
function renderChemCompare(d){
  const c = d.summary.compare;
  document.getElementById('chemCompareBox').innerHTML = `<div class="chem-cmp-grid">${chemCmpCard('In spec (all parameters)', c.in_spec, 'ok', 'Heats whose chemistry met every limit', d.summary.has_limits === false)}${chemCmpCard('Out of spec', c.out_of_spec, 'bad', 'Heats with at least one limit breach')}</div><div class="chem-foot">Only heats that also appear in the disposition data (matched on heat_no) are counted. ${d.summary.heats - d.summary.heats_with_disposition} of ${d.summary.heats} heats in this view have no disposition record yet (not inspected/rolled). Correlation is not proof of cause.</div>`;
}
function chemOosRows(d, q){
  q = (q || '').trim().toUpperCase();
  return d.oos_heats.filter(o => !q || o.heat_no.includes(q) || o.violations.some(v => v.param.toUpperCase().includes(q)));
}
function renderChemOos(d){
  const box = document.getElementById('chemOosBox');
  if(!d.oos_total){ box.innerHTML = d.summary.has_limits === false ? '<div class="chem-empty-chart">No limits are defined for this group, so out-of-spec heats cannot be identified. Add a spec under Admin → Chemistry Spec Limits.</div>' : '<div class="chem-empty-chart chem-good">No out-of-spec heats in this selection ✔</div>'; return; }
  const draw = q => {
    const rows = chemOosRows(d, q);
    document.getElementById('chemOosBody').innerHTML = rows.map(o => {
      const disp = o.disp;
      return `<tr class="chem-click" data-heat="${escQcr(o.heat_no)}"><td><b>${escQcr(o.heat_no)}</b></td><td>${escQcr(o.analyst || '—')}</td><td>${o.violations.map(v => `<span class="chem-chip">${escQcr(v.param)} ${chemNum(v.value)} ${v.side === 'below' ? '&lt; LSL' : '&gt; USL'} ${chemNum(v.limit)}</span>`).join('')}</td>` +
        (disp ? `<td>${disp.coils}</td><td class="${disp.reject_pct > 0 ? 'chem-bad' : ''}">${disp.reject_pct}%</td><td>${disp.top_defects.length ? disp.top_defects.map(t => `${escQcr(t.defect)} (${t.coils})`).join(', ') : '<span class="chem-muted">no defect</span>'}</td>` : '<td colspan="3" class="chem-muted">no disposition data for this heat</td>') + '</tr>';
    }).join('') || '<tr><td colspan="6" class="chem-muted">No match.</td></tr>';
  };
  box.innerHTML = `<div class="chem-oos-bar"><input type="search" id="chemOosSearch" placeholder="Search heat or parameter…" autocomplete="off"><button type="button" class="chem-btn" id="chemOosCsv">⬇ Export CSV</button><span class="chem-muted">${d.oos_total} heats${d.oos_total > d.oos_heats.length ? ` (showing first ${d.oos_heats.length})` : ''} · click a row for the heat's coils and defects</span></div><div class="chem-table-wrap"><table class="chem-table"><thead><tr><th>Heat</th><th>Analyst</th><th>Chemistry problem</th><th>Coils</th><th>Reject %</th><th>Defects seen on its coils</th></tr></thead><tbody id="chemOosBody"></tbody></table></div>`;
  draw('');
  document.getElementById('chemOosSearch').addEventListener('input', e => draw(e.target.value));
  document.getElementById('chemOosCsv').addEventListener('click', () => chemExportOos(d));
}
// CSV helpers: cells are quoted and formula-looking text is neutralised (Excel formula injection).
function chemCsvCell(v){ let s = String(v ?? ''); if(/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number' && isFinite(v))) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function chemDownloadCsv(name, lines){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function chemFileTag(d){
  const g = String((d && d.spec && d.spec.description) || chemSel.spec || 'chemistry').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return g || 'chemistry';
}
// Capability of every parameter of the grade (main elements first) — the numbers behind the Cpk cards and table.
function chemExportCpk(d){
  const rows = (d && d.overview) || []; if(!rows.length) return;
  const num = v => v == null || !isFinite(v) ? '' : Number(v);
  const lines = [['Grade / spec', 'Parameter', 'Main element', 'Heats', 'Mean', 'Std LSL', 'Std USL', 'Aim LSL', 'Aim USL', 'Cp', 'Cpk', 'Cpk rating', 'Std. Dev. (within, Cp/Cpk)', 'Pp', 'Ppk', 'Std. Dev. (overall, Pp/Ppk)', 'Out-of-spec heats', 'Indicative (< 30 heats)'].map(chemCsvCell).join(',')];
  rows.forEach(r => lines.push([(d.spec && d.spec.description) || '', r.label, r.main ? 'Yes' : 'No', r.n, num(r.mean), num(r.lsl), num(r.usl), num(r.aim_lsl), num(r.aim_usl), num(r.cp), num(r.cpk),
    r.cpk == null ? '' : chemIdxLabel(r.cpk), num(r.sigma_within), num(r.pp), num(r.ppk), num(r.sigma_overall), r.oos, r.n < 30 ? 'Yes' : 'No'].map(chemCsvCell).join(',')));
  chemDownloadCsv('chemistry_cpk_' + chemFileTag(d) + '.csv', lines);
}
// One row per heat for the charted parameter, in heat-number order, with its disposition summary.
function chemExportHeats(d){
  const s = (d && d.series) || []; if(!s.length) return;
  const label = (chemMeta && chemMeta.params.find(p => p.key === d.param) || {}).label || d.param;
  const lines = [['Heat no', 'Date', label, 'Out of spec (this parameter)', 'Any parameter out of spec', 'Analyst', 'Coils', 'Reject %', 'Top defect'].map(chemCsvCell).join(',')];
  s.forEach(p => lines.push([p.heat_no, p.cast_date || '', p.value, p.oos ? 'Yes' : 'No', p.heat_oos ? 'Yes' : 'No', p.analyst || '',
    p.disp ? p.disp.coils : '', p.disp ? p.disp.reject_pct : '', p.disp && p.disp.top_defects && p.disp.top_defects[0] ? p.disp.top_defects[0].defect : ''].map(chemCsvCell).join(',')));
  chemDownloadCsv('chemistry_heats_' + d.param + '_' + chemFileTag(d) + '.csv', lines);
}
function chemExportOos(d){
  const cell = chemCsvCell;
  const lines = [['Heat', 'Analyst', 'Chemistry problem', 'Coils', 'Reject %', 'Defect coils', 'Top defects'].map(cell).join(',')];
  d.oos_heats.forEach(o => lines.push([o.heat_no, o.analyst, o.violations.map(v => `${v.param} ${v.value} ${v.side === 'below' ? '< LSL' : '> USL'} ${v.limit}`).join('; '),
    o.disp ? o.disp.coils : '', o.disp ? o.disp.reject_pct : '', o.disp ? o.disp.defect_coils : '', o.disp ? o.disp.top_defects.map(t => `${t.defect} (${t.coils})`).join('; ') : ''].map(cell).join(',')));
  chemDownloadCsv('out_of_spec_heats.csv', lines);
}

// ---------------------------------------------------------------- heat dialog (chemistry + its coils' defects)
function chemHeatModal(){
  let m = document.getElementById('chemHeatModal');
  if(!m){
    m = document.createElement('div'); m.id = 'chemHeatModal'; m.className = 'chem-modal'; m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '<div class="chem-dialog" role="dialog" aria-modal="true" aria-labelledby="chemHeatTitle"><div class="chem-dlg-head"><h3 id="chemHeatTitle">Heat</h3><button type="button" id="chemHeatClose" class="chem-btn">Close</button></div><div class="chem-dlg-body" id="chemHeatBody"></div></div>';
    document.body.appendChild(m);
    const close = () => { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); };
    m.addEventListener('click', e => { if(e.target === m) close(); });
    m.querySelector('#chemHeatClose').addEventListener('click', close);
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && m.classList.contains('open')){ e.stopPropagation(); close(); } }, true);
  }
  return m;
}
async function openChemHeat(heat){
  const m = chemHeatModal(), body = m.querySelector('#chemHeatBody');
  m.querySelector('#chemHeatTitle').textContent = 'Heat ' + String(heat).toUpperCase();
  body.innerHTML = '<div class="chem-muted">Loading…</div>'; m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
  try {
    const d = await chemFetch('/api/chem/heat?heat_no=' + encodeURIComponent(heat));
    m.querySelector('#chemHeatTitle').textContent = 'Heat ' + d.heat_no;
    let html = '';
    if(!d.found) html += `<div class="chem-note-strip">No chemistry was imported for this heat.</div>`;
    else {
      const c = d.chem;
      html += `<div class="chem-dlg-meta">${escQcr(d.spec || 'No spec assigned')} · cast ${escQcr(c.cast_date || 'date not available')} · analyst ${escQcr(c.analyst || '—')} · alloy ${escQcr(c.alloy || '—')} ${escQcr(c.denomination || '')}</div>
      <div class="chem-table-wrap"><table class="chem-table"><thead><tr><th>Parameter</th><th>Value</th><th>LSL</th><th>USL</th><th>Status</th></tr></thead><tbody>${d.params.map(p => `<tr><td><b>${escQcr(p.label)}</b></td><td>${chemNum(p.value)}</td><td>${p.lsl == null ? '—' : chemNum(p.lsl)}</td><td>${p.usl == null ? '—' : chemNum(p.usl)}</td><td class="${p.side ? 'chem-bad' : (p.lsl != null || p.usl != null) ? 'chem-good' : ''}">${p.side ? (p.side === 'below' ? 'BELOW LSL' : 'ABOVE USL') : (p.lsl != null || p.usl != null) ? 'OK' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if(d.summary){
      const s = d.summary;
      html += `<h4 class="chem-h4">Disposition of this heat's coils</h4><div class="chem-dlg-meta">${s.coils} coils · ${s.qty_mt} MT · reject ${s.reject_mt} MT (${s.reject_pct}%) · ${s.defect_coils} coils with a defect (${s.defect_pct}%)</div>
      <div class="chem-table-wrap"><table class="chem-table"><thead><tr><th>Batch no</th><th>Insp. date</th><th>Work center</th><th>Grade</th><th>MT</th><th>Main defect</th><th>Intensity</th><th>Decision</th></tr></thead><tbody>${d.coils.map(r => `<tr><td>${escQcr(r.batch_no)}</td><td>${escQcr(r.insp_lot_date)}</td><td>${escQcr(r.work_center)}</td><td>${escQcr(r.grade)}</td><td>${Number(r.output_weight || 0).toFixed(3)}</td><td>${escQcr(r.main_defect || '—')}</td><td>${escQcr(r.defect_intensity || '—')}</td><td class="${String(r.quality_decision).toUpperCase() === 'REJECT' ? 'chem-bad' : ''}">${escQcr(r.quality_decision)}</td></tr>`).join('')}</tbody></table></div>`;
    } else html += `<div class="chem-muted">No disposition records exist for this heat yet.</div>`;
    body.innerHTML = html;
  } catch(e){ body.innerHTML = `<div class="chem-note-strip">⚠️ ${escQcr(e.message)}</div>`; }
}

// ---------------------------------------------------------------- delegated clicks (charts, tables)
document.addEventListener('click', e => {
  const t = e.target;
  if(!t || !t.closest || !t.closest('#tab-chem')) return;
  const pt = t.closest('[data-heat]');
  if(pt){ openChemHeat(pt.getAttribute('data-heat')); return; }
  const row = t.closest('[data-param]');
  if(row){ chemSel.param = row.getAttribute('data-param'); chemSaveSel(); const sel = document.getElementById('chemParamSel'); if(sel) sel.value = chemSel.param; chemRefresh(); window.scrollTo({top: document.getElementById('tab-chem').offsetTop, behavior: 'smooth'}); }
});

// ---------------------------------------------------------------- tab registration
// The dashboard opens a tab through TAB_LOADERS[tabName](signal). Register the chemistry loader from here so the tab
// works no matter which other src/js piece defines the map. If the map is defined LATER in the bundle (still in its
// temporal dead zone now) or is not there yet, retry once the whole bundle has run.
(function chemRegisterTab(){
  const reg = () => {
    try {
      if(typeof TAB_LOADERS !== 'object' || !TAB_LOADERS) return false;
      if(typeof TAB_LOADERS.chem !== 'function') TAB_LOADERS.chem = loadChemSpc;
      return typeof TAB_LOADERS.chem === 'function';
    } catch (e) { return false; }
  };
  if(reg()) return;
  document.addEventListener('DOMContentLoaded', reg);
  window.addEventListener('load', reg);
})();
