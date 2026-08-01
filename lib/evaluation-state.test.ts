import {
  canApproveEvaluation,
  canRejectEvaluation,
  canReopenEvaluation,
  canUnapproveEvaluation,
  dedupeEvaluationCandidateRows,
  evaluationStepTypeForAction,
  isActiveEvaluationStatus,
  pickPreferredEvaluationRow,
} from "./evaluation-state";

describe("evaluation-state", () => {
  it("guards admin transitions", () => {
    expect(canApproveEvaluation("submitted")).toBe(true);
    expect(canApproveEvaluation("approved")).toBe(false);
    expect(canApproveEvaluation("rejected")).toBe(false);

    expect(canRejectEvaluation("submitted")).toBe(true);
    expect(canRejectEvaluation("approved")).toBe(false);
    expect(canRejectEvaluation("rejected")).toBe(false);

    expect(canUnapproveEvaluation("approved")).toBe(true);
    expect(canUnapproveEvaluation("submitted")).toBe(false);
    expect(canUnapproveEvaluation("rejected")).toBe(false);

    expect(canReopenEvaluation("rejected")).toBe(true);
    expect(canReopenEvaluation("submitted")).toBe(false);
  });

  it("prefers active evaluation rows over rejected history", () => {
    const rejected = { userFlowId: 1, evalId: 10, evalStatus: "rejected" };
    const submitted = { userFlowId: 1, evalId: 3, evalStatus: "submitted" };
    const approved = { userFlowId: 1, evalId: 2, evalStatus: "approved" };

    expect(pickPreferredEvaluationRow(rejected, submitted)).toEqual(submitted);
    expect(pickPreferredEvaluationRow(submitted, approved)).toEqual(submitted);
    expect(pickPreferredEvaluationRow(approved, rejected)).toEqual(approved);
    expect(isActiveEvaluationStatus("submitted")).toBe(true);
    expect(isActiveEvaluationStatus("rejected")).toBe(false);
  });

  it("dedupes candidate list by userFlowId", () => {
    const rows = [
      { userFlowId: 1, evalId: 1, evalStatus: "rejected" },
      { userFlowId: 1, evalId: 2, evalStatus: "submitted" },
      { userFlowId: 2, evalId: null, evalStatus: null },
      { userFlowId: 2, evalId: 5, evalStatus: "rejected" },
    ];

    expect(dedupeEvaluationCandidateRows(rows)).toEqual([
      { userFlowId: 1, evalId: 2, evalStatus: "submitted" },
      { userFlowId: 2, evalId: 5, evalStatus: "rejected" },
    ]);
  });

  it("maps actions to flow step types", () => {
    expect(evaluationStepTypeForAction("lecturer_reject")).toBe("checking");
    expect(evaluationStepTypeForAction("submit_for_review")).toBe("finished");
    expect(evaluationStepTypeForAction("admin_decision")).toBe("finished");
  });
});
