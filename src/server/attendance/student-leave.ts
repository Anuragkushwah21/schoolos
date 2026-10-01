import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { StudentLeaveReason, StudentLeaveStatus } from "@/generated/prisma/enums";
import { spanDays } from "@/lib/calendar";
import { addDays, formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import type { StudentLeaveDecisionInput, StudentLeaveInput } from "@/lib/validation/student-leave";
import { groupLabel } from "@/server/academics/streams";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { findChild, listMyChildren } from "@/server/parent/access";

/**
 * Student leave — "Rahul will be away on 2–3 Oct, he is unwell."
 *
 *   * Raised by a parent for their own child (any class), or by a student
 *     with a login (Class 6–12) for themselves. Never mandatory for students.
 *   * Decided by the class teacher of the student's current section; the
 *     School Admin sees everything and may decide or overturn any request.
 *     No other teacher can.
 *   * Approval never writes attendance. The register shows the student as on
 *     leave; if a day was already marked, the approver is told and the
 *     register flags it — the mark changes only when someone changes it, on
 *     the register's own audit trail.
 *   * Every id from a request is re-checked against the session's school and
 *     the caller's own relationships.
 */

export const LEAVE_REASON_LABEL: Record<StudentLeaveReason, string> = {
  SICK: "Sick",
  FAMILY_FUNCTION: "Family function",
  MEDICAL_APPOINTMENT: "Medical appointment",
  PERSONAL: "Personal reason",
  TRAVEL: "Travel",
  OTHER: "Other",
};

/** No single request runs longer than this; longer absences are for the office. */
export const MAX_LEAVE_DAYS = 60;
const OPEN: StudentLeaveStatus[] = ["PENDING", "APPROVED"];

const reasonText = (row: { reason: StudentLeaveReason; reasonText: string | null }) =>
  row.reason === "OTHER" && row.reasonText ? row.reasonText : LEAVE_REASON_LABEL[row.reason];

/** The student's current placement, with the class teacher who decides their leave. */
async function currentPlacement(ctx: TenantContext, studentId: string) {
  const student = await ctx.db.student.findFirst({
    where: { id: studentId, status: { in: [...CURRENT_STUDENT] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { academicSession: { isCurrent: true }, status: "ACTIVE" },
        take: 1,
        select: {
          stream: { select: { name: true } },
          section: { select: { id: true, name: true, classTeacherId: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        },
      },
    },
  });
  const placement = student?.enrollments[0];
  if (!student || !placement) throw new NotFoundError("That student is not placed in a class this year.");
  return { student, section: placement.section, group: groupLabel(placement.section, placement.stream) };
}

// -----------------------------------------------------------------------------
// Asking
// -----------------------------------------------------------------------------

/** The children (parent) or the student themselves a request can be made for. */
export async function leaveTargets(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT", "STUDENT");
  let ids: string[];
  if (ctx.user.role === "PARENT") {
    const { children } = await listMyChildren(ctx);
    ids = children.filter((child) => child.current).map((child) => child.id);
  } else {
    const self = await ctx.db.student.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
    ids = self ? [self.id] : [];
  }
  const rows = [];
  for (const id of ids) {
    try {
      const { student, group, section } = await currentPlacement(ctx, id);
      const classTeacher = section.classTeacherId ? await ctx.db.teacher.findFirst({ where: { id: section.classTeacherId }, select: { firstName: true, lastName: true } }) : null;
      rows.push({ id: student.id, name: fullName(student), group, classTeacher: classTeacher ? fullName(classTeacher) : null });
    } catch {
      // Not placed this year: nothing to ask leave from.
    }
  }
  return rows;
}

export async function applyStudentLeave(ctx: TenantContext, input: StudentLeaveInput): Promise<{ id: string }> {
  assertRole(ctx.user, "PARENT", "STUDENT");
  // Whose leave: a parent's own child (or not found), or the student themselves — never an id they chose for someone else.
  let studentId: string;
  if (ctx.user.role === "PARENT") {
    if (!input.studentId) throw new ValidationError("Please correct the highlighted fields.", { studentId: ["Choose your child"] });
    studentId = (await findChild(ctx, input.studentId)).student.id;
  } else {
    const self = await ctx.db.student.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
    if (!self) throw new NotFoundError("Your student record was not found.");
    studentId = self.id;
  }
  const { student, section } = await currentPlacement(ctx, studentId);

  const school = await ctx.db.school.findFirst({ select: { studentLeaveBackdateDays: true } });
  const earliest = addDays(today(), -(school?.studentLeaveBackdateDays ?? 7));
  const errors: Record<string, string[]> = {};
  if (input.toDate < input.fromDate) errors.toDate = ["The end date cannot be before the start date."];
  else if (spanDays(input.fromDate, input.toDate) > MAX_LEAVE_DAYS) errors.toDate = [`One request can cover at most ${MAX_LEAVE_DAYS} days.`];
  if (input.fromDate < earliest) {
    errors.fromDate = [
      school?.studentLeaveBackdateDays
        ? `Leave can start at most ${school.studentLeaveBackdateDays} day${school.studentLeaveBackdateDays === 1 ? "" : "s"} ago (${formatDate(earliest)}). Please speak to the class teacher for older absences.`
        : "Leave can start today or later. Please speak to the class teacher for past absences.",
    ];
  }
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted fields.", errors);

  const overlapping = await ctx.db.studentLeave.findFirst({
    where: { studentId: student.id, status: { in: OPEN }, fromDate: { lte: input.toDate }, toDate: { gte: input.fromDate } },
    select: { fromDate: true, toDate: true, status: true },
  });
  if (overlapping) {
    throw new ConflictError(
      `${fullName(student)} already has a ${overlapping.status === "APPROVED" ? "approved" : "pending"} leave request for ${formatDate(overlapping.fromDate)}${overlapping.toDate > overlapping.fromDate ? `–${formatDate(overlapping.toDate)}` : ""} that overlaps these dates.`,
    );
  }

  const created = await ctx.db.studentLeave.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: student.id,
      sectionId: section.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason,
      reasonText: input.reason === "OTHER" ? input.reasonText : null,
      note: input.note,
      requestedById: ctx.user.id,
      requestedByRole: ctx.user.role,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "STUDENT_LEAVE_REQUESTED",
    entityType: "StudentLeave",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Leave requested for ${fullName(student)}, ${formatDate(input.fromDate)}–${formatDate(input.toDate)} (${LEAVE_REASON_LABEL[input.reason]}).`,
  });
  return created;
}

/** The requester withdraws a request: while pending, or before an approved leave starts. */
export async function cancelStudentLeave(ctx: TenantContext, leaveId: string): Promise<void> {
  assertRole(ctx.user, "PARENT", "STUDENT");
  const leave = await ctx.db.studentLeave.findFirst({ where: { AND: [{ id: leaveId }, await ownLeavesWhere(ctx)] }, select: { id: true, status: true, fromDate: true, student: { select: { firstName: true, lastName: true } } } });
  if (!leave) throw new NotFoundError("That leave request was not found.");
  if (!(leave.status === "PENDING" || (leave.status === "APPROVED" && leave.fromDate > today()))) {
    throw new ConflictError("Only a pending request, or an approved one that has not started yet, can be cancelled.");
  }
  await ctx.db.studentLeave.updateMany({ where: { id: leave.id, status: leave.status }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await recordAudit({ action: "STUDENT_LEAVE_CANCELLED", entityType: "StudentLeave", entityId: leave.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Leave request for ${fullName(leave.student)} cancelled.` });
}

// -----------------------------------------------------------------------------
// Deciding
// -----------------------------------------------------------------------------

/**
 * Approve or reject. The class teacher of the student's current section
 * decides pending requests; the School Admin may decide any, and may overturn
 * a decision. Returns how many days in the range already have attendance —
 * never changed here, but worth the approver's attention.
 */
export async function decideStudentLeave(ctx: TenantContext, input: StudentLeaveDecisionInput): Promise<{ markedDays: number }> {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const leave = await ctx.db.studentLeave.findFirst({
    where: { id: input.leaveId },
    select: { id: true, status: true, studentId: true, fromDate: true, toDate: true, student: { select: { firstName: true, lastName: true } } },
  });
  if (!leave) throw new NotFoundError("That leave request was not found.");
  const next: StudentLeaveStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";

  if (ctx.user.role === "TEACHER") {
    const teacher = await requireTeacherSelf(ctx);
    const { section } = await currentPlacement(ctx, leave.studentId).catch(() => ({ section: null }));
    // Same answer for another class's student and another school's request.
    if (!section || section.classTeacherId !== teacher.id) throw new NotFoundError("That leave request was not found.");
    if (leave.status !== "PENDING") throw new ConflictError("This request has already been decided. The School Admin can change the decision.");
  } else if (leave.status === "CANCELLED") {
    throw new ConflictError("This request was cancelled by the family.");
  }
  if (leave.status === next) return { markedDays: 0 };

  const { count } = await ctx.db.studentLeave.updateMany({
    where: { id: leave.id, status: leave.status },
    data: { status: next, decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: input.comment },
  });
  if (!count) throw new ConflictError("This request changed a moment ago. Refresh and try again.");

  const markedDays = next === "APPROVED" ? await ctx.db.studentAttendance.count({ where: { studentId: leave.studentId, date: { gte: leave.fromDate, lte: leave.toDate } } }) : 0;
  await recordAudit({
    action: next === "APPROVED" ? "STUDENT_LEAVE_APPROVED" : "STUDENT_LEAVE_REJECTED",
    entityType: "StudentLeave",
    entityId: leave.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Leave for ${fullName(leave.student)} ${formatDate(leave.fromDate)}–${formatDate(leave.toDate)} ${next === "APPROVED" ? "approved" : "rejected"}${leave.status !== "PENDING" ? ` (was ${leave.status.toLowerCase()})` : ""}${input.comment ? `: ${input.comment}` : ""}.`,
  });
  return { markedDays };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

async function ownLeavesWhere(ctx: TenantContext): Promise<Prisma.StudentLeaveWhereInput> {
  if (ctx.user.role === "PARENT") {
    const { children } = await listMyChildren(ctx);
    return { studentId: { in: children.map((child) => child.id) } };
  }
  const self = await ctx.db.student.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
  return { studentId: self?.id ?? "__none__" };
}

/** Admin: the school. Teacher: students of the sections they are class teacher of now. Parent: their children. Student: their own. */
async function visibleWhere(ctx: TenantContext): Promise<Prisma.StudentLeaveWhereInput> {
  if (ctx.user.role === "SCHOOL_ADMIN") return {};
  if (ctx.user.role === "TEACHER") {
    const teacher = await requireTeacherSelf(ctx);
    return { student: { enrollments: { some: { status: "ACTIVE", academicSession: { isCurrent: true }, section: { classTeacherId: teacher.id } } } } };
  }
  assertRole(ctx.user, "PARENT", "STUDENT");
  return ownLeavesWhere(ctx);
}

const LEAVE_SELECT = {
  id: true,
  fromDate: true,
  toDate: true,
  reason: true,
  reasonText: true,
  note: true,
  status: true,
  requestedByRole: true,
  decidedAt: true,
  decisionComment: true,
  createdAt: true,
  requestedBy: { select: { firstName: true, lastName: true } },
  decidedBy: { select: { firstName: true, lastName: true, role: true } },
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      enrollments: {
        where: { academicSession: { isCurrent: true } },
        take: 1,
        select: {
          stream: { select: { name: true } },
          section: { select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } }, classTeacher: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  },
} as const satisfies Prisma.StudentLeaveSelect;

export type StudentLeaveFilters = { status?: StudentLeaveStatus; q?: string; sectionId?: string; studentId?: string };

export async function listStudentLeaves(ctx: TenantContext, filters: StudentLeaveFilters = {}) {
  const where = await visibleWhere(ctx);
  const rows = await ctx.db.studentLeave.findMany({
    where: {
      AND: [
        where,
        filters.status ? { status: filters.status } : {},
        filters.studentId ? { studentId: filters.studentId } : {},
        filters.sectionId ? { student: { enrollments: { some: { sectionId: filters.sectionId, status: "ACTIVE" } } } } : {},
        filters.q
          ? { student: { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { lastName: { contains: filters.q, mode: "insensitive" } }, { admissionNumber: { contains: filters.q, mode: "insensitive" } }] } }
          : {},
      ],
    },
    orderBy: [{ fromDate: "desc" }, { createdAt: "desc" }],
    take: 300,
    select: LEAVE_SELECT,
  });
  const mayDecide = ctx.user.role === "SCHOOL_ADMIN" || ctx.user.role === "TEACHER";
  return rows.map((row) => {
    const placement = row.student.enrollments[0];
    const classTeacher = placement?.section.classTeacher ? fullName(placement.section.classTeacher) : null;
    return {
      id: row.id,
      studentId: row.student.id,
      student: fullName(row.student),
      admissionNumber: row.student.admissionNumber,
      group: placement ? groupLabel(placement.section, placement.stream) : null,
      stream: placement?.section.stream?.name ?? placement?.stream?.name ?? null,
      fromDate: row.fromDate,
      toDate: row.toDate,
      days: spanDays(row.fromDate, row.toDate),
      reason: row.reason,
      reasonLabel: reasonText(row),
      note: row.note,
      status: row.status,
      requestedBy: row.requestedBy ? `${fullName(row.requestedBy)} (${row.requestedByRole === "STUDENT" ? "student" : "parent"})` : row.requestedByRole === "STUDENT" ? "Student" : "Parent",
      requestedAt: row.createdAt,
      /** Who decided — or, while pending, who will (the class teacher). */
      approver: row.decidedBy ? fullName(row.decidedBy) : classTeacher,
      decidedByAdmin: row.decidedBy?.role === "SCHOOL_ADMIN",
      decidedAt: row.decidedAt,
      comment: row.decisionComment,
      mayDecide: mayDecide && (ctx.user.role === "SCHOOL_ADMIN" ? row.status !== "CANCELLED" : row.status === "PENDING"),
      mayCancel: !mayDecide && (row.status === "PENDING" || (row.status === "APPROVED" && row.fromDate > today())),
    };
  });
}

export type StudentLeaveRow = Awaited<ReturnType<typeof listStudentLeaves>>[number];

/**
 * Approved leave for a section's students on one day, for the register:
 * student id → reason. Only reads; the register decides nothing by itself.
 */
export async function approvedLeaveOn(ctx: TenantContext, studentIds: string[], date: Date): Promise<Map<string, string>> {
  if (!studentIds.length) return new Map();
  const rows = await ctx.db.studentLeave.findMany({
    where: { studentId: { in: studentIds }, status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date } },
    select: { studentId: true, reason: true, reasonText: true },
  });
  return new Map(rows.map((row) => [row.studentId, reasonText(row)]));
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function studentLeaveSettings(ctx: TenantContext) {
  const school = await ctx.db.school.findFirst({ select: { studentLeaveBackdateDays: true } });
  return { backdateDays: school?.studentLeaveBackdateDays ?? 7 };
}

/** School Admin: how far back a family may date a request (0 = from today). */
export async function saveStudentLeaveSettings(ctx: TenantContext, input: { backdateDays: number }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!Number.isInteger(input.backdateDays) || input.backdateDays < 0 || input.backdateDays > 60) throw new AppError("VALIDATION", "Choose 0 to 60 days.");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { studentLeaveBackdateDays: input.backdateDays } });
  await recordAudit({ action: "STUDENT_LEAVE_SETTINGS_UPDATED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Student leave may start up to ${input.backdateDays} days back.` });
}

// -----------------------------------------------------------------------------
// Alerts (the existing derived feeds)
// -----------------------------------------------------------------------------

const ALERT_DAYS = 14;

/** Class teacher: new requests waiting for them. */
export async function teacherLeaveAlerts(ctx: TenantContext) {
  const rows = await ctx.db.studentLeave.findMany({
    where: { AND: [await visibleWhere(ctx), { status: "PENDING" }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, fromDate: true, toDate: true, student: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({
    kind: "student-leave",
    childId: null,
    title: `New leave request submitted for ${fullName(row.student)}.`,
    detail: `${formatDate(row.fromDate)}${row.toDate > row.fromDate ? ` – ${formatDate(row.toDate)}` : ""}`,
    at: row.createdAt,
    href: "/teacher/student-leave",
    tone: "warning" as const,
  }));
}

/** Parent (or student): a request just approved or rejected. */
export async function familyLeaveAlerts(ctx: TenantContext, studentIds: string[], href: string) {
  if (!studentIds.length) return [];
  const rows = await ctx.db.studentLeave.findMany({
    where: { studentId: { in: studentIds }, status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { gte: addDays(today(), -ALERT_DAYS) } },
    orderBy: { decidedAt: "desc" },
    take: 10,
    select: { studentId: true, status: true, decidedAt: true, fromDate: true, toDate: true, student: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({
    kind: "student-leave" as const,
    childId: row.studentId,
    childName: row.student.firstName,
    title: `${fullName(row.student)}'s leave request has been ${row.status === "APPROVED" ? "approved" : "rejected"}.`,
    detail: `${formatDate(row.fromDate)}${row.toDate > row.fromDate ? ` – ${formatDate(row.toDate)}` : ""}`,
    at: row.decidedAt!,
    href,
    tone: row.status === "APPROVED" ? ("info" as const) : ("warning" as const),
  }));
}

/** School Admin: how many requests are waiting. */
export async function pendingLeaveCount(ctx: TenantContext): Promise<number> {
  return ctx.db.studentLeave.count({ where: { status: "PENDING" } });
}

// -----------------------------------------------------------------------------
// Dashboard card and calendar
// -----------------------------------------------------------------------------

/**
 * The dashboard's Leave card: requests by status for the leave this person
 * sees (their class, their children, or the whole school), and the one most
 * worth a look — the oldest pending request for a decider, otherwise the next
 * approved leave.
 */
export async function studentLeaveSummary(ctx: TenantContext) {
  const where = await visibleWhere(ctx);
  const [grouped, pending, approved] = await Promise.all([
    ctx.db.studentLeave.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ctx.db.studentLeave.findFirst({
      where: { AND: [where, { status: "PENDING" }] },
      orderBy: { fromDate: "asc" },
      select: { id: true, fromDate: true, toDate: true, status: true, student: { select: { firstName: true, lastName: true } } },
    }),
    ctx.db.studentLeave.findFirst({
      where: { AND: [where, { status: "APPROVED", toDate: { gte: today() } }] },
      orderBy: { fromDate: "asc" },
      select: { id: true, fromDate: true, toDate: true, status: true, student: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const count = (status: StudentLeaveStatus) => grouped.find((row) => row.status === status)?._count._all ?? 0;
  const decider = ctx.user.role === "SCHOOL_ADMIN" || ctx.user.role === "TEACHER";
  const pick = decider ? (pending ?? approved) : (approved ?? pending);
  return {
    pending: count("PENDING"),
    approved: count("APPROVED"),
    rejected: count("REJECTED"),
    highlight: pick ? { ...pick, student: fullName(pick.student) } : null,
  };
}

/** Approved leave overlapping a date range, for the calendar — only leave this person may see. */
export async function approvedLeavesBetween(ctx: TenantContext, from: Date, to: Date) {
  const where = await visibleWhere(ctx);
  const rows = await ctx.db.studentLeave.findMany({
    where: { AND: [where, { status: "APPROVED", fromDate: { lte: to }, toDate: { gte: from } }] },
    orderBy: { fromDate: "asc" },
    take: 200,
    select: { fromDate: true, toDate: true, student: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ student: fullName(row.student), fromDate: row.fromDate, toDate: row.toDate }));
}
