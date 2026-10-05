import type { Metadata } from "next";
import { GraduationCapIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { AdminTestsScreen } from "@/features/exams/admin-tests-screen";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "All tests" };

/** Exams & Results → All tests. */
export default async function Page(props: PageProps<"/school-admin/exams">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  if (!(await getCurrentSession(ctx))) return <SetupNotice title="Exams & Results" need="session" />;
  const search = await props.searchParams;
  return (
    <>
      <PageHeader icon={GraduationCapIcon} tone="purple" title="All tests" description="Every test and exam paper this session — set by teachers, or papers of a term exam." />
      <AdminTestsScreen ctx={ctx} view="all" base="/school-admin/exams" search={search} emptyTitle="No tests yet" emptyText="Teachers create tests for their subjects; term exams are created from Term exams." />
    </>
  );
}
