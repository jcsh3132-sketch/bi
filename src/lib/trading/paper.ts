import type { BotState } from "./store";
import { analyze, exitPrice, nextTick, plan, type Candle } from "./strategy.ts";
export function paperCycle(s:BotState,candles:Candle[],price:number,now:number){
  const latest=candles.at(-1)!;
  s.lastAt=now;s.nextAt=nextTick(now);
  // Replayed steps, duplicate chains and simultaneous starts cannot enter twice.
  if(latest.time<=s.lastCandle)return;
  if(s.position&&s.position.opened<candles[0].time)throw new Error("복구할 캔들 범위를 초과했습니다. 포지션을 확인하세요.");
  const day=new Date(now).toISOString().slice(0,10);
  if(s.day!==day){s.day=day;s.dayBalance=s.balance;s.losses=0;}
  let exited=false;
  if(s.position){
    for(const c of candles){
      if(c.time<s.position.opened||c.time<=s.lastCandle)continue;
      const exit=exitPrice(s.position,c);
      if(exit===null)continue;
      const p=s.position, pnl=((p.side==="LONG"?1:-1)*(exit-p.entry)-.0005*(exit+p.entry))*p.quantity;
      s.balance+=pnl;s.losses=pnl<0?s.losses+1:0;
      const trade=s.trades.findLast(t=>t.status==="OPEN");
      if(!trade)throw new Error("포지션 기록이 일치하지 않습니다.");
      Object.assign(trade,{status:"CLOSED",exitTime:new Date(c.end).toISOString(),exit,pnl,result:pnl>0?"WIN":pnl<0?"LOSS":"BREAKEVEN"});
      s.position=null;exited=true;break;
    }
  }
  const signal=analyze(candles);s.signal=signal;
  // A late wake-up may reconcile exits but must not trade an old signal.
  const timely=now-latest.end<120000;
  const riskOK=s.balance>s.dayBalance*.97&&s.losses<3;
  if(!s.position&&!exited&&signal.side!=="WAIT"&&timely&&riskOK){
    const p=plan(candles,signal.side,s.balance,price);
    if(p){s.position={...p,opened:now};s.trades.push({id:(s.trades.at(-1)?.id||0)+1,side:p.side,status:"OPEN",entryTime:new Date(now).toISOString(),exitTime:null,entry:p.entry,exit:null,pnl:null,result:null});}
  }
  if(!timely)s.signal.reasons.push("지연된 신호의 신규 진입 생략");
  if(!riskOK)s.signal.reasons.push("일일 손실 또는 연속 손실 제한");
  s.lastCandle=latest.time;s.history.push({time:new Date(now).toISOString(),balance:s.balance});s.history=s.history.slice(-200);
}
