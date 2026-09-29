import "server-only";

import type { HomeworkHabit, ParticipationLevel, RemarkLevel } from "@/generated/prisma/enums";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireSectionAccess, requireSubjectAssignment, requireTeacherSelf } from "@/server/auth/teacher-access";
import { requireCurrentSession } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";

/**
 * A teacher's note about one child.
 *
 * Two boundaries, both checked in the database rather than in the form:
 *
 *   * To write about a child, the teacher must reach the section that child
 *     is *currently enrolled in*. Teaching them last year is not enough, and
 *     neither is sharing a school.
 *   * To change a remark, the teacher must be the one who wrote it. This
 *     holds even for a class teacher: a remark is attributed, and an
 *     attributed note somebody else can rewrite is worthless.
 */

const REMARK_SELECT = {
  id: true,
  understanding: true,
  homeworkHabit: true,
  participation: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  teacherId: true,
  subject: { select: { id: true, name: true } },
  teacher: { select: { firstName: true, lastName: true } },
  student: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * The child's current placement, if this teacher is entitled to it.
 *
 * Starting from the enrollment rather than the student is what ties the
 * permission to *this* session: the section is read off the placement, and
 * access is then checked against that section.
 */
async function requireStudentInMySection(ctx: TenantContext, studentId: string, academicSessionId: string) {
  const enrollment = await ctx.db.studentEnrollment.findFirst({
    where: { studentId, academicSessionId, status: "ACTIVE" },
    select: {
      sectionId: true,
      student: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Another school's child resolves to nothing here, because `ctx.db` is
  // already scoped — so this is the same answer as "no such student".
  if (!enrollment) throw new NotFoundError("That student was not found in this session.");

  await requireSectionAccess(ctx, enrollment.sectionId);
  return enrollment;
}

/** The three bands plus the note, as the form submits them. */
export type RemarkBands = {
  understanding: RemarkLevel | null;
  homeworkHabit: HomeworkHabit | null;
  participation: ParticipationLevel | null;
  note: string | null;
};

export type RemarkInput = RemarkBands & {
  studentId: string;
  subjectId: string | null;
};

/**
 * A remark that answers none of the three and says nothing is not a remark.
 *
 * Checked here as well as in the schema: the service is reachable from the API
 * and from a future importer, and an empty row on a child's record is worse
 * than a rejected request.
 */
function assertSomethingSaid(bands: RemarkBands): void {
  if (!bands.understanding && !bands.homeworkHabit && !bands.participation && !bands.note) {
    throw new AppError("VALIDATION", "A remark must answer at least one question, or say something.");
  }
}

export async function addRemark(ctx: TenantContext, input: RemarkInput): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  assertSomethingSaid(input);
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  const enrollment = await requireStudentInMySection(ctx, input.studentId, session.id);
  // A class teacher reaches the whole section, but a remark filed under a
  // subject speaks for that subject: only its own teacher may write one.
  if (input.subjectId) {
    await requireSubjectAssignment(ctx, enrollment.sectionId, input.subjectId, session.id);
  }

  const created = await ctx.db.studentRemark.create({
    data: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      studentId: input.studentId,
      teacherId: teacher.id,
      subjectId: input.subjectId,
      understanding: input.understanding,
      homeworkHabit: input.homeworkHabit,
      participation: input.participation,
      body: input.note,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "STUDENT_REMARK_ADDED",
    entityType: "Student",
    entityId: input.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    // The remark itself is not copied into the audit trail: support staff read
    // this log, and a note about a child is not theirs to browse.
    summary: `Remark added for ${fullName(enrollment.student)}.`,
  });

  return created;
}

/** The teacher's own remark, or a refusal that does not say which it was. */
async function requireOwnRemark(ctx: TenantContext, remarkId: string) {
  const teacher = await requireTeacherSelf(ctx);

  const row = await ctx.db.studentRemark.findFirst({
    where: { id: remarkId },
    select: { id: true, teacherId: true, studentId: true },
  });

  if (!row) throw new NotFoundError("That remark was not found.");
  if (row.teacherId !== teacher.id) {
    throw new ForbiddenError("You can only change remarks you wrote yourself.");
  }

  return row;
}

export async function updateRemark(
  ctx: TenantContext,
  remarkId: string,
  bands: RemarkBands,
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const existing = await requireOwnRemark(ctx, remarkId);
  assertSomethingSaid(bands);

  await ctx.db.studentRemark.update({
    where: { id: existing.id },
    data: {
      understanding: bands.understanding,
      homeworkHabit: bands.homeworkHabit,
      participation: bands.participation,
      body: bands.note,
    },
  });

  await recordAudit({
    action: "STUDENT_REMARK_UPDATED",
    entityType: "Student",
    entityId: existing.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Remark updated.",
  });
}

export async function deleteRemark(ctx: TenantContext, remarkId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const existing = await requireOwnRemark(ctx, remarkId);

  await ctx.db.studentRemark.delete({ where: { id: existing.id } });

  await recordAudit({
    action: "STUDENT_REMARK_DELETED",
    entityType: "Student",
    entityId: existing.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Remark deleted.",
  });
}

/**
 * Every remark about one child this session, from any teacher.
 *
 * A teacher who may see the child may read what colleagues have written —
 * that is the point of a shared record — but `mine` marks the ones they can
 * change, so the UI never offers an edit that the server would refuse.
 */
export async function remarksForStudent(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  await requireStudentInMySection(ctx, studentId, session.id);

  const rows = await ctx.db.studentRemark.findMany({
    where: { studentId, academicSessionId: session.id },
    orderBy: { createdAt: "desc" },
    select: REMARK_SELECT,
  });

  return rows.map((row) => ({
    id: row.id,
    understanding: row.understanding,
    homeworkHabit: row.homeworkHabit,
    participation: row.participation,
    note: row.body,
    createdAt: row.createdAt,
    subject: row.subject?.name ?? null,
    author: fullName(row.teacher),
    mine: row.teacherId === teacher.id,
  }));
}
