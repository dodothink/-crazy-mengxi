// 上游一致性校验：随时可跑，不需要 git、不修改任何文件。
// 用法：node scripts/verify-upstream.mjs
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const lock=JSON.parse(readFileSync(join(root,'upstream-lock.json'),'utf8'));
const excludes=new Set(JSON.parse(readFileSync(join(root,'downstream-excludes.json'),'utf8')).exclude);
const patches=new Set(['extension/poster.js','extension/api.js','extension/alerts.js','extension/background.js','extension/popup.html','extension/popup.css','extension/popup.js','extension/offscreen.js']);
// manifest 与图标是明确的下游覆盖，不参与上游一致性比对
const overrides=new Set(['extension/manifest.json','test/v440.test.mjs']); // 下游改过的测试：退避阶梯 15/30/60
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

const drift=[],missing=[],excluded=[],patched=[];
for(const [name,digest] of Object.entries(lock.sha256)){
  const file=join(root,name);
  if(!existsSync(file)){missing.push(name);continue;}
  if(overrides.has(name)||name.startsWith('extension/icons/')){continue;}
  if(sha(file)!==digest){drift.push(name);continue;}
  if(excludes.has(name))excluded.push(name);
  else if(patches.has(name))patched.push(name);
}
for(const name of excludes)if(!(name in lock.sha256))drift.push('排除清单中的未知文件: '+name);

const total=Object.keys(lock.sha256).length;
console.log(`上游核心文件：${total} 个`);
console.log(`  一致随包：${total-excluded.length-patched.length-drift.length-missing.length} 个`);
console.log(`  排除（上游界面）：${excluded.length} 个`);
console.log(`  下游补丁覆盖：${patched.length} 个 —— ${[...patched].join(', ')}`);
if(missing.length)console.log(`  缺失：${missing.length} 个 —— ${missing.join(', ')}`);
if(drift.length)console.log(`  漂移：${drift.length} 个 —— ${drift.join(', ')}`);
if(missing.length||drift.length){console.error('校验失败：源码与上游锁不一致');process.exit(1);}
console.log('校验通过。');
