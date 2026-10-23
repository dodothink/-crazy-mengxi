const byId=id=>document.getElementById(id);
byId('workbench').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('addons/workbench.html')});
byId('tasks').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('control.html')});
byId('collect').onclick=()=>{const frame=byId('collection'),open=frame.hidden;if(open&&!frame.getAttribute('src'))frame.src=chrome.runtime.getURL('popup.html');frame.hidden=!open;byId('collect').setAttribute('aria-expanded',String(open));};
chrome.runtime.sendMessage({type:'ADDON_STATUS'}).then(s=>{if(!s?.ok)throw Error(s?.error||'扩展后台未响应');const online=s.agentConnectedAt&&Date.now()-s.agentConnectedAt<90000;byId('connection').textContent=online?'Agent 已连接 · 可以开始读帖':'Agent 尚未连接\n打开 AI 工作台，输入本机配对码';}).catch(e=>{byId('connection').textContent=e.message;});
