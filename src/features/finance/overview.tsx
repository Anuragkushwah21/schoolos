import type { Route } from "next";
import Link from "next/link";
import { TriangleAlertIcon, WalletIcon, ReceiptTextIcon, BanknoteIcon, HourglassIcon, TrendingUpIcon, TrendingDownIcon } from "lucide-react";

import { BarChart, GroupedColumnChart } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { FilterBar } from "@/components/shared/filter-bar";
import { ChartSkeleton, StatCardsSkeleton } from "@/components/shared/skeletons";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import type { TenantContext } from "@/server/auth/current-user";
import {
  type FinanceOverview,
  type FinanceRange,
  financeOverview,
} from "@/server/finance/overview";

/**
 * The School Admin's money at a glance: today, this month, the chosen period,
 * and where it went.
 *
 * Rendered inside its own Suspense boundary on the dashboard, so the rest of
 * the page does not wait on the finance queries, and a failure here shows a
 * message in this section rather than taking the dashboard down with it.
 */

const SERIES = [
  { key: "fees", label: "Fees collected", color: "var(--viz-good)" },
  { key: "expenses", label: "Expenses", color: "var(--viz-critical)" },
  { key: "salary", label: "Salary paid", color: "var(--viz-warning)" },
];

const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const QUICK_ACTIONS: Array<{ href: Route; label: string; primary?: boolean }> = [
  { href: "/school-admin/finance/fees", label: "Collect fee", primary: true },
  { href: "/school-admin/finance/expenses", label: "Add expense", primary: true },
  { href: "/school-admin/finance/salaries", label: "Pay salary", primary: true },
  { href: "/school-admin/finance/payments", label: "View fee collection" },
  { href: "/school-admin/finance/expenses", label: "View expenses" },
  { href: "/school-admin/finance/salaries", label: "View salary payments" },
];

/** A zero is still a figure; the hint says what zero means here. */
function orNone(minor: number, none: string) {
  return minor > 0 ? undefined : none;
}

export async function FinanceOverviewSection({
  ctx,
  range,
  action,
}: {
  ctx: TenantContext;
  range: FinanceRange;
  /** The page the date filter submits back to. */
  action: string;
}) {
  let overview: FinanceOverview;
  try {
    overview = await financeOverview(ctx, range);
  } catch (error) {
    console.error("[finance] overview failed", error);
    return (
      <section aria-labelledby="finance-heading" className="mb-6">
        <FinanceHeading />
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-strong"
        >
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          Finance figures could not be loaded just now. Refresh the page to try again.
        </div>
      </section>
    );
  }

  const { period } = overview;

  return (
    <section aria-labelledby="finance-heading" className="mb-8">
      <FinanceHeading />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="orange" icon={WalletIcon}
          label="Today's fee collection"
          value={rupees(overview.today.feesMinor)}
          hint={orNone(overview.today.feesMinor, "No fee collected today")}
          href="/school-admin/finance/payments"
        />
        <StatCard tone="red" icon={ReceiptTextIcon}
          label="Today's expenses"
          value={rupees(overview.today.expensesMinor)}
          hint={orNone(overview.today.expensesMinor, "No expenses today")}
          href="/school-admin/finance/expenses"
        />
        <StatCard tone="amber" icon={BanknoteIcon}
          label="Today's salary paid"
          value={rupees(overview.today.salaryMinor)}
          hint={orNone(overview.today.salaryMinor, "No salary paid today")}
          href="/school-admin/finance/salaries"
        />
        <StatCard tone="red" icon={HourglassIcon}
          label="Pending fees"
          value={rupees(overview.pending.pendingMinor)}
          hint={
            !overview.pending.hasSession
              ? "No current session"
              : overview.pending.pendingMinor === 0
                ? "No pending fees"
                : overview.pending.overdue
                  ? `${overview.pending.overdue} students overdue`
                  : "none overdue"
          }
          href="/school-admin/finance/fees"
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard tone="orange" icon={TrendingUpIcon} label="This month · collection" value={rupees(overview.month.feesMinor)} />
        <StatCard tone="red" icon={TrendingDownIcon} label="This month · expenses" value={rupees(overview.month.expensesMinor)} />
        <StatCard tone="amber" icon={BanknoteIcon} label="This month · salary" value={rupees(overview.month.salaryMinor)} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((item) => (
          <Button key={item.label} asChild size="sm" variant={item.primary ? "default" : "outline"}>
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Net cash flow · {overview.range.label}</CardTitle>
          <CardDescription>
            Calculated operational cash flow: fees received minus expenses minus salary paid in
            this period. It is not accounting profit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FilterBar
            action={action}
            selects={[{ name: "range", label: "Period", defaultValue: range.key, options: RANGE_OPTIONS }]}
            dates={[
              { name: "from", label: "From (custom)", defaultValue: range.key === "custom" ? toDateInput(range.from) : undefined, max: toDateInput(today()) },
              { name: "to", label: "To (custom)", defaultValue: range.key === "custom" ? toDateInput(range.to) : undefined, max: toDateInput(today()) },
            ]}
          />
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Fees collected</dt>
              <dd className="text-lg font-semibold tabular-nums">{rupees(period.feesMinor)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expenses</dt>
              <dd className="text-lg font-semibold tabular-nums">− {rupees(period.expensesMinor)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Salary paid</dt>
              <dd className="text-lg font-semibold tabular-nums">− {rupees(period.salaryMinor)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Net cash flow</dt>
              <dd
                className="text-lg font-semibold tabular-nums"
                style={{ color: period.netMinor < 0 ? "var(--viz-critical)" : "var(--viz-good)" }}
              >
                {period.netMinor < 0 ? "− " : ""}
                {rupees(Math.abs(period.netMinor))}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardContent>
            <ChartFigure
              title="Monthly finance trend"
              subtitle="Fees collected, expenses and salary paid over the last six months."
              legend={SERIES.map((s) => ({ label: s.label, color: s.color }))}
              table={{
                head: ["Month", "Fees", "Expenses", "Salary"],
                rows: overview.trend.map((m) => [
                  m.label,
                  rupees(m.feesMinor),
                  rupees(m.expensesMinor),
                  rupees(m.salaryMinor),
                ]),
              }}
            >
              <GroupedColumnChart
                categories={overview.trend.map((m) => ({ key: m.key, label: m.label }))}
                series={SERIES}
                values={overview.trend.map((m) => [m.feesMinor, m.expensesMinor, m.salaryMinor])}
                formatValue={rupees}
                emptyMessage="No fees, expenses or salary recorded in the last six months."
              />
            </ChartFigure>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title="Expenses by category"
                subtitle={overview.range.label}
                table={{
                  head: ["Category", "Amount"],
                  rows: overview.expenseByCategory.map((row) => [
                    humanize(row.category),
                    rupees(row.amountMinor),
                  ]),
                }}
              >
                <BarChart
                  data={overview.expenseByCategory.map((row) => ({
                    key: row.category,
                    label: humanize(row.category),
                    value: row.amountMinor,
                    color: "var(--viz-critical)",
                  }))}
                  formatValue={rupees}
                  labelWidth={96}
                  width={380}
                  emptyMessage="No expenses in this period."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Fee collection by class"
                subtitle={overview.range.label}
                table={{
                  head: ["Class", "Collected"],
                  rows: overview.feesByClass.map((row) => [row.label, rupees(row.amountMinor)]),
                }}
              >
                <BarChart
                  data={overview.feesByClass.map((row) => ({
                    key: row.key,
                    label: row.label,
                    value: row.amountMinor,
                    color: "var(--viz-good)",
                  }))}
                  formatValue={rupees}
                  labelWidth={96}
                  width={380}
                  emptyMessage="No fees collected in this period."
                />
              </ChartFigure>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function FinanceHeading() {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="finance-heading" className="text-lg font-semibold">
        Finance overview
      </h2>
      <Link href="/school-admin/finance" className="text-primary text-sm hover:underline">
        Open finance
      </Link>
    </div>
  );
}

/** What the finance section looks like while its queries run. */
export function FinanceOverviewSkeleton() {
  return (
    <section aria-busy="true" className="mb-8">
      <div className="bg-muted mb-4 h-6 w-40 animate-pulse rounded" />
      <StatCardsSkeleton count={4} />
      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </section>
  );
}
