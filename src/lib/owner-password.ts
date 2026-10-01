import "server-only";
import { query, ready, transaction } from "./db.ts";
import { hashPassword, verifyPassword } from "./crypto.ts";

export async function ownerPasswordHash() {
  await ready();
  const rows = await query<{password_hash:string}>("SELECT password_hash FROM owner_auth WHERE id=$1", ["owner"]);
  return rows[0]?.password_hash || process.env.ADMIN_PASSWORD_HASH || "";
}
export async function changeOwnerPassword(current:string, next:string) {
  await ready();
  return transaction(async sql=>{
    // Materialize the bootstrap hash before locking, including the first change.
    await sql("INSERT INTO owner_auth(id,password_hash) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",["owner",process.env.ADMIN_PASSWORD_HASH || ""]);
    const rows=await sql<{password_hash:string}>("SELECT password_hash FROM owner_auth WHERE id=$1"+(process.env.DATABASE_URL?" FOR UPDATE":""),["owner"]);
    if(!verifyPassword(current,rows[0].password_hash))return false;
    await sql("UPDATE owner_auth SET password_hash=$1 WHERE id=$2",[hashPassword(next),"owner"]);
    await sql("DELETE FROM owner_sessions");
    return true;
  });
}
