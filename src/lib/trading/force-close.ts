import "server-only";
import { withExecution, type LiveMode } from "./execution-lock.ts";
import { recoverEntry, closeLocked } from "./recovery.ts";
import { changeState } from "./store.ts";
export async function forceClose(mode:LiveMode){
 try{return await withExecution(mode,async api=>{await recoverEntry(mode,api);const result=await closeLocked(mode,api);return {message:"포지션을 종료하고 최종 손익을 기록했습니다. 봇 시작을 누르면 다시 실행됩니다.",pnl:result.pnl};});}
 catch{await changeState(s=>{s.enabled=false;s.error="주문 또는 청산 확인 중입니다. 복구 확인으로 기존 주문을 조회하세요. 상태가 불명확한 주문은 재전송하지 않습니다.";},mode);throw Error("청산 확인 필요");}
}
