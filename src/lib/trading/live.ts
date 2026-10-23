import "server-only";
import { createHash } from "node:crypto";
import { roundStep } from "./binance.ts";
import { changeState, getState, needsSupervision } from "./store.ts";
import { analyze, nextTick, plan, plannedRisk, ACCOUNT_RISK, COST_BUFFER, type Candle } from "./strategy.ts";
import { getSettings } from "./settings.ts";
import { leverageIsSafe, type Bracket } from "./risk.ts";
import { withExecution, type LiveMode } from "./execution-lock.ts";
import { superviseLocked } from "./recovery.ts";
const SYMBOL="BTCUSDT";
type Account={multiAssetsMargin?:boolean;availableBalance:string;totalWalletBalance:string;positions:{symbol:string;positionAmt:string}[]};
export async function liveCycle(mode:LiveMode,generation:string,data:{candles:Candle[];price:number;serverTime:number}){
 return withExecution(mode,async api=>{
  const latest=data.candles.at(-1)!;
  let s=await getState(mode);if(s.generation!==generation)return null;
  await superviseLocked(mode,api);
  const account=await api<Account>("/fapi/v2/account");
  if(account.multiAssetsMargin)throw Error("USDT 단일 자산 계정만 지원합니다.");
  const positionMode=await api<{dualSidePosition:boolean}>("/fapi/v1/positionSide/dual");
  if(positionMode.dualSidePosition)throw Error("단방향 계정만 지원합니다.");
  s=await getState(mode);
  if(!s.position&&account.positions.some(p=>p.symbol===SYMBOL&&Number(p.positionAmt)!==0))throw Error("봇 외부의 포지션이 있습니다.");
  const signal=analyze(data.candles), balance=Number(account.totalWalletBalance),available=Number(account.availableBalance);
  if(!Number.isFinite(balance)||!Number.isFinite(available)||balance<0)throw new Error("잔고 확인 실패");
  await changeState(v=>{if(v.generation!==generation)return;v.balance=balance;v.lastAt=data.serverTime;v.nextAt=nextTick(data.serverTime);v.signal=signal;v.warning=null;const day=new Date(data.serverTime).toISOString().slice(0,10);if(v.day!==day){v.day=day;v.dayBalance=balance;v.losses=0;}v.history.push({time:new Date(data.serverTime).toISOString(),balance});v.history=v.history.slice(-200);},mode);
  s=await getState(mode);
  if(s.generation!==generation)return null;
  if(!s.enabled||s.error)return needsSupervision(s)?s.nextAt:null;
  if(s.position||latest.time<=s.lastCandle||signal.side==="WAIT"||data.serverTime-latest.end>120000||balance<=s.dayBalance*.97||s.losses>=3){await changeState(v=>{if(v.generation===generation)v.lastCandle=latest.time;},mode);return s.nextAt;}
  const settings=await getSettings(mode);
  if(settings.sizing==="fixed"){
    if(settings.margin>available*.99){await changeState(v=>{if(v.generation===generation)v.warning="설정한 진입 증거금보다 사용 가능 잔고가 부족해 신규 진입을 생략했습니다.";},mode);return s.nextAt;}
  }
  const p=plan(data.candles,signal.side,Math.min(balance,available),data.price,settings.sizing==="fixed"?settings:undefined,settings);
  if(!p){await changeState(v=>{if(v.generation===generation){v.lastCandle=latest.time;v.warning="손절 최대폭·계정 위험 0.5%·수량 조건을 충족하지 않아 신규 진입을 생략했습니다. 손절선을 억지로 좁히지 않습니다.";}},mode);return s.nextAt;}
  if(settings.sizing==="auto")p.quantity=Math.min(p.quantity,available*.99*settings.leverage/p.entry);
  const base=mode==="testnet"?"https://demo-fapi.binance.com":"https://fapi.binance.com";
  const response=await fetch(base+"/fapi/v1/exchangeInfo",{cache:"no-store",signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error("주문 규칙 조회 실패");
  const info=await response.json(),symbol=info.symbols.find((x:{symbol:string})=>x.symbol===SYMBOL);
  if(!symbol||symbol.status!=="TRADING")throw new Error("거래 가능한 심볼이 아닙니다.");
  const lot=symbol.filters.find((x:{filterType:string;stepSize:string})=>x.filterType==="MARKET_LOT_SIZE"&&Number(x.stepSize)>0)||symbol.filters.find((x:{filterType:string})=>x.filterType==="LOT_SIZE"), tick=symbol.filters.find((x:{filterType:string})=>x.filterType==="PRICE_FILTER");
  let quantity=roundStep(p.quantity,lot.stepSize);const stop=roundStep(p.stop,tick.tickSize),target=roundStep(p.target,tick.tickSize);
  if(settings.sizing==="auto")quantity=roundStep(Math.min(Number(quantity),Math.min(balance,available)*ACCOUNT_RISK/(Math.abs(p.entry-Number(stop))+p.entry*COST_BUFFER)),lot.stepSize);
  const notional=symbol.filters.find((x:{filterType:string})=>x.filterType==="MIN_NOTIONAL");
  if(Number(quantity)<Number(lot.minQty)||Number(quantity)>Number(lot.maxQty)||Number(quantity)*p.entry<Number(notional?.notional||10))return s.nextAt;
  p.quantity=Number(quantity);p.stop=Number(stop);p.target=Number(target);
  if(plannedRisk(p.entry,p.stop,p.quantity)>Math.min(balance,available)*ACCOUNT_RISK+1e-8)return s.nextAt;
  const tiers=await api<{symbol:string;brackets:Bracket[]}[]>("/fapi/v1/leverageBracket","GET",{symbol:SYMBOL});
  const tier=tiers.find(t=>t.symbol===SYMBOL);
  if(!tier||!leverageIsSafe({...p,opened:Date.now()},settings.leverage,tier.brackets)){await changeState(v=>{if(v.generation===generation)v.warning="설정 배수에서 손절보다 청산이 먼저 발생할 수 있어 신규 진입을 생략했습니다.";},mode);return s.nextAt;}
  const leverageResult=await api<{leverage?:number;maxNotionalValue?:string}>("/fapi/v1/leverage","POST",{symbol:SYMBOL,leverage:settings.leverage});
  if(leverageResult.leverage!=null&&leverageResult.leverage!==settings.leverage)throw new Error("요청한 배수 적용 실패");
  if(leverageResult.maxNotionalValue!=null&&Number(quantity)*data.price>Number(leverageResult.maxNotionalValue))throw new Error("배수별 최대 주문 금액 초과");
  const clientId="bi-"+createHash("sha256").update(`${mode}:${latest.time}`).digest("hex").slice(0,28);
  const submittedAt=Date.now(),timestamp=api.serverTime();
  const claimed=await changeState(v=>{if(!v.enabled||v.error||v.generation!==generation||v.position||v.pending||v.lastCandle>=latest.time)return false;v.pending=clientId;v.entryIntent={clientId,plan:{...p,opened:submittedAt},submittedAt,requestTimestamp:timestamp,lastSubmissionAt:submittedAt,riskBudget:Math.min(balance,available)*ACCOUNT_RISK};v.lastCandle=latest.time;return true;},mode);
  if(!claimed)return s.nextAt;
  try{
   const order=await api<{orderId:number;avgPrice:string;executedQty:string;status:string}>("/fapi/v1/order","POST",{symbol:SYMBOL,side:p.side==="LONG"?"BUY":"SELL",positionSide:"BOTH",type:"MARKET",quantity,newClientOrderId:clientId,newOrderRespType:"RESULT",timestamp});
   const entry=Number(order.avgPrice),filled=Number(order.executedQty);
   if(order.status!=="FILLED"||!Number.isFinite(order.orderId)||!Number.isFinite(entry)||entry<=0||!Number.isFinite(filled)||filled<=0)throw Error("미확정 체결 확인 필요");
   await changeState(v=>{if(v.pending!==clientId)throw Error("진입 기록 확인 필요");v.position={...p,entry,quantity:filled,opened:submittedAt,orderId:order.orderId};v.trades.push({id:(v.trades.at(-1)?.id||0)+1,side:p.side,status:"OPEN",entryTime:new Date(submittedAt).toISOString(),exitTime:null,entry,exit:null,pnl:null,result:null});},mode);
   if((Math.abs(entry-p.stop)+entry*.002)*filled>Math.min(balance,available)*ACCOUNT_RISK+1e-8||(p.side==="LONG"&&(entry<=p.stop||entry>=p.target))||(p.side==="SHORT"&&(entry>=p.stop||entry<=p.target)))throw Error("체결 가격이 위험 한도를 벗어났습니다.");
   for(const [type,triggerPrice,clientAlgoId] of [["STOP_MARKET",stop,`bi-sl-${order.orderId}`],["TAKE_PROFIT_MARKET",target,`bi-tp-${order.orderId}`]]){
    const requestTime=api.serverTime();
    await changeState(v=>{if(v.pending!==clientId||!v.entryIntent)throw Error("보호 주문 의도 확인 필요");v.entryIntent.lastSubmissionAt=Date.now();},mode);
    await api("/fapi/v1/algoOrder","POST",{symbol:SYMBOL,algoType:"CONDITIONAL",side:p.side==="LONG"?"SELL":"BUY",positionSide:"BOTH",type,triggerPrice,closePosition:"true",workingType:"MARK_PRICE",clientAlgoId,timestamp:requestTime});
   }
   await superviseLocked(mode,api);
  }catch{try{await superviseLocked(mode,api);}catch{}throw Error("진입 또는 보호 주문 복구 확인이 필요합니다.");}
  return s.nextAt;
 });
}
