import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {changeState,getState} from '../src/lib/trading/store.ts';
import {recoverEntry,superviseLocked} from '../src/lib/trading/recovery.ts';
import {BinanceError} from '../src/lib/trading/binance.ts';
import type {Exchange} from '../src/lib/trading/execution-lock.ts';
import {withExecution} from '../src/lib/trading/execution-lock.ts';
import {plan,plannedRisk} from '../src/lib/trading/strategy.ts';
import {leverageIsSafe,liquidationIsSafe} from '../src/lib/trading/risk.ts';
import {paperCycle} from '../src/lib/trading/paper.ts';
process.env.LOCAL_DATABASE_PATH=`.local/recovery-${randomUUID()}.db`;
const opened=Date.now()-300000,p={side:'LONG' as const,entry:100,quantity:2,stop:99,target:102,opened,orderId:42};
async function seed(intent=true){await changeState(s=>{s.enabled=true;s.position=intent?null:{...p};s.pending=intent?'bi-entry-test':null;s.entryIntent=intent?{clientId:'bi-entry-test',plan:p,submittedAt:opened,requestTimestamp:opened,lastSubmissionAt:opened,riskBudget:5}:null;s.closeIntent=null;s.executionLease=null;s.error=null;s.trades=intent?[]:[{id:1,side:'LONG',status:'OPEN',entryTime:new Date(opened).toISOString(),exitTime:null,entry:100,exit:null,pnl:null,result:null}];},'testnet');}
function mock(protectedPosition:boolean){let flat=false;const writes:{path:string;method:string;params:any}[]=[];
 const fn=async(path:string,method='GET',params:any={})=>{
 if(method!=='GET')writes.push({path,method,params});
 if(path.endsWith('/order')&&method==='POST'){assert.equal(params.reduceOnly,'true');flat=true;return {};}
 if(path.endsWith('/order'))return {symbol:'BTCUSDT',clientOrderId:'bi-entry-test',orderId:42,side:'BUY',positionSide:'BOTH',status:'FILLED',avgPrice:'100',executedQty:'2',time:opened};
 if(path.endsWith('/account'))return {totalWalletBalance:'999',positions:flat?[]:[{symbol:'BTCUSDT',positionAmt:'2',entryPrice:'100'}]};
 if(path.endsWith('/positionRisk'))return [{symbol:'BTCUSDT',positionAmt:'2',liquidationPrice:'80'}];
 if(path.endsWith('/openAlgoOrders'))return protectedPosition?['sl','tp'].map((kind,i)=>({algoId:i+1,clientAlgoId:`bi-${kind}-42`,symbol:'BTCUSDT',side:'SELL',orderType:i?'TAKE_PROFIT_MARKET':'STOP_MARKET',triggerPrice:i?'102':'99',closePosition:true,workingType:'MARK_PRICE'})):[];
 if(path.endsWith('/userTrades'))return [{orderId:42,qty:'2',price:'100',realizedPnl:'0',commission:'.1',commissionAsset:'USDT',time:opened},{orderId:43,qty:'2',price:'99',realizedPnl:'-2',commission:'.099',commissionAsset:'USDT',time:opened+1000}];
 if(path.endsWith('/income'))return [];
 throw Error(`unexpected ${path}`);
 };return {api:Object.assign(fn,{serverTime:()=>Date.now()}) as Exchange,writes};}
test('filled entry after crash is recovered without another entry; intact protection stays open',async()=>{await seed();const {api,writes}=mock(true);await superviseLocked('testnet',api);const s=await getState('testnet');assert.equal(s.position?.orderId,42);assert.equal(s.pending,null);assert.equal(s.entryIntent,null);assert.equal(writes.length,0);assert.equal(s.trades.length,1);});
test('missing protection after crash closes only recovered quantity and records costs',async()=>{await seed();const {api,writes}=mock(false);await superviseLocked('testnet',api);const s=await getState('testnet');assert.equal(writes.length,1);assert.equal(writes[0].params.quantity,'2');assert.equal(s.position,null);assert.equal(s.enabled,false);assert.equal(s.trades[0].status,'CLOSED');assert.ok(Math.abs(s.trades[0].pnl!+2.199)<1e-8);});
test('uncertain entry never submits a duplicate and remains recoverable',async()=>{await seed();let calls=0;const api=Object.assign(async()=>{calls++;throw Error('timeout');},{serverTime:()=>Date.now()}) as Exchange;await assert.rejects(recoverEntry('testnet',api));assert.equal(calls,1);assert.equal((await getState('testnet')).pending,'bi-entry-test');});
test('only expired new intents confirmed absent and flat can be cleared',async()=>{await seed();const api=Object.assign(async(path:string)=>{if(path.endsWith('/order'))throw new BinanceError(-2013);return {positions:[]};},{serverTime:()=>Date.now()}) as Exchange;await changeState(s=>{s.entryIntent!.submittedAt=Date.now();},'testnet');await assert.rejects(recoverEntry('testnet',api));await changeState(s=>{s.entryIntent!.submittedAt=opened;},'testnet');await recoverEntry('testnet',api);assert.equal((await getState('testnet')).pending,null);await seed();await changeState(s=>{s.entryIntent=null;},'testnet');await assert.rejects(recoverEntry('testnet',api));});
test('active execution lease blocks overlapping order writers before connecting',async()=>{await seed(false);await changeState(s=>{s.executionLease={owner:'other',until:Date.now()+60000};},'testnet');let ran=false;await assert.rejects(withExecution('testnet',async()=>{ran=true;}));assert.equal(ran,false);});
test('auto size includes costs; oversized fixed size and dangerous leverage are rejected',()=>{const c=Array.from({length:300},(_,i)=>({time:i*900000,end:(i+1)*900000-1,open:10000+i,close:10001+i,high:10010+i,low:9990+i,volume:100}));const a=plan(c,'LONG',1000,10300)!;assert.ok(a);assert.ok(plannedRisk(a.entry,a.stop,a.quantity)<=5+1e-8);assert.equal(plan(c,'LONG',1000,10300,{margin:900,leverage:125}),null);const b=[{notionalFloor:0,notionalCap:1000000,initialLeverage:125,maintMarginRatio:.004}];assert.equal(leverageIsSafe(p,10,b),true);assert.equal(leverageIsSafe(p,125,b),false);assert.equal(liquidationIsSafe(p,98.95),false);assert.equal(liquidationIsSafe(p,80),true);});
test('paper entry partial bar checks stop and does not credit earlier high as profit',async()=>{for(const stop of [true,false]){await seed(false);const s=await getState('testnet');s.position={...p,opened:1000};s.lastCandle=-1;const c=Array.from({length:1000},(_,i)=>({time:i*900000,end:(i+1)*900000-1,open:100,close:100,high:i===0?103:100.1+Math.sin(i)*.01,low:i===0&&stop?98:99.9+Math.sin(i)*.01,volume:10}));paperCycle(s,c,100,c.at(-1)!.end+1);assert.equal(s.trades[0].status,stop?'CLOSED':'OPEN');if(stop)assert.equal(s.trades[0].exit,99);}});
