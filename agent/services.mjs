import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from './write-guard.mjs';
import {floorDetails} from './archives.mjs';
const DAY=86400000,MIN=60000;
export const defaults={kinds:{reply:true,edit:true,hidden:true,keyword:true},quietStart:'00:00',quietEnd:'07:00',dailyTime:'08:00',dailyEnabled:true};
export function bj(now){const d=new Date(now+8*3600000);return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes(),hour:d.toISOString().slice(0,13)};}
const minutes=s=>+s.slice(0,2)*60+(+s.slice(3));
export function quiet(cfg,now){const a=minutes(cfg.quietStart),b=minutes(cfg.quietEnd),n=bj(now).minute;return a===b?false:a<b?n>=a&&n<b:n>=a||n<b;}
const digest=s=>createHash('sha256').update(s).digest('hex');
export function services({store,archives,output,notify,ai,now=Date.now}){
 store.set('summaryJobs',store.get('summaryJobs',[]).map(j=>j.state==='running'?{...j,state:'failed',error:'服务重启中断，请重新请求；已完成分段会复用'}:j));
 const cfg=()=>({...defaults,...store.get('servicePrefs',{}),kinds:{...defaults.kinds,...store.get('servicePrefs',{}).kinds}});
 function save(p){const c=cfg();for(const k of ['quietStart','quietEnd','dailyTime'])if(k in p){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p[k]))throw Error('时间格式应为 HH:MM');c[k]=p[k];}if('dailyEnabled'in p)c.dailyEnabled=!!p.dailyEnabled;for(const k of Object.keys(defaults.kinds))if(k in (p.kinds||{}))c.kinds[k]=!!p.kinds[k];store.set('servicePrefs',c);return status();}
 function status(){return {ok:true,config:cfg(),settings:store.get('pluginSettings',{}),archiveStatus:store.get('archiveStatus',null),alertGap:store.get('alertGap',null),reports:store.get('reports',[]).slice(-30),errors:store.get('serviceErrors',[]).slice(-5)};}
 function ingestContext({archiveWrites={},archiveStatus=null,alertGap=null}={}){const saved=store.get('archiveWrites',{});for(const [tid,w] of Object.entries(archiveWrites)){if(/^\d+$/.test(tid)&&Number.isFinite(w?.capturedAt)&&Number.isFinite(w?.revision)&&(!saved[tid]||saved[tid].revision<w.revision))saved[tid]={capturedAt:w.capturedAt,revision:w.revision};}store.set('archiveWrites',saved);store.set('archiveStatus',archiveStatus);if(alertGap)store.set('alertGap',alertGap);}
 const evidenceReady=a=>store.get('archiveWrites',{})[a.tid]?.capturedAt>=a.at;
 function archiveReason(){const s=store.get('archiveStatus',{});return !s?'尚未同步存档状态':s.folderAuthNeeded||['denied','prompt'].includes(s.permission)?'存档文件夹需要重新授权':s.lastWriteError?'最近写入失败：'+s.lastWriteError.error:s.pendingWrites?'仍有 '+s.pendingWrites+' 个帖子待写入':s.mode==='downloads'?'插件使用普通下载模式，请选择共用存档文件夹':'尚未确认提醒对应版本已写入';}
 function ingest(settings,alerts){
  if(settings)store.set('pluginSettings',{myName:String(settings.myName||'').slice(0,100),watchUsers:(settings.watchUsers||[]).filter(x=>typeof x==='string').slice(0,500),keywords:(settings.keywords||[]).filter(x=>typeof x==='string').slice(0,500)});
  const rows=store.get('serviceAlerts',[]),ids=new Set(rows.map(x=>x.id));
  for(const a of (alerts||[]).slice(0,300)){
   if(ids.has(a.id)){if(a.read){const old=rows.find(x=>x.id===a.id);old.read=true;if(old.delivery==='pending')old.delivery='read';}continue;}
   if(!/^[-\w]{1,100}$/.test(a.id||'')||!['reply','edit','hidden','keyword'].includes(a.kind)||!/^\d+$/.test(String(a.tid))||!Number.isFinite(a.at)||a.at>now()+MIN)continue;
   let u;try{u=new URL(a.url);}catch{continue;}if(u.origin!=='https://bbs.my0511.com'||u.username||u.password||!new RegExp('^/f\\d+b-t'+a.tid+'z(?:-\\d+)?$').test(u.pathname))continue;
   rows.push({id:a.id,tid:String(a.tid),kind:a.kind,at:a.at,received:now(),floor:Number.isInteger(a.floor)?a.floor:null,author:String(a.author||'').slice(0,100),title:String(a.title||'').slice(0,200),message:String(a.message||'').slice(0,1500),url:u.href,read:!!a.read,delivery:a.read?'read':cfg().kinds[a.kind]?'pending':'disabled',quiet:quiet(cfg(),now())});ids.add(a.id);
  }
  // Keep pending alerts; prune old delivered metadata only.
  store.set('serviceAlerts',rows.filter(a=>a.delivery==='pending'||now()-a.at<31*DAY));return (alerts||[]).filter(a=>ids.has(a.id)).map(a=>a.id);
 }
 function report(kind,key,text){mkdirSync(output,{recursive:true,mode:0o700});const file=kind+'-'+digest(key).slice(0,20)+'.md';writeFileSync(join(output,file),text,{mode:0o600});const records=store.get('reports',[]).filter(x=>x.file!==file);store.set('reports',[...records,{kind,file,at:now()}].slice(-300));return {ok:true,file,path:join(output,file),text};}
 async function evidence(a){
  if(!evidenceReady(a))return report('evidence',a.id,'# 证据暂缺\n\n原帖：'+a.url+'\n\n'+archiveReason()+'。本次不引用可能过期的楼层内容或指纹，请在完成存档后核对。');
  const r=await archives.byTid(a.tid),sections=[];
  for(const source of r.sources){const f=source.floors.find(x=>x.floor===a.floor);if(f)sections.push('## 来源 '+source.fileName+'\n\n### '+f.floor+'楼 · '+f.heading+'\n\n'+f.text);}
  return report('evidence',a.id,'# 改帖证据记录\n\n提醒：'+a.kind+' · '+new Date(a.at).toISOString()+'\n原帖：'+a.url+'\n\n以下逐字引用存档中的当前版本、历史与指纹；不重新计算指纹，也不判断删楼原因。\n\n'+(sections.join('\n\n')||'当前存档没有此楼，无法提供证据。'));
 }
 async function pushAlerts(){
  const time=now(),c=cfg();if(quiet(c,time)||!store.get('telegramBinding'))return;
  const gap=store.get('alertGap');if(gap)notify('alert-gap:'+gap.from+':'+gap.to,'有提醒缺失：上游保留记录存在缺口（'+gap.from+' → '+gap.to+'）。已继续同步可用提醒，请在论坛核对。');
  let rows=store.get('serviceAlerts',[]);for(const a of rows)if(a.delivery==='pending'&&!c.kinds[a.kind])a.delivery='disabled';store.set('serviceAlerts',rows);
  const pending=rows.filter(a=>a.delivery==='pending'&&(!['edit','hidden'].includes(a.kind)||evidenceReady(a)||time-a.received>=10*MIN));if(!pending.length)return;
  let meter=store.get('alertMeter',{});if(meter.hour!==bj(time).hour)meter={hour:bj(time).hour,count:0};
  if(meter.count>=30)return;
  let groups=[];const quietRows=pending.filter(a=>a.quiet);if(quietRows.length)groups.push(quietRows);
  const regular=pending.filter(a=>!a.quiet),byThread=new Map();for(const a of regular){if(!byThread.has(a.tid))byThread.set(a.tid,[]);byThread.get(a.tid).push(a);}
  for(const list of byThread.values())if(time-Math.min(...list.map(a=>a.received))>=10*MIN)groups.push(list);
  const capacity=30-meter.count;
  if(groups.length>capacity)groups=[...groups.slice(0,Math.max(0,capacity-1)),groups.slice(Math.max(0,capacity-1)).flat()];
  for(const group of groups){
   const id=digest(group.map(a=>a.id).sort().join('|')).slice(0,24),lines=[];let attachments=[];
   for(const a of group){let evidenceFile=a.evidenceFile;if(['edit','hidden'].includes(a.kind)&&!evidenceFile){try{const e=await evidence(a);evidenceFile=e.file;attachments.push(e.path);}catch(e){lines.push('证据记录暂不可用：'+e.message);}}
    if(evidenceFile&&!attachments.some(p=>p.endsWith(evidenceFile)))attachments.push(join(output,evidenceFile));
    a.evidenceFile=evidenceFile;lines.push(`[${a.kind}] ${a.title} · ${a.floor||'?'}楼\n${a.message}\n${a.url}`);
   }
   const full=report('alerts',id,'# 提醒汇总\n\n'+lines.join('\n\n'));
   store.set('alertBatch:'+id,group.map(a=>a.id));
   const caption=`My0511 提醒汇总 · ${group.length} 条\n`+lines.join('\n\n');
   const extra={reply_markup:{inline_keyboard:[[{text:'已读',callback_data:'read:'+id}]]}};
   if(caption.length>3500)extra.document=full.path;
   // A merged notification carries a combined evidence bundle as its single attachment.
   if(attachments.length){const all=report('evidence-bundle',id,'# 改帖证据包\n\n'+full.text+'\n\n'+(await Promise.all(group.filter(a=>['edit','hidden'].includes(a.kind)).map(async a=>{try{return (await evidence(a)).text;}catch(e){return a.url+'\n证据不可用：'+e.message;}}))).join('\n\n---\n\n'));extra.document=all.path;}
   store.set('lastAlertBatch',id);
   notify('alerts:'+id,caption.slice(0,3400)+(caption.length>3400?'\n完整内容见附带记录':''),extra);
   const selected=new Set(group.map(a=>a.id));store.set('serviceAlerts',store.get('serviceAlerts',[]).map(a=>selected.has(a.id)?{...a,delivery:'queued',batch:id,evidenceFile:group.find(x=>x.id===a.id)?.evidenceFile}:a));
   meter.count++;store.set('alertMeter',meter);
  }
 }
 function markRead(batch,profile){const ids=store.get('alertBatch:'+batch);if(!Array.isArray(ids))throw Error('提醒批次不存在');store.enqueue(profile,'markAlertsRead',{ids},7*DAY,'read-'+batch);const set=new Set(ids);store.set('serviceAlerts',store.get('serviceAlerts',[]).map(a=>set.has(a.id)?{...a,read:true}:a));}
 async function daily(time=now()){
  const users=store.get('pluginSettings',{}).watchUsers||[],all=await archives.records(),records=new Map();
  // Deduplicate copies of the same thread/floor, choosing the newest file.
  for(const r of all.sort((a,b)=>(a.capturedAt||a.mtime)-(b.capturedAt||b.mtime)))for(const f of r.floors)records.set(r.tid+':'+f.floor,{r,f:floorDetails(f)});
  let text='# 观察名单日报\n\n统计区间（北京时间）：'+new Date(time-DAY+8*3600000).toISOString().slice(0,16)+' 至 '+new Date(time+8*3600000).toISOString().slice(0,16)+'\n仅统计已采集文件中的发言，不代表论坛全部发言；不推测账号身份。\n',total=0;
  for(const user of users){const hits=[...records.values()].filter(x=>x.f.author===user&&x.f.at!==null&&x.f.at>time-DAY&&x.f.at<=time);total+=hits.length;const alerts=store.get('serviceAlerts',[]).filter(a=>a.author===user&&a.at>time-DAY&&a.at<=time);text+=`\n## ${user}\n\n发言 ${hits.length} 楼，涉及 ${new Set(hits.map(x=>x.r.tid)).size} 个帖子；改楼提醒 ${alerts.filter(a=>a.kind==='edit').length} 条，不可见提醒 ${alerts.filter(a=>a.kind==='hidden').length} 条。\n`;
   const counts=new Map();for(const x of hits)counts.set(x.r.tid,{title:x.r.title,url:x.r.url,count:(counts.get(x.r.tid)?.count||0)+1});for(const x of counts.values())text+=`\n- ${x.title}：${x.count} 楼 · ${x.url}`;
   text+='\n\n原话摘录（按时间顺序取前 5 楼，最多 300 字，截断处标明）：\n';for(const {r,f} of hits.sort((a,b)=>a.f.at-b.f.at).slice(0,5))text+=`\n${r.title} · ${f.floor}楼 · ${r.url}\n\n`+f.quote.slice(0,300).split('\n').map(x=>'> '+x).join('\n')+(f.quote.length>300?'\n\n（摘录截断）':'')+'\n';
  }
  const result=report('daily',bj(time).day,text+(users.length?'':'\n尚未设置关注的 ID。'));
  notify('daily:'+bj(time).day,`观察名单日报 ${bj(time).day}\n${users.length} 个关注 ID，在本机存档中共 ${total} 楼。完整记录见附件。`,{document:result.path});return {...result,total};
 }
 async function summary(tid){
  const r=await archives.byTid(tid);let chunks=[],part='';for(const f of r.floors){const text=floorDetails(f).current;for(let i=0;i<text.length;i+=11000){const bit=`\n【${f.floor}楼 ${f.heading.slice(0,300)}${i?'（续）':''}】\n`+text.slice(i,i+11000);if(part.length+bit.length>12000){if(part)chunks.push(part);part='';}part+=bit;}}if(part)chunks.push(part);if(!chunks.length)throw Error('存档没有可摘要的正文');
  let notes=[];for(let i=0;i<chunks.length;i++){const key='summaryChunk:'+digest(r.tid+chunks[i]);let note=store.get(key);if(!note){try{note=await ai(chunks[i],'概括本段主要观点、各方立场和关键楼层，保留楼号，不编造未出现的观点。');store.set(key,note);}catch(e){const partial=report('summary-partial',tid,`# 长帖摘要未完成\n\n已完成 ${notes.length}/${chunks.length} 段。${e.message}\n下次会复用已完成段落，不重复调用。\n\n`+notes.join('\n\n'));throw Error(e.message+'；进度已保存为 '+partial.file);}}notes.push(note);}
  // Hierarchical reduction keeps every chunk represented and each request bounded.
  let final;try{let merged=notes.join('\n');while(merged.length>18000){const next=[];for(let i=0;i<merged.length;i+=18000){const input=merged.slice(i,i+18000),key='summaryReduce:'+digest(input);let note=store.get(key);if(!note){note=await ai(input,'压缩合并摘要，保留分歧和关键楼号，不增加原文之外的事实。');store.set(key,note);}next.push(note);}const reduced=next.join('\n');if(reduced.length>=merged.length)throw Error('摘要压缩未收敛，请稍后重试');merged=reduced;}
  final=notes.length===1?merged:await ai(merged,'综合为主要观点、各方立场、关键楼层三部分，区分事实主张与已核实事实，不编造楼号。');
  }catch(e){const partial=report('summary-partial',tid,'# 长帖摘要待合并\n\n'+e.message+'\n分段已保存，下次请求会复用。\n\n'+notes.join('\n\n'));throw Error(e.message+'；进度已保存为 '+partial.file);}
  const result=report('summary',tid,'# '+r.title+' · 长帖摘要\n\n'+r.url+'\n\n共 '+r.floors.length+' 个已存楼层，分 '+chunks.length+' 段；AI 归纳仅供核对，以原楼为准。\n\n'+final);notify('summary:'+digest(result.text).slice(0,24),'长帖摘要 · '+r.title+'\n'+r.url+'\n'+final.slice(0,700),{document:result.path});return result;
 }
 let busy=false;
 async function tick(){if(busy)return;busy=true;try{await pushAlerts();const c=cfg(),time=now(),day=bj(time).day;if(store.get('pluginSettings')&&c.dailyEnabled&&bj(time).minute>=minutes(c.dailyTime)&&store.get('dailyDay')!==day){await daily(time);store.set('dailyDay',day);}const jobs=store.get('summaryJobs',[]),job=jobs.find(x=>x.state==='pending');if(job){job.state='running';store.set('summaryJobs',jobs);try{await summary(job.tid);job.state='done';}catch(e){job.state='failed';job.error=e.message;notify('summary-error:'+job.id,e.message);}store.set('summaryJobs',store.get('summaryJobs',[]).map(x=>x.id===job.id?job:x));}}catch(e){store.set('serviceErrors',[...store.get('serviceErrors',[]),{at:now(),error:e.message}].slice(-30));}finally{busy=false;}}
 return {status,save,ingest,ingestContext,evidence,pushAlerts,markRead,daily,summary,tick};
}
