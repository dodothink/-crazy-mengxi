import {forumTime} from './archives.mjs';
// Discover only newly archived topics. No forum access and no publishing authority.
export function archiveWatch(store,archives){
 const key='archiveWatch.v1';
 const initial=()=>({enabled:false,users:[],myName:'',prompt:'',baseline:null,pending:[],lastAt:null,error:null});
 const get=()=>({...initial(),...store.get(key,{})});
 let busy=null;
 function save(input){const prev=get();if(typeof input.enabled!=='boolean'||!Array.isArray(input.users)||input.users.length>20)throw Error('最多20个关注用户名');const users=input.users.map(u=>({name:String(u.name||'').trim(),enabled:u.enabled!==false}));if(users.some(u=>!u.name||u.name.length>100)||new Set(users.map(u=>u.name)).size!==users.length)throw Error('用户名为空、过长或重复');const myName=String(input.myName||'').trim();if(input.enabled&&(!users.some(u=>u.enabled)||!myName))throw Error('请填写本人用户名并开启至少一个关注用户');if(myName.length>100)throw Error('本人用户名过长');const changed=JSON.stringify(prev.users)!==JSON.stringify(users)||prev.enabled!==input.enabled;const value={...prev,enabled:input.enabled,users,myName,prompt:String(input.prompt||'').slice(0,300),...(changed?{baseline:null,pending:[],error:null}:{})};store.set(key,value);return status();}
 function status(){const s=get();return {ok:true,enabled:s.enabled,users:s.users,myName:s.myName,prompt:s.prompt,baselineReady:!!s.baseline,lastAt:s.lastAt,error:s.error,pending:s.pending.length,source:'本机 _data，仅限上游已经采到的帖子，不扫描论坛前三页'};}
 function check(){if(busy)return busy;busy=run().finally(()=>{busy=null;});return busy;}
 async function run(){let s=get();if(!s.enabled)return {ok:true,items:[],status:status()};try{
  await archives.sync();const meta=archives.status();if(meta.coverage!=='full')throw Error('等待上游机读存档补齐');const rows=await archives.records();
  // Configuration may have changed while files were being read.
  const now=get();if(JSON.stringify([now.enabled,now.users,now.myName,now.prompt])!==JSON.stringify([s.enabled,s.users,s.myName,s.prompt]))return {ok:true,items:[],status:status()};
  const identity=meta.sourceId+':'+meta.generation;
  if(!s.baseline||s.baseline.identity!==identity||meta.cursor<s.baseline.cursor){s={...s,baseline:{identity,cursor:meta.cursor,at:Date.now(),tids:rows.map(r=>r.tid)},pending:[],lastAt:Date.now(),error:null};store.set(key,s);return {ok:true,items:[],status:status()};}
  const seen=new Set(s.baseline.tids),users=new Set(s.users.filter(u=>u.enabled).map(u=>u.name)),pending=[...s.pending];
  for(const r of rows){if(seen.has(r.tid))continue;if(!r.authorKnown)continue;const created=forumTime(r.createdAt);if(created===null)continue;if(String(r.fid)!=='152'||created<=s.baseline.at){seen.add(r.tid);continue;}const name=String(r.author||'').trim();if(users.has(name)&&name!==s.myName){if(pending.length>=100)break;pending.push({tid:r.tid,fid:r.fid,url:r.url,title:r.title,author:name,myName:s.myName,prompt:s.prompt,discoveredAt:Date.now()});}seen.add(r.tid);}
  store.set(key,{...s,baseline:{identity,cursor:meta.cursor,at:s.baseline.at,tids:[...seen]},pending,lastAt:Date.now(),error:null});return {ok:true,items:pending.slice(0,20),status:status()};
 }catch(e){store.set(key,{...get(),lastAt:Date.now(),error:e.message});throw e;}}
 function ack(tids){if(!Array.isArray(tids)||tids.some(t=>!/^\d+$/.test(String(t))))throw Error('确认编号无效');const s=get(),ids=new Set(tids.map(String));store.set(key,{...s,pending:s.pending.filter(t=>!ids.has(t.tid))});return status();}
 return {status,save,check,ack};
}
