import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import {
  createSessionToken,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from "./_shared/auth-crypto.ts";
import {
  authSuccessResponse,
  jsonResponse,
  optionsResponse,
  toPublicUser,
  toPublicWorkspace,
} from "./_shared/auth-http.ts";
import {
  findUserByEmail,
  findWorkspaceById,
  getWorkspaceRoleForUser,
} from "./_shared/auth-store.ts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.ts";
import { log } from "./_shared/logger.ts";

interface LoginBody {
  email?: string;
  password?: string;
}

// Failed attempts per IP tracked over an hour (wider than the hard rate
// limit); crossing this threshold emits an error-level event ops can alert on.
const BRUTE_FORCE_ALERT_THRESHOLD = 10;
const failedAttemptsByIp = new Map<string, { count: number; resetAt: number }>();

function recordFailedLogin(ip: string, email: string): void {
  log.warn("auth_login_failed", { function: "auth-login", ip, email });

  const now = Date.now();
  const entry = failedAttemptsByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    failedAttemptsByIp.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count === BRUTE_FORCE_ALERT_THRESHOLD) {
    log.error("auth_bruteforce_suspected", {
      function: "auth-login",
      ip,
      failedAttempts: entry.count,
    });
  }
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`login:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      return jsonResponse(
        { error: "Too many login attempts. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const body = (await req.json()) as LoginBody;
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (!email || !password || !isValidEmail(email)) {
      return jsonResponse({ error: "Invalid email or password." }, { status: 401 });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      recordFailedLogin(ip, email);
      return jsonResponse({ error: "Invalid email or password." }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordFailedLogin(ip, email);
      return jsonResponse({ error: "Invalid email or password." }, { status: 401 });
    }

    const workspaceId = user.workspaceIds[0];
    const workspace = workspaceId ? await findWorkspaceById(workspaceId) : null;
    if (!workspace) {
      return jsonResponse({ error: "Workspace not found for this account." }, { status: 500 });
    }

    const role = await getWorkspaceRoleForUser(workspace.id, user.id, workspace.ownerId);
    log.info("auth_login_success", { function: "auth-login", ip, userId: user.id });

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      workspaceId: workspace.id,
      role,
      sessionVersion: user.sessionVersion,
    });

    return authSuccessResponse(
      {
        user: toPublicUser(user),
        workspace: toPublicWorkspace(workspace),
        role,
      },
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    log.error("auth_login_error", {
      function: "auth-login",
      error: message,
    });
    if (/Missing DATABASE_URL|database|ECONNREFUSED|connect/i.test(message)) {
      return jsonResponse(
        {
          error:
            "Sign-in is temporarily unavailable — the database is not connected. Please try again shortly.",
        },
        { status: 503 },
      );
    }
    return jsonResponse({ error: "Login failed. Please try again." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/auth/login",
};

export default withObservability(handler);
