import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { PairOverview, UnitReportView } from "@/features/academics/pair-report";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { pairProgress, unitReport } from "@/server/academics/progress";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Class progress" };

/** One class and subject — or one of its units — for school leaders. */
export default async function LeaderClassProgressPage(props: PageProps<"/school-admin/progress/class">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const pair = { sectionId: param(search.section) ?? "", subjectId: param(search.subject) ?? "" };
  const unitId = param(search.unit);
  const progress = await orHidden(pairProgress(ctx, pair));
  const report = unitId ? await orHidden(unitReport(ctx, pair, unitId)) : null;
  const mode = { role: "leader" as const, base: "/school-admin/progress" };
  return (
    <>
      <PageHeader
        back={report ? { href: `/school-admin/progress/class?section=${pair.sectionId}&subject=${pair.subjectId}` as Route, label: `${progress.section} · ${progress.subject}` } : { href: "/school-admin/progress", label: "Academic progress" }}
        title={report ? report.unit.title : `${progress.section} · ${progress.subject}`}
        description={report ? "Unit report" : progress.teachers.join(", ") || "No teacher assigned"}
      />
      {report ? <UnitReportView report={report} progress={progress} mode={mode} /> : <PairOverview progress={progress} mode={mode} />}
    </>
  );
}
