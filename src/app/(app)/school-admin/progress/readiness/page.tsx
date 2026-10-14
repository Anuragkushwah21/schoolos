import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { ReadinessView } from "@/features/academics/pair-report";
import { NotFoundError } from "@/lib/errors";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { examReadiness } from "@/server/academics/progress";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Exam readiness" };

/** Before examinations, per class: the evidence for every subject. School leaders. */
export default async function LeaderReadinessPage(props: PageProps<"/school-admin/progress/readiness">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const session = await getCurrentSession(ctx);
  if (!session) return <NoSessionNotice title="Exam readiness" back={{ href: "/school-admin/progress", label: "Academic progress" }} />;
  const [sections, search] = await Promise.all([sectionOptions(ctx, session.id), props.searchParams]);
  const sectionId = sections.find((row) => row.value === param(search.section))?.value ?? sections[0]?.value ?? "";
  // A class with no subjects assigned or timetabled has nothing to report.
  const data = sectionId
    ? await examReadiness(ctx, { sectionId }).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;
  return (
    <>
      <PageHeader back={{ href: "/school-admin/progress", label: "Academic progress" }} title="Exam readiness" description="Coverage, homework, tests and revision per subject, before exams. Shows the evidence — staff decide." />
      <FilterBar action="/school-admin/progress/readiness" selects={[{ name: "section", label: "Class", defaultValue: sectionId, options: sections }]} />
      <div className="mt-6">{data ? <ReadinessView data={data} /> : <EmptyState title="Nothing to show for this class">No subjects are assigned or timetabled for it this session.</EmptyState>}</div>
    </>
  );
}
