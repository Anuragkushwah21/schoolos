import "server-only";

import type { AdmissionStatus } from "@/generated/prisma/enums";
import {
  ADMISSION_TASKS,
  type AdmissionTask,
  type AssignmentState,
  CAPACITY_STATUSES,
  PENDING_STATUSES,
  TEACHER_EDITABLE,
  assignmentState,
  cleanTasks,
  driveState,
} from "@/lib/admission-drives";
import { formatDate, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { streamProblem, streamRuleForLevel } from "@/lib/stream-rules";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import type { AssignmentInput, DriveApplicationInput, DriveInput } from "@/lib/validation/admission-drives";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { staffHolds } from "@/server/auth/staff-access";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { isUniqueViolation } from "@/server/db/errors";
import { deleteStoredFile, readStoredFile, storeDocument, validateDocument } from "@/server/storage/files";
import { assertCan } from "@/server/auth/permissions";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * Admission drives: the School Admin opens admissions for a session, hands
 * classes (or sections) to teachers with their own dates, capacity and
 * permissions, and keeps the final decision.
 *
 *   Teacher: create → (documents) → submit → pending admin review
 *   Admin:   approve → convert to student (the usual admission), reject, or
 *            send back for correction → the teacher fixes and resubmits.
 *
 * Every rule is checked here, not just hidden in the screens: a teacher's
 * write access needs the permission AND an open assignment (drive running,
 * not paused or removed, today inside the assignment's own dates), so it
 * ends by itself when the end date passes. Capacity is counted under a row
 * lock. Nothing is ever deleted: removed assignments, moved applications and
 * removed documents all keep their history.
 */

const TASK_LABEL = Object.fromEntries(ADMISSION_TASKS.map((task) => [task.key, task.label.toLowerCase()])) as Record<AdmissionTask, string>;

const STATE_REFUSAL: Record<Exclude<AssignmentState, "OPEN">, string> = {
  NOT_STARTED: "This admission assignment has not started yet.",
  EXPIRED: "This admission assignment has ended. Ask the School Admin to extend it.",
  PAUSED: "The School Admin has paused this admission assignment.",
  REMOVED: "This admission assignment was removed by the School Admin.",
  DRIVE_STOPPED: "The admission drive is not running right now.",
};

const driveSelect = { id: true, name: true, status: true, startDate: true, endDate: true, academicSessionId: true } as const;

function classLabel(row: { class: { name: string }; section: { name: string } | null }): string {
  return row.section ? `${row.class.name} – ${row.section.name}` : row.class.name;
}

/** Applications taking a place, per assignment. */
async function usedPlaces(ctx: TenantContext, assignmentIds: string[]): Promise<Map<string, number>> {
  if (!assignmentIds.length) return new Map();
  const rows = await ctx.db.admissionApplication.groupBy({
    by: ["assignmentId"],
    where: { assignmentId: { in: assignmentIds }, status: { in: [...CAPACITY_STATUSES] } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.assignmentId!, row._count._all]));
}

type LockTx = Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0];

/**
 * Lock the assignment row for the rest of the transaction and check `adding`
 * more applications fit. The UPDATE takes the lock, so a second teacher click
 * waits here and then counts the first one.
 */
async function claimPlaces(tx: LockTx, assignmentId: string, adding: number): Promise<void> {
  const locked = await tx.admissionAssignment.updateMany({ where: { id: assignmentId }, data: { updatedAt: new Date() } });
  if (!locked.count) throw new NotFoundError("That admission assignment was not found.");
  const assignment = await tx.admissionAssignment.findFirstOrThrow({ where: { id: assignmentId }, select: { capacity: true } });
  const used = await tx.admissionApplication.count({ where: { assignmentId, status: { in: [...CAPACITY_STATUSES] } } });
  if (used + adding > assignment.capacity) {
    throw new ConflictError(
      adding === 1
        ? `This class is full: ${assignment.capacity} of ${assignment.capacity} admission places are taken.`
        : `Only ${Math.max(assignment.capacity - used, 0)} admission places are left (capacity ${assignment.capacity}).`,
    );
  }
}

// -----------------------------------------------------------------------------
// School Admin: drives
// -----------------------------------------------------------------------------

export async function listDrives(ctx: TenantContext) {
  assertCan(ctx, "students", "VIEW");
  const drives = await ctx.db.admissionDrive.findMany({
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    select: {
      ...driveSelect,
      academicSession: { select: { name: true } },
      _count: { select: { assignments: { where: { removedAt: null } } } },
    },
  });
  const counts = drives.length
    ? await ctx.db.admissionApplication.groupBy({ by: ["driveId", "status"], where: { driveId: { in: drives.map((drive) => drive.id) } }, _count: { _all: true } })
    : [];
  const on = today();
  return drives.map((drive) => {
    const mine = counts.filter((row) => row.driveId === drive.id);
    const count = (statuses: readonly AdmissionStatus[]) => mine.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    return {
      ...drive,
      state: driveState(drive, on),
      assignments: drive._count.assignments,
      applications: count(CAPACITY_STATUSES),
      pendingReview: count(["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"]),
    };
  });
}

function checkDates(start: Date, end: Date, field = "endDate") {
  if (end < start) throw new ValidationError("Please correct the highlighted fields.", { [field]: ["The end date must be on or after the start date."] });
}

export async function saveDrive(ctx: TenantContext, input: DriveInput): Promise<string> {
  assertCan(ctx, "students", "EDIT");
  checkDates(input.startDate, input.endDate);
  const session = await ctx.db.academicSession.findFirst({ where: { id: input.academicSessionId }, select: { id: true, name: true } });
  if (!session) throw new ValidationError("Please correct the highlighted fields.", { academicSessionId: ["Choose a session"] });

  const data = { academicSessionId: session.id, name: input.name, startDate: input.startDate, endDate: input.endDate, status: input.status, notes: input.notes };
  try {
    if (input.driveId) {
      const drive = await ctx.db.admissionDrive.findFirst({ where: { id: input.driveId }, select: { ...driveSelect, _count: { select: { applications: true } } } });
      if (!drive) throw new NotFoundError("That admission drive was not found.");
      if (drive.academicSessionId !== session.id && drive._count.applications) {
        throw new ValidationError("Please correct the highlighted fields.", { academicSessionId: ["This drive already has applications; its session cannot change."] });
      }
      // Teacher assignments must stay inside the drive's dates.
      const outside = await ctx.db.admissionAssignment.count({ where: { driveId: drive.id, removedAt: null, OR: [{ startDate: { lt: input.startDate } }, { endDate: { gt: input.endDate } }] } });
      if (outside) {
        throw new ValidationError("Please correct the highlighted fields.", {
          endDate: [`${outside} teacher assignment${outside === 1 ? " runs" : "s run"} outside these dates. Change ${outside === 1 ? "it" : "them"} first.`],
        });
      }
      await ctx.db.admissionDrive.updateMany({ where: { id: drive.id }, data });
      const changes = [
        drive.name !== input.name ? `renamed to "${input.name}"` : null,
        drive.status !== input.status ? `status ${drive.status.toLowerCase()} → ${input.status.toLowerCase()}` : null,
        drive.startDate.getTime() !== input.startDate.getTime() || drive.endDate.getTime() !== input.endDate.getTime() ? `dates ${formatDate(input.startDate)} – ${formatDate(input.endDate)}` : null,
      ].filter(Boolean);
      await recordAudit({
        action: "ADMISSION_DRIVE_UPDATED",
        entityType: "AdmissionDrive",
        entityId: drive.id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: `Admission drive "${drive.name}" updated${changes.length ? `: ${changes.join(", ")}` : ""}.`,
      });
      return drive.id;
    }
    const created = await ctx.db.admissionDrive.create({ data: { ...data, schoolId: ctx.schoolId, createdById: ctx.user.id }, select: { id: true } });
    await recordAudit({
      action: "ADMISSION_DRIVE_CREATED",
      entityType: "AdmissionDrive",
      entityId: created.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Admission drive "${input.name}" created for ${session.name}, ${formatDate(input.startDate)} – ${formatDate(input.endDate)}.`,
    });
    return created.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError("Please correct the highlighted fields.", { name: ["This session already has a drive with that name."] });
    throw error;
  }
}

/** One drive with its assignments (removed ones too, marked), places used, and its applications. */
export async function getDrive(ctx: TenantContext, driveId: string) {
  assertCan(ctx, "students", "VIEW");
  const drive = await ctx.db.admissionDrive.findFirst({
    where: { id: driveId },
    select: {
      ...driveSelect,
      notes: true,
      academicSession: { select: { id: true, name: true } },
      assignments: {
        orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        select: {
          id: true,
          classId: true,
          sectionId: true,
          teacherId: true,
          startDate: true,
          endDate: true,
          capacity: true,
          permissions: true,
          pausedAt: true,
          removedAt: true,
          class: { select: { name: true, level: true } },
          section: { select: { name: true } },
          teacher: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        },
      },
    },
  });
  if (!drive) throw new NotFoundError("That admission drive was not found.");
  const used = await usedPlaces(ctx, drive.assignments.map((row) => row.id));
  const applications = await ctx.db.admissionApplication.findMany({
    where: { driveId: drive.id },
    orderBy: { submittedAt: "desc" },
    take: 500,
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      studentFirstName: true,
      studentLastName: true,
      parentName: true,
      parentPhone: true,
      submittedAt: true,
      assignmentId: true,
      requestedClass: { select: { name: true } },
    },
  });
  const on = today();
  return {
    ...drive,
    state: driveState(drive, on),
    assignments: drive.assignments.map((row) => ({
      ...row,
      label: classLabel(row),
      permissions: cleanTasks(row.permissions),
      used: used.get(row.id) ?? 0,
      state: assignmentState(row, drive, on),
      pending: applications.filter((app) => app.assignmentId === row.id && (PENDING_STATUSES as readonly string[]).includes(app.status)).length,
    })),
    applications,
  };
}

// -----------------------------------------------------------------------------
// School Admin: teacher assignments
// -----------------------------------------------------------------------------

async function loadAssignment(ctx: TenantContext, assignmentId: string) {
  const assignment = await ctx.db.admissionAssignment.findFirst({
    where: { id: assignmentId },
    select: {
      id: true,
      driveId: true,
      classId: true,
      sectionId: true,
      teacherId: true,
      startDate: true,
      endDate: true,
      capacity: true,
      permissions: true,
      pausedAt: true,
      removedAt: true,
      class: { select: { name: true } },
      section: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      drive: { select: driveSelect },
    },
  });
  if (!assignment) throw new NotFoundError("That admission assignment was not found.");
  return assignment;
}

/**
 * Add or change a teacher assignment: teacher, class / section, dates,
 * capacity and permissions. Changing the teacher hands the assignment — and
 * its applications — to the new teacher; the old teacher's access ends and
 * the history stays. Capacity can never drop below the places already used.
 */
export async function saveAssignment(ctx: TenantContext, input: AssignmentInput): Promise<string> {
  assertCan(ctx, "students", "EDIT");
  const fail = (field: string, message: string): never => {
    throw new ValidationError("Please correct the highlighted fields.", { [field]: [message] });
  };
  const drive = await ctx.db.admissionDrive.findFirst({ where: { id: input.driveId }, select: driveSelect });
  if (!drive) throw new NotFoundError("That admission drive was not found.");
  if (drive.status === "CANCELLED" || drive.status === "CLOSED") fail("driveId", `This drive is ${drive.status.toLowerCase()}. Reopen it before changing assignments.`);

  const klass = await ctx.db.class.findFirst({ where: { id: input.classId }, select: { id: true, name: true } });
  if (!klass) fail("classId", "Choose a class");
  let sectionName: string | null = null;
  if (input.sectionId) {
    const section = await ctx.db.section.findFirst({ where: { id: input.sectionId, classId: input.classId, academicSessionId: drive.academicSessionId }, select: { name: true } });
    if (!section) fail("sectionId", "Choose a section of this class in the drive's session");
    sectionName = section!.name;
  }
  const teacher = await ctx.db.teacher.findFirst({ where: { id: input.teacherId }, select: { id: true, firstName: true, lastName: true, status: true } });
  if (!teacher) fail("teacherId", "Choose a teacher");
  if (!(CURRENT_EMPLOYEE as readonly string[]).includes(teacher!.status)) fail("teacherId", `${fullName(teacher!)} is not a current teacher.`);
  checkDates(input.startDate, input.endDate);
  if (input.startDate < drive.startDate || input.endDate > drive.endDate) {
    fail("endDate", `Keep the assignment inside the drive's dates (${formatDate(drive.startDate)} – ${formatDate(drive.endDate)}), or change the drive first.`);
  }
  const permissions = cleanTasks(input.permissions);
  const label = sectionName ? `${klass!.name} – ${sectionName}` : klass!.name;
  const data = {
    classId: klass!.id,
    sectionId: input.sectionId,
    teacherId: teacher!.id,
    startDate: input.startDate,
    endDate: input.endDate,
    capacity: input.capacity,
    permissions,
  };

  if (!input.assignmentId) {
    const created = await ctx.db.admissionAssignment.create({ data: { ...data, schoolId: ctx.schoolId, driveId: drive.id }, select: { id: true } });
    await recordAudit({
      action: "ADMISSION_ASSIGNMENT_CREATED",
      entityType: "AdmissionAssignment",
      entityId: created.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${label} in "${drive.name}" assigned to ${fullName(teacher!)}, ${formatDate(input.startDate)} – ${formatDate(input.endDate)}, capacity ${input.capacity}.`,
      metadata: { driveId: drive.id, permissions },
    });
    return created.id;
  }

  const before = await loadAssignment(ctx, input.assignmentId);
  if (before.driveId !== drive.id) throw new NotFoundError("That admission assignment was not found.");
  if (before.removedAt) throw new ConflictError("This assignment was removed. Add a new one instead.");
  const moved = before.classId !== data.classId;
  return ctx.db.$transaction(async (tx) => {
    const used = await tx.admissionApplication.count({ where: { assignmentId: before.id, status: { in: [...CAPACITY_STATUSES] } } });
    if (input.capacity < used) fail("capacity", `${used} places are already used; capacity cannot be less than that.`);
    if (moved && used) fail("classId", "This assignment already has applications for its class. Add a new assignment for the other class instead.");
    await tx.admissionAssignment.updateMany({ where: { id: before.id }, data });
    const changes = [
      before.teacherId !== data.teacherId ? `teacher ${fullName(before.teacher)} → ${fullName(teacher!)}` : null,
      before.startDate.getTime() !== data.startDate.getTime() || before.endDate.getTime() !== data.endDate.getTime()
        ? `dates ${formatDate(before.startDate)} – ${formatDate(before.endDate)} → ${formatDate(data.startDate)} – ${formatDate(data.endDate)}`
        : null,
      before.capacity !== data.capacity ? `capacity ${before.capacity} → ${data.capacity}` : null,
      cleanTasks(before.permissions).join(",") !== permissions.join(",") ? `permissions: ${permissions.length ? permissions.join(", ") : "none"}` : null,
      before.sectionId !== data.sectionId || moved ? `now ${label}` : null,
    ].filter(Boolean);
    await recordAudit({
      action: "ADMISSION_ASSIGNMENT_UPDATED",
      entityType: "AdmissionAssignment",
      entityId: before.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${label} in "${drive.name}" changed${changes.length ? `: ${changes.join("; ")}` : ""}.`,
      metadata: { driveId: drive.id, previousTeacherId: before.teacherId, teacherId: data.teacherId },
    });
    return before.id;
  });
}

/** Give a teacher more time: a later end date, still inside the drive. */
export async function extendAssignment(ctx: TenantContext, input: { assignmentId: string; endDate: Date }): Promise<void> {
  assertCan(ctx, "students", "EDIT");
  const assignment = await loadAssignment(ctx, input.assignmentId);
  if (assignment.removedAt) throw new ConflictError("This assignment was removed.");
  if (input.endDate <= assignment.endDate) throw new ValidationError("Please correct the highlighted fields.", { endDate: ["Choose a date after the current end date."] });
  if (input.endDate > assignment.drive.endDate) {
    throw new ValidationError("Please correct the highlighted fields.", { endDate: [`The drive ends on ${formatDate(assignment.drive.endDate)}. Extend the drive first.`] });
  }
  await ctx.db.admissionAssignment.updateMany({ where: { id: assignment.id }, data: { endDate: input.endDate } });
  await recordAudit({
    action: "ADMISSION_ASSIGNMENT_UPDATED",
    entityType: "AdmissionAssignment",
    entityId: assignment.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${classLabel(assignment)} (${fullName(assignment.teacher)}) extended from ${formatDate(assignment.endDate)} to ${formatDate(input.endDate)}.`,
  });
}

export async function setAssignmentPaused(ctx: TenantContext, assignmentId: string, paused: boolean): Promise<void> {
  assertCan(ctx, "students", "EDIT");
  const assignment = await loadAssignment(ctx, assignmentId);
  if (assignment.removedAt) throw new ConflictError("This assignment was removed.");
  if (!!assignment.pausedAt === paused) return;
  await ctx.db.admissionAssignment.updateMany({ where: { id: assignment.id }, data: { pausedAt: paused ? new Date() : null } });
  await recordAudit({
    action: paused ? "ADMISSION_ASSIGNMENT_PAUSED" : "ADMISSION_ASSIGNMENT_RESUMED",
    entityType: "AdmissionAssignment",
    entityId: assignment.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${classLabel(assignment)} (${fullName(assignment.teacher)}) ${paused ? "paused" : "resumed"}.`,
  });
}

/**
 * End an assignment for good. The teacher loses access at once; the row and
 * every application on it stay. Pending applications are best moved to
 * another assignment first (see `reassignApplications`).
 */
export async function removeAssignment(ctx: TenantContext, assignmentId: string): Promise<void> {
  assertCan(ctx, "students", "DELETE");
  const assignment = await loadAssignment(ctx, assignmentId);
  if (assignment.removedAt) return;
  await ctx.db.admissionAssignment.updateMany({ where: { id: assignment.id }, data: { removedAt: new Date() } });
  await recordAudit({
    action: "ADMISSION_ASSIGNMENT_REMOVED",
    entityType: "AdmissionAssignment",
    entityId: assignment.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${classLabel(assignment)} (${fullName(assignment.teacher)}) removed from "${assignment.drive.name}". Its applications are kept.`,
  });
}

/**
 * Move pending applications (not yet converted or rejected) from one
 * assignment to another of the same class in the same drive — to another
 * teacher, for instance. The target's capacity is checked under lock; each
 * application keeps its number, status, documents and history, and gets a
 * note saying where it came from.
 */
export async function reassignApplications(ctx: TenantContext, input: { fromAssignmentId: string; toAssignmentId: string; applicationIds: string[] }): Promise<number> {
  assertCan(ctx, "students", "EDIT");
  if (input.fromAssignmentId === input.toAssignmentId) throw new ValidationError("Please correct the highlighted fields.", { toAssignmentId: ["Choose a different assignment."] });
  const [from, to] = await Promise.all([loadAssignment(ctx, input.fromAssignmentId), loadAssignment(ctx, input.toAssignmentId)]);
  if (from.driveId !== to.driveId) throw new ValidationError("Please correct the highlighted fields.", { toAssignmentId: ["Choose an assignment in the same drive."] });
  if (from.classId !== to.classId) throw new ValidationError("Please correct the highlighted fields.", { toAssignmentId: [`Choose an assignment for ${from.class.name}.`] });
  if (to.removedAt) throw new ValidationError("Please correct the highlighted fields.", { toAssignmentId: ["That assignment was removed."] });

  const moved = await ctx.db.$transaction(async (tx) => {
    const rows = await tx.admissionApplication.findMany({
      where: { assignmentId: from.id, status: { in: [...PENDING_STATUSES] }, ...(input.applicationIds.length ? { id: { in: input.applicationIds } } : {}) },
      select: { id: true, applicationNumber: true },
    });
    if (!rows.length) throw new ConflictError("There are no pending applications to move.");
    await claimPlaces(tx, to.id, rows.length);
    await tx.admissionApplication.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { assignmentId: to.id, requestedClassId: to.classId } });
    await tx.admissionFollowUp.createMany({
      data: rows.map((row) => ({
        schoolId: ctx.schoolId,
        applicationId: row.id,
        note: `Moved from ${fullName(from.teacher)} (${classLabel(from)}) to ${fullName(to.teacher)} (${classLabel(to)}).`,
        authorId: ctx.user.id,
      })),
    });
    return rows;
  });
  await recordAudit({
    action: "ADMISSION_REASSIGNED",
    entityType: "AdmissionAssignment",
    entityId: to.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${moved.length} pending application${moved.length === 1 ? "" : "s"} moved from ${fullName(from.teacher)} to ${fullName(to.teacher)} (${classLabel(to)}).`,
    metadata: { fromAssignmentId: from.id, applicationNumbers: moved.map((row) => row.applicationNumber) },
  });
  return moved.length;
}

/** Choices for the assignment form: the session's classes with their sections, and current teachers. */
export async function assignmentOptions(ctx: TenantContext, academicSessionId: string) {
  assertCan(ctx, "students", "VIEW");
  const [classes, teachers] = await Promise.all([
    ctx.db.class.findMany({
      orderBy: [{ level: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sections: { where: { academicSessionId }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
    }),
    ctx.db.teacher.findMany({ where: { status: { in: [...CURRENT_EMPLOYEE] as never } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, employeeId: true } }),
  ]);
  return { classes, teachers };
}

// -----------------------------------------------------------------------------
// School Admin: the decision on a teacher-entered application
// -----------------------------------------------------------------------------

/**
 * Approve, reject, or send back for correction. School Admin only: the
 * office's "move applications along" permission does not reach drive
 * applications. Approving leads to the usual "Convert to student".
 */
export async function reviewDriveApplication(ctx: TenantContext, input: { applicationId: string; decision: "APPROVE" | "REJECT" | "REQUEST_CORRECTION"; note: string | null }): Promise<void> {
  assertCan(ctx, "students", "APPROVE");
  const application = await ctx.db.admissionApplication.findFirst({ where: { id: input.applicationId, driveId: { not: null } }, select: { id: true, status: true, applicationNumber: true } });
  if (!application) throw new NotFoundError();
  if (!["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"].includes(application.status)) {
    throw new ConflictError(application.status === "DRAFT" || application.status === "CORRECTION_REQUESTED" ? "The teacher has not submitted this application yet." : "This application has already been decided.");
  }
  if (input.decision !== "APPROVE" && !input.note) {
    throw new ValidationError("Please correct the highlighted fields.", { note: [input.decision === "REJECT" ? "Say why it is rejected." : "Say what needs correcting."] });
  }
  const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "CORRECTION_REQUESTED";
  const { count } = await ctx.db.admissionApplication.updateMany({
    where: { id: application.id, status: application.status },
    data: { status, reviewNotes: input.note, reviewedAt: new Date(), reviewedById: ctx.user.id },
  });
  if (!count) throw new ConflictError("This application changed a moment ago. Reload and try again.");
  await ctx.db.admissionFollowUp.create({
    data: {
      schoolId: ctx.schoolId,
      applicationId: application.id,
      note: input.decision === "APPROVE" ? `Approved by the School Admin.${input.note ? ` ${input.note}` : ""}` : `${input.decision === "REJECT" ? "Rejected" : "Sent back for correction"}: ${input.note}`,
      authorId: ctx.user.id,
    },
  });
  await recordAudit({
    action: input.decision === "APPROVE" ? "ADMISSION_STATUS_CHANGED" : input.decision === "REJECT" ? "ADMISSION_REJECTED" : "ADMISSION_CORRECTION_REQUESTED",
    entityType: "AdmissionApplication",
    entityId: application.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Application ${application.applicationNumber} ${input.decision === "APPROVE" ? "approved" : input.decision === "REJECT" ? "rejected" : "sent back for correction"}${input.note ? `: ${input.note}` : ""}.`,
  });
}

// -----------------------------------------------------------------------------
// Teacher: their own admission work
// -----------------------------------------------------------------------------

const teacherAssignmentSelect = {
  id: true,
  classId: true,
  sectionId: true,
  startDate: true,
  endDate: true,
  capacity: true,
  permissions: true,
  pausedAt: true,
  removedAt: true,
  class: { select: { name: true, level: true } },
  section: { select: { name: true } },
  drive: { select: { ...driveSelect, academicSession: { select: { name: true } } } },
} as const;

function withState<T extends { startDate: Date; endDate: Date; pausedAt: Date | null; removedAt: Date | null; permissions: string[]; drive: Parameters<typeof driveState>[0] } & Parameters<typeof classLabel>[0]>(row: T, on: Date) {
  const state = assignmentState(row, row.drive, on);
  const tasks = cleanTasks(row.permissions);
  const can = (task: AdmissionTask) => tasks.includes(task) && (task === "view" || state === "OPEN");
  return { ...row, label: classLabel(row), state, tasks, can: { view: can("view"), create: can("create"), edit: can("edit"), documents: can("documents"), submit: can("submit") } };
}

/** Whether the signed-in teacher has any admission assignment — for the sidebar. */
export async function hasAdmissionWork(ctx: TenantContext): Promise<boolean> {
  if (ctx.user.role !== "TEACHER") return false;
  return (await ctx.db.admissionAssignment.count({ where: { removedAt: null, teacher: { userId: ctx.user.id } } })) > 0;
}

/** The teacher's assignments (current ones; removed ones are gone from their view) and the applications on them. */
export async function myAdmissionWork(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const me = await requireTeacherSelf(ctx);
  const on = today();
  const rows = await ctx.db.admissionAssignment.findMany({ where: { teacherId: me.id, removedAt: null }, orderBy: { startDate: "desc" }, select: teacherAssignmentSelect });
  const used = await usedPlaces(ctx, rows.map((row) => row.id));
  const assignments = rows.map((row) => ({ ...withState(row, on), used: used.get(row.id) ?? 0 }));
  const visible = assignments.filter((row) => row.tasks.includes("view")).map((row) => row.id);
  const applications = await ctx.db.admissionApplication.findMany({
    where: { assignmentId: { in: assignments.map((row) => row.id) }, OR: [{ assignmentId: { in: visible } }, { createdById: ctx.user.id }] },
    orderBy: { submittedAt: "desc" },
    take: 500,
    select: { id: true, applicationNumber: true, status: true, studentFirstName: true, studentLastName: true, parentName: true, parentPhone: true, submittedAt: true, assignmentId: true, reviewNotes: true },
  });
  return { teacher: me, assignments, applications };
}

/** One of the teacher's assignments, with what they may do on it today. */
async function myAssignment(ctx: TenantContext, assignmentId: string) {
  assertRole(ctx.user, "TEACHER");
  const me = await requireTeacherSelf(ctx);
  const row = await ctx.db.admissionAssignment.findFirst({ where: { id: assignmentId, teacherId: me.id }, select: teacherAssignmentSelect });
  if (!row) throw new NotFoundError("That admission assignment was not found.");
  return withState(row, today());
}

function requireTask(assignment: Awaited<ReturnType<typeof myAssignment>>, task: AdmissionTask) {
  if (!assignment.tasks.includes(task)) throw new ForbiddenError(`You do not have permission to ${TASK_LABEL[task]} for ${assignment.label}. Ask the School Admin.`);
  if (task !== "view" && assignment.state !== "OPEN") throw new ForbiddenError(STATE_REFUSAL[assignment.state as Exclude<AssignmentState, "OPEN">]);
}

/** An application on one of the teacher's assignments — never anyone else's. */
async function myApplicationRow(ctx: TenantContext, applicationId: string) {
  assertRole(ctx.user, "TEACHER");
  const me = await requireTeacherSelf(ctx);
  const application = await ctx.db.admissionApplication.findFirst({
    where: { id: applicationId, assignment: { teacherId: me.id, removedAt: null } },
    select: { id: true, status: true, applicationNumber: true, assignmentId: true, createdById: true, requestedClassId: true },
  });
  if (!application) throw new NotFoundError();
  const assignment = await myAssignment(ctx, application.assignmentId!);
  return { application, assignment };
}

export async function getMyApplication(ctx: TenantContext, applicationId: string) {
  const { application, assignment } = await myApplicationRow(ctx, applicationId);
  if (!assignment.tasks.includes("view") && application.createdById !== ctx.user.id) {
    throw new ForbiddenError(`You do not have permission to view applications for ${assignment.label}.`);
  }
  const full = await ctx.db.admissionApplication.findFirstOrThrow({
    where: { id: application.id },
    include: {
      requestedClass: { select: { id: true, name: true, level: true } },
      requestedStream: { select: { id: true, name: true } },
      academicSession: { select: { name: true } },
      documents: { where: { removedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, fileName: true, size: true, createdAt: true } },
      followUps: { orderBy: { createdAt: "desc" }, select: { id: true, note: true, createdAt: true, author: { select: { firstName: true, lastName: true } } } },
    },
  });
  const editable = (TEACHER_EDITABLE as readonly string[]).includes(full.status);
  return {
    application: full,
    assignment,
    can: {
      edit: editable && assignment.can.edit,
      documents: editable && assignment.can.documents,
      submit: editable && assignment.can.submit,
    },
  };
}

/** Streams a teacher may pick for a class: none for Nursery–8, the school's streams for 9–12. */
export async function streamOptionsFor(ctx: TenantContext, classLevel: number) {
  if (streamRuleForLevel(classLevel) === "NONE") return [];
  const streams = await ctx.db.stream.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return streams.map((stream) => ({ value: stream.id, label: stream.name }));
}

async function checkStream(ctx: TenantContext, classId: string, streamId: string | null) {
  const klass = await ctx.db.class.findFirstOrThrow({ where: { id: classId }, select: { name: true, level: true } });
  if (streamId && !(await ctx.db.stream.findFirst({ where: { id: streamId }, select: { id: true } }))) {
    throw new ValidationError("Please correct the highlighted fields.", { requestedStreamId: ["Choose a stream from the list"] });
  }
  const problem = streamProblem(klass.level, streamId, klass.name);
  if (problem) throw new ValidationError("Please correct the highlighted fields.", { requestedStreamId: [problem] });
}

function applicationData(input: DriveApplicationInput) {
  return {
    studentFirstName: input.studentFirstName,
    studentLastName: input.studentLastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    previousSchool: input.previousSchool,
    requestedStreamId: input.requestedStreamId,
    parentName: input.parentName,
    parentRelationship: input.parentRelationship,
    parentPhone: input.parentPhone,
    parentEmail: input.parentEmail,
    addressLine: input.addressLine,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    notes: input.notes,
  };
}

/** A teacher starts an application (a draft) in their class. Capacity is checked under lock. */
export async function createDriveApplication(ctx: TenantContext, assignmentId: string, input: DriveApplicationInput): Promise<string> {
  const assignment = await myAssignment(ctx, assignmentId);
  requireTask(assignment, "create");
  await checkStream(ctx, assignment.classId, input.requestedStreamId);
  const session = await ctx.db.academicSession.findFirstOrThrow({ where: { id: assignment.drive.academicSessionId }, select: { name: true } });
  const prefix = `APP-${session.name.slice(0, 4)}-`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await ctx.db.$transaction(async (tx) => {
        await claimPlaces(tx, assignment.id, 1);
        const count = await tx.admissionApplication.count({ where: { applicationNumber: { startsWith: prefix } } });
        const applicationNumber = `${prefix}${String(count + 1 + attempt).padStart(5, "0")}`;
        const row = await tx.admissionApplication.create({
          data: {
            ...applicationData(input),
            schoolId: ctx.schoolId,
            academicSessionId: assignment.drive.academicSessionId,
            applicationNumber,
            status: "DRAFT",
            source: "DRIVE",
            requestedClassId: assignment.classId,
            driveId: assignment.drive.id,
            assignmentId: assignment.id,
            createdById: ctx.user.id,
          },
          select: { id: true },
        });
        return { id: row.id, applicationNumber };
      });
      await recordAudit({
        action: "ADMISSION_CREATED",
        entityType: "AdmissionApplication",
        entityId: created.id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: `Application ${created.applicationNumber} started for ${input.studentFirstName} ${input.studentLastName} (${assignment.label}, "${assignment.drive.name}").`,
      });
      return created.id;
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate an application number.");
}

function requireEditable(status: AdmissionStatus) {
  if (!(TEACHER_EDITABLE as readonly string[]).includes(status)) {
    throw new ConflictError("This application has been submitted. Only the School Admin can send it back for changes.");
  }
}

export async function updateDriveApplication(ctx: TenantContext, applicationId: string, input: DriveApplicationInput): Promise<void> {
  const { application, assignment } = await myApplicationRow(ctx, applicationId);
  requireTask(assignment, "edit");
  requireEditable(application.status);
  await checkStream(ctx, application.requestedClassId, input.requestedStreamId);
  const { count } = await ctx.db.admissionApplication.updateMany({ where: { id: application.id, status: { in: [...TEACHER_EDITABLE] } }, data: applicationData(input) });
  if (!count) throw new ConflictError("This application changed a moment ago. Reload and try again.");
  await recordAudit({ action: "ADMISSION_UPDATED", entityType: "AdmissionApplication", entityId: application.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Application ${application.applicationNumber} edited.` });
}

/** Send to the School Admin: draft (or corrected) → submitted, pending admin review. */
export async function submitDriveApplication(ctx: TenantContext, applicationId: string): Promise<void> {
  const { application, assignment } = await myApplicationRow(ctx, applicationId);
  requireTask(assignment, "submit");
  requireEditable(application.status);
  const { count } = await ctx.db.admissionApplication.updateMany({
    where: { id: application.id, status: { in: [...TEACHER_EDITABLE] } },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  if (!count) throw new ConflictError("This application changed a moment ago. Reload and try again.");
  await ctx.db.admissionFollowUp.create({
    data: { schoolId: ctx.schoolId, applicationId: application.id, note: application.status === "CORRECTION_REQUESTED" ? "Corrected and submitted again." : "Submitted for admin review.", authorId: ctx.user.id },
  });
  await recordAudit({
    action: "ADMISSION_SUBMITTED",
    entityType: "AdmissionApplication",
    entityId: application.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Application ${application.applicationNumber} submitted for admin review (${assignment.label}).`,
  });
}

// -----------------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------------

export async function addAdmissionDocument(ctx: TenantContext, input: { applicationId: string; label: string; file: File }): Promise<void> {
  const { application, assignment } = await myApplicationRow(ctx, input.applicationId);
  requireTask(assignment, "documents");
  requireEditable(application.status);
  const document = await validateDocument(input.file);
  const key = await storeDocument(ctx.schoolId, document, "admission-documents");
  try {
    const row = await ctx.db.admissionDocument.create({
      data: { schoolId: ctx.schoolId, applicationId: application.id, label: input.label, fileName: document.fileName, storageKey: key, size: document.size, uploadedById: ctx.user.id },
      select: { id: true },
    });
    await recordAudit({
      action: "ADMISSION_DOCUMENT_ADDED",
      entityType: "AdmissionApplication",
      entityId: application.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `"${input.label}" added to application ${application.applicationNumber}.`,
      metadata: { documentId: row.id },
    });
  } catch (error) {
    await deleteStoredFile(key);
    throw error;
  }
}

/** Taken off the application; the record (and the file) are kept for the history. */
export async function removeAdmissionDocument(ctx: TenantContext, documentId: string): Promise<void> {
  const document = await ctx.db.admissionDocument.findFirst({ where: { id: documentId, removedAt: null }, select: { id: true, label: true, applicationId: true } });
  if (!document) throw new NotFoundError();
  const { application, assignment } = await myApplicationRow(ctx, document.applicationId);
  requireTask(assignment, "documents");
  requireEditable(application.status);
  await ctx.db.admissionDocument.updateMany({ where: { id: document.id }, data: { removedAt: new Date() } });
  await recordAudit({
    action: "ADMISSION_DOCUMENT_REMOVED",
    entityType: "AdmissionApplication",
    entityId: application.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${document.label}" removed from application ${application.applicationNumber}.`,
  });
}

/** An application's current documents, for the admin and office screens. */
export async function applicationDocuments(ctx: TenantContext, applicationId: string) {
  if (!isSchoolLeader(ctx.user.role) && !(ctx.user.role === "NON_TEACHING_STAFF" && (await staffHolds(ctx, "admissions.view")))) throw new ForbiddenError();
  return ctx.db.admissionDocument.findMany({ where: { applicationId, removedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, fileName: true, size: true, createdAt: true } });
}

/**
 * A document's bytes, for whoever may see the application: the School Admin,
 * office staff with "Online applications & status", or the teacher whose
 * assignment it is on (with View, or who entered it).
 */
export async function readAdmissionDocument(ctx: TenantContext, documentId: string): Promise<{ bytes: Buffer; fileName: string }> {
  const document = await ctx.db.admissionDocument.findFirst({ where: { id: documentId }, select: { applicationId: true, fileName: true, storageKey: true } });
  if (!document) throw new NotFoundError();
  if (ctx.user.role === "TEACHER") {
    await getMyApplication(ctx, document.applicationId);
  } else if (!isSchoolLeader(ctx.user.role) && !(ctx.user.role === "NON_TEACHING_STAFF" && (await staffHolds(ctx, "admissions.view")))) {
    throw new ForbiddenError();
  }
  try {
    return { bytes: await readStoredFile(document.storageKey), fileName: document.fileName };
  } catch {
    throw new AppError("NOT_FOUND", "That file is no longer available.");
  }
}
