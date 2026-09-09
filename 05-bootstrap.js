// ---------- Tab switching ----------
const TAB_LOADERS = {
  dashboard: loadKpis,
  controlroom: loadControlRoom,
  wcgrade: loadWcGrade,
  defects: loadDefectAnalysis,
  weekly: loadPeriodTrend,
};

async function activateTab(tabName){
  fetch("/api/activity/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_type:"tab_open",tab:tabName,filters:currentFilters})}).catch(()=>{});
  if(refreshController) refreshController.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + tabName));
  try { await TAB_LOADERS[tabName](signal); if(tabName==='controlroom') scheduleQcrLayout(); } catch(e) { if(e.name!=="AbortError") console.error(e); }
}

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
  setInterval(()=>{sendLiveHeartbeat();refreshLiveUsers();},20000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){sendLiveHeartbeat();refreshLiveUsers();}});
}

function setRefreshed(){
  const now = new Date();
  const d = String(now.getDate()).padStart(2,"0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  const hh = String(now.getHours()).padStart(2,"0");
  const mm = String(now.getMinutes()).padStart(2,"0");
  document.getElementById("refreshed").textContent = `${d} ${m} ${y} • ${hh}:${mm}`;
  document.getElementById("liveLabel").textContent = "LIVE DATA";
}

async function init(){
  setRefreshed();
  startLiveUserTracking();
  // Dashboard is intentionally public for now. No username/password is required.
  // Every dashboard page load is logged server-side with the visitor IP address.
  await loadKpiTargets();
  wireDrilldown();
  await loadFilters();
  await loadKpis();
}
init();
