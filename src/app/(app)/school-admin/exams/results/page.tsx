import type { Metadata } from "next";
import { GraduationCapIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { AdminTestsScreen } from "@/features/exams/admin-tests-screen";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Published results" };

/** Exams & Results → Published results. */
export default async function Page(props: PageProps<"/school-admin/exams/results">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  if (!(await getCurrentSession(ctx))) return <SetupNotice title="Exams & Results" need="session" />;
  const search = await props.searchParams;
  return (
    <>
      <PageHeader icon={GraduationCapIcon} tone="purple" title="Published results" description="Results students and parents can see: submitted tests and published term exams. Open one to see every student’s marks." />
      <AdminTestsScreen ctx={ctx} view="published" base="/school-admin/exams/results" search={search} emptyTitle="No published results yet" emptyText="Results appear here when a teacher submits a test or you publish a term exam." />
    </>
  );
}
