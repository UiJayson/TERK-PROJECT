import { useCallback, useEffect, useState } from "react";
import {
  fetchValidationQuestions,
  regenerateValidationQuestions,
  reviewValidationAnswer,
  type ValidationQuestion,
} from "../../api/validation";
import { Card } from "../../components/ui/Card";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";

export function ValidationPage() {
  const [questions, setQuestions] = useState<ValidationQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const { questions } = await fetchValidationQuestions();
      setQuestions(questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load validation questions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function regenerate() {
    setRegenerating(true);
    setError("");
    try {
      const { questions } = await regenerateValidationQuestions();
      setQuestions(questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  }

  async function review(
    id: string,
    status: "correct" | "incorrect" | "needs_improvement",
    correctedAnswer?: string,
  ) {
    try {
      const { question } = await reviewValidationAnswer(id, status, correctedAnswer);
      setQuestions((prev) => prev.map((q) => (q.id === id ? question : q)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="Staging validation" description="Review AI answers before going live." />
        <LoadingState label="Loading questions…" />
      </div>
    );
  }

  const correct = questions.filter((q) => q.status === "correct").length;
  const reviewed = questions.filter((q) => q.status !== "pending").length;
  const passRate = reviewed === 0 ? 0 : Math.round((correct / reviewed) * 100);

  return (
    <div className="page-stack">
      <PageHeader
        title="Staging validation"
        description="Review the AI's answers to auto-generated test questions. Deployment is gated on a minimum pass rate."
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card title="Overview">
        <p className="integrations-copy">
          Reviewed: {reviewed} / {questions.length} · Correct: {correct} · Pass rate: {passRate}%
        </p>
        <button
          type="button"
          className="agent-btn agent-btn--primary"
          onClick={() => void regenerate()}
          disabled={regenerating}
        >
          {regenerating ? "Regenerating…" : "Regenerate questions from current data"}
        </button>
      </Card>

      {questions.map((q) => (
        <QuestionRow key={q.id} q={q} onReview={review} />
      ))}
      {questions.length === 0 ? (
        <Card title="No questions yet">
          <p className="integrations-copy">
            Click "Regenerate" above to build a test set from your onboarding data and any uploaded documents.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function QuestionRow({
  q,
  onReview,
}: {
  q: ValidationQuestion;
  onReview: (id: string, status: "correct" | "incorrect" | "needs_improvement", correctedAnswer?: string) => void;
}) {
  const [correction, setCorrection] = useState(q.correctedAnswer ?? "");
  return (
    <Card title={q.question}>
      <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
        Category: {q.category} · Source: {q.aiAnswerSource ?? "—"} · Status: {q.status}
      </div>
      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{q.aiAnswer ?? "(no answer)"}</div>
      {q.status !== "correct" ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            placeholder="If incorrect, type the correct answer here…"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
      ) : null}
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="agent-btn agent-btn--primary" onClick={() => onReview(q.id, "correct")}>
          ✅ Correct
        </button>
        <button
          className="agent-btn agent-btn--ghost"
          onClick={() => onReview(q.id, "incorrect", correction)}
          disabled={!correction.trim()}
        >
          ❌ Incorrect
        </button>
        <button
          className="agent-btn agent-btn--ghost"
          onClick={() => onReview(q.id, "needs_improvement", correction)}
          disabled={!correction.trim()}
        >
          ✏️ Needs improvement
        </button>
      </div>
    </Card>
  );
}
