import "server-only";

import type { AttendanceStatus, TeacherAttendanceStatus } from "@/generated/prisma/enums";
import { addDays, formatDate, today, toDateInput } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireSectionAccess } from "@/server/auth/teacher-access";
import { sectionLabel } from "@/server/academics/structure";

/**
 * Daily attendance.
 *
 * Who may mark a register is decided by `requireSectionAccess` — a School Admin
 * for any section, a teacher only for sections they teach or are class teacher
 * of. On top of that, teachers work within a short window: they can correct
 * the last week, but rewriting last term's registers is an admin's job.
 */

export const TEACHER_EDIT_WINDOW_DAYS = 7;

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
export const STAFF_ATTENDANCE_STATUSES: TeacherAttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"];

/** Throws unless `date` is a day this user may mark for this section. */
function assertMarkableDate(
  ctx: TenantContext,
  date: Date,
  session: { name: string; startDate: Date; endDate: Date },
): void {
  const now = today();
  if (date > now) {
    throw new AppError("VALIDATION", "Attendance cannot be marked for a future date.");
  }
  if (date < session.startDate || date > session.endDate) {
    throw new AppError("VALIDATION", `${formatDate(date)} is outside the ${session.name} session.`);
  }
  if (ctx.user.role === "TEACHER" && date < addDays(now, -TEACHER_EDIT_WINDOW_DAYS)) {
    throw new ForbiddenError(
      `Teachers can mark attendance for the last ${TEACHER_EDIT_WINDOW_DAYS} days only. Ask the school office to correct older registers.`,
    );
  }
}

/** The register for one section on one day: every enrolled student and any mark. */
export async function getRegister(ctx: TenantContext, sectionId: string, date: Date) {
  await requireSectionAccess(ctx, sectionId);

  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
      academicSession: { select: { id: true, name: true, startDate: true, endDate: true } },
    },
  });
  if (!section) throw new NotFoundError();

  const [enrollments, marks] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { sectionId: section.id, status: "ACTIVE", student: { status: "ACTIVE" } },
      select: {
        rollNumber: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      },
    }),
    ctx.db.studentAttendance.findMany({
      where: { sectionId: section.id, date },
      select: {
        studentId: true,
        status: true,
        remarks: true,
        markedAt: true,
        markedBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);

  const rows = enrollments
    .sort(
      (a, b) =>
        rollOrder(a.rollNumber) - rollOrder(b.rollNumber) ||
        a.student.firstName.localeCompare(b.student.firstName),
    )
    .map((enrollment) => {
      const mark = byStudent.get(enrollment.student.id);
      return {
        studentId: enrollment.student.id,
        name: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
        admissionNumber: enrollment.student.admissionNumber,
        rollNumber: enrollment.rollNumber,
        status: mark?.status ?? null,
        remarks: mark?.remarks ?? null,
      };
    });

  const latest = marks.reduce<(typeof marks)[number] | null>(
    (acc, mark) => (!acc || mark.markedAt > acc.markedAt ? mark : acc),
    null,
  );

  let editable = true;
  let lockedReason: string | null = null;
  try {
    assertMarkableDate(ctx, date, section.academicSession);
  } catch (error) {
    editable = false;
    lockedReason = error instanceof AppError ? error.message : null;
  }

  return {
    section: { id: section.id, label: sectionLabel(section), session: section.academicSession },
    date,
    rows,
    marked: marks.length,
    lastMarked: latest
      ? {
          at: latest.markedAt,
          by: latest.markedBy ? `${latest.markedBy.firstName} ${latest.markedBy.lastName}` : null,
        }
      : null,
    editable,
    lockedReason,
  };
}

export type AttendanceEntry = { studentId: string; status: AttendanceStatus; remarks: string | null };

/**
 * Save a whole register. Every student in the submission must be enrolled in
 * the section; a forged student id — including one from another school —
 * fails the whole save rather than being silently skipped.
 */
export async function markAttendance(
  ctx: TenantContext,
  input: { sectionId: string; date: Date; entries: AttendanceEntry[] },
): Promise<{ saved: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER");
  await requireSectionAccess(ctx, input.sectionId);

  const section = await ctx.db.section.findFirst({
    where: { id: input.sectionId },
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
      academicSession: { select: { id: true, name: true, startDate: true, endDate: true } },
    },
  });
  if (!section) throw new NotFoundError();
  assertMarkableDate(ctx, input.date, section.academicSession);

  if (!input.entries.length) {
    throw new ValidationError("Mark at least one student before saving.");
  }

  const enrolled = new Set(
    (
      await ctx.db.studentEnrollment.findMany({
        where: { sectionId: section.id, status: "ACTIVE" },
        select: { studentId: true },
      })
    ).map((row) => row.studentId),
  );
  const stranger = input.entries.find((entry) => !enrolled.has(entry.studentId));
  if (stranger) throw new ForbiddenError("A student in this register is not in this section.");

  await ctx.db.$transaction(
    input.entries.map((entry) =>
      ctx.db.studentAttendance.upsert({
        where: {
          schoolId_studentId_date: { schoolId: ctx.schoolId, studentId: entry.studentId, date: input.date },
        },
        create: {
          schoolId: ctx.schoolId,
          academicSessionId: section.academicSession.id,
          studentId: entry.studentId,
          sectionId: section.id,
          date: input.date,
          status: entry.status,
          remarks: entry.remarks,
          markedByUserId: ctx.user.id,
        },
        update: {
          sectionId: section.id,
          academicSessionId: section.academicSession.id,
          status: entry.status,
          remarks: entry.remarks,
          markedByUserId: ctx.user.id,
          markedAt: new Date(),
        },
      }),
    ),
  );

  const absent = input.entries.filter((entry) => entry.status === "ABSENT").length;
  await recordAudit({
    action: "ATTENDANCE_MARKED",
    entityType: "Section",
    entityId: section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Attendance for ${sectionLabel(section)} on ${formatDate(input.date)}: ${input.entries.length} marked, ${absent} absent.`,
  });

  return { saved: input.entries.length };
}

// -----------------------------------------------------------------------------
// Staff attendance (School Admin only)
// -----------------------------------------------------------------------------

export async function getStaffRegister(ctx: TenantContext, date: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const [teachers, marks] = await Promise.all([
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true, status: true },
    }),
    ctx.db.teacherAttendance.findMany({
      where: { date },
      select: { teacherId: true, status: true, remarks: true },
    }),
  ]);

  const byTeacher = new Map(marks.map((mark) => [mark.teacherId, mark]));
  return teachers.map((teacher) => ({
    teacherId: teacher.id,
    name: `${teacher.firstName} ${teacher.lastName}`,
    employeeId: teacher.employeeId,
    onLeave: teacher.status === "ON_LEAVE",
    status: byTeacher.get(teacher.id)?.status ?? null,
    remarks: byTeacher.get(teacher.id)?.remarks ?? null,
  }));
}

export async function markStaffAttendance(
  ctx: TenantContext,
  input: {
    date: Date;
    entries: Array<{ teacherId: string; status: TeacherAttendanceStatus; remarks: string | null }>;
  },
): Promise<{ saved: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (input.date > today()) throw new AppError("VALIDATION", "Attendance cannot be marked for a future date.");
  if (!input.entries.length) throw new ValidationError("Mark at least one teacher before saving.");

  const known = new Set(
    (
      await ctx.db.teacher.findMany({
        where: { id: { in: input.entries.map((e) => e.teacherId) } },
        select: { id: true },
      })
    ).map((t) => t.id),
  );
  if (input.entries.some((entry) => !known.has(entry.teacherId))) throw new NotFoundError();

  await ctx.db.$transaction(
    input.entries.map((entry) =>
      ctx.db.teacherAttendance.upsert({
        where: { schoolId_teacherId_date: { schoolId: ctx.schoolId, teacherId: entry.teacherId, date: input.date } },
        create: {
          schoolId: ctx.schoolId,
          teacherId: entry.teacherId,
          date: input.date,
          status: entry.status,
          remarks: entry.remarks,
        },
        update: { status: entry.status, remarks: entry.remarks },
      }),
    ),
  );

  await recordAudit({
    action: "STAFF_ATTENDANCE_MARKED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Staff attendance for ${formatDate(input.date)}: ${input.entries.length} marked.`,
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

/**
 * Per-student totals for a section across a date range, lowest attendance
 * first — the order a class teacher wants to read it in.
 */
export async function sectionReport(ctx: TenantContext, sectionId: string, from: Date, to: Date) {
  await requireSectionAccess(ctx, sectionId);

  const [register, grouped, days] = await Promise.all([
    getRegister(ctx, sectionId, to),
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
  const date = today();
  const [sections, marked, byStatus, staff] = await Promise.all([
    ctx.db.section.count({ where: { academicSessionId, enrollments: { some: { status: "ACTIVE" } } } }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId"], where: { academicSessionId, date } }),
    ctx.db.studentAttendance.groupBy({
      by: ["status"],
      where: { academicSessionId, date },
      _count: { _all: true },
    }),
    ctx.db.teacherAttendance.groupBy({ by: ["status"], where: { date }, _count: { _all: true } }),
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

  return { date, sections, sectionsMarked: marked.length, counts, staffPresent, staffMarked };
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
