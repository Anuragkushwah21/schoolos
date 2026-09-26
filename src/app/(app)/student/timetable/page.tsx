import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Card, CardContent } from "@/components/ui/card";
import { dayOfWeek, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyTimetable } from "@/server/student/me";

export const metadata: Metadata = { title: "Timetable" };

/** The weekly periods of the section the school placed this student in. */
export default async function StudentTimetablePage() {
  const ctx = await requireTenant("STUDENT");
  const { me, slots } = await orNotFound(getMyTimetable(ctx));

  return (
    <>
      <PageHeader
        title="My timetable"
        description={`${me.placement.sectionLabel} · ${me.placement.sessionName}`}
      />

      {slots.length ? (
        <Card>
          <CardContent>
            <TimetableGrid
              today={dayOfWeek(today())}
              slots={slots.map((slot) => ({
                id: slot.id,
                dayOfWeek: slot.dayOfWeek,
                startMinute: slot.startMinute,
                endMinute: slot.endMinute,
                title: slot.subject.name,
                subtitle: fullName(slot.teacher),
                meta: slot.room,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="No timetable yet">
          Your school draws the weekly timetable. It appears here as soon as they do.
        </EmptyState>
      )}
    </>
  );
}
