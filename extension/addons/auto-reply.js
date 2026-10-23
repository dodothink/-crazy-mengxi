// One explicitly submitted draft at a time. Never starts from generation alone.
const AutoReply=(()=>{
 const active=t=>t&&['waiting_notice','countdown','claiming','sending'].includes(t.state);
 const config=async()=>({enabled:false,...await AddonState.read('autoReplyConfig',{})});
 async function cancel(reason='已取消自动发表',tid,ref){
  await AddonState.update('autoReplyTask',t=>active(t)&&(!tid||t.tid===String(tid))&&(!ref||t.draftRef===ref)?{...t,state:'cancelled',reason}:t,null);
 }
 async function setEnabled(enabled){
  if(typeof enabled!=='boolean')throw new Error('开关值无效');
  await AddonState.write('autoReplyConfig',{enabled});
  if(!enabled)await cancel('开关已关闭');
  return status();
 }
 async function status(){return {ok:true,...await config(),task:await AddonState.read('autoReplyTask',null)};}
 async function begin(draft,draftRef){
  await cancel('已有新的审核草稿');
  if(!(await config()).enabled)return false;
  await AddonState.assertRunnable('post');
  await AddonState.write('autoReplyTask',{...draft,draftRef,state:'waiting_notice',createdAt:Date.now(),lastCheckedAt:Date.now()});
  return true;
 }
 async function attach(draftRef,id){await AddonState.update('autoReplyTask',t=>t?.draftRef===draftRef&&t.state==='waiting_notice'?{...t,approvalId:id}:t,null);}
 async function assertReady(it){
  const t=await AddonState.read('autoReplyTask',null),p=(await AddonState.read('pendingApprovals',{}))[String(it.tid)];
  if(!(await config()).enabled||t?.state!=='sending'||t.draftRef!==it.ref||t.message!==it.message||t.tid!==it.tid||t.fid!==it.fid||p?.draftRef!==t.draftRef||Date.now()>t.dueAt+120000)throw Object.assign(new Error('自动发表已取消、草稿已改变或超时'),{paused:true});
  await AddonState.assertRunnable('post');
 }
 const tick=()=>AddonState.serial('auto-reply-tick',async()=>{
  let t=await AddonState.read('autoReplyTask',null);
  if(!t||!['waiting_notice','countdown'].includes(t.state))return;
  const now=Date.now();
  try{
   if(!(await config()).enabled)throw new Error('开关已关闭');
   await AddonState.assertRunnable('post');
   if(now-t.lastCheckedAt>90000)throw new Error('电脑离线或休眠，已取消；不会补发');
   if(!t.approvalId){if(now-t.createdAt>30000)throw new Error('审核请求未完成');return;}
   const p=(await AddonState.read('pendingApprovals',{}))[t.tid];
   if(p?.draftRef!==t.draftRef)throw new Error('草稿已修改或审核已处理');
   const originalRef=t.draftRef;
   const r=await Bridge.autoApproval({id:t.approvalId,draftRef:t.draftRef,action:'status'});
   if(r.state!=='pending')throw new Error('审核已采用、拒绝、取消或过期');
   if(r.delivery==='needs_review'||(!r.dueAt&&now-t.createdAt>60000))throw new Error('手机通知未确认送达，请人工处理');
   if(r.dueAt&&now>r.dueAt+60000)throw new Error('已错过倒计时，不会补发');
   t=await AddonState.update('autoReplyTask',v=>v?.draftRef===t.draftRef&&['waiting_notice','countdown'].includes(v.state)?{...v,state:r.dueAt?'countdown':'waiting_notice',dueAt:r.dueAt,lastCheckedAt:now}:v,null);
   if(t?.draftRef!==originalRef||t?.state!=='countdown'||now<t.dueAt)return;
   const ref=t.draftRef;
   await AddonState.update('autoReplyTask',v=>v?.draftRef===ref&&v.state==='countdown'?{...v,state:'claiming'}:v,null);
   const claim=await Bridge.autoApproval({id:t.approvalId,draftRef:ref,action:'claim'});
   if(claim.busy){await AddonState.update('autoReplyTask',v=>v?.draftRef===ref&&v.state==='claiming'?{...v,state:'countdown'}:v,null);return;}
   if(claim.state!=='timed_out')throw new Error('未确认自动发表授权，本次已取消');
   t=await AddonState.update('autoReplyTask',v=>v?.draftRef===ref&&v.state==='claiming'?{...v,state:'sending'}:v,null);
   if(t?.draftRef!==ref||t.state!=='sending')return;
   const result=await My0511API.postOnce({ref:t.draftRef,tid:t.tid,fid:t.fid,message:t.message},item=>assertReady({...item,ref:t.draftRef}));
   await AddonState.update('autoReplyTask',v=>v?.draftRef===ref&&v.state==='sending'?{...v,state:result?.ok?'done':'stopped',reason:result?.error||'任务未发送，请查看发帖记录'}:v,null);
  }catch(e){await cancel(e.message,t?.tid,t?.draftRef);}
 });
 // A service-worker restart during submission must never replay a claim.
 const ready=AddonState.update('autoReplyTask',t=>t&&['claiming','sending'].includes(t.state)?{...t,state:'stopped',reason:'执行被中断，请核实发帖记录，不会自动重发'}:t,null);
 chrome.alarms.create('auto-reply',{periodInMinutes:0.5});
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='auto-reply')ready.then(tick).catch(()=>{});});
 My0511API.on('postHalted',()=>cancel('Posting paused'));
 chrome.runtime.onStartup.addListener(()=>cancel('Browser restarted; no replay'));
 return {config,status,setEnabled,begin,attach,cancel,assertReady,tick,ready};
})();
