import type { Metadata, Route } from "next";
import Link from "next/link";
import { BookOpenCheckIcon, CheckIcon, ClipboardCheckIcon, GraduationCapIcon, NotebookPenIcon, UserRoundCheckIcon, UsersIcon, BookOpenIcon } from "lucide-react";

import { Meter } from "@/components/charts/bars";
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
import {
  formatSchoolTime,
  DAY_LABEL,
  addDays,
  dayOfWeek,
  formatDate,
  formatDayShort,
  formatMinutes,
  toDateInput,
  today,
} from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { greetingKey } from "@/lib/greeting";
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

export default async function TeacherDashboardPage() {
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

  const [plan, classes, pendingHomework, closedToday, supportRows, concerns] = await Promise.all([
    getMyDayPlan(ctx),
    getMyClasses(ctx),
    pendingHomeworkCount(ctx),
    schoolClosureOn(ctx, today()),
    listSupport(ctx),
    listConcerns(ctx),
  ]);
  const concernCount = concerns.filter((row) => row.waitingOnMe).length;

  const sectionIds = classes.map((cls) => cls.sectionId);

  // Every one of these is limited to this teacher's own sections — the same
  // list that decides which registers they may open at all. Omitting the ids
  // would quietly widen them to the whole school.
  const [trend, attention, dueSoon] = await Promise.all([
    sectionIds.length
      ? attendanceTrend(ctx, { academicSessionId: plan.session.id, days: 21, sectionIds })
      : Promise.resolve([]),
    sectionIds.length
      ? studentsNeedingAttention(ctx, {
          academicSessionId: plan.session.id,
          sectionIds,
          threshold: LOW_ATTENDANCE,
          limit: 5,
        })
      : Promise.resolve([]),
    homeworkDueForMySections(ctx, {
      from: today(),
      to: addDays(today(), HOMEWORK_HORIZON_DAYS),
      take: 5,
    }),
  ]);

  // No register is owed on a holiday or weekly off.
  // Only the class teacher owes a section's daily register.
  const pendingRegisters = closedToday ? [] : classes.filter((cls) => cls.isClassTeacher && !cls.attendanceMarkedToday);
  const students = classes.reduce((sum, cls) => sum + cls.students, 0);
  const completed = plan.periods.filter((period) => period.recorded).length;
  const covering = plan.periods.filter((period) => period.coveringFor);
  const registers = await myRegistersToday(ctx);

  return (
    <>
      <PageHeader variant="hero" title={`${hello} 👋`} description={`${formatDayShort(plan.date, intl)} · ${plan.session.name}`} />

      {/* ---------------- today's register(s): own class and any the office handed over ---------------- */}
      {registers.length && !closedToday ? (
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

      {/* ---------------- the day's teaching, first ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">{t("dashboard.teacher.todaysClasses")}</CardTitle>
          <CardDescription>
            {plan.periods.length ? t("dashboard.teacher.writtenUp", { done: completed, total: plan.periods.length }) : t("dashboard.teacher.noClasses")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plan.periods.length ? (
            <ul className="flex flex-col gap-3">
              {plan.periods.map((period) => {
                const own = classes.find((cls) => cls.sectionId === period.sectionId);
                const marked = own?.attendanceMarkedToday ?? false;
                const takesRegister = own?.isClassTeacher ?? false;
                return (
                  <li key={period.slotId} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
                    <span className="text-primary-strong w-28 shrink-0 text-sm font-semibold tabular-nums">{formatMinutes(period.startMinute)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{period.subject}</span>
                      <span className="text-muted-foreground block text-sm">
                        {period.section}
                        {period.room ? ` · ${period.room}` : ""}
                        {period.topic ? ` · ${period.topic}` : ""}
                        {period.coveringFor ? ` · ${t("dashboard.teacher.coveringFor", { name: period.coveringFor })}` : ""}
                        {period.coveredBy ? ` · covered by ${period.coveredBy}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {closedToday || !takesRegister ? null : marked ? (
                        <StatusBadge status="PRESENT" label={t("dashboard.admin.marked")} />
                      ) : (
                        <Button asChild variant="outline">
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
                        <Button asChild>
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
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("dashboard.teacher.noClasses")}</p>
          )}
        </CardContent>
      </Card>

      <QuickActions
        title={t("dashboard.quickActions")}
        actions={[
          { href: "/teacher/attendance", label: t("dashboard.teacher.takeAttendance"), icon: ClipboardCheckIcon },
          { href: "/teacher/homework/new", label: t("dashboard.teacher.addHomework"), icon: NotebookPenIcon },
          { href: "/teacher/exams", label: t("dashboard.teacher.enterMarks"), icon: GraduationCapIcon },
          { href: "/teacher/classes", label: t("dashboard.teacher.viewStudents"), icon: UsersIcon },
          { href: "/teacher/profile", label: t("dashboard.teacher.myAttendance"), icon: UserRoundCheckIcon },
        ]}
      />

      <Card className="mb-6">
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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard tone="blue" icon={BookOpenIcon}
          label={t("dashboard.teacher.myClasses")}
          value={classes.length}
          hint={
            classes.some((cls) => cls.isClassTeacher)
              ? `class teacher of ${classes.filter((cls) => cls.isClassTeacher).length}`
              : undefined
          }
          href="/teacher/classes"
        />
        <StatCard tone="blue" icon={GraduationCapIcon} label={t("dashboard.teacher.students")} value={students} href="/teacher/classes" />
        <StatCard tone="green" icon={CheckIcon}
          label={t("dashboard.teacher.completed")}
          value={`${completed}/${plan.periods.length}`}
          hint={DAY_LABEL[dayOfWeek(plan.date)]}
          href="/teacher/activities"
        />
        <StatCard tone="green" icon={ClipboardCheckIcon}
          label={t("dashboard.teacher.registers")}
          value={closedToday ? "—" : `${classes.length - pendingRegisters.length}/${classes.length}`}
          hint={closedToday ? closedToday.label : formatDayShort(plan.date, intl)}
          href="/teacher/attendance"
        />
        <StatCard tone="purple" icon={NotebookPenIcon} label={t("dashboard.teacher.pendingHomework")} value={pendingHomework} hint={t("dashboard.teacher.notYetDue")} href="/teacher/homework" />
      </div>

      <SchoolLifeCards ctx={ctx} base="/teacher" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("dashboard.forYou")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertList alerts={await getTeacherAlerts(ctx)} emptyText={t("dashboard.nothingNew")} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <ChartFigure
                title="Attendance in your classes"
                subtitle="Present and late across your own sections, over the last three weeks."
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
                    detail:
                      point.counts.total > 0
                        ? `${point.counts.PRESENT + point.counts.LATE} of ${point.counts.total} students`
                        : undefined,
                  }))}
                  emptyMessage="Mark a few registers and your trend appears here."
                />
              </ChartFigure>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Your classes</CardTitle>
                <CardDescription>
                  {closedToday
                    ? `${closedToday.label} — no register today.`
                    : pendingRegisters.length
                      ? `${pluralize(pendingRegisters.length, "register")} still to mark today.`
                      : "Every register is marked today."}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/teacher/classes">All</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {classes.length ? (
                <>
                  {closedToday ? null : (
                    <Meter
                      label="Marked today"
                      value={classes.length - pendingRegisters.length}
                      max={classes.length}
                      tone={pendingRegisters.length ? "warning" : "good"}
                    />
                  )}
                  <ul className="divide-y">
                    {classes.map((cls) => (
                      <li
                        key={cls.sectionId}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{cls.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {pluralize(cls.students, "student")}
                            {cls.isClassTeacher ? " · class teacher" : ""}
                          </p>
                        </div>
                        {!cls.isClassTeacher ? null : cls.attendanceMarkedToday ? (
                          <span
                            className="inline-flex items-center gap-1 text-sm"
                            style={{ color: "var(--viz-good)" }}
                          >
                            <CheckIcon className="size-4" aria-hidden />
                            Marked
                          </span>
                        ) : closedToday ? (
                          <span className="text-muted-foreground text-sm">Not required</span>
                        ) : (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={`/teacher/attendance?section=${cls.sectionId}&date=${toDateInput(plan.date)}`}
                            >
                              Mark
                            </Link>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState title="No classes assigned yet">
                  Ask the school office to assign your subjects.
                </EmptyState>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t("dashboard.teacher.homeworkDue")}</CardTitle>
                <CardDescription>Across your classes, next {HOMEWORK_HORIZON_DAYS} days.</CardDescription>
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
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {formatDate(item.dueOn, intl)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t("dashboard.teacher.nothingDue")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>
                Students in your classes below {LOW_ATTENDANCE * 100}% this session.
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
                      <span
                        className="text-sm font-medium tabular-nums"
                        style={{ color: "var(--viz-critical)" }}
                      >
                        {Math.round((student.share ?? 0) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <CheckIcon
                    className="size-4 shrink-0"
                    style={{ color: "var(--viz-good)" }}
                    aria-hidden
                  />
                  Nobody in your classes is below {LOW_ATTENDANCE * 100}%.
                </p>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </>
  );
}
