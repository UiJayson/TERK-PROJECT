import { createId } from "./auth-crypto.ts";
import * as db from "./db.ts";

const GRAPH_API_VERSION = "v18.0";

export interface InstagramSendResult {
  messageId?: string;
}

export class InstagramSenderError extends Error {
  status: number;
  code?: number;
  body: string;

  constructor(status: number, body: string, code?: number) {
    super(`Instagram API error (${status}): ${body}`);
    this.name = "InstagramSenderError";
    this.status = status;
    this.body = body;
    this.code = code;
  }

  get isTokenExpired(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

function graphUrl(businessAccountId: string): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}/messages`;
}

async function parseApiError(response: Response): Promise<InstagramSenderError> {
  const body = await response.text();
  let code: number | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; message?: string } };
    code = parsed.error?.code;
  } catch {
    // ignore JSON parse errors
  }
  return new InstagramSenderError(response.status, body, code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postMessage(
  businessAccountId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(graphUrl(businessAccountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function sendDM(
  toInstagramId: string,
  text: string,
  accessToken: string,
  businessAccountId: string,
  options?: { workspaceId?: string; queueOnFailure?: boolean },
): Promise<InstagramSendResult> {
  const body = {
    recipient: { id: toInstagramId },
    message: { text },
  };

  const rateLimitDelays = [2000, 4000];
  let serverRetried = false;

  for (let attempt = 0; attempt < rateLimitDelays.length + 2; attempt++) {
    const response = await postMessage(businessAccountId, accessToken, body);

    if (response.ok) {
      const data = (await response.json()) as { message_id?: string };
      console.info(`Instagram send OK to ${toInstagramId}:`, data.message_id ?? "no-id");
      return { messageId: data.message_id };
    }

    const error = await parseApiError(response);

    if (error.isTokenExpired) {
      console.error("Instagram token expired");
      throw error;
    }

    if (error.isRateLimited && attempt < rateLimitDelays.length) {
      const delay = rateLimitDelays[attempt];
      console.warn(`Instagram rate limited, retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    if (error.isServerError && !serverRetried) {
      serverRetried = true;
      console.warn("Instagram server error, retrying once");
      await sleep(1000);
      continue;
    }

    if (
      options?.queueOnFailure &&
      options.workspaceId &&
      error.isServerError
    ) {
      await db.insertPendingMessage({
        id: createId("pmsg"),
        workspaceId: options.workspaceId,
        toPhone: toInstagramId,
        messageText: text,
        phoneNumberId: businessAccountId,
        errorMessage: error.message,
      });
      console.warn(`Instagram message queued for retry (workspace ${options.workspaceId})`);
      return {};
    }

    throw error;
  }

  throw new InstagramSenderError(429, "Rate limit retries exhausted");
}
