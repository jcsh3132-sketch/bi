import "server-only";
import { z } from "zod";
import { query, ready } from "../db.ts";
import type { Environment } from "../credentials.ts";
export const settingsSchema=z.object({environment:z.enum(["testnet","mainnet"]),leverage:z.number().int().min(1).max(125),sizing:z.enum(["auto","fixed"]),margin:z.number().finite().min(1).max(1000000)}).strict();
export type TradingSettings=z.infer<typeof settingsSchema>;
export async function getSettings(environment:Environment):Promise<TradingSettings>{
  await ready();await query("CREATE TABLE IF NOT EXISTS trading_settings (environment TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const rows=await query<{payload:string}>("SELECT payload FROM trading_settings WHERE environment=$1",[environment]);
  return rows[0]?settingsSchema.parse(JSON.parse(rows[0].payload)):{environment,leverage:2,sizing:"auto",margin:100};
}
export async function saveSettings(settings:TradingSettings){
  await getSettings(settings.environment);
  await query("INSERT INTO trading_settings(environment,payload) VALUES($1,$2) ON CONFLICT(environment) DO UPDATE SET payload=excluded.payload",[settings.environment,JSON.stringify(settings)]);
}
