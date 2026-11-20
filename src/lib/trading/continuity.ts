import type {BotState} from './store.ts';
export function hasExposure(s:BotState){return s.mode!=='paper'&&!!(s.position||s.pending||s.entryIntent||s.closeIntent);}
export function needsSchedule(s:BotState){return s.enabled||hasExposure(s)||!!(s.continuous&&s.autoResumeAt);}
export function resumeIfReady(s:BotState,now:number){
 if(s.continuous&&s.autoResumeAt&&now>=s.autoResumeAt&&!hasExposure(s)){
  s.enabled=true;s.autoResumeAt=null;s.error=null;s.warning='복구 후 대기를 마쳤습니다. 계정 상태와 새 진입 조건을 다시 확인합니다.';
 }
}
export function claimStalled(s:BotState,monitorId:string,now:number,generation:string){
 if(s.monitorId!==monitorId||!needsSchedule(s))return null;
 s.monitorAt=now;
 if(s.executionLease&&s.executionLease.until>now)return null;
 if(s.nextAt!==null&&now-s.nextAt<180000)return null;
 s.generation=generation;s.nextAt=now;s.workflowId=null;
 return generation;
}
