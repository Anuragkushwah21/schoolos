import type { Route } from "next";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { CreateStudentForm } from "@/features/school/people-forms";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { searchParents } from "@/server/people/students";

export const metadata: Metadata = { title: "Add student" };

export default async function NewStudentPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  const back = { href: "/school-admin/students" as Route, label: "Students" };

  if (!session) {
    return (
      <>
        <SetupNotice title="Add student" need="session" back={back} />
      </>
    );
  }

  const [sections, parents] = await Promise.all([sectionOptions(ctx, session.id), searchParents(ctx)]);

  if (!sections.length) {
    return (
      <>
        <SetupNotice title="Add student" need="sections" back={back}>
          A student is always placed in a section, and {session.name} has none yet.
        </SetupNotice>
      </>
    );
  }

  return (
    <>
      <PageHeader back={back} title="Add student" description="Admit a student directly. Online applications are under Admissions." />
      <CreateStudentForm
        sessionName={session.name}
        sections={sections}
        parents={parents.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.phone}` }))}
      />
    </>
  );
}
