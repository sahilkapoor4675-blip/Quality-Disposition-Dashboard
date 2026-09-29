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

