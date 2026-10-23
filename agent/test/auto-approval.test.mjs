import test from 'node:test';import assert from 'node:assert/strict';
import {Store,approve} from '../core.mjs';import {autoApproval} from '../auto-approval.mjs';
function setup(){const s=new Store(':memory:'),now=Date.now();s.set('approval:a',{profile:'p',draft:{tid:'1',fid:'152',message:'test'},draftRef:'ref',autoAfterMs:300000,sentAt:now-300000,state:'pending',expires:now+600000});s.set('activeApproval:p:1','a');s.set('telegramHealth',{ok:true,at:now});s.notify('approval:a',{});s.db.prepare("UPDATE outbox SET state='sent'").run();return {s,now,body:{id:'a',draftRef:'ref',action:'claim'}};}
test('confirmed delivery times out exactly once; phone approval cannot race a consumed timeout',()=>{const {s,now,body}=setup();try{assert.throws(()=>autoApproval(s,'p',body,now-1));assert.equal(autoApproval(s,'p',body,now).state,'timed_out');assert.throws(()=>autoApproval(s,'p',body,now));assert.throws(()=>approve(s,'a',true));assert.equal(s.pending('p').length,0);}finally{s.close();}});
test('rejection, adoption, cancellation, replacement, offline and missing delivery prevent timeout',()=>{
 for(const mode of ['reject','adopt','cancel','replace','offline','pending','no-date','manual','expired','late','other-profile','other-ref']){
  const {s,now,body}=setup();try{
   if(mode==='reject')approve(s,'a',false);if(mode==='adopt')approve(s,'a',true);
   if(mode==='cancel')autoApproval(s,'p',{...body,action:'cancel'},now);
   if(mode==='replace')s.set('activeApproval:p:1','b');if(mode==='offline')s.set('telegramHealth',{ok:true,at:now-11000});
   if(mode==='pending')s.db.prepare("UPDATE outbox SET state='needs_review'").run();
   if(mode==='no-date')s.set('approval:a',{...s.get('approval:a'),sentAt:null});
   if(mode==='manual')s.set('approval:a',{...s.get('approval:a'),autoAfterMs:0});
   if(mode==='expired')s.set('approval:a',{...s.get('approval:a'),expires:now-1});
   assert.throws(()=>autoApproval(s,mode==='other-profile'?'q':'p',mode==='other-ref'?{...body,draftRef:'new'}:body,mode==='late'?now+60001:now),mode);
  }finally{s.close();}
 }
});
