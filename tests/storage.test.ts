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
  await saveCredential("testnet","a".repeat(64),"b".repeat(64));
  await changeState(s=>{s.enabled=true;s.generation="timeout-test";},"testnet");
  const boundary=Math.floor(Date.now()/PERIOD)*PERIOD;
  const candles:Candle[]=Array.from({length:500},(_,i)=>{const close=10000+i*2+Math.sin(i*.7)*18;const time=boundary+(i-500)*PERIOD;return {time,end:time+PERIOD-1,open:close-2,high:close+8,low:close-8,close,volume:100};});
  const original=globalThis.fetch;let submissions=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));let result:unknown={};
    if(url.pathname.endsWith("/time"))result={serverTime:Date.now()};
    else if(url.pathname.endsWith("/account"))result={totalWalletBalance:"1000",availableBalance:"1000",positions:[]};
    else if(url.pathname.endsWith("/dual"))result={dualSidePosition:false};
    else if(url.pathname.endsWith("/exchangeInfo"))result={symbols:[{symbol:"BTCUSDT",status:"TRADING",filters:[{filterType:"MARKET_LOT_SIZE",stepSize:"0.001",minQty:"0.001",maxQty:"100"},{filterType:"PRICE_FILTER",tickSize:"0.10"}]}]};
    else if(url.pathname.endsWith("/order")&&init?.method==="POST"){submissions++;throw new Error("simulated timeout");}
    return new Response(JSON.stringify(result),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    const data={candles,price:candles.at(-1)!.close,serverTime:boundary+5000};
    await assert.rejects(liveCycle("testnet","timeout-test",data));
    assert.equal(submissions,1);assert.ok((await getState("testnet")).pending);
    await assert.rejects(liveCycle("testnet","timeout-test",data));
    assert.equal(submissions,1);
  }finally{globalThis.fetch=original;}
});
