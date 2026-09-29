import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { HolidayForm } from "@/features/calendar/forms";
import { parseDateInput, today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New holiday" };

/**
 * `?date=YYYY-MM-DD` — set when the admin clicks a day on the calendar — fills
 * in the first day. A past or malformed date is ignored rather than offered,
 * since the server would refuse it anyway.
 */
export default async function NewHolidayPage(props: PageProps<"/school-admin/holidays/new">) {
  await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const now = today();
  const picked = parseDateInput(param(search.date));
  const startDate = picked && picked >= now ? toDateInput(picked) : undefined;

  return (
    <>
      <PageHeader back={{ href: "/school-admin/holidays", label: "Holidays" }} title="New holiday" />
      <HolidayForm today={toDateInput(now)} earliestStart={toDateInput(now)} defaultStartDate={startDate} />
    </>
  );
}
