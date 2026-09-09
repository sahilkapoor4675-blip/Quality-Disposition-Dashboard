// SVG CHART HELPERS (no external libraries). All charts use a FIXED
// design width that scales responsively to the container (CSS width:100%)
// — no horizontal scrolling, everything visible at once. Long category
// names use horizontal bar orientation so labels are never cut off.
// =====================================================================
// Note: NO red in bar/fill palettes — red is reserved exclusively for trend
// lines (e.g. Defect % line, Pareto cumulative-% line), never for bars.
const CHART_COLORS = ["#118DFF", "#16A34A", "#D97706", "#7C3AED", "#64748B", "#0EA5E9", "#EC4899", "#6366F1", "#0891B2", "#84CC16"];
const DECISION_COLORS = {
  "PRIME": "#16A34A", "FOR NEXT PROCESS": "#118DFF", "SALVAGE": "#7C3AED",
  "HOLD FOR DECISION": "#D97706", "REJECT": "#0891B2", "RE-WORK": "#64748B", "DIVERT": "#6366F1",
};
const DESIGN_W = 720;

function truncateLabel(s, n){
  if(!s) return "";
  return s.length > n ? s.substring(0, n-1) + "…" : s;
}
function niceMax(v){
  // Adds headroom and guards against a near-zero max (percentages 0-1 etc.)
  if(!isFinite(v) || v <= 0) return 1;
  return v * 1.2;
}
// Y-axis title for VERTICAL charts (rotated, placed at far left)
function yAxisTitle(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}
// X-axis title for VERTICAL charts (centered, placed at bottom)
function xAxisTitleV(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle">${text}</text>`;
}
// X-axis title (value axis) for HORIZONTAL bar charts (centered, at bottom)
function xAxisTitleH(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle">${text}</text>`;
}
// Y-axis title (category axis) for HORIZONTAL bar charts (rotated, far left)
function yAxisTitleH(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="#475569" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}

function makePieChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const sorted = [...items].sort((a,b) => b[valueKey]-a[valueKey]);
  // Wider viewBox gives outside labels enough room; CSS still scales it responsively.
  const w = 1500, h = 820, cx = 750, cy = 380, r = 280, innerR = 145;
  const gapDeg = 0.018;
  const total = sorted.reduce((s,d) => s + d[valueKey], 0);

  // Pass 1: compute each slice's geometry + mid-angle (needed before placing labels)
  let angle = -Math.PI/2;
  const slicesData = sorted.map((d, i) => {
    const val = d[valueKey];
    const frac = total ? val/total : 0;
    const sweep = frac * 2 * Math.PI;
    const a0 = angle + gapDeg/2;
    const a1 = angle + sweep - gapDeg/2;
    const midAngle = (a0 + a1) / 2;
    angle += sweep;
    const color = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    return {d, val, frac, a0, a1, midAngle, color};
  });

  // Pass 2: draw donut segments (outer arc out, inner arc back)
  let slices = "";
  slicesData.forEach(s => {
    const ox1 = cx + r*Math.cos(s.a0), oy1 = cy + r*Math.sin(s.a0);
    const ox2 = cx + r*Math.cos(s.a1), oy2 = cy + r*Math.sin(s.a1);
    const ix1 = cx + innerR*Math.cos(s.a1), iy1 = cy + innerR*Math.sin(s.a1);
    const ix2 = cx + innerR*Math.cos(s.a0), iy2 = cy + innerR*Math.sin(s.a0);
    const largeArc = (s.a1 - s.a0) > Math.PI ? 1 : 0;
    slices += `<path data-drill-category="${s.d[labelKey]}" data-drill-kind="decision" d="M${ox1},${oy1} A${r},${r} 0 ${largeArc} 1 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${s.color}" stroke="#fff" stroke-width="2.5"><title>${s.d[labelKey]}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${(s.frac*100).toFixed(1)}%)</title></path>`;
  });

  // Center label: grand total
  const totalText = opts.valFmt ? opts.valFmt(total) : total.toFixed(2);
  const centerLabel = `
    <text x="${cx}" y="${cy-10}" font-size="21" font-weight="700" text-anchor="middle" fill="#6b7c93">TOTAL</text>
    <text x="${cx}" y="${cy+16}" font-size="29" font-weight="700" text-anchor="middle" fill="#1c2b3a">${totalText}</text>`;

  // Pass 3: place outside labels. To keep both sides visually balanced,
  // slices are assigned to left/right by rank (alternating) so neither
  // side gets overloaded. Each leader line still starts from the slice's
  // TRUE position on the ring.
  const rightSlices = [], leftSlices = [];
  slicesData.forEach((s, i) => (i % 2 === 0 ? rightSlices : leftSlices).push(s));
  rightSlices.sort((a,b) => a.midAngle - b.midAngle);
  leftSlices.sort((a,b) => a.midAngle - b.midAngle);

  const rowSpacing = 58;
  const elbowOffset = 44;
  const labelOffset = 250;

  function layoutSide(list, side){
    const n = list.length;
    if(n === 0) return "";
    const totalH = (n-1) * rowSpacing;
    let startY = cy - totalH/2;
    startY = Math.max(40, Math.min(startY, h - 40 - totalH));
    let out = "";
    list.forEach((s, idx) => {
      const targetY = startY + idx*rowSpacing;
      const edgeX = cx + r*Math.cos(s.midAngle), edgeY = cy + r*Math.sin(s.midAngle);
      const elbowX = cx + side*(r+elbowOffset);
      const labelX = cx + side*(r+labelOffset);
      const anchor = side > 0 ? "start" : "end";
      const valText = opts.valFmt ? opts.valFmt(s.val) : s.val.toFixed(2);
      out += `<polyline points="${edgeX},${edgeY} ${elbowX},${targetY} ${labelX-side*4},${targetY}" fill="none" stroke="#94a3b8" stroke-width="1.2"/>`;
      out += `<circle cx="${edgeX}" cy="${edgeY}" r="3" fill="${s.color}"/>`;
      out += `<text x="${labelX}" y="${targetY-6}" font-size="21" font-weight="700" text-anchor="${anchor}" fill="#1c2b3a">${s.d[labelKey]}<title>${s.d[labelKey]}</title></text>`;
      out += `<text x="${labelX}" y="${targetY+11}" font-size="19" font-weight="700" text-anchor="${anchor}" fill="${s.color}">${valText} (${(s.frac*100).toFixed(1)}%)</text>`;
    });
    return out;
  }

  const sliceLabels = layoutSide(rightSlices, 1) + layoutSide(leftSlices, -1);

  // Bottom legend: name-only (with color swatch), separate from the
  // detailed outside labels above.
  let legend = "";
  sorted.forEach((d, i) => {
    const color = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span>${d[labelKey]}</div>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${slices}${centerLabel}${sliceLabels}</svg>`;
}

/* Vertical bar chart — used for SHORT category names only (Months etc). */
function makeBarChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 380, padL = 65, padR = 20, padT = 30, padB = 95;
  const maxV = niceMax(Math.max(...items.map(d => d[valueKey]), 0));
  const plotW = w - padL - padR;
  const gap = plotW / items.length;
  const barW = Math.min(56, gap * 0.55);
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  items.forEach((d, i) => {
    const val = d[valueKey];
    const barH = (val / maxV) * (h - padT - padB);
    const x = padL + i * gap + (gap - barW) / 2;
    const y = h - padB - barH;
    const barColor = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${x + barW/2}" y="${y - 8}" font-size="14.5" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${x + barW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${x+barW/2} ${h-padB+20})">${truncateLabel(d[labelKey], 12)}</text>`;
  });
  const legend = `<div class="legend-item"><span class="legend-dot" style="background:#118DFF"></span>${opts.legend || opts.yLabel || valueKey}</div>`;
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Horizontal bar chart — used for LONG category names (Grades, Defects,
   Work Centers, Intensity levels) so labels never get cut off. */
function makeHBarChart(container, items, valueKey, labelKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  // Always order horizontal bars from highest to lowest value. This prevents a
  // low-value bar from appearing above a higher-value bar and makes the chart
  // read like a proper ranked analysis. Keep a stable secondary sort by name.
  const rows = [...items].sort((a,b) => {
    const dv = (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0);
    return dv || String(a[labelKey] || '').localeCompare(String(b[labelKey] || ''));
  });
  const w = DESIGN_W;
  const rowH = 40, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = rows.length * rowH + padT + padB;
  const maxV = niceMax(Math.max(...rows.map(d => Number(d[valueKey]) || 0), 0));
  const plotW = w - padL - padR;
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="#6b7c93">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  rows.forEach((d, i) => {
    const val = Number(d[valueKey]) || 0;
    const barW = (val / maxV) * plotW;
    const y = padT + i * rowH + rowH*0.2;
    const barH = rowH * 0.6;
    const barColor = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.fmt ? opts.fmt(val) : val}</title></rect>`;
    bars += `<text x="${padL + barW + 8}" y="${y + barH/2 + 4}" font-size="14.5" font-weight="700" fill="#1c2b3a">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${padL - 10}" y="${y + barH/2 + 4}" font-size="12" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}<title>${d[labelKey]}</title></text>`;
  });
  // Each category gets the same color as its bar so the legend is a true
  // key for the colorful Work Center / Grade chart (not a generic metric legend).
  const legend = rows.map((d,i) => {
    const c = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    return `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${d[labelKey]}</div>`;
  }).join("");
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Horizontal GROUPED bar chart — e.g. Intensity: Coils + Qty side-by-side. */
function makeHGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W;
  const rowH = opts.rowH || 58, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = items.length * rowH + padT + padB;
  const plotW = w - padL - padR;
  const nSeries = seriesDefs.length;
  const barH = (rowH * 0.7) / nSeries;

  // Use ONE common value scale across all grouped series. Separate per-series
  // maxima make a smaller value appear visually taller than a larger value.
  const commonMax = niceMax(Math.max(...seriesDefs.flatMap(s => items.map(d => Number(d[s.key]) || 0)), 0));
  const maxes = seriesDefs.map(() => commonMax);

  let bars = "", labels = "", legend = "", gridlines = "";
  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    const gv = commonMax * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupY = padT + i * rowH + rowH*0.15;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barW = Math.max(0, (val / maxV) * plotW);
      const y = groupY + si * (barH + 5);
      bars += `<rect x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${s.color}" rx="3"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${padL + barW + 10}" y="${y + barH/2 + 5}" font-size="16.5" font-weight="700" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${padL - 12}" y="${groupY + (barH+5)*nSeries/2 + 2}" font-size="12.5" font-weight="700" text-anchor="end" fill="#334155">${truncateLabel(d[labelKey], 26)}</text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Vertical grouped bar chart — for time-series with SHORT labels (Months). */
function makeGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 430, padL = 70, padR = 20, padT = 30, padB = 115;
  const plotW = w - padL - padR;
  const gap = plotW / items.length;
  const nSeries = seriesDefs.length;
  const groupW = Math.min(gap * 0.7, 90);
  const barW = groupW / nSeries - 6;
  const truncLen = opts.labelTruncate || 12;

  // Use ONE common value scale across all grouped series. Separate per-series
  // maxima make a smaller value appear visually taller than a larger value.
  const commonMax = niceMax(Math.max(...seriesDefs.flatMap(s => items.map(d => Number(d[s.key]) || 0)), 0));
  const maxes = seriesDefs.map(() => commonMax);

  let bars = "", labels = "", legend = "", gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    const gv = Math.max(...maxes) * g/4;
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  items.forEach((d, i) => {
    const groupX = padL + i * gap + (gap - groupW) / 2;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barH = Math.max(0, (val / maxV) * (h - padT - padB));
      const x = groupX + si * (barW + 6);
      const y = h - padB - barH;
      bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="decision" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${s.color}" rx="2"><title>${s.label} — ${d[labelKey]}: ${s.fmt ? s.fmt(val) : val}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 6}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${groupX + groupW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${groupX+groupW/2} ${h-padB+20})">${truncateLabel(d[labelKey], truncLen)}<title>${d[labelKey]}</title></text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

function makeLineChart(container, items, labelKey, series, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 400, padL = 65, padR = 30, padT = 45, padB = 95;
  const n = items.length;
  const stepX = n > 1 ? (w - padL - padR) / (n - 1) : 0;
  const maxV = opts.max !== undefined ? opts.max :
    niceMax(Math.max(...series.flatMap(s => items.map(d => d[s.key])), 0));

  let gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    const gv = maxV*g/4;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(2)}</text>`;
  }

  let svgParts = "", legend = "";
  const maxLabels = 10;
  const skip = Math.max(1, Math.ceil(n / maxLabels));
  series.forEach((s, si) => {
    const vals = items.map(d => d[s.key]);
    let points = "", dots = "", valueLabels = "";
    vals.forEach((v, i) => {
      const x = padL + (n > 1 ? i * stepX : (w-padL-padR)/2);
      const y = h - padB - (v / maxV) * (h - padT - padB);
      points += `${x},${y} `;
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="${s.color}" stroke="#fff" stroke-width="1.5"><title>${s.label} — ${items[i][labelKey]}: ${s.fmt ? s.fmt(v) : v}</title></circle>`;
      // Show the actual value in bold near the point (skip some when crowded)
      if(i % skip === 0 || i === n-1){
        const labelY = y - 10 - (si * 14);
        valueLabels += `<text x="${x}" y="${labelY}" font-size="14" font-weight="700" text-anchor="middle" fill="${s.color}">${s.fmt ? s.fmt(v) : v}</text>`;
      }
    });
    svgParts += `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2.5"/>${dots}${valueLabels}`;
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`;
  });

  let xLabels = "";
  items.forEach((d, i) => {
    if(i % skip !== 0 && i !== n-1) return;
    const x = padL + (n > 1 ? i * stepX : (w-padL-padR)/2);
    xLabels += `<text x="${x}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-30 ${x} ${h-padB+20})">${truncateLabel((d[labelKey]||"").replace("Wk of ",""), 12)}</text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${svgParts}${xLabels}
  </svg>`;
}

function makeComboChart(container, items, labelKey, barKey, lineKey, opts={}){
  if(!items.length){ container.innerHTML = "<div class='no-data'>No data to display.</div>"; return; }
  const w = DESIGN_W, h = 430, padL = 72, padR = 72, padT = 34, padB = 110;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxBar = niceMax(Math.max(...items.map(d => Number(d[barKey])||0), 0));
  const maxLine = opts.lineMax !== undefined ? opts.lineMax : 1;
  const gap = plotW / items.length;
  const barW = Math.min(52, gap * 0.58);
  let bars="", labels="", points="", dots="", gridlines="";
  for(let g=0; g<=4; g++){
    const ratio=g/4, gy=padT+plotH*(1-ratio);
    const bv=maxBar*ratio, lv=maxLine*ratio;
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#eef1f6" stroke-width="1"/>`;
    gridlines += `<text x="${padL-9}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="#6b7c93">${opts.barFmt?opts.barFmt(bv):bv.toFixed(0)}</text>`;
    gridlines += `<text x="${w-padR+9}" y="${gy+4}" font-size="10.5" text-anchor="start" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lv):lv.toFixed(0)}</text>`;
  }
  items.forEach((d,i)=>{
    const val=Number(d[barKey])||0, barH=(val/maxBar)*plotH;
    const x=padL+i*gap+(gap-barW)/2, y=h-padB-barH;
    const barColor = opts.barColor && !opts.colorful ? opts.barColor : CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect data-drill-category="${d[labelKey]}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,0)}" fill="${barColor}" rx="3"><title>${d[labelKey]}: ${opts.barFmt?opts.barFmt(val):val}</title></rect>`;
    bars += `<text x="${x+barW/2}" y="${Math.max(y-8,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2b3a">${opts.barFmt?opts.barFmt(val):val}</text>`;
    const lineVal=Math.max(0,Math.min(maxLine,Number(d[lineKey])||0));
    const lineY=h-padB-(lineVal/maxLine)*plotH, px=x+barW/2;
    points += `${px},${lineY} `;
    dots += `<circle cx="${px}" cy="${lineY}" r="4" fill="#DC2626" stroke="#fff" stroke-width="1.5"><title>Cumulative: ${opts.lineFmt?opts.lineFmt(lineVal):lineVal}</title></circle>`;
    dots += `<text x="${px}" y="${Math.max(lineY-10,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lineVal):lineVal}</text>`;
    labels += `<text x="${px}" y="${h-padB+20}" font-size="11.5" font-weight="700" text-anchor="end" fill="#334155" transform="rotate(-35 ${px} ${h-padB+20})">${truncateLabel(d[labelKey],16)}<title>${d[labelKey]}</title></text>`;
  });
  const legend=`<div class="legend-item"><span class="legend-dot" style="background:${CHART_COLORS[0]}"></span>${opts.barLegend||"Qty (MT)"}</div><div class="legend-item"><span class="legend-dot" style="background:#DC2626"></span>${opts.lineLegend||"Cumulative %"}</div>`;
  container.innerHTML=`<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${yAxisTitle(opts.barAxisLabel||"Qty (MT)",h,padT,padB)}
    <text x="${w-16}" y="${padT+plotH/2}" font-size="11.5" font-weight="700" fill="#DC2626" text-anchor="middle" transform="rotate(-90 ${w-16} ${padT+plotH/2})">${opts.lineAxisLabel||"Cumulative %"}</text>
    ${xAxisTitleV(opts.xLabel||"Main Defect",w,h,padL,padR)}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="#c7ceda" stroke-width="1.5"/>
    ${bars}<polyline points="${points}" fill="none" stroke="#DC2626" stroke-width="2.5"/>${dots}${labels}
  </svg>`;
}

function wireChartDrilldown(containerId, kind){
  const c=document.getElementById(containerId); if(!c||c.dataset.drillWired)return; c.dataset.drillWired='1'; c.classList.add('drillable-chart');
  c.addEventListener('click',e=>{const el=e.target.closest('[data-drill-category]'); if(!el)return; const cat=el.getAttribute('data-drill-category'); if(kind==='decision')openDrilldown('decision_category',`Quality Decision: ${cat} — Underlying Records`,{drill_value:cat}); else if(kind==='defect')openDrilldown('defect_category',`Defect: ${cat} — Underlying Records`,{drill_value:cat});});
}

