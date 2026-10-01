import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../src/lib/crypto.ts";
import { ownerPasswordHash, changeOwnerPassword } from "../src/lib/owner-password.ts";
import { query, ready } from "../src/lib/db.ts";
import { parseUsdtBalance } from "../src/lib/account-balance.ts";
process.env.LOCAL_DATABASE_PATH=`.local/auth-test-${randomUUID()}.db`;
process.env.ADMIN_PASSWORD_HASH=hashPassword("initial-test-password");
test("password changes persist, revoke sessions and never fall back to old bootstrap",async()=>{
  await ready();
  await query("INSERT INTO owner_sessions(token_hash,expires_at) VALUES($1,$2)",["test-session",Date.now()+60000]);
  assert.equal(await changeOwnerPassword("wrong","replacement-test-password"),false);
  assert.equal((await query("SELECT * FROM owner_sessions")).length,1);
  assert.equal(await changeOwnerPassword("initial-test-password","replacement-test-password"),true);
  assert.equal((await query("SELECT * FROM owner_sessions")).length,0);
  assert.equal(verifyPassword("replacement-test-password",await ownerPasswordHash()),true);
  process.env.ADMIN_PASSWORD_HASH=hashPassword("other-bootstrap-password");
  assert.equal(verifyPassword("other-bootstrap-password",await ownerPasswordHash()),false);
  assert.equal(await changeOwnerPassword("initial-test-password","another-password"),false);
});
test("wallet, available funds and cross profit remain separate; invalid data never becomes zero",()=>{
  assert.deepEqual(parseUsdtBalance([{asset:"USDT",balance:"3000.5",availableBalance:"2295.01",crossUnPnl:"-23.1"}]),{balance:3000.5,availableBalance:2295.01,crossUnPnl:-23.1});
  assert.throws(()=>parseUsdtBalance([]));
  assert.throws(()=>parseUsdtBalance([{asset:"USDT",balance:"",availableBalance:"1",crossUnPnl:"0"}]));
  assert.throws(()=>parseUsdtBalance([{asset:"USDT",balance:"NaN",availableBalance:"1",crossUnPnl:"0"}]));
});
