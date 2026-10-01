import { CalendarRangeIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { HolidaysScreen } from "@/features/calendar/holidays-screen";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Calendar" };

/** Read-only: only the School Admin changes the calendar. Leave is managed on the Leave pages. */
export default async function CalendarPage(props: PageProps<"/staff/holidays">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  const search = await props.searchParams;

  return (
    <>
      <PageHeader icon={CalendarRangeIcon} tone="orange" title="Calendar" description="A date overview: holidays, school events and your meetings." />
      <HolidaysScreen ctx={ctx} basePath="/staff/holidays" monthParam={param(search.month)} />
    </>
  );
}
