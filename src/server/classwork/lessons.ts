import "server-only";

import { addDays, dayOfWeek, today } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";

/**
 * Planning a lesson, and attaching what the class should work from.
 *
 * Both live on the `ClassSession` row that already represents "this period on
 * this date" — the same row a teacher later writes up. A plan is that row in its
 * `SCHEDULED` state with a `plannedTopic`; recording the class fills in the rest
 * of the same row. There is deliberately no second lesson table: two rows for
 * one period is how a plan and a register come to disagree.
 *
 * Authorization is the period, never an id in the request. A teacher may plan
 * and attach to a period they are scheduled to teach, or one the office has
 * named them the stand-in for — the same two ways in that `recordActivity`
 * allows, and no others.
 */

/** How far ahead a lesson can be planned. Beyond a fortnight it is a syllabus. */
export const PLANNING_HORIZON_DAYS = 21;

export const MATERIAL_KINDS = ["NOTES", "LINK", "DOCUMENT", "QUESTIONS", "PRACTICE"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Kinds that carry a URL rather than text the teacher typed. */
const URL_KINDS: readonly MaterialKind[] = ["LINK", "DOCUMENT"];

export type LessonPlanInput = {
  timetableSlotId: string;
  date: Date;
  plannedTopic: string | null;
  preparation: string | null;
};

/**
 * The period being planned or attached to, once it is established that this
 * teacher may touch it.
 *
 * Refusals are indistinguishable: another school's slot, another teacher's slot
 * and a slot that does not exist all answer the same way.
 */
async function requireTeachablePeriod(ctx: TenantContext, timetableSlotId: string, date: Date) {
  const teacher = await requireTeacherSelf(ctx);

  const slot = await ctx.db.timetableSlot.findFirst({
    where: { id: timetableSlotId },
    select: {
      id: true,
      dayOfWeek: true,
      teacherId: true,
      subject: { select: { name: true } },
      section: {
        select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
      },
    },
  });
  if (!slot) throw new ForbiddenError("That period is not one of yours.");

  if (slot.teacherId !== teacher.id) {
    // The office may have put them in it for this one date.
    const standIn = await ctx.db.classSession.findFirst({
      where: { timetableSlotId: slot.id, date, actualTeacherId: teacher.id },
      select: { id: true },
    });
    if (!standIn) throw new ForbiddenError("That period is not one of yours.");
  }

  // The timetable fixes which weekday the period falls on.
  if (dayOfWeek(date) !== slot.dayOfWeek) {
    throw new AppError("VALIDATION", "That period does not fall on that day of the week.");
  }

  return { teacher, slot };
}

/**
 * Set — or change — what a period is going to cover.
 *
 * Upserted on `(schoolId, timetableSlotId, date)`, so planning a period that has
 * already been written up edits that record's plan rather than creating a second
 * account of the same lesson. Recording the class afterwards leaves the plan in
 * place, which is what lets a student compare the two.
 */
export async function planLesson(
  ctx: TenantContext,
  input: LessonPlanInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");

  const now = today();
  if (input.date < now) {
    throw new AppError("VALIDATION", "A lesson cannot be planned for a day that has passed.");
  }
  if (input.date > addDays(now, PLANNING_HORIZON_DAYS)) {
    throw new AppError(
      "VALIDATION",
      `Lessons can be planned up to ${PLANNING_HORIZON_DAYS} days ahead.`,
    );
  }
  if (!input.plannedTopic && !input.preparation) {
    throw new AppError("VALIDATION", "Give the lesson a topic, or something to prepare.");
  }

  const { teacher, slot } = await requireTeachablePeriod(ctx, input.timetableSlotId, input.date);

  const record = await ctx.db.classSession.upsert({
    where: {
      schoolId_timetableSlotId_date: {
        schoolId: ctx.schoolId,
        timetableSlotId: slot.id,
        date: input.date,
      },
    },
    create: {
      schoolId: ctx.schoolId,
      timetableSlotId: slot.id,
      date: input.date,
      // Planned, not taught. The status changes when the class is written up.
      status: "SCHEDULED",
      scheduledTeacherId: slot.teacherId,
      plannedTopic: input.plannedTopic,
      preparation: input.preparation,
    },
    // Only the plan is touched: a status, topic or note already on the row
    // belongs to the record of the class and is not this function's to rewrite.
    update: { plannedTopic: input.plannedTopic, preparation: input.preparation },
    select: { id: true },
  });

  await recordAudit({
    action: "LESSON_PLANNED",
    entityType: "ClassSession",
    entityId: record.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${slot.subject.name} for ${sectionLabel(slot.section)} planned: ${input.plannedTopic ?? "preparation only"}.`,
  });

  void teacher;
  return record;
}

/**
 * One of this teacher's own lessons, whether planned or already written up.
 *
 * Scoped to either end of a substitution, so a stand-in can attach material to
 * the class they actually took.
 */
async function requireOwnLesson(ctx: TenantContext, classSessionId: string) {
  const teacher = await requireTeacherSelf(ctx);

  const lesson = await ctx.db.classSession.findFirst({
    where: {
      id: classSessionId,
      OR: [{ scheduledTeacherId: teacher.id }, { actualTeacherId: teacher.id }],
    },
    select: {
      id: true,
      date: true,
      timetableSlot: {
        select: {
          subject: { select: { name: true } },
          section: {
            select: {
              name: true,
              class: { select: { name: true } },
              stream: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Another teacher's lesson and a missing one are the same answer.
  if (!lesson) throw new NotFoundError("That lesson was not found.");
  return lesson;
}

export type MaterialInput = {
  classSessionId: string;
  kind: MaterialKind;
  title: string;
  url: string | null;
  body: string | null;
};

/**
 * Attach notes, a link, a document or practice work to one lesson.
 *
 * A link or a document needs a URL; notes, questions and practice need text.
 * Enforced here rather than only in the form, because the service is reachable
 * from the API and a material with neither is a row a student cannot use.
 */
export async function addLessonMaterial(
  ctx: TenantContext,
  input: MaterialInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const lesson = await requireOwnLesson(ctx, input.classSessionId);

  const wantsUrl = URL_KINDS.includes(input.kind);
  if (wantsUrl && !input.url) {
    throw new AppError("VALIDATION", "A link or a document needs a web address.");
  }
  if (!wantsUrl && !input.body) {
    throw new AppError("VALIDATION", "Write the notes, questions or practice work itself.");
  }

  const created = await ctx.db.lessonMaterial.create({
    data: {
      schoolId: ctx.schoolId,
      classSessionId: lesson.id,
      kind: input.kind,
      title: input.title,
      // Only the field the kind actually uses is stored, so a kind change can
      // never leave a stale URL behind a block of notes.
      url: wantsUrl ? input.url : null,
      body: wantsUrl ? null : input.body,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "LESSON_MATERIAL_ADDED",
    entityType: "ClassSession",
    entityId: lesson.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${input.title}" added to ${lesson.timetableSlot.subject.name} for ${sectionLabel(lesson.timetableSlot.section)}.`,
  });

  return created;
}

export async function deleteLessonMaterial(ctx: TenantContext, materialId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");

  const material = await ctx.db.lessonMaterial.findFirst({
    where: { id: materialId },
    select: { id: true, title: true, classSessionId: true },
  });
  if (!material) throw new NotFoundError("That material was not found.");

  // Reached through the lesson, so the same two ways in apply.
  const lesson = await requireOwnLesson(ctx, material.classSessionId);

  await ctx.db.lessonMaterial.deleteMany({ where: { id: material.id } });

  await recordAudit({
    action: "LESSON_MATERIAL_REMOVED",
    entityType: "ClassSession",
    entityId: lesson.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${material.title}" removed from ${lesson.timetableSlot.subject.name}.`,
  });
}

/**
 * The teacher's own planned lessons that have not been taught yet.
 *
 * What the "Planned" list on their own screens reads, and the counterpart of
 * what students see as "upcoming".
 */
export async function listMyPlannedLessons(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const now = today();

  const rows = await ctx.db.classSession.findMany({
    where: {
      date: { gte: now, lte: addDays(now, PLANNING_HORIZON_DAYS) },
      status: "SCHEDULED",
      OR: [{ scheduledTeacherId: teacher.id }, { actualTeacherId: teacher.id }],
      AND: [{ OR: [{ plannedTopic: { not: null } }, { preparation: { not: null } }] }],
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      plannedTopic: true,
      preparation: true,
      timetableSlot: {
        select: {
          id: true,
          startMinute: true,
          subject: { select: { name: true } },
          section: {
            select: {
              name: true,
              class: { select: { name: true } },
              stream: { select: { name: true } },
            },
          },
        },
      },
      _count: { select: { materials: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    slotId: row.timetableSlot.id,
    startMinute: row.timetableSlot.startMinute,
    subject: row.timetableSlot.subject.name,
    section: sectionLabel(row.timetableSlot.section),
    plannedTopic: row.plannedTopic,
    preparation: row.preparation,
    materialCount: row._count.materials,
  }));
}
