import type { Metadata } from "next";
import Link from "next/link";

import { BarChart, ColumnChart, StackedBar } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, humanize, pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { SchoolTracker } from "@/features/platform/school-tracker";
import { requireSuperAdmin } from "@/server/auth/current-user";
import {
  largestSchools,
  planDistribution,
  platformTotals,
  schoolGrowth,
  schoolTracker,
  schoolsByStatus,
} from "@/server/analytics/platform";
import { prisma } from "@/server/db/prisma";
import { PLATFORM_AUDIT_WHERE } from "@/server/platform/audit";

export const metadata: Metadata = { title: "Platform" };

export default async function PlatformDashboardPage(props: PageProps<"/super-admin/dashboard">) {
  // The Super Admin governs the platform and has no school, so this is the one
  // area that uses the unscoped client directly.
  const user = await requireSuperAdmin();
  const q = param((await props.searchParams).q);

  const [tracker, status, growth, plans, totals, largest, queue, recent] = await Promise.all([
    schoolTracker(user, { q }),
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
      // Platform events only; a school's daily operations are not shown here.
      where: PLATFORM_AUDIT_WHERE,
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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total schools" value={status.total} href="/super-admin/schools" />
        <StatCard label="Active schools" value={status.active} href="/super-admin/schools?status=ACTIVE" />
        <StatCard
          label="Pending registrations"
          value={status.awaitingReview}
          href="/super-admin/schools?status=REVIEW"
        />
        <StatCard
          label="Rejected / inactive"
          value={status.rejected + status.suspended}
          hint={`${status.rejected} rejected · ${status.suspended} suspended or inactive`}
        />
      </div>

      <section aria-labelledby="school-list-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="school-list-heading" className="text-lg font-semibold">
              School list
            </h2>
            <p className="text-muted-foreground text-sm">
              {pluralize(tracker.totals.schools, "school")} ·{" "}
              {tracker.totals.students.toLocaleString("en-IN")} students ·{" "}
              {tracker.totals.teachers.toLocaleString("en-IN")} teachers ·{" "}
              {formatMoney(tracker.totals.revenueMinor)} fees collected. Click a school for the
              owner&apos;s details.
            </p>
          </div>
        </div>
        <FilterBar
          action="/super-admin/dashboard"
          search={{ defaultValue: q, placeholder: "Search name, UDISE code, city…" }}
        />
        {tracker.rows.length ? (
          <SchoolTracker
            rows={tracker.rows.map((row) => ({
              ...row,
              joinedLabel: formatDate(row.joinedOn),
              revenueLabel: formatMoney(row.revenueMinor),
            }))}
          />
        ) : (
          <EmptyState title={q ? "No school matches that search" : "No schools yet"}>
            {q ? "Try another name, UDISE code or city." : "Schools appear here once they register."}
          </EmptyState>
        )}
      </section>

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
                <CardTitle>Platform activity</CardTitle>
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
