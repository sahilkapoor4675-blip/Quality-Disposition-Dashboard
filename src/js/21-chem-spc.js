/* 21-chem-spc.js — "Chemistry SPC" tab: one heat = one point, I-MR control charts, histogram with LSL/USL,
   Cp/Cpk/Pp/Ppk, Western Electric rules, out-of-spec heat list joined to disposition defects/rejects by heat_no.
   Bundled into /app.js in filename order; see README ("Frontend source layout"). All maths is server-side (chem_spc.py). */
const CHEM_SEL_KEY = 'qdash_chem_sel_v1';
const CHEM_RULE_TEXT = {
  1: 'Rule 1: a point beyond 3σ from the centre line',
  2: 'Rule 2: 2 of 3 points beyond 2σ on the same side',
  3: 'Rule 3: 4 of 5 points beyond 1σ on the same side',
  4: 'Rule 4: 8 points in a row on one side of the centre line',
};
let chemMeta = null, chemData = null;
let chemSel = { spec: '', param: 'cu', last_n: 0 };
try { Object.assign(chemSel, JSON.parse(localStorage.getItem(CHEM_SEL_KEY) || '{}')); } catch (e) {}
delete chemSel.date_from; delete chemSel.date_to;   // older saved selections: dates are no longer used

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
    const k = document.getElementById('chemKpis'); if(k && k.parentNode) k.parentNode.insertBefore(b, k);
  }
  b.textContent = '⚠️ ' + msg + ' The charts below may show the previous selection.';
}
function chemClearError(){ const b = document.getElementById('chemErr'); if(b) b.remove(); }
function chemRefresh(){
  return refreshChemView().catch(e => { if(e && e.name === 'AbortError') return; console.error(e); chemShowError((e && e.message) || 'Could not load chemistry data.'); });
}
// A saved selection can be stale or hand-edited (localStorage): fall back to safe values instead of sending the API a 400.
function chemSanitiseSel(){
  if(!chemMeta.params.some(p => p.key === chemSel.param)) chemSel.param = 'cu';
  if(![0, 30, 50, 100, 200].includes(Number(chemSel.last_n))) chemSel.last_n = 0;
  chemSel.last_n = Number(chemSel.last_n) || 0;
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
  ['chemMainBox','chemKpis','chemIChart','chemMRChart','chemHist','chemOverviewBox','chemCompareBox','chemOosBox'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
}
function chemGroupLabel(g){
  if(g === '__none__') return 'No spec assigned (' + chemMeta.unassigned.heats + ' heats)';
  const s = chemMeta.specs.find(x => x.description === g);
  return s ? s.description + ' — ' + s.heats + ' heats' : g;
}
function renderChemControls(){
  const groups = chemMeta.specs.filter(s => s.heats > 0).map(s => s.description).concat(chemMeta.unassigned ? ['__none__'] : []);
  const spec = chemMeta.specs.find(s => s.description === chemSel.spec);
  const params = chemMeta.params;
  const opt = (v, t, cur) => `<option value="${escQcr(v)}"${v === cur ? ' selected' : ''}>${escQcr(t)}</option>`;
  document.getElementById('chemControls').innerHTML = `
    <div class="chem-ctl-row">
      <label class="chem-ctl"><span>Grade / spec</span><select id="chemSpecSel">${groups.map(g => opt(g, chemGroupLabel(g), chemSel.spec)).join('')}</select></label>
      <label class="chem-ctl"><span>Parameter</span><select id="chemParamSel">${params.map(p => opt(p.key, p.label, chemSel.param)).join('')}</select></label>
      <label class="chem-ctl"><span>Last N heats</span><select id="chemLastN">${[[0,'All'],[30,'30'],[50,'50'],[100,'100'],[200,'200']].map(([v,t]) => opt(String(v), t, String(chemSel.last_n))).join('')}</select></label>
      <label class="chem-ctl chem-find"><span>Find heat</span><input type="search" id="chemFindHeat" placeholder="e.g. NBS6348" autocomplete="off"></label>
    </div>
    <div class="chem-ctl-note">This tab has its own selectors; the dashboard filters above (month, work center, …) apply to disposition data and are not used here. Heats are plotted in heat-number order (no dates are used); "Last N heats" means the N highest heat numbers.</div>`;
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('chemSpecSel', 'change', e => { chemSel.spec = e.target.value; chemSaveSel(); renderChemControls(); chemRefresh(); });
  on('chemParamSel', 'change', e => { chemSel.param = e.target.value; chemSaveSel(); chemRefresh(); });
  on('chemLastN', 'change', e => { chemSel.last_n = Number(e.target.value) || 0; chemSaveSel(); chemRefresh(); });
  on('chemFindHeat', 'keydown', e => { if(e.key === 'Enter'){ const v = e.target.value.trim(); if(v) openChemHeat(v); } });
}
let chemReqSeq = 0;
async function refreshChemView(signal){
  const seq = ++chemReqSeq;
  const q = new URLSearchParams({spec: chemSel.spec, param: chemSel.param, last_n: chemSel.last_n});
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
  renderChemKpis(d);
  drawChemI(document.getElementById('chemIChart'), d);
  drawChemMR(document.getElementById('chemMRChart'), d);
  drawChemHist(document.getElementById('chemHist'), d);
  renderChemOverview(d); renderChemCompare(d); renderChemOos(d);
}

// ---------------------------------------------------------------- KPI cards
function renderChemKpis(d){
  const c = d.capability || {};
  const card = (label, value, sub, cls) => `<div class="kpi-card chem-kpi ${cls || ''}"><div class="label">${escQcr(label)}</div><div class="value">${value}</div><div class="prev">${sub || ''}</div></div>`;
  const lim = (d.lsl != null ? 'LSL ' + chemNum(d.lsl) : 'no LSL') + ' · ' + (d.usl != null ? 'USL ' + chemNum(d.usl) : 'no USL');
  const notes = [].concat(d.warnings || [], c.note ? [c.note] : []);
  document.getElementById('chemKpis').innerHTML =
    card('Heats plotted', d.n.toLocaleString(), `${d.summary.heats_with_disposition} of ${d.summary.heats} have disposition data`) +
    card('Mean', chemNum(c.mean), lim) +
    card('Cpk (within σ)', chemIdx(c.cpk), (chemIdxLabel(c.cpk) ? chemIdxLabel(c.cpk) + ' · ' : '') + (c.cp != null ? 'Cp ' + chemIdx(c.cp) : 'one-sided spec'), chemIdxClass(c.cpk)) +
    card('Ppk (overall σ)', chemIdx(c.ppk), (chemIdxLabel(c.ppk) ? chemIdxLabel(c.ppk) + ' · ' : '') + (c.pp != null ? 'Pp ' + chemIdx(c.pp) : 'one-sided spec'), chemIdxClass(c.ppk)) +
    card('Out-of-control points', d.summary.ooc_points.toLocaleString(), 'any Western Electric rule', d.summary.ooc_points ? 'chem-warn' : 'chem-good') +
    card('Out-of-spec heats', d.oos_total.toLocaleString(), 'any parameter of this grade', d.oos_total ? 'chem-bad' : 'chem-good') +
    (notes.length ? `<div class="chem-note-strip">${notes.map(n => 'ⓘ ' + escQcr(n)).join('<br>')}</div>` : '');
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
  const W = chartUnits(el), m = {l: 64, r: 78, t: 16, b: 46};
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
    if(im && !im.flat){
      [1, 2].forEach(k => [1, -1].forEach(sg => { const v = im.cl + sg * k * im.sigma_within; if(v > dom.lo && v < dom.hi) g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-axis)" stroke-dasharray="1 5"/>`; }));
    }
    g += line(d.lsl, '#DC2626', '7 4', 'LSL', 1.8) + line(d.usl, '#DC2626', '7 4', 'USL', 1.8);
    if(im){ g += line(im.ucl, '#D97706', '5 4', 'UCL') + line(im.lcl, '#D97706', '5 4', 'LCL') + line(im.cl, '#16A34A', '', 'CL', 1.6); }
    if(dom.off.lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 6}" font-size="11" font-weight="700" fill="#DC2626">▼ LSL ${chemNum(d.lsl)} is far below this scale</text>`;
    if(dom.off.usl) g += `<text x="${m.l + 6}" y="${m.t + 12}" font-size="11" font-weight="700" fill="#DC2626">▲ USL ${chemNum(d.usl)} is far above this scale</text>`;
    g += `<polyline fill="none" stroke="#118DFF" stroke-opacity=".55" stroke-width="1.2" points="${s.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.4 : n > 120 ? 3 : 3.8;
    s.forEach((p, i) => {
      const ooc = p.rules && p.rules.length, cls = p.oos ? '#DC2626' : ooc ? '#D97706' : '#118DFF';
      const tip = `${p.heat_no} — ${chemNum(p.value)}` + (p.oos ? ' · OUT OF SPEC' : '') + (ooc ? ' · ' + p.rules.map(x => 'WE rule ' + x).join(', ') : '') +
        (p.disp ? ` · ${p.disp.coils} coils, reject ${p.disp.reject_pct}%${p.disp.top_defects[0] ? ', top defect ' + p.disp.top_defects[0].defect : ''}` : ' · no disposition data');
      g += `<circle class="chem-pt" data-heat="${escQcr(p.heat_no)}" data-tip="${escQcr(tip)}" cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${p.oos ? r + 1.8 : ooc ? r + .8 : r}" fill="${cls}" ${p.oos ? 'stroke="#7f1d1d" stroke-width="1.6"' : 'stroke="var(--card)" stroke-width=".6"'}/>`;
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
  return `<div class="chem-legend"><span><i class="chem-dot" style="background:#118DFF"></i>In control</span><span><i class="chem-dot" style="background:#D97706"></i>Western Electric rule hit</span><span><i class="chem-dot" style="background:#DC2626;box-shadow:0 0 0 2px #7f1d1d"></i>Out of spec</span><span><i class="chem-ln" style="border-color:#16A34A"></i>Centre line</span><span><i class="chem-ln chem-dash" style="border-color:#D97706"></i>UCL / LCL (3σ)</span><span><i class="chem-ln chem-dash" style="border-color:#DC2626"></i>LSL / USL</span></div>`;
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
    const vline = (v, color, label, side, yOff) => v == null || v < h.xmin || v > h.xmax ? '' :
      `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}" stroke="${color}" stroke-width="2" ${label === 'Mean' ? '' : 'stroke-dasharray="7 4"'}/><text x="${X(v) + (side === 'l' ? -4 : 4)}" y="${m.t + 12 + (yOff || 0)}" text-anchor="${side === 'l' ? 'end' : 'start'}" font-size="11" font-weight="700" fill="${color}">${label} ${chemNum(v)}</text>`;
    // The Mean label sits beside its line; when the mean is close to USL (or LSL) it would run over that label, so
    // put it on the free side, and drop it one row lower when both limits are close (very tight spec).
    const mv = c && c.mean, near = (a, b) => a != null && b != null && a >= h.xmin && a <= h.xmax && b >= h.xmin && b <= h.xmax && Math.abs(X(a) - X(b)) < 90;
    let mSide = 'r', mOff = 0;
    if(mv != null && near(mv, d.usl) && d.usl >= mv) mSide = 'l';
    if(mv != null && mSide === 'l' && near(mv, d.lsl) && d.lsl <= mv){ mSide = 'r'; mOff = 14; }
    g += vline(d.lsl, '#DC2626', 'LSL', 'l') + vline(d.usl, '#DC2626', 'USL', 'r') + vline(mv, '#16A34A', 'Mean', mSide, mOff);
    if(h.lsl_off) g += `<text x="${m.l + 6}" y="${m.t + 44}" font-size="11" font-weight="700" fill="#DC2626">◀ LSL ${chemNum(d.lsl)} is far to the left of the data</text>`;
    if(h.usl_off) g += `<text x="${m.l + pw - 6}" y="${m.t + 44}" text-anchor="end" font-size="11" font-weight="700" fill="#DC2626">USL ${chemNum(d.usl)} is far to the right of the data ▶</text>`;
    xt.forEach(v => { g += `<text x="${X(v)}" y="${m.t + ph + 16}" text-anchor="middle" font-size="11" fill="var(--chart-muted)">${xf(v)}</text>`; });
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--chart-axis)"/><text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">Value (heats per bin; curve = normal fit on overall σ)</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Histogram with specification limits">${g}</svg>`;
  };
  redraw(); chartRemember(el, redraw);
}

// ---------------------------------------------------------------- tables / panels
function renderChemOverview(d){
  const rows = d.overview || [];
  const tr = r => `<tr class="chem-click${r.param === d.param ? ' chem-cur' : ''}${r.main ? ' chem-main-row' : ''}" data-param="${r.param}"><td><b>${r.main ? '★ ' : ''}${escQcr(r.label)}</b></td><td>${r.n}</td><td>${chemNum(r.mean)}</td><td>${r.lsl == null ? '—' : chemNum(r.lsl)}</td><td>${r.usl == null ? '—' : chemNum(r.usl)}</td><td class="${chemIdxClass(r.cp)}">${chemIdx(r.cp)}</td><td class="${chemIdxClass(r.cpk)}">${chemIdx(r.cpk)}${r.cpk != null ? ' <span class="chem-tier">' + chemIdxLabel(r.cpk) + '</span>' : ''}</td><td class="${chemIdxClass(r.pp)}">${chemIdx(r.pp)}</td><td class="${chemIdxClass(r.ppk)}">${chemIdx(r.ppk)}</td><td>${r.ooc}</td><td class="${r.oos ? 'chem-bad' : ''}">${r.oos}</td></tr>`;
  const mains = rows.filter(r => r.main), others = rows.filter(r => !r.main);
  const sep = t => `<tr class="chem-sep"><td colspan="11">${t}</td></tr>`;
  document.getElementById('chemOverviewBox').innerHTML = rows.length ? `<div class="chem-oos-bar"><button type="button" class="chem-btn" id="chemCpkCsv">⬇ Cpk table (CSV)</button><button type="button" class="chem-btn" id="chemHeatsCsv">⬇ Heat data — ${escQcr((chemMeta.params.find(p => p.key === d.param) || {}).label || d.param)} (CSV)</button></div><div class="chem-table-wrap"><table class="chem-table"><thead><tr><th>Parameter</th><th>Heats</th><th>Mean</th><th>LSL</th><th>USL</th><th>Cp</th><th>Cpk</th><th>Pp</th><th>Ppk</th><th>OOC pts</th><th>Out of spec</th></tr></thead><tbody>${mains.length ? sep('★ Main elements') + mains.map(tr).join('') : ''}${others.length ? sep('Impurities &amp; other parameters') + others.map(tr).join('') : ''}</tbody></table></div><div class="chem-foot">Click a row to chart that parameter. Copper-base rating: Cpk/Ppk ≥ 1.67 excellent, ≥ 1.33 capable (green), 1.00–1.33 marginal (amber), below 1.00 not capable (red). Where the lower limit is 0 (impurity-type limits) only the upper limit is used.</div>` : '<div class="chem-empty-chart">No parameters with enough data.</div>';
  const b1 = document.getElementById('chemCpkCsv'), b2 = document.getElementById('chemHeatsCsv');
  if(b1) b1.addEventListener('click', () => chemExportCpk(d));
  if(b2) b2.addEventListener('click', () => chemExportHeats(d));
}
// Main elements (Cu + the alloying elements of the grade): their Cpk is the headline of this tab.
function renderChemMain(d){
  const box = document.getElementById('chemMainBox'); if(!box) return;
  const mains = (d.overview || []).filter(r => r.main);
  if(!mains.length){ box.innerHTML = ''; return; }
  const card = r => {
    const off = r.cp != null && r.cpk != null && r.cp - r.cpk > 0.25;   // wide window but mean sits off-centre
    const lim = (r.lsl != null ? chemNum(r.lsl) : '—') + ' – ' + (r.usl != null ? chemNum(r.usl) : '—');
    return `<button type="button" class="chem-main-card ${chemIdxClass(r.cpk)}${r.param === d.param ? ' chem-cur' : ''}" data-param="${r.param}" title="Click to chart ${escQcr(r.label)}">
      <span class="chem-main-el">${escQcr(r.label)}</span>
      <span class="chem-main-cpk">${chemIdx(r.cpk)}</span>
      <span class="chem-main-tag">${r.cpk == null ? 'no Cpk' : escQcr(chemIdxLabel(r.cpk))}</span>
      <span class="chem-main-sub">Cpk · mean ${chemNum(r.mean)} · limits ${lim}</span>
      <span class="chem-main-sub">${r.cp != null ? 'Cp ' + chemIdx(r.cp) : 'one-sided'} · Ppk ${chemIdx(r.ppk)} · ${r.n} heats${r.n < 30 ? ' (indicative)' : ''}${off ? ' · <b>off-centre</b>' : ''}</span>
    </button>`;
  };
  box.innerHTML = `<div class="chem-main-head"><h3>★ Main elements — Cpk</h3><span class="chem-h3-sub">copper-base rating: ≥ 1.67 excellent · ≥ 1.33 capable · 1.00–1.33 marginal · &lt; 1.00 not capable</span></div><div class="chem-main-grid">${mains.map(card).join('')}</div>`;
}
function chemCmpCard(title, a, tone, hint, noLimits){
  const has = !noLimits && a && a.heats > 0;
  return `<div class="chem-cmp ${tone}"><div class="chem-cmp-t">${escQcr(title)}</div><div class="chem-cmp-v">${has && a.reject_pct != null ? a.reject_pct.toFixed(2) + '%' : '—'}</div><div class="chem-cmp-s">reject (by MT)</div><div class="chem-cmp-v2">${has && a.defect_pct != null ? a.defect_pct + '%' : '—'} <span>coils with a defect</span></div><div class="chem-cmp-f">${has ? `${a.heats} heats · ${a.coils} coils` : noLimits ? 'no limits defined for this group' : 'no heats with disposition data'}${has && a.heats < 10 ? '<br><b>small sample — read with care</b>' : ''}</div><div class="chem-cmp-h">${escQcr(hint)}</div></div>`;
}
function renderChemCompare(d){
  const c = d.summary.compare;
  document.getElementById('chemCompareBox').innerHTML = `<div class="chem-cmp-grid">${chemCmpCard('In spec (all parameters)', c.in_spec, 'ok', 'Heats whose chemistry met every limit', d.summary.has_limits === false)}${chemCmpCard('Out of spec', c.out_of_spec, 'bad', 'Heats with at least one limit breach')}${chemCmpCard('Out-of-control point (charted parameter)', c.out_of_control, 'warn', 'Heats that hit a Western Electric rule')}</div><div class="chem-foot">Only heats that also appear in the disposition data (matched on heat_no) are counted. ${d.summary.heats - d.summary.heats_with_disposition} of ${d.summary.heats} heats in this view have no disposition record yet (not inspected/rolled). Correlation is not proof of cause.</div>`;
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
  const lines = [['Grade / spec', 'Parameter', 'Main element', 'Heats', 'Mean', 'LSL', 'USL', 'Cp', 'Cpk', 'Cpk rating', 'Pp', 'Ppk', 'Out-of-control points', 'Out-of-spec heats', 'Indicative (< 30 heats)'].map(chemCsvCell).join(',')];
  rows.forEach(r => lines.push([(d.spec && d.spec.description) || '', r.label, r.main ? 'Yes' : 'No', r.n, num(r.mean), num(r.lsl), num(r.usl), num(r.cp), num(r.cpk),
    r.cpk == null ? '' : chemIdxLabel(r.cpk), num(r.pp), num(r.ppk), r.ooc, r.oos, r.n < 30 ? 'Yes' : 'No'].map(chemCsvCell).join(',')));
  chemDownloadCsv('chemistry_cpk_' + chemFileTag(d) + '.csv', lines);
}
// One row per heat for the charted parameter, in heat-number order, with its disposition summary.
function chemExportHeats(d){
  const s = (d && d.series) || []; if(!s.length) return;
  const label = (chemMeta && chemMeta.params.find(p => p.key === d.param) || {}).label || d.param;
  const lines = [['Heat no', label, 'Out of spec (this parameter)', 'Any parameter out of spec', 'Western Electric rules', 'Analyst', 'Coils', 'Reject %', 'Top defect'].map(chemCsvCell).join(',')];
  s.forEach(p => lines.push([p.heat_no, p.value, p.oos ? 'Yes' : 'No', p.heat_oos ? 'Yes' : 'No', (p.rules || []).join(' '), p.analyst || '',
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
      html += `<div class="chem-dlg-meta">${escQcr(d.spec || 'No spec assigned')} · analyst ${escQcr(c.analyst || '—')} · alloy ${escQcr(c.alloy || '—')} ${escQcr(c.denomination || '')}</div>
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
