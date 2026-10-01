import "server-only";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;
type Sqlite = { prepare: (sql: string) => { all: (...params: unknown[]) => Row[] }; exec: (sql: string) => void };
const runtime = globalThis as unknown as { dashboardPool?: Pool; dashboardLocal?: Sqlite; dashboardInit?: Promise<void> };
export type Query = typeof query;
let localQueue: Promise<unknown> = Promise.resolve();
export async function transaction<T>(fn: (sql: Query) => Promise<T>): Promise<T> {
  if (process.env.DATABASE_URL) {
    await query("SELECT 1");
    const client = await runtime.dashboardPool!.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(async <R extends Row = Row>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[]);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  // Development only; production always uses a PostgreSQL row lock.
  const task=localQueue.then(async()=>{
    await query("BEGIN IMMEDIATE");
    try { const result=await fn(query);await query("COMMIT");return result; }
    catch(error){await query("ROLLBACK");throw error;}
  });
  localQueue=task.catch(()=>undefined);
  return task;
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (process.env.DATABASE_URL) {
    runtime.dashboardPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 20000 });
    return (await runtime.dashboardPool.query(sql, params)).rows as T[];
  }
  if (process.env.VERCEL || !process.env.LOCAL_DATABASE_PATH) throw new Error("영구 데이터베이스 연결이 필요합니다.");
  if (!runtime.dashboardLocal) {
    const path = resolve(process.env.LOCAL_DATABASE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    runtime.dashboardLocal = new DatabaseSync(path) as Sqlite;
    runtime.dashboardLocal.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  const args: unknown[] = [];
  const localSql = sql.replace(/\$(\d+)/g, (_, number) => { args.push(params[Number(number) - 1]); return "?"; });
  return runtime.dashboardLocal.prepare(localSql).all(...args) as T[];
}

export async function ready() {
  runtime.dashboardInit ??= (async () => {
    for (const statement of [
      "CREATE TABLE IF NOT EXISTS owner_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS owner_auth (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS api_credentials (environment TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL, masked_key TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS bot_snapshots (id TEXT PRIMARY KEY, payload TEXT NOT NULL, received_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS request_limits (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL)",
    ]) await query(statement);
  })().catch((error) => { runtime.dashboardInit = undefined; throw error; });
  await runtime.dashboardInit;
}

export async function rateLimit(id: string, maximum: number, seconds = 600) {
  await ready();
  const now = Date.now();
  const bucket = `${id}:${Math.floor(now / (seconds * 1000))}`;
  const rows = await query<{ attempts: number }>("INSERT INTO request_limits (id, attempts, expires_at) VALUES ($1, 1, $2) ON CONFLICT (id) DO UPDATE SET attempts=request_limits.attempts+1 RETURNING attempts", [bucket, now + seconds * 2000]);
  await query("DELETE FROM request_limits WHERE expires_at < $1", [now]);
  return Number(rows[0].attempts) <= maximum;
}
