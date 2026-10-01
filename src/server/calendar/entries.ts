import "server-only";

import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
import { approvedLeavesBetween } from "@/server/attendance/student-leave";
import { visibleMeetingWhere } from "@/server/communication/meetings";

/**
 * The school calendar beyond holidays: events, exams and meetings, each shown only to those it concerns.
 *
 *   * Events — published ones for everyone; the School Admin also sees drafts.
 *   * Exams — the admin sees all; a teacher, the sections they teach; a
 *     student or parent, their own (child's) section. Dates only: marks stay
 *     behind the publish switch.
 *   * Meetings — scheduled ones the user is invited to (see
 *     `visibleMeetingWhere`); every one to the admin.
 *   * Approved student leave — a marker only, for those it concerns: a
 *     parent or student their own, a class teacher their class. The admin's
 *     calendar leaves it out (the whole school's leave would bury the
 *     dates); leave itself is managed on the Leave pages, never here.
 */

export type CalendarEntry = {
  kind: "EVENT" | "EXAM" | "MEETING" | "LEAVE";
  title: string;
  startDate: Date;
  endDate: Date;
};

async function visibleSectionIds(ctx: TenantContext): Promise<string[] | "ALL"> {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
      return "ALL";
    case "TEACHER": {
      const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
      return session ? accessibleSectionIds(ctx, session.id) : [];
    }
    case "STUDENT":
    case "PARENT": {
      const rows = await ctx.db.studentEnrollment.findMany({
        where: {
          academicSession: { isCurrent: true },
          student: ctx.user.role === "STUDENT" ? { userId: ctx.user.id } : { parents: { some: { parent: { userId: ctx.user.id } } } },
        },
        select: { sectionId: true },
      });
      return rows.map((row) => row.sectionId);
    }
    default:
      return [];
  }
}

export async function getCalendarEntries(ctx: TenantContext, from: Date, to: Date): Promise<CalendarEntry[]> {
  const admin = ctx.user.role === "SCHOOL_ADMIN";
  const sections = await visibleSectionIds(ctx);
  const sectionWhere = sections === "ALL" ? {} : { sectionId: { in: sections } };

  const showLeave = ctx.user.role === "TEACHER" || ctx.user.role === "PARENT" || ctx.user.role === "STUDENT";
  const [events, exams, meetings, leaves] = await Promise.all([
    ctx.db.event.findMany({
      where: { date: { gte: from, lte: to }, ...(admin ? {} : { isPublished: true }) },
      select: { title: true, date: true },
    }),
    sections === "ALL" || sections.length
      ? ctx.db.exam.findMany({
          where: { startDate: { lte: to }, endDate: { gte: from }, ...sectionWhere },
          select: { name: true, startDate: true, endDate: true, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
    ctx.db.meeting.findMany({
      where: { AND: [await visibleMeetingWhere(ctx), { date: { gte: from, lte: to }, status: "SCHEDULED" }] },
      select: { title: true, date: true },
    }),
    showLeave ? approvedLeavesBetween(ctx, from, to) : Promise.resolve([]),
  ]);

  // One exam is created per section; show it once per name and dates.
  const examKeys = new Map<string, CalendarEntry>();
  for (const exam of exams) {
    const key = `${exam.name}|${exam.startDate.getTime()}|${exam.endDate.getTime()}`;
    const existing = examKeys.get(key);
    const label = sectionLabel(exam.section);
    if (existing) existing.title = existing.title.includes("sections") ? existing.title : `${exam.name} (several sections)`;
    else examKeys.set(key, { kind: "EXAM", title: sections === "ALL" ? `${exam.name} (${label})` : exam.name, startDate: exam.startDate, endDate: exam.endDate });
  }

  return [
    ...events.map((event) => ({ kind: "EVENT" as const, title: event.title, startDate: event.date, endDate: event.date })),
    ...examKeys.values(),
    ...meetings.map((meeting) => ({ kind: "MEETING" as const, title: meeting.title, startDate: meeting.date, endDate: meeting.date })),
    ...leaves.map((leave) => ({ kind: "LEAVE" as const, title: `${leave.student} on leave`, startDate: leave.fromDate, endDate: leave.toDate })),
  ].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}
