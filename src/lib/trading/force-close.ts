import "server-only";
import { randomUUID } from "node:crypto";
import { binance } from "./binance.ts";
import { changeState, getState, type Mode } from "./store.ts";
import { settle, type Fill } from "./settlement.ts";
type Account={totalWalletBalance:string;positions:{symbol:string;positionAmt:string}[]};
export async function forceClose(mode:Exclude<Mode,"paper">){
  const api=await binance(mode);
  const claim=await changeState(s=>{
    if(s.pending){if(!s.pending.startsWith("bi-close-"))throw new Error("진입 주문 확인 중입니다. 잠시 후 다시 확인하세요.");return {id:s.pending,fresh:false,position:s.position};}
    if(!s.position?.orderId)throw new Error("강제 종료할 봇 포지션이 없습니다.");
    s.enabled=false;s.generation=randomUUID();s.nextAt=null;s.workflowId=null;
    s.pending="bi-close-"+randomUUID().replaceAll("-","").slice(0,24);
    return {id:s.pending,fresh:true,position:s.position};
  },mode);
  const p=claim.position;if(!p?.orderId)throw new Error("포지션 기록 확인 필요");
  try{
    let account=await api<Account>("/fapi/v2/account");
    const positions=account.positions.filter(p=>p.symbol==="BTCUSDT"&&Number(p.positionAmt)!==0);
    if(positions.length){
      if(positions.length!==1||Math.abs(Number(positions[0].positionAmt))-p.quantity>1e-8||Math.abs(Math.abs(Number(positions[0].positionAmt))-p.quantity)>1e-8||(Number(positions[0].positionAmt)>0)!==(p.side==="LONG"))throw new Error("거래소 포지션과 봇 기록이 다릅니다.");
      if(claim.fresh){
        await api("/fapi/v1/order","POST",{symbol:"BTCUSDT",side:p.side==="LONG"?"SELL":"BUY",positionSide:"BOTH",type:"MARKET",quantity:String(Math.abs(Number(positions[0].positionAmt))),reduceOnly:"true",newClientOrderId:claim.id,newOrderRespType:"RESULT"});
      }else{
        // Repeated clicks or timeouts only query the original order, never resend.
        await api("/fapi/v1/order","GET",{symbol:"BTCUSDT",origClientOrderId:claim.id});
      }
      account=await api<Account>("/fapi/v2/account");
      if(account.positions.some(p=>p.symbol==="BTCUSDT"&&Number(p.positionAmt)!==0))throw new Error("청산 체결 확인 중입니다.");
    }
    const fills=await api<Fill[]>("/fapi/v1/userTrades","GET",{symbol:"BTCUSDT",startTime:p.opened-1000,limit:1000});
    const provisional=settle(fills,p.orderId,p.quantity);
    const incomes=await api<{income:string;asset:string}[]>("/fapi/v1/income","GET",{symbol:"BTCUSDT",incomeType:"FUNDING_FEE",startTime:p.opened,endTime:Date.parse(provisional.exitTime),limit:1000});
    if(!Array.isArray(incomes)||incomes.length>=1000||incomes.some(i=>i.asset!=="USDT"||!Number.isFinite(Number(i.income))))throw new Error("펀딩 확인 필요");
    const result=settle(fills,p.orderId,p.quantity,incomes.reduce((n,i)=>n+Number(i.income),0));
    const orders=await api<{algoId:number;clientAlgoId:string}[]>("/fapi/v1/openAlgoOrders","GET",{symbol:"BTCUSDT"});
    for(const order of orders.filter(o=>[`bi-sl-${p.orderId}`,`bi-tp-${p.orderId}`].includes(o.clientAlgoId)))await api("/fapi/v1/algoOrder","DELETE",{symbol:"BTCUSDT",algoId:order.algoId});
    const balance=Number(account.totalWalletBalance);if(!Number.isFinite(balance))throw new Error("잔고 확인 필요");
    await changeState(s=>{
      if(s.pending!==claim.id)return;
      const trade=s.trades.findLast(t=>t.status==="OPEN");if(!trade)throw new Error("거래 기록 확인 필요");
      const entryFills=fills.filter(f=>f.orderId===p.orderId),entryQty=entryFills.reduce((n,f)=>n+Number(f.qty),0);
      Object.assign(trade,{...result,entry:entryFills.reduce((n,f)=>n+Number(f.qty)*Number(f.price),0)/entryQty,status:"CLOSED",result:result.pnl>0?"WIN":result.pnl<0?"LOSS":"BREAKEVEN"});
      s.position=null;s.pending=null;s.error=null;s.warning=null;s.balance=balance;s.lastAt=Date.now();s.losses=result.pnl<0?s.losses+1:0;s.history.push({time:new Date().toISOString(),balance});s.history=s.history.slice(-200);
    },mode);
    return {message:"포지션을 종료하고 최종 손익을 기록했습니다. 봇 시작을 누르면 다시 실행됩니다.",pnl:result.pnl};
  }catch{
    await changeState(s=>{if(s.pending===claim.id)s.error="청산 또는 정산 확인이 필요합니다. 종료 상태 확인으로 기존 주문을 조회하세요. 주문을 자동 재전송하지 않습니다.";},mode);
    throw new Error("청산 확인 필요");
  }
}
