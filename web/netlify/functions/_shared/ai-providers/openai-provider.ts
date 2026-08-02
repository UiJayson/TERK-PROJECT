import OpenAI from "openai";
import { getConfig, isConfiguredSecret } from "../config.ts";
import { formatPrompt } from "./format-prompt.ts";
import {
  countTokensHeuristic,
  estimateCostUsd,
  EMBEDDING_DIMENSIONS,
  resolveChatModel,
  resolveEmbeddingModel,
} from "./pricing.ts";
import type {
  AIProvider,
  GenerateResponseInput,
  GenerateResponseResult,
} from "./types.ts";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;

  isConfigured(): boolean {
    return isConfiguredSecret(getConfig().anthropic.openaiApiKey);
  }

  private client(): OpenAI {
    const apiKey = getConfig().anthropic.openaiApiKey;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    // Bounded per-call timeout; ai-engine owns retries and fallback.
    return new OpenAI({
      apiKey,
      baseURL: getConfig().anthropic.openaiBaseUrl || undefined,
      timeout: 20_000,
      maxRetries: 0,
    });
  }

  countTokens(text: string): number {
    return countTokensHeuristic(text);
  }

  async generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult> {
    const model = input.model ?? resolveChatModel("openai");
    const formatted = formatPrompt("openai", input.systemPrompt, input.messages);
    const openai = this.client();

    const completion = await openai.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.4,
      max_tokens: input.maxTokens ?? 1024,
      response_format: input.jsonMode === false ? undefined : { type: "json_object" },
      messages: formatted.messages.map((message) => ({
        role: message.role as "system" | "user" | "assistant",
        content: message.content,
      })),
    });

    const content = completion.choices[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("Empty OpenAI response");
    }

    const inputTokens =
      completion.usage?.prompt_tokens ??
      this.countTokens(
        [input.systemPrompt, ...input.messages.map((message) => message.content)].join("\n"),
      );
    const outputTokens =
      completion.usage?.completion_tokens ?? this.countTokens(content);

    return {
      content,
      model,
      provider: "openai",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens),
      },
    };
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isConfigured()) return null;

    const openai = this.client();
    const model = resolveEmbeddingModel();

    const response = await openai.embeddings.create({
      model,
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data[0]?.embedding ?? null;
  }
}
