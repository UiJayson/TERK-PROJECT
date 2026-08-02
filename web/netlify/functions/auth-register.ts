import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import {
  createId,
  createSessionToken,
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
} from "./_shared/auth-crypto.ts";
import {
  authSuccessResponse,
  jsonResponse,
  optionsResponse,
  toPublicUser,
  toPublicWorkspace,
} from "./_shared/auth-http.ts";
import {
  createUserWithWorkspace,
  findUserByEmail,
  getWorkspaceRoleForUser,
} from "./_shared/auth-store.ts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.ts";

interface RegisterBody {
  name?: string;
  email?: string;
  password?: string;
  companyName?: string;
}

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const ip = clientIp(req);
  const limit = checkRateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonResponse(
      { error: "Too many registration attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const body = (await req.json()) as RegisterBody;
    const name = body.name?.trim() ?? "";
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const companyName = body.companyName?.trim() ?? "";

    if (!name || !email || !password || !companyName) {
      return jsonResponse({ error: "All fields are required." }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, { status: 400 });
    }

    if (!isValidPassword(password)) {
      return jsonResponse(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return jsonResponse({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const { user, workspace } = await createUserWithWorkspace({
      userId: createId("user"),
      email,
      name,
      passwordHash,
      workspaceId: createId("ws"),
      companyName,
    });

    const role = await getWorkspaceRoleForUser(workspace.id, user.id, workspace.ownerId);

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
    const message = error instanceof Error ? error.message : "Registration failed";
    if (message === "EMAIL_TAKEN") {
      return jsonResponse({ error: "An account with this email already exists." }, { status: 409 });
    }
    if (/Missing DATABASE_URL|database|ECONNREFUSED|connect/i.test(message)) {
      console.error("Registration failed (database):", message);
      return jsonResponse(
        {
          error:
            "Registration is temporarily unavailable — the database is not connected. Please try again shortly.",
        },
        { status: 503 },
      );
    }
    console.error("Registration failed:", message);
    return jsonResponse({ error: "Registration failed. Please try again." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/auth/register",
};

export default withObservability(handler);
