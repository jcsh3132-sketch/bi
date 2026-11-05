import fs from 'node:fs/promises';
import {analyzeEntry} from '../src/lib/trading/entry-filter.ts';
import {analyze,indicators} from '../src/lib/trading/strategy.ts';
import {simulate,hourlyDirections} from './lib/review-engine.mjs';
const candidates=['baseline','trend-quality','pullback','breakout'];
const results=[];
for(const period of ['recent-exploratory','independent-2025','fresh-2026-10']){
 const read=kind=>fs.readFile(`.local/research/review-v2-${period}-${kind}.json`,'utf8').then(JSON.parse);
 const [candles,marks,funding]=await Promise.all([read('trade'),read('mark'),read('funding')]);
 const signals=Object.fromEntries(candidates.map(id=>[id,[]]));
 for(let i=0;i<candles.length;i++){
  if(i<999){for(const id of candidates)signals[id].push('WAIT');continue;}
  const window=candles.slice(i-999,i+1),a=analyze(window),v=indicators(window).at(-1),long=a.side==='LONG',dir=long?1:-1;
  const quality=a.side!=='WAIT'&&a.regime===(long?'TREND_UP':'TREND_DOWN')&&v.adx>=25&&v.rsi>=(long?50:32)&&v.rsi<=(long?68:50)&&Math.abs(v.close-v.fast)<=1.5*v.atr;
  const prev=window.at(-2),last20=window.slice(-21,-1);
  const pullback=quality&&(long?Math.min(...window.slice(-4,-1).map(c=>c.low))<=v.fast&&v.close>prev.high:Math.max(...window.slice(-4,-1).map(c=>c.high))>=v.fast&&v.close<prev.low);
  const breakout=quality&&v.volumeRatio>=1.2&&(long?v.close>Math.max(...last20.map(c=>c.high)):v.close<Math.min(...last20.map(c=>c.low)));
  signals.baseline.push(a.side);signals['trend-quality'].push(quality?a.side:'WAIT');signals.pullback.push(analyzeEntry(window,'pullback').side);signals.breakout.push(breakout?a.side:'WAIT');
 }
 const start=period==='independent-2025'?candles.findIndex(c=>c.time>=Date.parse('2025-01-01')):period==='fresh-2026-10'?candles.findIndex(c=>c.time>=Date.parse('2026-10-08T08:00:00Z')):1000;
 const runs=candidates.map(id=>{const {records,monthly,...r}=simulate({candles,marks,funding,signals:signals[id],hourly:[],config:{id,rr:2},start});return r;});
 results.push({period,runs});console.log(JSON.stringify({period,runs}));
}
await fs.writeFile('.local/research/quality-review.json',JSON.stringify({candidates,results},null,2));
