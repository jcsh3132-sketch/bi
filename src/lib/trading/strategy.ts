export type Candle = { time: number; end: number; open: number; high: number; low: number; close: number; volume: number };
export type Side = "LONG" | "SHORT";
export const PERIOD = 15 * 60 * 1000;
export function nextTick(now: number) { return (Math.floor((now - 5000) / PERIOD) + 1) * PERIOD + 5000; }
function ewm(values: number[], alpha: number, minimum: number) {
  let current = NaN, count = 0;
  return values.map(value => { if (Number.isFinite(value)) { current = Number.isFinite(current) ? alpha * value + (1-alpha) * current : value; count++; } return count >= minimum ? current : NaN; });
}
export function indicators(c: Candle[]) {
  const close=c.map(v=>v.close), ema=(p:number)=>ewm(close,2/(p+1),p);
  const fast=ema(20), slow=ema(50), trend=ema(200), a=ema(12), b=ema(26);
  const macd=a.map((v,i)=>v-b[i]), signal=ewm(macd,2/10,9), hist=macd.map((v,i)=>v-signal[i]);
  const gain=ewm(close.map((v,i)=>i?Math.max(0,v-close[i-1]):NaN),1/14,14);
  const loss=ewm(close.map((v,i)=>i?Math.max(0,close[i-1]-v):NaN),1/14,14);
  const atr=ewm(c.map((v,i)=>Math.max(v.high-v.low,i?Math.abs(v.high-close[i-1]):0,i?Math.abs(v.low-close[i-1]):0)),1/14,14);
  const plus=ewm(c.map((v,i)=>{const up=i?v.high-c[i-1].high:0, down=i?c[i-1].low-v.low:0;return up>down&&up>0?up:0;}),1/14,14);
  const minus=ewm(c.map((v,i)=>{const up=i?v.high-c[i-1].high:0, down=i?c[i-1].low-v.low:0;return down>up&&down>0?down:0;}),1/14,14);
  const pdi=plus.map((v,i)=>atr[i]?100*v/atr[i]:NaN), mdi=minus.map((v,i)=>atr[i]?100*v/atr[i]:NaN);
  const adx=ewm(pdi.map((v,i)=>v+mdi[i]?100*Math.abs(v-mdi[i])/(v+mdi[i]):NaN),1/14,14);
  return c.map((v,i)=>({...v, fast:fast[i],slow:slow[i],trend:trend[i],macd:macd[i],hist:hist[i],macdSignal:signal[i],atr:atr[i],pdi:pdi[i],mdi:mdi[i],adx:adx[i],rsi:gain[i]===0?0:loss[i]===0?100:100-100/(1+gain[i]/loss[i]),volumeRatio:i>=19?v.volume/(c.slice(i-19,i+1).reduce((s,x)=>s+x.volume,0)/20):NaN}));
}
export function analyze(candles: Candle[]) {
  const rows=indicators(candles), v=rows.at(-1)!, previous=rows.at(-2)!;
  if(rows.length<200 || !v || !previous || ![v.fast,v.slow,v.trend,v.rsi,v.adx,v.atr,v.volumeRatio,v.hist].every(Number.isFinite)) throw new Error("지표용 캔들이 부족합니다.");
  let up=0,down=0,range=0;
  if(v.fast>v.slow&&v.slow>v.trend)up+=2;else if(v.fast<v.slow&&v.slow<v.trend)down+=2;else range++;
  up+=Number(v.close>v.trend);down+=Number(v.close<v.trend);
  if(v.adx>=23){if(v.pdi>v.mdi)up+=2;else if(v.mdi>v.pdi)down+=2;}else if(v.adx<=18)range+=2;
  const spread=Math.abs(v.fast-v.slow)/v.close*100;
  if(spread>=.18){if(v.fast>v.slow)up++;else down++;}else if(spread<=.08)range+=2;
  const old=rows.at(-4)!.fast,slope=(v.fast-old)/old*100;
  if(slope>=.03)up++;else if(slope<=-.03)down++;else range++;
  const recent=rows.slice(-20), high=Math.max(...recent.map(x=>x.high)),low=Math.min(...recent.map(x=>x.low));
  if((high-low)/((high+low)/2)*100<=1.2)range+=2;
  const regime=v.atr/v.close*100>=1.2?"HIGH_VOLATILITY":up>=5&&up>=down+2&&up>range?"TREND_UP":down>=5&&down>=up+2&&down>range?"TREND_DOWN":range>=4&&range>=Math.max(up,down)?"RANGE":"UNCERTAIN";
  let long=0,short=0;
  if(v.close>v.trend)long+=2;else if(v.close<v.trend)short+=2;
  if(v.fast>v.slow&&v.slow>v.trend)long+=2;else if(v.fast<v.slow&&v.slow<v.trend)short+=2;else if(v.fast>v.slow)long++;else if(v.fast<v.slow)short++;
  if(v.rsi>=50&&v.rsi<=72)long++;if(v.rsi>=28&&v.rsi<=50)short++;
  if(v.macd>v.macdSignal&&v.hist>0)long++;else if(v.macd<v.macdSignal&&v.hist<0)short++;
  if(v.hist>0&&v.hist>previous.hist)long++;else if(v.hist<0&&v.hist<previous.hist)short++;
  if(v.pdi>v.mdi)long++;else if(v.mdi>v.pdi)short++;
  if(v.adx>=18){if(v.pdi>v.mdi)long++;else if(v.mdi>v.pdi)short++;}
  if(v.volumeRatio>=.8){if(long>short)long++;else if(short>long)short++;}
  const reasons:string[]=[];
  if(v.adx<18)reasons.push("추세 강도 부족");if(v.volumeRatio<.8)reasons.push("거래량 부족");
  if(regime==="HIGH_VOLATILITY")reasons.push("높은 변동성에서는 진입 대기");
  const threshold=regime==="UNCERTAIN"?7:regime==="RANGE"?8:6;
  const side:Side|"WAIT"=reasons.length?"WAIT":long>=threshold&&long-short>=2&&v.close>v.trend&&regime!=="TREND_DOWN"?"LONG":short>=threshold&&short-long>=2&&v.close<v.trend&&regime!=="TREND_UP"?"SHORT":"WAIT";
  if(side==="WAIT"&&!reasons.length)reasons.push("진입 점수 미충족");
  return {side,regime,longScore:long,shortScore:short,candleTime:new Date(v.time).toISOString(),reasons,atr:v.atr};
}
export function plan(c:Candle[],side:Side,balance:number,entry=c.at(-1)!.close,fixed?:{margin:number;leverage:number}) {
  const atr=indicators(c).at(-1)!.atr, direction=side==="LONG"?1:-1, recent=c.slice(-10);
  const swing=side==="LONG"?Math.min(...recent.map(v=>v.low))-.2*atr:Math.max(...recent.map(v=>v.high))+.2*atr;
  const distance=Math.max(1.5*atr,Math.abs(entry-swing),entry*.0035);
  if(!Number.isFinite(distance)||distance<=0||distance/entry>.015||balance<=0)return null;
  const quantity=fixed?fixed.margin*fixed.leverage/entry:Math.min(balance*.005*.999/distance,balance/entry);
  if(!Number.isFinite(quantity)||quantity<=0)return null;
  if(quantity*entry<10)return null;
  return {side,entry,stop:entry-direction*distance,target:entry+direction*distance*2,quantity};
}
export type Position = NonNullable<ReturnType<typeof plan>> & { opened: number; orderId?: number };
export function exitPrice(position:Position,c:Candle) {
  const long=position.side==="LONG",stop=long?c.low<=position.stop:c.high>=position.stop,target=long?c.high>=position.target:c.low<=position.target;
  // Candle data cannot reveal intrabar order: assume stop first when both touched.
  if(stop)return long?Math.min(c.open,position.stop):Math.max(c.open,position.stop);
  if(target)return position.target;
  return null;
}
