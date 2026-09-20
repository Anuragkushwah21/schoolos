import type { Metadata } from "next";
import Link from "next/link";

import { ColumnChart, Meter } from "@/components/charts/bars";
import { ChartFigure } from "@/components/charts/chart-figure";
import { attendanceLegend, attendanceSegments } from "@/components/charts/attendance-colors";
import { StackedBar } from "@/components/charts/bars";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventList, NoticeList } from "@/features/communication/feed";
import { DAY_LABEL, dayOfWeek, formatDayShort, formatMinutes, today } from "@/lib/dates";
import { formatPercent } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { studentHistory } from "@/server/attendance/service";
import { monthlyAttendance } from "@/server/analytics/student";
import { upcomingEvents } from "@/server/communication/events";
import { noticesFor } from "@/server/communication/notices";
import { getSectionWeek, getStudentPlacement } from "@/server/people/portal";

export const metadata: Metadata = { title: "Student dashboard" };

export default async function StudentDashboardPage() {
  const ctx = await requireTenant("STUDENT");
  const { student, session, enrollment } = await getStudentPlacement(ctx);

  const [notices, events] = await Promise.all([noticesFor(ctx, { take: 4 }), upcomingEvents(ctx, 4)]);

  if (!session || !enrollment) {
    return (
      <>
        <PageHeader title={`Welcome, ${student.firstName}`} />
        <EmptyState title="You are not placed in a class yet">
          Your school will place you in a section for the current session.
        </EmptyState>
      </>
    );
  }

  const date = today();
  const day = dayOfWeek(date);
  const [history, week] = await Promise.all([
    studentHistory(ctx, student.id, session.id),
    getSectionWeek(ctx, enrollment.section.id, session.id),
  ]);

  const todaysPeriods = week.filter((slot) => slot.dayOfWeek === day);
  const todayMark = history.rows.find((row) => row.date.toISOString().slice(0, 10) === history.todayKey);
  const months = monthlyAttendance(history.rows);
  const attended = history.counts.PRESENT + history.counts.LATE;

  return (
    <>
      <PageHeader
        title={`Welcome, ${student.firstName}`}
        description={`${enrollment.section.class.name} – ${enrollment.section.name}${
          enrollment.rollNumber ? `, roll ${enrollment.rollNumber}` : ""
        } · ${session.name}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/student/timetable">Timetable</Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Attendance"
          value={history.counts.total ? formatPercent(attended, history.counts.total) : "—"}
          hint={`${history.counts.total} days marked`}
          href="/student/attendance"
        />
        <StatCard label="Days absent" value={history.counts.ABSENT} href="/student/attendance" />
        <StatCard
          label="Today"
          value={todayMark ? <StatusBadge status={todayMark.status} className="text-base" /> : "—"}
          hint={formatDayShort(date)}
        />
        <StatCard
          label="Class teacher"
          value={enrollment.section.classTeacher?.firstName ?? "—"}
          hint={enrollment.section.classTeacher?.lastName ?? undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Today&apos;s classes</CardTitle>
                <CardDescription>{DAY_LABEL[day]}</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/timetable">Full week</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {todaysPeriods.length ? (
                <ul className="divide-y">
                  {todaysPeriods.map((slot) => (
                    <li key={slot.id} className="flex items-center gap-4 py-3">
                      <span className="text-muted-foreground w-20 shrink-0 text-sm tabular-nums">
                        {formatMinutes(slot.startMinute)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">{slot.subject.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {slot.teacher.firstName} {slot.teacher.lastName}
                          {slot.room ? ` · ${slot.room}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No classes scheduled today.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="Your attendance by month"
                subtitle="How many of the days marked each month you were present or late."
                table={{
                  head: ["Month", "Attended", "Present", "Late", "Excused", "Absent"],
                  rows: [...months].reverse().map((month) => [
                    month.fullLabel,
                    month.share === null ? "—" : `${Math.round(month.share * 100)}%`,
                    month.counts.PRESENT,
                    month.counts.LATE,
                    month.counts.EXCUSED,
                    month.counts.ABSENT,
                  ]),
                }}
              >
                <ColumnChart
                  // A single column is a stat tile pretending to be a chart;
                  // the card below already carries this session's number.
                  data={
                    months.length > 1
                      ? months.map((month) => ({
                          key: month.key,
                          label: month.label,
                          value: month.share === null ? 0 : Math.round(month.share * 100),
                          detail: `${month.counts.PRESENT + month.counts.LATE} of ${month.counts.total} days`,
                        }))
                      : []
                  }
                  formatValue={(value) => `${value}%`}
                  emptyMessage={
                    months.length === 1
                      ? "Your month-by-month trend appears once a second month has been marked."
                      : "Nothing marked yet this session."
                  }
                />
              </ChartFigure>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ChartFigure
                title="This session so far"
                subtitle={`${history.counts.total} days marked.`}
                legend={attendanceLegend(history.counts)}
                table={{
                  head: ["Status", "Days"],
                  rows: attendanceSegments(history.counts).map((segment) => [segment.label, segment.value]),
                }}
              >
                <StackedBar
                  segments={attendanceSegments(history.counts)}
                  emptyMessage="Nothing marked yet this session."
                />
              </ChartFigure>

              {history.counts.total ? (
                <div className="mt-6">
                  <Meter
                    label="Days attended"
                    value={attended}
                    max={history.counts.total}
                    tone={attended / history.counts.total >= 0.75 ? "good" : "warning"}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Notices</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/notices">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <NoticeList notices={notices} compact />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming events</CardTitle>
            </CardHeader>
            <CardContent>
              <EventList events={events} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent days</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/attendance">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {history.rows.length ? (
                <ul className="divide-y text-sm">
                  {history.rows.slice(0, 8).map((row) => (
                    <li key={row.date.toISOString()} className="flex items-center justify-between gap-3 py-2">
                      <span>{formatDayShort(row.date)}</span>
                      <StatusBadge status={row.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing marked yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
