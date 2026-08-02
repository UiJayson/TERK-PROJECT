import type { Config, Context } from "@netlify/functions";
import { isProduction } from "./_shared/config.ts";
import { isAdminAuthorized } from "./_shared/admin-auth.ts";
import {
  AnthropicProvider,
  AnthropicProviderError,
} from "./_shared/ai-providers/anthropic-provider.ts";
import { OpenAIProvider } from "./_shared/ai-providers/openai-provider.ts";
import { resolveChatModel } from "./_shared/ai-providers/pricing.ts";
import { AIEngineError, isServiceUnavailableError } from "./_shared/ai-engine.ts";

const TEST_PROMPT = "Say 'I am Claude, running on Anthropic.'";
const DISPLAY_MODEL = "claude-3-5-sonnet";

async function handler(_req: Request, _context: Context) {
  if (_req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // This endpoint spends real AI credits — never leave it open in production.
  if (isProduction() && !isAdminAuthorized(_req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const model = resolveChatModel("anthropic");
  const provider = new AnthropicProvider();

  if (!provider.isConfigured()) {
    return Response.json(
      {
        error: "Invalid Anthropic API key",
        hint: "Check console.anthropic.com",
      },
      { status: 401 },
    );
  }

  const started = Date.now();

  try {
    const result = await provider.generateResponse({
      systemPrompt: "You are a helpful assistant. Reply exactly as instructed.",
      messages: [{ role: "user", content: TEST_PROMPT }],
      model,
      temperature: 0,
      maxTokens: 64,
      operation: "chat",
    });

    return Response.json({
      provider: "anthropic",
      model: DISPLAY_MODEL,
      response: result.content,
      latency_ms: Date.now() - started,
      tokens_used: {
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
      },
    });
  } catch (error) {
    if (error instanceof AnthropicProviderError && error.statusCode === 401) {
      return Response.json(
        {
          error: "Invalid Anthropic API key",
          hint: "Check console.anthropic.com",
        },
        { status: 401 },
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const fallback = new OpenAIProvider();

    if (fallback.isConfigured()) {
      console.warn(`Anthropic failed [${errorMessage}], falling back to OpenAI`);
      try {
        const fallbackStarted = Date.now();
        const result = await fallback.generateResponse({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ role: "user", content: TEST_PROMPT }],
          temperature: 0,
          maxTokens: 64,
        });

        return Response.json({
          provider: "openai",
          model: result.model,
          response: result.content,
          latency_ms: Date.now() - fallbackStarted,
          fallback: true,
          anthropic_error: errorMessage,
          tokens_used: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
        });
      } catch (fallbackError) {
        console.error("OpenAI fallback failed:", fallbackError);
      }
    }

    if (
      error instanceof AIEngineError ||
      error instanceof AnthropicProviderError
    ) {
      return Response.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 },
      );
    }

    if (isServiceUnavailableError(error)) {
      return Response.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 },
      );
    }

    return Response.json(
      {
        error: errorMessage,
        hint: "Check console.anthropic.com",
      },
      { status: 503 },
    );
  }
}

export const config: Config = {
  path: "/.netlify/functions/ai-test",
};

export default handler;
