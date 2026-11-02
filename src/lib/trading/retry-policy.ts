import type {BotState} from './store.ts';
export function scheduleFailure(s:BotState,generation:string,now:number,error?:unknown){
 if(s.generation!==generation)return null;
 const exposure=s.mode!=='paper'&&!!(s.position||s.pending||s.entryIntent||s.closeIntent);
 const transient=error instanceof Error&&(["TypeError","TimeoutError","AbortError"].includes(error.name)||[0,-1000,-1001,-1003,-1006,-1007,-1008,-1021].includes(Number((error as Error & {code?:number}).code)));
 if(exposure&&!transient){s.enabled=false;s.error='신규 진입을 중지하고 기존 주문·보호 상태를 복구 확인 중입니다. 미확정 주문은 재전송하지 않습니다.';}
 else if(s.enabled){s.error=null;s.warning='거래 조건 또는 거래소 연결을 확인하지 못했습니다. 신규 주문 없이 자동 재시도합니다. 열린 포지션은 신규 진입 전에 다시 확인합니다.';}
 s.nextAt=s.enabled||exposure?now+(exposure?30000:60000):null;
 return s.nextAt;
}
