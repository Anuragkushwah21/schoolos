import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MarksSheetScreen } from "@/features/exams/marks-sheet-screen";
import { requireTenant } from "@/server/auth/current-user";
import { getMarksSheet } from "@/server/exams/service";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Marks" };

export default async function TeacherMarksPage(props: PageProps<"/teacher/exams/[assessmentId]">) {
  const ctx = await requireTenant("TEACHER");
  const { assessmentId } = await props.params;
  // A paper for a subject this teacher does not teach is refused inside.
  const sheet = await orHidden(getMarksSheet(ctx, assessmentId));

  return (
    <>
      <PageHeader back={{ href: "/teacher/exams", label: "Exams & marks" }} title={`${sheet.paper.subject} · ${sheet.paper.section}`} />
      <MarksSheetScreen sheet={sheet} />
    </>
  );
}
