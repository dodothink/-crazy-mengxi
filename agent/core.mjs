import {assertWrite} from './write-guard.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export const token=()=>randomBytes(32).toString('hex');
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
export class Store {
 constructor(path){if(path!==':memory:'){assertWrite(path);assertWrite(path+'-wal');assertWrite(path+'-shm');}this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,profile TEXT,kind TEXT,payload TEXT,state TEXT,expires INTEGER,result TEXT); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,payload TEXT,state TEXT);`);}
 get(k,f=null){const r=this.db.prepare('SELECT v FROM kv WHERE k=?').get(k);return r?JSON.parse(r.v):f;}
 set(k,v){this.db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(k,JSON.stringify(v));return v;}
 enqueue(profile,kind,payload,ttl=300000,id=token().slice(0,24)){this.db.prepare("INSERT OR IGNORE INTO commands VALUES(?,?,?,?,'pending',?,NULL)").run(id,profile,kind,JSON.stringify(payload),Date.now()+ttl);return id;}
 pending(profile){this.db.prepare("UPDATE commands SET state='expired' WHERE state='pending' AND expires<?").run(Date.now());return this.db.prepare("SELECT * FROM commands WHERE profile=? AND state='pending' ORDER BY rowid LIMIT 10").all(profile).map(x=>({...x,payload:JSON.parse(x.payload)}));}
 ack(profile,id,result){const row=this.db.prepare('SELECT state FROM commands WHERE id=? AND profile=?').get(id,profile);if(!row)return false;this.db.prepare("UPDATE commands SET state='done',payload='{}',result=? WHERE id=? AND profile=? AND state='pending'").run(JSON.stringify(result),id,profile);return row.state==='pending'||row.state==='done';}
 notify(id,payload){this.db.prepare("INSERT OR IGNORE INTO outbox VALUES(?,?,'pending')").run(id,JSON.stringify(payload));}
 transact(fn){if(this.inTransaction)return fn();this.inTransaction=true;this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.inTransaction=false;}}
 close(){this.db.close();}
}
export function draft(value){if(!/^\d+$/.test(String(value.tid))||!/^\d+$/.test(String(value.fid))||typeof value.message!=='string'||!value.message.trim()||value.message.length>3000)throw new Error('草稿无效或超过 3000 字');return {tid:String(value.tid),fid:String(value.fid),message:value.message};}
export function approve(store,id,accepted){return store.transact(()=>{const a=store.get('approval:'+id);if(!a||a.state!=='pending'||a.expires<Date.now())throw new Error('审批已处理或过期');if(a.draftRef&&store.get('activeApproval:'+a.profile+':'+a.draft.tid)!==id)throw new Error('已有更新的草稿');a.state=accepted?'approved':'rejected';store.set('approval:'+id,a);if(accepted)store.enqueue(a.profile,'adopt',{...a.draft,...(a.draftRef?{draftRef:a.draftRef}:{})},300000,'approval-'+id);return a;});}
export function authorizeTelegram(store,msg){const b=store.get('telegramBinding');return !!b&&msg?.chat?.type==='private'&&String(msg.chat.id)===b.chatId&&String(msg.from?.id)===b.userId&&!msg.from?.is_bot;}
