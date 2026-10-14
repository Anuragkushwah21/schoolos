import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { deleteHomeworkAction } from "@/features/classwork/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AddHomeworkResourceForm,
  HomeworkForm,
  HomeworkMarksForm,
  HomeworkResourceEditor,
} from "@/features/classwork/forms";
import { formatDate, toDateInput, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { getMyHomework, homeworkRoster, homeworkStudentChoices } from "@/server/classwork/homework";
import { mySyllabusChoices } from "@/server/academics/syllabus";
import { orHidden } from "@/server/page-helpers";
import { myTeachingOptions } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Edit homework" };

/**
 * One assignment, for the teacher who set it.
 *
 * `getMyHomework` is the guard: another teacher's row refuses, and one from
 * another school cannot be seen at all. The page adds nothing of its own.
 */
export default async function EditHomeworkPage(
  props: PageProps<"/teacher/homework/[homeworkId]">,
) {
  const ctx = await requireTenant("TEACHER");
  const { homeworkId } = await props.params;

  if (!(await getCurrentSession(ctx))) {
    return (
      <NoSessionNotice
        title="Homework"
        back={{ href: "/teacher/homework", label: "Homework" }}
      />
    );
  }

  const [homework, teaching, students, syllabus] = await Promise.all([
    orHidden(getMyHomework(ctx, homeworkId)),
    myTeachingOptions(ctx),
    homeworkStudentChoices(ctx),
    mySyllabusChoices(ctx),
  ]);
  const roster = await homeworkRoster(ctx, homeworkId);

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/homework", label: "Homework" }}
        title={homework.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={homework.status} />
            {homework.section} · {homework.subject} · due {formatDate(homework.dueOn)}
          </span>
        }
        actions={
          <ActionButton
            action={deleteHomeworkAction}
            fields={{ homeworkId: homework.id }}
            variant="destructive"
            confirm={{
              title: "Delete this homework?",
              description:
                "It disappears from the class and from their parents' view. To take it back without deleting it, set it to draft instead.",
              confirmLabel: "Delete",
            }}
          >
            Delete
          </ActionButton>
        }
      />
      <HomeworkForm
        today={toDateInput(today())}
        sections={teaching.map((option) => ({
          value: option.sectionId,
          label: option.label,
          subjects: option.subjects.map((subject) => ({
            value: subject.id,
            label: subject.name,
            whole: subject.whole,
            streams: subject.streams.map((stream) => ({ value: stream.id, label: stream.name })),
          })),
        }))}
        homework={{
          id: homework.id,
          sectionId: homework.sectionId,
          subjectId: homework.subjectId,
          streamId: homework.streamId,
          title: homework.title,
          description: homework.description,
          instructions: homework.instructions,
          assignedOn: toDateInput(homework.assignedOn),
          dueOn: toDateInput(homework.dueOn),
          status: homework.status,
          audience: homework.audience,
          studentIds: homework.studentIds,
          syllabusItemId: homework.syllabusItemId,
        }}
        students={students}
        syllabus={syllabus}
      />

      <Card className="mt-8 max-w-3xl">
        <CardHeader>
          <CardTitle>Who handed it in</CardTitle>
          <CardDescription>
            {`${homework.audience === "SELECTED_STUDENTS" ? `Selected students: ${roster.counts.total}` : `Whole class: ${roster.counts.total}`}. Submitted ${roster.counts.submitted} · late ${roster.counts.late} · missing ${roster.counts.missing} · not checked ${roster.counts.assigned}. Students and parents see what you record here; opening the homework never marks it.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!roster.students.length ? (
            <p className="text-muted-foreground text-sm">No students in this class yet.</p>
          ) : roster.canMark ? (
            <HomeworkMarksForm homeworkId={homework.id} canMarkMissing={roster.canMarkMissing} students={roster.students.map((row) => ({ studentId: row.studentId, name: row.name, rollNumber: row.rollNumber, status: row.status, note: row.note }))} />
          ) : (
            <p className="text-muted-foreground text-sm">{roster.status === "PUBLISHED" ? "You can record who handed it in from the day it is set." : "Publish the homework to record who handed it in."}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-8 max-w-3xl">
        <CardHeader>
          <CardTitle>Study resources</CardTitle>
          <CardDescription>
            PDFs, videos and links for this homework. Changes here save straight away and never
            affect the homework itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {homework.resources.length ? (
            homework.resources.map((resource) => (
              <HomeworkResourceEditor key={resource.id} resource={resource} />
            ))
          ) : (
            <p className="text-muted-foreground text-sm">No study resources attached.</p>
          )}
          <div className="border-t pt-4">
            <p className="mb-3 text-sm font-medium">Add a resource</p>
            <AddHomeworkResourceForm homeworkId={homework.id} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
