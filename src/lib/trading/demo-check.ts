import "server-only";
import { binance } from "./binance.ts";
export async function demoCheck(){
  const api=await binance("testnet");
  const account=await api<{multiAssetsMargin?:boolean;availableBalance:string;totalWalletBalance:string;positions:{symbol:string;positionAmt:string}[]}>("/fapi/v2/account");
  const positionMode=await api<{dualSidePosition:boolean}>("/fapi/v1/positionSide/dual");
  const orders=await api<unknown[]>("/fapi/v1/openOrders","GET",{symbol:"BTCUSDT"});
  const algoOrders=await api<unknown[]>("/fapi/v1/openAlgoOrders","GET",{symbol:"BTCUSDT"});
  const balance=Number(account.totalWalletBalance),availableBalance=Number(account.availableBalance);
  if(!Number.isFinite(balance)||!Number.isFinite(availableBalance)||availableBalance<=0)throw new Error("잔고 확인 필요");
  return {balance,availableBalance,multiAssets:!!account.multiAssetsMargin,hedgeMode:positionMode.dualSidePosition,positions:account.positions.filter(p=>p.symbol==="BTCUSDT"&&Number(p.positionAmt)!==0).length,openOrders:orders.length,algoOrders:algoOrders.length};
}
