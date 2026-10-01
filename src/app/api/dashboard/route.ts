import { failure, json, requireOwner } from "@/lib/auth";
import { getState, snapshot } from "@/lib/trading/store";
import { accountBalance } from "@/lib/account-balance";
import { environmentSchema } from "@/lib/schema";
import { NextRequest } from "next/server";
export async function GET(request:NextRequest) {
  try {
    await requireOwner();
    const s=await getState();
    const environment=environmentSchema.safeParse(request.nextUrl.searchParams.get("environment") || (s.mode==="mainnet"?"mainnet":"testnet"));
    let account=null,accountError=null;
    if(environment.success){try{account=await accountBalance(environment.data);}catch{accountError="계정 잔고를 조회하지 못했습니다. 연결 확인에서 키·권한·IP 제한을 확인하세요.";}}
    return json({ snapshot: snapshot(s), account, accountError, receivedAt: s.lastAt ? new Date(s.lastAt).toISOString() : null });
  } catch (e) { return failure(e); }
}
