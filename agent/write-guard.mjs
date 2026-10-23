import * as fs from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
let archives=[join(homedir(),'Downloads','My0511存档')];
function canonical(p){p=resolve(String(p));let tail=[];while(!fs.existsSync(p)){const parent=dirname(p);if(parent===p)break;tail.unshift(p.slice(parent.length).replace(/^[/\\]/,''));p=parent;}return resolve(fs.realpathSync(p),...tail);}
const inside=(p,root)=>{const r=relative(root,p);return !r||(!r.startsWith('..'+requireSep())&&r!=='..'&&!isAbsolute(r));};
const requireSep=()=>process.platform==='win32'?'\\':'/';
export function protectArchives(paths){archives=[...new Set([...archives,...paths.map(String)])];}
export function assertWrite(path){const p=canonical(path);for(const root of archives)if(inside(p,canonical(root)))throw Error('拒绝写入共用存档文件夹');if(fs.existsSync(path)&&fs.statSync(path).isFile()&&fs.statSync(path).nlink>1)throw Error('拒绝写入多重硬链接文件');return path;}
export function assertRuntime(root){const p=canonical(root);assertWrite(root);for(const a of archives)if(inside(canonical(a),p))throw Error('运行目录不能包含共用存档目录');}
export const writeFileSync=(p,...args)=>fs.writeFileSync(assertWrite(p),...args);
export const mkdirSync=(p,...args)=>fs.mkdirSync(assertWrite(p),...args);
export const chmodSync=(p,...args)=>fs.chmodSync(assertWrite(p),...args);
export const renameSync=(a,b)=>fs.renameSync(assertWrite(a),assertWrite(b));
