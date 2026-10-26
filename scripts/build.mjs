import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,cpSync,rmSync,renameSync,existsSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),version='4.2.5-agent.10',productName='疯狂的梦溪',packageName='CrazyMengxi-'+version;
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:30*1024*1024});
const lock=JSON.parse(readFileSync(join(root,'upstream-lock.json'),'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const files=d=>readdirSync(d,{withFileTypes:true}).flatMap(x=>{const p=join(d,x.name);if(x.isSymbolicLink())throw Error('Symlinks forbidden in package: '+p);return x.isDirectory()?files(p):[p];});
const core=Object.keys(lock.sha256);
for(const name of core)if(sha(readFileSync(join(root,name)))!==lock.sha256[name])throw Error('Upstream drift: '+name);
for(const p of [...files(join(root,'extension')),...files(join(root,'test'))]){const n=relative(root,p).split('\\').join('/');if(!n.startsWith('extension/addons/')&&!core.includes(n))throw Error('Unexpected core file: '+n);}
const stage=join(root,'dist','.stage-'+Date.now()),product=join(root,'dist',packageName);mkdirSync(stage,{recursive:true});
for(const name of ['extension','test','test-addons','docs'])cpSync(join(root,name),join(stage,name),{recursive:true});
mkdirSync(join(stage,'agent'));for(const f of readdirSync(join(root,'agent'))){const src=join(root,'agent',f);if(f==='test')cpSync(src,join(stage,'agent/test'),{recursive:true});else if(lstatSync(src).isFile()&&(/\.(mjs|cmd|command)$/.test(f)||['package.json','README.md'].includes(f)))cpSync(src,join(stage,'agent',f));}
cpSync(join(root,'使用说明.md'),join(stage,'使用说明.md'));
const original=JSON.parse(readFileSync(join(root,'extension/manifest.json')));const manifest={...original,name:productName,description:'疯狂的梦溪：独立 Agent 插件，读帖、Kimi 回复草稿、Telegram 审核和存档报告。',version:lock.version,version_name:version,key:readFileSync(join(root,'assets/extension-public-key.txt'),'utf8').trim(),action:{...original.action,default_title:productName,default_popup:'addons/launcher.html'},host_permissions:[...new Set([...original.host_permissions,'http://127.0.0.1:17851/*'])]};
writeFileSync(join(stage,'extension/manifest.json'),JSON.stringify(manifest,null,2)+'\n');cpSync(join(root,'assets/icons'),join(stage,'extension/icons'),{recursive:true});
for(const name of core){if(name==='extension/manifest.json'||name.startsWith('extension/icons/'))continue;if(sha(readFileSync(join(stage,name)))!==lock.sha256[name])throw Error('Packaged core drift: '+name);}
const tests=[...files(join(stage,'test')),...files(join(stage,'test-addons')),...files(join(stage,'agent/test'))].filter(x=>x.endsWith('.test.mjs'));
const testTmp=join(stage,'.test-tmp');mkdirSync(testTmp);
try{execFileSync(process.execPath,['--test',...tests],{cwd:stage,stdio:'inherit',env:{...process.env,TMPDIR:testTmp,TMP:testTmp,TEMP:testTmp}});}finally{rmSync(testTmp,{recursive:true,force:true});}
const info={productName,version,upstreamVersion:lock.version,upstreamTag:lock.tag,upstreamBaseCommit:lock.baseCommit,upstreamSnapshotHash:sha(readFileSync(join(root,'upstream-lock.json'))),downstreamCommit:git('rev-parse','HEAD').toString().trim(),coreIntegrity:'SHA-256 verified working-tree snapshot; manifest and product icons are packaging overrides',builtAt:new Date().toISOString()};
writeFileSync(join(stage,'BUILD-INFO.json'),JSON.stringify(info,null,2));
cpSync(join(root,'upstream-lock.json'),join(stage,'upstream-lock.json'));
cpSync(join(root,'docs/疯狂的梦溪_版本说明.md'),join(stage,'版本说明.md'));
if(existsSync(product)){if(!existsSync(join(product,'BUILD-INFO.json')))throw Error('Refusing to replace unknown output');rmSync(product,{recursive:true});}renameSync(stage,product);
// Dependency-free ZIP (stored entries, UTF-8 names), suitable for macOS/Windows.
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
let offset=0,records=[],central=[];const basename=packageName;
for(const file of files(product)){const data=readFileSync(file),name=Buffer.from(basename+'/'+relative(product,file).split('\\').join('/')),sum=crc(data),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(sum,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);records.push(h,name,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(sum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((lstatSync(file).mode&0xffff)<<16)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);writeFileSync(product+'.zip',Buffer.concat([...records,directory,end]));console.log('Built '+product+'.zip');
