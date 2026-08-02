import {
  countTokensHeuristic,
  resolveChatModel,
} from "./pricing.ts";
import { getConfig, isConfiguredSecret } from "../config.ts";
import { OpenAIProvider } from "./openai-provider.ts";
import type {
  AIProvider,
  GenerateResponseInput,
  GenerateResponseResult,
} from "./types.ts";

export class NetlifyAIProvider implements AIProvider {
  readonly name = "netlify" as const;
  private readonly openai = new OpenAIProvider();

  isConfigured(): boolean {
    const { openaiApiKey, openaiBaseUrl } = getConfig().anthropic;
    return isConfiguredSecret(openaiApiKey) && isConfiguredSecret(openaiBaseUrl);
  }

  countTokens(text: string): number {
    return countTokensHeuristic(text);
  }

  async generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult> {
    const result = await this.openai.generateResponse({
      ...input,
      model: input.model ?? resolveChatModel("netlify"),
    });
    return { ...result, provider: "netlify" };
  }

  async generateEmbedding(text: string, _workspaceId?: string): Promise<number[] | null> {
    return this.openai.generateEmbedding(text);
  }
}
