import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {saveCredential} from "../src/lib/credentials.ts";
import {changeState,getState} from "../src/lib/trading/store.ts";
import {forceClose} from "../src/lib/trading/force-close.ts";
process.env.LOCAL_DATABASE_PATH=`.local/close-${randomUUID()}.db`;
process.env.CREDENTIAL_ENCRYPTION_KEY=randomBytes(32).toString("base64");
async function seed(){await saveCredential("testnet","a".repeat(64),"b".repeat(64));await changeState(s=>{s.enabled=true;s.pending=null;s.error=null;s.position={side:"LONG",entry:10000,stop:9900,target:10200,quantity:.01,opened:1000,orderId:1};s.trades=[{id:1,side:"LONG",status:"OPEN",entryTime:new Date(1000).toISOString(),exitTime:null,entry:10000,exit:null,pnl:null,result:null}];},"testnet");}
test("market close stops bot, settles costs, clears intent and only cancels bot protections",async()=>{
  await seed();const original=globalThis.fetch;let flat=false,posts=0;const deleted:number[]=[];
  globalThis.fetch=async(input,init)=>{const u=new URL(String(input));let body:unknown={};
    if(u.pathname.endsWith("/time"))body={serverTime:Date.now()};
    else if(u.pathname.endsWith("/account"))body={totalWalletBalance:"1000.9",positions:flat?[]:[{symbol:"BTCUSDT",positionAmt:"0.01"}]};
    else if(u.pathname.endsWith("/order")){assert.equal(init?.method,"POST");assert.equal(u.searchParams.get("reduceOnly"),"true");posts++;flat=true;body={status:"FILLED"};}
    else if(u.pathname.endsWith("/userTrades"))body=[{orderId:1,qty:".01",price:"10000",realizedPnl:"0",commission:".05",commissionAsset:"USDT",time:1000},{orderId:2,qty:".01",price:"10100",realizedPnl:"1",commission:".0505",commissionAsset:"USDT",time:2000}];
    else if(u.pathname.endsWith("/income"))body=[];
    else if(u.pathname.endsWith("/openAlgoOrders"))body=[{algoId:11,clientAlgoId:"bi-sl-1"},{algoId:12,clientAlgoId:"bi-tp-1"},{algoId:13,clientAlgoId:"manual-order"}];
    else if(u.pathname.endsWith("/algoOrder")){assert.equal(init?.method,"DELETE");deleted.push(Number(u.searchParams.get("algoId")));}
    return new Response(JSON.stringify(body));};
  try{await forceClose("testnet");const s=await getState("testnet");assert.equal(posts,1);assert.equal(s.enabled,false);assert.equal(s.pending,null);assert.equal(s.position,null);assert.equal(s.trades[0].status,"CLOSED");assert.ok(Math.abs(s.trades[0].pnl!-.8995)<1e-8);assert.deepEqual(deleted,[11,12]);}finally{globalThis.fetch=original;}
});
test("an ambiguous close is never submitted twice and blocks new entry until reconciled",async()=>{
  await seed();const original=globalThis.fetch;let posts=0;
  globalThis.fetch=async(input,init)=>{const u=new URL(String(input));if(u.pathname.endsWith("/time"))return new Response(JSON.stringify({serverTime:Date.now()}));if(u.pathname.endsWith("/account"))return new Response(JSON.stringify({totalWalletBalance:"1000",positions:[{symbol:"BTCUSDT",positionAmt:"0.01"}]}));if(init?.method==="POST"){posts++;throw Error("timeout");}throw Error("query unavailable");};
  try{await assert.rejects(forceClose("testnet"));await assert.rejects(forceClose("testnet"));assert.equal(posts,1);const s=await getState("testnet");assert.equal(s.enabled,false);assert.ok(s.pending?.startsWith("bi-close-"));}finally{globalThis.fetch=original;}
});
