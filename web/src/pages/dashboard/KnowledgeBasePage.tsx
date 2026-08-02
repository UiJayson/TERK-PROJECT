import { useCallback, useEffect, useRef, useState } from "react";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  fetchKnowledgeItems,
  KNOWLEDGE_ITEM_TYPES,
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_TYPE_LABELS,
  searchKnowledgeSemantic,
  SECTION_LABELS,
  type KnowledgeItemType,
  type KnowledgeSearchResult,
  updateKnowledgeItem,
  uploadKnowledgeDocument,
  type KnowledgeItem,
  type KnowledgeSection,
} from "../../api/knowledge";
import { KnowledgeItemModal } from "../../components/knowledge/KnowledgeItemModal";
import { CompanyBrainEditor } from "../../components/knowledge/CompanyBrainEditor";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

type SectionFilter = KnowledgeSection | "all";
type KnowledgeView = "brain" | "entries";

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

import { usePermissions } from "../../auth/usePermissions";

export function KnowledgeBasePage() {
  const { canManageKnowledge, canDeleteKnowledge } = usePermissions();
  const [view, setView] = useState<KnowledgeView>("brain");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [section, setSection] = useState<SectionFilter>("all");
  const [query, setQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<KnowledgeSearchResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState("");
  const [indexStatus, setIndexStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadType, setUploadType] = useState<KnowledgeItemType>("document");
  const [uploadTags, setUploadTags] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);

  const loadItems = useCallback(async () => {
    setError("");
    try {
      const next = await fetchKnowledgeItems({
        section,
        q: query,
      });
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load knowledge");
    } finally {
      setLoading(false);
    }
  }, [section, query]);

  useEffect(() => {
    if (view !== "entries") return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void loadItems();
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadItems, query, view]);

  useEffect(() => {
    if (view !== "entries") return;
    const trimmed = semanticQuery.trim();
    if (!trimmed) {
      setSemanticResults([]);
      setSemanticError("");
      return;
    }

    setSemanticLoading(true);
    setSemanticError("");
    const timer = window.setTimeout(() => {
      void searchKnowledgeSemantic(trimmed)
        .then(setSemanticResults)
        .catch((err) => {
          setSemanticError(err instanceof Error ? err.message : "Semantic search failed");
          setSemanticResults([]);
        })
        .finally(() => setSemanticLoading(false));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [semanticQuery, view]);

  async function handleSave(input: {
    section: KnowledgeSection;
    type: KnowledgeItemType;
    tags: string;
    title: string;
    content: string;
  }) {
    setBusy(true);
    setError("");
    try {
      if (editing) {
        await updateKnowledgeItem(editing.id, input);
      } else {
        await createKnowledgeItem(input);
      }
      await loadItems();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: KnowledgeItem) {
    const confirmed = window.confirm(`Delete “${item.title}”? Agents will stop using this entry.`);
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await deleteKnowledgeItem(item.id);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    if (!uploadTitle.trim()) {
      setError("Title is required for document uploads.");
      return;
    }

    setBusy(true);
    setIndexStatus("Uploading & indexing…");
    setError("");
    try {
      const { item, chunksIndexed } = await uploadKnowledgeDocument(file, {
        title: uploadTitle.trim(),
        type: uploadType,
        tags: uploadTags,
      });
      setSection("documents");
      setShowUploadForm(false);
      setUploadTitle("");
      setUploadTags("");
      setIndexStatus(`Indexed ${chunksIndexed} chunk${chunksIndexed === 1 ? "" : "s"} for “${item.title}”`);
      window.setTimeout(() => setIndexStatus(""), 4000);
      await loadItems();
    } catch (err) {
      setIndexStatus("");
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultSection: KnowledgeSection =
    section === "all" ? "company" : section;

  return (
    <div className="page-stack">
      <PageHeader
        title="Knowledge Base"
        description="Edit Company Brain files and knowledge entries your agents retrieve via keyword search."
        actions={
          view === "entries" && canManageKnowledge ? (
            <div className="kb-header-actions">
              <button
                type="button"
                className="agent-btn agent-btn--ghost"
                onClick={() => setShowUploadForm((open) => !open)}
                disabled={busy}
              >
                {busy && indexStatus ? "Indexing…" : "Upload PDF / DOCX / TXT"}
              </button>
              <button
                type="button"
                className="agent-btn agent-btn--primary"
                onClick={() => {
                  setEditing(null);
                  setCreating(true);
                }}
              >
                Create entry
              </button>
            </div>
          ) : null
        }
      />

      <section className="kb-view-tabs" role="tablist" aria-label="Knowledge views">
        <button
          type="button"
          role="tab"
          className={`kb-section-tab ${view === "brain" ? "is-active" : ""}`}
          onClick={() => setView("brain")}
        >
          Company Brain
        </button>
        <button
          type="button"
          role="tab"
          className={`kb-section-tab ${view === "entries" ? "is-active" : ""}`}
          onClick={() => setView("entries")}
        >
          Entries & documents
        </button>
      </section>

      {view === "brain" ? (
        <CompanyBrainEditor readOnly={!canManageKnowledge} />
      ) : (
        <>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        hidden
        onChange={(event) => void handleUpload(event.target.files)}
      />

      {indexStatus ? <p className="kb-index-status">{indexStatus}</p> : null}

      {showUploadForm ? (
        <section className="card kb-upload-form">
          <h2 className="kb-semantic-search__title">Upload document</h2>
          <label className="kb-field">
            Title
            <input
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              required
              placeholder="Document title"
            />
          </label>
          <label className="kb-field">
            Type
            <select
              value={uploadType}
              onChange={(event) => setUploadType(event.target.value as KnowledgeItemType)}
              required
            >
              {KNOWLEDGE_ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {KNOWLEDGE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="kb-field">
            Tags (comma-separated)
            <input
              value={uploadTags}
              onChange={(event) => setUploadTags(event.target.value)}
              placeholder="policy, handbook"
            />
          </label>
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !uploadTitle.trim()}
          >
            Choose file & upload
          </button>
        </section>
      ) : null}

      <section className="kb-semantic-search card">
        <header className="kb-semantic-search__header">
          <div>
            <h2 className="kb-semantic-search__title">Test Search</h2>
            <p className="kb-semantic-search__hint">
              Type a customer question to see keyword-retrieved items with relevance scores.
            </p>
          </div>
        </header>
        <label className="kb-search kb-semantic-search__input">
          <span className="sr-only">Semantic search query</span>
          <input
            value={semanticQuery}
            onChange={(event) => setSemanticQuery(event.target.value)}
            placeholder="e.g. What is the hot desk price?"
          />
        </label>
        {semanticLoading ? <LoadingState label="Searching knowledge…" /> : null}
        {semanticError ? <ErrorBanner message={semanticError} onRetry={() => setSemanticQuery((q) => q)} /> : null}
        {!semanticLoading && semanticQuery.trim() && semanticResults.length === 0 && !semanticError ? (
          <p className="kb-semantic-search__empty">No matching items found.</p>
        ) : null}
        {semanticResults.length > 0 ? (
          <ul className="kb-semantic-results">
            {semanticResults.map((result) => (
              <li key={result.id} className="kb-semantic-result">
                <p className="kb-semantic-result__meta">
                  Score {result.relevanceScore} · {result.type} · {result.title}
                </p>
                <p className="kb-semantic-result__content">
                  {result.content.length > 320
                    ? `${result.content.slice(0, 320)}…`
                    : result.content}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="kb-toolbar">
        <div className="kb-sections" role="tablist" aria-label="Knowledge sections">
          <button
            type="button"
            role="tab"
            className={`kb-section-tab ${section === "all" ? "is-active" : ""}`}
            onClick={() => setSection("all")}
          >
            All
          </button>
          {KNOWLEDGE_SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={`kb-section-tab ${section === key ? "is-active" : ""}`}
              onClick={() => setSection(key)}
            >
              {SECTION_LABELS[key]}
            </button>
          ))}
        </div>

        <label className="kb-search">
          <span className="sr-only">Search knowledge</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, content, documents…"
          />
        </label>
      </section>

      {error ? <ErrorBanner message={error} onRetry={() => void loadItems()} /> : null}

      {loading ? (
        <LoadingState label="Loading knowledge…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No knowledge entries found"
          description="Create an entry or upload a PDF, DOCX, or TXT document."
          action={
            <button
              type="button"
              className="agent-btn agent-btn--primary"
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              Create entry
            </button>
          }
        />
      ) : (
        <section className="kb-list">
          {items.map((item) => (
            <article key={item.id} className="kb-item card">
              <header className="kb-item__header">
                <div>
                  <p className="kb-item__section">{SECTION_LABELS[item.section]}</p>
                  <h2 className="kb-item__title">{item.title}</h2>
                </div>
                <div className="kb-item__actions">
                  {canManageKnowledge ? (
                    <button
                      type="button"
                      className="agent-btn agent-btn--ghost"
                      onClick={() => {
                        setCreating(false);
                        setEditing(item);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {canDeleteKnowledge ? (
                    <button
                      type="button"
                      className="agent-btn agent-btn--ghost"
                      onClick={() => void handleDelete(item)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </header>

              <p className="kb-item__preview">
                {item.content.length > 220
                  ? `${item.content.slice(0, 220)}…`
                  : item.content}
              </p>

              <footer className="kb-item__footer">
                <span>Updated {formatDate(item.updatedAt)}</span>
                {item.document ? (
                  <span className="kb-item__file">{item.document.filename}</span>
                ) : null}
              </footer>
            </article>
          ))}
        </section>
      )}

      {!loading && section !== "all" ? (
        <p className="kb-count">
          {items.length} entr{items.length === 1 ? "y" : "ies"} in{" "}
          {SECTION_LABELS[section]}
        </p>
      ) : null}

      {creating || editing ? (
        <KnowledgeItemModal
          item={editing}
          defaultSection={defaultSection}
          busy={busy}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
        </>
      )}
    </div>
  );
}
