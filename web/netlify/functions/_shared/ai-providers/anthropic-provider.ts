import Anthropic from "@anthropic-ai/sdk";
import { formatPrompt } from "./format-prompt.ts";
import { getConfig, isConfiguredSecret } from "../config.ts";
import {
  countTokensHeuristic,
  estimateCostUsd,
  resolveChatModel,
} from "./pricing.ts";
import { OpenAIProvider } from "./openai-provider.ts";
import type {
  AIProvider,
  GenerateResponseInput,
  GenerateResponseResult,
} from "./types.ts";

export class AnthropicProviderError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number, retryable = false) {
    super(message);
    this.name = "AnthropicProviderError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function isAnthropicFallbackEligible(error: unknown): boolean {
  if (error instanceof AnthropicProviderError) {
    return error.retryable || error.statusCode === 401;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("econnreset") ||
      msg.includes("network")
    );
  }
  return true;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  private readonly embeddingFallback = new OpenAIProvider();

  isConfigured(): boolean {
    return isConfiguredSecret(getConfig().anthropic.apiKey);
  }

  countTokens(text: string): number {
    return countTokensHeuristic(text);
  }

  private client(): Anthropic {
    const apiKey = getConfig().anthropic.apiKey;
    if (!apiKey) {
      throw new AnthropicProviderError("ANTHROPIC_API_KEY is not set", 401, false);
    }
    // Bounded per-call timeout: a hung provider call must fail fast enough
    // for the ai-engine retry + OpenAI fallback to run inside the Netlify
    // function budget. SDK-level retries stay off — ai-engine owns retrying.
    return new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
  }

  async generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult> {
    const model = input.model ?? resolveChatModel("anthropic");
    const formatted = formatPrompt("anthropic", input.systemPrompt, input.messages);
    const maxTokens = input.maxTokens ?? 1024;

    const messages = formatted.messages.map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));

    try {
      const client = this.client();
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: input.temperature ?? 0.7,
        system: formatted.systemPrompt,
        messages,
      });

      const content =
        response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();

      if (!content) {
        throw new Error("Empty Anthropic response");
      }

      const inputTokens =
        response.usage?.input_tokens ??
        this.countTokens(
          [input.systemPrompt, ...input.messages.map((message) => message.content)].join("\n"),
        );
      const outputTokens =
        response.usage?.output_tokens ?? this.countTokens(content);

      return {
        content,
        model,
        provider: "anthropic",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens),
        },
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const status = error.status ?? 500;
        if (status === 401) {
          throw new AnthropicProviderError("Invalid Anthropic API key", 401, false);
        }
        if (status === 429) {
          throw new AnthropicProviderError("Anthropic rate limit exceeded", 429, true);
        }
        if (status === 529) {
          throw new AnthropicProviderError("Anthropic API overloaded", 529, true);
        }
        throw new AnthropicProviderError(
          error.message || `Anthropic API error (${status})`,
          status,
          status >= 500,
        );
      }
      throw error;
    }
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (this.embeddingFallback.isConfigured()) {
      return this.embeddingFallback.generateEmbedding(text);
    }
    return null;
  }
}
