import "server-only";
import { randomUUID } from "node:crypto";
import { BinanceError } from "./binance.ts";
import { changeState, getState } from "./store.ts";
import { settle, type Fill } from "./settlement.ts";
import { liquidationIsSafe } from "./risk.ts";
import { type Exchange, type LiveMode, withExecution } from "./execution-lock.ts";
import type { Position } from "./strategy.ts";
const SYMBOL="BTCUSDT", EXPIRY_GRACE=120000;
type Order={symbol:string;clientOrderId:string;orderId:number;side:string;positionSide:string;status:string;avgPrice:string;executedQty:string;time:number};
type Account={totalWalletBalance:string;positions:{symbol:string;positionAmt:string;entryPrice?:string}[]};
type Algo={algoId:number;clientAlgoId:string;symbol:string;side:string;orderType:string;triggerPrice:string;closePosition:boolean;workingType:string};
const terminal=(status:string)=>["FILLED","CANCELED","EXPIRED","EXPIRED_IN_MATCH","REJECTED"].includes(status);
async function exposure(api:Exchange){const account=await api<Account>("/fapi/v2/account");if(!Array.isArray(account.positions))throw Error("계정 조회 확인 필요");const positions=account.positions.filter(p=>p.symbol===SYMBOL&&Number(p.positionAmt)!==0);if(positions.length>1||positions.some(p=>!Number.isFinite(Number(p.positionAmt))))throw Error("포지션 조회 확인 필요");return {account,actual:positions[0]};}
function matches(p:Position,actual:{positionAmt:string},allowPartial=false){const q=Number(actual.positionAmt);return (q>0)===(p.side==="LONG")&&(allowPartial?Math.abs(q)<=p.quantity+1e-8:Math.abs(Math.abs(q)-p.quantity)<1e-8);}
export async function recoverEntry(mode:LiveMode,api:Exchange){
 const s=await getState(mode),id=s.pending;
 if(!id||id.startsWith("bi-close-"))return;
 let order:Order;
 try{order=await api<Order>("/fapi/v1/order","GET",{symbol:SYMBOL,origClientOrderId:id});}
 catch(e){
  if(e instanceof BinanceError&&e.code===-2013&&s.entryIntent&&Date.now()-s.entryIntent.submittedAt>EXPIRY_GRACE){
   const {actual}=await exposure(api);
   if(!actual&&!s.position){await changeState(v=>{if(v.pending===id){v.pending=null;v.entryIntent=null;v.enabled=false;v.error=null;v.warning="유효시간이 지난 진입 주문의 미체결을 확인했습니다. 봇 시작으로 다시 실행하세요.";}},mode);return;}
  }
  throw Error("진입 주문의 체결 여부를 조회 중입니다. 신규 주문은 전송하지 않습니다.");
 }
 if(order.symbol!==SYMBOL||order.clientOrderId!==id||!["BUY","SELL"].includes(order.side)||order.positionSide!=="BOTH"||!Number.isFinite(order.orderId))throw Error("진입 주문 식별 확인 필요");
 if(!terminal(order.status)){await api("/fapi/v1/order","DELETE",{symbol:SYMBOL,orderId:order.orderId});throw Error("남은 진입 주문의 취소 확인 중입니다.");}
 const quantity=Number(order.executedQty),entry=Number(order.avgPrice);
 if(!Number.isFinite(quantity)||quantity<0)throw Error("체결 수량 확인 필요");
 if(quantity===0){const {actual}=await exposure(api);if(actual||s.position)throw Error("미체결 주문과 계정 포지션이 일치하지 않습니다.");await changeState(v=>{if(v.pending===id){v.pending=null;v.entryIntent=null;v.enabled=false;v.error=null;}},mode);return;}
 if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(order.time)||order.time<=0)throw Error("진입 체결가 확인 필요");
 await changeState(v=>{
  if(v.pending!==id)return;
  if(v.position&&v.position.orderId!==order.orderId)throw Error("포지션 기록 불일치");
  const existing=v.position||v.entryIntent?.plan;
  // Legacy intents without a saved protection plan are reduced to flat by superviseLocked.
  v.position={side:order.side==="BUY"?"LONG":"SHORT",entry,quantity,stop:existing?.stop??entry,target:existing?.target??entry,opened:order.time,orderId:order.orderId};
  const trade=v.trades.findLast(t=>t.status==="OPEN");
  if(trade){trade.entry=entry;trade.entryTime=new Date(order.time).toISOString();}
  else v.trades.push({id:(v.trades.at(-1)?.id||0)+1,side:v.position.side,status:"OPEN",entryTime:new Date(order.time).toISOString(),exitTime:null,entry,exit:null,pnl:null,result:null});
 },mode);
}
async function finalizeFlat(mode:LiveMode,api:Exchange,p:Position){
 const s=await getState(mode);
 // A paused writer cannot later submit an entry/protection after its fixed signature expires.
 if(s.entryIntent&&Date.now()-s.entryIntent.lastSubmissionAt<EXPIRY_GRACE)throw Error("이전 주문 요청의 유효시간 종료와 잔여 주문을 확인 중입니다.");
 const {account,actual}=await exposure(api);if(actual)throw Error("청산 체결 확인 중입니다.");
 const fills=await api<Fill[]>("/fapi/v1/userTrades","GET",{symbol:SYMBOL,startTime:p.opened-1000,limit:1000});
 const preliminary=settle(fills,p.orderId!,p.quantity);
 const incomes=await api<{income:string;asset:string}[]>("/fapi/v1/income","GET",{symbol:SYMBOL,incomeType:"FUNDING_FEE",startTime:p.opened,endTime:Date.parse(preliminary.exitTime),limit:1000});
 if(!Array.isArray(incomes)||incomes.length>=1000||incomes.some(i=>i.asset!=="USDT"||!Number.isFinite(Number(i.income))))throw Error("펀딩 확인 필요");
 const result=settle(fills,p.orderId!,p.quantity,incomes.reduce((sum,i)=>sum+Number(i.income),0));
 const orders=await api<Algo[]>("/fapi/v1/openAlgoOrders","GET",{symbol:SYMBOL});
 for(const o of orders.filter(o=>[`bi-sl-${p.orderId}`,`bi-tp-${p.orderId}`].includes(o.clientAlgoId)))await api("/fapi/v1/algoOrder","DELETE",{symbol:SYMBOL,algoId:o.algoId});
 const balance=Number(account.totalWalletBalance);if(!Number.isFinite(balance))throw Error("잔고 확인 필요");
 await changeState(v=>{if(v.position?.orderId!==p.orderId)return;const trade=v.trades.findLast(t=>t.status==="OPEN");if(!trade)throw Error("거래 기록 확인 필요");Object.assign(trade,{...result,status:"CLOSED",result:result.pnl>0?"WIN":result.pnl<0?"LOSS":"BREAKEVEN"});v.position=null;v.pending=null;v.entryIntent=null;v.closeIntent=null;v.error=null;v.balance=balance;v.losses=result.pnl<0?v.losses+1:0;v.lastAt=Date.now();v.lastCandle=Math.max(v.lastCandle,Math.floor(Date.now()/900000)*900000-900000);v.history.push({time:new Date().toISOString(),balance});v.history=v.history.slice(-200);},mode);
 return result;
}
export async function closeLocked(mode:LiveMode,api:Exchange){
 let s=await getState(mode);const p=s.position;if(!p?.orderId)throw Error("종료할 봇 포지션 확인 필요");
 await changeState(v=>{v.enabled=false;},mode);
 let {actual}=await exposure(api);
 if(!actual)return finalizeFlat(mode,api,p);
 if(!matches(p,actual,!!s.closeIntent))throw Error("거래소 포지션과 봇 기록이 다릅니다.");
 if(s.pending?.startsWith("bi-close-")){
  let previous:Order|null=null;
  try{previous=await api<Order>("/fapi/v1/order","GET",{symbol:SYMBOL,origClientOrderId:s.pending});}
  catch(e){if(!(e instanceof BinanceError&&e.code===-2013&&s.closeIntent&&Date.now()-s.closeIntent.submittedAt>EXPIRY_GRACE))throw e;}
  if(previous){
   if(previous.clientOrderId!==s.pending||previous.symbol!==SYMBOL)throw Error("청산 주문 식별 확인 필요");
   if(previous.side!==(p.side==="LONG"?"SELL":"BUY")||previous.positionSide!=="BOTH"||!Number.isFinite(Number(previous.executedQty))||Number(previous.executedQty)<0)throw Error("청산 주문 수량·방향 확인 필요");
   if(!terminal(previous.status))throw Error("청산 주문 체결을 기다리고 있습니다.");
   const refreshed=await exposure(api);actual=refreshed.actual;
   if(!actual)return finalizeFlat(mode,api,p);
   if(!s.closeIntent||!matches(p,actual,true)||Math.abs(Math.abs(Number(actual.positionAmt))-(s.closeIntent.remainingBefore-Number(previous.executedQty)))>1e-8)throw Error("청산 후 잔여 수량 확인 필요");
  }
 }
 const quantity=Math.abs(Number(actual.positionAmt)),clientId="bi-close-"+randomUUID().replaceAll("-","").slice(0,24),submittedAt=Date.now(),timestamp=api.serverTime();
 await changeState(v=>{if(v.position?.orderId!==p.orderId)throw Error("포지션 변경 확인 필요");v.pending=clientId;v.closeIntent={clientId,submittedAt,requestTimestamp:timestamp,remainingBefore:quantity};},mode);
 await api("/fapi/v1/order","POST",{symbol:SYMBOL,side:p.side==="LONG"?"SELL":"BUY",positionSide:"BOTH",type:"MARKET",quantity:String(quantity),reduceOnly:"true",newClientOrderId:clientId,newOrderRespType:"RESULT",timestamp});
 return finalizeFlat(mode,api,p);
}
function validProtection(o:Algo|undefined,p:Position,type:string,trigger:number){return !!o&&o.symbol===SYMBOL&&o.side===(p.side==="LONG"?"SELL":"BUY")&&o.orderType===type&&o.closePosition===true&&o.workingType==="MARK_PRICE"&&Math.abs(Number(o.triggerPrice)-trigger)<1e-8;}
export async function superviseLocked(mode:LiveMode,api:Exchange){
 await recoverEntry(mode,api);
 let s=await getState(mode),p=s.position;if(!p)return;
 if(s.pending?.startsWith("bi-close-")){await closeLocked(mode,api);return;}
 const {actual}=await exposure(api);
 if(!actual){await finalizeFlat(mode,api,p);return;}
 if(!matches(p,actual))throw Error("수동 변경된 포지션 확인 필요");
 const entry=Number(actual.entryPrice);if(Number.isFinite(entry)&&entry>0&&(!Number.isFinite(p.entry)||p.entry<=0)){await changeState(v=>{if(v.position&&v.position.orderId===p!.orderId){v.position.entry=entry;const t=v.trades.findLast(t=>t.status==="OPEN");if(t)t.entry=entry;}},mode);s=await getState(mode);p=s.position!;}
 const orders=await api<Algo[]>("/fapi/v1/openAlgoOrders","GET",{symbol:SYMBOL});
 const protectedPosition=validProtection(orders.find(o=>o.clientAlgoId===`bi-sl-${p.orderId}`),p,"STOP_MARKET",p.stop)&&validProtection(orders.find(o=>o.clientAlgoId===`bi-tp-${p.orderId}`),p,"TAKE_PROFIT_MARKET",p.target);
 let safe=protectedPosition;
 if(safe){const risks=await api<{symbol:string;positionAmt:string;liquidationPrice:string}[]>("/fapi/v3/positionRisk","GET",{symbol:SYMBOL});const risk=risks.find(r=>r.symbol===SYMBOL&&Number(r.positionAmt)!==0);if(!risk)throw Error("청산 여유 조회 확인 필요");safe=liquidationIsSafe(p,Number(risk.liquidationPrice));}
 if(!safe){await changeState(v=>{v.enabled=false;v.warning="보호 주문 누락 또는 청산 여유 부족을 확인하여 신규 진입을 막고 포지션 종료를 진행합니다.";},mode);await closeLocked(mode,api);return;}
 await changeState(v=>{if(v.position?.orderId===p!.orderId){v.pending=null;v.entryIntent=null;v.error=null;}},mode);
}
export async function supervise(mode:LiveMode){return withExecution(mode,api=>superviseLocked(mode,api));}
