import "server-only";

import { today } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import {
  accessibleSectionIds,
  requireSubjectAssignment,
  requireTeacherSelf,
} from "@/server/auth/teacher-access";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";

/**
 * Work set for a section in one subject.
 *
 * Two rules do all the work here:
 *
 *   * Setting homework needs `requireSubjectAssignment`, not section access.
 *     A class teacher can take any register in their section, but only the
 *     Mathematics teacher may set Mathematics homework.
 *   * Editing needs authorship. The row records who set it, and that is the
 *     only teacher who may change it — being in the same school, or even
 *     teaching the same class, is not enough.
 */

export const HOMEWORK_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export type HomeworkInput = {
  sectionId: string;
  subjectId: string;
  title: string;
  description: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
};

const HOMEWORK_SELECT = {
  id: true,
  title: true,
  description: true,
  assignedOn: true,
  dueOn: true,
  status: true,
  teacherId: true,
  createdAt: true,
  subject: { select: { id: true, name: true } },
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  },
} as const;

type HomeworkRow = {
  id: string;
  title: string;
  description: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
  teacherId: string;
  subject: { id: string; name: string };
  section: { id: string; name: string; class: { name: string }; stream: { name: string } | null };
};

function shape(row: HomeworkRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assignedOn: row.assignedOn,
    dueOn: row.dueOn,
    status: row.status,
    subjectId: row.subject.id,
    subject: row.subject.name,
    sectionId: row.section.id,
    section: sectionLabel(row.section),
    overdue: row.status === "PUBLISHED" && row.dueOn < today(),
  };
}

/** Work cannot be due before it is set. */
function assertDates(assignedOn: Date, dueOn: Date): void {
  if (dueOn < assignedOn) {
    throw new AppError("VALIDATION", "The due date cannot be before the date it is set.");
  }
}

export async function createHomework(
  ctx: TenantContext,
  input: HomeworkInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);

  // The one check that matters: do they teach this subject to this section?
  const { teacherId } = await requireSubjectAssignment(
    ctx,
    input.sectionId,
    input.subjectId,
    session.id,
  );
  assertDates(input.assignedOn, input.dueOn);

  const created = await ctx.db.homework.create({
    data: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      teacherId,
      title: input.title,
      description: input.description,
      assignedOn: input.assignedOn,
      dueOn: input.dueOn,
      status: input.status,
    },
    select: { id: true, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
  });

  await recordAudit({
    action: "HOMEWORK_CREATED",
    entityType: "Homework",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${input.title}" set for ${sectionLabel(created.section)}.`,
  });

  return { id: created.id };
}

/**
 * The teacher's own homework row, or a refusal.
 *
 * Someone else's homework and a non-existent id answer identically, so the
 * response cannot be used to discover what other teachers have set.
 */
async function requireOwnHomework(ctx: TenantContext, homeworkId: string) {
  const teacher = await requireTeacherSelf(ctx);

  const row = await ctx.db.homework.findFirst({
    where: { id: homeworkId },
    select: { id: true, teacherId: true, title: true, sectionId: true, subjectId: true, academicSessionId: true },
  });

  if (!row) throw new NotFoundError("That homework was not found.");
  if (row.teacherId !== teacher.id) {
    throw new ForbiddenError("You can only change homework you set yourself.");
  }

  return row;
}

export async function updateHomework(
  ctx: TenantContext,
  homeworkId: string,
  input: HomeworkInput,
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);

  const existing = await requireOwnHomework(ctx, homeworkId);
  // Moving homework to a different class or subject is still setting it there,
  // so the destination is checked exactly as a new one would be.
  await requireSubjectAssignment(ctx, input.sectionId, input.subjectId, session.id);
  assertDates(input.assignedOn, input.dueOn);

  await ctx.db.homework.update({
    where: { id: existing.id },
    data: {
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      title: input.title,
      description: input.description,
      assignedOn: input.assignedOn,
      dueOn: input.dueOn,
      status: input.status,
    },
  });

  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${input.title}" updated.`,
  });
}

export async function deleteHomework(ctx: TenantContext, homeworkId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const existing = await requireOwnHomework(ctx, homeworkId);

  await ctx.db.homework.delete({ where: { id: existing.id } });

  await recordAudit({
    action: "HOMEWORK_DELETED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${existing.title}" deleted.`,
  });
}

export type HomeworkFilters = {
  sectionId?: string | null;
  subjectId?: string | null;
  status?: HomeworkStatus | null;
  take?: number;
};

/** Everything this teacher has set, newest first. */
export async function listMyHomework(ctx: TenantContext, filters: HomeworkFilters = {}) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  const rows = await ctx.db.homework.findMany({
    where: {
      teacherId: teacher.id,
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ dueOn: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 50,
    select: HOMEWORK_SELECT,
  });

  return rows.map(shape);
}

/** One row for the edit form — the teacher's own, or a refusal. */
export async function getMyHomework(ctx: TenantContext, homeworkId: string) {
  assertRole(ctx.user, "TEACHER");
  await requireOwnHomework(ctx, homeworkId);

  const row = await ctx.db.homework.findFirstOrThrow({
    where: { id: homeworkId },
    select: HOMEWORK_SELECT,
  });
  return shape(row);
}

/**
 * Work this teacher has set that is still ahead of its due date — the
 * "pending" count on the dashboard.
 */
export async function pendingHomeworkCount(ctx: TenantContext): Promise<number> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  return ctx.db.homework.count({
    where: { teacherId: teacher.id, status: "PUBLISHED", dueOn: { gte: today() } },
  });
}

/**
 * Homework due for the sections a teacher can reach, whoever set it.
 *
 * This is the class-teacher's view — what a section owes this week across all
 * its subjects — so it is scoped by section access rather than authorship.
 */
export async function homeworkDueForMySections(
  ctx: TenantContext,
  options: { from: Date; to: Date; take?: number },
) {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const sectionIds = await accessibleSectionIds(ctx, session.id);

  // "ALL" belongs to admins; a teacher with no sections sees nothing.
  const mine = sectionIds === "ALL" ? [] : sectionIds;
  if (mine.length === 0) return [];

  const rows = await ctx.db.homework.findMany({
    where: {
      sectionId: { in: mine },
      status: "PUBLISHED",
      dueOn: { gte: options.from, lte: options.to },
    },
    orderBy: { dueOn: "asc" },
    take: options.take ?? 20,
    select: HOMEWORK_SELECT,
  });

  return rows.map(shape);
}
