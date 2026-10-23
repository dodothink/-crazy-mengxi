import test from 'node:test';import assert from 'node:assert/strict';import {worker} from './harness.mjs';
function message(w,msg){return new Promise(resolve=>{w.listeners.forEach(fn=>fn(msg,{id:w.chrome.runtime.id,url:w.chrome.runtime.getURL('popup.html')},resolve));});}
async function autoWorker(){
 const w=worker({safety380:{profileId:'p'},migr340:true,haltCollect:true,haltPost:false});await w.eval('Poster.ready');await w.eval('AutoReply.ready');
 w.c.autoCalls=[];w.c.postCalls=[];
 w.c.autoStatus={ok:true,state:'pending',delivery:'sent',dueAt:Date.now()-1};
 w.eval(`Bridge.autoApproval=async b=>{autoCalls.push(b);return b.action==='claim'?{ok:true,state:'timed_out'}:autoStatus;};Poster.postOnce=async (t,guard)=>{postCalls.push(t);await guard(t);return {ok:true};};`);
 return w;
}
async function armAuto(w){await w.eval(`AutoReply.setEnabled(true)`);await w.eval(`AutoReply.begin({tid:'1',fid:'152',message:'test'},'ref')`);w.data['addon:pendingApprovals']={'1':{draftRef:'ref'}};await w.eval(`AutoReply.attach('ref','a')`);}
test('auto mode defaults off, starts only after delivery and makes one attempt',async()=>{
 const w=await autoWorker();assert.equal((await w.eval('AutoReply.status()')).enabled,false);await w.eval('AutoReply.tick()');assert.equal(w.c.postCalls.length,0);
 await armAuto(w);w.c.autoStatus={ok:true,state:'pending',delivery:'pending',dueAt:null};await w.eval('AutoReply.tick()');assert.equal(w.data['addon:autoReplyTask'].state,'waiting_notice');assert.equal(w.c.postCalls.length,0);
 w.c.autoStatus={ok:true,state:'pending',delivery:'sent',dueAt:Date.now()-1};await Promise.all([w.eval('AutoReply.tick()'),w.eval('AutoReply.tick()')]);assert.equal(w.c.postCalls.length,1);assert.equal(w.data['addon:autoReplyTask'].state,'done');
});
test('switch off, edit, reject, pause, offline, failed delivery and missed deadline cancel without posting',async()=>{
 for(const reason of ['off','edit','reject','pause','offline','delivery','late']){
  const w=await autoWorker();await armAuto(w);
  if(reason==='off')await w.eval('AutoReply.setEnabled(false)');
  if(reason==='edit')await w.eval('Bridge.invalidateApproval("1")');
  if(reason==='reject')w.c.autoStatus.state='rejected';
  if(reason==='pause')await message(w,{type:'HALT_POST'});
  if(reason==='offline')w.data['addon:autoReplyTask'].lastCheckedAt=Date.now()-91000;
  if(reason==='delivery')w.c.autoStatus.delivery='needs_review';
  if(reason==='late')w.c.autoStatus.dueAt=Date.now()-61000;
  await w.eval('AutoReply.tick()');assert.equal(w.c.postCalls.length,0,reason);assert.equal(w.data['addon:autoReplyTask'].state,'cancelled',reason);
 }
});
test('switch off during timeout claim prevents submission and reconnect never retries uncertain claim',async()=>{
 const w=await autoWorker();await armAuto(w);
 w.eval(`Bridge.autoApproval=async b=>{if(b.action==='claim'){await AutoReply.setEnabled(false);return {ok:true,state:'timed_out'};}return autoStatus;};`);
 await w.eval('AutoReply.tick()');assert.equal(w.c.postCalls.length,0);
 const interrupted=worker({'addon:autoReplyConfig':{enabled:true},'addon:autoReplyTask':{state:'sending',draftRef:'ref'}});await interrupted.eval('AutoReply.ready');assert.equal(interrupted.data['addon:autoReplyTask'].state,'stopped');assert.equal(interrupted.requests(),0);
});
test('busy Telegram polling retries only inside deadline; stale local draft cannot pass submit guard',async()=>{
 const w=await autoWorker();await armAuto(w);w.eval(`Bridge.autoApproval=async b=>b.action==='claim'?{ok:true,busy:true}:autoStatus;`);
 await w.eval('AutoReply.tick()');assert.equal(w.data['addon:autoReplyTask'].state,'countdown');assert.equal(w.c.postCalls.length,0);
 w.data['addon:autoReplyTask'].state='sending';w.data['addon:autoReplyTask'].dueAt=Date.now();
 await assert.rejects(w.eval(`AutoReply.assertReady({tid:'1',fid:'152',message:'edited',ref:'ref'})`));
});
