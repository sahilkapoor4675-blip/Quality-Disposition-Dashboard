/* 08-tables.js — Sortable tables and table renderers. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---- Click-to-sort table headers (desktop power-user feature) ----
// Sort state is remembered per table (column + direction) so it survives a
// filter-triggered data refresh. Repeated clicks on the same header cycle
// ascending → descending → natural/server order.
// A "grand total" row (class="grand-total-row") is always pinned to the
// bottom, whatever the sort.
const SORTABLE_TABLE_IDS = ["decisionTable","defectTable","intensityTable","monthlyTable","wcTable","gradeTable","registerTable","weeklyTable","quarterlyTable","yearlyTable"];
const _tableSortState = new Map(); // tableId -> {col, dir}; absent = natural/server order
const _tableNormalOrder = new Map(); // tableId -> {rows: HTMLElement[], totals: HTMLElement[]}
function _parseSortCell(text){
  const t = String(text == null ? '' : text).trim()
    .replace(/[,%]/g, '')
    .replace(/^\+\s*/, '')
    .replace(/\s*(pp|pts|mt|coils)\s*$/i, '')
    .trim();
  if(!t) return null;
  if(!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function rememberTableNormalOrder(tableId){
  const tbody=document.querySelector(`#${tableId} tbody`); if(!tbody) return;
  const rows=[...tbody.querySelectorAll('tr')];
  _tableNormalOrder.set(tableId,{
    rows:rows.filter(r=>!r.classList.contains('grand-total-row')),
    totals:rows.filter(r=>r.classList.contains('grand-total-row'))
  });
}
function restoreTableNormalOrder(tableId){
  const tbody=document.querySelector(`#${tableId} tbody`); if(!tbody) return;
  const saved=_tableNormalOrder.get(tableId);
  if(!saved) return;
  saved.rows.concat(saved.totals).forEach(r=>tbody.appendChild(r));
}
function applyTableSort(tableId){
  const tbody=document.querySelector(`#${tableId} tbody`); if(!tbody) return;
  const state=_tableSortState.get(tableId);
  if(!state){ restoreTableNormalOrder(tableId); return; }
  const rows=[...tbody.querySelectorAll('tr')];
  const totalRows=rows.filter(r=>r.classList.contains('grand-total-row'));
  const dataRows=rows.filter(r=>!r.classList.contains('grand-total-row'));
  dataRows.sort((a,b)=>{
    const av=a.children[state.col]?.textContent||'', bv=b.children[state.col]?.textContent||'';
    const an=_parseSortCell(av), bn=_parseSortCell(bv);
    const cmp=(an!==null && bn!==null) ? (an-bn) : av.trim().localeCompare(bv.trim(),undefined,{numeric:true});
    return cmp*state.dir;
  });
  dataRows.concat(totalRows).forEach(r=>tbody.appendChild(r));
}
function initSortableTables(){
  SORTABLE_TABLE_IDS.forEach(tableId=>{
    const table=document.getElementById(tableId); if(!table) return;
    const ths=[...table.querySelectorAll('thead th')];
    ths.forEach((th,col)=>{
      th.classList.add('sortable-th');
      th.setAttribute('tabindex','0'); th.setAttribute('role','button'); th.setAttribute('aria-sort','none'); th.setAttribute('title','Click: ascending • 2nd click: descending • 3rd click: reset to normal order'); th.setAttribute('aria-label',th.textContent.trim()+' — click: ascending, again: descending, again: reset to normal order');
      const doSort=()=>{
        const cur=_tableSortState.get(tableId);
        // Three-state cycle for the same column: ascending → descending → natural order.
        // Clicking a different column starts a fresh ascending sort.
        if(cur && cur.col===col){
          if(cur.dir===1){
            _tableSortState.set(tableId,{col,dir:-1});
          }else{
            _tableSortState.delete(tableId);
          }
        }else{
          _tableSortState.set(tableId,{col,dir:1});
        }
        ths.forEach(t=>{t.classList.remove('sort-asc','sort-desc');t.setAttribute('aria-sort','none');});
        const next=_tableSortState.get(tableId);
        if(next && next.col===col){
          th.classList.add(next.dir===1?'sort-asc':'sort-desc');
          th.setAttribute('aria-sort',next.dir===1?'ascending':'descending');
        }
        applyTableSort(tableId);
        if(window.SFX) SFX.play('select');
      };
      th.addEventListener('click',doSort);
      th.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); doSort(); } });
    });
  });
}

function renderDecisionTable(rows, total){
  const tbody = document.querySelector("#decisionTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escQcr(r.decision)}</td><td>${r.coils.toLocaleString()}</td>
      <td>${fmtPct(r.pct_coils)}</td><td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_qty)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${total.coils.toLocaleString()}</td>
      <td>${fmtPct(total.pct_coils)}</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_qty)}</td>`;
    tbody.appendChild(tr);
  }
  rememberTableNormalOrder("decisionTable");
  applyTableSort("decisionTable");
}

function renderDefectTable(rows, total){
  const tbody = document.querySelector("#defectTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escQcr(r.defect)}</td><td>${fmtNum2(r.qty)}</td>
      <td>${fmtPct(r.pct)}</td><td>${fmtPct(r.cum_pct)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const topQty=rows.reduce((s,r)=>s+Number(r.qty||0),0);
    const topPct=total.qty?topQty/Number(total.qty):0;
    const tr=document.createElement("tr"); tr.className="grand-total-row";
    tr.innerHTML=`<td>Top 5 Total</td><td>${fmtNum2(topQty)}</td><td>${fmtPct(topPct)}</td><td>${fmtPct(topPct)}</td>`; tbody.appendChild(tr);
    const gt=document.createElement("tr"); gt.className="grand-total-row";
    gt.innerHTML=`<td>Grand Total</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(1)}</td><td>${fmtPct(1)}</td>`; tbody.appendChild(gt);
  }
  rememberTableNormalOrder("defectTable");
  applyTableSort("defectTable");
}

function renderIntensityTable(rows, total){
  const tbody = document.querySelector("#intensityTable tbody");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escQcr(r.intensity)}</td><td>${r.coils.toLocaleString()}</td>
      <td>${fmtPct(r.pct_coils)}</td><td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_qty)}</td>`;
    tbody.appendChild(tr);
  });
  if(total){
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td>Total</td><td>${total.coils.toLocaleString()}</td>
      <td>${fmtPct(total.pct_coils)}</td><td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_qty)}</td>`;
    tbody.appendChild(tr);
  }
  rememberTableNormalOrder("intensityTable");
  applyTableSort("intensityTable");
}

function renderMetricsTable(tableId, rows, total, ranked=false){
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  rows.forEach((r,idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `${ranked ? `<td><strong>${idx+1}</strong></td>` : ""}<td>${escQcr(r.name)}</td><td>${Number(r.coils||0).toLocaleString()}</td>
      <td>${fmtNum2(Number(r.output_qty||0))}</td><td>${Number(r.defect_coils||0).toLocaleString()}</td>
      <td>${fmtPct(Number(r.defect_pct||0))}</td><td>${fmtNum2(Number(r.reject_qty||0))}</td>
      <td>${fmtPct(Number(r.reject_pct_qty||0))}</td><td>${fmtPct(Number(r.first_pass_yield_pct||0))}</td>`;
    tbody.appendChild(tr);
  });
  /* Grand Total is recalculated from the actual displayed groups. Percentages
     are recomputed from aggregate counts/quantities, never averaged. */
  const agg = rows.reduce((a,r)=>{
    a.coils += Number(r.coils||0); a.output_qty += Number(r.output_qty||0);
    a.defect_coils += Number(r.defect_coils||0); a.reject_qty += Number(r.reject_qty||0);
    a.prime_qty += Number(r.prime_qty||0); return a;
  },{coils:0,output_qty:0,defect_coils:0,reject_qty:0,prime_qty:0});
  const gt = total || agg;
  const tr = document.createElement("tr");
  tr.className = "grand-total-row";
  tr.innerHTML = `${ranked ? "<td></td>" : ""}<td>Grand Total</td><td>${Number(gt.coils||0).toLocaleString()}</td>
    <td>${fmtNum2(Number(gt.output_qty||0))}</td><td>${Number(gt.defect_coils||0).toLocaleString()}</td>
    <td>${fmtPct(Number(gt.coils)?Number(gt.defect_coils||0)/Number(gt.coils):0)}</td><td>${fmtNum2(Number(gt.reject_qty||0))}</td>
    <td>${fmtPct(Number(gt.output_qty)?Number(gt.reject_qty||0)/Number(gt.output_qty):0)}</td>
    <td>${fmtPct(Number(gt.output_qty)?Number(gt.prime_qty||0)/Number(gt.output_qty):0)}</td>`;
  tbody.appendChild(tr);
  // Capture the freshly rendered server/natural order before applying any
  // remembered sort. This is required for the third click (reset) to restore
  // the table exactly to its current unsorted order after every data refresh.
  rememberTableNormalOrder(tableId);
  applyTableSort(tableId);
}


