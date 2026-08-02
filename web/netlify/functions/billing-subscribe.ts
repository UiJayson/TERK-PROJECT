import type { Config, Context } from "@netlify/functions";
import { withObservability } from "./_shared/observability.ts";
import {
  optionsResponse,
  requireAuthWithWorkspaceAccess,
} from "./_shared/auth-http.ts";
import { handleBillingSubscribe } from "./_shared/billing-subscribe-handler.ts";

async function handler(req: Request, _context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;

  return handleBillingSubscribe(req, auth);
}

export const config: Config = {
  path: "/api/billing/subscribe",
};

export default withObservability(handler);
