/* 11-chart-core.js — Chart palette, SVG helpers, resize observer, tooltips. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---------------------------------------------------------------------
// SUBTLE CHART DEPTH (gradient fill + soft lift shadow)
// A flat color chip reads as generic; a full 3D/bevel treatment reads as
// gimmicky and, on a donut/pie, actively distorts how big each slice looks
// (a well-known data-viz readability problem). So depth here stays
// restrained: one soft top-to-bottom gradient per color plus a single
// shared low-opacity drop shadow, reused by every chart and the fishbone
// diagram so the whole app reads as one consistent, gently "lifted" look.
// Every chart on a page gets its OWN gradient/filter ids (suffixed with a random
// per-render tag). Two charts sharing a plain id like "grad-118DFF" would silently
// go transparent the moment either chart re-renders (e.g. on container resize) and
// removes/replaces its <defs> — SVG/HTML ids are looked up document-wide, so a
// url(#grad-118DFF) reference can resolve to WHATEVER chart on the page defined
// that id last, including one that no longer exists.
let _svgDepthSeq = 0;
function svgDepthTag(){ return 'd' + (++_svgDepthSeq) + Math.random().toString(36).slice(2,6); }
function svgDepthDefs(colors, tag){
  const uniq=[...new Set((colors||[]).filter(Boolean))];
  const grads=uniq.map(c=>`<linearGradient id="grad-${tag}-${c.replace('#','')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c}" stop-opacity="1"/><stop offset="100%" stop-color="${c}" stop-opacity=".8"/></linearGradient>`).join('');
  return `<defs>${grads}<filter id="chartLift-${tag}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#0b1c33" flood-opacity=".22"/></filter></defs>`;
}
function svgFill(color, tag){ return color ? `url(#grad-${tag}-${color.replace('#','')})` : color; }
function svgLift(tag){ return `url(#chartLift-${tag})`; }
// Legend swatches echo the same top-to-bottom gradient (full color -> ~80%
// opacity) used for the bar/slice fills above, so a legend dot reads as a
// tiny sample of its chart color rather than a flat, disconnected chip.
// A top-to-bottom opacity fade (color -> 80% opacity) is nearly invisible at
// the legend dot's 11px size, so the gradient is widened to a visible
// light-to-dark sweep (a soft highlight fading into a darker shade of the
// same color) instead — still clearly "that chart color", just with real depth.
function legendDotBg(color){ return color ? `linear-gradient(180deg,color-mix(in srgb,${color} 65%,white) 0%,${color} 55%,color-mix(in srgb,${color} 78%,black) 100%)` : color; }
const DESIGN_W = 720; // fallback only (chart container hidden / not measurable yet)

// ---------------------------------------------------------------------
// ZOOM-AWARE CHART SIZING
// The charts are SVG. They used to be drawn on a fixed 720-unit canvas that
// was then stretched to the container's width, so the text size followed the
// container width instead of the browser zoom: when the person pressed
// Ctrl +/- the page text grew or shrank but the chart text stayed ~20px.
// Now the canvas width is derived from the container's real CSS width:
//     units = containerWidth / CHART_PX_PER_UNIT
// so ONE SVG unit is always the same number of CSS pixels. Chart text is then
// a fixed CSS size exactly like every other piece of text on the page and
// scales with browser zoom in every browser; only the plot area gets
// wider/narrower. (CHART_PX_PER_UNIT 1.9 reproduces the previous look at
// 100% zoom on a ~1500px-wide window.) Below CHART_MIN_UNITS the canvas stops
// shrinking and the whole chart scales down instead, which keeps very narrow
// / phone layouts readable.
// ---------------------------------------------------------------------
const CHART_PX_PER_UNIT = 1.9;
const CHART_MIN_UNITS = 480;
function chartAvailWidth(el){
  if(!el) return 0;
  const cs = getComputedStyle(el);
  return Math.max(0, el.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0));
}
function chartUnits(container, pxPerUnit=CHART_PX_PER_UNIT, minUnits=CHART_MIN_UNITS, fallback=DESIGN_W){
  const cw = chartAvailWidth(container);
  if(!cw) return fallback;
  // container._qdFit is set only by presentation mode: it reshapes the canvas so the chart's
  // aspect ratio matches the space it is shown in (1 = normal dashboard behaviour).
  return Math.max(minUnits, Math.round(cw / (pxPerUnit * (container._qdFit || 1))));
}
// Charts remember how to redraw themselves and are redrawn (debounced) when
// their container's width changes: browser zoom, window resize, a hidden tab
// becoming visible, the sidebar/layout reflowing...
const _chartResizeQueue = new Set();
let _chartResizeTimer = null;
const _chartResizeObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(entries => {
  entries.forEach(e => _chartResizeQueue.add(e.target));
  clearTimeout(_chartResizeTimer);
  // The 120ms timer just lets a drag-resize settle before we bother redrawing
  // at all. The actual redraw work is then deferred one more step, onto
  // requestAnimationFrame, so it lands right before the browser's next paint
  // instead of at the arbitrary moment a setTimeout callback happens to fire —
  // that misalignment is what let several charts visibly pop mid-frame
  // (the resize/sidebar-toggle "flicker") instead of updating in the same
  // frame as everything else.
  _chartResizeTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      const targets = [..._chartResizeQueue]; _chartResizeQueue.clear();
      // Read phase first: measure every queued chart's width before redrawing
      // any of them. Interleaving "measure this one, redraw it, measure the
      // next one, redraw it..." forces the browser to recompute layout on
      // every single measurement (classic layout thrashing) whenever more
      // than one chart resizes at once — e.g. every chart on a tab when the
      // window itself is resized. Measuring all of them up front means the
      // layout is only ever read once per batch.
      const widths = targets.map(t => (t._qdRedraw && t.isConnected) ? chartAvailWidth(t) : null);
      // Write phase: redraw only the ones whose width actually changed
      // enough to matter (height-only changes, caused by a redraw itself,
      // must not trigger another redraw). A brief chart-refreshing→chart-ready
      // class toggle — the same transition already used for filter-triggered
      // refreshes — turns the SVG swap into a soft fade instead of an
      // instant pop, so a resize redraw reads as a smooth transition rather
      // than a jarring flash.
      targets.forEach((t, i) => {
        const cw = widths[i];
        if(cw == null || cw <= 0) return;
        if(Math.abs(cw - (t._qdCw||0)) < 6) return;
        t.classList.add('chart-refreshing');
        // One frame for the fade-out to actually register, then redraw and
        // hold briefly before fading back in — swapping content immediately
        // would just be an imperceptible flash, not the smooth dip-and-return
        // the rest of the app's refresh transitions use.
        requestAnimationFrame(() => {
          try { t._qdRedraw(); } catch(err){ console.error('Chart redraw failed', err); }
          setTimeout(() => {
            t.classList.remove('chart-refreshing');
            t.classList.add('chart-ready');
            setTimeout(() => t.classList.remove('chart-ready'), 700);
          }, 90);
        });
      });
    });
  }, 120);
}) : null;
function chartRemember(container, redraw){
  if(!container) return;
  container._qdRedraw = redraw;
  container._qdCw = chartAvailWidth(container);
  if(_chartResizeObserver && !container._qdObserved){ container._qdObserved = true; _chartResizeObserver.observe(container); }
}

// ---------------------------------------------------------------------
// CUSTOM CHART TOOLTIP
// Every hoverable chart shape carries a plain-text data-tip attribute
// instead of an SVG <title> child, so the tooltip can be styled like the
// rest of the app (card background, border, shadow) instead of showing the
// browser's unstyled native box. One floating element is reused for every
// chart; event delegation on document means it keeps working after a chart
// redraws (resize, filter change, tab switch) with no per-chart rewiring.
let _chartTooltipEl = null;
function chartTooltipEl(){
  if(!_chartTooltipEl){
    _chartTooltipEl = document.createElement('div');
    _chartTooltipEl.className = 'chart-tooltip';
    _chartTooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_chartTooltipEl);
  }
  return _chartTooltipEl;
}
function positionChartTooltip(x, y){
  const el = chartTooltipEl(), pad = 14;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = el.getBoundingClientRect();
  let left = x + pad, top = y + pad;
  if(left + rect.width > vw - 8) left = x - rect.width - pad;   // flip left of cursor near the right edge
  if(top + rect.height > vh - 8) top = y - rect.height - pad;   // flip above the cursor near the bottom edge
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, top) + 'px';
}
function initChartTooltips(){
  if(initChartTooltips._wired) return;
  initChartTooltips._wired = true;
  document.addEventListener('pointerover', e => {
    const t = e.target.closest('[data-tip]');
    if(!t || t.contains(e.relatedTarget)) return;
    const el = chartTooltipEl();
    const tip = t.getAttribute('data-tip') || '';
    const fEl = t.closest('[data-chart-field]');
    const showField = fEl && !/ — /.test(tip) && !/^Cumulative/i.test(tip);
    el.innerHTML = '<span class="ct-main">' + escQcr(tip) + '</span>' + (showField ? '<span class="ct-field">' + qdIc('tag') + escQcr(fEl.getAttribute('data-chart-field')) + '</span>' : '');
    el.classList.add('show');
    positionChartTooltip(e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', e => {
    if(!chartTooltipEl().classList.contains('show')) return;
    if(!e.target.closest('[data-tip]')) return;
    positionChartTooltip(e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', e => {
    const t = e.target.closest('[data-tip]');
    if(!t || t.contains(e.relatedTarget)) return; // moving within the same shape shouldn't hide it
    chartTooltipEl().classList.remove('show');
  });
  // A tap on mobile fires pointerover with no matching pointerout until the
  // next tap elsewhere; hide on the next touch outside any tipped shape.
  document.addEventListener('touchstart', e => {
    if(!e.target.closest('[data-tip]')) chartTooltipEl().classList.remove('show');
  }, {passive:true});
}

