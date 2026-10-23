import {exitPrice,plan,indicators,analyze} from '../../src/lib/trading/strategy.ts';
export function confidence(wins,total){if(!total)return [0,1];const z=1.96,p=wins/total,d=1+z*z/total,center=(p+z*z/(2*total))/d,half=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;return [center-half,center+half];}
export function hourlyDirections(candles){
 const hours=[];for(let i=0;i<candles.length;){const t=Math.floor(candles[i].time/3600000)*3600000,group=[];while(i<candles.length&&Math.floor(candles[i].time/3600000)*3600000===t)group.push(candles[i++]);if(group.length===4&&group[0].time===t)hours.push({time:t,end:t+3599999,open:group[0].open,high:Math.max(...group.map(c=>c.high)),low:Math.min(...group.map(c=>c.low)),close:group.at(-1).close,volume:group.reduce((s,c)=>s+c.volume,0)});}
 const rows=indicators(hours);let h=-1;return candles.map(c=>{while(h+1<rows.length&&rows[h+1].end<=c.end)h++;const v=rows[h];return v&&Number.isFinite(v.slow)?v.fast>v.slow&&v.close>v.fast?'LONG':v.fast<v.slow&&v.close<v.fast?'SHORT':'WAIT':'WAIT';});
}
export function prepareSignals(candles){return candles.map((c,i)=>i<999?'WAIT':analyze(candles.slice(i-999,i+1)).side);}
export function simulate({candles,marks,funding,signals,hourly,config,start=1000,end=candles.length,fee=.0005,slip=.0002,planner=plan,initial=1000}){
 let balance=initial,peak=initial,drawdown=0,pos=null,eligible=0,day='',dayBalance=initial,losses=0;const trades=[],curve=[],fundMap=new Map();for(const f of funding){const t=Math.floor(f.fundingTime/900000)*900000;fundMap.set(t,[...(fundMap.get(t)||[]),f]);}
 const markByTime=new Map(marks.map(c=>[c.time,c]));
 function close(fill,i,reason){const c=candles[i],dir=pos.side==='LONG'?1:-1,exit=fill*(1-dir*slip),gross=dir*(exit-pos.entry)*pos.quantity,exitFee=exit*pos.quantity*fee,net=gross-pos.entryFee-exitFee+pos.funding;balance+=gross-exitFee;trades.push({entryTime:pos.time,exitTime:c.end,side:pos.side,entry:pos.entry,exit,net,gross,fees:pos.entryFee+exitFee,funding:pos.funding,width:pos.width,reason});losses=net<0?losses+1:0;pos=null;eligible=i+2;}
 for(let i=start;i<end;i++){
  const c=candles[i],m=markByTime.get(c.time);if(!m)throw Error('Missing mark bar '+c.time);const today=new Date(c.time).toISOString().slice(0,10);if(today!==day){day=today;dayBalance=balance;losses=0;}
  if(pos){for(const f of fundMap.get(c.time)||[]){const value=-(pos.side==='LONG'?1:-1)*pos.quantity*Number(f.markPrice)*Number(f.fundingRate);pos.funding+=value;balance+=value;}}
  if(!pos&&i>=eligible&&i<end-1&&balance>dayBalance*.97&&losses<3){const side=signals[i-1];if(side!=='WAIT'&&(!config.confirmHour||hourly[i-1]===side)){
   const p=planner(candles.slice(Math.max(0,i-1000),i),side,balance,c.open,undefined,{maxStopPercent:1.5,rewardRisk:config.rr});
   if(p){const quantity=Math.floor((p.quantity+Number.EPSILON)/.001)*.001,stop=Math.floor((p.stop+Number.EPSILON)/.1)*.1,target=Math.floor((p.target+Number.EPSILON)/.1)*.1,entry=c.open*(1+(side==='LONG'?1:-1)*slip);if(quantity>0&&quantity*entry>=100){const entryFee=entry*quantity*fee;pos={side,entry,quantity,stop,target,entryFee,funding:0,time:c.time+5000,width:Math.abs(c.open-stop)/c.open*100};balance-=entryFee;}}
  }}
  if(pos){const trigger=exitPrice({...pos,opened:pos.time},m);if(trigger!==null){const basis=c.open-m.open;close(trigger+basis,i,Math.abs(trigger-pos.target)<1e-6?'target':'stop');}}
  const equity=balance+(pos?(pos.side==='LONG'?1:-1)*(c.close-pos.entry)*pos.quantity-pos.quantity*c.close*fee:0);peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak*100);curve.push({time:c.end,equity});
 }
 const wins=trades.filter(t=>t.net>0),profits=wins.reduce((s,t)=>s+t.net,0),loss=-trades.filter(t=>t.net<0).reduce((s,t)=>s+t.net,0),monthly={};for(const t of trades){const month=new Date(t.exitTime).toISOString().slice(0,7);const m=monthly[month]??={trades:0,wins:0,net:0};m.trades++;m.wins+=Number(t.net>0);m.net+=t.net;}
 return {id:config.id,trades:trades.length,wins:wins.length,winRate:trades.length?wins.length/trades.length*100:0,winRate95:confidence(wins.length,trades.length).map(n=>n*100),net:trades.reduce((s,t)=>s+t.net,0),returnPct:(curve.at(-1).equity/initial-1)*100,profitFactor:loss?profits/loss:null,maxDrawdown:drawdown,averageWin:wins.length?profits/wins.length:0,averageLoss:trades.length>wins.length?loss/(trades.length-wins.length):0,fees:trades.reduce((s,t)=>s+t.fees,0),funding:trades.reduce((s,t)=>s+t.funding,0),openPosition:!!pos,monthly,records:trades};
}
