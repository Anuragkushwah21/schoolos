import "server-only";

import type { AttendanceStatus, TeacherAttendanceStatus } from "@/generated/prisma/enums";
import { formatDate, today, toDateInput } from "@/lib/dates";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireSectionAccess } from "@/server/auth/teacher-access";
import { sectionLabel } from "@/server/academics/structure";
import { schoolClosureOn } from "@/server/calendar/holidays";
import { approvedLeaveOn } from "@/server/staff/leave";

/**
 * Daily attendance.
 *
 * Who may take a register is decided by `requireAttendanceAccess` — a School
 * Admin for any section, a teacher only for the section they are class
 * teacher of this session. On top of that, teachers work within a short
 * window: they can correct the last week, but rewriting last term's registers
 * is an admin's job. Reading attendance reports stays with everyone who
 * teaches the section (`requireSectionAccess`).
 *
 * Dates follow the rules of a historical record: today and earlier are
 * allowed, a future date never is. A declared holiday is refused outright —
 * the school was shut, so there is nothing to record and nothing that could
 * count as an absence. A weekly off is not refused: attendance is not
 * expected on one, but a special working Saturday can still be recorded.
 */

import { assertNotHoliday, ATTENDANCE_STATUSES, finalizeDueRegisters } from "./register";

// The student register — draft, submission, correction window — lives in
// `./register`; it is re-exported here so existing imports keep working.
export {
  ATTENDANCE_STATUSES,
  type AttendanceEntry,
  getRegister,
  markAttendance,
  saveRegisterDraft,
  TEACHER_EDIT_WINDOW_DAYS,
} from "./register";

export const STAFF_ATTENDANCE_STATUSES: TeacherAttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"];

// -----------------------------------------------------------------------------
// Staff attendance (School Admin only)
// -----------------------------------------------------------------------------

/**
 * The staff register for one day: every current teacher and non-teaching
 * staff member, with any mark and approved leave (which pre-fills ON_LEAVE).
 * Teachers and staff are kept in their own tables; `key` ("t:…" / "s:…") is
 * what the register form sends back.
 */
export async function getStaffRegister(ctx: TenantContext, date: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const [teachers, marks, leave, staff, staffMarks, staffLeave] = await Promise.all([
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true, status: true, designation: true },
    }),
    ctx.db.teacherAttendance.findMany({ where: { date }, select: { teacherId: true, status: true, remarks: true } }),
    approvedLeaveOn(ctx, date),
    ctx.db.staffMember.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true, status: true, role: true, designation: true },
    }),
    ctx.db.staffAttendance.findMany({ where: { date }, select: { staffMemberId: true, status: true, remarks: true } }),
    ctx.db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date }, staffMemberId: { not: null } },
      select: { staffMemberId: true },
    }),
  ]);

  const byTeacher = new Map(marks.map((mark) => [mark.teacherId, mark]));
  const byStaff = new Map(staffMarks.map((mark) => [mark.staffMemberId, mark]));
  const staffOnLeave = new Set(staffLeave.map((row) => row.staffMemberId));
  return [
    ...teachers.map((teacher) => ({
      key: `t:${teacher.id}`,
      kind: "TEACHER" as const,
      /** Kept for API clients that read the teachers' register. */
      teacherId: teacher.id as string | null,
      staffMemberId: null as string | null,
      name: `${teacher.firstName} ${teacher.lastName}`,
      employeeId: teacher.employeeId,
      job: teacher.designation ?? "Teacher",
      onLeave: teacher.status === "ON_LEAVE",
      status: byTeacher.get(teacher.id)?.status ?? null,
      remarks: byTeacher.get(teacher.id)?.remarks ?? null,
      /** Approved leave covering this day: the register pre-fills ON_LEAVE. */
      onApprovedLeave: leave.has(teacher.id),
    })),
    ...staff.map((member) => ({
      key: `s:${member.id}`,
      kind: "STAFF" as const,
      teacherId: null as string | null,
      staffMemberId: member.id as string | null,
      name: `${member.firstName} ${member.lastName}`,
      employeeId: member.employeeId,
      job: member.designation ?? member.role.charAt(0) + member.role.slice(1).toLowerCase().replace(/_/g, " "),
      onLeave: member.status === "ON_LEAVE",
      status: byStaff.get(member.id)?.status ?? null,
      remarks: byStaff.get(member.id)?.remarks ?? null,
      onApprovedLeave: staffOnLeave.has(member.id),
    })),
  ];
}

export type StaffAttendanceEntry = {
  teacherId?: string | null;
  staffMemberId?: string | null;
  status: TeacherAttendanceStatus;
  remarks: string | null;
};

/**
 * Save the staff register: teachers and non-teaching staff together. Each id
 * is looked up inside the admin's own school; an unknown one fails the save.
 */
export async function markStaffAttendance(
  ctx: TenantContext,
  input: { date: Date; entries: StaffAttendanceEntry[] },
): Promise<{ saved: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (input.date > today()) throw new AppError("VALIDATION", "Attendance cannot be marked for a future date.");
  await assertNotHoliday(ctx, input.date);
  if (!input.entries.length) throw new ValidationError("Mark at least one person before saving.");

  const teacherEntries = input.entries.filter((entry): entry is StaffAttendanceEntry & { teacherId: string } => Boolean(entry.teacherId));
  const staffEntries = input.entries.filter((entry): entry is StaffAttendanceEntry & { staffMemberId: string } => !entry.teacherId && Boolean(entry.staffMemberId));
  if (teacherEntries.length + staffEntries.length !== input.entries.length) throw new NotFoundError();

  const [knownTeachers, knownStaff] = await Promise.all([
    ctx.db.teacher.findMany({ where: { id: { in: teacherEntries.map((e) => e.teacherId) } }, select: { id: true } }),
    ctx.db.staffMember.findMany({ where: { id: { in: staffEntries.map((e) => e.staffMemberId) } }, select: { id: true } }),
  ]);
  const teacherIds = new Set(knownTeachers.map((t) => t.id));
  const staffIds = new Set(knownStaff.map((m) => m.id));
  if (teacherEntries.some((e) => !teacherIds.has(e.teacherId)) || staffEntries.some((e) => !staffIds.has(e.staffMemberId))) {
    throw new NotFoundError();
  }

  await ctx.db.$transaction([
    ...teacherEntries.map((entry) =>
      ctx.db.teacherAttendance.upsert({
        where: { schoolId_teacherId_date: { schoolId: ctx.schoolId, teacherId: entry.teacherId, date: input.date } },
        create: { schoolId: ctx.schoolId, teacherId: entry.teacherId, date: input.date, status: entry.status, remarks: entry.remarks },
        update: { status: entry.status, remarks: entry.remarks },
      }),
    ),
    ...staffEntries.map((entry) =>
      ctx.db.staffAttendance.upsert({
        where: { schoolId_staffMemberId_date: { schoolId: ctx.schoolId, staffMemberId: entry.staffMemberId, date: input.date } },
        create: { schoolId: ctx.schoolId, staffMemberId: entry.staffMemberId, date: input.date, status: entry.status, remarks: entry.remarks, markedByUserId: ctx.user.id },
        update: { status: entry.status, remarks: entry.remarks, markedByUserId: ctx.user.id },
      }),
    ),
  ]);

  await recordAudit({
    action: "STAFF_ATTENDANCE_MARKED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Staff attendance for ${formatDate(input.date)}: ${teacherEntries.length} teachers and ${staffEntries.length} other staff marked.`,
  });

  return { saved: input.entries.length };
}

// -----------------------------------------------------------------------------
// Summaries
// -----------------------------------------------------------------------------

export type AttendanceCounts = Record<AttendanceStatus, number> & { total: number };

export function emptyCounts(): AttendanceCounts {
  return { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, total: 0 };
}

/** Present + late, over everything marked. Excused days still count as marked. */
export function attendedShare(counts: AttendanceCounts): number | null {
  return counts.total ? (counts.PRESENT + counts.LATE) / counts.total : null;
}

/** The section and its current students, for reports (the caller has checked access). */
async function reportRoster(ctx: TenantContext, sectionId: string) {
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
      academicSession: { select: { id: true, name: true, startDate: true, endDate: true } },
      enrollments: {
        where: { status: "ACTIVE", student: { status: "ACTIVE" } },
        select: { rollNumber: true, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
      },
    },
  });
  if (!section) throw new NotFoundError();
  return {
    section: { id: section.id, label: sectionLabel(section), session: section.academicSession },
    rows: section.enrollments.map((row) => ({
      studentId: row.student.id,
      name: `${row.student.firstName} ${row.student.lastName}`,
      admissionNumber: row.student.admissionNumber,
      rollNumber: row.rollNumber,
    })),
  };
}

/**
 * Per-student totals for a section across a date range, lowest attendance
 * first — the order a class teacher wants to read it in.
 */
export async function sectionReport(ctx: TenantContext, sectionId: string, from: Date, to: Date) {
  await requireSectionAccess(ctx, sectionId);

  const [register, grouped, days] = await Promise.all([
    reportRoster(ctx, sectionId),
    ctx.db.studentAttendance.groupBy({
      by: ["studentId", "status"],
      where: { sectionId, date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["date"],
      where: { sectionId, date: { gte: from, lte: to } },
    }),
  ]);

  const counts = new Map<string, AttendanceCounts>();
  for (const row of grouped) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }

  const students = register.rows
    .map((row) => {
      const c = counts.get(row.studentId) ?? emptyCounts();
      return { ...row, counts: c, share: attendedShare(c) };
    })
    .sort((a, b) => (a.share ?? 2) - (b.share ?? 2) || a.name.localeCompare(b.name));

  const totals = students.reduce((acc, student) => {
    for (const status of ATTENDANCE_STATUSES) acc[status] += student.counts[status];
    acc.total += student.counts.total;
    return acc;
  }, emptyCounts());

  return { section: register.section, students, totals, markedDays: days.length };
}

/** One row per section of the session: how the whole school is doing. */
export async function schoolReport(ctx: TenantContext, academicSessionId: string, from: Date, to: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const [sections, grouped] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, level: true } },
        stream: { select: { name: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["sectionId", "status"],
      where: { academicSessionId, date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, AttendanceCounts>();
  for (const row of grouped) {
    const entry = counts.get(row.sectionId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.sectionId, entry);
  }

  return sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => {
      const c = counts.get(section.id) ?? emptyCounts();
      return {
        id: section.id,
        label: sectionLabel(section),
        students: section._count.enrollments,
        counts: c,
        share: attendedShare(c),
      };
    });
}

/** Today at a glance, for the admin dashboard. */
export async function todayOverview(ctx: TenantContext, academicSessionId: string) {
  // Drafts whose period has ended count as taken from now on.
  await finalizeDueRegisters(ctx);
  const date = today();
  const [sections, marked, byStatus, staff, closure] = await Promise.all([
    ctx.db.section.count({ where: { academicSessionId, enrollments: { some: { status: "ACTIVE" } } } }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId"], where: { academicSessionId, date } }),
    ctx.db.studentAttendance.groupBy({
      by: ["status"],
      where: { academicSessionId, date },
      _count: { _all: true },
    }),
    ctx.db.teacherAttendance.groupBy({ by: ["status"], where: { date }, _count: { _all: true } }),
    schoolClosureOn(ctx, date),
  ]);

  const counts = emptyCounts();
  for (const row of byStatus) {
    counts[row.status] += row._count._all;
    counts.total += row._count._all;
  }
  const staffPresent = staff
    .filter((row) => row.status === "PRESENT" || row.status === "LATE")
    .reduce((sum, row) => sum + row._count._all, 0);
  const staffMarked = staff.reduce((sum, row) => sum + row._count._all, 0);

  return {
    date,
    sections,
    sectionsMarked: marked.length,
    counts,
    staffPresent,
    staffMarked,
    /** Set on a holiday or weekly off, when no register is expected. */
    closure: closure ? { kind: closure.kind, label: closure.label } : null,
  };
}

/** A student's own record for a session, newest first, plus totals. */
export async function studentHistory(ctx: TenantContext, studentId: string, academicSessionId: string) {
  const rows = await ctx.db.studentAttendance.findMany({
    where: { studentId, academicSessionId },
    orderBy: { date: "desc" },
    select: { date: true, status: true, remarks: true },
  });
  const counts = emptyCounts();
  for (const row of rows) {
    counts[row.status] += 1;
    counts.total += 1;
  }
  return { rows, counts, share: attendedShare(counts), todayKey: toDateInput(today()) };
}
