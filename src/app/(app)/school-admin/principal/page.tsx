import type { Metadata, Route } from "next";
import Link from "next/link";
import { CheckCircle2Icon, ClipboardListIcon, Clock3Icon, HourglassIcon, TriangleAlertIcon, UserRoundCogIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS } from "@/features/responsibilities/responsibilities-screen";
import { formatDate, formatDateTime } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { principalWorkspace } from "@/server/people/principals";
import type { ResponsibilityRow } from "@/server/responsibilities/service";

export const metadata: Metadata = { title: "Principal" };

function Rows({ rows, who }: { rows: ResponsibilityRow[]; who: "to" | "by" }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">None yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
          <span className="min-w-0 flex-1 font-medium">{row.title}</span>
          <span className="text-muted-foreground">{who === "to" ? (row.assignedByName ? `from ${row.assignedByName}` : "") : `to ${row.assignedToName}`}</span>
          {row.endDate ? <span className="text-muted-foreground tabular-nums">{`due ${formatDate(row.endDate)}`}</span> : null}
          <StatusBadge status={row.shownStatus} label={STATUS[row.shownStatus].label} tone={STATUS[row.shownStatus].tone} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The School Admin's Principal workspace: who the Principal is, the
 * responsibilities they hold and gave out, and their recent key actions. With
 * no Principal, the School Admin carries the Principal's work.
 */
export default async function PrincipalWorkspacePage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const data = await principalWorkspace(ctx);
  const header = <PageHeader icon={UserRoundCogIcon} tone="purple" title="Principal" description="The Principal's details, responsibilities and recent work." />;

  if (!data.principals.length) {
    return (
      <>
        {header}
        <EmptyState
          title="No Principal Assigned"
          icon={UserRoundCogIcon}
          tone="purple"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/school-admin/settings/principal">Add a Principal</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/school-admin/responsibilities">Responsibilities</Link>
              </Button>
            </div>
          }
        >
          School Admin currently manages Principal responsibilities.
        </EmptyState>
      </>
    );
  }

  const held = data.held!;
  const delegated = data.delegated!;
  return (
    <>
      {header}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {data.principals.map((principal) => (
          <Card key={principal.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {fullName(principal)}
                <StatusBadge status={principal.isActive ? "ACTIVE" : "INACTIVE"} label={principal.isActive ? (principal.activatedAt ? "Active" : "Waiting for activation") : "Login closed"} tone={principal.isActive ? (principal.activatedAt ? "positive" : "warning") : "neutral"} />
              </CardTitle>
              <CardDescription>{[principal.email, principal.phone].filter(Boolean).join(" · ")}</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{principal.lastLoginAt ? `Last signed in ${formatDateTime(principal.lastLoginAt)}` : "Has not signed in yet"}</span>
              <span className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/school-admin/settings/principal">Manage login</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={`/school-admin/principal/${principal.id}` as Route}>Profile &amp; documents</Link>
                </Button>
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-base font-semibold">Principal&apos;s responsibilities</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={Clock3Icon} label="Active" value={held.inProgress} hint="in progress" />
        <StatCard tone="amber" icon={HourglassIcon} label="Pending" value={held.pending} hint="not done yet" />
        <StatCard tone="green" icon={CheckCircle2Icon} label="Completed" value={held.completed} hint={`${held.recentlyCompleted} in the last 30 days`} />
        <StatCard tone="red" icon={TriangleAlertIcon} label="Overdue" value={held.overdue} hint="past the due date" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Given to the Principal</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/responsibilities">Assign</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Rows rows={data.heldRows} who="to" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delegated by the Principal</CardTitle>
            <CardDescription>{`${delegated.pending} pending · ${delegated.overdue} overdue · ${delegated.completed} completed`}</CardDescription>
          </CardHeader>
          <CardContent>
            <Rows rows={data.delegatedRows} who="by" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ClipboardListIcon className="size-4" aria-hidden />
            Recent activity
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/school-admin/audit">Full audit log</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.activity.length ? (
            <ul className="divide-y text-sm">
              {data.activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                  <span className="text-muted-foreground w-40 shrink-0 tabular-nums">{formatDateTime(entry.createdAt)}</span>
                  <span className="min-w-0 flex-1">{entry.summary}</span>
                  {entry.module ? <span className="text-muted-foreground text-xs">{entry.module}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No recorded actions yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
