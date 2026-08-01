export type EvaluationStatus = "submitted" | "approved" | "rejected";

export type EvaluationFlowStepType = "checking" | "finished";

const ACTIVE_STATUSES: EvaluationStatus[] = ["submitted", "approved"];

export function isActiveEvaluationStatus(
  status: string | null | undefined,
): status is "submitted" | "approved" {
  return status === "submitted" || status === "approved";
}

export function canApproveEvaluation(status: string | null | undefined) {
  return status === "submitted";
}

/** Admin may reject only pending reviews. */
export function canRejectEvaluation(status: string | null | undefined) {
  return status === "submitted";
}

/** Admin may revoke approval and send the evaluation back to pending review. */
export function canUnapproveEvaluation(status: string | null | undefined) {
  return status === "approved";
}

export function canReopenEvaluation(status: string | null | undefined) {
  return status === "rejected";
}

/**
 * Prefer the actionable/active evaluation for a candidate list row.
 * Active statuses win over rejected history; newer ids break ties.
 */
export function pickPreferredEvaluationRow<
  T extends { evalId: number | null; evalStatus: string | null },
>(current: T, candidate: T): T {
  const currentActive = isActiveEvaluationStatus(current.evalStatus);
  const candidateActive = isActiveEvaluationStatus(candidate.evalStatus);

  if (currentActive !== candidateActive) {
    return candidateActive ? candidate : current;
  }

  const currentId = current.evalId ?? -1;
  const candidateId = candidate.evalId ?? -1;
  return candidateId > currentId ? candidate : current;
}

export function dedupeEvaluationCandidateRows<
  T extends {
    userFlowId: number;
    evalId: number | null;
    evalStatus: string | null;
  },
>(rows: T[]): T[] {
  const preferred = new Map<number, T>();

  for (const row of rows) {
    const existing = preferred.get(row.userFlowId);
    if (!existing) {
      preferred.set(row.userFlowId, row);
      continue;
    }
    preferred.set(row.userFlowId, pickPreferredEvaluationRow(existing, row));
  }

  return Array.from(preferred.values());
}

export function evaluationStepTypeForAction(
  action:
    | "submit_for_review"
    | "admin_decision"
    | "lecturer_reject",
): EvaluationFlowStepType {
  if (action === "lecturer_reject") return "checking";
  return "finished";
}

export { ACTIVE_STATUSES };
