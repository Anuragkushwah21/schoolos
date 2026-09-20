import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { dayOfWeek, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getSectionWeek, getStudentPlacement } from "@/server/people/portal";

export const metadata: Metadata = { title: "Timetable" };

export default async function StudentTimetablePage() {
  const ctx = await requireTenant("STUDENT");
  const { session, enrollment } = await getStudentPlacement(ctx);

  if (!session || !enrollment) {
    return (
      <>
        <PageHeader title="Timetable" />
        <EmptyState title="You are not placed in a class yet" />
      </>
    );
  }

  const slots = await getSectionWeek(ctx, enrollment.section.id, session.id);

  return (
    <>
      <PageHeader
        title="Your timetable"
        description={`${enrollment.section.class.name} – ${enrollment.section.name} · ${session.name}`}
      />
      <TimetableGrid
        today={dayOfWeek(today())}
        slots={slots.map((slot) => ({
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          title: slot.subject.name,
          subtitle: `${slot.teacher.firstName} ${slot.teacher.lastName}`,
          meta: slot.room,
        }))}
      />
    </>
  );
}
