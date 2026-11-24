// 统一测试：把打包产物当作扩展，跑上游 test/ 与下游 test-addons/ 两套。
// 上游测试必须跑在「打过下游补丁」的扩展上，否则退避阶梯、发帖加固这类改动会被判失败。
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dist=join(root,'dist','extension');
const stage=join(tmpdir(),'mengxi-test-'+process.pid);
const run=(files,label)=>{
  if(!files.length){console.log(`（${label} 没有用例）`);return true;}
  console.log(`\n=== ${label}：${files.length} 个文件 ===`);
  try{
    execFileSync(process.execPath,['--test',...files],{cwd:stage,stdio:'inherit'});
    return true;
  }catch{return false;}
};
try{
  mkdirSync(stage,{recursive:true});
  cpSync(dist,join(stage,'extension'),{recursive:true});
  for(const d of ['test','test-addons'])cpSync(join(root,d),join(stage,d),{recursive:true});
  const upstream=readdirSync(join(stage,'test')).filter(f=>f.endsWith('.test.mjs')).map(f=>join('test',f));
  const downstream=readdirSync(join(stage,'test-addons')).filter(f=>f.endsWith('.test.mjs')).map(f=>join('test-addons',f));
  const a=run(upstream,'上游');
  const b=run(downstream,'下游扩展');
  console.log(a&&b?'\n全部通过':'\n有失败用例');
  process.exit(a&&b?0:1);
}finally{rmSync(stage,{recursive:true,force:true});}
