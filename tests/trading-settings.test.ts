import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSettings, saveSettings, settingsSchema } from "../src/lib/trading/settings.ts";
import { parseExchangeView } from "../src/lib/trading/exchange-view.ts";
import { plan, type Candle } from "../src/lib/trading/strategy.ts";
process.env.LOCAL_DATABASE_PATH=`.local/settings-test-${randomUUID()}.db`;
test("custom sizing persists per account; leverage bounds reject invalid settings",async()=>{
  await saveSettings({environment:"testnet",leverage:5,sizing:"fixed",margin:100});
  assert.equal((await getSettings("testnet")).leverage,5);
  assert.equal((await getSettings("testnet")).margin,100);
  assert.equal((await getSettings("mainnet")).sizing,"auto");
  for(const leverage of [0,126,2.5])assert.equal(settingsSchema.safeParse({environment:"testnet",leverage,sizing:"fixed",margin:100}).success,false);
});
test("positions and native algo stops/targets retain exchange trigger prices",()=>{
  const view=parseExchangeView([{symbol:"BTCUSDT",positionSide:"BOTH",positionAmt:"-0.02",entryPrice:"84000",markPrice:"83000",liquidationPrice:"90000",unRealizedProfit:"20"},{symbol:"ETHUSDT",positionAmt:"0"}],[],[{algoId:1,symbol:"BTCUSDT",side:"BUY",orderType:"STOP_MARKET",triggerPrice:"85000",closePosition:true},{algoId:2,symbol:"BTCUSDT",side:"BUY",orderType:"TAKE_PROFIT_MARKET",triggerPrice:"82000",closePosition:true}]);
  assert.equal(view.positions.length,1);assert.equal(view.positions[0].side,"SHORT");assert.equal(view.positions[0].quantity,.02);
  assert.equal(view.orders[0].trigger,85000);assert.equal(view.orders[1].trigger,82000);assert.equal(view.orders[0].closePosition,true);
});
test("fixed margin times leverage sets notional while preserving protective prices",()=>{
  const c:Candle[]=Array.from({length:300},(_,i)=>({time:i*900000,end:(i+1)*900000-1,open:10000+i,close:10001+i,high:10010+i,low:9990+i,volume:100}));
  const automatic=plan(c,"LONG",1000,10300)!;
  const custom=plan(c,"LONG",1000,10300,{margin:100,leverage:5})!;
  assert.ok(custom);assert.equal(custom.quantity*custom.entry,500);assert.equal(custom.stop,automatic.stop);assert.equal(custom.target,automatic.target);
});
