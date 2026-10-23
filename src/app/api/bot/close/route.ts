import {NextRequest} from "next/server";
import {failure,HttpError,json,readBody,requireOwner,sameOrigin} from "@/lib/auth";
import {botMode} from "@/lib/trading/store";
import {forceClose} from "@/lib/trading/force-close";
import {armRecovery} from "@/lib/trading/scheduler";
export const maxDuration=60;
export async function POST(request:NextRequest){try{sameOrigin(request);await requireOwner();const body=await readBody(request);const mode=botMode();if(mode==="paper")throw new HttpError(400,"Demo 또는 실계정 포지션에서 사용할 수 있습니다.");if(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=="production")throw new HttpError(403,"운영 배포에서만 실행할 수 있습니다.");if(!body||body.confirm!=="포지션 종료"||Object.keys(body).some(k=>k!=="confirm"))throw new HttpError(400,"종료 확인 문구를 입력하세요.");try{return json(await forceClose(mode));}catch{try{await armRecovery(mode);}catch{}throw new HttpError(409,"청산 또는 정산을 확인 중입니다. 주문 복구 확인으로 기존 주문의 조회와 예약 상태를 확인하세요.");}}catch(e){return failure(e);}}
