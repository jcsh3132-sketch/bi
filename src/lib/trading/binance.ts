import "server-only";
import { createHmac } from "node:crypto";
import { loadCredential } from "../credentials.ts";
import type { Mode } from "./store";
export async function binance(mode:Exclude<Mode,"paper">){
  if(mode==="mainnet"&&process.env.ALLOW_MAINNET_LIVE!=="true")throw new Error("실주문이 비활성화되어 있습니다.");
  const keys=await loadCredential(mode);if(!keys)throw new Error("API 키가 필요합니다.");
  const base=mode==="testnet"?"https://demo-fapi.binance.com":"https://fapi.binance.com";
  const clock=await fetch(base+"/fapi/v1/time",{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!clock.ok)throw new Error("거래소 시각 조회 실패");
  const offset=Number((await clock.json()).serverTime)-Date.now();
  if(!Number.isFinite(offset)||Math.abs(offset)>60000)throw new Error("시각 차이가 너무 큽니다.");
  return async function request<T>(path:string,method="GET",params:Record<string,string|number>={}):Promise<T>{
    const p=new URLSearchParams(Object.entries({...params,recvWindow:5000,timestamp:Date.now()+offset}).map(([k,v])=>[k,String(v)]));
    const signature=createHmac("sha256",keys.secretKey).update(p.toString()).digest("hex");p.set("signature",signature);
    const res=await fetch(base+path+"?"+p,{method,headers:{"X-MBX-APIKEY":keys.apiKey},cache:"no-store",signal:AbortSignal.timeout(12000)});
    if(!res.ok)throw new Error("거래소 요청 실패");
    return res.json() as Promise<T>;
  };
}
export function roundStep(value:number,step:string){
  const precision=(step.split(".")[1]||"").replace(/0+$/,"").length;
  return (Math.floor((value+Number.EPSILON)/Number(step))*Number(step)).toFixed(precision);
}
