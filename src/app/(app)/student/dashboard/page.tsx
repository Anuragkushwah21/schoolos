import { SunIcon, ClipboardCheckIcon, NotebookPenIcon, TrophyIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeList } from "@/features/communication/feed";
import { AlertList } from "@/features/parent/today";
import { StudentTabs } from "@/features/student/nav";
import { getStudentAlerts } from "@/server/alerts/feeds";
import { formatDate, formatMinutes } from "@/lib/dates";
import { humanize, pluralize } from "@/lib/format";
import { greetingKey } from "@/lib/greeting";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { noticesFor } from "@/server/communication/notices";
import { findStudentSelf } from "@/server/student/access";
import { mySupport } from "@/server/support/service";
import {
  getMyAttendance,
  getMyDay,
  getMyHomework,
  getMyResults,
  getMyUpcomingLessons,
} from "@/server/student/me";

export const metadata: Metadata = { title: "Today" };

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
  const t = await getT();
  const me = await findStudentSelf(ctx);

  if (!me.placement) {
    return (
      <>
        <PageHeader title={`${t(greetingKey(), { name: me.student.firstName })} 👋`} />
        <EmptyState title={t("dashboard.student.notPlaced")}>
          Your school will put you in a section for the current session. Your timetable, classes and
          homework appear here once they do.
        </EmptyState>
      </>
    );
  }

  const [day, homework, results, attendance, upcoming, notices, support] = await Promise.all([
    getMyDay(ctx),
    getMyHomework(ctx),
    getMyResults(ctx),
    getMyAttendance(ctx),
    getMyUpcomingLessons(ctx, { days: 7 }),
    noticesFor(ctx, { take: 4 }),
    mySupport(ctx),
  ]);

  const outstanding = homework.overdue.length + homework.dueToday.length + homework.dueSoon.length;
  const latest = results.past.find((entry) => entry.sat) ?? null;

  return (
    <>
      <PageHeader
        title={`${t(greetingKey(), { name: me.student.firstName })} 👋`}
        description={`${me.placement.sectionLabel}${me.placement.rollNumber ? `, roll ${me.placement.rollNumber}` : ""} · ${me.placement.sessionName}`}
      />
      <StudentTabs active="dashboard" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={SunIcon}
          label={t("dashboard.student.today")}
          value={
            day.attendance
              ? humanize(day.attendance.status)
              : day.closure
                ? day.closure.kind === "HOLIDAY"
                  ? "Holiday"
                  : "Weekly off"
                : "Not marked"
          }
          hint={
            day.closure && !day.attendance
              ? day.closure.label
              : `${day.tally.scheduled} ${day.tally.scheduled === 1 ? "class" : "classes"}`
          }
        />
        <StatCard tone="green" icon={ClipboardCheckIcon}
          label={t("dashboard.student.attendance")}
          value={attendance.share === null ? "—" : `${Math.round(attendance.share * 100)}%`}
          hint={`${attendance.counts.total} days marked`}
          href="/student/attendance"
        />
        <StatCard tone="purple" icon={NotebookPenIcon}
          label={t("dashboard.student.homework")}
          value={outstanding}
          hint={homework.overdue.length ? `${homework.overdue.length} overdue` : "nothing overdue"}
          href="/student/homework"
        />
        <StatCard tone="orange" icon={TrophyIcon}
          label={t("dashboard.student.latestTest")}
          value={latest ? `${latest.marksObtained}/${latest.maxMarks}` : "—"}
          hint={latest ? latest.subject : "no marks yet"}
          href="/student/results"
        />
      </div>

      {support.length ? (
        // Help, not a label: what the teacher added and what the student can do.
        <Card className="border-success/30 mb-6">
          <CardHeader>
            <CardTitle>{t("support.extraSupport")}</CardTitle>
            <CardDescription>{t("support.studentIntro")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-4">
              {support.map((row) => (
                <li key={row.id} className="bg-success-soft rounded-xl p-3 text-sm">
                  <p className="text-success-strong font-semibold">
                    {row.subject ?? t("support.general")}
                    {row.topic ? ` — ${row.topic}` : ""}
                  </p>
                  <p className="mt-1">
                    <span className="text-muted-foreground">{t("support.whatToDo")}: </span>
                    {t(`support.todo.${row.action}`)}
                  </p>
                  {row.actionNote ? <p className="mt-1">{row.actionNote}</p> : null}
                  {row.extraClass && row.extraClass.status !== "CANCELLED" ? (
                    <p className="text-info-strong mt-1 font-medium">
                      {t("support.extraClassOn", { date: formatDate(row.extraClass.date), time: formatMinutes(row.extraClass.startMinute) })}
                    </p>
                  ) : null}
                  {row.teacher ? <p className="text-muted-foreground mt-1 text-xs">{row.teacher}</p> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("dashboard.forYou")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertList alerts={await getStudentAlerts(ctx)} emptyText={t("dashboard.nothingNew")} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.student.todaysClasses")}</CardTitle>
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
                <CardTitle>{t("dashboard.student.homework")}</CardTitle>
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
                <CardTitle>{t("dashboard.student.comingUp")}</CardTitle>
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
                <CardTitle>{t("dashboard.student.myProgress")}</CardTitle>
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
              <CardTitle>{t("dashboard.notices")}</CardTitle>
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
