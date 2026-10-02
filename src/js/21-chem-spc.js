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
let chemSel = { spec: '__all__', param: '__all__', last_n: 0, month: '', week: '', quarter: '', fy: '', ins_icon: true, ins_cl: true, ins_aim: true };
// Like the dashboard filters, the Chemistry filters start on "All" on every visit (only a shared link / saved preset sets them); nothing is restored from the browser.
chemSel.ins_icon = chemSel.ins_cl = chemSel.ins_aim = true;   // the Insert box was removed: element pictures, centre line and Aim lines are always drawn

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
  Object.keys(CHEM_URL_KEYS).forEach(k => { const v = snap[k]; if(v != null && v !== '' && v !== 0 && v !== '__all__') params.set(CHEM_URL_KEYS[k], String(v)); });
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
  chemSel.spec = o.spec || '__all__';
  chemSel.param = o.param || '__all__';
  chemSel.last_n = Number(o.last_n) || 0;
  CHEM_PERIOD_KEYS.forEach(k => { chemSel[k] = o[k] || ''; });
  chemLastPeriod = '';
  if(chemMeta) chemSanitiseSel();   // before the first load the loader sanitises it once the grades / periods are known
}
// Saved Views (Save Preset / Manage Presets in the Selection bar of this tab).
function chemApplyView(v){
  if(!chemMeta || !v) return;
  const groups = ['__all__'].concat(chemMeta.specs.filter(s => s.heats > 0).map(s => s.description), chemMeta.unassigned ? ['__none__'] : []);
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
  if(lists[key]) return (chemPeriods()[lists[key]] || []).map(v => ({value: v, label: key === 'week' ? chemWeekLabel(v) : v}));
  if(key === 'spec') return ['__all__'].concat(chemMeta.specs.filter(x => x.heats > 0).map(x => x.description), chemMeta.unassigned ? ['__none__'] : []).map(g => ({value: g, label: chemGroupLabel(g)}));
  if(key === 'param') return [{value: '__all__', label: 'All'}].concat(chemMeta.params.map(p => ({value: p.key, label: p.label})));
  return [];
}

function chemNum(v, d){
  if(v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if(d == null) d = a >= 100 ? 3 : a >= 10 ? 3 : a >= 1 ? 3 : a >= 0.1 ? 4 : 5;
  return Number(v).toLocaleString(undefined, {minimumFractionDigits: d > 3 ? 3 : d, maximumFractionDigits: d});
}
function chemIdx(v){ return v == null || !isFinite(v) ? '—' : v.toFixed(2); }
// Capability bands = the dashboard KPI-card logic: HIGH (target) -> ON TARGET, MID (warning) -> WATCH, below -> ACTION. The numbers live in the
// KPI target table (Admin -> KPI Targets, label below); the defaults are the copper-base practice (Cpk 1.33 capable, 1.00 minimum).
const CHEM_KPI_LABEL = 'Chemistry Capability (Cp/Cpk/Pp/Ppk)';
const CHEM_KPI_DEFAULT = {label: CHEM_KPI_LABEL, target: 1.33, warning: 1.0, critical: 0.67, direction: 'higher'};
async function chemEnsureTargets(){
  try { if(typeof KPI_TARGETS !== 'object' || !KPI_TARGETS) return; } catch (e) { return; }
  if(!KPI_TARGETS[CHEM_KPI_LABEL] && typeof loadKpiTargets === 'function') await loadKpiTargets();
  if(!KPI_TARGETS[CHEM_KPI_LABEL]) KPI_TARGETS[CHEM_KPI_LABEL] = Object.assign({}, CHEM_KPI_DEFAULT);
}
function chemThr(){ try { return (KPI_TARGETS && KPI_TARGETS[CHEM_KPI_LABEL]) || CHEM_KPI_DEFAULT; } catch (e) { return CHEM_KPI_DEFAULT; } }
function chemKpiStatus(v){
  if(v == null || !isFinite(v)) return 'neutral';
  const c = chemThr(); if(c.target == null) return 'neutral';
  const t = Number(c.target), w = Number(c.warning), d = String(c.direction || 'higher').toLowerCase();
  if(d === 'lower') return v <= t ? 'good' : v <= w ? 'amber' : 'bad';
  if(d === 'higher') return v >= t ? 'good' : v >= w ? 'amber' : 'bad';
  return 'neutral';
}
function chemIdxClass(v){ const s = chemKpiStatus(v); return s === 'good' ? 'chem-good' : s === 'amber' ? 'chem-warn' : s === 'bad' ? 'chem-bad' : ''; }
function chemIdxLabel(v){ const s = chemKpiStatus(v); return s === 'good' ? 'On target' : s === 'amber' ? 'Watch' : s === 'bad' ? 'Action' : ''; }
// Month label of a week: "Wk of 06-Apr-26" -> "06-Apr-2026 to 12-Apr-2026" (full Monday-Sunday range, same text as the dashboard's Week filter).
function chemWeekLabel(v){
  const m = /^Wk of (\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(String(v || '')); if(!m) return v;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], mo = names.findIndex(n => n.toLowerCase() === m[2].toLowerCase());
  if(mo < 0) return v;
  const a = new Date(Date.UTC(2000 + Number(m[3]), mo, Number(m[1]))), b = new Date(a.getTime() + 6 * 864e5);
  const f = d => String(d.getUTCDate()).padStart(2, '0') + '-' + names[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  return f(a) + ' to ' + f(b);
}
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
  const p = chemSel.spec === '__all__' ? chemMeta.all_periods : chemSel.spec === '__none__' ? (chemMeta.unassigned && chemMeta.unassigned.periods) : (s && s.periods);
  return Object.assign({months: [], weeks: [], quarters: [], fys: [], undated: 0}, p || {});
}
function chemSanitiseSel(){
  const grp = chemMeta.specs.filter(s => s.heats > 0).map(s => s.description).concat(chemMeta.unassigned ? ['__none__'] : []);
  if(chemSel.spec !== '__all__' && !grp.includes(chemSel.spec)) chemSel.spec = '__all__';
  if(chemSel.param !== '__all__' && !chemMeta.params.some(p => p.key === chemSel.param)) chemSel.param = '__all__';
  { const n = Number(chemSel.last_n); if(!Number.isInteger(n) || n < 0 || n > 5000) chemSel.last_n = 0; }   // any whole number 1-5000 from a shared link is kept (the API accepts up to 5000)
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
  await chemEnsureTargets();
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
  ['chemMainBox','chemNotes','chemIChart','chemMRChart','chemHist','chemOverviewBox','chemOosBox'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
}
function chemGroupLabel(g){
  if(g === '__all__') return 'All';
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
function chemPeriodItems(list, fmt){ return [{value: '', label: 'All'}].concat((list || []).map(x => ({value: x, label: fmt ? fmt(x) : x}))); }
const chemIsAllVal = v => v === '' || v === '__all__';
// An empty Month / Week / Quarter / FY list means the stored heats carry no cast date (they were imported without the file's Date column).
function chemNoDates(){ const p = chemMeta ? chemPeriods() : null; return !!(p && p.undated > 0 && !p.months.length); }
// One dropdown, built with the SAME markup/classes as the dashboard filters (.filter-field > .filter-control > .filter-trigger + .filter-menu),
// so size, font, icons, hover, open menu, dark mode and the "active" highlight all come from the dashboard's own CSS.
function chemFieldHtml(key, icon, label, items, cur, active){
  const shown = (items.find(x => x.value === cur) || items[0] || {label: 'All'}).label;
  const opts = items.map(x => `<div class="filter-option${chemIsAllVal(x.value) ? ' all-option' : ''}${x.value === cur ? ' selected' : ''}" data-value="${escQcr(x.value)}">${escQcr(x.label)}</div>`).join('');
  return `<div class="filter-field${active ? ' filter-active' : ''}" data-chem-key="${key}"><label>${icon} ${label}</label><div class="filter-control"><button type="button" class="filter-trigger" aria-haspopup="listbox"><span>${escQcr(shown)}</span><span class="chevron">${qdIc('chevron-down')}</span></button><div class="filter-menu"><input class="filter-search" type="text" placeholder="Search options…" autocomplete="off"><div class="filter-options">${opts}</div></div></div></div>`;
}
function chemCurVal(key){ return key === 'last_n' ? String(Number(chemSel.last_n) || 0) : String(chemSel[key] == null ? '' : chemSel[key]); }
const CHEM_ACTIVE_KEYS = ['month', 'week', 'quarter', 'fy', 'last_n', 'param', 'spec'];
// Baseline view = first grade + Cu% + no period + all heats (what Reset All restores). Anything else counts as an active filter,
// exactly like a dashboard filter that is not "All".
function chemDefaultSpec(){ return '__all__'; }
function chemIsActive(key){
  if(!CHEM_ACTIVE_KEYS.includes(key)) return false;
  const v = chemCurVal(key);
  if(key === 'last_n') return v !== '0';
  if(key === 'param') return v !== '' && v !== '__all__';
  if(key === 'spec') return v !== '' && v !== '__all__';
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
    f.innerHTML = chemPeriodItems(lists[l], k === 'week' ? chemWeekLabel : null).map(x => `<div class="filter-option${chemIsAllVal(x.value) ? ' all-option' : ''}${x.value === cur ? ' selected' : ''}" data-value="${escQcr(x.value)}">${escQcr(x.label)}</div>`).join('')
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
  // Same as the dashboard's Reset All: every Chemistry filter goes back to All.
  chemSel.spec = '__all__'; chemSel.param = '__all__';
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
  const tip = 'Month / Week / Quarter / Fin. Year come from the Date column of the chemistry file (financial year April–March, same labels as the main dashboard). Charts always run in heat-number order; “Heat Qty” = the N highest heat numbers of the selection (of each grade when Grade = All). Grade = All shows the element cards of every grade; pick a grade for its charts. Cp / Cpk / Pp / Ppk are measured against the Standard limits.';
  const F = (key, icon, label, items, active) => chemFieldHtml(key, icon, label, items, chemCurVal(key), active);
  // same 4-column layout and order as the dashboard filters: Month | Work Center→Parameter | Grade | Quality Decision→Heat Qty  /  Week | Quarter | Fin. Year | Defect Intensity→Heat No.
  chemTopBarEl().innerHTML = `
    <div class="filter-toolbar"><div class="filter-toolbar-title" title="${escQcr(tip)}">${qdIc('filter')}Chemistry Filters <span class="chem-tb-i">ⓘ</span></div><div class="filter-actions"><span id="chemActiveBadge" class="active-filter-badge">0 Active</span><button id="chemCompareBtn" class="reset-all" type="button">${qdIc('compare')}Compare Periods</button><button id="chemResetAll" class="reset-all" type="button">${qdIc('reset')}Reset All</button></div></div>
    ${F('month', '📅', 'Month', chemPeriodItems(per.months), chemIsActive('month'))}
    ${F('param', '🔬', 'Parameter', [{value: '__all__', label: 'All'}].concat(chemMeta.params.map(p => ({value: p.key, label: p.label}))), chemIsActive('param'))}
    ${F('spec', '🧪', 'Grade', ['__all__'].concat(groups).map(g => ({value: g, label: chemGroupLabel(g)})), chemIsActive('spec'))}
    ${F('last_n', '🔢', 'Heat Qty (Last N)', (CHEM_QTY.some(q => q[0] === String(chemSel.last_n)) ? CHEM_QTY : CHEM_QTY.concat([[String(chemSel.last_n), String(chemSel.last_n)]])).map(([v, t]) => ({value: v, label: t})), chemIsActive('last_n'))}
    ${F('week', '🗓️', 'Week', chemPeriodItems(per.weeks, chemWeekLabel), chemIsActive('week'))}
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
  if(p.current.week) labels.push(chemWeekLabel(p.current.week));
  if(p.current.month) labels.push(p.current.month);
  if(p.current.quarter) labels.push(p.current.quarter);
  if(p.current.fy) labels.push(p.current.fy);
  const cur = labels.join(' · ');
  const prev = p.previous;
  const prevLabel = prev ? [prev.week ? chemWeekLabel(prev.week) : '',prev.month,prev.quarter,prev.fy].filter(Boolean).join(' · ') : '';
  el.innerHTML = prevLabel
    ? `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> ${escQcr(prevLabel)}`
    : `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; <i>No comparable previous period is available for this selection</i>`;
}
function chemRenderFilterSummary(d){
  const text = document.getElementById('chemFilterSummaryText');
  const count = document.getElementById('chemFilterRecordCount');
  if(!text || !count) return;
  const spec = chemSel.spec === '__none__' ? 'No spec assigned' : (chemSel.spec === '__all__' ? 'All grades' : (chemSel.spec || 'All grades'));
  const param = d.param === '__all__' ? 'All parameters' : ((chemMeta && chemMeta.params.find(p => p.key === d.param)?.label) || d.param || 'Parameter');
  const parts = [spec, param];
  if(chemSel.month) parts.push(chemSel.month);
  if(chemSel.week) parts.push(chemWeekLabel(chemSel.week));
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
function chemParamLabel(key){ return key === '__all__' ? 'All elements' : ((chemMeta && chemMeta.params.find(p => p.key === key) || {}).label || key); }
// Parameter = All: one chart per main element, each under its own element heading. A single parameter draws exactly one chart as before.
function chemSubCharts(el, d, fn){
  if(!el) return;
  if(d.param !== '__all__'){ el.classList.remove('chem-multi'); fn(el, d); return; }
  const pv = d.param_views || [];
  el._qdRedraw = null; el.classList.add('chem-multi');
  el.innerHTML = pv.length ? pv.map(p => `<div class="chem-pblock"><div class="chem-pblock-t">${escQcr(chemParamLabel(p.param))}</div><div class="chart-scroll chem-pchart"></div></div>`).join('') : '<div class="chem-empty-chart">No main elements with enough data in this selection.</div>';
  el.querySelectorAll('.chem-pchart').forEach((sub, i) => fn(sub, Object.assign({}, d, pv[i])));
}
function renderChemAll(){
  const d = chemData, tab = document.getElementById('tab-chem');
  tab.classList.toggle('chem-all-grades', !!d.all_grades);
  const lbl = d.all_grades ? 'All' : chemParamLabel(d.param);
  ['chemTitleParam', 'chemTitleParamMR', 'chemTitleParamHist'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = lbl; });
  renderChemMain(d);
  renderChemNotes(d);
  if(d.all_grades){   // grades have different limits, so no pooled charts: pick a grade for those (the hidden panels are emptied so no loading skeleton is left behind)
    ['chemIChart', 'chemMRChart', 'chemHist', 'chemOverviewBox', 'chemOosBox'].forEach(id => { const el = document.getElementById(id); if(el){ el.innerHTML = ''; el._qdRedraw = null; } });
    return;
  }
  chemSubCharts(document.getElementById('chemIChart'), d, drawChemI);
  chemSubCharts(document.getElementById('chemMRChart'), d, drawChemMR);
  chemSubCharts(document.getElementById('chemHist'), d, drawChemHist);
  renderChemOverview(d); renderChemOos(d);
}

// ---------------------------------------------------------------- notes (no KPI cards any more)
function renderChemNotes(d){
  const el = document.getElementById('chemNotes'); if(!el) return;
  const c = d.capability || {};
  const per = chemPeriods(), periodOn = !!(chemSel.month || chemSel.week || chemSel.quarter || chemSel.fy);
  const aimAny = d.spec && d.spec.aim && Object.keys(d.spec.aim).length > 0;
  const pl = (chemMeta.params.find(p => p.key === d.param) || {}).label || d.param;
  const multi = d.all_grades || d.param === '__all__';
  const pvWarn = Array.from(new Set((d.param_views || []).flatMap(p => (p.warnings || []).map(w => chemParamLabel(p.param) + ': ' + w))));
  const aimNote = multi || !chemSel.ins_aim ? [] : !aimAny ? ['No Aim limits are stored for this grade, so no Aim line can be drawn. Load the AIM sheet of Standard.xlsx in Admin → Spec Limits (or type the Aim limits there).']
    : (d.aim_lsl == null && d.aim_usl == null) ? [`This grade has no Aim limit for ${pl}, so no Aim line is drawn for it.`] : [];
  const notes = [].concat(d.all_grades ? ['Grade = All: the cards below are per grade (each grade is measured against its own limits). Pick a Grade in the filters, or click a card, to see its control charts, histogram, capability table and out-of-spec heats. Heat Qty applies to each grade separately.'] : [],
    d.summary.heats ? [] : ['No heats match this selection (check Month / Week / Quarter / Fin. Year, or the grade).'],
    chemNoDates() ? [`No cast date is stored for the ${per.undated.toLocaleString()} heat(s) of this grade, so the Month / Week / Quarter / Fin. Year lists, Compare Periods and the period trend are empty. Re-import the chemistry file in Admin → Cast Chemistry: its Date column is read on import and fills these filters (existing heats are updated, nothing is duplicated).`] : [],
    periodOn && per.undated && !chemNoDates() ? [`${per.undated} heat(s) of this grade have no readable date and drop out while a Month / Week / Quarter / Fin. Year filter is set.`] : [],
    aimNote, d.warnings || [], pvWarn, c.note ? [c.note] : []);
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
  if(el.closest && el.closest('.chem-multi') && !el.closest('.analytics-presentation-panel')) h = Math.round(h * 1.3);   // Parameter = All: each element chart is drawn bigger
  return {W, H: h, m, pw: W - m.l - m.r, ph: h - m.t - m.b};
}
function chemDomain(vals, d, extra){
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Std LSL/USL and Aim LSL/USL are ALWAYS drawn: the scale widens to include every limit that exists, however small the data spread is.
  // (Statistical UCL/LCL stay in d.imr for diagnostics only; they are not drawn.)
  const lims = [d.lsl, d.usl];
  if(chemSel.ins_aim) lims.push(d.aim_lsl, d.aim_usl);
  lims.forEach(v => { if(v != null && isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const pad = ((hi - lo) || Math.abs(hi) * 0.02 || 0.02) * 0.06;
  return {lo: lo - pad, hi: hi + pad, off: {lsl: false, usl: false, aim_lsl: false, aim_usl: false}};
}
// Upper-limit-only parameters (impurities such as Pb: "0 - 0.04"): the server ignores a 0 / empty LSL for the capability maths, but the CHARTS still show it.
// Std LSL and Aim LSL are drawn at 0 whenever the matching USL exists, so the mean line (middle of the Aim band) sits between 0 and the Aim USL.
function chemDispLimits(d){
  if(!d) return d;
  const fillLo = (lo, hi) => (lo == null || !isFinite(lo)) && hi != null && isFinite(hi) && hi > 0 ? 0 : lo;
  const o = Object.assign({}, d);
  o.lsl = fillLo(d.lsl, d.usl);
  o.aim_lsl = fillLo(d.aim_lsl, d.aim_usl);
  return o;
}
// Why a value counts as out of spec on the charts: outside the Standard limits, or outside the Aim (operating) band while Aim is shown. '' = in spec.
function chemOutWhy(v, d, serverOos){
  if(v == null || !isFinite(v)) return '';
  const e = 1e-9;
  if(d.lsl != null && v < d.lsl - e) return 'below Std LSL';
  if(d.usl != null && v > d.usl + e) return 'above Std USL';
  if(chemSel.ins_aim){
    if(d.aim_lsl != null && v < d.aim_lsl - e) return 'below Aim LSL';
    if(d.aim_usl != null && v > d.aim_usl + e) return 'above Aim USL';
  }
  return serverOos ? 'outside Std limits' : '';
}
// Centre line = middle of the Aim band (never the data mean / moving-range mean). No Aim band -> the data mean as a fallback.
function chemMeanLine(d, fallback){
  if(d.aim_lsl != null && d.aim_usl != null) return (Number(d.aim_lsl) + Number(d.aim_usl)) / 2;
  if(d.aim_lsl != null) return Number(d.aim_lsl);
  if(d.aim_usl != null) return Number(d.aim_usl);
  return fallback == null ? null : fallback;
}

// ---------------------------------------------------------------- I chart
function drawChemI(el, d){
  if(!el) return;
  d = chemDispLimits(d);
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
    if(chemSel.ins_aim) g += line(d.aim_lsl, '#0D9488', '', 'Aim LSL', 2.2) + line(d.aim_usl, '#0D9488', '', 'Aim USL', 2.2);
    g += line(d.lsl, '#DC2626', '7 4', 'Std LSL', 1.8) + line(d.usl, '#DC2626', '7 4', 'Std USL', 1.8);
    if(chemSel.ins_cl){ g += line(chemMeanLine(d, im && im.cl), '#16A34A', '', 'Mean', 1.8); }
    if(dom.off.lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 6}" font-size="11" font-weight="700" fill="#DC2626">▼ Std LSL ${chemNum(d.lsl)} is far below this scale</text>`;
    if(dom.off.usl) g += `<text x="${m.l + 6}" y="${m.t + 12}" font-size="11" font-weight="700" fill="#DC2626">▲ Std USL ${chemNum(d.usl)} is far above this scale</text>`;
    if(dom.off.aim_lsl) g += `<text x="${m.l + 6}" y="${m.t + ph - 20}" font-size="11" font-weight="700" fill="#0D9488">▼ Aim LSL ${chemNum(d.aim_lsl)} is far below this scale</text>`;
    if(dom.off.aim_usl) g += `<text x="${m.l + 6}" y="${m.t + 26}" font-size="11" font-weight="700" fill="#0D9488">▲ Aim USL ${chemNum(d.aim_usl)} is far above this scale</text>`;
    g += `<polyline fill="none" stroke="#118DFF" stroke-opacity=".55" stroke-width="1.2" points="${s.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    const r = n > 250 ? 2.4 : n > 120 ? 3 : 3.8;
    const markerIdx = chemMarkerIndexes(s, p => !!chemOutWhy(p.value, d, p.oos));
    markerIdx.forEach(i => {
      const p = s[i], why = chemOutWhy(p.value, d, p.oos), cls = why ? '#DC2626' : '#118DFF';
      const tip = `${p.heat_no}${p.cast_date ? ' · ' + p.cast_date : ''} — ${chemNum(p.value)}` + (why ? ` · OUT OF SPEC (${why})` : '') +
        (p.disp ? ` · ${p.disp.coils} coils, reject ${p.disp.reject_pct}%${p.disp.top_defects[0] ? ', top defect ' + p.disp.top_defects[0].defect : ''}` : ' · no disposition data');
      g += `<circle class="chem-pt" data-heat="${escQcr(p.heat_no)}" data-tip="${escQcr(tip)}" cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${why ? r + 1.8 : r}" fill="${cls}" ${why ? 'stroke="#7f1d1d" stroke-width="1.6"' : 'stroke="var(--card)" stroke-width=".6"'}/>`;
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
      const why = chemOutWhy(p.value, d, p.oos);
      const tip = `${p.heat_no}${p.cast_date ? ' · ' + p.cast_date : ''} — ${chemNum(p.value)}` + (why ? ` · OUT OF SPEC (${why})` : '') +
        (p.disp ? ` · ${p.disp.coils} coils, reject ${p.disp.reject_pct}%${p.disp.top_defects[0] ? ', top defect ' + p.disp.top_defects[0].defect : ''}` : ' · no disposition data');
      return tip;
    }, p => p.heat_no);
  };
  redraw(); chartRemember(el, redraw);
}
function chemLegend(){
  return `<div class="legend chem-legend"><span><i class="chem-dot" style="background:#118DFF"></i>Heat (in spec)</span><span><i class="chem-dot" style="background:#DC2626;box-shadow:0 0 0 2px #7f1d1d"></i>Out of spec${chemSel.ins_aim ? ' (outside Aim / Std limits)' : ''}</span>${chemSel.ins_cl ? '<span><i class="chem-ln" style="border-color:#16A34A"></i>Mean (centre line)</span>' : ''}<span><i class="chem-ln chem-dash" style="border-color:#DC2626"></i>Standard LSL / USL</span>${chemSel.ins_aim ? '<span><i class="chem-ln" style="border-color:#0D9488"></i>Aim LSL / USL (operating bounds)</span>' : ''}</div>`;
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
  d = chemDispLimits(d);
  el.dataset.chartField = (chemMeta && chemMeta.params.find(p => p.key === d.param)?.label) || d.param || 'Chemistry value';
  const h = d.histogram;
  if(!d.n || !h || !h.bins.length) return chemEmptyChart(el, 'No data to build a histogram.');
  const redraw = () => {
    const B = chemBox(el, 300); B.m.r = 28; B.pw = B.W - B.m.l - B.m.r;   // the histogram has no limit labels in the right margin, so use that space for the plot
    const {W, H, m, pw, ph} = B, c = d.capability;
    const maxN = Math.max(...h.bins.map(b => b.n), 1) * 1.12;
    // The server range only knows the Standard limits: widen it so the Aim limits are drawn too (unless they are far off the data)
    const dLo = h.bins[0].x0, dHi = h.bins[h.bins.length - 1].x1, ref = (dHi - dLo) || h.width || 0.01;
    let xmin = h.xmin, xmax = h.xmax, aimOffL = false, aimOffR = false;
    const hl = [d.lsl, d.usl].concat(chemSel.ins_aim ? [d.aim_lsl, d.aim_usl] : []).filter(v => v != null && isFinite(v));
    if(hl.length){ const sp = (Math.max(xmax, ...hl) - Math.min(xmin, ...hl)) || ref; xmin = Math.min(xmin, ...hl) - sp * 0.04; xmax = Math.max(xmax, ...hl) + sp * 0.04; }
    const X = v => m.l + ((v - xmin) / (xmax - xmin)) * pw, Y = v => m.t + ph - (v / maxN) * ph;
    const xt = chemTicks(xmin, xmax, Math.max(4, Math.floor(pw / 90))), xf = chemTickFmt(xt.length > 1 ? xt[1] - xt[0] : 1);
    let g = '';
    chemTicks(0, maxN, 4).forEach(v => { g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--chart-muted)">${Math.round(v)}</text>`; });
    h.bins.forEach(b => {
      const out = (d.lsl != null && b.x1 <= d.lsl) || (d.usl != null && b.x0 >= d.usl) || (chemSel.ins_aim && ((d.aim_lsl != null && b.x1 <= d.aim_lsl) || (d.aim_usl != null && b.x0 >= d.aim_usl)));
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
    const mv = chemMeanLine(d, c && c.mean);
    g += vline(d.lsl, '#DC2626', 'Std LSL', 'l', 0) + vline(d.usl, '#DC2626', 'Std USL', 'r', 0);
    if(chemSel.ins_aim && d.aim_lsl != null && d.aim_usl != null && d.aim_lsl >= xmin && d.aim_usl <= xmax)   // light band between the Aim limits
      g += `<rect x="${X(d.aim_lsl).toFixed(1)}" y="${m.t}" width="${(X(d.aim_usl) - X(d.aim_lsl)).toFixed(1)}" height="${ph}" fill="#0D9488" fill-opacity=".07"/>`;
    if(chemSel.ins_aim) g += vline(d.aim_lsl, '#0D9488', 'Aim LSL', 'l', 1, true) + vline(d.aim_usl, '#0D9488', 'Aim USL', 'r', 1, true);
    if(chemSel.ins_cl) g += vline(mv, '#16A34A', 'Mean', mv != null && d.usl != null && d.lsl != null && (mv - d.lsl) > (d.usl - mv) ? 'l' : 'r', 2, true);
    if(false) g += `<text x="${m.l + 6}" y="${m.t + 60}" font-size="11" font-weight="700" fill="#DC2626">◀ Std LSL ${chemNum(d.lsl)} is far to the left of the data</text>`;
    if(false) g += `<text x="${m.l + pw - 6}" y="${m.t + 60}" text-anchor="end" font-size="11" font-weight="700" fill="#DC2626">Std USL ${chemNum(d.usl)} is far to the right of the data ▶</text>`;
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
  document.getElementById('chemOverviewBox').innerHTML = rows.length ? `<div class="chem-oos-bar"><button type="button" class="chem-btn" id="chemCpkCsv">⬇ Cpk table (CSV)</button><button type="button" class="chem-btn" id="chemHeatsCsv">⬇ Heat data — ${escQcr(chemParamLabel(d.param))} (CSV)</button></div><div class="table-scroll"><table class="chem-table"><thead><tr><th>🧪 Parameter</th><th>🔢 Heats</th><th>📍 Mean</th><th>🔻 Std LSL</th><th>🔺 Std USL</th><th>🎯 Aim LSL</th><th>🎯 Aim USL</th><th>🎯 Cp</th><th>📈 Cpk</th><th>📉 Std. Dev. (Cp/Cpk)</th><th>📐 Pp</th><th>📊 Ppk</th><th>📉 Std. Dev. (Pp/Ppk)</th><th>🚩 Out of spec</th></tr></thead><tbody>${mains.length ? sep('★ Main elements') + mains.map(tr).join('') : ''}${others.length ? sep('🧫 Impurities &amp; other parameters') + others.map(tr).join('') : ''}</tbody></table></div><div class="chem-foot">Click a row to chart that parameter. Cp/Cpk use the within σ (moving range ÷ 1.128), Pp/Ppk the overall σ; both against the Standard limits. Colour bands follow the KPI Targets set by the admin: ≥ ${Number(chemThr().target).toFixed(2)} on target (green), ≥ ${Number(chemThr().warning).toFixed(2)} watch (amber), below that action (red). Where the lower limit is 0 (impurity-type limits) only the upper limit is used.</div>` : '<div class="chem-empty-chart">No parameters with enough data.</div>';
  const b1 = document.getElementById('chemCpkCsv'), b2 = document.getElementById('chemHeatsCsv');
  if(b1) b1.addEventListener('click', () => chemExportCpk(d));
  if(b2) b2.addEventListener('click', () => chemExportHeats(d));
}
// ---------------------------------------------------------------- element cards (symbol + picture + Cp/Cpk/Pp/Ppk/Std. Dev.)
const CHEM_ELEMENTS = {
  // c / d = the two ends of that element's header bar in the reference photo sheet (Element_Icons.png); t = accent colour (the dark end)
  cu: {sym: 'Cu', name: 'Copper',     z: 29, c: '#AE5E31', d: '#6D2F10', t: '#8A4318', kind: 'ingot'},
  ni: {sym: 'Ni', name: 'Nickel',     z: 28, c: '#939393', d: '#5E5D5D', t: '#5E5D5D', kind: 'coin'},
  zn: {sym: 'Zn', name: 'Zinc',       z: 30, c: '#435B6B', d: '#2C414F', t: '#2C414F', kind: 'ingot'},
  al: {sym: 'Al', name: 'Aluminium',  z: 13, c: '#5C87A3', d: '#41708F', t: '#41708F', kind: 'ingot'},
  mn: {sym: 'Mn', name: 'Manganese',  z: 25, c: '#704385', d: '#5A336A', t: '#5A336A', kind: 'crystal'},
  fe: {sym: 'Fe', name: 'Iron',       z: 26, c: '#6E4129', d: '#55311C', t: '#55311C', kind: 'ingot'},
  pb: {sym: 'Pb', name: 'Lead',       z: 82, c: '#4B515B', d: '#393D43', t: '#393D43', kind: 'ingot'},
  sn: {sym: 'Sn', name: 'Tin',        z: 50, c: '#9A6A47', d: '#805535', t: '#805535', kind: 'coin'},
  si: {sym: 'Si', name: 'Silicon',    z: 14, c: '#4F6B45', d: '#3C5531', t: '#3C5531', kind: 'crystal'},
  p:  {sym: 'P',  name: 'Phosphorus', z: 15, c: '#CC9620', d: '#B9810B', t: '#9A6B00', kind: 'crystal'},
  s:  {sym: 'S',  name: 'Sulfur',     z: 16, c: '#DDB51C', d: '#C79B00', t: '#A98A00', kind: 'crystal'},
  c:  {sym: 'C',  name: 'Carbon',     z: 6,  c: '#5A6574', d: '#141A22', t: '#2A323D', kind: 'crystal'},
};
// '#RRGGBB' -> 'rgba(r,g,b,a)' (used for the soft element-coloured card background)
function chemHexA(hex, a){ const n = parseInt(String(hex).slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
// Small drawn picture of the element's typical form (ingots / coin / crystal), coloured per element. Inline SVG: no image files, works offline.
function chemElemArt(key){
  const e = CHEM_ELEMENTS[key]; if(!e) return '';
  const photo = typeof CHEM_ELEMENT_PHOTOS !== 'undefined' && CHEM_ELEMENT_PHOTOS[key];
  if(photo) return `<img class="chem-el-photo" src="${photo}" alt="${escQcr(e.name)}" width="144" height="108" loading="lazy" decoding="async" draggable="false">`;
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
function chemStatus(v){ const st = chemKpiStatus(v); return [st, st === 'good' ? 'ON TARGET' : st === 'amber' ? 'WATCH' : st === 'bad' ? 'ACTION' : 'REFERENCE']; }
function chemTone(v){ const st = chemKpiStatus(v); return st === 'good' ? 'target-good' : st === 'amber' ? 'target-amber' : st === 'bad' ? 'target-bad' : ''; }
// Main elements of the grade (Cu + its alloying elements), largest first. Built like the dashboard KPI cards (.kpi-card: coloured status bar on the left,
// icon chip + label + status pill on top, big value, tinted tile row underneath). Left column = within σ (Cp / Cpk), right column = overall σ (Pp / Ppk).
function renderChemMain(d){
  const box = document.getElementById('chemMainBox'); if(!box) return;
  // One group of cards for the selected grade; with Grade = All one group per grade (each measured against its own limits).
  const groups = d.all_grades
    ? (d.grades || []).map(g => ({grade: g.description, title: g.description === '__none__' ? 'No spec assigned' : g.description, n: g.n_heats, rows: (g.overview || []).filter(r => r.main)})).filter(g => g.rows.length)
    : [{grade: '', title: '', n: 0, rows: (d.overview || []).filter(r => r.main)}].filter(g => g.rows.length);
  const flat = []; groups.forEach(g => g.rows.forEach(r => flat.push({g, r})));
  if(!flat.length){ box.innerHTML = d.all_grades ? '<div class="chem-empty-chart">No heats with capability figures match this selection.</div>' : ''; return; }
  const sd = v => v == null || !isFinite(v) ? '—' : chemNum(v, v >= 1 ? 3 : v >= 0.1 ? 4 : 5);
  const pctTxt = v => `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`, dTxt = v => `${v >= 0 ? '+' : ''}${chemIdx(v)}`;
  // One metric column = label + big value + its OWN "Prev" line with the change vs the previous period (Cpk and Ppk each get one).
  const metric = (key, k, sub, v, prevV, chg, pct, type) => {
    const c = chemIdxClass(v), t = type || 'info';
    const tc = t === 'up' ? 'good' : t === 'down' ? 'bad' : t === 'equal' ? 'equal' : 'info';
    const prevHtml = `<span class="prev">🕘 Prev <b class="kpi-prev-val" data-chem-prev="${key}">${prevV == null ? 'N/A' : chemIdx(prevV)}</b></span>`;
    const trendHtml = prevV == null || chg == null ? '' : `<span class="trend ${tc}">${t === 'up' ? '▲' : t === 'down' ? '▼' : '▬'} ${t === 'equal' ? 'No change' : (pct != null ? `<b class="kpi-change-val" data-chem-pct="${key}">${pctTxt(pct)}</b><span class="chem-el-abs">(<span class="kpi-delta-val" data-chem-delta="${key}">${dTxt(chg)}</span>)</span>` : `<span class="kpi-delta-val" data-chem-delta="${key}">${dTxt(chg)}</span>`)}</span>`;
    return `<div class="chem-el-big"><span class="chem-el-bk">${k === 'Cpk' ? '📈' : '📊'} ${k}<small>${sub}</small></span><b class="chem-el-bv ${c ? 'is-' + c.replace('chem-', '') : ''}" data-chem-value="${k.toLowerCase()}">${chemIdx(v)}</b><div class="kpi-trendline chem-el-trendline">${prevHtml}${trendHtml}</div></div>`;
  };
  const tile = (k, v, cls) => `<div class="kpi-target-item ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
  const card = (r, i, g) => {
    const e = CHEM_ELEMENTS[r.param] || {sym: String(r.label).replace('%', ''), name: r.label, z: '', c: '#7A8CA8', d: '#4F6180', t: '#3F5675'};
    const [st, stTxt] = chemStatus(r.cpk);
    const trendType = r.cpk_change_type || 'info';
    const pulseClass = trendType === 'up' ? 'kpi-up' : trendType === 'down' ? 'kpi-down' : 'kpi-pulse';
    const vars = `--el-c:${e.c};--el-d:${e.d};--el-t:${e.t};--el-glow:${chemHexA(e.c, .5)};--el-tint1:${chemHexA(e.c, .28)};--el-tint2:${chemHexA(e.c, .10)};--el-edge:${chemHexA(e.d, .45)};--kpi-stagger:${Math.min(i, 7) * 65}ms`;
    return `<div class="kpi-card ${pulseClass} chem-el-kpi status-${st}${!d.all_grades && r.param === d.param ? ' chem-cur' : ''}" ${d.all_grades ? `data-el="${escQcr(r.param)}"` : `data-param="${r.param}"`} role="button" tabindex="0" style="${vars}" aria-label="${escQcr(e.name)}${g && g.grade ? ' (' + escQcr(g.title) + ')' : ''} — Cpk ${chemIdx(r.cpk)}, ${stTxt.toLowerCase()}. Click to chart">
      <div class="kpi-top">
        <div class="label chem-el-label"><span class="kpi-icon chem-el-chip">${escQcr(e.sym)}</span><span class="chem-el-nm">${escQcr(e.name)}${e.z ? `<small>Atomic no. ${e.z}</small>` : ''}</span></div>
        <div class="chem-el-tr"><span class="chem-el-art">${chemElemArt(r.param)}</span><span class="kpi-status ${st}">${stTxt}</span></div>
      </div>
      <div class="chem-el-metrics">${metric('cpk', 'Cpk', 'within σ', r.cpk, r.prev_cpk, r.cpk_change, r.cpk_change_pct, r.cpk_change_type)}${metric('ppk', 'Ppk', 'overall σ', r.ppk, r.prev_ppk, r.ppk_change, r.ppk_change_pct, r.ppk_change_type)}</div>
      <div class="kpi-bottom chem-el-bottom"><div class="kpi-meta chem-el-meta"><div class="kpi-targets chem-el-tiles">
        ${tile('🎯 Cp', chemIdx(r.cp), chemTone(r.cp))}${tile('📐 Pp', chemIdx(r.pp), chemTone(r.pp))}
        ${tile('📉 Std. Dev.', sd(r.sigma_within))}${tile('📉 Std. Dev.', sd(r.sigma_overall))}
      </div></div></div>
    </div>`;
  };
  // LOW / MID / HIGH are the same on every card, so they are written ONCE above the cards instead of on each card.
  const thr = chemThr(), tf = v => v == null || !isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
  const bandNote = `<div class="chem-band-note"><b>🎯 Capability bands</b> (Cpk / Ppk)<span class="chem-band bad">LOW ${tf(thr.critical)}</span><span class="chem-band amber">MID ${tf(thr.warning)}</span><span class="chem-band good">HIGH ${tf(thr.target)}</span><span class="chem-band-dir">↑ Higher is better</span></div>`;
  let ci = 0;
  box.innerHTML = bandNote + groups.map(g => (d.all_grades ? `<div class="chem-grade-head"><b>🧪 ${escQcr(g.title)}</b><span>${g.n.toLocaleString()} heat${g.n === 1 ? '' : 's'}</span></div>` : '')
    + `<div class="chem-el-grid-wrap" data-n="${g.rows.length}">${g.rows.map(r => card(r, ci++, g)).join('')}</div>`).join('');

  // Same KPI interaction model: 5° pointer tilt, directional change classes, count-up/spring animation for headline + trend metrics.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isFirstPaint = !chemFirstPaintDone;
  const nextCpk = new Map(), nextTrend = new Map();
  const cardEls = box.querySelectorAll('.chem-el-kpi');
  flat.forEach(({g, r}, i) => {
    const cardEl = cardEls[i], pkey = (g.grade || '') + '|' + r.param;
    if(!cardEl) return;
    if(typeof _kpiTiltEnabled !== 'undefined' && _kpiTiltEnabled && typeof attachKpiTilt === 'function') attachKpiTilt(cardEl);
    const selectParam = () => {
      chemSel.param = r.param;
      if(g.grade){ chemSel.spec = g.grade; chemLastPeriod = ''; chemSanitiseSel(); chemSaveSel(); renderChemControls(); chemRefresh(); return; }   // Grade = All: a card opens its grade
      chemSaveSel(); chemSyncFields(); chemRefresh();
    };
    cardEl.addEventListener('click', e => { if(!e.target.closest('a,button,input,select')) selectParam(); });
    cardEl.addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && !e.target.closest('input,button,select')){ e.preventDefault(); selectParam(); } });
    const oldCpk = chemCardPrevCpk.get(pkey), oldTrend = chemCardPrevTrend.get(pkey);
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
    // Prev / change numbers: Cpk and Ppk each have their own line; count from the last value shown (or 0 on first paint).
    const fin = v => v != null && Number.isFinite(Number(v)), ot = oldTrend || {};
    if(!reduceMotion) [
      {key: 'cpk', prev: r.prev_cpk, pct: r.cpk_change_pct, chg: r.cpk_change, o: {prev: ot.prev, pct: ot.pct, chg: ot.change}},
      {key: 'ppk', prev: r.prev_ppk, pct: r.ppk_change_pct, chg: r.ppk_change, o: {prev: ot.pprev, pct: ot.ppct, chg: ot.pchange}},
    ].forEach(L => {
      const pe = cardEl.querySelector(`[data-chem-prev="${L.key}"]`), ce = cardEl.querySelector(`[data-chem-pct="${L.key}"]`), de = cardEl.querySelector(`[data-chem-delta="${L.key}"]`);
      if(pe && fin(L.prev)) animateChemNumber(pe, fin(L.o.prev) ? Number(L.o.prev) : 0, Number(L.prev), chemIdx);
      if(ce && fin(L.pct)) animateChemNumber(ce, fin(L.o.pct) ? Number(L.o.pct) : 0, Number(L.pct), pctTxt);
      if(de && fin(L.chg)) animateChemNumber(de, fin(L.o.chg) ? Number(L.o.chg) : 0, Number(L.chg), dTxt);
    });
    nextCpk.set(pkey, Number.isFinite(Number(r.cpk)) ? Number(r.cpk) : null);
    const nz = v => Number.isFinite(Number(v)) && v != null ? Number(v) : null;
    nextTrend.set(pkey, {prev: nz(r.prev_cpk), change: nz(r.cpk_change), pct: nz(r.cpk_change_pct), ppk: nz(r.ppk), pprev: nz(r.prev_ppk), pchange: nz(r.ppk_change), ppct: nz(r.ppk_change_pct)});
  });
  chemCardPrevCpk = nextCpk;
  chemCardPrevTrend = nextTrend;
  chemFirstPaintDone = true;
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
  box.innerHTML = `<div class="chem-oos-bar"><input type="search" id="chemOosSearch" placeholder="🔍 Search heat or parameter…" autocomplete="off"><button type="button" class="chem-btn" id="chemOosCsv">⬇ Export CSV</button><span class="chem-muted">${d.oos_total} heats${d.oos_total > d.oos_heats.length ? ` (showing first ${d.oos_heats.length})` : ''} · click a row for the heat's coils and defects</span></div><div class="table-scroll"><table class="chem-table"><thead><tr><th>🔥 Heat</th><th>👤 Analyst</th><th>⚠️ Chemistry problem</th><th>🌀 Coils</th><th>❌ Reject %</th><th>🛠️ Defects seen on its coils</th></tr></thead><tbody id="chemOosBody"></tbody></table></div>`;
  draw('');
  document.getElementById('chemOosSearch').addEventListener('input', e => draw(e.target.value));
  document.getElementById('chemOosCsv').addEventListener('click', () => chemExportOos(d));
}
// Header "Export" dialog -> Chemistry downloads (Cpk table / heat data / out-of-spec heats of the CURRENT Chemistry selection).
// These are the same three downloads that sit inside the tab; the dialog only gives them one more way in.
function chemRunExport(kind){
  const d = chemData, none = t => { showToast('info', 'Nothing to export', t); return false; };
  if(!d) return none('The Chemistry data is not loaded yet.');
  if(kind === 'cpk'){ if(!(d.all_grades ? (d.grades || []).length : (d.overview || []).length)) return none('No capability figures for this selection.'); chemExportCpk(d); }
  else if(kind === 'heats'){
    if(d.all_grades) return none('Pick a Grade first: heat data is exported for one grade at a time.');
    if(!chemHeatSeries(d).length) return none('No heats with this parameter in the selection.'); chemExportHeats(d);
  }
  else if(kind === 'oos'){
    if(d.all_grades) return none('Pick a Grade first: out-of-spec heats are exported for one grade at a time.');
    if(!(d.oos_heats || []).length) return none('No out-of-spec heats in this selection.'); chemExportOos(d);
  }
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
  const sets = d && d.all_grades ? (d.grades || []).map(g => ({grade: g.description === '__none__' ? 'No spec assigned' : g.description, rows: g.overview || []}))
    : [{grade: (d && d.spec && d.spec.description) || '', rows: (d && d.overview) || []}];
  if(!sets.some(x => x.rows.length)) return;
  const num = v => v == null || !isFinite(v) ? '' : Number(v);
  const lines = [['Grade / spec', 'Parameter', 'Main element', 'Heats', 'Mean', 'Std LSL', 'Std USL', 'Aim LSL', 'Aim USL', 'Cp', 'Cpk', 'Cpk rating', 'Std. Dev. (within, Cp/Cpk)', 'Pp', 'Ppk', 'Std. Dev. (overall, Pp/Ppk)', 'Out-of-spec heats', 'Indicative (< 30 heats)'].map(chemCsvCell).join(',')];
  sets.forEach(st => st.rows.forEach(r => lines.push([st.grade, r.label, r.main ? 'Yes' : 'No', r.n, num(r.mean), num(r.lsl), num(r.usl), num(r.aim_lsl), num(r.aim_usl), num(r.cp), num(r.cpk),
    r.cpk == null ? '' : chemIdxLabel(r.cpk), num(r.sigma_within), num(r.pp), num(r.ppk), num(r.sigma_overall), r.oos, r.n < 30 ? 'Yes' : 'No'].map(chemCsvCell).join(','))));
  chemDownloadCsv('chemistry_cpk_' + chemFileTag(d) + '.csv', lines);
}
// One row per heat for the charted parameter, in heat-number order, with its disposition summary.
// Heat series of the view: the charted parameter, or (Parameter = All) the first main element's series (all elements are merged on export).
function chemHeatSeries(d){ return d && d.param === '__all__' ? (((d.param_views || [])[0] || {}).series || []) : ((d && d.series) || []); }
function chemExportHeats(d){
  const s = chemHeatSeries(d); if(!s.length) return;
  if(d.param === '__all__'){
    const pv = d.param_views || [], by = pv.map(p => new Map((p.series || []).map(x => [x.heat_no, x])));
    const heats = [], seen = new Set();
    pv.forEach(p => (p.series || []).forEach(x => { if(!seen.has(x.heat_no)){ seen.add(x.heat_no); heats.push(x); } }));
    heats.sort((a, b) => (a.i || 0) - (b.i || 0));
    const lines = [['Heat no', 'Date'].concat(pv.map(p => chemParamLabel(p.param)), ['Any parameter out of spec', 'Analyst', 'Coils', 'Reject %', 'Top defect']).map(chemCsvCell).join(',')];
    heats.forEach(h => lines.push([h.heat_no, h.cast_date || ''].concat(by.map(m => m.has(h.heat_no) ? m.get(h.heat_no).value : ''), [h.heat_oos ? 'Yes' : 'No', h.analyst || '',
      h.disp ? h.disp.coils : '', h.disp ? h.disp.reject_pct : '', h.disp && h.disp.top_defects && h.disp.top_defects[0] ? h.disp.top_defects[0].defect : '']).map(chemCsvCell).join(',')));
    chemDownloadCsv('chemistry_heats_all_elements_' + chemFileTag(d) + '.csv', lines);
    return;
  }
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
    else html += `<div class="table-scroll"><table class="drill-table chem-drill-params"><thead><tr><th>🧪 Parameter</th><th>🔢 Value</th><th>🔻 Std LSL</th><th>🔺 Std USL</th><th>🎯 Aim LSL</th><th>🎯 Aim USL</th><th>🚦 Status</th></tr></thead><tbody>${d.params.map(p => {
      // upper-limit-only elements (impurities): the lower bound is 0, same as on the charts
      const fill = (lo, hi) => lo == null && hi != null && hi > 0 ? 0 : lo;
      const lsl = fill(p.lsl, p.usl), alsl = fill(p.aim_lsl, p.aim_usl), cell = v => v == null ? '—' : chemNum(v);
      const hasLim = p.lsl != null || p.usl != null || p.aim_lsl != null || p.aim_usl != null;
      const status = p.side ? (p.side === 'below' ? '🚩 OUT OF SPEC · BELOW LSL' : '🚩 OUT OF SPEC · ABOVE USL') : p.aim_side ? (p.aim_side === 'below' ? '🚩 OUT OF SPEC · BELOW AIM LSL' : '🚩 OUT OF SPEC · ABOVE AIM USL') : hasLim ? '✅ OK' : '';
      const bad = !!(p.side || p.aim_side);
      return `<tr class="${bad ? 'chem-row-bad' : ''}"><td><b>${escQcr(p.label)}</b></td><td>${chemNum(p.value)}</td><td>${cell(lsl)}</td><td>${cell(p.usl)}</td><td>${cell(alsl)}</td><td>${cell(p.aim_usl)}</td><td class="${bad ? 'chem-bad' : hasLim ? 'chem-good' : ''}">${status}</td></tr>`; }).join('')}</tbody></table></div>`;
    if(s) html += `<h4 class="chem-h4">🏭 Disposition of this heat's coils</h4><div class="table-scroll"><table class="drill-table"><thead><tr><th>📦 Batch no</th><th>📅 Insp. date</th><th>🏭 Work center</th><th>🏷️ Grade</th><th>⚖️ MT</th><th>🛠️ Main defect</th><th>🔥 Intensity</th><th>🧾 Decision</th></tr></thead><tbody>${d.coils.map(r => `<tr><td>${escQcr(r.batch_no)}</td><td>${escQcr(r.insp_lot_date)}</td><td>${escQcr(r.work_center)}</td><td>${escQcr(r.grade)}</td><td>${Number(r.output_weight || 0).toFixed(3)}</td><td>${escQcr(r.main_defect || '—')}</td><td>${escQcr(r.defect_intensity || '—')}</td><td class="${String(r.quality_decision).toUpperCase() === 'REJECT' ? 'chem-bad' : ''}">${escQcr(r.quality_decision)}</td></tr>`).join('')}</tbody></table></div>`;
    else html += `<div class="chem-muted" style="margin-top:12px">No disposition records exist for this heat yet.</div>`;
    body.innerHTML = html;
    body.querySelectorAll('table.drill-table').forEach(QDHF.decorateStatic);   // Excel-style header filters (src/js/21-drill-header-filters.js)
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
