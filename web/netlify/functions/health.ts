import type { Config, Context } from "@netlify/functions";
import { getServiceHealth } from "./_shared/config.ts";

async function handler(_req: Request, _context: Context) {
  try {
    const services = getServiceHealth();

    return Response.json({
      status: "ok",
      services,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    return Response.json({ status: "error", error: message }, { status: 500 });
  }
}

export const config: Config = {
  path: "/.netlify/functions/health",
};

export default handler;
