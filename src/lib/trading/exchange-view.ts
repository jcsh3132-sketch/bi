import "server-only";
import { binance } from "./binance.ts";
import { loadCredential, type Environment } from "../credentials.ts";
type Row=Record<string,unknown>;
const numeric=(value:unknown)=>{const n=Number(value);return value==null||value===""||!Number.isFinite(n)?null:n;};
export function parseExchangeView(positions:Row[],orders:Row[],algos:Row[]){
  if(!Array.isArray(positions)||!Array.isArray(orders)||!Array.isArray(algos))throw new Error("Invalid exchange response");
  return {positions:positions.filter(p=>numeric(p.positionAmt)!==null&&Number(p.positionAmt)!==0).map(p=>({symbol:String(p.symbol),side:p.positionSide==="BOTH"?(Number(p.positionAmt)>0?"LONG":"SHORT"):String(p.positionSide),quantity:Math.abs(Number(p.positionAmt)),entry:numeric(p.entryPrice),mark:numeric(p.markPrice),liquidation:numeric(p.liquidationPrice),pnl:numeric(p.unRealizedProfit),marginType:String(p.marginType||"—")})),orders:[...orders.map(p=>({id:`order-${p.orderId}`,symbol:String(p.symbol),type:String(p.type),side:String(p.side),positionSide:String(p.positionSide||"BOTH"),price:numeric(p.price),trigger:numeric(p.stopPrice),quantity:numeric(p.origQty),closePosition:p.closePosition===true,status:String(p.status||"NEW"),workingType:String(p.workingType||"CONTRACT_PRICE")})),...algos.map(p=>({id:`algo-${p.algoId}`,symbol:String(p.symbol),type:String(p.orderType||p.type),side:String(p.side),positionSide:String(p.positionSide||"BOTH"),price:numeric(p.price),trigger:numeric(p.triggerPrice),quantity:numeric(p.quantity),closePosition:p.closePosition===true||p.closePosition==="true",status:String(p.algoStatus||"NEW"),workingType:String(p.workingType||"MARK_PRICE")}))]};
}
export async function exchangeView(environment:Environment){
  if(!await loadCredential(environment))return null;
  const api=await binance(environment,true);
  const [positions,orders,algos]=await Promise.all([api<Row[]>("/fapi/v3/positionRisk"),api<Row[]>("/fapi/v1/openOrders"),api<Row[]>("/fapi/v1/openAlgoOrders")]);
  return {environment,...parseExchangeView(positions,orders,algos),queriedAt:new Date().toISOString()};
}
export type ExchangeView=NonNullable<Awaited<ReturnType<typeof exchangeView>>>;
