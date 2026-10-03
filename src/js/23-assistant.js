/* 23-assistant.js — Free, offline "Quality Assistant": Ask (answers from the dashboard's own numbers), Help (glossary + how-to),
   Help mode (click any card / chart / button to have it explained) and read-aloud / voice input via the browser's built-in speech.
   No API key, no server call except the dashboard's own /api/qcr, no cost. Bundled into /app.js in filename order (after 22-boot.js);
   everything is wired from DOMContentLoaded-safe init at the bottom. Public API: window.QDAssist. */
/* A function declaration (called first, hoisted) instead of an IIFE: the app.js bundle must end with "}" (tests/test_smoke.py). */
qdAssistantModule();
function qdAssistantModule(){
'use strict';
const LS_LANG = 'qd_assist_lang';
let lang = 'hi';
try { lang = localStorage.getItem(LS_LANG) === 'en' ? 'en' : 'hi'; } catch(e){}
const t = (en, hi) => lang === 'en' ? en : (hi || en);
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = id => document.getElementById(id);
const pct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%';
const num = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString(undefined, {minimumFractionDigits: d, maximumFractionDigits: d});
const fmtK = (k, v) => v == null ? '—' : k.fmt === 'pct' ? pct(v) : k.fmt === 'int' ? Math.round(v).toLocaleString() : num(v, k.fmt === 'num2' ? 2 : 3);
const plainLabel = s => String(s || '').replace(/^[^A-Za-z0-9]+/, '').trim();

// ---------------------------------------------------------------- data (the dashboard's own API, current filters, 45 s cache)
let _cache = {key: '', at: 0, data: null};
async function getData(force){
  const qs = new URLSearchParams(typeof currentFilters !== 'undefined' ? currentFilters : {}).toString();
  if(!force && _cache.data && _cache.key === qs && Date.now() - _cache.at < 45000) return _cache.data;
  const r = await fetch('/api/qcr?' + qs, {cache: 'no-store'});
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json(); if(d.error) throw new Error(d.error);
  _cache = {key: qs, at: Date.now(), data: d}; return d;
}
const filtersText = () => {
  const f = typeof currentFilters !== 'undefined' ? currentFilters : {}, parts = Object.keys(f).filter(k => f[k] && f[k] !== 'All').map(k => `${k.replace(/_/g, ' ')}: ${f[k]}`);
  return parts.length ? parts.join(', ') : t('All data', 'Poora data');
};
function band(label, v){
  const T = typeof KPI_TARGETS !== 'undefined' && KPI_TARGETS ? KPI_TARGETS[label] : null; if(!T || v == null) return null;
  const lower = String(T.direction).toLowerCase() === 'lower';
  const ok = lower ? v <= T.target : v >= T.target, warn = lower ? v <= T.warning : v >= T.warning;
  return {T, lower, level: ok ? 'good' : warn ? 'watch' : 'bad', text: ok ? t('On target', 'Target par') : warn ? t('Watch', 'Dhyan do') : t('Action needed', 'Action chahiye')};
}
function kpiLine(k, withPrev = true){
  let s = `**${esc(plainLabel(k.label))}: ${fmtK(k, k.value)}**`;
  const b = band(k.label, k.value); if(b) s += ` — ${b.text} (target ${b.lower ? '≤' : '≥'} ${fmtK(k, b.T.target)})`;
  if(withPrev && k.prev != null){
    const ch = k.change_value, arrow = k.arrow === 'up' ? '▲' : k.arrow === 'down' ? '▼' : '•', good = k.trend_color === 'good' ? t('good', 'accha') : k.trend_color === 'bad' ? t('bad', 'kharab') : '';
    s += `\n   ${arrow} ${t('vs previous', 'pichhle period se')} ${fmtK(k, k.prev)}${ch != null ? ` (${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(2)}%)` : ''}${good ? ' · ' + good : ''}`;
  }
  return s;
}

// ---------------------------------------------------------------- knowledge base (Help tab + explain): [id, group, keywords, title, en, hi]
const KB = [
 ['coils','kpi',['total coils','coil count','coils'],'Total Coils','Number of coil records (inspection lots) in the current filter. Click the card to see the underlying records.','Current filter mein kitne coil records (inspection lots) hain. Card par click karoge to saare records khulenge.'],
 ['output','kpi',['output quantity','output qty','production','quantity','utpadan'],'Output Quantity (MT)','Total output weight in metric tonnes of the coils in the filter. It is the base for every “% Qty” KPI.','Filter ke coils ka total weight (MT). Saare “% Qty” KPI isi par based hain.'],
 ['defect_coils','kpi',['defect coils','defective coils'],'Defect Coils','Coils whose main defect is anything other than “NO DEFECT”. Lower is better.','Jin coils mein “NO DEFECT” ke alawa koi defect hai. Kam hona accha hai.'],
 ['fpy','kpi',['first pass yield','fpy','prime%','prime percent','prime'],'First Pass Yield % (Prime%)','Share of output quantity that was graded PRIME at first inspection (Prime MT ÷ Output MT). Higher is better.','Output ka kitna hissa pehli baar mein PRIME nikla (Prime MT ÷ Output MT). Zyada = accha.'],
 ['defect_rate','kpi',['defect rate','defect percent','defect pct'],'Defect Rate','Defect coils ÷ total coils. Lower is better.','Defect coils ÷ total coils. Kam = accha.'],
 ['reject_pct','kpi',['reject %','reject percent','reject pct','reject rate','rejection'],'Reject % Qty','Reject quantity ÷ output quantity. Lower is better; compare with the target on the card.','Reject MT ÷ output MT. Kam = accha; card ke target se compare karo.'],
 ['reject_qty','kpi',['reject qty','reject quantity','reject mt','scrap'],'Reject Qty (MT)','Metric tonnes of coils decided REJECT.','Jo MT REJECT decide hua.'],
 ['hold','kpi',['hold for decision','hold qty','hold'],'Hold for Decision','Material waiting for a quality decision. A large hold quantity means decisions are being delayed.','Material jo quality decision ka wait kar raha hai. Hold zyada = decision mein deri.'],
 ['salvage','kpi',['salvage','divert','salvage + divert'],'Salvage / Divert','Salvage = usable after downgrade or cutting; Divert = sent to another order/grade. Both are lost prime value.','Salvage = downgrade/cut karke use hone wala; Divert = dusre order/grade mein bheja. Dono mein prime value ka nuksaan.'],
 ['rework','kpi',['rework','re-work'],'Rework % Qty','Share of output that needs re-processing.','Output ka woh hissa jo dobara process karna padta hai.'],
 ['decisions','kpi',['quality decision','decision','prime','for next process','reject','re-work','divert'],'Quality decisions','PRIME (best), FOR NEXT PROCESS, SALVAGE, HOLD FOR DECISION, RE-WORK, DIVERT, REJECT. Exact plant rules are in your QA procedure.','PRIME (sabse accha), FOR NEXT PROCESS, SALVAGE, HOLD FOR DECISION, RE-WORK, DIVERT, REJECT. Exact rules aapke QA procedure mein hain.'],
 ['cpk','spc',['cpk','process capability','capability index'],'Cpk (within σ)','How well the process fits inside the spec limits, using short-term (within-subgroup) variation and the nearer limit. Bands on this dashboard: ≥ 1.33 On target, ≥ 1.00 Watch, below that Action. Higher is better.','Process spec limits ke andar kitni fit hai — short-term (within) variation aur paas wali limit se. Dashboard bands: ≥ 1.33 On target, ≥ 1.00 Watch, usse kam Action. Zyada = accha.'],
 ['ppk','spc',['ppk','overall capability','performance index'],'Ppk (overall σ)','Same idea as Cpk but with overall (long-term) variation, so it is usually lower than Cpk. A big gap between Cpk and Ppk means the process mean drifts over time.','Cpk jaisa hi, lekin overall (long-term) variation se — isliye aksar Cpk se kam. Cpk aur Ppk mein bada gap = mean time ke saath drift kar raha hai.'],
 ['cp','spc',['cp ','pp ','potential capability','cp/pp'],'Cp and Pp','Cp / Pp ignore where the mean sits and only compare the spec width with the process spread. Cp ≥ Cpk always: if Cp is high but Cpk is low, centre the process.','Cp / Pp mean ki jagah ignore karke sirf spec width vs spread dekhte hain. Cp high par Cpk low ho to process ko center karo.'],
 ['sigma','spc',['std dev','standard deviation','sigma','σ','within','overall'],'Std. Dev. (within / overall)','Within σ is estimated from the moving range (used by Cp/Cpk); overall σ is the plain standard deviation of all heats (used by Pp/Ppk).','Within σ moving range se nikalta hai (Cp/Cpk); overall σ saare heats ka normal std dev hai (Pp/Ppk).'],
 ['aim','spc',['aim','std limit','standard limit','lsl','usl','spec limit','aim lsl','aim usl'],'Standard vs Aim limits','Std LSL/USL are the specification limits (out of spec = outside them). Aim LSL/USL are the tighter internal target band; a heat outside Aim but inside Std is a warning, not a rejection.','Std LSL/USL spec limits hain (bahar = out of spec). Aim LSL/USL tighter internal target band hai; Aim ke bahar par Std ke andar = warning, rejection nahi.'],
 ['trendchip','spc',['trend arrow','trend chip','pp','percentage point','change chip','prev'],'Trend chip on element cards','▼ −10.32% (−0.27): the % is the relative change of the index, the bracket is the absolute difference of the index itself (e.g. 2.31 − 2.57). Cpk/Ppk have no unit, so the bracket is not percentage points.','▼ −10.32% (−0.27): % relative change hai, bracket index ka seedha antar (jaise 2.31 − 2.57). Cpk/Ppk ki unit nahi hoti, isliye bracket pp nahi hai.'],
 ['imr','spc',['individuals chart','i chart','moving range','mr chart','control chart','spc chart'],'I and MR charts','Each point is one heat. The I chart shows the value with mean and limits; the MR chart shows heat-to-heat change. Points outside limits, long runs on one side or steady drifts mean the process has changed.','Har point ek heat hai. I chart value + mean + limits dikhata hai, MR chart heat-to-heat badlaav. Limits ke bahar point, ek taraf lambi run ya lagatar drift = process badal gaya.'],
 ['hist','spc',['histogram','bar','bin','distribution'],'Histogram','Distribution of heat values with Standard and Aim limits and a normal curve. Hover a bar and click it to drill down to the heats in that range.','Heat values ka distribution, Std/Aim limits aur normal curve ke saath. Bar par hover karo aur click karke us range ke heats dekho.'],
 ['indicative','spc',['indicative','30 heats','few heats','small sample'],'Indicative (< 30 heats)','With fewer than 30 heats Cpk/Ppk are only indicative — the sample is too small to trust.','30 se kam heats par Cpk/Ppk sirf indicative hain — sample chhota hai.'],
 ['pareto','chart',['pareto','top defects','cumulative'],'Pareto chart','Bars = defect quantity (MT), line = cumulative %. The first few bars usually cause most of the loss: fix those first.','Bars = defect quantity (MT), line = cumulative %. Pehle kuch bars zyada nuksaan karte hain — pehle unhe theek karo.'],
 ['intensity','chart',['intensity','light','medium','heavy'],'Defect intensity','How severe the defect is on the coil (e.g. LIGHT / MEDIUM / HEAVY). Coils without an intensity are shown as “without intensity”.','Coil par defect kitna severe hai (LIGHT / MEDIUM / HEAVY). Intensity bina wale alag dikhte hain.'],
 ['fishbone','chart',['fishbone','6m','ishikawa','root cause','man machine'],'6M Fishbone','Cause map for a defect across Man, Machine, Material, Method, Measurement and Environment, with RCA actions from the Fishbone master.','Defect ka cause map: Man, Machine, Material, Method, Measurement, Environment — RCA actions ke saath (Fishbone master se).'],
 ['qcr','chart',['control room','qcr','what needs attention','health score','early warning'],'Quality Control Room','One screen of what needs attention: health score, early warnings, critical KPIs, top contributors and the Pareto → root-cause path.','Ek screen par kya dhyan maangta hai: health score, early warnings, critical KPIs, top contributors aur Pareto → root cause.'],
 ['forecast','chart',['forecast','predict','next period'],'Forecast','A simple trend projection of FPY, reject % and defect % for the next period from recent periods. It is a direction hint, not a guarantee.','Pichhle periods ke trend se agle period ka FPY, reject % aur defect % ka simple projection. Ye direction ka sanket hai, guarantee nahi.'],
 ['filters','howto',['filter','filters','month filter','select month','grade filter'],'Filters','Filters are linked: choosing a Month limits the other dropdowns to values that exist in it. “Reset All” clears everything. The Week filter shows full Monday–Sunday ranges.','Filters linked hain: Month chunoge to baaki dropdown sirf us month ke values dikhayenge. “Reset All” sab saaf karta hai. Week filter poora Monday–Sunday range dikhata hai.'],
 ['drill','howto',['drill','drill down','underlying records','click card'],'Drill-down','Click a KPI card, a chart bar or a table row to open its underlying records. In the table, the header ▼ gives Excel-style filters; Export Selected Records exports exactly what is filtered.','KPI card, chart bar ya table row par click karo — underlying records khulte hain. Table header ke ▼ se Excel jaise filters; Export Selected Records filtered rows hi export karta hai.'],
 ['export','howto',['export','download','excel','pdf','ppt','powerpoint','csv','report'],'Export','Header → Export: Excel, PDF, PowerPoint or CSV for the current view; Chemistry tables export as styled Excel (or CSV via the File type switch). Drill-downs have their own Export button.','Header → Export: current view ka Excel, PDF, PowerPoint ya CSV; Chemistry tables styled Excel (ya CSV, File type se). Drill-down ka apna Export button hai.'],
 ['palette','howto',['command palette','ctrl k','shortcut','shortcuts','keyboard'],'Command palette & shortcuts','Ctrl+K opens the command palette (tabs, dark mode, sound, admin, assistant). “/” focuses search, 1–6 jump to tabs, Ctrl+/ opens this assistant, ? opens Help.','Ctrl+K command palette kholta hai (tabs, dark mode, sound, admin, assistant). “/” search, 1–6 tabs, Ctrl+/ assistant, ? Help kholta hai.'],
 ['views','howto',['saved view','preset','save preset','views'],'Saved views / presets','Save Preset stores the current filters and tab; pick it later from Saved Views, or manage it from Manage Presets.','Save Preset current filters aur tab ko store karta hai; baad mein Saved Views se chuno, ya Manage Presets se sambhalo.'],
 ['compare','howto',['compare','compare periods','side by side'],'Compare Periods','Shows two periods (or two grades on the Chemistry tab) side by side so changes are visible at a glance.','Do periods (Chemistry mein do grades) side by side dikhata hai.'],
 ['theme','howto',['dark mode','light mode','theme','night'],'Dark mode & appearance','Ctrl+K → “Switch to Dark Mode”. Accent colour, compact rows and sound are in the same palette.','Ctrl+K → “Switch to Dark Mode”. Accent colour, compact rows aur sound isi palette mein hain.'],
 ['live','howto',['live data','last updated','data freshness','refresh','updated'],'Live data & freshness','LIVE DATA means the dashboard checks the database revision and refreshes when new data is imported. “Last updated” shows how fresh the numbers are.','LIVE DATA = dashboard database revision check karke naya data aane par refresh hota hai. “Last updated” numbers kitne taaza hain dikhata hai.'],
 ['admin','howto',['admin','import','upload data','backup','users'],'Admin panel','Open it from Ctrl+K → Open Admin Panel (login required): data import, KPI targets, Chemistry specs, backups and users.','Ctrl+K → Open Admin Panel (login chahiye): data import, KPI targets, Chemistry specs, backups, users.'],
];
const KB_GROUPS = {kpi: ['📌 KPIs & decisions', '📌 KPIs aur decisions'], spc: ['🧪 Chemistry SPC', '🧪 Chemistry SPC'], chart: ['📊 Charts & analysis', '📊 Charts aur analysis'], howto: ['🧭 How to use', '🧭 Kaise use karein']};
const kbById = id => KB.find(e => e[0] === id);
function kbHtml(e, extra){ return `**${esc(e[3])}**\n${esc(t(e[4], e[5]))}${extra ? '\n\n' + extra : ''}`; }
function kbSearch(q){
  const out = [];
  KB.forEach(e => { let s = 0; e[2].forEach(k => { const kk = k.trim(); if(kk && q.includes(kk)) s = Math.max(s, kk.length + (q === kk ? 5 : 0)); }); if(q.includes(e[3].toLowerCase())) s = Math.max(s, e[3].length); if(s) out.push([s, e]); });
  return out.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// ---------------------------------------------------------------- tabs (navigation) + descriptions for Help mode
const TABS = [
  ['dashboard', ['dashboard', 'home', 'overview tab'], '📊 Dashboard', 'KPI cards, decision mix, Pareto, intensity and monthly trend for the current filters.', 'Current filters ke KPI cards, decision mix, Pareto, intensity aur monthly trend.'],
  ['controlroom', ['control room', 'qcr'], '🚨 Quality Control Room', 'What needs attention: health score, early warnings, critical KPIs, contributors and root-cause path.', 'Kya dhyan maangta hai: health score, early warnings, critical KPIs, contributors aur root cause.'],
  ['wcgrade', ['work center', 'workcenter', 'grade tab', 'wc'], '🏭 Work Center & Grade', 'Reject % and output by work center and by alloy grade.', 'Work center aur alloy grade ke hisaab se reject % aur output.'],
  ['defects', ['defects list', 'defect list', 'defects tab'], '🎯 Defects List', 'Top-10 Pareto and the complete defect occurrence register.', 'Top-10 Pareto aur poora defect occurrence register.'],
  ['weekly', ['period trend', 'weekly', 'trend tab'], '📅 Period Trend', 'Weekly, quarterly and financial-year trends of defect %, reject % and FPY.', 'Weekly, quarterly aur FY trend — defect %, reject %, FPY.'],
  ['chem', ['chemistry', 'chem', 'spc tab'], '🧪 Chemistry SPC', 'Heat chemistry capability (Cpk/Ppk), I-MR charts, histograms and the link to coil disposition.', 'Heat chemistry capability (Cpk/Ppk), I-MR charts, histogram aur coil disposition se link.'],
];
const tabDesc = key => { const x = TABS.find(a => a[0] === key); return x ? `**${esc(x[2])}**\n${esc(t(x[3], x[4]))}` : ''; };

// ---------------------------------------------------------------- answers
const R = (html, o) => Object.assign({html}, o || {});
const chipsDefault = () => [t('Summary', 'Summary batao'), t('Top defects', 'Top defects'), t('Worst grade', 'Sabse kharab grade'), t('What should I do?', 'Kya karna chahiye?'), t('Alerts', 'Alerts')];

async function ansSummary(){
  const d = await getData(), i = d.intel || {}, ks = d.k.kpis || [], p = d.k.period || {}, hs = i.health_score || {};
  let s = `**${t('Summary', 'Summary')} · ${esc(filtersText())}**`;
  if(p.current) s += `\n${esc(t('Period', 'Period'))}: ${esc(p.current)}${p.previous ? ' ' + t('vs', 'vs') + ' ' + esc(p.previous) : ''} · ${(d.fr && d.fr.filtered_records || 0).toLocaleString()} ${t('records', 'records')}`;
  if(hs.score != null) s += `\n🩺 ${t('Health score', 'Health score')}: **${hs.score}/100** (${esc(hs.status || '')})`;
  if(i.quality_story) s += `\n\n${esc(i.quality_story)}`;
  const bad = ks.filter(k => k.trend_color === 'bad' && k.prev != null), good = ks.filter(k => k.trend_color === 'good' && k.prev != null);
  if(bad.length) s += `\n\n⚠️ ${t('Getting worse', 'Kharab ho rahe')}: ` + bad.slice(0, 4).map(k => `${esc(plainLabel(k.label))} ${fmtK(k, k.value)}`).join(' · ');
  if(good.length) s += `\n✅ ${t('Improving', 'Sudhar')}: ` + good.slice(0, 4).map(k => `${esc(plainLabel(k.label))} ${fmtK(k, k.value)}`).join(' · ');
  const td = (d.k.top_defects || [])[0]; if(td) s += `\n🎯 ${t('Top defect', 'Top defect')}: ${esc(td.defect)} (${num(td.qty, 2)} MT, ${pct(td.pct, 1)})`;
  return R(s, {chips: [t('Why did it change?', 'Kyun badla?'), t('What should I do?', 'Kya karna chahiye?'), t('Alerts', 'Alerts'), t('Forecast', 'Forecast')], actions: [{label: t('Open Control Room', 'Control Room kholo'), run: () => activateTab('controlroom')}]});
}
const KPI_WORDS = [
  ['Total Coils', ['total coils', 'coils', 'coil']], ['Output Quantity (MT)', ['output', 'production', 'quantity', 'utpadan']], ['Defect Coils', ['defect coils']],
  ['First Pass Yield % (Prime%)', ['first pass', 'fpy', 'prime', 'yield']], ['Defect Rate', ['defect rate', 'defect %', 'defect percent']], ['Reject % Qty', ['reject %', 'reject percent', 'reject rate', 'reject pct']],
  ['Hold for Decision % Qty', ['hold %', 'hold percent']], ['Salvage % Qty', ['salvage %', 'salvage percent']], ['Hold For Decision Qty (MT)', ['hold qty', 'hold mt', 'hold']], ['Reject Qty (MT)', ['reject qty', 'reject mt', 'reject quantity', 'reject', 'scrap']],
  ['Salvage + Divert Qty (MT)', ['salvage', 'divert']], ['Rework % Qty', ['rework', 're-work']],
];
function findKpis(q, ks){
  const hit = [];
  KPI_WORDS.forEach(([label, words]) => { let s = 0; words.forEach(w => { if(q.includes(w)) s = Math.max(s, w.length); }); if(s) hit.push([s, label]); });
  hit.sort((a, b) => b[0] - a[0]);
  const top = hit.length ? hit[0][0] : 0, labels = hit.filter(h => h[0] === top).map(h => h[1]);
  return ks.filter(k => labels.includes(k.label)).slice(0, 2);
}
async function ansKpi(found){
  const lines = found.map(k => kpiLine(k)), e = KB.find(x => x[3].toLowerCase() === plainLabel(found[0].label).toLowerCase() || x[2].some(w => plainLabel(found[0].label).toLowerCase().includes(w)));
  let h = lines.join('\n\n'); if(e && found.length === 1) h += `\n\nℹ️ ${esc(t(e[4], e[5]))}`;
  return R(h, {chips: [t('Why did it change?', 'Kyun badla?'), t('Top defects', 'Top defects'), t('Summary', 'Summary batao')]});
}
async function ansDefects(){
  const d = await getData(), reg = (d.d.register || []).filter(r => r.qty > 0 || r.records > 0).slice(0, 5), tot = d.d.register_total || {};
  if(!reg.length) return R(t('No defects in the current filter.', 'Current filter mein koi defect nahi.'));
  const top3 = reg.slice(0, 3).reduce((a, r) => a + (r.qty || 0), 0), all = (d.d.totals || {}).qty || tot.qty || 0;
  let s = `**🎯 ${t('Top defects', 'Top defects')} · ${esc(filtersText())}**\n` + reg.map((r, i) => `${i + 1}. ${esc(r.defect)} — ${num(r.qty, 2)} MT · ${r.records} ${t('coils', 'coils')} (${pct(r.pct_records, 1)})`).join('\n');
  if(all) s += `\n\n${t('The top 3 are', 'Top 3 ka hissa')} **${pct(top3 / all, 0)}** ${t('of defect quantity — fix these first (Pareto rule).', 'defect quantity ka hai — inhe pehle theek karo (Pareto rule).')}`;
  return R(s, {chips: [t('What should I do?', 'Kya karna chahiye?'), t('Why did it change?', 'Kyun badla?')], actions: [{label: t('Open Defects List', 'Defects List kholo'), run: () => activateTab('defects')}]});
}
async function ansGroups(q){
  const d = await getData(), wantWc = /work ?cent|\bwc\b|line|machine/.test(q) && !/grade/.test(q), rows = ((wantWc ? d.w.by_work_center : d.w.by_grade) || []).filter(r => r.coils > 0);
  if(!rows.length) return R(t('No data in the current filter.', 'Current filter mein data nahi.'));
  const best = /best|sabse accha|top performer|achha|accha/.test(q);
  const m = /defect/.test(q) ? ['defect_pct', t('Defect %', 'Defect %')] : /fpy|prime|yield/.test(q) ? ['first_pass_yield_pct', 'FPY'] : /output|volume|production/.test(q) ? ['output_qty', t('Output', 'Output')] : ['reject_pct_qty', t('Reject %', 'Reject %')];
  const higherBad = m[0] !== 'first_pass_yield_pct' && m[0] !== 'output_qty';
  const sorted = rows.slice().sort((a, b) => (higherBad ? (b[m[0]] - a[m[0]]) : (a[m[0]] - b[m[0]])) * (best ? -1 : 1));
  const f = r => m[0] === 'output_qty' ? num(r.output_qty, 1) + ' MT' : pct(r[m[0]], 2);
  let s = `**${wantWc ? '🏭' : '🏷️'} ${best ? t('Best', 'Sabse accha') : t('Worst', 'Sabse kharab')} ${wantWc ? t('work centers', 'work centers') : t('grades', 'grades')} — ${esc(m[1])}**\n` + sorted.slice(0, 3).map((r, i) => `${i + 1}. ${esc(r.name)} — ${f(r)} · ${r.coils} ${t('coils', 'coils')} · ${num(r.output_qty, 1)} MT`).join('\n');
  return R(s, {chips: [wantWc ? t('Worst grade', 'Sabse kharab grade') : t('Worst work center', 'Sabse kharab work center'), t('Top defects', 'Top defects')], actions: [{label: t('Open Work Center & Grade', 'Work Center & Grade kholo'), run: () => activateTab('wcgrade')}]});
}
async function ansTrend(){
  const d = await getData(), rows = (d.m.rows || []).filter(r => r.coils > 0);
  if(rows.length < 2) return R(t('Need at least two months of data in the filter to show a trend.', 'Trend ke liye filter mein kam se kam do mahine ka data chahiye.'));
  const last = rows.slice(-3), L = rows[rows.length - 1], P = rows[rows.length - 2];
  const worst = rows.slice().sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0], bestF = rows.slice().sort((a, b) => b.first_pass_yield_pct - a.first_pass_yield_pct)[0];
  let s = `**📈 ${t('Monthly trend', 'Monthly trend')}**\n` + last.map(r => `• ${esc(r.name)}: ${r.coils.toLocaleString()} ${t('coils', 'coils')} · ${t('defect', 'defect')} ${pct(r.defect_pct, 1)} · ${t('reject', 'reject')} ${pct(r.reject_pct_qty, 2)} · FPY ${pct(r.first_pass_yield_pct, 1)}`).join('\n');
  const dF = (L.first_pass_yield_pct - P.first_pass_yield_pct) * 100, dR = (L.reject_pct_qty - P.reject_pct_qty) * 100;
  s += `\n\n${esc(L.name)} ${t('vs', 'vs')} ${esc(P.name)}: FPY ${dF >= 0 ? '▲' : '▼'} ${Math.abs(dF).toFixed(1)} pp, ${t('reject', 'reject')} ${dR >= 0 ? '▲' : '▼'} ${Math.abs(dR).toFixed(2)} pp.`;
  s += `\n${t('Highest reject', 'Sabse zyada reject')}: ${esc(worst.name)} (${pct(worst.reject_pct_qty, 2)}) · ${t('best FPY', 'best FPY')}: ${esc(bestF.name)} (${pct(bestF.first_pass_yield_pct, 1)})`;
  return R(s, {chips: [t('Forecast', 'Forecast'), t('Why did it change?', 'Kyun badla?')], actions: [{label: t('Open Period Trend', 'Period Trend kholo'), run: () => activateTab('weekly')}]});
}
async function ansWhy(){
  const d = await getData(), i = d.intel || {}, w = i.why_changed || {}, pf = (i.problem_finder || []).slice(0, 3);
  let s = `**🔍 ${t('Why did it change?', 'Kyun badla?')}**`;
  if(w.statement) s += `\n${esc(w.statement)}`;
  if(w.defect_contributor && w.defect_contributor.name) s += `\n• ${t('Main defect', 'Main defect')}: ${esc(w.defect_contributor.name)} (${num(w.defect_contributor.qty, 2)} MT)`;
  if(w.wc_contributor && w.wc_contributor.name) s += `\n• ${t('Work center', 'Work center')}: ${esc(w.wc_contributor.name)}`;
  if(pf.length) s += `\n\n${t('Biggest problems now', 'Abhi ke sabse bade problems')}:\n` + pf.map((x, n) => `${n + 1}. ${esc(x.title)} — ${esc(x.detail || '')}`).join('\n');
  if(!w.statement && !pf.length) s += `\n${t('Not enough history in this filter to explain a change. Try selecting a single month.', 'Is filter mein badlaav samjhane ke liye history kam hai. Ek month chun kar dekho.')}`;
  return R(s, {chips: [t('What should I do?', 'Kya karna chahiye?'), t('Top defects', 'Top defects')]});
}
async function ansAlerts(){
  const d = await getData(), ws = ((d.intel || {}).early_warnings || []).slice(0, 5);
  if(!ws.length) return R('✅ ' + t('No early warnings in the current filter.', 'Current filter mein koi early warning nahi.'));
  const ic = {high: '🔴', medium: '🟠', low: '🟢'};
  return R(`**🚨 ${t('Early warnings', 'Early warnings')} (${ws.length})**\n` + ws.map(x => `${ic[String(x.severity).toLowerCase()] || '•'} ${esc(x.title)}\n   ${esc(x.detail || '')} → ${esc(x.action || '')}`).join('\n'), {chips: [t('What should I do?', 'Kya karna chahiye?'), t('Summary', 'Summary batao')], actions: [{label: t('Open Control Room', 'Control Room kholo'), run: () => activateTab('controlroom')}]});
}
async function ansAction(){
  const d = await getData(), i = d.intel || {}, pf = (i.problem_finder || []).slice(0, 3), rec = i.recommended_investigation || [];
  let s = `**🛠️ ${t('Suggested next steps', 'Aage kya karein')}**`;
  if(pf.length) s += '\n' + pf.map((x, n) => `${n + 1}. **${esc(x.action || 'Investigate')}** — ${esc(x.title)}${x.driver_path ? ' (' + esc(x.driver_path) + ')' : ''}`).join('\n');
  if(rec.length) s += `\n\n${t('Look at', 'Dekho')}: ${rec.slice(0, 6).map(esc).join(' → ')}`;
  s += `\n\n${t('Tip: click the Top Defect bar on the Pareto chart to open the exact heats and batches.', 'Tip: Pareto chart ke Top Defect bar par click karke exact heats aur batches dekho.')}`;
  return R(s, {chips: [t('Top defects', 'Top defects'), t('Alerts', 'Alerts')], actions: [{label: t('Open Control Room', 'Control Room kholo'), run: () => activateTab('controlroom')}]});
}
async function ansForecast(){
  const d = await getData(), f = (d.intel || {}).forecast;
  if(!f || f.fpy == null) return R(t('Not enough periods to forecast. Clear the Month filter to give it history.', 'Forecast ke liye periods kam hain. Month filter hata kar history do.'));
  const r = f.risk || {}, ic = {high: '🔴', medium: '🟠', low: '🟢'};
  return R(`**🔮 ${t('Forecast for next period', 'Agle period ka forecast')}** (${f.periods_used} ${t('periods used', 'periods se')})\n• FPY: ${pct(f.fpy, 1)} ${ic[r.fpy] || ''}\n• ${t('Reject %', 'Reject %')}: ${pct(f.reject_pct, 2)} ${ic[r.reject_pct] || ''}\n• ${t('Defect %', 'Defect %')}: ${pct(f.defect_pct, 1)} ${ic[r.defect_pct] || ''}\n\n${t('This is a simple trend projection, not a guarantee.', 'Ye simple trend projection hai, guarantee nahi.')}`, {chips: [t('Monthly trend', 'Trend dikhao'), t('Alerts', 'Alerts')]});
}

// ---------------------------------------------------------------- actions (navigate / theme / export / filters / heat)
async function setFilter(key, value){
  const field = document.querySelector(`.filter-field[data-filter-key="${key}"]`); if(!field) return false;
  const trig = field.querySelector('.filter-trigger'); if(trig) trig.click();
  const opt = [...field.querySelectorAll('.filter-option')].find(o => (o.dataset.value || '') === value); if(!opt) { if(trig) trig.click(); return false; }
  opt.click(); return true;
}
async function tryFilterCommand(q, raw){
  const opts = window._filterOptionsCache; if(!opts) return null;
  if(/reset|clear|saaf|hatao|all filters/.test(q) && /filter/.test(q)) { const b = $('resetAllBtn'); if(b){ b.click(); _cache.data = null; return R('↺ ' + t('All filters cleared.', 'Saare filters saaf kar diye.'), {chips: chipsDefault()}); } }
  const verb = /\b(filter|set|select|show|dikhao|lagao|chuno|laga|only|sirf|for)\b/.test(q) || /(dikhao|lagao|chuno)/.test(q); if(!verb) return null;
  const done = [];
  for(const key of ['month', 'work_center', 'grade', 'quality_decision', 'financial_year', 'quarter', 'defect_intensity']){
    const items = (opts[key] || []).map(x => typeof x === 'string' ? {value: x} : x).filter(x => x.value && x.value !== 'All');
    const hit = items.filter(x => q.includes(String(x.value).toLowerCase())).sort((a, b) => String(b.value).length - String(a.value).length)[0];
    if(hit && await setFilter(key, String(hit.value))) done.push(`${key.replace(/_/g, ' ')} = ${hit.value}`);
  }
  if(!done.length) return null; _cache.data = null;
  return R('🎛️ ' + t('Filter applied', 'Filter laga diya') + ': **' + done.map(esc).join(', ') + '**', {chips: [t('Summary', 'Summary batao'), t('Top defects', 'Top defects')]});
}
function tryNavCommand(q){
  const open = /\b(open|go|goto|show|kholo|khol|jao|chalo|dikhao|le chalo|switch)\b/.test(q);
  if(/export|download|report/.test(q) && /(excel|pdf|ppt|powerpoint|csv|export|download)/.test(q) && open || /^export/.test(q)){ const b = $('exportMenuBtn'); if(b){ b.click(); return R('⬇️ ' + t('Export dialog opened — pick Excel, PDF, PowerPoint or CSV.', 'Export dialog khol diya — Excel, PDF, PowerPoint ya CSV chuno.')); } }
  if(/dark|night|raat/.test(q) && /(mode|theme|on|karo|switch)/.test(q) || /light mode|theme/.test(q) && /(switch|karo|change)/.test(q)){ toggleTheme(); return R('🌓 ' + t('Theme switched.', 'Theme badal diya.')); }
  if(open){
    const hit = TABS.find(a => a[1].some(w => q.includes(w)) || q.includes(a[2].replace(/^[^A-Za-z]+/, '').toLowerCase()));
    if(hit){ activateTab(hit[0]); return R(`→ ${esc(hit[2])}\n${esc(t(hit[3], hit[4]))}`); }
  }
  return null;
}
function tryHeat(q, raw){
  const m = String(raw).match(/\b([A-Za-z]{2,4}\d{3,6})\b/); if(!m || typeof openChemHeat !== 'function') return null;
  if(!/heat|chem|coil|batch|dikhao|kholo|open|show|detail/.test(q) && String(raw).trim().length > m[1].length + 3) return null;
  openChemHeat(m[1].toUpperCase()); return R('🔥 ' + t('Opening heat', 'Heat khol raha hoon') + ` **${esc(m[1].toUpperCase())}** — ${t('its chemistry, Aim/Std limits and coil disposition.', 'uski chemistry, Aim/Std limits aur coil disposition.')}`);
}

// ---------------------------------------------------------------- router
const EXPLAIN_RE = /(kya hai|kya hota|kya hoti|what is|what's|whats|meaning|matlab|explain|samjha|define|definition|formula|kaise|how (do|to|can)|kyun nahi|help)/;
async function answer(raw){
  const q = String(raw).toLowerCase().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if(!q) return R(t('Type a question — for example “Reject % kitna hai?” or “Top defects”.', 'Sawal likho — jaise “Reject % kitna hai?” ya “Top defects”.'), {chips: chipsDefault()});
  if(/^(hi|hello|hey|namaste|hlo|salam|help|madad|kya kar sakte)/.test(q) && q.length < 28) return R(t('Hi! I read the numbers on this dashboard and explain them. I work offline — no cost. Try one of these:', 'Namaste! Main is dashboard ke numbers padhkar samjhata hoon. Offline chalta hoon — koi kharcha nahi. Ye try karo:'), {chips: chipsDefault()});
  let r = tryHeat(q, raw) || await tryFilterCommand(q, raw) || tryNavCommand(q); if(r) return r;
  const kb = kbSearch(q), explainType = EXPLAIN_RE.test(q);
  const d = await getData(); const kfound = findKpis(q, d.k.kpis || []);
  if(explainType && kb.length) { const e = kb[0], k = kfound[0]; return R(kbHtml(e, k ? '📍 ' + t('Right now', 'Abhi') + ': ' + kpiLine(k).replace(/\n\s+/g, ' · ') : ''), {chips: kb.slice(1, 3).map(x => x[3]).concat([t('Summary', 'Summary batao')])}); }
  if(/summary|overview|status|haal|kaisa chal|kaise chal|brief|saar|report card|health/.test(q)) return ansSummary();
  if(/why|kyun|kyu|reason|wajah|karan|badh|badha|gira|ghat|ghata|change/.test(q) && !/should i/.test(q)) return ansWhy();
  if(/forecast|predict|next period|agle|aage ka|future/.test(q)) return ansForecast();
  if(/what should|kya karun|kya karna|karna chahiye|action|recommend|suggest|next step|investigate|sudhar|improve|kaise sudhar/.test(q)) return ansAction();
  if(/alert|warning|risk|problem|issue|dikkat|chetavni|attention/.test(q) && !/grade|work ?cent/.test(q)) return ansAlerts();
  if(/(worst|best|sabse|highest|lowest|zyada|kam|rank|compare|top)/.test(q) && /(grade|work ?cent|\bwc\b|line)/.test(q) || /^(grade|work ?center|work centre)s?$/.test(q)) return ansGroups(q);
  if(/defect|pareto|kharabi|nuks/.test(q) && !kfound.length || /top defect|pareto/.test(q)) return ansDefects();
  if(/trend|month|mahin|weekly|history|progress/.test(q)) return ansTrend();
  if(kfound.length) return ansKpi(kfound);
  if(kb.length) return R(kbHtml(kb[0]), {chips: kb.slice(1, 3).map(x => x[3])});
  const near = KB.filter(e => e[3].toLowerCase().split(/\W+/).some(w => w.length > 3 && q.includes(w))).slice(0, 3);
  return R(t('I did not understand that. I can summarise the numbers, rank defects / grades / work centers, explain changes, warn about risks, open tabs, apply filters and explain any term (Cpk, FPY, Pareto…).', 'Ye samajh nahi aaya. Main numbers ka summary, defects / grades / work centers ka ranking, badlaav ki wajah, risk warning, tabs kholna, filters lagana aur kisi bhi term (Cpk, FPY, Pareto…) ka matlab bata sakta hoon.'), {chips: near.map(e => e[3]).concat(chipsDefault().slice(0, 3))});
}

// ---------------------------------------------------------------- Help mode: click anything to have it explained
const CHART_HELP = [
  [/decision mix|quality decision/i, 'decisions', d => { const rows = (d.k.decision_table || []).filter(r => r.qty > 0).slice(0, 3); return rows.length ? t('Largest shares', 'Sabse bade hisse') + ': ' + rows.map(r => `${esc(r.decision)} ${pct(r.pct_qty, 1)}`).join(' · ') : ''; }],
  [/pareto|top \d+ defect|occurrence register/i, 'pareto', d => { const rows = (d.k.top_defects || []).slice(0, 3); return rows.length ? t('Top 3', 'Top 3') + ': ' + rows.map(r => `${esc(r.defect)} ${num(r.qty, 1)} MT`).join(' · ') + ` (${t('cumulative', 'cumulative')} ${pct(rows[rows.length - 1].cum_pct, 0)})` : ''; }],
  [/fishbone|6m/i, 'fishbone', () => ''],
  [/intensity/i, 'intensity', d => { const rows = (d.k.intensity_table || []).filter(r => r.qty > 0).slice(0, 3); return rows.length ? rows.map(r => `${esc(r.intensity)} ${num(r.qty, 1)} MT`).join(' · ') : ''; }],
  [/monthly|trend|weekly|quarterly|yearly|fy/i, null, d => { const rows = (d.m.rows || []).filter(r => r.coils > 0), L = rows[rows.length - 1]; return L ? `${esc(L.name)}: ${t('defect', 'defect')} ${pct(L.defect_pct, 1)} · ${t('reject', 'reject')} ${pct(L.reject_pct_qty, 2)} · FPY ${pct(L.first_pass_yield_pct, 1)}` : ''; }],
  [/work center/i, null, d => { const r = (d.w.by_work_center || []).filter(x => x.coils > 0).sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0]; return r ? `${t('Highest reject', 'Sabse zyada reject')}: ${esc(r.name)} ${pct(r.reject_pct_qty, 2)}` : ''; }],
  [/grade/i, null, d => { const r = (d.w.by_grade || []).filter(x => x.coils > 0).sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0]; return r ? `${t('Highest reject', 'Sabse zyada reject')}: ${esc(r.name)} ${pct(r.reject_pct_qty, 2)}` : ''; }],
  [/individuals|\(i\) chart/i, 'imr', () => ''], [/moving range|\(mr\)/i, 'imr', () => ''], [/histogram/i, 'hist', () => ''],
  [/attention|critical kpi|contributor|root cause|control room/i, 'qcr', d => { const w = ((d.intel || {}).early_warnings || [])[0]; return w ? `${t('Top warning', 'Top warning')}: ${esc(w.title)}` : ''; }],
];
const CHART_TEXT = {
  decisions: ['Shows how the output quantity splits across quality decisions. A big PRIME share is good; growing SALVAGE / HOLD / REJECT slices are lost value.', 'Output quantity quality decisions mein kaise bati hai. PRIME bada = accha; SALVAGE / HOLD / REJECT badhna = value ka nuksaan.'],
  pareto: ['Defects ranked by quantity with the cumulative line. Attack the first bars first — click one to see its heats and batches.', 'Defects quantity ke hisaab se ranked, cumulative line ke saath. Pehle bars par kaam karo — click karke heats aur batches dekho.'],
  fishbone: ['Six-M cause map (Man, Machine, Material, Method, Measurement, Environment) for the top defects, to guide the root-cause discussion.', 'Top defects ka 6M cause map (Man, Machine, Material, Method, Measurement, Environment) — root cause charcha ke liye.'],
  intensity: ['How severe the defective coils are (light to heavy). Heavy share growing = process is getting worse, not just noisier.', 'Defective coils kitne severe hain (light se heavy). Heavy hissa badhna = process kharab ho raha hai.'],
};
async function explainElement(el){
  const kpi = el.closest('.kpi-card');
  if(kpi && kpi.classList.contains('chem-el-kpi')){
    const txt = kpi.innerText.replace(/\s+/g, ' '), name = (txt.match(/^([A-Za-z]{1,2})\s+([A-Z][A-Za-z ]+?)\s+Atomic/) || [])[2] || '', m = k => (txt.match(new RegExp(k + '[^\\d-]*(-?[\\d.]+)')) || [])[1];
    const cpk = m('Cpk'), ppk = m('Ppk'), cp = m('Cp'), pp = m('Pp'), c = cpk != null ? Number(cpk) : null;
    const lvl = c == null ? '' : c >= 1.33 ? t('On target', 'Target par') : c >= 1 ? t('Watch', 'Dhyan do') : t('Action needed', 'Action chahiye');
    let s = `**${esc(name || 'Element')} — ${t('capability card', 'capability card')}**\n`;
    if(cpk != null) s += `Cpk **${esc(cpk)}** (${esc(lvl)}) · Ppk **${esc(ppk || '—')}**${cp ? ` · Cp ${esc(cp)} · Pp ${esc(pp || '—')}` : ''}\n\n`;
    s += esc(t(kbById('cpk')[4], kbById('cpk')[5])) + '\n\n' + esc(t(kbById('trendchip')[4], kbById('trendchip')[5]));
    return R(s, {chips: [t('Ppk vs Cpk', 'Cpk aur Ppk ka antar'), t('Aim vs Std limits', 'Aim aur Std limits')]});
  }
  if(kpi){
    const d = await getData(), lab = plainLabel((kpi.querySelector('.label') || kpi).textContent), k = (d.k.kpis || []).find(x => plainLabel(x.label) === lab) || findKpis(lab.toLowerCase(), d.k.kpis || [])[0];
    if(k){ const e = KB.find(x => x[2].some(w => k.label.toLowerCase().includes(w))); return R(kpiLine(k) + (e ? `\n\nℹ️ ${esc(t(e[4], e[5]))}` : '') + `\n\n${t('Click the card normally (Help mode off) to open its records.', 'Records dekhne ke liye Help mode band karke card par click karo.')}`, {chips: [t('Why did it change?', 'Kyun badla?'), t('Summary', 'Summary batao')]}); }
  }
  const tabBtn = el.closest('.tab-btn'); if(tabBtn){ const k = tabBtn.dataset.tab; const dsc = tabDesc(k); if(dsc) return R(dsc); }
  const ff = el.closest('.filter-field'); if(ff){ const k = ff.dataset.filterKey, e = kbById('filters'); return R(`**${esc(plainLabel((ff.querySelector('label,.filter-label') || {}).textContent || k))}** — ${t('current', 'abhi')}: ${esc((window.currentFilters || {})[k] || 'All')}\n${esc(t(e[4], e[5]))}`); }
  const hdr = el.closest('#exportMenuBtn,#cmdkOpenBtn,.live-status,#qaOpenBtn');
  if(hdr){ const m = {exportMenuBtn: 'export', cmdkOpenBtn: 'palette', qaOpenBtn: null}, id = hdr.id ? m[hdr.id] : 'live';
    if(hdr.id === 'qaOpenBtn') return R(t('That is me — ask anything about the numbers, or click any card / chart in Help mode.', 'Ye main hoon — numbers ke baare mein kuch bhi poochho, ya Help mode mein kisi card / chart par click karo.')); if(id) return R(kbHtml(kbById(id))); }
  const panel = el.closest('.analytics-panel,.panel,.qcr-card,.chem-panel,section');
  if(panel){
    const h = panel.querySelector('h2,h3,.analytics-panel-title'), title = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    if(title){ const d = await getData().catch(() => null), hit = CHART_HELP.find(c => c[0].test(title));
      let body = '';
      if(hit){ const txt = hit[1] && CHART_TEXT[hit[1]] ? CHART_TEXT[hit[1]] : null, e = hit[1] ? kbById(hit[1] === 'decisions' ? 'decisions' : hit[1]) : null; body = txt ? t(txt[0], txt[1]) : e ? t(e[4], e[5]) : ''; const live = d ? hit[2](d) : ''; if(live) body += `\n\n📍 ${live}`; }
      else body = t('This section shows the numbers behind the dashboard for the current filters. Hover bars and points for exact values; click bars or rows to drill down.', 'Ye section current filters ke numbers dikhata hai. Exact value ke liye bars/points par hover karo; drill-down ke liye bars ya rows par click karo.');
      return R(`**${esc(title.replace(/^[^A-Za-z0-9]+/, ''))}**\n${esc(body).replace(/\n/g, '\n')}`.replace(/&lt;br&gt;/g, '\n'), {chips: [t('Why did it change?', 'Kyun badla?'), t('Top defects', 'Top defects')]}); }
  }
  return null;
}
const SELECTORS = '.kpi-card,.tab-btn,.filter-field,#exportMenuBtn,#cmdkOpenBtn,.live-status,#qaOpenBtn,.analytics-panel,.panel,.qcr-card,.chem-panel';
let helpOn = false;
function onHelpClick(e){
  if(!helpOn) return; const tg = e.target; if(!tg || !tg.closest) return;
  if(tg.closest('#qaPanel,#qaBanner,#cmdkModal')) return;
  const el = tg.closest(SELECTORS); if(!el) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  el.classList.add('qa-flash'); setTimeout(() => el.classList.remove('qa-flash'), 1200);
  openPanel('ask'); const typing = addMsg('bot', '…', {typing: true});
  explainElement(el).then(r => { typing.remove(); if(r) addBot(r); else addBot(R(t('No specific help for this spot — click a card, chart, tab or filter.', 'Is jagah ki specific help nahi — kisi card, chart, tab ya filter par click karo.'))); }).catch(err => { typing.remove(); addBot(R('⚠️ ' + esc(err.message))); });
}
function setHelpMode(on){
  helpOn = !!on; document.documentElement.classList.toggle('qa-help', helpOn);
  let b = $('qaBanner');
  if(helpOn){ if(!b){ b = document.createElement('div'); b.id = 'qaBanner'; b.className = 'qa-banner'; document.body.appendChild(b); b.addEventListener('click', ev => { if(ev.target.closest('button')) setHelpMode(false); }); }
    b.innerHTML = `<span>❓ <b>${esc(t('Help mode', 'Help mode'))}</b> — ${esc(t('click any card, chart, tab or filter to have it explained', 'kisi bhi card, chart, tab ya filter par click karo — samjha dunga'))}</span><button type="button">${esc(t('Exit (Esc)', 'Band (Esc)'))}</button>`; b.hidden = false; }
  else if(b) b.hidden = true;
  const tg = $('qaHelpToggle'); if(tg){ tg.classList.toggle('on', helpOn); tg.setAttribute('aria-pressed', helpOn ? 'true' : 'false'); }
}

// ---------------------------------------------------------------- panel UI
let panel, body, input, chipsEl, helpView, askView, msgs = [], mode = 'ask', speaking = null;
function buildPanel(){
  if($('qaPanel')) return;
  panel = document.createElement('aside'); panel.id = 'qaPanel'; panel.className = 'qa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Quality Assistant'); panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `<div class="qa-head"><div class="qa-title"><span class="qa-spark">✨</span> <b>Quality Assistant</b><small id="qaSub"></small></div>
    <div class="qa-head-actions"><button type="button" id="qaLang" title="Language / Bhasha"></button><button type="button" id="qaHelpToggle" aria-pressed="false" title="Click-to-explain mode">❓ <span id="qaHelpLbl"></span></button><button type="button" id="qaClose" aria-label="Close">✕</button></div></div>
    <div class="qa-tabs" role="tablist"><button type="button" role="tab" data-qa-tab="ask" class="active"></button><button type="button" role="tab" data-qa-tab="help"></button></div>
    <div class="qa-view" id="qaAsk"><div class="qa-body" id="qaBody" aria-live="polite"></div><div class="qa-chips" id="qaChips"></div>
      <form class="qa-input" id="qaForm" autocomplete="off"><input id="qaInput" type="text" maxlength="300" aria-label="Ask"><button type="button" id="qaMic" title="Voice" hidden>🎤</button><button type="submit" id="qaSend" aria-label="Send">➤</button></form></div>
    <div class="qa-view" id="qaHelp" hidden><div class="qa-help-search"><input id="qaHelpSearch" type="search" maxlength="60"></div><div class="qa-help-list" id="qaHelpList"></div></div>`;
  document.body.appendChild(panel);
  body = $('qaBody'); input = $('qaInput'); chipsEl = $('qaChips'); helpView = $('qaHelp'); askView = $('qaAsk');
  $('qaClose').addEventListener('click', closePanel);
  $('qaHelpToggle').addEventListener('click', () => { setHelpMode(!helpOn); if(helpOn && window.innerWidth < 700) closePanel(); });
  $('qaLang').addEventListener('click', () => { lang = lang === 'en' ? 'hi' : 'en'; try { localStorage.setItem(LS_LANG, lang); } catch(e){} relabel(); renderHelpList(); addBot(R(t('Language: English', 'Bhasha: Hinglish'), {chips: chipsDefault()})); });
  panel.querySelectorAll('[data-qa-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.qaTab)));
  $('qaForm').addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if(v) ask(v); });
  $('qaHelpSearch').addEventListener('input', renderHelpList);
  body.addEventListener('click', e => {
    const c = e.target.closest('[data-qa-act]'); if(c){ const m = msgs[+c.dataset.qaMsg]; const a = m && m.actions && m.actions[+c.dataset.qaAct]; if(a) a.run(); return; }
    const s = e.target.closest('[data-qa-say]'); if(s){ speak(msgs[+s.dataset.qaSay]); }
  });
  chipsEl.addEventListener('click', e => { const c = e.target.closest('[data-qa-chip]'); if(c) ask(c.dataset.qaChip); });
  helpView.addEventListener('click', e => { const b = e.target.closest('[data-qa-kb]'); if(b){ const en = kbById(b.dataset.qaKb); setTab('ask'); addUser(en[3]); addBot(R(kbHtml(en))); } });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SR){ const mic = $('qaMic'); mic.hidden = false; mic.addEventListener('click', () => { try { const r = new SR(); r.lang = lang === 'en' ? 'en-IN' : 'hi-IN'; r.interimResults = false; mic.classList.add('rec'); r.onresult = ev => { input.value = ev.results[0][0].transcript; ask(input.value); }; r.onend = () => mic.classList.remove('rec'); r.onerror = () => mic.classList.remove('rec'); r.start(); } catch(e){ mic.classList.remove('rec'); } }); }
  relabel(); renderHelpList(); greet();
}
function relabel(){
  $('qaSub').textContent = ' · ' + t('free · works offline', 'free · offline chalta hai');
  $('qaLang').textContent = lang === 'en' ? 'EN' : 'हिं'; $('qaLang').title = t('Switch language (English / Hinglish)', 'Bhasha badlo (English / Hinglish)');
  $('qaHelpLbl').textContent = t('Help mode', 'Help mode');
  panel.querySelector('[data-qa-tab="ask"]').textContent = '💬 ' + t('Ask', 'Poochho'); panel.querySelector('[data-qa-tab="help"]').textContent = '📘 ' + t('Help & Glossary', 'Help aur Glossary');
  input.placeholder = t('Ask about the numbers…  e.g. “Reject % kitna hai?”', 'Numbers ke baare mein poochho… jaise “Reject % kitna hai?”');
  $('qaHelpSearch').placeholder = t('Search help: Cpk, export, filters…', 'Help dhundo: Cpk, export, filters…');
}
function setTab(k){
  mode = k; panel.querySelectorAll('[data-qa-tab]').forEach(b => b.classList.toggle('active', b.dataset.qaTab === k));
  askView.hidden = k !== 'ask'; helpView.hidden = k !== 'help'; if(k === 'ask') setTimeout(() => input.focus(), 30); else setTimeout(() => $('qaHelpSearch').focus(), 30);
}
function renderHelpList(){
  if(!helpView) return; const q = ($('qaHelpSearch').value || '').toLowerCase().trim();
  let html = ''; Object.keys(KB_GROUPS).forEach(g => {
    const items = KB.filter(e => e[1] === g && (!q || (e[3] + ' ' + e[2].join(' ') + ' ' + t(e[4], e[5])).toLowerCase().includes(q))); if(!items.length) return;
    html += `<div class="qa-help-group">${esc(t(KB_GROUPS[g][0], KB_GROUPS[g][1]))}</div>` + items.map(e => `<button type="button" class="qa-topic" data-qa-kb="${esc(e[0])}"><b>${esc(e[3])}</b><span>${esc(t(e[4], e[5]).slice(0, 86))}…</span></button>`).join('');
  });
  $('qaHelpList').innerHTML = html || `<div class="qa-empty">${esc(t('No help topic matches.', 'Koi help topic nahi mila.'))}</div>`;
}
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
function addMsg(who, html, o){
  const i = msgs.push({who, html, plain: o && o.plain, actions: o && o.actions}) - 1, el = document.createElement('div'); el.className = 'qa-msg qa-' + who + (o && o.typing ? ' qa-typing' : '');
  el.innerHTML = o && o.raw ? html : (who === 'user' ? esc(html) : html);
  if(who === 'bot' && !(o && o.typing)) el.insertAdjacentHTML('beforeend', `<div class="qa-msg-tools"><button type="button" data-qa-say="${i}" title="${esc(t('Read aloud', 'Padhkar sunao'))}">🔊</button></div>`);
  if(o && o.actions && o.actions.length) el.insertAdjacentHTML('beforeend', `<div class="qa-acts">${o.actions.map((a, n) => `<button type="button" data-qa-msg="${i}" data-qa-act="${n}">${esc(a.label)}</button>`).join('')}</div>`);
  body.appendChild(el); body.scrollTop = body.scrollHeight; return el;
}
const addUser = txt => addMsg('user', txt);
function addBot(r){
  const html = r.html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  addMsg('bot', html, {raw: true, plain: r.html.replace(/\*\*/g, '').replace(/[▲▼•→✅⚠️🎯🩺🔴🟠🟢📍ℹ️]/g, ' '), actions: r.actions});
  chipsEl.innerHTML = (r.chips || []).slice(0, 5).map(c => `<button type="button" data-qa-chip="${esc(c)}">${esc(c)}</button>`).join('');
}
function greet(){ addBot(R(t('Hi! I explain the numbers on this dashboard — free and offline. Ask in English or Hinglish, or turn on **Help mode** and click any card or chart.', 'Namaste! Main is dashboard ke numbers samjhata hoon — free aur offline. English ya Hinglish mein poochho, ya **Help mode** on karke kisi bhi card ya chart par click karo.'), {chips: chipsDefault()})); }
async function ask(text){
  setTab('ask'); addUser(text); input.value = ''; chipsEl.innerHTML = '';
  const typing = addMsg('bot', '…', {typing: true});
  try { const r = await answer(text); typing.remove(); addBot(r); }
  catch(e){ typing.remove(); addBot(R('⚠️ ' + t('Could not read the data', 'Data nahi padh paya') + ': ' + esc(e.message), {chips: chipsDefault()})); }
}
function speak(m){
  if(!m || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(String(m.plain || '').replace(/<[^>]+>/g, ' ').slice(0, 900)); u.lang = lang === 'en' ? 'en-IN' : 'hi-IN';
  if(speaking){ speechSynthesis.cancel(); const same = speaking === m; speaking = null; if(same) return; }
  speaking = m; u.onend = () => { speaking = null; }; speechSynthesis.speak(u);
}
function openPanel(tab){
  buildPanel(); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); document.documentElement.classList.add('qa-open');
  const b = $('qaOpenBtn'); if(b) b.setAttribute('aria-expanded', 'true'); setTab(tab || mode);
}
function closePanel(){
  if(!panel) return; panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); document.documentElement.classList.remove('qa-open');
  const b = $('qaOpenBtn'); if(b) b.setAttribute('aria-expanded', 'false'); if('speechSynthesis' in window) speechSynthesis.cancel();
}
const togglePanel = tab => (panel && panel.classList.contains('open') && (!tab || tab === mode)) ? closePanel() : openPanel(tab);

function init(){
  const btn = $('qaOpenBtn'); if(btn) btn.addEventListener('click', () => togglePanel('ask'));
  document.addEventListener('click', onHelpClick, true);
  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if(e.key === '/' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); togglePanel('ask'); return; }
    if(e.key === 'Escape'){ if(helpOn){ setHelpMode(false); e.stopPropagation(); return; } if(panel && panel.classList.contains('open') && !document.querySelector('#cmdkModal.open, .drill-modal.open')){ closePanel(); } return; }
    if(e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openPanel('help'); }
  }, true);
}
window.QDAssist = {open: tab => openPanel(tab || 'ask'), help: () => openPanel('help'), ask: q => { openPanel('ask'); return ask(q); }, helpMode: on => setHelpMode(on === undefined ? !helpOn : on), isHelpMode: () => helpOn, toggleLang: () => { lang = lang === 'en' ? 'hi' : 'en'; try { localStorage.setItem(LS_LANG, lang); } catch(e){} if(panel) { relabel(); renderHelpList(); } return lang; }, lang: () => lang, _answer: answer, _kb: KB};
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
