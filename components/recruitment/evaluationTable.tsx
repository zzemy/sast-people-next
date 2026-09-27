"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  CircleCheck,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Undo2,
  Video,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  countInterviewStatuses,
  deriveInterviewActions,
  getInterviewStatus,
  INTERVIEW_STATUS_ORDER,
  interviewStatusMeta,
  type InterviewAction,
  type InterviewActionId,
  type InterviewStatusKey,
} from "@/lib/interview-status";
import { normalizeWithdrawalReason, WITHDRAWAL_REASON_MAX_LENGTH } from "@/lib/validation/user-flow";
import { updateCandidateApplyGroup } from "@/action/user-flow/apply-group";
import { createEvaluation } from "@/action/user-flow/evaluation";
import { MIN_PASSED_EVALUATION_LENGTH } from "@/lib/evaluation-constants";
import {
  cancelInterviewSchedule,
  confirmInterviewScheduleEnded,
  createInterviewSchedule,
  previewInterviewScheduleEmail,
  returnInterviewCandidate,
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
import { FeishuOAuthStatus } from "@/components/feishu-oauth-status";
import { ViewUserInfoSheet } from "@/components/manage/viewUserInfoSheet";
import {
  getInterviewMeetingRoom,
  interviewMeetingRooms,
} from "@/lib/interview-meeting-rooms";
import { formatBeijingDate, toBeijingWallClockDate } from "@/lib/timezone";

type Candidate = {
  userFlowId: number;
  uid: number;
  name: string;
  studentId: string | null;
  qq: string | null;
  status: string | null;
  withdrawReason?: string | null;
  portfolioLink: string | null;
  portfolioDescription: string | null;
  applyGroup: string | null;
  evalId: number | null;
  evalContent: string | null;
  evalMeetingLink: string | null;
  evalRecommendation: "passed" | "failed" | null;
  evalStatus: string | null;
  evalReturnReason?: string | null;
  evalAuthorId: number | null;
  canEditEvaluation: boolean;
  canManageSchedule: boolean;
  scheduleId: number | null;
  scheduleOrganizerName: string | null;
  scheduleMeetingLink: string | null;
  scheduleLink: string | null;
  scheduleMeetingMinuteLink: string | null;
  scheduleLocation: string | null;
  scheduleMeetingRoomId: string | null;
  scheduleStartsAt: Date | string | null;
  scheduleEndsAt: Date | string | null;
  scheduleStatus: string | null;
  scheduleMeetingStatus: string | null;
  scheduleMeetingEndedAt: Date | string | null;
};

type SortKey = "schedule" | "name" | "status";
type SortDir = "asc" | "desc";

// Shared chip chrome. The focus ring matches components/ui/button.tsx — plain
// <button> chips would otherwise fall back to the UA outline.
const CHIP_BASE =
  "inline-flex touch-manipulation items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:py-1";

const statusFilterChipClass = (active: boolean) =>
  cn(
    CHIP_BASE,
    active
      ? "border-foreground/20 bg-foreground/10 font-medium text-foreground"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  );

/**
 * "待我处理" crosses the status axis rather than being one of its values, so it
 * gets the brand tint and a divider to keep the two groups readable.
 */
const mineFilterChipClass = (active: boolean) =>
  cn(
    CHIP_BASE,
    active
      ? "border-primary/40 bg-primary/10 font-medium text-primary"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  );

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
  const beijingStart = toBeijingWallClockDate(start);
  beijingStart.setMinutes(0, 0, 0);
  beijingStart.setHours(beijingStart.getHours() + 1);
  const end = new Date(beijingStart);
  end.setMinutes(end.getMinutes() + 30);
  return {
    startsAt: formatDateTimeLocal(beijingStart),
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "09-26 12:00 – 12:30" for a same-day slot, falling back to repeating the date
 * only when the interview actually crosses midnight. Slot lengths are minutes,
 * so the date is almost always redundant.
 */
function formatScheduleRange(startsAt: string, endsAt: string) {
  if (!startsAt) return endsAt;
  if (!endsAt) return startsAt;
  const [startDay] = startsAt.split(" ");
  const [endDay, endClock] = endsAt.split(" ");
  return startDay === endDay
    ? `${startsAt} – ${endClock}`
    : `${startsAt} – ${endsAt}`;
}

/** "今天" / "明天" / "昨天" so the next interview is findable at a glance. */
function getRelativeDayLabel(
  value: Date | string | null,
  now: number | null,
): string | null {
  if (!value || now === null) return null;
  const target = formatBeijingDate(value);
  if (target === "-") return null;
  if (target === formatBeijingDate(now)) return "今天";
  if (target === formatBeijingDate(now + DAY_MS)) return "明天";
  if (target === formatBeijingDate(now - DAY_MS)) return "昨天";
  return null;
}

function CandidateIdentity({
  name,
  studentId,
  qq,
  uid,
  role,
}: {
  name: string;
  studentId: string | null;
  qq: string | null;
  uid: number;
  role: number;
}) {
  const meta = [studentId || null, qq ? `QQ ${qq}` : null].filter(Boolean);

  return (
    <div className="min-w-0 space-y-1">
      <ViewUserInfoSheet
        userInfo={{ id: uid, name, studentId }}
        currentUserRole={role}
        trigger={
          <button
            type="button"
            title={name}
            className="max-w-full truncate text-left text-sm font-medium leading-5 text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {name}
          </button>
        }
      />
      {meta.length > 0 && (
        <p className="truncate text-xs tabular-nums text-muted-foreground" title={meta.join(" · ")}>
          {meta.join(" · ")}
        </p>
      )}
    </div>
  );
}

const ApplyGroupText = ({
  value,
  editable,
  onEdit,
  editLabel,
}: {
  value: string | null;
  editable?: boolean;
  onEdit?: () => void;
  editLabel?: string;
}) => {
  if (editable && onEdit) {
    return (
      <button
        type="button"
        aria-label={editLabel ?? "修改投递组别"}
        title={value ? `投递组别：${value}，点击修改` : "未填写，点击标记投递组别"}
        className="truncate text-sm text-foreground/85 transition-colors hover:text-foreground hover:underline"
        onClick={onEdit}
      >
        {value || <span className="text-muted-foreground">未填写</span>}
      </button>
    );
  }
  return (
    <span className="truncate text-sm text-foreground/85" title={value ?? undefined}>
      {value || "未填写"}
    </span>
  );
};

const PortfolioDetails = ({
  value,
  description,
}: {
  value: string | null;
  description?: string | null;
}) => {
  const href = externalHref(value ?? "");
  return (
    <div className="min-w-0 space-y-1">
      {value && href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-start gap-1 break-all text-sm leading-5 text-foreground/85 underline decoration-muted-foreground/40 underline-offset-4 hover:text-primary hover:decoration-primary"
        >
          <span>{value}</span>
          <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">未提供</span>
      )}
      {description && (
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
          {description}
        </p>
      )}
    </div>
  );
};

const PortfolioLink = ({
  value,
  description,
  onOpen,
}: {
  value: string | null;
  description?: string | null;
  onOpen: () => void;
}) => {
  // A bordered button per row competed with the row's real action, so this is a
  // quiet link instead — still reachable, no longer a second button.
  if (!value && !description) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group inline-flex max-w-full items-center gap-1 text-sm text-foreground/85 underline-offset-4 transition-colors hover:text-primary hover:underline"
    >
      <span className="truncate">查看作品</span>
      <Eye className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
  );
};

const EvalStatusText = ({ candidate }: { candidate: Candidate }) => {
  const status = getInterviewStatus(candidate);
  const meta = interviewStatusMeta[status];
  const badge = (
    <span
      data-slot="interview-status-badge"
      data-status={status}
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.badgeClassName,
      )}
      title={meta.description}
    >
      {meta.label}
    </span>
  );

  // A returned evaluation carries the admin's reason; surface it on hover.
  const returnReason = candidate.evalReturnReason ?? candidate.withdrawReason;
  if (status === "returned" && returnReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap break-words">
            退回理由：{returnReason}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
};
const ScheduleIconLink = ({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Video;
}) => (
  <a
    href={externalHref(href)}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    title={label}
    className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  >
    <Icon className="size-3.5" aria-hidden="true" />
  </a>
);

const ScheduleInfo = ({
  candidate,
  now,
}: {
  candidate: Candidate;
  now: number | null;
}) => {
  if (!candidate.scheduleMeetingLink) {
    return (
      <div className="min-w-0 space-y-1">
        <span className="text-sm text-muted-foreground">未预约</span>
        {candidate.status === "withdrawn" && candidate.withdrawReason && (
          <p className="truncate text-xs text-destructive" title={candidate.withdrawReason}>
            退回理由：{candidate.withdrawReason}
          </p>
        )}
      </div>
    );
  }

  const startsAt = formatScheduleTime(candidate.scheduleStartsAt);
  const endsAt = formatScheduleTime(candidate.scheduleEndsAt);
  const timeRange = formatScheduleRange(startsAt, endsAt);
  const dayLabel = getRelativeDayLabel(candidate.scheduleStartsAt, now);
  const hasDistinctScheduleLink =
    Boolean(candidate.scheduleLink) &&
    candidate.scheduleLink !== candidate.scheduleMeetingLink;
  // Place and organiser share one line. Both are always shown: suppressing a
  // repeat made the cell one line on some rows and two on others, which read as
  // a ragged column and cost more than the repetition saved.
  const placeAndOwner = [candidate.scheduleLocation, candidate.scheduleOrganizerName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 shrink truncate text-sm tabular-nums text-foreground">
          {dayLabel && <span className="font-medium">{dayLabel} </span>}
          {timeRange}
        </p>
        <span className="flex shrink-0 items-center">
          <ScheduleIconLink
            href={candidate.scheduleMeetingLink}
            label="留档会议"
            icon={Video}
          />
          {hasDistinctScheduleLink && candidate.scheduleLink && (
            <ScheduleIconLink
              href={candidate.scheduleLink}
              label="日程"
              icon={CalendarDays}
            />
          )}
        </span>
      </div>
      {placeAndOwner && (
        <p className="truncate text-xs text-muted-foreground" title={placeAndOwner}>
          {placeAndOwner}
        </p>
      )}
      {candidate.status === "withdrawn" && candidate.withdrawReason && (
        <p className="truncate text-xs text-destructive" title={candidate.withdrawReason}>
          退回理由：{candidate.withdrawReason}
        </p>
      )}
    </div>
  );
};

/**
 * Every actionable row gets exactly one control, so the column has a single
 * shape that cannot go ragged: previously the same column held a solid brand
 * pill, an outlined box, a lone ⋯ and an em dash, at four different widths.
 *
 * The menu button carries the *next step's* name rather than a generic "操作",
 * so the row still tells you what to do without opening anything; the menu is
 * where you actually do it, plus whatever secondary actions exist. The tone
 * follows the action so "this row is your job" stays visible in the column.
 */
const ACTION_MENU_BUTTON =
  "inline-flex h-9 w-full shrink-0 touch-manipulation items-center justify-center gap-1 rounded-full border px-3 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 lg:h-8 lg:w-[5.75rem] lg:px-2";

/** Brand tint marks the row's actual work; a hairline outline marks logistics. */
const ACTION_TONE = {
  work: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
  /* A 5% grey fill is imperceptible next to the tinted pills and read as an
     unfinished control, so logistics get a visible hairline and no fill. */
  logistics:
    "border-foreground/20 bg-transparent text-foreground hover:bg-foreground/5",
  destructive:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300",
} as const;

function actionTone(action: InterviewAction) {
  if (action.destructive) return ACTION_TONE.destructive;
  return action.id === "evaluation" ? ACTION_TONE.work : ACTION_TONE.logistics;
}

const ACTION_ICONS: Record<InterviewActionId, typeof Video> = {
  schedule: CalendarPlus,
  "cancel-schedule": CalendarX2,
  "confirm-ended": CircleCheck,
  evaluation: FileText,
  return: Undo2,
};

function ActionCell({
  plan,
  candidate,
  busy,
  align = "end",
  onAction,
}: {
  plan: ReturnType<typeof deriveInterviewActions>;
  candidate: Candidate;
  busy: boolean;
  align?: "start" | "end";
  onAction: (action: InterviewAction, candidate: Candidate) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Radix opens a menu from the trigger's `pointerdown`, and on touch that is the
  // instant a finger lands: a swipe that merely started on the button opened the
  // menu mid-scroll, and an open menu holds the page until it is dismissed. The
  // wrapper below swallows that press, so the click a real tap produces is what
  // decides the outcome — from where the menu stood before the press, so a
  // dismissal landing between the two cannot flip the tap back into an open.
  const menuOpenOnPressRef = useRef(false);
  const actions = [
    ...(plan.primary ? [plan.primary] : []),
    ...plan.overflow,
  ];

  if (actions.length === 0) {
    // A finished row shows nothing at all — an em dash here read as debris, and
    // the status badge already says the row is done. The one exception is a row
    // the current user is locked out of, where naming the owner is the point.
    if (!plan.lockedReason) return null;
    return (
      <span className="text-xs text-muted-foreground" title={plan.lockedReason}>
        {plan.lockedReason}
      </span>
    );
  }

  return (
    // Click only. Opening on hover was tried and reverted: every row has a menu,
    // so dragging the pointer across the table opened them in a cascade, and any
    // delay short enough to feel responsive fired during a normal sweep. The press
    // is left out for the same reason — a tap decides, a swipe does not.
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/* The press has to be stopped ahead of the trigger, and React can only do
          that from an ancestor: a capture handler on the target itself runs in the
          same pass as the target's own handler. `contents` keeps the wrapper out
          of the layout. */}
      <span
        className="contents"
        onPointerDownCapture={(event) => {
          event.stopPropagation();
          menuOpenOnPressRef.current = menuOpen;
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-slot="row-action-menu"
            disabled={busy}
            onClick={() => setMenuOpen(!menuOpenOnPressRef.current)}
            className={cn(
              ACTION_MENU_BUTTON,
              // The tone follows the primary only: a row whose sole option is a
              // destructive one should not advertise itself in red.
              plan.primary ? actionTone(plan.primary) : ACTION_TONE.logistics,
            )}
          >
            <span className="truncate">{plan.primary?.label ?? "操作"}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent
        align={align === "start" ? "start" : "end"}
        className="w-44"
      >
        {actions.map((action, index) => {
          const Icon = ACTION_ICONS[action.id];
          // Keep the destructive actions apart from the ordinary ones.
          const needsDivider =
            action.destructive && !actions[index - 1]?.destructive;
          return (
            <Fragment key={action.id}>
              {needsDivider && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={action.destructive ? "destructive" : "default"}
                onSelect={() => onAction(action, candidate)}
              >
                <Icon aria-hidden="true" />
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const EvaluationTable = ({
  candidates,
  groupOptions,
  role,
  targetUserFlowId,
  targetScheduleId,
  loading = false,
  onRefresh,
}: {
  candidates: Candidate[];
  groupOptions: string[];
  role: number;
  targetUserFlowId?: number;
  targetScheduleId?: number;
  loading?: boolean;
  onRefresh: () => void;
}) => {
  const safeCandidates = useMemo(
    () => (Array.isArray(candidates) ? candidates : []),
    [candidates],
  );
  const [evaluatingId, setEvaluatingId] = useState<number | null>(null);
  const [portfolioCandidate, setPortfolioCandidate] = useState<Candidate | null>(null);
  const [returnConfirmCandidate, setReturnConfirmCandidate] = useState<Candidate | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);
  const [cancelConfirmCandidate, setCancelConfirmCandidate] = useState<Candidate | null>(null);
  const [schedulingId, setSchedulingId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [recommendation, setRecommendation] = useState<"passed" | "failed">("passed");
  const [scheduleStartsAt, setScheduleStartsAt] = useState("");
  const [scheduleEndsAt, setScheduleEndsAt] = useState("");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [scheduleMeetingRoomId, setScheduleMeetingRoomId] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{
    subject: string;
    to: string;
    html: string;
  } | null>(null);
  const [feishuBound, setFeishuBound] = useState<boolean | null>(null);
  const [feishuStatusFailed, setFeishuStatusFailed] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [groupEditingCandidate, setGroupEditingCandidate] = useState<Candidate | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [applyGroupFilter, setApplyGroupFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InterviewStatusKey | "mine" | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "schedule",
    dir: "asc",
  });
  const safeGroupOptions = Array.isArray(groupOptions) ? groupOptions : [];
  const groupOptionsKey = safeGroupOptions.join("\u0000");

  useEffect(() => {
    // Drop the filter only when the selected group is gone, so a stale value
    // cannot hide every candidate under a new flow. Keying on the joined values
    // rather than the array reference keeps the selection across the re-render
    // that a server action's revalidatePath triggers after a submission.
    const options = groupOptionsKey ? groupOptionsKey.split("\u0000") : [];
    setApplyGroupFilter((current) =>
      current && !options.includes(current) ? null : current,
    );
  }, [groupOptionsKey]);

  useEffect(() => {
    setNow(Date.now());
    // The "confirm the interview has ended" action unlocks with the clock, so a
    // page left open all afternoon has to keep ticking.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const planFor = useCallback(
    (candidate: Candidate) => deriveInterviewActions(candidate, role, now),
    [role, now],
  );

  const startEdit = (c: Candidate) => {
    setEvaluatingId(c.userFlowId);
    setContent(c.evalContent ?? "");
    setMeetingLink(c.scheduleMeetingMinuteLink ?? c.evalMeetingLink ?? "");
    setRecommendation(c.evalRecommendation ?? "passed");
    setEvaluationError(null);
  };

  const startSchedule = (c: Candidate) => {
    setSchedulingId(c.userFlowId);
    const range =
      c.scheduleStartsAt && c.scheduleEndsAt
        ? {
            startsAt: formatDateTimeLocal(toBeijingWallClockDate(new Date(c.scheduleStartsAt))),
            endsAt: formatDateTimeLocal(toBeijingWallClockDate(new Date(c.scheduleEndsAt))),
          }
        : getDefaultScheduleRange();
    setScheduleStartsAt(range.startsAt);
    setScheduleEndsAt(range.endsAt);
    setScheduleLocation(c.scheduleLocation ?? "");
    setScheduleMeetingRoomId(c.scheduleMeetingRoomId ?? "");
    setScheduleNote("");
  };

  const cancelEdit = () => {
    setEvaluatingId(null);
    setContent("");
    setMeetingLink("");
    setRecommendation("passed");
    setEvaluationError(null);
  };

  const cancelSchedule = () => {
    setSchedulingId(null);
    setScheduleStartsAt("");
    setScheduleEndsAt("");
    setScheduleLocation("");
    setScheduleMeetingRoomId("");
    setScheduleNote("");
    setScheduleLoading(false);
    setFeishuBound(null);
    setFeishuStatusFailed(false);
  };

  const cancelReturn = () => {
    setReturnConfirmCandidate(null);
    setReturnReason("");
    setReturnError(null);
  };

  const canEditApplyGroup = role >= 2 && groupOptions.length > 0;

  const startGroupEdit = (c: Candidate) => {
    setGroupEditingCandidate(c);
    setGroupDraft(c.applyGroup ?? "");
    setGroupError(null);
  };

  const cancelGroupEdit = () => {
    setGroupEditingCandidate(null);
    setGroupDraft("");
    setGroupError(null);
    setGroupSaving(false);
  };

  const handleSaveCandidateGroup = async () => {
    if (!groupEditingCandidate) return;
    if (!groupDraft) {
      setGroupError("请选择投递组别");
      return;
    }
    setGroupError(null);
    setGroupSaving(true);
    try {
      const result = await updateCandidateApplyGroup(
        groupEditingCandidate.userFlowId,
        groupDraft,
      );
      if (!result.success) {
        setGroupError(result.error?.message ?? "保存失败");
        return;
      }
      cancelGroupEdit();
      toast.success("投递组别已更新");
      onRefresh();
    } catch {
      toast.error("保存失败");
    } finally {
      setGroupSaving(false);
    }
  };

  const editingCandidate =
    safeCandidates.find((c) => c.userFlowId === evaluatingId) ?? null;
  const schedulingCandidate =
    safeCandidates.find((c) => c.userFlowId === schedulingId) ?? null;

  const handlePass = async (userFlowId: number) => {
    if (!content.trim()) {
      setEvaluationError("请填写面评内容后再提交。");
      return;
    }
    if (recommendation === "passed" && content.trim().length < MIN_PASSED_EVALUATION_LENGTH) {
      setEvaluationError(`建议通过时，面评内容至少需要 ${MIN_PASSED_EVALUATION_LENGTH} 个字。`);
      return;
    }
    setLoadingId(userFlowId);
    try {
      const result = await createEvaluation(
        userFlowId,
        content,
        recommendation,
        meetingLink,
      );
      if (!result.success) {
        const message = result.error?.message ?? "提交失败";
        setEvaluationError(message);
        toast.error(message);
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

  const handleConfirmScheduleEnded = async (candidate: Candidate) => {
    if (!candidate.scheduleId) return;
    setLoadingId(candidate.userFlowId);
    try {
      const result = await confirmInterviewScheduleEnded(candidate.scheduleId);
      if (!result.success) {
        toast.error(result.error?.message ?? "确认面试结束失败");
        return;
      }
      toast.success("已确认面试结束，可以提交面评");
      onRefresh();
    } catch {
      toast.error("确认面试结束失败");
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
        meetingRoomId: scheduleMeetingRoomId || undefined,
        note: scheduleNote,
      });
      if (!result.success) {
        toast.error(result.error?.message ?? "飞书日程创建失败");
        return;
      }
      if (result.data.emailWarning) {
        toast.warning(result.data.emailWarning);
      } else {
        toast.success("线下面试日程已创建，预约邮件已发送");
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
        meetingRoomId: scheduleMeetingRoomId || undefined,
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
      setCancelConfirmCandidate(null);
      cancelSchedule();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消预约失败");
    } finally {
      setLoadingId(null);
    }
  };

  const handleReturnCandidate = async (candidate: Candidate) => {
    const validation = normalizeWithdrawalReason(returnReason);
    if (!validation.success) {
      setReturnError(validation.error);
      return;
    }

    setLoadingId(candidate.userFlowId);
    try {
      const result = await returnInterviewCandidate(
        candidate.userFlowId,
        validation.value,
      );
      if (!result.success) {
        setReturnError(result.error?.message ?? "退回失败");
        return;
      }
      if (result.emailWarning) {
        toast.warning(result.emailWarning);
      } else {
        toast.success("已退回该报名，候选人可以重新选择流程");
      }
      cancelReturn();
      cancelSchedule();
      onRefresh();
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : "退回失败");
    } finally {
      setLoadingId(null);
    }
  };

  const runAction = (action: InterviewAction, candidate: Candidate) => {
    switch (action.id) {
      case "schedule":
        startSchedule(candidate);
        break;
      case "cancel-schedule":
        setCancelConfirmCandidate(candidate);
        break;
      case "confirm-ended":
        void handleConfirmScheduleEnded(candidate);
        break;
      case "evaluation":
        startEdit(candidate);
        break;
      case "return":
        setReturnConfirmCandidate(candidate);
        setReturnReason("");
        setReturnError(null);
        break;
    }
  };

  const searched = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return safeCandidates;
    return safeCandidates.filter((candidate) =>
      [candidate.name, candidate.studentId, candidate.qq].some((value) =>
        String(value ?? "").toLocaleLowerCase().includes(query),
      ),
    );
  }, [safeCandidates, search]);

  const groupScoped = useMemo(
    () =>
      applyGroupFilter
        ? searched.filter((candidate) => candidate.applyGroup === applyGroupFilter)
        : searched,
    [searched, applyGroupFilter],
  );

  // Counts describe the search + group scope but ignore the status filter, so
  // selecting a status chip cannot make every other chip read zero.
  const statusCounts = useMemo(
    () => countInterviewStatuses(groupScoped),
    [groupScoped],
  );

  // The action column only exists for role >= 2, so a lower role must not see
  // rows counted as "待我处理" that it has no way to act on.
  const isMine = useCallback(
    (candidate: Candidate) => role >= 2 && planFor(candidate).primary !== null,
    [planFor, role],
  );

  const mineCount = useMemo(
    () => groupScoped.filter(isMine).length,
    [groupScoped, isMine],
  );

  const statusFilterOptions = useMemo(
    () =>
      INTERVIEW_STATUS_ORDER.map((key) => ({
        key,
        count: statusCounts[key],
      })).filter((option) => option.count > 0),
    [statusCounts],
  );

  const visibleCandidates = useMemo(() => {
    let rows = groupScoped;
    if (statusFilter === "mine") {
      rows = rows.filter(isMine);
    } else if (statusFilter) {
      rows = rows.filter(
        (candidate) => getInterviewStatus(candidate) === statusFilter,
      );
    }

    const byStudentId = (a: Candidate, b: Candidate) =>
      (a.studentId ?? "").localeCompare(b.studentId ?? "");
    const direction = sort.dir === "asc" ? 1 : -1;
    const compare = (a: Candidate, b: Candidate) => {
      if (sort.key === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      if (sort.key === "status") {
        return (
          INTERVIEW_STATUS_ORDER.indexOf(getInterviewStatus(a)) -
          INTERVIEW_STATUS_ORDER.indexOf(getInterviewStatus(b))
        );
      }
      return (
        (getTime(a.scheduleStartsAt) ?? Infinity) -
        (getTime(b.scheduleStartsAt) ?? Infinity)
      );
    };

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort.key === "schedule") {
        // Candidates with no slot are their own bucket, so they stay at the
        // bottom in both directions instead of floating up when descending.
        const aTime = getTime(a.scheduleStartsAt);
        const bTime = getTime(b.scheduleStartsAt);
        if (aTime === null || bTime === null) {
          if (aTime === bTime) return byStudentId(a, b);
          return aTime === null ? 1 : -1;
        }
      }
      return compare(a, b) * direction || byStudentId(a, b);
    });
    return sorted;
  }, [groupScoped, statusFilter, sort, isMine]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const renderSortableHead = (
    label: string,
    key: SortKey,
    className: string,
  ) => {
    const active = sort.key === key;
    return (
      <TableHead
        className={className}
        aria-sort={
          active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={cn(
            "group inline-flex items-center gap-1 rounded text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
              aria-hidden="true"
            />
          )}
        </button>
      </TableHead>
    );
  };

  // Every matching candidate renders at once: interview flows are small enough
  // that a pager only got in the way of scanning, and the 全部 chip already
  // carries the total.
  const isTargetCandidate = useCallback(
    (candidate: Candidate) =>
      Boolean(
        (targetUserFlowId && candidate.userFlowId === targetUserFlowId) ||
          (targetScheduleId && candidate.scheduleId === targetScheduleId),
      ),
    [targetUserFlowId, targetScheduleId],
  );

  const hasActiveFilter =
    Boolean(search.trim()) ||
    Boolean(applyGroupFilter) ||
    Boolean(statusFilter);

  const clearFilters = () => {
    setSearch("");
    setApplyGroupFilter(null);
    setStatusFilter(null);
  };

  const selectStatusFilter = (value: InterviewStatusKey | "mine" | null) => {
    setStatusFilter((current) => (current === value ? null : value));
  };

  // "Nothing matched the filters" and "this flow has nobody" need different copy,
  // and that distinction has to come from the unfiltered rows.
  const emptyMessage =
    safeCandidates.length > 0
      ? "没有符合条件的候选人。"
      : "该流程暂时没有可处理的报名人员。";

  const renderRowActions = (
    candidate: Candidate,
    align: "start" | "end" = "end",
  ) => (
    <ActionCell
      plan={planFor(candidate)}
      candidate={candidate}
      busy={loadingId === candidate.userFlowId}
      align={align}
      onAction={runAction}
    />
  );

  return (
    <div className="min-w-0 rounded-lg border bg-card" aria-busy={loading}>
      {/* Not sticky below lg: the stacked toolbar is ~150px tall on a phone and
          would eat a fifth of the viewport for the whole scroll. */}
      <div className="z-20 rounded-t-lg border-b bg-card/95 lg:sticky lg:top-0 lg:backdrop-blur-sm">
        {/* One row, control group left and filters right: two small controls on
            their own row left ~700px of empty toolbar at desktop widths. */}
        <div className="flex flex-col gap-2.5 p-3 sm:p-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-4">
          <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-2">
            <Input
              placeholder="搜索姓名、学号或QQ"
              aria-label="搜索面试候选人"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              className="h-9 min-w-0 flex-1 sm:w-[13rem] sm:flex-none"
            />
            {safeGroupOptions.length > 0 && (
              <Select
                value={applyGroupFilter ?? "all"}
                onValueChange={(value) => {
                  setApplyGroupFilter(value === "all" ? null : value);
                }}
              >
                <SelectTrigger
                  className="h-9 w-full min-w-0 truncate text-xs sm:w-[8.5rem] [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
                  aria-label="按投递组别筛选候选人"
                  title={applyGroupFilter ?? "全部组别"}
                >
                  <SelectValue placeholder="全部组别" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部组别</SelectItem>
                  {safeGroupOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Hidden while loading: the rows still belong to the previous flow,
              so showing their counts under the new flow's title would lie. */}
          {statusCounts.total > 0 && !loading && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={statusFilter === null}
                className={statusFilterChipClass(statusFilter === null)}
                onClick={() => selectStatusFilter(null)}
              >
                全部
                <span className="tabular-nums opacity-60">{statusCounts.total}</span>
              </button>
              {mineCount > 0 && (
                <>
                  <button
                    type="button"
                    aria-pressed={statusFilter === "mine"}
                    className={mineFilterChipClass(statusFilter === "mine")}
                    onClick={() => selectStatusFilter("mine")}
                  >
                    待我处理
                    <span className="tabular-nums opacity-70">{mineCount}</span>
                  </button>
                  <span
                    className="mx-0.5 h-4 w-px shrink-0 bg-border"
                    aria-hidden="true"
                  />
                </>
              )}
              {statusFilterOptions.map(({ key, count }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  className={statusFilterChipClass(statusFilter === key)}
                  title={interviewStatusMeta[key].description}
                  onClick={() => selectStatusFilter(key)}
                >
                  {interviewStatusMeta[key].label}
                  <span className="tabular-nums opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 rounded-b-lg lg:block">
        {/* Content-driven widths with hints, not `table-fixed` percentages: fixed
            percentages left every column with its own share of dead space, which
            is what made the columns look unevenly spaced. */}
        {/* Widths are tuned so each column ends up with the same trailing space
            (~105px at a 1230px table), not merely the same percentage: equal
            percentages on unequal content is what made some gaps look tight and
            others cavernous. Sized for production data — a 2-4 character name
            and a student id of one letter plus eight digits, which is far
            shorter than the demo seed. `table-auto` keeps min-content as a
            floor, so nothing clips at narrow widths. */}
        <Table className="w-full min-w-[52rem]" containerClassName="overflow-x-auto">
          <TableHeader>
            <TableRow className="border-b border-border/60 hover:bg-transparent">
              {renderSortableHead(
                "候选人",
                "name",
                "h-10 w-[19%] px-4 text-xs font-medium text-muted-foreground",
              )}
              <TableHead className="h-10 w-[12%] px-3 text-xs font-medium text-muted-foreground">投递组别</TableHead>
              <TableHead className="h-10 w-[15%] px-3 text-xs font-medium text-muted-foreground">作品</TableHead>
              {renderSortableHead(
                "面试安排",
                "schedule",
                "h-10 w-[23%] px-3 text-xs font-medium text-muted-foreground",
              )}
              {renderSortableHead(
                "状态",
                "status",
                "h-10 w-[15%] px-3 text-right text-xs font-medium text-muted-foreground",
              )}
              {role >= 2 && (
                <TableHead className="h-10 w-[16%] px-4 text-right text-xs font-medium text-muted-foreground">操作</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <TableRow key={`skeleton-${index}`} className="border-b border-border/40">
                  {Array.from({ length: role >= 2 ? 6 : 5 }, (_, cellIndex) => (
                    <TableCell key={cellIndex} className="px-4 py-2.5">
                      {/* Mirrors the real two-line cell: the schedule cell's
                          icon links are size-6, so its first line is 24px, not
                          the 20px of a text line. Matching that keeps the page
                          from shifting when the data lands. */}
                      <div className="space-y-1">
                        <Skeleton className="h-6 w-3/5 max-w-[7rem]" />
                        <Skeleton className="h-4 w-4/5 max-w-[5rem]" />
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : visibleCandidates.length === 0 ? (
              <TableRow className="border-b-0">
                <TableCell
                  colSpan={role >= 2 ? 6 : 5}
                  className="h-32 px-4 text-center"
                >
                  <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                  {hasActiveFilter && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={clearFilters}
                    >
                      清除筛选
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              visibleCandidates.map((c) => (
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
                      : "border-b border-border/40 last:border-0 hover:bg-muted/30"
                  }
                >
                  <TableCell className="px-4 py-2 align-middle">
                    <CandidateIdentity
                      name={c.name}
                      studentId={c.studentId}
                      qq={c.qq}
                      uid={c.uid}
                      role={role}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2 align-middle">
                    <ApplyGroupText
                      value={c.applyGroup}
                      editable={canEditApplyGroup}
                      onEdit={() => startGroupEdit(c)}
                      editLabel={`修改${c.name}的投递组别`}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2 align-middle">
                    <PortfolioLink
                      value={c.portfolioLink}
                      description={c.portfolioDescription}
                      onOpen={() => setPortfolioCandidate(c)}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2 align-middle">
                    {/* A fixed content height keeps rows uniform: an unbooked
                        candidate is one line where a booked one is two, and the
                        resulting 4px wobble reads as uneven row spacing. */}
                    <div className="flex min-h-[2.75rem] min-w-0 flex-col justify-center">
                      <ScheduleInfo candidate={c} now={now} />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 align-middle text-right">
                    <EvalStatusText candidate={c} />
                  </TableCell>
                  {role >= 2 && (
                    <TableCell className="px-4 py-2 align-middle text-right">
                      {renderRowActions(c)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="flex flex-col divide-y divide-border rounded-b-lg lg:hidden">
        {loading ? (
          // Structural mirror of a real card, so the list does not jump on load.
          <div className="flex flex-col divide-y divide-border">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={`skeleton-${index}`}
                data-slot="candidate-card-skeleton"
                className="flex flex-col gap-3 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton className="h-5 w-28" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="border-t border-border/60 pt-3">
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {hasActiveFilter && (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
        ) : (
          visibleCandidates.map((c) => {
            const plan = planFor(c);
            // A card gives the action row a divider, so an empty one reads as a
            // broken section. On desktop the column still needs its "—" marker.
            const hasActionArea =
              Boolean(plan.primary) ||
              plan.overflow.length > 0 ||
              Boolean(plan.lockedReason);
            return (
              <div
                key={c.userFlowId}
                data-slot="candidate-card"
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
                    qq={c.qq}
                    uid={c.uid}
                    role={role}
                  />
                  {/* shrink-0: a long name must truncate itself, not squeeze the badge. */}
                  <div className="shrink-0">
                    <EvalStatusText candidate={c} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ApplyGroupText
                    value={c.applyGroup}
                    editable={canEditApplyGroup}
                    onEdit={() => startGroupEdit(c)}
                    editLabel={`修改${c.name}的投递组别`}
                  />
                  <span className="text-muted-foreground/40" aria-hidden="true">
                    ·
                  </span>
                  <PortfolioLink
                    value={c.portfolioLink}
                    description={c.portfolioDescription}
                    onOpen={() => setPortfolioCandidate(c)}
                  />
                </div>
                <ScheduleInfo candidate={c} now={now} />
                {role >= 2 && hasActionArea && (
                  <div className="border-t border-border/60 pt-3">
                    <ActionCell
                      plan={plan}
                      candidate={c}
                      busy={loadingId === c.userFlowId}
                      align="start"
                      onAction={runAction}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Dialog
        open={Boolean(portfolioCandidate)}
        onOpenChange={(open) => {
          if (!open) setPortfolioCandidate(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>作品信息</DialogTitle>
            <DialogDescription>
              {portfolioCandidate
                ? `${portfolioCandidate.name} 的作品链接和简介`
                : "查看候选人提交的作品信息。"}
            </DialogDescription>
          </DialogHeader>
          {portfolioCandidate && (
            <div className="grid gap-4 py-1">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">作品链接</p>
                {portfolioCandidate.portfolioLink &&
                externalHref(portfolioCandidate.portfolioLink) ? (
                  <a
                    href={externalHref(portfolioCandidate.portfolioLink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Link2 className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 break-all text-sm leading-5 text-foreground/85">
                      {portfolioCandidate.portfolioLink}
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">未提供</p>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">作品简介</p>
                {portfolioCandidate.portfolioDescription ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                    {portfolioCandidate.portfolioDescription}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">未提供</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={() => setPortfolioCandidate(null)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                <PortfolioDetails
                  value={editingCandidate.portfolioLink}
                  description={editingCandidate.portfolioDescription}
                />
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="evaluation-content" className="text-sm font-medium">
                面评内容 <span className="text-destructive">*</span>
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                面评内容必填；建议通过时至少填写 {MIN_PASSED_EVALUATION_LENGTH} 个字。
              </p>
              <Textarea
                id="evaluation-content"
                placeholder="请输入面评内容..."
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (evaluationError) setEvaluationError(null);
                }}
                aria-invalid={Boolean(evaluationError)}
                aria-describedby={
                  evaluationError ? "evaluation-content-error" : undefined
                }
                required
                className="min-h-[160px] resize-y"
              />
              <p className="text-right text-xs text-muted-foreground">{content.trim().length} 字</p>
              {evaluationError && (
                <p id="evaluation-content-error" role="alert" className="text-sm text-destructive">
                  {evaluationError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">讲师建议</label>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="讲师建议">
                <Button
                  type="button"
                  variant={recommendation === "passed" ? "default" : "outline"}
                  aria-pressed={recommendation === "passed"}
                  onClick={() => setRecommendation("passed")}
                >
                  建议通过
                </Button>
                <Button
                  type="button"
                  variant={recommendation === "failed" ? "destructive" : "outline"}
                  aria-pressed={recommendation === "failed"}
                  onClick={() => setRecommendation("failed")}
                >
                  建议不通过
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                此为讲师意见，最终结果由管理员结合面评审核决定。
              </p>
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
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={cancelEdit}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!editingCandidate) return;
                  return handlePass(editingCandidate.userFlowId);
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
        open={Boolean(returnConfirmCandidate)}
        onOpenChange={(open) => {
          if (!open) cancelReturn();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认退回面试报名</DialogTitle>
            <DialogDescription>
              {returnConfirmCandidate
                ? `退回后 ${returnConfirmCandidate.name} 的当前面试流程将作废，候选人需重新选择流程。此操作不可撤销，请填写退回理由。`
                : "退回后候选人的当前面试流程将作废，需重新报名。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="withdraw-reason">
              退回理由 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="withdraw-reason"
              placeholder="请输入退回理由"
              value={returnReason}
              onChange={(event) => {
                setReturnReason(event.target.value);
                if (returnError) setReturnError(null);
              }}
              maxLength={WITHDRAWAL_REASON_MAX_LENGTH}
              aria-invalid={Boolean(returnError)}
              aria-describedby={returnError ? "withdraw-reason-error" : undefined}
              className="min-h-28 resize-y"
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>必填，最多 {WITHDRAWAL_REASON_MAX_LENGTH} 字</span>
              <span>{returnReason.length}/{WITHDRAWAL_REASON_MAX_LENGTH}</span>
            </div>
            {returnError && (
              <p id="withdraw-reason-error" role="alert" className="text-sm text-destructive">
                {returnError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={cancelReturn}
              disabled={loadingId !== null}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={loadingId !== null}
              loading={
                returnConfirmCandidate
                  ? loadingId === returnConfirmCandidate.userFlowId
                  : false
              }
              onClick={() => {
                if (!returnConfirmCandidate) return;
                return handleReturnCandidate(returnConfirmCandidate);
              }}
            >
              确认退回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cancelConfirmCandidate)}
        onOpenChange={(open) => {
          if (!open) setCancelConfirmCandidate(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认取消面试预约</DialogTitle>
            <DialogDescription>
              {cancelConfirmCandidate
                ? `将删除 ${cancelConfirmCandidate.name} 的飞书日程与留档会议，并向候选人发送取消邮件。取消后该候选人回到「待预约」，需要重新预约。`
                : "将删除飞书日程与留档会议，并发送取消邮件。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelConfirmCandidate(null)}
              disabled={loadingId !== null}
            >
              保留预约
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={loadingId !== null}
              loading={
                cancelConfirmCandidate
                  ? loadingId === cancelConfirmCandidate.userFlowId
                  : false
              }
              onClick={() => {
                if (!cancelConfirmCandidate) return;
                return handleCancelSchedule(cancelConfirmCandidate);
              }}
            >
              确认取消预约
            </Button>
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
            <DialogTitle>安排线下面试</DialogTitle>
            <DialogDescription>
              {schedulingCandidate
                ? `${schedulingCandidate.name}（${schedulingCandidate.studentId ?? "无学号"}）`
                : "创建内部飞书日程和留档会议，并发送线下面试预约邮件。"}
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
            <p className="text-xs leading-5 text-muted-foreground">
              飞书会议仅用于录制与妙记留档；候选人邮件只包含线下面试时间、地点和备注。
            </p>
            {feishuStatusFailed && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                飞书授权状态检查失败。可尝试重新绑定，或刷新页面后再试。
              </p>
            )}
            {schedulingCandidate?.scheduleMeetingLink && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 text-xs text-muted-foreground">当前留档会议</p>
                <ScheduleInfo candidate={schedulingCandidate} now={now} />
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
              <label className="text-sm font-medium">会议室</label>
              <Select
                value={scheduleMeetingRoomId || "none"}
                onValueChange={(value) => {
                  const roomId = value === "none" ? "" : value;
                  setScheduleMeetingRoomId(roomId);
                  const room = getInterviewMeetingRoom(roomId);
                  setScheduleLocation(room?.name ?? "");
                }}
              >
                <SelectTrigger className="h-10" aria-label="会议室">
                  <SelectValue placeholder="不预约会议室" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不预约会议室</SelectItem>
                  {interviewMeetingRooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                选择后会在飞书日程中预约该会议室，冲突时无法创建日程。
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">地点</label>
              <Input
                placeholder="例如：仙林校区大学生活动中心 101"
                value={scheduleLocation}
                onChange={(e) => setScheduleLocation(e.target.value)}
                className="h-10"
                disabled={Boolean(scheduleMeetingRoomId)}
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
              {schedulingCandidate?.scheduleMeetingLink && schedulingCandidate.canManageSchedule && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const candidate = schedulingCandidate;
                    cancelSchedule();
                    setCancelConfirmCandidate(candidate);
                  }}
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
              {schedulingCandidate?.scheduleMeetingLink ? "保存改约" : "创建线下面试日程"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(groupEditingCandidate)}
        onOpenChange={(open) => {
          if (!open) cancelGroupEdit();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>修改投递组别</DialogTitle>
            <DialogDescription>
              {groupEditingCandidate
                ? `${groupEditingCandidate.name}（${groupEditingCandidate.studentId ?? "无学号"}）`
                : "为候选人标记或修改投递组别。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="candidate-apply-group">投递组别</Label>
            <Select
              value={groupDraft}
              onValueChange={(value) => {
                setGroupDraft(value);
                if (groupError) setGroupError(null);
              }}
            >
              <SelectTrigger
                id="candidate-apply-group"
                className="w-full text-left [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:justify-start [&_[data-slot=select-value]]:text-left"
              >
                <SelectValue placeholder="选择投递组别" />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groupError && (
              <p role="alert" className="text-sm text-destructive">
                {groupError}
              </p>
            )}
          </div>
          <DialogFooter className="mt-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={cancelGroupEdit}
              disabled={groupSaving}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={handleSaveCandidateGroup}
              loading={groupSaving}
              disabled={groupSaving}
            >
              保存
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
