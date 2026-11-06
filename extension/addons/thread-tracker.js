const ThreadTracker=(()=>{
 const read=()=>AddonState.read('trackedThreads',{});
 const update=(tid,fn)=>AddonState.update('trackedThreads',v=>{if(v[tid])v[tid]=fn(v[tid]);return v;},{});

 function options(m){const mode=m.replyMode||'all';if(!['all','selected'].includes(mode))throw Error('回复对象无效');const users=[...new Set(String(m.replyUsers||'').split(/[\n,，;；]+/).map(x=>x.trim()).filter(Boolean))];if(users.length>20||users.some(x=>x.length>100))throw Error('最多20个用户名，每个不超过100字');if(mode==='selected'&&!users.length)throw Error('请填写至少一个指定用户名');return {replyMode:mode,replyUsers:users,quoteOriginal:!!m.quoteOriginal};}
 function eligible(t,f){const author=String(f.author||'').trim();return author!==t.myName&&(t.replyMode!=='selected'||(t.replyUsers||[]).includes(author));}
 async function configure(m){const config=options(m),tid=String(m.tid);if(m.prompt!==undefined){if(typeof m.prompt!=='string'||m.prompt.length>300)throw Error('回复要求最多300字');config.prompt=m.prompt;}if(!(await read())[tid])throw Error('跟踪帖不存在');await Bridge.invalidateApproval(tid);await update(tid,t=>({...t,...config,revision:AddonState.id(),draft:null,notice:null,autoApprovalId:null,lastError:null,note:'回复规则已更新，旧草稿与倒计时已取消'}));await Bridge.invalidateApproval(tid);return list();}
 function quotedDraft(t,result,batch){const source=batch.find(f=>f.floor===result.floor);let message=result.message;let quote=null;if(t.quoteOriginal){const text=String(source.text||'').trim();if(!text)throw Error('目标楼层无可引用正文');quote={floor:source.floor,author:String(source.author||'').trim(),text};const safe=x=>x.replace(/\[/g,'［').replace(/\]/g,'］');const excerpt=safe(text.slice(0,240));message='引用 '+quote.author+' 的 '+quote.floor+' 楼原文'+(text.length>240?'（节选）':'')+'\n'+excerpt+'\n原帖 '+t.url+'\n\n'+message;if(message.length>3000)throw Error('引用和回复合计超过3000字，请缩短回复要求');}return {message,quote,sourceText:String(source.text||'').slice(0,500),author:String(source.author||'').trim(),floor:result.floor,reason:result.reason.slice(0,500),id:AddonState.id()};}
 const sourceKey=r=>r.source.sourceId+':'+r.source.generation;
 async function loadThread(tid){const r=await Bridge.request('/archive-thread',{tid:String(tid)});if(r.source?.kind!=='local-archive-v1'||!Array.isArray(r.floors))throw Error('请更新 Agent：需要本机机读存档接口');return r;}
 async function assertQuote(tid,message){const t=(await read())[tid];if(!t?.draft||t.draft.message!==message)return;const r=await loadThread(tid);if(t.draft.localSource!==sourceKey(r))throw Error('这是切换数据源前的草稿，请重新核对后处理，不直接发送');if(!(r.source.analysisReady??r.source.complete))throw Error('存档采集不完整，请等待上游完整采集');const q=t.draft.quote;if(!q)return;const f=r.floors.find(f=>f.floor===q.floor);if(!f||f.hiddenAt||String(f.author||'').trim()!==q.author||String(f.text||'').trim()!==q.text)throw Error('被引用楼层已变化或不可见，请重新核对草稿');}

 const analyzing=new Set();
 function view(t,s,online){
  if(!t.enabled)return {label:'已关闭',tone:'off'};
  if(!online)return {label:'已开启，Agent 连接待恢复',tone:'warn'};
  if(analyzing.has(t.tid))return {label:'Kimi 正在分析新回复',tone:'busy'};
  if(t.draft)return {label:'等待你审核草稿',tone:'ready'};
  if(t.archiveWaiting)return {label:'已读到存档，等待上游成功采集',tone:'warn'};
  if(t.lastError)return {label:'上轮失败，等待重试',tone:'error'};
  return {label:t.initialized?'等待本机存档更新':'等待首次读取本机存档建立基线',tone:'ready'};
 }
 async function list(){const auto=await AutoReply.status();const s=await My0511API.status(),connection=await AddonState.read('agentConnection',null),online=!!connection?.lastSeenAt&&Date.now()-connection.lastSeenAt<90000;return {ok:true,checkedAt:Date.now(),agentOnline:online,agentLastSeen:connection?.lastSeenAt||null,haltCollect:s.haltCollect,challenge:!!s.challenge,autoEnabled:false,dataSource:'local-archive-v1',manualReview:true,items:Object.values(await read()).map(t=>({...t,autoTask:auto.task?.tid===t.tid?auto.task:null,work:view(t,s,online)}))};}
 async function save(m,run=true){
  const u=new URL(m.url),match=/^\/f(\d+)b-t(\d+)z(?:-\d+)?\/?$/.exec(u.pathname);
  if(u.origin!=='https://bbs.my0511.com'||u.username||u.password||!match)throw Error('请输入 My0511 帖子链接');
  const me=String(m.myName||'').trim();if(!me||me.length>100)throw Error('请填写你的论坛用户名，用来排除自己的发言');
  const config=options(m);const tid=match[2];await AddonState.update('trackedThreads',v=>{if(v[tid])throw Error('该帖已在列表中，请使用卡片开关');if(Object.keys(v).length>=20)throw Error('最多跟踪20个帖子');v[tid]={...config,tid,fid:match[1],url:u.origin+u.pathname,myName:me,prompt:String(m.prompt||'').slice(0,300),enabled:true,revision:AddonState.id(),seen:[],nextAt:0,note:'等待首次读取本机存档建立基线'};return v;},{});if(run)await tick();return list();
 }
 async function toggle(tid,enabled){await update(tid,t=>({...t,enabled:!!enabled,revision:AddonState.id(),notice:enabled?t.notice:null,nextAt:0,note:enabled?'等待检查':'跟踪已暂停'}));if(!enabled)await Bridge.invalidateApproval(tid);else await tick();return list();}
 async function remove(tid){tid=String(tid);await update(tid,t=>({...t,enabled:false,revision:AddonState.id(),notice:null,note:'正在移除任务'}));await Bridge.invalidateApproval(tid);await AddonState.update('trackedThreads',v=>{delete v[tid];return v;},{});return list();}
 async function pauseAll(){const ids=Object.keys(await read());await AddonState.update('trackedThreads',v=>{for(const tid of ids)if(v[tid])v[tid]={...v[tid],enabled:false,revision:AddonState.id(),notice:null,nextAt:0,note:'跟踪已暂停'};return v;},{});const results=await Promise.allSettled(ids.map(tid=>Bridge.invalidateApproval(tid)));if(results.some(r=>r.status==='rejected'))throw Error('任务已暂停，但部分审核取消未确认，请刷新并核对自动发表状态');return list();}
 async function blockManual(tid){await update(tid,t=>t.draft?.attemptRef?{...t,draft:{...t.draft,manualCancelled:true}}:t);}
 async function hold(tid,id){await update(tid,t=>{if(t.draft?.id!==id)throw Error('草稿已变化');return {...t,notice:null,reviewHold:true,autoApprovalId:null,note:'手机正在审核，已取消旧倒计时'};});await Bridge.invalidateApproval(tid);}
 async function claimManual(tid,id,message,ref){await update(tid,t=>{if(!t.enabled||t.draft?.id!==id||t.draft.message!==message||t.draft.attemptRef)throw Error('草稿已变化或已尝试发表，请核对记录');return {...t,draft:{...t.draft,attemptRef:ref},notice:null,note:'手机确认发表，正在核验'};});}
 async function finishManual(tid,id,ref){await update(tid,t=>t.draft?.id===id&&t.draft.attemptRef===ref?{...t,draft:null,notice:null,autoApprovalId:null,lastPostedAt:Date.now(),note:'手机回复已确认发表成功'}:t);}
 async function failManual(tid,id,ref,error){await update(tid,t=>t.draft?.id===id&&t.draft.attemptRef===ref?{...t,lastError:error,note:'发表未确认，不会自动重试，请核对论坛记录'}:t);}
 async function tick(){return AddonState.serial('tracker-queue',async()=>{
  try{const discovered=await Bridge.request('/archive-watch',{action:'check'});for(const d of discovered.items||[]){if(!(await read())[d.tid])await save({...d,replyMode:'all',quoteOriginal:true},false);await Bridge.request('/archive-watch',{action:'ack',tids:[d.tid]});}}catch(e){await AddonState.update('localDiscoveryStatus',()=>({error:e.message,at:Date.now()}),{});}
  for(const t of Object.values(await read())){
   if(!t.enabled)continue;
   if(t.localSource&&t.notice&&!t.reviewHold){
    try{await Bridge.request('/track-notify',{id:t.notice.id,tid:t.tid,text:t.notice.text+'\n必须逐条确认；不会超时自动发表。'});await update(t.tid,x=>x.notice?.id===t.notice.id?{...x,notice:null}:x);}catch(e){await update(t.tid,x=>({...x,lastError:'手机提醒未送达：'+e.message}));}
   }
   if(t.localSource&&t.nextAt>Date.now())continue;
   await update(t.tid,x=>({...x,nextAt:Date.now()+60000,queuedAt:null}));
   await process(t.tid);
  }
 });}
 async function process(tid){return AddonState.serial('tracker-ai',async()=>{
  let t=(await read())[tid];if(!t?.enabled)return;
  try{
   const r=await loadThread(tid);await update(tid,x=>({...x,lastAt:Date.now(),lastError:null,archiveUpdatedAt:r.source.writtenAt,archiveComplete:r.source.complete,archiveScope:r.source.captureScope,archiveWaiting:false,sourceHash:r.source.hash}));
   const floors=Object.values(r.floors||{}).sort((a,b)=>a.floor-b.floor).filter(f=>!f.hiddenAt&&Number.isFinite(f.floor));
   const ids=floors.map(f=>f.floor),title=r.thread?.title||tid;
   if(!t.initialized||t.localSource!==sourceKey(r)){if(t.initialized)await Bridge.invalidateApproval(tid);await update(tid,x=>({...x,initialized:true,localSource:sourceKey(r),revision:AddonState.id(),seen:ids,title,lastAt:Date.now(),notice:null,autoApprovalId:null,reviewHold:!!x.draft,note:x.draft?'本机基线已建立；旧草稿保留供查看，请处理后继续':'本机基线已建立，不处理历史楼层'}));return;}
   if(!(r.source.analysisReady??r.source.complete)){await update(tid,x=>({...x,archiveWaiting:true,lastError:null,note:'本机读取成功；采集失败或状态未知，等待上游更新'}));return;}
   const fresh=floors.filter(f=>!t.seen.includes(f.floor)&&eligible(t,f));
   await update(tid,x=>({...x,title,lastAt:Date.now(),newCount:fresh.length}));
   if(t.draft){await update(tid,x=>({...x,note:'已有待审核草稿，新回复稍后处理'}));return;}
   if(!fresh.length){await update(tid,x=>({...x,seen:ids,note:'没有符合回复对象的新楼层，不调用 Kimi'}));return;}
   const cfg=(await Bridge.request('/ai-config',{})).config||{};let batch=fresh.slice(0,Math.min(20,Math.max(1,cfg.batchSize||8)));let selected=new Set(batch.map(f=>f.floor));
   const makeContext=()=>JSON.stringify({title,archiveScope:r.source.captureScope||'full',archiveWarning:r.source.warning||null,myName:t.myName,instructions:t.prompt,myStatements:floors.filter(f=>String(f.author||'').trim()===t.myName).slice(-4).map(f=>({floor:f.floor,text:String(f.text||'').slice(0,600)})),context:floors.filter(f=>!selected.has(f.floor)).slice(-3).map(f=>({floor:f.floor,author:f.author,text:String(f.text||'').slice(0,900)})),newReplies:batch.map(f=>({floor:f.floor,author:f.author,text:String(f.text||'').slice(0,1600)}))});
   let context=makeContext();while(context.length>24000&&batch.length>1){batch.pop();selected=new Set(batch.map(f=>f.floor));context=makeContext();}
   analyzing.add(tid);await update(tid,x=>({...x,aiStartedAt:Date.now()}));
   const answer=await Bridge.request('/track-ai',{context});
   const result=JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
   if(typeof result.shouldReply!=='boolean'||typeof result.reason!=='string'||(result.shouldReply&&(!selected.has(result.floor)||typeof result.message!=='string'||!result.message.trim()||result.message.length>3000)))throw Error('AI 返回格式无效，保留待处理楼层');
   const current=(await read())[tid];if(!current?.enabled||current.revision!==t.revision)return;
   const latest=await loadThread(tid);if(sourceKey(latest)!==sourceKey(r)||latest.source.hash!==r.source.hash||!(latest.source.analysisReady??latest.source.complete))throw Error('分析期间本机存档已变化，保留楼层等待重新分析');
   const draft=result.shouldReply?{...quotedDraft(t,result,batch),localSource:sourceKey(r)}:null;
   await update(tid,x=>!x.enabled||x.revision!==t.revision?x:({...x,seen:[...new Set([...x.seen,...batch.map(f=>f.floor),...floors.filter(f=>!eligible(t,f)).map(f=>f.floor)])],draft,reviewHold:false,note:draft?'草稿已生成，等待审核':'本轮无需回复：'+result.reason.slice(0,300),notice:draft?{id:draft.id,automatic:false,text:'帖子跟踪 · 待审核草稿\n'+title+' · 回应'+draft.floor+'楼\n理由：'+draft.reason+'\n草稿：'+draft.message.slice(0,1600)+'\n'+t.url+'\n请在工作台审核，尚未发表。'}:null}));
  }catch(e){await update(tid,x=>({...x,lastError:e.message,note:'本轮未完成：'+e.message}));}finally{analyzing.delete(tid);}
 });}
 async function action(m){if(!['dismiss','approval','fill','save'].includes(m.action))throw Error('未知操作');const t=(await read())[m.tid];if(!t?.draft||t.draft.id!==m.id)throw Error('草稿已变化，请刷新');
 if(m.action==='dismiss'){await Bridge.invalidateApproval(t.tid);await update(t.tid,x=>({...x,draft:null,notice:null,note:'草稿已处理，等待下一轮'}));}
 else {if(!t.enabled&&m.action!=='save')throw Error('请先开启该帖跟踪');const message=String(m.message||'').trim();if(!message||message.length>3000)throw Error('草稿为空或超过3000字');await Bridge.invalidateApproval(t.tid);await update(t.tid,x=>({...x,notice:null,draft:{...x.draft,message}}));await assertQuote(t.tid,message);if(m.action==='approval')await Bridge.approval({tid:t.tid,fid:t.fid,message});else if(m.action==='fill')await My0511API.fillReply({tid:t.tid,fid:t.fid,message});else if(m.action!=='save')throw Error('未知操作');}
 return list();}
 chrome.alarms.get('thread-tracker').then(a=>{if(!a||a.periodInMinutes!==1)chrome.alarms.create('thread-tracker',{periodInMinutes:1});});
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='thread-tracker')tick().catch(()=>{});});

 return {list,save,toggle,tick,process,action,configure,assertQuote,remove,pauseAll,hold,claimManual,finishManual,failManual,blockManual};
})();
