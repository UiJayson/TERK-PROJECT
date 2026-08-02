import { FormEvent, useEffect, useState } from "react";
import type { WorkspaceAgent } from "../../auth/types";

interface AgentEditModalProps {
  agent: WorkspaceAgent;
  busy?: boolean;
  onClose: () => void;
  onSave: (notes: string) => Promise<void>;
}

export function AgentEditModal({ agent, busy, onClose, onSave }: AgentEditModalProps) {
  const [notes, setNotes] = useState(agent.notes);
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
    setError("");
    try {
      await onSave(notes);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save agent");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-labelledby="edit-agent-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-panel__header">
          <div>
            <p className="modal-panel__eyebrow">Edit agent</p>
            <h2 id="edit-agent-title">{agent.name}</h2>
          </div>
          <button type="button" className="modal-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-panel__body">
          <section className="modal-section">
            <h3>Architecture (read-only)</h3>
            <p>
              Behavior comes from <code>{agent.id}</code> agent files and shared knowledge.
              Product facts stay in the Company Brain.
            </p>
            <dl className="agent-card__meta">
              <div>
                <dt>Model</dt>
                <dd>{agent.model}</dd>
              </div>
              <div>
                <dt>Channels</dt>
                <dd>{agent.channelsConnected.join(", ")}</dd>
              </div>
            </dl>
          </section>

          <section className="modal-section">
            <h3>Agent prompt</h3>
            <pre className="agent-prompt">{agent.prompt}</pre>
          </section>

          <form className="modal-section" onSubmit={(event) => void handleSubmit(event)}>
            <h3>Owner notes</h3>
            <p className="modal-section__hint">
              Optional notes for your team. Do not paste prices or policies here — use Knowledge Base.
            </p>
            <textarea
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. Prefer short replies on WhatsApp hours questions."
            />
            {error ? <p className="auth-form__error">{error}</p> : null}
            <div className="modal-panel__actions">
              <button type="button" className="agent-btn agent-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="agent-btn agent-btn--primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
