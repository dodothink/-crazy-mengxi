import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store} from '../core.mjs';import {settings} from '../settings.mjs';
test('new user saves private credentials, renews binding, and never receives secrets back',()=>{
 const root=mkdtempSync(join(tmpdir(),'my0511-settings-'))+'/';const db=new Store(root+'test.sqlite');
 try{const s=settings(root,db),key='test-api-key-not-real',tg='123456789:'+ 'x'.repeat(35);assert.equal(s.status().kimiConfigured,false);
 const r=s.save({kimiKey:key,telegramToken:tg});assert.equal(r.kimiConfigured,true);assert.equal(r.telegramConfigured,true);assert.ok(r.bindCode);assert.equal(JSON.stringify(r).includes(key),false);assert.equal(JSON.stringify(r).includes(tg),false);assert.equal(statSync(root+'kimi-key').mode&0o777,0o600);assert.equal(statSync(root+'telegram-token').mode&0o777,0o600);
 s.save({kimiKey:'new-test-api-key',telegramToken:''});assert.equal(readFileSync(root+'telegram-token','utf8'),tg);assert.notEqual(s.renew().bindCode,r.bindCode);
 db.set('telegramBinding',{chatId:'old',userId:'old'});db.enqueue('profile','pause',{},60000,'keep');
 assert.throws(()=>s.save({kimiKey:'must-not-be-written',telegramToken:'999999999:'+ 'y'.repeat(35)}),/不覆盖/);assert.equal(readFileSync(root+'kimi-key','utf8'),'new-test-api-key');assert.equal(db.get('telegramBinding').chatId,'old');assert.equal(db.pending('profile').length,1);assert.equal(s.status().bindCode,null);
 assert.throws(()=>s.save({kimiKey:'invalid\nkey'}),/格式/);assert.throws(()=>s.save({kimiKey:'valid-key-123'},{busy:true}),/稍后/);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
