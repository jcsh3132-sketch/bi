import "server-only";
import { decrypt, encrypt } from "./crypto.ts";
import { query, ready } from "./db.ts";
export type Environment = "testnet" | "mainnet";
export async function credentialList() {
  await ready();
  return query("SELECT environment, masked_key AS \"maskedKey\", updated_at AS \"updatedAt\" FROM api_credentials ORDER BY environment");
}
export async function saveCredential(environment: Environment, apiKey: string, secretKey: string) {
  await ready();
  const encrypted = encrypt(JSON.stringify({ apiKey, secretKey }), `binance:${environment}`);
  const mask = `••••••••${apiKey.slice(-4)}`;
  await query("INSERT INTO api_credentials(environment, encrypted_value, masked_key, updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(environment) DO UPDATE SET encrypted_value=excluded.encrypted_value, masked_key=excluded.masked_key, updated_at=excluded.updated_at", [environment, encrypted, mask, new Date().toISOString()]);
}
export async function loadCredential(environment: Environment): Promise<{ apiKey: string; secretKey: string } | null> {
  await ready();
  const rows = await query<{ encrypted_value: string }>("SELECT encrypted_value FROM api_credentials WHERE environment=$1", [environment]);
  return rows[0] ? JSON.parse(decrypt(rows[0].encrypted_value, `binance:${environment}`)) : null;
}
