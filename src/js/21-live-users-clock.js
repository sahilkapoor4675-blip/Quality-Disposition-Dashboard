/* 21-live-users-clock.js — Live-user heartbeat, digital clock, last-updated label. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
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
  // Hours now carry the leftover minutes too ("2 hr 15 min ago"), so it no longer sits
  // unchanged for a whole hour. An exact-hour age just reads "2 hr ago".
  if(h<24){ const mm=m%60; return mm?`${h} hr ${mm} min ago`:`${h} hr ago`; }
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

