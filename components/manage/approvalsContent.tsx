"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAllEvaluations,
  approveEvaluation,
  rejectEvaluation,
  reopenEvaluation,
  unapproveEvaluation,
} from "@/action/user-flow/evaluation";
import type { InferSelectModel } from "drizzle-orm";
import type { interviewEvaluation } from "@/db/schema";
import originalDayjs from "@/lib/dayjs";
import { externalHref } from "@/lib/link";

export type EvaluationRow = {
  evaluation: InferSelectModel<typeof interviewEvaluation>;
  meetingLink: string | null;
  portfolioLink: string | null;
  authorName: string | null;
  candidateName: string | null;
  candidateStudentId: string | null;
  flowTitle: string | null;
  flowType: string | null;
};

const statusLabel: Record<string, string> = {
  submitted: "待终审",
  approved: "已通过",
  rejected: "已驳回",
};

const flowTypeLabel: Record<string, string> = {
  recruitment: "笔试招新",
  recruitment_exemption: "免试招新",
  woc: "WOC/WOD",
  soc: "SOC/SOD",
};

const InlineLink = ({ label, value }: { label: string; value: string }) => (
  <a
    href={externalHref(value)}
    target="_blank"
    rel="noopener noreferrer"
    className="block max-w-full truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
  >
    {label}：{value}
  </a>
);

export const ApprovalsContent = ({
  initialEvaluations,
  initialLoadError = false,
}: {
  initialEvaluations?: EvaluationRow[];
  initialLoadError?: boolean;
}) => {
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>(
    Array.isArray(initialEvaluations) ? initialEvaluations : [],
  );
  const [loading, setLoading] = useState(!initialEvaluations);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const fetchEvaluations = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getAllEvaluations();
      setEvaluations(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
      toast.error("加载审批列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialEvaluations) {
      fetchEvaluations();
    }
  }, [initialEvaluations]);

  const handleApprove = async (id: number) => {
    setActionLoading(id);
    try {
      await approveEvaluation(id);
      toast.success("面评已通过");
      setEvaluations((prev) =>
        prev.map((e) =>
          e.evaluation.id === id
            ? { ...e, evaluation: { ...e.evaluation, status: "approved" } }
            : e,
        ),
      );
    } catch {
      toast.error("操作失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading(id);
    try {
      await rejectEvaluation(id);
      toast.success("面评已驳回");
      setEvaluations((prev) =>
        prev.map((e) =>
          e.evaluation.id === id
            ? { ...e, evaluation: { ...e.evaluation, status: "rejected" } }
            : e,
        ),
      );
    } catch {
      toast.error("操作失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnapprove = async (id: number) => {
    setActionLoading(id);
    try {
      await unapproveEvaluation(id);
      toast.success("已撤销通过，退回待审");
      setEvaluations((prev) =>
        prev.map((e) =>
          e.evaluation.id === id
            ? { ...e, evaluation: { ...e.evaluation, status: "submitted" } }
            : e,
        ),
      );
    } catch {
      toast.error("操作失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReopen = async (id: number) => {
    setActionLoading(id);
    try {
      await reopenEvaluation(id);
      toast.success("已撤销驳回");
      setEvaluations((prev) =>
        prev.map((e) =>
          e.evaluation.id === id
            ? { ...e, evaluation: { ...e.evaluation, status: "submitted" } }
            : e,
        ),
      );
    } catch {
      toast.error("操作失败");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <p className="text-muted-foreground text-sm">加载中...</p>;
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">审批列表加载失败</p>
            <p className="text-sm text-muted-foreground">
              请确认生产数据库迁移已执行完成后重试。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={fetchEvaluations}>
            重试
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (evaluations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">暂无待审批的面评</p>
      </div>
    );
  }

  const pending = evaluations.filter((e) => e.evaluation.status === "submitted");
  const archived = evaluations.filter((e) => e.evaluation.status !== "submitted");
  const displayed = showArchived ? archived : pending;

  if (loading) {
    return <p className="text-muted-foreground text-sm">加载中...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {pending.length} 条待审批
        </p>
        {(archived.length > 0 || showArchived) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "返回待审批" : `已归档 (${archived.length})`}
          </Button>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">
            {showArchived ? "暂无已归档面评" : "暂无待审批的面评"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {displayed.map((row) => (
            <Card key={row.evaluation.id} className="rounded-xl">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <CardTitle className="min-w-0 text-base leading-6 sm:text-sm">
                    {row.candidateName ?? "未知用户"}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {row.candidateStudentId ?? "-"}
                    </span>
                  </CardTitle>
                  <Badge
                    className="w-fit shrink-0"
                    variant={
                      row.evaluation.status === "approved"
                        ? "default"
                        : row.evaluation.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {statusLabel[row.evaluation.status] ?? row.evaluation.status}
                  </Badge>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {row.flowTitle && (
                    <Badge variant="outline" className="text-xs">
                      {flowTypeLabel[row.flowType ?? ""] ?? row.flowType}
                    </Badge>
                  )}
                  {row.flowTitle && <span>{row.flowTitle}</span>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {row.evaluation.content}
                </p>
                {(row.portfolioLink || row.meetingLink) && (
                  <div className="space-y-1">
                    {row.portfolioLink && (
                      <InlineLink label="作品链接" value={row.portfolioLink} />
                    )}
                    {row.meetingLink && (
                      <InlineLink label="妙记链接" value={row.meetingLink} />
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {row.authorName && <span>评价人：{row.authorName}</span>}
                    {row.authorName && <span className="hidden sm:inline">·</span>}
                    <span>
                      {originalDayjs(row.evaluation.createdAt).format(
                        "YYYY-MM-DD HH:mm",
                      )}
                    </span>
                  </div>
                  {row.evaluation.status === "submitted" && (
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => handleApprove(row.evaluation.id)}
                        loading={actionLoading === row.evaluation.id}
                      >
                        通过
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full sm:w-auto"
                        onClick={() => handleReject(row.evaluation.id)}
                        loading={actionLoading === row.evaluation.id}
                      >
                        驳回
                      </Button>
                    </div>
                  )}
                  {row.evaluation.status === "approved" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={() => handleUnapprove(row.evaluation.id)}
                      loading={actionLoading === row.evaluation.id}
                    >
                      撤销通过
                    </Button>
                  )}
                  {row.evaluation.status === "rejected" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      onClick={() => handleReopen(row.evaluation.id)}
                      loading={actionLoading === row.evaluation.id}
                    >
                      撤销驳回
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
