/* 04-preferences-palette-shortcuts.js — Theme/density/sound/accent prefs, command palette, keyboard shortcuts. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
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
  const TAB_LABELS={dashboard:'📊 Dashboard',controlroom:'🚨 Quality Control Room',wcgrade:'🏭 Work Center & Grade',defects:'🎯 Defects List',weekly:'📅 Period Trend',chem:'🧪 Chemistry SPC'};
  function buildCommands(){
    const cmds=[];
    Object.keys(TAB_LABELS).forEach((key,i)=>cmds.push({cat:'nav',icon:'→',label:`Go to ${TAB_LABELS[key]}`,hint:String(i+1),desc:'Jump to this dashboard section',run:()=>activateTab(key)}));
    // Exports (Excel / PDF / PPT / CSV) live only in the header's "⬇ Export" button now
    // Exports open through the dedicated dialog (#exportDialogModal) instead of the Command Palette.
    // Compare mode is desktop-only (its button is hidden on narrow screens), so only offer it when the button is actually shown.
    const _onChem=(document.querySelector('.tab-btn.active')?.dataset.tab)==='chem';
    // The Chemistry tab has its own Compare Periods button (the dashboard one is hidden there)
    const _cmpBtn=document.getElementById(_onChem?'chemCompareBtn':'compareModeBtn');
    if(_cmpBtn?.offsetParent) cmds.push({cat:'filters',icon:'⊞',label:'Compare Periods (side-by-side)',desc:_onChem?'Two Chemistry periods / grades next to each other':'Two periods next to each other',run:()=>_cmpBtn.click()});
    cmds.push({cat:'filters',icon:'↺',label:'Reset All Filters',desc:_onChem?'Clear every Chemistry filter':'Clear every dashboard filter',run:()=>document.getElementById(_onChem?'chemResetAll':'resetAllBtn')?.click()});
    cmds.push({cat:'nav',icon:'🔎',label:'Focus Search',hint:'/',desc:'Search any defect, grade or work center',run:()=>document.getElementById('globalSearchInput')?.focus()});
    const isDark=currentTheme()==='dark';
    cmds.push({cat:'appearance',icon:isDark?'☀️':'🌙',label:isDark?'Switch to Light Mode':'Switch to Dark Mode',kw:'theme night day appearance',desc:'Change the theme',run:()=>toggleTheme()});
    const isCompact=isCompactDensity();
    cmds.push({cat:'appearance',icon:'☰',label:isCompact?'Switch to Comfortable Table Rows':'Switch to Compact Table Rows',kw:'compact density rows spacing tight',desc:'Table row spacing',run:()=>{
      const d=toggleDensity();
      showToast('success',d==='compact'?'Compact table rows on':'Comfortable table rows on', d==='compact'?'More rows fit on screen. Change it any time from Ctrl+K.':'Tables use the roomier row spacing again.');
    }});
    const soundOn=!window.SFX||SFX.isEnabled();
    cmds.push({cat:'prefs',icon:soundOn?'🔈':'🔊',label:soundOn?'Mute Sound Effects':'Unmute Sound Effects',kw:'sound volume audio speaker sfx mute unmute',desc:'Click and confirmation sounds',run:()=>{
      const on=toggleSound();
      if(on!==null) showToast('success',on?'Sound effects on':'Sound effects muted', on?'Click and confirmation sounds are back.':'The dashboard is silent now. Unmute any time from Ctrl+K.');
    }});
    const hintsOn=fieldHintsOn();
    cmds.push({cat:'prefs',icon:'🏷️',label:hintsOn?'Turn Off Field Name Hints (hover tag)':'Turn On Field Name Hints (hover tag)',kw:'field name hover tooltip tag hint cursor',desc:'Name tag that follows the cursor',run:()=>{
      const on=toggleFieldHints();
      showToast('success',on?'Field name hints on':'Field name hints off', on?'A small tag now names the field under your cursor.':'The hover tag is hidden. Turn it back on from Ctrl+K.');
    }});
    cmds.push({cat:'admin',icon:'🔐',label:'Open Admin Panel',kw:'admin settings users login manage',desc:'Import, backups, users and settings',run:()=>window.location.href='/admin'});
    const curTab=document.querySelector('.tab-btn.active')?.dataset.tab||'dashboard';
    cmds.push({cat:'prefs',icon:'📌',label:`Set "${TAB_LABELS[curTab]||curTab}" as my Default Landing Tab`,desc:'The tab the dashboard opens on',run:()=>setDefaultLandingTab(curTab)});
    ACCENT_PRESETS.forEach(a=>cmds.push({cat:'appearance',icon:'🎨',label:`Accent Color — ${a.name}`,desc:'Highlight color',run:()=>{applyAccent(a.value);showToast('success','Accent color updated',a.name+' applied.');}}));
    return cmds;
  }
  // Categories, in the order they appear in the palette. Commands are grouped under these
  // headings (headings only show when at least one command in them matches the search).
  const CATS=[
    {key:'nav',label:'Navigation',icon:'🧭'},
    {key:'filters',label:'Filters & Compare',icon:'🎛️'},
    {key:'appearance',label:'Appearance',icon:'🎨'},
    {key:'prefs',label:'Preferences',icon:'⚙️'},
    {key:'admin',label:'Admin',icon:'🔐'},
  ];
  let active=0, filtered=[];
  function render(query){
    const all=buildCommands();
    const q=query.trim().toLowerCase();
    const matches = q ? all.filter(c=>(c.label+' '+(c.kw||'')+' '+((CATS.find(k=>k.key===c.cat)||{}).label||'')).toLowerCase().includes(q)) : all;
    // Flat, category-ordered list — `filtered` indexes stay in sync with data-idx, so
    // arrow-key navigation, Enter and mouse selection work exactly as before.
    filtered=[]; let html='';
    CATS.forEach(cat=>{
      const items=matches.filter(c=>c.cat===cat.key); if(!items.length) return;
      const n=items.length;
      html+=`<div class="cmdk-cat" data-field="${escQcr(cat.label)}" data-field-meta="Category · ${n} command${n===1?'':'s'}"><span class="cmdk-cat-icon" aria-hidden="true">${cat.icon}</span><span class="cmdk-cat-name">${escQcr(cat.label)}</span><span class="cmdk-cat-count">${n}</span></div>`;
      items.forEach(c=>{
        const i=filtered.push(c)-1;
        html+=`<div class="cmdk-item${i===0?' active':''}" data-idx="${i}" data-field="${escQcr(c.label)}" data-field-meta="${escQcr(cat.label+(c.desc?' · '+c.desc:''))}"><span class="cmdk-icon">${c.icon}</span><span class="cmdk-label">${escQcr(c.label)}</span>${c.hint?`<span class="cmdk-hint">${c.hint}</span>`:''}</div>`;
      });
    });
    active=0;
    if(!filtered.length){ list.innerHTML='<div class="cmdk-empty">No matching command.</div>'; return; }
    list.innerHTML=html;
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
  const TAB_ORDER = ['dashboard','controlroom','wcgrade','defects','weekly','chem'];
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
    if(!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-6]$/.test(e.key)){
      const tabName = TAB_ORDER[Number(e.key)-1];
      const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if(btn){ e.preventDefault(); activateTab(tabName); }
      return;
    }
    if(!typing && e.key==='?'){
      e.preventDefault();
      showToast('info','Keyboard shortcuts','Ctrl+K command palette · / search · 1-6 switch tabs · Esc close');
    }
  });
})();

