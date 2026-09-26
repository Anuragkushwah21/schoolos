import type { Metadata } from "next";
import Link from "next/link";

import { BarChart, ColumnChart, StackedBar } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, humanize, pluralize } from "@/lib/format";
import { requireSuperAdmin } from "@/server/auth/current-user";
import {
  largestSchools,
  planDistribution,
  platformTotals,
  schoolGrowth,
  schoolsByStatus,
} from "@/server/analytics/platform";
import { prisma } from "@/server/db/prisma";

export const metadata: Metadata = { title: "Platform" };

export default async function PlatformDashboardPage() {
  // The Super Admin governs the platform and has no school, so this is the one
  // area that uses the unscoped client directly.
  const user = await requireSuperAdmin();

  const [status, growth, plans, totals, largest, queue, recent] = await Promise.all([
    schoolsByStatus(user),
    schoolGrowth(user, 12),
    planDistribution(user),
    platformTotals(user),
    largestSchools(user, 6),
    prisma.school.findMany({
      where: { status: { in: ["PENDING", "UNDER_REVIEW"] } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true, name: true, city: true, state: true, status: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, summary: true, createdAt: true },
    }),
  ]);

  // Statuses, so the reserved status hues rather than series colours.
  const statusSegments = [
    { key: "ACTIVE", label: "Active", value: status.active, color: "var(--viz-good)" },
    { key: "REVIEW", label: "Awaiting review", value: status.awaitingReview, color: "var(--viz-warning)" },
    { key: "REJECTED", label: "Rejected", value: status.rejected, color: "var(--viz-neutral)" },
    { key: "SUSPENDED", label: "Suspended", value: status.suspended, color: "var(--viz-critical)" },
  ];

  const subscribed = plans.reduce((sum, plan) => sum + plan.value, 0);

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Every school on SchoolOS."
        actions={
          <Button asChild variant="outline">
            <Link href="/super-admin/schools?status=REVIEW">Review queue</Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Schools" value={status.total} href="/super-admin/schools" />
        <StatCard
          label="Awaiting review"
          value={status.awaitingReview}
          href="/super-admin/schools?status=REVIEW"
        />
        <StatCard label="Active" value={status.active} href="/super-admin/schools?status=ACTIVE" />
        <StatCard
          label="Students"
          value={totals.students.toLocaleString("en-IN")}
          hint="across every school"
        />
        <StatCard
          label="Teachers"
          value={totals.teachers.toLocaleString("en-IN")}
          hint={`${totals.users.toLocaleString("en-IN")} accounts in all`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title="Registrations, last 12 months"
                subtitle="Schools that applied each month. Hover a column for how many were approved."
                table={{
                  head: ["Month", "Registered", "Approved"],
                  rows: [...growth]
                    .reverse()
                    .map((month) => [month.fullLabel, month.registered, month.approved]),
                }}
              >
                <ColumnChart
                  data={growth.map((month) => ({
                    key: month.key,
                    label: month.label,
                    value: month.registered,
                    detail: `${pluralize(month.approved, "approval")}`,
                  }))}
                  emptyMessage="No registrations yet."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Schools by status"
                subtitle={`${status.total} in total.`}
                legend={statusSegments
                  .filter((segment) => segment.value > 0)
                  .map((segment) => ({
                    label: segment.label,
                    color: segment.color,
                    value: String(segment.value),
                  }))}
                table={{
                  head: ["Status", "Schools"],
                  rows: statusSegments.map((segment) => [segment.label, segment.value]),
                }}
              >
                <StackedBar segments={statusSegments} emptyMessage="No schools registered yet." />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Largest schools"
                subtitle="Active schools by student count — where the load is."
                table={{
                  head: ["School", "Students", "Teachers"],
                  rows: largest.map((school) => [school.label, school.value, school.teachers]),
                }}
              >
                <BarChart
                  data={largest.map((school) => ({
                    key: school.id,
                    label: school.label,
                    value: school.value,
                    detail: `${pluralize(school.teachers, "teacher")}${school.city ? ` · ${school.city}` : ""}`,
                  }))}
                  labelWidth={180}
                  emptyMessage="No active schools yet."
                />
              </ChartFigure>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Review queue</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/super-admin/schools?status=REVIEW">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {queue.length ? (
                <ul className="divide-y">
                  {queue.map((school) => (
                    <li key={school.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/super-admin/schools/${school.id}`}
                          className="font-medium hover:underline"
                        >
                          {school.name}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {[school.city, school.state].filter(Boolean).join(", ")} · registered{" "}
                          {formatDateTime(school.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={school.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing waiting">New registrations appear here.</EmptyState>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Plan mix"
                subtitle={`${pluralize(subscribed, "school")} on a live subscription.`}
                table={{
                  head: ["Plan", "Schools", "Price / year"],
                  rows: plans.map((plan) => [
                    plan.label,
                    plan.value,
                    formatMoney(plan.priceMinor, plan.currency),
                  ]),
                }}
              >
                <BarChart
                  data={plans.map((plan) => ({
                    key: plan.id,
                    label: plan.label,
                    value: plan.value,
                    detail: `${formatMoney(plan.priceMinor, plan.currency)} / year`,
                  }))}
                  labelWidth={72}
                  width={380}
                  emptyMessage="No subscriptions yet."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>{pluralize(totals.liveTokens, "live API token")}.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/super-admin/audit">Audit log</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {recent.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-0.5 py-3">
                    <p className="text-sm">{entry.summary}</p>
                    <p className="text-muted-foreground text-xs">
                      {humanize(entry.action)} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
