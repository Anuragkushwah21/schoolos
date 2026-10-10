import type { Route } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CalendarClockIcon,
  CalendarOffIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FilePenLineIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  HourglassIcon,
  IdCardIcon,
  ListTodoIcon,
  ReceiptTextIcon,
  SendIcon,
  UserCheckIcon,
  UserCogIcon,
  UserPlusIcon,
  WalletIcon,
} from "lucide-react";

import { BarChart, GroupedColumnChart, StackedBar } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { NeedsAttention } from "@/components/shared/needs-attention";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { formatDate, formatMonth, today } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/translate";
import { academicSnapshot, admissionsToday, financeSnapshot, staffToday, studentBands } from "@/server/analytics/admin-dashboard";
import { attendanceTrend, genderSplit, registersOutstanding } from "@/server/analytics/school";
import { needsAttention } from "@/server/analytics/today";
import { todayOverview } from "@/server/attendance/service";
import type { TenantContext } from "@/server/auth/current-user";
import { classStrengthReport } from "@/server/reports/exports";
import { getIntlLocale, getT } from "@/server/i18n";
import { attendedDays } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { WorkspaceCards } from "@/features/staff/workspace-cards";
import { getPayroll } from "@/server/finance/payroll";
import { staffCountsByRole } from "@/server/operations/staff";

/**
 * The School Admin dashboard, as sections that each answer one question and
 * load on their own (each is wrapped in Suspense by the page):
 *
 *   Today      — what happened today?
 *   Students   — how many students do we have?
 *   Academics  — who needs attention, and what is waiting?
 *   Staff      — who is in, who is away?
 *   Money      — what came in and went out?
 *   Needs action — what requires a decision?
 *
 * Charts only where they say something a number cannot, and every chart has
 * its numbers alongside.
 */

function SectionHeading({ id, title, href, linkLabel }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 id={id} className="text-lg font-bold tracking-tight">
        {title}
      </h2>
      {href ? (
        <Link href={href as Route} className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline">
          {linkLabel}
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export function SectionSkeleton({ tiles = 4, chart = false }: { tiles?: number; chart?: boolean }) {
  return (
    <div className="mb-10" aria-hidden>
      <Skeleton className="mb-3 h-6 w-40" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {Array.from({ length: tiles }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
      {chart ? <Skeleton className="mt-4 h-56 rounded-2xl" /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Today
// -----------------------------------------------------------------------------

export async function TodaySection({ ctx, sessionId, modules }: { ctx: TenantContext; sessionId: string | null; /** The school's optional modules: fee and expense tiles only when it has them. */ modules: readonly string[] }) {
  const [admissions, money, overview, registers] = await Promise.all([
    admissionsToday(ctx),
    sessionId ? financeSnapshotLite(ctx) : Promise.resolve({ collected: 0, expenses: 0 }),
    sessionId ? todayOverview(ctx, sessionId) : Promise.resolve(null),
    sessionId ? registersOutstanding(ctx, sessionId) : Promise.resolve([]),
  ]);
  const closed = overview?.closure ?? null;
  const pending = await needsAttention(ctx, {
    academicSessionId: sessionId,
    registersPending: closed ? 0 : registers.filter((row) => !row.marked).length,
    staffMarked: overview?.staffMarked ?? 0,
    closedToday: Boolean(closed),
  });
  const attended = overview ? attendedDays(overview.counts) : 0;
  const share = overview && overview.counts.total ? Math.round((attended / overview.counts.total) * 100) : null;

  return (
    <section aria-labelledby="today" className="mb-10">
      <SectionHeading id="today" title="Today" />
      <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", modules.includes("FINANCE") && modules.includes("EXPENSES") ? "lg:grid-cols-5" : "lg:grid-cols-3")}>
        <StatCard tone="blue" icon={UserPlusIcon} label="New admissions" value={admissions.admitted} hint={`${admissions.enquiries} new enquir${admissions.enquiries === 1 ? "y" : "ies"} · ${admissions.applications} application${admissions.applications === 1 ? "" : "s"}`} href="/school-admin/admissions/enquiries" />
        {modules.includes("FINANCE") ? <StatCard tone="green" icon={WalletIcon} label="Fee collection" value={rupees(money.collected)} hint="received today" href="/school-admin/finance/payments" /> : null}
        {modules.includes("EXPENSES") ? <StatCard tone="orange" icon={ReceiptTextIcon} label="Expenses" value={rupees(money.expenses)} hint="spent today" href="/school-admin/finance/expenses" /> : null}
        <StatCard
          tone="cyan"
          icon={ClipboardCheckIcon}
          label="Attendance"
          value={share === null ? "—" : `${share}%`}
          hint={closed ? closed.label : overview && overview.counts.total ? `${attended} of ${overview.counts.total} present` : "not marked yet"}
          href="/school-admin/attendance"
        />
        <StatCard tone={pending.length ? "red" : "green"} icon={ListTodoIcon} label="Pending actions" value={pending.length} hint={pending.length ? "see Needs action" : "all clear"} href="#needs-action" />
      </div>
    </section>
  );
}

async function financeSnapshotLite(ctx: TenantContext) {
  const date = today();
  const [collected, expenses] = await Promise.all([
    ctx.db.feePayment.aggregate({ where: { paidOn: date, voidedAt: null }, _sum: { amountMinor: true } }),
    ctx.db.expense.aggregate({ where: { spentOn: date }, _sum: { amountMinor: true } }),
  ]);
  return { collected: collected._sum.amountMinor ?? 0, expenses: expenses._sum.amountMinor ?? 0 };
}

// -----------------------------------------------------------------------------
// Students and staff
// -----------------------------------------------------------------------------

export async function StudentsSection({ ctx, sessionId }: { ctx: TenantContext; sessionId: string }) {
  const [bands, gender, strength] = await Promise.all([studentBands(ctx, sessionId), genderSplit(ctx), classStrengthReport(ctx)]);
  const total = bands.reduce((sum, band) => sum + band.value, 0);
  const genderSegments = [
    { key: "boys", label: "Boys", value: gender.boys, color: "var(--viz-accent)" },
    { key: "girls", label: "Girls", value: gender.girls, color: "var(--viz-ordinal-1)" },
    { key: "other", label: "Other / not recorded", value: gender.other, color: "var(--viz-neutral)" },
  ];
  return (
    <section aria-labelledby="students" className="flex flex-col">
      <SectionHeading id="students" title="Students" href="/school-admin/students" linkLabel="All students" />
      <Card className="flex-1">
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-extrabold tracking-tight tabular-nums">{formatNumber(total)}</span>
            <span className="text-muted-foreground text-sm">current students this session</span>
          </div>
          <ChartFigure title="By stage" table={{ head: ["Stage", "Students"], rows: bands.map((band) => [band.label, band.value]) }}>
            <BarChart data={bands} labelWidth={130} emptyMessage="No students placed this session yet." />
          </ChartFigure>
          <ChartFigure
            title="Boys and girls"
            legend={genderSegments.filter((segment) => segment.value > 0).map((segment) => ({ label: segment.label, color: segment.color, value: String(segment.value) }))}
            table={{ head: ["", "Students"], rows: genderSegments.map((segment) => [segment.label, segment.value]) }}
          >
            <StackedBar segments={genderSegments} emptyMessage="No students yet." />
          </ChartFigure>
          {strength.rows.length ? (
            <div>
              <p className="mb-2 text-sm font-medium">By class</p>
              <div className="max-h-72 overflow-y-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-xs">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Class</th>
                      <th className="px-3 py-1.5 text-right font-medium">Boys</th>
                      <th className="px-3 py-1.5 text-right font-medium">Girls</th>
                      <th className="px-3 py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {strength.rows.map((row) => (
                      <tr key={row.name}>
                        <td className="px-3 py-1.5">{row.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.boys}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.girls}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

export async function StaffSection({ ctx, sessionId }: { ctx: TenantContext; sessionId: string | null }) {
  const [staff, overview] = await Promise.all([staffToday(ctx), sessionId ? todayOverview(ctx, sessionId) : Promise.resolve(null)]);
  return (
    <section aria-labelledby="staff" className="flex flex-col">
      <SectionHeading id="staff" title="Staff" href="/school-admin/teachers" linkLabel="Teachers & staff" />
      <div className="grid flex-1 grid-cols-2 gap-3 sm:gap-4">
        <StatCard tone="purple" icon={UserCogIcon} label="Teachers" value={staff.teachers} href="/school-admin/teachers" />
        <StatCard tone="purple" icon={IdCardIcon} label="Other staff" value={staff.staff} href="/school-admin/staff" />
        <StatCard
          tone="green"
          icon={UserCheckIcon}
          label="Teachers present today"
          value={overview && overview.staffMarked ? `${overview.staffPresent} / ${overview.staffMarked}` : "—"}
          hint={overview && overview.staffMarked ? "of those marked" : "staff register not marked"}
          href="/school-admin/attendance/staff"
        />
        <StatCard tone="amber" icon={CalendarOffIcon} label="On leave today" value={staff.onLeave} hint="approved leave" href="/school-admin/leave" />
      </div>
    </section>
  );
}

/**
 * Staff by kind — Teaching and Non-teaching — as role cards. Each opens that
 * role's workspace, where the admin does the work directly, as admin.
 */
export async function StaffWorkspacesSection({ ctx }: { ctx: TenantContext }) {
  const counts = await staffCountsByRole(ctx);
  return (
    <section aria-labelledby="staff-workspaces" className="mb-10">
      <SectionHeading id="staff-workspaces" title="Staff workspaces" href="/school-admin/staff/workspaces" linkLabel="All roles" />
      <p className="text-muted-foreground mb-3 text-sm">Do any role&apos;s work yourself — no staff account needed — or add people to a role when you hire.</p>
      <WorkspaceCards counts={counts} />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Academics
// -----------------------------------------------------------------------------

export async function AcademicSection({ ctx, sessionId }: { ctx: TenantContext; sessionId: string }) {
  const [academic, trend] = await Promise.all([academicSnapshot(ctx, sessionId), attendanceTrend(ctx, { academicSessionId: sessionId, days: 30 })]);
  return (
    <section aria-labelledby="academics" className="mb-10">
      <SectionHeading id="academics" title="Academics" href="/school-admin/exams" linkLabel="Exams & results" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <StatCard tone="orange" icon={HeartPulseIcon} label="Students needing attention" value={academic.needsAttention} hint="by the school's rule" href="/school-admin/exams/performance" />
        <StatCard tone="amber" icon={FilePenLineIcon} label="Tests pending marks" value={academic.pendingMarks} hint="held, not submitted" href="/school-admin/exams/pending" />
        <StatCard tone="blue" icon={SendIcon} label="Results to publish" value={academic.readyToPublish} hint="term exams ready" href="/school-admin/exams/term?status=READY_TO_PUBLISH" />
        <StatCard
          tone="purple"
          icon={CalendarClockIcon}
          label="Upcoming exams"
          value={academic.upcomingExams}
          hint={academic.nextExam ? `${academic.nextExam.name}, ${formatDate(academic.nextExam.startDate)}` : `${academic.upcomingTests} ${academic.upcomingTests === 1 ? "test" : "tests"} in 14 days`}
          href="/school-admin/exams/term"
        />
      </div>
      <Card>
        <CardContent>
          <ChartFigure
            title="Attendance, last 30 days"
            subtitle="Present and late, over every student marked that day. Days with no register are left out."
            table={{
              head: ["Day", "Attended"],
              rows: trend
                .filter((point) => point.counts.total > 0)
                .slice(-10)
                .reverse()
                .map((point) => [point.label, point.share === null ? "—" : `${Math.round(point.share * 100)}%`]),
            }}
          >
            <TrendArea
              data={trend.map((point) => ({
                key: point.key,
                label: point.label,
                value: point.share === null ? null : Math.round(point.share * 100),
                detail: point.counts.total > 0 ? `${attendedDays(point.counts)} of ${point.counts.total} students` : undefined,
              }))}
              emptyMessage="Mark a few registers and the trend will appear here."
            />
          </ChartFigure>
        </CardContent>
      </Card>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------

export async function FinanceSection({ ctx, sessionId }: { ctx: TenantContext; sessionId: string }) {
  const money = await financeSnapshot(ctx, sessionId);
  const hasTrend = money.months.some((month) => month.fees || month.expenses);
  return (
    <section aria-labelledby="money" className="mb-10">
      <SectionHeading id="money" title="Money" href="/school-admin/finance" linkLabel="Finance overview" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-3 2xl:grid-cols-5">
        <StatCard tone="green" icon={WalletIcon} label="Collected today" value={rupees(money.collectedTodayMinor)} href="/school-admin/finance/payments" />
        <StatCard tone="orange" icon={ReceiptTextIcon} label="Expenses today" value={rupees(money.expensesTodayMinor)} href="/school-admin/finance/expenses" />
        <StatCard tone="blue" icon={BanknoteIcon} label="Collected this session" value={rupees(money.collectedSessionMinor)} />
        <StatCard tone="amber" icon={GraduationCapIcon} label="Pending fees" value={rupees(money.pendingMinor)} hint="still to be paid this session" href="/school-admin/finance/payments" />
        <StatCard
          tone={money.overdueStudents ? "red" : "green"}
          icon={ClipboardListIcon}
          label="Outstanding (overdue)"
          value={money.overdueStudents}
          hint={money.overdueStudents ? "students past their due date" : "nobody overdue"}
          href="/school-admin/finance/payments"
        />
      </div>
      <Card>
        <CardContent>
          <ChartFigure
            title="Fees collected and expenses, last 6 months"
            legend={[
              { label: "Fees collected", color: "var(--viz-good)" },
              { label: "Expenses", color: "var(--viz-warning)" },
            ]}
            table={{ head: ["Month", "Fees", "Expenses"], rows: money.months.map((month) => [month.label, rupees(month.fees), rupees(month.expenses)]) }}
          >
            {hasTrend ? (
              <GroupedColumnChart
                categories={money.months.map((month) => ({ key: month.key, label: month.label }))}
                series={[
                  { key: "fees", label: "Fees collected", color: "var(--viz-good)" },
                  { key: "expenses", label: "Expenses", color: "var(--viz-warning)" },
                ]}
                values={money.months.map((month) => [month.fees, month.expenses])}
                formatValue={(value) => rupees(value)}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No payments or expenses recorded in the last six months.</p>
            )}
          </ChartFigure>
        </CardContent>
      </Card>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Salaries
// -----------------------------------------------------------------------------

/**
 * This month's salaries, whoever paid them — the accountant or the admin:
 * how much has gone out, how much is still to pay, and each payment with
 * who recorded it. Every payment is also on the audit log, by name.
 */
export async function SalariesSection({ ctx }: { ctx: TenantContext }) {
  const payroll = await getPayroll(ctx, today());
  const paid = payroll.rows
    .filter((row) => row.payment)
    .sort((a, b) => b.payment!.createdAt.getTime() - a.payment!.createdAt.getTime());
  const unpaid = payroll.rows.filter((row) => !row.payment && row.dueMinor !== null);
  const month = formatMonth(payroll.month);
  return (
    <section aria-labelledby="salaries" className="mb-10">
      <SectionHeading id="salaries" title={`Salaries — ${month}`} href="/school-admin/finance/payroll" linkLabel="Payroll" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard tone="green" icon={BanknoteIcon} label="Paid this month" value={rupees(payroll.totals.paidMinor)} hint={`${payroll.totals.paid} ${payroll.totals.paid === 1 ? "person" : "people"}`} href="/school-admin/finance/payroll" />
        <StatCard
          tone={payroll.totals.remainingMinor ? "amber" : "green"}
          icon={HourglassIcon}
          label="Still to pay"
          value={rupees(payroll.totals.remainingMinor)}
          hint={unpaid.length ? `${unpaid.length} ${unpaid.length === 1 ? "person" : "people"}` : "everyone paid"}
          href="/school-admin/finance/payroll"
        />
        <StatCard tone="blue" icon={WalletIcon} label="Salary bill" value={rupees(payroll.totals.dueMinor)} hint="due this month" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Paid this month</h3>
            {paid.length ? (
              <ul className="divide-y text-sm">
                {paid.slice(0, 8).map((row) => (
                  <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground"> · {row.role}</span>
                      <span className="text-muted-foreground block text-xs">
                        {`Paid ${formatDate(row.payment!.paidOn)}${row.payment!.paidBy ? ` by ${row.payment!.paidBy}` : ""}`}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{rupees(row.payment!.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No salary paid yet this month.</p>
            )}
          </div>
          {unpaid.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Not paid yet</h3>
              <ul className="flex flex-wrap gap-2 text-xs">
                {unpaid.slice(0, 12).map((row) => (
                  <li key={row.key} className="bg-warning-soft rounded-full px-2.5 py-1">
                    {`${row.name} · ${row.role} · ${rupees(row.dueMinor ?? 0)}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Needs action
// -----------------------------------------------------------------------------

export async function NeedsActionSection({ ctx, sessionId, stacked = false }: { ctx: TenantContext; sessionId: string | null; stacked?: boolean }) {
  const [t, intl, overview, registers] = await Promise.all([
    getT(),
    getIntlLocale(),
    sessionId ? todayOverview(ctx, sessionId) : Promise.resolve(null),
    sessionId ? registersOutstanding(ctx, sessionId) : Promise.resolve([]),
  ]);
  const closed = overview?.closure ?? null;
  const todo = await needsAttention(ctx, {
    academicSessionId: sessionId,
    registersPending: closed ? 0 : registers.filter((row) => !row.marked).length,
    staffMarked: overview?.staffMarked ?? 0,
    closedToday: Boolean(closed),
  });
  return (
    <div id="needs-action" className="scroll-mt-24">
      <NeedsAttention
        title="Needs action"
        stacked={stacked}
        allClear={t("dashboard.attention.allClear")}
        rows={todo.map((item) => ({
          key: item.key,
          href: item.href,
          tone: item.tone,
          text: t(`dashboard.attention.${item.key}` as MessageKey, { count: formatNumber(item.count, intl), amount: formatMoney(item.amountMinor ?? 0, "INR", intl) }),
          action: t(`dashboard.attention.${item.key}Action` as MessageKey),
        }))}
      />
    </div>
  );
}
