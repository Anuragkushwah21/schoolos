import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { HomeworkForm } from "@/features/classwork/forms";
import { toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { myTeachingOptions } from "@/server/people/teacher-self";
import { mySyllabusChoices } from "@/server/academics/syllabus";
import { homeworkStudentChoices } from "@/server/classwork/homework";

export const metadata: Metadata = { title: "Set homework" };

export default async function NewHomeworkPage(props: PageProps<"/teacher/homework/new">) {
  const ctx = await requireTenant("TEACHER");
  // "?section=" from the dashboard pre-selects that class.
  const defaultSectionId = param((await props.searchParams).section);
  if (!(await getCurrentSession(ctx))) {
    return (
      <NoSessionNotice
        title="Set homework"
        back={{ href: "/teacher/homework", label: "Homework" }}
      />
    );
  }

  const [teaching, students, syllabus] = await Promise.all([myTeachingOptions(ctx), homeworkStudentChoices(ctx), mySyllabusChoices(ctx)]);

  if (teaching.length === 0) {
    return (
      <>
        <PageHeader back={{ href: "/teacher/homework", label: "Homework" }} title="Set homework" />
        <EmptyState title="You are not assigned to any subject yet">
          Homework belongs to a subject in a class. Ask the school office to record what you teach,
          and this form fills itself in.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/homework", label: "Homework" }}
        title="Set homework"
        description="Published work is visible straight away to the students it is for and their parents. Review it before it is set."
      />
      <HomeworkForm
        students={students}
        syllabus={syllabus}
        defaultSectionId={defaultSectionId}
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
      />
    </>
  );
}
