import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTabs } from "@/features/student/nav";
import { formatDate, formatMinutes } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyUpcomingLessons } from "@/server/student/me";

export const metadata: Metadata = { title: "Upcoming lessons" };

/**
 * Lessons a teacher has planned but not yet taught.
 *
 * Only what the teacher actually entered. A period with no plan does not appear
 * here — inventing a topic from the timetable would be guessing at what a class
 * will cover, and a student who prepared the wrong thing would be worse off than
 * one who prepared nothing.
 */
export default async function StudentUpcomingPage() {
  const ctx = await requireTenant("STUDENT");
  const { me, lessons } = await orNotFound(getMyUpcomingLessons(ctx, { days: 21 }));

  return (
    <>
      <PageHeader
        title="Upcoming lessons"
        description={`${me.placement.sectionLabel} · what your teachers have planned`}
      />
      <StudentTabs active="upcoming" />

      {lessons.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Planned</CardTitle>
            <CardDescription>Soonest first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {lessons.map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                    {formatDate(lesson.date)}
                    <span className="block text-xs">{formatMinutes(lesson.startMinute)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {lesson.subject}
                      {lesson.plannedTopic ? ` — ${lesson.plannedTopic}` : ""}
                    </span>
                    <span className="text-muted-foreground block text-xs">{lesson.teacher}</span>
                    {lesson.preparation ? (
                      <span className="mt-1 block text-sm">
                        <span className="font-medium">To prepare:</span> {lesson.preparation}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="No lessons planned yet">
          When a teacher plans what a class will cover — and what to do beforehand — it appears here.
          Your timetable is still under Timetable.
        </EmptyState>
      )}
    </>
  );
}
