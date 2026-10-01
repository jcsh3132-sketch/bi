import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { loadCredential } from "@/lib/credentials";
import { environmentSchema } from "@/lib/schema";
import { rateLimit } from "@/lib/db";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); await requireOwner();
    if (!await rateLimit("keys:verify", 10, 60)) throw new HttpError(429, "잠시 후 다시 확인하세요.");
    const env = environmentSchema.safeParse((await readBody(request)).environment);
    if (!env.success) throw new HttpError(400, "환경을 선택하세요.");
    const key = await loadCredential(env.data);
    if (!key) throw new HttpError(404, "저장된 키가 없습니다.");
    const base = env.data === "testnet" ? "https://demo-fapi.binance.com" : "https://fapi.binance.com";
    const clock = await fetch(`${base}/fapi/v1/time`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!clock.ok) throw new HttpError(502, "거래소 연결이 제한되었거나 일시적으로 응답하지 않습니다.");
    const time = await clock.json();
    if (!Number.isSafeInteger(time.serverTime)) throw new HttpError(502, "거래소 시간 응답 오류");
    const params = new URLSearchParams({ timestamp: String(time.serverTime), recvWindow: "5000" });
    params.set("signature", createHmac("sha256", key.secretKey).update(params.toString()).digest("hex"));
    const response = await fetch(`${base}/fapi/v3/balance?${params}`, { headers: { "X-MBX-APIKEY": key.apiKey }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new HttpError(400, "인증에 실패했습니다. 키의 거래 환경, 선물 조회 권한, IP 제한을 확인하세요.");
    const balances = await response.json();
    if (!Array.isArray(balances)) throw new HttpError(502, "잔고 응답 오류");
    const usdt = balances.find((row: { asset: string }) => row.asset === "USDT");
    return json({ ok: true, availableBalance: usdt ? Number(usdt.availableBalance) : 0, message: "잔고 조회 성공 · 주문은 전송하지 않았습니다." });
  } catch (e) { return failure(e); }
}
