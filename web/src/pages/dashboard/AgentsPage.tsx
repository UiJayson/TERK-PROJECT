import { useCallback, useEffect, useState } from "react";
import { fetchAgents, updateAgent } from "../../api/agents";
import type { AgentId, WorkspaceAgent } from "../../auth/types";
import { AgentCard } from "../../components/agents/AgentCard";
import { AgentEditModal } from "../../components/agents/AgentEditModal";
import { AgentTestModal } from "../../components/agents/AgentTestModal";
import { ProductCatalogPanel } from "../../components/agents/ProductCatalogPanel";
import { MarketingPanel } from "../../components/agents/MarketingPanel";
import { BIPanel } from "../../components/agents/BIPanel";
import { WorkflowsPanel } from "../../components/agents/WorkflowsPanel";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

import { usePermissions } from "../../auth/usePermissions";

export function AgentsPage() {
  const { canManageAgents } = usePermissions();
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<AgentId | null>(null);
  const [editing, setEditing] = useState<WorkspaceAgent | null>(null);
  const [testing, setTesting] = useState<WorkspaceAgent | null>(null);
  const [tab, setTab] = useState<"agents" | "catalog" | "marketing" | "bi" | "workflows">("agents");

  const loadAgents = useCallback(async () => {
    setError("");
    try {
      const next = await fetchAgents();
      setAgents(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  async function handleToggle(agent: WorkspaceAgent, enabled: boolean) {
    setBusyId(agent.id);
    setError("");
    try {
      const updated = await updateAgent(agent.id, { enabled });
      setAgents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update agent");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveNotes(notes: string) {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const updated = await updateAgent(editing.id, { notes });
      setAgents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditing(updated);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="My Agents"
        description="Manage your AI employees. Behavior stays in agent files; company facts stay in the Knowledge Base."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void loadAgents()} /> : null}

      <div className="kb-header-actions">
        <button
          type="button"
          className={`agent-btn ${tab === "agents" ? "agent-btn--primary" : "agent-btn--ghost"}`}
          onClick={() => setTab("agents")}
        >
          My Agents
        </button>
        <button
          type="button"
          className={`agent-btn ${tab === "catalog" ? "agent-btn--primary" : "agent-btn--ghost"}`}
          onClick={() => setTab("catalog")}
        >
          Product Catalog
        </button>
        <button
          type="button"
          className={`agent-btn ${tab === "marketing" ? "agent-btn--primary" : "agent-btn--ghost"}`}
          onClick={() => setTab("marketing")}
        >
          Marketing
        </button>
        <button
          type="button"
          className={`agent-btn ${tab === "bi" ? "agent-btn--primary" : "agent-btn--ghost"}`}
          onClick={() => setTab("bi")}
        >
          Business Intelligence
        </button>
        <button
          type="button"
          className={`agent-btn ${tab === "workflows" ? "agent-btn--primary" : "agent-btn--ghost"}`}
          onClick={() => setTab("workflows")}
        >
          Workflows
        </button>
      </div>

      {tab === "workflows" ? (
        <WorkflowsPanel readOnly={!canManageAgents} />
      ) : tab === "bi" ? (
        <BIPanel readOnly={!canManageAgents} />
      ) : tab === "marketing" ? (
        <MarketingPanel readOnly={!canManageAgents} />
      ) : tab === "catalog" ? (
        <ProductCatalogPanel readOnly={!canManageAgents} />
      ) : loading ? (
        <LoadingState label="Loading agents…" />
      ) : agents.length === 0 ? (
        <EmptyState
          title="No agents configured"
          description="Your workspace agents will appear here once the runtime is ready."
        />
      ) : (
        <section className="agents-grid" aria-label="AI employees">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              busy={busyId === agent.id}
              readOnly={!canManageAgents}
              onToggle={(enabled) => void handleToggle(agent, enabled)}
              onEdit={() => setEditing(agent)}
              onTest={() => setTesting(agent)}
            />
          ))}
        </section>
      )}

      {editing ? (
        <AgentEditModal
          agent={editing}
          busy={busyId === editing.id}
          onClose={() => setEditing(null)}
          onSave={handleSaveNotes}
        />
      ) : null}

      {testing ? (
        <AgentTestModal agent={testing} onClose={() => setTesting(null)} />
      ) : null}
    </div>
  );
}
