import { z } from "zod";
const number = z.number().finite();
const nullable = number.nullable();
const date = z.string().datetime({ offset: true });
export const environmentSchema = z.enum(["testnet", "mainnet"]);
export const credentialSchema = z.object({ environment: environmentSchema, apiKey: z.string().trim().regex(/^[A-Za-z0-9]{16,256}$/), secretKey: z.string().trim().regex(/^[A-Za-z0-9]{16,256}$/) }).strict();
export const snapshotSchema = z.object({
  capturedAt: date,
  runtime: z.object({ state: z.enum(["RUNNING","STOPPED","ERROR","API_ERROR","UNKNOWN"]), updatedAt: date.nullable(), dryRun: z.boolean(), testnet: z.boolean(), symbol: z.string().max(30), timeframe: z.string().max(10), entryEnabled: z.boolean() }).strict(),
  balance: nullable,
  performance: z.object({ totalTrades: z.number().int().nonnegative(), winRate: number, netPnl: number, todayPnl: number, profitFactor: nullable }),
  signal: z.object({ side: z.string().max(20), regime: z.string().max(40), longScore: number, shortScore: number, candleTime: z.string().max(40), reasons: z.array(z.string().max(300)).max(20) }).nullable(),
  position: z.object({ side: z.string().max(20), entry: number, stop: number, target: number, quantity: number }).nullable(),
  history: z.array(z.object({ time: z.string().max(40), balance: number })).max(200),
  trades: z.array(z.object({ id: z.number().int(), side: z.string().max(20), status: z.string().max(30), entryTime: z.string().max(40), exitTime: z.string().max(40).nullable(), entry: number, exit: nullable, pnl: nullable, grossPnl:number.optional(), fees:number.optional(), funding:number.optional(), result: z.string().max(20).nullable() })).max(100),
}).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
