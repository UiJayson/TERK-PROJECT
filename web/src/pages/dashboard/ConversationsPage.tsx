import { useCallback, useEffect, useMemo, useState } from "react";
import { usePermissions } from "../../auth/usePermissions";
import { fetchConversationsPage, resolveConversation, type RuntimeConversation } from "../../api/runtime";
import { ConversationDetail } from "../../components/conversations/ConversationDetail";
import { ConversationFilters } from "../../components/conversations/ConversationFilters";
import { ConversationList } from "../../components/conversations/ConversationList";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Link } from "react-router-dom";
import {
  type Conversation,
  type ConversationAgent,
  type ConversationChannelFilter,
  matchesChannelFilter,
} from "../../data/conversations";

function toConversation(item: RuntimeConversation): Conversation {
  return {
    id: item.id,
    customer: item.customer,
    channel: item.channel,
    agentUsed: item.agentUsed,
    conversationStatus: item.conversationStatus,
    leadStatus: item.leadStatus,
    sentiment: item.sentiment,
    updatedAt: item.updatedAt,
    preview: item.preview,
    unread: item.unread,
    messages: item.messages,
  };
}

export function ConversationsPage() {
  const { canWriteConversations } = usePermissions();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [agentFilters, setAgentFilters] = useState<ConversationAgent[]>([]);
  const [channelFilter, setChannelFilter] = useState<ConversationChannelFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await fetchConversationsPage({ limit: 50 });
      const mapped = page.items.map(toConversation);
      setItems(mapped);
      setNextCursor(page.nextCursor);
      setSelectedId((current) => current ?? mapped[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchConversationsPage({ limit: 50, cursor: nextCursor });
      const mapped = page.items.map(toConversation);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...mapped.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more conversations");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const conversations = useMemo(() => {
    return items.filter((conversation) => {
      const agentOk =
        agentFilters.length === 0 || agentFilters.includes(conversation.agentUsed);
      const channelOk = matchesChannelFilter(conversation.channel, channelFilter);
      return agentOk && channelOk;
    });
  }, [items, agentFilters, channelFilter]);

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    conversations[0] ??
    null;

  function toggleAgent(agent: ConversationAgent) {
    setAgentFilters((current) =>
      current.includes(agent)
        ? current.filter((value) => value !== agent)
        : [...current, agent],
    );
  }

  function toggleChannelFilter(filter: ConversationChannelFilter) {
    setChannelFilter(filter);
  }

  async function handleResolve(conversationId: string) {
    setResolveBusy(true);
    try {
      await resolveConversation(conversationId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve conversation");
    } finally {
      setResolveBusy(false);
    }
  }

  return (
    <div className="page-stack conv-page">
      <PageHeader
        title="Conversations"
        description="Live threads from your AI runtime: routing, agents, and shared knowledge."
        actions={
          <button type="button" className="agent-btn agent-btn--ghost" onClick={() => void load()}>
            Refresh
          </button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <ConversationFilters
        agents={agentFilters}
        channelFilter={channelFilter}
        onToggleAgent={toggleAgent}
        onChannelFilterChange={toggleChannelFilter}
        onClear={() => {
          setAgentFilters([]);
          setChannelFilter("all");
        }}
      />

      {loading ? (
        <LoadingState label="Loading conversations…" />
      ) : (
        <div className="conv-layout">
          <aside className="conv-layout__list" aria-label="Conversation list">
            <div className="conv-layout__list-header">
              <h2>Inbox</h2>
              <span>{conversations.length}</span>
            </div>
            {conversations.length === 0 ? (
              <EmptyState
                title="No conversations yet"
                description="Test an agent in My Agents. Replies are saved here automatically."
                action={
                  <Link to="/app/agents" className="agent-btn agent-btn--primary">
                    Open My Agents
                  </Link>
                }
              />
            ) : (
              <>
                <ConversationList
                  conversations={conversations}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
                {nextCursor ? (
                  <button
                    type="button"
                    className="agent-btn agent-btn--ghost"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                ) : null}
              </>
            )}
          </aside>

          <div className="conv-layout__detail">
            <ConversationDetail
              conversation={selected}
              onResolve={canWriteConversations ? (id) => void handleResolve(id) : undefined}
              resolveBusy={resolveBusy}
            />
          </div>
        </div>
      )}
    </div>
  );
}
