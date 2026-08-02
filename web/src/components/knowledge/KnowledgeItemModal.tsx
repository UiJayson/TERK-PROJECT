import { FormEvent, useEffect, useState } from "react";
import {
  KNOWLEDGE_ITEM_TYPES,
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_TYPE_LABELS,
  SECTION_LABELS,
  type KnowledgeItem,
  type KnowledgeItemType,
  type KnowledgeSection,
} from "../../api/knowledge";

interface KnowledgeItemModalProps {
  item?: KnowledgeItem | null;
  defaultSection: KnowledgeSection;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: {
    section: KnowledgeSection;
    type: KnowledgeItemType;
    tags: string;
    title: string;
    content: string;
  }) => Promise<void>;
}

export function KnowledgeItemModal({
  item,
  defaultSection,
  busy,
  onClose,
  onSave,
}: KnowledgeItemModalProps) {
  const [section, setSection] = useState<KnowledgeSection>(item?.section ?? defaultSection);
  const [type, setType] = useState<KnowledgeItemType>(
    (item?.type as KnowledgeItemType) ?? "service",
  );
  const [tags, setTags] = useState(item?.tags?.join(", ") ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSave({ section, type, tags, title, content });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-labelledby="knowledge-item-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-panel__header">
          <div>
            <p className="modal-panel__eyebrow">Knowledge Base</p>
            <h2 id="knowledge-item-title">{item ? "Edit entry" : "Create entry"}</h2>
          </div>
          <button type="button" className="modal-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <form
          className="modal-panel__body"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label className="kb-field">
            Section
            <select
              value={section}
              onChange={(event) => setSection(event.target.value as KnowledgeSection)}
              disabled={Boolean(item?.document)}
            >
              {KNOWLEDGE_SECTIONS.map((value) => (
                <option key={value} value={value}>
                  {SECTION_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="kb-field">
            Type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as KnowledgeItemType)}
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
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              placeholder="e.g. Opening hours"
            />
          </label>

          <label className="kb-field">
            Tags (comma-separated)
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="hours, location, contact"
            />
          </label>

          <label className="kb-field">
            Content
            <textarea
              rows={10}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required
              placeholder="Facts your AI agents can use. Keep this accurate and up to date."
            />
          </label>

          {item?.document ? (
            <p className="modal-section__hint">
              Source file: {item.document.filename}
            </p>
          ) : null}

          {error ? <p className="auth-form__error">{error}</p> : null}

          <div className="modal-panel__actions">
            <button type="button" className="agent-btn agent-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="agent-btn agent-btn--primary" disabled={busy}>
              {busy ? "Saving…" : "Save to shared knowledge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
