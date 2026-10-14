import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { ReadinessView } from "@/features/academics/pair-report";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { examReadiness } from "@/server/academics/progress";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Exam readiness" };

/** Before exams: the evidence for the subjects this teacher teaches in one class. */
export default async function TeacherReadinessPage(props: PageProps<"/teacher/progress/readiness">) {
  const ctx = await requireTenant("TEACHER");
  const sectionId = param((await props.searchParams).section) ?? "";
  const data = await orHidden(examReadiness(ctx, { sectionId }));
  return (
    <>
      <PageHeader back={{ href: "/teacher/progress" as Route, label: "Progress" }} title={`Exam readiness — ${data.section}`} description="Your subjects in this class: coverage, homework, tests and revision. The evidence, not a verdict." />
      <ReadinessView data={data} />
    </>
  );
}
