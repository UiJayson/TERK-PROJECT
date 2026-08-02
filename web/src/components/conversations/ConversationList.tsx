import {
  AGENT_LABELS,
  CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  SENTIMENT_LABELS,
  type Conversation,
} from "../../data/conversations";
import { ChannelIcon } from "./ChannelIcon";

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="conv-list-empty">
        <p>No conversations match these filters.</p>
      </div>
    );
  }

  return (
    <ul className="conv-list">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            className={`conv-list-item ${selectedId === conversation.id ? "is-selected" : ""}`}
            onClick={() => onSelect(conversation.id)}
          >
            <div className="conv-list-item__top">
              <div className="conv-list-item__identity">
                <ChannelIcon channel={conversation.channel} size={14} />
                <span className="conv-list-item__name">{conversation.customer.name}</span>
                {conversation.unread ? <span className="conv-dot" aria-label="Unread" /> : null}
              </div>
              <time dateTime={conversation.updatedAt}>{formatTime(conversation.updatedAt)}</time>
            </div>

            <p className="conv-list-item__preview">{conversation.preview}</p>

            <div className="conv-list-item__meta">
              <span className="conv-list-item__channel">
                <ChannelIcon channel={conversation.channel} size={12} />
                {CHANNEL_LABELS[conversation.channel]}
              </span>
              <span>{AGENT_LABELS[conversation.agentUsed]}</span>
              <span>{LEAD_STATUS_LABELS[conversation.leadStatus]}</span>
              <span className={`conv-sentiment conv-sentiment--${conversation.sentiment}`}>
                {SENTIMENT_LABELS[conversation.sentiment]}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
