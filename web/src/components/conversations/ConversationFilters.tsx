import {
  AGENT_FILTERS,
  AGENT_LABELS,
  CONVERSATION_CHANNEL_FILTERS,
  type ConversationAgent,
  type ConversationChannelFilter,
} from "../../data/conversations";

interface ConversationFiltersProps {
  agents: ConversationAgent[];
  channelFilter: ConversationChannelFilter;
  onToggleAgent: (agent: ConversationAgent) => void;
  onChannelFilterChange: (filter: ConversationChannelFilter) => void;
  onClear: () => void;
}

export function ConversationFilters({
  agents,
  channelFilter,
  onToggleAgent,
  onChannelFilterChange,
  onClear,
}: ConversationFiltersProps) {
  const hasFilters = agents.length > 0 || channelFilter !== "all";

  return (
    <div className="conv-filters">
      <div className="conv-filters__group conv-filters__group--channels">
        <p className="conv-filters__label">Channel</p>
        <div className="conv-filters__chips">
          {CONVERSATION_CHANNEL_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`conv-chip ${channelFilter === filter.id ? "is-active" : ""}`}
              onClick={() => onChannelFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="conv-filters__group">
        <p className="conv-filters__label">Agent</p>
        <div className="conv-filters__chips">
          {AGENT_FILTERS.map((agent) => (
            <button
              key={agent}
              type="button"
              className={`conv-chip ${agents.includes(agent) ? "is-active" : ""}`}
              onClick={() => onToggleAgent(agent)}
            >
              {AGENT_LABELS[agent]}
            </button>
          ))}
        </div>
      </div>

      {hasFilters ? (
        <button type="button" className="conv-filters__clear" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
