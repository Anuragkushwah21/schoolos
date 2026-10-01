import type { Route } from "next";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { CreateStudentForm } from "@/features/school/people-forms";
import { requireTenant } from "@/server/auth/current-user";
import { admissionSeatOptions } from "@/server/academics/streams";
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

  const [sections, levels, parents, seats] = await Promise.all([
    sectionOptions(ctx, session.id),
    // The class level decides whether a student account is offered (Class 6 up).
    ctx.db.section.findMany({ where: { academicSessionId: session.id }, select: { id: true, class: { select: { level: true } } } }),
    searchParents(ctx),
    admissionSeatOptions(ctx, session.id),
  ]);
  const levelOf = new Map(levels.map((row) => [row.id, row.class.level]));

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
        sections={sections.map((section) => {
          // "Class 9 – A · 3 seats left" — or full — so the office sees room before choosing.
          const plan = seats[section.value];
          const left = plan?.capacity != null ? plan.capacity - plan.occupied : null;
          const note = left === null ? "" : left <= 0 ? " · full" : ` · ${left} seat${left === 1 ? "" : "s"} left`;
          return { ...section, label: `${section.label}${note}`, level: levelOf.get(section.value) ?? 0 };
        })}
        seats={seats}
        parents={parents.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.phone}${p.email ? ` · ${p.email}` : ""}` }))}
      />
    </>
  );
}
