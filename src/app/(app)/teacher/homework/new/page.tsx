import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { HomeworkForm } from "@/features/classwork/forms";
import { toDateInput, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { myTeachingOptions } from "@/server/people/teacher-self";

export const metadata: Metadata = { title: "Set homework" };

export default async function NewHomeworkPage() {
  const ctx = await requireTenant("TEACHER");
  if (!(await getCurrentSession(ctx))) {
    return (
      <NoSessionNotice
        title="Set homework"
        back={{ href: "/teacher/homework", label: "Homework" }}
      />
    );
  }

  const teaching = await myTeachingOptions(ctx);

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
        description="Published work is visible to the class and their parents straight away."
      />
      <HomeworkForm
        today={toDateInput(today())}
        sections={teaching.map((option) => ({
          value: option.sectionId,
          label: option.label,
          subjects: option.subjects.map((subject) => ({ value: subject.id, label: subject.name })),
        }))}
      />
    </>
  );
}
