import { sleep } from "workflow";
import { start } from "workflow/api";
import { changeState, type Mode, botMode } from "@/lib/trading/store";
import { liveCycle } from "@/lib/trading/live";
import { marketData } from "@/lib/trading/market";
import { paperCycle } from "@/lib/trading/paper";
import { nextTick } from "@/lib/trading/strategy";

async function cycle(generation:string,mode:Mode){
  "use step";
  // Never return API keys, encrypted keys or account secrets into Workflow logs.
  if(botMode()!==mode)return null;
  const active=await changeState(s=>s.enabled&&s.generation===generation&&!s.error,mode);
  if(!active)return null;
  let data;
  try { data=await marketData(mode); }
  catch {
    return changeState(s=>{if(!s.enabled||s.generation!==generation)return null;s.warning="바이낸스 시장 데이터에 연결하지 못했습니다. 다음 예약에서 재시도합니다.";s.nextAt=nextTick(Date.now());return s.nextAt;},mode);
  }
  try {
    if(mode!=="paper")return await liveCycle(mode,generation,data);
    return await changeState(s=>{
      if(!s.enabled||s.generation!==generation||s.error)return null;
      s.warning=null;
      paperCycle(s,data.candles,data.price,data.serverTime);
      return s.nextAt;
    },mode);
  } catch {
    // Retain the last committed state if reconciliation or accounting fails.
    return changeState(s=>{if(s.generation===generation){s.enabled=false;s.error="거래 상태 또는 보호 주문을 확인하지 못했습니다. 거래소의 포지션·주문을 확인하세요. 미확정 주문은 자동 재전송하지 않습니다.";s.nextAt=null;}return null;},mode);
  }
}
async function active(generation:string,mode:Mode){"use step";return botMode()===mode&&await changeState(s=>s.enabled&&s.generation===generation&&!s.error,mode);}
async function recordRun(generation:string,mode:Mode,id:string){"use step";await changeState(s=>{if(s.generation===generation&&s.enabled)s.workflowId=id;},mode);}
export async function scheduledBot(generation:string,mode:Mode){
  "use workflow";
  const next=await cycle(generation,mode);
  if(next===null)return;
  await sleep(new Date(next));
  if(!await active(generation,mode))return;
  const run=await start(scheduledBot,[generation,mode],{deploymentId:"latest"});
  await recordRun(generation,mode,run.runId);
}
