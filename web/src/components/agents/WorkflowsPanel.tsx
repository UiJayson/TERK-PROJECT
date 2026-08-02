import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createWorkflow,
  executeWorkflow,
  fetchWorkflowsDashboard,
  seedPrebuiltWorkflows,
  updateWorkflowStatus,
  type Workflow,
  type WorkflowExecution,
  type WorkflowStats,
  type WorkflowTrigger,
} from "../../api/workflows";
import { EmptyState } from "../ui/EmptyState";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LoadingState } from "../ui/LoadingState";

interface WorkflowsPanelProps {
  readOnly?: boolean;
}

const TRIGGER_OPTIONS: WorkflowTrigger[] = [
  "new_lead",
  "appointment_booked",
  "conversation_escalated",
  "subscription_expired",
  "scheduled",
];

export function WorkflowsPanel({ readOnly = false }: WorkflowsPanelProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<WorkflowTrigger>("new_lead");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const dashboard = await fetchWorkflowsDashboard();
      setWorkflows(dashboard.workflows);
      setExecutions(dashboard.executions);
      setStats(dashboard.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const workflow = await createWorkflow({
        name: name.trim(),
        triggers: [trigger],
        steps: [
          { type: "wait", config: { duration: 1, unit: "hours" } },
          {
            type: "send_email",
            config: {
              subject: `[AI OS] ${name.trim()}`,
              body: "Automated follow-up from your workflow.",
            },
          },
        ],
      });
      setWorkflows((current) => [workflow, ...current]);
      setName("");
      setSuccess(`Workflow "${workflow.name}" created.`);
      const dashboard = await fetchWorkflowsDashboard();
      setStats(dashboard.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workflow");
    } finally {
      setBusy(false);
    }
  }

  async function handleSeed() {
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      const seeded = await seedPrebuiltWorkflows();
      if (seeded.length > 0) {
        setWorkflows((current) => [...seeded, ...current]);
        setSuccess(`Added ${seeded.length} pre-built workflow(s).`);
      } else {
        setSuccess("Pre-built workflows already exist.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not seed workflows");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(workflow: Workflow) {
    setBusy(true);
    setError("");
    try {
      const nextStatus = workflow.status === "active" ? "paused" : "active";
      const updated = await updateWorkflowStatus(workflow.id, nextStatus);
      setWorkflows((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update workflow");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecute(workflowId: string) {
    setBusy(true);
    setError("");
    try {
      const execution = await executeWorkflow(workflowId, { test: true });
      setExecutions((current) => [execution, ...current]);
      setSuccess(`Workflow execution started (${execution.status}).`);
      const dashboard = await fetchWorkflowsDashboard();
      setStats(dashboard.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading workflows…" />;
  }

  return (
    <section className="marketing-panel" aria-label="Workflows dashboard">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {success ? <p className="integrations-copy">{success}</p> : null}

      {stats ? (
        <dl className="conv-detail__stats marketing-stats">
          <div>
            <dt>Active workflows</dt>
            <dd>{stats.activeWorkflows}</dd>
          </div>
          <div>
            <dt>Total executions</dt>
            <dd>{stats.totalExecutions}</dd>
          </div>
          <div>
            <dt>Success rate</dt>
            <dd>{stats.successRate}%</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{stats.failedExecutions}</dd>
          </div>
        </dl>
      ) : null}

      {!readOnly ? (
        <form className="marketing-campaign-form" onSubmit={(event) => void handleCreate(event)}>
          <h3>Create workflow</h3>
          <div className="kb-header-actions">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Workflow name"
              disabled={busy}
            />
            <select
              value={trigger}
              onChange={(event) => setTrigger(event.target.value as WorkflowTrigger)}
              disabled={busy}
            >
              {TRIGGER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button type="submit" className="agent-btn agent-btn--primary" disabled={busy || !name.trim()}>
              Create
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              disabled={busy}
              onClick={() => void handleSeed()}
            >
              Load pre-built
            </button>
          </div>
        </form>
      ) : null}

      <div className="marketing-columns">
        <section>
          <h3>Active workflows</h3>
          {workflows.length === 0 ? (
            <EmptyState
              title="No workflows"
              description="Load pre-built workflows or create a custom automation."
            />
          ) : (
            <ul className="marketing-list">
              {workflows.map((workflow) => (
                <li key={workflow.id}>
                  <strong>{workflow.name}</strong>
                  <span className="marketing-list__meta">
                    {workflow.status}
                    {workflow.isPrebuilt ? " · pre-built" : ""}
                  </span>
                  <p>Triggers: {workflow.triggers.join(", ")} · {workflow.steps.length} step(s)</p>
                  {!readOnly ? (
                    <div className="kb-header-actions">
                      <button
                        type="button"
                        className="agent-btn agent-btn--ghost"
                        disabled={busy}
                        onClick={() => void handleToggle(workflow)}
                      >
                        {workflow.status === "active" ? "Pause" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="agent-btn agent-btn--ghost"
                        disabled={busy}
                        onClick={() => void handleExecute(workflow.id)}
                      >
                        Test run
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Execution history</h3>
          {executions.length === 0 ? (
            <EmptyState
              title="No executions yet"
              description="Workflow runs appear here with success/failure status."
            />
          ) : (
            <ul className="marketing-list">
              {executions.slice(0, 10).map((execution) => (
                <li key={execution.id}>
                  <strong>{execution.status}</strong>
                  <span className="marketing-list__meta">
                    step {execution.currentStepIndex}
                  </span>
                  {execution.error ? <p>{execution.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
