import { hasSession } from "@/lib/auth";
import Dashboard from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  let authenticated = false;
  try { authenticated = await hasSession(); } catch { /* locked when DB unavailable */ }
  return <Dashboard initialAuthenticated={authenticated} />;
}
