import {analyze,indicators,type Candle} from './strategy.ts';
export function analyzeEntry(c:Candle[],filter:'baseline'|'pullback'='pullback'){
 const signal=analyze(c);if(filter==='baseline'||signal.side==='WAIT')return signal;
 const v=indicators(c).at(-1)!,long=signal.side==='LONG',previous=c.at(-2)!;
 const quality=signal.regime===(long?'TREND_UP':'TREND_DOWN')&&v.adx>=25&&v.rsi>=(long?50:32)&&v.rsi<=(long?68:50)&&Math.abs(v.close-v.fast)<=1.5*v.atr;
 const retraced=long?Math.min(...c.slice(-4,-1).map(x=>x.low))<=v.fast&&v.close>previous.high:Math.max(...c.slice(-4,-1).map(x=>x.high))>=v.fast&&v.close<previous.low;
 return quality&&retraced?signal:{...signal,side:'WAIT' as const,reasons:[...signal.reasons,'추세·과열 회피·눌림목 후 재돌파 조건 대기']};
}
