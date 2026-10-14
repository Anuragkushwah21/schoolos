import "server-only";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { requireCurrentSession } from "@/server/academics/structure";

/**
 * The school's syllabus for one class and subject in the current session:
 * units → chapters → topics. It says what is expected to be taught; what was
 * taught is recorded per lesson (`LessonTopic`, see progress.ts). Each school
 * writes its own — nothing is built in, so any board or curriculum fits.
 *
 *   * School leaders (School Admin, Principal) edit it (`academics` EDIT).
 *   * A teacher reads it for a class and subject they are assigned to teach.
 *   * Students and parents do not see it here.
 */

export const SYLLABUS_LEVELS = ["UNIT", "CHAPTER", "TOPIC"] as const;
export type SyllabusLevel = (typeof SYLLABUS_LEVELS)[number];
const PARENT_LEVEL: Record<SyllabusLevel, SyllabusLevel | null> = { UNIT: null, CHAPTER: "UNIT", TOPIC: "CHAPTER" };

export type SyllabusTopic = { id: string; title: string; position: number };
export type SyllabusChapter = { id: string; title: string; position: number; topics: SyllabusTopic[] };
export type SyllabusUnit = { id: string; title: string; position: number; plannedFrom: Date | null; plannedTo: Date | null; chapters: SyllabusChapter[] };

/**
 * May this person read the syllabus for this class and subject? Leaders always
 * (in their school); a teacher only for a subject they teach in some section
 * of that class this session. Anyone else — or another school's ids — is refused.
 */
export async function requireSyllabusReader(ctx: TenantContext, classId: string, subjectId: string, academicSessionId: string): Promise<void> {
  if (ctx.user.role === "TEACHER") {
    const teacher = await requireTeacherSelf(ctx);
    const assigned = await ctx.db.teacherSubjectAssignment.findFirst({ where: { teacherId: teacher.id, subjectId, academicSessionId, section: { classId } }, select: { id: true } });
    if (!assigned) throw new ForbiddenError("You do not teach that subject to that class.");
    return;
  }
  assertCan(ctx, "academics", "VIEW");
}

/** One class and subject's syllabus as a tree, in teaching order. Empty when it has not been set up. */
export async function getSyllabus(ctx: TenantContext, input: { classId: string; subjectId: string; academicSessionId?: string }): Promise<SyllabusUnit[]> {
  const sessionId = input.academicSessionId ?? (await requireCurrentSession(ctx)).id;
  await requireSyllabusReader(ctx, input.classId, input.subjectId, sessionId);
  const rows = await ctx.db.syllabusItem.findMany({
    where: { academicSessionId: sessionId, classId: input.classId, subjectId: input.subjectId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, level: true, parentId: true, title: true, position: true, plannedFrom: true, plannedTo: true },
  });
  return buildTree(rows);
}

export function buildTree(rows: ReadonlyArray<{ id: string; level: SyllabusLevel; parentId: string | null; title: string; position: number; plannedFrom: Date | null; plannedTo: Date | null }>): SyllabusUnit[] {
  const topics = (chapterId: string) => rows.filter((row) => row.level === "TOPIC" && row.parentId === chapterId).map((row) => ({ id: row.id, title: row.title, position: row.position }));
  const chapters = (unitId: string) => rows.filter((row) => row.level === "CHAPTER" && row.parentId === unitId).map((row) => ({ id: row.id, title: row.title, position: row.position, topics: topics(row.id) }));
  return rows.filter((row) => row.level === "UNIT").map((row) => ({ id: row.id, title: row.title, position: row.position, plannedFrom: row.plannedFrom, plannedTo: row.plannedTo, chapters: chapters(row.id) }));
}

export type SyllabusItemInput = {
  id?: string | null;
  classId: string;
  subjectId: string;
  level: SyllabusLevel;
  parentId: string | null;
  title: string;
  position?: number | null;
  plannedFrom?: Date | null;
  plannedTo?: Date | null;
};

/** Add or rename a unit, chapter or topic. Leaders only; the parent must be one level up in the same class, subject and session. */
export async function saveSyllabusItem(ctx: TenantContext, input: SyllabusItemInput): Promise<{ id: string }> {
  assertCan(ctx, "academics", "EDIT");
  const session = await requireCurrentSession(ctx);
  const title = input.title.trim();
  if (title.length < 1 || title.length > 200) throw new AppError("VALIDATION", "Give it a title (up to 200 characters).");
  const [klass, subject] = await Promise.all([
    ctx.db.class.findFirst({ where: { id: input.classId }, select: { id: true, name: true } }),
    ctx.db.subject.findFirst({ where: { id: input.subjectId }, select: { id: true, name: true } }),
  ]);
  if (!klass || !subject) throw new NotFoundError("That class or subject was not found.");

  const wantParent = PARENT_LEVEL[input.level];
  if (wantParent) {
    if (!input.parentId) throw new AppError("VALIDATION", input.level === "CHAPTER" ? "Choose the unit this chapter is in." : "Choose the chapter this topic is in.");
    const parent = await ctx.db.syllabusItem.findFirst({ where: { id: input.parentId, academicSessionId: session.id, classId: klass.id, subjectId: subject.id }, select: { level: true } });
    if (!parent || parent.level !== wantParent) throw new AppError("VALIDATION", input.level === "CHAPTER" ? "A chapter belongs in a unit of the same class and subject." : "A topic belongs in a chapter of the same class and subject.");
  } else if (input.parentId) {
    throw new AppError("VALIDATION", "A unit is not inside anything.");
  }
  const planned = input.level === "UNIT" ? { plannedFrom: input.plannedFrom ?? null, plannedTo: input.plannedTo ?? null } : { plannedFrom: null, plannedTo: null };
  if (planned.plannedFrom && planned.plannedTo && planned.plannedTo < planned.plannedFrom) throw new AppError("VALIDATION", "The planned end cannot be before the planned start.");

  if (input.id) {
    const existing = await ctx.db.syllabusItem.findFirst({ where: { id: input.id, academicSessionId: session.id, classId: klass.id, subjectId: subject.id, level: input.level }, select: { id: true, title: true } });
    if (!existing) throw new NotFoundError("That syllabus entry was not found.");
    await ctx.db.syllabusItem.update({ where: { id: existing.id }, data: { title, parentId: input.parentId, ...(input.position != null ? { position: input.position } : {}), ...planned } });
    await recordAudit({ action: "SYLLABUS_UPDATED", entityType: "SyllabusItem", entityId: existing.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${subject.name} ${klass.name} syllabus: ${input.level.toLowerCase()} "${existing.title}" → "${title}".` });
    return { id: existing.id };
  }

  const last = await ctx.db.syllabusItem.aggregate({ where: { academicSessionId: session.id, classId: klass.id, subjectId: subject.id, parentId: input.parentId }, _max: { position: true } });
  const created = await ctx.db.syllabusItem.create({
    data: { schoolId: ctx.schoolId, academicSessionId: session.id, classId: klass.id, subjectId: subject.id, level: input.level, parentId: input.parentId, title, position: input.position ?? (last._max.position ?? 0) + 1, ...planned },
    select: { id: true },
  });
  await recordAudit({ action: "SYLLABUS_UPDATED", entityType: "SyllabusItem", entityId: created.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${subject.name} ${klass.name} syllabus: ${input.level.toLowerCase()} "${title}" added.` });
  return created;
}

/**
 * Remove an entry that nothing uses yet. Once a lesson, homework, test or
 * review points at it — or it still has chapters or topics — it stays, so no
 * record ever loses what it was about. Rename it instead.
 */
export async function deleteSyllabusItem(ctx: TenantContext, itemId: string): Promise<void> {
  assertCan(ctx, "academics", "EDIT");
  const item = await ctx.db.syllabusItem.findFirst({
    where: { id: itemId },
    select: { id: true, title: true, level: true, _count: { select: { children: true, lessons: true, homework: true, assessments: true, reviews: true } } },
  });
  if (!item) throw new NotFoundError("That syllabus entry was not found.");
  const used = item._count.lessons + item._count.homework + item._count.assessments + item._count.reviews;
  if (item._count.children) throw new ConflictError(`Remove what is inside this ${item.level.toLowerCase()} first.`);
  if (used) throw new ConflictError(`Lessons, homework, tests or reviews already refer to this ${item.level.toLowerCase()}. Rename it instead of removing it.`);
  await ctx.db.syllabusItem.delete({ where: { id: item.id } });
  await recordAudit({ action: "SYLLABUS_UPDATED", entityType: "SyllabusItem", entityId: item.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Syllabus ${item.level.toLowerCase()} "${item.title}" removed.` });
}

/**
 * Check a unit/chapter/topic id chosen on homework, a test or a lesson: it
 * must be in the syllabus of that section's class and that subject, this
 * session. Returns the id, or null when none was chosen.
 */
export async function requireSyllabusItemFor(
  ctx: TenantContext,
  itemId: string | null | undefined,
  scope: { sectionId: string; subjectId: string; academicSessionId: string },
  levels: readonly SyllabusLevel[] = SYLLABUS_LEVELS,
): Promise<string | null> {
  if (!itemId) return null;
  const section = await ctx.db.section.findFirst({ where: { id: scope.sectionId }, select: { classId: true } });
  const item = section ? await ctx.db.syllabusItem.findFirst({ where: { id: itemId, classId: section.classId, subjectId: scope.subjectId, academicSessionId: scope.academicSessionId }, select: { id: true, level: true } }) : null;
  if (!item || !levels.includes(item.level)) throw new AppError("VALIDATION", "Choose a unit, chapter or topic from this class's syllabus for this subject.");
  return item.id;
}

/** Syllabus choices for a teacher's forms: per section+subject they teach, the flat list "Unit › Chapter › Topic". */
export async function mySyllabusChoices(ctx: TenantContext): Promise<Record<string, Array<{ id: string; level: SyllabusLevel; label: string }>>> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);
  const assignments = await ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: session.id }, select: { sectionId: true, subjectId: true, section: { select: { classId: true } } } });
  if (!assignments.length) return {};
  const items = await ctx.db.syllabusItem.findMany({
    where: { academicSessionId: session.id, OR: assignments.map((row) => ({ classId: row.section.classId, subjectId: row.subjectId })) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, level: true, parentId: true, title: true, position: true, plannedFrom: true, plannedTo: true, classId: true, subjectId: true },
  });
  const out: Record<string, Array<{ id: string; level: SyllabusLevel; label: string }>> = {};
  for (const row of assignments) {
    const tree = buildTree(items.filter((item) => item.classId === row.section.classId && item.subjectId === row.subjectId));
    const flat: Array<{ id: string; level: SyllabusLevel; label: string }> = [];
    for (const unit of tree) {
      flat.push({ id: unit.id, level: "UNIT", label: unit.title });
      for (const chapter of unit.chapters) {
        flat.push({ id: chapter.id, level: "CHAPTER", label: `${unit.title} › ${chapter.title}` });
        for (const topic of chapter.topics) flat.push({ id: topic.id, level: "TOPIC", label: `${unit.title} › ${chapter.title} › ${topic.title}` });
      }
    }
    out[`${row.sectionId}:${row.subjectId}`] = flat;
  }
  return out;
}

/** Topics per period: each slot's class and subject, from the teacher's syllabus choices. */
export function topicsBySlot(
  slots: ReadonlyArray<{ id: string; subjectId: string; section: { id: string } }>,
  choices: Record<string, Array<{ id: string; level: string; label: string }>>,
): Record<string, Array<{ id: string; label: string }>> {
  return Object.fromEntries(slots.map((slot) => [slot.id, (choices[`${slot.section.id}:${slot.subjectId}`] ?? []).filter((row) => row.level === "TOPIC").map((row) => ({ id: row.id, label: row.label }))]));
}
