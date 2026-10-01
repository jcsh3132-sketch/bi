import "server-only";
import type { Candle } from "./strategy";
export async function marketData(mode="paper"):Promise<{candles:Candle[];price:number;serverTime:number}>{
  const base=mode==="testnet"?"https://demo-fapi.binance.com":"https://fapi.binance.com";
  async function get(path:string){const res=await fetch(base+path,{cache:"no-store",signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error("시장 데이터 연결 실패");return res.json();}
  const clock=await get("/fapi/v1/time");
  const serverTime=Number(clock.serverTime);
  if(!Number.isFinite(serverTime)||Math.abs(serverTime-Date.now())>60000)throw new Error("시장 시각 검증 실패");
  const raw=await get("/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000");
  if(!Array.isArray(raw))throw new Error("시장 데이터 형식 오류");
  const candles=raw.map((r:unknown[])=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),end:Number(r[6])})).filter(c=>c.end<serverTime);
  if(candles.length<200||candles.some(c=>![c.time,c.open,c.high,c.low,c.close,c.volume,c.end].every(Number.isFinite)||c.close<=0))throw new Error("시장 데이터 검증 실패");
  for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==900000)throw new Error("캔들 구간 누락");
  if(serverTime-candles.at(-1)!.end>960000)throw new Error("오래된 시장 데이터");
  const ticker=await get("/fapi/v1/ticker/price?symbol=BTCUSDT"),price=Number(ticker.price);
  if(!Number.isFinite(price)||price<=0)throw new Error("시장 가격 검증 실패");
  return {candles,price,serverTime};
}
