import {saveSettings} from "../src/lib/trading/settings.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { changeState, getState } from "../src/lib/trading/store.ts";
import { saveCredential, loadCredential } from "../src/lib/credentials.ts";
import { liveCycle } from "../src/lib/trading/live.ts";
import { PERIOD, type Candle } from "../src/lib/trading/strategy.ts";
process.env.LOCAL_DATABASE_PATH=`.local/test-${randomUUID()}.db`;
process.env.CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString("base64");
test("concurrent transactions serialize and rollback failed accounting",async()=>{
  await Promise.all(Array.from({length:20},()=>changeState(s=>{s.balance+=1;})));
  assert.equal((await getState()).balance,1020);
  await assert.rejects(changeState(s=>{s.balance=0;throw new Error("simulated crash");}));
  assert.equal((await getState()).balance,1020);
  assert.equal((await getState("testnet")).balance,0);
});
test("credentials survive reads and remain segregated by environment",async()=>{
  await saveCredential("testnet","a".repeat(64),"b".repeat(64));
  assert.equal((await loadCredential("testnet"))?.apiKey,"a".repeat(64));
  assert.equal(await loadCredential("mainnet"),null);
});
test("exchange timeout after intent never produces a second entry on replay",async()=>{
  await saveSettings({environment:"testnet",entryFilter:"baseline",leverage:2,sizing:"auto",margin:100});
  await saveCredential("testnet","a".repeat(64),"b".repeat(64));
  await changeState(s=>{s.enabled=true;s.generation="timeout-test";},"testnet");
  const boundary=Math.floor(Date.now()/PERIOD)*PERIOD;
  const candles:Candle[]=Array.from({length:500},(_,i)=>{const close=10000+i*2+Math.sin(i*.7)*18;const time=boundary+(i-500)*PERIOD;return {time,end:time+PERIOD-1,open:close-2,high:close+8,low:close-8,close,volume:100};});
  const original=globalThis.fetch;let submissions=0,invalidMark=true;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));let result:unknown={};
    if(url.pathname.endsWith("/premiumIndex"))result={markPrice:String(invalidMark?1:10000+499*2+Math.sin(499*.7)*18)};
    else if(url.pathname.endsWith("/bookTicker"))result={bidPrice:String(10000+499*2+Math.sin(499*.7)*18-.1),askPrice:String(10000+499*2+Math.sin(499*.7)*18+.1)};
    else if(url.pathname.endsWith("/time"))result={serverTime:Date.now()};
    else if(url.pathname.endsWith("/account"))result={totalWalletBalance:"1000",availableBalance:"1000",positions:[]};
    else if(url.pathname.endsWith("/dual"))result={dualSidePosition:false};
    else if(url.pathname.endsWith("/exchangeInfo"))result={symbols:[{symbol:"BTCUSDT",status:"TRADING",filters:[{filterType:"MARKET_LOT_SIZE",stepSize:"0.001",minQty:"0.001",maxQty:"100"},{filterType:"PRICE_FILTER",tickSize:"0.10"}]}]};
    else if(url.pathname.endsWith("/leverageBracket"))result=[{symbol:"BTCUSDT",brackets:[{notionalFloor:0,notionalCap:1000000,initialLeverage:125,maintMarginRatio:.004}]}];
    else if(url.pathname.endsWith("/order")&&init?.method==="POST"){submissions++;throw new Error("simulated timeout");}
    return new Response(JSON.stringify(result),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    const data={candles,price:candles.at(-1)!.close,serverTime:boundary+5000};
    if(invalidMark){await liveCycle("testnet","timeout-test",data);assert.equal(submissions,0);assert.equal((await getState("testnet")).pending,null);invalidMark=false;await changeState(s=>{s.lastCandle=0;},"testnet");}
    await assert.rejects(liveCycle("testnet","timeout-test",data));
    assert.equal(submissions,1);assert.ok((await getState("testnet")).pending);
    await assert.rejects(liveCycle("testnet","timeout-test",data));
    assert.equal(submissions,1);
  }finally{globalThis.fetch=original;}
});

import {scheduleFailure} from '../src/lib/trading/retry-policy.ts';
import {SettlementPending} from '../src/lib/trading/settlement-pending.ts';
test('native exit with delayed fills continues to the next eligible entry without restart',async()=>{
 const boundary=Math.floor(Date.now()/PERIOD)*PERIOD,opened=boundary-2*PERIOD;
 await changeState(s=>{s.enabled=true;s.generation='continuous';s.pending=null;s.entryIntent=null;s.closeIntent=null;s.executionLease=null;s.error=null;s.warning=null;s.losses=0;s.balance=1000;s.dayBalance=1000;s.day=new Date(boundary).toISOString().slice(0,10);s.lastCandle=boundary-2*PERIOD;s.position={side:'LONG',entry:10000,quantity:.02,stop:9900,target:10200,opened,orderId:42};s.trades=[{id:1,side:'LONG',status:'OPEN',entryTime:new Date(opened).toISOString(),exitTime:null,entry:10000,exit:null,pnl:null,result:null}];},'testnet');
 const original=globalThis.fetch;let fillsReady=false,entries=0;let newOrder:any=null;const algos:any[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),params=url.searchParams,path=url.pathname;let result:unknown;
  if(path.endsWith('/premiumIndex'))result={markPrice:String(10000+499*2+Math.sin(499*.7)*18)};
  else if(path.endsWith('/bookTicker'))result={bidPrice:String(10000+499*2+Math.sin(499*.7)*18-.1),askPrice:String(10000+499*2+Math.sin(499*.7)*18+.1)};
  else if(path.endsWith('/time'))result={serverTime:Date.now()};
  else if(path.endsWith('/account'))result={totalWalletBalance:'1000',availableBalance:'1000',positions:newOrder?[{symbol:'BTCUSDT',positionAmt:newOrder.executedQty,entryPrice:newOrder.avgPrice}]:[]};
  else if(path.endsWith('/dual'))result={dualSidePosition:false};
  else if(path.endsWith('/userTrades'))result=fillsReady?[{orderId:42,qty:'.02',price:'10000',realizedPnl:'0',commission:'.1',commissionAsset:'USDT',time:opened},{orderId:43,qty:'.02',price:'10200',realizedPnl:'4',commission:'.102',commissionAsset:'USDT',time:boundary-10000}]:[];
  else if(path.endsWith('/income'))result=[];
  else if(path.endsWith('/openAlgoOrders'))result=algos;
  else if(path.endsWith('/exchangeInfo'))result={symbols:[{symbol:'BTCUSDT',status:'TRADING',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001',maxQty:'100'},{filterType:'PRICE_FILTER',tickSize:'.1'}]}]};
  else if(path.endsWith('/leverageBracket'))result=[{symbol:'BTCUSDT',brackets:[{notionalFloor:0,notionalCap:1000000,initialLeverage:125,maintMarginRatio:.004}]}];
  else if(path.endsWith('/leverage'))result={leverage:2};
  else if(path.endsWith('/order')&&init?.method==='POST'){assert.equal(params.get('reduceOnly'),null);entries++;newOrder={symbol:'BTCUSDT',clientOrderId:params.get('newClientOrderId'),orderId:44,side:params.get('side'),positionSide:'BOTH',status:'FILLED',avgPrice:String(10000+499*2+Math.sin(499*.7)*18),executedQty:params.get('quantity'),time:Date.now()};result=newOrder;}
  else if(path.endsWith('/order'))result=newOrder;
  else if(path.endsWith('/algoOrder')){algos.push({algoId:algos.length+1,clientAlgoId:params.get('clientAlgoId'),symbol:'BTCUSDT',side:params.get('side'),orderType:params.get('type'),triggerPrice:params.get('triggerPrice'),closePosition:true,workingType:'MARK_PRICE'});result={};}
  else if(path.endsWith('/positionRisk'))result=[{symbol:'BTCUSDT',positionAmt:newOrder.executedQty,liquidationPrice:'1000'}];
  else throw Error('Unexpected API '+path);
  return new Response(JSON.stringify(result),{status:200});
 };
 function data(at:number){const candles:Candle[]=Array.from({length:500},(_,i)=>{const close=10000+i*2+Math.sin(i*.7)*18,time=at+(i-500)*PERIOD;return {time,end:time+PERIOD-1,open:close-2,high:close+8,low:close-8,close,volume:100};});return {candles,price:candles.at(-1)!.close,serverTime:at+5000};}
 try{
  let failure:unknown;try{await liveCycle('testnet','continuous',data(boundary));}catch(e){failure=e;}
  assert.ok(failure instanceof SettlementPending);await changeState(s=>{scheduleFailure(s,'continuous',Date.now(),failure);},'testnet');assert.equal(entries,0);
  fillsReady=true;await liveCycle('testnet','continuous',data(boundary));assert.equal(entries,0);assert.equal((await getState('testnet')).enabled,true);assert.equal((await getState('testnet')).trades[0].status,'CLOSED');
  await liveCycle('testnet','continuous',data(boundary+PERIOD));assert.equal(entries,1);const s=await getState('testnet');assert.equal(s.enabled,true);assert.equal(s.position?.orderId,44);assert.equal(s.trades.length,2);assert.equal(s.pending,null);assert.equal(algos.length,2);
 }finally{globalThis.fetch=original;}
});
