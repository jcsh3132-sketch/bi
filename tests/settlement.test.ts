import test from "node:test";
import assert from "node:assert/strict";
import {settle,type Fill} from "../src/lib/trading/settlement.ts";
const fills:Fill[]=[{orderId:1,qty:"0.01",price:"10000",realizedPnl:"0",commission:"0.05",commissionAsset:"USDT",time:1000},{orderId:2,qty:"0.004",price:"10100",realizedPnl:"0.4",commission:"0.0202",commissionAsset:"USDT",time:2000},{orderId:2,qty:"0.006",price:"10200",realizedPnl:"1.2",commission:"0.0306",commissionAsset:"USDT",time:3000}];
test("closed trade combines partial fills, both fees and signed funding",()=>{const r=settle(fills,1,.01,-.02);assert.ok(Math.abs(r.exit-10160)<1e-8);assert.ok(Math.abs(r.pnl-1.4792)<1e-8);assert.equal(r.grossPnl,1.6);assert.equal(r.exitTime,new Date(3000).toISOString());});
test("incomplete or invalid fills never produce a final profit",()=>{assert.throws(()=>settle(fills.slice(0,2),1,.01));assert.throws(()=>settle(fills.map(f=>({...f,commission:"NaN"})),1,.01));assert.throws(()=>settle(fills.map(f=>({...f,commissionAsset:"BNB"})),1,.01));});
