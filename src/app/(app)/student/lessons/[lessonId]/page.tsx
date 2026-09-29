import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MATERIAL_KIND_LABEL, MaterialActions } from "@/features/student/material-actions";
import { StudentTabs } from "@/features/student/nav";
import { formatDate, formatMinutes } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyLesson } from "@/server/student/me";

export const metadata: Metadata = { title: "Lesson" };

/**
 * One lesson in full — the point of the whole student portal.
 *
 * What was taught, the teacher's notes, the short list to revise, the material
 * they attached and the homework set around it. This is what lets a student who
 * missed a class, or did not follow it, catch up without waiting for anybody.
 *
 * The `lessonId` is the only id a student read accepts, and `getMyLesson` checks
 * it against their own section: a lesson from another section, or another school,
 * answers exactly as one that does not exist.
 */
export default async function StudentLessonPage(
  props: PageProps<"/student/lessons/[lessonId]">,
) {
  const ctx = await requireTenant("STUDENT");
  const { lessonId } = await props.params;
  const { lesson, homework } = await orNotFound(getMyLesson(ctx, lessonId));

  return (
    <>
      <PageHeader
        back={{ href: "/student/classes", label: "Completed classes" }}
        title={lesson.topic ?? lesson.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lesson.status} />
            {lesson.subject} · {formatDate(lesson.date)} · {formatMinutes(lesson.startMinute)}–
            {formatMinutes(lesson.endMinute)} · {lesson.teacher}
            {lesson.stoodInFor ? ` (covering for ${lesson.stoodInFor})` : ""}
          </span>
        }
      />
      <StudentTabs active="classes" />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          {lesson.preparation ? (
            <Card>
              <CardHeader>
                <CardTitle>{lesson.taught ? "Prepare for the next class" : "Prepare before this class"}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{lesson.preparation}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Class notes</CardTitle>
              <CardDescription>
                {lesson.taught
                  ? "Written by your teacher after the class."
                  : "This class has not been taught yet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lesson.notes ? (
                <p className="text-sm whitespace-pre-line">{lesson.notes}</p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Your teacher has not added notes for this class.
                </p>
              )}
            </CardContent>
          </Card>

          {lesson.importantPoints ? (
            <Card>
              <CardHeader>
                <CardTitle>Important</CardTitle>
                <CardDescription>The short list to revise from.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{lesson.importantPoints}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Study material</CardTitle>
              <CardDescription>
                {lesson.materials.length
                  ? "Attached by your teacher for this class."
                  : "Nothing attached to this class."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lesson.materials.length ? (
                <ul className="flex flex-col gap-4">
                  {lesson.materials.map((material) => (
                    <li key={material.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{material.title}</p>
                        <StatusBadge
                          status="INACTIVE"
                          label={MATERIAL_KIND_LABEL[material.kind] ?? material.kind}
                          tone="neutral"
                        />
                      </div>
                      {material.body ? (
                        <p className="mt-2 text-sm whitespace-pre-line">{material.body}</p>
                      ) : null}
                      {material.description ? (
                        <p className="text-muted-foreground mt-2 text-sm">{material.description}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <MaterialActions material={material} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Notes, PDFs, videos and links your teacher attaches appear here.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Homework from this class</CardTitle>
            <CardDescription>Set in this subject around this date.</CardDescription>
          </CardHeader>
          <CardContent>
            {homework.length ? (
              <ul className="divide-y">
                {homework.map((work) => (
                  <li key={work.id} className="flex flex-col gap-1 py-3">
                    <p className="text-sm font-medium">{work.title}</p>
                    {work.description ? (
                      <p className="text-sm whitespace-pre-line">{work.description}</p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      Due {formatDate(work.dueOn)} · set by {work.teacher}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No homework from this class" />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
