// Remote actions share the same addon tasks and public API as the workbench.
const RemoteControl=(()=>{
 async function snapshot(){const tracking=await ThreadTracker.list();return {controlVersion:1,checkedAt:tracking.checkedAt,autoEnabled:tracking.autoEnabled,items:tracking.items.map(t=>({tid:t.tid,fid:t.fid,url:t.url,title:t.title,enabled:t.enabled,revision:t.revision,myName:t.myName,prompt:t.prompt,replyMode:t.replyMode,replyUsers:t.replyUsers,quoteOriginal:t.quoteOriginal,note:t.note,lastError:t.lastError,lastAt:t.lastAt,work:t.work,autoTask:t.autoTask?{state:t.autoTask.state,dueAt:t.autoTask.dueAt,reason:t.autoTask.reason}:null,draft:t.draft?{...t.draft,quote:t.draft.quote?{...t.draft.quote,text:t.draft.quote.text.slice(0,500)}:null}:null}))};}
 async function execute(m,command){
  if(!m||typeof m.op!=='string')throw Error('手机操作无效');
  if(m.op==='run'){if(!['all','collect','post'].includes(m.scope)||typeof m.paused!=='boolean')throw Error('运行控制无效');await AddonControl.pause(m.scope,m.paused);return {ok:true,info:(m.paused?'已暂停':'已恢复')+'：'+m.scope};}
  if(m.op==='auto'){if(typeof m.enabled!=='boolean')throw Error('自动发表开关无效');await AutoReply.setEnabled(m.enabled);return {ok:true,info:'自动发表已'+(m.enabled?'开启；只对新草稿生效':'关闭')};}
  if(m.op==='cancelAuto'){const a=(await AutoReply.status()).task;if(a)await Bridge.invalidateApproval(a.tid);return {ok:true,info:'已取消尚未提交的自动发表'};}
  if(m.op==='pauseTasks'){await ThreadTracker.pauseAll();return {ok:true,info:'全部跟踪任务已暂停'};}
  if(m.op==='add'){await ThreadTracker.save(m);return {ok:true,info:'任务已添加；首次采集建立基线'};}
  const t=(await ThreadTracker.list()).items.find(x=>x.tid===m.tid);if(!t||t.revision!==m.revision)throw Error('任务已变化或移除，请刷新手机任务列表');
  if(m.op==='toggle'){if(typeof m.enabled!=='boolean')throw Error('任务开关无效');await ThreadTracker.toggle(t.tid,m.enabled);}
  else if(m.op==='remove')await ThreadTracker.remove(t.tid);
  else if(m.op==='rules')await ThreadTracker.configure({...m,tid:t.tid});
  else {
   if(!t.draft||t.draft.id!==m.id||m.expectedMessage!==undefined&&t.draft.message!==m.expectedMessage)throw Error('草稿已变化，请重新查看');
   if(m.op==='hold')await ThreadTracker.hold(t.tid,m.id);
   else if(m.op==='edit'||m.op==='dismiss')await ThreadTracker.action({tid:t.tid,id:m.id,action:m.op==='edit'?'save':'dismiss',message:m.message});
   else if(m.op==='send')return publish(t,m,command);
   else throw Error('不支持的手机操作');
  }
  return {ok:true,info:({toggle:m.enabled?'任务已恢复':'任务已暂停',remove:'任务已移除，存档保留',rules:'回复规则已更新，旧草稿和倒计时已取消',hold:'旧审批及倒计时已取消，可以修改草稿',edit:'草稿已保存，没有自动发表',dismiss:'草稿已拒绝，未提交的发表已取消'})[m.op]};
 }
 async function publish(t,m,c){
  if(!c?.id||c.expires<Date.now()||t.draft.message!==m.message)throw Error('发表确认已过期或正文已变化');
  const auto=(await AutoReply.status()).task;if(auto?.tid===t.tid&&auto.message===m.message&&(['claiming','sending','done'].includes(auto.state)||auto.submissionStartedAt))throw Error('同一草稿已尝试自动发表，请先核对论坛记录，不能重复发送');
  await ThreadTracker.hold(t.tid,m.id);await AddonState.assertRunnable();
  const ref='tg-'+c.id;
  const guard=async item=>{if(c.expires<Date.now())throw Error('手机发表确认已过期');const now=(await ThreadTracker.list()).items.find(x=>x.tid===t.tid);if(!now?.enabled||now.revision!==t.revision||now.draft?.id!==m.id||now.draft?.message!==m.message||now.draft?.attemptRef!==ref||now.draft?.manualCancelled)throw Error('任务已暂停、取消或草稿已变化');await AddonState.assertRunnable();await ThreadTracker.assertQuote(t.tid,m.message);await Bridge.request('/remote-guard',{id:c.id});};
  await ThreadTracker.claimManual(t.tid,m.id,m.message,ref);
  try{const result=await My0511API.postOnce({ref,tid:t.tid,fid:t.fid,message:m.message},guard);if(!result?.ok)throw Error(result?.error||'未确认发表成功，请核对论坛记录，不自动重试');await ThreadTracker.finishManual(t.tid,m.id,ref);return {ok:true,info:'论坛已确认发表成功：帖子 '+t.tid};}catch(e){await ThreadTracker.failManual(t.tid,m.id,ref,e.message);throw e;}
 }
 return {snapshot,execute};
})();
