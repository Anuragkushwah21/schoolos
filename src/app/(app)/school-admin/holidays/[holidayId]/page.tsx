import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { deleteHolidayAction } from "@/features/calendar/actions";
import { HolidayForm } from "@/features/calendar/forms";
import { formatSpan } from "@/lib/calendar";
import { today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getHoliday, holidayHasEnded } from "@/server/calendar/holidays";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit holiday" };

export default async function EditHolidayPage(props: PageProps<"/school-admin/holidays/[holidayId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { holidayId } = await props.params;
  const holiday = await orNotFound(getHoliday(ctx, holidayId));
  const now = today();

  // A holiday that has fully ended is part of the record: read-only.
  if (holidayHasEnded(holiday, now)) {
    return (
      <>
        <PageHeader
          back={{ href: "/school-admin/holidays", label: "Holidays" }}
          title={holiday.title}
          description={formatSpan(holiday.startDate, holiday.endDate)}
        />
        <p className="bg-muted/40 max-w-3xl rounded-lg border px-3 py-2 text-sm">
          This holiday has already ended, so it can no longer be edited or deleted.
        </p>
      </>
    );
  }

  const startedAlready = holiday.startDate < now;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/holidays", label: "Holidays" }}
        title={holiday.title}
        actions={
          <ActionButton
            action={deleteHolidayAction}
            fields={{ holidayId: holiday.id }}
            variant="destructive"
            confirm={{
              title: "Delete this holiday?",
              description: "Registers reopen for these days. Attendance cleared when the holiday was declared is not restored.",
              confirmLabel: "Delete",
            }}
          >
            Delete
          </ActionButton>
        }
      />
      <HolidayForm
        today={toDateInput(now)}
        earliestStart={toDateInput(startedAlready ? holiday.startDate : now)}
        holiday={{
          id: holiday.id,
          title: holiday.title,
          description: holiday.description,
          startDate: toDateInput(holiday.startDate),
          endDate: toDateInput(holiday.endDate),
        }}
      />
    </>
  );
}
