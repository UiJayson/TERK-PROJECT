import type { AIProviderName, AIMessage } from "./types.ts";

export interface FormattedPrompt {
  systemPrompt: string;
  messages: AIMessage[];
}

/**
 * Provider-specific prompt shaping.
 * - OpenAI / Netlify: system message prepended to messages array.
 * - Anthropic: system passed separately; messages are user/assistant only.
 */
export function formatPrompt(
  provider: AIProviderName,
  systemPrompt: string,
  messages: AIMessage[],
): FormattedPrompt {
  const history = messages.filter((message) => message.role !== "system");

  if (provider === "anthropic") {
    return {
      systemPrompt,
      messages: history,
    };
  }

  return {
    systemPrompt,
    messages: [{ role: "system", content: systemPrompt }, ...history],
  };
}
