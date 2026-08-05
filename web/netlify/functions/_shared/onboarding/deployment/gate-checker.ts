/**
 * Deployment gate (Problem 3 §Step 5). Enforced at the API level — the go-live
 * endpoint calls {@link canGoLive} and rejects the transition if any condition
 * fails. Not a warning, not a UI hint: a hard lock.
 *
 * Conditions (all must be true):
 *  ✓ Onboarding wizard is 100% complete
 *  ✓ All critical categories have at least one verified-correct answer
 *  ✓ Zero unresolved knowledge-base contradictions
 *  ✓ At least one escalation contact is defined
 *  ✓ Synthetic validation pass rate >= threshold (configurable, default 80%)
 */

import { ensureDbConnection, getSql } from "../../db.ts";
import { listEscalationContacts } from "../business-store.ts";
import { countContradictions } from "../ingestion/document-store.ts";
import {
  listStagingQuestions,
  refreshValidationPassRate,
} from "../validation/staging-controller.ts";
import { getWizardStatus } from "../wizard/wizard-controller.ts";
import { CRITICAL_CATEGORIES, type CriticalCategory } from "../types.ts";

export interface GateCheckResult {
  canGoLive: boolean;
  status: "draft" | "staging" | "live";
  wizardComplete: boolean;
  wizardMissing: string[];
  contradictionCount: number;
  validationPassRate: number;
  passRateThreshold: number;
  criticalCategoriesVerified: CriticalCategory[];
  criticalCategoriesMissing: CriticalCategory[];
  escalationContactCount: number;
  reasons: string[];
  lastCheckedAt: string;
}

const DEFAULT_PASS_RATE_THRESHOLD = 80;

export async function checkDeploymentGate(
  workspaceId: string,
  passRateThreshold: number = DEFAULT_PASS_RATE_THRESHOLD,
): Promise<GateCheckResult> {
  const [wizard, contradictionCount, contacts, questions, passRate] = await Promise.all([
    getWizardStatus(workspaceId),
    countContradictions(workspaceId),
    listEscalationContacts(workspaceId),
    listStagingQuestions(workspaceId),
    refreshValidationPassRate(workspaceId),
  ]);

  const verifiedCategories = new Set<CriticalCategory>();
  for (const q of questions) {
    if (q.status === "correct" && CRITICAL_CATEGORIES.includes(q.category as CriticalCategory)) {
      verifiedCategories.add(q.category as CriticalCategory);
    }
  }
  const missing = CRITICAL_CATEGORIES.filter((c) => !verifiedCategories.has(c));

  const reasons: string[] = [];
  if (!wizard.complete) {
    reasons.push(`Onboarding wizard incomplete: ${wizard.sectionsMissing.join(", ")}`);
  }
  if (missing.length > 0) {
    reasons.push(`No verified answer for critical categories: ${missing.join(", ")}`);
  }
  if (contradictionCount > 0) {
    reasons.push(`${contradictionCount} unresolved knowledge-base contradiction(s)`);
  }
  if (contacts.length === 0) {
    reasons.push("At least one escalation contact must be defined");
  }
  if (passRate < passRateThreshold) {
    reasons.push(
      `Validation pass rate ${passRate.toFixed(1)}% is below required ${passRateThreshold}%`,
    );
  }

  const canGo = reasons.length === 0;
  const now = new Date().toISOString();

  await persistGateResult(workspaceId, {
    verifiedCategories: [...verifiedCategories],
    contradictionCount,
    passRate,
    lockedReason: canGo ? null : reasons.join(" · "),
  });

  const status = await getStoredStatus(workspaceId);

  return {
    canGoLive: canGo,
    status,
    wizardComplete: wizard.complete,
    wizardMissing: wizard.sectionsMissing,
    contradictionCount,
    validationPassRate: passRate,
    passRateThreshold,
    criticalCategoriesVerified: [...verifiedCategories],
    criticalCategoriesMissing: missing,
    escalationContactCount: contacts.length,
    reasons,
    lastCheckedAt: now,
  };
}

async function persistGateResult(
  workspaceId: string,
  patch: {
    verifiedCategories: CriticalCategory[];
    contradictionCount: number;
    passRate: number;
    lockedReason: string | null;
  },
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    INSERT INTO deployment_status
      (workspace_id, critical_categories_verified, contradiction_count,
       validation_pass_rate, last_gate_check, locked_reason)
    VALUES
      (${workspaceId}, ${patch.verifiedCategories as unknown as string[]},
       ${patch.contradictionCount}, ${patch.passRate}, now(), ${patch.lockedReason})
    ON CONFLICT (workspace_id) DO UPDATE SET
      critical_categories_verified = EXCLUDED.critical_categories_verified,
      contradiction_count          = EXCLUDED.contradiction_count,
      validation_pass_rate         = EXCLUDED.validation_pass_rate,
      last_gate_check              = now(),
      locked_reason                = EXCLUDED.locked_reason
  `;
}

async function getStoredStatus(workspaceId: string): Promise<"draft" | "staging" | "live"> {
  const db = getSql();
  const rows = await db`
    SELECT status FROM deployment_status WHERE workspace_id = ${workspaceId} LIMIT 1
  `;
  const s = rows.length > 0 ? String(rows[0].status) : "draft";
  return s === "live" ? "live" : s === "staging" ? "staging" : "draft";
}

/**
 * Attempt the staging → live transition. Runs {@link checkDeploymentGate} and
 * flips the status only when it passes. Any failure is a 409, not a 200 with a
 * warning.
 */
export async function goLive(workspaceId: string): Promise<GateCheckResult> {
  const gate = await checkDeploymentGate(workspaceId);
  if (!gate.canGoLive) {
    return gate;
  }
  await ensureDbConnection();
  const db = getSql();
  await db`
    UPDATE deployment_status
    SET status = 'live', went_live_at = now(), locked_reason = NULL
    WHERE workspace_id = ${workspaceId}
  `;
  return { ...gate, status: "live" };
}

/** Move draft → staging (a soft transition; only live is gated). */
export async function moveToStaging(workspaceId: string): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    INSERT INTO deployment_status (workspace_id, status)
    VALUES (${workspaceId}, 'staging')
    ON CONFLICT (workspace_id) DO UPDATE
    SET status = CASE WHEN deployment_status.status = 'live' THEN 'live' ELSE 'staging' END
  `;
}
