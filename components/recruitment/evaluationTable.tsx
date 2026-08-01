"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createEvaluation, rejectCandidate, reopenAndEvaluate } from "@/action/user-flow/evaluation";
import {
  cancelInterviewSchedule,
  createInterviewSchedule,
  previewInterviewScheduleEmail,
} from "@/action/user-flow/interviewSchedule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { externalHref } from "@/lib/link";
import { generateEvaluationDraft } from "@/action/ai/candidate";
import { FeishuOAuthStatus } from "@/components/feishu-oauth-status";

type Candidate = {
  userFlowId: number;
  uid: number;
  name: string;
  studentId: string | null;
  phoneNumber: string | null;
  status: string | null;
  portfolioLink: string | null;
  evalId: number | null;
  evalContent: string | null;
  evalMeetingLink: string | null;
  evalStatus: string | null;
  scheduleId: number | null;
  scheduleMeetingLink: string | null;
  scheduleLink: string | null;
  scheduleMeetingMinuteLink: string | null;
  scheduleLocation: string | null;
  scheduleStartsAt: Date | string | null;
  scheduleEndsAt: Date | string | null;
  scheduleStatus: string | null;
};

const evalStatusLabel = (
  evalStatus: string | null,
  flowStatus: string | null,
  scheduleMeetingLink: string | null,
  scheduleEnded: boolean,
) => {
  if (evalStatus === "approved" || flowStatus === "passed") {
    return { text: "已通过", className: "text-primary" };
  }
  if (evalStatus === "rejected") {
    return { text: "面评驳回", className: "text-destructive" };
  }
  if (evalStatus === "submitted") {
    return { text: "待审核", className: "text-foreground" };
  }
  if (flowStatus === "failed") {
    return { text: "不通过", className: "text-destructive" };
  }
  if (!scheduleMeetingLink) {
    return { text: "待预约", className: "text-muted-foreground" };
  }
  if (!scheduleEnded) {
    return { text: "待面试", className: "text-muted-foreground" };
  }
  return { text: "待评估", className: "text-muted-foreground" };
};

const EvalStatusText = ({
  evalStatus,
  flowStatus,
  scheduleMeetingLink,
  scheduleEnded,
}: {
  evalStatus: string | null;
  flowStatus: string | null;
  scheduleMeetingLink: string | null;
  scheduleEnded: boolean;
}) => {
  const status = evalStatusLabel(
    evalStatus,
    flowStatus,
    scheduleMeetingLink,
    scheduleEnded,
  );
  return (
    <span className={`text-sm ${status.className}`}>
      {status.text}
    </span>
  );
};



const getCandidateStatusKey = (candidate: Candidate) => {
  if (candidate.evalStatus === "approved" || candidate.status === "passed") return "accepted";
  if (candidate.evalStatus === "rejected") return "evalRejected";
  if (candidate.status === "failed") return "rejected";
  if (candidate.evalStatus === "submitted") return "pending";
  return "waiting";
};

const summaryItems = [
  { key: "waiting", label: "待评估" },
  { key: "pending", label: "待审核" },
  { key: "accepted", label: "已通过" },
  { key: "evalRejected", label: "面评驳回" },
  { key: "rejected", label: "不通过" },
];

const formatDateTimeLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
};

const getDefaultScheduleRange = () => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);
  return {
    startsAt: formatDateTimeLocal(start),
    endsAt: formatDateTimeLocal(end),
  };
};

const scheduleFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatScheduleTime = (value: Date | string | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return scheduleFormatter.format(date).replace(/\//g, "-");
};

const getTime = (value: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

function CandidateIdentity({
  name,
  studentId,
  phoneNumber,
  showPhone,
}: {
  name: string;
  studentId: string | null;
  phoneNumber: string | null;
  showPhone?: boolean;
}) {
  const meta = [
    studentId || null,
    showPhone ? phoneNumber || null : null,
  ].filter(Boolean);

  return (
    <div className="min-w-0 space-y-0.5">
      <p className="truncate text-sm font-medium leading-5 text-foreground" title={name}>
        {name}
      </p>
      {meta.length > 0 && (
        <p className="truncate text-xs tabular-nums text-muted-foreground" title={meta.join(" · ")}>
          {meta.join(" · ")}
        </p>
      )}
    </div>
  );
}

const PortfolioLink = ({ value }: { value: string | null }) => {
  if (!value) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <a
      href={externalHref(value)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-foreground/80 hover:text-foreground"
    >
      作品
      <ExternalLink className="size-3.5 shrink-0 opacity-50" />
    </a>
  );
};

const ScheduleInfo = ({ candidate }: { candidate: Candidate }) => {
  if (!candidate.scheduleMeetingLink) {
    return <span className="text-sm text-muted-foreground">未预约</span>;
  }

  const startsAt = formatScheduleTime(candidate.scheduleStartsAt);
  const endsAt = formatScheduleTime(candidate.scheduleEndsAt);
  const timeRange = startsAt
    ? `${startsAt}${endsAt ? ` – ${endsAt}` : ""}`
    : endsAt;
  const hasDistinctScheduleLink =
    Boolean(candidate.scheduleLink) &&
    candidate.scheduleLink !== candidate.scheduleMeetingLink;

  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        <a
          href={externalHref(candidate.scheduleMeetingLink)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-foreground/80 hover:text-foreground"
        >
          会议
          <ExternalLink className="size-3.5 shrink-0 opacity-50" />
        </a>
        {hasDistinctScheduleLink && candidate.scheduleLink && (
          <a
            href={externalHref(candidate.scheduleLink)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            日程
            <ExternalLink className="size-3.5 shrink-0 opacity-50" />
          </a>
        )}
      </div>
      {timeRange && (
        <p className="text-xs tabular-nums text-muted-foreground">{timeRange}</p>
      )}
      {candidate.scheduleLocation && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={candidate.scheduleLocation}
        >
          {candidate.scheduleLocation}
        </p>
      )}
    </div>
  );
};

function ActionButton({
  children,
  disabled,
  onClick,
  tone = "default",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary hover:text-primary"
      : tone === "danger"
        ? "text-destructive hover:text-destructive"
        : "text-muted-foreground hover:text-foreground";

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 px-2 text-sm font-normal shadow-none ${toneClass}`}
    >
      {children}
    </Button>
  );
}

export const EvaluationTable = ({
  candidates,
  role,
  targetUserFlowId,
  targetScheduleId,
  onRefresh,
}: {
  candidates: Candidate[];
  role: number;
  targetUserFlowId?: number;
  targetScheduleId?: number;
  onRefresh: () => void;
}) => {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const [evaluatingId, setEvaluatingId] = useState<number | null>(null);
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [scheduleStartsAt, setScheduleStartsAt] = useState("");
  const [scheduleEndsAt, setScheduleEndsAt] = useState("");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{
    subject: string;
    to: string;
    html: string;
  } | null>(null);
  const [feishuBound, setFeishuBound] = useState<boolean | null>(null);
  const [feishuStatusFailed, setFeishuStatusFailed] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<"pass" | "reopen" | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const startEdit = (c: Candidate, mode: "pass" | "reopen") => {
    setEvaluatingId(c.userFlowId);
    setEditMode(mode);
    setContent(c.evalContent ?? "");
    setMeetingLink(c.scheduleMeetingMinuteLink ?? c.evalMeetingLink ?? "");
  };

  const startSchedule = (c: Candidate) => {
    setSchedulingId(c.userFlowId);
    const range =
      c.scheduleStartsAt && c.scheduleEndsAt
        ? {
            startsAt: formatDateTimeLocal(new Date(c.scheduleStartsAt)),
            endsAt: formatDateTimeLocal(new Date(c.scheduleEndsAt)),
          }
        : getDefaultScheduleRange();
    setScheduleStartsAt(range.startsAt);
    setScheduleEndsAt(range.endsAt);
    setScheduleLocation(c.scheduleLocation ?? "");
    setScheduleNote("");
  };

  const cancelEdit = () => {
    setEvaluatingId(null);
    setContent("");
    setMeetingLink("");
    setEditMode(null);
  };

  const cancelSchedule = () => {
    setSchedulingId(null);
    setScheduleStartsAt("");
    setScheduleEndsAt("");
    setScheduleLocation("");
    setScheduleNote("");
    setScheduleLoading(false);
    setFeishuBound(null);
    setFeishuStatusFailed(false);
  };

  const editingCandidate =
    safeCandidates.find((c) => c.userFlowId === evaluatingId) ?? null;
  const schedulingCandidate =
    safeCandidates.find((c) => c.userFlowId === schedulingId) ?? null;

  const handlePass = async (userFlowId: number) => {
    if (!content.trim()) return;
    setLoadingId(userFlowId);
    try {
      const result = await createEvaluation(userFlowId, content, meetingLink);
      if (!result.success) {
        toast.error(result.error?.message ?? "提交失败");
        return;
      }
      toast.success("面评已提交，等待管理员审核");
      cancelEdit();
      onRefresh();
    } catch {
      toast.error("提交失败");
    } finally {
      setLoadingId(null);
    }
  };

  const handleReopen = async (userFlowId: number) => {
    if (!content.trim()) return;
    setLoadingId(userFlowId);
    try {
      const result = await reopenAndEvaluate(userFlowId, content, meetingLink);
      if (!result.success) {
        toast.error(result.error?.message ?? "操作失败");
        return;
      }
      toast.success("面评已提交，等待管理员审核");
      cancelEdit();
      onRefresh();
    } catch {
      toast.error("操作失败");
    } finally {
      setLoadingId(null);
    }
  };

  const handleReject = async (userFlowId: number) => {
    setLoadingId(userFlowId);
    try {
      await rejectCandidate(userFlowId);
      toast.success("已设为不通过");
      cancelEdit();
      onRefresh();
    } catch {
      toast.error("操作失败");
    } finally {
      setLoadingId(null);
    }
  };

  const handleCreateSchedule = async (userFlowId: number) => {
    if (!scheduleStartsAt || !scheduleEndsAt) {
      toast.error("请填写面试开始和结束时间");
      return;
    }
    if (feishuBound !== true) {
      toast.error(
        feishuStatusFailed
          ? "飞书授权状态检查失败，请先在上方重新绑定飞书后再发起日程。"
          : "请先绑定飞书账号后再发起面试日程。",
      );
      return;
    }

    setScheduleLoading(true);
    try {
      const result = await createInterviewSchedule({
        userFlowId,
        startsAt: scheduleStartsAt,
        endsAt: scheduleEndsAt,
        location: scheduleLocation,
        note: scheduleNote,
      });
      if (!result.success) {
        toast.error(result.error?.message ?? "飞书日程创建失败");
        return;
      }
      if (result.data.emailWarning) {
        toast.warning(result.data.emailWarning);
      } else {
        toast.success("飞书会议和日程已创建，预约邮件已发送");
      }
      cancelSchedule();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "飞书日程创建失败");
    } finally {
      setScheduleLoading(false);
    }
  };

  const handlePreviewScheduleEmail = async (userFlowId: number) => {
    if (!scheduleStartsAt || !scheduleEndsAt) {
      toast.error("请先填写面试开始和结束时间");
      return;
    }

    setEmailPreviewLoading(true);
    try {
      const result = await previewInterviewScheduleEmail({
        userFlowId,
        startsAt: scheduleStartsAt,
        endsAt: scheduleEndsAt,
        location: scheduleLocation,
        note: scheduleNote,
      });
      if (!result.success) {
        toast.error(result.error?.message ?? "邮件预览生成失败");
        return;
      }
      setEmailPreview(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "邮件预览生成失败");
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  const handleCancelSchedule = async (candidate: Candidate) => {
    if (!candidate.scheduleId) {
      toast.error("找不到可取消的面试预约");
      return;
    }

    setLoadingId(candidate.userFlowId);
    try {
      const result = await cancelInterviewSchedule(candidate.scheduleId);
      if (!result.success) {
        toast.error(result.error?.message ?? "取消预约失败");
        return;
      }
      if (result.emailWarning) {
        toast.warning(result.emailWarning);
      } else {
        toast.success("面试预约已取消，取消邮件已发送");
      }
      cancelSchedule();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消预约失败");
    } finally {
      setLoadingId(null);
    }
  };

  const handleGenerateEvaluationDraft = async () => {
    if (!editingCandidate) return;

    setAiDraftLoading(true);
    try {
      const result = await generateEvaluationDraft(
        editingCandidate.userFlowId,
        content,
      );
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setContent(result.data.text);
      toast.success(content.trim() ? "面评内容已润色" : "面评草稿已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 面评生成失败");
    } finally {
      setAiDraftLoading(false);
    }
  };

  if (safeCandidates.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center">
        <p className="text-sm font-medium">暂无可评估的候选人</p>
        <p className="mt-1 text-xs text-muted-foreground">
          当前流程还没有可处理的报名人员。
        </p>
      </div>
    );
  }

  const statusCounts = new Map<string, number>();
  for (const candidate of safeCandidates) {
    const key = getCandidateStatusKey(candidate);
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const isTargetCandidate = (candidate: Candidate) =>
    Boolean(
      (targetUserFlowId && candidate.userFlowId === targetUserFlowId) ||
        (targetScheduleId && candidate.scheduleId === targetScheduleId),
    );

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">面评候选人</p>
          <p className="text-xs text-muted-foreground">
            预约面试后提交面评结果
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {summaryItems
            .map(
              (item) =>
                `${item.label} ${statusCounts.get(item.key) ?? 0}`,
            )
            .join(" · ")}
        </p>
      </div>
      <div className="hidden min-w-0 lg:block">
        <Table className="w-full table-fixed" containerClassName="overflow-x-visible">
          {role >= 2 ? (
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[22%]" />
              <col className="w-[12%]" />
              <col className="w-[30%]" />
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[14%]" />
              <col className="w-[30%]" />
              <col className="w-[24%]" />
            </colgroup>
          )}
          <TableHeader>
            <TableRow className="border-b border-border/60 hover:bg-transparent">
              <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">候选人</TableHead>
              <TableHead className="h-10 px-3 text-xs font-medium text-muted-foreground">作品</TableHead>
              <TableHead className="h-10 px-3 text-xs font-medium text-muted-foreground">会议</TableHead>
              <TableHead className="h-10 px-3 text-xs font-medium text-muted-foreground">状态</TableHead>
              {role >= 2 && (
                <TableHead className="h-10 px-4 text-right text-xs font-medium text-muted-foreground">操作</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {safeCandidates.map((c) => {
              const isEditing = evaluatingId === c.userFlowId;
              const isRejected = c.status === "failed";
              const busy = loadingId === c.userFlowId;
              const scheduleEnded =
                now !== null &&
                Boolean(c.scheduleMeetingLink) &&
                (getTime(c.scheduleEndsAt) ?? Number.POSITIVE_INFINITY) <= now;
              const canEvaluate = scheduleEnded || c.evalStatus !== null || isRejected;

              return (
                <TableRow
                  key={c.userFlowId}
                  id={
                    isTargetCandidate(c)
                      ? `user-flow-${c.userFlowId}-desktop`
                      : undefined
                  }
                  className={
                    isTargetCandidate(c)
                      ? "scroll-mt-24 bg-muted/40 hover:bg-muted/40"
                      : "border-b border-border/40 last:border-0 hover:bg-muted/15"
                  }
                >
                  <TableCell className="px-4 py-3 align-middle">
                    <CandidateIdentity
                      name={c.name}
                      studentId={c.studentId}
                      phoneNumber={c.phoneNumber}
                      showPhone={role >= 3}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-3 align-middle">
                    <PortfolioLink value={c.portfolioLink} />
                  </TableCell>
                  <TableCell className="px-3 py-3 align-middle">
                    <ScheduleInfo candidate={c} />
                  </TableCell>
                  <TableCell className="px-3 py-3 align-middle">
                    <EvalStatusText evalStatus={c.evalStatus} flowStatus={c.status} scheduleMeetingLink={c.scheduleMeetingLink} scheduleEnded={scheduleEnded} />
                  </TableCell>
                  {role >= 2 && (
                    <TableCell className="px-4 py-3 align-middle text-right">
                      {!canEvaluate ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <ActionButton onClick={() => startSchedule(c)}>
                            {c.scheduleMeetingLink ? "改约" : "预约"}
                          </ActionButton>
                          {c.scheduleMeetingLink && (
                            <ActionButton
                              disabled={busy}
                              onClick={() => handleCancelSchedule(c)}
                            >
                              {busy ? "处理中" : "取消"}
                            </ActionButton>
                          )}
                        </div>
                      ) : isEditing ? (
                        <span className="text-xs text-muted-foreground">正在编辑…</span>
                      ) : c.evalStatus === "submitted" ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <ActionButton onClick={() => startEdit(c, "pass")}>
                            修改
                          </ActionButton>
                        </div>
                      ) : c.evalStatus === "approved" || c.evalStatus === "rejected" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : isRejected ? (
                        <div className="flex justify-end">
                          <ActionButton tone="primary" onClick={() => startEdit(c, "reopen")}>
                            改为通过
                          </ActionButton>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <ActionButton onClick={() => startSchedule(c)}>
                            改约
                          </ActionButton>
                          <ActionButton tone="primary" onClick={() => startEdit(c, "pass")}>
                            通过
                          </ActionButton>
                          <ActionButton
                            tone="danger"
                            disabled={busy}
                            onClick={() => handleReject(c.userFlowId)}
                          >
                            {busy ? "处理中" : "不通过"}
                          </ActionButton>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="flex flex-col divide-y divide-border lg:hidden">
        {safeCandidates.map((c) => {
          const isEditing = evaluatingId === c.userFlowId;
          const isRejected = c.status === "failed";
          const busy = loadingId === c.userFlowId;
          const scheduleEnded =
            now !== null &&
            Boolean(c.scheduleMeetingLink) &&
            (getTime(c.scheduleEndsAt) ?? Number.POSITIVE_INFINITY) <= now;
          const canEvaluate = scheduleEnded || c.evalStatus !== null || isRejected;

          return (
            <div
              key={c.userFlowId}
              id={
                isTargetCandidate(c)
                  ? `user-flow-${c.userFlowId}-mobile`
                  : undefined
              }
              className={
                isTargetCandidate(c)
                  ? "flex scroll-mt-24 flex-col gap-3 bg-muted/30 p-4"
                  : "flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40"
              }
            >
              <div className="flex items-start justify-between gap-3">
                <CandidateIdentity
                  name={c.name}
                  studentId={c.studentId}
                  phoneNumber={c.phoneNumber}
                  showPhone={role >= 3}
                />
                <EvalStatusText evalStatus={c.evalStatus} flowStatus={c.status} scheduleMeetingLink={c.scheduleMeetingLink} scheduleEnded={scheduleEnded} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PortfolioLink value={c.portfolioLink} />
              </div>
              <ScheduleInfo candidate={c} />
              {role >= 2 && (
                !canEvaluate ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <ActionButton onClick={() => startSchedule(c)}>
                      {c.scheduleMeetingLink ? "改约" : "预约"}
                    </ActionButton>
                    {c.scheduleMeetingLink && (
                      <ActionButton
                        disabled={busy}
                        onClick={() => handleCancelSchedule(c)}
                      >
                        {busy ? "处理中" : "取消"}
                      </ActionButton>
                    )}
                  </div>
                ) : isEditing ? (
                  <div className="pt-1 text-sm text-muted-foreground">
                    正在编辑面评
                  </div>
                ) : c.evalStatus === "submitted" ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <ActionButton onClick={() => startEdit(c, "pass")}>
                      修改
                    </ActionButton>
                  </div>
                ) : c.evalStatus === "approved" ? (
                  <div className="pt-1 text-sm text-muted-foreground">已完成</div>
                ) : c.evalStatus === "rejected" ? (
                  <div className="pt-1 text-sm text-muted-foreground">已驳回</div>
                ) : isRejected ? (
                  <div className="pt-1">
                    <ActionButton tone="primary" onClick={() => startEdit(c, "reopen")}>
                      改为通过
                    </ActionButton>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ActionButton onClick={() => startSchedule(c)}>
                      改约
                    </ActionButton>
                    <ActionButton tone="primary" onClick={() => startEdit(c, "pass")}>
                      通过
                    </ActionButton>
                    <ActionButton
                      tone="danger"
                      disabled={busy}
                      onClick={() => handleReject(c.userFlowId)}
                    >
                      {busy ? "处理中" : "不通过"}
                    </ActionButton>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
      <Dialog
        open={!!editingCandidate}
        onOpenChange={(open) => {
          if (!open) cancelEdit();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>面评记录</DialogTitle>
            <DialogDescription>
              {editingCandidate
                ? `${editingCandidate.name}（${editingCandidate.studentId ?? "无学号"}）`
                : "面试结束后填写评价内容和妙记链接。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {editingCandidate && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 text-xs text-muted-foreground">作品链接</p>
                <PortfolioLink value={editingCandidate.portfolioLink} />
              </div>
            )}
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm font-medium">面评内容</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateEvaluationDraft}
                  loading={aiDraftLoading}
                >
                  <Sparkles data-icon="inline-start" />
                  {content.trim() ? "润色内容" : "生成草稿"}
                </Button>
              </div>
              <Textarea
                placeholder="请输入面评内容..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[160px] resize-y"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">妙记链接</label>
              {meetingLink ? (
                <a
                  href={externalHref(meetingLink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 text-sm text-foreground hover:text-primary hover:underline"
                >
                  <span className="truncate">查看妙记</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">
                  飞书生成妙记后会自动同步到这里。
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="mt-2 border-t pt-4 sm:items-center sm:justify-between">
            <div className="min-h-9">
              {editingCandidate && editingCandidate.status !== "failed" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleReject(editingCandidate.userFlowId)}
                  loading={loadingId === editingCandidate.userFlowId}
                >
                  不通过
                </Button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={cancelEdit}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!editingCandidate) return;
                  return editMode === "reopen"
                    ? handleReopen(editingCandidate.userFlowId)
                    : handlePass(editingCandidate.userFlowId);
                }}
                loading={
                  editingCandidate
                    ? loadingId === editingCandidate.userFlowId
                    : false
                }
              >
                提交面评
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!schedulingCandidate}
        onOpenChange={(open) => {
          if (!open) cancelSchedule();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>预约面试会议</DialogTitle>
            <DialogDescription>
              {schedulingCandidate
                ? `${schedulingCandidate.name}（${schedulingCandidate.studentId ?? "无学号"}）`
                : "创建飞书会议和日程，并发送预约邮件。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <FeishuOAuthStatus
              role={role}
              onStatusChange={(status, meta) => {
                setFeishuBound(status?.bound ?? null);
                setFeishuStatusFailed(meta.failed);
              }}
            />
            {feishuBound === false && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-100">
                发起飞书会议和日程前需要先绑定飞书授权。点击上方「绑定飞书」完成授权后，再填写时间并发起日程。
              </p>
            )}
            {feishuStatusFailed && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                飞书授权状态检查失败。可尝试重新绑定，或刷新页面后再试。
              </p>
            )}
            {schedulingCandidate?.scheduleMeetingLink && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 text-xs text-muted-foreground">当前会议</p>
                <ScheduleInfo candidate={schedulingCandidate} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">开始时间</label>
                <Input
                  type="datetime-local"
                  value={scheduleStartsAt}
                  onChange={(e) => setScheduleStartsAt(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">结束时间</label>
                <Input
                  type="datetime-local"
                  value={scheduleEndsAt}
                  onChange={(e) => setScheduleEndsAt(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">地点</label>
              <Input
                placeholder="例如：仙林校区大学生活动中心 101"
                value={scheduleLocation}
                onChange={(e) => setScheduleLocation(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">预约备注</label>
              <Input
                placeholder="例如：请提前准备作品介绍"
                value={scheduleNote}
                onChange={(e) => setScheduleNote(e.target.value)}
                className="h-10"
              />
            </div>
          </div>
          <DialogFooter className="mt-2 border-t pt-4">
            <div className="flex flex-1 justify-start">
              {schedulingCandidate?.scheduleMeetingLink && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCancelSchedule(schedulingCandidate)}
                  loading={loadingId === schedulingCandidate.userFlowId}
                >
                  取消预约
                </Button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={cancelSchedule}>
              关闭
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!schedulingCandidate) return;
                return handlePreviewScheduleEmail(schedulingCandidate.userFlowId);
              }}
              loading={emailPreviewLoading}
            >
              预览邮件
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!schedulingCandidate) return;
                return handleCreateSchedule(schedulingCandidate.userFlowId);
              }}
              loading={scheduleLoading}
              disabled={feishuBound !== true}
              title={
                feishuBound === true
                  ? undefined
                  : "请先绑定飞书账号后再发起面试日程"
              }
            >
              {schedulingCandidate?.scheduleMeetingLink ? "保存改约" : "发起飞书日程"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(emailPreview)}
        onOpenChange={(open) => {
          if (!open) setEmailPreview(null);
        }}
      >
        <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-4 overflow-hidden sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>预约邮件预览</DialogTitle>
            <DialogDescription className="line-clamp-2">
              {emailPreview
                ? `收件人：${emailPreview.to}；主题：${emailPreview.subject}`
                : "预览将使用当前填写的时间和备注。"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
            <iframe
              title="预约邮件预览"
              srcDoc={emailPreview?.html ?? ""}
              sandbox=""
              className="h-[min(55dvh,520px)] w-full bg-white"
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => setEmailPreview(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};



