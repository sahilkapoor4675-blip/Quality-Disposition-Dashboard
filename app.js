const FILTER_DEFS = [
  {key:"month", label:"📅 Month"},
  {key:"work_center", label:"🏭 Work Center"},
  {key:"grade", label:"🧪 Grade"},
  {key:"quality_decision", label:"⚖️ Quality Decision"},
  {key:"week", label:"🗓️ Week"},
  {key:"quarter", label:"📊 Quarter"},
  {key:"financial_year", label:"📆 Financial Year"},
  {key:"defect_intensity", label:"🏷️ Defect Intensity"},
];

// V65.0 icon helper: <svg><use> reference into the sprite at the top of index.html.
function qdIc(name,cls){ return `<svg class="ic${cls?' '+cls:''}" aria-hidden="true"><use href="#ic-${name}"/></svg>`; }

let currentFilters = {};
FILTER_DEFS.forEach(f => currentFilters[f.key] = "All");
let previousKpiValues = new Map();
let previousKpiTrend = new Map();
let kpiAnimationToken = 0;
let kpiFirstPaintDone = false;
// Subtle 3D tilt on KPI cards (mouse-follow rotateX/rotateY), only for
// fine-pointer devices and when the user hasn't asked for reduced motion.
// Reads --tiltX/--tiltY, consumed by the .kpi-card:hover transform in app.css.
const _kpiTiltEnabled = window.matchMedia('(pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function attachKpiTilt(card){
  const maxDeg=5;
  card.addEventListener('mousemove',e=>{
    const r=card.getBoundingClientRect();
    const px=(e.clientX-r.left)/r.width, py=(e.clientY-r.top)/r.height;
    card.style.setProperty('--tiltY',((px-0.5)*2*maxDeg).toFixed(2)+'deg');
    card.style.setProperty('--tiltX',((0.5-py)*2*maxDeg).toFixed(2)+'deg');
  });
  card.addEventListener('mouseleave',()=>{ card.style.setProperty('--tiltX','0deg'); card.style.setProperty('--tiltY','0deg'); });
}

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
      if (typeof triggerFilterRefresh === "function") triggerFilterRefresh();
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
// ---- Display preferences: theme, table density, sound ----
// These three used to be header buttons. They now live ONLY in the Command
// Palette (Ctrl+K / Cmd+K, or the ⌘K button in the header), which calls the
// functions below directly — nothing depends on a header button existing.
// The theme itself is applied pre-paint by the inline script in index.html
// (to avoid a flash of the wrong theme); this just changes/persists it.
function currentTheme(){ return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
function toggleTheme(){
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("qdash_theme", next); } catch (e) {}
  return next;
}
// Density: "Compact" tightens table row padding so more fits on screen
// without scrolling — remembered per-browser like the theme.
function isCompactDensity(){ return document.body.classList.contains("density-compact"); }
function applyDensity(density){ document.body.classList.toggle("density-compact", density === "compact"); }
function toggleDensity(){
  const next = isCompactDensity() ? "comfortable" : "compact";
  applyDensity(next);
  try { localStorage.setItem("qdash_density", next); } catch (e) {}
  return next;
}
(function restoreDensity(){
  let saved = "comfortable";
  try { saved = localStorage.getItem("qdash_density") || "comfortable"; } catch (e) {}
  applyDensity(saved);
})();
// Sound: sfx.js owns the on/off state (window.SFX); this is just the toggle.
function toggleSound(){
  if (!window.SFX) return null;
  const next = !SFX.isEnabled();
  SFX.setEnabled(next);
  return next;
}
// ---- Personalization: default landing tab + accent color. Both are
// preferences reachable from the Command Palette (Ctrl+K) rather than
// adding more header buttons — see initCommandPalette() below. ----
const ACCENT_PRESETS=[
  {name:"Ocean Blue (default)",value:""},
  {name:"Teal",value:"#0D9488"},
  {name:"Violet",value:"#7C3AED"},
  {name:"Rose",value:"#E11D48"},
  {name:"Amber",value:"#D97706"},
  {name:"Forest",value:"#15803D"},
];
function applyAccent(value){
  if(value) document.documentElement.style.setProperty("--accent",value);
  else document.documentElement.style.removeProperty("--accent");
  try{ localStorage.setItem("qdash_accent", value||""); }catch(e){}
}
(function restoreAccent(){ let saved=""; try{ saved=localStorage.getItem("qdash_accent")||""; }catch(e){} if(saved) applyAccent(saved); })();
function setDefaultLandingTab(tabName){
  try{ localStorage.setItem("qdash_default_tab", tabName); }catch(e){}
  showToast("success","Default tab set",`The dashboard will open on "${document.querySelector('.tab-btn[data-tab="'+tabName+'"]')?.textContent.trim()||tabName}" from now on.`);
}

// ---- Command palette (Ctrl+K / Cmd+K) ----
function initCommandPalette(){
  const modal=document.getElementById('cmdkModal'), input=document.getElementById('cmdkInput'), list=document.getElementById('cmdkList');
  if(!modal||!input||!list) return;
  const TAB_LABELS={dashboard:'📊 Dashboard',controlroom:'🩺 Quality Control Room',wcgrade:'🏭 Work Center & Grade',defects:'⚠️ Defect Register',weekly:'📈 Monthly / Weekly Trend'};
  function buildCommands(){
    const cmds=[];
    Object.keys(TAB_LABELS).forEach((key,i)=>cmds.push({icon:'→',label:`Go to ${TAB_LABELS[key]}`,hint:String(i+1),run:()=>activateTab(key)}));
    // Exports (Excel / PDF / PPT / CSV) live only in the header's "⬇ Export" button now
    // Exports open through the dedicated dialog (#exportDialogModal) instead of the Command Palette.
    // Compare mode is desktop-only (its button is hidden on narrow screens), so only offer it when the button is actually shown.
    if(document.getElementById('compareModeBtn')?.offsetParent) cmds.push({icon:'⊞',label:'Compare Periods (side-by-side)',run:()=>document.getElementById('compareModeBtn')?.click()});
    cmds.push({icon:'↺',label:'Reset All Filters',run:()=>document.getElementById('resetAllBtn')?.click()});
    cmds.push({icon:'🔎',label:'Focus Search',hint:'/',run:()=>document.getElementById('globalSearchInput')?.focus()});
    const isDark=currentTheme()==='dark';
    cmds.push({icon:isDark?'☀️':'🌙',label:isDark?'Switch to Light Mode':'Switch to Dark Mode',kw:'theme night day appearance',run:()=>toggleTheme()});
    const isCompact=isCompactDensity();
    cmds.push({icon:'☰',label:isCompact?'Switch to Comfortable Table Rows':'Switch to Compact Table Rows',kw:'compact density rows spacing tight',run:()=>{
      const d=toggleDensity();
      showToast('success',d==='compact'?'Compact table rows on':'Comfortable table rows on', d==='compact'?'More rows fit on screen. Change it any time from Ctrl+K.':'Tables use the roomier row spacing again.');
    }});
    const soundOn=!window.SFX||SFX.isEnabled();
    cmds.push({icon:soundOn?'🔈':'🔊',label:soundOn?'Mute Sound Effects':'Unmute Sound Effects',kw:'sound volume audio speaker sfx mute unmute',run:()=>{
      const on=toggleSound();
      if(on!==null) showToast('success',on?'Sound effects on':'Sound effects muted', on?'Click and confirmation sounds are back.':'The dashboard is silent now. Unmute any time from Ctrl+K.');
    }});
    const hintsOn=fieldHintsOn();
    cmds.push({icon:'🏷️',label:hintsOn?'Turn Off Field Name Hints (hover tag)':'Turn On Field Name Hints (hover tag)',kw:'field name hover tooltip tag hint cursor',run:()=>{
      const on=toggleFieldHints();
      showToast('success',on?'Field name hints on':'Field name hints off', on?'A small tag now names the field under your cursor.':'The hover tag is hidden. Turn it back on from Ctrl+K.');
    }});
    cmds.push({icon:'🔐',label:'Open Admin Panel',kw:'admin settings users login manage',run:()=>window.location.href='/admin'});
    const curTab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    cmds.push({icon:'📌',label:`Set "${TAB_LABELS[curTab]||curTab}" as my Default Landing Tab`,run:()=>setDefaultLandingTab(curTab)});
    ACCENT_PRESETS.forEach(a=>cmds.push({icon:'🎨',label:`Accent Color — ${a.name}`,run:()=>{applyAccent(a.value);showToast('success','Accent color updated',a.name+' applied.');}}));
    return cmds;
  }
  let active=0, filtered=[];
  function render(query){
    const all=buildCommands();
    const q=query.trim().toLowerCase();
    filtered = q ? all.filter(c=>(c.label+' '+(c.kw||'')).toLowerCase().includes(q)) : all;
    active=0;
    if(!filtered.length){ list.innerHTML='<div class="cmdk-empty">No matching command.</div>'; return; }
    list.innerHTML=filtered.map((c,i)=>`<div class="cmdk-item${i===0?' active':''}" data-idx="${i}"><span class="cmdk-icon">${c.icon}</span><span class="cmdk-label">${escQcr(c.label)}</span>${c.hint?`<span class="cmdk-hint">${c.hint}</span>`:''}</div>`).join('');
  }
  function setActive(i){
    const items=[...list.querySelectorAll('.cmdk-item')]; if(!items.length) return;
    active=(i+items.length)%items.length;
    items.forEach((el,j)=>el.classList.toggle('active',j===active));
    items[active].scrollIntoView({block:'nearest'});
  }
  function run(i){ const c=filtered[i]; if(!c) return; close(); c.run(); if(window.SFX) SFX.play('confirm'); }
  function open(){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); input.value=''; render(''); input.focus(); }
  function close(){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
  // Show the shortcut in the right dialect for the platform (⌘K on Apple devices, Ctrl K elsewhere).
  const kbdHint=document.getElementById('cmdkKbd');
  if(kbdHint && /Mac|iPhone|iPad/i.test(navigator.platform||navigator.userAgent||'')) kbdHint.textContent='⌘K';
  window.openCommandPalette = open;
  window.closeCommandPalette = close;
  window.isCommandPaletteOpen = ()=>modal.classList.contains('open');
  document.getElementById('cmdkOpenBtn')?.addEventListener('click', open);
  input.addEventListener('input',()=>render(input.value));
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); setActive(active+1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); setActive(active-1); }
    else if(e.key==='Enter'){ e.preventDefault(); run(active); }
    else if(e.key==='Escape'){ e.preventDefault(); close(); }
  });
  list.addEventListener('mousemove',e=>{ const it=e.target.closest('.cmdk-item'); if(it) setActive(Number(it.dataset.idx)); });
  list.addEventListener('click',e=>{ const it=e.target.closest('.cmdk-item'); if(it) run(Number(it.dataset.idx)); });
  modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
}

let refreshController = null;

// ---- Keyboard shortcuts (desktop power-user efficiency) ----
// Disabled while typing anywhere (input/textarea/select/contenteditable) so
// normal typing — including inside the filter search boxes — is never
// hijacked; and Ctrl/Cmd/Alt combos other than the ones listed are left
// alone so browser/OS shortcuts keep working normally.
(function initKeyboardShortcuts(){
  const TAB_ORDER = ['dashboard','controlroom','wcgrade','defects','weekly'];
  document.addEventListener('keydown', (e)=>{
    const ae=document.activeElement, tag=(ae&&ae.tagName||'').toLowerCase();
    const typing = tag==='input' || tag==='textarea' || tag==='select' || (ae&&ae.isContentEditable);
    if((e.key==='k'||e.key==='K') && (e.ctrlKey||e.metaKey)){
      // Pressing it again while the palette is open closes it (it used to reopen and wipe the query).
      if(window.isCommandPaletteOpen && window.isCommandPaletteOpen()){
        e.preventDefault();
        window.closeCommandPalette && window.closeCommandPalette();
        return;
      }
      // Never hijack the key while the user is typing in a field (search box, filter search,
      // saved-view name, ...). The toolbar ⌘K button still opens the palette from anywhere.
      if(typing) return;
      e.preventDefault();
      window.openCommandPalette && window.openCommandPalette();
      return;
    }
    if(e.key==='/' && !typing){
      e.preventDefault();
      document.getElementById('globalSearchInput')?.focus();
      return;
    }
    if(!typing && (e.key==='e'||e.key==='E') && (e.ctrlKey||e.metaKey)){
      // Ctrl+E used to trigger an Excel export directly; that shortcut was removed once the
      // header's visible "⬇ Export" button was added, so anyone still reaching for the old
      // muscle-memory shortcut gets pointed at its replacement instead of the key doing nothing
      // (or the browser's own Ctrl+E doing something unexpected). Shown once per browser via
      // localStorage so it doesn't nag on every accidental press.
      let seen=true; try{ seen=localStorage.getItem('qdash_seen_ctrle_moved')==='1'; }catch(err){}
      if(!seen){
        e.preventDefault();
        showToast('info','Export moved','Ctrl+E no longer exports — use the ⬇ Export button in the header instead.');
        try{ localStorage.setItem('qdash_seen_ctrle_moved','1'); }catch(err){}
      }
      return;
    }
    if(!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-5]$/.test(e.key)){
      const tabName = TAB_ORDER[Number(e.key)-1];
      const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if(btn){ e.preventDefault(); activateTab(tabName); }
      return;
    }
    if(!typing && e.key==='?'){
      e.preventDefault();
      showToast('info','Keyboard shortcuts','Ctrl+K command palette · / search · 1-5 switch tabs · Esc close');
    }
  });
})();

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

// ---- Report exports (Excel / PDF / PPT / raw CSV) ----
// Triggered from the header's "⬇ Export" button via the export dialog.
// Progress is shown as a toast, since large reports can take a while.
const EXPORT_LABELS={excel:'Excel report',pdf:'PDF report',pptx:'PowerPoint report',csv:'Raw data (CSV)'};
const _exportBusy={};
function exportDashboard(format){
  const label=EXPORT_LABELS[format]||format;
  if(_exportBusy[format]){ showToast('info',label+' is already being generated','Please wait — the download starts automatically.'); return; }
  _exportBusy[format]=true;
  const params=new URLSearchParams(currentFilters).toString();
  const url=`/api/export/${format}?${params}`;
  const endProgress=showToast('info','Generating '+label+'…','Large reports can take up to a minute. The download starts automatically.',{duration:300000});
  fetch(url,{cache:'no-store'}).then(res=>{
    if(!res.ok) return res.json().catch(()=>null).then(j=>{ throw new Error((j&&j.error)?j.error:('Export failed (HTTP '+res.status+').')); });
    const cd=res.headers.get('Content-Disposition')||'';
    const m=/filename="?([^";]+)"?/i.exec(cd);
    const filename=m?m[1]:(`export.${format==='pptx'?'pptx':format}`);
    return res.blob().then(blob=>({blob,filename}));
  }).then(({blob,filename})=>{
    const dlUrl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=dlUrl; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(dlUrl),4000);
    endProgress();
    showToast('success','Export ready',filename+' has finished downloading.');
    if(window.SFX) SFX.play('success');
  }).catch(e=>{
    endProgress();
    showToast('error','Export failed',String(e.message||e));
    if(window.SFX) SFX.play('error');
  }).finally(()=>{ _exportBusy[format]=false; });
}

async function loadFilters(){
  const res = await fetch("/api/filters");
  const options = await res.json();
  window._filterOptionsCache = options;
  const container = document.getElementById("filters");
  container.innerHTML = `<div class="filter-toolbar"><div class="filter-toolbar-title">${qdIc('filter')}Dashboard Filters</div><div class="filter-actions"><span id="activeFilterBadge" class="active-filter-badge">0 Active</span><button id="compareModeBtn" class="reset-all" type="button">${qdIc('compare')}Compare Periods</button><button id="resetAllBtn" class="reset-all" type="button">${qdIc('reset')}Reset All</button></div></div>`;
  FILTER_DEFS.forEach(f => {
    const field = document.createElement("div"); field.className = "filter-field"; field.dataset.filterKey = f.key;
    const label = document.createElement("label"); label.textContent = f.label;
    const control = document.createElement("div"); control.className = "filter-control";
    const trigger = document.createElement("button"); trigger.type="button"; trigger.className="filter-trigger";
    const valueSpan = document.createElement("span"); valueSpan.textContent="All";
    trigger.appendChild(valueSpan); trigger.insertAdjacentHTML("beforeend",`<span class='chevron'>${qdIc('chevron-down')}</span>`);
    const menu = document.createElement("div"); menu.className="filter-menu";
    const search = document.createElement("input"); search.className="filter-search"; search.placeholder="Search options…"; search.type="text";
    const list = document.createElement("div"); list.className="filter-options";
    menu.appendChild(search); menu.appendChild(list); control.appendChild(trigger); control.appendChild(menu); field.appendChild(label); field.appendChild(control); container.appendChild(field);
    const raw = options[f.key] || ["All"];
    const items = raw.map(item => ({value:(item&&typeof item==='object')?item.value:item, label:(item&&typeof item==='object')?item.label:item}));
    if(!items.some(x=>x.value==="All")) items.unshift({value:"All",label:"All"});
    field._filterItems = items;
    const renderOptions = (term="") => {
      const q=term.trim().toLowerCase(); list.innerHTML="";
      const source=field._filterItems || items;
      const filtered=source.filter(x=>String(x.label).toLowerCase().includes(q));
      filtered.forEach((x,i)=>{
        const opt=document.createElement("div"); opt.dataset.value=x.value; opt.className="filter-option"+(x.value==="All"?" all-option":"")+(currentFilters[f.key]===x.value?" selected":"");
        opt.textContent=x.label;
        opt.addEventListener("click",()=>{
          currentFilters[f.key]=x.value; valueSpan.textContent=x.label; control.classList.remove("open"); search.value=""; renderOptions(); field.classList.toggle("filter-active", x.value!=="All"); updateActiveFilterBadge(); writeUrlState(false); triggerFilterRefresh();
        }); list.appendChild(opt);
      });
      if(!filtered.length) list.innerHTML='<div class="filter-empty">No matching options</div>';
    };
    field._filterRenderOptions = renderOptions;
    trigger.addEventListener("click",()=>{document.querySelectorAll('.filter-control.open').forEach(c=>{if(c!==control)c.classList.remove('open')}); control.classList.toggle('open'); if(control.classList.contains('open')){search.focus();renderOptions(search.value);}});
    search.addEventListener("input",()=>renderOptions(search.value));
    renderOptions();
    field.classList.toggle("filter-active", currentFilters[f.key]!=="All");
  });
  document.getElementById("resetAllBtn").addEventListener("click",()=>{FILTER_DEFS.forEach(f=>currentFilters[f.key]="All"); document.querySelectorAll('.filter-control').forEach(c=>{c.classList.remove('open'); const s=c.querySelector('.filter-trigger span'); if(s)s.textContent='All';}); document.querySelectorAll('.filter-field').forEach(f=>f.classList.remove('filter-active')); updateActiveFilterBadge(); writeUrlState(false); triggerFilterRefresh();});
  document.addEventListener("click", e=>{if(!e.target.closest('.filter-control')) document.querySelectorAll('.filter-control.open').forEach(c=>c.classList.remove('open'));});
  updateActiveFilterBadge();
}
function updateActiveFilterBadge(){
  const n=FILTER_DEFS.filter(f=>currentFilters[f.key] && currentFilters[f.key]!=="All").length;
  const b=document.getElementById('activeFilterBadge'); if(b){ b.textContent=`${n} Active`; b.classList.toggle('show',n>0); }
  const s=document.getElementById('statusActiveFilters'); if(s) s.textContent=String(n);
}

let _dataRevision = null;
let _dataRevisionTimer = null;
let _dataRevisionChecking = false;

async function fetchDataRevision(){
  const res = await fetch('/api/data_revision',{cache:'no-store'});
  if(!res.ok) throw new Error(`Revision check failed (HTTP ${res.status}).`);
  return res.json();
}

function _normaliseFilterItems(raw){
  const items=(raw||['All']).map(item => ({
    value:(item&&typeof item==='object')?String(item.value):String(item),
    label:(item&&typeof item==='object')?String(item.label):String(item)
  }));
  if(!items.some(x=>x.value==='All')) items.unshift({value:'All',label:'All'});
  return items;
}

async function refreshFilterOptionsAfterDataChange(){
  const res=await fetch('/api/filters',{cache:'no-store'});
  if(!res.ok) throw new Error(`Filter refresh failed (HTTP ${res.status}).`);
  const options=await res.json();
  window._filterOptionsCache=options;
  let selectionChanged=false;

  FILTER_DEFS.forEach(f=>{
    const items=_normaliseFilterItems(options[f.key]);
    const valid=new Set(items.map(x=>x.value));
    if(currentFilters[f.key]!=="All" && !valid.has(String(currentFilters[f.key]))){
      currentFilters[f.key]="All";
      selectionChanged=true;
    }
    const field=document.querySelector(`.filter-field[data-filter-key="${f.key}"]`);
    if(!field) return;
    field._filterItems=items;
    const search=field.querySelector('.filter-search');
    if(typeof field._filterRenderOptions==='function') field._filterRenderOptions(search?search.value:'');
    const span=field.querySelector('.filter-trigger span');
    const selected=items.find(x=>x.value===String(currentFilters[f.key]||'All')) || items[0] || {label:'All'};
    if(span) span.textContent=selected.label;
    field.classList.toggle('filter-active', currentFilters[f.key]!=="All");
  });

  updateActiveFilterBadge();
  if(selectionChanged) writeUrlState(false);
  window.dispatchEvent(new CustomEvent('qdash:data-revision-changed'));
  return selectionChanged;
}

async function checkDataRevision(){
  if(_dataRevisionChecking) return;
  _dataRevisionChecking=true;
  try{
    const state=await fetchDataRevision();
    if(state && state.available===false) return;
    const revision=Number(state?.revision);
    if(!Number.isFinite(revision)) return;
    if(_dataRevision===null){
      _dataRevision=revision;
      return;
    }
    if(revision===_dataRevision) return;
    const previous=_dataRevision;
    _dataRevision=revision;
    try{
      await refreshFilterOptionsAfterDataChange();
      showToast('info','Data updated','New or changed records are now reflected in this dashboard.');
      await triggerFilterRefresh();
    }catch(err){
      console.warn('Live data refresh failed',err);
      // Roll back only the observed marker so the next poll retries the refresh.
      _dataRevision=previous;
    }
  }catch(e){
    // Background freshness is best-effort; never surface polling noise to users.
  }finally{
    _dataRevisionChecking=false;
  }
}

async function startDataRevisionPolling(){
  if(_dataRevisionTimer) clearInterval(_dataRevisionTimer);
  try{
    const state=await fetchDataRevision();
    const revision=Number(state?.revision);
    if(Number.isFinite(revision)) _dataRevision=revision;
  }catch(e){}
  _dataRevisionTimer=setInterval(()=>{
    if(document.visibilityState==='visible') checkDataRevision();
  },30000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible') checkDataRevision();
  });
}

async function triggerFilterRefresh(){
  // Cancel an older in-flight dashboard request when filters are changed again.
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  const activeBtn=document.querySelector('.tab-btn.active'); const activeTab=activeBtn?activeBtn.dataset.tab:'dashboard';
  const page=document.querySelector('.container'); if(page) page.classList.add('dashboard-refreshing');
  document.querySelectorAll('.kpi-card').forEach(c=>c.classList.add('shimmering'));
  document.querySelectorAll('.chart-scroll').forEach(c=>c.classList.add('chart-refreshing'));
  document.querySelector('.filters')?.classList.add('filter-pulse');
  const t0=performance.now();
  try{await TAB_LOADERS[activeTab](signal); if(activeTab==='dashboard') prefetchQcrCore({...currentFilters}); finishTabLoad(activeTab);}catch(e){finishTabLoad(activeTab,e);}finally{
    const elapsed=performance.now()-t0; const wait=Math.max(0,250-elapsed);
    setTimeout(()=>{document.querySelectorAll('.kpi-card').forEach(c=>c.classList.remove('shimmering')); document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-refreshing');c.classList.add('chart-ready');setTimeout(()=>c.classList.remove('chart-ready'),700)}); if(page)page.classList.remove('dashboard-refreshing');},wait);
  }
}


// Icon shown before each KPI card's name — purely cosmetic, keyed by label.
const KPI_ICONS = {
  "Total Coils": "📦",
  "Defect Coils": "⚠️",
  "First Pass Yield % (Prime%)": "✅",
  "Hold for Decision % Qty": "⏳",
  "Output Quantity (MT)": "🏭",
  "Salvage % Qty": "♻️",
  "Salvage + Divert Qty (MT)": "🔀",
  "Defect Rate": "🔻",
  "Reject % Qty": "🚫",
  "Hold For Decision Qty (MT)": "🕒",
  "Reject Qty (MT)": "❌",
  "Rework % Qty": "🔧",
};

let KPI_TARGETS={};
let qcrAnimationToken=0;
function fmtTarget(v,fmt){
  if(v===null||v===undefined||v==='') return '—';
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(fmt==='pct') return (n*100).toFixed(1)+'%';
  if(fmt==='int') return Math.round(n).toLocaleString();
  if(fmt==='num3') return n.toFixed(2);
  return n.toFixed(2);
}
function kpiTargetData(label){return KPI_TARGETS[label]||null;}
function kpiTargetMarkup(label,fmt){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return '<div class="kpi-target-none">No Target Setting</div>';
  const dir=(c.direction||'higher').toLowerCase();
  const low=dir==='lower'?c.target:c.critical;
  const mid=c.warning;
  const high=dir==='lower'?c.critical:c.target;
  const lowClass=dir==='lower'?'target-good':'target-bad';
  const highClass=dir==='lower'?'target-bad':'target-good';
  return `<div class="kpi-targets"><div class="kpi-target-item ${lowClass}"><span>LOW</span><b>${fmtTarget(low,fmt)}</b></div><div class="kpi-target-item target-amber"><span>MID</span><b>${fmtTarget(mid,fmt)}</b></div><div class="kpi-target-item ${highClass}"><span>HIGH</span><b>${fmtTarget(high,fmt)}</b></div></div><div class="kpi-target"><span>${dir==='higher'?'↑ Higher is better':dir==='lower'?'↓ Lower is better':'Neutral'}</span></div>`;
}
function kpiStatus(label,k){
  const c=kpiTargetData(label);
  if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(k.value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  if(d==='higher') return v>=t?'good':v>=w?'amber':'bad';
  return 'neutral';
}
function sparklineSvg(oldValue,currentValue,status){
  const a=Number.isFinite(oldValue)?oldValue:Number(currentValue); const b=Number(currentValue)||0; const pts=[]; for(let i=0;i<6;i++){const t=i/5; const v=a+(b-a)*t; pts.push(v)}
  let min=Math.min(...pts),max=Math.max(...pts); if(min===max){min-=1;max+=1;} const points=pts.map((v,i)=>`${(i*15.2).toFixed(1)},${(24-(v-min)/(max-min)*20).toFixed(1)}`).join(' ');
  const stroke=status==='good'?'#16a34a':status==='bad'?'#dc2626':status==='amber'?'#d97706':'#118dff';
  return `<svg class="sparkline" viewBox="0 0 76 28" preserveAspectRatio="none"><polyline points="${points}" stroke="${stroke}"/><circle cx="76" cy="${(24-(b-min)/(max-min)*20).toFixed(1)}" r="2.2" fill="${stroke}"/></svg>`;
}
function renderKpis(kpis){
  const grid=document.getElementById('kpiGrid'); const nextValues=new Map(); const nextTrend=new Map(); const token=++kpiAnimationToken; grid.innerHTML='';
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isFirstPaint=!kpiFirstPaintDone;
  kpis.forEach((k,idx)=>{
    const card=document.createElement('div'); const oldValue=previousKpiValues.get(k.label); const cur=Number(k.value)||0; const changed=Number.isFinite(oldValue)&&Math.abs(oldValue-cur)>1e-12; const direction=changed?(cur>oldValue?'up':'down'):''; const status=kpiStatus(k.label,k);
    card.className=`kpi-card status-${status} kpi-pulse`; if(direction)card.classList.add(direction==='up'?'kpi-up':'kpi-down');
    // Stagger each card's entrance/refresh animation so a full-grid refresh reads as a
    // gentle left-to-right ripple instead of every card flashing in lockstep.
    const staggerMs=reduceMotion?0:Math.min(idx,7)*65;
    if(staggerMs) card.style.setProperty('--kpi-stagger',`${staggerMs}ms`);
    let trendHtml=''; let trendMeta=null;
    if(k.arrow!==null && k.arrow!==undefined){
      const arrowChar=k.arrow==='up'?'▲':k.arrow==='down'?'▼':'▬';
      const changeType=k.change_type;
      let changeInner='';
      if(changeType==='pts'||changeType==='pct'){
        const unit=changeType==='pts'?' pts':'%';
        changeInner=`<span class="kpi-change-val">${k.change_value>=0?'+':''}${(k.change_value*100).toFixed(3)}${unit}</span>`;
      } else if(changeType==='new'){ changeInner='New'; }
      else { changeInner='No change'; }
      let deltaInner=''; let deltaKind=null, deltaRaw=null; const absUnit=k.fmt==='int'?'coils':(k.fmt==='num2'?'MT':'');
      if(k.change_value_pp!==null && k.change_value_pp!==undefined){
        deltaKind='pp'; deltaRaw=Number(k.change_value_pp); const ppVal=deltaRaw*100;
        deltaInner=` (<span class="kpi-delta-val">${ppVal>=0?'+':''}${ppVal.toFixed(2)} pp</span>)`;
      } else if(k.change_value_abs!==null && k.change_value_abs!==undefined){
        deltaKind='abs'; deltaRaw=Number(k.change_value_abs);
        deltaInner=` (<span class="kpi-delta-val">${deltaRaw>=0?'+':''}${fmtValue(deltaRaw,k.fmt)}${absUnit?' '+absUnit:''}</span>)`;
      }
      const prevRaw=(k.prev!==null && k.prev!==undefined)?Number(k.prev):null;
      const prevInner = prevRaw!==null ? `<span class="kpi-prev-val">${fmtValue(prevRaw,k.fmt)}</span>` : 'N/A';
      trendHtml=`<span class="prev">Prev: ${prevInner}</span><span class="trend ${k.trend_color}">${arrowChar} ${changeInner}${deltaInner}</span>`;
      trendMeta={
        fmt:k.fmt, prevRaw,
        changeType:(changeType==='pts'||changeType==='pct')?changeType:null,
        changeRaw:(changeType==='pts'||changeType==='pct')?Number(k.change_value):null,
        deltaKind, deltaRaw, absUnit
      };
    }
    const statusText=status==='good'?'ON TARGET':status==='amber'?'WATCH':status==='bad'?'ACTION':'REFERENCE';
    const valueColor=(k.label==='Total Coils'||k.label==='Output Quantity (MT)')?'#2388C9':(k.color||'#16324F');
    const targetCfg=KPI_TARGETS[k.label]||null;
    const directionText=targetCfg ? ((targetCfg.direction||'higher').toLowerCase()==='lower'?'Lower is better':'Higher is better') : 'Reference KPI';
    const targetText=targetCfg ? fmtValue(targetCfg.target,k.fmt) : 'Not set';
    const prevText=(k.prev!==null && k.prev!==undefined) ? fmtValue(k.prev,k.fmt) : 'N/A';
    card.innerHTML=`<div class="kpi-top"><div class="label"><span class="kpi-icon">${KPI_ICONS[k.label]||'📊'}</span>${escQcr(k.label)}</div><span class="kpi-status ${status}">${statusText}</span></div><div class="value" data-target="${cur}" style="color:${valueColor}">${fmtValue(cur,k.fmt)}</div><div class="kpi-bottom"><div class="kpi-meta">${kpiTargetMarkup(k.label,k.fmt)}<div class="kpi-trendline">${trendHtml}</div></div>${sparklineSvg(oldValue,cur,status)}</div>`;
    card.setAttribute('role','button'); card.setAttribute('tabindex','0'); card.setAttribute('aria-label',`Drill down into ${k.label}`); card.addEventListener('click',()=>openDrilldown(k.label,`${k.label} — Underlying Records`)); card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrilldown(k.label,`${k.label} — Underlying Records`);}}); grid.appendChild(card); const valueEl=card.querySelector('.value');
    if(_kpiTiltEnabled) attachKpiTilt(card);
    if(changed&&!reduceMotion){ if(staggerMs) setTimeout(()=>{ if(token===kpiAnimationToken) animateKpiValue(valueEl,oldValue,cur,k.fmt,token); },staggerMs); else animateKpiValue(valueEl,oldValue,cur,k.fmt,token); }
    else if(isFirstPaint&&!reduceMotion){ if(staggerMs) setTimeout(()=>{ if(token===kpiAnimationToken) animateKpiValue(valueEl,0,cur,k.fmt,token); },staggerMs); else animateKpiValue(valueEl,0,cur,k.fmt,token); }
    // Prev value / % trend / delta (pp or MT/coils) count up in step with the
    // headline value, instead of just snapping to their new text.
    if(trendMeta && !reduceMotion && (changed||isFirstPaint)){
      const oldTrend=previousKpiTrend.get(k.label);
      const runTrendAnim=()=>{
        if(token!==kpiAnimationToken) return;
        const prevEl=card.querySelector('.kpi-prev-val');
        if(prevEl && trendMeta.prevRaw!==null){
          const fromPrev=(oldTrend&&oldTrend.prevRaw!==null&&oldTrend.prevRaw!==undefined)?oldTrend.prevRaw:(isFirstPaint?0:trendMeta.prevRaw);
          if(fromPrev!==trendMeta.prevRaw) animateNumericSpan(prevEl,fromPrev,trendMeta.prevRaw,v=>fmtValue(v,trendMeta.fmt),token);
        }
        const changeEl=card.querySelector('.kpi-change-val');
        if(changeEl && trendMeta.changeType){
          const sameType=oldTrend&&oldTrend.changeType===trendMeta.changeType;
          const fromChange=sameType?oldTrend.changeRaw:(isFirstPaint?0:trendMeta.changeRaw);
          if(fromChange!==trendMeta.changeRaw){
            const unit=trendMeta.changeType==='pts'?' pts':'%';
            animateNumericSpan(changeEl,fromChange,trendMeta.changeRaw,v=>`${v>=0?'+':''}${(v*100).toFixed(3)}${unit}`,token);
          }
        }
        const deltaEl=card.querySelector('.kpi-delta-val');
        if(deltaEl && trendMeta.deltaKind){
          const sameKind=oldTrend&&oldTrend.deltaKind===trendMeta.deltaKind;
          const fromDelta=sameKind?oldTrend.deltaRaw:(isFirstPaint?0:trendMeta.deltaRaw);
          if(fromDelta!==trendMeta.deltaRaw){
            if(trendMeta.deltaKind==='pp') animateNumericSpan(deltaEl,fromDelta,trendMeta.deltaRaw,v=>`${(v*100)>=0?'+':''}${(v*100).toFixed(2)} pp`,token);
            else animateNumericSpan(deltaEl,fromDelta,trendMeta.deltaRaw,v=>`${v>=0?'+':''}${fmtValue(v,trendMeta.fmt)}${trendMeta.absUnit?' '+trendMeta.absUnit:''}`,token);
          }
        }
      };
      if(staggerMs) setTimeout(runTrendAnim,staggerMs); else runTrendAnim();
    }
    nextValues.set(k.label,cur); nextTrend.set(k.label,trendMeta);
  }); previousKpiValues=nextValues; previousKpiTrend=nextTrend; kpiFirstPaintDone=true;
}
async function loadKpiTargets(){try{const d=await fetch('/api/kpi_targets',{cache:'no-store'}).then(r=>r.json());KPI_TARGETS=d.targets||{};}catch(e){KPI_TARGETS={};}}

function animateKpiValue(el, from, to, fmt, token){
  const start = performance.now();
  const duration = 620;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    if(token !== kpiAnimationToken) return;
    const p = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * ease(p);
    el.textContent = fmtValue(v, fmt);
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = fmtValue(to, fmt);
  };
  requestAnimationFrame(step);
}
// Same count-up used for the headline KPI value, generalized with a custom
// formatter so the Prev/% trend/delta (pp or MT/coils) numbers underneath
// can count up too instead of just snapping to their new text.
function animateNumericSpan(el, from, to, formatFn, token){
  const start = performance.now();
  const duration = 620;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    if(token !== kpiAnimationToken) return;
    const p = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * ease(p);
    el.textContent = formatFn(v);
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = formatFn(to);
  };
  requestAnimationFrame(step);
}

function renderPeriodBanner(period){
  const el = document.getElementById("periodBanner");
  if(!period){ el.textContent = ""; return; }
  const cur = period.current || "All Periods";
  const prev = period.previous;
  el.innerHTML = prev
    ? `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; ⏮️ <b>Compared to:</b> ${escQcr(prev)}`
    : `📅 <b>Current Period:</b> ${escQcr(cur)} &nbsp;&nbsp;|&nbsp;&nbsp; <i>Select a single Month/Week/Quarter/FY filter to see period-over-period comparison</i>`;
}

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
  const t=text.trim().replace(/[,%]/g,'');
  const n=parseFloat(t);
  return (t!=='' && !isNaN(n) && /^-?[\d.]+$/.test(t)) ? n : null;
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


function activeFilterSummary(){
  const parts=[];
  const labels={month:'Month',work_center:'Work Center',grade:'Grade',quality_decision:'Quality Decision',week:'Week',quarter:'Quarter',financial_year:'Financial Year',defect_intensity:'Defect Intensity'};
  Object.keys(currentFilters).forEach(k=>{const v=currentFilters[k]; if(v && v!=='All') parts.push(`${labels[k]||k}: ${v}`);});
  return parts.length?parts.join(' | '):'All Data';
}
function refreshFilterSummary(recordCount){
  const el=document.getElementById('filterSummaryText'); if(el)el.textContent=activeFilterSummary();
  const c=document.getElementById('filterRecordCount'); if(c)c.textContent=(recordCount===undefined?'--':Number(recordCount).toLocaleString())+' coils';
  renderSavedViews();
}
function savedViews(){try{return JSON.parse(localStorage.getItem('qdash_saved_views')||'{}')}catch(e){return {}}}
function renderSavedViews(){const sel=document.getElementById('savedViewSelect'); if(!sel)return; const views=savedViews(); sel.innerHTML='<option value="">Saved Views</option>'+Object.keys(views).sort().map(n=>`<option value="${escQcr(n)}">${escQcr(n)}</option>`).join('');}
function saveCurrentView(){
  // Replaces the old window.prompt() flow with an inline, named-preset
  // popover: type a name, hit Save — no browser dialog.
  const pop=document.getElementById('viewPopover'); if(!pop) return;
  pop.innerHTML=`<div class="view-pop-title">${qdIc('bookmark-plus')}Save current filters as…</div><input type="text" id="viewPopSaveName" maxlength="60" placeholder="e.g. This Month + Work Center A + PRIME"><div class="view-pop-actions"><button class="btn" id="viewPopCancelBtn" type="button">Cancel</button><button class="btn primary" id="viewPopSaveBtn" type="button">${qdIc('bookmark-plus')}Save Preset</button></div>`;
  pop.classList.remove('hidden');
  const input=document.getElementById('viewPopSaveName'); input.focus();
  function doSave(){
    const name=input.value.trim(); if(!name) { input.focus(); return; }
    const views=savedViews(); views[name]=Object.assign({},currentFilters);
    try{ localStorage.setItem('qdash_saved_views',JSON.stringify(views)); }catch(e){}
    renderSavedViews(); document.getElementById('savedViewSelect').value=name; closeViewPopover();
  }
  document.getElementById('viewPopSaveBtn').onclick=doSave;
  document.getElementById('viewPopCancelBtn').onclick=closeViewPopover;
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doSave(); } else if(e.key==='Escape'){ closeViewPopover(); } });
}
function closeViewPopover(){ document.getElementById('viewPopover')?.classList.add('hidden'); }
function renderManagePresetsList(){
  const pop=document.getElementById('viewPopover'); if(!pop) return;
  const views=savedViews(); const names=Object.keys(views).sort();
  const listHtml = names.length
    ? `<div class="view-pop-list">${names.map(n=>`<div class="view-pop-row" data-name="${escQcr(n)}"><span class="view-pop-name">${escQcr(n)}</span><button class="view-pop-load" type="button" title="Load this preset">Load</button><button class="view-pop-del" type="button" title="Delete this preset">🗑</button></div>`).join('')}</div>`
    : `<div class="view-pop-empty">No saved presets yet — use “Save Preset” to name your current filter combination.</div>`;
  pop.innerHTML=`<div class="view-pop-title">${qdIc('list-edit')}Saved filter presets</div>${listHtml}<div class="view-pop-actions"><button class="btn" id="viewPopCloseBtn" type="button">Close</button></div>`;
  pop.classList.remove('hidden');
  pop.querySelectorAll('.view-pop-load').forEach(b=>b.addEventListener('click',e=>{
    const name=e.target.closest('.view-pop-row').dataset.name;
    applySavedView(name); const sel=document.getElementById('savedViewSelect'); if(sel) sel.value=name;
    closeViewPopover();
  }));
  pop.querySelectorAll('.view-pop-del').forEach(b=>b.addEventListener('click',e=>{
    const row=e.target.closest('.view-pop-row'); const name=row.dataset.name;
    const v=savedViews(); delete v[name];
    try{ localStorage.setItem('qdash_saved_views',JSON.stringify(v)); }catch(err){}
    renderSavedViews(); renderManagePresetsList();
  }));
  document.getElementById('viewPopCloseBtn').onclick=closeViewPopover;
}
function manageSavedViews(){ renderManagePresetsList(); }
document.addEventListener('click',e=>{
  const pop=document.getElementById('viewPopover'); if(!pop || pop.classList.contains('hidden')) return;
  if(pop.contains(e.target) || e.target.closest('#saveViewBtn,#clearViewsBtn')) return;
  closeViewPopover();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeViewPopover(); });
// ---- URL state: the current tab and every non-"All" filter are reflected
// in the address bar (?tab=...&work_center=...), so the browser's own
// back/forward buttons work between tabs/filter changes, and a person can
// bookmark or paste a link to a colleague that opens straight into the
// exact view they were looking at. Filter tweaks use replaceState (one
// URL update, no extra back-button stop per click); switching tabs uses
// pushState (each tab is a distinct "page" worth a back-button stop).
const TAB_KEYS=['dashboard','controlroom','wcgrade','defects','weekly'];
function readUrlState(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('tab');
  const filters={};
  FILTER_DEFS.forEach(f=>{ const v=params.get(f.key); if(v) filters[f.key]=v; });
  return { tab: TAB_KEYS.includes(tab)?tab:null, filters };
}
function writeUrlState(push){
  const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
  const params=new URLSearchParams();
  if(tab!=='dashboard') params.set('tab',tab);
  FILTER_DEFS.forEach(f=>{ if(currentFilters[f.key] && currentFilters[f.key]!=='All') params.set(f.key,currentFilters[f.key]); });
  const qs=params.toString(), url=location.pathname+(qs?('?'+qs):'');
  const state={tab,filters:Object.assign({},currentFilters)};
  if(push) history.pushState(state,'',url); else history.replaceState(state,'',url);
}
// Syncs the filter dropdown UI (trigger label text + the "active" pill
// styling) to whatever is currently in currentFilters. Used whenever
// currentFilters is changed from somewhere other than a direct dropdown
// click — restoring from the URL on load, the back/forward buttons, and
// applying a saved view all funnel through here instead of duplicating
// this DOM-sync logic three times.
function syncFilterUiFromState(){
  document.querySelectorAll('.filter-field').forEach(field=>{
    const key=field.dataset.filterKey, val=currentFilters[key]||'All';
    const span=field.querySelector('.filter-trigger span');
    if(span){ const opts=[...field.querySelectorAll('.filter-option')]; const match=opts.find(o=>o.dataset.value===val); span.textContent=match?match.textContent:val; }
    field.classList.toggle('filter-active', val!=='All');
  });
  updateActiveFilterBadge();
}
function applySavedView(name){const views=savedViews(); if(!name||!views[name])return; Object.assign(currentFilters,views[name]); syncFilterUiFromState(); writeUrlState(false); triggerFilterRefresh();}
function drilldownFiltersQuery(extra={}){const p=new URLSearchParams(currentFilters); Object.keys(extra).forEach(k=>p.set(k,extra[k])); return p.toString();}
let drillStack=[];
let _presentationDrillState=null;
function currentDrill(){return drillStack[drillStack.length-1]||{metric:'',title:'',extra:{},page:1};}

function elevateDrillModalForPresentation(){
  const modal=document.getElementById('drillModal');
  if(!modal || !_analyticsPresentationState || modal.parentNode===document.body || _presentationDrillState) return;
  const placeholder=document.createComment('qdash-presentation-drill-placeholder');
  modal.parentNode.insertBefore(placeholder,modal);
  document.body.appendChild(modal);
  _presentationDrillState={modal,placeholder};
}

function restoreDrillModalAfterPresentation(){
  const state=_presentationDrillState;
  if(!state) return;
  try{
    state.placeholder.parentNode?.insertBefore(state.modal,state.placeholder);
    state.placeholder.remove();
  }catch(e){}
  _presentationDrillState=null;
}
function renderDrillBreadcrumb(){
  const nav=document.getElementById('drillBreadcrumb'); if(!nav)return;
  if(drillStack.length<2){nav.innerHTML='';nav.style.display='none';return;}
  nav.style.display='flex';
  nav.innerHTML=drillStack.map((lvl,i)=>{
    const isLast=i===drillStack.length-1;
    const label=escQcr(lvl.crumb||lvl.title||'Level '+(i+1));
    return (i>0?'<span class="drill-breadcrumb-sep" aria-hidden="true">›</span>':'')+
      (isLast
        ? `<span class="drill-breadcrumb-crumb current" aria-current="page">${label}</span>`
        : `<button type="button" class="drill-breadcrumb-crumb" data-drill-level="${i}">${label}</button>`);
  }).join('');
}
function goToDrillLevel(i){
  if(i<0||i>=drillStack.length)return;
  drillStack=drillStack.slice(0,i+1);
  renderDrillBreadcrumb();
  renderDrillPage(currentDrill().page||1);
}
function renderDrillPage(page=1){
  const {metric,title,extra}=currentDrill(), modal=document.getElementById('drillModal'), content=document.getElementById('drillContent'); if(!modal||!content)return;
  currentDrill().page=page; { const dt=document.getElementById('drillTitle'); const dtt=dt&&dt.querySelector('.drill-title-text'); (dtt||dt).textContent=title||'Underlying Records'; } document.getElementById('drillSubtitle').textContent=activeFilterSummary();
  content.innerHTML='<div class="drill-empty">Loading underlying records…</div>'; document.getElementById('drillCount').textContent='Loading…';
  const qs=drilldownFiltersQuery(Object.assign({metric,page,page_size:250},extra)); document.getElementById('drillExportBtn').href='/api/drilldown/export?'+drilldownFiltersQuery(Object.assign({metric},extra));
  fetch('/api/drilldown?'+qs,{cache:'no-store'}).then(r=>r.json()).then(data=>{
    if(data.error)throw new Error(data.error); document.getElementById('drillCount').textContent=Number(data.count||0).toLocaleString()+' coils'; document.getElementById('drillScope').textContent=(data.scope||'')+' • '+Number(data.row_count||data.rows?.length||0).toLocaleString()+' records';
    if(!data.rows||!data.rows.length){content.innerHTML='<div class="drill-empty">'+emptyStateMarkup('No underlying records found for this KPI/selection.','Try a wider date range or clear a filter.')+'</div>';return;}
    const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const fmtDate=v=>{const s=String(v||''); if(/^\d{4}-\d{2}-\d{2}/.test(s)){const [y,m,d]=s.slice(0,10).split('-'); return `${d}-${m}-${y}`;} return s;};
    const heads=['Date','Heat No','Batch No','Work Center','Grade','Main Defect','Defect Intensity','Decision','Weight (MT)'];
    let html='<div class="table-scroll"><table class="drill-table"><thead><tr>'+heads.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>';
    data.rows.forEach(r=>{const heat=esc(r.heat_no); html+=`<tr><td>${esc(fmtDate(r.insp_lot_date))}</td><td><button class="heat-detail-btn" type="button" data-heat="${heat}">${heat||'—'}</button></td><td>${esc(r.batch_no||r.coil_lot)}</td><td>${esc(r.work_center)}</td><td>${esc(r.grade)}</td><td>${esc(r.main_defect)}</td><td>${esc(r.defect_intensity||'—')}</td><td>${esc(r.quality_decision)}</td><td>${Number(r.output_weight||0).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3})}</td></tr>`});
    html+=`</tbody><tfoot><tr class="grand-total-row"><td colspan="2">Grand Total — ${Number(data.count||0).toLocaleString()} coils</td><td></td><td></td><td></td><td></td><td></td><td>Records: ${Number(data.row_count||0).toLocaleString()}</td><td>${Number(data.total_weight||0).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3})}</td></tr></tfoot></table></div>`;
    if(Number(data.total_pages||1)>1) html+=`<div class="drill-pagination"><button type="button" data-drill-page="${Math.max(1,Number(data.page||1)-1)}" ${Number(data.page||1)<=1?'disabled':''}>‹ Previous</button><span>Page ${Number(data.page||1)} of ${Number(data.total_pages||1)}</span><button type="button" data-drill-page="${Math.min(Number(data.total_pages||1),Number(data.page||1)+1)}" ${Number(data.page||1)>=Number(data.total_pages||1)?'disabled':''}>Next ›</button></div>`;
    content.innerHTML=html;
  }).catch(e=>{content.innerHTML='<div class="drill-empty">'+emptyStateMarkup('Unable to load records.',String(e.message||e))+'</div>';document.getElementById('drillCount').textContent='Error';});
}
// Opens a fresh drill-down as the FIRST level (e.g. clicking a defect bar on
// a chart) — resets any previous breadcrumb trail, since this is a new,
// unrelated drill starting over from the top.
function openDrilldown(metric,title,extra={},crumb){ drillStack=[{metric,title,extra,page:1,crumb:crumb||title}]; const modal=document.getElementById('drillModal'); if(!modal)return; elevateDrillModalForPresentation(); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('drill-modal-open'); renderDrillBreadcrumb(); renderDrillPage(1); }
// Pushes ONE LEVEL DEEPER onto the existing trail (e.g. clicking a Heat No.
// inside an already-open drill-down) — so "Defect: X" > "Heat H12345" both
// stay visible and clickable in the breadcrumb, instead of the first level
// being silently replaced and losing its context.
function pushDrilldown(metric,title,extra={},crumb){ drillStack.push({metric,title,extra,page:1,crumb:crumb||title}); renderDrillBreadcrumb(); renderDrillPage(1); }

function closeDrilldown(){const m=document.getElementById('drillModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');} document.body.classList.remove('drill-modal-open'); drillStack=[]; const d=document.getElementById('drillDialog'); if(d){d.style.cssText='';} restoreDrillModalAfterPresentation(); /* reset any drag/resize back to default centered size for next open */}
qcrWireProblemActions();
// Desktop convenience: the drill-down modal can be dragged by its header
// and resized from its bottom-right corner, like a real window, instead of
// being a fixed-size overlay. Pure pointer-event math — no library.
function wireDrillDialogDragResize(){
  const dialog=document.getElementById('drillDialog'), head=document.getElementById('drillHead'), handle=document.getElementById('drillResizeHandle');
  if(!dialog||!head||!handle) return;
  let mode=null, startX=0, startY=0, startRect=null;
  function onMove(e){
    if(!mode) return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    if(mode==='drag'){
      dialog.style.position='fixed'; dialog.style.margin='0';
      dialog.style.left=Math.max(0,Math.min(window.innerWidth-80,startRect.left+dx))+'px';
      dialog.style.top=Math.max(0,Math.min(window.innerHeight-40,startRect.top+dy))+'px';
    } else if(mode==='resize'){
      dialog.style.width=Math.max(480,startRect.width+dx)+'px';
      dialog.style.height=Math.max(320,startRect.height+dy)+'px';
    }
  }
  function onUp(){ mode=null; dialog.classList.remove('dragging'); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
  head.addEventListener('mousedown',e=>{
    if(e.target.closest('#drillCloseBtn,#drillExportBtn')) return; // don't start a drag from the action buttons
    mode='drag'; startX=e.clientX; startY=e.clientY; startRect=dialog.getBoundingClientRect(); dialog.classList.add('dragging');
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
  });
  handle.addEventListener('mousedown',e=>{
    e.preventDefault(); mode='resize'; startX=e.clientX; startY=e.clientY; startRect=dialog.getBoundingClientRect(); dialog.classList.add('dragging');
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
  });
}
// Side-by-side compare: reuses the URL-state feature (?tab=...&<dim>=...)
// so each pane is a fully live, independent copy of this same dashboard at
// a different filter value — not a simplified summary that needs its own
// rendering path to maintain.
function wireExportDialog(){
  const btn=document.getElementById('exportMenuBtn');
  const modal=document.getElementById('exportDialogModal');
  const closeBtn=document.getElementById('exportDialogCloseBtn');
  const options=[...document.querySelectorAll('.export-dialog-option')];
  if(!btn||!modal||!closeBtn||!options.length) return;

  let restoreFocusEl=null;
  const setOpenState=(open)=>{
    modal.classList.toggle('open',open);
    modal.setAttribute('aria-hidden',open?'false':'true');
    btn.setAttribute('aria-expanded',open?'true':'false');
  };
  const close=({restoreFocus=false}={})=>{
    const wasOpen=modal.classList.contains('open');
    setOpenState(false);
    if(restoreFocus && wasOpen){
      const target=restoreFocusEl||btn;
      try{ target.focus({preventScroll:true}); }catch(e){ target.focus(); }
    }
    restoreFocusEl=null;
  };
  const open=()=>{
    restoreFocusEl=document.activeElement;
    setOpenState(true);
    requestAnimationFrame(()=>options[0]?.focus());
  };
  const runExport=(format)=>{
    close();
    exportDashboard(format);
  };

  btn.addEventListener('click',e=>{ e.stopPropagation(); modal.classList.contains('open') ? close({restoreFocus:true}) : open(); });
  closeBtn.addEventListener('click',()=>close({restoreFocus:true}));
  options.forEach(item=>item.addEventListener('click',()=>runExport(item.dataset.fmt)));
  modal.addEventListener('click',e=>{ if(e.target===modal) close({restoreFocus:true}); });
  modal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ e.preventDefault(); close({restoreFocus:true}); return; }
    if(e.key!=='Tab') return;
    const focusables=[closeBtn,...options];
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && modal.classList.contains('open')){ e.preventDefault(); close({restoreFocus:true}); }
  });
}
function wireCompareMode(){
  const btn=document.getElementById('compareModeBtn'), modal=document.getElementById('compareModal');
  if(!btn||!modal) return;
  const dimSelect=document.getElementById('compareDimSelect'), valA=document.getElementById('compareValueA'), valB=document.getElementById('compareValueB');
  dimSelect.innerHTML=FILTER_DEFS.map(f=>`<option value="${f.key}">${f.label.replace(/^\S+\s/,'')}</option>`).join('');
  dimSelect.value='month';
  function populateValues(){
    const key=dimSelect.value;
    const raw=(window._filterOptionsCache&&window._filterOptionsCache[key])||[];
    const items=raw.map(item=>(item&&typeof item==='object')?item:{value:item,label:item}).filter(x=>x.value!=='All');
    const optionsHtml=items.map(x=>`<option value="${escQcr(x.value)}">${escQcr(x.label)}</option>`).join('');
    valA.innerHTML=optionsHtml; valB.innerHTML=optionsHtml;
    if(items.length>1) valB.selectedIndex=1; // default to two different values instead of the same one twice
  }
  dimSelect.addEventListener('change',populateValues);
  populateValues();
  function openSetup(){ modal.classList.add('open'); document.getElementById('compareView').classList.add('hidden'); document.getElementById('compareSetup').style.display='block'; }
  function clearComparingToStatus(){ const s=document.getElementById('statusComparingTo'); if(s) s.textContent='None'; }
  btn.addEventListener('click',openSetup);
  document.getElementById('compareCancelBtn').addEventListener('click',()=>{ modal.classList.remove('open'); clearComparingToStatus(); });
  document.getElementById('compareCloseBtn').addEventListener('click',()=>{ modal.classList.remove('open'); clearComparingToStatus(); });
  document.getElementById('compareEditBtn').addEventListener('click',openSetup);
  document.getElementById('compareGoBtn').addEventListener('click',()=>{
    const key=dimSelect.value, a=valA.value, b=valB.value;
    if(!a||!b){ showToast('error','Pick both values','Choose a value for both the left and right side.'); return; }
    const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    function buildUrl(val){
      const params=new URLSearchParams();
      if(tab!=='dashboard') params.set('tab',tab);
      FILTER_DEFS.forEach(f=>{ if(f.key===key) return; if(currentFilters[f.key]&&currentFilters[f.key]!=='All') params.set(f.key,currentFilters[f.key]); });
      params.set(key,val);
      return location.pathname+'?'+params.toString();
    }
    document.getElementById('compareFrameA').src=buildUrl(a);
    document.getElementById('compareFrameB').src=buildUrl(b);
    const dimLabel=(FILTER_DEFS.find(f=>f.key===key)||{}).label||key;
    document.getElementById('compareViewTitle').textContent=`Comparing ${dimLabel.replace(/^\S+\s/,'')}: ${a}  vs  ${b}`;
    document.getElementById('compareSetup').style.display='none';
    document.getElementById('compareView').classList.remove('hidden');
    const s=document.getElementById('statusComparingTo'); if(s) s.textContent=`${a} vs ${b}`;
  });
}
function wireDrilldown(){
  document.getElementById('drillCloseBtn')?.addEventListener('click',closeDrilldown);
  document.getElementById('drillModal')?.addEventListener('click',e=>{if(e.target.id==='drillModal')closeDrilldown();});
document.getElementById('drillBreadcrumb')?.addEventListener('click',e=>{const b=e.target.closest('[data-drill-level]');if(b)goToDrillLevel(Number(b.dataset.drillLevel));});
document.getElementById('drillContent')?.addEventListener('click',e=>{const b=e.target.closest('.heat-detail-btn');if(b){const heat=b.dataset.heat;if(heat)pushDrilldown('heat_detail',`Heat ${heat} — Complete History`,{drill_value:heat},`Heat ${heat}`);return;} const pg=e.target.closest('[data-drill-page]');if(pg&&!pg.disabled)renderDrillPage(Number(pg.dataset.drillPage));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && document.getElementById('drillModal')?.classList.contains('open')){e.preventDefault();e.stopImmediatePropagation();closeDrilldown();}});
  document.getElementById('saveViewBtn')?.addEventListener('click',saveCurrentView);
  document.getElementById('clearViewsBtn')?.addEventListener('click',manageSavedViews);
  document.getElementById('savedViewSelect')?.addEventListener('change',e=>applySavedView(e.target.value));
  renderSavedViews();
  wireDrillDialogDragResize();
}
async function loadKpis(signal){
  const params = new URLSearchParams(currentFilters).toString();
  // Dashboard KPI and monthly trend are independent; fetch them together.
  const monthlyPromise = loadMonthlyTrend(signal);
  monthlyPromise.catch(()=>{}); // observed below by "await monthlyPromise"; avoids an unhandled-rejection if /api/kpis fails first
  const res = await fetch("/api/kpis?" + params, {signal});
  const data = await res.json();
  if(!res.ok || data.error){ throw new Error(data.error || ('Request failed (HTTP '+res.status+').')); }
  renderKpis(data.kpis);
  const totalKpi = (data.kpis||[]).find(x=>x.label==='Total Coils'); refreshFilterSummary(totalKpi ? totalKpi.value : 0);
  renderPeriodBanner(data.period);
  renderDecisionTable(data.decision_table, data.decision_total);
  renderDefectTable(data.top_defects, data.top_defects_total);
  renderIntensityTable(data.intensity_table, data.intensity_total);
  dashLoadFishbone(data.top_defects);

  const decisionRows = data.decision_table.filter(r => r.qty > 0);
  makePieChart(document.getElementById("decisionPie"), decisionRows, "qty", "decision",
    {valFmt: fmtDonutQty3});
  makeGroupedBarChart(document.getElementById("decisionBarChart"), data.decision_table, "decision", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {yLabel: "Coils  /  Qty (MT)", xLabel: "Quality Decision", labelTruncate: 16});
  makeComboChart(document.getElementById("pareto5Chart"), data.top_defects, "defect", "qty", "cum_pct",
    {barFmt: v => v.toFixed(1), lineFmt: v => (v*100).toFixed(0)+"%", xLabel: "Defect Type", colorful: true});
  makeHGroupedBarChart(document.getElementById("intensityChart"), data.intensity_table, "intensity", [
    {key:"coils", label:"Coils", color:"#118DFF", fmt: v => v.toFixed(0)},
    {key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)},
  ], {xLabel: "Coils  /  Qty (MT)", yLabel: "Defect Intensity", drillKind: 'intensity'});

  wireChartDrilldown('decisionPie','decision'); wireChartDrilldown('decisionBarChart','decision'); wireChartDrilldown('pareto5Chart','defect'); wireChartDrilldown('intensityChart','intensity');
  await monthlyPromise;
}


function markChartsReady(){document.querySelectorAll('.chart-scroll').forEach(c=>{c.classList.remove('chart-ready'); void c.offsetWidth; c.classList.remove('chart-refreshing'); c.classList.add('chart-ready'); setTimeout(()=>c.classList.remove('chart-ready'),700);});}
// =====================================================================
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
  _chartResizeTimer = setTimeout(() => {
    const targets = [..._chartResizeQueue]; _chartResizeQueue.clear();
    targets.forEach(t => {
      if(!t._qdRedraw || !t.isConnected) return;
      const cw = chartAvailWidth(t);
      // Height changes (a redraw changes the chart's height) must NOT trigger another redraw.
      if(cw > 0 && Math.abs(cw - (t._qdCw||0)) >= 6){ try { t._qdRedraw(); } catch(err){ console.error('Chart redraw failed', err); } }
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

// ---------------------------------------------------------------------
// ANALYTICS PRESENTATION MODE
// Opens one analytics panel in a focused, fullscreen-style overlay without
// creating a second chart instance or making another API request. The real
// panel node is moved into the overlay and restored to the exact DOM position
// on close, so existing delegated drill-down handlers, ResizeObserver wiring,
// live data updates, filters and chart state remain intact.
let _analyticsPresentation = null;
let _analyticsPresentationState = null;

function ensureAnalyticsPresentation(){
  if(_analyticsPresentation) return _analyticsPresentation;
  const overlay=document.createElement('div');
  overlay.id='analyticsPresentation';
  overlay.className='analytics-presentation';
  overlay.hidden=true;
  overlay.innerHTML=`<div class="analytics-presentation-backdrop" data-presentation-close="1"></div>
    <section class="analytics-presentation-shell" role="dialog" aria-modal="true" aria-labelledby="analyticsPresentationTitle">
      <div class="analytics-presentation-toolbar">
        <div class="analytics-presentation-meta">
          <span class="analytics-presentation-kicker">${qdIc('maximize')}PRESENTATION MODE</span>
          <h2 id="analyticsPresentationTitle"></h2>
        </div>
        <button type="button" class="analytics-presentation-close" aria-label="Close presentation mode" title="Close presentation mode (Esc)">${qdIc('x')}</button>
      </div>
      <div class="analytics-presentation-stage" tabindex="-1"></div>
    </section>`;
  document.body.appendChild(overlay);
  const closeBtn=overlay.querySelector('.analytics-presentation-close');
  closeBtn.addEventListener('click',closeAnalyticsPresentation);
  overlay.addEventListener('click',e=>{ if(e.target.matches('[data-presentation-close]')) closeAnalyticsPresentation(); });
  // Keep keyboard focus inside the presentation overlay while it is open.
  overlay.addEventListener('keydown',e=>{
    if(e.key!=="Tab" || !_analyticsPresentationState) return;
    const focusables=[...overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=="hidden";
    });
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1], active=document.activeElement;
    if(e.shiftKey){
      if(active===first || !overlay.contains(active)){e.preventDefault();last.focus();}
    }else if(active===last){e.preventDefault();first.focus();}
  });
  _analyticsPresentation=overlay;
  return overlay;
}

function analyticsPanelTitle(panel){
  const heading=panel?.querySelector(':scope > h3');
  if(!heading) return 'Analytics';
  const clone=heading.cloneNode(true);
  clone.querySelector('.analytics-expand-btn')?.remove();
  return clone.textContent.trim() || 'Analytics';
}

function openAnalyticsPresentation(panel){
  if(!panel || _analyticsPresentationState) return;
  const overlay=ensureAnalyticsPresentation();
  const stage=overlay.querySelector('.analytics-presentation-stage');
  const title=overlay.querySelector('#analyticsPresentationTitle');
  const closeBtn=overlay.querySelector('.analytics-presentation-close');
  const parent=panel.parentNode;
  const placeholder=document.createComment('qdash-analytics-presentation-placeholder');
  const previousActive=document.activeElement;
  panel.parentNode.insertBefore(placeholder,panel);
  title.textContent=analyticsPanelTitle(panel);
  _analyticsPresentationState={panel,placeholder,parent,previousActive};
  panel.classList.add('analytics-presentation-panel');
  stage.appendChild(panel);
  document.documentElement.classList.add('analytics-presentation-open');
  document.body.classList.add('analytics-presentation-open');
  overlay.hidden=false;
  requestAnimationFrame(()=>{
    overlay.classList.add('is-open');
    closeBtn.focus({preventScroll:true});
    // Moving the real chart container changes its size: redraw every chart at the
    // presentation size and reshape it to fit the screen (no zooming out needed).
    fitPresentationCharts(panel);
  });
}

// Presentation fit: the chart's SVG is letterboxed (never cropped) inside the space left after the
// legend and table. To also FILL that space, redraw once with a canvas whose aspect ratio matches it.
function fitPresentationCharts(panel){
  if(!panel) return;
  panel.querySelectorAll('.chart-scroll').forEach(c=>{
    if(!c._qdRedraw) return;
    try{
      c._qdFit=1; c._qdRedraw();
      const svg=c.querySelector(':scope > .chart-svg');
      const vb=svg && svg.viewBox && svg.viewBox.baseVal;
      if(!vb || !vb.width || !vb.height || !svg.clientWidth || !svg.clientHeight) return;
      const fit=Math.max(0.55,Math.min(2.2,(vb.width/vb.height)/(svg.clientWidth/svg.clientHeight)));
      if(Math.abs(fit-1)<0.06) return;
      c._qdFit=fit; c._qdRedraw();
    }catch(err){ console.error('Presentation fit failed',err); }
  });
}
let _presFitTimer=null;
window.addEventListener('resize',()=>{
  if(!_analyticsPresentationState) return;
  clearTimeout(_presFitTimer);
  _presFitTimer=setTimeout(()=>{ if(_analyticsPresentationState) fitPresentationCharts(_analyticsPresentationState.panel); },220);
});

function closeAnalyticsPresentation(){
  const state=_analyticsPresentationState;
  if(!state) return;
  const overlay=_analyticsPresentation;
  const panel=state.panel;
  try{
    state.placeholder.parentNode?.insertBefore(panel,state.placeholder);
    state.placeholder.remove();
  }catch(e){
    try{state.parent.appendChild(panel);}catch(_e){}
  }
  panel.classList.remove('analytics-presentation-panel');
  panel.querySelectorAll('.chart-scroll').forEach(c=>{ c._qdFit=1; });
  _analyticsPresentationState=null;
  document.documentElement.classList.remove('analytics-presentation-open');
  document.body.classList.remove('analytics-presentation-open');
  overlay?.classList.remove('is-open');
  if(overlay){
    setTimeout(()=>{ if(!_analyticsPresentationState) overlay.hidden=true; },180);
  }
  requestAnimationFrame(()=>panel.querySelectorAll('.chart-scroll').forEach(c=>{ c._qdRedraw?.(); }));
  const restore=state.previousActive;
  if(restore && typeof restore.focus==='function' && document.contains(restore)){
    requestAnimationFrame(()=>restore.focus({preventScroll:true}));
  }
}

function wireAnalyticsPresentation(){
  if(wireAnalyticsPresentation._wired) return;
  wireAnalyticsPresentation._wired=true;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && _analyticsPresentationState){
      if(document.getElementById('drillModal')?.classList.contains('open')) return;
      e.preventDefault(); closeAnalyticsPresentation();
    }
  });
  document.querySelectorAll('.tab-panel .panel').forEach(panel=>{
    if(!panel.querySelector('.chart-scroll,.qcr-fishbone-diagram')) return;
    const heading=panel.querySelector(':scope > h3');
    if(!heading || heading.querySelector('.analytics-expand-btn')) return;
    heading.classList.add('analytics-panel-title');
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='analytics-expand-btn';
    btn.setAttribute('aria-label',`Open ${analyticsPanelTitle(panel)} in presentation mode`);
    btn.title='Open in presentation mode';
    btn.innerHTML=qdIc('maximize');
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openAnalyticsPresentation(panel);});
    heading.appendChild(btn);
  });
}

// ---------------------------------------------------------------------
// FIELD HINTS (V65.0)
// A small tag follows the mouse and names the field under it: KPI parts, table columns
// (+ row), filters, legends and icon-only buttons. Chart shapes keep their own tooltip
// (above). Toggle from Ctrl+K; the choice is remembered.
const FIELD_HINT_KEY='qdash_field_hints';
function fieldHintsOn(){ try{ return localStorage.getItem(FIELD_HINT_KEY)!=='off'; }catch(e){ return true; } }
function toggleFieldHints(){ const on=!fieldHintsOn(); try{ localStorage.setItem(FIELD_HINT_KEY,on?'on':'off'); }catch(e){} if(!on) hideFieldTag(); return on; }
let _fieldTagEl=null, _fieldTagTarget=null, _fieldTagTitleEl=null, _fieldTagRaf=0, _fieldTagXY=null;
function fieldTagEl(){
  if(!_fieldTagEl){
    _fieldTagEl=document.createElement('div');
    _fieldTagEl.className='qd-field-tag'; _fieldTagEl.setAttribute('role','tooltip');
    _fieldTagEl.innerHTML=qdIc('tag')+'<div class="qft-copy"><b class="qft-name"></b><small class="qft-meta"></small></div>';
    document.body.appendChild(_fieldTagEl);
  }
  return _fieldTagEl;
}
function _fhClean(s){ return String(s||'').replace(/[\u2191\u2193\u2195\u25B2\u25BC\u21C5]/g,'').replace(/\s+/g,' ').trim(); }
function _fhCell(table,idx){
  const rows=table.tHead&&table.tHead.rows.length?table.tHead.rows:table.rows;
  const r=rows[rows.length?(table.tHead&&table.tHead.rows.length?rows.length-1:0):0]; return r&&r.cells[idx]?_fhClean(r.cells[idx].textContent):'';
}
function resolveFieldInfo(t){
  if(!(t instanceof Element)) return null;
  // The intro/splash screen is presentation-only; field-name hover tags should not appear there.
  if(t.closest('#introScreen')) return null;
  if(t.closest('[data-tip],.qd-field-tag,.chart-tooltip,.analytics-presentation-backdrop')) return null;
  const ex=t.closest('[data-field]');
  if(ex) return {name:ex.getAttribute('data-field'),meta:ex.getAttribute('data-field-meta')||'Field'};
  const cell=t.closest('td,th');
  if(cell && cell.closest('table')){
    const table=cell.closest('table'); const idx=cell.cellIndex; const head=_fhCell(table,idx);
    if(cell.tagName==='TH') return head?{name:head,meta:'Table column'}:null;
    if(!head) return null;
    let rowLabel=''; for(const c of cell.parentElement.cells){ const h=_fhCell(table,c.cellIndex); const tx=_fhClean(c.textContent); if(c!==cell && tx && !/^(rank|#|sr\.?|s\.?no\.?)$/i.test(h) && !/^[\d.,%\s-]+$/.test(tx)){ rowLabel=tx; break; } }
    return {name:head,meta:rowLabel?('Row: '+(rowLabel.length>34?rowLabel.slice(0,33)+'…':rowLabel)):'Table value'};
  }
  const kpi=t.closest('.kpi-card');
  if(kpi){
    const name=_fhClean(kpi.querySelector('.label')&&kpi.querySelector('.label').textContent.replace(kpi.querySelector('.kpi-icon')?.textContent||'',''))||'KPI';
    if(t.closest('.kpi-status')) return {name:'Status vs target',meta:name};
    if(t.closest('.value')) return {name:name,meta:'Current value'};
    if(t.closest('.prev')) return {name:'Previous period value',meta:name};
    if(t.closest('.trend')) return {name:'Change vs previous period',meta:name};
    if(t.closest('.kpi-targets,.kpi-target,.kpi-target-item')) return {name:'Target thresholds',meta:name};
    return {name:name,meta:'KPI'};
  }
  const ff=t.closest('.filter-field');
  if(ff){ const lab=_fhClean(ff.querySelector('label')&&ff.querySelector('label').textContent).replace(/^\P{L}+/u,''); const opt=t.closest('.filter-option,.filter-options > *'); return {name:lab||'Filter',meta:opt?('Option: '+_fhClean(opt.textContent)):'Filter'}; }
  const li=t.closest('.legend-item'); if(li) return {name:_fhClean(li.textContent),meta:'Legend'};
  const ex2=t.closest('.qcr-exec-item'); if(ex2){ const sm=ex2.querySelector('small'); if(sm) return {name:_fhClean(sm.textContent),meta:'Summary'}; }

  // Generic field coverage: keep the hint working on controls/labels added later
  // without requiring every new element to be manually decorated with data-field.
  const formCtl=t.closest('input,select,textarea');
  if(formCtl){
    const id=formCtl.id;
    const lab=(id&&document.querySelector('label[for=\"'+CSS.escape(id)+'\"]'))||formCtl.closest('.field,.filter-field')?.querySelector('label');
    const nm=_fhClean(lab?.textContent||formCtl.getAttribute('aria-label')||formCtl.getAttribute('name')||formCtl.getAttribute('placeholder'));
    if(nm) return {name:nm,meta:formCtl.tagName==='SELECT'?'Dropdown':formCtl.tagName==='TEXTAREA'?'Text field':'Input'};
  }
  const tab=t.closest('.tab-btn'); if(tab){ const nm=_fhClean(tab.textContent); if(nm) return {name:nm,meta:'Dashboard section'}; }

  const ti=t.closest('[title],[aria-label]');
  if(ti && (ti.tagName==='BUTTON'||ti.hasAttribute('title')||ti.getAttribute('role')==='button') && !ti.closest('.cmdk-dialog')){
    const nm=_fhClean(ti.getAttribute('title')||ti.getAttribute('data-qd-title')||ti.getAttribute('aria-label')); if(nm) return {name:nm,meta:ti.tagName==='BUTTON'?'Button':'Info',_titleEl:ti.hasAttribute('title')?ti:null};
  }

  const action=t.closest('button,a,[role=\"button\"]');
  if(action && !action.closest('.cmdk-dialog')){
    const nm=_fhClean(action.getAttribute('data-field')||action.textContent);
    if(nm && nm.length<=80) return {name:nm,meta:action.tagName==='A'?'Link':'Button'};
  }

  const sectionTitle=t.closest('h1,h2,h3,h4,h5,h6');
  if(sectionTitle){ const nm=_fhClean(sectionTitle.textContent); if(nm) return {name:nm,meta:'Section'}; }

  const ui=t.closest('.stat,.quality-score,.result,.connection-box,.filebox,.shortcut-panel,.activity-event,.recovery-card,.command-card,.admin-kpi,.admin-prod-card,.prod-metrics > div,.integrity-grid > div,.issue,.wizard .step');
  if(ui){
    const own=_fhClean(ui.getAttribute('data-field')||ui.querySelector('.label,.prod-head b,.prod-metrics span,.integrity-grid span,.activity-main b,.command-card b,.recovery-card b')?.textContent||ui.textContent);
    if(own){ const clipped=own.length>70?own.slice(0,69)+'…':own; return {name:clipped,meta:'Field'}; }
  }
  return null;
}
function hideFieldTag(){
  if(_fieldTagEl) _fieldTagEl.classList.remove('show');
  if(_fieldTagTitleEl){ const v=_fieldTagTitleEl.getAttribute('data-qd-title'); if(v!==null){ _fieldTagTitleEl.setAttribute('title',v); _fieldTagTitleEl.removeAttribute('data-qd-title'); } _fieldTagTitleEl=null; }
  _fieldTagTarget=null;
}
function placeFieldTag(x,y){
  const el=fieldTagEl(); const r=el.getBoundingClientRect(); let L=x+14,T=y+20;
  if(L+r.width>innerWidth-8) L=x-r.width-12; if(T+r.height>innerHeight-8) T=y-r.height-14;
  el.style.transform='translate3d('+Math.max(6,L)+'px,'+Math.max(6,T)+'px,0)';
}
function initFieldHints(){
  if(initFieldHints._wired) return; initFieldHints._wired=true;
  if(!window.matchMedia('(pointer: fine)').matches) return;
  document.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse' || !fieldHintsOn()) return;
    _fieldTagXY=[e.clientX,e.clientY];
    if(_fieldTagRaf) return;
    _fieldTagRaf=requestAnimationFrame(()=>{
      _fieldTagRaf=0; const [x,y]=_fieldTagXY; const tg=e.target;
      if(tg!==_fieldTagTarget){
        hideFieldTag(); _fieldTagTarget=tg; const info=resolveFieldInfo(tg);
        if(!info){ return; }
        if(info._titleEl){ _fieldTagTitleEl=info._titleEl; info._titleEl.setAttribute('data-qd-title',info._titleEl.getAttribute('title')); info._titleEl.removeAttribute('title'); }
        const el=fieldTagEl(); el.querySelector('.qft-name').textContent=info.name; el.querySelector('.qft-meta').textContent=info.meta||''; el.classList.add('show');
      }
      if(_fieldTagEl && _fieldTagEl.classList.contains('show')) placeFieldTag(x,y);
    });
  },{passive:true});
  document.addEventListener('pointerleave',hideFieldTag,true);
  document.documentElement.addEventListener('mouseleave',hideFieldTag);
  window.addEventListener('scroll',hideFieldTag,{passive:true,capture:true});
  document.addEventListener('pointerdown',hideFieldTag,true);
}

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
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}
// X-axis title for VERTICAL charts (centered, placed at bottom)
function xAxisTitleV(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle">${text}</text>`;
}
// X-axis title (value axis) for HORIZONTAL bar charts (centered, at bottom)
function xAxisTitleH(text, w, h, padL, padR){
  const cx = padL + (w - padL - padR) / 2;
  return `<text x="${cx}" y="${h - 6}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle">${text}</text>`;
}
// Y-axis title (category axis) for HORIZONTAL bar charts (rotated, far left)
function yAxisTitleH(text, h, padT, padB){
  const cy = padT + (h - padT - padB) / 2;
  return `<text x="16" y="${cy}" font-size="11.5" font-weight="700" fill="var(--chart-axis-title)" text-anchor="middle" transform="rotate(-90 16 ${cy})">${text}</text>`;
}

// Friendly empty-state markup shared by every chart and the drill-down
// modal, instead of a bare line of text. `sub` is optional supporting text
// (e.g. a hint to widen the filter); an inline SVG icon keeps this
// dependency-free and themeable via currentColor.
function emptyStateMarkup(title, sub){
  return `<div class="empty-state"><svg class="empty-state-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 5"/><path d="M20 40 L28 30 L36 35 L44 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="44" cy="22" r="2.8" fill="currentColor"/><circle cx="36" cy="35" r="2.8" fill="currentColor"/><circle cx="28" cy="30" r="2.8" fill="currentColor"/><circle cx="20" cy="40" r="2.8" fill="currentColor"/></svg><div class="empty-state-title">${escQcr(title)}</div>${sub?`<div class="empty-state-sub">${escQcr(sub)}</div>`:''}</div>`;
}

// ---- Toast notifications: a visual, top-right sliding confirmation for
// success/error/info, so people who keep sound muted (see sfx.js) still get
// a clear confirmation an action finished — sound and toast are independent
// of each other, neither depends on the other being on. ----
function ensureToastHost(){
  let host=document.getElementById('toastHost');
  if(!host){ host=document.createElement('div'); host.id='toastHost'; host.className='toast-host'; host.setAttribute('aria-live','polite'); host.setAttribute('role','status'); document.body.appendChild(host); }
  return host;
}
function showToast(kind,title,message,opts={}){
  const host=ensureToastHost();
  const el=document.createElement('div');
  el.className='toast toast-'+(kind||'info');
  const icon=kind==='success'?'✅':kind==='error'?'⚠️':'ℹ️';
  el.innerHTML=`<span class="toast-icon" aria-hidden="true">${icon}</span><div class="toast-body"><div class="toast-title"></div><div class="toast-msg"></div></div><button class="toast-close" type="button" aria-label="Dismiss notification">✕</button>`;
  el.querySelector('.toast-title').textContent=title||'';
  const msgEl=el.querySelector('.toast-msg');
  if(message) msgEl.textContent=message; else msgEl.remove();
  host.appendChild(el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
  const dur=opts.duration||(kind==='error'?6500:4200);
  let dismissed=false;
  const dismiss=()=>{ if(dismissed)return; dismissed=true; el.classList.remove('show'); el.classList.add('hide'); setTimeout(()=>el.remove(),260); };
  el._dismiss=dismiss;
  // Cap how many toasts can be stacked/visible at once — if a burst of calls fires in quick
  // succession (bulk export, multiple failed rows, etc.) the oldest ones are dismissed early
  // instead of silently piling up the whole screen height.
  const MAX_VISIBLE_TOASTS=4;
  const active=[...host.children].filter(c=>c!==el&&!c.classList.contains('hide'));
  if(active.length>=MAX_VISIBLE_TOASTS){ active.slice(0,active.length-MAX_VISIBLE_TOASTS+1).forEach(old=>{ if(old._dismiss) old._dismiss(); }); }
  const timer=setTimeout(dismiss,dur);
  el.querySelector('.toast-close').addEventListener('click',()=>{clearTimeout(timer);dismiss();});
  return ()=>{clearTimeout(timer);dismiss();};
}

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
  slicesData.forEach(s => {
    const ox1 = cx + r*Math.cos(s.a0), oy1 = cy + r*Math.sin(s.a0);
    const ox2 = cx + r*Math.cos(s.a1), oy2 = cy + r*Math.sin(s.a1);
    const ix1 = cx + innerR*Math.cos(s.a1), iy1 = cy + innerR*Math.sin(s.a1);
    const ix2 = cx + innerR*Math.cos(s.a0), iy2 = cy + innerR*Math.sin(s.a0);
    const largeArc = (s.a1 - s.a0) > Math.PI ? 1 : 0;
    slices += `<path class="chart-slice" data-drill-category="${escQcr(s.d[labelKey])}" data-drill-kind="decision" d="M${ox1},${oy1} A${r},${r} 0 ${largeArc} 1 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${svgFill(s.color, _pieTag)}" filter="${svgLift(_pieTag)}" stroke="var(--chart-halo)" stroke-width="2.5" data-tip="${escQcr(s.d[labelKey])}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${fmtDonutPct3(s.frac)})"></path>`;
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
    bars += `<rect class="chart-bar"${opts.drillKind?` data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind}"`:''} x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${svgFill(barColor, _hbarTag)}" filter="${svgLift(_hbarTag)}" rx="3" data-tip="${escQcr(d[labelKey])}: ${opts.fmt ? opts.fmt(val) : val}"></rect>`;
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
      bars += `<rect class="chart-bar"${opts.drillKind?` data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind}"`:''} x="${padL}" y="${y}" width="${Math.max(barW,2)}" height="${barH}" fill="${svgFill(s.color, _hgTag)}" filter="${svgLift(_hgTag)}" rx="3" data-tip="${escQcr(s.label)} — ${escQcr(d[labelKey])}: ${s.fmt ? s.fmt(val) : val}"></rect>`;
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
      bars += `<rect class="chart-bar" data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="${opts.drillKind||'decision'}" x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${svgFill(s.color, _vgTag)}" filter="${svgLift(_vgTag)}" rx="2" data-tip="${escQcr(s.label)} — ${escQcr(d[labelKey])}: ${s.fmt ? s.fmt(val) : val}"></rect>`;
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
    bars += `<rect class="chart-bar" data-drill-category="${escQcr(d[labelKey])}" data-drill-kind="defect" x="${x}" y="${y}" width="${barW}" height="${Math.max(barH,0)}" fill="${svgFill(barColor, _comboTag)}" filter="${svgLift(_comboTag)}" rx="3" data-tip="${escQcr(d[labelKey])}: ${opts.barFmt?opts.barFmt(val):val}"></rect>`;
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

// ---------- Tab: Quality Control Room ----------
function qcrStatus(label, value){
  const c=KPI_TARGETS[label]; if(!c || c.target===null || c.target===undefined) return 'neutral';
  const v=Number(value)||0,t=Number(c.target),w=Number(c.warning),d=(c.direction||'higher').toLowerCase();
  if(d==='lower') return v<=t?'good':v<=w?'amber':'bad';
  return v>=t?'good':v>=w?'amber':'bad';
}
function qcrFmtKpi(k){ return k.fmt==='pct' ? (Number(k.value||0)*100).toFixed(2)+'%' : k.fmt==='int' ? Math.round(Number(k.value||0)).toLocaleString() : Number(k.value||0).toFixed(2); }
function qcrTargetText(label){ const c=KPI_TARGETS[label]; if(!c)return 'Target not set'; return `${c.direction==='lower'?'≤':'≥'} ${fmtTarget(c.target,'pct')}`; }
// Top Contributors: Defects / Work Centers / Grades in one tabbed card.
// Replaces the old separate Top 5 Defects, Worst Work Centers, Worst Grades,
// Grade Concentration, Work Center & Grade Risk and Recurring Quality
// Problems cards — same underlying rows, shown once each, with a
// "Recurring" / risk badge inline instead of a whole extra card.
function qcrRenderContribPanel(id, rows, kind, meta){
  const el=document.getElementById(id); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">No data available for current selection.</div>';return;}
  el.innerHTML=rows.map((r,i)=>{
    let name,metricText,sev,attrs,action,badges='';
    if(kind==='defect'){
      name=String(r.defect??'—'); const qty=Number(r.qty||0); const pct=meta.total?qty/meta.total:0;
      sev=pct>=0.35?'CRITICAL':pct>=0.20?'ATTENTION':'NORMAL';
      metricText=`${qty.toFixed(2)} MT • ${(pct*100).toFixed(2)}% of defect qty • ${Number(r.records||0).toLocaleString()} coils`;
      attrs=`data-defect="${escQcr(name)}"`; action='View Pareto';
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
    }else{
      name=String(r.name??'—'); const reject=Number(r.reject_pct_qty||0), coils=Number(r.coils||0);
      sev=reject>=0.05?'CRITICAL':reject>=0.03?'ATTENTION':'NORMAL';
      metricText=`${(reject*100).toFixed(2)}% Reject${coils?` • ${coils.toLocaleString()} coils`:''}`;
      attrs= kind==='wc' ? `data-qcr-wc="${escQcr(name)}"` : `data-qcr-grade="${escQcr(name)}"`;
      action= kind==='wc' ? `Investigate ${escQcr(name)}` : `Review ${escQcr(name)}`;
      if(meta.recurring.has(name)) badges+='<span class="qcr-badge qcr-badge-recurring">🔁 Recurring</span>';
      const risk=meta.risk?meta.risk[name]:null; if(risk&&risk!=='Low') badges+=`<span class="qcr-badge qcr-badge-risk-${risk.toLowerCase()}">${risk} risk</span>`;
    }
    return `<div class="qcr-ranked-row"><div class="qcr-rank">${i+1}</div><div class="qcr-ranked-main"><b>${escQcr(name)}</b><span>${metricText}</span>${badges?`<div class="qcr-badges">${badges}</div>`:''}<em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em></div><button class="qcr-mini-investigate qcr-contrib-btn" type="button" ${attrs}>${action} →</button></div>`;
  }).join('');
}
function qcrRenderTopContributors(topDefects, defectTotalQty, worstWc, worstGr, intel){
  const patterns=Array.isArray(intel?.recurring_patterns)?intel.recurring_patterns:[];
  const recDefects=new Set(patterns.map(x=>x.defect).filter(Boolean));
  const recWc=new Set(patterns.map(x=>x.work_center).filter(Boolean));
  const recGrade=new Set(patterns.map(x=>x.grade).filter(Boolean));
  const riskWc={}; (intel?.risk_matrix?.work_centers||[]).forEach(x=>{riskWc[x.name]=x.risk;});
  const riskGrade={}; (intel?.risk_matrix?.grades||[]).forEach(x=>{riskGrade[x.name]=x.risk;});
  qcrRenderContribPanel('qcrContribDefect', topDefects, 'defect', {total:defectTotalQty, recurring:recDefects});
  qcrRenderContribPanel('qcrContribWc', worstWc, 'wc', {recurring:recWc, risk:riskWc});
  qcrRenderContribPanel('qcrContribGrade', worstGr, 'grade', {recurring:recGrade, risk:riskGrade});
  qcrLoadFishbone(topDefects);
  const footer=document.getElementById('qcrContribFooter');
  if(footer){
    const gc=Array.isArray(intel?.grade_concentration)?intel.grade_concentration:[]; const top=gc[0];
    footer.innerHTML=top?`<div class="qcr-hot-combo">🔥 Hottest combination: <b>${escQcr(top.grade||'—')}</b> grade • <b>${escQcr(top.defect||'—')}</b> defect • <b>${escQcr(top.wc||'—')}</b> work center — ${(Number(top.reject_pct||0)*100).toFixed(2)}% reject</div>`:'';
  }
}
// ---------- 6M Fishbone Analysis (Top Contributors → 6M Fishbone tab) ----------
// Pulls Man/Machine/Material/Method/Measurement/Environment causes for the
// current Top 5 Defects from /api/fishbone, which matches disposition
// defect names against the admin-imported 6M Fishbone Master workbook.
let qcrFishboneData = {items:[]};
// 6M category style (icon + color), imported from the workbook's own "Icon
// Color Coding" sheet via /api/fishbone. Falls back to these defaults until
// the first successful fetch fills it in, so nothing breaks on first paint.
let FISHBONE_STYLE = {
  man:         {label:'Man',         icon:'👤', color:'#118DFF'},
  machine:     {label:'Machine',     icon:'⚙️', color:'#16A34A'},
  material:    {label:'Material',    icon:'📦', color:'#D97706'},
  method:      {label:'Method',      icon:'📋', color:'#7C3AED'},
  measurement: {label:'Measurement', icon:'📏', color:'#DB2777'},
  environment: {label:'Environment', icon:'🌍', color:'#0891B2'},
};
function fbStyle(key){ return FISHBONE_STYLE[key] || {label:key,icon:'',color:'#64748B'}; }
function qcrRenderFishboneChips(items){
  const chipsEl=document.getElementById('qcrFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
function qcrFishboneCard(field,items){
  const st=fbStyle(field);
  const list=Array.isArray(items)?items:(items?[items]:[]);
  const body=list.length?`<ul class="qcr-fb-ul">${list.map(t=>`<li>${escQcr(t)}</li>`).join('')}</ul>`:'<div class="qcr-fb-empty">No cause on file</div>';
  return `<div class="qcr-fb-branch qcr-fb-${field}" style="--fb-color:${st.color}"><div class="qcr-fb-head"><span class="qcr-fb-icon">${st.icon}</span>${escQcr(st.label)}<span class="qcr-fb-count">${list.length||''}</span></div>${body}</div>`;
}
// Root Cause Analysis (5-Why + CAPA) table for whichever 6M categories have
// RCA data on file for the selected defect — sits under the fishbone diagram
// in both the QCR tab and the Dashboard tab (same underlying /api/fishbone data).
function renderRcaPanel(item){
  const rca = item && item.rca; if(!rca || !Object.keys(rca).length) return '';
  const order=['man','machine','material','method','measurement','environment'];
  const available = order.filter(k=>Array.isArray(rca[k]) && rca[k].length);
  if(!available.length) return '';
  // Each 6M category (Man/Machine/Material/...) can carry MORE THAN ONE
  // Why-Why/root-cause entry (e.g. two separate "Man" causes for the same
  // defect) — every entry imported for that category is rendered as its
  // own row, with the category chip row-spanned across them so it's clear
  // they all belong to the same 6M bucket.
  const rows = available.map(k=>{
    const st=fbStyle(k), entries=rca[k];
    return entries.map((r,i)=>{
      const chain=(r.why_chain||[]).map(escQcr).join(' <span class="qcr-rca-arrow">→</span> ');
      const catCell = i===0 ? `<td rowspan="${entries.length}"><span class="qcr-rca-chip" style="background:${st.color}">${st.icon} ${escQcr(st.label)}</span>${entries.length>1?`<div class="qcr-rca-count">${entries.length} causes</div>`:''}</td>` : '';
      return `<tr data-cause="${k}">
        ${catCell}
        <td class="qcr-rca-chain">${chain||'—'}</td>
        <td><b>${escQcr(r.root_cause)}</b></td>
        <td>${escQcr(r.action)}</td>
        <td>${escQcr(r.preventive_action)}</td>
        <td>${[r.role,r.responsibility].filter(Boolean).map(escQcr).join(' / ')||'—'}</td>
      </tr>`;
    }).join('');
  }).join('');
  if(!rows) return '';
  const causeOptions = ['<option value="all">All Causes</option>'].concat(
    available.map(k=>{const st=fbStyle(k); return `<option value="${k}">${st.icon} ${escQcr(st.label)} (${rca[k].length})</option>`;})
  ).join('');
  return `<div class="qcr-rca-panel">
    <div class="qcr-rca-head-row">
      <div class="qcr-fb-title">🧭 Root Cause Analysis (RCA) — ${escQcr(item.defect)}</div>
      <label class="qcr-rca-filter-label">Filter by Cause:
        <select class="qcr-rca-cause-filter" aria-label="Filter RCA by 6M cause category">${causeOptions}</select>
      </label>
    </div>
    <div class="qcr-rca-table-wrap"><table class="qcr-rca-table">
      <thead><tr><th>6M Category</th><th>5-Why Chain</th><th>Root Cause</th><th>Action</th><th>Preventive Action</th><th>Role / Responsibility</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
// Delegated listener: filtering by cause only ever hides/shows <tr> rows
// already rendered above, so it works no matter how many times the RCA
// panel gets re-rendered (new defect selected, filters changed, etc.).
document.addEventListener('change', e=>{
  const sel = e.target.closest('.qcr-rca-cause-filter'); if(!sel) return;
  const panel = sel.closest('.qcr-rca-panel'); if(!panel) return;
  const val = sel.value;
  panel.querySelectorAll('tbody tr[data-cause]').forEach(tr=>{
    tr.style.display = (val==='all' || tr.dataset.cause===val) ? '' : 'none';
  });
});
function qcrRenderFishboneDiagram(item){
  const el=document.getElementById('qcrFishboneDiagram'); if(!el) return;
  if(!item){ el.innerHTML='<div class="qcr-empty">No defect selected.</div>'; return; }
  if(!item.matched){
    el.innerHTML=`<div class="qcr-empty">No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet. Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.</div>`;
    return;
  }
  const c=item.causes||{};
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  el.innerHTML = `
    <div class="qcr-fb-title">🐟 6M Fishbone — ${escQcr(item.defect)}</div>
    ${note}
    <div class="qcr-fb-grid">
      ${qcrFishboneCard('man',c.man)}
      ${qcrFishboneCard('machine',c.machine)}
      ${qcrFishboneCard('material',c.material)}
      ${qcrFishboneCard('method',c.method)}
      ${qcrFishboneCard('measurement',c.measurement)}
      ${qcrFishboneCard('environment',c.environment)}
    </div>
    <div class="qcr-fb-spine"><span>${escQcr(item.defect)}</span></div>
    ${renderRcaPanel(item)}`;
}
function qcrLoadFishbone(topDefects){
  const chipsEl=document.getElementById('qcrFishboneChips'), diagEl=document.getElementById('qcrFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">Loading 6M fishbone analysis…</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    if(d.style) FISHBONE_STYLE=Object.assign({},FISHBONE_STYLE,d.style);
    qcrFishboneData=d;
    qcrRenderFishboneChips(d.items||[]);
    qcrRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">6M fishbone data unavailable.</div>'; });
}
document.getElementById('qcrFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#qcrFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  qcrRenderFishboneDiagram((qcrFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
// ---------- 6M Fishbone Analysis (Dashboard tab → below Top 5 Defects Pareto) ----------
// Same /api/fishbone source as the Quality Control Room tab, but driven by the
// Dashboard's own filtered Top 5 Defects (data.top_defects from /api/kpis), so it
// reacts to every filter change on the Dashboard tab independently of the QCR tab.
let dashFishboneData = {items:[]};
function dashRenderFishboneChips(items){
  const chipsEl=document.getElementById('dashFishboneChips'); if(!chipsEl) return;
  chipsEl.innerHTML = items.map((it,i)=>`<button class="qcr-fishbone-chip${i===0?' active':''}" type="button" data-idx="${i}">${escQcr(it.defect)}${it.matched?'':' ⚠'}</button>`).join('');
}
// True Ishikawa/fishbone skeleton (spine + 6 angled bones converging on the
// defect "head"), built as one SVG — as opposed to the qcr-fb-grid card
// layout used on the Quality Control Room tab. Same underlying causes data.
// Design goals: show EVERY cause (no 5-item cap, no truncation) and never let
// text collide — font-size auto-shrinks and wraps per label, and the whole
// diagram's height auto-grows to fit however many causes a branch has.
function fbList(v){ return Array.isArray(v) ? v.filter(x=>x!==null && x!==undefined && String(x).trim()!=='') : (v?[v]:[]); }
// Wrap `text` into at most `maxLines` lines of at most `maxChars` each
// (word-based). Only the last resort truncates (with an ellipsis) if even
// after the max number of lines the text still won't fit.
function fbWrapGeneric(text,maxChars,maxLines){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean);
  const lines=[]; let cur='';
  for(const w of words){
    if(!cur){ cur=w; continue; }
    if((cur+' '+w).length<=maxChars) cur=cur+' '+w;
    else { lines.push(cur); cur=w; }
  }
  if(cur) lines.push(cur);
  if(!lines.length) lines.push('');
  if(lines.length>maxLines){
    const head=lines.slice(0,maxLines-1);
    let rest=lines.slice(maxLines-1).join(' ');
    if(rest.length>maxChars) rest=rest.slice(0,Math.max(1,maxChars-1))+'…';
    head.push(rest);
    return head;
  }
  return lines;
}
// Fit `text` into a box of width `boxW`: keep a single, CONSISTENT font size
// for every label (so no cause looks bigger/smaller than another) and wrap
// across up to `maxLines` lines to make long text fit instead of shrinking
// it. Only shrinks as a last resort, if even wrapping can't make it fit.
function fbFitBox(text, boxW, opts){
  const o=Object.assign({pad:14, baseSize:13, minSize:9.5, maxLines:2, charW:0.66, lineH:1.2}, opts||{});
  text=String(text||'').trim();
  const avail=Math.max(24, boxW-o.pad);
  const fs=o.baseSize;
  if(text.length*fs*o.charW<=avail) return {fontSize:fs, lines:[text], lineHeight:fs*o.lineH};
  const maxChars=Math.max(4,Math.floor(avail/(fs*o.charW)));
  const lines=fbWrapGeneric(text,maxChars,o.maxLines);
  if(lines.every(l=>l.length*fs*o.charW<=avail)) return {fontSize:fs, lines, lineHeight:fs*o.lineH};
  for(let fs2=fs-0.5; fs2>=o.minSize; fs2-=0.5){
    const maxChars2=Math.max(4,Math.floor(avail/(fs2*o.charW)));
    const lines2=fbWrapGeneric(text,maxChars2,o.maxLines);
    if(lines2.every(l=>l.length*fs2*o.charW<=avail)) return {fontSize:fs2, lines:lines2, lineHeight:fs2*o.lineH};
  }
  const fsMin=o.minSize, maxCharsMin=Math.max(4,Math.floor(avail/(fsMin*o.charW)));
  return {fontSize:fsMin, lines:fbWrapGeneric(text,maxCharsMin,o.maxLines), lineHeight:fsMin*o.lineH};
}
// Evenly spread n points along the usable middle span of a bone (leaving
// a little clearance near the spine and near the category label box).
function fbSpreadT(n){
  if(n<=1) return [0.56];
  const startFrac=0.14, endFrac=0.82, out=[];
  for(let i=0;i<n;i++) out.push(startFrac + i*(endFrac-startFrac)/(n-1));
  return out;
}
const FISHBONE_BRANCH_DEFS = [
  {key:'man',         side:'top',    lane:0},
  {key:'machine',     side:'top',    lane:1},
  {key:'material',    side:'top',    lane:2},
  {key:'method',      side:'bottom', lane:0},
  {key:'measurement', side:'bottom', lane:1},
  {key:'environment', side:'bottom', lane:2},
];
function fishboneBranchDefs(){
  return FISHBONE_BRANCH_DEFS.map(b=>{
    const st=fbStyle(b.key);
    return Object.assign({},b,{label:st.label, icon:st.icon, color:st.color});
  });
}
// Fishbone canvas: 802 units of fixed margins/head + 2 lane gaps. At the full design
// (LANE 380) that is 1562 units, drawn at FISHBONE_PX_PER_UNIT CSS px per unit. When the
// container is narrower the lanes tighten (down to FISHBONE_LANE_MIN); below that the SVG keeps
// its natural CSS size and the card scrolls sideways, so the text never shrinks with the window
// and always follows browser zoom. `availUnits` = container width / FISHBONE_PX_PER_UNIT.
const FISHBONE_PX_PER_UNIT = 0.88, FISHBONE_LANE_MAX = 380, FISHBONE_LANE_MIN = 280, FISHBONE_FIXED_W = 802;
function buildFishboneSvg(item, availUnits){
  const causes=item.causes||{};
  const laneFor = Number.isFinite(availUnits) ? Math.floor((availUnits - FISHBONE_FIXED_W) / 2) : FISHBONE_LANE_MAX;
  const LANE=Math.max(FISHBONE_LANE_MIN, Math.min(FISHBONE_LANE_MAX, laneFor)), TIP_DX=-160, ROW_GAP=56, BOX_H=42;
  const anchors=[210, 210+LANE, 210+LANE*2];
  const spineX1=30, spineX2=anchors[2]+260;
  const headW=232;
  const availCauseW=LANE-130; // horizontal room before the next lane / head box

  // Pre-fit every cause label (per branch) so we know how tall each side
  // of the diagram actually needs to be before we draw anything.
  const branchData=fishboneBranchDefs().map(b=>{
    const list=fbList(causes[b.key]);
    const items=(list.length?list:['No cause on file']).map(txt=>({
      text:txt, missing:!list.length,
      fit:fbFitBox(txt, availCauseW, {baseSize:14, minSize:9.5, maxLines:(LANE<FISHBONE_LANE_MAX?5:3), charW:0.64})
    }));
    return Object.assign({}, b, {anchorX:anchors[b.lane], items});
  });
  const nMax=side=>Math.max(1,...branchData.filter(b=>b.side===side).map(b=>b.items.length));
  const tipDyFor=n=>Math.max(150, Math.round(ROW_GAP*(n-1)+90));
  const TIP_DY_TOP=tipDyFor(nMax('top')), TIP_DY_BOT=tipDyFor(nMax('bottom'));

  const spineY=TIP_DY_TOP+BOX_H+26;
  const H=spineY+TIP_DY_BOT+BOX_H+26;
  const W=spineX2+headW+30;

  const _fbTag = svgDepthTag();
  const branchDefs = svgDepthDefs(branchData.map(b => b.color), _fbTag);
  const fbHeadGrad = `<linearGradient id="fbHeadGrad-${_fbTag}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--fb-head);stop-opacity:1"/><stop offset="100%" style="stop-color:var(--fb-head);stop-opacity:.82"/></linearGradient>`;
  // A simple, static fish silhouette (body + tail) scaled to the diagram's own box and
  // held at very low opacity — a nod to the classic "fishbone" shape without competing
  // with the live data drawn on top of it.
  const wmCx = spineX1 + (spineX2 - spineX1) * 0.52, wmCy = spineY, wmRx = (spineX2 - spineX1) * 0.46, wmRy = Math.min(TIP_DY_TOP, TIP_DY_BOT) * 0.82;
  const watermark = `<g fill="var(--fb-spine)" fill-opacity=".05"><ellipse cx="${wmCx}" cy="${wmCy}" rx="${wmRx}" ry="${wmRy}"/><polygon points="${spineX1+8},${wmCy} ${spineX1-70},${wmCy-wmRy*0.55} ${spineX1-70},${wmCy+wmRy*0.55}"/></g>`;
  let svg=`<defs>${branchDefs.replace('<defs>','').replace('</defs>','')}${fbHeadGrad}</defs>${watermark}`;
  svg+=`<line x1="${spineX1}" y1="${spineY}" x2="${spineX2}" y2="${spineY}" stroke="var(--fb-spine)" stroke-width="3"/>`;
  svg+=`<polygon points="${spineX2},${spineY} ${spineX2-20},${spineY-13} ${spineX2-20},${spineY+13}" fill="var(--fb-spine)"/>`;

  // ---- head box (the defect / effect) ----
  const headFit=fbFitBox(item.defect, headW, {pad:22, baseSize:16, minSize:9, maxLines:4, charW:0.66, lineH:1.2});
  const headH=Math.max(80, 30+headFit.lines.length*headFit.lineHeight+18);
  const headY=spineY-headH/2;
  svg+=`<rect x="${spineX2}" y="${headY}" width="${headW}" height="${headH}" rx="12" fill="url(#fbHeadGrad-${_fbTag})" filter="${svgLift(_fbTag)}"/>`;
  const hMidOffset=(headFit.lines.length-1)*headFit.lineHeight/2;
  svg+=headFit.lines.map((ln,i)=>`<text x="${spineX2+headW/2}" y="${spineY - hMidOffset + i*headFit.lineHeight + 5}" font-size="${headFit.fontSize}" font-weight="800" fill="#fff" text-anchor="middle">${escQcr(ln)}</text>`).join('');

  // ---- 6 angled bones, each carrying every cause for that branch ----
  branchData.forEach(b=>{
    const TIP_DY = b.side==='top' ? TIP_DY_TOP : TIP_DY_BOT;
    const tipX=b.anchorX+TIP_DX, tipY = b.side==='top' ? spineY-TIP_DY : spineY+TIP_DY;
    const dx=tipX-b.anchorX, dy=tipY-spineY;
    const len=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/len, uy=dy/len;
    let px=-uy, py=ux; if(px<0){ px=uy; py=-ux; } // perpendicular leaning toward the head (right)
    svg+=`<line x1="${b.anchorX}" y1="${spineY}" x2="${tipX}" y2="${tipY}" stroke="${b.color}" stroke-width="2.5"/>`;
    svg+=`<circle cx="${b.anchorX}" cy="${spineY}" r="4" fill="${b.color}"/>`;
    const ts=fbSpreadT(b.items.length);
    b.items.forEach((it,i)=>{
      const t=ts[i];
      const bx=b.anchorX+dx*t, by=spineY+dy*t;
      const ex=bx+px*14, ey=by+py*14;
      svg+=`<line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${it.missing?'var(--fb-cause-muted-line)':b.color}" stroke-width="1.5"/>`;
      const anchor = px>=0 ? 'start':'end';
      const tx = ex + (px>=0?5:-5);
      const {fontSize,lines,lineHeight}=it.fit;
      const midOffset=(lines.length-1)*lineHeight/2;
      lines.forEach((ln,li)=>{
        svg+=`<text x="${tx}" y="${ey - midOffset + li*lineHeight + 4}" font-size="${fontSize}" font-weight="${it.missing?'600':'700'}" font-style="${it.missing?'italic':'normal'}" fill="${it.missing?'var(--fb-cause-muted)':'var(--fb-cause-text)'}" text-anchor="${anchor}">${escQcr(ln)}</text>`;
      });
    });
    const boxW=176,boxX=tipX-boxW/2, boxY=b.side==='top'?tipY-BOX_H:tipY;
    svg+=`<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${BOX_H}" rx="10" fill="${svgFill(b.color, _fbTag)}" filter="${svgLift(_fbTag)}"/>`;
    svg+=`<text x="${tipX}" y="${boxY+BOX_H/2+6}" font-size="17" font-weight="800" fill="#fff" text-anchor="middle">${b.icon} ${b.label}</text>`;
  });
  const SHIFT_X=70; // nudge the whole diagram right within its frame, per feedback
  const natW=Math.round((W+SHIFT_X)*FISHBONE_PX_PER_UNIT);
  return `<svg class="chart-svg fishbone-svg" viewBox="0 0 ${W+SHIFT_X} ${H}" style="--fb-natural-w:${natW}px" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${SHIFT_X},0)">${svg}</g></svg>`;
}
function dashRenderFishboneDiagram(item){
  const el=document.getElementById('dashFishboneDiagram'); if(!el) return;
  chartRemember(el, ()=>dashRenderFishboneDiagram(item));
  if(!item){ el.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  if(!item.matched){
    el.innerHTML=`<div class="qcr-empty">No 6M Fishbone mapping found for <b>${escQcr(item.defect)}</b> yet. Ask an admin to import/update the 6M Fishbone Master, or add a defect mapping in Admin → 6M Fishbone Analysis.</div>`;
    return;
  }
  const note = item.match_type==='fuzzy' ? `<div class="qcr-fb-note">Matched to master defect "${escQcr(item.matched_defect)}" (closest match, ${Math.round((item.confidence||0)*100)}% confidence). If this looks wrong, fix it in Admin → 6M Fishbone Analysis.</div>` : '';
  // Dashboard tab shows the fishbone diagram only — the detailed RCA
  // (5-Why / root cause / action) table stays exclusive to the QCR tab.
  const cw = chartAvailWidth(el);
  el.innerHTML = `${note}${buildFishboneSvg(item, cw ? cw / FISHBONE_PX_PER_UNIT : undefined)}`;
}
function dashLoadFishbone(topDefects){
  const chipsEl=document.getElementById('dashFishboneChips'), diagEl=document.getElementById('dashFishboneDiagram');
  if(!chipsEl || !diagEl) return;
  const names=(topDefects||[]).map(r=>r.defect).filter(n=>n && n!=='—').slice(0,5);
  if(!names.length){ chipsEl.innerHTML=''; diagEl.innerHTML='<div class="qcr-empty">No defect data available for the current selection.</div>'; return; }
  diagEl.innerHTML='<div class="qcr-empty">Loading 6M fishbone analysis…</div>';
  fetch('/api/fishbone?defects='+encodeURIComponent(names.join('|')),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error) throw new Error(d.error);
    if(d.style) FISHBONE_STYLE=Object.assign({},FISHBONE_STYLE,d.style);
    dashFishboneData=d;
    dashRenderFishboneChips(d.items||[]);
    dashRenderFishboneDiagram((d.items||[])[0]);
  }).catch(()=>{ diagEl.innerHTML='<div class="qcr-empty">6M fishbone data unavailable.</div>'; });
}
document.getElementById('dashFishboneChips')?.addEventListener('click',e=>{
  const b=e.target.closest('.qcr-fishbone-chip'); if(!b)return;
  document.querySelectorAll('#dashFishboneChips .qcr-fishbone-chip').forEach(x=>x.classList.toggle('active',x===b));
  dashRenderFishboneDiagram((dashFishboneData.items||[])[Number(b.dataset.idx||0)]);
});
function qcrRenderHealthReasons(intel){
  const btn=document.getElementById('qcrHealthWhyBtn'), box=document.getElementById('qcrHealthReasons'); if(!btn||!box)return;
  const reasons=Array.isArray(intel?.health_score?.reasons)?intel.health_score.reasons:[];
  if(!reasons.length){btn.classList.add('qcr-hidden'); box.classList.add('qcr-hidden'); box.innerHTML=''; return;}
  btn.classList.remove('qcr-hidden'); btn.textContent='Why? ▾'; box.classList.add('qcr-hidden');
  box.innerHTML=reasons.map(r=>{const n=Math.abs(Number(r[1]||0));return `<span class="negative">-${n.toFixed(1)} pts <b>${escQcr(r[0])}</b></span>`;}).join('');
}
function qcrRenderComparison(rows){
  const el=document.getElementById('qcrComparison'); if(!rows.length){el.innerHTML='<div class="qcr-empty">Monthly comparison is not available.</div>';return;}
  const cur=rows[rows.length-1], prev=rows.length>1?rows[rows.length-2]:null;
  const metrics=[['Defect %','defect_pct',true,'lower'],['First Pass Yield % (Prime%)','first_pass_yield_pct',true,'higher'],['Reject % Qty','reject_pct_qty',true,'lower'],['Output Qty (MT)','output_qty',false,'higher'],['Coils','coils',false,'higher']];
  const cell=(m,row)=>m[2] ? (Number(row?.[m[1]]||0)*100).toFixed(2)+'%' : Number(row?.[m[1]]||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const delta=(m)=>{if(!prev)return '—'; const a=Number(prev[m[1]]||0),b=Number(cur[m[1]]||0),diff=b-a; if(m[2]){const pp=diff*100; const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(pp)<0.005?'equal':good?'good':'bad'}">${pp>=0?'+':''}${pp.toFixed(2)} pp ${Math.abs(pp)<0.005?'→':good?'↑':'↓'}</span>`;} const good=m[3]==='higher'?diff>0:diff<0; return `<span class="qcr-delta ${Math.abs(diff)<0.000001?'equal':good?'good':'bad'}">${diff>=0?'+':''}${diff.toFixed(2)} ${Math.abs(diff)<0.000001?'→':good?'↑':'↓'}</span>`;};
  el.innerHTML=`<table class="qcr-compare"><thead><tr><th>Metric</th><th>${escQcr(prev?prev.name:'Previous')}</th><th>${escQcr(cur.name)}</th><th>Change</th></tr></thead><tbody>${metrics.map(m=>`<tr><td>${m[0]}</td><td>${prev?cell(m,prev):'—'}</td><td>${cell(m,cur)}</td><td>${delta(m)}</td></tr>`).join('')}</tbody></table>`;
}
const qcrCoreCache = new Map();
window.qcrLoadToken=0;
function qcrCacheKey(filters){ return new URLSearchParams(filters).toString(); }
function qcrSessionKey(filters){ return 'qcr_last_good_v28_' + qcrCacheKey(filters); }
async function fetchQcrCore(filters, signal){
  const key=qcrCacheKey(filters); const cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return cached.data;
  const params=new URLSearchParams(filters).toString();
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch('/api/qcr?'+params+'&_qcr=28&_attempt='+(attempt+1),{signal,cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
      let data=null;
      try{data=await r.json();}catch(e){throw new Error('QCR server returned invalid JSON (HTTP '+r.status+')');}
      if(!r.ok || data?.error) throw new Error(data?.error || ('QCR request failed (HTTP '+r.status+')'));
      if(!data || !data.k || !data.d || !data.w){throw new Error('QCR response is incomplete');}
      qcrCoreCache.set(key,{ts:Date.now(),data});
      try{sessionStorage.setItem(qcrSessionKey(filters),JSON.stringify({ts:Date.now(),data}));}catch(_){}
      return data;
    }catch(e){
      if(e.name==='AbortError') throw e;
      lastError=e;
      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  // A transient API failure must never turn a working QCR into a blank screen.
  try{
    const saved=JSON.parse(sessionStorage.getItem(qcrSessionKey(filters))||'null');
    if(saved?.data?.k && saved?.data?.d && saved?.data?.w){
      qcrCoreCache.set(key,{ts:Date.now(),data:saved.data});
      return saved.data;
    }
  }catch(_){}
  throw lastError || new Error('Unable to load Control Room data');
}
function prefetchQcrCore(filters){
  const key=qcrCacheKey(filters), cached=qcrCoreCache.get(key);
  if(cached && (Date.now()-cached.ts)<30000) return;
  fetchQcrCore(filters).catch(()=>{});
}
function qcrRenderTrendPrediction(rows,d,w){
  const el=document.getElementById('qcrTrendPrediction'); if(!el)return;
  try{
    const valid=Array.isArray(rows)?rows.filter(r=>Number.isFinite(Number(r?.first_pass_yield_pct))):[];
    const recent=valid.slice(-4);
    if(recent.length<3){el.innerHTML='<div class="qcr-empty">Need at least 3 monthly periods for trend intelligence.</div>';return;}
    const fpy=recent.map(r=>Number(r.first_pass_yield_pct)||0), rej=recent.map(r=>Number(r.reject_pct_qty)||0);
    const slope=a=>{const n=a.length,xm=(n-1)/2,ym=a.reduce((x,y)=>x+y,0)/n,den=a.reduce((x,_,i)=>x+(i-xm)*(i-xm),0);return den? a.reduce((x,y,i)=>x+(i-xm)*(y-ym),0)/den:0;};
    const sf=slope(fpy),sr=slope(rej),deteriorating=sf<-0.001||sr>0.001,stable=!deteriorating&&Math.abs(sf)<0.0005&&Math.abs(sr)<0.0005;
    const status=deteriorating?'⚠️ Deteriorating Trend':stable?'✓ Stable Trend':'↕ Mixed Trend',cls=deteriorating?'bad':stable?'good':'amber',next=Math.max(0,Math.min(1,fpy[fpy.length-1]+sf));
    // Contributors (Grade/Defect/Work Center) are intentionally not repeated
    // here — they're already ranked in "Top Contributors" above.
    el.innerHTML=`<div class="qcr-intel-status ${cls}">${status}</div><div class="qcr-intel-main">FPY ${ (fpy[fpy.length-1]*100).toFixed(2)}% <span>→ projected ${(next*100).toFixed(2)}%</span></div><div class="qcr-intel-meta">Last ${recent.length} months: ${recent.map(r=>escQcr(r.name)).join(' → ')}</div><div class="qcr-intel-meta">${sf<0?'FPY is trending down.':'FPY is not declining.'} ${sr>0?'Reject % is increasing.':'Reject % is not increasing.'}</div>`;
  }catch(e){console.error('QCR trend intelligence',e);el.innerHTML='<div class="qcr-empty">Trend intelligence unavailable.</div>';}
}
document.getElementById('qcrRootCause')?.addEventListener('click',e=>{const b=e.target.closest('.qcr-root-link');if(!b)return; const container=document.getElementById('qcrRootCause'); const defect=container?.dataset.defect||''; openDrilldown('defect_category',`Root Cause: ${b.dataset.rootGrade||'—'} → ${b.dataset.rootWc||'—'}`,{drill_value:defect,grade:b.dataset.rootGrade||'All',work_center:b.dataset.rootWc||'All'});});
function loadRootCause(defect){
  const el=document.getElementById('qcrRootCause'); if(!el||!defect)return Promise.resolve(); el.innerHTML='<div class="qcr-empty">Loading root-cause path…</div>';
  // The defect this panel is currently showing has to be recoverable later
  // when a path button is clicked (see the click handler below) — stash it
  // on the container itself instead of relying on a CSS class that was
  // never actually present in the rendered markup.
  el.dataset.defect=defect;
  const p=new URLSearchParams(currentFilters);p.set('defect',defect); return fetch('/api/root_cause?'+p.toString(),{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d.error)throw new Error(d.error); const paths=d.paths||[]; const rec=d.records||[];
    const top=paths[0]; let html=`<div class="qcr-root-title">${escQcr(defect)}</div>`;
    if(top) html+=`<div class="qcr-root-path"><span>Defect<br><b>${escQcr(defect)}</b></span><i>→</i><span>Grade<br><b>${escQcr(top.grade)}</b></span><i>→</i><span>Work Center<br><b>${escQcr(top.work_center)}</b></span><i>→</i><span>Heat / Batch<br><b>${escQcr(rec[0]?.heat_no||'—')} / ${escQcr(rec[0]?.batch_no||'—')}</b></span></div>`;
    html+=`<div class="qcr-root-meta">Top contributing combinations — click to investigate records</div><div class="qcr-root-list">${paths.slice(0,6).map((x,i)=>`<button class="qcr-root-link" data-root-grade="${escQcr(x.grade)}" data-root-wc="${escQcr(x.work_center)}"><b>#${i+1} ${escQcr(x.grade)}</b><span>${escQcr(x.work_center)} • ${x.qty.toFixed(2)} MT • ${x.coils.toLocaleString()} coils</span></button>`).join('')}</div>`;
    el.innerHTML=html;
    // innerHTML replacement above wipes any dataset previously set on `el`
    // itself? No — dataset lives on the element node, not its innerHTML, so
    // it survives. Kept here as a defensive re-set in case that ever changes.
    el.dataset.defect=defect;
  }).catch(e=>{el.innerHTML='<div class="qcr-empty">Root-cause data unavailable.</div>';});
}
// NOTE: Grade Concentration and "Why changed?" used to also be computed here
// via extra client-side API calls. That logic is dead weight now — the
// consolidated intel endpoint (qcrRenderWhyDecomposition + the grade
// concentration block in loadControlRoom) already provides a richer version
// of the same insight, so the duplicate implementation was removed.
function escQcr(v){return String(v??'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function qcrRenderProblemFinder(intel, intelError){
  const el=document.getElementById('qcrProblemFinder'), count=document.getElementById('qcrProblemCount'); if(!el)return;
  // An intel_error means the engine that finds problems never actually ran
  // for this request — so there is no confirmed "no issues" result to
  // report. Saying "0 issues / ✓ No material quality problem detected" here
  // reads as a completed, reassuring analysis and directly contradicts the
  // Biggest Problem card showing "Analysis unavailable" right above it.
  if(intelError){
    if(count){count.textContent='Unavailable';}
    el.innerHTML='<div class="qcr-empty">⚠ Quality analysis could not run for this request (temporary error) — this is not a confirmed zero-issue result. Refresh to retry.</div>';
    return;
  }
  const all=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const rows=all.slice(0,5);
  const critCount=all.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const shownNote=all.length>rows.length?` · top ${rows.length} shown`:'';
  if(count)count.textContent=all.length?(critCount>0?`${critCount} critical issue${critCount===1?'':'s'}${shownNote}`:`${all.length} issue${all.length===1?'':'s'}${shownNote}`):'0 issues';
  if(!rows.length){el.innerHTML='<div class="qcr-empty">✓ No material quality problem detected for the current selection. Continue monitoring.</div>';return;}
  el.innerHTML=rows.map((x,i)=>{
    const sev=String(x.severity||'Observation').toUpperCase(); const conf=String(x.confidence||'MEDIUM').toUpperCase();
    const driver=x.driver_path||x.where||'—'; const change=x.change|| (x.impact_qty?`${Number(x.impact_qty).toFixed(2)} MT`:'—');
    return `<div class="qcr-problem-row ${sev.toLowerCase()}"><div class="qcr-problem-rank">${i+1}</div><div class="qcr-problem-main"><b>${escQcr(x.title||x.what||'Quality issue')}</b><span>${escQcr(x.detail||'Material quality signal detected.')}</span><div class="qcr-problem-fields"><span><small>DRIVER</small>${escQcr(driver)}</span><span><small>CHANGE</small>${escQcr(change)}</span><span><small>CONFIDENCE</small>${conf} · ${Number(x.records||0).toLocaleString()} records</span></div></div><div class="qcr-problem-action"><em class="qcr-severity-pill ${sev.toLowerCase()}">${sev}</em><button class="qcr-investigate-btn" type="button" data-qcr-where="${escQcr(x.where||'')}" data-qcr-grade="${escQcr(x.grade||'')}" data-qcr-defect="${escQcr(x.defect||'')}" data-qcr-period="${escQcr(x.period||'')}">Investigate →</button></div></div>`;
  }).join('');
}

function qcrRenderQualityStory(intel, intelError){
  // Where/Grade/Defect/Confidence used to repeat here as pill tags, but that's
  // the exact same info already shown in the "What Needs Attention" row right
  // above this card — dropped to avoid saying the same thing twice.
  const el=document.getElementById('qcrQualityStory');if(!el)return;
  if(intelError){
    // Surface the actual server-side error (truncated server-side to 240
    // chars already) instead of a generic message, so a recurring failure
    // is diagnosable from the page itself rather than requiring server logs.
    el.innerHTML=`<div class="qcr-story-label">📋 Quality Story</div><div class="qcr-story-text">Unavailable — the analysis engine hit a temporary error and will retry automatically on next refresh.</div><div class="qcr-story-text" style="margin-top:6px;font-family:monospace;font-size:11px;opacity:.65;">${escQcr(intelError)}</div>`;
    return;
  }
  const story=String(intel?.quality_story||'No quality story available.');
  el.innerHTML=`<div class="qcr-story-label">📋 Quality Story</div><div class="qcr-story-text">${escQcr(story)}</div>`;
}
function qcrRenderQualityImprovements(intel){
  // Compact single line under the Quality Story — no longer a whole extra
  // card of its own; the improvement names/details were the only new
  // information here, so we keep just that, in one line.
  const el=document.getElementById('qcrQualityImprovements');if(!el)return;const rows=Array.isArray(intel?.improvements)?intel.improvements:[];
  if(!rows.length){el.innerHTML='';return;}
  el.innerHTML=`<span class="qcr-improving-label">🟢 Improving:</span> `+rows.slice(0,3).map(x=>`<b>${escQcr(x.name||'Quality improvement')}</b> <small>(${escQcr(x.detail||'positive movement')})</small>`).join(' • ');
}
function qcrRenderWhyDecomposition(intel){
  // Trimmed to the two headline deltas + the one-line explanation — the
  // Grade/Defect/Work Center names it used to repeat here are already
  // ranked in "Top Contributors" above, so they're not re-listed.
  const el=document.getElementById('qcrWhyChanged');if(!el)return; const z=intel?.why_changed;
  if(!z||!z.current||!z.previous){el.innerHTML='<div class="qcr-empty">Previous period comparison is not available for this selection.</div>';return;}
  el.innerHTML=`<div class="qcr-why-grid"><div><b>FPY ${Number(z.fpy_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.fpy_change_pp||0)).toFixed(2)} pp</b></div><div><b>Reject ${Number(z.reject_change_pp||0)>=0?'↑':'↓'} ${Math.abs(Number(z.reject_change_pp||0)).toFixed(2)} pp</b></div></div><div class="qcr-story-text">${escQcr(z.statement||'')}</div>`;
}
function qcrInvestigation(extra={}, title='QCR Investigation'){
  const p={};
  Object.entries(extra||{}).forEach(([k,v])=>{
    if(v===undefined||v===null) return;
    const s=String(v).trim();
    if(!s || s==='—') return;
    // "month" is allowed through even when explicitly "All" — What Needs
    // Attention findings are computed independently of the currently
    // selected month filter, so an explicit month override (including a
    // reset to "All") must not be silently dropped, or the investigate
    // drilldown ends up combining a finding's Work Center/Grade/Defect with
    // an unrelated month and returns zero records.
    if(k!=='month' && s.toLowerCase()==='all') return;
    p[k]=v;
  });
  openDrilldown('quality_investigation',title,p);
}
function qcrWireProblemActions(){
  document.getElementById('qcrProblemFinder')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-investigate-btn'); if(!b)return;
    const defect=b.dataset.qcrDefect, where=b.dataset.qcrWhere, grade=b.dataset.qcrGrade, period=b.dataset.qcrPeriod;
    // Findings here are detected across the full trend history (independent
    // of whichever month happens to be selected on the page), so the
    // investigation must use the finding's own period rather than inherit
    // the page's current month filter — otherwise the two can point to
    // different months and the drilldown comes back empty.
    qcrInvestigation({work_center:where,grade,drill_value:defect,month:(period&&period!=='—'?period:'All')},`QCR Investigation — ${defect&&defect!=='—'?defect:'Quality issue'}`);
  });
  // Top Contributors: tab switching + investigate/root-cause wiring (event
  // delegation, since each tab's rows are re-rendered on every load).
  document.getElementById('qcrContribTabs')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-tab-btn'); if(!b)return;
    const tab=b.dataset.contribTab;
    document.querySelectorAll('#qcrContribTabs .qcr-tab-btn').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.qcr-tab-panel-c').forEach(p=>p.classList.toggle('qcr-hidden',p.dataset.contribPanel!==tab));
  });
  document.querySelector('.qcr-contrib-card')?.addEventListener('click',e=>{
    const b=e.target.closest('.qcr-contrib-btn'); if(!b)return;
    if(b.dataset.defect){ loadRootCause(b.dataset.defect); return; }
    if(b.dataset.qcrWc){ qcrInvestigation({work_center:b.dataset.qcrWc},`Work Center Investigation — ${b.dataset.qcrWc}`); return; }
    if(b.dataset.qcrGrade){ qcrInvestigation({grade:b.dataset.qcrGrade},`Grade Investigation — ${b.dataset.qcrGrade}`); return; }
  });
  // Quality Health "Why?" toggle in the executive strip (replaces the old
  // standalone Quality Health Score card — same reasons, one click away).
  document.getElementById('qcrHealthWhyBtn')?.addEventListener('click',()=>{
    const box=document.getElementById('qcrHealthReasons'); if(!box)return;
    const nowHidden=box.classList.toggle('qcr-hidden');
    const btn=document.getElementById('qcrHealthWhyBtn'); if(btn)btn.textContent=nowHidden?'Why? ▾':'Why? ▴';
  });
}
function qcrRenderTargetHistory(rows,target){
  const el=document.getElementById('qcrTargetHistory'); if(!el)return;
  if(!rows.length){el.innerHTML='<div class="qcr-empty">No historical monthly data available.</div>';return;}
  el.innerHTML=`<div class="qcr-target-summary">Target <b>${(Number(target||0)*100).toFixed(1)}%</b> • % Target Achieved shows how much of the target was reached each period (100% = target fully met)</div><div class="qcr-target-table"><table class="qcr-compare"><thead><tr><th>Period</th><th>Target</th><th>Actual</th><th>% Target Achieved</th><th>Gap</th></tr></thead><tbody>${rows.map(r=>{const a=Number(r.actual||0),t=Number(r.target||0),att=Number(r.attainment||0);const cls=att>=0.97?'good':att>=0.90?'amber':'bad';return `<tr><td>${escQcr(r.period)}</td><td>${(t*100).toFixed(1)}%</td><td>${(a*100).toFixed(2)}%</td><td><span class="qcr-delta ${cls}">${(att*100).toFixed(1)}%</span></td><td>${Number(r.gap_pp||0)>=0?'+':''}${Number(r.gap_pp||0).toFixed(2)} pp</td></tr>`}).join('')}</tbody></table></div>`;
}

function qcrRenderExecutive(intel, critical, comparisonRows, intelError){
  const health=intel?.health_score||{}; const h=Number(health.score||0); const pf=Array.isArray(intel?.problem_finder)?intel.problem_finder:[];
  const crit=pf.filter(x=>String(x.severity||'').toLowerCase()==='critical').length;
  const att=pf.filter(x=>String(x.severity||'').toLowerCase()==='attention').length;
  const top=pf[0];
  const prev=comparisonRows?.length>1?comparisonRows[comparisonRows.length-2]:null, cur=comparisonRows?.length?comparisonRows[comparisonRows.length-1]:null;
  let trend='●', trendText='Stable', trendClass='neutral';
  if(prev&&cur){const a=Number(prev.fpy||prev.fpy_pct||0),b=Number(cur.fpy||cur.fpy_pct||0);if(b<a){trend='▼';trendText='Quality declining';trendClass='bad';}else if(b>a){trend='▲';trendText='Quality improving';trendClass='good';}}
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const breaches=critical.filter(k=>qcrStatus(k.label,k.value)!=='good').length;
  // When the intelligence engine (health score / problem finder) failed to
  // compute for this request — e.g. a transient DB connection error — the
  // server still returns a well-formed but FAKE health_score of {score:0,
  // status:"amber"} and an empty problem_finder, purely so the rest of the
  // payload isn't blanked. Rendering that as-is looks like a real, confident
  // "0/100, Attention, No material issue" result, which directly contradicts
  // the Target Breaches count (computed independently from real KPI data)
  // sitting right next to it. Surface the failure honestly instead of
  // presenting fabricated numbers as if they were a real analysis.
  if(intelError){
    set('qcrExecHealth','—/100');set('qcrExecHealthState','Unavailable');
    set('qcrExecCritical','—');set('qcrExecBreaches',breaches);
    set('qcrExecProblem','Analysis unavailable');set('qcrExecDriver',(String(intelError).slice(0,90))||'Temporary error — refresh to retry');
    set('qcrExecTrend','●');set('qcrExecTrendText','Unavailable');
    const trendEl=document.getElementById('qcrExecTrend'); if(trendEl)trendEl.className='qcr-trend-symbol neutral';
    return;
  }
  set('qcrExecHealth',`${h.toFixed(0)}/100`);set('qcrExecHealthState',health.status==='good'?'Healthy':health.status==='bad'?'Critical':'Attention');set('qcrExecCritical',crit);set('qcrExecBreaches',breaches);set('qcrExecProblem',top?.title||'No material issue');set('qcrExecDriver',top?.driver_path||top?.where||'Continue monitoring');set('qcrExecTrend',trend);set('qcrExecTrendText',trendText);
  const trendEl=document.getElementById('qcrExecTrend'); if(trendEl)trendEl.className='qcr-trend-symbol '+trendClass;
}
async function loadControlRoom(signal){
  const filterSnapshot={...currentFilters};
  const params=new URLSearchParams(filterSnapshot).toString();
  try{
    const data=await fetchQcrCore(filterSnapshot,signal); const {k,d,w,m,fr}=data;
    document.getElementById('qcrFreshness').textContent=`Data Through: ${fr.data_through_display||'—'} • Filtered Records: ${Number(fr.filtered_records||0).toLocaleString()}`;
    const dssThrough=document.getElementById('statusDataThrough'); if(dssThrough) dssThrough.textContent=fr.data_through_display||'—';
    const criticalLabels=['First Pass Yield % (Prime%)','Defect Rate','Reject % Qty','Hold for Decision % Qty','Salvage % Qty','Rework % Qty'];
    const critical=(k.kpis||[]).filter(x=>criticalLabels.includes(x.label));
    // Worst-first ordering + inline target/gap folds in what used to be a
    // separate "KPI Target Intelligence" ranking card — same numbers, one place.
    const qcrStatusOrder={bad:0,amber:1,good:2,neutral:3};
    const criticalSorted=[...critical].sort((a,b)=>(qcrStatusOrder[qcrStatus(a.label,a.value)]??3)-(qcrStatusOrder[qcrStatus(b.label,b.value)]??3));
    const qcrGrid=document.getElementById('qcrCriticalKpis');
    const nextQcrValues=new Map(); qcrGrid.innerHTML='';
    criticalSorted.forEach(x=>{
      const st=qcrStatus(x.label,x.value), cur=Number(x.value)||0, old=window.qcrPreviousKpiValues?.get(x.label);
      const changed=Number.isFinite(old)&&Math.abs(old-cur)>1e-12;
      const card=document.createElement('div'); card.className='qcr-kpi';
      const cfg=KPI_TARGETS[x.label];
      const targetLine=(cfg&&cfg.target!=null)?`<div class="qcr-kpi-target">Target ${qcrTargetText(x.label)} • Gap ${((cur-Number(cfg.target))*100)>=0?'+':''}${((cur-Number(cfg.target))*100).toFixed(2)} pp</div>`:'';
      card.innerHTML=`<div class="qcr-kpi-name">${KPI_ICONS[x.label]||'📊'} ${escQcr(x.label)}</div><div class="qcr-kpi-value ${st}">${qcrFmtKpi(x)}</div>${targetLine}<span class="qcr-status ${st}">${st==='good'?'ON TARGET':st==='amber'?'WATCH':st==='bad'?'CRITICAL':'REFERENCE'}</span>`;
      qcrGrid.appendChild(card); nextQcrValues.set(x.label,cur);
      if(changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const el=card.querySelector('.qcr-kpi-value'); el.classList.add(cur>old?'value-change-up':'value-change-down');
        animateKpiValue(el,old,cur,x.fmt,++qcrAnimationToken); setTimeout(()=>el.classList.remove('value-change-up','value-change-down'),700);
      }
    });
    window.qcrPreviousKpiValues=nextQcrValues;

    // Overall Quality Status: target breaches + reject/FPY + major concentration signals.
    const badKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='bad').length;
    const amberKpis=critical.filter(x=>qcrStatus(x.label,x.value)==='amber').length;
    const maxWc=Math.max(0,...(w.by_work_center||[]).map(x=>Number(x.reject_pct_qty)||0));
    const maxGr=Math.max(0,...(w.by_grade||[]).map(x=>Number(x.reject_pct_qty)||0));
    const topDefPct=d.totals?.qty ? Number((d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>b.qty-a.qty)[0]?.qty||0)/Number(d.totals.qty) : 0;
    let overall='STABLE', overallClass='good';
    if(badKpis>0 || maxWc>0.05 || maxGr>0.05 || topDefPct>=0.35){ overall='CRITICAL'; overallClass='bad'; }
    else if(amberKpis>0 || maxWc>0.03 || maxGr>0.03 || topDefPct>=0.25){ overall='ATTENTION REQUIRED'; overallClass='amber'; }
    const qs=document.getElementById('qcrQualityStatus'); if(qs){qs.className='qcr-quality-status '+overallClass;qs.querySelector('strong').textContent=overall;}

    const defectTotalQty=Number(d.totals?.qty||0); const topDefects=(d.register||[]).filter(x=>Number(x.qty||0)>0).sort((a,b)=>Number(b.qty||0)-Number(a.qty||0)).slice(0,5);
    const worstWc=[...(w.by_work_center||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    const worstGr=[...(w.by_grade||[])].filter(x=>Number(x.coils||0)>0).sort((a,b)=>Number(b.reject_pct_qty||0)-Number(a.reject_pct_qty||0)).slice(0,5);
    // All QCR intelligence is now returned by the consolidated endpoint so these
    // sections never depend on a chain of secondary browser requests.
    qcrRenderComparison((m&&m.rows)||[]);
    qcrRenderExecutive(data?.intel||{},critical,(m&&m.rows)||[],data?.intel_error||'');
    qcrRenderTrendPrediction((m&&m.rows)||[],d,w);
    fetch('/api/qcr_target_history?'+params,{signal}).then(r=>r.json()).then(th=>{if(!th.error){qcrRenderTargetHistory(th.rows||[],th.target); scheduleQcrLayout();}}).catch(()=>{});
    const intel=data?.intel||{}; const intelErr=data?.intel_error||'';
    qcrRenderProblemFinder(intel,intelErr);
    qcrRenderQualityStory(intel,intelErr);
    qcrRenderQualityImprovements(intel);
    qcrRenderWhyDecomposition(intel);
    qcrRenderHealthReasons(intel);
    qcrRenderTopContributors(topDefects,defectTotalQty,worstWc,worstGr,intel);
    const loadToken=++window.qcrLoadToken;
    if(topDefects[0]?.defect) loadRootCause(topDefects[0].defect).finally(scheduleQcrLayout);

    markChartsReady();
    scheduleQcrLayout();
  }catch(e){
    if(e.name!=='AbortError'){
      console.error('QCR load failed',e);
      const msg=String(e?.message||'Unable to load Control Room data');
      const ids=['qcrProblemFinder','qcrQualityStory','qcrQualityImprovements','qcrCriticalKpis','qcrContribDefect','qcrContribWc','qcrContribGrade','qcrComparison','qcrWhyChanged','qcrTrendPrediction','qcrTargetHistory'];
      ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="qcr-empty">Unable to load this QCR section. <span class="qcr-error-detail">'+escQcr(msg)+'</span></div>';});
      const root=document.getElementById('qcrRootCause');if(root)root.innerHTML='<div class="qcr-empty">Root-cause data unavailable until QCR data reconnects.</div>';
      const qs=document.getElementById('qcrQualityStatus');if(qs){qs.className='qcr-quality-status amber';const st=qs.querySelector('strong');if(st)st.textContent='UNAVAILABLE';}
    }
  }
}

// ---------- QCR stable layout ----------
// QCR uses native CSS grid only. No JS card positioning is used; this keeps
// the tab responsive and prevents ResizeObserver/layout feedback loops.
function scheduleQcrLayout(){ return; }

// ---------- Tab switching ----------
const TAB_LOADERS = {
  dashboard: loadKpis,
  controlroom: loadControlRoom,
  wcgrade: loadWcGrade,
  defects: loadDefectAnalysis,
  weekly: loadPeriodTrend,
};

// Switching tabs must always start the new tab from the top. Without this the previous
// tab's scroll offset carried over (the page is one long scroller shared by every panel).
// The browser's own back/forward scroll restoration is switched off too, otherwise it
// re-applies the old offset right after our popstate handler has scrolled to the top.
try{ if('scrollRestoration' in history) history.scrollRestoration='manual'; }catch(e){}
function resetPageScroll(){
  const de=document.documentElement, prev=de.style.scrollBehavior;
  de.style.scrollBehavior='auto';                      // no smooth-scroll animation: jump straight to the top
  try{ window.scrollTo(0,0); }catch(e){}
  de.scrollTop=0; if(document.body) document.body.scrollTop=0;
  de.style.scrollBehavior=prev;
}
async function activateTab(tabName, fromHistory, opts){
  if(_analyticsPresentationState) closeAnalyticsPresentation();
  fetch("/api/activity/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"tab_open",tab:tabName,filters:currentFilters})}).catch(()=>{});
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + tabName));
  if(!(opts && opts.keepScroll)) resetPageScroll();
  showSkeletons(tabName);
  if(!fromHistory) writeUrlState(true); // fromHistory=true means popstate already changed the URL; don't push again
  try { await TAB_LOADERS[tabName](signal); if(tabName==='controlroom') scheduleQcrLayout(); finishTabLoad(tabName); } catch(e) { finishTabLoad(tabName, e); }
}
// Skeleton loaders: a shimmering placeholder shaped like a chart/table shows
// immediately when a tab becomes visible, replaced automatically the moment
// its real content is rendered (every chart/table function overwrites the
// container's innerHTML, so there's nothing to explicitly tear down here).
// Only fills containers that are genuinely empty — a filter-triggered
// refresh of an already-loaded tab keeps its existing dim/fade treatment
// (see triggerFilterRefresh) instead of flashing back to a skeleton.
// Error state for a tab whose data could not be loaded. Without this the shimmering placeholders
// above stayed on screen forever ("loading forever") while the real error only went to the console.
function clearTabError(tabName){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  panel.querySelector(':scope > .tab-load-error')?.remove();
}
function showTabError(tabName, err){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  const raw=(err&&err.message)?String(err.message):'';
  const msg=raw && !/^(Unexpected token|JSON|Failed to fetch|NetworkError|Load failed)/i.test(raw) ? raw : 'The server did not respond correctly. Check your connection and try again.';
  panel.querySelectorAll('.skeleton-chart').forEach(el=>{ el.outerHTML='<div class="load-error-inline">⚠️ Chart unavailable</div>'; });
  panel.querySelectorAll('.table-scroll tbody').forEach(tb=>{
    if(tb.querySelector('.skeleton-row')){
      const cols=tb.closest('table')?.querySelectorAll('thead th').length||6;
      tb.innerHTML=`<tr class="load-error-row"><td colspan="${cols}">⚠️ Table unavailable</td></tr>`;
    }
  });
  let b=panel.querySelector(':scope > .tab-load-error');
  if(!b){ b=document.createElement('div'); b.className='tab-load-error'; b.setAttribute('role','alert'); panel.prepend(b); }
  b.innerHTML=`<span>⚠️ <b>Couldn't load this view.</b> ${escQcr(msg)}</span><button type="button" class="tab-retry-btn">↻ Retry</button>`;
  b.querySelector('.tab-retry-btn').addEventListener('click',()=>{
    b.remove();
    panel.querySelectorAll('.load-error-inline').forEach(el=>{ el.parentElement && (el.parentElement.innerHTML=''); });
    panel.querySelectorAll('tbody .load-error-row').forEach(tr=>{ tr.closest('tbody').innerHTML=''; });
    activateTab(tabName, true, {keepScroll:true});
  });
}
// Called after every tab load attempt: shows the error state on failure, and also when a loader
// "succeeded" but left placeholders behind (nothing was ever rendered).
function finishTabLoad(tabName, err){
  if(err && err.name==='AbortError') return;
  if(err){ console.error(err); showTabError(tabName, err); return; }
  const panel=document.getElementById('tab-'+tabName);
  if(panel && panel.querySelector('.skeleton-chart,.skeleton-row')) showTabError(tabName, new Error('No data was returned for this view.'));
  else { clearTabError(tabName); setRefreshed(); }
}
const SKELETON_BAR_HEIGHTS=[58,88,42,96,68,52,80,64];
function showSkeletons(tabName){
  const panel=document.getElementById('tab-'+tabName); if(!panel) return;
  panel.querySelectorAll('.chart-scroll').forEach(c=>{
    if(!c.children.length) c.innerHTML=`<div class="skeleton-chart">${SKELETON_BAR_HEIGHTS.map(h=>`<div class="skeleton-bar" style="height:${h}%"></div>`).join('')}</div>`;
  });
  panel.querySelectorAll('.table-scroll tbody').forEach(tb=>{
    if(!tb.children.length){
      const cols=tb.closest('table')?.querySelectorAll('thead th').length||6;
      tb.innerHTML=Array.from({length:5}).map(()=>`<tr class="skeleton-row"><td colspan="${cols}"><div class="skeleton-line" style="width:${60+Math.random()*35|0}%"></div></td></tr>`).join('');
    }
  });
}
// Back/forward buttons: restore whichever tab+filters that history entry
// represents. history.state carries the exact filters we pushed; a manually
// edited/shared URL (no state, e.g. after a fresh navigation) falls back to
// re-parsing the query string.
window.addEventListener('popstate', (e)=>{
  const restored = e.state || readUrlState();
  const filters = restored.filters || {};
  FILTER_DEFS.forEach(f=>{ currentFilters[f.key] = filters[f.key] || "All"; });
  syncFilterUiFromState();
  activateTab(restored.tab || 'dashboard', true);
});

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if(!btn) return;
  activateTab(btn.dataset.tab);
});

const VISITOR_ID_KEY = "qdash_visitor_id_v1";
function getVisitorId(){
  try{
    let id=localStorage.getItem(VISITOR_ID_KEY);
    if(!id){id=(crypto&&crypto.randomUUID)?crypto.randomUUID():"v-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,12);localStorage.setItem(VISITOR_ID_KEY,id);}
    return id;
  }catch(e){return "v-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,12);}
}
async function sendLiveHeartbeat(){
  try{
    const visitor_id=getVisitorId();
    const tab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    await fetch('/api/activity/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitor_id,tab}),keepalive:true});
  }catch(e){}
}
async function refreshLiveUsers(){
  try{
    const r=await fetch('/api/activity/live',{cache:'no-store'}); const d=await r.json();
    const el=document.getElementById('liveUsersCount'); if(el) el.textContent=Number(d.active_users||0).toLocaleString();
  }catch(e){}
}
function startLiveUserTracking(){
  sendLiveHeartbeat(); refreshLiveUsers();
  setInterval(()=>{if(document.visibilityState==='visible'){sendLiveHeartbeat();refreshLiveUsers();}},30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){sendLiveHeartbeat();refreshLiveUsers();}});
}

function formatClockTime(date, withSeconds=true){
  const d = date instanceof Date ? date : new Date(date);
  if(Number.isNaN(d.getTime())) return '—';
  let h=d.getHours();
  const ampm=h>=12?'PM':'AM';
  h=h%12||12;
  const hh=String(h).padStart(2,'0');
  const mm=String(d.getMinutes()).padStart(2,'0');
  const ss=String(d.getSeconds()).padStart(2,'0');
  return withSeconds ? `${hh}:${mm}:${ss} ${ampm}` : `${hh}:${mm} ${ampm}`;
}
function formatDateTime12(date, withSeconds=true){
  const d=date instanceof Date ? date : new Date(date);
  if(Number.isNaN(d.getTime())) return String(date||'—');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const datePart=`${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  return `${datePart} • ${formatClockTime(d,withSeconds)}`;
}
function updateDigitalClock(){
  const now = new Date();
  const el=document.getElementById('digitalClock');
  if(el) el.textContent=formatClockTime(now,true);
  const dateEl=document.getElementById('digitalClockDate');
  if(dateEl){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    dateEl.textContent=`${days[now.getDay()]}, ${String(now.getDate()).padStart(2,'0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
}
let _digitalClockTimer=null;
function startDigitalClock(){
  updateDigitalClock();
  if(_digitalClockTimer) clearInterval(_digitalClockTimer);
  _digitalClockTimer=setInterval(()=>{
    if(document.visibilityState==='visible') updateDigitalClock();
  },1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') updateDigitalClock();},{passive:true});
}
// "Last Updated" (header, top-left of the meta block) used to show a static absolute
// date+time set once at page load and never touched again — identical in shape to the
// digital clock next to it, and stale after the first filter change since nothing ever
// called this again. It's now driven by every real data refresh and rendered as relative
// time ("2 min ago"), with the exact date+time kept as a hover tooltip, so it reads as a
// distinct "when was this data last refreshed" signal instead of a second clock.
let _lastRefreshedAt=null;
function timeAgoShort(date){
  const d=date instanceof Date?date:new Date(date);
  if(Number.isNaN(d.getTime())) return '—';
  const diff=Math.max(0,Date.now()-d.getTime()), m=Math.floor(diff/60000);
  if(m<1) return 'Just now';
  if(m<60) return `${m} min ago`;
  const h=Math.floor(m/60);
  if(h<24) return `${h} hr ago`;
  return formatDateTime12(d,false);
}
function renderLastUpdatedLabel(){
  if(!_lastRefreshedAt) return;
  const el=document.getElementById("refreshed");
  if(el){ el.textContent=timeAgoShort(_lastRefreshedAt); el.title=formatDateTime12(_lastRefreshedAt,true); }
  // Data Status Strip mirrors the same "when did this session's data last
  // change" signal, so the two never drift out of sync.
  const s=document.getElementById("statusLastRefreshed");
  if(s){ s.textContent=timeAgoShort(_lastRefreshedAt); s.title=formatDateTime12(_lastRefreshedAt,true); }
}
function setRefreshed(){
  _lastRefreshedAt = new Date();
  renderLastUpdatedLabel();
  const live=document.getElementById("liveLabel");
  if(live) live.textContent = "LIVE DATA";
}
setInterval(()=>{ if(document.visibilityState==='visible') renderLastUpdatedLabel(); }, 30000);

function initHeaderMotion(){
  const header=document.querySelector('header.app-header');
  if(!header) return;

  const root=document.documentElement;
  const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const syncStickyOffset=()=>{
    const h=Math.ceil(header.getBoundingClientRect().height);
    root.style.setProperty('--header-sticky-offset', `${h}px`);
  };
  const applyScrollState=()=>{
    const next=window.scrollY > 18;
    if(header.classList.contains('is-scrolled')===next) return;
    header.classList.toggle('is-scrolled', next);
    // Padding changes the real sticky box height; refresh the filter offset after
    // the browser applies the class so filters never cover the header.
    requestAnimationFrame(syncStickyOffset);
  };

  syncStickyOffset();
  applyScrollState();

  let scrollQueued=false;
  const onScroll=()=>{
    if(scrollQueued) return;
    scrollQueued=true;
    requestAnimationFrame(()=>{
      scrollQueued=false;
      applyScrollState();
    });
  };
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',syncStickyOffset,{passive:true});

  if('ResizeObserver' in window){
    const observer=new ResizeObserver(syncStickyOffset);
    observer.observe(header);
  }

  // Keep motion preference changes live without reloading the page. CSS handles
  // the animation shutdown; this listener simply refreshes the sticky geometry.
  if(reduceMotion?.addEventListener){
    reduceMotion.addEventListener('change',syncStickyOffset);
  }else if(reduceMotion?.addListener){
    reduceMotion.addListener(syncStickyOffset);
  }
}

async function init(){
  initHeaderMotion();
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
  startDataRevisionPolling();
  initSortableTables();
  wireAnalyticsPresentation();
  wireCompareMode();
  wireExportDialog();
  initCommandPalette();
  initChartTooltips();
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
