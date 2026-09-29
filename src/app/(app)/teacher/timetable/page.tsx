import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { dayOfWeek, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getTeacherWeek } from "@/server/people/portal";

export const metadata: Metadata = { title: "Timetable" };

export default async function TeacherTimetablePage() {
  const ctx = await requireTenant("TEACHER");
  const week = await getTeacherWeek(ctx);

  if (!week) {
    return (
      <>
        <PageHeader title="Timetable" />
        <EmptyState title="No timetable yet.">Your periods appear here once the school office builds the timetable.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Your timetable" description={`Weekly periods for ${week.session.name}.`} />
      <TimetableGrid
        today={dayOfWeek(today())}
        slots={week.slots.map((slot) => ({
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          title: slot.subject.name,
          subtitle: `${slot.section.class.name} – ${slot.section.name}`,
          meta: slot.room,
        }))}
      />
    </>
  );
}
