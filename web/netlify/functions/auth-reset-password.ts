import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import {
  hashPassword,
  hashToken,
  isValidPassword,
} from "./_shared/auth-crypto.ts";
import { jsonResponse, optionsResponse } from "./_shared/auth-http.ts";
import { consumePasswordReset, updateUserPassword } from "./_shared/auth-store.ts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.ts";

interface ResetBody {
  token?: string;
  password?: string;
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`reset:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      return jsonResponse(
        { error: "Too many reset attempts. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const body = (await req.json()) as ResetBody;
    const token = body.token?.trim() ?? "";
    const password = body.password ?? "";

    if (!token || !password) {
      return jsonResponse({ error: "Token and password are required." }, { status: 400 });
    }

    if (!isValidPassword(password)) {
      return jsonResponse(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }

    const reset = await consumePasswordReset(hashToken(token));
    if (!reset) {
      return jsonResponse(
        { error: "This reset link is invalid or has expired." },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(password);
    await updateUserPassword(reset.userId, passwordHash);

    return jsonResponse({ message: "Password updated. You can sign in now." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reset failed";
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/auth/reset-password",
};

export default withObservability(handler);
