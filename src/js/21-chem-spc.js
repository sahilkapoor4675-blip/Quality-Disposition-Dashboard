/* 21-chem-spc.js — "Chemistry SPC" tab: one heat = one point, big element cards (symbol + picture, Cp/Cpk/Pp/Ppk and their Std. Dev.),
   Month/Parameter/Grade/Heat-Qty/Week/Quarter/Fin.Year/Heat-No filters (same look and size as the dashboard filters, shown in the TOP filter bar
   while this tab is open, replacing the disposition filters), I-MR control charts and histogram with Standard AND Aim limits + mean,
   out-of-spec heat list joined to disposition defects/rejects by heat_no. The selection lives in the URL (chem_spec, chem_param, chem_month, ...),
   so a Chemistry view can be shared as a link; Compare Periods, Saved Views and the header Export dialog work on this tab too.
   Bundled into /app.js in filename order; see README ("Frontend source layout"). All maths is server-side (chem_spc.py). */
const CHEM_SEL_KEY = 'qdash_chem_sel_v1';
let chemMeta = null, chemData = null;
let chemCardPrevCpk = new Map();
let chemCardPrevTrend = new Map();
let chemFirstPaintDone = false;
let chemSel = { spec: '', param: 'cu', last_n: 0, month: '', week: '', quarter: '', fy: '', ins_icon: true, ins_cl: true, ins_aim: true };
try { Object.assign(chemSel, JSON.parse(localStorage.getItem(CHEM_SEL_KEY) || '{}')); } catch (e) {}
chemSel.ins_icon = chemSel.ins_cl = chemSel.ins_aim = true;   // the Insert box was removed: element pictures, centre line and Aim lines are always drawn
delete chemSel.date_from; delete chemSel.date_to;   // older saved selections used a from/to date range; it was replaced by Month/Week/Quarter/Fin.Year

// ---------------------------------------------------------------- selection <-> URL / saved views / compare
// The selection is remembered in the browser (localStorage) AND written to the address bar while this tab is open, so the link can be shared
// (and Compare Periods can open two live copies of this tab). A link that carries chem_* parameters wins over the stored selection.
const CHEM_URL_KEYS = {spec: 'chem_spec', param: 'chem_param', last_n: 'chem_n', month: 'chem_month', week: 'chem_week', quarter: 'chem_quarter', fy: 'chem_fy'};
const CHEM_PERIOD_KEYS = ['month', 'week', 'quarter', 'fy'];
function chemSelSnapshot(){
  return {spec: chemSel.spec || '', param: chemSel.param || '', last_n: Number(chemSel.last_n) || 0, month: chemSel.month || '', week: chemSel.week || '', quarter: chemSel.quarter || '', fy: chemSel.fy || ''};
}
function chemWriteUrl(params, snap){
  snap = snap || chemSelSnapshot();
  Object.keys(CHEM_URL_KEYS).forEach(k => { const v = snap[k]; if(v != null && v !== '' && v !== 0) params.set(CHEM_URL_KEYS[k], String(v)); });
}
function chemReadUrl(params){
  if(!Object.values(CHEM_URL_KEYS).some(u => params.has(u))) return null;
  const o = {};
  Object.keys(CHEM_URL_KEYS).forEach(k => { o[k] = params.get(CHEM_URL_KEYS[k]) || ''; });
  o.last_n = Number(o.last_n) || 0;
  return o;
}
// Used for a link / the browser's back-forward buttons. Anything that is not in the link means "All" (a link is a complete selection).
function chemApplyUrl(o){
  if(!o) return;
  if(o.spec) chemSel.spec = o.spec;
  if(o.param) chemSel.param = o.param;
  chemSel.last_n = Number(o.last_n) || 0;
  CHEM_PERIOD_KEYS.forEach(k => { chemSel[k] = o[k] || ''; });
  chemLastPeriod = '';
  if(chemMeta) chemSanitiseSel();   // before the first load the loader sanitises it once the grades / periods are known
}
// Saved Views (Save Preset / Manage Presets in the Selection bar of this tab).
function chemApplyView(v){
  if(!chemMeta || !v) return;
  const groups = chemMeta.specs.filter(s => s.heats > 0).map(s => s.description).concat(chemMeta.unassigned ? ['__none__'] : []);
  if(v.spec){
    if(groups.includes(v.spec)) chemSel.spec = v.spec;
    else showToast('info', 'Grade not available', 'The grade saved in this preset is no longer in the data, so the current grade was kept.');
  }
  if(v.param) chemSel.param = v.param;
  chemSel.last_n = Number(v.last_n) || 0;
  CHEM_PERIOD_KEYS.forEach(k => { chemSel[k] = v[k] || ''; });
  chemLastPeriod = '';
  chemSanitiseSel(); chemSaveSel(); renderChemControls(); chemRefresh();
}
// Compare Periods on this tab: which filters can be compared, and the values each offers (the periods of the grade on screen).
function chemCompareDims(){
  return [{key: 'month', label: 'Month'}, {key: 'week', label: 'Week'}, {key: 'quarter', label: 'Quarter'}, {key: 'fy', label: 'Financial Year'}, {key: 'spec', label: 'Grade'}, {key: 'param', label: 'Parameter'}];
}
function chemCompareItems(key){
  if(!chemMeta) return [];
  const lists = {month: 'months', week: 'weeks', quarter: 'quarters', fy: 'fys'};
  if(lists[key]) return (chemPeriods()[lists[key]] || []).map(v => ({value: v, label: v}));
  if(key === 'spec') return chemMeta.specs.filter(x => x.heats > 0).map(x => x.description).concat(chemMeta.unassigned ? ['__none__'] : []).map(g => ({value: g, label: chemGroupLabel(g)}));
  if(key === 'param') return chemMeta.params.map(p => ({value: p.key, label: p.label}));
  return [];
}

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
function chemSaveSel(){
  // A Compare Periods pane is a framed copy of this page: it must not overwrite the selection the main window remembers.
  try { if(window.self !== window.top) return; } catch (e) { return; }
  try { localStorage.setItem(CHEM_SEL_KEY, JSON.stringify(chemSel)); } catch (e) {}
}
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
  // Cancel an in-flight filter/parameter request before starting the newest one.
  // This prevents rapid clicks from queueing stale Chemistry responses and keeps
  // the dashboard visibly tied to the latest selection.
  if(chemRefreshController) chemRefreshController.abort();
  const ctl = new AbortController();
  chemRefreshController = ctl;
  return refreshChemView(ctl.signal).catch(e => {
    if(e && e.name === 'AbortError') return;
    console.error(e);
    chemShowError((e && e.message) || 'Could not load chemistry data.');
  }).finally(() => {
    if(chemRefreshController === ctl) chemRefreshController = null;
  });
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
  chemData = null;
  chemFirstPaintDone = false;
  chemCardPrevCpk = new Map();
  chemCardPrevTrend = new Map();
  chemTopBarEl().innerHTML = '';
  const summary = document.getElementById('chemFilterSummaryText');
  const count = document.getElementById('chemFilterRecordCount');
  const banner = document.getElementById('chemPeriodBanner');
  if(summary) summary.textContent = 'No Chemistry Data';
  if(count) count.textContent = '0 heats';
  if(banner) banner.innerHTML = '';
  document.getElementById('chemControls').innerHTML = '<div class="panel"><div class="panel-body"><div class="chem-empty"><b>No chemistry data yet.</b><br>An admin can load cast chemistry from <a href="/admin#chemImportPanel">Admin → Import Cast Chemistry</a> and grade limits from <a href="/admin#chemSpecPanel">Admin → Chemistry Spec Limits</a>.</div></div></div>';
  ['chemMainBox','chemNotes','chemIChart','chemMRChart','chemHist','chemOverviewBox','chemCompareBox','chemOosBox'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
}
function chemGroupLabel(g){
  if(g === '__none__') return 'No spec assigned (' + chemMeta.unassigned.heats + ' heats)';
  const s = chemMeta.specs.find(x => x.description === g);
  return s ? s.description + ' — ' + s.heats + ' heats' : g;
}
// The filters live in the TOP filter bar (inside #stickyControls, where the disposition filters normally are, and with the same .filters look) and are only visible
// while the Chemistry SPC tab is open; every other tab keeps the normal dashboard filters. Nothing is drawn inside the tab itself.
function chemTopBarEl(){
  let bar = document.getElementById('chemTopBar');
  if(!bar){
    bar = document.createElement('div'); bar.id = 'chemTopBar'; bar.className = 'filters chem-topbar hidden';
    const anchor = document.getElementById('filters'), host = document.getElementById('stickyControls');
    if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    else if(host) host.insertBefore(bar, host.firstChild);
    else document.body.insertBefore(bar, document.body.firstChild);
  }
  return bar;
}
function chemSyncMode(){
  const tab = document.getElementById('tab-chem'); if(!tab) return;
  const on = !tab.classList.contains('hidden') && tab.style.display !== 'none';
  if(!on && chemRefreshController){ chemRefreshController.abort(); chemRefreshController = null; }
  document.documentElement.classList.toggle('chem-mode', on);
  chemTopBarEl().classList.toggle('hidden', !on);
}
const CHEM_QTY = [['0', 'All'], ['10', '10'], ['20', '20'], ['30', '30'], ['50', '50'], ['100', '100'], ['200', '200']];
const CHEM_PERIOD_FIELDS = [['month', 'months'], ['week', 'weeks'], ['quarter', 'quarters'], ['fy', 'fys']];
let chemLastPeriod = '', chemFindVal = '';
function chemPeriodItems(list){ return [{value: '', label: 'All'}].concat((list || []).map(x => ({value: x, label: x}))); }
// An empty Month / Week / Quarter / FY list means the stored heats carry no cast date (they were imported without the file's Date column).
function chemNoDates(){ const p = chemMeta ? chemPeriods() : null; return !!(p && p.undated > 0 && !p.months.length); }
// One dropdown, built with the SAME markup/classes as the dashboard filters (.filter-field > .filter-control > .filter-trigger + .filter-menu),
// so size, font, icons, hover, open menu, dark mode and the "active" highlight all come from the dashboard's own CSS.
function chemFieldHtml(key, icon, label, items, cur, active){
  const shown = (items.find(x => x.value === cur) || items[0] || {label: 'All'}).label;
  const opts = items.map(x => `<div class="filter-option${x.value === '' ? ' all-option' : ''}${x.value === cur ? ' selected' : ''}" data-value="${escQcr(x.value)}">${escQcr(x.label)}</div>`).join('');
  return `<div class="filter-field${active ? ' filter-active' : ''}" data-chem-key="${key}"><label>${icon} ${label}</label><div class="filter-control"><button type="button" class="filter-trigger" aria-haspopup="listbox"><span>${escQcr(shown)}</span><span class="chevron">${qdIc('chevron-down')}</span></button><div class="filter-menu"><input class="filter-search" type="text" placeholder="Search options…" autocomplete="off"><div class="filter-options">${opts}</div></div></div></div>`;
}
function chemCurVal(key){ return key === 'last_n' ? String(Number(chemSel.last_n) || 0) : String(chemSel[key] == null ? '' : chemSel[key]); }
const CHEM_ACTIVE_KEYS = ['month', 'week', 'quarter', 'fy', 'last_n', 'param', 'spec'];
// Baseline view = first grade + Cu% + no period + all heats (what Reset All restores). Anything else counts as an active filter,
// exactly like a dashboard filter that is not "All".
function chemDefaultSpec(){
  const usable = (chemMeta && chemMeta.specs || []).filter(s => s.heats > 0);
  return usable[0] ? usable[0].description : (chemMeta && chemMeta.unassigned ? '__none__' : '');
}
function chemIsActive(key){
  if(!CHEM_ACTIVE_KEYS.includes(key)) return false;
  const v = chemCurVal(key);
  if(key === 'last_n') return v !== '0';
  if(key === 'param') return v !== '' && v !== 'cu';
  if(key === 'spec') return v !== '' && v !== chemDefaultSpec();
  return v !== '';
}
// Re-sync trigger text / selected option / active highlight / "N Active" badge from chemSel without rebuilding the dropdowns.
function chemSyncFields(){
  const bar = chemTopBarEl();
  bar.querySelectorAll('.filter-field[data-chem-key]').forEach(f => {
    const key = f.dataset.chemKey, v = chemCurVal(key);
    let label = null;
    f.querySelectorAll('.filter-option').forEach(o => { const on = o.dataset.value === v; o.classList.toggle('selected', on); if(on) label = o.textContent; });
    const span = f.querySelector('.filter-trigger span');
    if(span && label != null) span.textContent = label;
    f.classList.toggle('filter-active', chemIsActive(key));
  });
  const n = CHEM_ACTIVE_KEYS.filter(chemIsActive).length, badge = document.getElementById('chemActiveBadge');
  if(badge){ badge.textContent = n + ' Active'; badge.classList.toggle('show', n > 0); }
  const st = document.getElementById('statusActiveFilters'); if(st) st.textContent = String(n);
}
// Month / Week / Quarter / Fin. Year option lists follow the other three selections (like the dashboard's cascading filters).
function chemFillPeriods(lists){
  CHEM_PERIOD_FIELDS.forEach(([k, l]) => {
    const f = chemTopBarEl().querySelector(`.filter-field[data-chem-key="${k}"] .filter-options`); if(!f) return;
    const cur = chemCurVal(k);
    f.innerHTML = chemPeriodItems(lists[l]).map(x => `<div class="filter-option${x.value === '' ? ' all-option' : ''}${x.value === cur ? ' selected' : ''}" data-value="${escQcr(x.value)}">${escQcr(x.label)}</div>`).join('')
      + ((lists[l] || []).length ? '' : `<div class="filter-empty">${chemNoDates() ? 'No cast dates stored — re-import the chemistry file' : 'No periods for this selection'}</div>`);
  });
  chemSyncFields();
}
function chemFilterOptions(ctl, term){
  const q = String(term || '').trim().toLowerCase();
  let shown = 0;
  ctl.querySelectorAll('.filter-option').forEach(o => { const ok = !q || o.textContent.toLowerCase().includes(q); o.style.display = ok ? '' : 'none'; if(ok) shown++; });
  const box = ctl.querySelector('.filter-options'); let em = box.querySelector('.filter-empty');
  if(!shown && !em){ em = document.createElement('div'); em.className = 'filter-empty'; em.textContent = 'No matching options'; box.appendChild(em); }
  else if(shown && em) em.remove();
}
function chemPick(key, value){
  const sv = document.getElementById('chemSavedViewSelect'); if(sv) sv.value = '';
  if(key === 'spec'){ chemSel.spec = value; chemLastPeriod = ''; chemSanitiseSel(); chemSaveSel(); renderChemControls(); chemRefresh(); return; }
  if(key === 'last_n') chemSel.last_n = Number(value) || 0;
  else { chemSel[key] = value; if(CHEM_PERIOD_FIELDS.some(([k]) => k === key)) chemLastPeriod = key; }
  chemSaveSel(); chemSyncFields(); chemRefresh();
}
function chemResetAll(){
  // Match the dashboard's Reset All semantics: clear every user-facing Chemistry
  // filter, then restore the safest default grade/parameter selection so the tab
  // returns to a deterministic baseline instead of retaining a hidden selection.
  const usable = (chemMeta?.specs || []).filter(s => s.heats > 0);
  chemSel.spec = usable[0]?.description || (chemMeta?.unassigned ? '__none__' : '');
  chemSel.param = (chemMeta?.params || []).some(p => p.key === 'cu') ? 'cu' : ((chemMeta?.params || [])[0]?.key || 'cu');
  chemSel.month = chemSel.week = chemSel.quarter = chemSel.fy = '';
  chemSel.last_n = 0; chemLastPeriod = ''; chemFindVal = '';
  const inp = document.getElementById('chemFindHeat'); if(inp) inp.value = '';
  const sv = document.getElementById('chemSavedViewSelect'); if(sv) sv.value = '';
  chemSaveSel(); renderChemControls(); chemRefresh();
}
function chemBindBar(bar){
  if(bar._chemBound) return; bar._chemBound = true;
  bar.addEventListener('click', e => {
    const trig = e.target.closest('button.filter-trigger');
    if(trig){
      const ctl = trig.closest('.filter-control');
      document.querySelectorAll('.filter-control.open').forEach(c => { if(c !== ctl) c.classList.remove('open'); });
      ctl.classList.toggle('open');
      if(ctl.classList.contains('open')){ const sx = ctl.querySelector('.filter-search'); if(sx){ sx.value = ''; chemFilterOptions(ctl, ''); sx.focus(); } }
      return;
    }
    const opt = e.target.closest('.filter-option');
    if(opt){ const f = opt.closest('.filter-field'); f.querySelector('.filter-control').classList.remove('open'); chemPick(f.dataset.chemKey, opt.dataset.value); return; }
    if(e.target.closest('#chemCompareBtn')){ if(typeof window.qdOpenCompare === 'function') window.qdOpenCompare(); return; }
    if(e.target.closest('#chemResetAll')) chemResetAll();
  });
  bar.addEventListener('input', e => {
    if(e.target.classList.contains('filter-search')) chemFilterOptions(e.target.closest('.filter-control'), e.target.value);
    if(e.target.id === 'chemFindHeat') chemFindVal = e.target.value;
  });
  bar.addEventListener('keydown', e => {
    if(e.target.id === 'chemFindHeat' && e.key === 'Enter'){ const v = e.target.value.trim(); if(v) openChemHeat(v); }
    if(e.key === 'Escape') bar.querySelectorAll('.filter-control.open').forEach(c => c.classList.remove('open'));
  });
}
function renderChemControls(){
  const groups = chemMeta.specs.filter(s => s.heats > 0).map(s => s.description).concat(chemMeta.unassigned ? ['__none__'] : []);
  const per = chemPeriods();
  const tip = 'Month / Week / Quarter / Fin. Year come from the Date column of the chemistry file (financial year April–March, same labels as the main dashboard). Charts always run in heat-number order; “Heat Qty” = the N highest heat numbers of the selection. Cp / Cpk / Pp / Ppk are measured against the Standard limits.';
  const F = (key, icon, label, items, active) => chemFieldHtml(key, icon, label, items, chemCurVal(key), active);
  // same 4-column layout and order as the dashboard filters: Month | Work Center→Parameter | Grade | Quality Decision→Heat Qty  /  Week | Quarter | Fin. Year | Defect Intensity→Heat No.
  chemTopBarEl().innerHTML = `
    <div class="filter-toolbar"><div class="filter-toolbar-title" title="${escQcr(tip)}">${qdIc('filter')}Chemistry Filters <span class="chem-tb-i">ⓘ</span></div><div class="filter-actions"><span id="chemActiveBadge" class="active-filter-badge">0 Active</span><button id="chemCompareBtn" class="reset-all" type="button">${qdIc('compare')}Compare Periods</button><button id="chemResetAll" class="reset-all" type="button">${qdIc('reset')}Reset All</button></div></div>
    ${F('month', '📅', 'Month', chemPeriodItems(per.months), chemIsActive('month'))}
    ${F('param', '🔬', 'Parameter', chemMeta.params.map(p => ({value: p.key, label: p.label})), chemIsActive('param'))}
    ${F('spec', '🧪', 'Grade', groups.map(g => ({value: g, label: chemGroupLabel(g)})), chemIsActive('spec'))}
    ${F('last_n', '🔢', 'Heat Qty (Last N)', CHEM_QTY.map(([v, t]) => ({value: v, label: t})), chemIsActive('last_n'))}
    ${F('week', '🗓️', 'Week', chemPeriodItems(per.weeks), chemIsActive('week'))}
    ${F('quarter', '📊', 'Quarter', chemPeriodItems(per.quarters), chemIsActive('quarter'))}
    ${F('fy', '📆', 'Financial Year', chemPeriodItems(per.fys), chemIsActive('fy'))}
    <div class="filter-field"><label>🔥 Heat No.</label><div class="filter-control"><input type="search" id="chemFindHeat" class="filter-trigger chem-heat-input" placeholder="e.g. NBS6348 ↵" autocomplete="off" value="${escQcr(chemFindVal)}"></div></div>`;
  chemBindBar(chemTopBarEl());
  chemSyncMode();
  chemSyncFields();
}
let chemReqSeq = 0;
let chemRefreshController = null;
let chemDrillSeq = 0;
let chemDrillController = null;
let chemChartReadySeq = 0;

function chemSetRefreshState(on){
  const panel = document.getElementById('tab-chem');
  const page = document.querySelector('.container');
  if(panel) panel.classList.toggle('chem-dashboard-refreshing', on);
  if(page) page.classList.toggle('dashboard-refreshing', on);
  document.querySelectorAll('#tab-chem .kpi-card').forEach(c => c.classList.toggle('shimmering', on));
  document.querySelectorAll('#tab-chem .chart-scroll').forEach(c => c.classList.toggle('chart-refreshing', on));
  const bar = chemTopBarEl();
  if(bar && on){ bar.classList.remove('filter-pulse'); void bar.offsetWidth; bar.classList.add('filter-pulse'); }
}
function chemMarkChartsReady(){
  const readySeq = ++chemChartReadySeq;
  document.querySelectorAll('#tab-chem .chart-scroll').forEach(c => {
    c.classList.remove('chart-ready');
    void c.offsetWidth;
    c.classList.remove('chart-refreshing');
    c.classList.add('chart-ready');
    setTimeout(() => { if(readySeq === chemChartReadySeq) c.classList.remove('chart-ready'); }, 700);
  });
}
function chemRenderPeriodBanner(d){
  const el = document.getElementById('chemPeriodBanner');
  if(!el) return;
  const p = d && d.period_comparison;
  if(p && p.mode === 'last_n'){
    el.innerHTML = `📅 <b>Current:</b> Last ${p.last_n} heats &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> the ${p.prev_heats} heat${p.prev_heats === 1 ? '' : 's'} before them`;
    return;
  }
  if(!p || !p.current || !(p.current.month || p.current.week || p.current.quarter || p.current.fy)){
    el.innerHTML = '📅 <b>Current Period:</b> All Periods &nbsp;&nbsp;|&nbsp;&nbsp; <i>Select a single Month/Week/Quarter/FY (or a Heat Qty) to see the trend arrows</i>';
    return;
  }
  const labels = [];
  if(p.current.week) labels.push(p.current.week);
  if(p.current.month) labels.push(p.current.month);
  if(p.current.quarter) labels.push(p.current.quarter);
  if(p.current.fy) labels.push(p.current.fy);
  const cur = labels.join(' · ');
  const prev = p.previous;
  const prevLabel = prev ? [prev.week,prev.month,prev.quarter,prev.fy].filter(Boolean).join(' · ') : '';
  el.innerHTML = prevLabel
    ? `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> ${escQcr(prevLabel)}`
    : `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; <i>No comparable previous period is available for this selection</i>`;
}
function chemRenderFilterSummary(d){
  const text = document.getElementById('chemFilterSummaryText');
  const count = document.getElementById('chemFilterRecordCount');
  if(!text || !count) return;
  const spec = chemSel.spec === '__none__' ? 'No spec assigned' : (chemSel.spec || 'All Grades');
  const param = (chemMeta && chemMeta.params.find(p => p.key === d.param)?.label) || d.param || 'Parameter';
  const parts = [spec, param];
  if(chemSel.month) parts.push(chemSel.month);
  if(chemSel.week) parts.push(chemSel.week);
  if(chemSel.quarter) parts.push(chemSel.quarter);
  if(chemSel.fy) parts.push(chemSel.fy);
  if(chemSel.last_n) parts.push(`Last ${chemSel.last_n} heats`);
  text.textContent = parts.join(' • ');
  const n = Number(d.n_heats ?? d.n ?? 0);
  count.textContent = `${n.toLocaleString()} heat${n === 1 ? '' : 's'}`;
}
async function refreshChemView(signal){
  const seq = ++chemReqSeq;
  const q = new URLSearchParams({spec: chemSel.spec, param: chemSel.param, last_n: chemSel.last_n, month: chemSel.month, week: chemSel.week, quarter: chemSel.quarter, fy: chemSel.fy});
  const box = document.getElementById('tab-chem');
  const hadView = !!chemData;
  box.classList.add('chem-loading');
  if(hadView) chemSetRefreshState(true);
  try {
    const d = await chemFetch('/api/chem/spc?' + q.toString(), signal);
    if(seq !== chemReqSeq) return;
    chemData = d; chemClearError();
    // Month / Week / Quarter / Fin. Year that no longer fit together (e.g. Month = Jan-2026 but Quarter switched to Q1) would show 'no heats':
    // the one changed last wins, the others go back to All, then the view is fetched once more.
    if(d.periods_cascade){
      const bad = CHEM_PERIOD_FIELDS.filter(([k, l]) => chemSel[k] && !d.periods_cascade[l].includes(chemSel[k])).map(([k]) => k);
      if(bad.length){
        let drop = bad.filter(k => k !== chemLastPeriod); if(!drop.length) drop = bad;
        drop.forEach(k => { chemSel[k] = ''; });
        chemSaveSel(); chemSyncFields();
        return refreshChemView(signal);
      }
      chemFillPeriods(d.periods_cascade);
    }
    // Keep the user's chosen parameter even when that parameter has no values for
    // the selected period/grade. Auto-switching to another element was surprising,
    // changed the visible filter without user input, and could trigger a second request.
    renderChemAll();
    chemRenderPeriodBanner(d);
    chemRenderFilterSummary(d);
    chemMarkChartsReady();
    if(typeof writeUrlState === 'function') writeUrlState(false);   // keep the address bar = the selection on screen (shareable link)
  } finally {
    if(seq === chemReqSeq){
      box.classList.remove('chem-loading');
      chemSetRefreshState(false);
    }
  }
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
  const per = chemPeriods(), periodOn = !!(chemSel.month || chemSel.week || chemSel.quarter || chemSel.fy);
  const aimAny = d.spec && d.spec.aim && Object.keys(d.spec.aim).length > 0;
  const pl = (chemMeta.params.find(p => p.key === d.param) || {}).label || d.param;
  const aimNote = !chemSel.ins_aim ? [] : !aimAny ? ['No Aim limits are stored for this grade, so no Aim line can be drawn. Load the AIM sheet of Standard.xlsx in Admin → Spec Limits (or type the Aim limits there).']
    : (d.aim_lsl == null && d.aim_usl == null) ? [`This grade has no Aim limit for ${pl}, so no Aim line is drawn for it.`] : [];
  const notes = [].concat(d.summary.heats ? [] : ['No heats match this selection (check Month / Week / Quarter / Fin. Year, or the grade).'],
    chemNoDates() ? [`No cast date is stored for the ${per.undated.toLocaleString()} heat(s) of this grade, so the Month / Week / Quarter / Fin. Year lists, Compare Periods and the period trend are empty. Re-import the chemistry file in Admin → Cast Chemistry: its Date column is read on import and fills these filters (existing heats are updated, nothing is duplicated).`] : [],
    periodOn && per.undated && !chemNoDates() ? [`${per.undated} heat(s) of this grade have no readable date and drop out while a Month / Week / Quarter / Fin. Year filter is set.`] : [],
    aimNote, d.warnings || [], c.note ? [c.note] : []);
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

// Large Chemistry selections can contain thousands of heats. Rendering a DOM/SVG circle
// for every heat makes browsers spend far more time laying out/painting than the server
// spends calculating SPC. Keep the full series in the polyline and use a bounded set of
// marker nodes. A nearest-point hover overlay still exposes the exact heat/value for every
// underlying data point, so this is a render optimization, not a data reduction.
const CHEM_MAX_POINT_MARKERS = 720;
function chemMarkerIndexes(series, priority){
  const n = series.length;
  if(n <= CHEM_MAX_POINT_MARKERS) return Array.from({length:n}, (_,i)=>i);
  const pri = [];
  for(let i=0;i<n;i++) if(!priority || priority(series[i],i)) pri.push(i);
  const out = new Set();
  if(pri.length >= CHEM_MAX_POINT_MARKERS){
    const span = Math.max(1, pri.length - 1);
    for(let k=0;k<CHEM_MAX_POINT_MARKERS;k++) out.add(pri[Math.round(k*span/(CHEM_MAX_POINT_MARKERS-1))]);
  } else {
    pri.forEach(i=>out.add(i));
    const remain = CHEM_MAX_POINT_MARKERS - out.size;
    if(remain > 0){
      const step = Math.max(1, (n-1)/Math.max(1, remain-1));
      for(let k=0;k<remain;k++) out.add(Math.min(n-1, Math.round(k*step)));
    }
  }
  return [...out].sort((a,b)=>a-b);
}
function chemBindNearestHover(svg, rect, series, field, tipForIndex, heatForIndex){
  if(!svg || !rect || !series.length || typeof chartTooltipEl !== 'function' || typeof positionChartTooltip !== 'function') return;
  const show = (ev) => {
    const r = rect.getBoundingClientRect(), px = Math.max(0, Math.min(r.width, ev.clientX - r.left));
    const idx = series.length === 1 ? 0 : Math.round((px / Math.max(1,r.width)) * (series.length - 1));
    const tip = tipForIndex(series[idx], idx);
    const el = chartTooltipEl();
    el.innerHTML = '<span class="ct-main">' + escQcr(tip) + '</span>' + (field ? '<span class="ct-field">' + qdIc('tag') + escQcr(field) + '</span>' : '');
    el.classList.add('show');
    positionChartTooltip(ev.clientX, ev.clientY);
  };
  rect.addEventListener('pointermove', show);
  rect.addEventListener('pointerleave', () => chartTooltipEl().classList.remove('show'));
  if(typeof heatForIndex === 'function') rect.addEventListener('click', ev => {
    const r = rect.getBoundingClientRect(), px = Math.max(0, Math.min(r.width, ev.clientX - r.left));
    const idx = series.length === 1 ? 0 : Math.round((px / Math.max(1,r.width)) * (series.length - 1));
    const heat = heatForIndex(series[idx], idx);
    if(heat) { ev.stopPropagation(); openChemHeat(heat); }
  });
}

// Fixed-size box so labels stay readable; width follows the container like the other charts.
function chemBox(el, h){
  const W = chartUnits(el), m = {l: 64, r: 122, t: 16, b: 46};
  return {W, H: h, m, pw: W - m.l - m.r, ph: h - m.t - m.b};
}
function chemDomain(vals, d, extra){
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Statistical UCL/LCL remain available in d.imr for diagnostics, but are not
  // visual bounds. Aim limits are the plant operating bounds shown to users.
  const off = {lsl: false, usl: false, aim_lsl: false, aim_usl: false};
  const span0 = (hi - lo) || Math.abs(hi) * 0.02 || 0.01;
  [['lsl', d.lsl], ['usl', d.usl]].forEach(([k, v]) => {
    if(v == null) return;
    const dist = k === 'lsl' ? lo - v : v - hi;
    if(dist <= 2.5 * span0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } else off[k] = true;
  });
  // Aim limits are handled exactly like the Standard limits: they widen the scale, or - when far outside the data - get a note
  // (they used to vanish silently when they were far from the data).
  if(chemSel.ins_aim) [['aim_lsl', d.aim_lsl, 'lo'], ['aim_usl', d.aim_usl, 'hi']].forEach(([k, v, side]) => {
    if(v == null) return;
    const dist = side === 'lo' ? lo - v : v - hi;
    if(dist <= 2.5 * span0){ lo = Math.min(lo, v); hi = Math.max(hi, v); } else off[k] = true;
  });
  const pad = ((hi - lo) || 0.02) * 0.06;
  return {lo: lo - pad, hi: hi + pad, off};
}

// ---------------------------------------------------------------- I chart
function drawChemI(el, d){
  if(!el) return;
  el.dataset.chartField = (chemMeta && chemMeta.params.find(p => p.key === d.param)?.label) || d.param || 'Chemistry value';
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
      for(let k = 0; k < 4 && usedY.some(u => Math.abs(u - ty) < 12); k++) ty += 12;   // keep neighbouring limit labels readable
      usedY.push(ty);
      return `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${color}" stroke-width="${sw || 1.4}" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${m.l + pw + 6}" y="${ty}" font-size="11" font-weight="700" fill="${color}">${label} ${chemNum(v)}</text>`;
    };
    if(chemSel.ins_aim && (d.aim_lsl != null || d.aim_usl != null)){   // light band between the Aim limits
      const y0 = Math.max(m.t, Math.min(m.t + ph, d.aim_usl != null ? Y(d.aim_usl) : m.t)), y1 = Math.max(m.t, Math.min(m.t + ph, d.aim_lsl != null ? Y(d.aim_lsl) : m.t + ph));
      if(y1 > y0) g += `<rect x="${m.l}" y="${y0.toFixed(1)}" width="${pw}" height="${(y1 - y0).toFixed(1)}" fill="#0D9488" fill-opacity=".07"/>`;
    }
    g += line(d.lsl, '#DC2626', '7 4', 'Std LSL', 1.8) + line(d.usl, '#DC2626', '7 4', 'Std USL', 1.8);
    if(chemSel.ins_aim) g += line(d.aim_lsl, '#0D9488', '', 'Aim LSL', 2.2) + line(d.aim_usl, '#0D9488', '', 'Aim USL', 2.2);
    if(im && chemSel.ins_cl){ g += line(im.cl, '#16A34A', '', 'Mean', 1.8); }
    if(dom.off.lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 6}" font-size="11" font-weight="700" fill="#DC2626">▼ Std LSL ${chemNum(d.lsl)} is far below this scale</text>`;
    if(dom.off.usl) g += `<text x="${m.l + 6}" y="${m.t + 12}" font-size="11" font-weight="700" fill="#DC2626">▲ Std USL ${chemNum(d.usl)} is far above this scale</text>`;
    if(dom.off.aim_lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 20}" font-size="11" font-weight="700" fill="#0D9488">▼ Aim LSL ${chemNum(d.aim_lsl)} is far below this scale</text>`;
    if(dom.off.aim_usl) g += `<text x="${m.l + 6}" y="${m.t + 26}" font-size="11" font-weight="700" fill="#0D9488">▲ Aim USL ${chemNum(d.aim_usl)} is far above this scale</text>`;
    g += `<polyline fill="none" stroke="#118DFF" stroke-opacity=".55" stroke-width="1.2" points="${s.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.4 : n > 120 ? 3 : 3.8;
    const markerIdx = chemMarkerIndexes(s, p => !!p.oos);
    markerIdx.forEach(i => {
      const p = s[i], cls = p.oos ? '#DC2626' : '#118DFF';
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
    el.innerHTML = `${chemLegend()}<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Individuals control chart">${g}<rect class="chem-hover-layer" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="pointer-events:all;cursor:crosshair"/></svg>`;
    const svg = el.querySelector('svg'), hover = svg?.querySelector('.chem-hover-layer');
    chemBindNearestHover(svg, hover, s, el.dataset.chartField, p => {
      const tip = `${p.heat_no}${p.cast_date ? ' · ' + p.cast_date : ''} — ${chemNum(p.value)}` + (p.oos ? ' · OUT OF SPEC' : '') +
        (p.disp ? ` · ${p.disp.coils} coils, reject ${p.disp.reject_pct}%${p.disp.top_defects[0] ? ', top defect ' + p.disp.top_defects[0].defect : ''}` : ' · no disposition data');
      return tip;
    }, p => p.heat_no);
  };
  redraw(); chartRemember(el, redraw);
}
function chemLegend(){
  return `<div class="legend chem-legend"><span><i class="chem-dot" style="background:#118DFF"></i>Heat (in spec)</span><span><i class="chem-dot" style="background:#DC2626;box-shadow:0 0 0 2px #7f1d1d"></i>Out of spec</span>${chemSel.ins_cl ? '<span><i class="chem-ln" style="border-color:#16A34A"></i>Mean (centre line)</span>' : ''}<span><i class="chem-ln chem-dash" style="border-color:#DC2626"></i>Standard LSL / USL</span>${chemSel.ins_aim ? '<span><i class="chem-ln" style="border-color:#0D9488"></i>Aim LSL / USL (operating bounds)</span>' : ''}</div>`;
}

// ---------------------------------------------------------------- MR chart
function drawChemMR(el, d){
  if(!el) return;
  el.dataset.chartField = 'Moving Range';
  if(!d.mr || !d.mr.length || !d.imr) return chemEmptyChart(el, 'Need at least 2 heats for a moving-range chart.');
  const redraw = () => {
    const B = chemBox(el, 220), {W, H, m, pw, ph} = B, mr = d.mr, n = mr.length, im = d.imr;
    const hi0 = Math.max(...mr) * 1.12 || 0.01;
    const X = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), Y = v => m.t + ph - (v / hi0) * ph;
    const yt = chemTicks(0, hi0, 4), yf = chemTickFmt(yt.length > 1 ? yt[1] - yt[0] : 1);
    let g = '';
    yt.forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${yf(v)}</text>`; });
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(im.mrbar)}" y2="${Y(im.mrbar)}" stroke="#16A34A" stroke-width="1.6"/><text x="${m.l + pw + 6}" y="${Y(im.mrbar) + 4}" font-size="11" font-weight="700" fill="#16A34A">MR̄ ${chemNum(im.mrbar)}</text>`;
    g += `<polyline fill="none" stroke="#7C3AED" stroke-opacity=".55" stroke-width="1.1" points="${mr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.2 : n > 120 ? 2.8 : 3.4;
    const markerIdx = chemMarkerIndexes(mr, v => v > im.mr_ucl);
    markerIdx.forEach(i => {
      const v = mr[i], bad = v > im.mr_ucl, p = d.series[i + 1];
      g += `<circle class="chem-pt" data-heat="${escQcr(p.heat_no)}" data-tip="${escQcr(`MR ${d.series[i].heat_no} → ${p.heat_no}: ${chemNum(v)}${bad ? ' · above UCL (sudden jump)' : ''}`)}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${bad ? r + 1.2 : r}" fill="${bad ? '#D97706' : '#7C3AED'}" stroke="var(--card)" stroke-width=".6"/>`;
    });
    g += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">|Δ| between consecutive heats</text><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--chart-axis)"/>`;
    el.innerHTML = `<div class="legend chem-legend"><span><i class="chem-ln" style="border-color:#16A34A"></i>MR̄ (centre line)</span><span><i class="chem-ln" style="border-color:#7C3AED"></i>Moving Range</span><span><i class="chem-dot" style="background:#D97706"></i>MR above diagnostic UCL</span></div><svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Moving range chart">${g}<rect class="chem-hover-layer" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="pointer-events:all;cursor:crosshair"/></svg>`;
    const svg = el.querySelector('svg'), hover = svg?.querySelector('.chem-hover-layer');
    const mrSeries = mr.map((v,i)=>({v,i}));
    chemBindNearestHover(svg, hover, mrSeries, 'Moving Range', x => `MR ${d.series[x.i].heat_no} → ${d.series[x.i+1].heat_no}: ${chemNum(x.v)}${x.v > im.mr_ucl ? ' · above UCL (sudden jump)' : ''}`, x => d.series[x.i+1].heat_no);
  };
  redraw(); chartRemember(el, redraw);
}

// ---------------------------------------------------------------- Histogram
function drawChemHist(el, d){
  if(!el) return;
  el.dataset.chartField = (chemMeta && chemMeta.params.find(p => p.key === d.param)?.label) || d.param || 'Chemistry value';
  const h = d.histogram;
  if(!d.n || !h || !h.bins.length) return chemEmptyChart(el, 'No data to build a histogram.');
  const redraw = () => {
    const B = chemBox(el, 300), {W, H, m, pw, ph} = B, c = d.capability;
    const maxN = Math.max(...h.bins.map(b => b.n), 1) * 1.12;
    // The server range only knows the Standard limits: widen it so the Aim limits are drawn too (unless they are far off the data)
    const dLo = h.bins[0].x0, dHi = h.bins[h.bins.length - 1].x1, ref = (dHi - dLo) || h.width || 0.01;
    let xmin = h.xmin, xmax = h.xmax, aimOffL = false, aimOffR = false;
    if(chemSel.ins_aim){
      if(d.aim_lsl != null){ if(dLo - d.aim_lsl <= 4 * ref) xmin = Math.min(xmin, d.aim_lsl - ref * 0.04); else aimOffL = true; }
      if(d.aim_usl != null){ if(d.aim_usl - dHi <= 4 * ref) xmax = Math.max(xmax, d.aim_usl + ref * 0.04); else aimOffR = true; }
    }
    const X = v => m.l + ((v - xmin) / (xmax - xmin)) * pw, Y = v => m.t + ph - (v / maxN) * ph;
    const xt = chemTicks(xmin, xmax, Math.max(4, Math.floor(pw / 90))), xf = chemTickFmt(xt.length > 1 ? xt[1] - xt[0] : 1);
    let g = '';
    chemTicks(0, maxN, 4).forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${Math.round(v)}</text>`; });
    h.bins.forEach(b => {
      const out = (d.lsl != null && b.x1 <= d.lsl) || (d.usl != null && b.x0 >= d.usl);
      const x0 = X(b.x0), w = Math.max(1, X(b.x1) - X(b.x0) - 1);
      const labelY = Math.max(m.t + 11, Y(b.n) - 5);
      g += `<rect class="chart-bar chem-hist-bar" style="--i:${Math.min(h.bins.indexOf(b),10)}" data-tip="${escQcr(`${chemNum(b.x0)} – ${chemNum(b.x1)}: ${b.n} heat${b.n === 1 ? '' : 's'}${out ? ' (out of spec)' : ''}`)}" x="${x0.toFixed(1)}" y="${Y(b.n).toFixed(1)}" width="${w.toFixed(1)}" height="${(m.t + ph - Y(b.n)).toFixed(1)}" fill="${out ? '#DC2626' : '#118DFF'}" fill-opacity=".78"/>`;
      if(b.n > 0 && w >= 22) g += `<text class="chem-hist-label" x="${(x0 + w/2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--chart-muted)">${b.n}</text>`;
    });
    if(c && c.sigma_overall > 0 && c.mean != null){
      const area = d.n * h.width, pts = [];
      for(let i = 0; i <= 120; i++){ const v = xmin + (xmax - xmin) * i / 120, z = (v - c.mean) / c.sigma_overall; const y = area * Math.exp(-z * z / 2) / (c.sigma_overall * Math.sqrt(2 * Math.PI)); pts.push(`${X(v).toFixed(1)},${Math.max(m.t, Y(y)).toFixed(1)}`); }
      g += `<polyline fill="none" stroke="var(--text)" stroke-width="1.6" stroke-opacity=".8" points="${pts.join(' ')}"/>`;
    }
    // one label row per kind of line (Standard, Aim, Mean) so labels never run over each other
    // a label that would run into the y-axis / right margin flips to the other side of its line; a card-coloured halo keeps text readable over bars
    const vline = (v, color, label, side0, row, solid) => { if(v == null || v < xmin || v > xmax) return ''; const side = side0 === 'l' && X(v) - m.l < 112 ? 'r' : side0 === 'r' && m.l + pw - X(v) < 112 ? 'l' : side0; return `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}" stroke="${color}" stroke-width="${solid ? 2 : 1.8}" ${solid ? '' : 'stroke-dasharray="7 4"'}/><text x="${X(v) + (side === 'l' ? -4 : 4)}" y="${m.t + 12 + (row || 0) * 14}" text-anchor="${side === 'l' ? 'end' : 'start'}" font-size="11" font-weight="700" fill="${color}" stroke="var(--card)" stroke-width="3" paint-order="stroke">${label} ${chemNum(v)}</text>`; };
    const mv = c && c.mean;
    g += vline(d.lsl, '#DC2626', 'Std LSL', 'l', 0) + vline(d.usl, '#DC2626', 'Std USL', 'r', 0);
    if(chemSel.ins_aim && d.aim_lsl != null && d.aim_usl != null && d.aim_lsl >= xmin && d.aim_usl <= xmax)   // light band between the Aim limits
      g += `<rect x="${X(d.aim_lsl).toFixed(1)}" y="${m.t}" width="${(X(d.aim_usl) - X(d.aim_lsl)).toFixed(1)}" height="${ph}" fill="#0D9488" fill-opacity=".07"/>`;
    if(chemSel.ins_aim) g += vline(d.aim_lsl, '#0D9488', 'Aim LSL', 'l', 1, true) + vline(d.aim_usl, '#0D9488', 'Aim USL', 'r', 1, true);
    if(chemSel.ins_cl) g += vline(mv, '#16A34A', 'Mean', mv != null && d.usl != null && d.lsl != null && (mv - d.lsl) > (d.usl - mv) ? 'l' : 'r', 2, true);
    if(h.lsl_off) g += `<text x="${m.l + 6}" y="${m.t + 60}" font-size="11" font-weight="700" fill="#DC2626">◀ Std LSL ${chemNum(d.lsl)} is far to the left of the data</text>`;
    if(h.usl_off) g += `<text x="${m.l + pw - 6}" y="${m.t + 60}" text-anchor="end" font-size="11" font-weight="700" fill="#DC2626">Std USL ${chemNum(d.usl)} is far to the right of the data ▶</text>`;
    if(aimOffL) g += `<text x="${m.l + 6}" y="${m.t + 74}" font-size="11" font-weight="700" fill="#0D9488">◀ Aim LSL ${chemNum(d.aim_lsl)} is far to the left of the data</text>`;
    if(aimOffR) g += `<text x="${m.l + pw - 6}" y="${m.t + 74}" text-anchor="end" font-size="11" font-weight="700" fill="#0D9488">Aim USL ${chemNum(d.aim_usl)} is far to the right of the data ▶</text>`;
    xt.forEach(v => { g += `<text x="${X(v)}" y="${m.t + ph + 16}" text-anchor="middle" font-size="11" fill="var(--chart-muted)">${xf(v)}</text>`; });
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--chart-axis)"/><text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--chart-axis-title)">Value (heats per bin; curve = normal fit on overall σ)</text>`;
    el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Histogram with specification limits">${g}</svg>`;
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
  document.getElementById('chemOverviewBox').innerHTML = rows.length ? `<div class="chem-oos-bar"><button type="button" class="chem-btn" id="chemCpkCsv">⬇ Cpk table (CSV)</button><button type="button" class="chem-btn" id="chemHeatsCsv">⬇ Heat data — ${escQcr((chemMeta.params.find(p => p.key === d.param) || {}).label || d.param)} (CSV)</button></div><div class="table-scroll"><table class="chem-table"><thead><tr><th>Parameter</th><th>Heats</th><th>Mean</th><th>Std LSL</th><th>Std USL</th><th>Aim LSL</th><th>Aim USL</th><th>Cp</th><th>Cpk</th><th>Std. Dev. (Cp/Cpk)</th><th>Pp</th><th>Ppk</th><th>Std. Dev. (Pp/Ppk)</th><th>Out of spec</th></tr></thead><tbody>${mains.length ? sep('★ Main elements') + mains.map(tr).join('') : ''}${others.length ? sep('Impurities &amp; other parameters') + others.map(tr).join('') : ''}</tbody></table></div><div class="chem-foot">Click a row to chart that parameter. Cp/Cpk use the within σ (moving range ÷ 1.128), Pp/Ppk the overall σ; both against the Standard limits. Rating: ≥ 1.67 excellent, ≥ 1.33 capable (green), 1.00–1.33 marginal (amber), below 1.00 not capable (red). Where the lower limit is 0 (impurity-type limits) only the upper limit is used.</div>` : '<div class="chem-empty-chart">No parameters with enough data.</div>';
  const b1 = document.getElementById('chemCpkCsv'), b2 = document.getElementById('chemHeatsCsv');
  if(b1) b1.addEventListener('click', () => chemExportCpk(d));
  if(b2) b2.addEventListener('click', () => chemExportHeats(d));
}
// ---------------------------------------------------------------- element cards (symbol + picture + Cp/Cpk/Pp/Ppk/Std. Dev.)
const CHEM_ELEMENTS = {
  // c = light logo colour, d = dark logo colour, t = colour of the big symbol (the logo's colour, darkened just enough to read on white)
  cu: {sym: 'Cu', name: 'Copper',     z: 29, c: '#E2925A', d: '#93511F', t: '#B4602A', kind: 'ingot'},
  ni: {sym: 'Ni', name: 'Nickel',     z: 28, c: '#CBD3DB', d: '#7C8894', t: '#6B7885', kind: 'coin'},
  zn: {sym: 'Zn', name: 'Zinc',       z: 30, c: '#B3C7D4', d: '#5F7A8C', t: '#557A93', kind: 'ingot'},
  al: {sym: 'Al', name: 'Aluminium',  z: 13, c: '#E4E8ED', d: '#98A2B0', t: '#7B8797', kind: 'ingot'},
  mn: {sym: 'Mn', name: 'Manganese',  z: 25, c: '#BE86D8', d: '#6B3D86', t: '#8A4FAE', kind: 'crystal'},
  fe: {sym: 'Fe', name: 'Iron',       z: 26, c: '#95A1AE', d: '#434C57', t: '#59636F', kind: 'ingot'},
  pb: {sym: 'Pb', name: 'Lead',       z: 82, c: '#8A919C', d: '#3A404A', t: '#4A515C', kind: 'ingot'},
  sn: {sym: 'Sn', name: 'Tin',        z: 50, c: '#EEF1F5', d: '#A0A9B5', t: '#7E8896', kind: 'coin'},
  si: {sym: 'Si', name: 'Silicon',    z: 14, c: '#7C8FBA', d: '#2E3B5C', t: '#43568A', kind: 'crystal'},
  p:  {sym: 'P',  name: 'Phosphorus', z: 15, c: '#FF8A63', d: '#B02F12', t: '#D03A17', kind: 'crystal'},
  s:  {sym: 'S',  name: 'Sulfur',     z: 16, c: '#F8DD54', d: '#B08F00', t: '#A98A00', kind: 'crystal'},
  c:  {sym: 'C',  name: 'Carbon',     z: 6,  c: '#5A6574', d: '#141A22', t: '#2A323D', kind: 'crystal'},
};
// '#RRGGBB' -> 'rgba(r,g,b,a)' (used for the soft element-coloured card background)
function chemHexA(hex, a){ const n = parseInt(String(hex).slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
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
// Rating -> [KPI status class, pill text] (same green / amber / red pills as the dashboard KPI cards).
function chemStatus(v){ return v == null ? ['neutral', 'REFERENCE'] : v >= 1.67 ? ['good', 'EXCELLENT'] : v >= 1.33 ? ['good', 'CAPABLE'] : v >= 1 ? ['amber', 'MARGINAL'] : ['bad', 'NOT CAPABLE']; }
function chemTone(v){ return v == null ? '' : v >= 1.33 ? 'target-good' : v >= 1 ? 'target-amber' : 'target-bad'; }
// Main elements of the grade (Cu + its alloying elements), largest first. Built like the dashboard KPI cards (.kpi-card: coloured status bar on the left,
// icon chip + label + status pill on top, big value, tinted tile row underneath). Left column = within σ (Cp / Cpk), right column = overall σ (Pp / Ppk).
function renderChemMain(d){
  const box = document.getElementById('chemMainBox'); if(!box) return;
  const mains = (d.overview || []).filter(r => r.main);
  if(!mains.length){ box.innerHTML = ''; return; }
  const sd = v => v == null || !isFinite(v) ? '—' : chemNum(v, v >= 1 ? 3 : v >= 0.1 ? 4 : 5);
  const big = (k, sub, v) => { const c = chemIdxClass(v); return `<div class="chem-el-big"><span class="chem-el-bk">${k}</span><b class="chem-el-bv ${c ? 'is-' + c.replace('chem-', '') : ''}" data-chem-value="${k.toLowerCase()}">${chemIdx(v)}</b><small>${sub}</small></div>`; };
  const tile = (k, v, cls) => `<div class="kpi-target-item ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
  const card = (r, i) => {
    const e = CHEM_ELEMENTS[r.param] || {sym: String(r.label).replace('%', ''), name: r.label, z: '', c: '#9DB5D9', d: '#5B6F8F', t: '#3F5675'};
    const [st, stTxt] = chemStatus(r.cpk);
    const trendType = r.cpk_change_type || 'info';
    const trendClass = trendType === 'up' ? 'good' : trendType === 'down' ? 'bad' : trendType === 'equal' ? 'equal' : 'info';
    const pulseClass = trendType === 'up' ? 'kpi-up' : trendType === 'down' ? 'kpi-down' : 'kpi-pulse';
    const pctTxt = v => `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`, dTxt = v => `${v >= 0 ? '+' : ''}${chemIdx(v)}`;
    const hasChange = r.prev_cpk != null && r.cpk_change != null;
    const trend = !hasChange
      ? `<div class="kpi-trendline chem-el-trendline"><span class="prev">Prev: ${r.prev_cpk == null ? 'N/A' : `<b class="kpi-prev-val">${chemIdx(r.prev_cpk)}</b>`}</span><span class="trend info">${d.period_comparison ? '▬ Not enough data' : '▬ Select a period or Heat Qty'}</span></div>`
      : `<div class="kpi-trendline chem-el-trendline"><span class="prev">Prev: <b class="kpi-prev-val">${chemIdx(r.prev_cpk)}</b></span><span class="trend ${trendClass}">${trendType === 'up' ? '▲' : trendType === 'down' ? '▼' : '▬'} ${trendType === 'equal' ? 'No change' : (r.cpk_change_pct != null ? `<b class="kpi-change-val">${pctTxt(r.cpk_change_pct)}</b> (<span class="kpi-delta-val">${dTxt(r.cpk_change)}</span>)` : `<span class="kpi-delta-val">${dTxt(r.cpk_change)}</span>`)}</span></div>`;
    const vars = `--el-c:${e.c};--el-d:${e.d};--el-t:${e.t};--el-glow:${chemHexA(e.c, .5)};--el-tint1:${chemHexA(e.c, .28)};--el-tint2:${chemHexA(e.c, .10)};--el-edge:${chemHexA(e.d, .45)};--kpi-stagger:${Math.min(i, 7) * 65}ms`;
    return `<div class="kpi-card ${pulseClass} chem-el-kpi status-${st}${r.param === d.param ? ' chem-cur' : ''}" data-param="${r.param}" role="button" tabindex="0" style="${vars}" aria-label="${escQcr(e.name)} — Cpk ${chemIdx(r.cpk)}, ${stTxt.toLowerCase()}. Click to chart">
      <div class="kpi-top">
        <div class="label chem-el-label"><span class="kpi-icon chem-el-chip">${escQcr(e.sym)}</span><span class="chem-el-nm">${escQcr(e.name)}${e.z ? `<small>Atomic no. ${e.z}</small>` : ''}</span></div>
        <span class="kpi-status ${st}">${stTxt}</span>
      </div>
      <div class="chem-el-body">
        <div class="chem-el-metrics">${big('Cpk', 'within σ', r.cpk)}${big('Ppk', 'overall σ', r.ppk)}</div>
        <div class="chem-el-art">${chemElemArt(r.param)}</div>
      </div>
      ${trend}
      <div class="kpi-bottom chem-el-bottom"><div class="kpi-meta chem-el-meta"><div class="kpi-targets chem-el-tiles">
        ${tile('Cp', chemIdx(r.cp), chemTone(r.cp))}${tile('Pp', chemIdx(r.pp), chemTone(r.pp))}
        ${tile('Std. Dev.', sd(r.sigma_within))}${tile('Std. Dev.', sd(r.sigma_overall))}
      </div></div><div class="chem-el-spark">${sparklineSvg(chemCardPrevCpk.get(r.param), r.cpk, st === 'good' ? 'good' : st === 'bad' ? 'bad' : st === 'amber' ? 'amber' : 'neutral')}</div></div>
    </div>`;
  };
  box.innerHTML = `<div class="chem-el-grid-wrap">${mains.map(card).join('')}</div><div class="chem-foot">Left column: <b>Cp / Cpk</b> use the within (moving-range) σ; right column: <b>Pp / Ppk</b> use the overall σ; both against the <b>Standard</b> limits. Std. Dev. under each column is the σ that column uses. Green ≥ 1.33 · amber 1.00–1.33 · red &lt; 1.00. Trend compares Cpk with the immediately previous Week / Month / Quarter / Financial Year, or — when only Heat Qty (last N) is set — with the N heats before them (▲ better, ▼ worse). Click a card to chart that element.</div>`;

  // Same KPI interaction model: 5° pointer tilt, directional change classes, count-up/spring animation for headline + trend metrics.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isFirstPaint = !chemFirstPaintDone;
  const nextCpk = new Map(), nextTrend = new Map();
  mains.forEach((r, i) => {
    const cardEl = box.querySelector(`.chem-el-kpi[data-param="${r.param}"]`);
    if(!cardEl) return;
    if(typeof _kpiTiltEnabled !== 'undefined' && _kpiTiltEnabled && typeof attachKpiTilt === 'function') attachKpiTilt(cardEl);
    const selectParam = () => { chemSel.param = r.param; chemSaveSel(); chemSyncFields(); chemRefresh(); };
    cardEl.addEventListener('click', e => { if(!e.target.closest('a,button,input,select')) selectParam(); });
    cardEl.addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && !e.target.closest('input,button,select')){ e.preventDefault(); selectParam(); } });
    const oldCpk = chemCardPrevCpk.get(r.param), oldTrend = chemCardPrevTrend.get(r.param);
    const targets = cardEl.querySelectorAll('.chem-el-bv');
    const cpkEl = targets[0], ppkEl = targets[1];
    const duration = 680, token = (cardEl._chemAnimToken || 0) + 1;
    cardEl._chemAnimToken = token;
    const animateChemNumber = (el, from, to, formatter) => {
      // Null capability is a real "not computable" state, not zero. Keep the
      // dashboard's em-dash instead of coercing null -> 0 during animation.
      if(!el || to == null || !Number.isFinite(Number(to)) || reduceMotion || (from != null && Number(from) === Number(to))) return;
      const numericTo = Number(to);
      const start = performance.now();
      const safeFrom = Number.isFinite(Number(from)) ? Number(from) : 0;
      const step = now => {
        if(cardEl._chemAnimToken !== token) return;
        const p = Math.min(1, (now - start) / duration);
        el.textContent = formatter(safeFrom + (numericTo - safeFrom) * easeSpringOut(p));
        if(p < 1) requestAnimationFrame(step); else el.textContent = formatter(numericTo);
      };
      requestAnimationFrame(step);
    };
    if(isFirstPaint){
      animateChemNumber(cpkEl, 0, r.cpk, chemIdx);
      animateChemNumber(ppkEl, 0, r.ppk, chemIdx);
    }else{
      animateChemNumber(cpkEl, oldCpk, r.cpk, chemIdx);
      animateChemNumber(ppkEl, oldTrend && Number.isFinite(oldTrend.ppk) ? oldTrend.ppk : r.ppk, r.ppk, chemIdx);
    }
    const prevEl = cardEl.querySelector('.kpi-prev-val');
    const changeEl = cardEl.querySelector('.kpi-change-val'), deltaEl = cardEl.querySelector('.kpi-delta-val');
    if(!reduceMotion && r.prev_cpk != null && Number.isFinite(Number(r.prev_cpk))){
      const fromPrev = oldTrend && Number.isFinite(oldTrend.prev) ? oldTrend.prev : 0;
      animateChemNumber(prevEl, fromPrev, Number(r.prev_cpk), chemIdx);
    }
    if(!reduceMotion && changeEl && r.cpk_change_pct != null && Number.isFinite(Number(r.cpk_change_pct))){
      const fromPct = oldTrend && Number.isFinite(oldTrend.pct) ? oldTrend.pct : 0;
      animateChemNumber(changeEl, fromPct, Number(r.cpk_change_pct), v => `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
    }
    if(!reduceMotion && deltaEl && r.cpk_change != null && Number.isFinite(Number(r.cpk_change))){
      const fromChange = oldTrend && Number.isFinite(oldTrend.change) ? oldTrend.change : 0;
      animateChemNumber(deltaEl, fromChange, Number(r.cpk_change), v => `${v >= 0 ? '+' : ''}${chemIdx(v)}`);
    }
    nextCpk.set(r.param, Number.isFinite(Number(r.cpk)) ? Number(r.cpk) : null);
    nextTrend.set(r.param, {prev:Number.isFinite(Number(r.prev_cpk)) ? Number(r.prev_cpk) : null, change:Number.isFinite(Number(r.cpk_change)) ? Number(r.cpk_change) : null, pct:Number.isFinite(Number(r.cpk_change_pct)) ? Number(r.cpk_change_pct) : null, ppk:Number.isFinite(Number(r.ppk)) ? Number(r.ppk) : null});
  });
  chemCardPrevCpk = nextCpk;
  chemCardPrevTrend = nextTrend;
  chemFirstPaintDone = true;
}

function chemCmpCard(title, a, tone, hint, noLimits, emptyMsg){
  const has = !noLimits && a && a.heats > 0;
  return `<div class="chem-cmp ${tone}"><div class="chem-cmp-t">${escQcr(title)}</div><div class="chem-cmp-v">${has && a.reject_pct != null ? a.reject_pct.toFixed(2) + '%' : '—'}</div><div class="chem-cmp-s">reject (by MT)</div><div class="chem-cmp-v2">${has && a.defect_pct != null ? a.defect_pct + '%' : '—'} <span>coils with a defect</span></div><div class="chem-cmp-f">${has ? `${a.heats} heats · ${a.coils} coils` : noLimits ? 'no limits defined for this group' : escQcr(emptyMsg || 'no heats with disposition data')}${has && a.heats < 10 ? '<br><b>small sample — read with care</b>' : ''}</div><div class="chem-cmp-h">${escQcr(hint)}</div></div>`;
}
function renderChemCompare(d){
  const c = d.summary.compare, noLim = d.summary.has_limits === false;
  const oosN = Number(d.oos_total || 0), oosDisp = c.out_of_spec ? Number(c.out_of_spec.heats || 0) : 0;
  const oosEmpty = oosN === 0 ? 'No heat breached a limit in this selection ✔ — nothing to compare' : `${oosN} heat${oosN === 1 ? '' : 's'} breached a limit, but none of them has inspection data yet`;
  const missing = d.summary.heats - d.summary.heats_with_disposition;
  document.getElementById('chemCompareBox').innerHTML = `<div class="chem-cmp-why"><b>Why this is here:</b> it answers “do heats whose chemistry was out of limits end up with more rejects / defects on the coils rolled from them?” Heats are linked to the inspection (disposition) data through <b>heat_no</b>. If out-of-spec heats show a clearly higher reject % than in-spec heats, chemistry is a likely cause. This box is for reading only — nothing here is clickable; open the table below for individual heats.</div><div class="chem-cmp-grid">${chemCmpCard('In spec (all parameters)', c.in_spec, 'ok', 'Heats whose chemistry met every limit', noLim, 'no in-spec heat has inspection data yet')}${chemCmpCard('Out of spec', c.out_of_spec, 'bad', 'Heats with at least one limit breach', noLim, oosEmpty)}</div><div class="chem-foot">Only heats that also appear in the disposition data (matched on heat_no) are counted. ${missing} of ${d.summary.heats} heats in this view have no disposition record yet (not inspected/rolled). Correlation is not proof of cause.</div>`;
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
  box.innerHTML = `<div class="chem-oos-bar"><input type="search" id="chemOosSearch" placeholder="Search heat or parameter…" autocomplete="off"><button type="button" class="chem-btn" id="chemOosCsv">⬇ Export CSV</button><span class="chem-muted">${d.oos_total} heats${d.oos_total > d.oos_heats.length ? ` (showing first ${d.oos_heats.length})` : ''} · click a row for the heat's coils and defects</span></div><div class="table-scroll"><table class="chem-table"><thead><tr><th>Heat</th><th>Analyst</th><th>Chemistry problem</th><th>Coils</th><th>Reject %</th><th>Defects seen on its coils</th></tr></thead><tbody id="chemOosBody"></tbody></table></div>`;
  draw('');
  document.getElementById('chemOosSearch').addEventListener('input', e => draw(e.target.value));
  document.getElementById('chemOosCsv').addEventListener('click', () => chemExportOos(d));
}
// Header "Export" dialog -> Chemistry downloads (Cpk table / heat data / out-of-spec heats of the CURRENT Chemistry selection).
// These are the same three downloads that sit inside the tab; the dialog only gives them one more way in.
function chemRunExport(kind){
  const d = chemData, none = t => { showToast('info', 'Nothing to export', t); return false; };
  if(!d) return none('The Chemistry data is not loaded yet.');
  if(kind === 'cpk'){ if(!(d.overview || []).length) return none('No capability figures for this selection.'); chemExportCpk(d); }
  else if(kind === 'heats'){ if(!(d.series || []).length) return none('No heats with this parameter in the selection.'); chemExportHeats(d); }
  else if(kind === 'oos'){ if(!(d.oos_heats || []).length) return none('No out-of-spec heats in this selection.'); chemExportOos(d); }
  else return false;
  showToast('success', 'Chemistry CSV downloaded', 'Built from the current Chemistry selection.');
  return true;
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

// ---------------------------------------------------------------- heat drill-down (same look as the main dashboard's "Underlying Records" drill-down)
// Uses the main drill-down's own markup and classes (drill-modal / drill-dialog / drill-head / drill-breadcrumb / drill-body / drill-table),
// so header, spacing, table style and buttons come from the same CSS as every other drill-down in the app.
let chemDrillLast = null;
function chemHeatModal(){
  let m = document.getElementById('chemDrillModal');
  if(!m){
    m = document.createElement('div'); m.id = 'chemDrillModal'; m.className = 'drill-modal'; m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '<div class="drill-dialog" id="chemDrillDialog" role="dialog" aria-modal="true" aria-labelledby="chemDrillTitle">' +
      '<div class="drill-head"><div><h3 id="chemDrillTitle"><svg class="ic" aria-hidden="true"><use href="#ic-table"/></svg><span class="drill-title-text">Heat</span></h3><div class="drill-sub" id="chemDrillSub">Chemistry SPC</div></div>' +
      '<div class="drill-head-actions"><a id="chemDrillExport" class="drill-export" href="#"><svg class="ic" aria-hidden="true"><use href="#ic-download"/></svg>Export Selected Records</a>' +
      '<button id="chemDrillClose" type="button"><svg class="ic" aria-hidden="true"><use href="#ic-x"/></svg>Close</button></div></div>' +
      '<nav class="drill-breadcrumb" id="chemDrillCrumb" aria-label="Drill-down path"></nav>' +
      '<div class="drill-body"><div class="drill-meta"><span class="drill-count" id="chemDrillCount">0 records</span><span id="chemDrillScope"></span></div><div id="chemDrillContent"></div></div></div>';
    document.body.appendChild(m);
    const close = () => {
      if(chemDrillController){ chemDrillController.abort(); chemDrillController = null; }
      chemDrillSeq++;
      m.classList.remove('chem-drill-open', 'open', 'show', 'active');
      m.setAttribute('aria-hidden', 'true');
    };
    m.addEventListener('click', e => { if(e.target === m) close(); });
    m.querySelector('#chemDrillClose').addEventListener('click', close);
    m.querySelector('#chemDrillExport').addEventListener('click', e => { e.preventDefault(); chemExportDrill(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && m.classList.contains('chem-drill-open')){ e.stopPropagation(); close(); } }, true);
  }
  return m;
}
function chemExportDrill(){
  const d = chemDrillLast; if(!d || !d.found) return;
  const lines = [['Heat', 'Section', 'Item', 'Value / MT', 'LSL', 'USL', 'Status / Decision', 'Insp. date', 'Work center', 'Grade', 'Main defect', 'Intensity'].map(chemCsvCell).join(',')];
  d.params.forEach(p => lines.push([d.heat_no, 'Chemistry', p.label, p.value, p.lsl == null ? '' : p.lsl, p.usl == null ? '' : p.usl, p.side ? (p.side === 'below' ? 'BELOW LSL' : 'ABOVE USL') : (p.lsl != null || p.usl != null) ? 'OK' : '', '', '', '', '', ''].map(chemCsvCell).join(',')));
  (d.coils || []).forEach(r => lines.push([d.heat_no, 'Coil', r.batch_no, Number(r.output_weight || 0), '', '', r.quality_decision || '', r.insp_lot_date || '', r.work_center || '', r.grade || '', r.main_defect || '', r.defect_intensity || ''].map(chemCsvCell).join(',')));
  chemDownloadCsv('heat_' + String(d.heat_no).replace(/[^A-Za-z0-9]+/g, '_') + '.csv', lines);
}
async function openChemHeat(heat){
  const seq = ++chemDrillSeq;
  if(chemDrillController) chemDrillController.abort();
  const controller = new AbortController();
  chemDrillController = controller;
  const signal = controller.signal;
  const m = chemHeatModal(), body = m.querySelector('#chemDrillContent'), h = String(heat).toUpperCase();
  chemDrillLast = null;
  m.querySelector('.drill-title-text').textContent = 'Heat ' + h;
  m.querySelector('#chemDrillSub').textContent = 'Chemistry SPC · heat number ' + h;
  m.querySelector('#chemDrillCrumb').innerHTML = '<span>Chemistry SPC</span> <span aria-hidden="true">›</span> <b>Heat ' + escQcr(h) + '</b>';
  m.querySelector('#chemDrillCount').textContent = 'Loading…'; m.querySelector('#chemDrillScope').textContent = '';
  body.innerHTML = '<div class="chem-muted">Loading…</div>';
  m.classList.add('chem-drill-open', 'open', 'show', 'active'); m.setAttribute('aria-hidden', 'false');
  try {
    const d = await chemFetch('/api/chem/heat?heat_no=' + encodeURIComponent(heat), signal);
    if(seq !== chemDrillSeq || signal.aborted) return;
    chemDrillLast = d;
    m.querySelector('.drill-title-text').textContent = 'Heat ' + d.heat_no;
    m.querySelector('#chemDrillCrumb').innerHTML = '<span>Chemistry SPC</span> <span aria-hidden="true">›</span> <b>Heat ' + escQcr(d.heat_no) + '</b>';
    const s = d.summary, c = d.chem;
    m.querySelector('#chemDrillSub').textContent = d.found ? `${d.spec || 'No spec assigned'} · cast ${c.cast_date || 'date not available'} · analyst ${c.analyst || '—'} · alloy ${c.alloy || '—'} ${c.denomination || ''}`.trim() : 'No chemistry imported for this heat';
    m.querySelector('#chemDrillCount').textContent = s ? `${s.coils} coil${s.coils === 1 ? '' : 's'}` : '0 records';
    m.querySelector('#chemDrillScope').textContent = s ? `${s.qty_mt} MT · reject ${s.reject_mt} MT (${s.reject_pct}%) · ${s.defect_coils} coils with a defect (${s.defect_pct}%)` : '';
    let html = '';
    if(!d.found) html += `<div class="chem-note-strip">No chemistry was imported for this heat.</div>`;
    else html += `<div class="table-scroll"><table class="drill-table"><thead><tr><th>Parameter</th><th>Value</th><th>LSL</th><th>USL</th><th>Status</th></tr></thead><tbody>${d.params.map(p => `<tr><td><b>${escQcr(p.label)}</b></td><td>${chemNum(p.value)}</td><td>${p.lsl == null ? '—' : chemNum(p.lsl)}</td><td>${p.usl == null ? '—' : chemNum(p.usl)}</td><td class="${p.side ? 'chem-bad' : (p.lsl != null || p.usl != null) ? 'chem-good' : ''}">${p.side ? (p.side === 'below' ? 'BELOW LSL' : 'ABOVE USL') : (p.lsl != null || p.usl != null) ? 'OK' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    if(s) html += `<h4 class="chem-h4">Disposition of this heat's coils</h4><div class="table-scroll"><table class="drill-table"><thead><tr><th>Batch no</th><th>Insp. date</th><th>Work center</th><th>Grade</th><th>MT</th><th>Main defect</th><th>Intensity</th><th>Decision</th></tr></thead><tbody>${d.coils.map(r => `<tr><td>${escQcr(r.batch_no)}</td><td>${escQcr(r.insp_lot_date)}</td><td>${escQcr(r.work_center)}</td><td>${escQcr(r.grade)}</td><td>${Number(r.output_weight || 0).toFixed(3)}</td><td>${escQcr(r.main_defect || '—')}</td><td>${escQcr(r.defect_intensity || '—')}</td><td class="${String(r.quality_decision).toUpperCase() === 'REJECT' ? 'chem-bad' : ''}">${escQcr(r.quality_decision)}</td></tr>`).join('')}</tbody></table></div>`;
    else html += `<div class="chem-muted" style="margin-top:12px">No disposition records exist for this heat yet.</div>`;
    body.innerHTML = html;
  } catch(e){ if(e && e.name === 'AbortError') return; if(seq !== chemDrillSeq) return; body.innerHTML = `<div class="chem-note-strip">⚠️ ${escQcr(e.message)}</div>`; m.querySelector('#chemDrillCount').textContent = ''; }
  finally { if(seq === chemDrillSeq && chemDrillController === controller) chemDrillController = null; }
}

// ---------------------------------------------------------------- delegated clicks (charts, tables)
document.addEventListener('click', e => {
  const t = e.target;
  if(!t || !t.closest || !t.closest('#tab-chem')) return;
  const pt = t.closest('[data-heat]');
  if(pt){ openChemHeat(pt.getAttribute('data-heat')); return; }
  const row = t.closest('[data-param]');
  if(row){ chemSel.param = row.getAttribute('data-param'); chemSaveSel(); chemSyncFields(); chemRefresh(); }
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
  if(!reg()){ document.addEventListener('DOMContentLoaded', reg); window.addEventListener('load', reg); }
})();

// Show the Chemistry filter bar (and hide the disposition filters) exactly while the Chemistry SPC tab is open.
// The tab switcher lives in another src/js piece, so follow the panel's own visibility instead of hooking into it.
(function chemWatchTab(){
  const start = () => {
    const tab = document.getElementById('tab-chem'); if(!tab) return;
    chemSyncMode();
    new MutationObserver(chemSyncMode).observe(tab, {attributes: true, attributeFilter: ['class', 'style', 'hidden']});
    const tabs = document.getElementById('tabs'); if(tabs) tabs.addEventListener('click', () => setTimeout(chemSyncMode, 0));
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
