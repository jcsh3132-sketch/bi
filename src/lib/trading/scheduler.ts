import "server-only";
import {botWatchdog} from '@/workflows/watchdog';
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { scheduledBot } from "@/workflows/bot";
import { changeState, needsSupervision, type Mode } from "./store";
export async function launchBot(generation:string,mode:Mode){
 const monitorId=randomUUID();
 await changeState(s=>{if(s.generation===generation){s.monitorId=monitorId;s.monitorAt=Date.now();}},mode);
 try{await start(botWatchdog,[monitorId,mode],{deploymentId:'latest'});}catch(e){await changeState(s=>{if(s.generation===generation){s.nextAt=Date.now()-180000;s.error='예약 감시 시작에 실패했습니다. 시작을 다시 눌러 재시도하세요.';}},mode);throw e;}
 try{const run=await start(scheduledBot,[generation,mode],{deploymentId:"latest"});await changeState(s=>{if(s.generation===generation)s.workflowId=run.runId;},mode);}
 catch(e){await changeState(s=>{if(s.generation===generation){s.warning="실행 예약이 지연되어 감시 작업이 재시도합니다.";s.nextAt=Date.now()-180000;}},mode);throw e;}
}
export async function armRecovery(mode:Mode){
 const generation=await changeState(s=>{s.enabled=false;s.continuous=false;s.autoResumeAt=null;if(!needsSupervision(s))return null;s.generation=randomUUID();s.nextAt=Date.now();s.workflowId=null;return s.generation;},mode);
 if(generation)await launchBot(generation,mode);
 return generation;
}
