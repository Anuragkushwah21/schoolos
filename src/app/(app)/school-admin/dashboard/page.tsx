import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  BarChart3Icon,
  BookOpenIcon,
  CalendarOffIcon,
  CheckIcon,
  ClipboardCheckIcon,
  GraduationCapIcon,
  HandshakeIcon,
  IdCardIcon,
  MegaphoneIcon,
  NotebookPenIcon,
  ReceiptTextIcon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  BanknoteIcon,
} from "lucide-react";

import { ChartEmpty, ChartFigure } from "@/components/charts/chart-figure";
import { BarChart, Meter, StackedBar } from "@/components/charts/bars";
import { TrendArea } from "@/components/charts/trend-area";
import {
  ORDINAL_RAMP,
  attendanceLegend,
  attendanceSegments,
} from "@/components/charts/attendance-colors";
import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { FinanceOverviewSection, FinanceOverviewSkeleton } from "@/features/finance/overview";
import { SetupProgressCard } from "@/features/school/setup-progress";
import { setupReport } from "@/server/academics/setup";
import { formatDayShort } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/format";
import { greetingKey } from "@/lib/greeting";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { todayOverview } from "@/server/attendance/service";
import {
  admissionsFunnel,
  attendanceTrend,
  classStrength,
  genderSplit,
  registersOutstanding,
  studentsNeedingAttention,
} from "@/server/analytics/school";
import { needsAttention, schoolToday } from "@/server/analytics/today";
import { supportSummary } from "@/server/support/service";
import type { MessageKey } from "@/lib/i18n/translate";
import { NeedsAttention } from "@/components/shared/needs-attention";
import { resolveFinanceRange } from "@/server/finance/overview";
import { getIntlLocale, getT } from "@/server/i18n";

export const metadata: Metadata = { title: "School dashboard" };

const LOW_ATTENDANCE = 0.75;

/**
 * The School Admin's home: "what is happening today?" first — the day's
 * numbers and the things people do most — then today's activity, and the
 * longer-range charts below for when there is time to look.
 */
export default async function AdminDashboardPage(props: PageProps<"/school-admin/dashboard">) {
  // Authorization and tenant scope in one step: `db` can only ever see this
  // administrator's own school.
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { db } = ctx;
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const search = await props.searchParams;
  // Only a filter hint: the figures themselves are scoped by `ctx`, never by
  // anything in the URL.
  const financeRange = resolveFinanceRange({
    range: param(search.range),
    from: param(search.from),
    to: param(search.to),
  });

  const session = await getCurrentSession(ctx);

  const [students, teachers, overview, gender, day, support] = await Promise.all([
    db.student.count({ where: { status: "ACTIVE" } }),
    db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    session ? todayOverview(ctx, session.id) : Promise.resolve(null),
    genderSplit(ctx),
    schoolToday(ctx, session?.id ?? null),
    supportSummary(ctx),
  ]);

  // A school that is not finished being set up needs the order of the steps
  // more than it needs charts of data it does not have yet.
  const setup = await setupReport(ctx);

  const [trend, strength, funnel, attention, registers] = session
    ? await Promise.all([
        attendanceTrend(ctx, { academicSessionId: session.id, days: 30 }),
        classStrength(ctx, session.id),
        admissionsFunnel(ctx, session.id),
        studentsNeedingAttention(ctx, {
          academicSessionId: session.id,
          threshold: LOW_ATTENDANCE,
          limit: 6,
        }),
        registersOutstanding(ctx, session.id),
      ])
    : [[], [], null, [], []];

  const attendedToday = overview ? overview.counts.PRESENT + overview.counts.LATE : 0;
  // On a holiday or weekly off nobody is expected to open a register.
  const closedToday = overview?.closure ?? null;
  const outstanding = closedToday ? [] : registers.filter((row) => !row.marked);
  const percent = LOW_ATTENDANCE * 100;
  const todo = await needsAttention(ctx, {
    academicSessionId: session?.id ?? null,
    registersPending: outstanding.length,
    staffMarked: overview?.staffMarked ?? 0,
    closedToday: Boolean(closedToday),
  });

  return (
    <>
      <PageHeader variant="hero"
        title={`${t(greetingKey(), { name: ctx.user.firstName })} 👋`}
        description={session ? `${t("dashboard.admin.session", { name: session.name })} · ${formatDayShort(new Date(), intl)}` : t("dashboard.admin.noSession")}
      />

      <SetupProgressCard report={setup} />

      <section aria-labelledby="today-overview" className="mb-8">
        <h2 id="today-overview" className="mb-3 text-base font-semibold">
          {t("dashboard.todayOverview")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <StatCard
            tone="blue"
            icon={GraduationCapIcon}
            label={t("dashboard.admin.students")}
            value={formatNumber(students, intl)}
            hint={`${gender.boys} · ${gender.girls}`}
            href="/school-admin/students"
          />
          <StatCard tone="purple" icon={UserCogIcon} label={t("dashboard.admin.teachers")} value={formatNumber(teachers, intl)} href="/school-admin/teachers" />
          <StatCard tone="purple" icon={IdCardIcon} label={t("dashboard.admin.staff")} value={formatNumber(day.staff, intl)} href="/school-admin/staff" />
          <StatCard
            tone="green"
            icon={ClipboardCheckIcon}
            label={t("dashboard.admin.attendance")}
            value={overview && overview.counts.total ? `${formatNumber(attendedToday, intl)} / ${formatNumber(overview.counts.total, intl)}` : "—"}
            hint={closedToday ? closedToday.label : overview && overview.counts.total ? t("dashboard.admin.attendanceHint", { total: overview.counts.total }) : t("dashboard.admin.notMarked")}
            href="/school-admin/attendance"
          />
          <StatCard
            tone="blue"
            icon={BookOpenIcon}
            label={t("dashboard.admin.classes")}
            value={formatNumber(day.classesToday, intl)}
            hint={closedToday ? closedToday.label : t("dashboard.admin.classesHint")}
            href="/school-admin/timetable"
          />
          <StatCard tone="purple" icon={NotebookPenIcon} label={t("dashboard.admin.homework")} value={formatNumber(day.homeworkToday, intl)} href="/school-admin/homework" />
        </div>
      </section>

      <h2 className="mb-3 text-base font-semibold">Events, leave, notices &amp; meetings</h2>
      <SchoolLifeCards ctx={ctx} base="/school-admin" />

      <section aria-labelledby="money-today" className="mb-8">
        <h2 id="money-today" className="mb-3 text-base font-semibold">
          {t("dashboard.admin.moneyToday")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard
            tone="orange"
            icon={WalletIcon}
            label={t("dashboard.admin.collection")}
            value={formatMoney(day.collectionMinor, "INR", intl)}
            hint={t("dashboard.admin.collectionHint", { count: day.paymentCount })}
            href="/school-admin/finance/payments"
          />
          <StatCard tone="red" icon={ReceiptTextIcon} label={t("dashboard.admin.expenses")} value={formatMoney(day.expensesMinor, "INR", intl)} href="/school-admin/finance/expenses" />
          <StatCard
            tone="amber"
            icon={BanknoteIcon}
            label={t("dashboard.admin.salaryPaid")}
            value={formatMoney(day.salaryMinor, "INR", intl)}
            hint={t("dashboard.admin.salaryHint", { count: day.salaryCount })}
            href="/school-admin/finance/salaries"
          />
        </div>
      </section>

      <QuickActions
        title={t("dashboard.quickActions")}
        actions={[
          { href: "/school-admin/students/new", label: t("dashboard.admin.addStudent"), icon: UserPlusIcon, tone: "blue" },
          { href: "/school-admin/teachers/new", label: t("dashboard.admin.addTeacher"), icon: UsersIcon, tone: "purple" },
          { href: "/school-admin/attendance", label: t("dashboard.admin.takeAttendance"), icon: ClipboardCheckIcon, tone: "green" },
          { href: "/school-admin/finance/payments", label: t("dashboard.admin.collectFee"), icon: WalletIcon, tone: "orange" },
          { href: "/school-admin/notices/new", label: t("dashboard.admin.createNotice"), icon: MegaphoneIcon, tone: "amber" },
          { href: "/school-admin/meetings/new", label: t("dashboard.admin.createMeeting"), icon: HandshakeIcon, tone: "cyan" },
          { href: "/school-admin/reports", label: t("dashboard.admin.viewReports"), icon: BarChart3Icon, tone: "blue" },
        ]}
      />

      {closedToday ? (
        <div role="status" className="bg-info-soft text-info-strong border-info/25 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <p className="flex items-center gap-2">
            <CalendarOffIcon className="size-4 shrink-0" aria-hidden />
            {t("dashboard.admin.closedToday", { label: closedToday.label })}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/school-admin/holidays">{t("nav.calendar")}</Link>
          </Button>
        </div>
      ) : null}

      <NeedsAttention
        title={t("dashboard.attention.title")}
        allClear={t("dashboard.attention.allClear")}
        rows={todo.map((item) => ({
          key: item.key,
          href: item.href,
          tone: item.tone,
          text: t(`dashboard.attention.${item.key}` as MessageKey, {
            count: formatNumber(item.count, intl),
            amount: formatMoney(item.amountMinor ?? 0, "INR", intl),
          }),
          action: t(`dashboard.attention.${item.key}Action` as MessageKey),
        }))}
      />

      <h2 className="mb-3 text-base font-semibold">{t("dashboard.todayActivity")}</h2>
      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("dashboard.admin.registersTitle")}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/attendance">{t("common.open")}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {registers.length ? (
              <ul className="divide-y text-sm">
                {registers.slice(0, 8).map((row) => (
                  <li key={row.id} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{row.label}</span>
                    {row.marked ? (
                      <StatusBadge status="ACTIVE" label={t("dashboard.admin.marked")} />
                    ) : closedToday ? null : (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/school-admin/attendance?section=${row.id}`}>{t("dashboard.admin.markNow")}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t("empty.nothingYet")}</p>
            )}
            {registers.length && !outstanding.length && !closedToday ? (
              <p className="text-success-strong mt-3 flex items-center gap-2 text-sm">
                <CheckIcon className="size-4" aria-hidden />
                {t("dashboard.admin.allMarked")}
              </p>
            ) : null}
          </CardContent>
        </Card>


        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("support.needsAttention")}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/support">{t("support.viewStudents")}</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-2xl font-bold tabular-nums">{t("support.studentsNeeding", { count: support.students })}</p>
            {support.bySubject.length ? (
              <ul className="flex flex-wrap gap-2 text-sm">
                {support.bySubject.slice(0, 3).map((row) => (
                  <li key={row.subject ?? "general"} className="bg-primary-soft text-primary-strong rounded-full px-3 py-1 font-medium">
                    {row.subject ?? t("support.general")} · {row.count}
                  </li>
                ))}
                {support.bySubject.length > 3 ? (
                  <li className="bg-muted text-muted-foreground rounded-full px-3 py-1 font-medium">
                    {t("support.other")} · {support.bySubject.slice(3).reduce((sum, row) => sum + row.count, 0)}
                  </li>
                ) : null}
              </ul>
            ) : null}
            {support.concernsToReview ? (
              <div className="bg-info-soft text-info-strong flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium">
                {t("support.concernsToReview", { count: support.concernsToReview })}
                <Button asChild size="sm" variant="outline">
                  <Link href="/school-admin/concerns">{t("support.reviewConcerns")}</Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.admin.needsAttention")}</CardTitle>
            <CardDescription>{t("dashboard.admin.needsAttentionHint", { percent })}</CardDescription>
          </CardHeader>
          <CardContent>
            {attention.length ? (
              <ul className="divide-y">
                {attention.map((student) => (
                  <li key={student.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/school-admin/students/${student.id}`} className="font-medium hover:underline">
                        {student.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {student.section ?? "—"}
                        {student.rollNumber ? ` · ${student.rollNumber}` : ""}
                      </p>
                    </div>
                    <span className="text-danger-strong text-sm font-semibold tabular-nums">{Math.round((student.share ?? 0) * 100)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <CheckIcon className="text-success size-4 shrink-0" aria-hidden />
                {t("dashboard.admin.nobodyBelow", { percent })}
              </p>
            )}
          </CardContent>
        </Card>

      </div>

      <h2 className="mb-3 text-base font-semibold">{t("dashboard.insights")}</h2>

      <Suspense key={`${financeRange.key}:${financeRange.from.getTime()}:${financeRange.to.getTime()}`} fallback={<FinanceOverviewSkeleton />}>
        <FinanceOverviewSection ctx={ctx} range={financeRange} action="/school-admin/dashboard" />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---------------- attendance over the month ---------------- */}
        <Card>
          <CardContent>
            <ChartFigure
              title="Attendance, last 30 days"
              subtitle="Present and late, over every student marked that day. Days with no register are left out."
              table={{
                head: ["Day", "Attended", "Present", "Late", "Excused", "Absent"],
                rows: trend
                  .filter((point) => point.counts.total > 0)
                  .slice(-14)
                  .reverse()
                  .map((point) => [
                    point.label,
                    point.share === null ? "—" : `${Math.round(point.share * 100)}%`,
                    point.counts.PRESENT,
                    point.counts.LATE,
                    point.counts.EXCUSED,
                    point.counts.ABSENT,
                  ]),
              }}
            >
              <TrendArea
                data={trend.map((point) => ({
                  key: point.key,
                  label: point.label,
                  value: point.share === null ? null : Math.round(point.share * 100),
                  detail:
                    point.counts.total > 0
                      ? `${point.counts.PRESENT + point.counts.LATE} of ${point.counts.total} students`
                      : undefined,
                }))}
                emptyMessage="Mark a few registers and the trend will appear here."
              />
            </ChartFigure>
          </CardContent>
        </Card>

        {/* ---------------- today's register ---------------- */}
        <Card>
          <CardContent>
            <ChartFigure
              title={`Today's register · ${overview ? formatDayShort(overview.date, intl) : ""}`}
              subtitle={
                overview && overview.counts.total
                  ? `${overview.counts.total} students marked across ${overview.sectionsMarked} of ${overview.sections} sections.`
                  : closedToday
                    ? `${closedToday.label}. No register is expected today.`
                    : "Nothing marked yet today."
              }
              legend={overview ? attendanceLegend(overview.counts) : []}
              table={
                overview
                  ? {
                      head: ["Status", "Students"],
                      rows: attendanceSegments(overview.counts).map((segment) => [segment.label, segment.value]),
                    }
                  : undefined
              }
            >
              {overview ? <StackedBar segments={attendanceSegments(overview.counts)} /> : <ChartEmpty>No academic session yet.</ChartEmpty>}
            </ChartFigure>

            {overview && overview.sections > 0 ? (
              <div className="mt-6 flex flex-col gap-4">
                <Meter
                  label="Registers marked today"
                  value={overview.sectionsMarked}
                  max={overview.sections}
                  tone={overview.sectionsMarked === overview.sections ? "good" : "warning"}
                />
                {overview.staffMarked > 0 ? (
                  <Meter label="Staff present today" value={overview.staffPresent} max={overview.staffMarked} tone="good" />
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ---------------- class strength ---------------- */}
        <Card>
          <CardContent>
            <ChartFigure
              title="Students per class"
              subtitle={session ? `Active enrolments in ${session.name}.` : undefined}
              table={{ head: ["Class", "Students"], rows: strength.map((row) => [row.label, row.value]) }}
            >
              <BarChart
                data={strength.map((row) => ({ key: row.id, label: row.label, value: row.value }))}
                labelWidth={96}
                emptyMessage="No students placed in this session yet."
              />
            </ChartFigure>
          </CardContent>
        </Card>

        {/* ---------------- admissions funnel ---------------- */}
        <Card>
          <CardContent>
            <ChartFigure
              title="Admissions this session"
              subtitle={funnel ? `${funnel.received} received · ${funnel.waiting} awaiting a decision · ${funnel.rejected} rejected` : undefined}
              table={funnel ? { head: ["Stage", "Applications"], rows: funnel.stages.map((stage) => [stage.label, stage.value]) } : undefined}
            >
              <BarChart
                data={(funnel?.received ? funnel.stages : []).map((stage, index) => ({
                  key: stage.key,
                  label: stage.label,
                  value: stage.value,
                  // Ordered stages, so an ordinal ramp rather than category colours.
                  color: ORDINAL_RAMP[index],
                }))}
                labelWidth={86}
                width={380}
                emptyMessage="No applications yet this session."
              />
            </ChartFigure>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
