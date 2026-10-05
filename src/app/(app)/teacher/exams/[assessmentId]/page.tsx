import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MarksSheetScreen } from "@/features/exams/marks-sheet-screen";
import { requireTenant } from "@/server/auth/current-user";
import { getMarksSheet } from "@/server/exams/service";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Enter marks" };

/** Exams & Tests → Enter Marks → Submit Results. Another teacher's test is refused inside. */
export default async function TeacherMarksPage(props: PageProps<"/teacher/exams/[assessmentId]">) {
  const ctx = await requireTenant("TEACHER");
  const { assessmentId } = await props.params;
  const sheet = await orHidden(getMarksSheet(ctx, assessmentId));

  return (
    <>
      <PageHeader back={{ href: "/teacher/exams", label: "My tests" }} title={`Enter marks · ${sheet.paper.subject} · ${sheet.paper.section}`} />
      <MarksSheetScreen sheet={sheet} role="TEACHER" />
    </>
  );
}
