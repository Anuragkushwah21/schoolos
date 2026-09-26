import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RegisterScreen } from "@/features/attendance/register-page";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Attendance" };

export default async function AdminAttendancePage(props: PageProps<"/admin/attendance">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Mark or correct any section's register."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/attendance/staff">Staff attendance</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/reports">Reports</Link>
            </Button>
          </>
        }
      />
      {session ? (
        <RegisterScreen
          ctx={ctx}
          basePath="/admin/attendance"
          sections={await sectionOptions(ctx, session.id)}
          sectionParam={param(search.section)}
          dateParam={param(search.date)}
        />
      ) : (
        <EmptyState title="No current academic session">Set one under Academics first.</EmptyState>
      )}
    </>
  );
}
