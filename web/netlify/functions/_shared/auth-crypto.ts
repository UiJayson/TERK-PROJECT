import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getConfig, isProduction } from "./config.ts";
import type { SessionPayload } from "./auth-types.ts";

const SESSION_COOKIE = "aios_session";
// 24h access tokens with sliding renewal: /api/auth/me re-issues a fresh
// token on each app load, so active users stay signed in while idle or
// stolen tokens expire within a day.
const SESSION_TTL_SECONDS = 60 * 60 * 24;

function getSecretKey() {
  return new TextEncoder().encode(getConfig().auth.secret);
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    workspaceId: payload.workspaceId,
    role: payload.role,
    sessionVersion: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.workspaceId !== "string") {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      workspaceId: payload.workspaceId,
      role:
        payload.role === "owner" || payload.role === "admin" || payload.role === "staff"
          ? payload.role
          : "owner",
      sessionVersion:
        typeof payload.sessionVersion === "number" ? payload.sessionVersion : 0,
    };
  } catch {
    return null;
  }
}

export function createResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieHeader(token: string): string {
  const secure = isProduction() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = isProduction() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readSessionToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8;
}
