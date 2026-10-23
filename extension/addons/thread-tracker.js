const ThreadTracker=(()=>{
 const read=()=>AddonState.read('trackedThreads',{});
 const update=(tid,fn)=>AddonState.update('trackedThreads',v=>{if(v[tid])v[tid]=fn(v[tid]);return v;},{});
 const analyzing=new Set();
 function view(t,s,online){
  if(!t.enabled)return {label:'已关闭',tone:'off'};
  if(s.challenge)return {label:'等待人工验证',tone:'warn'};
  if(s.haltCollect)return {label:'已开启，但采集暂停',tone:'warn'};
  if(!online)return {label:'已开启，Agent 连接待恢复',tone:'warn'};
  if(analyzing.has(t.tid))return {label:'Kimi 正在分析新回复',tone:'busy'};
  if(t.draft)return {label:'等待你审核草稿',tone:'ready'};
  if(t.lastError)return {label:'上轮失败，等待重试',tone:'error'};
  if(s.job&&String(s.job.tid)===t.tid)return {label:'正在采集帖子',tone:'busy'};
  if(t.queuedAt&&(!t.lastAt||t.queuedAt>t.lastAt))return {label:'已入队，等待采集完成',tone:'busy'};
  return {label:t.initialized?'等待下一轮检查':'等待首次采集建立基线',tone:'ready'};
 }
 async function list(){const auto=await AutoReply.status();const s=await My0511API.status(),connection=await AddonState.read('agentConnection',null),online=!!connection?.lastSeenAt&&Date.now()-connection.lastSeenAt<90000;return {ok:true,checkedAt:Date.now(),agentOnline:online,agentLastSeen:connection?.lastSeenAt||null,haltCollect:s.haltCollect,challenge:!!s.challenge,autoEnabled:auto.enabled,items:Object.values(await read()).map(t=>({...t,autoTask:auto.task?.tid===t.tid?auto.task:null,work:view(t,s,online)}))};}
 async function save(m){
  const u=new URL(m.url),match=/^\/f(\d+)b-t(\d+)z(?:-\d+)?\/?$/.exec(u.pathname);
  if(u.origin!=='https://bbs.my0511.com'||u.username||u.password||!match)throw Error('请输入 My0511 帖子链接');
  const me=String(m.myName||'').trim();if(!me||me.length>100)throw Error('请填写你的论坛用户名，用来排除自己的发言');
  const tid=match[2];await AddonState.update('trackedThreads',v=>{if(v[tid])throw Error('该帖已在列表中，请使用卡片开关');if(Object.keys(v).length>=20)throw Error('最多跟踪20个帖子');v[tid]={tid,fid:match[1],url:u.origin+u.pathname,myName:me,prompt:String(m.prompt||'').slice(0,300),enabled:true,revision:AddonState.id(),seen:[],nextAt:0,note:'等待首次采集建立基线'};return v;},{});await tick();return list();
 }
 async function toggle(tid,enabled){await update(tid,t=>({...t,enabled:!!enabled,revision:AddonState.id(),notice:enabled?t.notice:null,nextAt:0,note:enabled?'等待检查':'跟踪已暂停'}));if(!enabled)await Bridge.invalidateApproval(tid);else await tick();return list();}
 async function tick(){return AddonState.serial('tracker-queue',async()=>{const status=await My0511API.status();if(status.haltCollect||status.challenge)return;for(const t of Object.values(await read())){if(!t.enabled)continue;const completed=await AutoReply.status();if(t.autoApprovalId&&completed.task?.approvalId===t.autoApprovalId&&completed.task.state==='done'){await update(t.tid,x=>({...x,draft:null,autoApprovalId:null,lastPostedAt:Date.now(),note:'已确认发表成功，继续跟踪新回复'}));}if(t.notice){
 if(t.notice.automatic){
  const auto=await AutoReply.status();
  if(!auto.enabled){await update(t.tid,x=>({...x,notice:{...x.notice,automatic:false},note:'自动发表已关闭，保留草稿'}));continue;}
  if(status.haltPost){await update(t.tid,x=>({...x,note:'发帖暂停，尚未送入自动审核'}));continue;}
  if(auto.task&&['waiting_notice','countdown','claiming','sending'].includes(auto.task.state)){await update(t.tid,x=>({...x,note:'等待上一条自动审核结束'}));continue;}
  // Persist before sending: interrupted requests must not be replayed.
  await update(t.tid,x=>({...x,notice:null,note:'正在发送手机审核；中断后请人工核对'}));
  try{const current=(await read())[t.tid];if(!current?.enabled||current.revision!==t.revision||current.draft?.id!==t.draft?.id)continue;
   const response=await Bridge.approval({tid:t.tid,fid:t.fid,message:t.draft.message});
   const after=(await read())[t.tid];if(!after?.enabled||after.revision!==t.revision||after.draft?.id!==t.draft.id){await Bridge.invalidateApproval(t.tid);continue;}
   await update(t.tid,x=>({...x,autoApprovalId:response.id,note:response.automatic?'手机审核已排队，送达后开始5分钟倒计时':'手机审核已排队，自动发表开关已关闭'}));
  }catch(e){await update(t.tid,x=>({...x,lastError:e.message,note:'送审未确认，请人工核对；不会自动重送'}));}
 }else{try{await Bridge.request('/track-notify',{id:t.notice.id,tid:t.tid,text:t.notice.text});await update(t.tid,x=>({...x,notice:null}));}catch{}}
 }if(t.nextAt>Date.now())continue;try{await My0511API.enqueue([{tid:t.tid,fid:t.fid,title:t.title||t.tid}]);await update(t.tid,x=>({...x,nextAt:Date.now()+15*60000,queuedAt:Date.now(),note:'已加入采集队列'}));}catch(e){await update(t.tid,x=>({...x,lastError:e.message,note:e.message,nextAt:Date.now()+60000}));}}});}
 async function process(tid){return AddonState.serial('tracker-ai',async()=>{
  let t=(await read())[tid];if(!t?.enabled)return;const status=await My0511API.status();if(status.haltCollect||status.challenge)return;
  try{
   const r=await My0511API.getThread(tid);if(!r)throw Error('采集结束但没有读取到帖子记录');await update(tid,x=>({...x,lastAt:Date.now(),lastError:null}));
   const floors=Object.values(r.floors||{}).sort((a,b)=>a.floor-b.floor).filter(f=>!f.hiddenAt&&Number.isFinite(f.floor));
   const ids=floors.map(f=>f.floor),title=r.thread?.title||tid;
   if(!t.initialized){await update(tid,x=>({...x,initialized:true,seen:ids,title,lastAt:Date.now(),note:'基线已建立，等待新回复'}));return;}
   const fresh=floors.filter(f=>!t.seen.includes(f.floor)&&String(f.author||'').trim()!==t.myName);
   await update(tid,x=>({...x,title,lastAt:Date.now(),newCount:fresh.length}));
   if(t.draft){await update(tid,x=>({...x,note:'已有待审核草稿，新回复稍后处理'}));return;}
   if(!fresh.length){await update(tid,x=>({...x,seen:ids,note:'没有新的他人回复，不调用 Kimi'}));return;}
   const batch=fresh.slice(0,8),selected=new Set(batch.map(f=>f.floor));
   const context=JSON.stringify({title,myName:t.myName,instructions:t.prompt,context:floors.filter(f=>!selected.has(f.floor)).slice(-3).map(f=>({floor:f.floor,author:f.author,text:String(f.text||'').slice(0,900)})),newReplies:batch.map(f=>({floor:f.floor,author:f.author,text:String(f.text||'').slice(0,1600)}))});
   analyzing.add(tid);await update(tid,x=>({...x,aiStartedAt:Date.now()}));
   const answer=await Bridge.request('/track-ai',{context});
   const result=JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
   if(typeof result.shouldReply!=='boolean'||typeof result.reason!=='string'||(result.shouldReply&&(!selected.has(result.floor)||typeof result.message!=='string'||!result.message.trim()||result.message.length>3000)))throw Error('AI 返回格式无效，保留待处理楼层');
   const current=(await read())[tid],latest=await My0511API.status();if(!current?.enabled||current.revision!==t.revision||latest.haltCollect||latest.challenge)return;
   const autoConfig=await AutoReply.status();
   const draft=result.shouldReply?{message:result.message,floor:result.floor,reason:result.reason.slice(0,500),id:AddonState.id()}:null;
   await update(tid,x=>!x.enabled||x.revision!==t.revision?x:({...x,seen:[...new Set([...x.seen,...batch.map(f=>f.floor),...floors.filter(f=>String(f.author||'').trim()===t.myName).map(f=>f.floor)])],draft,note:draft?'草稿已生成，等待审核':'本轮无需回复：'+result.reason.slice(0,300),notice:draft?{id:draft.id,automatic:autoConfig.enabled,text:'帖子跟踪 · 待审核草稿\n'+title+' · 回应'+draft.floor+'楼\n理由：'+draft.reason+'\n草稿：'+draft.message.slice(0,1600)+'\n'+t.url+'\n请在工作台审核，尚未发表。'}:null}));await tick();
  }catch(e){await update(tid,x=>({...x,lastError:e.message,note:'本轮未完成：'+e.message}));}finally{analyzing.delete(tid);}
 });}
 async function action(m){if(!['dismiss','approval','fill','save'].includes(m.action))throw Error('未知操作');const t=(await read())[m.tid];if(!t?.draft||t.draft.id!==m.id)throw Error('草稿已变化，请刷新');
 if(m.action==='dismiss'){await Bridge.invalidateApproval(t.tid);await update(t.tid,x=>({...x,draft:null,notice:null,note:'草稿已处理，等待下一轮'}));}
 else {if(!t.enabled)throw Error('请先开启该帖跟踪');const message=String(m.message||'').trim();if(!message||message.length>3000)throw Error('草稿为空或超过3000字');await Bridge.invalidateApproval(t.tid);await update(t.tid,x=>({...x,notice:null,draft:{...x.draft,message}}));if(m.action==='approval')await Bridge.approval({tid:t.tid,fid:t.fid,message});else if(m.action==='fill')await My0511API.fillReply({tid:t.tid,fid:t.fid,message});else if(m.action!=='save')throw Error('未知操作');}
 return list();}
 chrome.alarms.get('thread-tracker').then(a=>{if(!a)chrome.alarms.create('thread-tracker',{periodInMinutes:1});});
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='thread-tracker')tick().catch(()=>{});});
 My0511API.on('jobDone',e=>{if(e.skipped)update(e.tid,t=>({...t,lastError:String(e.skipped),note:'采集未完成：'+String(e.skipped)}));else process(String(e.tid)).catch(()=>{});});
 return {list,save,toggle,tick,process,action};
})();
