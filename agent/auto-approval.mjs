// Atomic timeout claim. Only a confirmed Telegram delivery starts the timer.
export function autoApproval(store, profile, body, now=Date.now()) {
 return store.transact(()=>{
  const a=store.get('approval:'+body.id);
  if(!a||a.profile!==profile||a.draftRef!==body.draftRef)throw new Error('审核任务不匹配');
  if(body.action==='cancel'){
   if(a.state==='pending'){a.state='cancelled';store.set('approval:'+body.id,a);}
  }
  const delivery=store.db.prepare('SELECT state FROM outbox WHERE id=?').get('approval:'+body.id)?.state;
  const dueAt=a.autoAfterMs&&a.sentAt?a.sentAt+a.autoAfterMs:null;
  const current=store.get('activeApproval:'+profile+':'+a.draft.tid)===body.id;
  const state=!current?'superseded':a.expires<now?'expired':a.state;
  if(body.action==='claim'){
   if(state!=='pending'||a.autoAfterMs!==300000||!dueAt||delivery!=='sent')throw new Error('审核已处理或通知尚未确认送达');
   if(now<dueAt||now>dueAt+60000)throw new Error('不在自动发表时间内，请重新审核');
   const health=store.get('telegramHealth');
   if(!health?.ok||now-health.at>10000)throw new Error('手机审核连接异常，已停止自动发表');
   a.state='timed_out';store.set('approval:'+body.id,a);
   return {ok:true,state:a.state,dueAt};
  }
  return {ok:true,state,delivery:delivery||'pending',dueAt};
 });
}
