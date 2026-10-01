import "server-only";
import { randomUUID } from "node:crypto";
import { query, ready, transaction, type Query } from "../db.ts";
import type { Snapshot } from "../schema";
import type { Position } from "./strategy";
export type Mode = "paper" | "testnet" | "mainnet";
export function botMode():Mode { const mode=process.env.BOT_TRADING_MODE||"paper";if(!["paper","testnet","mainnet"].includes(mode))throw new Error("실행 모드 오류");if(mode==="mainnet"&&process.env.ALLOW_MAINNET_LIVE!=="true")throw new Error("실거래 허용 설정이 필요합니다.");return mode as Mode; }
export type BotState = {
  mode: Mode; pending: string | null;
  enabled: boolean; generation: string; nextAt: number | null; lastAt: number | null;
  workflowId: string | null; error: string | null; lastCandle: number;
  warning: string | null;
  balance: number; day: string; dayBalance: number; losses: number;
  position: Position | null; signal: Snapshot["signal"];
  history: Snapshot["history"]; trades: Snapshot["trades"];
};
let initialized: Promise<void> | undefined;
export async function botReady(){
  initialized??=(async()=>{
    await ready();
    await query("CREATE TABLE IF NOT EXISTS scheduled_bot (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    for(const mode of ["paper","testnet","mainnet"] as Mode[])await query("INSERT INTO scheduled_bot(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",[mode,JSON.stringify({mode,pending:null,enabled:false,generation:randomUUID(),nextAt:null,lastAt:null,workflowId:null,error:null,warning:null,lastCandle:0,balance:mode==="paper"?1000:0,day:"",dayBalance:mode==="paper"?1000:0,losses:0,position:null,signal:null,history:[],trades:[]} satisfies BotState)]);
  })().catch(e=>{initialized=undefined;throw e;});
  await initialized;
}
export async function state(sql:Query=query,lock=false,mode:Mode=botMode()):Promise<BotState>{
  const rows=await sql<{payload:string}>(`SELECT payload FROM scheduled_bot WHERE id=$1${lock&&process.env.DATABASE_URL?" FOR UPDATE":""}`,[mode]);
  return JSON.parse(rows[0].payload);
}
export async function writeState(s:BotState,sql:Query=query){await sql("UPDATE scheduled_bot SET payload=$1 WHERE id=$2",[JSON.stringify(s),s.mode]);}
export async function changeState<T>(fn:(s:BotState)=>T|Promise<T>,mode:Mode=botMode()):Promise<T>{await botReady();return transaction(async sql=>{const s=await state(sql,true,mode);const result=await fn(s);await writeState(s,sql);return result;});}
export async function getState(mode:Mode=botMode()){await botReady();return state(query,false,mode);}
export function snapshot(s:BotState):Snapshot{
  const closed=s.trades.filter(t=>t.status==="CLOSED"),wins=closed.filter(t=>(t.pnl||0)>0),positive=wins.reduce((n,t)=>n+(t.pnl||0),0),negative=closed.reduce((n,t)=>n+Math.min(0,t.pnl||0),0);
  const today=new Date().toISOString().slice(0,10);
  return {capturedAt:new Date().toISOString(),runtime:{state:s.error?"ERROR":s.enabled?"RUNNING":"STOPPED",updatedAt:s.lastAt?new Date(s.lastAt).toISOString():null,dryRun:s.mode==="paper",testnet:s.mode==="testnet",symbol:"BTCUSDT",timeframe:"15m",entryEnabled:s.enabled&&!s.error},balance:s.balance,performance:{totalTrades:closed.length,winRate:closed.length?wins.length/closed.length*100:0,netPnl:closed.reduce((n,t)=>n+(t.pnl||0),0),todayPnl:closed.filter(t=>t.exitTime?.startsWith(today)).reduce((n,t)=>n+(t.pnl||0),0),profitFactor:negative?positive/-negative:null},signal:s.signal,position:s.position,history:s.history.slice(-200),trades:s.trades.slice(-100).reverse()};
}
