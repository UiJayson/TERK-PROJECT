import {
  AGENT_LABELS,
  CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  SENTIMENT_LABELS,
  type Conversation,
} from "../../data/conversations";
import { ChannelIcon } from "./ChannelIcon";
import { EmptyState } from "../ui/EmptyState";

interface ConversationDetailProps {
  conversation: Conversation | null;
  onResolve?: (conversationId: string) => void;
  resolveBusy?: boolean;
}

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function contactLine(conversation: Conversation): string {
  const { email, phone, handle } = conversation.customer;
  return [email, phone, handle].filter(Boolean).join(" · ") || "No contact details";
}

export function ConversationDetail({
  conversation,
  onResolve,
  resolveBusy,
}: ConversationDetailProps) {
  if (!conversation) {
    return (
      <div className="conv-detail conv-detail--empty">
        <EmptyState
          title="Select a conversation"
          description="Choose a thread from the inbox to read the full history."
        />
      </div>
    );
  }

  return (
    <section className="conv-detail">
      <header className="conv-detail__header">
        <div>
          <h2 className="conv-detail__name">
            <ChannelIcon channel={conversation.channel} size={18} />
            {conversation.customer.name}
          </h2>
          <p className="conv-detail__contact">{contactLine(conversation)}</p>
        </div>
        <time dateTime={conversation.updatedAt}>{formatTime(conversation.updatedAt)}</time>
        {conversation.conversationStatus === "escalated" && onResolve ? (
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            disabled={resolveBusy}
            onClick={() => onResolve(conversation.id)}
          >
            {resolveBusy ? "Resolving…" : "Mark resolved"}
          </button>
        ) : null}
      </header>

      <dl className="conv-detail__stats">
        <div>
          <dt>Customer</dt>
          <dd>{conversation.customer.name}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd className="conv-detail__channel">
            <ChannelIcon channel={conversation.channel} size={14} />
            {CHANNEL_LABELS[conversation.channel]}
          </dd>
        </div>
        <div>
          <dt>Agent used</dt>
          <dd>{AGENT_LABELS[conversation.agentUsed]}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{conversation.conversationStatus ?? "open"}</dd>
        </div>
        <div>
          <dt>Lead status</dt>
          <dd>{LEAD_STATUS_LABELS[conversation.leadStatus]}</dd>
        </div>
        <div>
          <dt>Sentiment</dt>
          <dd className={`conv-sentiment conv-sentiment--${conversation.sentiment}`}>
            {SENTIMENT_LABELS[conversation.sentiment]}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatTime(conversation.updatedAt)}</dd>
        </div>
      </dl>

      <div className="conv-thread">
        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className={`conv-message conv-message--${message.role}${
              message.handoff ? " conv-message--handoff" : ""
            }`}
          >
            <header className="conv-message__meta">
              <span>
                {message.role === "customer"
                  ? conversation.customer.name
                  : message.role === "system"
                    ? message.handoff
                      ? "Handoff"
                      : "System"
                    : AGENT_LABELS[message.agent ?? conversation.agentUsed]}
              </span>
              <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
            </header>
            {message.handoff ? (
              <p className="conv-message__handoff">
                {AGENT_LABELS[message.handoff.from]} handed off to{" "}
                {AGENT_LABELS[message.handoff.to]}
              </p>
            ) : null}
            <p className="conv-message__body">{message.content}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
