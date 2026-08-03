import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "./config.ts";

const ALGO = "aes-256-gcm";
// v1 was keyed off AUTH_SECRET — decrypt-only, kept so tokens encrypted
// before the key split still work. Nothing encrypts to v1 anymore.
const PREFIX_V1 = "enc:v1:";
// v2 is keyed off the dedicated SECRET_ENCRYPTION_KEY (falls back to
// AUTH_SECRET if unset — see config.ts resolveSecretEncryptionKey).
const PREFIX_V2 = "enc:v2:";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function getEncryptionKey(): Buffer {
  return deriveKey(getConfig().auth.secretEncryptionKey);
}

function getLegacyEncryptionKey(): Buffer {
  return deriveKey(getConfig().auth.secret);
}

function decryptWithKey(value: string, prefix: string, key: Buffer): string {
  const parts = value.slice(prefix.length).split(":");
  if (parts.length !== 3) return value;

  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX_V2}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  if (!value) return "";
  if (value.startsWith(PREFIX_V2)) return decryptWithKey(value, PREFIX_V2, getEncryptionKey());
  if (value.startsWith(PREFIX_V1)) return decryptWithKey(value, PREFIX_V1, getLegacyEncryptionKey());
  return value;
}

export function hashVerifyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
}
