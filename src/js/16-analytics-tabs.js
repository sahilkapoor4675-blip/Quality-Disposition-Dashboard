/* 16-analytics-tabs.js — Work Center, Defect, Monthly and Period tabs. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------- Tab: Work Center & Grade ----------
async function loadWcGrade(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/work_center_grade?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }
  makeHBarChart(document.getElementById("wcChart"), data.by_work_center, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Work Center", drillKind:"work_center"});
  wireChartDrilldown("wcChart","work_center");
  renderMetricsTable("wcTable", [...data.by_work_center].sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)), data.total_work_center, true);
  makeHBarChart(document.getElementById("gradeChart"), data.by_grade, "reject_pct_qty", "name",
    {fmt: v => (v*100).toFixed(2)+"%", xLabel: "Reject % Qty", yLabel: "Grade", drillKind:"grade"});
  wireChartDrilldown("gradeChart","grade");
  renderMetricsTable("gradeTable", [...data.by_grade].sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)), data.total_grade, true); markChartsReady();
}

// ---------- Tab: Defect Analysis ----------
async function loadDefectAnalysis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/defect_analysis?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }
  makeComboChart(document.getElementById("paretoChart"), data.pareto, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Main Defect", colorful: true, barAxisLabel: "Qty (MT)", lineAxisLabel: "Cumulative %", barLegend: "Qty (MT)", lineLegend: "Cumulative %"});
  wireChartDrilldown("paretoChart","defect");
  const tbody = document.querySelector("#registerTable tbody");
  tbody.innerHTML = "";
  data.register.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.rank}</td><td>${escQcr(r.defect)}</td><td>${r.records.toLocaleString()}</td>
      <td>${fmtNum2(r.qty)}</td><td>${fmtPct(r.pct_records)}</td>`;
    tbody.appendChild(tr);
  });
  if(data.register_total){
    const total = data.register_total;
    const tr = document.createElement("tr");
    tr.className = "grand-total-row";
    tr.innerHTML = `<td></td><td>Total</td><td>${total.records.toLocaleString()}</td>
      <td>${fmtNum2(total.qty)}</td><td>${fmtPct(total.pct_records)}</td>`;
    tbody.appendChild(tr);
  }
  rememberTableNormalOrder("registerTable");
  applyTableSort("registerTable");
  markChartsReady();
}

// ---------- Tab: Monthly Trend ----------
let _monthlyTrendRows = [];
function renderMonthlyLineChart(){
  const series = [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ];
  makeLineChart(document.getElementById("monthlyLineChart"), _monthlyTrendRows, "name", series,
    {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Month"});
}
async function loadMonthlyTrend(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/monthly_trend?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }
  _monthlyTrendRows = data.rows||[];
  renderMonthlyLineChart();
  makeGroupedBarChart(document.getElementById("monthlyBarChart"), data.rows, "name", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"output_qty", label:"Output Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(0)},
  ], {yLabel: "Coils / Qty (MT)", xLabel: "Month", axisFmt: v => v.toFixed(0), drillKind:"month"});
  wireChartDrilldown("monthlyBarChart","month");
  renderMetricsTable("monthlyTable", data.rows, data.total); markChartsReady();
}

// ---------- Tab: Period Trend (Weekly / Quarterly / Yearly) ----------
async function loadPeriodTrend(signal){
  const params = new URLSearchParams(currentFilters).toString();
  const res = await fetch("/api/period_trend?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }

  makeLineChart(document.getElementById("weeklyChart"), data.weekly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Week"});
  renderMetricsTable("weeklyTable", data.weekly, data.weekly_total);

  makeLineChart(document.getElementById("quarterlyChart"), data.quarterly, "name", [
    {key:"defect_pct", label:"Defect %", color:"#DC2626", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Quarter"});
  renderMetricsTable("quarterlyTable", data.quarterly, data.quarterly_total);

  makeLineChart(document.getElementById("yearlyChart"), data.yearly, "name", [
    {key:"first_pass_yield_pct", label:"First Pass Yield % (Prime%)", color:"#16A34A", fmt: v => (v*100).toFixed(1)+"%"},
    {key:"reject_pct_qty", label:"Reject % Qty", color:"#D97706", fmt: v => (v*100).toFixed(1)+"%"},
  ], {axisFmt: v => (v*100).toFixed(0)+"%", yLabel: "%", xLabel: "Financial Year"});
  renderMetricsTable("yearlyTable", data.yearly, data.yearly_total); markChartsReady();
}

