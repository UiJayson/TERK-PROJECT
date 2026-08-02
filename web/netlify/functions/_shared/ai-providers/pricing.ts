import { getConfig } from "../config.ts";
import type { AIProviderName } from "./types.ts";

/** Rough USD pricing per 1M tokens (input / output). */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? { input: 1, output: 3 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export function countTokensHeuristic(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function resolveProviderName(): AIProviderName {
  return getConfig().anthropic.provider;
}

export function resolveChatModel(provider: AIProviderName): string {
  const configuredModel = getConfig().anthropic.model;
  if (configuredModel) {
    return configuredModel;
  }

  switch (provider) {
    case "anthropic":
      return "claude-3-5-sonnet-20241022";
    case "openai":
    case "netlify":
    default:
      return "gpt-4o-mini";
  }
}

export function resolveEmbeddingModel(): string {
  return getConfig().anthropic.embeddingModel;
}

export const EMBEDDING_DIMENSIONS = 1536;
