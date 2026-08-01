import Link from "next/link";
import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationComponent } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import originalDayjs from "@/lib/dayjs";
import type { listOperationAudit } from "@/lib/operation-audit-list";

type AuditLogResult = Awaited<ReturnType<typeof listOperationAudit>>;
type AuditLogItem = AuditLogResult["logs"][number];

const actionGroups = [
  { value: "review", label: "批卷" },
  { value: "email", label: "邮件" },
  { value: "evaluation", label: "面评" },
  { value: "flow", label: "流程" },
  { value: "user", label: "用户" },
];

const actionLabels: Record<string, string> = {
  "review.score.upsert": "保存评分",
  "review.score.batch_upsert": "批量保存评分",
  "email.batch.create": "创建邮件批次",
  "email.batch_send": "发送邮件批次",
  "email.recover_stale": "恢复中断邮件",
  "email.delivery_retry": "重试单封邮件",
  "email.test_send": "测试发送邮件",
  "email.template.update": "更新邮件模板",
  "email.template.reset": "重置邮件模板",
  "flow.create": "创建流程",
  "flow.update": "更新流程",
  "flow.delete": "删除流程",
  "flow.duplicate": "复制流程",
  "flow.update_problems": "更新题目",
  "flow.update_steps": "更新流程步骤",
  "user.update_role": "修改角色",
  "user.ban": "禁用用户",
  "user_flow.forward": "推进流程",
  "user_flow.finish": "完成流程",
  "user_flow.reject": "拒绝流程",
  "user_flow.reopen": "重开流程",
  "user_flow.backward": "回退流程",
  "user_flow.batch_update_step": "批量更新步骤",
  "user_flow.batch_end": "批量结束流程",
  "user_flow.batch_set_outcome": "批量设置结果",
  "evaluation.create": "创建面评",
  "evaluation.update_pending": "更新待审面评",
  "evaluation.reject_candidate": "拒绝候选人",
  "evaluation.reopen_and_create": "重开并创建面评",
  "evaluation.approve": "通过面评",
  "evaluation.reject": "驳回面评",
  "evaluation.unapprove": "撤销通过",
  "evaluation.reopen": "重开面评",
};

function getActionLabel(action: string) {
  return actionLabels[action] ?? action;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function MetadataSummary({ metadata }: { metadata: AuditLogItem["metadata"] }) {
  if (!isRecord(metadata) || Object.keys(metadata).length === 0) {
    return <span className="text-sm text-muted-foreground">无附加数据</span>;
  }

  const rawJson = JSON.stringify(metadata, null, 2);

  return (
    <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
      {rawJson}
    </pre>
  );
}

function AuditLogMobileItem({ item }: { item: AuditLogItem }) {
  return (
    <div className="space-y-4 border-b p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{getActionLabel(item.action)}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {item.action}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">
          <p>{originalDayjs(item.createdAt).format("YYYY-MM-DD")}</p>
          <p>{originalDayjs(item.createdAt).format("HH:mm:ss")}</p>
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">操作者</span>
          <span className="text-right">{item.actorName ?? "未知用户"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">资源</span>
          <span className="font-mono text-xs">
            {item.resourceType}
            {item.resourceId ? ` #${item.resourceId}` : ""}
          </span>
        </div>
      </div>

      <MetadataSummary metadata={item.metadata} />
    </div>
  );
}

export function AuditLogTable({
  logs,
  totalCount,
  filters,
}: Pick<AuditLogResult, "logs" | "totalCount" | "filters">) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const start = totalCount === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const end = Math.min(filters.page * filters.pageSize, totalCount);
  const hasFilters = Boolean(
    filters.actor ||
      filters.action ||
      filters.actionGroup ||
      filters.resourceType ||
      filters.from ||
      filters.to,
  );
  const groupHref = (value: string) => `/dashboard/audit?actionGroup=${value}`;

  return (
    <div className="space-y-4">
      <form action="/dashboard/audit" className="rounded-md border bg-card p-4">
        <div className="flex flex-col gap-2 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium">审计记录</p>
            <p className="text-sm text-muted-foreground">
              当前显示 {start} - {end}，共 {totalCount} 条
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "已应用筛选" : "全部记录"}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(170px,1fr)_minmax(220px,1.1fr)_minmax(170px,1fr)_150px_150px_auto]">
          <input type="hidden" name="actionGroup" value={filters.actionGroup} />
          <Input
            name="actor"
            defaultValue={filters.actor}
            placeholder="操作者姓名 / 学号 / ID"
          />
          <Input
            name="action"
            defaultValue={filters.action}
            placeholder="操作类型，例如 review.score"
          />
          <Input
            name="resourceType"
            defaultValue={filters.resourceType}
            placeholder="资源类型，例如 user_flow"
          />
          <Input type="date" name="from" defaultValue={filters.from} />
          <Input type="date" name="to" defaultValue={filters.to} />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              <Search data-icon="inline-start" />
              筛选
            </Button>
            <Button asChild variant="outline" size="icon" title="重置筛选">
              <Link href="/dashboard/audit">
                <RotateCcw />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
          <p className="shrink-0 text-sm text-muted-foreground">快捷筛选</p>
          <div className="flex flex-wrap gap-2">
            {actionGroups.map((group) => (
              <Button
                key={group.value}
                asChild
                variant={filters.actionGroup === group.value ? "default" : "outline"}
                size="sm"
              >
                <Link href={groupHref(group.value)}>{group.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      </form>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="hidden md:block">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[13%] px-4">时间</TableHead>
                <TableHead className="w-[15%] px-4">操作者</TableHead>
                <TableHead className="w-[19%] px-4">操作</TableHead>
                <TableHead className="w-[12%] px-4">资源</TableHead>
                <TableHead className="px-4">附加数据</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {safeLogs.length > 0 ? (
                safeLogs.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/25">
                    <TableCell className="px-4 py-4 align-top">
                      <div className="font-mono text-xs leading-5 text-muted-foreground">
                        <p>{originalDayjs(item.createdAt).format("YYYY-MM-DD")}</p>
                        <p>{originalDayjs(item.createdAt).format("HH:mm:ss")}</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-top">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.actorName ?? "未知用户"}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {item.actorStudentId ?? `#${item.actorId}`}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-top">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {getActionLabel(item.action)}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {item.action}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-top">
                      <div className="font-mono text-xs leading-5">
                        <p className="text-foreground">{item.resourceType}</p>
                        {item.resourceId ? (
                          <p className="text-muted-foreground">#{item.resourceId}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-top">
                      <MetadataSummary metadata={item.metadata} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center">
                    <p className="text-sm font-medium">暂无审计记录</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      当前筛选条件下没有可显示的数据
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="md:hidden">
          {safeLogs.length > 0 ? (
            safeLogs.map((item) => <AuditLogMobileItem key={item.id} item={item} />)
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              暂无审计记录
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="whitespace-nowrap text-sm text-muted-foreground">
          显示 {start} - {end}，共 {totalCount} 条记录
        </p>
        <PaginationComponent
          totalItems={totalCount}
          pageSize={filters.pageSize}
          currentPage={filters.page}
        />
      </div>
    </div>
  );
}
