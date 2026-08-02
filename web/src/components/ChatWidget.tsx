import { FormEvent, useEffect, useRef, useState } from "react";
import { clampMessage, MAX_MESSAGE_LENGTH, safeImageUrl } from "../lib/embed-security";
import type { ChatMessage, ChatResponse, ConversationState, ProductCard } from "../types";

const agentLabels: Record<string, string> = {
  reception: "Reception",
  sales: "Sales",
  marketing: "Marketing",
  human_review: "Human review",
};

interface ChatWidgetProps {
  pageUrl: string;
  publicKey?: string;
  workspaceName?: string;
  greeting?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function ChatWidget({
  pageUrl,
  publicKey,
  workspaceName = "AI Business OS",
  greeting = "Hi! Ask about hours, products, pricing, or booking and I'll route you to the right specialist.",
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"ai" | "demo" | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: greeting },
  ]);
  const [state, setState] = useState<ConversationState>({
    active_agent: "reception",
    last_intent: "greeting",
  });
  const [meta, setMeta] = useState<{
    agent: string;
    intent: string;
    reason: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = clampMessage(input);
    if (!text || loading) return;

    const historyForApi = messages.filter(
      (message, index) => !(index === 0 && message.role === "assistant"),
    );
    const nextHistory = [...messages, { role: "user" as const, content: text }];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    const startedAt = Date.now();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          history: historyForApi,
          state,
          page_url: pageUrl,
          channel: publicKey ? "website" : "dashboard",
          public_key: publicKey,
          conversation_id: conversationId,
        }),
      });

      const data = (await response.json()) as ChatResponse & {
        conversation_id?: string;
        typing_delay_ms?: number;
        escalated?: boolean;
        error?: string;
        products?: ProductCard[];
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Chat request failed");
      }

      const delayMs = data.typing_delay_ms ?? 0;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, delayMs - elapsed);
      if (remaining > 0) {
        await sleep(remaining);
      }

      setMessages([
        ...nextHistory,
        {
          role: "assistant",
          content: data.reply,
          products: data.products,
        },
      ]);
      setState(data.state);
      setMode(data.mode);
      setConversationId(data.conversation_id ?? conversationId);
      setMeta({
        agent: data.agent,
        intent: data.intent,
        reason: data.routing_reason,
      });
    } catch (error) {
      setMessages([
        ...nextHistory,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-shell">
      <button
        type="button"
        className="chat-launcher"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Close chat" : "Chat with us"}
      </button>

      {open && (
        <section className="chat-panel" aria-label="Website chat">
          <header className="chat-header">
            <div>
              <strong>{workspaceName}</strong>
              <span>Website chat</span>
            </div>
            {meta && (
              <div className="chat-routing">
                <span className="badge">{agentLabels[meta.agent] ?? meta.agent}</span>
                {mode === "demo" && <span className="badge demo">Demo mode</span>}
              </div>
            )}
          </header>

          <div className="chat-messages" ref={scrollRef}>
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
              >
                {message.content}
                {message.products && message.products.length > 0 ? (
                  <div className="product-cards">
                    {message.products.map((product) => (
                      <article key={product.id} className="product-card">
                        {safeImageUrl(product.imageUrl) ? (
                          <img
                            src={safeImageUrl(product.imageUrl)!}
                            alt={product.title}
                            className="product-card__image"
                          />
                        ) : (
                          <div className="product-card__image product-card__image--placeholder">
                            No image
                          </div>
                        )}
                        <div className="product-card__body">
                          <strong>{product.title}</strong>
                          {product.price !== null ? (
                            <p className="product-card__price">
                              {product.currency} {product.price.toFixed(2)}
                            </p>
                          ) : null}
                          {product.stockStatus ? (
                            <p className="product-card__stock">{product.stockStatus.replaceAll("_", " ")}</p>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {loading && (
              <div className="bubble assistant typing" aria-live="polite">
                <span className="typing-dots">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
          </div>

          {meta && (
            <p className="chat-meta">
              Routed to <strong>{agentLabels[meta.agent] ?? meta.agent}</strong> ·{" "}
              {meta.intent.replaceAll("_", " ")}
            </p>
          )}

          <form className="chat-form" onSubmit={(event) => void sendMessage(event)}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about tours, hours, or plans…"
              disabled={loading}
              maxLength={MAX_MESSAGE_LENGTH}
              aria-label="Message"
            />
            <button type="submit" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
