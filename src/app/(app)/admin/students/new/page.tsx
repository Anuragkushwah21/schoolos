import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CreateStudentForm } from "@/features/school/people-forms";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { searchParents } from "@/server/people/students";

export const metadata: Metadata = { title: "Add student" };

export default async function NewStudentPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  const back = { href: "/admin/students", label: "Students" };

  if (!session) {
    return (
      <>
        <PageHeader back={back} title="Add student" />
        <EmptyState title="No current academic session">Set one under Academics first.</EmptyState>
      </>
    );
  }

  const [sections, parents] = await Promise.all([sectionOptions(ctx, session.id), searchParents(ctx)]);

  if (!sections.length) {
    return (
      <>
        <PageHeader back={back} title="Add student" />
        <EmptyState
          title={`No sections in ${session.name}`}
          action={
            <Button asChild size="sm">
              <Link href="/admin/academics/classes">Create sections</Link>
            </Button>
          }
        >
          A student is always placed in a section, so create one first.
        </EmptyState>
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
