/* 21-drill-header-filters.js — Excel-style column filters in the header of every drill-down table (main drill-down incl. Heat history, Chemistry heat drill-down). Bundled into /app.js in filename order; see README ("Frontend source layout").
   Click the funnel in a header -> list of the column's values with check boxes + search (like Excel's AutoFilter). Filters on several columns combine (AND) and each list only shows
   values that still exist under the other columns' filters. The main drill-down is paginated (250 rows per page by the server): the first time a filter menu is opened the
   remaining pages are loaded, so a filter always works on ALL records of the drill-down, not just the page on screen. */
const QDHF = (function(){
  const FUNNEL = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2 3h12l-4.6 5.4V13l-2.8-1.6V8.4L2 3z" fill="currentColor"/></svg>';
  const MAX_LIST = 400, PAGE = 500;
  let pop = null, anchor = null;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const blankLabel = '(Blanks)';
  const entryLabel = e => e.v === '' ? blankLabel : e.v;

  function thHtml(labelHtml, col, labelText){
    return `<span class="qdhf-th"><span class="qdhf-label">${labelHtml}</span><button type="button" class="qdhf-btn" data-qdhf-col="${col}" title="Filter: ${esc(labelText)}" aria-haspopup="dialog" aria-expanded="false" aria-label="Filter ${esc(labelText)}">${FUNNEL}</button></span>`;
  }

  // ------------------------------------------------------------------ popover (shared by both table kinds)
  function closePop(){
    if(pop){ pop.remove(); pop = null; }
    if(anchor){ anchor.setAttribute('aria-expanded', 'false'); anchor = null; }
  }
  function place(){
    if(!pop || !anchor) return;
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.right - pw), Math.max(8, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if(top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function buildMenu(btn, title){
    closePop();
    pop = document.createElement('div');
    pop.className = 'qdhf-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Filter ' + title);
    pop.innerHTML = `<div class="qdhf-title">${FUNNEL}<span>Filter — ${esc(title)}</span></div><div class="qdhf-body"><div class="qdhf-loading">Loading all records…</div></div>`;
    document.body.appendChild(pop);
    anchor = btn; btn.setAttribute('aria-expanded', 'true');
    place();
    return pop;
  }
  function sortEntries(entries){
    const num = entries.every(e => e.v === '' || (isFinite(Number(String(e.v).replace(/,/g, ''))) && String(e.v).trim() !== ''));
    entries.sort((a, b) => {
      if(a.v === '' || b.v === '') return a.v === b.v ? 0 : a.v === '' ? 1 : -1;
      if(num) return Number(String(a.v).replace(/,/g, '')) - Number(String(b.v).replace(/,/g, ''));
      return String(a.v).localeCompare(String(b.v), undefined, {numeric: true, sensitivity: 'base'});
    });
    return entries;
  }
  // entries: [{v, n}] ; selected: Set of values or null (= everything) ; onApply(Set|null)
  function showEntries(menu, entries, selected, onApply){
    if(!pop || pop !== menu) return;
    sortEntries(entries);
    const chk = new Set(entries.filter(e => !selected || selected.has(e.v)).map(e => e.v));
    let q = '';
    const body = menu.querySelector('.qdhf-body');
    body.innerHTML = `<input type="search" class="qdhf-search" placeholder="Search…" autocomplete="off" aria-label="Search values">` +
      `<label class="qdhf-row qdhf-selall"><input type="checkbox" class="qdhf-all"><span class="qdhf-all-t">(Select All)</span><em class="qdhf-sel-count"></em></label>` +
      `<div class="qdhf-list" role="listbox"></div><div class="qdhf-more" hidden></div>` +
      `<div class="qdhf-actions"><button type="button" class="qdhf-clear">Clear filter</button><span class="qdhf-spacer"></span><button type="button" class="qdhf-cancel">Cancel</button><button type="button" class="qdhf-ok">OK</button></div>`;
    const list = body.querySelector('.qdhf-list'), all = body.querySelector('.qdhf-all'), ok = body.querySelector('.qdhf-ok'),
      more = body.querySelector('.qdhf-more'), cnt = body.querySelector('.qdhf-sel-count'), allT = body.querySelector('.qdhf-all-t');
    const visible = () => { const s = q.trim().toLowerCase(); return s ? entries.filter(e => entryLabel(e).toLowerCase().includes(s)) : entries; };
    const idx = new Map(entries.map((e, i) => [e, i]));
    function render(){
      const vis = visible(), shown = vis.slice(0, MAX_LIST);
      list.innerHTML = shown.map(e => `<label class="qdhf-row"><input type="checkbox" data-i="${idx.get(e)}"${chk.has(e.v) ? ' checked' : ''}><span>${esc(entryLabel(e))}</span><em>${e.n}</em></label>`).join('') || '<div class="qdhf-none">No values match.</div>';
      more.hidden = vis.length <= MAX_LIST; if(!more.hidden) more.textContent = `Showing first ${MAX_LIST} of ${vis.length.toLocaleString()} values — type in the search box to narrow the list.`;
      const nChecked = vis.filter(e => chk.has(e.v)).length;
      all.checked = vis.length > 0 && nChecked === vis.length; all.indeterminate = nChecked > 0 && nChecked < vis.length;
      allT.textContent = q.trim() ? '(Select All Search Results)' : '(Select All)';
      cnt.textContent = `${chk.size.toLocaleString()} / ${entries.length.toLocaleString()}`;
      ok.disabled = chk.size === 0;
    }
    body.querySelector('.qdhf-search').addEventListener('input', e => { q = e.target.value; render(); });
    list.addEventListener('change', e => { const cb = e.target.closest('input[data-i]'); if(!cb) return; const en = entries[Number(cb.dataset.i)]; cb.checked ? chk.add(en.v) : chk.delete(en.v); render(); });
    all.addEventListener('change', () => { const on = all.checked; visible().forEach(e => on ? chk.add(e.v) : chk.delete(e.v)); render(); });
    body.querySelector('.qdhf-cancel').addEventListener('click', closePop);
    body.querySelector('.qdhf-clear').addEventListener('click', () => { closePop(); onApply(null); });
    ok.addEventListener('click', () => { const everything = chk.size === entries.length; closePop(); onApply(everything ? null : new Set(chk)); });
    render(); place();
    const s = body.querySelector('.qdhf-search'); if(s) s.focus({preventScroll: true});
  }

  // ------------------------------------------------------------------ static tables (rows already in the DOM, e.g. Chemistry heat drill-down)
  function staticRows(table){ const tb = table.tBodies[0]; const n = table.__qdhf.n; return tb ? [...tb.rows].filter(r => r.cells.length === n && !r.classList.contains('grand-total-row')) : []; }
  function applyStatic(table){
    const st = table.__qdhf, tb = table.tBodies[0]; if(!st || !tb) return;
    st.obs.disconnect();
    staticRows(table).forEach(r => { const ok = [...st.filters].every(([c, set]) => set.has(r.cells[c].textContent.trim())); r.classList.toggle('qdhf-hide', !ok); });
    table.querySelectorAll('.qdhf-btn').forEach(b => { const on = st.filters.has(Number(b.dataset.qdhfCol)); b.classList.toggle('on', on); b.closest('th').classList.toggle('qdhf-on', on); });
    st.obs.observe(tb, {childList: true});
  }
  function decorateStatic(table){
    if(!table || !table.tHead || table.__qdhf) return;
    const hr = table.tHead.rows[table.tHead.rows.length - 1], ths = [...hr.cells];
    ths.forEach((th, i) => { const t = th.textContent.trim(); th.innerHTML = thHtml(th.innerHTML, i, t); });
    table.classList.add('qdhf-table');
    table.__qdhf = {filters: new Map(), n: ths.length, labels: ths.map(t => t.textContent.trim()), obs: new MutationObserver(() => applyStatic(table))};
    if(table.tBodies[0]) table.__qdhf.obs.observe(table.tBodies[0], {childList: true});
  }
  function openStatic(btn){
    const table = btn.closest('table'), st = table && table.__qdhf; if(!st) return;
    const col = Number(btn.dataset.qdhfCol), title = st.labels[col] || 'Column';
    const menu = buildMenu(btn, title);
    const counts = new Map();
    staticRows(table).filter(r => [...st.filters].every(([c, set]) => c === col || set.has(r.cells[c].textContent.trim()))).forEach(r => { const v = r.cells[col].textContent.trim(); counts.set(v, (counts.get(v) || 0) + 1); });
    showEntries(menu, [...counts].map(([v, n]) => ({v, n})), st.filters.get(col) || null, set => { set ? st.filters.set(col, set) : st.filters.delete(col); applyStatic(table); });
  }

  // ------------------------------------------------------------------ main drill-down (paginated by the server -> filters need every page)
  const DRILL_HEADS = ['Date', 'Heat No', 'Batch No', 'Work Center', 'Grade', 'Main Defect', 'Defect Intensity', 'Decision', 'Weight (MT)'];
  const fmtW = v => Number(v || 0).toLocaleString(undefined, {minimumFractionDigits: 3, maximumFractionDigits: 3});
  const fmtDate = v => { const s = String(v || ''); if(/^\d{4}-\d{2}-\d{2}/.test(s)){ const [y, m, d] = s.slice(0, 10).split('-'); return `${d}-${m}-${y}`; } return s; };
  const cellsOf = r => [fmtDate(r.insp_lot_date), r.heat_no || '', String(r.batch_no || r.coil_lot || ''), r.work_center || '', r.grade || '', r.main_defect || '', r.defect_intensity || '—', r.quality_decision || '', fmtW(r.output_weight)];
  let cur = null;   // state of the drill-down currently on screen

  function rowHtml(r){
    const heat = esc(r.heat_no);
    return `<tr><td>${esc(fmtDate(r.insp_lot_date))}</td><td><button class="heat-detail-btn" type="button" data-heat="${heat}">${heat || '—'}</button></td><td>${esc(r.batch_no || r.coil_lot)}</td><td>${esc(r.work_center)}</td><td>${esc(r.grade)}</td><td>${esc(r.main_defect)}</td><td>${esc(r.defect_intensity || '—')}</td><td>${esc(r.quality_decision)}</td><td>${fmtW(r.output_weight)}</td></tr>`;
  }
  function tableHtml(rows, foot){
    const head = DRILL_HEADS.map((h, i) => `<th>${thHtml(esc(h), i, h)}</th>`).join('');
    return `<div class="table-scroll"><table class="drill-table qdhf-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody><tfoot><tr class="grand-total-row"><td colspan="2">Grand Total — ${Number(foot.coils || 0).toLocaleString()} coils</td><td></td><td></td><td></td><td></td><td></td><td>Records: ${Number(foot.records || 0).toLocaleString()}</td><td>${fmtW(foot.weight)}</td></tr></tfoot></table></div>`;
  }
  function pagerHtml(data){
    if(!(Number(data.total_pages || 1) > 1)) return '';
    const p = Number(data.page || 1), tp = Number(data.total_pages || 1);
    return `<div class="drill-pagination"><button type="button" data-drill-page="${Math.max(1, p - 1)}" ${p <= 1 ? 'disabled' : ''}>‹ Previous</button><span>Page ${p} of ${tp}</span><button type="button" data-drill-page="${Math.min(tp, p + 1)}" ${p >= tp ? 'disabled' : ''}>Next ›</button></div>`;
  }
  function barEl(){
    let b = document.getElementById('qdhfBar');
    if(!b){ const body = document.querySelector('#drillModal .drill-body'), c = document.getElementById('drillContent'); if(!body || !c) return null; b = document.createElement('div'); b.id = 'qdhfBar'; b.className = 'qdhf-bar'; b.hidden = true; body.insertBefore(b, c); }
    return b;
  }
  function passes(cells, filters, skip){ for(const [c, set] of filters){ if(c !== skip && !set.has(cells[c])) return false; } return true; }
  function activeFilters(st){ return st.filters.size > 0; }
  function paint(st){
    if(cur !== st) return;
    const content = document.getElementById('drillContent'), bar = barEl(), cntEl = document.getElementById('drillCount');
    if(!content) return;
    if(!activeFilters(st)){
      content.innerHTML = tableHtml(st.data.rows, {coils: st.data.count, records: st.data.row_count, weight: st.data.total_weight}) + pagerHtml(st.data);
      if(bar) bar.hidden = true;
      if(cntEl && st.countText) cntEl.textContent = st.countText;
    } else {
      const rows = (st.all || st.data.rows).filter(r => passes(st.cellCache.get(r) || cellsOf(r), st.filters, -1));
      const w = rows.reduce((s, r) => s + Number(r.output_weight || 0), 0);
      content.innerHTML = tableHtml(rows, {coils: rows.length, records: rows.length, weight: w}) + (rows.length ? '' : '<div class="drill-empty">No records match the filter.</div>');
      if(cntEl) cntEl.textContent = `${rows.length.toLocaleString()} of ${Number(st.data.row_count || 0).toLocaleString()} records`;
      if(bar){
        const chips = [...st.filters].map(([c, set]) => `<span class="qdhf-chip">${esc(DRILL_HEADS[c])}: ${set.size === 1 ? esc([...set][0] === '' ? blankLabel : [...set][0]) : set.size + ' selected'}</span>`).join('');
        bar.innerHTML = `<span class="qdhf-bar-t">${FUNNEL} Filtered</span>${chips}<button type="button" class="qdhf-clear-all">Clear all filters</button>`; bar.hidden = false;
      }
    }
    content.querySelectorAll('.qdhf-btn').forEach(b => { const on = st.filters.has(Number(b.dataset.qdhfCol)); b.classList.toggle('on', on); b.closest('th').classList.toggle('qdhf-on', on); });
  }
  function loadAll(st){
    if(st.all) return Promise.resolve(st.all);
    if(st.loading) return st.loading;
    const tp = Math.max(1, Math.ceil(Number(st.data.row_count || st.data.rows.length) / PAGE));
    if(Number(st.data.total_pages || 1) <= 1){ st.all = st.data.rows.slice(); return Promise.resolve(st.all); }
    const get = p => fetch('/api/drilldown?' + drilldownFiltersQuery(Object.assign({metric: st.metric, page: p, page_size: PAGE}, st.extra)), {cache: 'no-store'}).then(r => r.json()).then(d => { if(d.error) throw new Error(d.error); return d.rows || []; });
    st.loading = (async () => { const out = []; for(let p = 1; p <= tp; p++) out.push(...await get(p)); st.all = out; return out; })();
    st.loading.catch(() => { st.loading = null; });
    return st.loading;
  }
  async function openDrill(btn){
    const st = cur; if(!st) return;
    const col = Number(btn.dataset.qdhfCol), menu = buildMenu(btn, DRILL_HEADS[col]);
    let rows;
    try { rows = await loadAll(st); } catch(e){ if(pop === menu) menu.querySelector('.qdhf-body').innerHTML = `<div class="qdhf-loading">Could not load all records: ${esc(e.message || e)}</div>`; return; }
    if(cur !== st || pop !== menu) return;
    const counts = new Map(), own = st.filters.get(col);
    rows.forEach(r => { const cells = st.cellCache.get(r) || (st.cellCache.set(r, cellsOf(r)), st.cellCache.get(r)); if(!passes(cells, st.filters, col)) return; const v = cells[col]; counts.set(v, (counts.get(v) || 0) + 1); });
    showEntries(menu, [...counts].map(([v, n]) => ({v, n})), own || null, set => { set ? st.filters.set(col, set) : st.filters.delete(col); paint(st); });
  }
  // called by renderDrillPage() when a page of records arrives
  function renderDrill(content, data, env){
    const st = cur = {metric: env.metric, extra: env.extra || {}, data, all: null, loading: null, filters: new Map(), cellCache: new WeakMap(), countText: env.cntEl ? env.cntEl.textContent : ''};
    st.data.rows.forEach(r => st.cellCache.set(r, cellsOf(r)));
    paint(st);
  }
  function resetDrill(){ cur = null; closePop(); const b = document.getElementById('qdhfBar'); if(b) b.hidden = true; }

  function csvCell(v){ const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportFiltered(){
    const st = cur; if(!st || !activeFilters(st)) return false;
    const rows = (st.all || st.data.rows).filter(r => passes(st.cellCache.get(r) || cellsOf(r), st.filters, -1));
    const lines = [DRILL_HEADS.map(csvCell).join(',')].concat(rows.map(r => cellsOf(r).map(csvCell).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'drilldown_filtered_records.csv'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return true;
  }

  // ------------------------------------------------------------------ global wiring (one set of listeners, works for every drill-down)
  document.addEventListener('click', e => {
    const t = e.target; if(!t || !t.closest) return;
    const btn = t.closest('.qdhf-btn');
    if(btn){
      e.preventDefault(); e.stopPropagation();
      if(anchor === btn){ closePop(); return; }
      if(btn.closest('#drillContent')) openDrill(btn); else openStatic(btn);
      return;
    }
    if(t.closest('.qdhf-clear-all')){ if(cur){ cur.filters.clear(); paint(cur); } return; }
    if(t.closest('#drillExportBtn') && cur && activeFilters(cur)){ e.preventDefault(); exportFiltered(); }
  }, true);
  document.addEventListener('mousedown', e => { if(pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.qdhf-btn'))) closePop(); }, true);
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && pop){ e.preventDefault(); e.stopImmediatePropagation(); closePop(); } }, true);
  window.addEventListener('resize', () => place());
  document.addEventListener('scroll', e => { if(pop && !pop.contains(e.target)) closePop(); }, true);

  return {decorateStatic, renderDrill, resetDrill, closePop};
})();
