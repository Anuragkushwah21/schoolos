import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { homeworkStatus } from "@/lib/time-status";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireStreamTeaching } from "@/server/academics/stream-scope";
import { accessibleSectionIds, requireTeacherSelf } from "@/server/auth/teacher-access";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { requireSyllabusItemFor } from "@/server/academics/syllabus";
import { recordAudit } from "@/server/audit/log";
import {
  type MaterialFields,
  type PreparedMaterial,
  assertRoomForMore,
  isValidWebAddress,
  prepareMaterial,
  saveMaterial,
} from "@/server/classwork/materials";
import { deleteStoredFile, storeDocument, validateDocument } from "@/server/storage/files";
import { assertCan } from "@/server/auth/permissions";

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

/** What a teacher can attach to homework: a PDF, a video, or a link. */
export const HOMEWORK_RESOURCE_KINDS = ["DOCUMENT", "VIDEO", "LINK"] as const;
export type HomeworkResourceKind = (typeof HOMEWORK_RESOURCE_KINDS)[number];

export type HomeworkResourceInput = Omit<MaterialFields, "kind" | "body"> & {
  kind: HomeworkResourceKind;
};

export const HOMEWORK_AUDIENCES = ["SECTION", "SELECTED_STUDENTS"] as const;
export type HomeworkAudience = (typeof HOMEWORK_AUDIENCES)[number];

export type HomeworkInput = {
  sectionId: string;
  /**
   * More sections to set the same work for, in one save (new homework only).
   * Each becomes its own homework row, checked exactly like `sectionId`.
   */
  extraSectionIds?: string[];
  subjectId: string;
  /** One stream of a section split into streams; null/absent is the whole section. */
  streamId?: string | null;
  /** The whole section (default), or only `studentIds`. */
  audience?: HomeworkAudience;
  /** For SELECTED_STUDENTS: students placed in the chosen section(s). */
  studentIds?: string[];
  /** The unit, chapter or topic it practises — from the class's syllabus. Left alone on edit when absent. */
  syllabusItemId?: string | null;
  title: string;
  description: string | null;
  /** Step-by-step instructions for the student. */
  instructions?: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
};

/** Students one section's homework may be set for: placed there this session, still on the roll, in the stream when one is chosen. */
async function eligibleStudents(ctx: TenantContext, sectionId: string, academicSessionId: string, streamId: string | null) {
  const rows = await ctx.db.studentEnrollment.findMany({
    where: { sectionId, academicSessionId, status: "ACTIVE", student: { status: { in: ["ACTIVE", "ON_LEAVE"] } } },
    select: { studentId: true, streamId: true, section: { select: { streamId: true } } },
  });
  return rows.filter((row) => !streamId || (row.streamId ?? row.section.streamId) === streamId).map((row) => row.studentId);
}

/**
 * Split the chosen students across the chosen sections, refusing any student
 * who is not placed in one of them (another section, another school, a
 * student who has left — all the same answer) and any section left with none.
 */
async function targetsBySection(
  ctx: TenantContext,
  sections: Array<{ sectionId: string; streamId: string | null; label: string }>,
  academicSessionId: string,
  studentIds: readonly string[],
): Promise<Map<string, string[]>> {
  const wanted = [...new Set(studentIds)];
  if (!wanted.length) throw new AppError("VALIDATION", "Choose at least one student, or set it for the whole class.");
  if (wanted.length > 500) throw new AppError("VALIDATION", "Choose at most 500 students.");
  const out = new Map<string, string[]>();
  const placed = new Set<string>();
  for (const section of sections) {
    const eligible = new Set(await eligibleStudents(ctx, section.sectionId, academicSessionId, section.streamId));
    const chosen = wanted.filter((id) => eligible.has(id));
    if (!chosen.length) throw new AppError("VALIDATION", `No student chosen in ${section.label}. Choose students there, or leave that class out.`);
    chosen.forEach((id) => placed.add(id));
    out.set(section.sectionId, chosen);
  }
  if (wanted.some((id) => !placed.has(id))) throw new ForbiddenError("Some chosen students are not in the classes this homework is for.");
  return out;
}

const HOMEWORK_SELECT = {
  id: true,
  title: true,
  description: true,
  instructions: true,
  assignedOn: true,
  dueOn: true,
  status: true,
  teacherId: true,
  createdAt: true,
  audience: true,
  syllabusItemId: true,
  _count: { select: { resources: true, targets: true, submissions: true } },
  streamId: true,
  stream: { select: { name: true } },
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
  instructions: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
  teacherId: string;
  audience: HomeworkAudience;
  syllabusItemId: string | null;
  _count: { resources: number; targets: number; submissions: number };
  streamId: string | null;
  stream: { name: string } | null;
  subject: { id: string; name: string };
  section: { id: string; name: string; class: { name: string }; stream: { name: string } | null };
};

function shape(row: HomeworkRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    assignedOn: row.assignedOn,
    dueOn: row.dueOn,
    status: row.status,
    resourceCount: row._count.resources,
    /** SECTION, or SELECTED_STUDENTS with `studentCount` students. */
    audience: row.audience,
    syllabusItemId: row.syllabusItemId,
    studentCount: row.audience === "SELECTED_STUDENTS" ? row._count.targets : null,
    /** How many students the teacher has recorded (submitted, late or missing). */
    checkedCount: row._count.submissions,
    subjectId: row.subject.id,
    subject: row.subject.name,
    sectionId: row.section.id,
    streamId: row.streamId,
    stream: row.stream?.name ?? null,
    /** The class, and the stream when the work is for one stream only. */
    section: row.stream ? `${sectionLabel(row.section)} · ${row.stream.name}` : sectionLabel(row.section),
    overdue: row.status === "PUBLISHED" && row.dueOn < today(),
    /** ASSIGNED, DUE_TODAY or OVERDUE for published work, from the due date. */
    timeStatus: row.status === "PUBLISHED" ? homeworkStatus(row.dueOn) : null,
  };
}

/** Work cannot be due before it is set. */
function assertDates(assignedOn: Date, dueOn: Date): void {
  if (dueOn < assignedOn) {
    throw new AppError("VALIDATION", "The due date cannot be before the date it is set.");
  }
}

/** Check every resource before anything is written, so one bad file refuses the lot. */
async function prepareResources(resources: HomeworkResourceInput[]): Promise<PreparedMaterial[]> {
  const prepared: PreparedMaterial[] = [];
  for (const resource of resources) {
    if (!(HOMEWORK_RESOURCE_KINDS as readonly string[]).includes(resource.kind)) {
      throw new AppError("VALIDATION", "Homework resources are a PDF, a video or a link.");
    }
    prepared.push(await prepareMaterial(resource));
  }
  return prepared;
}

/**
 * Set homework, with any study resources attached in the same save.
 *
 * Resources are checked first, then the homework is created, then each
 * resource is stored. If storing fails part-way, the homework and whatever was
 * already stored are removed again, so a failed save never leaves half an
 * assignment in front of the class.
 */
export async function createHomework(
  ctx: TenantContext,
  input: HomeworkInput,
  resources: HomeworkResourceInput[] = [],
): Promise<{ id: string; ids: string[] }> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const sectionIds = [...new Set([input.sectionId, ...(input.extraSectionIds ?? [])])];
  if (sectionIds.length > 20) throw new AppError("VALIDATION", "Set it for at most 20 classes at a time.");
  // A stream belongs to one section, so work for one stream is for one class.
  if (sectionIds.length > 1 && input.streamId) throw new AppError("VALIDATION", "Work for one stream can be set for one class at a time.");
  const audience: HomeworkAudience = input.audience ?? "SECTION";

  // The one check that matters, for every class: do they teach this subject
  // to this section (and stream, when the section is split into streams)?
  const targets: Array<{ sectionId: string; streamId: string | null; label: string; teacherId: string }> = [];
  for (const sectionId of sectionIds) {
    const { teacherId, streamId } = await requireStreamTeaching(ctx, {
      sectionId,
      subjectId: input.subjectId,
      streamId: sectionIds.length > 1 ? null : (input.streamId ?? null),
      academicSessionId: session.id,
    });
    const section = await ctx.db.section.findFirstOrThrow({ where: { id: sectionId }, select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } });
    targets.push({ sectionId, streamId, label: sectionLabel(section), teacherId });
  }
  assertDates(input.assignedOn, input.dueOn);
  const students = audience === "SELECTED_STUDENTS" ? await targetsBySection(ctx, targets, session.id, input.studentIds ?? []) : null;
  // A syllabus entry belongs to one class: every chosen class must have it.
  let syllabusItemId: string | null = null;
  for (const target of targets) syllabusItemId = await requireSyllabusItemFor(ctx, input.syllabusItemId, { sectionId: target.sectionId, subjectId: input.subjectId, academicSessionId: session.id });

  // A double-clicked or re-sent form must not set the same work twice.
  for (const target of targets) {
    const duplicate = await ctx.db.homework.findFirst({
      where: {
        teacherId: target.teacherId,
        sectionId: target.sectionId,
        subjectId: input.subjectId,
        streamId: target.streamId,
        title: input.title,
        assignedOn: input.assignedOn,
        dueOn: input.dueOn,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError(`This homework has already been set for ${target.label}.`);
    }
  }

  if (resources.length > 20) {
    throw new AppError("VALIDATION", "At most 20 resources can be attached.");
  }
  const prepared = await prepareResources(resources);

  // Every class's row (and its chosen students) together, or none.
  const created = await ctx.db.$transaction(async (tx) => {
    const rows: Array<{ id: string; label: string; streamName: string | null; students: number | null }> = [];
    for (const target of targets) {
      const row = await tx.homework.create({
        data: {
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          sectionId: target.sectionId,
          subjectId: input.subjectId,
          teacherId: target.teacherId,
          streamId: target.streamId,
          audience,
          syllabusItemId,
          title: input.title,
          description: input.description,
          instructions: input.instructions ?? null,
          assignedOn: input.assignedOn,
          dueOn: input.dueOn,
          status: input.status,
        },
        select: { id: true, stream: { select: { name: true } } },
      });
      const chosen = students?.get(target.sectionId) ?? null;
      if (chosen) {
        await tx.homeworkStudent.createMany({ data: chosen.map((studentId) => ({ schoolId: ctx.schoolId, homeworkId: row.id, studentId })) });
      }
      rows.push({ id: row.id, label: target.label, streamName: row.stream?.name ?? null, students: chosen?.length ?? null });
    }
    return rows;
  });

  for (const row of created) {
    await recordAudit({
      action: "HOMEWORK_CREATED",
      entityType: "Homework",
      entityId: row.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Homework "${input.title}" set for ${row.label}${row.streamName ? ` (${row.streamName})` : ""}. ${row.students !== null ? `Selected students: ${row.students}.` : "Whole class."}`,
    });
  }

  // Each class's homework gets its own copy of every resource, so deleting
  // one class's homework never removes a file another class still uses.
  const stored: string[] = [];
  try {
    for (const row of created) {
      for (const resource of prepared) {
        const saved = await saveMaterial(ctx, { homeworkId: row.id }, resource);
        if (saved.storageKey) stored.push(saved.storageKey);
      }
    }
  } catch (error) {
    // Resources and chosen students cascade with the homework; files do not.
    await ctx.db.homework.deleteMany({ where: { id: { in: created.map((row) => row.id) } } });
    await Promise.all(stored.map(deleteStoredFile));
    throw error;
  }

  return { id: created[0]!.id, ids: created.map((row) => row.id) };
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
    select: { id: true, teacherId: true, title: true, sectionId: true, subjectId: true, academicSessionId: true, streamId: true, status: true, audience: true, assignedOn: true, dueOn: true, targets: { select: { studentId: true } } },
  });

  if (!row) throw new NotFoundError("That homework was not found.");
  if (row.teacherId !== teacher.id) {
    throw new ForbiddenError("You can only change homework you set yourself.");
  }

  return { ...row, targets: row.targets.map((target) => target.studentId) };
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
  const { streamId } = await requireStreamTeaching(ctx, {
    sectionId: input.sectionId,
    subjectId: input.subjectId,
    streamId: input.streamId ?? null,
    academicSessionId: session.id,
  });
  assertDates(input.assignedOn, input.dueOn);
  if (input.extraSectionIds?.length) throw new AppError("VALIDATION", "Saved homework belongs to one class. Set new homework to add another class.");

  // Who it is for: unchanged unless the form says otherwise. The chosen
  // students are checked against the (possibly new) class and stream.
  const audience: HomeworkAudience = input.audience ?? existing.audience;
  let students: string[] | null = null;
  if (audience === "SELECTED_STUDENTS") {
    const ids = input.studentIds ?? (input.audience ? [] : existing.targets);
    const section = await ctx.db.section.findFirstOrThrow({ where: { id: input.sectionId }, select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } });
    students = (await targetsBySection(ctx, [{ sectionId: input.sectionId, streamId, label: sectionLabel(section) }], session.id, ids)).get(input.sectionId)!;
  }

  const syllabusItemId = input.syllabusItemId !== undefined ? await requireSyllabusItemFor(ctx, input.syllabusItemId, { sectionId: input.sectionId, subjectId: input.subjectId, academicSessionId: session.id }) : undefined;

  await ctx.db.$transaction(async (tx) => {
    await tx.homework.update({
      where: { id: existing.id },
      data: {
        sectionId: input.sectionId,
        subjectId: input.subjectId,
        streamId,
        audience,
        ...(syllabusItemId !== undefined ? { syllabusItemId } : {}),
        title: input.title,
        description: input.description,
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        assignedOn: input.assignedOn,
        dueOn: input.dueOn,
        status: input.status,
      },
    });
    // The student list is replaced, never merged: it is exactly who is chosen now.
    await tx.homeworkStudent.deleteMany({ where: { homeworkId: existing.id, ...(students ? { studentId: { notIn: students } } : {}) } });
    if (students?.length) {
      await tx.homeworkStudent.createMany({ data: students.map((studentId) => ({ schoolId: ctx.schoolId, homeworkId: existing.id, studentId })), skipDuplicates: true });
    }
  });

  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${input.title}" updated. ${students ? `Selected students: ${students.length}.` : "Whole class."}`,
  });
}

export async function deleteHomework(ctx: TenantContext, homeworkId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const existing = await requireOwnHomework(ctx, homeworkId);

  // The resource rows cascade with the homework; the files they point at are
  // removed here, once the rows are gone.
  const files = await ctx.db.lessonMaterial.findMany({
    where: { homeworkId: existing.id, storageKey: { not: null } },
    select: { storageKey: true },
  });

  await ctx.db.homework.delete({ where: { id: existing.id } });
  await Promise.all(files.map((file) => deleteStoredFile(file.storageKey!)));

  await recordAudit({
    action: "HOMEWORK_DELETED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${existing.title}" deleted.`,
  });
}

/**
 * The students a teacher can pick for homework, per section they teach this
 * session: name, roll number and stream (their own, or the section's). Only
 * sections the teacher is assigned to — nobody else's class, nobody from
 * another school.
 */
export async function homeworkStudentChoices(ctx: TenantContext): Promise<Record<string, Array<{ id: string; name: string; rollNumber: string | null; streamId: string | null }>>> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);
  const assignments = await ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: session.id }, select: { sectionId: true } });
  const sectionIds = [...new Set(assignments.map((row) => row.sectionId))];
  if (!sectionIds.length) return {};
  const rows = await ctx.db.studentEnrollment.findMany({
    where: { sectionId: { in: sectionIds }, academicSessionId: session.id, status: "ACTIVE", student: { status: { in: ["ACTIVE", "ON_LEAVE"] } } },
    select: { sectionId: true, rollNumber: true, streamId: true, section: { select: { streamId: true } }, student: { select: { id: true, firstName: true, lastName: true } } },
  });
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);
  const out: Record<string, Array<{ id: string; name: string; rollNumber: string | null; streamId: string | null }>> = {};
  for (const row of rows.sort((a, b) => rollOrder(a.rollNumber) - rollOrder(b.rollNumber) || a.student.firstName.localeCompare(b.student.firstName))) {
    (out[row.sectionId] ??= []).push({ id: row.student.id, name: `${row.student.firstName} ${row.student.lastName}`.trim(), rollNumber: row.rollNumber, streamId: row.streamId ?? row.section.streamId });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Who handed it in: recorded by the teacher who set it, after checking
// -----------------------------------------------------------------------------

/** What a teacher can record per student. "ASSIGNED" clears a mark. */
export const SUBMISSION_MARKS = ["ASSIGNED", "SUBMITTED", "LATE", "MISSING"] as const;
export type SubmissionMark = (typeof SUBMISSION_MARKS)[number];

/**
 * The students this homework is for, each with what the teacher recorded:
 * everyone placed in the section (or stream) for whole-class work, or the
 * chosen students. No mark means it is simply assigned — nothing is ever
 * marked because someone opened it.
 */
export async function homeworkRoster(ctx: TenantContext, homeworkId: string) {
  assertRole(ctx.user, "TEACHER");
  const homework = await requireOwnHomework(ctx, homeworkId);
  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: {
      sectionId: homework.sectionId,
      academicSessionId: homework.academicSessionId,
      status: "ACTIVE",
      student: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      ...(homework.audience === "SELECTED_STUDENTS" ? { studentId: { in: homework.targets } } : {}),
    },
    select: { rollNumber: true, streamId: true, section: { select: { streamId: true } }, student: { select: { id: true, firstName: true, lastName: true } } },
  });
  const students = enrollments.filter((row) => !homework.streamId || (row.streamId ?? row.section.streamId) === homework.streamId);
  const marks = await ctx.db.homeworkSubmission.findMany({ where: { homeworkId: homework.id }, select: { studentId: true, status: true, note: true, markedAt: true } });
  const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);
  const rows = students
    .sort((a, b) => rollOrder(a.rollNumber) - rollOrder(b.rollNumber) || a.student.firstName.localeCompare(b.student.firstName))
    .map((row) => {
      const mark = byStudent.get(row.student.id);
      return { studentId: row.student.id, name: `${row.student.firstName} ${row.student.lastName}`.trim(), rollNumber: row.rollNumber, status: (mark?.status ?? "ASSIGNED") as SubmissionMark, note: mark?.note ?? null, markedAt: mark?.markedAt ?? null };
    });
  const count = (status: SubmissionMark) => rows.filter((row) => row.status === status).length;
  return {
    audience: homework.audience,
    status: homework.status,
    dueOn: homework.dueOn,
    /** Missing can only be recorded once the work is due. */
    canMarkMissing: homework.dueOn <= today(),
    canMark: homework.status === "PUBLISHED" && homework.assignedOn <= today(),
    students: rows,
    counts: { total: rows.length, assigned: count("ASSIGNED"), submitted: count("SUBMITTED"), late: count("LATE"), missing: count("MISSING") },
  };
}

/**
 * Record what the teacher found when checking the homework. Only the teacher
 * who set it, only published work that has been set (not before its date),
 * only students it is for, and "missing" only once it is due.
 */
export async function markHomeworkSubmissions(ctx: TenantContext, homeworkId: string, marks: ReadonlyArray<{ studentId: string; status: SubmissionMark; note?: string | null }>) {
  assertRole(ctx.user, "TEACHER");
  const roster = await homeworkRoster(ctx, homeworkId);
  if (roster.status !== "PUBLISHED") throw new ConflictError("Publish the homework before recording who handed it in.");
  if (!roster.canMark) throw new ConflictError("This homework has not been set yet.");
  if (!marks.length) throw new AppError("VALIDATION", "Nothing to record.");
  const allowed = new Set(roster.students.map((row) => row.studentId));
  if (marks.some((mark) => !allowed.has(mark.studentId))) throw new ForbiddenError("Some students are not ones this homework is for.");
  if (!roster.canMarkMissing && marks.some((mark) => mark.status === "MISSING")) throw new ConflictError("Homework can be marked missing only once it is due.");

  const current = new Map(roster.students.map((row) => [row.studentId, row]));
  const changed = marks.filter((mark) => current.get(mark.studentId)!.status !== mark.status || (mark.note ?? null) !== current.get(mark.studentId)!.note);
  if (!changed.length) return { changed: 0 };

  await ctx.db.$transaction(async (tx) => {
    for (const mark of changed) {
      if (mark.status === "ASSIGNED") {
        await tx.homeworkSubmission.deleteMany({ where: { homeworkId, studentId: mark.studentId } });
        continue;
      }
      await tx.homeworkSubmission.upsert({
        where: { schoolId_homeworkId_studentId: { schoolId: ctx.schoolId, homeworkId, studentId: mark.studentId } },
        create: { schoolId: ctx.schoolId, homeworkId, studentId: mark.studentId, status: mark.status, note: mark.note ?? null, markedByUserId: ctx.user.id },
        update: { status: mark.status, note: mark.note ?? null, markedByUserId: ctx.user.id, markedAt: new Date() },
      });
    }
  });

  const tally = (status: SubmissionMark) => changed.filter((mark) => mark.status === status).length;
  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: homeworkId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework checked: ${tally("SUBMITTED")} submitted, ${tally("LATE")} late, ${tally("MISSING")} missing, ${tally("ASSIGNED")} cleared.`,
  });
  return { changed: changed.length };
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
    select: {
      ...HOMEWORK_SELECT,
      resources: { orderBy: { createdAt: "asc" }, select: RESOURCE_SELECT },
      targets: { select: { studentId: true } },
    },
  });
  return { ...shape(row), resources: row.resources, studentIds: row.targets.map((target) => target.studentId) };
}

// -----------------------------------------------------------------------------
// Study resources on existing homework
// -----------------------------------------------------------------------------

/** The storage key stays on the server; everything else is safe to show. */
export const RESOURCE_SELECT = {
  id: true,
  kind: true,
  title: true,
  url: true,
  description: true,
  fileName: true,
  fileSize: true,
} as const;

/** A resource on homework this teacher set, or "not found". */
async function requireOwnResource(ctx: TenantContext, resourceId: string) {
  const teacher = await requireTeacherSelf(ctx);
  const resource = await ctx.db.lessonMaterial.findFirst({
    where: { id: resourceId, homework: { teacherId: teacher.id } },
    select: { id: true, kind: true, title: true, url: true, storageKey: true, homeworkId: true },
  });
  // Another teacher's resource, a class material and a missing id look alike.
  if (!resource?.homeworkId) throw new NotFoundError("That resource was not found.");
  return { ...resource, homeworkId: resource.homeworkId };
}

export async function addHomeworkResource(
  ctx: TenantContext,
  homeworkId: string,
  input: HomeworkResourceInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const homework = await requireOwnHomework(ctx, homeworkId);
  const owner = { homeworkId: homework.id };

  await assertRoomForMore(ctx, owner);
  const [prepared] = await prepareResources([input]);
  const saved = await saveMaterial(ctx, owner, prepared!);

  await recordAudit({
    action: "LESSON_MATERIAL_ADDED",
    entityType: "Homework",
    entityId: homework.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${input.title}" attached to homework "${homework.title}".`,
  });

  return { id: saved.id };
}

export type HomeworkResourceUpdate = {
  title: string;
  description: string | null;
  /** For a video or link, or a document hosted elsewhere. */
  url: string | null;
  /** A replacement PDF for an uploaded document. */
  file?: File | null;
};

/**
 * Change a resource's title, description or address, or replace its PDF.
 *
 * The kind stays what it was: turning a video into a PDF is removing one and
 * adding the other. A replaced PDF is written before the old one is deleted,
 * so a failed upload leaves the original in place.
 */
export async function updateHomeworkResource(
  ctx: TenantContext,
  resourceId: string,
  input: HomeworkResourceUpdate,
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const resource = await requireOwnResource(ctx, resourceId);

  const replacement =
    resource.kind === "DOCUMENT" && input.file && input.file.size > 0
      ? await validateDocument(input.file)
      : null;

  if (!replacement && !resource.storageKey) {
    // A link-shaped resource must keep a working address.
    if (!input.url) throw new AppError("VALIDATION", "Give a web address.");
    if (!isValidWebAddress(input.url)) {
      throw new AppError("VALIDATION", "Enter a valid https:// web address.");
    }
  }

  const newKey = replacement ? await storeDocument(ctx.schoolId, replacement) : null;
  try {
    await ctx.db.lessonMaterial.updateMany({
      where: { id: resource.id },
      data: {
        title: input.title,
        description: input.description,
        ...(replacement
          ? {
              url: null,
              storageKey: newKey,
              fileName: replacement.fileName,
              fileSize: replacement.size,
              mimeType: replacement.mimeType,
            }
          : resource.storageKey
            ? {}
            : { url: input.url }),
      },
    });
  } catch (error) {
    if (newKey) await deleteStoredFile(newKey);
    throw error;
  }
  if (newKey && resource.storageKey) await deleteStoredFile(resource.storageKey);

  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: resource.homeworkId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Resource "${input.title}" updated${replacement ? " with a new PDF" : ""}.`,
  });
}

/** Remove one resource. The homework itself is untouched. */
export async function removeHomeworkResource(ctx: TenantContext, resourceId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const resource = await requireOwnResource(ctx, resourceId);

  await ctx.db.lessonMaterial.deleteMany({ where: { id: resource.id } });
  if (resource.storageKey) await deleteStoredFile(resource.storageKey);

  await recordAudit({
    action: "LESSON_MATERIAL_REMOVED",
    entityType: "Homework",
    entityId: resource.homeworkId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${resource.title}" removed from homework.`,
  });
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
  options: { from: Date; to: Date; take?: number; /** One of my sections only; any other id is ignored. */ sectionId?: string | null },
) {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const sectionIds = await accessibleSectionIds(ctx, session.id);

  // "ALL" belongs to admins; a teacher with no sections sees nothing.
  const mine = sectionIds === "ALL" ? [] : sectionIds;
  if (mine.length === 0) return [];
  const scope = options.sectionId && mine.includes(options.sectionId) ? [options.sectionId] : mine;

  const rows = await ctx.db.homework.findMany({
    where: {
      sectionId: { in: scope },
      status: "PUBLISHED",
      dueOn: { gte: options.from, lte: options.to },
    },
    orderBy: { dueOn: "asc" },
    take: options.take ?? 20,
    select: HOMEWORK_SELECT,
  });

  return rows.map(shape);
}

export const ADMIN_HOMEWORK_PAGE_SIZE = 30;

/**
 * The School Admin's read-only view of homework across the school — what has
 * been set, by whom, and when it is due. Teachers remain the only people who
 * set or change homework; drafts stay private to their teacher.
 */
export async function listHomeworkForAdmin(
  ctx: TenantContext,
  filters: { q?: string; sectionId?: string; due?: "upcoming" | "today" | "past"; page?: number } = {},
) {
  assertCan(ctx, "homework", "VIEW");
  const now = today();
  const page = Math.max(1, filters.page ?? 1);
  const where = {
    status: "PUBLISHED" as const,
    academicSession: { isCurrent: true },
    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
    ...(filters.due === "upcoming" ? { dueOn: { gt: now } } : filters.due === "today" ? { dueOn: now } : filters.due === "past" ? { dueOn: { lt: now } } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { subject: { name: { contains: filters.q, mode: "insensitive" as const } } },
            { teacher: { firstName: { contains: filters.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const [rows, total, setToday, dueToday] = await Promise.all([
    ctx.db.homework.findMany({
      where,
      orderBy: [{ dueOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * ADMIN_HOMEWORK_PAGE_SIZE,
      take: ADMIN_HOMEWORK_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        assignedOn: true,
        dueOn: true,
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
        stream: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        _count: { select: { resources: true } },
      },
    }),
    ctx.db.homework.count({ where }),
    ctx.db.homework.count({ where: { status: "PUBLISHED", assignedOn: now } }),
    ctx.db.homework.count({ where: { status: "PUBLISHED", dueOn: now } }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject.name,
      teacher: `${row.teacher.firstName} ${row.teacher.lastName}`.trim(),
      section: row.stream ? `${sectionLabel(row.section)} · ${row.stream.name}` : sectionLabel(row.section),
      assignedOn: row.assignedOn,
      dueOn: row.dueOn,
      resources: row._count.resources,
      timeStatus: homeworkStatus(row.dueOn, now),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_HOMEWORK_PAGE_SIZE)),
    setToday,
    dueToday,
  };
}
