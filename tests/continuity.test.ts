import test from 'node:test';
import assert from 'node:assert/strict';
import {claimStalled,needsSchedule,resumeIfReady} from '../src/lib/trading/continuity.ts';
import {scheduleFailure} from '../src/lib/trading/retry-policy.ts';
import type {BotState} from '../src/lib/trading/store.ts';
const state=()=>({mode:'testnet',enabled:true,continuous:true,generation:'old',monitorId:'m',nextAt:1000,executionLease:null,position:null,pending:null} as BotState);
test('watchdog claims overdue work once without enabling stopped bot or duplicating live lease',()=>{
 const s=state();assert.equal(claimStalled(s,'wrong',200000,'g'),null);assert.equal(claimStalled(s,'m',100000,'g'),null);
 s.executionLease={owner:'writer',until:400000};assert.equal(claimStalled(s,'m',200000,'g'),null);s.executionLease=null;
 assert.equal(claimStalled(s,'m',200000,'g'),'g');assert.equal(claimStalled(s,'m',200001,'duplicate'),null);assert.equal(s.generation,'g');
 s.enabled=false;s.nextAt=null;assert.equal(claimStalled(s,'m',500000,'restart'),null);
});
test('recovery waits for flat settlement and cooldown, never overrides manual stop',()=>{
 const s=state();s.enabled=false;s.autoResumeAt=1000;s.pending='unresolved';resumeIfReady(s,2000);assert.equal(s.enabled,false);
 s.pending=null;resumeIfReady(s,999);assert.equal(s.enabled,false);assert.equal(needsSchedule(s),true);
 resumeIfReady(s,1000);assert.equal(s.enabled,true);assert.equal(s.autoResumeAt,null);
 s.enabled=false;s.continuous=false;s.autoResumeAt=1000;resumeIfReady(s,3000);assert.equal(s.enabled,false);assert.equal(needsSchedule(s),false);
});
test('flat recovery cooldown survives retry without losing its scheduled wakeup',()=>{
 const s=state();s.enabled=false;s.autoResumeAt=3600000;assert.equal(scheduleFailure(s,'old',100),60100);assert.equal(s.enabled,false);
});
