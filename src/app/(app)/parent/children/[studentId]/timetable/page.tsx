import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Card, CardContent } from "@/components/ui/card";
import { ChildTabs } from "@/features/parent/child-nav";
import { dayOfWeek, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildTimetable } from "@/server/parent/child";

export const metadata: Metadata = { title: "Timetable" };

/** The weekly periods of the section the school placed this child in. */
export default async function ChildTimetablePage(
  props: PageProps<"/parent/children/[studentId]/timetable">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const { child, slots } = await orNotFound(getChildTimetable(ctx, studentId));

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — timetable`}
        description={`${child.placement.sectionLabel} · ${child.placement.sessionName}`}
      />
      <ChildTabs studentId={studentId} active="timetable" />

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
        <EmptyState title="No timetable for this class yet">
          The school office draws the weekly timetable. It appears here as soon as they do.
        </EmptyState>
      )}
    </>
  );
}
