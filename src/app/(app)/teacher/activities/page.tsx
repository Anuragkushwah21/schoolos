import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ClassActivityForm, LessonPlanForm } from "@/features/classwork/forms";
import {
  DAY_SHORT,
  addDays,
  formatDate,
  formatMinutes,
  parseDateInput,
  toDateInput,
  today,
} from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { ACTIVITY_WINDOW_DAYS, getMyDayPlan, listMyActivities } from "@/server/classwork/activities";
import { PLANNING_HORIZON_DAYS, listMyPlannedLessons } from "@/server/classwork/lessons";
import { getTeacherWeek } from "@/server/people/portal";

export const metadata: Metadata = { title: "Class records" };

/** How far back the list of past records looks. */
const HISTORY_DAYS = 30;

/**
 * What happened in each period — written up by the teacher who taught it.
 *
 * The date is a filter in the URL rather than component state, so a day being
 * caught up on can be linked to and returned to. Every period offered belongs
 * to this teacher's timetable; the service checks that again on save.
 */
export default async function TeacherActivitiesPage(props: PageProps<"/teacher/activities">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;

  const now = today();
  const earliest = addDays(now, -ACTIVITY_WINDOW_DAYS);

  // A date outside the correction window is treated as no date at all: the
  // form would refuse it anyway, and silently clamping would be a lie.
  const requested = parseDateInput(param(search.date));
  const date = requested && requested <= now && requested >= earliest ? requested : now;

  // Asked before anything else: every call below needs a current session, and
  // "the office has not opened the year yet" is a setup state, not an error.
  if (!(await getCurrentSession(ctx))) return <NoSessionNotice title="Class records" />;

  const [week, plan, history, planned] = await Promise.all([
    getTeacherWeek(ctx),
    getMyDayPlan(ctx, date),
    listMyActivities(ctx, { from: addDays(now, -HISTORY_DAYS), to: now }),
    listMyPlannedLessons(ctx),
  ]);

  if (!week || week.slots.length === 0) {
    return (
      <>
        <PageHeader title="Class records" />
        <EmptyState title="You have no periods on the timetable yet">
          A class record is written against a scheduled period. Once the school office puts your
          subjects on the timetable, they appear here.
        </EmptyState>
      </>
    );
  }

  const recorded = plan.periods.filter((period) => period.recorded).length;

  return (
    <>
      <PageHeader
        title="Class records"
        description={`What you taught, period by period. You can write up today and the last ${ACTIVITY_WINDOW_DAYS} days.`}
      />

      <FilterBar
        action="/teacher/activities"
        dates={[
          {
            name: "date",
            label: "Show the day",
            defaultValue: toDateInput(date),
            max: toDateInput(now),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Write up a class</CardTitle>
            <CardDescription>
              Saving the same period twice corrects the first record rather than adding a second.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClassActivityForm
              slots={week.slots.map((slot) => ({
                value: slot.id,
                dayOfWeek: slot.dayOfWeek,
                label: `${DAY_SHORT[slot.dayOfWeek]} ${formatMinutes(slot.startMinute)} · ${slot.subject.name} · ${slot.section.class.name} – ${slot.section.name}`,
              }))}
              defaultSlotId={param(search.slot)}
              defaultDate={toDateInput(now)}
              earliestDate={toDateInput(earliest)}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{formatDate(plan.date)}</CardTitle>
              <CardDescription>
                {plan.periods.length
                  ? `${recorded} of ${pluralize(plan.periods.length, "period")} written up.`
                  : "Nothing scheduled that day."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {plan.periods.length ? (
                <ul className="divide-y">
                  {plan.periods.map((period) => (
                    <li key={period.slotId} className="flex items-center gap-3 py-2.5">
                      <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                        {formatMinutes(period.startMinute)}–{formatMinutes(period.endMinute)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{period.subject}</span>
                        <span className="text-muted-foreground block text-xs">
                          {period.section}
                          {period.topic ? ` · ${period.topic}` : ""}
                          {period.coveringFor ? ` · covering for ${period.coveringFor}` : ""}
                          {period.coveredBy ? ` · covered by ${period.coveredBy}` : ""}
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
                <p className="text-muted-foreground text-sm">No periods scheduled that day.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan a lesson</CardTitle>
              <CardDescription>
                What you intend to cover, set before the class. Your students see it as an upcoming
                lesson with whatever you ask them to prepare.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <LessonPlanForm
                slots={week.slots.map((slot) => ({
                  value: slot.id,
                  dayOfWeek: slot.dayOfWeek,
                  label: `${DAY_SHORT[slot.dayOfWeek]} ${formatMinutes(slot.startMinute)} · ${slot.subject.name} · ${slot.section.class.name} – ${slot.section.name}`,
                }))}
                earliestDate={toDateInput(now)}
                latestDate={toDateInput(addDays(now, PLANNING_HORIZON_DAYS))}
                defaultDate={toDateInput(addDays(now, 1))}
              />

              {planned.length ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Planned</p>
                  <ul className="divide-y rounded-lg border">
                    {planned.map((lesson) => (
                      <li key={lesson.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
                          {formatDate(lesson.date)}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block font-medium">
                            {lesson.plannedTopic ?? "Preparation only"}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {lesson.subject} · {lesson.section}
                            {lesson.materialCount ? ` · ${lesson.materialCount} material` : ""}
                          </span>
                        </span>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/teacher/activities/${lesson.id}` as Route}>Open</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent records</CardTitle>
              <CardDescription>Your last {HISTORY_DAYS} days.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length ? (
                <ul className="divide-y">
                  {history.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-muted-foreground w-24 shrink-0 text-sm tabular-nums">
                        {formatDate(entry.date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{entry.topic ?? entry.subject}</span>
                        <span className="text-muted-foreground block text-xs">
                          {entry.section} · {entry.subject}
                        </span>
                      </span>
                      <StatusBadge status={entry.status} />
                      {entry.editable ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/teacher/activities/${entry.id}`}>Edit</Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nothing written up yet. The form beside this list is where it starts.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
