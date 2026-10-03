/* 05-formatters-export.js — Number formatters and report exports. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// Used ONLY for KPI cards — 3 decimal places after the point, per request.
function fmtValue(v, fmt){
  if(fmt === "int") return Math.round(v).toLocaleString();
  if(fmt === "pct") return (v*100).toFixed(3) + "%";
  if(fmt === "num2") return v.toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3});
  if(fmt === "num3") return v.toFixed(3);
  return v;
}
// Used for table cells (Decision table, Defect table, trend tables, etc.)
function fmtNum2(v){ return v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtPct(v){ return (v*100).toFixed(2) + "%"; }
// Donut-only display precision: Qty and % values show 3 decimals.
// Other charts intentionally retain their pre-V64.6 display precision.
function fmtDonutQty3(v){ return Number(v||0).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3}) + " MT"; }
function fmtDonutPct3(v){ return (Number(v||0)*100).toFixed(3) + "%"; }

// ---- Styled Excel downloads of "what is on screen" (drill-downs, Chemistry tables). The browser sends the table as a plain spec to
// POST /api/export/table; reports._table_xlsx builds the workbook (logo, header band, icons, status / decision colours, filters).
async function qdDownloadXlsx(spec, filename){
  const name = String(filename || spec.filename || 'export').replace(/\.xlsx$/i, '');
  const body = Object.assign({}, spec, {filename: name});
  const total = (spec.sections || []).reduce((n, x) => n + ((x.rows || []).length), 0);
  const toast = typeof showToast === 'function' ? showToast : () => {};
  try {
    const res = await fetch('/api/export/table', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if(!res.ok){ let m = 'Export failed (HTTP ' + res.status + ').'; try { const j = await res.json(); if(j && j.error) m = j.error; } catch(e){} throw new Error(m); }
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.xlsx'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast('success', 'Excel downloaded', `${name}.xlsx · ${total.toLocaleString()} row${total === 1 ? '' : 's'}`);
    return true;
  } catch(e){ toast('error', 'Export failed', String((e && e.message) || e)); return false; }
}
function qdNowDmy(){ const t = new Date(), z = n => String(n).padStart(2, '0'); return `${z(t.getDate())}-${z(t.getMonth() + 1)}-${t.getFullYear()} ${z(t.getHours())}:${z(t.getMinutes())}`; }
