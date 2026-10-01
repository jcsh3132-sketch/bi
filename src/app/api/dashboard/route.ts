import { failure, json, requireOwner } from "@/lib/auth";
import { getState, snapshot } from "@/lib/trading/store";
export async function GET() {
  try {
    await requireOwner();
    const s=await getState();
    return json({ snapshot: snapshot(s), receivedAt: s.lastAt ? new Date(s.lastAt).toISOString() : null });
  } catch (e) { return failure(e); }
}
