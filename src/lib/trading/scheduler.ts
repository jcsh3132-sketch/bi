import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { scheduledBot } from "@/workflows/bot";
import { changeState, needsSupervision, type Mode } from "./store";
export async function launchBot(generation:string,mode:Mode){
 try{const run=await start(scheduledBot,[generation,mode],{deploymentId:"latest"});await changeState(s=>{if(s.generation===generation)s.workflowId=run.runId;},mode);}
 catch(e){await changeState(s=>{if(s.generation===generation){s.enabled=false;s.error="클라우드 실행 예약에 실패했습니다. 주문 복구 확인으로 다시 예약하세요.";s.nextAt=null;}},mode);throw e;}
}
export async function armRecovery(mode:Mode){
 const generation=await changeState(s=>{s.enabled=false;if(!needsSupervision(s))return null;s.generation=randomUUID();s.nextAt=Date.now();s.workflowId=null;return s.generation;},mode);
 if(generation)await launchBot(generation,mode);
 return generation;
}
