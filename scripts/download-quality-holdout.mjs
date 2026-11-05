import fs from 'node:fs/promises';
const start=Date.parse('2026-09-27T22:00:00Z'),end=Date.parse('2026-11-05T00:00:00Z');
for(const [kind,path] of [['trade','klines'],['mark','markPriceKlines'],['funding','fundingRate']]){
 const file=`.local/research/review-v2-fresh-2026-10-${kind}.json`;try{await fs.access(file);continue;}catch{}
 let cursor=start,all=[];while(cursor<end){const r=await fetch(`https://fapi.binance.com/fapi/v1/${path}?symbol=BTCUSDT&limit=1000&startTime=${cursor}&endTime=${end-1}${kind==='funding'?'':'&interval=15m'}`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);const raw=await r.json();if(!raw.length)break;all.push(...(kind==='funding'?raw:raw.map(r=>({time:+r[0],end:+r[6],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]}))));cursor=kind==='funding'?raw.at(-1).fundingTime+1:+raw.at(-1)[0]+900000;}
 if(kind!=='funding'&&(all[0]?.time!==start||all.at(-1)?.end!==end-1||all.some((c,i)=>i&&c.time-all[i-1].time!==900000)))throw Error('Incomplete market period');await fs.writeFile(file,JSON.stringify(all));console.log(kind,all.length);
}
