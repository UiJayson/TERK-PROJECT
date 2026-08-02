import { FormEvent, useEffect, useState } from "react";
import type { WorkspaceAgent } from "../../auth/types";
import { testAgent } from "../../api/agents";

interface AgentTestModalProps {
  agent: WorkspaceAgent;
  onClose: () => void;
}

interface TestMessage {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

export function AgentTestModal({ agent, onClose }: AgentTestModalProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    [],
  );
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setError("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setLoading(true);

    try {
      const result = await testAgent(agent.id, message, {
        conversationId,
        history,
      });
      setConversationId(result.conversation_id ?? conversationId);
      setHistory((current) => [
        ...current,
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      ]);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.reply,
          meta: result.routing_reason,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-labelledby="test-agent-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-panel__header">
          <div>
            <p className="modal-panel__eyebrow">Test agent · live AI runtime</p>
            <h2 id="test-agent-title">{agent.name}</h2>
          </div>
          <button type="button" className="modal-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="agent-test">
          <div className="agent-test__messages">
            {messages.length === 0 ? (
              <p className="empty-panel__hint">
                Uses your workspace Shared Knowledge, agent prompt, and runtime. Replies are saved
                to Conversations and Leads.
              </p>
            ) : null}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`}>
                <div
                  className={`agent-test__bubble agent-test__bubble--${message.role}`}
                >
                  {message.content}
                </div>
                {message.meta ? (
                  <p className="agent-test__meta">{message.meta}</p>
                ) : null}
              </div>
            ))}
            {loading ? <p className="empty-panel__hint">Thinking…</p> : null}
          </div>

          {error ? <p className="auth-form__error">{error}</p> : null}

          <form className="agent-test__form" onSubmit={(event) => void handleSubmit(event)}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Try: What are your opening hours?"
              disabled={loading}
            />
            <button
              type="submit"
              className="agent-btn agent-btn--primary"
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
