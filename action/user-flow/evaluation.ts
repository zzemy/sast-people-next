"use server";

import { db } from "@/db/drizzle";
import {
  flow,
  flowStep,
  interviewEvaluation,
  interviewSchedule,
  userFlow,
} from "@/db/schema";
import {
  ACTIVE_STATUSES,
  canApproveEvaluation,
  canRejectEvaluation,
  canReopenEvaluation,
  canUnapproveEvaluation,
  dedupeEvaluationCandidateRows,
  evaluationStepTypeForAction,
  type EvaluationFlowStepType,
} from "@/lib/evaluation-state";
import { verifyRole } from "@/lib/dal";
import { listPeopleUsersByLinkIds } from "@/lib/link/user-lookup";
import { writeOperationAudit } from "@/lib/operation-audit";
import { logServerError } from "@/lib/server-error-log";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncUserRoleFromAcceptedFlows } from "./roleTransition";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Prefer step type; fall back to historical order for older customized flows. */
async function findEvaluationStepIdInTx(
  tx: Tx,
  flowId: number,
  stepType: EvaluationFlowStepType,
): Promise<number | null> {
  const [byType] = await tx
    .select({ id: flowStep.id })
    .from(flowStep)
    .where(
      and(
        eq(flowStep.fkFlowId, flowId),
        eq(flowStep.type, stepType),
      ),
    )
    .orderBy(desc(flowStep.order))
    .limit(1);

  if (byType) return byType.id;

  const fallbackOrder = stepType === "checking" ? 2 : 3;
  const [byOrder] = await tx
    .select({ id: flowStep.id })
    .from(flowStep)
    .where(
      and(
        eq(flowStep.fkFlowId, flowId),
        eq(flowStep.order, fallbackOrder),
      ),
    )
    .limit(1);

  return byOrder?.id ?? null;
}

async function findActiveEvaluationInTx(tx: Tx, userFlowId: number) {
  const [active] = await tx
    .select({
      id: interviewEvaluation.id,
      status: interviewEvaluation.status,
      meetingLink: interviewEvaluation.meetingLink,
    })
    .from(interviewEvaluation)
    .where(
      and(
        eq(interviewEvaluation.fkUserFlowId, userFlowId),
        inArray(interviewEvaluation.status, ACTIVE_STATUSES),
      ),
    )
    .orderBy(desc(interviewEvaluation.id))
    .limit(1);

  return active ?? null;
}

async function moveUserFlowInTx(
  tx: Tx,
  userFlowId: number,
  progressStatus: "ongoing" | "passed" | "failed",
  stepType: EvaluationFlowStepType,
) {
  const [uf] = await tx
    .select({ flowId: userFlow.fkFlowId })
    .from(userFlow)
    .where(eq(userFlow.id, userFlowId))
    .limit(1);

  const stepId = uf
    ? await findEvaluationStepIdInTx(tx, uf.flowId, stepType)
    : null;

  await tx
    .update(userFlow)
    .set({
      progressStatus,
      fkCurrentStepId: stepId,
      updatedAt: new Date(),
    })
    .where(eq(userFlow.id, userFlowId));

  return uf?.flowId ?? null;
}

async function safeSyncUserRole(uid: number, context: {
  action: string;
  path: string;
  actorId: number | null;
  actorRole: number | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await syncUserRoleFromAcceptedFlows(uid);
  } catch (error) {
    logServerError(context.action, error, {
      path: context.path,
      userId: context.actorId,
      role: context.actorRole,
      action: context.action,
      metadata: context.metadata,
    });
  }
}

export const createEvaluation = async (
  userFlowId: number,
  content: string,
  meetingLink?: string,
) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(2);

    if (!content.trim()) {
      return { success: false, error: { message: "面评内容不能为空" } };
    }

    const hasMeetingLinkArg = meetingLink !== undefined;
    const link = hasMeetingLinkArg ? meetingLink.trim() || null : undefined;

    const result = await db.transaction(async (tx) => {
      const active = await findActiveEvaluationInTx(tx, userFlowId);

      if (active?.status === "approved") {
        return {
          success: false as const,
          error: {
            message: "该候选人面评已通过，请先由管理员撤销通过后再修改",
          },
        };
      }

      await moveUserFlowInTx(
        tx,
        userFlowId,
        "ongoing",
        evaluationStepTypeForAction("submit_for_review"),
      );

      if (active?.status === "submitted") {
        await tx
          .update(interviewEvaluation)
          .set({
            content: content.trim(),
            ...(hasMeetingLinkArg ? { meetingLink: link ?? null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(interviewEvaluation.id, active.id));

        return {
          success: true as const,
          data: { id: active.id },
          auditAction: "evaluation.update_pending" as const,
          evaluationId: active.id,
        };
      }

      const [evaluation] = await tx
        .insert(interviewEvaluation)
        .values({
          fkUserFlowId: userFlowId,
          fkUserId: session!.uid,
          content: content.trim(),
          meetingLink: link ?? null,
          status: "submitted",
        })
        .returning();

      return {
        success: true as const,
        data: evaluation,
        auditAction: "evaluation.create" as const,
        evaluationId: evaluation.id,
      };
    });

    if (!result.success) {
      return result;
    }

    revalidatePath("/dashboard/recruitment");
    revalidatePath("/dashboard/approvals");
    await writeOperationAudit({
      actorId: session.uid,
      action: result.auditAction,
      resourceType: "interview_evaluation",
      resourceId: result.evaluationId,
      metadata: {
        userFlowId,
        hasMeetingLink: hasMeetingLinkArg
          ? Boolean(link)
          : undefined,
      },
    });
    return { success: true, data: result.data };
  } catch (error) {
    logServerError("evaluation:create", error, {
      path: "/dashboard/recruitment",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "create-evaluation",
      userFlowId,
      metadata: { hasMeetingLink: Boolean(meetingLink?.trim()) },
    });
    throw error;
  }
};

export const rejectCandidate = async (userFlowId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(2);

    await db.transaction(async (tx) => {
      const active = await findActiveEvaluationInTx(tx, userFlowId);
      if (active?.status === "approved") {
        throw new Error("该候选人面评已通过，请先由管理员撤销通过后再操作");
      }

      await moveUserFlowInTx(
        tx,
        userFlowId,
        "failed",
        evaluationStepTypeForAction("lecturer_reject"),
      );

      await tx
        .delete(interviewEvaluation)
        .where(
          and(
            eq(interviewEvaluation.fkUserFlowId, userFlowId),
            eq(interviewEvaluation.status, "submitted"),
          ),
        );
    });

    revalidatePath("/dashboard/recruitment");
    revalidatePath("/dashboard/approvals");
    await writeOperationAudit({
      actorId: session.uid,
      action: "evaluation.reject_candidate",
      resourceType: "user_flow",
      resourceId: userFlowId,
    });
  } catch (error) {
    logServerError("evaluation:rejectCandidate", error, {
      path: "/dashboard/recruitment",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "reject-candidate-before-evaluation",
      userFlowId,
    });
    throw error;
  }
};

export const reopenAndEvaluate = async (
  userFlowId: number,
  content: string,
  meetingLink?: string,
) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(2);

    if (!content.trim()) {
      return { success: false, error: { message: "面评内容不能为空" } };
    }

    const hasMeetingLinkArg = meetingLink !== undefined;
    const link = hasMeetingLinkArg ? meetingLink.trim() || null : undefined;

    const result = await db.transaction(async (tx) => {
      const active = await findActiveEvaluationInTx(tx, userFlowId);

      if (active?.status === "approved") {
        return {
          success: false as const,
          error: {
            message: "该候选人面评已通过，请先由管理员撤销通过后再操作",
          },
        };
      }

      await moveUserFlowInTx(
        tx,
        userFlowId,
        "ongoing",
        evaluationStepTypeForAction("submit_for_review"),
      );

      if (active?.status === "submitted") {
        await tx
          .update(interviewEvaluation)
          .set({
            content: content.trim(),
            ...(hasMeetingLinkArg ? { meetingLink: link ?? null } : {}),
            fkUserId: session!.uid,
            updatedAt: new Date(),
          })
          .where(eq(interviewEvaluation.id, active.id));

        return {
          success: true as const,
          evaluationId: active.id,
          auditAction: "evaluation.reopen_and_create" as const,
        };
      }

      const [evaluation] = await tx
        .insert(interviewEvaluation)
        .values({
          fkUserFlowId: userFlowId,
          fkUserId: session!.uid,
          content: content.trim(),
          meetingLink: link ?? null,
          status: "submitted",
        })
        .returning({ id: interviewEvaluation.id });

      return {
        success: true as const,
        evaluationId: evaluation.id,
        auditAction: "evaluation.reopen_and_create" as const,
      };
    });

    if (!result.success) {
      return result;
    }

    revalidatePath("/dashboard/recruitment");
    revalidatePath("/dashboard/approvals");
    await writeOperationAudit({
      actorId: session.uid,
      action: result.auditAction,
      resourceType: "user_flow",
      resourceId: userFlowId,
      metadata: {
        evaluationId: result.evaluationId,
        hasMeetingLink: hasMeetingLinkArg ? Boolean(link) : undefined,
      },
    });
    return { success: true };
  } catch (error) {
    logServerError("evaluation:reopenAndEvaluate", error, {
      path: "/dashboard/recruitment",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "reopen-and-evaluate",
      userFlowId,
      metadata: { hasMeetingLink: Boolean(meetingLink?.trim()) },
    });
    throw error;
  }
};

export const approveEvaluation = async (evaluationId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;
  let affectedUserId: number | null = null;

  try {
    session = await verifyRole(3);

    await db.transaction(async (tx) => {
      const [evalRecord] = await tx
        .select({
          fkUserFlowId: interviewEvaluation.fkUserFlowId,
          status: interviewEvaluation.status,
        })
        .from(interviewEvaluation)
        .where(eq(interviewEvaluation.id, evaluationId))
        .limit(1);

      if (!evalRecord) throw new Error("面评不存在");
      if (!canApproveEvaluation(evalRecord.status)) {
        throw new Error("只能通过待终审的面评");
      }

      await tx
        .update(interviewEvaluation)
        .set({
          status: "approved",
          fkReviewedBy: session!.uid,
          updatedAt: new Date(),
        })
        .where(eq(interviewEvaluation.id, evaluationId));

      const [uf] = await tx
        .select({ fkUserId: userFlow.fkUserId })
        .from(userFlow)
        .where(eq(userFlow.id, evalRecord.fkUserFlowId))
        .limit(1);

      if (uf) {
        affectedUserId = uf.fkUserId;
        await moveUserFlowInTx(
          tx,
          evalRecord.fkUserFlowId,
          "passed",
          evaluationStepTypeForAction("admin_decision"),
        );
      }
    });

    if (affectedUserId !== null) {
      await safeSyncUserRole(affectedUserId, {
        action: "evaluation:approve:role-sync",
        path: "/dashboard/approvals",
        actorId: session.uid,
        actorRole: session.role,
        metadata: { evaluationId, affectedUserId },
      });
    }

    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/recruitment");
    await writeOperationAudit({
      actorId: session.uid,
      action: "evaluation.approve",
      resourceType: "interview_evaluation",
      resourceId: evaluationId,
      metadata: { affectedUserId },
    });
  } catch (error) {
    logServerError("evaluation:approve", error, {
      path: "/dashboard/approvals",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "approve-evaluation",
      metadata: { evaluationId, affectedUserId },
    });
    throw error;
  }
};

export const rejectEvaluation = async (evaluationId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(3);

    await db.transaction(async (tx) => {
      const [evalRecord] = await tx
        .select({
          fkUserFlowId: interviewEvaluation.fkUserFlowId,
          status: interviewEvaluation.status,
        })
        .from(interviewEvaluation)
        .where(eq(interviewEvaluation.id, evaluationId))
        .limit(1);

      if (!evalRecord) throw new Error("面评不存在");
      if (!canRejectEvaluation(evalRecord.status)) {
        throw new Error("只能驳回待终审的面评");
      }

      await tx
        .update(interviewEvaluation)
        .set({
          status: "rejected",
          fkReviewedBy: session!.uid,
          updatedAt: new Date(),
        })
        .where(eq(interviewEvaluation.id, evaluationId));

      await moveUserFlowInTx(
        tx,
        evalRecord.fkUserFlowId,
        "failed",
        evaluationStepTypeForAction("admin_decision"),
      );
    });

    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/recruitment");
    await writeOperationAudit({
      actorId: session.uid,
      action: "evaluation.reject",
      resourceType: "interview_evaluation",
      resourceId: evaluationId,
    });
  } catch (error) {
    logServerError("evaluation:reject", error, {
      path: "/dashboard/approvals",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "reject-evaluation",
      metadata: { evaluationId },
    });
    throw error;
  }
};

/** Revoke a previous approval and send the evaluation back to pending review. */
export const unapproveEvaluation = async (evaluationId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;
  let affectedUserId: number | null = null;

  try {
    session = await verifyRole(3);

    await db.transaction(async (tx) => {
      const [evalRecord] = await tx
        .select({
          fkUserFlowId: interviewEvaluation.fkUserFlowId,
          status: interviewEvaluation.status,
        })
        .from(interviewEvaluation)
        .where(eq(interviewEvaluation.id, evaluationId))
        .limit(1);

      if (!evalRecord) throw new Error("面评不存在");
      if (!canUnapproveEvaluation(evalRecord.status)) {
        throw new Error("只能撤销已通过的面评");
      }

      await tx
        .update(interviewEvaluation)
        .set({
          status: "submitted",
          fkReviewedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(interviewEvaluation.id, evaluationId));

      const [uf] = await tx
        .select({ fkUserId: userFlow.fkUserId })
        .from(userFlow)
        .where(eq(userFlow.id, evalRecord.fkUserFlowId))
        .limit(1);

      if (uf) {
        affectedUserId = uf.fkUserId;
        await moveUserFlowInTx(
          tx,
          evalRecord.fkUserFlowId,
          "ongoing",
          evaluationStepTypeForAction("submit_for_review"),
        );
      }
    });

    if (affectedUserId !== null) {
      await safeSyncUserRole(affectedUserId, {
        action: "evaluation:unapprove:role-sync",
        path: "/dashboard/approvals",
        actorId: session.uid,
        actorRole: session.role,
        metadata: { evaluationId, affectedUserId },
      });
    }

    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/recruitment");
    await writeOperationAudit({
      actorId: session.uid,
      action: "evaluation.unapprove",
      resourceType: "interview_evaluation",
      resourceId: evaluationId,
      metadata: { affectedUserId },
    });
  } catch (error) {
    logServerError("evaluation:unapprove", error, {
      path: "/dashboard/approvals",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "unapprove-evaluation",
      metadata: { evaluationId, affectedUserId },
    });
    throw error;
  }
};

export const reopenEvaluation = async (evaluationId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(3);

    await db.transaction(async (tx) => {
      const [evalRecord] = await tx
        .select({
          status: interviewEvaluation.status,
          fkUserFlowId: interviewEvaluation.fkUserFlowId,
        })
        .from(interviewEvaluation)
        .where(eq(interviewEvaluation.id, evaluationId))
        .limit(1);

      if (!evalRecord) throw new Error("面评不存在");
      if (!canReopenEvaluation(evalRecord.status)) {
        throw new Error("只能撤销已驳回的面评");
      }

      const active = await findActiveEvaluationInTx(tx, evalRecord.fkUserFlowId);
      if (active) {
        throw new Error("该候选人已有待审或已通过的面评，无法重新打开旧记录");
      }

      await tx
        .update(interviewEvaluation)
        .set({
          status: "submitted",
          fkReviewedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(interviewEvaluation.id, evaluationId));

      await moveUserFlowInTx(
        tx,
        evalRecord.fkUserFlowId,
        "ongoing",
        evaluationStepTypeForAction("submit_for_review"),
      );
    });

    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/recruitment");
    await writeOperationAudit({
      actorId: session.uid,
      action: "evaluation.reopen",
      resourceType: "interview_evaluation",
      resourceId: evaluationId,
    });
  } catch (error) {
    logServerError("evaluation:reopen", error, {
      path: "/dashboard/approvals",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "reopen-evaluation",
      metadata: { evaluationId },
    });
    throw error;
  }
};

export const getAllEvaluations = async () => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(3);

    const rows = await db
      .select({
        evaluation: interviewEvaluation,
        meetingLink: interviewEvaluation.meetingLink,
        portfolioLink: userFlow.portfolioLink,
        authorId: interviewEvaluation.fkUserId,
        candidateId: userFlow.fkUserId,
        flowTitle: flow.title,
        flowType: flow.type,
      })
      .from(interviewEvaluation)
      .leftJoin(userFlow, eq(interviewEvaluation.fkUserFlowId, userFlow.id))
      .leftJoin(flow, eq(userFlow.fkFlowId, flow.id))
      .orderBy(interviewEvaluation.createdAt);

    const userMap = await listPeopleUsersByLinkIds(
      rows
        .flatMap((row) => [row.authorId, row.candidateId])
        .filter((id): id is number => id !== null),
    );

    return rows.map((row) => ({
      ...row,
      authorName: userMap.get(row.authorId)?.name ?? null,
      candidateName: row.candidateId
        ? (userMap.get(row.candidateId)?.name ?? null)
        : null,
      candidateStudentId: row.candidateId
        ? (userMap.get(row.candidateId)?.studentId ?? null)
        : null,
    }));
  } catch (error) {
    logServerError("evaluation:getAll", error, {
      path: "/dashboard/approvals",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "get-all-evaluations",
    });
    throw error;
  }
};

export const getEvaluationCandidates = async (flowId: number) => {
  let session: Awaited<ReturnType<typeof verifyRole>> | null = null;

  try {
    session = await verifyRole(2);

    const candidates = await db
      .select({
        userFlowId: userFlow.id,
        uid: userFlow.fkUserId,
        status: userFlow.progressStatus,
        portfolioLink: userFlow.portfolioLink,
        evalId: interviewEvaluation.id,
        evalContent: interviewEvaluation.content,
        evalMeetingLink: interviewEvaluation.meetingLink,
        evalStatus: interviewEvaluation.status,
      })
      .from(userFlow)
      .leftJoin(
        interviewEvaluation,
        eq(interviewEvaluation.fkUserFlowId, userFlow.id),
      )
      .where(eq(userFlow.fkFlowId, flowId));

    const dedupedCandidates = dedupeEvaluationCandidateRows(candidates);

    const userFlowIds = dedupedCandidates.map(
      (candidate) => candidate.userFlowId,
    );
    const scheduleRows =
      userFlowIds.length === 0
        ? []
        : await db
            .select({
              id: interviewSchedule.id,
              fkUserFlowId: interviewSchedule.fkUserFlowId,
              meetingLink: interviewSchedule.meetingLink,
              scheduleLink: interviewSchedule.scheduleLink,
              meetingMinuteLink: interviewSchedule.meetingMinuteLink,
              location: interviewSchedule.location,
              startsAt: interviewSchedule.startsAt,
              endsAt: interviewSchedule.endsAt,
              status: interviewSchedule.status,
            })
            .from(interviewSchedule)
            .where(
              and(
                inArray(interviewSchedule.fkUserFlowId, userFlowIds),
                eq(interviewSchedule.status, "created"),
              ),
            )
            .orderBy(desc(interviewSchedule.startsAt));

    const latestScheduleMap = new Map<number, (typeof scheduleRows)[number]>();
    for (const schedule of scheduleRows) {
      if (!latestScheduleMap.has(schedule.fkUserFlowId)) {
        latestScheduleMap.set(schedule.fkUserFlowId, schedule);
      }
    }

    const userMap = await listPeopleUsersByLinkIds(
      dedupedCandidates.map((candidate) => candidate.uid),
      { canViewSensitiveInfo: session.role >= 3 },
    );

    return dedupedCandidates
      .map((candidate) => ({
        ...candidate,
        name: userMap.get(candidate.uid)?.name ?? "未知用户",
        studentId: userMap.get(candidate.uid)?.studentId ?? null,
        phoneNumber:
          session!.role >= 3
            ? (userMap.get(candidate.uid)?.phone ?? null)
            : null,
        scheduleId: latestScheduleMap.get(candidate.userFlowId)?.id ?? null,
        scheduleMeetingLink:
          latestScheduleMap.get(candidate.userFlowId)?.meetingLink ?? null,
        scheduleLink:
          latestScheduleMap.get(candidate.userFlowId)?.scheduleLink ?? null,
        scheduleMeetingMinuteLink:
          latestScheduleMap.get(candidate.userFlowId)?.meetingMinuteLink ??
          null,
        scheduleLocation:
          latestScheduleMap.get(candidate.userFlowId)?.location ?? null,
        scheduleStartsAt:
          latestScheduleMap.get(candidate.userFlowId)?.startsAt ?? null,
        scheduleEndsAt:
          latestScheduleMap.get(candidate.userFlowId)?.endsAt ?? null,
        scheduleStatus:
          latestScheduleMap.get(candidate.userFlowId)?.status ?? null,
      }))
      .sort((a, b) => (a.studentId ?? "").localeCompare(b.studentId ?? ""));
  } catch (error) {
    logServerError("evaluation:getCandidates", error, {
      path: "/dashboard/recruitment",
      userId: session?.uid ?? null,
      role: session?.role ?? null,
      action: "get-evaluation-candidates",
      flowId,
    });
    throw error;
  }
};
