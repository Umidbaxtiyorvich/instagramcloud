import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "v1";

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || "dev-only-insecure-key-change-me";
  return scryptSync(secret, "instagramcloud", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(packed: string): string {
  const [ver, ivB, tagB, dataB] = packed.split(".");
  if (ver !== PREFIX) throw new Error("Unknown token encoding");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB, "base64url")), decipher.final()]);
  return dec.toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
