import { COST_BUFFER, type Position } from "./strategy.ts";
export type Bracket={notionalFloor:number;notionalCap:number;initialLeverage:number;maintMarginRatio:number};
export function leverageIsSafe(position:Position,leverage:number,brackets:Bracket[]){
 const adverse=Math.abs(position.entry-position.stop)/position.entry+COST_BUFFER;
 const notional=position.entry*position.quantity*(1+adverse);
 if(!Number.isInteger(leverage)||leverage<1||!Number.isFinite(adverse)||!Array.isArray(brackets))return false;
 const bracket=brackets.find(b=>[b.notionalFloor,b.notionalCap,b.initialLeverage,b.maintMarginRatio].every(Number.isFinite)&&b.notionalFloor<=notional&&notional<b.notionalCap);
 return !!bracket&&bracket.maintMarginRatio>=0&&bracket.maintMarginRatio<1&&leverage<=bracket.initialLeverage&&adverse+bracket.maintMarginRatio*(1+adverse)<1/leverage;
}
export function liquidationIsSafe(p:Position,liquidation:number){
 if(!Number.isFinite(liquidation)||liquidation<0)return false;
 if(liquidation===0)return true;
 const buffer=p.entry*.001;
 return p.side==="LONG"?liquidation<p.stop-buffer:liquidation>p.stop+buffer;
}
