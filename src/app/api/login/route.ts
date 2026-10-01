import { NextRequest } from "next/server";
import { createSession, failure, HttpError, json, readBody, sameOrigin } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { sha256, verifyPassword } from "@/lib/crypto";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) throw new HttpError(503, "소유자 로그인 설정이 필요합니다.");
    const data = await readBody(request, 2048);
    if (typeof data.password !== "string" || data.password.length > 512) throw new HttpError(400, "비밀번호를 입력하세요.");
    const ip = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") || "unknown" : "local";
    if (!await rateLimit(`login:${sha256(ip)}`, 8) || !await rateLimit("login:global", 60)) throw new HttpError(429, "로그인 시도가 많습니다. 10분 뒤 다시 시도하세요.");
    if (!verifyPassword(data.password, hash)) throw new HttpError(401, "비밀번호를 확인하세요.");
    const response = json({ ok: true });
    await createSession(response);
    return response;
  } catch (e) { return failure(e); }
}
