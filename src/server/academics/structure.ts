import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { isForeignKeyViolation, isUniqueViolation } from "@/server/db/errors";

/**
 * Academic structure: sessions, classes, streams, subjects and sections.
 *
 * Every query runs through `ctx.db`, which is already scoped to the caller's
 * school; ids arriving from forms are therefore only ever looked up inside
 * that school; another school's id simply finds nothing.
 */

// -----------------------------------------------------------------------------
// Academic sessions
// -----------------------------------------------------------------------------

export async function getCurrentSession(ctx: TenantContext) {
  return ctx.db.academicSession.findFirst({
    where: { isCurrent: true },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
}

/** For operations that make no sense without a current session. */
export async function requireCurrentSession(ctx: TenantContext) {
  const session = await getCurrentSession(ctx);
  if (!session) {
    throw new AppError(
      "CONFLICT",
      "No academic session is marked as current. Set one under Academics first.",
    );
  }
  return session;
}

export async function listAcademicSessions(ctx: TenantContext) {
  return ctx.db.academicSession.findMany({
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
      _count: { select: { enrollments: true, sections: true } },
    },
  });
}

/** Resolve the session a page should show: the one asked for, else current. */
export async function resolveSession(ctx: TenantContext, requestedId?: string) {
  if (requestedId) {
    const requested = await ctx.db.academicSession.findFirst({
      where: { id: requestedId },
      select: { id: true, name: true, isCurrent: true },
    });
    if (requested) return requested;
  }
  return ctx.db.academicSession.findFirst({
    where: { isCurrent: true },
    select: { id: true, name: true, isCurrent: true },
  });
}

export async function createAcademicSession(
  ctx: TenantContext,
  input: { name: string; startDate: Date; endDate: Date; makeCurrent: boolean },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const overlapping = await ctx.db.academicSession.findFirst({
    where: { startDate: { lte: input.endDate }, endDate: { gte: input.startDate } },
    select: { name: true },
  });
  if (overlapping) {
    throw new ConflictError(`Those dates overlap the ${overlapping.name} session.`);
  }

  try {
    await ctx.db.$transaction(async (tx) => {
      if (input.makeCurrent) {
        await tx.academicSession.updateMany({ where: {}, data: { isCurrent: false } });
      }
      const created = await tx.academicSession.create({
        data: {
          schoolId: ctx.schoolId,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          isCurrent: input.makeCurrent,
        },
        select: { id: true },
      });
      await recordAudit({
        action: "ACADEMIC_SESSION_CREATED",
        entityType: "AcademicSession",
        entityId: created.id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: `Academic session ${input.name} created${input.makeCurrent ? " and made current" : ""}.`,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A session with that name already exists.");
    throw error;
  }
}

/**
 * Exactly one session is current. Switching is a single transaction, so there
 * is no moment at which a school has none — or two.
 */
export async function setCurrentSession(ctx: TenantContext, sessionId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const target = await ctx.db.academicSession.findFirst({
    where: { id: sessionId },
    select: { id: true, name: true },
  });
  if (!target) throw new NotFoundError();

  await ctx.db.$transaction(async (tx) => {
    await tx.academicSession.updateMany({ where: { id: { not: target.id } }, data: { isCurrent: false } });
    await tx.academicSession.updateMany({ where: { id: target.id }, data: { isCurrent: true } });
  });

  await recordAudit({
    action: "ACADEMIC_SESSION_ACTIVATED",
    entityType: "AcademicSession",
    entityId: target.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${target.name} is now the current academic session.`,
  });
}

// -----------------------------------------------------------------------------
// Classes, streams, subjects
// -----------------------------------------------------------------------------

export async function listClasses(ctx: TenantContext, options: { activeOnly?: boolean } = {}) {
  return ctx.db.class.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: { level: "asc" },
    select: { id: true, name: true, level: true, isActive: true },
  });
}

export async function createClass(
  ctx: TenantContext,
  input: { name: string; level: number },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  try {
    await ctx.db.class.create({ data: { schoolId: ctx.schoolId, ...input } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A class with that name or level already exists.");
    }
    throw error;
  }
  await recordAudit({
    action: "CLASS_UPDATED",
    entityType: "Class",
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Class ${input.name} added.`,
  });
}

export async function setClassActive(ctx: TenantContext, classId: string, isActive: boolean) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.class.updateMany({ where: { id: classId }, data: { isActive } });
  if (!count) throw new NotFoundError();
  await recordAudit({
    action: "CLASS_UPDATED",
    entityType: "Class",
    entityId: classId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Class ${isActive ? "enabled" : "disabled"}.`,
  });
}

export async function listStreams(ctx: TenantContext, options: { activeOnly?: boolean } = {}) {
  return ctx.db.stream.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });
}

export async function createStream(ctx: TenantContext, name: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  try {
    await ctx.db.stream.create({ data: { schoolId: ctx.schoolId, name } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That stream already exists.");
    throw error;
  }
  await recordAudit({
    action: "STREAM_UPDATED",
    entityType: "Stream",
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Stream ${name} added.`,
  });
}

export async function setStreamActive(ctx: TenantContext, streamId: string, isActive: boolean) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.stream.updateMany({ where: { id: streamId }, data: { isActive } });
  if (!count) throw new NotFoundError();
}

export async function listSubjects(ctx: TenantContext, options: { activeOnly?: boolean } = {}) {
  return ctx.db.subject.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, isActive: true },
  });
}

export async function createSubject(
  ctx: TenantContext,
  input: { name: string; code: string },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  try {
    await ctx.db.subject.create({ data: { schoolId: ctx.schoolId, ...input } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A subject with that code already exists.");
    throw error;
  }
  await recordAudit({
    action: "SUBJECT_UPDATED",
    entityType: "Subject",
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Subject ${input.name} (${input.code}) added.`,
  });
}

export async function setSubjectActive(ctx: TenantContext, subjectId: string, isActive: boolean) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.subject.updateMany({ where: { id: subjectId }, data: { isActive } });
  if (!count) throw new NotFoundError();
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

/** "Class 10 – A", or "Class 11 – A (Science)". */
export function sectionLabel(section: {
  name: string;
  class: { name: string };
  stream?: { name: string } | null;
}): string {
  return `${section.class.name} – ${section.name}${section.stream ? ` (${section.stream.name})` : ""}`;
}

/** Every class with its sections for one session, for the structure screen. */
export async function listClassesWithSections(ctx: TenantContext, academicSessionId: string) {
  return ctx.db.class.findMany({
    orderBy: { level: "asc" },
    select: {
      id: true,
      name: true,
      level: true,
      isActive: true,
      sections: {
        where: { academicSessionId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          capacity: true,
          stream: { select: { name: true } },
          classTeacher: { select: { firstName: true, lastName: true } },
          _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
        },
      },
    },
  });
}

/** Full section rows for one session, ordered by class level then name. */
export async function listSections(ctx: TenantContext, academicSessionId: string) {
  const sections = await ctx.db.section.findMany({
    where: { academicSessionId },
    select: {
      id: true,
      name: true,
      capacity: true,
      classTeacherId: true,
      class: { select: { id: true, name: true, level: true } },
      stream: { select: { id: true, name: true } },
      classTeacher: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });

  return sections.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
}

/**
 * Sections as select options, ordered by class level then name. Pass
 * `onlyIds` to restrict to what a teacher may act on.
 */
export async function sectionOptions(
  ctx: TenantContext,
  academicSessionId: string,
  onlyIds?: string[] | "ALL",
) {
  const sections = await ctx.db.section.findMany({
    where: {
      academicSessionId,
      ...(Array.isArray(onlyIds) ? { id: { in: onlyIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  });

  return sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => ({ value: section.id, label: sectionLabel(section) }));
}

export async function getSection(ctx: TenantContext, sectionId: string) {
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      capacity: true,
      streamId: true,
      classTeacherId: true,
      academicSession: { select: { id: true, name: true, isCurrent: true } },
      class: { select: { id: true, name: true, level: true } },
      stream: { select: { id: true, name: true } },
      classTeacher: { select: { id: true, firstName: true, lastName: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        orderBy: [{ rollNumber: "asc" }],
        select: {
          id: true,
          rollNumber: true,
          student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true } },
        },
      },
      teacherAssignments: {
        select: {
          id: true,
          subject: { select: { name: true } },
          teacher: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!section) throw new NotFoundError();
  return section;
}

async function assertStreamAndTeacher(
  ctx: TenantContext,
  input: { streamId: string | null; classTeacherId: string | null },
) {
  const [stream, teacher] = await Promise.all([
    input.streamId
      ? ctx.db.stream.findFirst({ where: { id: input.streamId }, select: { id: true } })
      : Promise.resolve(true),
    input.classTeacherId
      ? ctx.db.teacher.findFirst({ where: { id: input.classTeacherId, status: "ACTIVE" }, select: { id: true } })
      : Promise.resolve(true),
  ]);
  if (!stream || !teacher) throw new NotFoundError("That stream or teacher was not found.");
}

export async function createSection(
  ctx: TenantContext,
  input: {
    academicSessionId: string;
    classId: string;
    name: string;
    streamId: string | null;
    capacity: number | null;
    classTeacherId: string | null;
  },
): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const [session, klass] = await Promise.all([
    ctx.db.academicSession.findFirst({ where: { id: input.academicSessionId }, select: { id: true } }),
    ctx.db.class.findFirst({ where: { id: input.classId }, select: { id: true, name: true } }),
  ]);
  if (!session || !klass) throw new NotFoundError();
  await assertStreamAndTeacher(ctx, input);

  try {
    const section = await ctx.db.section.create({
      data: { schoolId: ctx.schoolId, ...input, name: input.name.toUpperCase() },
      select: { id: true },
    });
    await recordAudit({
      action: "SECTION_CREATED",
      entityType: "Section",
      entityId: section.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Section ${klass.name} – ${input.name.toUpperCase()} created.`,
    });
    return section.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(`${klass.name} already has a section ${input.name.toUpperCase()} this session.`);
    }
    throw error;
  }
}

export async function updateSection(
  ctx: TenantContext,
  sectionId: string,
  input: { name: string; streamId: string | null; capacity: number | null; classTeacherId: string | null },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertStreamAndTeacher(ctx, input);

  const existing = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: { id: true, classTeacherId: true, academicSessionId: true },
  });
  if (!existing) throw new NotFoundError();

  try {
    const { count } = await ctx.db.section.updateMany({
      where: { id: sectionId },
      data: { ...input, name: input.name.toUpperCase() },
    });
    if (!count) throw new NotFoundError();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That section name is already used in this class.");
    throw error;
  }

  // A class teacher can be assigned, changed or removed at any time, and none of
  // it destroys what came before: the previous assignment is closed rather than
  // overwritten, so "who was class teacher in August" stays answerable.
  if (existing.classTeacherId !== input.classTeacherId) {
    await recordClassTeacherChange(ctx, {
      sectionId: existing.id,
      academicSessionId: existing.academicSessionId,
      previousTeacherId: existing.classTeacherId,
      teacherId: input.classTeacherId,
    });
  }

  await recordAudit({
    action: "SECTION_UPDATED",
    entityType: "Section",
    entityId: sectionId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Section ${input.name.toUpperCase()} updated.`,
  });
}

/**
 * Close the outgoing class-teacher assignment and open the incoming one.
 *
 * `Section.classTeacherId` remains the current pointer every other screen reads;
 * this keeps the history behind it. Removing a class teacher closes the open row
 * and opens nothing, which is how "nobody, since October" is recorded.
 */
async function recordClassTeacherChange(
  ctx: TenantContext,
  input: {
    sectionId: string;
    academicSessionId: string;
    previousTeacherId: string | null;
    teacherId: string | null;
  },
): Promise<void> {
  const now = today();

  if (input.previousTeacherId) {
    await ctx.db.classTeacherAssignment.updateMany({
      where: { sectionId: input.sectionId, teacherId: input.previousTeacherId, toDate: null },
      data: { toDate: now },
    });
  }

  if (input.teacherId) {
    await ctx.db.classTeacherAssignment.create({
      data: {
        schoolId: ctx.schoolId,
        academicSessionId: input.academicSessionId,
        sectionId: input.sectionId,
        teacherId: input.teacherId,
        fromDate: now,
      },
    });
  }

  const teacher = input.teacherId
    ? await ctx.db.teacher.findFirst({
        where: { id: input.teacherId },
        select: { firstName: true, lastName: true },
      })
    : null;

  await recordAudit({
    action: "CLASS_TEACHER_ASSIGNED",
    entityType: "Section",
    entityId: input.sectionId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: teacher
      ? `Class teacher set to ${fullName(teacher)}.`
      : "Class teacher removed.",
  });
}

/** Who has been class teacher of this section, newest first. */
export async function classTeacherHistory(ctx: TenantContext, sectionId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const rows = await ctx.db.classTeacherAssignment.findMany({
    where: { sectionId },
    // `createdAt` breaks the tie: two changes on the same day share a `fromDate`,
    // and without this their order would be whatever Postgres returned.
    orderBy: [{ fromDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      fromDate: true,
      toDate: true,
      teacher: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fromDate: row.fromDate,
    toDate: row.toDate,
    current: row.toDate === null,
    teacherId: row.teacher.id,
    teacher: fullName(row.teacher),
    employeeId: row.teacher.employeeId,
  }));
}

/** Only an empty section can be removed; anything with history is kept. */
export async function deleteSection(ctx: TenantContext, sectionId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  try {
    const { count } = await ctx.db.section.deleteMany({ where: { id: sectionId } });
    if (!count) throw new NotFoundError();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError(
        "This section has students, attendance, timetable or teachers attached and cannot be deleted.",
      );
    }
    throw error;
  }
}
