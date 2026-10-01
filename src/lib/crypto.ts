import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

export function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, digest] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !digest || password.length > 512) return false;
  const expected = Buffer.from(digest, "base64url");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) { return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b))); }
export function encryptionKey() {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) throw new Error("암호화 키 설정을 확인하세요.");
  return key;
}
export function encrypt(value: string, context: string, key = encryptionKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function decrypt(value: string, context: string, key = encryptionKey()) {
  const [version, nonce, tag, body] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !body) throw new Error("저장된 키 형식 오류");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
