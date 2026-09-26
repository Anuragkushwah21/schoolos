import type { Route } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMinutes } from "@/lib/dates";
import { humanize } from "@/lib/format";
import type { FocusItem } from "@/server/parent/child";
import type { ParentAlert } from "@/server/parent/alerts";

/**
 * "What happened at school today?", assembled from the day's own records.
 *
 * Every figure here is a row a teacher wrote: the register, the write-up of
 * each period, the homework they set. A period with nothing against it says so
 * rather than being counted as anything, because "not written up yet" at 10am
 * is the normal state of an afternoon lesson.
 */
export function TodaysUpdate({
  today,
  studentId,
}: {
  today: {
    date: Date;
    child: { student: { name: string }; placement: { sectionLabel: string } };
    attendance: { status: string; remarks: string | null } | null;
    periods: Array<{
      slotId: string;
      startMinute: number;
      endMinute: number;
      room: string | null;
      subject: string;
      scheduledTeacher: string;
      status: string | null;
      topic: string | null;
      takenBy: string | null;
    }>;
    tally: { scheduled: number; completed: number; substitute: number; missed: number; cancelled: number; notRecorded: number };
    homework: Array<{ id: string; title: string; dueOn: Date; subject: { name: string } }>;
    latestResult: { name: string; subject: string; date: Date; marksObtained: number | null; maxMarks: number } | null;
    latestRemark: {
      understanding: string | null;
      homeworkHabit: string | null;
      participation: string | null;
      note: string | null;
      author: string;
      createdAt: Date;
    } | null;
  };
  studentId: string;
}) {
  const { tally } = today;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today at school</CardTitle>
        <CardDescription>
          {formatDate(today.date)} · {today.child.placement.sectionLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Attendance"
            value={today.attendance ? humanize(today.attendance.status) : "Not marked"}
            hint={today.attendance?.remarks ?? undefined}
          />
          <StatCard label="Classes" value={tally.scheduled} hint="on the timetable" />
          <StatCard
            label="Written up"
            value={tally.completed + tally.substitute}
            hint={tally.notRecorded ? `${tally.notRecorded} still to come` : "all of them"}
          />
          <StatCard
            label="Missed"
            value={tally.missed + tally.cancelled}
            hint={tally.substitute ? `${tally.substitute} covered` : undefined}
          />
        </div>

        {today.periods.length ? (
          <ul className="divide-y">
            {today.periods.map((period) => (
              <li key={period.slotId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                  {formatMinutes(period.startMinute)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{period.subject}</span>
                  <span className="text-muted-foreground block text-xs">
                    {period.topic ? period.topic : "Topic not recorded yet"}
                    {period.takenBy && period.takenBy !== period.scheduledTeacher
                      ? ` · taken by ${period.takenBy}`
                      : ` · ${period.scheduledTeacher}`}
                  </span>
                </span>
                {period.status ? (
                  <StatusBadge status={period.status} />
                ) : (
                  <StatusBadge status="SCHEDULED" label="Not recorded" />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No classes on the timetable today.</p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Panel title="Homework" href={`/parent/children/${studentId}/homework` as Route}>
            {today.homework.length ? (
              <ul className="flex flex-col gap-1.5">
                {today.homework.slice(0, 3).map((work) => (
                  <li key={work.id} className="text-sm">
                    <span className="font-medium">{work.subject.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {work.title} · due {formatDate(work.dueOn)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing outstanding.</p>
            )}
          </Panel>

          <Panel title="Latest test" href={`/parent/children/${studentId}/results` as Route}>
            {today.latestResult ? (
              <div className="text-sm">
                <p className="font-medium">
                  {today.latestResult.marksObtained}/{today.latestResult.maxMarks}
                </p>
                <p className="text-muted-foreground text-xs">
                  {today.latestResult.subject} · {today.latestResult.name} ·{" "}
                  {formatDate(today.latestResult.date)}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No marks recorded yet.</p>
            )}
          </Panel>

          <Panel title="Teacher remark" href={`/parent/children/${studentId}/remarks` as Route}>
            {today.latestRemark ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1">
                  {today.latestRemark.understanding ? (
                    <StatusBadge
                      status={today.latestRemark.understanding}
                      label={humanize(today.latestRemark.understanding)}
                    />
                  ) : null}
                  {today.latestRemark.participation ? (
                    <StatusBadge
                      status={today.latestRemark.participation}
                      label={humanize(today.latestRemark.participation)}
                    />
                  ) : null}
                </div>
                {today.latestRemark.note ? (
                  <p className="text-sm">{today.latestRemark.note}</p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {today.latestRemark.author} · {formatDate(today.latestRemark.createdAt)}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing written yet.</p>
            )}
          </Panel>
        </div>
      </CardContent>
    </Card>
  );
}

function Panel({
  title,
  href,
  children,
}: {
  title: string;
  href: Route;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
        <Button asChild variant="ghost" size="xs">
          <Link href={href}>All</Link>
        </Button>
      </div>
      {children}
    </div>
  );
}

/**
 * Things worth telling a guardian without them going looking.
 *
 * Ordered by how much they need to act: a child absent today first, a notice
 * last. An empty list is the good outcome and says so.
 */
export function AlertList({ alerts }: { alerts: ParentAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <CheckIcon className="size-4 shrink-0" style={{ color: "var(--viz-good)" }} aria-hidden />
        Nothing needs your attention today.
      </p>
    );
  }

  const TONE_COLOR = {
    critical: "var(--viz-critical)",
    warning: "var(--viz-warning)",
    info: "var(--viz-neutral, var(--muted-foreground))",
  } as const;

  return (
    <ul className="divide-y">
      {alerts.map((alert, index) => (
        <li key={`${alert.kind}-${alert.childId ?? "school"}-${index}`} className="flex gap-3 py-2.5">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: TONE_COLOR[alert.tone] }}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{alert.title}</span>
            <span className="text-muted-foreground block text-xs">{alert.detail}</span>
          </span>
          {alert.href ? (
            <Button asChild variant="ghost" size="xs">
              <Link href={alert.href as Route}>Open</Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What to help with at home.
 *
 * Each line names the record it came from — a topic taught on a date, a mark in
 * a subject, a due date — so a parent can check it rather than take it on faith.
 * The school stays the authority; this only arranges what it already recorded.
 */
export function FocusList({ items }: { items: FocusItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing specific to work on">
        Once there are lesson topics, marks or homework on the record, this is where the things worth
        going over at home appear.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={`${item.reason}-${index}`} className="rounded-lg border p-3">
          <p className="text-sm font-medium">{item.headline}</p>
          <p className="text-muted-foreground mt-1 text-xs">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}
