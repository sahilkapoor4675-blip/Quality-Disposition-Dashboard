/* 23-assistant.js — Free, offline "Quality Assistant": Ask (answers from the dashboard's own numbers), Help (glossary + how-to), Help mode
   (click any card / chart / table column / button and a small explain card pops up next to it), a guided tour, read-aloud and voice input.
   Languages: English, Hinglish (Roman Hindi) and Hindi (Devanagari) — for the answers AND for understanding what is typed.
   No API key, no paid service: the only request is the dashboard's own /api/qcr. Bundled into /app.js in filename order (after 22-boot.js).
   Public API: window.QDAssist. */
qdAssistantModule();   // function declaration (hoisted) instead of an IIFE: the app.js bundle must end with "}" (tests/test_smoke.py)
function qdAssistantModule(){
'use strict';
const LS_LANG = 'qd_assist_lang', LS_SEEN = 'qd_assist_seen';
const LANGS = [['en', 'English'], ['hl', 'Hinglish'], ['dv', 'हिन्दी']];
let lang = 'hl';
try { const s = localStorage.getItem(LS_LANG); lang = s === 'en' || s === 'dv' || s === 'hl' ? s : (s === 'hi' ? 'hl' : 'hl'); } catch(e){}
// t(english, hinglish, hindi): the Hindi text falls back to Hinglish, then English
const t = (en, hl, dv) => lang === 'en' ? en : lang === 'dv' ? (dv || hl || en) : (hl || en);
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = id => document.getElementById(id);
const pct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%';
const num = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString(undefined, {minimumFractionDigits: d, maximumFractionDigits: d});
const fmtK = (k, v) => v == null ? '—' : k.fmt === 'pct' ? pct(v) : k.fmt === 'int' ? Math.round(v).toLocaleString() : num(v, k.fmt === 'num2' ? 2 : 3);
const plainLabel = s => String(s || '').replace(/^[^A-Za-z0-9]+/, '').trim();
const setLangStore = l => { lang = l; try { localStorage.setItem(LS_LANG, l); } catch(e){} };

// ---------------------------------------------------------------- understanding typed text (English / Hinglish / Devanagari Hindi)
// Hindi words are mapped to the Roman keywords the router already knows, so every question works in all three scripts.
const DEVA = [
  [/वर्क\s*सेंटर|वर्कसेंटर|कार्य\s*केंद्र/g, ' work center '], [/कंट्रोल\s*रूम|नियंत्रण\s*कक्ष/g, ' control room '], [/डिफेक्ट्स?\s*लिस्ट|दोष\s*सूची/g, ' defects list '],
  [/पीरियड\s*ट्रेंड|अवधि\s*रुझान/g, ' period trend '], [/डार्क\s*मोड|अंधेरा\s*मोड|रात\s*मोड/g, ' dark mode '], [/लाइट\s*मोड/g, ' light mode '],
  [/क्या\s*करना\s*चाहिए|क्या\s*करें|क्या\s*करूं|क्या\s*करूँ|आगे\s*क्या|सुझाव|कार्रवाई|कार्यवाही/g, ' what should i do '], [/क्या\s*होता\s*है|क्या\s*होती\s*है|क्या\s*है|मतलब|समझाओ|समझाइए|समझाइये|परिभाषा|अर्थ/g, ' kya hai '],
  [/सबसे\s*खराब|सबसे\s*बुरा|सबसे\s*ज़्यादा\s*रिजेक्ट|सबसे\s*ज्यादा\s*रिजेक्ट/g, ' worst '], [/सबसे\s*अच्छा|सबसे\s*बढ़िया|सबसे\s*बेहतर/g, ' best '],
  [/सारांश|समरी|स्थिति|हाल\s*चाल|हालचाल|हाल|रिपोर्ट\s*कार्ड|ओवरव्यू|अवलोकन/g, ' summary '], [/रिजेक्ट|रिजेक्शन|अस्वीकृत|रद्द/g, ' reject '],
  [/डिफेक्ट्स|डिफेक्ट|दोषों|दोष|खराबी|कमी/g, ' defect '], [/ग्रेड/g, ' grade '], [/रुझान|ट्रेंड|प्रवृत्ति/g, ' trend '], [/महीना|महीने|मासिक|माह/g, ' month '],
  [/क्यों|क्यूं|कारण|वजह/g, ' kyun '], [/बढ़ा|बढ़ गया|बढ़ी|बढ़ रहा|गिरा|गिर गया|घटा|घट गया|बदला|बदलाव/g, ' badha '],
  [/अलर्ट|चेतावनियाँ|चेतावनियां|चेतावनी|जोखिम|समस्याएँ|समस्याएं|समस्या|दिक्कत|खतरा/g, ' alert '], [/पूर्वानुमान|अनुमान|भविष्य/g, ' forecast '], [/कितना|कितनी|कितने|कितना\s*है/g, ' kitna '],
  [/खोलो|खोलिए|खोलिये|खोलें|खोल\s*दो|चलो|जाओ/g, ' kholo '], [/दिखाओ|दिखाइए|दिखाइये|दिखाएं|दिखाएँ|बताओ|बताइए|बताइये/g, ' dikhao '],
  [/शीर्ष|टॉप|सबसे\s*ऊपर/g, ' top '], [/फिल्टर|फ़िल्टर|छान/g, ' filter '], [/रीसेट|साफ\s*करो|हटाओ|हटाएं/g, ' reset '], [/निर्यात|एक्सपोर्ट|डाउनलोड/g, ' export '],
  [/एक्सेल/g, ' excel '], [/पीडीएफ/g, ' pdf '], [/पावरपॉइंट|प्रेजेंटेशन/g, ' powerpoint '], [/कॉइल|कुंडली/g, ' coil '], [/आउटपुट|उत्पादन/g, ' output '],
  [/होल्ड/g, ' hold '], [/सैल्वेज|सेल्वेज/g, ' salvage '], [/रीवर्क|रिवर्क/g, ' rework '], [/डायवर्ट/g, ' divert '], [/प्राइम/g, ' prime '],
  [/सीपीके/g, ' cpk '], [/पीपीके/g, ' ppk '], [/एफपीवाई|फर्स्ट\s*पास\s*यील्ड|प्रथम\s*पास/g, ' fpy '], [/पारेटो|पैरेटो|पेरेटो/g, ' pareto '], [/हिस्टोग्राम/g, ' histogram '],
  [/फिशबोन/g, ' fishbone '], [/केमिस्ट्री|रसायन/g, ' chemistry '], [/हीट/g, ' heat '], [/डैशबोर्ड|डैशबोर्ड/g, ' dashboard '], [/मदद|सहायता|हेल्प/g, ' help '],
  [/नमस्ते|नमस्कार|प्रणाम|हेलो|हैलो/g, ' namaste '], [/टूर|गाइड/g, ' tour '], [/अनुमत|लक्ष्य|टारगेट/g, ' target '],
  [/जनवरी/g, ' jan '], [/फ़रवरी|फरवरी/g, ' feb '], [/मार्च/g, ' mar '], [/अप्रैल/g, ' apr '], [/मई/g, ' may '], [/जून/g, ' jun '], [/जुलाई/g, ' jul '], [/अगस्त/g, ' aug '],
  [/सितंबर|सितम्बर/g, ' sep '], [/अक्टूबर|अक्तूबर/g, ' oct '], [/नवंबर|नवम्बर/g, ' nov '], [/दिसंबर|दिसम्बर/g, ' dec '],
];
function norm(raw){
  let s = String(raw || '').toLowerCase().replace(/[०-९]/g, c => String('०१२३४५६७८९'.indexOf(c)));
  if(/[\u0900-\u097F]/.test(s)) DEVA.forEach(([re, to]) => { s = s.replace(re, to); });
  s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.\/-]*(20\d{2})\b/g, '$1-$2');
  return s.replace(/[?!.,;।]+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  return parts.length ? parts.join(', ') : t('All data', 'Poora data', 'पूरा डेटा');
};
function band(label, v){
  const T = typeof KPI_TARGETS !== 'undefined' && KPI_TARGETS ? KPI_TARGETS[label] : null; if(!T || v == null) return null;
  const lower = String(T.direction).toLowerCase() === 'lower';
  const ok = lower ? v <= T.target : v >= T.target, warn = lower ? v <= T.warning : v >= T.warning;
  return {T, lower, level: ok ? 'good' : warn ? 'watch' : 'bad', text: ok ? t('On target', 'Target par', 'लक्ष्य पर') : warn ? t('Watch', 'Dhyan do', 'ध्यान दें') : t('Action needed', 'Action chahiye', 'कार्रवाई ज़रूरी')};
}
function kpiLine(k, withPrev = true){
  let s = `**${esc(plainLabel(k.label))}: ${fmtK(k, k.value)}**`;
  const b = band(k.label, k.value); if(b) s += ` — ${b.text} (${t('target', 'target', 'लक्ष्य')} ${b.lower ? '≤' : '≥'} ${fmtK(k, b.T.target)})`;
  if(withPrev && k.prev != null){
    const ch = k.change_value, arrow = k.arrow === 'up' ? '▲' : k.arrow === 'down' ? '▼' : '•', good = k.trend_color === 'good' ? t('good', 'accha', 'अच्छा') : k.trend_color === 'bad' ? t('bad', 'kharab', 'खराब') : '';
    s += `\n   ${arrow} ${t('vs previous', 'pichhle period se', 'पिछले अवधि से')} ${fmtK(k, k.prev)}${ch != null ? ` (${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(2)}%)` : ''}${good ? ' · ' + good : ''}`;
  }
  return s;
}

// ---------------------------------------------------------------- knowledge base: [id, group, keywords, titleEn, titleHi, English, Hinglish, Hindi]
const KB = [
 ['coils','kpi',['total coils','coil count','coils'],'Total Coils','कुल कॉइल','Number of coil records (inspection lots) in the current filter. Click the card to see the underlying records.','Current filter mein kitne coil records (inspection lots) hain. Card par click karoge to saare records khulenge.','मौजूदा फ़िल्टर में कुल कॉइल रिकॉर्ड (इंस्पेक्शन लॉट) कितने हैं। कार्ड पर क्लिक करने से सभी रिकॉर्ड खुलते हैं।'],
 ['output','kpi',['output quantity','output qty','production','quantity','utpadan'],'Output Quantity (MT)','आउटपुट मात्रा (MT)','Total output weight in metric tonnes of the coils in the filter. It is the base for every “% Qty” KPI.','Filter ke coils ka total weight (MT). Saare “% Qty” KPI isi par based hain.','फ़िल्टर के कॉइल का कुल वज़न (मीट्रिक टन)। सभी “% Qty” KPI इसी पर आधारित हैं।'],
 ['defect_coils','kpi',['defect coils','defective coils'],'Defect Coils','दोषपूर्ण कॉइल','Coils whose main defect is anything other than “NO DEFECT”. Lower is better.','Jin coils mein “NO DEFECT” ke alawa koi defect hai. Kam hona accha hai.','वे कॉइल जिनमें “NO DEFECT” के अलावा कोई मुख्य दोष है। कम होना बेहतर है।'],
 ['fpy','kpi',['first pass yield','fpy','prime%','prime percent','prime'],'First Pass Yield % (Prime%)','फर्स्ट पास यील्ड % (प्राइम%)','Share of output quantity that was graded PRIME at first inspection (Prime MT ÷ Output MT). Higher is better.','Output ka kitna hissa pehli baar mein PRIME nikla (Prime MT ÷ Output MT). Zyada = accha.','आउटपुट का कितना हिस्सा पहली जाँच में PRIME निकला (Prime MT ÷ Output MT)। ज़्यादा होना बेहतर है।'],
 ['defect_rate','kpi',['defect rate','defect percent','defect pct'],'Defect Rate','दोष दर','Defect coils ÷ total coils. Lower is better.','Defect coils ÷ total coils. Kam = accha.','दोषपूर्ण कॉइल ÷ कुल कॉइल। कम होना बेहतर है।'],
 ['reject_pct','kpi',['reject %','reject percent','reject pct','reject rate','rejection'],'Reject % Qty','रिजेक्ट % मात्रा','Reject quantity ÷ output quantity. Lower is better; compare with the target on the card.','Reject MT ÷ output MT. Kam = accha; card ke target se compare karo.','रिजेक्ट मात्रा ÷ आउटपुट मात्रा। कम होना बेहतर है; कार्ड के लक्ष्य से तुलना करें।'],
 ['reject_qty','kpi',['reject qty','reject quantity','reject mt','scrap'],'Reject Qty (MT)','रिजेक्ट मात्रा (MT)','Metric tonnes of coils decided REJECT.','Jo MT REJECT decide hua.','जितने MT पर REJECT का निर्णय हुआ।'],
 ['hold','kpi',['hold for decision','hold qty','hold'],'Hold for Decision','होल्ड फॉर डिसीज़न','Material waiting for a quality decision. A large hold quantity means decisions are being delayed.','Material jo quality decision ka wait kar raha hai. Hold zyada = decision mein deri.','वह माल जो गुणवत्ता निर्णय की प्रतीक्षा में है। होल्ड ज़्यादा = निर्णय में देरी।'],
 ['salvage','kpi',['salvage','divert','salvage + divert'],'Salvage / Divert','सैल्वेज / डायवर्ट','Salvage = usable after downgrade or cutting; Divert = sent to another order/grade. Both are lost prime value.','Salvage = downgrade/cut karke use hone wala; Divert = dusre order/grade mein bheja. Dono mein prime value ka nuksaan.','सैल्वेज = डाउनग्रेड/कटिंग के बाद उपयोगी माल; डायवर्ट = दूसरे ऑर्डर/ग्रेड में भेजा गया। दोनों में प्राइम वैल्यू का नुकसान है।'],
 ['rework','kpi',['rework','re-work'],'Rework % Qty','रीवर्क % मात्रा','Share of output that needs re-processing.','Output ka woh hissa jo dobara process karna padta hai.','आउटपुट का वह हिस्सा जिसे दोबारा प्रोसेस करना पड़ता है।'],
 ['decisions','kpi',['quality decision','decision','prime','for next process','reject','re-work','divert'],'Quality decisions','गुणवत्ता निर्णय','PRIME (best), FOR NEXT PROCESS, SALVAGE, HOLD FOR DECISION, RE-WORK, DIVERT, REJECT. Exact plant rules are in your QA procedure.','PRIME (sabse accha), FOR NEXT PROCESS, SALVAGE, HOLD FOR DECISION, RE-WORK, DIVERT, REJECT. Exact rules aapke QA procedure mein hain.','PRIME (सबसे अच्छा), FOR NEXT PROCESS, SALVAGE, HOLD FOR DECISION, RE-WORK, DIVERT, REJECT। सटीक नियम आपकी QA प्रक्रिया में हैं।'],
 ['cpk','spc',['cpk','process capability','capability index'],'Cpk (within σ)','Cpk (within σ)','How well the process fits inside the spec limits, using short-term (within-subgroup) variation and the nearer limit. Bands on this dashboard: ≥ 1.33 On target, ≥ 1.00 Watch, below that Action. Higher is better.','Process spec limits ke andar kitni fit hai — short-term (within) variation aur paas wali limit se. Dashboard bands: ≥ 1.33 On target, ≥ 1.00 Watch, usse kam Action. Zyada = accha.','प्रक्रिया स्पेक सीमाओं के अंदर कितनी फिट बैठती है — अल्पकालिक (within) विचलन और नज़दीकी सीमा से। डैशबोर्ड के बैंड: ≥ 1.33 लक्ष्य पर, ≥ 1.00 ध्यान दें, उससे कम कार्रवाई। ज़्यादा होना बेहतर है।'],
 ['ppk','spc',['ppk','overall capability','performance index'],'Ppk (overall σ)','Ppk (overall σ)','Same idea as Cpk but with overall (long-term) variation, so it is usually lower than Cpk. A big gap between Cpk and Ppk means the process mean drifts over time.','Cpk jaisa hi, lekin overall (long-term) variation se — isliye aksar Cpk se kam. Cpk aur Ppk mein bada gap = mean time ke saath drift kar raha hai.','Cpk जैसा ही, पर कुल (दीर्घकालिक) विचलन से — इसलिए अक्सर Cpk से कम। Cpk और Ppk में बड़ा अंतर = औसत समय के साथ खिसक रहा है।'],
 ['cp','spc',['cp ','pp ','potential capability','cp/pp'],'Cp and Pp','Cp और Pp','Cp / Pp ignore where the mean sits and only compare the spec width with the process spread. Cp ≥ Cpk always: if Cp is high but Cpk is low, centre the process.','Cp / Pp mean ki jagah ignore karke sirf spec width vs spread dekhte hain. Cp high par Cpk low ho to process ko center karo.','Cp / Pp औसत की जगह को नज़रअंदाज़ करके सिर्फ़ स्पेक चौड़ाई बनाम फैलाव देखते हैं। Cp ज़्यादा पर Cpk कम हो तो प्रक्रिया को केंद्र में लाएँ।'],
 ['sigma','spc',['std dev','standard deviation','sigma','σ','within','overall'],'Std. Dev. (within / overall)','मानक विचलन (within / overall)','Within σ is estimated from the moving range (used by Cp/Cpk); overall σ is the plain standard deviation of all heats (used by Pp/Ppk).','Within σ moving range se nikalta hai (Cp/Cpk); overall σ saare heats ka normal std dev hai (Pp/Ppk).','Within σ मूविंग रेंज से निकाला जाता है (Cp/Cpk); overall σ सभी हीट का सामान्य मानक विचलन है (Pp/Ppk)।'],
 ['aim','spc',['aim','std limit','standard limit','lsl','usl','spec limit','aim lsl','aim usl'],'Standard vs Aim limits','स्टैंडर्ड बनाम एम सीमाएँ','Std LSL/USL are the specification limits (out of spec = outside them). Aim LSL/USL are the tighter internal target band; a heat outside Aim but inside Std is a warning, not a rejection.','Std LSL/USL spec limits hain (bahar = out of spec). Aim LSL/USL tighter internal target band hai; Aim ke bahar par Std ke andar = warning, rejection nahi.','Std LSL/USL स्पेक सीमाएँ हैं (बाहर = आउट ऑफ़ स्पेक)। Aim LSL/USL अंदरूनी, ज़्यादा कसा हुआ लक्ष्य बैंड है; Aim के बाहर पर Std के अंदर = चेतावनी, रिजेक्शन नहीं।'],
 ['trendchip','spc',['trend arrow','trend chip','pp','percentage point','change chip','prev'],'Trend chip on element cards','एलिमेंट कार्ड का ट्रेंड चिप','▼ −10.32% (−0.27): the % is the relative change of the index, the bracket is the absolute difference of the index itself (e.g. 2.31 − 2.57). Cpk/Ppk have no unit, so the bracket is not percentage points.','▼ −10.32% (−0.27): % relative change hai, bracket index ka seedha antar (jaise 2.31 − 2.57). Cpk/Ppk ki unit nahi hoti, isliye bracket pp nahi hai.','▼ −10.32% (−0.27): % इंडेक्स का सापेक्ष बदलाव है, और कोष्ठक में इंडेक्स का सीधा अंतर (जैसे 2.31 − 2.57)। Cpk/Ppk की कोई इकाई नहीं होती, इसलिए कोष्ठक वाला मान प्रतिशत-बिंदु (pp) नहीं है।'],
 ['imr','spc',['individuals chart','i chart','moving range','mr chart','control chart','spc chart'],'I and MR charts','I और MR चार्ट','Each point is one heat. The I chart shows the value with mean and limits; the MR chart shows heat-to-heat change. Points outside limits, long runs on one side or steady drifts mean the process has changed.','Har point ek heat hai. I chart value + mean + limits dikhata hai, MR chart heat-to-heat badlaav. Limits ke bahar point, ek taraf lambi run ya lagatar drift = process badal gaya.','हर बिंदु एक हीट है। I चार्ट मान, औसत और सीमाएँ दिखाता है; MR चार्ट हीट-दर-हीट बदलाव। सीमा के बाहर बिंदु, एक तरफ़ लंबी कतार या लगातार खिसकाव = प्रक्रिया बदल गई है।'],
 ['hist','spc',['histogram','bar','bin','distribution'],'Histogram','हिस्टोग्राम','Distribution of heat values with Standard and Aim limits and a normal curve. Hover a bar and click it to drill down to the heats in that range.','Heat values ka distribution, Std/Aim limits aur normal curve ke saath. Bar par hover karo aur click karke us range ke heats dekho.','हीट मानों का वितरण, Std/Aim सीमाओं और नॉर्मल कर्व के साथ। बार पर माउस ले जाएँ और क्लिक करके उस रेंज की हीट देखें।'],
 ['indicative','spc',['indicative','30 heats','few heats','small sample'],'Indicative (< 30 heats)','संकेतात्मक (< 30 हीट)','With fewer than 30 heats Cpk/Ppk are only indicative — the sample is too small to trust.','30 se kam heats par Cpk/Ppk sirf indicative hain — sample chhota hai.','30 से कम हीट पर Cpk/Ppk सिर्फ़ संकेतात्मक हैं — नमूना बहुत छोटा है।'],
 ['pareto','chart',['pareto','top defects','cumulative'],'Pareto chart','पारेटो चार्ट','Bars = defect quantity (MT), line = cumulative %. The first few bars usually cause most of the loss: fix those first.','Bars = defect quantity (MT), line = cumulative %. Pehle kuch bars zyada nuksaan karte hain — pehle unhe theek karo.','बार = दोष की मात्रा (MT), रेखा = संचयी %। शुरू के कुछ बार ही ज़्यादातर नुकसान करते हैं — पहले उन्हें ठीक करें।'],
 ['intensity','chart',['intensity','light','medium','heavy'],'Defect intensity','दोष की तीव्रता','How severe the defect is on the coil (e.g. LIGHT / MEDIUM / HEAVY). Coils without an intensity are shown as “without intensity”.','Coil par defect kitna severe hai (LIGHT / MEDIUM / HEAVY). Intensity bina wale alag dikhte hain.','कॉइल पर दोष कितना गंभीर है (LIGHT / MEDIUM / HEAVY)। बिना तीव्रता वाले अलग दिखते हैं।'],
 ['fishbone','chart',['fishbone','6m','ishikawa','root cause','man machine'],'6M Fishbone','6M फिशबोन','Cause map for a defect across Man, Machine, Material, Method, Measurement and Environment, with RCA actions from the Fishbone master.','Defect ka cause map: Man, Machine, Material, Method, Measurement, Environment — RCA actions ke saath (Fishbone master se).','किसी दोष का कारण-नक्शा: Man, Machine, Material, Method, Measurement, Environment — RCA कार्रवाइयों के साथ (Fishbone master से)।'],
 ['qcr','chart',['control room','qcr','what needs attention','health score','early warning'],'Quality Control Room','क्वालिटी कंट्रोल रूम','One screen of what needs attention: health score, early warnings, critical KPIs, top contributors and the Pareto → root-cause path.','Ek screen par kya dhyan maangta hai: health score, early warnings, critical KPIs, top contributors aur Pareto → root cause.','एक स्क्रीन पर वह सब जिस पर ध्यान चाहिए: हेल्थ स्कोर, शुरुआती चेतावनियाँ, गंभीर KPI, मुख्य योगदानकर्ता और पारेटो → मूल कारण।'],
 ['forecast','chart',['forecast','predict','next period'],'Forecast','पूर्वानुमान','A simple trend projection of FPY, reject % and defect % for the next period from recent periods. It is a direction hint, not a guarantee.','Pichhle periods ke trend se agle period ka FPY, reject % aur defect % ka simple projection. Ye direction ka sanket hai, guarantee nahi.','हाल की अवधियों के ट्रेंड से अगली अवधि के FPY, रिजेक्ट % और दोष % का सरल अनुमान। यह दिशा का संकेत है, गारंटी नहीं।'],
 ['filters','howto',['filter','filters','month filter','select month','grade filter'],'Filters','फ़िल्टर','Filters are linked: choosing a Month limits the other dropdowns to values that exist in it. “Reset All” clears everything. The Week filter shows full Monday–Sunday ranges.','Filters linked hain: Month chunoge to baaki dropdown sirf us month ke values dikhayenge. “Reset All” sab saaf karta hai. Week filter poora Monday–Sunday range dikhata hai.','फ़िल्टर आपस में जुड़े हैं: महीना चुनने पर बाकी ड्रॉपडाउन सिर्फ़ उसी महीने के मान दिखाते हैं। “Reset All” सब साफ़ करता है। Week फ़िल्टर पूरा सोमवार–रविवार दिखाता है।'],
 ['drill','howto',['drill','drill down','underlying records','click card'],'Drill-down','ड्रिल-डाउन','Click a KPI card, a chart bar or a table row to open its underlying records. In the table, the header ▼ gives Excel-style filters; Export Selected Records exports exactly what is filtered.','KPI card, chart bar ya table row par click karo — underlying records khulte hain. Table header ke ▼ se Excel jaise filters; Export Selected Records filtered rows hi export karta hai.','KPI कार्ड, चार्ट बार या टेबल की पंक्ति पर क्लिक करें — नीचे के रिकॉर्ड खुलते हैं। टेबल हेडर के ▼ से एक्सेल जैसे फ़िल्टर लगते हैं; Export Selected Records वही पंक्तियाँ निकालता है जो फ़िल्टर हुई हैं।'],
 ['export','howto',['export','download','excel','pdf','ppt','powerpoint','csv','report'],'Export','एक्सपोर्ट','Header → Export: Excel, PDF, PowerPoint or CSV for the current view; Chemistry tables export as styled Excel (or CSV via the File type switch). Drill-downs have their own Export button.','Header → Export: current view ka Excel, PDF, PowerPoint ya CSV; Chemistry tables styled Excel (ya CSV, File type se). Drill-down ka apna Export button hai.','हेडर → Export: मौजूदा व्यू का Excel, PDF, PowerPoint या CSV; Chemistry टेबल स्टाइल्ड Excel (या File type से CSV) में निकलते हैं। ड्रिल-डाउन का अपना Export बटन है।'],
 ['palette','howto',['command palette','ctrl k','shortcut','shortcuts','keyboard'],'Command palette & shortcuts','कमांड पैलेट और शॉर्टकट','Ctrl+K opens the command palette (tabs, dark mode, sound, admin, assistant). “/” focuses search, 1–6 jump to tabs, Ctrl+/ opens this assistant, ? opens Help.','Ctrl+K command palette kholta hai (tabs, dark mode, sound, admin, assistant). “/” search, 1–6 tabs, Ctrl+/ assistant, ? Help kholta hai.','Ctrl+K कमांड पैलेट खोलता है (टैब, डार्क मोड, साउंड, एडमिन, असिस्टेंट)। “/” खोज, 1–6 टैब, Ctrl+/ असिस्टेंट, ? हेल्प खोलता है।'],
 ['views','howto',['saved view','preset','save preset','views'],'Saved views / presets','सेव्ड व्यू / प्रीसेट','Save Preset stores the current filters and tab; pick it later from Saved Views, or manage it from Manage Presets.','Save Preset current filters aur tab ko store karta hai; baad mein Saved Views se chuno, ya Manage Presets se sambhalo.','Save Preset मौजूदा फ़िल्टर और टैब को सहेजता है; बाद में Saved Views से चुनें या Manage Presets से संभालें।'],
 ['compare','howto',['compare','compare periods','side by side'],'Compare Periods','अवधियों की तुलना','Shows two periods (or two grades on the Chemistry tab) side by side so changes are visible at a glance.','Do periods (Chemistry mein do grades) side by side dikhata hai.','दो अवधियाँ (Chemistry टैब में दो ग्रेड) साथ-साथ दिखाता है ताकि बदलाव एक नज़र में दिखे।'],
 ['theme','howto',['dark mode','light mode','theme','night'],'Dark mode & appearance','डार्क मोड और रूप-रंग','Ctrl+K → “Switch to Dark Mode”. Accent colour, compact rows and sound are in the same palette.','Ctrl+K → “Switch to Dark Mode”. Accent colour, compact rows aur sound isi palette mein hain.','Ctrl+K → “Switch to Dark Mode”। एक्सेंट रंग, कॉम्पैक्ट पंक्तियाँ और साउंड भी इसी पैलेट में हैं।'],
 ['live','howto',['live data','last updated','data freshness','refresh','updated'],'Live data & freshness','लाइव डेटा','LIVE DATA means the dashboard checks the database revision and refreshes when new data is imported. “Last updated” shows how fresh the numbers are.','LIVE DATA = dashboard database revision check karke naya data aane par refresh hota hai. “Last updated” numbers kitne taaza hain dikhata hai.','LIVE DATA यानी डैशबोर्ड डेटाबेस का रिविज़न जाँचता है और नया डेटा आने पर खुद ताज़ा होता है। “Last updated” बताता है कि आँकड़े कितने ताज़ा हैं।'],
 ['admin','howto',['admin','import','upload data','backup','users'],'Admin panel','एडमिन पैनल','Open it from Ctrl+K → Open Admin Panel (login required): data import, KPI targets, Chemistry specs, backups and users.','Ctrl+K → Open Admin Panel (login chahiye): data import, KPI targets, Chemistry specs, backups, users.','Ctrl+K → Open Admin Panel (लॉगिन ज़रूरी): डेटा इम्पोर्ट, KPI लक्ष्य, Chemistry स्पेक, बैकअप और यूज़र।'],
 ['tour','howto',['tour','guide','walkthrough','how to start','kaise shuru'],'Guided tour','गाइडेड टूर','A 7-step walk through the main areas: filters, KPI cards, tabs, Export, Commands, Assistant and Help mode. Start it from the Help tab or the ❓ button.','7 steps mein main hisson ka tour: filters, KPI cards, tabs, Export, Commands, Assistant aur Help mode. Help tab ya ❓ button se shuru karo.','मुख्य हिस्सों का 7 चरणों का दौरा: फ़िल्टर, KPI कार्ड, टैब, Export, Commands, Assistant और Help mode। Help टैब या ❓ बटन से शुरू करें।'],
];
const KB_GROUPS = {kpi: ['📌 KPIs & decisions', '📌 KPIs aur decisions', '📌 KPI और निर्णय'], spc: ['🧪 Chemistry SPC', '🧪 Chemistry SPC', '🧪 केमिस्ट्री SPC'], chart: ['📊 Charts & analysis', '📊 Charts aur analysis', '📊 चार्ट और विश्लेषण'], howto: ['🧭 How to use', '🧭 Kaise use karein', '🧭 कैसे इस्तेमाल करें']};
const kbById = id => KB.find(e => e[0] === id);
const kbTitle = e => lang === 'dv' ? (e[4] || e[3]) : e[3];
const kbText = e => t(e[5], e[6], e[7]);
const kbHtml = (e, extra) => `**${esc(kbTitle(e))}**\n${esc(kbText(e))}${extra ? '\n\n' + extra : ''}`;
function kbSearch(q){
  const out = [];
  KB.forEach(e => { let s = 0; e[2].forEach(k => { const kk = k.trim(); if(kk && q.includes(kk)) s = Math.max(s, kk.length + (q === kk ? 5 : 0)); }); if(q.includes(e[3].toLowerCase())) s = Math.max(s, e[3].length); if(s) out.push([s, e]); });
  return out.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// ---------------------------------------------------------------- tabs
const TABS = [
  ['dashboard', ['dashboard', 'home', 'overview tab'], '📊 Dashboard', 'KPI cards, decision mix, Pareto, intensity and monthly trend for the current filters.', 'Current filters ke KPI cards, decision mix, Pareto, intensity aur monthly trend.', 'मौजूदा फ़िल्टर के KPI कार्ड, निर्णय मिश्रण, पारेटो, तीव्रता और मासिक ट्रेंड।'],
  ['controlroom', ['control room', 'qcr'], '🚨 Quality Control Room', 'What needs attention: health score, early warnings, critical KPIs, contributors and root-cause path.', 'Kya dhyan maangta hai: health score, early warnings, critical KPIs, contributors aur root cause.', 'किस पर ध्यान चाहिए: हेल्थ स्कोर, शुरुआती चेतावनियाँ, गंभीर KPI, योगदानकर्ता और मूल कारण।'],
  ['wcgrade', ['work center', 'workcenter', 'grade tab', 'wc'], '🏭 Work Center & Grade', 'Reject % and output by work center and by alloy grade.', 'Work center aur alloy grade ke hisaab se reject % aur output.', 'वर्क सेंटर और अलॉय ग्रेड के हिसाब से रिजेक्ट % और आउटपुट।'],
  ['defects', ['defects list', 'defect list', 'defects tab'], '🎯 Defects List', 'Top-10 Pareto and the complete defect occurrence register.', 'Top-10 Pareto aur poora defect occurrence register.', 'शीर्ष-10 पारेटो और दोषों का पूरा रजिस्टर।'],
  ['weekly', ['period trend', 'weekly', 'trend tab'], '📅 Period Trend', 'Weekly, quarterly and financial-year trends of defect %, reject % and FPY.', 'Weekly, quarterly aur FY trend — defect %, reject %, FPY.', 'साप्ताहिक, तिमाही और वित्त-वर्ष ट्रेंड — दोष %, रिजेक्ट %, FPY।'],
  ['chem', ['chemistry', 'chem', 'spc tab'], '🧪 Chemistry SPC', 'Heat chemistry capability (Cpk/Ppk), I-MR charts, histograms and the link to coil disposition.', 'Heat chemistry capability (Cpk/Ppk), I-MR charts, histogram aur coil disposition se link.', 'हीट केमिस्ट्री की क्षमता (Cpk/Ppk), I-MR चार्ट, हिस्टोग्राम और कॉइल डिस्पोज़िशन से जुड़ाव।'],
];
const tabDesc = key => { const x = TABS.find(a => a[0] === key); return x ? `**${esc(x[2])}**\n${esc(t(x[3], x[4], x[5]))}` : ''; };

// ---------------------------------------------------------------- answers
const R = (html, o) => Object.assign({html}, o || {});
const C = (label, q) => ({l: label, q});          // follow-up chip: label shown, English query routed
const K = id => ({l: kbTitle(kbById(id)), kb: id});  // chip that opens a Help topic
const CH = {
  summary: () => C(t('Summary', 'Summary batao', 'सारांश बताओ'), 'summary'), defects: () => C(t('Top defects', 'Top defects', 'शीर्ष दोष'), 'top defects'),
  grade: () => C(t('Worst grade', 'Sabse kharab grade', 'सबसे खराब ग्रेड'), 'worst grade'), wc: () => C(t('Worst work center', 'Sabse kharab work center', 'सबसे खराब वर्क सेंटर'), 'worst work center'),
  todo: () => C(t('What should I do?', 'Kya karna chahiye?', 'क्या करना चाहिए?'), 'what should i do'), alerts: () => C(t('Alerts', 'Alerts', 'चेतावनियाँ'), 'alerts'),
  why: () => C(t('Why did it change?', 'Kyun badla?', 'क्यों बदला?'), 'why did it change'), forecast: () => C(t('Forecast', 'Forecast', 'पूर्वानुमान'), 'forecast'),
  trend: () => C(t('Monthly trend', 'Trend dikhao', 'मासिक ट्रेंड'), 'monthly trend'), tour: () => C(t('Take a tour', 'Tour karo', 'टूर करें'), '__tour__'),
};
const chipsDefault = () => [CH.summary(), CH.defects(), CH.grade(), CH.todo(), CH.alerts()];
const ACT = {
  control: () => ({label: t('Open Control Room', 'Control Room kholo', 'कंट्रोल रूम खोलें'), run: () => activateTab('controlroom')}),
  defects: () => ({label: t('Open Defects List', 'Defects List kholo', 'दोष सूची खोलें'), run: () => activateTab('defects')}),
  wcg: () => ({label: t('Open Work Center & Grade', 'Work Center & Grade kholo', 'वर्क सेंटर और ग्रेड खोलें'), run: () => activateTab('wcgrade')}),
  trend: () => ({label: t('Open Period Trend', 'Period Trend kholo', 'पीरियड ट्रेंड खोलें'), run: () => activateTab('weekly')}),
};

async function ansSummary(){
  const d = await getData(), i = d.intel || {}, ks = d.k.kpis || [], p = d.k.period || {}, hs = i.health_score || {};
  let s = `**${t('Summary', 'Summary', 'सारांश')} · ${esc(filtersText())}**`;
  if(p.current) s += `\n${t('Period', 'Period', 'अवधि')}: ${esc(p.current)}${p.previous ? ' ' + t('vs', 'vs', 'बनाम') + ' ' + esc(p.previous) : ''} · ${(d.fr && d.fr.filtered_records || 0).toLocaleString()} ${t('records', 'records', 'रिकॉर्ड')}`;
  if(hs.score != null) s += `\n🩺 ${t('Health score', 'Health score', 'हेल्थ स्कोर')}: **${hs.score}/100** (${esc(hs.status || '')})`;
  if(i.quality_story) s += `\n\n${esc(i.quality_story)}`;
  const bad = ks.filter(k => k.trend_color === 'bad' && k.prev != null), good = ks.filter(k => k.trend_color === 'good' && k.prev != null);
  if(bad.length) s += `\n\n⚠️ ${t('Getting worse', 'Kharab ho rahe', 'बिगड़ रहे')}: ` + bad.slice(0, 4).map(k => `${esc(plainLabel(k.label))} ${fmtK(k, k.value)}`).join(' · ');
  if(good.length) s += `\n✅ ${t('Improving', 'Sudhar', 'सुधर रहे')}: ` + good.slice(0, 4).map(k => `${esc(plainLabel(k.label))} ${fmtK(k, k.value)}`).join(' · ');
  const td = (d.k.top_defects || [])[0]; if(td) s += `\n🎯 ${t('Top defect', 'Top defect', 'शीर्ष दोष')}: ${esc(td.defect)} (${num(td.qty, 2)} MT, ${pct(td.pct, 1)})`;
  return R(s, {chips: [CH.why(), CH.todo(), CH.alerts(), CH.forecast()], actions: [ACT.control()]});
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
const kbForKpi = k => KB.find(x => x[2].some(w => plainLabel(k.label).toLowerCase().includes(w)));
async function ansKpi(found){
  let h = found.map(k => kpiLine(k)).join('\n\n'); const e = found.length === 1 ? kbForKpi(found[0]) : null; if(e) h += `\n\nℹ️ ${esc(kbText(e))}`;
  return R(h, {chips: [CH.why(), CH.defects(), CH.summary()]});
}
async function ansDefects(){
  const d = await getData(), reg = (d.d.register || []).filter(r => r.qty > 0 || r.records > 0).slice(0, 5), tot = d.d.register_total || {};
  if(!reg.length) return R(t('No defects in the current filter.', 'Current filter mein koi defect nahi.', 'मौजूदा फ़िल्टर में कोई दोष नहीं है।'));
  const top3 = reg.slice(0, 3).reduce((a, r) => a + (r.qty || 0), 0), all = (d.d.totals || {}).qty || tot.qty || 0;
  let s = `**🎯 ${t('Top defects', 'Top defects', 'शीर्ष दोष')} · ${esc(filtersText())}**\n` + reg.map((r, i) => `${i + 1}. ${esc(r.defect)} — ${num(r.qty, 2)} MT · ${r.records} ${t('coils', 'coils', 'कॉइल')} (${pct(r.pct_records, 1)})`).join('\n');
  if(all) s += `\n\n${t('The top 3 are', 'Top 3 ka hissa', 'शीर्ष 3 का हिस्सा')} **${pct(top3 / all, 0)}** ${t('of defect quantity — fix these first (Pareto rule).', 'defect quantity ka hai — inhe pehle theek karo (Pareto rule).', 'दोष की मात्रा का है — इन्हें पहले ठीक करें (पारेटो नियम)।')}`;
  return R(s, {chips: [CH.todo(), CH.why()], actions: [ACT.defects()]});
}
async function ansGroups(q){
  const d = await getData(), wantWc = /work ?cent|\bwc\b|line|machine/.test(q) && !/grade/.test(q), rows = ((wantWc ? d.w.by_work_center : d.w.by_grade) || []).filter(r => r.coils > 0);
  if(!rows.length) return R(t('No data in the current filter.', 'Current filter mein data nahi.', 'मौजूदा फ़िल्टर में डेटा नहीं है।'));
  const best = /best|sabse accha|top performer|achha|accha/.test(q);
  const m = /defect/.test(q) ? ['defect_pct', t('Defect %', 'Defect %', 'दोष %')] : /fpy|prime|yield/.test(q) ? ['first_pass_yield_pct', 'FPY'] : /output|volume|production/.test(q) ? ['output_qty', t('Output', 'Output', 'आउटपुट')] : ['reject_pct_qty', t('Reject %', 'Reject %', 'रिजेक्ट %')];
  const higherBad = m[0] !== 'first_pass_yield_pct' && m[0] !== 'output_qty';
  const sorted = rows.slice().sort((a, b) => (higherBad ? (b[m[0]] - a[m[0]]) : (a[m[0]] - b[m[0]])) * (best ? -1 : 1));
  const f = r => m[0] === 'output_qty' ? num(r.output_qty, 1) + ' MT' : pct(r[m[0]], 2);
  const head = wantWc ? (best ? t('Best work centers', 'Sabse accha work centers', 'सबसे अच्छे वर्क सेंटर') : t('Worst work centers', 'Sabse kharab work centers', 'सबसे खराब वर्क सेंटर')) : (best ? t('Best grades', 'Sabse accha grades', 'सबसे अच्छे ग्रेड') : t('Worst grades', 'Sabse kharab grades', 'सबसे खराब ग्रेड'));
  const s = `**${wantWc ? '🏭' : '🏷️'} ${head} — ${esc(m[1])}**\n` + sorted.slice(0, 3).map((r, i) => `${i + 1}. ${esc(r.name)} — ${f(r)} · ${r.coils} ${t('coils', 'coils', 'कॉइल')} · ${num(r.output_qty, 1)} MT`).join('\n');
  return R(s, {chips: [wantWc ? CH.grade() : CH.wc(), CH.defects()], actions: [ACT.wcg()]});
}
async function ansTrend(){
  const d = await getData(), rows = (d.m.rows || []).filter(r => r.coils > 0);
  if(rows.length < 2) return R(t('Need at least two months of data in the filter to show a trend.', 'Trend ke liye filter mein kam se kam do mahine ka data chahiye.', 'ट्रेंड दिखाने के लिए फ़िल्टर में कम से कम दो महीने का डेटा चाहिए।'));
  const last = rows.slice(-3), L = rows[rows.length - 1], P = rows[rows.length - 2];
  const worst = rows.slice().sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0], bestF = rows.slice().sort((a, b) => b.first_pass_yield_pct - a.first_pass_yield_pct)[0];
  let s = `**📈 ${t('Monthly trend', 'Monthly trend', 'मासिक ट्रेंड')}**\n` + last.map(r => `• ${esc(r.name)}: ${r.coils.toLocaleString()} ${t('coils', 'coils', 'कॉइल')} · ${t('defect', 'defect', 'दोष')} ${pct(r.defect_pct, 1)} · ${t('reject', 'reject', 'रिजेक्ट')} ${pct(r.reject_pct_qty, 2)} · FPY ${pct(r.first_pass_yield_pct, 1)}`).join('\n');
  const dF = (L.first_pass_yield_pct - P.first_pass_yield_pct) * 100, dR = (L.reject_pct_qty - P.reject_pct_qty) * 100;
  s += `\n\n${esc(L.name)} ${t('vs', 'vs', 'बनाम')} ${esc(P.name)}: FPY ${dF >= 0 ? '▲' : '▼'} ${Math.abs(dF).toFixed(1)} pp, ${t('reject', 'reject', 'रिजेक्ट')} ${dR >= 0 ? '▲' : '▼'} ${Math.abs(dR).toFixed(2)} pp.`;
  s += `\n${t('Highest reject', 'Sabse zyada reject', 'सबसे ज़्यादा रिजेक्ट')}: ${esc(worst.name)} (${pct(worst.reject_pct_qty, 2)}) · ${t('best FPY', 'best FPY', 'सबसे अच्छा FPY')}: ${esc(bestF.name)} (${pct(bestF.first_pass_yield_pct, 1)})`;
  return R(s, {chips: [CH.forecast(), CH.why()], actions: [ACT.trend()]});
}
async function ansWhy(){
  const d = await getData(), i = d.intel || {}, w = i.why_changed || {}, pf = (i.problem_finder || []).slice(0, 3);
  let s = `**🔍 ${t('Why did it change?', 'Kyun badla?', 'क्यों बदला?')}**`;
  if(w.statement) s += `\n${esc(w.statement)}`;
  if(w.defect_contributor && w.defect_contributor.name) s += `\n• ${t('Main defect', 'Main defect', 'मुख्य दोष')}: ${esc(w.defect_contributor.name)} (${num(w.defect_contributor.qty, 2)} MT)`;
  if(w.wc_contributor && w.wc_contributor.name) s += `\n• ${t('Work center', 'Work center', 'वर्क सेंटर')}: ${esc(w.wc_contributor.name)}`;
  if(pf.length) s += `\n\n${t('Biggest problems now', 'Abhi ke sabse bade problems', 'अभी की सबसे बड़ी समस्याएँ')}:\n` + pf.map((x, n) => `${n + 1}. ${esc(x.title)} — ${esc(x.detail || '')}`).join('\n');
  if(!w.statement && !pf.length) s += `\n${t('Not enough history in this filter to explain a change. Try selecting a single month.', 'Is filter mein badlaav samjhane ke liye history kam hai. Ek month chun kar dekho.', 'इस फ़िल्टर में बदलाव समझाने के लिए इतिहास कम है। कोई एक महीना चुनकर देखें।')}`;
  return R(s, {chips: [CH.todo(), CH.defects()]});
}
async function ansAlerts(){
  const d = await getData(), ws = ((d.intel || {}).early_warnings || []).slice(0, 5);
  if(!ws.length) return R('✅ ' + t('No early warnings in the current filter.', 'Current filter mein koi early warning nahi.', 'मौजूदा फ़िल्टर में कोई चेतावनी नहीं है।'));
  const ic = {high: '🔴', medium: '🟠', low: '🟢'};
  return R(`**🚨 ${t('Early warnings', 'Early warnings', 'शुरुआती चेतावनियाँ')} (${ws.length})**\n` + ws.map(x => `${ic[String(x.severity).toLowerCase()] || '•'} ${esc(x.title)}\n   ${esc(x.detail || '')} → ${esc(x.action || '')}`).join('\n'), {chips: [CH.todo(), CH.summary()], actions: [ACT.control()]});
}
async function ansAction(){
  const d = await getData(), i = d.intel || {}, pf = (i.problem_finder || []).slice(0, 3), rec = i.recommended_investigation || [];
  let s = `**🛠️ ${t('Suggested next steps', 'Aage kya karein', 'आगे क्या करें')}**`;
  if(pf.length) s += '\n' + pf.map((x, n) => `${n + 1}. **${esc(x.action || 'Investigate')}** — ${esc(x.title)}${x.driver_path ? ' (' + esc(x.driver_path) + ')' : ''}`).join('\n');
  if(rec.length) s += `\n\n${t('Look at', 'Dekho', 'देखें')}: ${rec.slice(0, 6).map(esc).join(' → ')}`;
  s += `\n\n${t('Tip: click the Top Defect bar on the Pareto chart to open the exact heats and batches.', 'Tip: Pareto chart ke Top Defect bar par click karke exact heats aur batches dekho.', 'सुझाव: पारेटो चार्ट के शीर्ष दोष वाले बार पर क्लिक करके सटीक हीट और बैच देखें।')}`;
  return R(s, {chips: [CH.defects(), CH.alerts()], actions: [ACT.control()]});
}
async function ansForecast(){
  const d = await getData(), f = (d.intel || {}).forecast;
  if(!f || f.fpy == null) return R(t('Not enough periods to forecast. Clear the Month filter to give it history.', 'Forecast ke liye periods kam hain. Month filter hata kar history do.', 'पूर्वानुमान के लिए अवधियाँ कम हैं। महीने का फ़िल्टर हटाकर इतिहास दें।'));
  const r = f.risk || {}, ic = {high: '🔴', medium: '🟠', low: '🟢'};
  return R(`**🔮 ${t('Forecast for next period', 'Agle period ka forecast', 'अगली अवधि का पूर्वानुमान')}** (${f.periods_used} ${t('periods used', 'periods se', 'अवधियों से')})\n• FPY: ${pct(f.fpy, 1)} ${ic[r.fpy] || ''}\n• ${t('Reject %', 'Reject %', 'रिजेक्ट %')}: ${pct(f.reject_pct, 2)} ${ic[r.reject_pct] || ''}\n• ${t('Defect %', 'Defect %', 'दोष %')}: ${pct(f.defect_pct, 1)} ${ic[r.defect_pct] || ''}\n\n${t('This is a simple trend projection, not a guarantee.', 'Ye simple trend projection hai, guarantee nahi.', 'यह सरल ट्रेंड अनुमान है, गारंटी नहीं।')}`, {chips: [CH.trend(), CH.alerts()]});
}

// ---------------------------------------------------------------- actions (navigate / theme / export / filters / heat)
async function setFilter(key, value){
  const field = document.querySelector(`.filter-field[data-filter-key="${key}"]`); if(!field) return false;
  const trig = field.querySelector('.filter-trigger'); if(trig) trig.click();
  const opt = [...field.querySelectorAll('.filter-option')].find(o => (o.dataset.value || '') === value); if(!opt){ if(trig) trig.click(); return false; }
  opt.click(); return true;
}
async function tryFilterCommand(q){
  const opts = window._filterOptionsCache; if(!opts) return null;
  if(/reset|clear|saaf|hatao|all filters/.test(q) && /filter/.test(q)){ const b = $('resetAllBtn'); if(b){ b.click(); _cache.data = null; return R('↺ ' + t('All filters cleared.', 'Saare filters saaf kar diye.', 'सारे फ़िल्टर साफ़ कर दिए।'), {chips: chipsDefault()}); } }
  const verb = /\b(filter|set|select|show|dikhao|lagao|chuno|laga|only|sirf|for|kholo)\b/.test(q); if(!verb) return null;
  const done = [];
  for(const key of ['month', 'work_center', 'grade', 'quality_decision', 'financial_year', 'quarter', 'defect_intensity']){
    const items = (opts[key] || []).map(x => typeof x === 'string' ? {value: x} : x).filter(x => x.value && x.value !== 'All');
    const hit = items.filter(x => q.includes(String(x.value).toLowerCase())).sort((a, b) => String(b.value).length - String(a.value).length)[0];
    if(hit && await setFilter(key, String(hit.value))) done.push(`${key.replace(/_/g, ' ')} = ${hit.value}`);
  }
  if(!done.length) return null; _cache.data = null;
  return R('🎛️ ' + t('Filter applied', 'Filter laga diya', 'फ़िल्टर लगा दिया') + ': **' + done.map(esc).join(', ') + '**', {chips: [CH.summary(), CH.defects()]});
}
function tryNavCommand(q){
  const open = /\b(open|go|goto|show|kholo|khol|jao|chalo|dikhao|le chalo|switch)\b/.test(q);
  if(/\b(tour|guide|walkthrough)\b/.test(q) || q === '__tour__'){ setTimeout(startTour, 150); return R('🧭 ' + t('Starting the guided tour…', 'Guided tour shuru kar raha hoon…', 'गाइडेड टूर शुरू कर रहा हूँ…')); }
  if(/export|download|report/.test(q) && /(excel|pdf|ppt|powerpoint|csv|export|download)/.test(q) && open || /^export/.test(q)){ const b = $('exportMenuBtn'); if(b){ b.click(); return R('⬇️ ' + t('Export dialog opened — pick Excel, PDF, PowerPoint or CSV.', 'Export dialog khol diya — Excel, PDF, PowerPoint ya CSV chuno.', 'Export डायलॉग खोल दिया — Excel, PDF, PowerPoint या CSV चुनें।')); } }
  if(/dark|night|raat/.test(q) && /(mode|theme|on|karo|switch)/.test(q) || /light mode|theme/.test(q) && /(switch|karo|change)/.test(q)){ toggleTheme(); return R('🌓 ' + t('Theme switched.', 'Theme badal diya.', 'थीम बदल दी।')); }
  if(open){
    const hit = TABS.find(a => a[1].some(w => q.includes(w)) || q.includes(a[2].replace(/^[^A-Za-z]+/, '').toLowerCase()));
    if(hit){ activateTab(hit[0]); return R(`→ ${esc(hit[2])}\n${esc(t(hit[3], hit[4], hit[5]))}`); }
  }
  return null;
}
function tryHeat(q, raw){
  const m = String(raw).match(/\b([A-Za-z]{2,4}\d{3,6})\b/); if(!m || typeof openChemHeat !== 'function') return null;
  if(!/heat|chem|coil|batch|dikhao|kholo|open|show|detail/.test(q) && String(raw).trim().length > m[1].length + 3) return null;
  openChemHeat(m[1].toUpperCase()); return R('🔥 ' + t('Opening heat', 'Heat khol raha hoon', 'हीट खोल रहा हूँ') + ` **${esc(m[1].toUpperCase())}** — ${t('its chemistry, Aim/Std limits and coil disposition.', 'uski chemistry, Aim/Std limits aur coil disposition.', 'उसकी केमिस्ट्री, Aim/Std सीमाएँ और कॉइल डिस्पोज़िशन।')}`);
}

// ---------------------------------------------------------------- router
const EXPLAIN_RE = /(kya hai|kya hota|kya hoti|what is|what's|whats|meaning|matlab|explain|samjha|define|definition|formula|kaise|how (do|to|can)|kyun nahi|help)/;
async function answer(raw){
  const q = norm(raw);
  if(!q) return R(t('Type a question — for example “What is the reject %?” or “Top defects”.', 'Sawal likho — jaise “Reject % kitna hai?” ya “Top defects”.', 'सवाल लिखें — जैसे “रिजेक्ट % कितना है?” या “शीर्ष दोष”।'), {chips: chipsDefault()});
  if(/^(hi|hello|hey|namaste|hlo|salam|help|madad|kya kar sakte)/.test(q) && q.length < 28) return R(t('Hi! I read the numbers on this dashboard and explain them. I work offline — no cost. Try one of these:', 'Namaste! Main is dashboard ke numbers padhkar samjhata hoon. Offline chalta hoon — koi kharcha nahi. Ye try karo:', 'नमस्ते! मैं इस डैशबोर्ड के आँकड़े पढ़कर समझाता हूँ। ऑफ़लाइन चलता हूँ — कोई खर्च नहीं। इनमें से कुछ आज़माएँ:'), {chips: chipsDefault().concat([CH.tour()])});
  const r = tryHeat(q, raw) || await tryFilterCommand(q) || tryNavCommand(q); if(r) return r;
  const kb = kbSearch(q), explainType = EXPLAIN_RE.test(q);
  const d = await getData(); const kfound = findKpis(q, d.k.kpis || []);
  if(explainType && kb.length){ const e = kb[0], k = kfound[0]; return R(kbHtml(e, k ? '📍 ' + t('Right now', 'Abhi', 'अभी') + ': ' + kpiLine(k).replace(/\n\s+/g, ' · ') : ''), {chips: kb.slice(1, 3).map(x => K(x[0])).concat([CH.summary()])}); }
  if(/summary|overview|status|haal|kaisa chal|kaise chal|brief|saar|report card|health/.test(q)) return ansSummary();
  if(/why|kyun|kyu|reason|wajah|karan|badh|badha|gira|ghat|ghata|change/.test(q) && !/should i/.test(q)) return ansWhy();
  if(/forecast|predict|next period|agle|aage ka|future/.test(q)) return ansForecast();
  if(/what should|kya karun|kya karna|karna chahiye|action|recommend|suggest|next step|investigate|sudhar|improve|kaise sudhar/.test(q)) return ansAction();
  if(/alert|warning|risk|problem|issue|dikkat|chetavni|attention/.test(q) && !/grade|work ?cent/.test(q)) return ansAlerts();
  if(/(worst|best|sabse|highest|lowest|zyada|kam|rank|compare|top)/.test(q) && /(grade|work ?cent|\bwc\b|line)/.test(q) || /^(grade|work ?center|work centre)s?$/.test(q)) return ansGroups(q);
  if(/defect|pareto|kharabi|nuks/.test(q) && !kfound.length || /top defect|pareto/.test(q)) return ansDefects();
  if(/trend|month|mahin|weekly|history|progress/.test(q)) return ansTrend();
  if(kfound.length) return ansKpi(kfound);
  if(kb.length) return R(kbHtml(kb[0]), {chips: kb.slice(1, 3).map(x => K(x[0]))});
  const near = KB.filter(e => e[3].toLowerCase().split(/\W+/).some(w => w.length > 3 && q.includes(w))).slice(0, 3);
  return R(t('I did not understand that. I can summarise the numbers, rank defects / grades / work centers, explain changes, warn about risks, open tabs, apply filters and explain any term (Cpk, FPY, Pareto…).', 'Ye samajh nahi aaya. Main numbers ka summary, defects / grades / work centers ka ranking, badlaav ki wajah, risk warning, tabs kholna, filters lagana aur kisi bhi term (Cpk, FPY, Pareto…) ka matlab bata sakta hoon.', 'यह समझ नहीं आया। मैं आँकड़ों का सारांश, दोष / ग्रेड / वर्क सेंटर की रैंकिंग, बदलाव की वजह, जोखिम की चेतावनी, टैब खोलना, फ़िल्टर लगाना और किसी भी शब्द (Cpk, FPY, पारेटो…) का मतलब बता सकता हूँ।'), {chips: near.map(e => K(e[0])).concat(chipsDefault().slice(0, 3))});
}

// ---------------------------------------------------------------- Help mode: click anything, a small explain card pops up next to it
const CHART_HELP = [
  [/decision mix|quality decision/i, 'decisions', d => { const rows = (d.k.decision_table || []).filter(r => r.qty > 0).slice(0, 3); return rows.length ? t('Largest shares', 'Sabse bade hisse', 'सबसे बड़े हिस्से') + ': ' + rows.map(r => `${esc(r.decision)} ${pct(r.pct_qty, 1)}`).join(' · ') : ''; }],
  [/pareto|top \d+ defect|occurrence register/i, 'pareto', d => { const rows = (d.k.top_defects || []).slice(0, 3); return rows.length ? t('Top 3', 'Top 3', 'शीर्ष 3') + ': ' + rows.map(r => `${esc(r.defect)} ${num(r.qty, 1)} MT`).join(' · ') + ` (${t('cumulative', 'cumulative', 'संचयी')} ${pct(rows[rows.length - 1].cum_pct, 0)})` : ''; }],
  [/fishbone|6m/i, 'fishbone', () => ''],
  [/intensity/i, 'intensity', d => { const rows = (d.k.intensity_table || []).filter(r => r.qty > 0).slice(0, 3); return rows.length ? rows.map(r => `${esc(r.intensity)} ${num(r.qty, 1)} MT`).join(' · ') : ''; }],
  [/monthly|trend|weekly|quarterly|yearly|fy/i, null, d => { const rows = (d.m.rows || []).filter(r => r.coils > 0), L = rows[rows.length - 1]; return L ? `${esc(L.name)}: ${t('defect', 'defect', 'दोष')} ${pct(L.defect_pct, 1)} · ${t('reject', 'reject', 'रिजेक्ट')} ${pct(L.reject_pct_qty, 2)} · FPY ${pct(L.first_pass_yield_pct, 1)}` : ''; }],
  [/work center/i, null, d => { const r = (d.w.by_work_center || []).filter(x => x.coils > 0).sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0]; return r ? `${t('Highest reject', 'Sabse zyada reject', 'सबसे ज़्यादा रिजेक्ट')}: ${esc(r.name)} ${pct(r.reject_pct_qty, 2)}` : ''; }],
  [/grade/i, null, d => { const r = (d.w.by_grade || []).filter(x => x.coils > 0).sort((a, b) => b.reject_pct_qty - a.reject_pct_qty)[0]; return r ? `${t('Highest reject', 'Sabse zyada reject', 'सबसे ज़्यादा रिजेक्ट')}: ${esc(r.name)} ${pct(r.reject_pct_qty, 2)}` : ''; }],
  [/individuals|\(i\) chart/i, 'imr', () => ''], [/moving range|\(mr\)/i, 'imr', () => ''], [/histogram/i, 'hist', () => ''],
  [/attention|critical kpi|contributor|root cause|control room/i, 'qcr', d => { const w = ((d.intel || {}).early_warnings || [])[0]; return w ? `${t('Top warning', 'Top warning', 'शीर्ष चेतावनी')}: ${esc(w.title)}` : ''; }],
];
const CHART_TEXT = {
  decisions: ['Shows how the output quantity splits across quality decisions. A big PRIME share is good; growing SALVAGE / HOLD / REJECT slices are lost value.', 'Output quantity quality decisions mein kaise bati hai. PRIME bada = accha; SALVAGE / HOLD / REJECT badhna = value ka nuksaan.', 'आउटपुट मात्रा गुणवत्ता निर्णयों में कैसे बँटी है। PRIME बड़ा = अच्छा; SALVAGE / HOLD / REJECT बढ़ना = वैल्यू का नुकसान।'],
  pareto: ['Defects ranked by quantity with the cumulative line. Attack the first bars first — click one to see its heats and batches.', 'Defects quantity ke hisaab se ranked, cumulative line ke saath. Pehle bars par kaam karo — click karke heats aur batches dekho.', 'दोष मात्रा के हिसाब से क्रमबद्ध, संचयी रेखा के साथ। पहले शुरू के बार पर काम करें — क्लिक करके हीट और बैच देखें।'],
  fishbone: ['Six-M cause map (Man, Machine, Material, Method, Measurement, Environment) for the top defects, to guide the root-cause discussion.', 'Top defects ka 6M cause map (Man, Machine, Material, Method, Measurement, Environment) — root cause charcha ke liye.', 'शीर्ष दोषों का 6M कारण-नक्शा (Man, Machine, Material, Method, Measurement, Environment) — मूल कारण चर्चा के लिए।'],
  intensity: ['How severe the defective coils are (light to heavy). Heavy share growing = process is getting worse, not just noisier.', 'Defective coils kitne severe hain (light se heavy). Heavy hissa badhna = process kharab ho raha hai.', 'दोषपूर्ण कॉइल कितने गंभीर हैं (हल्के से भारी)। भारी हिस्सा बढ़ना = प्रक्रिया बिगड़ रही है।'],
};
const GENERIC_PANEL = ['This section shows the numbers behind the dashboard for the current filters. Hover bars and points for exact values; click bars or rows to drill down.', 'Ye section current filters ke numbers dikhata hai. Exact value ke liye bars/points par hover karo; drill-down ke liye bars ya rows par click karo.', 'यह भाग मौजूदा फ़िल्टर के आँकड़े दिखाता है। सटीक मान के लिए बार/बिंदु पर माउस ले जाएँ; ड्रिल-डाउन के लिए बार या पंक्ति पर क्लिक करें।'];
const COL_HELP = [
  [/^records?$|occurrence/i, ['Number of coil records with this defect.', 'Is defect wale coil records ki ginti.', 'इस दोष वाले कॉइल रिकॉर्ड की संख्या।']], [/qty|mt|weight|output/i, ['Quantity in metric tonnes.', 'Matra metric tonne mein.', 'मात्रा मीट्रिक टन में।']],
  [/% records|pct_records/i, ['Share of all records.', 'Saare records mein hissa.', 'सभी रिकॉर्ड में हिस्सा।']], [/defect %|defect rate/i, ['Defect coils ÷ coils.', 'Defect coils ÷ coils.', 'दोषपूर्ण कॉइल ÷ कॉइल।']],
  [/reject/i, ['Reject quantity ÷ output quantity (lower is better).', 'Reject qty ÷ output qty (kam = accha).', 'रिजेक्ट मात्रा ÷ आउटपुट मात्रा (कम बेहतर)।']], [/fpy|first pass|prime/i, ['Share graded PRIME at first inspection (higher is better).', 'Pehli inspection mein PRIME ka hissa (zyada = accha).', 'पहली जाँच में PRIME का हिस्सा (ज़्यादा बेहतर)।']],
  [/heat/i, ['Heat (melt) number — click the row to open its chemistry and coils.', 'Heat (melt) number — row par click karke chemistry aur coils dekho.', 'हीट (मेल्ट) नंबर — पंक्ति पर क्लिक करके केमिस्ट्री और कॉइल देखें।']],
  [/decision/i, ['Quality decision given to the coil (PRIME, SALVAGE, REJECT…).', 'Coil ko mila quality decision (PRIME, SALVAGE, REJECT…).', 'कॉइल को मिला गुणवत्ता निर्णय (PRIME, SALVAGE, REJECT…)।']],
];
async function explainElement(el){
  const kpi = el.closest('.kpi-card');
  if(kpi && kpi.classList.contains('chem-el-kpi')){
    const txt = kpi.innerText.replace(/\s+/g, ' '), name = (txt.match(/^([A-Za-z]{1,2})\s+([A-Z][A-Za-z ]+?)\s+Atomic/) || [])[2] || '', m = k => (txt.match(new RegExp(k + '[^\\d-]*(-?[\\d.]+)')) || [])[1];
    const cpk = m('Cpk'), ppk = m('Ppk'), cp = m('Cp'), pp = m('Pp'), c = cpk != null ? Number(cpk) : null;
    const lvl = c == null ? '' : c >= 1.33 ? t('On target', 'Target par', 'लक्ष्य पर') : c >= 1 ? t('Watch', 'Dhyan do', 'ध्यान दें') : t('Action needed', 'Action chahiye', 'कार्रवाई ज़रूरी');
    let s = `**${esc(name || 'Element')} — ${t('capability card', 'capability card', 'क्षमता कार्ड')}**\n`;
    if(cpk != null) s += `Cpk **${esc(cpk)}** (${esc(lvl)}) · Ppk **${esc(ppk || '—')}**${cp ? ` · Cp ${esc(cp)} · Pp ${esc(pp || '—')}` : ''}\n\n`;
    s += esc(kbText(kbById('cpk'))) + '\n\n' + esc(kbText(kbById('trendchip')));
    return R(s, {chips: [K('ppk'), K('aim')]});
  }
  if(kpi){
    const d = await getData(), lab = plainLabel((kpi.querySelector('.label') || kpi).textContent), k = (d.k.kpis || []).find(x => plainLabel(x.label) === lab) || findKpis(lab.toLowerCase(), d.k.kpis || [])[0];
    if(k){ const e = kbForKpi(k); return R(kpiLine(k) + (e ? `\n\nℹ️ ${esc(kbText(e))}` : '') + `\n\n${t('Turn Help mode off and click the card to open its records.', 'Records dekhne ke liye Help mode band karke card par click karo.', 'रिकॉर्ड देखने के लिए Help mode बंद करके कार्ड पर क्लिक करें।')}`, {chips: [CH.why(), CH.summary()]}); }
  }
  const tabBtn = el.closest('.tab-btn'); if(tabBtn){ const dsc = tabDesc(tabBtn.dataset.tab); if(dsc) return R(dsc); }
  const ff = el.closest('.filter-field'); if(ff){ const k = ff.dataset.filterKey, e = kbById('filters'); return R(`**${esc(plainLabel((ff.querySelector('label,.filter-label') || {}).textContent || k))}** — ${t('current', 'abhi', 'अभी')}: ${esc((window.currentFilters || {})[k] || 'All')}\n${esc(kbText(e))}`, {chips: [CH.summary()]}); }
  const th = el.closest('th'); if(th){ const txt = th.textContent.replace(/[▼▲]/g, '').replace(/\s+/g, ' ').trim(), hit = COL_HELP.find(c => c[0].test(txt));
    return R(`**${esc(t('Column', 'Column', 'कॉलम'))}: ${esc(txt)}**\n${esc(hit ? t(hit[1][0], hit[1][1], hit[1][2]) : t('Table column. Use the ▼ in the header to filter its values.', 'Table column. Header ke ▼ se iski values filter karo.', 'टेबल का कॉलम। हेडर के ▼ से इसके मान फ़िल्टर करें।'))}`); }
  const hdr = el.closest('#exportMenuBtn,#cmdkOpenBtn,.live-status,#qaOpenBtn,#qaHelpBtn');
  if(hdr){
    if(hdr.id === 'qaOpenBtn') return R(t('That is me — ask anything about the numbers, in English, Hinglish or Hindi.', 'Ye main hoon — numbers ke baare mein kuch bhi poochho, English, Hinglish ya Hindi mein.', 'यह मैं हूँ — आँकड़ों के बारे में कुछ भी पूछें, English, Hinglish या हिन्दी में।'));
    const m = {exportMenuBtn: 'export', cmdkOpenBtn: 'palette'}; return R(kbHtml(kbById(hdr.id ? m[hdr.id] : 'live')));
  }
  const panel = el.closest('.analytics-panel,.panel,.qcr-card,.chem-panel,section');
  if(panel){
    const h = panel.querySelector('h2,h3,.analytics-panel-title'), title = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    if(title){
      const d = await getData().catch(() => null), hit = CHART_HELP.find(c => c[0].test(title)); let body = '';
      if(hit){ const txt = hit[1] && CHART_TEXT[hit[1]] ? CHART_TEXT[hit[1]] : null, e = hit[1] ? kbById(hit[1]) : null; body = txt ? t(txt[0], txt[1], txt[2]) : e ? kbText(e) : ''; const live = d ? hit[2](d) : ''; if(live) body += `\n\n📍 ${live}`; }
      else body = t(GENERIC_PANEL[0], GENERIC_PANEL[1], GENERIC_PANEL[2]);
      const tip = el.closest('[data-tip]'); if(tip) body += `\n\n👆 ${t('You clicked', 'Aapne click kiya', 'आपने क्लिक किया')}: ${String(tip.getAttribute('data-tip')).replace(/\s+/g, ' ').slice(0, 140)}`;
      return R(`**${esc(title.replace(/^[^A-Za-z0-9\u0900-\u097F]+/, ''))}**\n${esc(body).replace(/\n/g, '\n')}`.replace(/&lt;br&gt;/g, '\n'), {chips: [CH.why(), CH.defects()]});
    }
  }
  return null;
}
const SELECTORS = '.kpi-card,.tab-btn,.filter-field,#exportMenuBtn,#cmdkOpenBtn,.live-status,#qaOpenBtn,th,.analytics-panel,.panel,.qcr-card,.chem-panel';
let helpOn = false;
function onHelpClick(e){
  if(!helpOn) return; const tg = e.target; if(!tg || !tg.closest) return;
  if(tg.closest('#qaPanel,#qaBanner,#qaPop,#cmdkModal,#qaHelpBtn')) return;
  const el = tg.closest(SELECTORS); if(!el) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  el.classList.add('qa-flash'); setTimeout(() => el.classList.remove('qa-flash'), 1200);
  showPop(null, {x: e.clientX, y: e.clientY}, true);
  explainElement(el).then(r => showPop(r || R(t('No specific help for this spot — click a card, chart, tab, filter or column.', 'Is jagah ki specific help nahi — kisi card, chart, tab, filter ya column par click karo.', 'इस जगह की खास मदद नहीं है — किसी कार्ड, चार्ट, टैब, फ़िल्टर या कॉलम पर क्लिक करें।')), {x: e.clientX, y: e.clientY}))
    .catch(err => showPop(R('⚠️ ' + esc(err.message)), {x: e.clientX, y: e.clientY}));
}
function setHelpMode(on){
  helpOn = !!on; document.documentElement.classList.toggle('qa-help', helpOn); if(!helpOn) hidePop();
  let b = $('qaBanner');
  if(helpOn){
    if(!b){ b = document.createElement('div'); b.id = 'qaBanner'; b.className = 'qa-banner'; document.body.appendChild(b);
      b.addEventListener('click', ev => { const x = ev.target.closest('button'); if(!x) return; if(x.dataset.qaB === 'tour') startTour(); else setHelpMode(false); }); }
    b.innerHTML = `<span>❓ <b>${esc(t('Help mode', 'Help mode', 'हेल्प मोड'))}</b> — ${esc(t('click any card, chart, column, tab or filter', 'kisi bhi card, chart, column, tab ya filter par click karo', 'किसी भी कार्ड, चार्ट, कॉलम, टैब या फ़िल्टर पर क्लिक करें'))}</span><button type="button" data-qa-b="tour">🧭 ${esc(t('Tour', 'Tour', 'टूर'))}</button><button type="button" data-qa-b="exit">${esc(t('Exit (Esc)', 'Band (Esc)', 'बंद (Esc)'))}</button>`; b.hidden = false;
  } else if(b) b.hidden = true;
  [$('qaHelpToggle'), $('qaHelpBtn')].forEach(x => { if(x){ x.classList.toggle('on', helpOn); x.setAttribute('aria-pressed', helpOn ? 'true' : 'false'); } });
}
// the pop-up explain card
let pop = null, popAnswer = null;
function ensurePop(){
  if(pop) return pop; pop = document.createElement('div'); pop.id = 'qaPop'; pop.className = 'qa-pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
  pop.innerHTML = '<div class="qa-pop-bar"><span class="qa-pop-ico">✨</span><span class="qa-pop-tag"></span><button type="button" data-qa-p="say" title="🔊">🔊</button><button type="button" data-qa-p="close" aria-label="Close">✕</button></div><div class="qa-pop-body"></div><div class="qa-pop-chips"></div><div class="qa-pop-foot"></div>';
  document.body.appendChild(pop);
  pop.addEventListener('click', e => {
    const b = e.target.closest('[data-qa-p],[data-qa-chip],[data-qa-kbchip],[data-qa-popact]'); if(!b) return;
    if(b.dataset.qaP === 'close'){ hidePop(); return; }
    if(b.dataset.qaP === 'say'){ speak({plain: popAnswer && popAnswer.plain}); return; }
    if(b.dataset.qaP === 'more'){ const r = popAnswer; hidePop(); openPanel('ask'); if(r) addBot(r.r); return; }
    if(b.dataset.qaChip){ const q = b.dataset.qaChip; hidePop(); ask(q, b.textContent); return; }
    if(b.dataset.qaKbchip){ const en = kbById(b.dataset.qaKbchip); hidePop(); openPanel('ask'); addUser(kbTitle(en)); addBot(R(kbHtml(en))); return; }
    if(b.dataset.qaPopact){ const a = popAnswer && popAnswer.r.actions[+b.dataset.qaPopact]; if(a){ hidePop(); setHelpMode(false); a.run(); } }
  });
  return pop;
}
function chipHtml(c){ return c.kb ? `<button type="button" data-qa-kbchip="${esc(c.kb)}">${esc(c.l)}</button>` : `<button type="button" data-qa-chip="${esc(c.q)}">${esc(c.l)}</button>`; }
const mdHtml = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const plainOf = s => s.replace(/\*\*/g, '').replace(/[▲▼•→✅⚠️🎯🩺🔴🟠🟢📍ℹ️👆]/g, ' ');
function showPop(r, at, loading, anchor){
  const p = ensurePop(); const body = p.querySelector('.qa-pop-body');
  if(loading || !r){ p.querySelector('.qa-pop-tag').textContent = t('Explaining…', 'Samjha raha hoon…', 'समझा रहा हूँ…'); body.innerHTML = '<span class="qa-dots"><i></i><i></i><i></i></span>'; p.querySelector('.qa-pop-chips').innerHTML = ''; p.querySelector('.qa-pop-foot').innerHTML = ''; }
  else {
    popAnswer = {r, plain: plainOf(r.html)};
    p.querySelector('.qa-pop-tag').textContent = t('Help', 'Help', 'हेल्प');
    body.innerHTML = mdHtml(r.html);
    p.querySelector('.qa-pop-chips').innerHTML = (r.chips || []).slice(0, 3).map(chipHtml).join('');
    p.querySelector('.qa-pop-foot').innerHTML = (r.actions || []).map((a, i) => `<button type="button" data-qa-popact="${i}">${esc(a.label)}</button>`).join('') + `<button type="button" data-qa-p="more">💬 ${esc(t('Ask more', 'Aur poochho', 'और पूछें'))}</button>`;
  }
  p.hidden = false; p.classList.toggle('qa-pop-tour', false);
  place(p, at, anchor);
}
function place(p, at, anchor){
  const W = window.innerWidth, H = window.innerHeight, pw = Math.min(360, W - 16); p.style.width = pw + 'px'; p.style.maxHeight = Math.max(160, H - 24) + 'px';
  const ph = p.offsetHeight; let x, y;
  if(anchor){ const r = anchor.getBoundingClientRect(); x = r.left + r.width / 2 - pw / 2; y = r.bottom + 12; if(y + ph > H - 8) y = Math.max(8, r.top - ph - 12); }
  else { x = at.x + 14; y = at.y + 14; if(x + pw > W - 8) x = at.x - pw - 14; if(y + ph > H - 8) y = at.y - ph - 14; }
  p.style.left = Math.max(8, Math.min(x, W - pw - 8)) + 'px'; p.style.top = Math.max(8, Math.min(y, H - ph - 8)) + 'px';
}
function hidePop(){ if(pop) pop.hidden = true; popAnswer = null; }

// ---------------------------------------------------------------- guided tour
const TOUR = [
  ['#filters', 'Filters', 'फ़िल्टर', 'Start here: pick Month, Work Center, Grade… The dropdowns are linked, and every card and chart below follows your selection.', 'Yahan se shuru karo: Month, Work Center, Grade… Dropdowns linked hain, neeche ke saare cards aur charts isi selection ko follow karte hain.', 'यहाँ से शुरू करें: महीना, वर्क सेंटर, ग्रेड… ड्रॉपडाउन आपस में जुड़े हैं, और नीचे के सभी कार्ड और चार्ट आपके चयन के हिसाब से बदलते हैं।'],
  ['.kpi-card', 'KPI cards', 'KPI कार्ड', 'Each card is one KPI. The colour shows the status against the target; the arrow shows the change from the previous period. Click a card to open its records.', 'Har card ek KPI hai. Colour target ke mukable status dikhata hai; arrow pichhle period se badlaav. Card par click karke records dekho.', 'हर कार्ड एक KPI है। रंग लक्ष्य के मुकाबले स्थिति बताता है; तीर पिछली अवधि से बदलाव। रिकॉर्ड देखने के लिए कार्ड पर क्लिक करें।'],
  ['#tabs', 'Tabs', 'टैब', 'Dashboard, Quality Control Room, Work Center & Grade, Defects List, Period Trend and Chemistry SPC. Keys 1–6 jump between them.', 'Dashboard, Quality Control Room, Work Center & Grade, Defects List, Period Trend aur Chemistry SPC. Keys 1–6 se jump karo.', 'डैशबोर्ड, क्वालिटी कंट्रोल रूम, वर्क सेंटर और ग्रेड, दोष सूची, पीरियड ट्रेंड और केमिस्ट्री SPC। कुंजी 1–6 से सीधे जाएँ।'],
  ['#exportMenuBtn', 'Export', 'एक्सपोर्ट', 'Download the current view as Excel, PDF, PowerPoint or CSV.', 'Current view ko Excel, PDF, PowerPoint ya CSV mein download karo.', 'मौजूदा व्यू को Excel, PDF, PowerPoint या CSV में डाउनलोड करें।'],
  ['#cmdkOpenBtn', 'Commands', 'कमांड', 'Ctrl+K: tabs, dark mode, sound, admin and more — type to search.', 'Ctrl+K: tabs, dark mode, sound, admin aur bahut kuch — type karke dhundo.', 'Ctrl+K: टैब, डार्क मोड, साउंड, एडमिन और बहुत कुछ — टाइप करके खोजें।'],
  ['#qaOpenBtn', 'Assistant', 'असिस्टेंट', 'Ask in English, Hinglish or Hindi: “reject % kitna hai?”, “top defects”, “why did it change?”. It reads the same numbers you see.', 'English, Hinglish ya Hindi mein poochho: “reject % kitna hai?”, “top defects”, “kyun badla?”. Ye wahi numbers padhta hai jo aap dekhte ho.', 'English, Hinglish या हिन्दी में पूछें: “रिजेक्ट % कितना है?”, “शीर्ष दोष”, “क्यों बदला?”। यह वही आँकड़े पढ़ता है जो आप देखते हैं।'],
  ['#qaHelpBtn', 'Help mode', 'हेल्प मोड', 'Turn it on, then click any card, chart, column or tab — a small card explains it with the live numbers. Esc leaves.', 'Ise on karo, phir kisi bhi card, chart, column ya tab par click karo — chhota card live numbers ke saath samjhata hai. Esc se band.', 'इसे चालू करें, फिर किसी भी कार्ड, चार्ट, कॉलम या टैब पर क्लिक करें — छोटा कार्ड लाइव आँकड़ों के साथ समझाता है। Esc से बंद।'],
];
let tourI = -1;
function startTour(){ setHelpMode(false); closePanel(); tourI = 0; showTour(); }
function endTour(){ tourI = -1; document.querySelectorAll('.qa-tour-hl').forEach(e => e.classList.remove('qa-tour-hl')); hidePop(); }
function showTour(){
  document.querySelectorAll('.qa-tour-hl').forEach(e => e.classList.remove('qa-tour-hl'));
  let i = tourI; while(i < TOUR.length && !document.querySelector(TOUR[i][0])) i++;
  if(i >= TOUR.length){ endTour(); return; } tourI = i;
  const s = TOUR[i], el = document.querySelector(s[0]);
  el.scrollIntoView({block: 'center', behavior: 'smooth'}); el.classList.add('qa-tour-hl');
  const p = ensurePop(); popAnswer = {r: R(''), plain: t(s[3], s[4], s[5])};
  p.querySelector('.qa-pop-tag').textContent = `${t('Tour', 'Tour', 'टूर')} ${i + 1}/${TOUR.length} · ${lang === 'dv' ? s[2] : s[1]}`;
  p.querySelector('.qa-pop-body').innerHTML = esc(t(s[3], s[4], s[5])); p.querySelector('.qa-pop-chips').innerHTML = '';
  p.querySelector('.qa-pop-foot').innerHTML = `${i > 0 ? `<button type="button" data-qa-tour="prev">◀ ${esc(t('Back', 'Peeche', 'पीछे'))}</button>` : ''}<button type="button" data-qa-tour="next">${i === TOUR.length - 1 ? '✔ ' + esc(t('Done', 'Ho gaya', 'पूरा')) : esc(t('Next', 'Aage', 'आगे')) + ' ▶'}</button><button type="button" data-qa-tour="stop">${esc(t('Skip', 'Chhodo', 'छोड़ें'))}</button>`;
  p.hidden = false; p.classList.add('qa-pop-tour');
  setTimeout(() => { if(tourI === i && !p.hidden) place(p, null, el); }, 380);
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-qa-tour]'); if(!b) return;
  const a = b.dataset.qaTour; if(a === 'stop') endTour(); else if(a === 'next'){ tourI++; if(tourI >= TOUR.length) endTour(); else showTour(); } else { tourI = Math.max(0, tourI - 1); showTour(); }
});

// ---------------------------------------------------------------- panel UI
let panel, body, input, chipsEl, helpView, askView, msgs = [], mode = 'ask', speaking = null;
function buildPanel(){
  if($('qaPanel')) return;
  panel = document.createElement('aside'); panel.id = 'qaPanel'; panel.className = 'qa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Quality Assistant'); panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `<div class="qa-head"><div class="qa-title"><span class="qa-spark">✨</span> <b>Quality Assistant</b><small id="qaSub"></small></div>
    <div class="qa-head-actions"><select id="qaLang" aria-label="Language">${LANGS.map(l => `<option value="${l[0]}">${l[1]}</option>`).join('')}</select><button type="button" id="qaHelpToggle" aria-pressed="false">❓ <span id="qaHelpLbl"></span></button><button type="button" id="qaClose" aria-label="Close">✕</button></div></div>
    <div class="qa-tabs" role="tablist"><button type="button" role="tab" data-qa-tab="ask" class="active"></button><button type="button" role="tab" data-qa-tab="help"></button></div>
    <div class="qa-view" id="qaAsk"><div class="qa-body" id="qaBody" aria-live="polite"></div><div class="qa-chips" id="qaChips"></div>
      <form class="qa-input" id="qaForm" autocomplete="off"><input id="qaInput" type="text" maxlength="300" aria-label="Ask"><button type="button" id="qaMic" hidden>🎤</button><button type="submit" id="qaSend" aria-label="Send">➤</button></form></div>
    <div class="qa-view" id="qaHelp" hidden><div class="qa-help-top"><button type="button" id="qaTourBtn"></button><button type="button" id="qaHelpModeBtn"></button></div><div class="qa-help-search"><input id="qaHelpSearch" type="search" maxlength="60"></div><div class="qa-help-list" id="qaHelpList"></div></div>`;
  document.body.appendChild(panel);
  body = $('qaBody'); input = $('qaInput'); chipsEl = $('qaChips'); helpView = $('qaHelp'); askView = $('qaAsk');
  $('qaClose').addEventListener('click', closePanel);
  $('qaHelpToggle').addEventListener('click', () => { setHelpMode(!helpOn); if(helpOn) closePanel(); });
  $('qaHelpModeBtn').addEventListener('click', () => { setHelpMode(true); closePanel(); });
  $('qaTourBtn').addEventListener('click', startTour);
  $('qaLang').addEventListener('change', e => { setLang(e.target.value); addBot(R(t('Language: English', 'Bhasha: Hinglish', 'भाषा: हिन्दी'), {chips: chipsDefault()})); });
  panel.querySelectorAll('[data-qa-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.qaTab)));
  $('qaForm').addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if(v) ask(v); });
  $('qaHelpSearch').addEventListener('input', renderHelpList);
  body.addEventListener('click', e => {
    const c = e.target.closest('[data-qa-act]'); if(c){ const m = msgs[+c.dataset.qaMsg], a = m && m.actions && m.actions[+c.dataset.qaAct]; if(a) a.run(); return; }
    const s = e.target.closest('[data-qa-say]'); if(s) speak(msgs[+s.dataset.qaSay]);
  });
  chipsEl.addEventListener('click', e => { const c = e.target.closest('[data-qa-chip],[data-qa-kbchip]'); if(!c) return; if(c.dataset.qaKbchip){ const en = kbById(c.dataset.qaKbchip); addUser(kbTitle(en)); addBot(R(kbHtml(en))); } else ask(c.dataset.qaChip, c.textContent); });
  helpView.addEventListener('click', e => { const b = e.target.closest('[data-qa-kb]'); if(b){ const en = kbById(b.dataset.qaKb); setTab('ask'); addUser(kbTitle(en)); addBot(R(kbHtml(en))); } });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SR){ const mic = $('qaMic'); mic.hidden = false; mic.addEventListener('click', () => { try { const r = new SR(); r.lang = lang === 'dv' ? 'hi-IN' : 'en-IN'; r.interimResults = false; mic.classList.add('rec'); r.onresult = ev => { input.value = ev.results[0][0].transcript; ask(input.value); }; r.onend = () => mic.classList.remove('rec'); r.onerror = () => mic.classList.remove('rec'); r.start(); } catch(e){ mic.classList.remove('rec'); } }); }
  relabel(); renderHelpList(); greet();
}
function setLang(l){ setLangStore(l); if(panel){ relabel(); renderHelpList(); } relabelHeader(); if(helpOn) setHelpMode(true); }
function relabelHeader(){
  const o = $('qaOpenBtn'), h = $('qaHelpBtn');
  if(o){ const tx = o.querySelector('.cmdk-text'); if(tx) tx.textContent = t('Assistant', 'Assistant', 'असिस्टेंट'); o.title = t('Assistant — ask about the numbers, in English / Hinglish / Hindi (Ctrl+/)', 'Assistant — numbers ke baare mein poochho, English / Hinglish / Hindi mein (Ctrl+/)', 'असिस्टेंट — आँकड़ों के बारे में पूछें, English / Hinglish / हिन्दी में (Ctrl+/)'); }
  if(h) h.title = t('Help mode — click any card, chart or column to have it explained', 'Help mode — kisi bhi card, chart ya column par click karo, samjha dunga', 'हेल्प मोड — किसी भी कार्ड, चार्ट या कॉलम पर क्लिक करें, मैं समझा दूँगा');
}
function relabel(){
  $('qaSub').textContent = ' · ' + t('free · works offline', 'free · offline chalta hai', 'मुफ़्त · ऑफ़लाइन चलता है');
  $('qaLang').value = lang; $('qaLang').title = t('Language', 'Bhasha', 'भाषा');
  $('qaHelpLbl').textContent = t('Help mode', 'Help mode', 'हेल्प मोड');
  panel.querySelector('[data-qa-tab="ask"]').textContent = '💬 ' + t('Ask', 'Poochho', 'पूछें'); panel.querySelector('[data-qa-tab="help"]').textContent = '📘 ' + t('Help & Glossary', 'Help aur Glossary', 'हेल्प और शब्दकोश');
  input.placeholder = t('Ask about the numbers…  e.g. “What is the reject %?”', 'Numbers ke baare mein poochho… jaise “Reject % kitna hai?”', 'आँकड़ों के बारे में पूछें… जैसे “रिजेक्ट % कितना है?”');
  $('qaHelpSearch').placeholder = t('Search help: Cpk, export, filters…', 'Help dhundo: Cpk, export, filters…', 'हेल्प खोजें: Cpk, export, फ़िल्टर…');
  $('qaTourBtn').textContent = '🧭 ' + t('Take a tour', 'Tour karo', 'टूर करें'); $('qaHelpModeBtn').textContent = '❓ ' + t('Click-to-explain mode', 'Click karke samjho', 'क्लिक करके समझें');
  $('qaMic').title = t('Speak', 'Bolkar poochho', 'बोलकर पूछें'); $('qaSend').title = t('Send', 'Bhejo', 'भेजें');
}
function setTab(k){
  mode = k; panel.querySelectorAll('[data-qa-tab]').forEach(b => b.classList.toggle('active', b.dataset.qaTab === k));
  askView.hidden = k !== 'ask'; helpView.hidden = k !== 'help'; if(k === 'ask') setTimeout(() => input.focus(), 30); else setTimeout(() => $('qaHelpSearch').focus(), 30);
}
function renderHelpList(){
  if(!helpView) return; const q = norm($('qaHelpSearch').value || '');
  let html = ''; Object.keys(KB_GROUPS).forEach(g => {
    const gr = KB_GROUPS[g], items = KB.filter(e => e[1] === g && (!q || (e[3] + ' ' + e[4] + ' ' + e[2].join(' ') + ' ' + e[5] + ' ' + e[6] + ' ' + e[7]).toLowerCase().includes(q))); if(!items.length) return;
    html += `<div class="qa-help-group">${esc(t(gr[0], gr[1], gr[2]))}</div>` + items.map(e => `<button type="button" class="qa-topic" data-qa-kb="${esc(e[0])}"><b>${esc(kbTitle(e))}</b><span>${esc(kbText(e).slice(0, 90))}…</span></button>`).join('');
  });
  $('qaHelpList').innerHTML = html || `<div class="qa-empty">${esc(t('No help topic matches.', 'Koi help topic nahi mila.', 'कोई हेल्प विषय नहीं मिला।'))}</div>`;
}
function addMsg(who, html, o){
  const i = msgs.push({who, html, plain: o && o.plain, actions: o && o.actions}) - 1, el = document.createElement('div'); el.className = 'qa-msg qa-' + who + (o && o.typing ? ' qa-typing' : '');
  el.innerHTML = o && o.raw ? html : (who === 'user' ? esc(html) : html);
  if(who === 'bot' && !(o && o.typing)) el.insertAdjacentHTML('beforeend', `<div class="qa-msg-tools"><button type="button" data-qa-say="${i}" title="${esc(t('Read aloud', 'Padhkar sunao', 'पढ़कर सुनाएँ'))}">🔊</button></div>`);
  if(o && o.actions && o.actions.length) el.insertAdjacentHTML('beforeend', `<div class="qa-acts">${o.actions.map((a, n) => `<button type="button" data-qa-msg="${i}" data-qa-act="${n}">${esc(a.label)}</button>`).join('')}</div>`);
  body.appendChild(el); body.scrollTop = body.scrollHeight; return el;
}
const addUser = txt => addMsg('user', txt);
function addBot(r){
  addMsg('bot', mdHtml(r.html), {raw: true, plain: plainOf(r.html), actions: r.actions});
  chipsEl.innerHTML = (r.chips || []).slice(0, 5).map(chipHtml).join('');
}
function greet(){ addBot(R(t('Hi! I explain the numbers on this dashboard — free and offline. Ask in English, Hinglish or Hindi, or turn on **Help mode** and click any card or chart.', 'Namaste! Main is dashboard ke numbers samjhata hoon — free aur offline. English, Hinglish ya Hindi mein poochho, ya **Help mode** on karke kisi bhi card ya chart par click karo.', 'नमस्ते! मैं इस डैशबोर्ड के आँकड़े समझाता हूँ — मुफ़्त और ऑफ़लाइन। English, Hinglish या हिन्दी में पूछें, या **हेल्प मोड** चालू करके किसी भी कार्ड या चार्ट पर क्लिक करें।'), {chips: chipsDefault().concat([CH.tour()])})); }
async function ask(text, shown){
  if(/[\u0900-\u097F]/.test(text) && lang !== 'dv'){ setLang('dv'); }   // typed in Devanagari -> answer in Hindi
  setTab('ask'); addUser(shown || text); input.value = ''; chipsEl.innerHTML = '';
  const typing = addMsg('bot', '<span class="qa-dots"><i></i><i></i><i></i></span>', {typing: true, raw: true});
  try { const r = await answer(text); typing.remove(); addBot(r); }
  catch(e){ typing.remove(); addBot(R('⚠️ ' + t('Could not read the data', 'Data nahi padh paya', 'डेटा नहीं पढ़ पाया') + ': ' + esc(e.message), {chips: chipsDefault()})); }
}
function speak(m){
  if(!m || !m.plain || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(String(m.plain).replace(/<[^>]+>/g, ' ').slice(0, 900)); u.lang = lang === 'dv' ? 'hi-IN' : 'en-IN';
  if(speaking){ speechSynthesis.cancel(); const same = speaking === m; speaking = null; if(same) return; }
  speaking = m; u.onend = () => { speaking = null; }; speechSynthesis.speak(u);
}
function openPanel(tab){
  buildPanel(); hidePop(); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); document.documentElement.classList.add('qa-open');
  const b = $('qaOpenBtn'); if(b){ b.setAttribute('aria-expanded', 'true'); b.classList.remove('qa-attn'); } try { localStorage.setItem(LS_SEEN, '1'); } catch(e){}
  setTab(tab || mode);
}
function closePanel(){
  if(!panel) return; panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); document.documentElement.classList.remove('qa-open');
  const b = $('qaOpenBtn'); if(b) b.setAttribute('aria-expanded', 'false'); if('speechSynthesis' in window) speechSynthesis.cancel();
}
const togglePanel = tab => (panel && panel.classList.contains('open') && (!tab || tab === mode)) ? closePanel() : openPanel(tab);

function init(){
  const btn = $('qaOpenBtn'), hb = $('qaHelpBtn');
  if(btn){ btn.addEventListener('click', () => togglePanel('ask')); let seen = false; try { seen = localStorage.getItem(LS_SEEN) === '1'; } catch(e){} if(!seen) btn.classList.add('qa-attn'); }
  if(hb) hb.addEventListener('click', () => setHelpMode(!helpOn));
  relabelHeader();
  document.addEventListener('click', onHelpClick, true);
  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if(e.key === '/' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); togglePanel('ask'); return; }
    if(e.key === 'Escape'){ if(tourI >= 0){ endTour(); e.stopPropagation(); return; } if(pop && !pop.hidden){ hidePop(); e.stopPropagation(); return; } if(helpOn){ setHelpMode(false); e.stopPropagation(); return; } if(panel && panel.classList.contains('open') && !document.querySelector('#cmdkModal.open, .drill-modal.open')) closePanel(); return; }
    if(e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openPanel('help'); }
  }, true);
  window.addEventListener('resize', () => { if(pop && !pop.hidden && tourI >= 0){ const el = document.querySelector(TOUR[tourI][0]); if(el) place(pop, null, el); } });
}
window.QDAssist = {open: tab => openPanel(tab || 'ask'), help: () => openPanel('help'), ask: q => { openPanel('ask'); return ask(q); }, helpMode: on => setHelpMode(on === undefined ? !helpOn : on), isHelpMode: () => helpOn, tour: startTour,
  setLang: l => { if(LANGS.some(x => x[0] === l)) setLang(l); return lang; }, toggleLang: () => { setLang(LANGS[(LANGS.findIndex(x => x[0] === lang) + 1) % LANGS.length][0]); return lang; }, lang: () => lang, langs: () => LANGS.slice(), _answer: answer, _kb: KB, _norm: norm};
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
