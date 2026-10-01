import "server-only";
import { createHmac } from "node:crypto";
import { loadCredential, type Environment } from "./credentials.ts";

export function parseUsdtBalance(rows:unknown){
  if(!Array.isArray(rows))throw new Error("Invalid balance response");
  const row=rows.find(r=>r.asset==="USDT");
  if(!row)throw new Error("USDT balance missing");
  const balance=Number(row.balance),availableBalance=Number(row.availableBalance),crossUnPnl=Number(row.crossUnPnl);
  if([row.balance,row.availableBalance,row.crossUnPnl].some(v=>v==null||v==="") || ![balance,availableBalance,crossUnPnl].every(Number.isFinite))throw new Error("Invalid balance values");
  return {balance,availableBalance,crossUnPnl};
}
export async function accountBalance(environment:Environment){
  const keys=await loadCredential(environment);if(!keys)return null;
  const base=environment==="testnet"?"https://demo-fapi.binance.com":"https://fapi.binance.com";
  const clock=await fetch(base+"/fapi/v1/time",{cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!clock.ok)throw new Error("Exchange unavailable");
  const {serverTime}=await clock.json();if(!Number.isSafeInteger(serverTime))throw new Error("Invalid clock");
  const params=new URLSearchParams({timestamp:String(serverTime),recvWindow:"5000"});
  params.set("signature",createHmac("sha256",keys.secretKey).update(params.toString()).digest("hex"));
  const response=await fetch(base+"/fapi/v3/balance?"+params,{headers:{"X-MBX-APIKEY":keys.apiKey},cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("Exchange authentication failed");
  return {environment,...parseUsdtBalance(await response.json()),queriedAt:new Date().toISOString()};
}
