import { NextRequest } from "next/server";
import { failure, HttpError, json, readBody, requireOwner, sameOrigin } from "@/lib/auth";
import { environmentSchema } from "@/lib/schema";
import { getSettings, saveSettings, settingsSchema } from "@/lib/trading/settings";
export async function GET(request:NextRequest){try{await requireOwner();const env=environmentSchema.safeParse(request.nextUrl.searchParams.get("environment"));if(!env.success)throw new HttpError(400,"계정을 선택하세요.");return json({settings:await getSettings(env.data)});}catch(e){return failure(e);}}
export async function PUT(request:NextRequest){try{sameOrigin(request);await requireOwner();const parsed=settingsSchema.safeParse(await readBody(request));if(!parsed.success)throw new HttpError(400,"배수는 1~125 정수, 진입 증거금은 1~1,000,000 USDT로 입력하세요.");await saveSettings(parsed.data);return json({settings:parsed.data,message:"다음 신규 진입부터 적용합니다. 기존 포지션과 주문은 변경하지 않습니다."});}catch(e){return failure(e);}}
