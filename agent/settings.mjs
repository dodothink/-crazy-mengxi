import {readFileSync} from 'node:fs';
import {writeFileSync,renameSync,chmodSync} from './write-guard.mjs';
import {token} from './core.mjs';
export function settings(root,store){
 const secret=name=>{try{return readFileSync(root+name,'utf8').trim();}catch{return '';}};
 function write(name,value){const tmp=root+name+'.tmp';writeFileSync(tmp,value,{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,root+name);}
 function binding(){const b={code:token(),expires:Date.now()+15*60000};store.set('telegramBind',b);write('telegram-bind-code',b.code);return b;}
 function status(){const b=store.get('telegramBind'),bound=!!store.get('telegramBinding');return {ok:true,kimiConfigured:!!secret('kimi-key'),telegramConfigured:!!secret('telegram-token'),telegramBound:bound,bindCode:!bound&&!!secret('telegram-token')&&b?.expires>Date.now()?b.code:null,bindExpires:!bound&&!!secret('telegram-token')&&b?.expires>Date.now()?b.expires:null};}
 function save(input,{busy=false}={}){
  const key=typeof input.kimiKey==='string'?input.kimiKey.trim():'';
  const tg=typeof input.telegramToken==='string'?input.telegramToken.trim():'';
  if(key&&!/^[\x21-\x7e]{8,512}$/.test(key))throw Error('API Key 格式无效，请检查是否完整');
  if(tg&&!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(tg))throw Error('Telegram Token 格式无效，请粘贴 BotFather 提供的完整 Token');
  if(!key&&!tg)throw Error('请填写至少一项；留空表示保留原配置');
  if(busy)throw Error('服务正在处理请求，请稍后再保存');
  const old=secret('telegram-token');
  if(tg&&old&&tg!==old)throw Error('本机已有机器人配置，为保留原绑定和任务，此处不覆盖现有 Token。新用户请使用不含 runtime 的分享包，在自己的本机首次配置。');
  if(tg&&!old){write('telegram-token',tg);binding();}
  if(key)write('kimi-key',key);
  return status();
 }
 function renew(){if(!secret('telegram-token'))throw Error('请先保存 Telegram Token');if(store.get('telegramBinding'))throw Error('机器人已绑定，无需重新绑定');binding();return status();}
 return {status,save,renew};
}
