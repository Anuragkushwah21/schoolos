import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { HolidaysScreen } from "@/features/calendar/holidays-screen";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Holidays" };

/** Read-only: only the School Admin changes the calendar. */
export default async function HolidaysPage(props: PageProps<"/teacher/holidays">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;

  return (
    <>
      <PageHeader title="School calendar" description="Holidays, events, exams and parent-teacher meetings for you. No attendance is taken on a holiday." />
      <HolidaysScreen ctx={ctx} basePath="/teacher/holidays" monthParam={param(search.month)} />
    </>
  );
}
