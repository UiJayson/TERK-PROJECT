import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "./config.ts";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  return createHash("sha256").update(getConfig().auth.secret).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value;
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return value;

  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(
    ALGO,
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function hashVerifyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}
