import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { MeetingAudience, MeetingType, UserRole } from "@/generated/prisma/enums";
import { addDays, formatDate, formatMinutes, today } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { type MeetingTimeStatus, countdownLabel, lifecycle, meetingStatus, schoolNow } from "@/lib/time-status";
import { CURRENT_EMPLOYEE, CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { MEETING_AUDIENCE_LABEL, type MeetingGroup, type MeetingInput } from "@/lib/validation/meetings";
import { getCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
import { linkExtraClass } from "@/server/support/service";

/**
 * Meetings the school office calls: parent-teacher meetings, staff meetings,
 * a talk for one class's families. This is an invitation, not a booking — the
 * office fixes the time and chooses who is invited, and nobody picks a slot.
 *
 *   * School Admin — creates, edits (while upcoming), cancels and, once
 *     cancelled, deletes; sees every meeting of their school.
 *   * Parent, student, teacher, non-teaching staff — see the meetings they are
 *     invited to, read-only, with past ones kept as history.
 *
 * Who is invited never comes from the request. Each read starts from the
 * session user and resolves their group, their (children's) sections and their
 * students from the database, and `ctx.db` keeps every query inside the
 * session's school.
 *
 * Status: only CANCELLED is stored. UPCOMING → ONGOING → COMPLETED follows
 * from the date and times on every read (`meetingStatus`), and the list
 * filters below express the same rule as SQL so paging and counts agree.
 */

type Clock = { date: Date; minutes: number };

const GROUP_FOR_ROLE: Partial<Record<UserRole, MeetingGroup>> = {
  PARENT: "PARENTS",
  STUDENT: "STUDENTS",
  TEACHER: "TEACHERS",
  NON_TEACHING_STAFF: "NON_TEACHING_STAFF",
};

export const MEETING_PAGE_SIZE = 25;

// -----------------------------------------------------------------------------
// Status as a query
// -----------------------------------------------------------------------------

/** The rows whose computed status is `status` at `clock`. Mirrors `meetingStatus`. */
export function meetingTimeWhere(status: MeetingTimeStatus, clock: Clock = schoolNow()): Prisma.MeetingWhereInput {
  const { date, minutes } = clock;
  switch (status) {
    case "CANCELLED":
      return { status: "CANCELLED" };
    case "UPCOMING":
      return { status: "SCHEDULED", OR: [{ date: { gt: date } }, { date, startMinute: { gt: minutes } }] };
    case "ONGOING":
      return { status: "SCHEDULED", date, startMinute: { lte: minutes }, OR: [{ endMinute: null }, { endMinute: { gt: minutes } }] };
    case "COMPLETED":
      return { status: "SCHEDULED", OR: [{ date: { lt: date } }, { date, endMinute: { not: null, lte: minutes } }] };
  }
}

// -----------------------------------------------------------------------------
// Who is invited
// -----------------------------------------------------------------------------

/**
 * Which meetings the signed-in user is invited to. Admins see all of their
 * school's; any role without a group sees none.
 */
export async function visibleMeetingWhere(ctx: TenantContext): Promise<Prisma.MeetingWhereInput> {
  if (ctx.user.role === "SCHOOL_ADMIN") return {};
  const group = GROUP_FOR_ROLE[ctx.user.role];
  if (!group) return { id: { in: [] } };

  const audience: Prisma.MeetingWhereInput = { audiences: { hasSome: ["ALL", group] } };
  let sectionIds: string[] = [];
  let studentIds: string[] = [];

  if (ctx.user.role === "TEACHER") {
    const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const reachable = session ? await accessibleSectionIds(ctx, session.id) : [];
    sectionIds = Array.isArray(reachable) ? reachable : [];
  } else if (ctx.user.role === "STUDENT" || ctx.user.role === "PARENT") {
    const students = await ctx.db.student.findMany({
      where: {
        ...(ctx.user.role === "STUDENT" ? { userId: ctx.user.id } : { parents: { some: { parent: { userId: ctx.user.id } } } }),
        // A child who has left brings no invitations with them.
        status: { in: [...CURRENT_STUDENT] },
      },
      select: { id: true, enrollments: { where: { academicSession: { isCurrent: true } }, select: { sectionId: true } } },
    });
    studentIds = students.map((student) => student.id);
    sectionIds = [...new Set(students.flatMap((student) => student.enrollments.map((row) => row.sectionId)))];
  }

  const byPerson: Prisma.MeetingWhereInput[] =
    ctx.user.role === "TEACHER" || ctx.user.role === "NON_TEACHING_STAFF"
      ? [{ scope: "PEOPLE", recipients: { some: { userId: ctx.user.id } } }]
      : studentIds.length
        ? [{ scope: "PEOPLE", ...audience, students: { some: { studentId: { in: studentIds } } } }]
        : [];

  return {
    OR: [
      { scope: "SCHOOL", ...audience },
      ...(sectionIds.length ? [{ scope: "SECTIONS" as const, ...audience, sections: { some: { sectionId: { in: sectionIds } } } }] : []),
      ...byPerson,
    ],
  };
}

// -----------------------------------------------------------------------------
// Shapes
// -----------------------------------------------------------------------------

const SECTION_SELECT = { name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } as const;

const MEETING_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  date: true,
  startMinute: true,
  endMinute: true,
  location: true,
  meetingLink: true,
  audiences: true,
  scope: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  sections: { select: { section: { select: SECTION_SELECT } } },
  _count: { select: { recipients: true, students: true } },
} as const satisfies Prisma.MeetingSelect;

type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof MEETING_SELECT }>;

/** "Parents + Teachers · Class 10 A" — who a meeting reaches, in words. */
export function audienceLabel(meeting: { audiences: MeetingAudience[]; scope: string; sectionLabels: string[]; people: number }): string {
  const groups = meeting.audiences.map((value) => MEETING_AUDIENCE_LABEL[value]).join(" + ");
  if (meeting.scope === "SECTIONS") return `${groups} · ${meeting.sectionLabels.join(", ")}`;
  if (meeting.scope === "PEOPLE") return `${groups} · ${meeting.people} selected`;
  return `${groups} · whole school`;
}

export function meetingTimeLabel(meeting: { startMinute: number; endMinute: number | null }): string {
  return meeting.endMinute === null ? `From ${formatMinutes(meeting.startMinute)}` : `${formatMinutes(meeting.startMinute)}–${formatMinutes(meeting.endMinute)}`;
}

function present(row: MeetingRow, clock: Clock) {
  const sectionLabels = row.sections
    .map((item) => item.section)
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => sectionLabel(section));
  const timeStatus = meetingStatus(row, clock);
  // What people see: Upcoming → Today → Completed, or Cancelled.
  const stage = lifecycle({ ...row, cancelled: row.status === "CANCELLED" }, clock);
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    date: row.date,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    time: meetingTimeLabel(row),
    location: row.location,
    meetingLink: row.meetingLink,
    audiences: row.audiences,
    scope: row.scope,
    status: row.status,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    createdBy: row.createdBy ? fullName(row.createdBy) : null,
    sectionLabels,
    audience: audienceLabel({ ...row, sectionLabels, people: row._count.recipients + row._count.students }),
    timeStatus,
    stage,
    countdown: countdownLabel(row.date, stage, clock),
    /** A meeting that has not started may be edited; a cancelled one may be edited to reschedule it. */
    canEdit: timeStatus === "UPCOMING" || timeStatus === "CANCELLED",
    canCancel: timeStatus === "UPCOMING" || timeStatus === "ONGOING",
    /** The School Admin may delete any meeting; the audit log keeps what it was. */
    canDelete: true,
  };
}

export type MeetingView = ReturnType<typeof present>;

// -----------------------------------------------------------------------------
// School Admin
// -----------------------------------------------------------------------------

export async function listMeetingsForAdmin(
  ctx: TenantContext,
  filters: { q?: string; status?: MeetingTimeStatus; type?: MeetingType; page?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const clock = schoolNow();
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.MeetingWhereInput = {
    AND: [
      filters.status ? meetingTimeWhere(filters.status, clock) : {},
      filters.type ? { type: filters.type } : {},
      filters.q
        ? {
            OR: [
              { title: { contains: filters.q, mode: "insensitive" } },
              { description: { contains: filters.q, mode: "insensitive" } },
              { location: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  // Upcoming work reads soonest first; anything else, newest first.
  const orderBy: Prisma.MeetingOrderByWithRelationInput[] =
    filters.status === "UPCOMING" || filters.status === "ONGOING"
      ? [{ date: "asc" }, { startMinute: "asc" }]
      : [{ date: "desc" }, { startMinute: "desc" }];

  const [rows, total, counts] = await Promise.all([
    ctx.db.meeting.findMany({ where, orderBy, skip: (page - 1) * MEETING_PAGE_SIZE, take: MEETING_PAGE_SIZE, select: MEETING_SELECT }),
    ctx.db.meeting.count({ where }),
    Promise.all(
      (["UPCOMING", "ONGOING", "COMPLETED", "CANCELLED"] as const).map(async (status) => [status, await ctx.db.meeting.count({ where: meetingTimeWhere(status, clock) })] as const),
    ),
  ]);
  return {
    rows: rows.map((row) => present(row, clock)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / MEETING_PAGE_SIZE)),
    counts: Object.fromEntries(counts) as Record<MeetingTimeStatus, number>,
  };
}

/** One meeting with everyone it names, for the admin's detail and edit screens. */
export async function getMeetingForAdmin(ctx: TenantContext, meetingId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.meeting.findFirst({
    where: { id: meetingId },
    select: {
      ...MEETING_SELECT,
      sections: { select: { sectionId: true, section: { select: SECTION_SELECT } } },
      recipients: {
        select: {
          user: {
            select: {
              role: true,
              firstName: true,
              lastName: true,
              teacher: { select: { id: true } },
              staffMember: { select: { id: true, role: true } },
            },
          },
        },
      },
      students: { select: { student: { select: { admissionNumber: true, firstName: true, lastName: true } } } },
    },
  });
  if (!row) throw new NotFoundError("That meeting was not found.");
  return {
    ...present(row, schoolNow()),
    sectionIds: row.sections.map((item) => item.sectionId),
    teacherIds: row.recipients.flatMap((item) => (item.user.teacher ? [item.user.teacher.id] : [])),
    staffIds: row.recipients.flatMap((item) => (item.user.staffMember ? [item.user.staffMember.id] : [])),
    people: [
      ...row.recipients.map((item) => ({
        name: fullName(item.user),
        detail: item.user.staffMember ? humanize(item.user.staffMember.role) : humanize(item.user.role),
      })),
      ...row.students.map((item) => ({ name: fullName(item.student), detail: `Student ${item.student.admissionNumber}` })),
    ],
    admissionNumbers: row.students.map((item) => item.student.admissionNumber),
  };
}

function invalid(field: string, message: string): never {
  throw new ValidationError("Please correct the highlighted fields.", { [field]: [message] });
}

const covers = (audiences: MeetingAudience[], group: MeetingGroup) => audiences.includes("ALL") || audiences.includes(group);

/**
 * Resolve the invitees inside this school. A section, teacher, staff member or
 * admission number from another school is simply not found, and the composite
 * foreign keys refuse a cross-school link even if a lookup were skipped.
 */
async function resolveTargets(ctx: TenantContext, input: MeetingInput) {
  const empty = { sectionIds: [] as string[], userIds: [] as string[], studentIds: [] as string[] };
  if (input.scope === "SCHOOL") return empty;

  if (input.scope === "SECTIONS") {
    const wanted = [...new Set(input.sectionIds)];
    const found = await ctx.db.section.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    if (found.length !== wanted.length) invalid("sectionIds", "A chosen section was not found.");
    return { ...empty, sectionIds: wanted };
  }

  // PEOPLE: each pick must belong to a group the meeting is for.
  const teacherIds = [...new Set(input.teacherIds)];
  const staffIds = [...new Set(input.staffIds)];
  if (teacherIds.length && !covers(input.audiences, "TEACHERS")) invalid("teacherIds", "Tick Teachers to invite individual teachers.");
  if (staffIds.length && !covers(input.audiences, "NON_TEACHING_STAFF")) invalid("staffIds", "Tick Non-teaching staff to invite individual staff.");
  if (input.studentAdmissionNumbers.length && !covers(input.audiences, "STUDENTS") && !covers(input.audiences, "PARENTS")) {
    invalid("studentAdmissionNumbers", "Tick Students or Parents to invite by admission number.");
  }

  const [teachers, staff, students] = await Promise.all([
    teacherIds.length ? ctx.db.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, userId: true } }) : [],
    staffIds.length
      ? ctx.db.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, userId: true, firstName: true, lastName: true } })
      : [],
    input.studentAdmissionNumbers.length
      ? ctx.db.student.findMany({
          where: { admissionNumber: { in: input.studentAdmissionNumbers, mode: "insensitive" } },
          select: { id: true, admissionNumber: true },
        })
      : [],
  ]);
  if (teachers.length !== teacherIds.length) invalid("teacherIds", "A chosen teacher was not found.");
  if (staff.length !== staffIds.length) invalid("staffIds", "A chosen staff member was not found.");
  const noLogin = staff.filter((member) => !member.userId);
  if (noLogin.length) invalid("staffIds", `${noLogin.map(fullName).join(", ")} has no login yet. Give them one under Staff first.`);

  const wanted = [...new Set(input.studentAdmissionNumbers.map((value) => value.toLowerCase()))];
  const known = new Set(students.map((student) => student.admissionNumber.toLowerCase()));
  const unknown = wanted.filter((value) => !known.has(value));
  if (unknown.length) invalid("studentAdmissionNumbers", `Not found: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "…" : ""}`);

  return {
    sectionIds: [],
    userIds: [...new Set([...teachers.map((row) => row.userId), ...staff.map((row) => row.userId!)])],
    studentIds: students.map((row) => row.id),
  };
}

/**
 * Create or edit a meeting. An upcoming meeting may change; a cancelled one
 * may be edited to reschedule it (it becomes scheduled again). Never into the
 * past, and never once it has started.
 */
export async function saveMeeting(ctx: TenantContext, input: MeetingInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const clock = schoolNow();

  let existing: { id: string; title: string; cancelled: boolean } | null = null;
  if (input.meetingId) {
    const row = await ctx.db.meeting.findFirst({
      where: { id: input.meetingId },
      select: { id: true, title: true, status: true, date: true, startMinute: true, endMinute: true },
    });
    if (!row) throw new NotFoundError("That meeting was not found.");
    const status = meetingStatus(row, clock);
    if (status !== "UPCOMING" && status !== "CANCELLED") {
      throw new ConflictError("This meeting has already started, so it can no longer be changed. You can still delete it.");
    }
    existing = { ...row, cancelled: status === "CANCELLED" };
  }

  // Today is fine; a start time that has already passed is not.
  if (input.date.getTime() < clock.date.getTime()) invalid("date", "Choose today or a later date");
  if (input.date.getTime() === clock.date.getTime() && input.startMinute <= clock.minutes) {
    invalid("startMinute", "That time has already passed today. Choose a later time.");
  }

  const targets = await resolveTargets(ctx, input);
  const session = await getCurrentSession(ctx);
  const data = {
    type: input.type,
    title: input.title,
    description: input.description,
    date: input.date,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    location: input.location,
    meetingLink: input.meetingLink,
    audiences: input.audiences,
    scope: input.scope,
  };

  const id = await ctx.db.$transaction(async (tx) => {
    let meetingId: string;
    if (existing) {
      // Saving a cancelled meeting reschedules it.
      await tx.meeting.updateMany({ where: { id: existing.id }, data: existing.cancelled ? { ...data, status: "SCHEDULED", cancelledAt: null, cancelReason: null } : data });
      await Promise.all([
        tx.meetingSection.deleteMany({ where: { meetingId: existing.id } }),
        tx.meetingRecipient.deleteMany({ where: { meetingId: existing.id } }),
        tx.meetingStudent.deleteMany({ where: { meetingId: existing.id } }),
      ]);
      meetingId = existing.id;
    } else {
      meetingId = (
        await tx.meeting.create({
          data: { ...data, schoolId: ctx.schoolId, academicSessionId: session?.id ?? null, createdById: ctx.user.id },
          select: { id: true },
        })
      ).id;
    }
    const schoolId = ctx.schoolId;
    if (targets.sectionIds.length) await tx.meetingSection.createMany({ data: targets.sectionIds.map((sectionId) => ({ schoolId, meetingId, sectionId })) });
    if (targets.userIds.length) await tx.meetingRecipient.createMany({ data: targets.userIds.map((userId) => ({ schoolId, meetingId, userId })) });
    if (targets.studentIds.length) await tx.meetingStudent.createMany({ data: targets.studentIds.map((studentId) => ({ schoolId, meetingId, studentId })) });
    return meetingId;
  });

  // An extra class for a student's support: link it back, so the support
  // record shows it and moves on.
  if (!existing && input.supportId) {
    await linkExtraClass(ctx, input.supportId, id, `${formatDate(input.date)} at ${formatMinutes(input.startMinute)}`);
  }

  await recordAudit({
    action: existing ? "MEETING_UPDATED" : "MEETING_CREATED",
    entityType: "Meeting",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Meeting "${input.title}" ${existing ? (existing.cancelled ? "rescheduled" : "updated") : "scheduled"} for ${formatDate(input.date)} at ${formatMinutes(input.startMinute)} (${input.audiences
      .map((value) => MEETING_AUDIENCE_LABEL[value])
      .join(" + ")}).`,
  });
  return id;
}

/** Call a meeting off. It stays visible to invitees, marked cancelled. */
export async function cancelMeeting(ctx: TenantContext, input: { meetingId: string; reason: string | null }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.meeting.findFirst({
    where: { id: input.meetingId },
    select: { id: true, title: true, status: true, date: true, startMinute: true, endMinute: true },
  });
  if (!row) throw new NotFoundError("That meeting was not found.");
  const status = meetingStatus(row);
  if (status === "CANCELLED") throw new ConflictError("This meeting is already cancelled.");
  if (status === "COMPLETED") throw new ConflictError("This meeting has already taken place.");

  // Conditional on it still being scheduled, so two clicks cancel once.
  const { count } = await ctx.db.meeting.updateMany({
    where: { id: row.id, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
  });
  if (!count) throw new ConflictError("This meeting is already cancelled.");
  await recordAudit({
    action: "MEETING_CANCELLED",
    entityType: "Meeting",
    entityId: row.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Meeting "${row.title}" on ${formatDate(row.date)} cancelled${input.reason ? `: ${input.reason}` : "."}`,
  });
}

/**
 * Delete a meeting — upcoming, cancelled or past — at the School Admin's
 * decision. It disappears from every invitee's list; the audit log keeps what
 * it was. A student's support record that used it as an extra class is
 * unlinked, with a note, rather than blocking the delete.
 */
export async function deleteMeeting(ctx: TenantContext, meetingId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.meeting.findFirst({ where: { id: meetingId }, select: { id: true, title: true, date: true, startMinute: true, endMinute: true, status: true } });
  if (!row) throw new NotFoundError("That meeting was not found.");
  const status = meetingStatus(row);
  await ctx.db.$transaction(async (tx) => {
    const linked = await tx.studentSupport.findMany({ where: { extraClassMeetingId: row.id }, select: { id: true } });
    if (linked.length) {
      await tx.studentSupport.updateMany({ where: { id: { in: linked.map((support) => support.id) } }, data: { extraClassMeetingId: null } });
      await tx.supportNote.createMany({
        data: linked.map((support) => ({ schoolId: ctx.schoolId, supportId: support.id, authorId: ctx.user.id, note: `The extra class "${row.title}" on ${formatDate(row.date)} was deleted by the School Admin.` })),
      });
    }
    await tx.meeting.deleteMany({ where: { id: row.id } });
  });
  await recordAudit({
    action: "MEETING_DELETED",
    entityType: "Meeting",
    entityId: row.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Meeting "${row.title}" on ${formatDate(row.date)} at ${formatMinutes(row.startMinute)} (${status.toLowerCase()}) deleted.`,
  });
}

/** Sections, teachers and staff with logins, for choosing who a meeting reaches. */
export async function meetingTargetOptions(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [sections, teachers, staff] = await Promise.all([
    ctx.db.section.findMany({ where: { academicSession: { isCurrent: true } }, select: { id: true, ...SECTION_SELECT } }),
    ctx.db.teacher.findMany({
      where: { status: { in: [...CURRENT_EMPLOYEE] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    ctx.db.staffMember.findMany({
      where: { status: { in: [...CURRENT_EMPLOYEE] }, userId: { not: null } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
  ]);
  return {
    sections: sections
      .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
      .map((section) => ({ value: section.id, label: sectionLabel(section) })),
    teachers: teachers.map((teacher) => ({ value: teacher.id, label: fullName(teacher) })),
    staff: staff.map((member) => ({ value: member.id, label: `${fullName(member)} (${humanize(member.role)})` })),
  };
}

// -----------------------------------------------------------------------------
// Invitees
// -----------------------------------------------------------------------------

/**
 * The signed-in user's meetings: what is coming up or happening now (with any
 * that were called off), and recent history.
 */
export async function myMeetings(ctx: TenantContext, options: { pastLimit?: number } = {}) {
  const visible = await visibleMeetingWhere(ctx);
  const clock = schoolNow();
  const [current, past] = await Promise.all([
    ctx.db.meeting.findMany({
      where: { AND: [visible, { date: { gte: clock.date } }] },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      take: 100,
      select: MEETING_SELECT,
    }),
    ctx.db.meeting.findMany({
      where: { AND: [visible, { date: { lt: clock.date } }] },
      orderBy: [{ date: "desc" }, { startMinute: "desc" }],
      take: options.pastLimit ?? 30,
      select: MEETING_SELECT,
    }),
  ]);
  const shown = current.map((row) => present(row, clock));
  return {
    upcoming: shown.filter((row) => row.timeStatus === "UPCOMING" || row.timeStatus === "ONGOING" || row.timeStatus === "CANCELLED"),
    // A meeting earlier today that has ended belongs with the history.
    past: [...shown.filter((row) => row.timeStatus === "COMPLETED").reverse(), ...past.map((row) => present(row, clock))],
  };
}

const ALERT_AHEAD_DAYS = 14;
const CANCEL_WINDOW_DAYS = 7;

/**
 * Meeting entries for the alert feeds (`server/alerts/feeds.ts`,
 * `server/parent/alerts.ts`): invitations in the next two weeks and ones
 * recently called off. Derived on every read like the rest of the feed —
 * creating a meeting is what notifies the people it invites.
 */
export async function meetingAlerts(ctx: TenantContext, href: string) {
  const clock = schoolNow();
  const rows = await ctx.db.meeting.findMany({
    where: {
      AND: [
        await visibleMeetingWhere(ctx),
        { date: { gte: clock.date, lte: addDays(clock.date, ALERT_AHEAD_DAYS) } },
        { OR: [{ status: "SCHEDULED" }, { cancelledAt: { gte: addDays(today(), -CANCEL_WINDOW_DAYS) } }] },
      ],
    },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    take: 5,
    select: { title: true, date: true, startMinute: true, endMinute: true, status: true, location: true },
  });
  return rows
    .map((row) => ({ ...row, timeStatus: meetingStatus(row, clock) }))
    .filter((row) => row.timeStatus !== "COMPLETED")
    .map((row) => ({
      kind: "meeting" as const,
      childId: null,
      title: row.timeStatus === "CANCELLED" ? `Cancelled: ${row.title}` : row.timeStatus === "ONGOING" ? `Happening now: ${row.title}` : `Meeting: ${row.title}`,
      detail: `${formatDate(row.date)}, ${meetingTimeLabel(row).toLowerCase()}${row.location ? ` · ${row.location}` : ""}`,
      at: row.date,
      href,
      tone: row.timeStatus === "CANCELLED" || row.date.getTime() === clock.date.getTime() ? ("warning" as const) : ("info" as const),
    }));
}

/** The dashboard's Meetings card: upcoming count, the next one, and how many are done. */
export async function meetingSummary(ctx: TenantContext) {
  const visible = await visibleMeetingWhere(ctx);
  const clock = schoolNow();
  const [{ upcoming }, completed] = await Promise.all([
    myMeetings(ctx, { pastLimit: 0 }),
    ctx.db.meeting.count({ where: { AND: [visible, { status: "SCHEDULED", date: { lt: clock.date } }] } }),
  ]);
  const coming = upcoming.filter((row) => row.stage === "UPCOMING" || row.stage === "TODAY");
  return { upcoming: coming.length, completed, next: coming[0] ?? null };
}
