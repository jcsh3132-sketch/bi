export type Fill={orderId:number;qty:string;price:string;realizedPnl:string;commission:string;commissionAsset:string;time:number};
export function settle(fills:Fill[],orderId:number,expectedQuantity:number,funding=0){
  const entry=fills.filter(f=>f.orderId===orderId),exits=fills.filter(f=>f.orderId!==orderId);
  if(!entry.length||!exits.length||fills.length>=1000||fills.some(f=>f.commissionAsset!=="USDT"||![Number(f.qty),Number(f.price),Number(f.realizedPnl),Number(f.commission),f.time].every(Number.isFinite)||Number(f.qty)<=0||Number(f.price)<=0)||!Number.isFinite(funding))throw new Error("체결 기록 확인 필요");
  const quantity=exits.reduce((n,f)=>n+Number(f.qty),0);
  if(Math.abs(quantity-expectedQuantity)>1e-8||Math.abs(entry.reduce((n,f)=>n+Number(f.qty),0)-expectedQuantity)>1e-8)throw new Error("체결 수량 불일치");
  const exit=exits.reduce((n,f)=>n+Number(f.qty)*Number(f.price),0)/quantity;
  const grossPnl=fills.reduce((n,f)=>n+Number(f.realizedPnl),0),fees=fills.reduce((n,f)=>n+Number(f.commission),0);
  return {exit,grossPnl,fees,funding,pnl:grossPnl-fees+funding,exitTime:new Date(Math.max(...exits.map(f=>f.time))).toISOString()};
}
