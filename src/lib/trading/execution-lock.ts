import { randomUUID } from "node:crypto";
import { changeState, getState, type Mode } from "./store.ts";
import { binance } from "./binance.ts";
export type LiveMode=Exclude<Mode,"paper">;
export type Exchange=Awaited<ReturnType<typeof binance>>;
export async function withExecution<T>(mode:LiveMode,fn:(api:Exchange)=>Promise<T>):Promise<T>{
 const owner=randomUUID();
 const claimed=await changeState(s=>{if(s.executionLease&&s.executionLease.until>Date.now())return false;s.executionLease={owner,until:Date.now()+300000};return true;},mode);
 if(!claimed)throw Error("다른 주문 확인이 진행 중입니다.");
 async function guard(){await changeState(s=>{if(s.executionLease?.owner!==owner||s.executionLease.until<=Date.now())throw Error("주문 실행 권한이 만료되었습니다.");s.executionLease.until=Date.now()+300000;},mode);}
 try{return await fn(await binance(mode,false,guard));}
 finally{await changeState(s=>{if(s.executionLease?.owner===owner)s.executionLease=null;},mode);}
}
export async function ownsPosition(mode:LiveMode,orderId:number){return (await getState(mode)).position?.orderId===orderId;}
