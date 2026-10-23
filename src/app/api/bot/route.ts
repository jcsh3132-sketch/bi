import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getRun } from "workflow/api";
import { failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { changeState, getState, botMode, needsSupervision } from "@/lib/trading/store";
import { loadCredential } from "@/lib/credentials";
import { demoCheck } from "@/lib/trading/demo-check";
import { launchBot, armRecovery } from "@/lib/trading/scheduler";
export async function GET(){try{await requireOwner();const s=await getState();return json({enabled:s.enabled,nextAt:s.nextAt,lastAt:s.lastAt,error:s.error,warning:s.warning,pending:!!s.pending,monitoring:needsSupervision(s),mode:s.mode});}catch(e){return failure(e);}}
export async function POST(request:NextRequest){
 try{
  sameOrigin(request);await requireOwner();const body=await readBody(request);
  if(!body||!["start","stop","recover"].includes(body.action)||Object.keys(body).some(k=>!["action","confirm"].includes(k)))throw new HttpError(400,"시작·중지·복구를 선택하세요.");
  const mode=botMode();
  if(mode!=="paper"&&process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")throw new HttpError(403,"운영 배포에서만 실행할 수 있습니다.");
  if(body.action==="stop"){
   const s=await getState(mode);
   if(needsSupervision(s)){await armRecovery(mode);return json({message:"신규 진입을 중지했습니다. 기존 포지션의 정산·보호 상태 확인은 계속됩니다."});}
   const id=await changeState(v=>{const id=v.workflowId;v.enabled=false;v.generation=randomUUID();v.nextAt=null;v.workflowId=null;return id;},mode);
   if(id&&mode==="paper"){try{await getRun(id).cancel();}catch{}}
   return json({message:"봇의 신규 진입을 중지했습니다."});
  }
  if(mode!=="paper"&&!await loadCredential(mode))throw new HttpError(400,"해당 계정의 API 키를 먼저 저장하세요.");
  if(body.action==="recover"){
   if(!await armRecovery(mode))return json({message:"확인할 미확정 주문이나 봇 포지션이 없습니다."});
   return json({message:"신규 진입을 중지하고 기존 주문 복구를 예약했습니다. 보호 주문이 없으면 포지션 종료를 진행합니다."});
  }
  if(mode!=="paper"){
   if(body.confirm!==(mode==="mainnet"?"실거래 시작":"테스트 거래 시작"))throw new HttpError(400,"거래 시작 확인 문구를 입력하세요.");
   const current=await getState(mode);
   if(current.pending||current.entryIntent||current.closeIntent){await armRecovery(mode);return json({message:"미확정 주문이 있어 신규 진입 대신 복구를 예약했습니다. 복구 완료 후 봇 시작을 눌러주세요."});}
   if(mode==="testnet"&&!current.position){const check=await demoCheck();if(check.multiAssets||check.hedgeMode||check.positions||check.openOrders||check.algoOrders)throw new HttpError(409,"Demo 계정은 단방향·단일 자산 모드여야 하며 BTCUSDT의 기존 포지션과 주문을 확인해야 합니다.");}
  }
  const generation=await changeState(s=>{if(s.pending||s.entryIntent||s.closeIntent)throw new HttpError(409,"미확정 주문이 있습니다. 주문 복구 확인을 실행하세요.");if(s.enabled&&!s.error&&s.nextAt!==null&&Date.now()-s.nextAt<120000)return null;s.enabled=true;s.error=null;s.warning=null;s.generation=randomUUID();s.nextAt=Date.now();s.workflowId=null;return s.generation;},mode);
  if(!generation)return json({message:"봇이 이미 실행 중입니다."});
  await launchBot(generation,mode);return json({message:"클라우드 봇을 시작했습니다. PC를 꺼도 예약된 실행이 이어집니다."});
 }catch(e){return failure(e);}
}
