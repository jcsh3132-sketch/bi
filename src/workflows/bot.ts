import { sleep } from "workflow";
import { start } from "workflow/api";
import { changeState, getState, needsSupervision, type Mode, botMode } from "@/lib/trading/store";
import { liveCycle } from "@/lib/trading/live";
import { supervise } from "@/lib/trading/recovery";
import { marketData } from "@/lib/trading/market";
import { paperCycle } from "@/lib/trading/paper";
import { nextTick } from "@/lib/trading/strategy";
import { scheduleFailure } from "@/lib/trading/retry-policy";
async function cycle(generation:string,mode:Mode){
 "use step";
 if(botMode()!==mode)return null;
 const s=await getState(mode);
 if(s.generation!==generation||(!s.enabled&&!needsSupervision(s)))return null;
 try{
  // Reconcile exposure even if candle/ticker services are unavailable.
  if(mode!=="paper"&&needsSupervision(s))await supervise(mode);
  const current=await getState(mode);
  if(current.generation!==generation)return null;
  if(!current.enabled){return changeState(v=>{if(v.generation!==generation)return null;v.nextAt=needsSupervision(v)?nextTick(Date.now()):null;return v.nextAt;},mode);}
  let data;
  try{data=await marketData(mode);}catch{return changeState(v=>{if(v.generation!==generation)return null;v.warning="시장 데이터 연결 실패. 기존 주문 확인을 유지하며 다음 예약에서 재시도합니다.";v.nextAt=needsSupervision(v)?Date.now()+30000:nextTick(Date.now());return v.nextAt;},mode);}
  if(mode!=="paper")return await liveCycle(mode,generation,data);
  return changeState(v=>{if(!v.enabled||v.generation!==generation||v.error)return null;v.warning=null;paperCycle(v,data.candles,data.price,data.serverTime);return v.nextAt;},mode);
 }catch(error){
  return changeState(v=>scheduleFailure(v,generation,Date.now(),error),mode);
 }
}
async function active(generation:string,mode:Mode){"use step";return botMode()===mode&&await changeState(s=>s.generation===generation&&(s.enabled||needsSupervision(s)),mode);}
async function recordRun(generation:string,mode:Mode,id:string){"use step";await changeState(s=>{if(s.generation===generation&&(s.enabled||needsSupervision(s)))s.workflowId=id;},mode);}
export async function scheduledBot(generation:string,mode:Mode){
 "use workflow";
 while(true){
  let next:number|null;
  try{next=await cycle(generation,mode);}catch{await sleep("60s");continue;}
  if(next===null)return;
  await sleep(new Date(next));
  try{if(!await active(generation,mode))return;}catch{await sleep("60s");continue;}
  let run;
  try{run=await start(scheduledBot,[generation,mode],{deploymentId:"latest"});}
  catch{await sleep("60s");continue;}
  // Once the child starts, never launch another child just because bookkeeping fails.
  await recordRun(generation,mode,run.runId);return;
 }
}
