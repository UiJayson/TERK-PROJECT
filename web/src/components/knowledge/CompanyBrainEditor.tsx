import { useEffect, useState } from "react";
import {
  fetchSharedKnowledgeFiles,
  saveSharedKnowledgeFile,
  SHARED_KNOWLEDGE_FILES,
  type SharedKnowledgeFilePath,
} from "../../api/knowledge";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LoadingState } from "../ui/LoadingState";

export function CompanyBrainEditor({ readOnly = false }: { readOnly?: boolean }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState<SharedKnowledgeFilePath>(
    SHARED_KNOWLEDGE_FILES[0].path,
  );
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    setLoading(true);
    try {
      const next = await fetchSharedKnowledgeFiles();
      setFiles(next);
      setDraft(next[activePath] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Company Brain files");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function selectFile(path: SharedKnowledgeFilePath) {
    setActivePath(path);
    setDraft(files[path] ?? "");
    setSuccess("");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await saveSharedKnowledgeFile(activePath, draft);
      setFiles((current) => ({ ...current, [activePath]: draft }));
      setSuccess("Saved — agents will use this on the next message.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save file");
    } finally {
      setSaving(false);
    }
  }

  const activeMeta = SHARED_KNOWLEDGE_FILES.find((file) => file.path === activePath);

  if (loading) {
    return <LoadingState label="Loading Company Brain files…" />;
  }

  return (
    <section className="kb-brain">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {success ? <p className="kb-brain__success">{success}</p> : null}

      <div className="kb-brain__layout">
        <nav className="kb-brain__nav" aria-label="Company Brain files">
          {SHARED_KNOWLEDGE_FILES.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`kb-brain__file-tab ${activePath === file.path ? "is-active" : ""}`}
              onClick={() => selectFile(file.path)}
            >
              <span className="kb-brain__file-label">{file.label}</span>
              <span className="kb-brain__file-hint">{file.hint}</span>
            </button>
          ))}
        </nav>

        <div className="kb-brain__editor card">
          <header className="kb-brain__header">
            <div>
              <h2>{activeMeta?.label}</h2>
              <p>{activeMeta?.hint}</p>
            </div>
            {readOnly ? null : (
              <button
                type="button"
                className="agent-btn agent-btn--primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save file"}
              </button>
            )}
          </header>

          <label className="kb-brain__field">
            <span className="sr-only">{activeMeta?.label} markdown</span>
            <textarea
              className="kb-brain__textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
            />
          </label>

          <footer className="kb-brain__footer">
            <code>{activePath}</code>
            <span>Saved to Netlify Blobs per workspace — injected into every agent prompt.</span>
          </footer>
        </div>
      </div>
    </section>
  );
}
