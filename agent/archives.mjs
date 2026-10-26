import {readdir,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
const MAX_BYTES=8*1024*1024;
export function parseArchive(text){
 const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);if(!match)return null;
 const fields={};for(const line of match[1].split(/\r?\n/)){const i=line.indexOf(':');if(i>0)fields[line.slice(0,i).trim()]=line.slice(i+1).trim();}
 if(!/^\d+$/.test(fields.tid||''))return null;
 let url;try{url=new URL(fields['网址']);}catch{return null;}
 const ids=/^\/f(\d+)b-t(\d+)z(?:-\d+)?\/?$/.exec(url.pathname);
 if(url.origin!=='https://bbs.my0511.com'||url.username||url.password||!ids||ids[2]!==fields.tid)return null;
 let title=fields['标题']||'帖子 '+fields.tid;try{title=JSON.parse(title);}catch{}if(typeof title!=='string')title='帖子 '+fields.tid;
 const appendixAt=text.indexOf('\n## 附录：短回复');const bodyText=appendixAt>=0?text.slice(0,appendixAt):text;
 const floors=[];const re=/^### (\d+)楼 · ([^\n]+)\r?\n/gm;let m,last;
 while((m=re.exec(bodyText))){if(last)last.text=text.slice(last.start,m.index).trim();last={floor:Number(m[1]),heading:m[2].replace(/ <a id="f\d+"><\/a>\s*$/,''),start:re.lastIndex};floors.push(last);}
 if(last)last.text=bodyText.slice(last.start).trim();
 if(appendixAt>=0)for(const short of text.slice(appendixAt).matchAll(/^- \*\*(\d+)楼\*\* (.*?) · (\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}(?::\d{2})?)：(.*?) <a id="f\d+"><\/a>$/gm)){if(!floors.some(f=>f.floor===+short[1]))floors.push({floor:+short[1],heading:short[2]+' · '+short[3],text:short[4],start:0});}
 if(!floors.length)return null;
 return {tid:fields.tid,fid:ids[1],title:title.slice(0,500),url:url.href,count:floors.length,capturedAt:forumTime(fields['采集时间']),board:fields['版块']||'',floors};
}
export function archiveLibrary(directory){
 let files=new Map(),items=[],scannedAt=0,skipped=0,markdown=0,scanning;
 const idFor=name=>createHash('sha256').update(name).digest('hex');
 async function read(name){
  if(basename(name)!==name||!name.toLowerCase().endsWith('.md'))throw Error('存档文件无效');
  const root=await realpath(directory);const handle=await open(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await handle.stat();if(!st.isFile()||st.size>MAX_BYTES)throw Error('存档不是普通文件或超过 8 MB');const text=await handle.readFile('utf8');if(Buffer.byteLength(text)>MAX_BYTES)throw Error('存档超过 8 MB');return {text,mtime:st.mtimeMs,bytes:st.size};}finally{await handle.close();}
 }
 async function scan(){if(scanning)return scanning;scanning=(async()=>{
  let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{throw Error('无法读取存档目录，请检查目录是否存在及本机读取权限');}
  const next=new Map(),list=[];let ignored=0,total=0;
  for(const entry of entries){if(entry.name.startsWith('.')||entry.name==='My0511存档索引.md'||!entry.name.toLowerCase().endsWith('.md'))continue;total++;if(!entry.isFile()){ignored++;continue;}
   try{const {text,mtime,bytes}=await read(entry.name),record=parseArchive(text);if(!record){ignored++;continue;}const id=idFor(entry.name);next.set(id,entry.name);const {floors,...meta}=record;list.push({...meta,id,fileName:entry.name,mtime,bytes});}catch{ignored++;}
  }
  files=next;items=list.sort((a,b)=>b.mtime-a.mtime||a.id.localeCompare(b.id));skipped=ignored;markdown=total;scannedAt=Date.now();
 })();try{await scanning;}finally{scanning=null;}}
 async function list({query='',offset=0,refresh=false}={}){
  if(!scannedAt||refresh)await scan();const q=String(query).trim().toLowerCase().slice(0,200),found=items.filter(x=>!q||x.title.toLowerCase().includes(q)||x.tid.includes(q));const start=Math.max(0,Number(offset)||0);
  return {ok:true,directory,total:items.length,markdown,skipped,matched:found.length,offset:start,hasMore:start+100<found.length,items:found.slice(start,start+100),scannedAt};
 }
 async function record(id){if(!scannedAt)await scan();if(typeof id!=='string'||!files.has(id))throw Error('存档不存在，请刷新文件列表');let file;try{file=await read(files.get(id));}catch{throw Error('无法读取这份存档，请刷新列表');}const r=parseArchive(file.text);if(!r)throw Error('这份文件已不再是有效的帖子存档');return {...r,text:file.text};}
 async function preview(id){const r=await record(id);return {ok:true,title:r.title,tid:r.tid,fid:r.fid,text:r.text.slice(0,60000),truncated:r.text.length>60000};}
 async function context(id){const r=await record(id),sorted=r.floors.sort((a,b)=>a.floor-b.floor),chosen=[...sorted.slice(0,3),...sorted.slice(3).slice(-12)];let body={title:r.title,tid:r.tid,source:'本机 Markdown 存档，可能含采集时的历史版本',floors:[]};for(const f of chosen){const item={floor:f.floor,heading:f.heading,text:f.text.slice(0,1400)};if(JSON.stringify({...body,floors:[...body.floors,item]}).length>24000)break;body.floors.push(item);}return JSON.stringify(body);}
 async function records(){await scan();const result=[];for(const item of items){try{result.push({...await record(item.id),fileName:item.fileName,mtime:item.mtime});}catch{}}return result;}
 async function byTid(tid){if(!/^\d+$/.test(String(tid)))throw Error('帖子编号无效');const all=(await records()).filter(r=>r.tid===String(tid));if(!all.length)throw Error('本机没有该帖存档');const sorted=all.sort((a,b)=>(a.capturedAt||a.mtime)-(b.capturedAt||b.mtime)),floors=new Map();for(const r of sorted)for(const f of r.floors)floors.set(f.floor,f);return {...sorted.at(-1),floors:[...floors.values()].sort((a,b)=>a.floor-b.floor),sources:sorted};}
 return {list,preview,context,records,byTid};
}

// File-format readers used by reports; no fingerprint recomputation.
export function forumTime(value){const m=/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value||'');return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]-8,+m[5],+(m[6]||0)):null;}
export function floorDetails(f){
 if(f.archiveData)return {...f,author:f.author||'未知作者',at:forumTime(f.time),current:f.text,history:f.history||[],hidden:!!f.hidden,fingerprints:f.fingerprint?[f.fingerprint]:[],quote:f.text};
 const parts=f.heading.split(' · '),timeIndex=parts.findIndex(x=>forumTime(x)!==null);
 const cut=f.text.indexOf('> **本楼内容变过');const current=cut>=0?f.text.slice(0,cut).trim():f.text;
 const history=[...f.text.matchAll(/<details><summary>(.*?)<\/summary>\s*\n([\s\S]*?)<\/details>/g)].map(m=>({label:m[1],raw:m[2].trim()}));
 return {...f,author:(timeIndex>0?parts.slice(0,timeIndex):parts.slice(0,1)).join(' · '),at:timeIndex>=0?forumTime(parts[timeIndex]):null,current,history,hidden:/^> ⚠ 此楼在 /m.test(current),fingerprints:[...f.text.matchAll(/^(?:> )?<!-- 指纹 sha256:[^\n]*-->/gm)].map(m=>m[0]),quote:current.replace(/^<!--.*-->\s*$/gm,'').replace(/^> (?:⚠|图片存档：).*$/gm,'').trim()};
}
