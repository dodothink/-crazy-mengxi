import test from 'node:test';import assert from 'node:assert/strict';import {readKimiStream} from '../kimi-stream.mjs';import {completionText} from '../ai-config.mjs';
const event=x=>'data: '+JSON.stringify(x)+'\r\n\r\n';
const response=text=>({body:(async function*(){const b=Buffer.from(text);for(let i=0;i<b.length;i+=3)yield b.subarray(i,i+3);})()});
test('stream assembles split UTF8, ignores reasoning and retains usage',async()=>{const r=await readKimiStream(response(event({choices:[{delta:{reasoning_content:'秘密推理'}}]})+event({choices:[{delta:{content:'摘要正文'}}]})+event({choices:[{finish_reason:'stop',delta:{}}]})+event({choices:[],usage:{total_tokens:90}})+'data: [DONE]\n\n'));assert.equal(completionText(r),'摘要正文');assert.equal(r.usage.total_tokens,90);});
test('broken streams never produce partial summaries',async()=>{await assert.rejects(readKimiStream(response(event({choices:[{delta:{content:'半段'}}]}))),/中断/);});
test('token-limit output remains rejected',async()=>{const r=await readKimiStream(response(event({choices:[{delta:{content:'半段'},finish_reason:'length'}]})+'data: [DONE]\n\n'));assert.throws(()=>completionText(r),/上限/);});
