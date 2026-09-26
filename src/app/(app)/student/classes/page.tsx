import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTabs } from "@/features/student/nav";
import { formatDate, formatMinutes } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyCompletedLessons } from "@/server/student/me";

export const metadata: Metadata = { title: "Completed classes" };

/**
 * Classes already taught, for revision.
 *
 * Only lessons a teacher has written up: a scheduled row is a plan, not a record
 * of something that happened. The badges say what the notes and material are, so
 * a student can tell which lessons are worth opening.
 */
export default async function StudentClassesPage(props: PageProps<"/student/classes">) {
  const ctx = await requireTenant("STUDENT");
  const search = await props.searchParams;
  const subjectId = param(search.subject);

  const { me, subjects, lessons } = await orNotFound(
    getMyCompletedLessons(ctx, { subjectId, days: 60 }),
  );

  return (
    <>
      <PageHeader
        title="Completed classes"
        description={`${me.placement.sectionLabel} · the last 60 days, as your teachers wrote them up`}
      />
      <StudentTabs active="classes" />

      <FilterBar
        action="/student/classes"
        selects={[
          {
            name: "subject",
            label: "Subject",
            defaultValue: subjectId,
            allLabel: "All subjects",
            options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
          },
        ]}
      />

      {lessons.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Lesson by lesson</CardTitle>
            <CardDescription>Newest first. Open one to see the notes and material.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {lessons.map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <span className="text-muted-foreground w-28 shrink-0 text-sm tabular-nums">
                    {formatDate(lesson.date)}
                    <span className="block text-xs">{formatMinutes(lesson.startMinute)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {lesson.subject}
                      {lesson.topic ? ` — ${lesson.topic}` : ""}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {lesson.teacher}
                      {lesson.hasNotes ? " · notes" : ""}
                      {lesson.hasImportantPoints ? " · important points" : ""}
                      {lesson.materialCount
                        ? ` · ${lesson.materialCount} ${lesson.materialCount === 1 ? "material" : "materials"}`
                        : ""}
                    </span>
                  </span>
                  <StatusBadge status={lesson.status} />
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/student/lessons/${lesson.id}` as Route}>Review</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title={subjectId ? "Nothing in that subject yet" : "No classes written up yet"}
        >
          Your teachers write up each class after they teach it. What was covered — with any notes
          and material — appears here.
        </EmptyState>
      )}
    </>
  );
}
