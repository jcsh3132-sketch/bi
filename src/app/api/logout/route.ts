import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, failure, json, sameOrigin } from "@/lib/auth";
import { query, ready } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = (await cookies()).get(COOKIE)?.value;
    if (token) { await ready(); await query("DELETE FROM owner_sessions WHERE token_hash=$1", [sha256(token)]); }
    const response = json({ ok: true }); response.cookies.delete(COOKIE); return response;
  } catch (e) { return failure(e); }
}
