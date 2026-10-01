import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { start, getRun } from "workflow/api";
import { failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { changeState, getState, botMode } from "@/lib/trading/store";
import { loadCredential } from "@/lib/credentials";
import { scheduledBot } from "@/workflows/bot";
export async function GET(){try{await requireOwner();const s=await getState();return json({enabled:s.enabled,nextAt:s.nextAt,lastAt:s.lastAt,error:s.error,warning:s.warning,pending:!!s.pending,mode:s.mode});}catch(e){return failure(e);}}
export async function POST(request:NextRequest){
  try {
    sameOrigin(request);await requireOwner();const body=await readBody(request);
    if(!body||!["start","stop"].includes(body.action)||Object.keys(body).some(k=>!["action","confirm"].includes(k)))throw new HttpError(400,"시작 또는 중지를 선택하세요.");
    const mode=botMode();
    if(body.action==="stop"){
      const id=await changeState(s=>{const id=s.workflowId;s.enabled=false;s.generation=randomUUID();s.nextAt=null;s.workflowId=null;return id;});
      // Generation fencing is authoritative even if cancellation is unavailable.
      if(id&&mode==="paper"){try{await getRun(id).cancel();}catch{}}
      return json({message:"새 실행을 중지했습니다. 이미 시작된 주문의 보호 설정은 마무리됩니다. 보유 포지션과 거래소 주문은 그대로 남습니다."});
    }
    if(mode!=="paper"){
      if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")throw new HttpError(403,"운영 배포에서만 주문을 실행할 수 있습니다.");
      if(body.confirm!==(mode==="mainnet"?"실거래 시작":"테스트 거래 시작"))throw new HttpError(400,"거래 시작 확인 문구를 입력하세요.");
      if(!await loadCredential(mode))throw new HttpError(400,"해당 계정의 API 키를 먼저 저장하세요.");
    }
    const generation=await changeState(s=>{if(s.pending)throw new HttpError(409,"미확정 주문이 있습니다. 거래소에서 체결과 보호 주문을 확인한 후 기록을 복구해야 합니다.");if(s.enabled&&!s.error&&s.nextAt!==null&&Date.now()-s.nextAt<120000)return null;s.enabled=true;s.error=null;s.warning=null;s.generation=randomUUID();s.nextAt=Date.now();s.workflowId=null;return s.generation;});
    if(!generation)return json({message:"봇이 이미 실행 중입니다."});
    try {
      const run=await start(scheduledBot,[generation,mode]);
      await changeState(s=>{if(s.generation===generation&&s.enabled&&!s.workflowId)s.workflowId=run.runId;});
      return json({message:"클라우드 봇을 시작했습니다. PC를 꺼도 예약된 실행이 이어집니다."});
    } catch(e){await changeState(s=>{if(s.generation===generation){s.enabled=false;s.error="클라우드 실행 예약에 실패했습니다.";s.nextAt=null;}});throw e;}
  } catch(e){return failure(e);}
}
