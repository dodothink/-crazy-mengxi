import {createHash} from 'node:crypto';
import {Store} from '../core.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';
test('HTTP authentication, origin isolation, one-use pairing and AI validation',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'my0511-http-'))+'/runtime/';mkdirSync(dir,{recursive:true});mkdirSync(dir+'../archives');writeFileSync(dir+'../archives/thread.md','---\n标题: "本地存档"\n网址: https://bbs.my0511.com/f152b-t123z\ntid: 123\n---\n### 1楼 · 作者\n正文内容');mkdirSync(dir+'../archives/_data/threads',{recursive:true});const meta={format:'my0511-archive-data',formatVersion:1,sourceId:'http-test-source'};const data={...meta,tid:'123',fid:'152',title:'本地存档',url:'https://bbs.my0511.com/f152b-t123z',revision:1,floorCount:1,floors:[{floor:1,author:'作者',time:'2026-10-26 08:00',text:'正文内容'}],foldedFloors:[]};const bytes=JSON.stringify(data);writeFileSync(dir+'../archives/_data/source.json',JSON.stringify(meta));writeFileSync(dir+'../archives/_data/threads/123.json',bytes);writeFileSync(dir+'../archives/_data/manifest.json',JSON.stringify({...meta,seq:1,generation:1,coverage:'full',journal:{firstSeq:1,files:[]},threads:{'123':{seq:1,revision:1,jsonFile:'threads/123.json',jsonSha256:createHash('sha256').update(bytes).digest('hex'),complete:true}}}));const port=17859;const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,MY0511_RUNTIME:dir,MY0511_ARCHIVES:dir+'../archives',MY0511_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{await Promise.race([once(child.stdout,'data'),once(child,'exit').then(([code])=>{throw new Error('Test service failed '+code);})]);
 const ext='b'.repeat(32),origin='chrome-extension://'+ext;
 const call=(path,data,headers={})=>fetch('http://127.0.0.1:'+port+path,{method:'POST',headers:{'Content-Type':'application/json','X-Extension-Id':ext,Origin:origin,...headers},body:JSON.stringify(data)});
 assert.equal((await call('/sync',{})).status,401);
 assert.equal((await call('/remote-guard',{id:'test-send'})).status,401);
 assert.equal((await call('/ai-config',{})).status,401);
 assert.equal((await call('/archives',{})).status,401);
 assert.equal((await call('/archive-status',{})).status,401);
 assert.equal((await call('/services',{})).status,401);
 assert.equal((await call('/report',{kind:'daily'})).status,401);
 assert.equal((await call('/settings',{action:'save',kimiKey:'test-key-12345'})).status,401);
 assert.equal((await call('/pair',{}, {Origin:'https://evil.invalid'})).status,403);
 const preflight=await fetch('http://127.0.0.1:'+port+'/pair',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-extension-id'}});assert.equal(preflight.status,200);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const code=readFileSync(dir+'pairing-code','utf8');const p=await (await call('/pair',{code,profile:'test-profile-123456'})).json();assert.equal(p.ok,true);
 assert.equal((await call('/pair',{code,profile:'test-profile-123456'})).status,403);
 const headers={Authorization:'Bearer '+p.token};
 const aiCfg=await (await call('/ai-config',{action:'save',config:{dailyLimit:0,batchSize:12,reasoningEffort:'low'}},headers)).json();assert.equal(aiCfg.config.model,'kimi-k3.1-pro');assert.equal(aiCfg.config.batchSize,12);assert.equal((await call('/ai-config',{action:'save',config:{dailyLimit:-1}},headers)).status,400);
 const service=await (await call('/services',{action:'save',config:{dailyEnabled:false,quietStart:'01:00'}},headers)).json();assert.equal(service.config.quietStart,'01:00');assert.equal(service.config.dailyEnabled,false);
 assert.equal((await call('/services',{action:'save',config:{dailyTime:'99:00'}},headers)).status,400);
 const original=readFileSync(dir+'../archives/thread.md','utf8');const report=await (await call('/report',{kind:'daily'},headers)).json();assert.equal(report.ok,true);assert.ok(report.path.startsWith(dir+'reports/'));assert.ok(existsSync(report.path));assert.equal(readFileSync(dir+'../archives/thread.md','utf8'),original);
 const reader=await (await call('/archive-status',{},headers)).json();assert.equal(reader.ok,true);assert.equal(reader.coverage,'full');assert.equal(reader.total,1);
 const archiveList=await (await call('/archives',{},headers)).json();assert.equal(archiveList.total,1);
 const archive=await (await call('/archive',{id:archiveList.items[0].id},headers)).json();assert.match(archive.text,/正文内容/);
 const invalidArchive=await (await call('/archive-ai',{id:'../outside',prompt:''},headers)).json();assert.equal(invalidArchive.ok,false);
 const prefs=await (await call('/settings',{action:'save',kimiKey:'test-key-12345'},headers)).json();assert.equal(prefs.kimiConfigured,true);assert.equal(JSON.stringify(prefs).includes('test-key-12345'),false);
 const prefsStatus=await (await call('/settings',{action:'status'},headers)).json();assert.equal(prefsStatus.kimiConfigured,true);assert.equal((await call('/sync',{status:{haltCollect:true,haltPost:true}},headers)).status,200);
 assert.equal((await call('/sync',{}, {...headers,'X-Extension-Id':'c'.repeat(32)})).status,403);
 const ai=await (await call('/ai',{context:'',prompt:''},headers)).json();assert.equal(ai.ok,false);
 const approval=await (await call('/approval',{tid:'1',fid:'152',message:'test'},headers)).json();assert.match(approval.error,/尚未绑定/);
 const db=new Store(dir+'agent.sqlite');try{
  for(let i=0;i<25;i++)db.enqueue('test-profile-123456','pause',{},60000,'ack-'+i);
  const acks=Array.from({length:25},(_,i)=>({id:'ack-'+i,result:{ok:true}}));
  const first=await (await call('/sync',{status:{haltCollect:true},acks},headers)).json();assert.equal(first.acked.length,20);assert.equal(first.commands.length,5);
  const second=await (await call('/sync',{status:{haltCollect:true},acks:acks.slice(20)},headers)).json();assert.equal(second.acked.length,5);assert.equal(second.commands.length,0);
  db.enqueue('test-profile-123456','trackerControl',{op:'send',tid:'1'},60000,'test-send');
  assert.equal((await call('/remote-guard',{id:'test-send'},headers)).status,200);
  db.set('remoteCancelled:test-send',true);
  assert.equal((await call('/remote-guard',{id:'test-send'},headers)).status,400);
  db.set('telegramBinding',{chatId:'test-chat',userId:'test-user'});
  const request={tid:'1',fid:'152',message:'测试，不发表',draftRef:'test-draft-reference-1'};
  const approved=await (await call('/approval',request,headers)).json();assert.equal(approved.ok,true);assert.equal(db.get('approval:'+approved.id).draftRef,request.draftRef);
 }finally{db.close();}

 }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit').catch(()=>{});}rmSync(join(dir,'..'),{recursive:true,force:true});}
});
