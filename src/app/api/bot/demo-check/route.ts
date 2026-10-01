import { failure, json, requireOwner } from "@/lib/auth";
import { demoCheck } from "@/lib/trading/demo-check";
export async function GET(){try{await requireOwner();return json(await demoCheck());}catch(e){return failure(e);}}
