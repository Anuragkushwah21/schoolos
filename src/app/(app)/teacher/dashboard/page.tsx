import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BookOpenCheckIcon,
  BookOpenIcon,
  CheckIcon,
  ClipboardCheckIcon,
  ClipboardPlusIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  NotebookPenIcon,
  PlayIcon,
  StarIcon,
  UsersIcon,
} from "lucide-react";

import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { AlertList } from "@/features/parent/today";
import { getTeacherAlerts } from "@/server/alerts/feeds";
import { formatSchoolTime, DAY_LABEL, addDays, dayOfWeek, formatDate, formatDayShort, formatMinutes, toDateInput, today } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { greetingKey } from "@/lib/greeting";
import { param } from "@/lib/search-params";
import { schoolNow } from "@/lib/time-status";
import { cn } from "@/lib/utils";
import { getIntlLocale, getT } from "@/server/i18n";
import { requireTenant } from "@/server/auth/current-user";
import { findTeacherSelf } from "@/server/auth/teacher-access";
import { getCurrentSession } from "@/server/academics/structure";
import { attendanceTrend, studentsNeedingAttention } from "@/server/analytics/school";
import { getMyDayPlan } from "@/server/classwork/activities";
import { myRegistersToday } from "@/server/attendance/cover";
import { homeworkDueForMySections, pendingHomeworkCount } from "@/server/classwork/homework";
import { schoolClosureOn } from "@/server/calendar/holidays";
import { getMyClasses } from "@/server/people/teacher-self";
import { listConcerns } from "@/server/support/concerns";
import { listSupport } from "@/server/support/service";

export const metadata: Metadata = { title: "Teacher dashboard" };

const LOW_ATTENDANCE = 0.75;
/** How far ahead the "due soon" homework list looks. */
const HOMEWORK_HORIZON_DAYS = 7;

/**
 * A teacher's day, quickest things first: which class they are looking at
 * (a teacher may teach many — "?class=" switches, and only their own
 * classes are offered), one-tap actions for that class (take attendance,
 * create a test, set homework, start the next period), today's registers and
 * periods with Now / Next up, then the class's students needing attention,
 * homework due and attendance trend. "All my classes" shows everything.
 */
export default async function TeacherDashboardPage(props: PageProps<"/teacher/dashboard">) {
  const ctx = await requireTenant("TEACHER");
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const hello = t(greetingKey(), { name: ctx.user.firstName });

  // Asked rather than required: a teacher whose staff record has not been set
  // up is a half-finished setup, and a 404 would be a poor way to say so.
  const self = await findTeacherSelf(ctx);
  if (!self) {
    return (
      <>
        <PageHeader variant="hero" title={hello} />
        <EmptyState title={t("dashboard.teacher.noRecord")}>{t("dashboard.teacher.noRecordHint")}</EmptyState>
      </>
    );
  }

  // Every panel below is scoped to the current session, and `getMyDayPlan`
  // refuses outright without one. An unopened year is a setup state, so it is
  // said plainly rather than thrown.
  if (!(await getCurrentSession(ctx))) {
    return <NoSessionNotice title={hello} />;
  }

  const [plan, classes, pendingHomework, closedToday, supportRows, concerns, registersAll, alerts] = await Promise.all([
    getMyDayPlan(ctx),
    getMyClasses(ctx),
    pendingHomeworkCount(ctx),
    schoolClosureOn(ctx, today()),
    listSupport(ctx),
    listConcerns(ctx),
    myRegistersToday(ctx),
    getTeacherAlerts(ctx),
  ]);

  // The class being looked at: one of the teacher's own, or all of them.
  // An id that is not theirs simply shows everything — it never widens access.
  const classParam = param((await props.searchParams).class);
  const selected = classes.find((cls) => cls.sectionId === classParam) ?? null;
  const scopeIds = selected ? [selected.sectionId] : classes.map((cls) => cls.sectionId);
  const inScope = (sectionId: string) => !selected || sectionId === selected.sectionId;
  const concernCount = concerns.filter((row) => row.waitingOnMe).length;

  // Every one of these is limited to this teacher's own sections — the same
  // list that decides which registers they may open at all. Omitting the ids
  // would quietly widen them to the whole school.
  const [trend, attention, dueSoon] = await Promise.all([
    scopeIds.length ? attendanceTrend(ctx, { academicSessionId: plan.session.id, days: 21, sectionIds: scopeIds }) : Promise.resolve([]),
    scopeIds.length ? studentsNeedingAttention(ctx, { academicSessionId: plan.session.id, sectionIds: scopeIds, threshold: LOW_ATTENDANCE, limit: 5 }) : Promise.resolve([]),
    homeworkDueForMySections(ctx, { from: today(), to: addDays(today(), HOMEWORK_HORIZON_DAYS), take: 5, sectionId: selected?.sectionId }),
  ]);

  const periods = plan.periods.filter((period) => inScope(period.sectionId));
  const registers = closedToday ? [] : registersAll.filter((reg) => inScope(reg.sectionId));
  const covering = periods.filter((period) => period.coveringFor);
  const scopedClasses = selected ? [selected] : classes;
  // No register is owed on a holiday or weekly off; only the class teacher owes one.
  const pendingRegisters = closedToday ? [] : scopedClasses.filter((cls) => cls.isClassTeacher && !cls.attendanceMarkedToday);
  const ownRegisters = scopedClasses.filter((cls) => cls.isClassTeacher);
  const students = scopedClasses.reduce((sum, cls) => sum + cls.students, 0);
  const completed = periods.filter((period) => period.recorded).length;

  // Now / next: from the school's clock, among today's periods still ahead.
  const nowMinute = schoolNow().minutes;
  const current = periods.find((period) => period.startMinute <= nowMinute && nowMinute < period.endMinute && !period.coveredBy) ?? null;
  const next = periods.find((period) => period.startMinute > nowMinute && !period.coveredBy) ?? null;
  const startable = current && !current.status ? current : next && !next.status ? next : null;

  // Quick actions follow the chosen class: the register they owe, a test or homework for it.
  const registerFor = selected?.isClassTeacher ? selected : pendingRegisters[0] ?? ownRegisters[0] ?? null;
  const withClass = (path: string) => (selected ? `${path}?section=${selected.sectionId}` : path) as Route;
  const classHref = (sectionId: string | null) => (sectionId ? `/teacher/dashboard?class=${sectionId}` : "/teacher/dashboard") as Route;

  return (
    <>
      <PageHeader
        variant="hero"
        title={`${hello} 👋`}
        description={`${formatDayShort(plan.date, intl)} · ${plan.session.name}${closedToday ? ` · ${closedToday.label}` : ""}`}
      />

      {/* ---------------- which class: all, or one of theirs ---------------- */}
      {classes.length > 1 ? (
        <nav aria-label={t("dashboard.teacher.myClasses")} className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          <Link
            href={classHref(null)}
            aria-current={!selected ? "page" : undefined}
            className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors", !selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50")}
          >
            {t("dashboard.teacher.allClasses")}
          </Link>
          {classes.map((cls) => {
            const active = selected?.sectionId === cls.sectionId;
            const owes = cls.isClassTeacher && !cls.attendanceMarkedToday && !closedToday;
            return (
              <Link
                key={cls.sectionId}
                href={classHref(cls.sectionId)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50",
                )}
              >
                {cls.isClassTeacher ? <StarIcon className="size-3.5 fill-current" aria-label={t("dashboard.teacher.classTeacher")} /> : null}
                {cls.label}
                {owes ? <span className={cn("size-2 rounded-full", active ? "bg-primary-foreground" : "bg-warning")} aria-label={t("dashboard.teacher.registerPending")} /> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/* ---------------- the chosen class at a glance ---------------- */}
      {selected ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className="bg-primary-soft text-primary-strong flex size-12 shrink-0 items-center justify-center rounded-2xl">
              <UsersIcon className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {selected.label}
                {selected.isClassTeacher ? <StatusBadge status="ACTIVE" tone="info" label={t("dashboard.teacher.classTeacher")} /> : null}
              </span>
              <span className="text-muted-foreground block text-sm">
                {t("dashboard.teacher.inThisClass", { count: selected.students, subjects: selected.subjects.join(", ") || "—" })}
              </span>
            </span>
            {selected.isClassTeacher && !closedToday ? (
              <StatusBadge
                status={selected.attendanceMarkedToday ? "PRESENT" : "PENDING"}
                tone={selected.attendanceMarkedToday ? "positive" : "warning"}
                label={selected.attendanceMarkedToday ? t("dashboard.teacher.registerMarked") : t("dashboard.teacher.registerPending")}
              />
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/teacher/classes/${selected.sectionId}` as Route}>{t("dashboard.teacher.openClass")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- one tap for the usual jobs ---------------- */}
      <QuickActions
        title={selected ? t("dashboard.teacher.showingClass", { name: selected.label }) : t("dashboard.quickActions")}
        actions={[
          {
            href: (registerFor ? `/teacher/attendance?section=${registerFor.sectionId}&date=${toDateInput(plan.date)}` : "/teacher/attendance") as Route,
            label: t("dashboard.teacher.takeAttendance"),
            icon: ClipboardCheckIcon,
            tone: "green",
          },
          { href: withClass("/teacher/exams/new"), label: t("dashboard.teacher.createTest"), icon: ClipboardPlusIcon, tone: "purple" },
          { href: withClass("/teacher/homework/new"), label: t("dashboard.teacher.addHomework"), icon: NotebookPenIcon, tone: "orange" },
          startable
            ? { href: `/teacher/activities?slot=${startable.slotId}` as Route, label: `${t("dashboard.teacher.startClass")} · ${formatMinutes(startable.startMinute)}`, icon: PlayIcon, tone: "blue" }
            : { href: "/teacher/exams" as Route, label: t("dashboard.teacher.enterMarks"), icon: GraduationCapIcon, tone: "blue" },
          { href: (selected ? `/teacher/classes/${selected.sectionId}` : "/teacher/classes") as Route, label: t("dashboard.teacher.viewStudents"), icon: UsersIcon, tone: "cyan" },
          { href: "/teacher/support/new" as Route, label: t("support.addSupport"), icon: HeartHandshakeIcon, tone: "red" },
        ]}
      />

      {/* ---------------- today's register(s): own class and any the office handed over ---------------- */}
      {registers.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t("dashboard.teacher.todaysAttendance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {registers.map((reg) => (
                <li key={reg.sectionId} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{reg.label}</span>
                    {reg.coveringFor ? (
                      <span className="text-warning-strong block text-xs">
                        {t("dashboard.teacher.attendanceCovering", { name: reg.coveringFor })}
                        {reg.reason ? ` · ${reg.reason}` : ""}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground block text-sm">
                      {reg.phase === "NOT_TAKEN"
                        ? reg.opensAt && reg.opensAt > new Date()
                          ? t("dashboard.teacher.attendanceOpensAt", { time: formatSchoolTime(reg.opensAt) })
                          : ""
                        : reg.phase === "DRAFT"
                          ? reg.finalizeAt
                            ? t("dashboard.teacher.attendanceDraft", { time: formatSchoolTime(reg.finalizeAt) })
                            : t("dashboard.teacher.attendanceDraftManual")
                          : reg.phase === "CORRECTABLE" && reg.deadline
                            ? t("dashboard.teacher.attendanceSubmitted", { time: formatSchoolTime(reg.deadline) })
                            : t("dashboard.teacher.attendanceLocked")}
                    </span>
                  </span>
                  {reg.phase === "LOCKED" ? null : (
                    <Button asChild variant={reg.phase === "CORRECTABLE" ? "outline" : "default"}>
                      <Link href={`/teacher/attendance?section=${reg.sectionId}`}>
                        <ClipboardCheckIcon aria-hidden />
                        {reg.phase === "CORRECTABLE" ? t("dashboard.teacher.attendanceCorrect") : t("dashboard.teacher.attendanceTake")}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- cover the office has asked for ---------------- */}
      {covering.length ? (
        <Card className="border-warning/40 mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t("dashboard.teacher.substituteClasses")}</CardTitle>
            <CardDescription>{t("dashboard.teacher.substituteHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {covering.map((period) => (
                <li key={period.slotId} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
                  <span className="text-primary-strong w-28 shrink-0 text-sm font-semibold tabular-nums">
                    {formatMinutes(period.startMinute)}–{formatMinutes(period.endMinute)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {period.section} · {period.subject}
                    </span>
                    <span className="text-muted-foreground block text-sm">{t("dashboard.teacher.coveringFor", { name: period.coveringFor ?? "" })}</span>
                  </span>
                  {period.status ? (
                    <StatusBadge status={period.status} />
                  ) : (
                    <Button asChild>
                      <Link href={`/teacher/activities?slot=${period.slotId}`}>
                        <BookOpenCheckIcon aria-hidden />
                        {t("dashboard.teacher.startClass")}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- today's classes, as a timeline ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">{t("dashboard.teacher.todaysClasses")}</CardTitle>
          <CardDescription>
            {periods.length ? t("dashboard.teacher.writtenUp", { done: completed, total: periods.length }) : t("dashboard.teacher.noClasses")}
            {periods.length && !current && !next ? ` · ${t("dashboard.teacher.noMorePeriods")}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {periods.length ? (
            <ol className="flex flex-col gap-2">
              {periods.map((period) => {
                const own = classes.find((cls) => cls.sectionId === period.sectionId);
                const takesRegister = own?.isClassTeacher ?? false;
                const marked = own?.attendanceMarkedToday ?? false;
                const isNow = current?.slotId === period.slotId;
                const isNext = !isNow && next?.slotId === period.slotId;
                const past = period.endMinute <= nowMinute;
                return (
                  <li
                    key={period.slotId}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
                      isNow && "border-primary bg-primary-soft/40",
                      isNext && "border-primary/50",
                      past && !isNow && "opacity-80",
                    )}
                  >
                    <span className="flex w-28 shrink-0 flex-col">
                      <span className="text-primary-strong text-sm font-semibold tabular-nums">
                        {formatMinutes(period.startMinute)}–{formatMinutes(period.endMinute)}
                      </span>
                      {isNow ? <span className="text-primary-strong text-xs font-bold uppercase">{t("dashboard.teacher.nowTeaching")}</span> : null}
                      {isNext ? <span className="text-muted-foreground text-xs font-semibold uppercase">{t("dashboard.teacher.nextUp")}</span> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{period.subject}</span>
                      <span className="text-muted-foreground block text-sm">
                        {selected ? null : (
                          <Link href={classHref(period.sectionId)} className="hover:underline">
                            {period.section}
                          </Link>
                        )}
                        {period.room ? `${selected ? "" : " · "}${period.room}` : ""}
                        {period.topic ? ` · ${period.topic}` : ""}
                        {period.coveringFor ? ` · ${t("dashboard.teacher.coveringFor", { name: period.coveringFor })}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {closedToday || !takesRegister ? null : marked ? (
                        <StatusBadge status="PRESENT" label={t("dashboard.admin.marked")} />
                      ) : (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/teacher/attendance?section=${period.sectionId}&date=${toDateInput(plan.date)}`}>
                            <ClipboardCheckIcon aria-hidden />
                            {t("dashboard.teacher.takeAttendance")}
                          </Link>
                        </Button>
                      )}
                      {period.coveredBy ? (
                        // Someone else is taking this one; the record is theirs.
                        <StatusBadge status="SUBSTITUTE" tone="info" label={t("dashboard.teacher.coveredBy", { name: period.coveredBy })} />
                      ) : period.status ? (
                        <StatusBadge status={period.status} />
                      ) : (
                        <Button asChild size="sm" variant={isNow || isNext ? "default" : "outline"}>
                          <Link href={`/teacher/activities?slot=${period.slotId}`}>
                            <BookOpenCheckIcon aria-hidden />
                            {t("dashboard.teacher.startClass")}
                          </Link>
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">{t("dashboard.teacher.noClasses")}</p>
          )}
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          tone="blue"
          icon={BookOpenIcon}
          label={t("dashboard.teacher.myClasses")}
          value={classes.length}
          hint={classes.some((cls) => cls.isClassTeacher) ? `class teacher of ${classes.filter((cls) => cls.isClassTeacher).length}` : undefined}
          href="/teacher/classes"
        />
        <StatCard tone="blue" icon={GraduationCapIcon} label={t("dashboard.teacher.students")} value={students} hint={selected ? selected.label : undefined} href={(selected ? `/teacher/classes/${selected.sectionId}` : "/teacher/classes") as Route} />
        <StatCard tone="green" icon={CheckIcon} label={t("dashboard.teacher.completed")} value={`${completed}/${periods.length}`} hint={DAY_LABEL[dayOfWeek(plan.date)]} href="/teacher/activities" />
        <StatCard
          tone="green"
          icon={ClipboardCheckIcon}
          label={t("dashboard.teacher.registers")}
          value={closedToday ? "—" : ownRegisters.length ? `${ownRegisters.length - pendingRegisters.length}/${ownRegisters.length}` : "—"}
          hint={closedToday ? closedToday.label : ownRegisters.length ? formatDayShort(plan.date, intl) : t("dashboard.teacher.registerNotYours")}
          href="/teacher/attendance"
        />
        <StatCard tone="purple" icon={NotebookPenIcon} label={t("dashboard.teacher.pendingHomework")} value={pendingHomework} hint={t("dashboard.teacher.notYetDue")} href="/teacher/homework" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title={selected ? `Attendance in ${selected.label}` : "Attendance in your classes"}
                subtitle="Present and late, over the last three weeks."
                table={{
                  head: ["Day", "Attended", "Present", "Late", "Excused", "Absent"],
                  rows: trend
                    .filter((point) => point.counts.total > 0)
                    .slice(-10)
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
                    detail: point.counts.total > 0 ? `${point.counts.PRESENT + point.counts.LATE} of ${point.counts.total} students` : undefined,
                  }))}
                  emptyMessage="Mark a few registers and your trend appears here."
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t("support.needsAttention")}</CardTitle>
                <CardDescription>{t("support.studentsNeeding", { count: new Set(supportRows.map((row) => row.studentId)).size })}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/teacher/support">{t("common.viewAll")}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/teacher/support/new">+ {t("support.addSupport")}</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {concernCount ? (
                <Link href="/teacher/concerns" className="bg-info-soft text-info-strong rounded-xl px-3 py-2 text-sm font-medium hover:underline">
                  {t("support.concernsToReview", { count: concernCount })} →
                </Link>
              ) : null}
              {supportRows.length ? (
                <ul className="divide-y text-sm">
                  {supportRows.slice(0, 5).map((row) => (
                    <li key={row.id}>
                      <Link href={`/teacher/support/${row.id}` as Route} className="hover:bg-muted flex flex-wrap items-center gap-2 rounded-lg px-1 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{row.student}</span>
                          <span className="text-muted-foreground block text-xs">
                            {row.subject ?? t("support.general")} · {t(`support.reason.${row.reason}`)}
                          </span>
                        </span>
                        <StatusBadge status={row.priority} />
                        <StatusBadge status={row.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t("support.none")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Low attendance</CardTitle>
              <CardDescription>
                {selected ? `Students in ${selected.label}` : "Students in your classes"} below {LOW_ATTENDANCE * 100}% this session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attention.length ? (
                <ul className="divide-y">
                  {attention.map((student) => (
                    <li key={student.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium">{student.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {student.section ?? "Not placed"}
                          {student.rollNumber ? ` · roll ${student.rollNumber}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums" style={{ color: "var(--viz-critical)" }}>
                        {Math.round((student.share ?? 0) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <CheckIcon className="size-4 shrink-0" style={{ color: "var(--viz-good)" }} aria-hidden />
                  Nobody is below {LOW_ATTENDANCE * 100}%.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t("dashboard.teacher.homeworkDue")}</CardTitle>
                <CardDescription>
                  {selected ? selected.label : "Across your classes"}, next {HOMEWORK_HORIZON_DAYS} days.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/teacher/homework">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {dueSoon.length ? (
                <ul className="divide-y">
                  {dueSoon.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {item.section} · {item.subject}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatDate(item.dueOn, intl)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t("dashboard.teacher.nothingDue")}</p>
              )}
            </CardContent>
          </Card>

          {!selected ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Your classes</CardTitle>
                  <CardDescription>
                    {closedToday ? `${closedToday.label} — no register today.` : pendingRegisters.length ? `${pluralize(pendingRegisters.length, "register")} still to mark today.` : "Every register you owe is marked today."}
                  </CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/teacher/classes">All</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {classes.length ? (
                  <ul className="divide-y">
                    {classes.map((cls) => (
                      <li key={cls.sectionId}>
                        <Link href={classHref(cls.sectionId)} className="hover:bg-muted -mx-1 flex items-center justify-between gap-3 rounded-lg px-1 py-2.5">
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              {cls.isClassTeacher ? <StarIcon className="text-warning-strong size-3.5 fill-current" aria-hidden /> : null}
                              {cls.label}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {pluralize(cls.students, "student")}
                              {cls.subjects.length ? ` · ${cls.subjects.join(", ")}` : ""}
                            </span>
                          </span>
                          {!cls.isClassTeacher || closedToday ? null : cls.attendanceMarkedToday ? (
                            <span className="inline-flex items-center gap-1 text-sm" style={{ color: "var(--viz-good)" }}>
                              <CheckIcon className="size-4" aria-hidden />
                              {t("dashboard.admin.marked")}
                            </span>
                          ) : (
                            <StatusBadge status="PENDING" tone="warning" label={t("dashboard.teacher.registerPending")} />
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No classes assigned yet">Ask the school office to assign your subjects.</EmptyState>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <SchoolLifeCards ctx={ctx} base="/teacher" />

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.forYou")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertList alerts={alerts} emptyText={t("dashboard.nothingNew")} />
        </CardContent>
      </Card>
    </>
  );
}
