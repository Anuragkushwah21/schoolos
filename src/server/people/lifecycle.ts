import "server-only";

import type { LoginDisabledReason, PersonKind, StudentStatus, TeacherStatus } from "@/generated/prisma/enums";
import { formatDate, today } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import {
  CURRENT_STUDENT,
  EMPLOYEE_LIFECYCLE,
  LEFT_EMPLOYEE,
  LEFT_STUDENT,
  type LoginAccessInput,
  STUDENT_LIFECYCLE,
  employeeMaySignIn,
  loginState,
  studentMaySignIn,
} from "@/lib/validation/lifecycle";
import { setClassTeacher } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { invalidateAllSessionsForUser } from "@/server/auth/session";
import { assertWithinPlanLimit } from "@/server/platform/limits";

/**
 * People lifecycle: JOIN → ACTIVE → status change → access → history kept.
 *
 * Every status change for a student, teacher or staff member — from the
 * "Change status" dialog, the edit form, a bulk action or the API — comes
 * through here, so each one records when it took effect and why, closes or
 * reopens the login the same way, and leaves a `StatusChange` row behind.
 *
 * Nothing here deletes anyone. Registers, marks, homework, fees, salary,
 * lessons and remarks keep pointing at the person exactly as they were, so a
 * year taught by a teacher who has since left still says it was theirs.
 *
 * Status and login are separate. Leaving closes the login with reason STATUS
 * ("locked"); coming back reopens only a login that was closed that way. A
 * login the office closed on purpose (reason ADMIN) stays closed until the
 * office reopens it. School Admin only; the school always comes from `ctx`.
 */

type ChangeOptions = {
  effectiveDate: Date;
  reason: string | null;
  remarks: string | null;
  /** Bringing back someone who had left must be meant, not clicked by accident. */
  confirmReturn: boolean;
};

export type StatusChangeResult = {
  from: string;
  to: string;
  login: "closed" | "reopened" | "unchanged";
  /** For a teacher or staff member who left: what the office should hand over. */
  handover?: { periods: number; subjects: number; classTeacherRemoved: number; routesCleared: number };
};

function checkDate(effectiveDate: Date): void {
  // A change is recorded as it happens or after the fact, never in advance:
  // the status takes effect now, so a future date would contradict it.
  if (effectiveDate.getTime() > today().getTime()) {
    throw new ValidationError("Please correct the highlighted fields.", { effectiveDate: ["Choose today or an earlier date"] });
  }
}

type LoginRow = { id: string; isActive: boolean; disabledReason: LoginDisabledReason | null } | null;

/**
 * Close or reopen a login to match a new status. Returns what happened so the
 * caller can record it. Runs inside the caller's transaction.
 */
async function syncLoginToStatus(
  tx: Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0],
  user: LoginRow,
  maySignIn: boolean,
): Promise<"closed" | "reopened" | "unchanged"> {
  if (!user) return "unchanged";
  if (!maySignIn && user.isActive) {
    await tx.user.updateMany({ where: { id: user.id }, data: { isActive: false, disabledReason: "STATUS", disabledAt: new Date() } });
    return "closed";
  }
  if (maySignIn && !user.isActive && user.disabledReason === "STATUS") {
    await tx.user.updateMany({ where: { id: user.id }, data: { isActive: true, disabledReason: null, disabledAt: null } });
    return "reopened";
  }
  return "unchanged";
}

const USER_SELECT = { select: { id: true, isActive: true, disabledReason: true } } as const;

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

/** Where the current-session placement goes when a student leaves. */
const ENROLLMENT_ON_LEAVING: Record<string, "TRANSFERRED" | "WITHDRAWN" | "COMPLETED"> = {
  TRANSFERRED: "TRANSFERRED",
  WITHDRAWN: "WITHDRAWN",
  INACTIVE: "WITHDRAWN",
  GRADUATED: "COMPLETED",
};

export async function changeStudentStatus(
  ctx: TenantContext,
  studentId: string,
  status: StudentStatus,
  options: ChangeOptions,
): Promise<StatusChangeResult> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!(STUDENT_LIFECYCLE as readonly string[]).includes(status)) throw new ValidationError("Please correct the highlighted fields.", { status: ["Choose a student status"] });
  checkDate(options.effectiveDate);

  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: { id: true, firstName: true, lastName: true, status: true, user: USER_SELECT },
  });
  if (!student) throw new NotFoundError("That student was not found.");
  if (student.status === status) throw new ConflictError(`${fullName(student)} is already ${humanize(status).toLowerCase()}.`);

  const wasLeft = (LEFT_STUDENT as readonly string[]).includes(student.status);
  const leaving = (LEFT_STUDENT as readonly string[]).includes(status);
  if (wasLeft && !leaving && !options.confirmReturn) {
    throw new ValidationError("Please correct the highlighted fields.", {
      confirmReturn: [`${fullName(student)} has left the school. Tick the box to confirm they are coming back.`],
    });
  }
  if (status === "ACTIVE" && student.status !== "ACTIVE") await assertWithinPlanLimit(ctx, "students");

  const login = await ctx.db.$transaction(async (tx) => {
    await tx.student.updateMany({ where: { id: student.id }, data: { status } });

    // The current year's placement follows: a student who left is no longer
    // on this year's registers; one who returns is back on them. Earlier
    // years' placements are history and are never touched.
    const current = await tx.studentEnrollment.findFirst({
      where: { studentId: student.id, academicSession: { isCurrent: true } },
      select: { id: true, status: true },
    });
    if (current && leaving && current.status === "ACTIVE") {
      await tx.studentEnrollment.updateMany({ where: { id: current.id }, data: { status: ENROLLMENT_ON_LEAVING[status] } });
    } else if (current && !leaving && current.status !== "ACTIVE") {
      await tx.studentEnrollment.updateMany({ where: { id: current.id }, data: { status: "ACTIVE" } });
    }
    // A child who left no longer rides the school bus. Resuming it is a
    // separate decision, so returning does not restart it.
    if (leaving) await tx.studentTransport.updateMany({ where: { studentId: student.id, status: "ACTIVE" }, data: { status: "SUSPENDED" } });

    const loginChange = await syncLoginToStatus(tx, student.user, studentMaySignIn(status));
    await recordChanges(tx, ctx, { person: "STUDENT", studentId: student.id }, student.status, status, loginChange, options);
    return loginChange;
  });

  if (login === "closed" && student.user) await invalidateAllSessionsForUser(student.user.id);
  await auditChange(ctx, "Student", student.id, fullName(student), student.status, status, login, options);
  return { from: student.status, to: status, login };
}

// -----------------------------------------------------------------------------
// Teachers and non-teaching staff
// -----------------------------------------------------------------------------

export async function changeEmployeeStatus(
  ctx: TenantContext,
  person: "TEACHER" | "STAFF",
  personId: string,
  status: TeacherStatus,
  options: ChangeOptions,
): Promise<StatusChangeResult> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!(EMPLOYEE_LIFECYCLE as readonly string[]).includes(status)) throw new ValidationError("Please correct the highlighted fields.", { status: ["Choose an employment status"] });
  checkDate(options.effectiveDate);

  const row =
    person === "TEACHER"
      ? await ctx.db.teacher.findFirst({ where: { id: personId }, select: { id: true, firstName: true, lastName: true, status: true, user: USER_SELECT } })
      : await ctx.db.staffMember.findFirst({ where: { id: personId }, select: { id: true, firstName: true, lastName: true, status: true, user: USER_SELECT } });
  if (!row) throw new NotFoundError(person === "TEACHER" ? "That teacher was not found." : "That staff member was not found.");
  if (row.status === status) throw new ConflictError(`${fullName(row)} is already ${humanize(status).toLowerCase()}.`);

  const wasLeft = (LEFT_EMPLOYEE as readonly string[]).includes(row.status);
  const leaving = (LEFT_EMPLOYEE as readonly string[]).includes(status);
  if (wasLeft && !leaving && !options.confirmReturn) {
    throw new ValidationError("Please correct the highlighted fields.", {
      confirmReturn: [`${fullName(row)} has left the school. Tick the box to confirm they are coming back.`],
    });
  }
  if (person === "TEACHER" && employeeMaySignIn(status) && !employeeMaySignIn(row.status)) await assertWithinPlanLimit(ctx, "teachers");

  const login = await ctx.db.$transaction(async (tx) => {
    if (person === "TEACHER") await tx.teacher.updateMany({ where: { id: row.id }, data: { status } });
    else await tx.staffMember.updateMany({ where: { id: row.id }, data: { status } });
    const loginChange = await syncLoginToStatus(tx, row.user, employeeMaySignIn(status));
    await recordChanges(tx, ctx, person === "TEACHER" ? { person, teacherId: row.id } : { person, staffMemberId: row.id }, row.status, status, loginChange, options);
    return loginChange;
  });
  if (login === "closed" && row.user) await invalidateAllSessionsForUser(row.user.id);

  let handover: StatusChangeResult["handover"];
  if (leaving && !wasLeft) handover = person === "TEACHER" ? await releaseTeacher(ctx, row.id) : await releaseStaff(ctx, row.id);

  await auditChange(ctx, person === "TEACHER" ? "Teacher" : "StaffMember", row.id, fullName(row), row.status, status, login, options);
  return { from: row.status, to: status, login, handover };
}

/**
 * A teacher who has left stops being class teacher this year (the dated
 * history in `ClassTeacherAssignment` records the handover), and the office is
 * told which of this year's periods and subjects still name them, so it can
 * assign someone else. Those rows are left as they are: they are this year's
 * record of who taught what, and lessons already held keep their teacher.
 */
async function releaseTeacher(ctx: TenantContext, teacherId: string) {
  const sections = await ctx.db.section.findMany({
    where: { classTeacherId: teacherId, academicSession: { isCurrent: true } },
    select: { id: true },
  });
  for (const section of sections) await setClassTeacher(ctx, { sectionId: section.id, teacherId: null });
  const [periods, subjects] = await Promise.all([
    ctx.db.timetableSlot.count({ where: { teacherId, academicSession: { isCurrent: true } } }),
    ctx.db.teacherSubjectAssignment.count({ where: { teacherId, academicSession: { isCurrent: true } } }),
  ]);
  return { periods, subjects, classTeacherRemoved: sections.length, routesCleared: 0 };
}

/** A staff member who left no longer drives or attends a bus route. */
async function releaseStaff(ctx: TenantContext, staffId: string) {
  const [drivers, attendants] = await Promise.all([
    ctx.db.transportRoute.updateMany({ where: { driverId: staffId }, data: { driverId: null } }),
    ctx.db.transportRoute.updateMany({ where: { attendantId: staffId }, data: { attendantId: null } }),
  ]);
  return { periods: 0, subjects: 0, classTeacherRemoved: 0, routesCleared: drivers.count + attendants.count };
}

// -----------------------------------------------------------------------------
// Login access, separately from status
// -----------------------------------------------------------------------------

type PersonRef = { person: PersonKind; studentId?: string; parentId?: string; teacherId?: string; staffMemberId?: string };

async function findPerson(ctx: TenantContext, person: PersonKind, personId: string) {
  const select = { id: true, firstName: true, lastName: true, user: USER_SELECT } as const;
  switch (person) {
    case "STUDENT": {
      const row = await ctx.db.student.findFirst({ where: { id: personId }, select: { ...select, status: true } });
      return row ? { ...row, ref: { person, studentId: row.id } as PersonRef, maySignIn: studentMaySignIn(row.status) } : null;
    }
    case "TEACHER": {
      const row = await ctx.db.teacher.findFirst({ where: { id: personId }, select: { ...select, status: true } });
      return row ? { ...row, ref: { person, teacherId: row.id } as PersonRef, maySignIn: employeeMaySignIn(row.status) } : null;
    }
    case "STAFF": {
      const row = await ctx.db.staffMember.findFirst({ where: { id: personId }, select: { ...select, status: true } });
      return row ? { ...row, ref: { person, staffMemberId: row.id } as PersonRef, maySignIn: employeeMaySignIn(row.status) } : null;
    }
    case "PARENT": {
      // A guardian's login does not depend on their children: a parent whose
      // children have all left may still sign in, and sees no current data.
      const row = await ctx.db.parent.findFirst({ where: { id: personId }, select });
      return row ? { ...row, status: "ACTIVE" as const, ref: { person, parentId: row.id } as PersonRef, maySignIn: true } : null;
    }
  }
}

/** Open or close someone's login, without touching their status. */
export async function setLoginAccess(ctx: TenantContext, input: LoginAccessInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await findPerson(ctx, input.person, input.personId);
  if (!row) throw new NotFoundError("That person was not found.");
  if (!row.user) throw new ConflictError(`${fullName(row)} has no login yet.`);
  const before = loginState(row.user);

  if (input.enabled) {
    if (row.user.isActive) throw new ConflictError("This login is already active.");
    // A login never outranks the school's own decision about the person.
    if (!row.maySignIn) throw new ConflictError(`${fullName(row)} is ${humanize(row.status).toLowerCase()}. Change their status first, then enable the login.`);
  } else if (!row.user.isActive) {
    throw new ConflictError("This login is already switched off.");
  }

  await ctx.db.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { id: row.user!.id },
      data: input.enabled ? { isActive: true, disabledReason: null, disabledAt: null } : { isActive: false, disabledReason: "ADMIN", disabledAt: new Date() },
    });
    await tx.statusChange.create({
      data: {
        schoolId: ctx.schoolId,
        ...row.ref,
        kind: "LOGIN",
        fromValue: before,
        toValue: input.enabled ? "ACTIVE" : "DISABLED",
        effectiveDate: today(),
        reason: input.reason,
        changedById: ctx.user.id,
      },
    });
  });
  if (!input.enabled) await invalidateAllSessionsForUser(row.user.id);

  await recordAudit({
    action: "LOGIN_ACCESS_CHANGED",
    entityType: row.ref.person === "STAFF" ? "StaffMember" : humanize(row.ref.person),
    entityId: row.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Login for ${fullName(row)}: ${before} → ${input.enabled ? "ACTIVE" : "DISABLED"}${input.reason ? ` (${input.reason})` : ""}.`,
  });
}

// -----------------------------------------------------------------------------
// History and summaries
// -----------------------------------------------------------------------------

async function recordChanges(
  tx: Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0],
  ctx: TenantContext,
  ref: PersonRef,
  from: string,
  to: string,
  login: "closed" | "reopened" | "unchanged",
  options: ChangeOptions,
): Promise<void> {
  const base = { schoolId: ctx.schoolId, ...ref, effectiveDate: options.effectiveDate, changedById: ctx.user.id };
  await tx.statusChange.create({ data: { ...base, kind: "STATUS", fromValue: from, toValue: to, reason: options.reason, remarks: options.remarks } });
  if (login !== "unchanged") {
    await tx.statusChange.create({
      data: {
        ...base,
        kind: "LOGIN",
        fromValue: login === "closed" ? "ACTIVE" : "LOCKED",
        toValue: login === "closed" ? "LOCKED" : "ACTIVE",
        reason: `Status changed to ${humanize(to)}`,
      },
    });
  }
}

async function auditChange(
  ctx: TenantContext,
  entityType: string,
  entityId: string,
  name: string,
  from: string,
  to: string,
  login: "closed" | "reopened" | "unchanged",
  options: ChangeOptions,
): Promise<void> {
  await recordAudit({
    action: "PERSON_STATUS_CHANGED",
    entityType,
    entityId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${name}: ${from} → ${to} from ${formatDate(options.effectiveDate)}${options.reason ? ` (${options.reason})` : ""}${
      login === "closed" ? "; login ACTIVE → LOCKED" : login === "reopened" ? "; login LOCKED → ACTIVE" : ""
    }.`,
  });
}

export type PersonHistoryEntry = {
  id: string;
  kind: "STATUS" | "LOGIN";
  from: string;
  to: string;
  effectiveDate: Date;
  reason: string | null;
  remarks: string | null;
  changedBy: string | null;
  at: Date;
};

/** Everything the office needs on a profile: status, login, when they left, and the history. */
export async function personLifecycle(ctx: TenantContext, person: PersonKind, personId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await findPerson(ctx, person, personId);
  if (!row) throw new NotFoundError("That person was not found.");
  const where =
    person === "STUDENT" ? { studentId: row.id } : person === "TEACHER" ? { teacherId: row.id } : person === "STAFF" ? { staffMemberId: row.id } : { parentId: row.id };
  const changes = await ctx.db.statusChange.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      kind: true,
      fromValue: true,
      toValue: true,
      effectiveDate: true,
      reason: true,
      remarks: true,
      createdAt: true,
      changedBy: { select: { firstName: true, lastName: true } },
    },
  });
  const left = person === "STUDENT" ? LEFT_STUDENT : LEFT_EMPLOYEE;
  const leftOn = (left as readonly string[]).includes(row.status)
    ? (changes.find((change) => change.kind === "STATUS" && change.toValue === row.status)?.effectiveDate ?? null)
    : null;
  return {
    name: fullName(row),
    status: row.status,
    maySignIn: row.maySignIn,
    login: loginState(row.user),
    leftOn,
    history: changes.map(
      (change): PersonHistoryEntry => ({
        id: change.id,
        kind: change.kind,
        from: change.fromValue,
        to: change.toValue,
        effectiveDate: change.effectiveDate,
        reason: change.reason,
        remarks: change.remarks,
        changedBy: change.changedBy ? fullName(change.changedBy) : null,
        at: change.createdAt,
      }),
    ),
  };
}

/**
 * When each listed person left, for "Transferred · left 28 Sep 2026" in
 * search results. One query for a whole page of rows.
 */
export async function leavingDates(ctx: TenantContext, person: "STUDENT" | "TEACHER" | "STAFF", rows: Array<{ id: string; status: string }>): Promise<Map<string, Date>> {
  const left = person === "STUDENT" ? LEFT_STUDENT : LEFT_EMPLOYEE;
  const ids = rows.filter((row) => (left as readonly string[]).includes(row.status)).map((row) => row.id);
  if (!ids.length) return new Map();
  const field = person === "STUDENT" ? "studentId" : person === "TEACHER" ? "teacherId" : "staffMemberId";
  const changes = await ctx.db.statusChange.findMany({
    where: { kind: "STATUS", [field]: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { studentId: true, teacherId: true, staffMemberId: true, toValue: true, effectiveDate: true },
  });
  const statusOf = new Map(rows.map((row) => [row.id, row.status]));
  const result = new Map<string, Date>();
  for (const change of changes) {
    const key = change.studentId ?? change.teacherId ?? change.staffMemberId;
    if (key && !result.has(key) && statusOf.get(key) === change.toValue) result.set(key, change.effectiveDate);
  }
  return result;
}

/**
 * A guardian's standing, worked out from their children rather than stored:
 * ACTIVE while any child is a current student, NO_ACTIVE_CHILDREN once none is.
 */
export function parentStanding(children: Array<{ status: string }>): "ACTIVE" | "NO_ACTIVE_CHILDREN" {
  return children.some((child) => (CURRENT_STUDENT as readonly string[]).includes(child.status)) ? "ACTIVE" : "NO_ACTIVE_CHILDREN";
}

/**
 * Head counts by status for the reports page — current and former kept
 * apart, so "active students" never quietly includes those who have left.
 */
export async function peopleSummary(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [students, teachers, staff] = await Promise.all([
    ctx.db.student.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.db.teacher.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.db.staffMember.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const shape = (rows: Array<{ status: string; _count: { _all: number } }>, current: readonly string[]) => {
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Record<string, number>;
    const total = (statuses: readonly string[]) => statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
    const all = rows.reduce((sum, row) => sum + row._count._all, 0);
    return { byStatus, current: total(current), former: all - total(current) };
  };
  return {
    students: shape(students, CURRENT_STUDENT),
    teachers: shape(teachers, ["ACTIVE", "ON_LEAVE"]),
    staff: shape(staff, ["ACTIVE", "ON_LEAVE"]),
  };
}
