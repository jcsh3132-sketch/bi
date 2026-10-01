import { NextRequest } from "next/server";
import { failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { credentialList, saveCredential } from "@/lib/credentials";
import { credentialSchema, environmentSchema } from "@/lib/schema";
import { query, rateLimit } from "@/lib/db";
import { changeState, getState } from "@/lib/trading/store";
import { randomUUID } from "node:crypto";
export const runtime = "nodejs";
export async function GET() {
  try { await requireOwner(); return json({ credentials: await credentialList() }); } catch (e) { return failure(e); }
}
export async function PUT(request: NextRequest) {
  try {
    sameOrigin(request); await requireOwner();
    if (!await rateLimit("keys:write", 20)) throw new HttpError(429, "잠시 후 다시 저장하세요.");
    const data = credentialSchema.safeParse(await readBody(request));
    if (!data.success) throw new HttpError(400, "환경과 API 키 형식을 확인하세요.");
    const bot=await getState(data.data.environment);
    if(bot.enabled||bot.position||bot.pending)throw new HttpError(409,"해당 계정의 봇을 중지하고 포지션과 미확정 주문을 정리한 후 키를 교체하세요.");
    await saveCredential(data.data.environment, data.data.apiKey, data.data.secretKey);
    return json({ ok: true, credentials: await credentialList() });
  } catch (e) { return failure(e); }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request); await requireOwner();
    const data = await readBody(request);
    const env = environmentSchema.safeParse(data.environment);
    if (!env.success || data.confirm !== "삭제") throw new HttpError(400, "삭제 확인 문구를 입력하세요.");
    await changeState(s=>{s.enabled=false;s.generation=randomUUID();s.nextAt=null;},env.data);
    await query("DELETE FROM api_credentials WHERE environment=$1", [env.data]);
    return json({ ok: true, credentials: await credentialList() });
  } catch (e) { return failure(e); }
}
