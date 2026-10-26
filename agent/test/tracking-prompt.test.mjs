import test from 'node:test';import assert from 'node:assert/strict';import {trackingPrompt} from '../tracking-prompt.mjs';
test('tracking stance policy fits API prompt budget and uses evidence',()=>{assert.ok(trackingPrompt.length<=500);assert.match(trackingPrompt,/myStatements/);assert.match(trackingPrompt,/不默认赞同/);assert.match(trackingPrompt,/立场证据不足/);});
