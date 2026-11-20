import {sleep} from 'workflow';
import {start} from 'workflow/api';
import {randomUUID} from 'node:crypto';
import {changeState,getState,botMode,type Mode} from '@/lib/trading/store';
import {claimStalled,needsSchedule} from '@/lib/trading/continuity';
import {scheduledBot} from './bot';
async function check(id:string,mode:Mode){
 'use step';
 if(botMode()!==mode)return false;
 const s=await getState(mode);if(s.monitorId!==id||!needsSchedule(s))return false;
 const generation=await changeState(v=>claimStalled(v,id,Date.now(),randomUUID()),mode);
 if(generation){
  const run=await start(scheduledBot,[generation,mode],{deploymentId:'latest'});
  await changeState(v=>{if(v.generation===generation)v.workflowId=run.runId;},mode);
 }
 return true;
}
export async function botWatchdog(id:string,mode:Mode){
 'use workflow';
 while(true){
  await sleep('5m');
  try{if(!await check(id,mode))return;}catch{continue;}
  try{await start(botWatchdog,[id,mode],{deploymentId:'latest'});return;}catch{continue;}
 }
}
