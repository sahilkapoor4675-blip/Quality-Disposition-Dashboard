/* 15-chart-builders.js — Pie / bar / line / combo chart builders. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
function makePieChart(container, items, valueKey, labelKey, opts={}){
  chartRemember(container, ()=>makePieChart(container, items, valueKey, labelKey, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  const sorted = [...items].sort((a,b) => b[valueKey]-a[valueKey]);
  // Canvas width follows the container's real width (see ZOOM-AWARE CHART SIZING) so the
  // label text keeps a fixed CSS size and scales with browser zoom. The pie's own coordinate
  // system is ~2x the bar charts', hence its smaller px-per-unit. 1500 units is the full
  // design; when the container is narrower the DONUT and the leader-line gaps shrink (factor
  // f) so the outside labels always fit, while the text itself stays the same size.
  const w = chartUnits(container, 0.93, 1000, 1500);
  const f = Math.max(0.5, Math.min(1, (w/2 - 220) / 530));
  const r = Math.round(280*f), innerR = Math.round(145*f);
  const cx = w/2, cy = r + 100, h = cy + r + 90;
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
  const _pieTag = svgDepthTag();

  // Pass 2: draw donut segments (outer arc out, inner arc back)
  let slices = "";
  slicesData.forEach((s, i) => {
    const ox1 = cx + r*Math.cos(s.a0), oy1 = cy + r*Math.sin(s.a0);
    const ox2 = cx + r*Math.cos(s.a1), oy2 = cy + r*Math.sin(s.a1);
    const ix1 = cx + innerR*Math.cos(s.a1), iy1 = cy + innerR*Math.sin(s.a1);
    const ix2 = cx + innerR*Math.cos(s.a0), iy2 = cy + innerR*Math.sin(s.a0);
    const largeArc = (s.a1 - s.a0) > Math.PI ? 1 : 0;
    slices += `<path class="chart-slice" style="--i:${Math.min(i,10)}" data-drill-category="${escQcr(s.d[labelKey])}" data-drill-kind="decision" d="M${ox1},${oy1} A${r},${r} 0 ${largeArc} 1 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${svgFill(s.color, _pieTag)}" filter="${svgLift(_pieTag)}" stroke="var(--chart-halo)" stroke-width="2.5" data-tip="${escQcr(s.d[labelKey])}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${fmtDonutPct3(s.frac)})"></path>`;
  });

  // Center label: grand total
  const totalText = opts.valFmt ? opts.valFmt(total) : total.toFixed(2);
  // The centre text keeps its full size while the donut hole is big enough; when the donut has
  // shrunk (narrow container / high zoom) it scales down just enough to stay inside the hole.
  const cScale = Math.min(1, (innerR*2*0.8) / (Math.max(String(totalText).length, 6) * 0.62 * 29));
  // A very soft radial glow behind TOTAL/value, echoing the same low-opacity
  // "lift" treatment used on the slices themselves — kept subtle so it reads
  // as depth, not a spotlight.
  const centerGlowId = `donutGlow-${_pieTag}`;
  const centerGlowDefs = `<defs><radialGradient id="${centerGlowId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".32"/><stop offset="55%" stop-color="var(--accent)" stop-opacity=".14"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>`;
  const centerLabel = `${centerGlowDefs}
    <circle cx="${cx}" cy="${cy}" r="${(innerR*0.92).toFixed(1)}" fill="url(#${centerGlowId})"/>
    <text x="${cx}" y="${cy-10*cScale}" font-size="${(21*cScale).toFixed(1)}" font-weight="700" text-anchor="middle" fill="var(--chart-muted)">TOTAL</text>
    <text x="${cx}" y="${cy+16*cScale}" font-size="${(29*cScale).toFixed(1)}" font-weight="700" text-anchor="middle" fill="var(--chart-strong)">${totalText}</text>`;

  // Pass 3: place outside labels. To keep both sides visually balanced,
  // slices are assigned to left/right by rank (alternating) so neither
  // side gets overloaded. Each leader line still starts from the slice's
  // TRUE position on the ring.
  const rightSlices = [], leftSlices = [];
  slicesData.forEach((s, i) => (i % 2 === 0 ? rightSlices : leftSlices).push(s));
  rightSlices.sort((a,b) => a.midAngle - b.midAngle);
  leftSlices.sort((a,b) => a.midAngle - b.midAngle);

  const rowSpacing = 58;
  const elbowOffset = 44*f;
  const labelOffset = 250*f;

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
      out += `<polyline points="${edgeX},${edgeY} ${elbowX},${targetY} ${labelX-side*4},${targetY}" fill="none" stroke="var(--chart-leader)" stroke-width="1.2"/>`;
      out += `<circle cx="${edgeX}" cy="${edgeY}" r="3" fill="${s.color}"/>`;
      out += `<text x="${labelX}" y="${targetY-6}" font-size="21" font-weight="700" text-anchor="${anchor}" fill="var(--chart-strong)" data-tip="${escQcr(s.d[labelKey])}">${escQcr(s.d[labelKey])}</text>`;
      out += `<text x="${labelX}" y="${targetY+11}" font-size="19" font-weight="700" text-anchor="${anchor}" fill="${s.color}">${valText} (${fmtDonutPct3(s.frac)})</text>`;
    });
    return out;
  }

  const sliceLabels = layoutSide(rightSlices, 1) + layoutSide(leftSlices, -1);

  // Bottom legend: name-only (with color swatch), separate from the
  // detailed outside labels above.
  let legend = "";
  sorted.forEach((d, i) => {
    const color = DECISION_COLORS[d[labelKey]] || CHART_COLORS[i % CHART_COLORS.length];
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(color)}"></span>${escQcr(d[labelKey])}</div>`;
  });

  const pieDefs = svgDepthDefs(slicesData.map(s => s.color), _pieTag);
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${pieDefs}${slices}${centerLabel}${sliceLabels}</svg>`;
}

/* Vertical bar chart — used for SHORT category names only (Months etc). */
/* Horizontal bar chart — used for LONG category names (Grades, Defects,
   Work Centers, Intensity levels) so labels never get cut off. */
function makeHBarChart(container, items, valueKey, labelKey, opts={}){
  chartRemember(container, ()=>makeHBarChart(container, items, valueKey, labelKey, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  // Always order horizontal bars from highest to lowest value. This prevents a
  // low-value bar from appearing above a higher-value bar and makes the chart
  // read like a proper ranked analysis. Keep a stable secondary sort by name.
  const rows = [...items].sort((a,b) => {
    const dv = (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0);
    return dv || String(a[labelKey] || '').localeCompare(String(b[labelKey] || ''));
  });
  const w = chartUnits(container);
  const rowH = 40, padL = 200, padR = 70, padT = 20, padB = 55;
  const h = rows.length * rowH + padT + padB;
  const maxV = niceMax(Math.max(...rows.map(d => Number(d[valueKey]) || 0), 0));
  const plotW = w - padL - padR;
  const _hbarTag = svgDepthTag();
  let bars = "", labels = "", gridlines = "";

  for(let g=0; g<=4; g++){
    const gx = padL + plotW * g/4;
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="var(--chart-muted)">${opts.fmt ? opts.fmt(maxV*g/4) : (maxV*g/4).toFixed(0)}</text>`;
  }

  rows.forEach((d, i) => {
    const val = Number(d[valueKey]) || 0;
    const barW = (val / maxV) * plotW;
    const y = padT + i * rowH + rowH*0.2;
    const barH = rowH * 0.6;
    const barColor = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect class="chart-bar" style="--i:${Math.min(i,10)}"${opts.drillKind?` data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind}"`:''} x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${svgFill(barColor, _hbarTag)}" filter="${svgLift(_hbarTag)}" rx="3" data-tip="${escQcr(d[labelKey])}: ${opts.fmt ? opts.fmt(val) : val}"></rect>`;
    bars += `<text x="${padL + barW + 8}" y="${y + barH/2 + 4}" font-size="14.5" font-weight="700" fill="var(--chart-strong)">${opts.fmt ? opts.fmt(val) : val}</text>`;
    labels += `<text x="${padL - 10}" y="${y + barH/2 + 4}" font-size="12" font-weight="700" text-anchor="end" fill="var(--chart-label)" data-tip="${escQcr(d[labelKey])}">${escQcr(truncateLabel(d[labelKey], 26))}</text>`;
  });
  // Each category gets the same color as its bar so the legend is a true
  // key for the colorful Work Center / Grade chart (not a generic metric legend).
  const legend = rows.map((d,i) => {
    const c = opts.color || CHART_COLORS[i % CHART_COLORS.length];
    return `<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(c)}"></span>${escQcr(d[labelKey])}</div>`;
  }).join("");
  const hbarDefs = svgDepthDefs(rows.map((d,i) => opts.color || CHART_COLORS[i % CHART_COLORS.length]), _hbarTag);
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${hbarDefs}
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="var(--chart-axis)" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Horizontal GROUPED bar chart — e.g. Intensity: Coils + Qty side-by-side. */
function makeHGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  chartRemember(container, ()=>makeHGroupedBarChart(container, items, labelKey, seriesDefs, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  const w = chartUnits(container);
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
    gridlines += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridlines += `<text x="${gx}" y="${h-padB+18}" font-size="10.5" text-anchor="middle" fill="var(--chart-muted)">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  const _hgTag = svgDepthTag();
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(s.color)}"></span>${escQcr(s.label)}</div>`;
  });

  items.forEach((d, i) => {
    const groupY = padT + i * rowH + rowH*0.15;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barW = Math.max(0, (val / maxV) * plotW);
      const y = groupY + si * (barH + 5);
      bars += `<rect class="chart-bar" style="--i:${Math.min(i*nSeries+si,10)}"${opts.drillKind?` data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind}"`:''} x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${svgFill(s.color, _hgTag)}" filter="${svgLift(_hgTag)}" rx="3" data-tip="${escQcr(s.label)} — ${escQcr(d[labelKey])}: ${s.fmt ? s.fmt(val) : val}"></rect>`;
      bars += `<text x="${padL + barW + 10}" y="${y + barH/2 + 5}" font-size="16.5" font-weight="700" fill="var(--chart-strong)">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${padL - 12}" y="${groupY + (barH+5)*nSeries/2 + 2}" font-size="12.5" font-weight="700" text-anchor="end" fill="var(--chart-label)">${escQcr(truncateLabel(d[labelKey], 26))}</text>`;
  });

  const hgDefs = svgDepthDefs(seriesDefs.map(s => s.color), _hgTag);
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${hgDefs}
    ${gridlines}
    ${opts.yLabel ? yAxisTitleH(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleH(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}" stroke="var(--chart-axis)" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

/* Vertical grouped bar chart — for time-series with SHORT labels (Months). */
function makeGroupedBarChart(container, items, labelKey, seriesDefs, opts={}){
  chartRemember(container, ()=>makeGroupedBarChart(container, items, labelKey, seriesDefs, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  const w = chartUnits(container), h = 430, padL = 70, padR = 20, padT = 30, padB = 115;
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
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="var(--chart-muted)">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(0)}</text>`;
  }
  const _vgTag = svgDepthTag();
  seriesDefs.forEach(s => {
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(s.color)}"></span>${escQcr(s.label)}</div>`;
  });

  items.forEach((d, i) => {
    const groupX = padL + i * gap + (gap - groupW) / 2;
    seriesDefs.forEach((s, si) => {
      const val = Math.max(0, Number(d[s.key]) || 0);
      const maxV = maxes[si];
      const barH = Math.max(0, (val / maxV) * (h - padT - padB));
      const x = groupX + si * (barW + 6);
      const y = h - padB - barH;
      bars += `<rect class="chart-bar" style="--i:${Math.min(i*nSeries+si,10)}" data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind||'decision'}" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${svgFill(s.color, _vgTag)}" filter="${svgLift(_vgTag)}" rx="2" data-tip="${escQcr(s.label)} — ${escQcr(d[labelKey])}: ${s.fmt ? s.fmt(val) : val}"></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 6}" font-size="14" font-weight="700" text-anchor="middle" fill="var(--chart-strong)">${s.fmt ? s.fmt(val) : val}</text>`;
    });
    labels += `<text x="${groupX + groupW/2}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="var(--chart-label)" transform="rotate(-30 ${groupX+groupW/2} ${h-padB+20})" data-tip="${escQcr(d[labelKey])}">${escQcr(truncateLabel(d[labelKey], truncLen))}</text>`;
  });

  const vgDefs = svgDepthDefs(seriesDefs.map(s => s.color), _vgTag);
  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${vgDefs}
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="var(--chart-axis)" stroke-width="1.5"/>
    ${bars}${labels}
  </svg>`;
}

function makeLineChart(container, items, labelKey, series, opts={}){
  chartRemember(container, ()=>makeLineChart(container, items, labelKey, series, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  const w = chartUnits(container), h = 400, padL = 65, padR = 30, padT = 45, padB = 95;
  const n = items.length;
  const stepX = n > 1 ? (w - padL - padR) / (n - 1) : 0;
  const maxV = opts.max !== undefined ? opts.max :
    niceMax(Math.max(...series.flatMap(s => items.map(d => d[s.key])), 0));

  let gridlines = "";
  for(let g=0; g<=4; g++){
    const gy = padT + (h-padT-padB) * (1 - g/4);
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    const gv = maxV*g/4;
    gridlines += `<text x="${padL-8}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="var(--chart-muted)">${opts.axisFmt ? opts.axisFmt(gv) : gv.toFixed(2)}</text>`;
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
      const r = s.dashed ? 3 : 4;
      dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="${s.color}" stroke="var(--chart-halo)" stroke-width="1.5"${s.dashed?' opacity=".8"':''} data-tip="${escQcr(s.label)} — ${escQcr(items[i][labelKey])}: ${s.fmt ? s.fmt(v) : v}"></circle>`;
      // Show the actual value in bold near the point (skip some when crowded).
      // Dashed "compare to previous period" series get a smaller, lighter
      // label placed BELOW the point instead of above — keeps it clearly
      // legible without visually competing with the primary series' labels
      // right above the same point.
      if(i % skip === 0 || i === n-1){
        const labelY = s.dashed ? (y + 17 + (si*13)) : (y - 10 - (si*14));
        const fontSize = s.dashed ? 11 : 14;
        valueLabels += `<text x="${x}" y="${labelY}" font-size="${fontSize}" font-weight="700" text-anchor="middle" fill="${s.color}"${s.dashed?' opacity=".8"':''}>${s.fmt ? s.fmt(v) : v}</text>`;
      }
    });
    svgParts += `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="${s.dashed?2:2.5}" ${s.dashed?'stroke-dasharray="7 5" opacity=".72"':''}/>${dots}${valueLabels}`;
    legend += `<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(s.color)};${s.dashed?'opacity:.72;border:1px dashed '+s.color+';background:transparent;':''}"></span>${escQcr(s.label)}</div>`;
  });

  let xLabels = "";
  items.forEach((d, i) => {
    if(i % skip !== 0 && i !== n-1) return;
    const x = padL + (n > 1 ? i * stepX : (w-padL-padR)/2);
    xLabels += `<text x="${x}" y="${h - padB + 20}" font-size="11.5" font-weight="700" text-anchor="end" fill="var(--chart-label)" transform="rotate(-30 ${x} ${h-padB+20})">${escQcr(truncateLabel((d[labelKey]||"").replace("Wk of ",""), 12))}</text>`;
  });

  container.innerHTML = `<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridlines}
    ${opts.yLabel ? yAxisTitle(opts.yLabel, h, padT, padB) : ""}
    ${opts.xLabel ? xAxisTitleV(opts.xLabel, w, h, padL, padR) : ""}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="var(--chart-axis)" stroke-width="1.5"/>
    ${svgParts}${xLabels}
  </svg>`;
}

function makeComboChart(container, items, labelKey, barKey, lineKey, opts={}){
  chartRemember(container, ()=>makeComboChart(container, items, labelKey, barKey, lineKey, opts));
  if(!items.length){ container.innerHTML = emptyStateMarkup('No data to display.','Try widening the date range or clearing a filter.'); return; }
  const w = chartUnits(container), h = 430, padL = 72, padR = 72, padT = 34, padB = 110;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxBar = niceMax(Math.max(...items.map(d => Number(d[barKey])||0), 0));
  const maxLine = opts.lineMax !== undefined ? opts.lineMax : 1;
  const gap = plotW / items.length;
  const barW = Math.min(52, gap * 0.58);
  const _comboTag = svgDepthTag();
  let bars="", labels="", points="", dots="", gridlines="";
  for(let g=0; g<=4; g++){
    const ratio=g/4, gy=padT+plotH*(1-ratio);
    const bv=maxBar*ratio, lv=maxLine*ratio;
    gridlines += `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridlines += `<text x="${padL-9}" y="${gy+4}" font-size="10.5" text-anchor="end" fill="var(--chart-muted)">${opts.barFmt?opts.barFmt(bv):bv.toFixed(0)}</text>`;
    gridlines += `<text x="${w-padR+9}" y="${gy+4}" font-size="10.5" text-anchor="start" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lv):lv.toFixed(0)}</text>`;
  }
  items.forEach((d,i)=>{
    const val=Number(d[barKey])||0, barH=(val/maxBar)*plotH;
    const x=padL+i*gap+(gap-barW)/2, y=h-padB-barH;
    const barColor = opts.barColor && !opts.colorful ? opts.barColor : CHART_COLORS[i % CHART_COLORS.length];
    bars += `<rect class="chart-bar" style="--i:${Math.min(i,10)}" data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,0)}" fill="${svgFill(barColor, _comboTag)}" filter="${svgLift(_comboTag)}" rx="3" data-tip="${escQcr(d[labelKey])}: ${opts.barFmt?opts.barFmt(val):val}"></rect>`;
    bars += `<text x="${x+barW/2}" y="${Math.max(y-8,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="var(--chart-strong)">${opts.barFmt?opts.barFmt(val):val}</text>`;
    const lineVal=Math.max(0,Math.min(maxLine,Number(d[lineKey])||0));
    const lineY=h-padB-(lineVal/maxLine)*plotH, px=x+barW/2;
    points += `${px},${lineY} `;
    dots += `<circle cx="${px}" cy="${lineY}" r="4" fill="#DC2626" stroke="var(--chart-halo)" stroke-width="1.5" data-tip="Cumulative: ${opts.lineFmt?opts.lineFmt(lineVal):lineVal}"></circle>`;
    dots += `<text x="${px}" y="${Math.max(lineY-10,padT+12)}" font-size="14" font-weight="700" text-anchor="middle" fill="#DC2626">${opts.lineFmt?opts.lineFmt(lineVal):lineVal}</text>`;
    labels += `<text x="${px}" y="${h-padB+20}" font-size="11.5" font-weight="700" text-anchor="end" fill="var(--chart-label)" transform="rotate(-35 ${px} ${h-padB+20})" data-tip="${escQcr(d[labelKey])}">${escQcr(truncateLabel(d[labelKey],16))}</text>`;
  });
  const legend=`<div class="legend-item"><span class="legend-dot" style="background:${legendDotBg(CHART_COLORS[0])}"></span>${opts.barLegend||"Qty (MT)"}</div><div class="legend-item"><span class="legend-dot" style="background:${legendDotBg('#DC2626')}"></span>${opts.lineLegend||"Cumulative %"}</div>`;
  const comboBarColors = items.map((d,i) => opts.barColor && !opts.colorful ? opts.barColor : CHART_COLORS[i % CHART_COLORS.length]);
  container.innerHTML=`<div class="legend" style="justify-content:center;">${legend}</div><svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${svgDepthDefs(comboBarColors, _comboTag)}
    ${gridlines}
    ${yAxisTitle(opts.barAxisLabel||"Qty (MT)",h,padT,padB)}
    <text x="${w-16}" y="${padT+plotH/2}" font-size="11.5" font-weight="700" fill="#DC2626" text-anchor="middle" transform="rotate(-90 ${w-16} ${padT+plotH/2})">${opts.lineAxisLabel||"Cumulative %"}</text>
    ${xAxisTitleV(opts.xLabel||"Main Defect",w,h,padL,padR)}
    <line x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}" stroke="var(--chart-axis)" stroke-width="1.5"/>
    ${bars}<polyline points="${points}" fill="none" stroke="#DC2626" stroke-width="2.5"/>${dots}${labels}
  </svg>`;
}

function wireChartDrilldown(containerId, kind){
  const c=document.getElementById(containerId); if(!c||c.dataset.drillWired)return; c.dataset.drillWired='1'; c.classList.add('drillable-chart');
  c.addEventListener('click',e=>{
    const el=e.target.closest('[data-drill-category]'); if(!el)return;
    const cat=el.getAttribute('data-drill-category');
    if(kind==='decision')openDrilldown('decision_category',`Quality Decision: ${cat} — Underlying Records`,{drill_value:cat});
    else if(kind==='defect')openDrilldown('defect_category',`Defect: ${cat} — Underlying Records`,{drill_value:cat});
    // Work Center / Grade bars reuse the already-proven "quality_investigation"
    // filter (same one used by the QCR investigate buttons) instead of a
    // fake decision/defect match, so the totals shown are guaranteed correct.
    else if(kind==='work_center')openDrilldown('quality_investigation',`Work Center: ${cat} — Underlying Records`,{work_center:cat});
    else if(kind==='grade')openDrilldown('quality_investigation',`Grade: ${cat} — Underlying Records`,{grade:cat});
    else if(kind==='month')openDrilldown('month_category',`Month: ${cat} — Underlying Records`,{drill_value:cat});
    else if(kind==='intensity')openDrilldown('intensity_category',`Defect Intensity: ${cat} — Underlying Records`,{drill_value:cat});
  });
}

