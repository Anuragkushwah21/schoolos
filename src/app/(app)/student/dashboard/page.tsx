import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeList } from "@/features/communication/feed";
import { StudentTabs } from "@/features/student/nav";
import { formatDate, formatMinutes } from "@/lib/dates";
import { humanize, pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { noticesFor } from "@/server/communication/notices";
import { findStudentSelf } from "@/server/student/access";
import {
  getMyAttendance,
  getMyDay,
  getMyHomework,
  getMyResults,
  getMyUpcomingLessons,
} from "@/server/student/me";

export const metadata: Metadata = { title: "Today" };

function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" })
      .format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * A student's own day.
 *
 * Every figure comes from the rows their teachers wrote — the register, each
 * period's write-up, the homework set, the marks entered. Nothing here is
 * hardcoded, and a period a teacher has not written up says exactly that rather
 * than being counted as anything.
 */
export default async function StudentDashboardPage() {
  const ctx = await requireTenant("STUDENT");
  const me = await findStudentSelf(ctx);

  if (!me.placement) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${me.student.firstName}`} />
        <EmptyState title="You are not placed in a class yet">
          Your school will put you in a section for the current session. Your timetable, classes and
          homework appear here once they do.
        </EmptyState>
      </>
    );
  }

  const [day, homework, results, attendance, upcoming, notices] = await Promise.all([
    getMyDay(ctx),
    getMyHomework(ctx),
    getMyResults(ctx),
    getMyAttendance(ctx),
    getMyUpcomingLessons(ctx, { days: 7 }),
    noticesFor(ctx, { take: 4 }),
  ]);

  const outstanding = homework.overdue.length + homework.dueToday.length + homework.dueSoon.length;
  const latest = results.past.find((entry) => entry.sat) ?? null;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.student.firstName}`}
        description={`${me.placement.sectionLabel}${me.placement.rollNumber ? `, roll ${me.placement.rollNumber}` : ""} · ${me.placement.sessionName}`}
      />
      <StudentTabs active="dashboard" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Today"
          value={day.attendance ? humanize(day.attendance.status) : "Not marked"}
          hint={`${day.tally.scheduled} ${day.tally.scheduled === 1 ? "class" : "classes"}`}
        />
        <StatCard
          label="Attendance"
          value={attendance.share === null ? "—" : `${Math.round(attendance.share * 100)}%`}
          hint={`${attendance.counts.total} days marked`}
          href="/student/attendance"
        />
        <StatCard
          label="Homework"
          value={outstanding}
          hint={homework.overdue.length ? `${homework.overdue.length} overdue` : "nothing overdue"}
          href="/student/homework"
        />
        <StatCard
          label="Latest test"
          value={latest ? `${latest.marksObtained}/${latest.maxMarks}` : "—"}
          hint={latest ? latest.subject : "no marks yet"}
          href="/student/results"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s classes</CardTitle>
              <CardDescription>
                {day.tally.scheduled
                  ? `${day.tally.completed + day.tally.substitute} of ${pluralize(day.tally.scheduled, "class")} written up so far.`
                  : "Nothing on the timetable today."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {day.periods.length ? (
                <ul className="divide-y">
                  {day.periods.map((period) => (
                    <li
                      key={period.slotId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                    >
                      <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                        {formatMinutes(period.startMinute)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{period.subject}</span>
                        <span className="text-muted-foreground block text-xs">
                          {period.topic ?? "Topic not recorded yet"} · {period.teacher}
                          {period.room ? ` · ${period.room}` : ""}
                        </span>
                      </span>
                      {period.written ? (
                        <StatusBadge status={period.status!} />
                      ) : period.upcoming ? (
                        <StatusBadge status="SCHEDULED" label="Upcoming" tone="info" />
                      ) : (
                        <StatusBadge status="SCHEDULED" label="Not recorded" />
                      )}
                      {period.lessonId && period.written ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/student/lessons/${period.lessonId}` as Route}>Open</Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No classes on the timetable today.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Homework</CardTitle>
                <CardDescription>
                  {outstanding
                    ? `${pluralize(outstanding, "assignment")} needing attention.`
                    : "Nothing outstanding."}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/homework">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {outstanding ? (
                <ul className="divide-y">
                  {[...homework.overdue, ...homework.dueToday, ...homework.dueSoon]
                    .slice(0, 5)
                    .map((work) => (
                      <li key={work.id} className="flex items-baseline justify-between gap-3 py-2.5">
                        <span className="min-w-0 text-sm">
                          <span className="font-medium">{work.subject}</span> — {work.title}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          due {formatDate(work.dueOn)}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing due in the next few days.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Coming up</CardTitle>
                <CardDescription>Lessons your teachers have planned.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/upcoming">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {upcoming.lessons.length ? (
                <ul className="divide-y">
                  {upcoming.lessons.slice(0, 4).map((lesson) => (
                    <li key={lesson.id} className="flex flex-col gap-0.5 py-2.5">
                      <span className="text-sm font-medium">
                        {lesson.subject}
                        {lesson.plannedTopic ? ` — ${lesson.plannedTopic}` : ""}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDate(lesson.date)} · {formatMinutes(lesson.startMinute)}
                      </span>
                      {lesson.preparation ? (
                        <span className="text-xs">Prepare: {lesson.preparation}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nothing planned yet. Your teachers add upcoming lessons here when they set them.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>My progress</CardTitle>
                <CardDescription>Averages from marks your teachers entered.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/results">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {results.progress.length ? (
                <ul className="divide-y">
                  {results.progress.map((subject) => (
                    <li
                      key={subject.subjectId}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0 text-sm font-medium">{subject.subject}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {subject.average === null ? "—" : `${Math.round(subject.average * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No marks yet. Subject averages appear once you have sat a test.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Notices</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/student/notices">All</Link>
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
