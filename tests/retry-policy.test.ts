import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleFailure} from '../src/lib/trading/retry-policy.ts';
import type {BotState} from '../src/lib/trading/store.ts';
function state(){return {generation:'g',mode:'testnet',enabled:true,error:null,warning:null,position:null,pending:null,nextAt:0} as BotState;}
test('flat-account failures retain start intent and retry repeatedly without an order',()=>{const s=state();for(let i=0;i<20;i++){assert.equal(scheduleFailure(s,'g',i*60000),(i+1)*60000);assert.equal(s.enabled,true);assert.equal(s.error,null);assert.equal(s.pending,null);}});
test('uncertain entry is supervised with new entries disabled',()=>{const s=state();s.pending='entry';assert.equal(scheduleFailure(s,'g',100),30100);assert.equal(s.enabled,false);assert.ok(s.error);assert.equal(s.pending,'entry');});
test('manual stop and replaced generations cannot be restarted by retry',()=>{const s=state();s.enabled=false;assert.equal(scheduleFailure(s,'g',100),null);assert.equal(s.enabled,false);const before=JSON.stringify(s);assert.equal(scheduleFailure(s,'old',200),null);assert.equal(JSON.stringify(s),before);});
test('emergency close stop remains stopped after exposure is gone',()=>{const s=state();s.enabled=false;s.error='close';assert.equal(scheduleFailure(s,'g',100),null);assert.equal(s.enabled,false);});
test('temporary read timeout with exposure preserves start intent and retries supervision',()=>{const s=state();s.position={side:'LONG',entry:100,stop:99,target:102,quantity:1,opened:1};assert.equal(scheduleFailure(s,'g',100,new DOMException('timeout','TimeoutError')),30100);assert.equal(s.enabled,true);assert.equal(s.error,null);});
test('invalid credentials or unknown protection failure cannot resume exposure automatically',()=>{const s=state();s.pending='entry';scheduleFailure(s,'g',100,Object.assign(new Error('rejected'),{code:-2015}));assert.equal(s.enabled,false);assert.ok(s.error);});
