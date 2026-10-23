// Downstream capabilities only use the frozen public API.
if(!self.My0511API||Number(My0511API.version.split('.')[0])!==1||Number(My0511API.version.split('.')[1])<2)throw Error('My0511 API v1.2 required');
const AddonState=(()=>{
 const locks=new Map();
 function serial(key,fn){const p=(locks.get(key)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(key,p);p.finally(()=>{if(locks.get(key)===p)locks.delete(key);}).catch(()=>{});return p;}
 const read=(k,d)=>My0511API.store.get(k,d),write=(k,v)=>My0511API.store.set(k,v);
 return {read,write,update:(k,fn,d)=>My0511API.store.update(k,fn,d),serial,ready:read('agentPairing',null).then(async p=>{if(p)await My0511API.ackAlerts({consumer:'agent',cursor:await read('alertCursor',0)});}),id:()=>crypto.randomUUID(),
  async assertRunnable(){const s=await My0511API.status();if(s.haltPost||s.challenge)throw Error('发帖已暂停或等待人工验证');},
  event:(type,detail)=>My0511API.store.update('events',v=>[...v,{at:Date.now(),type,...detail}].slice(-200),[])};
})();
importScripts('addons/bridge.js','addons/auto-reply.js','addons/thread-tracker.js');
const AddonControl={
 async status(){const s=await My0511API.status();return {...s,ok:true,posts:[],alertGap:await AddonState.read('alertGap',null),archiveStatus:await My0511API.archiveStatus(),agentConnectedAt:(await AddonState.read('agentConnection',null))?.lastSeenAt||null};},
 async pause(scope,paused){return paused?My0511API.pause(scope):My0511API.resume(scope);},
 async handle(m){
  switch(m.type){
   case 'ADDON_TRACK_LIST':return ThreadTracker.list();
   case 'ADDON_TRACK_SAVE':return ThreadTracker.save(m);
   case 'ADDON_TRACK_TOGGLE':return ThreadTracker.toggle(m.tid,m.enabled);
   case 'ADDON_TRACK_ACTION':return ThreadTracker.action(m);
   case 'ADDON_STATUS':return this.status();
   case 'ADDON_PAUSE':await My0511API.pause(m.scope||'all');return {ok:true};
   case 'ADDON_RESUME':await My0511API.resume(m.scope||'all');return {ok:true};
   case 'ADDON_LIST':return {ok:true,list:(await My0511API.listThreads()).map(t=>({...t,thread:t}))};
   case 'ADDON_PAIR':return Bridge.pair(m.code);
   case 'ADDON_SYNC':return Bridge.sync();
   case 'ADDON_SETTINGS':return Bridge.settings(m);
   case 'ADDON_AI':return Bridge.ai(m.tid,m.prompt);
   case 'ADDON_ARCHIVES':return Bridge.archives(m);
   case 'ADDON_ARCHIVE':return Bridge.archive(m.id);
   case 'ADDON_ARCHIVE_AI':return Bridge.archiveAi(m.id,m.prompt);
   case 'ADDON_APPROVAL':return Bridge.approval(m);
   case 'ADDON_INVALIDATE_APPROVAL':return Bridge.invalidateApproval(m.tid);
   case 'ADDON_ADOPT':await Bridge.invalidateApproval(m.tid);return My0511API.fillReply(m);
   case 'ADDON_VERIFY_CHALLENGE':await My0511API.verifyChallenge(m.id);return {ok:true};
   case 'ADDON_AUTO_STATUS':return AutoReply.status();
   case 'ADDON_AUTO_SET':return AutoReply.setEnabled(m.enabled);
   case 'ADDON_AUTO_CANCEL':{const t=(await AutoReply.status()).task;if(t)await Bridge.invalidateApproval(t.tid);return AutoReply.status();}
   case 'ADDON_SERVICES':return Bridge.request('/services',m);
   case 'ADDON_REPORT':return Bridge.request('/report',m);
   default:throw Error('请使用上方插件核心的相应操作');
  }
 }
};
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(''))||!m?.type?.startsWith('ADDON_'))return;
 AddonControl.handle(m).then(r=>respond(r?.ok===undefined?{ok:true,...r}:r),e=>respond({ok:false,error:e.message}));return true;
});
My0511API.on('alert',async a=>{await AddonState.update('alertOutbox',v=>v.some(x=>x.id===a.id)?v:[...v,a],[]);await Bridge.sync().catch(()=>{});});
My0511API.on('archiveWritten',async e=>{await AddonState.update('archiveWrites',v=>{if(!v[e.tid]||v[e.tid].revision<e.revision)v[e.tid]={revision:e.revision,capturedAt:e.capturedAt};return v;},{});await Bridge.sync().catch(()=>{});});
