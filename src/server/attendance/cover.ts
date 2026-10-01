import "server-only";

import type { RegisterSubmission, RegisterTiming } from "@/generated/prisma/enums";
import { addDays, formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { sectionLabel } from "@/server/academics/structure";
import { attendanceWindow, finalizeDueRegisters, registerPhase } from "@/server/attendance/register";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireStaffSelf } from "@/server/auth/staff-access";
import { requireTeacherSelf } from "@/server/auth/teacher-access";

/**
 * When someone is away, their daily work goes to someone else for the day.
 *
 *   * A section's register (`RegisterCover`): the School Admin picks any
 *     current teacher — a substitute, a subject teacher — for one section on
 *     one date. That teacher sees the register on their dashboard and may
 *     take it that day; nobody else gains anything.
 *   * A non-teaching staff member's work (`WorkCover`): the admin hands it,
 *     with a line saying what to do, to a colleague, who sees it on their
 *     dashboard next to their own work.
 *
 * Both are kept as history: who was away, who covered, who assigned it.
 */

const COVER_BACK_DAYS = 7;
const COVER_AHEAD_DAYS = 14;

function assertCoverDate(date: Date): void {
  const now = today();
  if (date < addDays(now, -COVER_BACK_DAYS) || date > addDays(now, COVER_AHEAD_DAYS)) {
    throw new AppError("VALIDATION", `Cover can be arranged from ${COVER_BACK_DAYS} days back to ${COVER_AHEAD_DAYS} days ahead.`);
  }
}

// -----------------------------------------------------------------------------
// Register cover
// -----------------------------------------------------------------------------

/** Teachers away on `date`: marked absent or on leave in the staff register, or on approved leave. */
async function teachersAway(ctx: TenantContext, date: Date): Promise<Map<string, string>> {
  const [marks, leave] = await Promise.all([
    ctx.db.teacherAttendance.findMany({ where: { date, status: { in: ["ABSENT", "ON_LEAVE"] } }, select: { teacherId: true, status: true } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date }, teacherId: { not: null } }, select: { teacherId: true, type: true } }),
  ]);
  const away = new Map<string, string>();
  for (const row of leave) if (row.teacherId) away.set(row.teacherId, `On ${humanize(row.type).toLowerCase()} leave`);
  for (const row of marks) if (!away.has(row.teacherId)) away.set(row.teacherId, row.status === "ABSENT" ? "Absent" : "On leave");
  return away;
}

/**
 * Every section this session for one day: its class teacher and whether they
 * are away, who covers the register, and whether it has been taken.
 */
export async function registerCoverBoard(ctx: TenantContext, date: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await finalizeDueRegisters(ctx);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return { sections: [], teachers: [] };

  const [sections, covers, registers, marked, away, teachers] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId: session.id, enrollments: { some: { status: "ACTIVE" } } },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, level: true } },
        stream: { select: { name: true } },
        classTeacher: { select: { id: true, firstName: true, lastName: true } },
        teacherAssignments: { where: { academicSessionId: session.id }, select: { teacherId: true } },
      },
    }),
    ctx.db.registerCover.findMany({
      where: { date },
      select: { id: true, sectionId: true, reason: true, teacher: { select: { id: true, firstName: true, lastName: true } } },
    }),
    ctx.db.attendanceRegister.findMany({
      where: { date },
      select: { sectionId: true, status: true, submittedAt: true, correctionDeadline: true, finalizeAt: true },
    }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId"], where: { date }, _max: { markedAt: true } }),
    teachersAway(ctx, date),
    ctx.db.teacher.findMany({
      where: { status: { in: [...CURRENT_EMPLOYEE] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const coverBy = new Map(covers.map((row) => [row.sectionId, row]));
  const registerBy = new Map(registers.map((row) => [row.sectionId, row]));
  const legacyBy = new Map(marked.map((row) => [row.sectionId, row._max.markedAt]));

  return {
    sections: sections
      .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
      .map((section) => {
        const cover = coverBy.get(section.id);
        const register = registerBy.get(section.id) ?? null;
        const { phase } = registerPhase(register, register ? null : (legacyBy.get(section.id) ?? null), date);
        return {
          id: section.id,
          label: sectionLabel(section),
          classTeacher: section.classTeacher ? { id: section.classTeacher.id, name: fullName(section.classTeacher) } : null,
          classTeacherAway: section.classTeacher ? (away.get(section.classTeacher.id) ?? null) : null,
          cover: cover ? { id: cover.id, teacherId: cover.teacher.id, name: fullName(cover.teacher), reason: cover.reason } : null,
          phase,
          // Teachers of this section first: they already know the children.
          suggested: [...new Set(section.teacherAssignments.map((row) => row.teacherId))],
        };
      }),
    teachers: teachers.map((row) => ({ id: row.id, name: fullName(row), away: away.get(row.id) ?? null })),
  };
}

export async function assignRegisterCover(
  ctx: TenantContext,
  input: { sectionId: string; date: Date; teacherId: string; reason: string | null },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  assertCoverDate(input.date);
  const [section, teacher] = await Promise.all([
    ctx.db.section.findFirst({
      where: { id: input.sectionId, academicSession: { isCurrent: true } },
      select: { id: true, name: true, classTeacherId: true, class: { select: { name: true } }, stream: { select: { name: true } } },
    }),
    ctx.db.teacher.findFirst({ where: { id: input.teacherId, status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  if (!section) throw new NotFoundError("That section was not found this session.");
  if (!teacher) throw new NotFoundError("That teacher was not found, or is not a current teacher.");
  if (section.classTeacherId === teacher.id) throw new ConflictError(`${fullName(teacher)} is already this section's class teacher.`);
  const away = await teachersAway(ctx, input.date);
  if (away.has(teacher.id)) throw new ConflictError(`${fullName(teacher)} is ${away.get(teacher.id)!.toLowerCase()} that day.`);

  await ctx.db.registerCover.upsert({
    where: { schoolId_sectionId_date: { schoolId: ctx.schoolId, sectionId: section.id, date: input.date } },
    create: { schoolId: ctx.schoolId, sectionId: section.id, date: input.date, teacherId: teacher.id, reason: input.reason, assignedById: ctx.user.id },
    update: { teacherId: teacher.id, reason: input.reason, assignedById: ctx.user.id },
  });
  await recordAudit({
    action: "REGISTER_COVER_ASSIGNED",
    entityType: "Section",
    entityId: section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(teacher)} takes the ${sectionLabel(section)} register on ${formatDate(input.date)}${input.reason ? ` — ${input.reason}` : ""}.`,
  });
}

export async function removeRegisterCover(ctx: TenantContext, coverId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const cover = await ctx.db.registerCover.findFirst({ where: { id: coverId }, select: { id: true, sectionId: true, date: true } });
  if (!cover) throw new NotFoundError("That cover was not found.");
  await ctx.db.registerCover.deleteMany({ where: { id: cover.id } });
  await recordAudit({
    action: "REGISTER_COVER_REMOVED",
    entityType: "Section",
    entityId: cover.sectionId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Register cover for ${formatDate(cover.date)} removed.`,
  });
}

/**
 * Who took each register, and who was away, over a range — from the
 * registers, the covers, the class-teacher history and the staff register.
 */
export async function registerHistory(ctx: TenantContext, input: { from: Date; to: Date; sectionId?: string }) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const where = { date: { gte: input.from, lte: input.to }, ...(input.sectionId ? { sectionId: input.sectionId } : {}) };
  const sectionSelect = { name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } as const;
  const [registers, covers, legacy, leads, absences, leave] = await Promise.all([
    ctx.db.attendanceRegister.findMany({
      where,
      select: {
        sectionId: true,
        date: true,
        status: true,
        submittedAt: true,
        autoSubmitted: true,
        correctionDeadline: true,
        submittedBy: { select: { firstName: true, lastName: true } },
        section: { select: sectionSelect },
      },
    }),
    ctx.db.registerCover.findMany({
      where,
      select: { sectionId: true, date: true, reason: true, teacher: { select: { firstName: true, lastName: true } }, assignedBy: { select: { firstName: true, lastName: true } }, section: { select: sectionSelect } },
    }),
    // Registers from before registers were tracked: the marks say who took them.
    ctx.db.studentAttendance.findMany({
      where,
      distinct: ["sectionId", "date"],
      orderBy: [{ date: "desc" }],
      select: { sectionId: true, date: true, markedAt: true, markedBy: { select: { firstName: true, lastName: true } }, section: { select: sectionSelect } },
    }),
    ctx.db.classTeacherAssignment.findMany({
      where: { fromDate: { lte: input.to }, OR: [{ toDate: null }, { toDate: { gte: input.from } }], ...(input.sectionId ? { sectionId: input.sectionId } : {}) },
      select: { sectionId: true, fromDate: true, toDate: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
    }),
    ctx.db.teacherAttendance.findMany({ where: { date: { gte: input.from, lte: input.to }, status: { in: ["ABSENT", "ON_LEAVE"] } }, select: { teacherId: true, date: true, status: true } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: input.to }, endDate: { gte: input.from }, teacherId: { not: null } }, select: { teacherId: true, startDate: true, endDate: true } }),
  ]);

  type Row = {
    key: string;
    sectionId: string;
    section: string;
    level: number;
    date: Date;
    classTeacher: string | null;
    classTeacherAway: string | null;
    cover: { teacher: string; reason: string | null; assignedBy: string | null } | null;
    takenBy: string | null;
    submittedAt: Date | null;
    automatically: boolean;
    status: "Submitted" | "Draft" | "Not taken";
  };
  const rows = new Map<string, Row>();
  const row = (sectionId: string, date: Date, section: { name: string; class: { name: string; level: number }; stream: { name: string } | null }): Row => {
    const key = `${sectionId}|${date.toISOString()}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const lead = leads.find((l) => l.sectionId === sectionId && l.fromDate <= date && (!l.toDate || l.toDate >= date));
    const away = lead
      ? absences.find((a) => a.teacherId === lead.teacherId && a.date.getTime() === date.getTime())?.status ??
        (leave.some((l) => l.teacherId === lead.teacherId && l.startDate <= date && l.endDate >= date) ? "ON_LEAVE" : null)
      : null;
    const fresh: Row = {
      key,
      sectionId,
      section: sectionLabel(section),
      level: section.class.level,
      date,
      classTeacher: lead ? fullName(lead.teacher) : null,
      classTeacherAway: away ? humanize(away) : null,
      cover: null,
      takenBy: null,
      submittedAt: null,
      automatically: false,
      status: "Not taken",
    };
    rows.set(key, fresh);
    return fresh;
  };
  for (const item of legacy) {
    const r = row(item.sectionId, item.date, item.section);
    r.takenBy = item.markedBy ? fullName(item.markedBy) : null;
    r.submittedAt = item.markedAt;
    r.status = "Submitted";
  }
  for (const item of registers) {
    const r = row(item.sectionId, item.date, item.section);
    r.status = item.status === "SUBMITTED" ? "Submitted" : "Draft";
    r.submittedAt = item.submittedAt ?? r.submittedAt;
    r.automatically = item.autoSubmitted;
    if (item.submittedBy) r.takenBy = fullName(item.submittedBy);
  }
  for (const item of covers) {
    const r = row(item.sectionId, item.date, item.section);
    r.cover = { teacher: fullName(item.teacher), reason: item.reason, assignedBy: item.assignedBy ? fullName(item.assignedBy) : null };
  }
  return [...rows.values()].sort((a, b) => b.date.getTime() - a.date.getTime() || a.level - b.level || a.section.localeCompare(b.section));
}

// -----------------------------------------------------------------------------
// The teacher's side
// -----------------------------------------------------------------------------

/**
 * Today's registers for the signed-in teacher: the class they lead, and any
 * the office handed them today — each with where it stands and what to do.
 */
export async function myRegistersToday(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  await finalizeDueRegisters(ctx);
  const date = today();
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return [];
  const school = await ctx.db.school.findFirst({ select: { attendanceTiming: true, attendanceSubmission: true } });

  const [own, covers] = await Promise.all([
    ctx.db.section.findMany({
      where: { classTeacherId: teacher.id, academicSessionId: session.id },
      select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
    }),
    ctx.db.registerCover.findMany({
      where: { teacherId: teacher.id, date, section: { academicSessionId: session.id } },
      select: {
        reason: true,
        section: { select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } }, classTeacher: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ]);
  const targets = [
    ...own.map((section) => ({ section, coveringFor: null as string | null, reason: null as string | null })),
    ...covers.map((cover) => ({ section: cover.section, coveringFor: cover.section.classTeacher ? fullName(cover.section.classTeacher) : "the class teacher", reason: cover.reason })),
  ];

  return Promise.all(
    targets.map(async ({ section, coveringFor, reason }) => {
      const [register, latest, window] = await Promise.all([
        ctx.db.attendanceRegister.findFirst({ where: { sectionId: section.id, date }, select: { status: true, submittedAt: true, correctionDeadline: true, finalizeAt: true, autoSubmitted: true } }),
        ctx.db.studentAttendance.findFirst({ where: { sectionId: section.id, date }, orderBy: { markedAt: "desc" }, select: { markedAt: true } }),
        attendanceWindow(ctx.db, { sectionId: section.id, academicSessionId: session.id, date, timing: school?.attendanceTiming ?? "FIRST_PERIOD" }),
      ]);
      const { phase, deadline } = registerPhase(register, register ? null : (latest?.markedAt ?? null), date);
      return {
        sectionId: section.id,
        label: sectionLabel(section),
        coveringFor,
        reason,
        phase,
        deadline,
        finalizeAt: register?.status === "DRAFT" ? register.finalizeAt : null,
        opensAt: window.opensAt,
        autoSubmitted: register?.autoSubmitted ?? false,
        submission: school?.attendanceSubmission ?? "AUTO",
      };
    }),
  );
}

// -----------------------------------------------------------------------------
// Non-teaching staff work cover
// -----------------------------------------------------------------------------

export async function workCoverBoard(ctx: TenantContext, date: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [staff, onLeave, covers, marked] = await Promise.all([
    ctx.db.staffMember.findMany({
      where: { status: { in: [...CURRENT_EMPLOYEE] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, role: true, designation: true },
    }),
    ctx.db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date }, staffMemberId: { not: null } },
      select: { staffMemberId: true, type: true },
    }),
    ctx.db.workCover.findMany({
      where: { date },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        duties: true,
        absentStaff: { select: { id: true, firstName: true, lastName: true, role: true } },
        coverStaff: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    // Marked absent or on leave in the staff register that day.
    ctx.db.staffAttendance.findMany({ where: { date, status: { in: ["ABSENT", "ON_LEAVE"] } }, select: { staffMemberId: true, status: true } }),
  ]);
  const leaveBy = new Map(onLeave.map((row) => [row.staffMemberId!, `On ${humanize(row.type).toLowerCase()} leave`]));
  for (const row of marked) if (!leaveBy.has(row.staffMemberId)) leaveBy.set(row.staffMemberId, row.status === "ABSENT" ? "Absent" : "On leave");
  return {
    staff: staff.map((row) => ({ id: row.id, name: fullName(row), job: row.designation ?? humanize(row.role), away: leaveBy.get(row.id) ?? null })),
    covers: covers.map((row) => ({
      id: row.id,
      duties: row.duties,
      absent: { id: row.absentStaff.id, name: fullName(row.absentStaff), job: humanize(row.absentStaff.role) },
      cover: { id: row.coverStaff.id, name: fullName(row.coverStaff) },
      assignedBy: row.assignedBy ? fullName(row.assignedBy) : null,
    })),
  };
}

export async function assignWorkCover(
  ctx: TenantContext,
  input: { date: Date; absentStaffMemberId: string; coverStaffMemberId: string; duties: string },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  assertCoverDate(input.date);
  if (input.absentStaffMemberId === input.coverStaffMemberId) throw new AppError("VALIDATION", "Choose a different colleague to cover the work.");
  const [absent, cover] = await Promise.all([
    ctx.db.staffMember.findFirst({ where: { id: input.absentStaffMemberId }, select: { id: true, firstName: true, lastName: true } }),
    ctx.db.staffMember.findFirst({ where: { id: input.coverStaffMemberId, status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  if (!absent || !cover) throw new NotFoundError("That staff member was not found.");
  const coverAway = await ctx.db.leaveRequest.count({
    where: { staffMemberId: cover.id, status: "APPROVED", startDate: { lte: input.date }, endDate: { gte: input.date } },
  });
  if (coverAway) throw new ConflictError(`${fullName(cover)} is on leave that day.`);

  await ctx.db.workCover.upsert({
    where: {
      schoolId_date_absentStaffMemberId_coverStaffMemberId: {
        schoolId: ctx.schoolId,
        date: input.date,
        absentStaffMemberId: absent.id,
        coverStaffMemberId: cover.id,
      },
    },
    create: { schoolId: ctx.schoolId, date: input.date, absentStaffMemberId: absent.id, coverStaffMemberId: cover.id, duties: input.duties, assignedById: ctx.user.id },
    update: { duties: input.duties, assignedById: ctx.user.id },
  });
  await recordAudit({
    action: "WORK_COVER_ASSIGNED",
    entityType: "StaffMember",
    entityId: absent.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(cover)} covers ${fullName(absent)}'s work on ${formatDate(input.date)}: ${input.duties}`,
  });
}

export async function removeWorkCover(ctx: TenantContext, coverId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const cover = await ctx.db.workCover.findFirst({ where: { id: coverId }, select: { id: true, absentStaffMemberId: true, date: true } });
  if (!cover) throw new NotFoundError("That cover was not found.");
  await ctx.db.workCover.deleteMany({ where: { id: cover.id } });
  await recordAudit({
    action: "WORK_COVER_REMOVED",
    entityType: "StaffMember",
    entityId: cover.absentStaffMemberId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Work cover for ${formatDate(cover.date)} removed.`,
  });
}

export async function workCoverHistory(ctx: TenantContext, input: { from: Date; to: Date }) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.workCover.findMany({
    where: { date: { gte: input.from, lte: input.to } },
    orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    take: 300,
    select: {
      id: true,
      date: true,
      duties: true,
      absentStaff: { select: { firstName: true, lastName: true, role: true } },
      coverStaff: { select: { firstName: true, lastName: true } },
      assignedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    duties: row.duties,
    absent: `${fullName(row.absentStaff)} (${humanize(row.absentStaff.role)})`,
    cover: fullName(row.coverStaff),
    assignedBy: row.assignedBy ? fullName(row.assignedBy) : null,
  }));
}

/** The signed-in staff member's extra work today, covering for colleagues. */
export async function myWorkCoversToday(ctx: TenantContext) {
  const staff = await requireStaffSelf(ctx);
  const rows = await ctx.db.workCover.findMany({
    where: { coverStaffMemberId: staff.id, date: today() },
    select: { id: true, duties: true, absentStaff: { select: { firstName: true, lastName: true, role: true, designation: true } } },
  });
  return rows.map((row) => ({ id: row.id, duties: row.duties, for: fullName(row.absentStaff), job: row.absentStaff.designation ?? humanize(row.absentStaff.role) }));
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function attendanceSettings(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const school = await ctx.db.school.findFirst({ select: { attendanceTiming: true, attendanceSubmission: true } });
  return { timing: school?.attendanceTiming ?? "FIRST_PERIOD", submission: school?.attendanceSubmission ?? "AUTO" };
}

export async function saveAttendanceSettings(ctx: TenantContext, input: { timing: RegisterTiming; submission: RegisterSubmission }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.school.updateMany({ data: { attendanceTiming: input.timing, attendanceSubmission: input.submission } });
  await recordAudit({
    action: "ATTENDANCE_SETTINGS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Attendance set to ${humanize(input.timing).toLowerCase()}, ${input.submission === "AUTO" ? "submitted automatically" : "submitted by the teacher"}.`,
  });
}
