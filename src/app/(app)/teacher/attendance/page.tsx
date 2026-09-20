import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { RegisterScreen } from "@/features/attendance/register-page";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { TEACHER_EDIT_WINDOW_DAYS } from "@/server/attendance/service";

export const metadata: Metadata = { title: "Attendance" };

export default async function TeacherAttendancePage(props: PageProps<"/teacher/attendance">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) {
    return (
      <>
        <PageHeader title="Attendance" />
        <EmptyState title="The school has no current academic session" />
      </>
    );
  }

  // Only the sections this teacher teaches or is class teacher of.
  const ids = await accessibleSectionIds(ctx, session.id);
  const sections = await sectionOptions(ctx, session.id, ids === "ALL" ? [] : ids);

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`Your classes. You can mark today and correct the last ${TEACHER_EDIT_WINDOW_DAYS} days.`}
      />
      <RegisterScreen
        ctx={ctx}
        basePath="/teacher/attendance"
        sections={sections}
        sectionParam={param(search.section)}
        dateParam={param(search.date)}
      />
    </>
  );
}
