import { createHash } from "node:crypto";
import { jsonResponse } from "./auth-http.ts";

/**
 * HTTP-level caching for authenticated JSON APIs.
 *
 * - ETag + If-None-Match: a 304 costs ~0 bytes on the wire and lets the
 *   browser reuse its copy; the dashboard polls several endpoints, so most
 *   polls collapse to 304s when nothing changed.
 * - Cache-Control is always `private` (responses are per-user/per-workspace;
 *   they must never land in the shared CDN cache).
 * - Body compression is NOT done here: Netlify's edge already applies
 *   gzip/brotli to function responses based on Accept-Encoding.
 */

export interface CacheOptions {
  /** max-age in seconds for the browser cache. 0 = always revalidate. */
  maxAgeSeconds?: number;
  /** Extra headers to merge into the response. */
  headers?: Record<string, string>;
}

export function computeEtag(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * JSON response with ETag revalidation. Returns 304 (empty body) when the
 * client already holds the current version.
 */
export function cachedJsonResponse(
  req: Request,
  body: unknown,
  options: CacheOptions = {},
): Response {
  const serialized = JSON.stringify(body);
  const etag = computeEtag(serialized);
  const maxAge = options.maxAgeSeconds ?? 0;
  const cacheControl =
    maxAge > 0
      ? `private, max-age=${maxAge}, must-revalidate`
      : "private, no-cache";

  const commonHeaders = {
    ETag: etag,
    "Cache-Control": cacheControl,
    Vary: "Authorization",
    ...(options.headers ?? {}),
  };

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: commonHeaders });
  }

  return jsonResponse(body, { headers: commonHeaders });
}
