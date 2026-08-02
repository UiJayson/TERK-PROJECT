export type AIProviderName = "openai" | "anthropic" | "netlify";

export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface GenerateResponseInput {
  systemPrompt: string;
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  workspaceId?: string;
  operation?: "chat" | "embedding" | "bi_analysis" | "marketing";
}

export interface GenerateResponseResult {
  content: string;
  model: string;
  provider: AIProviderName;
  usage: TokenUsage;
}

export interface AIProvider {
  readonly name: AIProviderName;
  generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult>;
  generateEmbedding(text: string, workspaceId?: string): Promise<number[] | null>;
  countTokens(text: string): number;
  isConfigured(): boolean;
}

export class AIEngineError extends Error {
  provider: AIProviderName;
  retried: boolean;

  constructor(message: string, provider: AIProviderName, retried = false) {
    super(message);
    this.name = "AIEngineError";
    this.provider = provider;
    this.retried = retried;
  }
}
