import { createHash } from "node:crypto";
import { createId } from "./auth-crypto.ts";
import { resolveEmbeddingModel, resolveProviderName } from "./ai-providers/pricing.ts";
import { aiResponseCache } from "./cache.ts";
import {
  CircuitOpenError,
  ConcurrencyLimiter,
  getCircuitBreaker,
} from "./circuit-breaker.ts";
import * as db from "./db.ts";
import {
  AnthropicProvider,
  isAnthropicFallbackEligible,
} from "./ai-providers/anthropic-provider.ts";
import { NetlifyAIProvider } from "./ai-providers/netlify-provider.ts";
import { OpenAIProvider } from "./ai-providers/openai-provider.ts";
import type {
  AIProvider,
  AIProviderName,
  GenerateResponseInput,
  GenerateResponseResult,
} from "./ai-providers/types.ts";
import { AIEngineError } from "./ai-providers/types.ts";

export { formatPrompt } from "./ai-providers/format-prompt.ts";
export type {
  AIProviderName,
  AIMessage,
  GenerateResponseInput,
  GenerateResponseResult,
  TokenUsage,
} from "./ai-providers/types.ts";
export { AIEngineError } from "./ai-providers/types.ts";
export { AnthropicProviderError } from "./ai-providers/anthropic-provider.ts";

const GRACEFUL_ERROR_REPLY =
  "I'm having trouble connecting to our AI service right now. Please try again in a moment, or ask to speak with a human.";

const SERVICE_UNAVAILABLE = "AI service temporarily unavailable";

function createProvider(name: AIProviderName): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "netlify":
      return new NetlifyAIProvider();
    case "anthropic":
    default:
      return new AnthropicProvider();
  }
}

let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!cachedProvider) {
    cachedProvider = createProvider(resolveProviderName());
  }
  return cachedProvider;
}

export function isAIEngineConfigured(): boolean {
  const primary = getAIProvider();
  if (primary.isConfigured()) return true;
  if (resolveProviderName() === "anthropic") {
    return new OpenAIProvider().isConfigured();
  }
  return false;
}

export function resetAIProviderCache(): void {
  cachedProvider = null;
}

async function logUsage(
  input: GenerateResponseInput,
  result: GenerateResponseResult,
): Promise<void> {
  const logEntry = {
    provider: result.provider,
    model: result.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cost_estimate: result.usage.estimatedCostUsd,
    workspace_id: input.workspaceId ?? null,
    operation: input.operation ?? "chat",
  };
  console.info("AI usage:", JSON.stringify(logEntry));

  if (!input.workspaceId) return;

  try {
    await db.logAIUsage({
      id: createId("aiuse"),
      workspaceId: input.workspaceId,
      provider: result.provider,
      model: result.model,
      operation: input.operation ?? "chat",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.estimatedCostUsd,
    });
    const { incrementAiTokenUsage } = await import("./usage-limits.ts");
    await incrementAiTokenUsage(
      input.workspaceId,
      result.usage.inputTokens + result.usage.outputTokens,
    );
  } catch (error) {
    console.warn("AI usage logging failed:", error);
  }
}

// At most 8 provider calls in flight per instance; the rest queue (FIFO).
// Prevents a burst from stacking hundreds of concurrent provider requests.
const aiLimiter = new ConcurrencyLimiter(8, 200);

const AI_CACHE_TTL_MS = 3_600_000; // identical question → cached answer for 1h

/**
 * Cache key covers the full conversational state (system prompt, history,
 * message) plus workspace and provider, so only truly identical requests can
 * share an answer — a repeated FAQ hits, a mid-conversation turn won't.
 */
function aiCacheKey(input: GenerateResponseInput, providerName: string): string {
  const digest = createHash("sha1")
    .update(JSON.stringify({ ...input, workspaceId: input.workspaceId ?? "" }))
    .digest("base64url");
  return `ai:${providerName}:${input.workspaceId ?? "global"}:${digest}`;
}

async function attemptGenerate(
  provider: AIProvider,
  input: GenerateResponseInput,
): Promise<GenerateResponseResult> {
  const { timedOperation } = await import("./observability.ts");
  const breaker = getCircuitBreaker(`ai:${provider.name}`, {
    failureThreshold: 5,
    windowMs: 30_000,
    openMs: 60_000,
  });
  const result = await breaker.execute(() =>
    aiLimiter.run(() =>
      timedOperation(
        {
          category: "ai",
          operation: input.operation ?? "chat",
          workspaceId: input.workspaceId,
        },
        () => provider.generateResponse(input),
      ),
    ),
  );
  await logUsage(input, result);
  return result;
}

export async function generateResponse(
  input: GenerateResponseInput,
): Promise<GenerateResponseResult> {
  const primaryName = resolveProviderName();
  const primary = createProvider(primaryName);

  if (!primary.isConfigured()) {
    throw new AIEngineError(
      `${primary.name} provider is not configured`,
      primary.name,
    );
  }

  const cacheKey = aiCacheKey(input, primaryName);
  const cached = aiResponseCache.get(cacheKey) as GenerateResponseResult | undefined;
  if (cached) return cached;

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await attemptGenerate(primary, input);
      aiResponseCache.set(cacheKey, result, AI_CACHE_TTL_MS);
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof CircuitOpenError) break; // fail fast, no retry
      if (attempt === 0) {
        console.warn(`${primary.name} request failed, retrying once:`, error);
      }
    }
  }

  if (primaryName === "anthropic") {
    const fallback = new OpenAIProvider();
    if (fallback.isConfigured()) {
      const errorMessage =
        lastError instanceof Error ? lastError.message : String(lastError);
      console.warn(`Anthropic failed [${errorMessage}], falling back to OpenAI`);
      try {
        const result = await attemptGenerate(fallback, input);
        aiResponseCache.set(aiCacheKey(input, fallback.name), result, AI_CACHE_TTL_MS);
        return result;
      } catch (fallbackError) {
        console.error("OpenAI fallback also failed:", fallbackError);
        throw new AIEngineError(SERVICE_UNAVAILABLE, "openai", true);
      }
    }
  }

  if (isAnthropicFallbackEligible(lastError)) {
    throw new AIEngineError(SERVICE_UNAVAILABLE, primaryName, true);
  }

  throw new AIEngineError(
    lastError instanceof Error ? lastError.message : "AI request failed",
    primaryName,
    true,
  );
}

export async function generateEmbedding(
  text: string,
  workspaceId?: string,
): Promise<number[] | null> {
  const provider = getAIProvider();
  if (!provider.isConfigured()) return null;

  try {
    const embedding = await provider.generateEmbedding(text);
    if (embedding && workspaceId) {
      const model = resolveEmbeddingModel();
      const inputTokens = provider.countTokens(text);
      await db.logAIUsage({
        id: createId("aiuse"),
        workspaceId,
        provider: provider.name === "anthropic" ? "openai" : provider.name,
        model,
        operation: "embedding",
        inputTokens,
        outputTokens: 0,
        estimatedCostUsd: (inputTokens / 1_000_000) * 0.02,
      });
    }
    return embedding;
  } catch (error) {
    console.warn("Embedding generation failed:", error);
    return null;
  }
}

export function countTokens(text: string): number {
  return getAIProvider().countTokens(text);
}

export function getGracefulAIErrorReply(): string {
  return GRACEFUL_ERROR_REPLY;
}

export function isServiceUnavailableError(error: unknown): boolean {
  return error instanceof AIEngineError && error.message === SERVICE_UNAVAILABLE;
}

/** Convenience alias matching milestone spec naming. */
export const aiEngine = {
  generateResponse,
  generateEmbedding,
  countTokens,
  getProvider: getAIProvider,
  isConfigured: isAIEngineConfigured,
  getGracefulErrorReply: getGracefulAIErrorReply,
};
