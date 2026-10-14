import { addDays, formatMinutes, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import type { TenantContext } from "@/server/auth/current-user";
import { sectionLabel } from "@/server/academics/structure";
import { CalendarClockIcon } from "lucide-react";

import { Panel } from "@/features/people/profile-ui";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

/** A teacher's week on the timetable and their attendance over 30 days — read from the existing records. */
export async function TeacherWeekCard({ ctx, teacherId }: { ctx: TenantContext; teacherId: string }) {
  const now = today();
  const [slots, marks] = await Promise.all([
    ctx.db.timetableSlot.findMany({ where: { teacherId, academicSession: { isCurrent: true } }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }], select: { id: true, dayOfWeek: true, startMinute: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } } }),
    ctx.db.teacherAttendance.groupBy({ by: ["status"], where: { teacherId, date: { gte: addDays(now, -30), lte: now } }, _count: { _all: true } }),
  ]);
  const total = marks.reduce((sum, row) => sum + row._count._all, 0);
  return (
    <Panel title="Timetable and attendance" icon={CalendarClockIcon} tone="cyan" description={`Periods a week: ${slots.length}. Attendance, last 30 days: ${total ? marks.map((row) => `${humanize(row.status)} ${row._count._all}`).join(" · ") : "not marked"}.`}>
        {slots.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {DAYS.filter((day) => slots.some((slot) => slot.dayOfWeek === day)).map((day) => (
              <li key={day} className="bg-muted/60 rounded-xl px-3 py-2">
                <span className="font-medium">{humanize(day)}: </span>
                <span className="text-muted-foreground">
                  {slots
                    .filter((slot) => slot.dayOfWeek === day)
                    .map((slot) => `${formatMinutes(slot.startMinute)} ${slot.subject.name} (${sectionLabel(slot.section)})`)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Not on the timetable this session.</p>
        )}
    </Panel>
  );
}
