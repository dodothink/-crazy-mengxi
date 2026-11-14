// Only a per-installation localhost token is stored in the extension.
const Bridge=(()=>{
 const base='http://127.0.0.1:17851';
 async function call(path,body,auth=true){const p=await AddonState.read('agentPairing',null);if(auth&&!p)throw new Error('请先连接本地服务');const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Extension-Id':chrome.runtime.id,...(auth?{Authorization:'Bearer '+p.token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='/report'?300000:['/ai','/archive-ai','/archives','/archive-search','/track-ai'].includes(path)?190000:10000)});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'本地服务请求失败');return j;}
 async function pair(code){await AddonState.ready;const s=await My0511API.status();const r=await call('/pair',{code,profile:s.profileId},false);await AddonState.write('agentPairing',{token:r.token});return sync();}
 let syncing=null;
 function sync(){if(syncing)return syncing;const pending=AddonState.serial('bridge-sync',async()=>{
  await AddonState.ready;await LocalMode.ready;await LocalMode.enforce();
  if(!await AddonState.read('agentPairing',null))throw Error('请先连接本地服务');
  await My0511API.refreshChallenge();
  const receipts=await AddonState.read('remoteReceipts',{});
  const cursor=await AddonState.read('alertCursor',0);await My0511API.ackAlerts({consumer:'agent',cursor});
  const page=await My0511API.alertsSince({cursor,limit:200});
  if(page.truncated)await AddonState.write('alertGap',{from:cursor,to:page.nextCursor,at:Date.now()});
  if(!await AddonState.read('legacyAlertsLoaded',false)){const legacy=(await My0511API.alerts()).filter(a=>!a.seq);await AddonState.update('alertOutbox',v=>[...new Map([...v,...legacy].map(a=>[a.id,a])).values()],[]);await AddonState.write('legacyAlertsLoaded',true);}
  const pendingAlerts=await AddonState.read('alertOutbox',[]);
  const alerts=[...new Map([...page.items,...pendingAlerts].map(a=>[a.seq?'seq:'+a.seq:a.id,a])).values()].slice(0,300);
  const archiveWrites=await AddonState.read('archiveWrites',{});
  await AddonState.write('archiveWrites',archiveWrites);
  const status={...await AddonControl.status(),tracking:await RemoteControl.snapshot(),approvedQueue:Object.entries(receipts).filter(([,v])=>v.retryAt&&!v.result).map(([id,v])=>({id,retryAt:v.retryAt,reason:v.reason}))};
  const r=await call('/sync',{status,archiveWrites,settings:await My0511API.settings(),alerts,acks:Object.entries(receipts).filter(([,v])=>v.result&&!v.acked).map(([id,v])=>({id,result:v.result}))});
  if(r.aiConfig)await AddonState.write('aiConfig',r.aiConfig);
  if(r.alertsAccepted){const ids=new Set(r.alertsAccepted);await AddonState.update('alertOutbox',v=>v.filter(a=>!ids.has(a.id)),[]);if(page.items.every(a=>ids.has(a.id))){await AddonState.write('alertCursor',page.nextCursor);await My0511API.ackAlerts({consumer:'agent',cursor:page.nextCursor});}}
  await AddonState.write('agentConnection',{lastSeenAt:Date.now()});
  await AddonState.update('remoteReceipts',v=>{for(const id of r.acked||[])if(v[id]?.result)v[id].acked=true;return v;},{});
  let sendWait=null;
  for(const c of r.commands){
   const seen=await AddonState.read('remoteReceipts',{});if(seen[c.id]?.result)continue;
   const isSend=c.kind==='trackerControl'&&c.payload?.op==='send';
   if(isSend&&sendWait){await AddonState.update('remoteReceipts',v=>({...v,[c.id]:{retryAt:sendWait,reason:'等待队列前面的回复',startedAt:Date.now()}}),{});continue;}
   if(seen[c.id]?.retryAt>Date.now()){if(isSend)sendWait=seen[c.id].retryAt;continue;}
   if(seen[c.id]?.retryAt)delete seen[c.id];
   if(seen[c.id]){await finish(c.id,{ok:false,error:'上次执行中断，请核实电脑现场，不自动重放'});continue;}
   await AddonState.update('remoteReceipts',v=>({...v,[c.id]:{startedAt:Date.now()}}),{});
   let result;try{
    if(c.expires<Date.now())throw new Error('指令已过期');
    if(c.kind==='pause')result=await AddonControl.pause('all',true);
    else if(c.kind==='resume')result=await AddonControl.pause('all',false);
    else if(c.kind==='verify')result=await AddonControl.handle({type:'ADDON_VERIFY_CHALLENGE',id:c.payload.id});
    else if(c.kind==='answer')result=await My0511API.answerChallenge(c.payload);
    else if(c.kind==='markAlertsRead')result=await My0511API.markAlertsRead(c.payload.ids);
    else if(c.kind==='trackerControl')result=await RemoteControl.execute(c.payload,c);
    else if(c.kind==='adopt')result=await adoptApproved(c.payload);
    else throw new Error('指令不受支持');
    if(result?.deferred){if(isSend)sendWait=Math.max(Date.now()+1000,result.retryAt||Date.now()+30000);await AddonState.update('remoteReceipts',v=>({...v,[c.id]:{retryAt:Math.max(Date.now()+1000,result.retryAt||Date.now()+30000),reason:result.reason,startedAt:Date.now()}}),{});continue;}
    result={ok:result?.ok!==false,...(result?.info?{info:String(result.info).slice(0,500)}:{})};
   }catch(e){result={ok:false,error:e.message};}
   await finish(c.id,result);
  }
  return {ok:true};
 });syncing=pending;pending.finally(()=>{if(syncing===pending)syncing=null;}).catch(()=>{});return pending;}
 async function finish(id,result){await AddonState.update('remoteReceipts',v=>{v[id]={...v[id],result};const entries=Object.entries(v).sort((a,b)=>b[1].startedAt-a[1].startedAt).slice(0,200);return Object.fromEntries(entries);},{});}

 async function ai(tid,prompt=''){return call('/archive-ai',{id:String(tid),prompt});}
 async function invalidateApproval(tid){if(typeof ThreadTracker!=='undefined')await ThreadTracker.blockManual(tid);await AutoReply.cancel('草稿已修改或已取消',tid);await AddonState.update('pendingApprovals',v=>{delete v[String(tid)];return v;},{});return {ok:true};}
 async function approval(msg){
  const draft={tid:String(msg.tid),fid:String(msg.fid),message:msg.message},draftRef=AddonState.id();
  const automatic=await AutoReply.begin(draft,draftRef);
  await AddonState.update('pendingApprovals',v=>({...v,[draft.tid]:{draftRef,draft,expires:Date.now()+15*60000}}),{});
  try{await sync();const r=await call('/approval',{...draft,draftRef,autoAfterMs:automatic?300000:0});
   if(automatic){if(r.autoAfterMs!==300000)throw new Error('请重启 Agent 后再使用自动发表');await AutoReply.attach(draftRef,r.id);}return {...r,automatic};
  }catch(e){await AutoReply.cancel(e.message,draft.tid,draftRef);throw e;}
 }
 async function adoptApproved(payload){
  await AddonState.update('pendingApprovals',v=>{
   const current=v[String(payload.tid)];
   if(!current||current.draftRef!==payload.draftRef||current.expires<Date.now()||current.draft.message!==payload.message||current.draft.fid!==String(payload.fid))throw new Error('草稿已修改、取消或过期，请重新审批');
   delete v[String(payload.tid)];return v;
  },{});
  await AutoReply.cancel('手机已采用，改为仅填入',payload.tid,payload.draftRef);
  return AddonControl.handle({type:'ADDON_ADOPT',tid:payload.tid,fid:payload.fid,message:payload.message});
 }
 chrome.alarms.get('agent-sync').then(a=>{if(!a||a.periodInMinutes!==0.5)chrome.alarms.create('agent-sync',{periodInMinutes:0.5});}).catch(()=>{});
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='agent-sync')sync().catch(()=>{});});
 return {pair,sync,ai,approval,invalidateApproval,autoApproval:body=>call('/auto-approval',body),request:call,settings:body=>call('/settings',body),archives:body=>call('/archives',body),archive:id=>call('/archive',{id}),archiveAi:(id,prompt)=>call('/archive-ai',{id,prompt})};
})();
