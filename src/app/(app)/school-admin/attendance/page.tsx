import { ClipboardCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { Button } from "@/components/ui/button";
import { RegisterScreen } from "@/features/attendance/register-page";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Attendance" };

export default async function AdminAttendancePage(props: PageProps<"/school-admin/attendance">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  return (
    <>
      <PageHeader icon={ClipboardCheckIcon} tone="green"
        title="Attendance"
        description="Mark or correct any section's register."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/attendance/staff">Staff attendance</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/school-admin/reports">Reports</Link>
            </Button>
          </>
        }
      />
      {session ? (
        <RegisterScreen
          ctx={ctx}
          basePath="/school-admin/attendance"
          sections={await sectionOptions(ctx, session.id)}
          sectionParam={param(search.section)}
          dateParam={param(search.date)}
        />
      ) : (
        <SetupNotice title="Attendance" need="session" />
      )}
    </>
  );
}
