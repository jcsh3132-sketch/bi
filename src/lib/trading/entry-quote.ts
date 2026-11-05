import type {Position} from './strategy.ts';
export function entryQuoteIssue(p:Omit<Position,'opened'>,mark:number,bid:number,ask:number){
 if(![mark,bid,ask].every(n=>Number.isFinite(n)&&n>0)||ask<bid)return '호가·마크 가격 확인 실패';
 const mid=(bid+ask)/2,execution=p.side==='LONG'?ask:bid,distance=Math.abs(p.entry-p.stop);
 if((ask-bid)/mid>.001)return '매수·매도 호가 차이가 0.1%를 넘어 진입 대기';
 if(Math.abs(execution-p.entry)>Math.min(distance*.25,p.entry*.001))return '신호 가격에서 호가가 멀어져 추격 진입 생략';
 if(Math.abs(mark-execution)>Math.min(distance*.5,p.entry*.002))return '마크·체결 예상 가격 차이가 커 진입 생략';
 if(p.side==='LONG'?mark<=p.stop||mark>=p.target:mark>=p.stop||mark<=p.target)return '마크 가격이 보호 주문 범위 밖이므로 진입 생략';
 return null;
}
