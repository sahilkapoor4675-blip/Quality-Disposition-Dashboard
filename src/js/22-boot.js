/* 22-boot.js — init() and service-worker registration (must stay LAST). Bundled into /app.js in filename order; see README ("Frontend source layout"). */
async function init(){
  setRefreshed();
  startDigitalClock();
  startLiveUserTracking();
  // Dashboard is intentionally public for now. No username/password is required.
  // Every dashboard page load is logged server-side with the visitor IP address.
  await loadKpiTargets();
  wireDrilldown();
  // Restore tab/filters from the URL (a shared link or a page reload)
  // before the filter dropdowns are built, so they render already-selected
  // rather than being built as "All" and then corrected a moment later.
  const restored = readUrlState();
  Object.assign(currentFilters, restored.filters);
  await loadFilters();
  syncFilterUiFromState();
  // A shared/bookmarked link can encode a combination that no longer overlaps
  // (e.g. the data has moved on). Cascade once on load so an impossible combo
  // is narrowed immediately instead of surfacing as a silent 0-record view.
  if(FILTER_DEFS.some(f=>currentFilters[f.key]&&currentFilters[f.key]!=='All')) refreshCascadeFilters();
  startDataRevisionPolling();
  initSortableTables();
  wireAnalyticsPresentation();
  wireCompareMode();
  wireExportDialog();
  initCommandPalette();
  initChartTooltips();
  initOfflineBanner();
  initFieldHints();
  // No tab in the URL (a fresh visit, not a shared link)? Fall back to
  // whichever tab this person picked as their default landing tab (Command
  // Palette → "Set … as my Default Landing Tab"), before finally falling
  // back to "dashboard" if they've never set one.
  let savedDefaultTab = null;
  try { savedDefaultTab = localStorage.getItem("qdash_default_tab"); } catch(e) {}
  if(savedDefaultTab && !TAB_KEYS.includes(savedDefaultTab)) savedDefaultTab = null;
  const startTab = restored.tab || savedDefaultTab || 'dashboard';
  showSkeletons(startTab);
  if(startTab !== 'dashboard'){
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === startTab));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + startTab));
    try { await TAB_LOADERS[startTab](); finishTabLoad(startTab); } catch(e) { finishTabLoad(startTab, e); }
  } else {
    try { await loadKpis(); finishTabLoad('dashboard'); } catch(e) { finishTabLoad('dashboard', e); }
  }
  // Warm the QCR cache right after the landing tab finishes rendering, the
  // same way triggerFilterRefresh() already does on every later filter
  // change. Without this, only a *second* visit to the Quality Control Room
  // tab was fast (fetchQcrCore had nothing cached yet) — the very first
  // click always paid the full /api/qcr round trip. Skipped when the QCR
  // tab is itself the landing tab, since it's already fetching its own data
  // above and a second parallel request would just be wasted.
  if(startTab !== 'controlroom') prefetchQcrCore({...currentFilters});
}
init();

/* ==== Offline/PWA registration (moved from index.html) ==== */
// Offline/PWA support: only the public dashboard registers a worker, so
// admin.html never caches any admin data to disk. Registration failure
// (unsupported browser, blocked by policy, etc.) is silently ignored —
// the dashboard works the same either way, just without offline caching.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
