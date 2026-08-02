import { timingSafeEqual } from "node:crypto";
import { getConfig } from "./config.ts";

/**
 * Static-token guard for legacy admin endpoints. An empty configured token
 * (production without ADMIN_TOKEN set) never authorizes.
 */
export function isAdminAuthorized(req: Request): boolean {
  const adminToken = getConfig().auth.adminToken;
  if (!adminToken) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(adminToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
