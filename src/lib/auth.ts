import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { equalSecret, sha256 } from "./crypto";
import { query, ready, transaction } from "./db";

export const COOKIE = "bi_owner_session";
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function hasSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  await ready();
  const rows = await query("SELECT token_hash FROM owner_sessions WHERE token_hash=$1 AND expires_at>$2", [sha256(token), Date.now()]);
  return rows.length === 1;
}
export async function requireOwner() { if (!await hasSession()) throw new HttpError(401, "로그인이 필요합니다."); }
export function sameOrigin(request: NextRequest) {
  const expected = new URL(process.env.APP_ORIGIN || request.url).origin;
  if (request.headers.get("origin") !== expected) throw new HttpError(403, "허용되지 않은 요청입니다.");
}
export async function readBody(request: NextRequest, max = 8192) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "JSON 요청이 필요합니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "요청 내용이 없습니다.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new HttpError(413, "요청 크기가 너무 큽니다."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "요청 형식이 잘못되었습니다."); }
}
export async function createSession(response: NextResponse, expectedHash?:string) {
  await ready();
  const token = randomBytes(32).toString("base64url");
  const seconds = 60 * 60 * 24 * 7;
  await transaction(async sql=>{
    if(expectedHash){
      await sql("INSERT INTO owner_auth(id,password_hash) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",["owner",process.env.ADMIN_PASSWORD_HASH || ""]);
      const rows=await sql<{password_hash:string}>("SELECT password_hash FROM owner_auth WHERE id=$1"+(process.env.DATABASE_URL?" FOR UPDATE":""),["owner"]);
      if(!equalSecret(rows[0].password_hash,expectedHash))throw new HttpError(401,"비밀번호가 변경되었습니다. 다시 로그인하세요.");
    }
    await sql("DELETE FROM owner_sessions WHERE expires_at < $1", [Date.now()]);
    await sql("INSERT INTO owner_sessions(token_hash,expires_at) VALUES($1,$2)", [sha256(token), Date.now() + seconds * 1000]);
  });
  response.cookies.set(COOKIE, token, { httpOnly: true, secure: !!process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https://"), sameSite: "strict", path: "/", maxAge: seconds });
}
export function requireBridge(request: NextRequest) {
  const secret = process.env.BRIDGE_TOKEN || "";
  if (secret.length < 32 || !equalSecret(request.headers.get("authorization") || "", `Bearer ${secret}`)) throw new HttpError(401, "연결 인증 실패");
}
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store, private" } }); }
export function failure(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const code=typeof error==="object"&&error&&"code" in error?String(error.code):"UNKNOWN";
  console.error("Request failed", /^[A-Z0-9_]{1,50}$/.test(code)?code:"UNKNOWN");
  // Never return/log database URLs, request objects, or decrypted credentials.
  return json({ error: "요청을 완료하지 못했습니다. 서버 설정과 연결 상태를 확인하세요." }, 503);
}
