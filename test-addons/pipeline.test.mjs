import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {worker} from './harness.mjs';
test('timeout uses real posting pipeline once, stops on edit and requires matching forum target',async()=>{
 for(const scenario of ['success','cancel-during-fill','wrong-target']){
  const task={tid:'1',fid:'152',message:'test',draftRef:'test-reference',state:'countdown',dueAt:Date.now(),lastCheckedAt:Date.now()};
  const w=worker({safety380:{profileId:'p'},migr340:true,haltCollect:true,haltPost:false,'addon:autoReplyConfig':{enabled:true},'addon:autoReplyTask':task,'addon:pendingApprovals':{'1':{draftRef:'test-reference'}},postCfg:{enabled:false,myName:'me',minGapMin:0,quietDays:0}});
  await w.eval('Poster.ready');await w.eval('AutoReply.ready');w.data['addon:autoReplyTask'].state='sending';
  w.c.setTimeout=(fn,ms)=>setTimeout(fn,ms>=45000?ms:0);
  w.eval(`fetchHtml=async()=>'';parse=async()=>({meta:{totalPages:1},floors:[{floor:1,pid:'10',author:'other'}]});`);
  let submits=0;
  w.chrome.scripting.executeScript=async({func,args})=>{
   if(func.name==='pageFill'){if(scenario==='cancel-during-fill')await w.eval('AutoReply.setEnabled(false)');return [{result:{ok:true}}];}
   if(func.name==='pageSubmit'){
    const f={querySelector:q=>q==='textarea[name=message]'?{value:'test'}:{click(){submits++;}}};
    return [{result:vm.runInNewContext('('+func.toString()+')(...args)',{args,URL,location:{href:'https://bbs.my0511.com/post.php?action=reply&fid=152&tid='+(scenario==='wrong-target'?'9':'1')},document:{getElementById:()=>f}})}];
   }
   if(func.name==='pageProbe')return [{result:{ready:true,url:'https://bbs.my0511.com/f152b-t1z',receipt:{pid:'11',url:'https://bbs.my0511.com/f152b-t1z#pid11'}}}];
   throw Error('unexpected injection');
  };
  const result=await w.eval('AddonState.read("autoReplyTask").then(t=>My0511API.postOnce({ref:t.draftRef,tid:t.tid,fid:t.fid,message:t.message},item=>AutoReply.assertReady({...item,ref:t.draftRef})))');
  assert.equal(submits,scenario==='success'?1:0,scenario);assert.equal(result.ok,scenario==='success',scenario);
  assert.equal(w.data.postQueue[0].status,scenario==='success'?'done':'needs_review');
  await assert.rejects(w.eval('AddonState.read("autoReplyTask").then(t=>My0511API.postOnce({ref:t.draftRef,tid:t.tid,fid:t.fid,message:t.message},item=>AutoReply.assertReady({...item,ref:t.draftRef})))'));assert.equal(w.requests(),0);
 }
});
