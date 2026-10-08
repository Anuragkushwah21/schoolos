import type { Metadata } from "next";
import { BarChart3Icon } from "lucide-react";

import { BarChart, ColumnChart, StackedBar } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { OPTIONAL_MODULES } from "@/lib/school-modules";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { largestSchools, moduleAdoption, planDistribution, platformTotals, schoolGrowth, schoolsByStatus } from "@/server/analytics/platform";

export const metadata: Metadata = { title: "Platform reports" };

/**
 * Platform-level reports only: schools, registrations, growth, people across
 * schools, plans and module adoption. A school's own operations — a class's
 * attendance, a student's marks — belong to that school's dashboards.
 */
export default async function PlatformReportsPage() {
  const user = await requireSuperAdmin();
  const [status, growth, totals, plans, adoption, largest] = await Promise.all([
    schoolsByStatus(user),
    schoolGrowth(user, 12),
    platformTotals(user),
    planDistribution(user),
    moduleAdoption(user),
    largestSchools(user, 8),
  ]);
  const thisMonth = growth[growth.length - 1];
  const statusSegments = [
    { key: "ACTIVE", label: "Active", value: status.active, color: "var(--viz-good)" },
    { key: "REVIEW", label: "Pending", value: status.awaitingReview, color: "var(--viz-warning)" },
    { key: "SUSPENDED", label: "Suspended", value: status.suspended, color: "var(--viz-critical)" },
    { key: "REJECTED", label: "Rejected", value: status.rejected, color: "var(--viz-neutral)" },
  ];

  return (
    <>
      <PageHeader icon={BarChart3Icon} tone="blue" title="Platform reports" description="Schools, growth, people and plans across SchoolOS — platform level only." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total schools" value={status.total} href="/super-admin/schools" />
        <StatCard label="Active" value={status.active} href="/super-admin/schools?status=ACTIVE" />
        <StatCard label="New this month" value={thisMonth?.registered ?? 0} hint={`${thisMonth?.approved ?? 0} approved`} />
        <StatCard label="Pending" value={status.awaitingReview} href="/super-admin/approvals" />
        <StatCard label="Suspended" value={status.suspended} href="/super-admin/schools?status=SUSPENDED" />
      </div>
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Students across schools" value={formatNumber(totals.students)} />
        <StatCard label="Teachers across schools" value={formatNumber(totals.teachers)} />
        <StatCard label="Parents across schools" value={formatNumber(totals.parents)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardContent>
            <ChartFigure
              title="School growth, last 12 months"
              subtitle="Registrations each month; hover for approvals."
              table={{ head: ["Month", "Registered", "Approved"], rows: [...growth].reverse().map((month) => [month.fullLabel, month.registered, month.approved]) }}
            >
              <ColumnChart data={growth.map((month) => ({ key: month.key, label: month.label, value: month.registered, detail: pluralize(month.approved, "approval") }))} emptyMessage="No registrations yet." />
            </ChartFigure>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <ChartFigure
              title="Schools by status"
              subtitle={`${status.total} in total.`}
              legend={statusSegments.filter((segment) => segment.value > 0).map((segment) => ({ label: segment.label, color: segment.color, value: String(segment.value) }))}
              table={{ head: ["Status", "Schools"], rows: statusSegments.map((segment) => [segment.label, segment.value]) }}
            >
              <StackedBar segments={statusSegments} emptyMessage="No schools registered yet." />
            </ChartFigure>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <ChartFigure
              title="Module adoption"
              subtitle={`Active schools using each optional module (of ${adoption.activeSchools}). Core modules are in every school.`}
              table={{ head: ["Module", "Schools"], rows: OPTIONAL_MODULES.map((module) => [module.label, adoption.byModule[module.key] ?? 0]) }}
            >
              <BarChart
                data={OPTIONAL_MODULES.map((module) => ({ key: module.key, label: module.label, value: adoption.byModule[module.key] ?? 0 }))}
                labelWidth={120}
                emptyMessage="No active schools yet."
              />
            </ChartFigure>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <ChartFigure
              title="Plan mix"
              subtitle="Schools on a live subscription, by plan."
              table={{ head: ["Plan", "Schools", "Price / year"], rows: plans.map((plan) => [plan.label, plan.value, formatMoney(plan.priceMinor, plan.currency)]) }}
            >
              <BarChart data={plans.map((plan) => ({ key: plan.id, label: plan.label, value: plan.value, detail: `${formatMoney(plan.priceMinor, plan.currency)} / year` }))} labelWidth={90} emptyMessage="No subscriptions yet." />
            </ChartFigure>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent>
            <ChartFigure
              title="Largest schools"
              subtitle="Active schools by student count."
              table={{ head: ["School", "Students", "Teachers"], rows: largest.map((school) => [school.label, school.value, school.teachers]) }}
            >
              <BarChart
                data={largest.map((school) => ({ key: school.id, label: school.label, value: school.value, detail: `${pluralize(school.teachers, "teacher")}${school.city ? ` · ${school.city}` : ""}` }))}
                labelWidth={200}
                emptyMessage="No active schools yet."
              />
            </ChartFigure>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
