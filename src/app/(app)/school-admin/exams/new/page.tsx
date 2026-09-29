import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { CreateExamForm } from "@/features/exams/forms";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionLabel } from "@/server/academics/structure";

export const metadata: Metadata = { title: "New exam" };

export default async function NewExamPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="New exam" need="session" />;

  const [sections, subjects] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId: session.id },
      select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } },
    }),
    ctx.db.subject.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/exams", label: "Examinations" }}
        title="New exam"
        description={`${session.name}. Dates may be in the past or future.`}
      />
      <CreateExamForm
        sections={sections
          .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
          .map((section) => ({
            value: section.id,
            label: section.stream ? `${section.name} (${section.stream.name})` : section.name,
            group: section.class.name,
            full: sectionLabel(section),
          }))}
        subjects={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
      />
    </>
  );
}
