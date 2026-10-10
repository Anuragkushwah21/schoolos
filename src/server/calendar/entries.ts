import "server-only";

import { addDays, today } from "@/lib/dates";
import { isSchoolLeader } from "@/lib/permissions";
import { meetingStatus, schoolNow } from "@/lib/time-status";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { visibleToStream } from "@/server/academics/stream-scope";
import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
import { approvedLeavesBetween } from "@/server/attendance/student-leave";
import { audienceLabel, visibleMeetingWhere } from "@/server/communication/meetings";

/**
 * The school calendar: one read layer over the records that already have a
 * date — nothing is copied into a separate calendar table, so editing,
 * rescheduling or cancelling the record is what changes the calendar.
 *
 *   * Holidays — the whole school.
 *   * Events — published ones for everyone (the School Admin and Principal
 *     also see drafts, marked as drafts). Events have no audience of their own.
 *   * Meetings and PTMs — only for those invited (`visibleMeetingWhere`: role
 *     groups, whole school / sections / chosen people). Cancelled ones stay on
 *     the day, marked cancelled, and drop out of everything "upcoming".
 *   * Exams — dates only (marks stay behind the publish switch): leaders all;
 *     a teacher the sections they teach; a student or parent their own
 *     (child's) section.
 *   * Class tests — the same, and stream-aware: a test for one stream reaches
 *     that stream's students and parents only.
 *   * Approved student leave — a marker for the student, their parents and
 *     their class teacher (never the whole school).
 *
 * Notices are not calendar items: they are messages with a publish window,
 * not something happening on a day — they stay in Notices.
 *
 * Who sees what is decided here, on the server, from the session user.
 */

export type CalendarKind = "HOLIDAY" | "EVENT" | "MEETING" | "EXAM" | "TEST" | "LEAVE";

export type CalendarEntry = {
  /** Stable per source record (kind + id), for keys and de-duplication. */
  key: string;
  kind: CalendarKind;
  title: string;
  startDate: Date;
  endDate: Date;
  startMinute: number | null;
  endMinute: number | null;
  location: string | null;
  link: string | null;
  /** Instructions or a short description, as the source has it. */
  description: string | null;
  /** A short line under the title: "Parent-teacher meeting · Parents + Teachers", "Class 8 – A". */
  detail: string | null;
  cancelled: boolean;
  draft: boolean;
  /** Where to open it, for this role; null when there is no page for it. */
  href: string | null;
};

type Scope = { sections: "ALL" | string[]; placements: Array<{ sectionId: string; streamId: string | null }> | null };

/** The sections (and, for students and parents, the exact placements) whose dated items this user sees. */
async function scopeOf(ctx: TenantContext): Promise<Scope> {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
    case "PRINCIPAL":
      return { sections: "ALL", placements: null };
    case "TEACHER": {
      const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const reachable = session ? await accessibleSectionIds(ctx, session.id) : [];
      return { sections: reachable === "ALL" ? "ALL" : reachable, placements: null };
    }
    case "STUDENT":
    case "PARENT": {
      const rows = await ctx.db.studentEnrollment.findMany({
        where: {
          academicSession: { isCurrent: true },
          status: "ACTIVE",
          student: {
            status: { in: [...CURRENT_STUDENT] },
            ...(ctx.user.role === "STUDENT" ? { userId: ctx.user.id } : { parents: { some: { parent: { userId: ctx.user.id } } } }),
          },
        },
        select: { sectionId: true, streamId: true },
      });
      return { sections: [...new Set(rows.map((row) => row.sectionId))], placements: rows };
    }
    default:
      return { sections: [], placements: null };
  }
}

const SECTION_SELECT = { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } as const;

/**
 * Everything on the calendar between `from` and `to` (school dates,
 * inclusive) for the signed-in user. `base` is the role's area
 * ("/teacher", "/parent"…) for links.
 */
export async function getCalendarEntries(ctx: TenantContext, from: Date, to: Date, base = ""): Promise<CalendarEntry[]> {
  const leader = isSchoolLeader(ctx.user.role);
  const scope = await scopeOf(ctx);
  const sectionWhere = scope.sections === "ALL" ? {} : { sectionId: { in: scope.sections } };
  const anySections = scope.sections === "ALL" || scope.sections.length > 0;
  // A test for one stream reaches only that stream's students and parents.
  const testWhere = scope.placements
    ? { OR: scope.placements.map((placement) => ({ sectionId: placement.sectionId, ...visibleToStream(placement.streamId) })) }
    : sectionWhere;
  const showLeave = ctx.user.role === "TEACHER" || ctx.user.role === "PARENT" || ctx.user.role === "STUDENT";

  const [holidays, events, meetings, exams, tests, leaves] = await Promise.all([
    ctx.db.holiday.findMany({ where: { startDate: { lte: to }, endDate: { gte: from } }, select: { id: true, title: true, description: true, startDate: true, endDate: true } }),
    ctx.db.event.findMany({
      where: { date: { gte: from, lte: to }, ...(leader ? {} : { isPublished: true }) },
      select: { id: true, title: true, description: true, date: true, startMinute: true, endMinute: true, location: true, isPublished: true },
    }),
    ctx.db.meeting.findMany({
      where: { AND: [await visibleMeetingWhere(ctx), { date: { gte: from, lte: to } }] },
      select: { id: true, type: true, title: true, description: true, date: true, startMinute: true, endMinute: true, location: true, meetingLink: true, status: true, audiences: true, scope: true, sections: { select: { section: { select: SECTION_SELECT } } }, _count: { select: { recipients: true, students: true } } },
    }),
    anySections
      ? ctx.db.exam.findMany({ where: { startDate: { lte: to }, endDate: { gte: from }, ...sectionWhere }, select: { id: true, name: true, startDate: true, endDate: true, section: { select: SECTION_SELECT } } })
      : Promise.resolve([]),
    anySections
      ? ctx.db.assessment.findMany({ where: { examId: null, date: { gte: from, lte: to }, ...testWhere }, select: { id: true, name: true, date: true, subject: { select: { name: true } }, section: { select: SECTION_SELECT } } })
      : Promise.resolve([]),
    showLeave ? approvedLeavesBetween(ctx, from, to) : Promise.resolve([]),
  ]);

  const entries: CalendarEntry[] = [];
  const blank = { startMinute: null, endMinute: null, location: null, link: null, description: null, detail: null, cancelled: false, draft: false, href: null };

  for (const holiday of holidays) entries.push({ ...blank, key: `HOLIDAY:${holiday.id}`, kind: "HOLIDAY", title: holiday.title, startDate: holiday.startDate, endDate: holiday.endDate, description: holiday.description, detail: "School closed" });
  for (const event of events) {
    entries.push({ ...blank, key: `EVENT:${event.id}`, kind: "EVENT", title: event.title, startDate: event.date, endDate: event.date, startMinute: event.startMinute, endMinute: event.endMinute, location: event.location, description: event.description, draft: !event.isPublished, detail: event.isPublished ? "School event" : "Draft — only the office sees it", href: base ? `${leader ? "/school-admin" : base}/events/${event.id}` : null });
  }
  for (const meeting of meetings) {
    const sectionLabels = meeting.sections.map((row) => sectionLabel(row.section));
    entries.push({
      ...blank,
      key: `MEETING:${meeting.id}`,
      kind: "MEETING",
      title: meeting.title,
      startDate: meeting.date,
      endDate: meeting.date,
      startMinute: meeting.startMinute,
      endMinute: meeting.endMinute,
      location: meeting.location,
      // A link to join is no use once it is called off.
      link: meeting.status === "CANCELLED" ? null : meeting.meetingLink,
      description: meeting.description,
      cancelled: meeting.status === "CANCELLED",
      detail: `${meeting.type === "PTM" ? "Parent-teacher meeting" : "Meeting"} · ${audienceLabel({ audiences: meeting.audiences, scope: meeting.scope, sectionLabels, people: meeting._count.recipients + meeting._count.students })}`,
      href: base ? (leader ? `/school-admin/meetings/${meeting.id}` : `${base}/meetings`) : null,
    });
  }
  // One exam is created per section: shown once per name and dates.
  const examKeys = new Map<string, CalendarEntry>();
  for (const exam of exams) {
    const key = `${exam.name}|${exam.startDate.getTime()}|${exam.endDate.getTime()}`;
    const label = sectionLabel(exam.section);
    const existing = examKeys.get(key);
    if (existing) existing.detail = "Exam · several classes";
    else examKeys.set(key, { ...blank, key: `EXAM:${key}`, kind: "EXAM", title: exam.name, startDate: exam.startDate, endDate: exam.endDate, detail: `Exam · ${label}` });
  }
  entries.push(...examKeys.values());
  for (const test of tests) entries.push({ ...blank, key: `TEST:${test.id}`, kind: "TEST", title: `${test.subject.name}: ${test.name}`, startDate: test.date, endDate: test.date, detail: `Class test · ${sectionLabel(test.section)}` });
  for (const leave of leaves) entries.push({ ...blank, key: `LEAVE:${leave.student}:${leave.fromDate.getTime()}`, kind: "LEAVE", title: `${leave.student} on leave`, startDate: leave.fromDate, endDate: leave.toDate, detail: "Approved leave" });

  // Never twice: one entry per source record.
  const unique = new Map(entries.map((entry) => [entry.key, entry]));
  return [...unique.values()].sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || (a.startMinute ?? -1) - (b.startMinute ?? -1) || a.title.localeCompare(b.title));
}

/**
 * What is coming up from today (school date) for `days` days: not cancelled,
 * not a draft, and not a meeting that already ended earlier today. Used by
 * the calendar's upcoming list and the dashboard reminder.
 */
export async function upcomingEntries(ctx: TenantContext, days = 7, base = ""): Promise<CalendarEntry[]> {
  const from = today();
  const clock = schoolNow();
  const rows = await getCalendarEntries(ctx, from, addDays(from, days), base);
  return rows.filter((entry) => {
    if (entry.cancelled || entry.draft || entry.kind === "LEAVE") return false;
    if (entry.endDate < from) return false;
    if (entry.kind === "MEETING" && entry.startDate.getTime() === from.getTime()) {
      return meetingStatus({ status: "SCHEDULED", date: entry.startDate, startMinute: entry.startMinute ?? 0, endMinute: entry.endMinute }, clock) !== "COMPLETED";
    }
    return true;
  });
}
