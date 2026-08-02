import type { WorkspaceAgent } from "../../auth/types";

interface AgentCardProps {
  agent: WorkspaceAgent;
  busy?: boolean;
  readOnly?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onTest: () => void;
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatChannel(channel: string): string {
  return channel.replaceAll("_", " ");
}

export function AgentCard({ agent, busy, readOnly, onToggle, onEdit, onTest }: AgentCardProps) {
  return (
    <article className={`agent-card ${agent.enabled ? "is-active" : "is-paused"}`}>
      <header className="agent-card__header">
        <div>
          <p className="agent-card__role">{agent.role}</p>
          <h2 className="agent-card__name">{agent.name}</h2>
        </div>
        <span className={`agent-card__status agent-card__status--${agent.status}`}>
          {agent.enabled ? "On" : "Off"}
        </span>
      </header>

      <p className="agent-card__description">{agent.description}</p>

      <dl className="agent-card__meta">
        <div>
          <dt>Status</dt>
          <dd>{agent.enabled ? "Active" : "Paused"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{agent.model}</dd>
        </div>
        <div>
          <dt>Knowledge source</dt>
          <dd>{agent.knowledgeSources.length} shared files</dd>
        </div>
        <div>
          <dt>Channels connected</dt>
          <dd>{agent.channelsConnected.map(formatChannel).join(", ") || "None"}</dd>
        </div>
        <div className="agent-card__meta-wide">
          <dt>Last updated</dt>
          <dd>{formatDate(agent.lastUpdated)}</dd>
        </div>
      </dl>

      <div className="agent-card__knowledge">
        {agent.knowledgeSources.map((source) => (
          <span key={source} className="agent-card__chip">
            {source.replace("shared/", "")}
          </span>
        ))}
      </div>

      <footer className="agent-card__footer">
        <label className="agent-toggle">
          <input
            type="checkbox"
            checked={agent.enabled}
            disabled={busy || readOnly}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={`${agent.enabled ? "Turn off" : "Turn on"} ${agent.name}`}
          />
          <span aria-hidden="true">{agent.enabled ? "On" : "Off"}</span>
        </label>

        <div className="agent-card__actions">
          {!readOnly ? (
            <button type="button" className="agent-btn agent-btn--ghost" onClick={onEdit}>
              Edit Agent
            </button>
          ) : null}
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            onClick={onTest}
            disabled={!agent.enabled || readOnly}
          >
            Test Agent
          </button>
        </div>
      </footer>
    </article>
  );
}
