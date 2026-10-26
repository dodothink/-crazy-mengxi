import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {forumTime} from './archives.mjs';

const FORMAT='my0511-archive-data',KEY='archiveReader.v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const protocol=x=>x?.format===FORMAT&&x.formatVersion===1&&typeof x.sourceId==='string'&&x.sourceId.length>0;

// Never use mtimes or enumerate uncommitted files. All reads are manifest-directed.
export function archiveDataLibrary(directory,store){
 let cache=new Map(),manifest=null,inflight=null,lastCheck=0,lastError=null;
 async function read(name,maxBytes){
  if(!/^(?:source\.json|manifest\.json|threads\/\d+\.json)$/.test(name))throw Error('机读存档路径无效');
  const archive=await realpath(directory),root=join(archive,'_data');
  for(const path of [root,...(name.startsWith('threads/')?[join(root,'threads')]:[])]){
   const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('机读存档目录不能是符号链接');
  }
  const path=join(root,name),resolved=await realpath(path),rel=relative(root,resolved);
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('机读存档路径越界');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await file.stat();if(!stat.isFile()||stat.size>maxBytes)throw Error('机读存档大小或类型无效');
   // Bound the read even if a writer grows a file after stat().
   const buffer=Buffer.alloc(Math.min(stat.size+1,maxBytes+1));
   let count=0;while(count<buffer.length){const r=await file.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
   if(count>stat.size||count>maxBytes)throw Error('机读存档正在变化，请稍后重试');
   return buffer.subarray(0,count);
  }finally{await file.close();}
 }
 function validate(m,s){
  if(!protocol(m)||!protocol(s)||m.sourceId!==s.sourceId||!integer(m.seq)||!integer(m.generation)||!['full','partial'].includes(m.coverage)||!m.threads||Array.isArray(m.threads)||typeof m.threads!=='object')throw Error('不支持的机读存档协议或清单');
  if(Object.keys(m.threads).length>200000)throw Error('机读清单过大');
  for(const [tid,e] of Object.entries(m.threads)){
   if(!/^\d+$/.test(tid)||!e||!integer(e.seq)||e.seq>m.seq||!integer(e.revision))throw Error('机读清单条目无效');
   if(e.revision===0&&!e.jsonFile)continue; // Failure-only entries have no body.
   if(e.jsonFile!==`threads/${tid}.json`||!/^[a-f0-9]{64}$/.test(e.jsonSha256||''))throw Error('机读清单文件或校验值无效');
  }
 }
 async function scan(){
  const m=JSON.parse(await read('manifest.json',64*1024*1024)),s=JSON.parse(await read('source.json',65536));validate(m,s);
  const previous=store.get(KEY,null);
  const reset=!previous||previous.sourceId!==m.sourceId||previous.generation!==m.generation||m.seq<previous.cursor||previous.cursor+1<(m.journal?.firstSeq||0);
  // Rebuilds and source changes establish a safe new baseline, never replay history.
  if((reset||!manifest)&&m.coverage!=='full')throw Error('机读存档尚未补齐，等待上游覆盖范围变为“全部”');
  const next=new Map(),hashes={};let changed=0,unavailable=0,incomplete=0,verified=0;
  for(const [tid,e] of Object.entries(m.threads)){
   if(e.mdMissing||(!e.revision&&!e.jsonFile)){unavailable++;continue;}
   let record=cache.get(tid);
   if(!record||manifest?.sourceId!==m.sourceId||record.hash!==e.jsonSha256){
    const bytes=await read(e.jsonFile,32*1024*1024);
    if(sha(bytes)!==e.jsonSha256)throw Error(`帖子 ${tid} 尚未写入完成或校验失败，稍后重试`);
    const data=JSON.parse(bytes);
    if(!protocol(data)||data.sourceId!==m.sourceId||String(data.tid)!==tid||data.revision!==e.revision||!Array.isArray(data.floors)||!Array.isArray(data.foldedFloors||[]))throw Error(`帖子 ${tid} 数据与清单不一致`);
    let u;try{u=new URL(data.url);}catch{throw Error(`帖子 ${tid} 网址无效`);}
    if(u.origin!=='https://bbs.my0511.com'||u.username||u.password||!new RegExp('^/f\\d+b-t'+tid+'z(?:-\\d+)?/?$').test(u.pathname))throw Error(`帖子 ${tid} 网址不匹配`);
    const floors=[...data.floors,...(data.foldedFloors||[])];
    if(floors.some(f=>!Number.isSafeInteger(f.floor)||f.floor<1||typeof f.text!=='string')||new Set(floors.map(f=>f.floor)).size!==floors.length)throw Error(`帖子 ${tid} 楼层数据无效`);
    record={hash:e.jsonSha256,data};verified++;
   }
   if(!reset&&previous.hashes?.[tid]!==e.jsonSha256)changed++;
   const ready=e.complete===true&&!e.lastFailure;
   if(!ready)incomplete++;
   hashes[tid]=e.jsonSha256;next.set(tid,{...record,entry:e,ready});
  }
  // All-or-nothing: a failed read cannot advance the cursor past an unread change.
  const state={sourceId:m.sourceId,generation:m.generation,cursor:m.seq,hashes,baselineAt:reset?Date.now():previous.baselineAt,checkedAt:Date.now(),coverage:m.coverage,total:next.size,unavailable,incomplete,changed:reset?0:changed,verified,mode:reset?'baseline':'reconcile'};
  if(reset||previous.cursor!==m.seq||previous.coverage!==m.coverage||previous.total!==state.total||previous.unavailable!==unavailable||previous.incomplete!==incomplete||previous.changed!==state.changed)store.set(KEY,state);
  cache=next;manifest=m;lastCheck=Date.now();lastError=null;
  return status();
 }
 async function sync(){
  if(inflight)return inflight;
  inflight=scan().catch(e=>{lastError=e.message;throw e;}).finally(()=>{inflight=null;});return inflight;
 }
 async function ensure(refresh=false){if(refresh||!manifest||lastError||Date.now()-lastCheck>30000)await sync();}
 function status(){const s=store.get(KEY,null);return {ok:!!s&&!lastError,protocolVersion:1,source:'_data',coverage:s?.coverage||null,total:s?.total||0,cursor:s?.cursor??null,generation:s?.generation??null,incomplete:s?.incomplete||0,unavailable:s?.unavailable||0,baselineAt:s?.baselineAt||null,checkedAt:lastCheck||s?.checkedAt||null,mode:s?.mode||'waiting',error:lastError};}
 function view(tid,r){
  const d=r.data,e=r.entry;
  const floors=[...d.floors,...(d.foldedFloors||[])].sort((a,b)=>a.floor-b.floor).map(f=>({...f,heading:[f.author||'未知作者',f.time||'时间未知'].join(' · '),archiveData:true}));
  return {...d,tid,id:tid,count:floors.length,floors,fileName:e.jsonFile,capturedAt:forumTime(d.capturedAt),mtime:Date.parse(d.writtenAt)||0,complete:r.ready,warning:r.ready?null:'本次采集不完整或完整性未知；仅代表已存内容',lastFailure:e.lastFailure||null};
 }
 async function get(tid){await ensure();if(!/^\d+$/.test(String(tid))||!cache.has(String(tid)))throw Error('机读存档中没有该帖，请刷新列表');return view(String(tid),cache.get(String(tid)));}
 async function list({query='',offset=0,refresh=false}={}){
  await ensure(refresh);const q=String(query).trim().toLowerCase().slice(0,200);
  const found=[...cache].map(([tid,r])=>({id:tid,tid,fid:r.data.fid,title:r.data.title,url:r.data.url,count:r.data.floorCount,fileName:r.entry.jsonFile,complete:r.ready,writtenAt:r.data.writtenAt})).filter(x=>!q||String(x.title).toLowerCase().includes(q)||x.tid.includes(q)).sort((a,b)=>String(b.writtenAt).localeCompare(String(a.writtenAt))||a.tid.localeCompare(b.tid));
  const start=Math.max(0,Number.isSafeInteger(offset)?offset:0),s=status();
  return {ok:true,directory:join(directory,'_data'),total:cache.size,skipped:s.unavailable,matched:found.length,offset:start,hasMore:start+100<found.length,items:found.slice(start,start+100),reader:s,scannedAt:lastCheck};
 }
 async function preview(tid){const r=await get(tid),text=[r.title,r.url,r.warning||'完整采集',...r.floors.map(f=>`${f.floor}楼 · ${f.heading}\n${f.hidden?'[本楼不可见]\n':''}${f.quote?'引用：'+f.quote+'\n':''}${f.text}`)].join('\n\n');return {ok:true,tid:r.tid,title:r.title,text:text.slice(0,60000),truncated:text.length>60000,complete:r.complete};}
 async function context(tid){const r=await get(tid);if(!r.complete)throw Error('本次采集不完整或完整性未知，请先由上游完成完整采集');const f=r.floors.filter(x=>!x.hidden),chosen=[...f.slice(0,3),...f.slice(3).slice(-12)],body={title:r.title,tid:r.tid,source:'已校验机读存档 v1',floors:[]};for(const x of chosen){const item={floor:x.floor,author:x.author,text:x.text.slice(0,1400)};if(JSON.stringify({...body,floors:[...body.floors,item]}).length>24000)break;body.floors.push(item);}return JSON.stringify(body);}
 async function records(){await ensure();return [...cache].map(([tid,r])=>view(tid,r));}
 async function byTid(tid){const r=await get(tid);return {...r,sources:[r]};}
 return {sync,status,list,preview,context,records,byTid};
}
