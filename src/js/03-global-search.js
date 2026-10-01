/* 03-global-search.js — Global search (defects / grades / work centers). Bundled into /app.js in filename order; see README ("Frontend source layout"). */
// ---- Global search: quickly find any defect / grade / work center -----
(function initGlobalSearch(){
  const input = document.getElementById("globalSearchInput");
  const results = document.getElementById("globalSearchResults");
  if (!input || !results) return;
  let searchIndex = null; // [{type,label}], lazy-loaded on first focus
  let activeIdx = -1;

  async function loadSearchIndex(){
    if (searchIndex) return searchIndex;
    try{
      const [filters, defects] = await Promise.all([
        fetch("/api/filters").then(r=>r.json()),
        fetch("/api/defect_analysis").then(r=>r.json()),
      ]);
      const idx = [];
      (filters.work_center||[]).forEach(v=>{ if(v && v!=="All") idx.push({type:"work_center", label:v}); });
      (filters.grade||[]).forEach(v=>{ if(v && v!=="All") idx.push({type:"grade", label:v}); });
      (defects.register||[]).forEach(r=>{ if(r.defect) idx.push({type:"defect", label:r.defect}); });
      searchIndex = idx;
    }catch(e){ searchIndex = []; }
    return searchIndex;
  }

  function highlight(label, q){
    const i = label.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escQcr(label);
    return escQcr(label.slice(0,i)) + "<mark>" + escQcr(label.slice(i,i+q.length)) + "</mark>" + escQcr(label.slice(i+q.length));
  }

  function render(matches, q){
    if (!matches.length){
      results.innerHTML = '<div class="gsr-empty">No matching defect, grade, or work center.</div>';
      results.classList.add("open");
      return;
    }
    const tagLabel = {defect:"Defect", grade:"Grade", work_center:"Work Center"};
    results.innerHTML = matches.slice(0,12).map((m,i)=>
      `<div class="gsr-item${i===activeIdx?' active':''}" data-type="${m.type}" data-label="${escQcr(m.label)}">`+
      `<span class="gsr-item-label">${highlight(m.label,q)}</span>`+
      `<span class="gsr-item-tag ${m.type}">${tagLabel[m.type]}</span></div>`
    ).join("");
    results.classList.add("open");
  }

  function select(type, label){
    results.classList.remove("open");
    input.value = "";
    activeIdx = -1;
    if (type === "grade" || type === "work_center"){
      currentFilters[type] = label;
      document.querySelectorAll(".filter-field").forEach(field=>{
        if (field.dataset.filterKey !== type) return;
        const span = field.querySelector(".filter-trigger span");
        if (span) span.textContent = label;
        field.classList.add("filter-active");
      });
      if (typeof updateActiveFilterBadge === "function") updateActiveFilterBadge();
      // The Chemistry SPC tab has its own filters; these dashboard filters are hidden there, so show the result on the Dashboard tab.
      if (document.querySelector(".tab-btn.active")?.dataset.tab === "chem" && typeof activateTab === "function"){
        if (typeof writeUrlState === "function") writeUrlState(false);
        activateTab("dashboard");
        if (typeof refreshCascadeFilters === "function") refreshCascadeFilters();
      } else if (typeof triggerFilterRefresh === "function") triggerFilterRefresh();
    } else if (type === "defect"){
      openDrilldown("quality_investigation", `Search — ${label}`, {drill_value: label});
    }
  }

  window.addEventListener("qdash:data-revision-changed", () => { searchIndex = null; });

  input.addEventListener("focus", async () => {
    await loadSearchIndex();
    if (input.value.trim()) input.dispatchEvent(new Event("input"));
  });
  input.addEventListener("input", async () => {
    const q = input.value.trim();
    activeIdx = -1;
    if (!q){ results.classList.remove("open"); return; }
    const idx = await loadSearchIndex();
    const matches = idx.filter(m => m.label.toLowerCase().includes(q.toLowerCase()));
    render(matches, q);
  });
  results.addEventListener("click", (e) => {
    const item = e.target.closest(".gsr-item");
    if (!item || !item.dataset.type) return;
    select(item.dataset.type, item.dataset.label);
  });
  input.addEventListener("keydown", (e) => {
    const items = [...results.querySelectorAll(".gsr-item")];
    if (!items.length) return;
    if (e.key === "ArrowDown"){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); items.forEach((it,i)=>it.classList.toggle("active", i===activeIdx)); items[activeIdx].scrollIntoView({block:"nearest"}); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); items.forEach((it,i)=>it.classList.toggle("active", i===activeIdx)); items[activeIdx].scrollIntoView({block:"nearest"}); }
    else if (e.key === "Enter"){ e.preventDefault(); const it = items[activeIdx] || items[0]; if (it) select(it.dataset.type, it.dataset.label); }
    else if (e.key === "Escape"){ results.classList.remove("open"); input.blur(); }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#globalSearchWrap")) results.classList.remove("open");
  });
})();
