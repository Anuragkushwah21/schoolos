import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { Meter } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { TrendArea } from "@/components/charts/trend-area";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeList } from "@/features/communication/feed";
import { DAY_LABEL, formatDayShort, formatMinutes, toDateInput } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { attendanceTrend, studentsNeedingAttention } from "@/server/analytics/school";
import { noticesFor } from "@/server/communication/notices";
import { getTeacherDay } from "@/server/people/portal";

export const metadata: Metadata = { title: "Teacher dashboard" };

const LOW_ATTENDANCE = 0.75;

export default async function TeacherDashboardPage() {
  const ctx = await requireTenant("TEACHER");
  const [day, notices] = await Promise.all([getTeacherDay(ctx), noticesFor(ctx, { take: 4 })]);

  if (!day) {
    return (
      <>
        <PageHeader title={`Welcome, ${ctx.user.firstName}`} />
        <EmptyState title="Your staff record is not set up yet">
          Ask the school office to finish your profile and assign your classes.
        </EmptyState>
      </>
    );
  }

  const sectionIds = day.sections.map((section) => section.id);

  // Both of these are limited to this teacher's own sections — the same list
  // that decides which registers they may open at all.
  const [trend, attention] = await Promise.all([
    sectionIds.length
      ? attendanceTrend(ctx, { academicSessionId: day.session.id, days: 21, sectionIds })
      : Promise.resolve([]),
    sectionIds.length
      ? studentsNeedingAttention(ctx, {
          academicSessionId: day.session.id,
          sectionIds,
          threshold: LOW_ATTENDANCE,
          limit: 5,
        })
      : Promise.resolve([]),
  ]);

  const pending = day.sections.filter((section) => !section.markedToday);
  const students = day.sections.reduce((sum, section) => sum + section.students, 0);

  return (
    <>
      <PageHeader
        title={`Welcome, ${ctx.user.firstName}`}
        description={`${formatDayShort(day.date)} · ${day.session.name}`}
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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Your classes"
          value={day.sections.length}
          hint={day.classTeacherOf.length ? `class teacher of ${day.classTeacherOf.length}` : undefined}
        />
        <StatCard label="Students" value={students} />
        <StatCard label="Periods today" value={day.periods.length} hint={DAY_LABEL[day.day]} />
        <StatCard
          label="Registers marked"
          value={`${day.sections.length - pending.length}/${day.sections.length}`}
          hint={formatDayShort(day.date)}
          href="/teacher/attendance"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s periods</CardTitle>
              <CardDescription>{DAY_LABEL[day.day]}</CardDescription>
            </CardHeader>
            <CardContent>
              {day.periods.length ? (
                <ul className="divide-y">
                  {day.periods.map((period) => (
                    <li key={period.id} className="flex items-center gap-4 py-3">
                      <span className="text-muted-foreground w-20 shrink-0 text-sm tabular-nums">
                        {formatMinutes(period.startMinute)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{period.subject.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {period.section.class.name} – {period.section.name}
                          {period.room ? ` · ${period.room}` : ""}
                        </span>
                      </span>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/teacher/attendance?section=${period.section.id}`}>Register</Link>
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
            <CardHeader>
              <CardTitle>Your classes</CardTitle>
              <CardDescription>
                {pending.length
                  ? `${pluralize(pending.length, "register")} still to mark today.`
                  : "Every register is marked today."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {day.sections.length ? (
                <>
                  <Meter
                    label="Marked today"
                    value={day.sections.length - pending.length}
                    max={day.sections.length}
                    tone={pending.length ? "warning" : "good"}
                  />
                  <ul className="divide-y">
                    {day.sections.map((section) => (
                      <li key={section.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div>
                          <p className="font-medium">{section.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {pluralize(section.students, "student")}
                            {day.classTeacherOf.some((s) => s.id === section.id) ? " · class teacher" : ""}
                          </p>
                        </div>
                        {section.markedToday ? (
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
                              href={`/teacher/attendance?section=${section.id}&date=${toDateInput(day.date)}`}
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
                  <CheckIcon className="size-4 shrink-0" style={{ color: "var(--viz-good)" }} aria-hidden />
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
