import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import { getSiteUrl, isProduction } from "./_shared/config.ts";
import {
  createResetToken,
  hashToken,
  isValidEmail,
  normalizeEmail,
} from "./_shared/auth-crypto.ts";
import { sendEmail } from "./_shared/email.ts";
import { jsonResponse, optionsResponse } from "./_shared/auth-http.ts";
import { findUserByEmail, savePasswordReset } from "./_shared/auth-store.ts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.ts";

interface ForgotBody {
  email?: string;
}

function dashboardOrigin(req: Request): string {
  return req.headers.get("origin") ?? getSiteUrl();
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      return jsonResponse(
        { error: "Too many reset requests. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const body = (await req.json()) as ForgotBody;
    const email = normalizeEmail(body.email ?? "");

    const genericMessage =
      "If an account exists for that email, password reset instructions have been sent.";

    if (!email || !isValidEmail(email)) {
      return jsonResponse({ message: genericMessage });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return jsonResponse({ message: genericMessage });
    }

    const token = createResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await savePasswordReset({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt,
      used: false,
    });

    const origin = dashboardOrigin(req);
    const resetUrl = `${origin}/reset-password?token=${token}`;

    await sendEmail({
      to: email,
      subject: "[AI OS] Reset your password",
      text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
      html: `<p>Click to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
    });

    const includeResetLink = !isProduction();

    return jsonResponse({
      message: genericMessage,
      ...(includeResetLink ? { resetUrl } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return jsonResponse({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/auth/forgot-password",
};

export default withObservability(handler);
