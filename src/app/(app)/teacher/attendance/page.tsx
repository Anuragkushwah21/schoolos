import type { Metadata } from "next";

import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { RegisterScreen } from "@/features/attendance/register-page";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { attendanceSectionIds } from "@/server/auth/teacher-access";
import { getCurrentSession, sectionOptions } from "@/server/academics/structure";
import { TEACHER_EDIT_WINDOW_DAYS } from "@/server/attendance/service";

export const metadata: Metadata = { title: "Attendance" };

export default async function TeacherAttendancePage(props: PageProps<"/teacher/attendance">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) return <NoSessionNotice title="Attendance" />;

  // Only the section(s) this teacher is class teacher of. The server checks
  // the same rule again on every read and save, whatever is in the URL.
  const ids = await attendanceSectionIds(ctx, session.id);
  const sections = await sectionOptions(ctx, session.id, ids === "ALL" ? [] : ids);

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`Your class as class teacher. After attendance is submitted you can correct it for 2 hours, on the same day; a day you missed can be taken up to ${TEACHER_EDIT_WINDOW_DAYS} days later.`}
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
