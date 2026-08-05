import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "./_shared/db-errors.ts";
import { withObservability } from "./_shared/observability.ts";
import {
  jsonResponse,
  optionsResponse,
  requireAuthWithWorkspaceAccess,
  withRole,
} from "./_shared/auth-http.ts";
import {
  listStagingQuestions,
  regenerateStagingQuestions,
  reviewStagingAnswer,
} from "./_shared/onboarding/validation/staging-controller.ts";

/**
 * Staging validation API (Problem 3 §Step 4). Owner reviews AI-generated
 * answers, marks each correct / incorrect / needs_improvement, and can supply
 * a corrected answer. Pass rate is recomputed on every review and consumed by
 * the deployment gate.
 */
async function handler(req: Request, context: Context) {
  if (req.method === "OPTIONS") return optionsResponse();

  const auth = await requireAuthWithWorkspaceAccess(req);
  if (auth instanceof Response) return auth;
  const workspaceId = auth.workspace.id;
  const action = context.params?.action;
  const questionId = context.params?.questionId;

  try {
    // GET /api/validation/questions
    if (req.method === "GET" && (!action || action === "questions")) {
      const questions = await listStagingQuestions(workspaceId);
      return jsonResponse({ questions });
    }

    // POST /api/validation/regenerate — rebuild the question set.
    if (req.method === "POST" && action === "regenerate") {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      const questions = await regenerateStagingQuestions(workspaceId);
      return jsonResponse({ ok: true, questions });
    }

    // POST /api/validation/answer/:questionId  { status, correctedAnswer? }
    if (req.method === "POST" && action === "answer" && questionId) {
      const denied = withRole(auth, ["owner", "admin"]);
      if (denied) return denied;
      const body = (await req.json().catch(() => ({}))) as {
        status?: "correct" | "incorrect" | "needs_improvement";
        correctedAnswer?: string;
      };
      if (!body.status) {
        return jsonResponse({ error: "status is required" }, { status: 400 });
      }
      const updated = await reviewStagingAnswer(
        workspaceId,
        questionId,
        body.status,
        body.correctedAnswer,
      );
      return jsonResponse({ ok: true, question: updated });
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    if (message === "VALIDATION_REQUIRES_CORRECTED_ANSWER") {
      return jsonResponse(
        { error: "A corrected answer is required when marking incorrect or needs_improvement." },
        { status: 400 },
      );
    }
    if (message === "VALIDATION_QUESTION_NOT_FOUND") {
      return jsonResponse({ error: "Question not found." }, { status: 404 });
    }
    console.error("validation.ts request failed:", error);
    return jsonResponse({ error: publicErrorMessage(error, "Request failed") }, { status: 500 });
  }
}

export const config: Config = {
  path: [
    "/api/validation",
    "/api/validation/:action",
    "/api/validation/:action/:questionId",
  ],
};

export default withObservability(handler);
