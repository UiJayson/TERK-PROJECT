import { useCallback, useEffect, useState } from "react";
import {
  fetchOnboarding,
  listContradictions,
  listDocuments,
  resolveContradiction,
  submitOnboardingSection,
  uploadDocument,
  type FlaggedChunk,
  type OnboardingData,
  type UploadedDocument,
  type WizardStatus,
} from "../../api/onboarding";
import { Card } from "../../components/ui/Card";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

const SECTION_LABEL: Record<string, string> = {
  business_info: "Business info",
  operating_hours: "Operating hours",
  pricing: "Pricing",
  policies: "Policies",
  escalation: "Escalation",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function OnboardingPage() {
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [data, setData] = useState<OnboardingData | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [flagged, setFlagged] = useState<FlaggedChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sectionError, setSectionError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [{ status: s, data: d }, docs, flags] = await Promise.all([
        fetchOnboarding(),
        listDocuments().catch(() => ({ documents: [] })),
        listContradictions().catch(() => ({ chunks: [] })),
      ]);
      setStatus(s);
      setData(d);
      setDocuments(docs.documents);
      setFlagged(flags.chunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load onboarding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(section: string, payload: unknown) {
    setSectionError("");
    setSaving(section);
    try {
      const { status: s } = await submitOnboardingSection(section, payload);
      setStatus(s);
      await load();
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      await uploadDocument(file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function resolveFlag(chunkId: string, action: "confirm" | "discard" | "edit", correctedText?: string) {
    try {
      const { remaining } = await resolveContradiction(chunkId, action, correctedText);
      setFlagged(remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Onboarding" description="Set up your verified business data." />
        <LoadingState label="Loading onboarding…" />
      </div>
    );
  }

  const wizardComplete = status?.complete ?? false;

  return (
    <div className="page-stack">
      <PageHeader
        title="Onboarding"
        description="Verified business data is the source of truth. Documents supplement it — they never override it."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {sectionError ? <ErrorBanner message={sectionError} /> : null}

      <Card title="Wizard progress">
        <p className="integrations-copy">
          {wizardComplete
            ? "All sections complete — you can now upload supplementary documents below."
            : `Missing: ${(status?.sectionsMissing ?? []).map((s) => SECTION_LABEL[s] ?? s).join(", ")}`}
        </p>
        <ul className="integrations-copy" style={{ marginTop: 8, listStyle: "none", padding: 0 }}>
          {Object.entries(SECTION_LABEL).map(([key, label]) => {
            const done = (status?.sectionsComplete ?? []).includes(key);
            return (
              <li key={key}>
                <span
                  className={`channel-badge channel-badge--${done ? "connected" : "disconnected"}`}
                  style={{ marginRight: 8 }}
                >
                  {done ? "Done" : "Todo"}
                </span>
                {label}
              </li>
            );
          })}
        </ul>
      </Card>

      <BusinessInfoSection data={data} saving={saving === "business_info"} onSave={(p) => submit("business_info", p)} />
      <OperatingHoursSection data={data} saving={saving === "operating_hours"} onSave={(p) => submit("operating_hours", p)} />
      <PricingSection data={data} saving={saving === "pricing"} onSave={(p) => submit("pricing", p)} />
      <PoliciesSection data={data} saving={saving === "policies"} onSave={(p) => submit("policies", p)} />
      <EscalationSection data={data} saving={saving === "escalation"} onSave={(p) => submit("escalation", p)} />

      <Card title="Document upload">
        {!wizardComplete ? (
          <p className="integrations-copy">Complete the wizard above before uploading documents.</p>
        ) : (
          <>
            <p className="integrations-copy">
              Upload PDF, DOCX, or TXT. Chunks that contradict verified data are flagged and held out of the knowledge base until you resolve them.
            </p>
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            {documents.length > 0 ? (
              <ul className="integrations-copy" style={{ marginTop: 12 }}>
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <strong>{doc.filename}</strong> — {doc.uploadStatus} · {doc.contradictionStatus}
                    {doc.errorMessage ? ` · ${doc.errorMessage}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Card>

      <Card title={`Contradiction review (${flagged.length})`}>
        {flagged.length === 0 ? (
          <p className="integrations-copy">No contradictions to resolve.</p>
        ) : (
          <ul className="integrations-copy" style={{ padding: 0, listStyle: "none" }}>
            {flagged.map((chunk) => (
              <FlaggedChunkRow key={chunk.id} chunk={chunk} onResolve={resolveFlag} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BusinessInfoSection({
  data,
  saving,
  onSave,
}: {
  data: OnboardingData | null;
  saving: boolean;
  onSave: (payload: unknown) => void;
}) {
  const p = data?.profile;
  const [businessName, setBusinessName] = useState(p?.businessName ?? "");
  const [industry, setIndustry] = useState(p?.industry ?? "");
  const [supportEmail, setSupportEmail] = useState(p?.supportEmail ?? "");
  const [phone, setPhone] = useState(p?.phone ?? "");
  const [timezone, setTimezone] = useState(p?.timezone ?? "UTC");
  useEffect(() => {
    if (!p) return;
    setBusinessName(p.businessName);
    setIndustry(p.industry);
    setSupportEmail(p.supportEmail);
    setPhone(p.phone);
    setTimezone(p.timezone);
  }, [p]);
  return (
    <Card title="Business info">
      <div className="onboarding-grid">
        <label>Business name<input value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></label>
        <label>Industry<input value={industry} onChange={(e) => setIndustry(e.target.value)} /></label>
        <label>Support email<input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} /></label>
        <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label>Timezone<input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
      </div>
      <button
        type="button"
        className="agent-btn agent-btn--primary"
        onClick={() => onSave({ businessName, industry, supportEmail, phone, timezone })}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save business info"}
      </button>
    </Card>
  );
}

function OperatingHoursSection({
  data,
  saving,
  onSave,
}: {
  data: OnboardingData | null;
  saving: boolean;
  onSave: (payload: unknown) => void;
}) {
  const existing = data?.hours ?? [];
  const initial = DAY_NAMES.map((_, i) => {
    const found = existing.find((h) => h.dayOfWeek === i);
    return (
      found ?? {
        id: `new-${i}`,
        dayOfWeek: i,
        openTime: "09:00",
        closeTime: "17:00",
        isClosed: i === 0,
        isHoliday: false,
        holidayLabel: null,
      }
    );
  });
  const [days, setDays] = useState(initial);
  useEffect(() => {
    setDays(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return (
    <Card title="Operating hours">
      <table className="onboarding-table">
        <tbody>
          {days.map((d, i) => (
            <tr key={d.dayOfWeek}>
              <td>{DAY_NAMES[d.dayOfWeek]}</td>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={d.isClosed}
                    onChange={(e) => {
                      const next = [...days];
                      next[i] = { ...next[i], isClosed: e.target.checked };
                      setDays(next);
                    }}
                  /> Closed
                </label>
              </td>
              <td>
                <input
                  type="time"
                  disabled={d.isClosed}
                  value={d.openTime ?? "09:00"}
                  onChange={(e) => {
                    const next = [...days];
                    next[i] = { ...next[i], openTime: e.target.value };
                    setDays(next);
                  }}
                />
              </td>
              <td>
                <input
                  type="time"
                  disabled={d.isClosed}
                  value={d.closeTime ?? "17:00"}
                  onChange={(e) => {
                    const next = [...days];
                    next[i] = { ...next[i], closeTime: e.target.value };
                    setDays(next);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="agent-btn agent-btn--primary"
        onClick={() =>
          onSave(
            days.map((d) => ({
              dayOfWeek: d.dayOfWeek,
              openTime: d.isClosed ? null : d.openTime,
              closeTime: d.isClosed ? null : d.closeTime,
              isClosed: d.isClosed,
            })),
          )
        }
        disabled={saving}
      >
        {saving ? "Saving…" : "Save hours"}
      </button>
    </Card>
  );
}

function PricingSection({
  data,
  saving,
  onSave,
}: {
  data: OnboardingData | null;
  saving: boolean;
  onSave: (payload: unknown) => void;
}) {
  const [items, setItems] = useState(
    data?.prices?.length
      ? data.prices.map((p) => ({ name: p.name, description: p.description, price: p.price, currency: p.currency }))
      : [{ name: "", description: "", price: 0, currency: "USD" }],
  );
  useEffect(() => {
    if (data?.prices?.length) {
      setItems(data.prices.map((p) => ({ name: p.name, description: p.description, price: p.price, currency: p.currency })));
    }
  }, [data]);
  return (
    <Card title="Pricing">
      {items.map((item, i) => (
        <div key={i} className="onboarding-grid">
          <label>Name<input value={item.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
          <label>Price<input type="number" step="0.01" value={item.price} onChange={(e) => update(i, { price: Number(e.target.value) })} /></label>
          <label>Currency<input value={item.currency} onChange={(e) => update(i, { currency: e.target.value })} /></label>
          <label>Description<input value={item.description} onChange={(e) => update(i, { description: e.target.value })} /></label>
        </div>
      ))}
      <button type="button" className="agent-btn agent-btn--ghost" onClick={() => setItems([...items, { name: "", description: "", price: 0, currency: "USD" }])}>
        + Add item
      </button>
      <button type="button" className="agent-btn agent-btn--primary" onClick={() => onSave(items)} disabled={saving}>
        {saving ? "Saving…" : "Save pricing"}
      </button>
    </Card>
  );
  function update(i: number, patch: Partial<(typeof items)[number]>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }
}

function PoliciesSection({
  data,
  saving,
  onSave,
}: {
  data: OnboardingData | null;
  saving: boolean;
  onSave: (payload: unknown) => void;
}) {
  const [items, setItems] = useState(
    data?.policies?.length
      ? data.policies.map((p) => ({ policyType: p.policyType, ruleText: p.ruleText, windowDays: p.windowDays ?? null }))
      : [{ policyType: "refund", ruleText: "", windowDays: 7 as number | null }],
  );
  useEffect(() => {
    if (data?.policies?.length) {
      setItems(data.policies.map((p) => ({ policyType: p.policyType, ruleText: p.ruleText, windowDays: p.windowDays ?? null })));
    }
  }, [data]);
  return (
    <Card title="Policies (refund required)">
      {items.map((item, i) => (
        <div key={i} className="onboarding-grid">
          <label>Type
            <select value={item.policyType} onChange={(e) => update(i, { policyType: e.target.value })}>
              <option value="refund">refund</option>
              <option value="cancellation">cancellation</option>
              <option value="exchange">exchange</option>
              <option value="delivery">delivery</option>
              <option value="damage">damage</option>
            </select>
          </label>
          <label>Window (days)<input type="number" value={item.windowDays ?? 0} onChange={(e) => update(i, { windowDays: Number(e.target.value) })} /></label>
          <label>Rule text<input value={item.ruleText} onChange={(e) => update(i, { ruleText: e.target.value })} /></label>
        </div>
      ))}
      <button type="button" className="agent-btn agent-btn--ghost" onClick={() => setItems([...items, { policyType: "cancellation", ruleText: "", windowDays: null }])}>
        + Add policy
      </button>
      <button type="button" className="agent-btn agent-btn--primary" onClick={() => onSave(items)} disabled={saving}>
        {saving ? "Saving…" : "Save policies"}
      </button>
    </Card>
  );
  function update(i: number, patch: Partial<(typeof items)[number]>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }
}

function EscalationSection({
  data,
  saving,
  onSave,
}: {
  data: OnboardingData | null;
  saving: boolean;
  onSave: (payload: unknown) => void;
}) {
  const [items, setItems] = useState(
    data?.escalations?.length
      ? data.escalations.map((e) => ({ role: e.role, name: e.name, email: e.email, phone: e.phone }))
      : [{ role: "support", name: "", email: "", phone: "" }],
  );
  useEffect(() => {
    if (data?.escalations?.length) {
      setItems(data.escalations.map((e) => ({ role: e.role, name: e.name, email: e.email, phone: e.phone })));
    }
  }, [data]);
  return (
    <Card title="Escalation contacts">
      {items.map((item, i) => (
        <div key={i} className="onboarding-grid">
          <label>Role
            <select value={item.role} onChange={(e) => update(i, { role: e.target.value })}>
              <option value="support">support</option>
              <option value="manager">manager</option>
              <option value="emergency">emergency</option>
            </select>
          </label>
          <label>Name<input value={item.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
          <label>Email<input type="email" value={item.email} onChange={(e) => update(i, { email: e.target.value })} /></label>
          <label>Phone<input value={item.phone} onChange={(e) => update(i, { phone: e.target.value })} /></label>
        </div>
      ))}
      <button type="button" className="agent-btn agent-btn--ghost" onClick={() => setItems([...items, { role: "support", name: "", email: "", phone: "" }])}>
        + Add contact
      </button>
      <button type="button" className="agent-btn agent-btn--primary" onClick={() => onSave(items)} disabled={saving}>
        {saving ? "Saving…" : "Save contacts"}
      </button>
    </Card>
  );
  function update(i: number, patch: Partial<(typeof items)[number]>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }
}

function FlaggedChunkRow({
  chunk,
  onResolve,
}: {
  chunk: FlaggedChunk;
  onResolve: (chunkId: string, action: "confirm" | "discard" | "edit", correctedText?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(chunk.chunkText);
  return (
    <li style={{ padding: 12, borderBottom: "1px solid var(--border, #e5e7eb)" }}>
      <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
        {chunk.filename ?? "unknown source"} · {chunk.category}
      </div>
      <div style={{ marginTop: 4 }}>{editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} style={{ width: "100%" }} />
      ) : chunk.chunkText}</div>
      <div style={{ marginTop: 6, color: "var(--danger, #b91c1c)" }}>
        <strong>Contradiction:</strong> {chunk.contradictionDetail}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {editing ? (
          <button className="agent-btn agent-btn--primary" onClick={() => onResolve(chunk.id, "edit", text)}>
            Save edit
          </button>
        ) : (
          <>
            <button className="agent-btn agent-btn--ghost" onClick={() => setEditing(true)}>Edit</button>
            <button className="agent-btn agent-btn--ghost" onClick={() => onResolve(chunk.id, "confirm")}>Confirm as-is</button>
            <button className="agent-btn agent-btn--ghost" onClick={() => onResolve(chunk.id, "discard")}>Discard</button>
          </>
        )}
      </div>
    </li>
  );
}
