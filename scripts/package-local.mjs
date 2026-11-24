// 本机打包：不依赖 git，不跑测试，只做「校验 → 复制 → 打补丁 → 写清单」。
// 与 scripts/build.mjs 的产物结构一致，便于在没有 .git 的交接快照里重建 dist/extension。
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,rmSync,cpSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const version='5.0.0-merged.1';
const lock=JSON.parse(readFileSync(join(root,'upstream-lock.json'),'utf8'));
const excludes=new Set(JSON.parse(readFileSync(join(root,'downstream-excludes.json'),'utf8')).exclude);
const patches=['poster.js','api.js','alerts.js','background.js','popup.html','popup.css','popup.js','offscreen.js'];
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const stage=join(root,'dist');

// 1. 完整校验：上游核心必须与锁一致，排除项也要校验（排除不等于放任漂移）
const overrides=new Set(['extension/manifest.json','test/v440.test.mjs']); // 下游改过的测试：退避阶梯 15/30/60
for(const [name,digest] of Object.entries(lock.sha256)){
  if(overrides.has(name)||name.startsWith('extension/icons/'))continue;
  const file=join(root,name);
  if(!existsSync(file))throw Error('缺少上游文件: '+name);
  if(sha(file)!==digest)throw Error('上游漂移: '+name);
}
for(const name of excludes)if(!(name in lock.sha256))throw Error('排除项不在上游锁中: '+name);
for(const name of patches)if(!existsSync(join(root,'patches',name)))throw Error('缺少下游补丁: patches/'+name);

// 2. 复制并排除上游界面
rmSync(stage,{recursive:true,force:true});
mkdirSync(stage,{recursive:true});
cpSync(join(root,'extension'),join(stage,'extension'),{recursive:true});
for(const name of excludes){
  const file=join(stage,name);
  if(!existsSync(file))throw Error('排除目标不存在: '+name);
  rmSync(file);
}

// 3. 下游补丁覆盖（在复制之后，顺序不可颠倒）
const patched={};
for(const name of patches){
  copyFileSync(join(root,'patches',name),join(stage,'extension',name));
  patched['extension/'+name]=sha(join(stage,'extension',name));
}

// 4. 图标与清单
cpSync(join(root,'assets','icons'),join(stage,'extension','icons'),{recursive:true});
const manifest=JSON.parse(readFileSync(join(stage,'extension','manifest.json'),'utf8'));
manifest.name='梦溪·回声';
manifest.description='梦溪·回声：独立 Agent 插件，读帖、AI 回复草稿、Telegram 审核和存档报告。';
manifest.version_name=version;
manifest.key=readFileSync(join(root,'assets','extension-public-key.txt'),'utf8').trim();
manifest.action={...manifest.action,default_title:'梦溪·回声',default_popup:'popup.html'};
// 合并版保留了上游设置页；只有确实没打包时才删掉声明，否则 popup 的「设置」会报 Could not create an options page
if(!existsSync(join(stage,'extension','options.html'))){delete manifest.options_page;delete manifest.options_ui;}
manifest.host_permissions=[...new Set([...(manifest.host_permissions||[]),'http://127.0.0.1:17851/*'])].sort();
writeFileSync(join(stage,'extension','manifest.json'),JSON.stringify(manifest,null,2)+'\n');

// 5. 打包后复核：未打补丁、未排除的核心文件必须与锁一致
for(const [name,digest] of Object.entries(lock.sha256)){
  if(!name.startsWith('extension/')||excludes.has(name)||name in patched||overrides.has(name)||name.startsWith('extension/icons/'))continue;
  if(sha(join(stage,name))!==digest)throw Error('打包后漂移: '+name);
}
// 6. 不允许出现未登记的下游文件
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
for(const file of walk(join(stage,'extension'))){
  const name=relative(stage,file).split('\\').join('/');
  if(name.startsWith('extension/addons/')||name.startsWith('extension/icons/')||name==='extension/manifest.json'||name in patched)continue;
  if(!(name in lock.sha256))throw Error('未登记的下游文件: '+name);
}

const info={
  product:'梦溪·回声',version,upstreamVersion:lock.version||null,
  upstreamFiles:Object.keys(lock.sha256).length,
  excluded:[...excludes].sort(),patched,
  verified:'所有随包发出的上游文件均通过 SHA-256 校验；排除项已在校验后移除',
  builtAt:new Date().toISOString(),
};
writeFileSync(join(stage,'BUILD-INFO.json'),JSON.stringify(info,null,2)+'\n');
console.log(`已生成 dist/extension：上游 ${info.upstreamFiles} 个文件校验通过，排除 ${excludes.size} 个上游界面，打补丁 ${patches.length} 个。`);
