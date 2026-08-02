import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchLeadsPage, type RuntimeLead } from "../../api/runtime";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import {
  LEAD_AGENT_LABELS,
  LEAD_AGENTS,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  type Lead,
  type LeadAgent,
  type LeadSortKey,
  type LeadStatus,
} from "../../data/leads";

function toLead(item: RuntimeLead): Lead {
  return {
    id: item.id,
    name: item.name,
    phone: item.phone,
    email: item.email,
    productInterest: item.productInterest,
    leadScore: item.leadScore,
    assignedAgent: item.assignedAgent,
    status: item.status,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: item.source,
  };
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

function scoreClass(score: number): string {
  if (score >= 80) return "is-high";
  if (score >= 55) return "is-mid";
  return "is-low";
}

function exportLeadsCsv(leads: Lead[]) {
  const headers = [
    "Name",
    "Phone",
    "Email",
    "Product Interest",
    "Lead Score",
    "Assigned Agent",
    "Status",
    "Notes",
    "Source",
    "Updated At",
  ];

  const rows = leads.map((lead) => [
    lead.name,
    lead.phone,
    lead.email,
    lead.productInterest,
    String(lead.leadScore),
    LEAD_AGENT_LABELS[lead.assignedAgent],
    LEAD_STATUS_LABELS[lead.status],
    lead.notes,
    lead.source,
    lead.updatedAt,
  ]);

  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escape(cell)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [agentFilter, setAgentFilter] = useState<LeadAgent | "all">("all");
  const [sortKey, setSortKey] = useState<LeadSortKey>("leadScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await fetchLeadsPage({ limit: 50 });
      const next = page.items.map(toLead);
      setLeads(next);
      setNextCursor(page.nextCursor);
      setSelectedId((current) => current ?? next[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchLeadsPage({ limit: 50, cursor: nextCursor });
      const next = page.items.map(toLead);
      setLeads((current) => {
        const seen = new Set(current.map((lead) => lead.id));
        return [...current, ...next.filter((lead) => !seen.has(lead.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more leads");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredLeads = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const next = leads.filter((lead) => {
      const statusOk = statusFilter === "all" || lead.status === statusFilter;
      const agentOk = agentFilter === "all" || lead.assignedAgent === agentFilter;
      if (!statusOk || !agentOk) return false;
      if (!needle) return true;

      const haystack = [
        lead.name,
        lead.phone,
        lead.email,
        lead.productInterest,
        lead.notes,
        LEAD_AGENT_LABELS[lead.assignedAgent],
        LEAD_STATUS_LABELS[lead.status],
        lead.source,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });

    next.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "leadScore") {
        return (a.leadScore - b.leadScore) * direction;
      }
      if (sortKey === "updatedAt") {
        return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * direction;
      }
      const left = String(a[sortKey]).toLowerCase();
      const right = String(b[sortKey]).toLowerCase();
      return left.localeCompare(right) * direction;
    });

    return next;
  }, [leads, query, statusFilter, agentFilter, sortKey, sortDir]);

  const selected =
    filteredLeads.find((lead) => lead.id === selectedId) ??
    filteredLeads[0] ??
    null;

  const stats = useMemo(() => {
    const total = filteredLeads.length;
    const qualified = filteredLeads.filter((lead) =>
      ["qualified", "proposal", "won"].includes(lead.status),
    ).length;
    const avgScore =
      total === 0
        ? 0
        : Math.round(
            filteredLeads.reduce((sum, lead) => sum + lead.leadScore, 0) / total,
          );
    return { total, qualified, avgScore };
  }, [filteredLeads]);

  function toggleSort(key: LeadSortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  }

  return (
    <div className="page-stack leads-page">
      <PageHeader
        title="Leads"
        description="Leads created automatically by your AI employees from conversations."
        actions={
          <div className="kb-header-actions">
            <button type="button" className="agent-btn agent-btn--ghost" onClick={() => void load()}>
              Refresh
            </button>
            <button
              type="button"
              className="agent-btn agent-btn--primary"
              onClick={() => exportLeadsCsv(filteredLeads)}
              disabled={filteredLeads.length === 0}
            >
              Export CSV
            </button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingState label="Loading leads from AI runtime…" />
      ) : (
        <>
      <section className="stat-grid leads-stats">
        <StatCard label="Visible leads" value={String(stats.total)} hint="After filters" />
        <StatCard
          label="Pipeline quality"
          value={String(stats.qualified)}
          hint="Qualified, proposal, or won"
        />
        <StatCard
          label="Avg lead score"
          value={String(stats.avgScore)}
          hint="AI-assigned score"
        />
        <StatCard label="Source" value="AI agents" hint="Auto-created from chats" />
      </section>

      <section className="leads-toolbar">
        <label className="leads-search">
          <span className="sr-only">Search leads</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, phone, product, notes…"
          />
        </label>

        <label className="leads-select">
          Status
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as LeadStatus | "all")
            }
          >
            <option value="all">All statuses</option>
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LEAD_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="leads-select">
          Agent
          <select
            value={agentFilter}
            onChange={(event) =>
              setAgentFilter(event.target.value as LeadAgent | "all")
            }
          >
            <option value="all">All agents</option>
            {LEAD_AGENTS.map((agent) => (
              <option key={agent} value={agent}>
                {LEAD_AGENT_LABELS[agent]}
              </option>
            ))}
          </select>
        </label>

        <label className="leads-select">
          Sort by
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(":") as [
                LeadSortKey,
                "asc" | "desc",
              ];
              setSortKey(key);
              setSortDir(dir);
            }}
          >
            <option value="leadScore:desc">Lead score · High to low</option>
            <option value="leadScore:asc">Lead score · Low to high</option>
            <option value="name:asc">Name · A–Z</option>
            <option value="name:desc">Name · Z–A</option>
            <option value="updatedAt:desc">Updated · Newest</option>
            <option value="updatedAt:asc">Updated · Oldest</option>
            <option value="status:asc">Status · A–Z</option>
            <option value="assignedAgent:asc">Agent · A–Z</option>
          </select>
        </label>
      </section>

      <div className="leads-layout">
        <div className="leads-table-wrap">
          {filteredLeads.length === 0 ? (
            <EmptyState
              title="No leads match"
              description="Try clearing filters, or test an agent to capture new leads."
            />
          ) : (
            <table className="leads-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => toggleSort("name")}>
                      Name
                    </button>
                  </th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Product interest</th>
                  <th>
                    <button type="button" onClick={() => toggleSort("leadScore")}>
                      Score
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort("assignedAgent")}>
                      Agent
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort("status")}>
                      Status
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={selected?.id === lead.id ? "is-selected" : ""}
                    onClick={() => setSelectedId(lead.id)}
                  >
                    <td>
                      <div className="leads-name-cell">
                        <strong>{lead.name}</strong>
                        <span>{lead.source}</span>
                      </div>
                    </td>
                    <td>{lead.phone}</td>
                    <td>{lead.email}</td>
                    <td>{lead.productInterest}</td>
                    <td>
                      <span className={`leads-score ${scoreClass(lead.leadScore)}`}>
                        {lead.leadScore}
                      </span>
                    </td>
                    <td>{LEAD_AGENT_LABELS[lead.assignedAgent]}</td>
                    <td>
                      <span className={`leads-status leads-status--${lead.status}`}>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {nextCursor ? (
            <button
              type="button"
              className="agent-btn agent-btn--ghost"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more leads"}
            </button>
          ) : null}
        </div>

        <aside className="leads-detail card">
          {selected ? (
            <>
              <header className="leads-detail__header">
                <div>
                  <p className="leads-detail__eyebrow">Lead detail</p>
                  <h2>{selected.name}</h2>
                </div>
                <span className={`leads-score ${scoreClass(selected.leadScore)}`}>
                  {selected.leadScore}
                </span>
              </header>

              <dl className="leads-detail__grid">
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phone}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selected.email}</dd>
                </div>
                <div>
                  <dt>Product interest</dt>
                  <dd>{selected.productInterest}</dd>
                </div>
                <div>
                  <dt>Lead score</dt>
                  <dd>{selected.leadScore}</dd>
                </div>
                <div>
                  <dt>Assigned agent</dt>
                  <dd>{LEAD_AGENT_LABELS[selected.assignedAgent]}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`leads-status leads-status--${selected.status}`}>
                      {LEAD_STATUS_LABELS[selected.status]}
                    </span>
                  </dd>
                </div>
              </dl>

              <section className="leads-detail__notes">
                <h3>Notes</h3>
                <p>{selected.notes}</p>
              </section>

              <footer className="leads-detail__footer">
                <span>Source: {selected.source}</span>
                <span>Updated {formatDate(selected.updatedAt)}</span>
              </footer>
            </>
          ) : (
            <EmptyState
              title="Select a lead"
              description="Choose a row to inspect contact details and notes."
            />
          )}
        </aside>
      </div>
        </>
      )}
    </div>
  );
}
