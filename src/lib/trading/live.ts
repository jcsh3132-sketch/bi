import "server-only";
import { createHash } from "node:crypto";
import { binance, roundStep } from "./binance.ts";
import { changeState, getState, type Mode } from "./store.ts";
import { analyze, nextTick, plan, type Candle } from "./strategy.ts";
type Account={multiAssetsMargin?:boolean;availableBalance:string;totalWalletBalance:string;positions:{symbol:string;positionAmt:string;positionSide:string;entryPrice:string}[]};
type Fill={orderId:number;qty:string;price:string;realizedPnl:string;commission:string;commissionAsset:string;time:number};
type Algo={algoId:number;clientAlgoId:string};
const SYMBOL="BTCUSDT";
export async function liveCycle(mode:Exclude<Mode,"paper">,generation:string,data:{candles:Candle[];price:number;serverTime:number}){
  const api=await binance(mode), latest=data.candles.at(-1)!;
  const account=await api<Account>("/fapi/v2/account");
  if(account.multiAssetsMargin)throw new Error("USDT 단일 자산 계정만 지원합니다.");
  const positionMode=await api<{dualSidePosition:boolean}>("/fapi/v1/positionSide/dual");
  if(positionMode.dualSidePosition)throw new Error("단방향 계정만 지원합니다.");
  const external=account.positions.filter(p=>p.symbol===SYMBOL&&Number(p.positionAmt)!==0);
  if(external.length>1)throw new Error("계정 포지션 확인 필요");
  let s=await getState(mode);
  if(!s.enabled||s.generation!==generation)return null;
  // A crash after an exchange POST is ambiguous. Never blindly resubmit it.
  if(s.pending)throw new Error("미확정 주문을 먼저 확인하세요.");
  if(s.position){
    const p=s.position;
    if(external.length){
      const actual=external[0];
      if(Math.abs(Number(actual.positionAmt))!==p.quantity||(Number(actual.positionAmt)>0)!==(p.side==="LONG"))throw new Error("수동 변경된 포지션을 확인하세요.");
      const protections=await api<Algo[]>("/fapi/v1/openAlgoOrders", "GET", {symbol:SYMBOL});
      const prefix=String(p.orderId);
      if(!protections.some(x=>x.clientAlgoId===`bi-sl-${prefix}`)||!protections.some(x=>x.clientAlgoId===`bi-tp-${prefix}`))throw new Error("보호 주문 확인 필요");
    }else{
      const fills=await api<Fill[]>("/fapi/v1/userTrades","GET",{symbol:SYMBOL,startTime:p.opened-1000,limit:1000});
      const entry=fills.filter(f=>f.orderId===p.orderId), exits=fills.filter(f=>f.orderId!==p.orderId);
      // Reject mixed manual orders or incomplete history rather than invent PnL.
      if(!entry.length||!exits.length||fills.length===1000||fills.some(f=>f.commissionAsset!=="USDT")||Math.abs(exits.reduce((n,f)=>n+Number(f.qty),0)-p.quantity)>1e-8)throw new Error("체결 기록 확인 필요");
      const quantity=exits.reduce((n,f)=>n+Number(f.qty),0),exit=exits.reduce((n,f)=>n+Number(f.qty)*Number(f.price),0)/quantity,pnl=fills.reduce((n,f)=>n+Number(f.realizedPnl)-Number(f.commission),0);
      const protections=await api<Algo[]>("/fapi/v1/openAlgoOrders","GET",{symbol:SYMBOL});
      for(const order of protections.filter(x=>[ `bi-sl-${p.orderId}`,`bi-tp-${p.orderId}`].includes(x.clientAlgoId)))await api("/fapi/v1/algoOrder","DELETE",{symbol:SYMBOL,algoId:order.algoId});
      await changeState(v=>{if(v.generation!==generation||v.position?.orderId!==p.orderId)return;const trade=v.trades.findLast(t=>t.status==="OPEN");if(!trade)throw new Error("기록 불일치");Object.assign(trade,{status:"CLOSED",exitTime:new Date(Math.max(...exits.map(f=>f.time))).toISOString(),exit,pnl,result:pnl>0?"WIN":pnl<0?"LOSS":"BREAKEVEN"});v.position=null;v.losses=pnl<0?v.losses+1:0;},mode);
      // No immediate re-entry on the same reconciliation cycle.
      await changeState(v=>{if(v.generation===generation)v.lastCandle=latest.time;},mode);
    }
  }else if(external.length)throw new Error("봇 외부의 포지션이 있습니다.");
  const signal=analyze(data.candles), balance=Number(account.totalWalletBalance),available=Number(account.availableBalance);
  if(!Number.isFinite(balance)||!Number.isFinite(available)||balance<0)throw new Error("잔고 확인 실패");
  await changeState(v=>{if(v.generation!==generation)return;v.balance=balance;v.lastAt=data.serverTime;v.nextAt=nextTick(data.serverTime);v.signal=signal;v.warning=null;const day=new Date(data.serverTime).toISOString().slice(0,10);if(v.day!==day){v.day=day;v.dayBalance=balance;v.losses=0;}v.history.push({time:new Date(data.serverTime).toISOString(),balance});v.history=v.history.slice(-200);},mode);
  s=await getState(mode);
  if(!s.enabled||s.generation!==generation)return null;
  if(s.position||latest.time<=s.lastCandle||signal.side==="WAIT"||data.serverTime-latest.end>120000||balance<=s.dayBalance*.97||s.losses>=3){await changeState(v=>{if(v.generation===generation)v.lastCandle=latest.time;},mode);return s.nextAt;}
  const p=plan(data.candles,signal.side,Math.min(balance,available),data.price);
  if(!p)return s.nextAt;
  const base=mode==="testnet"?"https://demo-fapi.binance.com":"https://fapi.binance.com";
  const response=await fetch(base+"/fapi/v1/exchangeInfo",{cache:"no-store",signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error("주문 규칙 조회 실패");
  const info=await response.json(),symbol=info.symbols.find((x:{symbol:string})=>x.symbol===SYMBOL);
  if(!symbol||symbol.status!=="TRADING")throw new Error("거래 가능한 심볼이 아닙니다.");
  const lot=symbol.filters.find((x:{filterType:string;stepSize:string})=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0)||symbol.filters.find((x:{filterType:string})=>x.filterType==="LOT_SIZE"), tick=symbol.filters.find((x:{filterType:string})=>x.filterType==="PRICE_FILTER");
  const quantity=roundStep(p.quantity,lot.stepSize),stop=roundStep(p.stop,tick.tickSize),target=roundStep(p.target,tick.tickSize);
  const notional=symbol.filters.find((x:{filterType:string})=>x.filterType==="MIN_NOTIONAL");
  if(Number(quantity)<Number(lot.minQty)||Number(quantity)>Number(lot.maxQty)||Number(quantity)*p.entry<Number(notional?.notional||10))return s.nextAt;
  await api("/fapi/v1/leverage","POST",{symbol:SYMBOL,leverage:2});
  const clientId="bi-"+createHash("sha256").update(`${mode}:${latest.time}`).digest("hex").slice(0,28);
  const claimed=await changeState(v=>{if(!v.enabled||v.generation!==generation||v.position||v.pending||v.lastCandle>=latest.time)return false;v.pending=clientId;v.lastCandle=latest.time;return true;},mode);
  if(!claimed)return s.nextAt;
  // The intent is committed before POST. Step replay sees pending and halts.
  const submittedAt=Date.now();
  const order=await api<{orderId:number;avgPrice:string;executedQty:string;status:string}>("/fapi/v1/order","POST",{symbol:SYMBOL,side:p.side==="LONG"?"BUY":"SELL",positionSide:"BOTH",type:"MARKET",quantity,newClientOrderId:clientId,newOrderRespType:"RESULT"});
  const entry=Number(order.avgPrice),filled=Number(order.executedQty);
  if(order.status!=="FILLED"||entry<=0||filled<=0)throw new Error("미확정 체결 확인 필요");
  await changeState(v=>{v.position={...p,entry,quantity:filled,stop:Number(stop),target:Number(target),opened:submittedAt,orderId:order.orderId};v.trades.push({id:(v.trades.at(-1)?.id||0)+1,side:p.side,status:"OPEN",entryTime:new Date(submittedAt).toISOString(),exitTime:null,entry,exit:null,pnl:null,result:null});},mode);
  try {
    if((p.side==="LONG"&&(entry<=Number(stop)||entry>=Number(target)))||(p.side==="SHORT"&&(entry>=Number(stop)||entry<=Number(target))))throw new Error("체결 가격이 보호 범위를 벗어났습니다.");
    for(const [type,triggerPrice,clientAlgoId] of [["STOP_MARKET",stop,`bi-sl-${order.orderId}`],["TAKE_PROFIT_MARKET",target,`bi-tp-${order.orderId}`]])await api("/fapi/v1/algoOrder","POST",{symbol:SYMBOL,algoType:"CONDITIONAL",side:p.side==="LONG"?"SELL":"BUY",positionSide:"BOTH",type,triggerPrice,closePosition:"true",workingType:"MARK_PRICE",clientAlgoId});
  } catch {
    // Reduce-only cannot create an opposite position, including when a stop
    // already filled. A timeout remains pending and is never auto-resubmitted.
    try { await api("/fapi/v1/order","POST",{symbol:SYMBOL,side:p.side==="LONG"?"SELL":"BUY",positionSide:"BOTH",type:"MARKET",quantity:roundStep(filled,lot.stepSize),reduceOnly:"true",newClientOrderId:`bi-exit-${order.orderId}`,newOrderRespType:"RESULT"}); } catch {}
    throw new Error("보호 주문 실패: 긴급 청산 결과를 확인하세요.");
  }
  await changeState(v=>{if(v.pending===clientId)v.pending=null;},mode);
  return s.nextAt;
}
