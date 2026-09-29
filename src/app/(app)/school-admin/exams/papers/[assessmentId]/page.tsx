import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MarksSheetScreen } from "@/features/exams/marks-sheet-screen";
import { requireTenant } from "@/server/auth/current-user";
import { getMarksSheet } from "@/server/exams/service";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Marks" };

export default async function AdminMarksPage(props: PageProps<"/school-admin/exams/papers/[assessmentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { assessmentId } = await props.params;
  const sheet = await orNotFound(getMarksSheet(ctx, assessmentId));

  return (
    <>
      <PageHeader
        back={
          sheet.paper.exam
            ? { href: `/school-admin/exams/${sheet.paper.exam.id}` as Route, label: sheet.paper.exam.name }
            : { href: "/school-admin/exams", label: "Examinations" }
        }
        title={`${sheet.paper.subject} · ${sheet.paper.section}`}
      />
      <MarksSheetScreen sheet={sheet} />
    </>
  );
}
