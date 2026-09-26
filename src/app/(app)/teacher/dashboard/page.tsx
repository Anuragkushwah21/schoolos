import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { Meter } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeList } from "@/features/communication/feed";
import {
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
import { requireTenant } from "@/server/auth/current-user";
import { findTeacherSelf } from "@/server/auth/teacher-access";
import { getCurrentSession } from "@/server/academics/structure";
import { attendanceTrend, studentsNeedingAttention } from "@/server/analytics/school";
import { getMyDayPlan } from "@/server/classwork/activities";
import { homeworkDueForMySections, pendingHomeworkCount } from "@/server/classwork/homework";
import { noticesFor } from "@/server/communication/notices";
import { getMyClasses } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Teacher dashboard" };

const LOW_ATTENDANCE = 0.75;
/** How far ahead the "due soon" homework list looks. */
const HOMEWORK_HORIZON_DAYS = 7;

function greeting(now = new Date()): string {
  // The school's morning, not the server's.
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function TeacherDashboardPage() {
  const ctx = await requireTenant("TEACHER");

  // Asked rather than required: a teacher whose staff record has not been set
  // up is a half-finished setup, and a 404 would be a poor way to say so.
  const self = await findTeacherSelf(ctx);
  if (!self) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${ctx.user.firstName}`} />
        <EmptyState title="Your staff record is not set up yet">
          Ask the school office to finish your profile and assign your classes.
        </EmptyState>
      </>
    );
  }

  // Every panel below is scoped to the current session, and `getMyDayPlan`
  // refuses outright without one. An unopened year is a setup state, so it is
  // said plainly rather than thrown.
  if (!(await getCurrentSession(ctx))) {
    return <NoSessionNotice title={`${greeting()}, ${ctx.user.firstName}`} />;
  }

  const [plan, classes, notices, pendingHomework] = await Promise.all([
    getMyDayPlan(ctx),
    getMyClasses(ctx),
    noticesFor(ctx, { take: 4 }),
    pendingHomeworkCount(ctx),
  ]);

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

  const pendingRegisters = classes.filter((cls) => !cls.attendanceMarkedToday);
  const students = classes.reduce((sum, cls) => sum + cls.students, 0);
  const completed = plan.periods.filter((period) => period.recorded).length;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${ctx.user.firstName}`}
        description={`${formatDayShort(plan.date)} · ${plan.session.name}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/teacher/timetable">Timetable</Link>
            </Button>
            <Button asChild>
              <Link href="/teacher/attendance">Mark attendance</Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Your classes"
          value={classes.length}
          hint={
            classes.some((cls) => cls.isClassTeacher)
              ? `class teacher of ${classes.filter((cls) => cls.isClassTeacher).length}`
              : undefined
          }
          href="/teacher/classes"
        />
        <StatCard label="Students" value={students} href="/teacher/classes" />
        <StatCard
          label="Classes completed"
          value={`${completed}/${plan.periods.length}`}
          hint={DAY_LABEL[dayOfWeek(plan.date)]}
          href="/teacher/activities"
        />
        <StatCard
          label="Registers marked"
          value={`${classes.length - pendingRegisters.length}/${classes.length}`}
          hint={formatDayShort(plan.date)}
          href="/teacher/attendance"
        />
        <StatCard
          label="Homework pending"
          value={pendingHomework}
          hint="not yet due"
          href="/teacher/homework"
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/teacher/attendance">Mark attendance</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/teacher/activities">Add class activity</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/teacher/homework/new">Add homework</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/teacher/classes">View students</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s classes</CardTitle>
              <CardDescription>
                {plan.periods.length
                  ? `${completed} of ${pluralize(plan.periods.length, "period")} written up.`
                  : "Nothing scheduled today."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {plan.periods.length ? (
                <ul className="divide-y">
                  {plan.periods.map((period) => (
                    <li
                      key={period.slotId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                    >
                      <span className="text-muted-foreground w-32 shrink-0 text-sm tabular-nums">
                        {formatMinutes(period.startMinute)}–{formatMinutes(period.endMinute)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{period.subject}</span>
                        <span className="text-muted-foreground block text-xs">
                          {period.section}
                          {period.room ? ` · ${period.room}` : ""}
                          {period.topic ? ` · ${period.topic}` : ""}
                        </span>
                      </span>
                      {period.status ? (
                        <StatusBadge status={period.status} />
                      ) : (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/teacher/activities?slot=${period.slotId}`}>Record</Link>
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/teacher/attendance?section=${period.sectionId}`}>Register</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No periods scheduled today.</p>
              )}
            </CardContent>
          </Card>

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
                  {pendingRegisters.length
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
                  <Meter
                    label="Marked today"
                    value={classes.length - pendingRegisters.length}
                    max={classes.length}
                    tone={pendingRegisters.length ? "warning" : "good"}
                  />
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
                        {cls.attendanceMarkedToday ? (
                          <span
                            className="inline-flex items-center gap-1 text-sm"
                            style={{ color: "var(--viz-good)" }}
                          >
                            <CheckIcon className="size-4" aria-hidden />
                            Marked
                          </span>
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
                <CardTitle>Homework due soon</CardTitle>
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
                        {formatDate(item.dueOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nothing due in your classes this week.
                </p>
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

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Notices</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/teacher/notices">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <NoticeList notices={notices} compact />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
