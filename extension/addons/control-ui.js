document.getElementById('coreControl').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('control.html')});
const $=id=>document.getElementById(id);let latest,threads=[],browserThreads=[],localThreads=[],archiveOffset=0,archiveQuery="";
async function send(m){const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error||'后台没有响应');return r;}
async function refresh(){latest=await send({type:'ADDON_STATUS'});$('status').textContent=`采集：${latest.haltCollect?'暂停':'允许运行'} · 发帖：${latest.haltPost?'暂停':'允许运行'} · 待采 ${latest.queued} 条`;
if(latest.alertGap)$('status').textContent+=' · 有提醒缺失，请核对论坛';
const archive=latest.archiveStatus;if(archive)$('status').textContent+=' · 存档：'+(archive.folderAuthNeeded?'需要重新授权':archive.mode==='folder'?'文件夹模式':'普通下载模式')+'，待写 '+archive.pendingWrites+' 帖';
$('human').hidden=!latest.challenge;$('reason').textContent=latest.challenge?.reason||'';$('connection').textContent=latest.agentConnectedAt?'最近连接：'+new Date(latest.agentConnectedAt).toLocaleString():'尚未连接本地服务';
$('events').textContent=latest.log.map(x=>new Date(x.at).toLocaleTimeString()+' '+x.type+(x.error?' · '+x.error:'')).join('\n')||'暂无事件';
}
async function act(fn){$('notice').textContent='';try{await fn();}catch(e){$('notice').textContent=e.message;}}
$('refresh').onclick=()=>act(refresh);$('pause').onclick=()=>act(async()=>{await send({type:'ADDON_PAUSE',scope:'all'});await refresh();});
for(const [id,scope]of[['resumeCollect','collect'],['resumePost','post']])$(id).onclick=()=>act(async()=>{await send({type:'ADDON_RESUME',scope});await refresh();});
$('verifyChallenge').onclick=()=>act(async()=>{await send({type:'ADDON_VERIFY_CHALLENGE',id:latest.challenge.id});await refresh();});
$('pair').onclick=()=>act(async()=>{await send({type:'ADDON_PAIR',code:$('pairCode').value});$('pairCode').value='';await refresh();await loadSettings();});$('sync').onclick=()=>act(async()=>{await send({type:'ADDON_SYNC'});await refresh();});
let generatedDrafts={short:'',normal:''},generatedFor='';
async function applyGenerated(kind){
 const key=$('threads').value,t=selectedThread(),text=generatedDrafts[kind];
 if(!text||!t||key!==generatedFor)throw new Error('请先为当前帖子生成草稿');
 await send({type:'ADDON_INVALIDATE_APPROVAL',tid:t.tid});
 if($('threads').value!==key)return;
 $('draft').value=text;$('notice').textContent='回复草稿已填入，可直接修改、发送手机审核或填入论坛回复框。';
}
$('useShort').onclick=()=>act(()=>applyGenerated('short'));
$('useNormal').onclick=()=>act(()=>applyGenerated('normal'));
$('generate').onclick=()=>act(async()=>{
 const t=selectedThread();if(!t)throw new Error('先选择已存档帖子');
 const key=$('threads').value,oldDraft=$('draft').value;
 $('generate').disabled=true;
 try{
  const prompt=Drafts.request($('prompt').value);
  const r=await send(t.source==='local'?{type:'ADDON_ARCHIVE_AI',id:t.id,prompt}:{type:'ADDON_AI',tid:t.tid,prompt});
  if($('threads').value!==key){$('notice').textContent='已切换帖子，本次结果没有填入其他帖子的回复框。';return;}
  $('analysis').textContent=r.text.replace(/<reply-short>/gi,'简短回复：').replace(/<reply-normal>/gi,'普通回复：').replace(/<\/reply-(short|normal)>/gi,'');
  generatedDrafts=Drafts.extract(r.text);generatedFor=key;
  $('useShort').hidden=!generatedDrafts.short;$('useNormal').hidden=!generatedDrafts.normal;
  $('draftChoices').hidden=!generatedDrafts.short&&!generatedDrafts.normal;
  const choice=generatedDrafts.normal?'normal':generatedDrafts.short?'short':null;
  if(!choice){$('notice').textContent='AI 未返回可识别的独立草稿，请从上方结果复制所需正文，或重新生成。';return;}
  if(Drafts.canFill(key,$('threads').value,oldDraft,$('draft').value)){
   await send({type:'ADDON_INVALIDATE_APPROVAL',tid:t.tid});
   if(Drafts.canFill(key,$('threads').value,oldDraft,$('draft').value)){$('draft').value=generatedDrafts[choice];$('notice').textContent='已自动填入'+(choice==='normal'?'普通版':'简短版')+'回复，可直接编辑；也可用按钮切换版本。';}
  }else $('notice').textContent='新草稿已生成，保留了你正在编辑的内容。点击下方版本按钮可替换。';
 }finally{$('generate').disabled=false;}
});
function draftMessage(){const t=selectedThread();if(!t||!$('draft').value.trim())throw new Error('请选择帖子并填写草稿');return {tid:String(t.tid),fid:String(t.thread.fid),message:$('draft').value};}
$('adopt').onclick=()=>act(async()=>{await send({type:'ADDON_ADOPT',...draftMessage()});$('notice').textContent='已打开论坛回复页，正在等待页面加载并填入。请在论坛检查正文，最终由你点击发表。';});$('approval').onclick=()=>act(async()=>{await send({type:'ADDON_APPROVAL',...draftMessage()});$('notice').textContent='已发送手机草稿审批。';});
act(async()=>{await refresh();const r=await send({type:'ADDON_LIST'});browserThreads=r.list;renderThreads();await loadArchives().catch(e=>{$('archiveStatus').textContent=e.message;});});

$('draft').addEventListener('input',()=>{if($('threads').value)act(()=>send({type:'ADDON_INVALIDATE_APPROVAL',tid:selectedThread()?.tid}));});

function showSettings(r){
 $('settingsStatus').textContent=`Kimi：${r.kimiConfigured?'已配置':'未配置'} · Telegram：${r.telegramConfigured?(r.telegramBound?'已绑定':'待绑定'):'未配置'}`;
 $('bindingCommand').hidden=$('copyBinding').hidden=!r.bindCode;
 $('bindingCommand').value=r.bindCode?'/start '+r.bindCode:'';
 $('bindingHelp').textContent=r.bindCode?'打开你自己的 Telegram 机器人，发送下方命令。绑定码 15 分钟有效，请勿分享。':r.telegramBound?'已绑定本人私人账号。':'保存 Token 后生成绑定码，或点击「生成新的绑定码」。';
 $('renewBind').disabled=!r.telegramConfigured||r.telegramBound;
}
async function loadSettings(){showSettings(await send({type:'ADDON_SETTINGS',action:'status'}));}
$('loadSettings').onclick=()=>act(loadSettings);
$('renewBind').onclick=()=>act(async()=>showSettings(await send({type:'ADDON_SETTINGS',action:'renew'})));
$('saveSettings').onclick=()=>act(async()=>{
 $('saveSettings').disabled=true;
 try{const r=await send({type:'ADDON_SETTINGS',action:'save',kimiKey:$('kimiKey').value,telegramToken:$('telegramToken').value});$('kimiKey').value='';$('telegramToken').value='';showSettings(r);$('notice').textContent='已保存到本机。配置状态表示已保存，不代表外部认证已验证。';}
 finally{$('saveSettings').disabled=false;}
});
$('copyBinding').onclick=()=>act(async()=>{await navigator.clipboard.writeText($('bindingCommand').value);$('notice').textContent='已复制，在自己的机器人私聊中发送即可。';});
loadSettings().catch(()=>{});

function selectedThread(){return threads.find(t=>(t.source==='local'?'local:'+t.id:String(t.tid))===$('threads').value);}
function renderThreads(){const current=$('threads').value;threads=[...browserThreads,...localThreads];$('threads').replaceChildren(new Option('请选择',''));for(const t of threads){const option=new Option((t.source==='local'?'本机文件 · ':'浏览器 · ')+(t.thread.title||t.tid),t.source==='local'?'local:'+t.id:String(t.tid));$('threads').append(option);}if([...$('threads').options].some(o=>o.value===current))$('threads').value=current;}
async function loadArchives(refresh=false,more=false){const query=$('archiveSearch').value.trim();const offset=more&&query===archiveQuery?archiveOffset:0;const r=await send({type:'ADDON_ARCHIVES',query,offset,refresh});const incoming=r.items.map(t=>({...t,source:'local',thread:{title:t.title,fid:t.fid,url:t.url}}));localThreads=offset?[...localThreads,...incoming]:incoming;archiveQuery=query;archiveOffset=offset+r.items.length;renderThreads();$('archiveStatus').textContent=`本机目录：${r.directory}\n机读存档 v1 · ${r.reader?.coverage==='full'?'覆盖全部':'覆盖部分'} · 已校验 ${r.total} 帖 · 不完整或完整性未知 ${r.reader?.incomplete||0} 帖 · 不可用 ${r.skipped} 帖。匹配 ${r.matched} 帖，已显示 ${localThreads.length} 帖。`;$('moreArchives').hidden=!r.hasMore;}
$('searchArchives').onclick=()=>act(()=>loadArchives());
$('scanArchives').onclick=()=>act(async()=>{$('scanArchives').disabled=true;try{await loadArchives(true);}finally{$('scanArchives').disabled=false;}});
$('moreArchives').onclick=()=>act(()=>loadArchives(false,true));
$('archiveSearch').onkeydown=e=>{if(e.key==='Enter')act(()=>loadArchives());};
$('previewArchive').onclick=()=>act(async()=>{const t=selectedThread();if(!t)throw new Error('请选择帖子');if(t.source!=='local')throw new Error('请选择带“本机文件”标记的存档');const r=await send({type:'ADDON_ARCHIVE',id:t.id});$('archivePreview').textContent=r.text+(r.truncated?'\n\n（预览仅显示前 60000 字符，原文件未修改）':'');$('archivePreview').parentElement.open=true;});
$('threads').addEventListener('change',()=>{generatedDrafts={short:'',normal:''};generatedFor='';$('draftChoices').hidden=true;$('archivePreview').textContent='';$('analysis').textContent='';$('draft').value='';});

let autoState={enabled:false,task:null};
function showAuto(r){
 autoState=r;const t=r.task;
 $('autoReplyToggle').setAttribute('aria-pressed',String(r.enabled));
 $('autoReplyToggle').textContent='5 分钟未审核自动发表 · '+(r.enabled?'已开启':'已关闭');
 const active=t&&['waiting_notice','countdown','claiming','sending'].includes(t.state);
 $('cancelAutoReply').hidden=!active;
 let text=r.enabled?'已开启。新跟踪草稿自动送审，通知送达后计时；手动草稿需点击送审。':'已关闭，所有回复由你在论坛确认发表。';
 if(t){
  const prefix='帖子 '+t.tid+' · ';
  if(t.state==='waiting_notice')text=prefix+'等待手机通知确认送达，尚未开始倒计时';
  else if(t.state==='countdown'){const seconds=Math.max(0,Math.ceil((t.dueAt-Date.now())/1000));text=prefix+(seconds?'剩余 '+Math.floor(seconds/60)+' 分 '+seconds%60+' 秒':'倒计时已结束，正在检查手机审核结果');}
  else if(['claiming','sending'].includes(t.state))text=prefix+'正在检查并尝试发表；已提交的内容无法撤回';
  else if(t.state==='done')text=prefix+'已确认发表成功';
  else text=prefix+(t.reason||'已停止，请查看发帖记录');
 }
 $('autoReplyStatus').textContent=text;
}
async function refreshAuto(){showAuto(await send({type:'ADDON_AUTO_STATUS'}));}
$('autoReplyToggle').onclick=()=>act(async()=>{
 $('autoReplyToggle').disabled=true;
 try{showAuto(await send({type:'ADDON_AUTO_SET',enabled:!autoState.enabled}));}
 finally{$('autoReplyToggle').disabled=false;}
});
$('cancelAutoReply').onclick=()=>act(async()=>showAuto(await send({type:'ADDON_AUTO_CANCEL'})));
$('approval').onclick=()=>act(async()=>{
 $('approval').disabled=true;
 try{const r=await send({type:'ADDON_APPROVAL',...draftMessage()});$('notice').textContent=r.automatic?'审核通知已排队；确认送达后开始 5 分钟倒计时。':'手机审核已排队，仅采用草稿，不自动发表。';await refreshAuto();}
 finally{$('approval').disabled=false;}
});
refreshAuto().catch(()=>{});
setInterval(()=>{if(!document.hidden)refreshAuto().catch(()=>{$('autoReplyStatus').textContent='无法读取任务状态，请重新打开工作台；需要时暂停发帖。';});},1000);
