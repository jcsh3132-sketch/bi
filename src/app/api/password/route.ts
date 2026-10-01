import { NextRequest } from "next/server";
import { COOKIE, failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { changeOwnerPassword } from "@/lib/owner-password";
export async function POST(request:NextRequest){
  try {
    sameOrigin(request);await requireOwner();
    if(!await rateLimit("password:change",5))throw new HttpError(429,"10분 뒤 다시 시도하세요.");
    const body=await readBody(request,4096);
    if(!body || Object.keys(body).some(k=>!["currentPassword","newPassword","confirmPassword"].includes(k)) || typeof body.currentPassword!=="string" || body.currentPassword.length>512 || typeof body.newPassword!=="string" || body.newPassword.length<12 || body.newPassword.length>128 || body.newPassword!==body.confirmPassword || body.newPassword===body.currentPassword)throw new HttpError(400,"새 비밀번호는 기존과 다른 12~128자로 입력하고 확인 값을 맞춰 주세요.");
    if(!await changeOwnerPassword(body.currentPassword,body.newPassword))throw new HttpError(400,"현재 비밀번호를 확인하세요.");
    const response=json({ok:true,message:"비밀번호를 변경했습니다. 모든 기기에서 로그아웃되었습니다. 새 비밀번호로 로그인하세요."});
    response.cookies.set(COOKIE,"",{path:"/",maxAge:0});return response;
  }catch(e){return failure(e);}
}
