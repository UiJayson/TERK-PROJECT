/**
 * Staging controller (Problem 3 §Step 4). Persists generated questions with the
 * router's answer for owner review, and lets the owner mark each answer
 * correct / incorrect / needs-improvement (with an optional correction).
 *
 * `validation_pass_rate` is exposed to the deployment gate (Step 5).
 */

import { createId } from "../../auth-crypto.ts";
import { ensureDbConnection, getSql } from "../../db.ts";
import { routeQuery } from "../retrieval/router.ts";
import { generateSyntheticQuestions } from "./question-generator.ts";
import type { CriticalCategory } from "../types.ts";

export interface ValidationQuestionRow {
  id: string;
  workspaceId: string;
  question: string;
  category: CriticalCategory | "general";
  aiAnswer: string | null;
  aiAnswerSource: string | null;
  status: "pending" | "correct" | "incorrect" | "needs_improvement";
  correctedAnswer: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function rowToQuestion(row: Record<string, unknown>): ValidationQuestionRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    question: String(row.question),
    category: String(row.category) as ValidationQuestionRow["category"],
    aiAnswer: (row.ai_answer as string | null) ?? null,
    aiAnswerSource: (row.ai_answer_source as string | null) ?? null,
    status: String(row.status) as ValidationQuestionRow["status"],
    correctedAnswer: (row.corrected_answer as string | null) ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/**
 * Regenerate the tenant's synthetic-question set. Existing rows are cleared and
 * each new question is answered by the router (so the owner sees Track 1 vs
 * Track 2 vs fallback labels in the UI).
 */
export async function regenerateStagingQuestions(
  workspaceId: string,
): Promise<ValidationQuestionRow[]> {
  await ensureDbConnection();
  const db = getSql();

  const questions = await generateSyntheticQuestions(workspaceId);
  await db`DELETE FROM validation_questions WHERE workspace_id = ${workspaceId}`;

  const results: ValidationQuestionRow[] = [];
  for (const q of questions) {
    const answered = await routeQuery({ workspaceId, message: q.question });
    const id = createId("val");
    await db`
      INSERT INTO validation_questions
        (id, workspace_id, question, category, ai_answer, ai_answer_source, status)
      VALUES
        (${id}, ${workspaceId}, ${q.question}, ${q.category},
         ${answered.answer}, ${answered.source}, 'pending')
    `;
    results.push({
      id,
      workspaceId,
      question: q.question,
      category: q.category,
      aiAnswer: answered.answer,
      aiAnswerSource: answered.source,
      status: "pending",
      correctedAnswer: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  await refreshValidationPassRate(workspaceId);
  return results;
}

export async function listStagingQuestions(
  workspaceId: string,
): Promise<ValidationQuestionRow[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT * FROM validation_questions WHERE workspace_id = ${workspaceId}
    ORDER BY created_at ASC
  `;
  return rows.map(rowToQuestion);
}

export async function reviewStagingAnswer(
  workspaceId: string,
  questionId: string,
  status: "correct" | "incorrect" | "needs_improvement",
  correctedAnswer?: string,
): Promise<ValidationQuestionRow> {
  await ensureDbConnection();
  const db = getSql();
  if (status !== "correct" && !correctedAnswer?.trim()) {
    throw new Error("VALIDATION_REQUIRES_CORRECTED_ANSWER");
  }
  const rows = await db`
    UPDATE validation_questions SET
      status           = ${status},
      corrected_answer = ${correctedAnswer ?? null},
      reviewed_at      = now()
    WHERE id = ${questionId} AND workspace_id = ${workspaceId}
    RETURNING *
  `;
  if (rows.length === 0) throw new Error("VALIDATION_QUESTION_NOT_FOUND");
  await refreshValidationPassRate(workspaceId);
  return rowToQuestion(rows[0]);
}

/** Recompute pass rate = correct ÷ reviewed, and persist it for the gate. */
export async function refreshValidationPassRate(workspaceId: string): Promise<number> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT
      count(*) FILTER (WHERE status = 'correct')::int AS correct_count,
      count(*) FILTER (WHERE status IN ('correct','incorrect','needs_improvement'))::int AS reviewed_count
    FROM validation_questions WHERE workspace_id = ${workspaceId}
  `;
  const correct = Number(rows[0]?.correct_count ?? 0);
  const reviewed = Number(rows[0]?.reviewed_count ?? 0);
  const rate = reviewed === 0 ? 0 : (correct / reviewed) * 100;
  await db`
    INSERT INTO deployment_status (workspace_id, validation_pass_rate)
    VALUES (${workspaceId}, ${rate})
    ON CONFLICT (workspace_id) DO UPDATE SET validation_pass_rate = EXCLUDED.validation_pass_rate
  `;
  return rate;
}
