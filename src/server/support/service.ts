import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ConcernStatus, SupportPriority, SupportSource, SupportStatus } from "@/generated/prisma/enums";
import { addDays, formatDate, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { CURRENT_EMPLOYEE, CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { OPEN_SUPPORT, type ConcernInput, type ConcernReviewInput, type SupportFollowUpInput, type SupportInput } from "@/lib/validation/support";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds, requireSectionAccess, requireTeacherSelf } from "@/server/auth/teacher-access";
import { findChild, listMyChildren } from "@/server/parent/access";

/**
 * Student support — "which students need extra help, why, and what is being
 * done about it?"
 *
 *   * Teacher — the academic owner. Adds support for students in the classes
 *     they teach (a subject they teach there, or any subject as class
 *     teacher), follows up, and resolves. Reviews parent concerns routed to
 *     them.
 *   * School Admin — sees everything in their school, coordinates (assigns a
 *     teacher, arranges an extra class as a meeting), and follows up.
 *   * Parent — raises a concern about a current child; sees a short,
 *     supportive summary of the help being given, never staff notes.
 *   * Student — sees what they can do (practice, material, an extra class),
 *     never a label or a priority.
 *
 * A parent's concern never marks a child as needing support by itself: a
 * teacher reviews it and decides. Every id from a request is re-checked here
 * against the session's school and the caller's own relationships.
 */

// -----------------------------------------------------------------------------
// Shared lookups
// -----------------------------------------------------------------------------

const SECTION_SELECT = { id: true, name: true, classId: true, classTeacherId: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } as const;

/** Where a current student sits this year — support is always about now. */
async function currentPlacement(ctx: TenantContext, studentId: string) {
  const student = await ctx.db.student.findFirst({
    where: { id: studentId, status: { in: [...CURRENT_STUDENT] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { academicSession: { isCurrent: true }, status: "ACTIVE" },
        select: { academicSessionId: true, section: { select: SECTION_SELECT } },
      },
    },
  });
  const placement = student?.enrollments[0];
  if (!student || !placement) throw new NotFoundError("That student was not found in a class this year.");
  return { student, academicSessionId: placement.academicSessionId, section: placement.section };
}

/** Who teaches this subject to this section this year; else the class teacher. */
async function responsibleTeacher(ctx: TenantContext, section: { id: string; classTeacherId: string | null }, subjectId: string | null): Promise<string | null> {
  if (subjectId) {
    const assignment = await ctx.db.teacherSubjectAssignment.findFirst({
      where: { sectionId: section.id, subjectId, academicSession: { isCurrent: true }, teacher: { status: { in: [...CURRENT_EMPLOYEE] } } },
      select: { teacherId: true },
    });
    if (assignment) return assignment.teacherId;
  }
  return section.classTeacherId;
}

/**
 * A teacher may add support for a subject they teach in that section, or for
 * any subject (or none) as its class teacher.
 */
async function assertTeacherMaySupport(ctx: TenantContext, teacherId: string, section: { id: string; classTeacherId: string | null }, subjectId: string | null) {
  await requireSectionAccess(ctx, section.id);
  if (section.classTeacherId === teacherId) return;
  if (!subjectId) throw new ForbiddenError("Only the class teacher can add support that is not about one subject.");
  const teaches = await ctx.db.teacherSubjectAssignment.count({ where: { teacherId, sectionId: section.id, subjectId, academicSession: { isCurrent: true } } });
  if (!teaches) throw new ForbiddenError("You can add support only for a subject you teach to this class.");
}

/** Which support records the caller may see: all (admin) or their sections (teacher). */
async function visibleSupportWhere(ctx: TenantContext): Promise<Prisma.StudentSupportWhereInput> {
  if (ctx.user.role === "SCHOOL_ADMIN") return {};
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const sections = await accessibleSectionIds(ctx);
  return { OR: [{ teacherId: teacher.id }, { sectionId: { in: Array.isArray(sections) ? sections : [] } }] };
}

/** The owner or the class teacher may change a record; the admin always may. */
async function assertMayEdit(ctx: TenantContext, support: { teacherId: string | null; section: { classTeacherId: string | null } }) {
  if (ctx.user.role === "SCHOOL_ADMIN") return;
  const teacher = await requireTeacherSelf(ctx);
  if (support.teacherId !== teacher.id && support.section.classTeacherId !== teacher.id) {
    throw new ForbiddenError("Only the teacher looking after this support, or the class teacher, can change it.");
  }
}

const ROW_SELECT = {
  id: true,
  source: true,
  reason: true,
  reasonNote: true,
  topic: true,
  priority: true,
  action: true,
  actionNote: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  concernId: true,
  extraClassMeetingId: true,
  teacherId: true,
  student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  section: { select: SECTION_SELECT },
} as const satisfies Prisma.StudentSupportSelect;

type Row = Prisma.StudentSupportGetPayload<{ select: typeof ROW_SELECT }>;

function shape(row: Row) {
  return {
    id: row.id,
    source: row.source,
    reason: row.reason,
    reasonNote: row.reasonNote,
    topic: row.topic,
    priority: row.priority,
    action: row.action,
    actionNote: row.actionNote,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    fromConcern: Boolean(row.concernId),
    hasExtraClass: Boolean(row.extraClassMeetingId),
    studentId: row.student.id,
    student: fullName(row.student),
    admissionNumber: row.student.admissionNumber,
    subject: row.subject?.name ?? null,
    subjectId: row.subject?.id ?? null,
    teacher: row.teacher ? fullName(row.teacher) : null,
    teacherId: row.teacherId,
    section: sectionLabel(row.section),
    sectionId: row.section.id,
  };
}

export type SupportRow = ReturnType<typeof shape>;

// -----------------------------------------------------------------------------
// Creating and following up
// -----------------------------------------------------------------------------

export async function createSupport(ctx: TenantContext, input: SupportInput): Promise<string> {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const { student, academicSessionId, section } = await currentPlacement(ctx, input.studentId);

  if (input.subjectId && !(await ctx.db.subject.count({ where: { id: input.subjectId } }))) {
    throw new ValidationError("Please correct the highlighted fields.", { subjectId: ["Choose a subject"] });
  }

  let teacherId: string | null;
  let source: SupportSource;
  if (ctx.user.role === "TEACHER") {
    teacherId = (await requireTeacherSelf(ctx)).id;
    await assertTeacherMaySupport(ctx, teacherId, section, input.subjectId);
    source = "TEACHER";
  } else {
    // The office may name the teacher; otherwise the subject teacher (or class teacher) takes it.
    if (input.teacherId) {
      const teacher = await ctx.db.teacher.findFirst({ where: { id: input.teacherId, status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true } });
      if (!teacher) throw new ValidationError("Please correct the highlighted fields.", { teacherId: ["Choose a current teacher"] });
      teacherId = teacher.id;
    } else {
      teacherId = await responsibleTeacher(ctx, section, input.subjectId);
    }
    source = "SCHOOL_ADMIN";
  }

  let concernId: string | null = null;
  if (input.concernId) {
    const concern = await ctx.db.supportConcern.findFirst({ where: { id: input.concernId, studentId: student.id }, select: { id: true, teacherId: true } });
    if (!concern) throw new NotFoundError("That concern was not found for this student.");
    if (ctx.user.role === "TEACHER" && concern.teacherId !== teacherId && section.classTeacherId !== teacherId) {
      throw new ForbiddenError("That concern was sent to another teacher.");
    }
    concernId = concern.id;
    source = "PARENT";
  }

  // One open record per student and subject: more help goes on the same one.
  const open = await ctx.db.studentSupport.findFirst({
    where: { studentId: student.id, subjectId: input.subjectId, status: { in: [...OPEN_SUPPORT] } },
    select: { id: true },
  });
  if (open) throw new ConflictError(`${fullName(student)} already has open support for this subject. Add a follow-up to it instead.`);

  // Planned until the extra class is arranged; otherwise the help starts now.
  // Support the office adds starts NEW, for the teacher to pick up.
  const status: SupportStatus = source === "SCHOOL_ADMIN" ? "NEW" : input.action === "EXTRA_CLASS" ? "SUPPORT_PLANNED" : "IN_PROGRESS";

  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.studentSupport.create({
      data: {
        schoolId: ctx.schoolId,
        academicSessionId,
        studentId: student.id,
        classId: section.classId,
        sectionId: section.id,
        subjectId: input.subjectId,
        teacherId,
        source,
        reason: input.reason,
        reasonNote: input.reasonNote,
        topic: input.topic,
        priority: input.priority,
        action: input.action,
        actionNote: input.actionNote,
        status,
        concernId,
        createdById: ctx.user.id,
      },
      select: { id: true },
    });
    if (concernId) {
      await tx.supportConcern.updateMany({
        where: { id: concernId, status: { in: ["NEW", "REVIEWING"] } },
        data: { status: "ACTION_TAKEN", reviewedAt: new Date() },
      });
    }
    return created.id;
  });

  await recordAudit({
    action: "SUPPORT_CREATED",
    entityType: "StudentSupport",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Support added for ${fullName(student)}: ${humanize(input.reason)} → ${humanize(input.action)} (${humanize(input.priority)} priority).`,
  });
  return id;
}

/** A follow-up: a note, and/or a change of status, priority or action. */
export async function followUpSupport(ctx: TenantContext, input: SupportFollowUpInput): Promise<void> {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const support = await ctx.db.studentSupport.findFirst({
    where: { AND: [{ id: input.supportId }, await visibleSupportWhere(ctx)] },
    select: { id: true, status: true, priority: true, action: true, teacherId: true, student: { select: { firstName: true, lastName: true } }, section: { select: { classTeacherId: true } } },
  });
  if (!support) throw new NotFoundError("That support record was not found.");
  await assertMayEdit(ctx, support);

  const status = input.status && input.status !== support.status ? input.status : undefined;
  const data: Prisma.StudentSupportUpdateManyMutationInput = {
    ...(status ? { status, resolvedAt: status === "RESOLVED" ? new Date() : null } : {}),
    ...(input.priority && input.priority !== support.priority ? { priority: input.priority } : {}),
    ...(input.action && input.action !== support.action ? { action: input.action } : {}),
  };
  const changes = [
    status ? `status ${humanize(support.status)} → ${humanize(status)}` : null,
    data.priority ? `priority → ${humanize(String(data.priority))}` : null,
    data.action ? `action → ${humanize(String(data.action))}` : null,
  ].filter(Boolean);

  await ctx.db.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.studentSupport.updateMany({ where: { id: support.id }, data });
    await tx.supportNote.create({
      data: {
        schoolId: ctx.schoolId,
        supportId: support.id,
        authorId: ctx.user.id,
        note: input.note ?? (changes.length ? `Changed ${changes.join(", ")}.` : ""),
        fromStatus: status ? support.status : null,
        toStatus: status ?? null,
      },
    });
  });

  await recordAudit({
    action: status === "RESOLVED" ? "SUPPORT_RESOLVED" : changes.length ? "SUPPORT_UPDATED" : "SUPPORT_NOTE_ADDED",
    entityType: "StudentSupport",
    entityId: support.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Support for ${fullName(support.student)}: ${changes.length ? changes.join(", ") : "follow-up added"}.`,
  });
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export type SupportFilters = {
  q?: string;
  status?: SupportStatus | "OPEN";
  sectionId?: string;
  classId?: string;
  subjectId?: string;
  teacherId?: string;
  priority?: SupportPriority;
  source?: SupportSource;
};

export async function listSupport(ctx: TenantContext, filters: SupportFilters = {}) {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const status = filters.status ?? "OPEN";
  const rows = await ctx.db.studentSupport.findMany({
    where: {
      AND: [
        await visibleSupportWhere(ctx),
        status === "OPEN" ? { status: { in: [...OPEN_SUPPORT] } } : { status },
        filters.sectionId ? { sectionId: filters.sectionId } : {},
        filters.classId ? { classId: filters.classId } : {},
        filters.subjectId ? { subjectId: filters.subjectId } : {},
        filters.teacherId ? { teacherId: filters.teacherId } : {},
        filters.priority ? { priority: filters.priority } : {},
        filters.source ? { source: filters.source } : {},
        filters.q
          ? {
              student: {
                OR: [
                  { firstName: { contains: filters.q, mode: "insensitive" } },
                  { lastName: { contains: filters.q, mode: "insensitive" } },
                  { admissionNumber: { contains: filters.q, mode: "insensitive" } },
                ],
              },
            }
          : {},
      ],
    },
    // Most urgent first, then the ones waiting longest.
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
    take: 300,
    select: ROW_SELECT,
  });
  return rows.map(shape);
}

/**
 * The office's summary: how many students need support now, in which
 * subjects, how it is going, and how many parent concerns wait for review.
 */
export async function supportSummary(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [open, byStatus, concernsNew, bySource] = await Promise.all([
    ctx.db.studentSupport.findMany({
      where: { status: { in: [...OPEN_SUPPORT] } },
      select: { studentId: true, subject: { select: { name: true } } },
    }),
    ctx.db.studentSupport.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.db.supportConcern.count({ where: { status: { in: ["NEW", "REVIEWING"] } } }),
    ctx.db.studentSupport.groupBy({ by: ["source"], where: { status: { in: [...OPEN_SUPPORT] } }, _count: { _all: true } }),
  ]);
  const subjects = new Map<string, number>();
  for (const row of open) {
    const name = row.subject?.name ?? "";
    subjects.set(name, (subjects.get(name) ?? 0) + 1);
  }
  const bySubject = [...subjects.entries()].map(([subject, count]) => ({ subject: subject || null, count })).sort((a, b) => b.count - a.count);
  return {
    students: new Set(open.map((row) => row.studentId)).size,
    open: open.length,
    bySubject,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<Record<SupportStatus, number>>,
    bySource: Object.fromEntries(bySource.map((row) => [row.source, row._count._all])) as Partial<Record<SupportSource, number>>,
    concernsToReview: concernsNew,
  };
}

/** One record with its follow-ups, the parent's concern and the extra class, for staff. */
export async function getSupport(ctx: TenantContext, supportId: string) {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const row = await ctx.db.studentSupport.findFirst({
    where: { AND: [{ id: supportId }, await visibleSupportWhere(ctx)] },
    select: {
      ...ROW_SELECT,
      concern: { select: { id: true, reason: true, message: true, status: true, createdAt: true, parent: { select: { firstName: true, lastName: true, phone: true } } } },
      extraClass: { select: { id: true, title: true, date: true, startMinute: true, status: true } },
      notes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, note: true, fromStatus: true, toStatus: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!row) throw new NotFoundError("That support record was not found.");
  let mayEdit = true;
  try {
    await assertMayEdit(ctx, row);
  } catch {
    mayEdit = false;
  }
  return {
    ...shape(row),
    mayEdit,
    concern: row.concern
      ? { ...row.concern, parent: fullName(row.concern.parent), parentPhone: row.concern.parent.phone }
      : null,
    extraClass: row.extraClass,
    notes: row.notes.map((note) => ({ ...note, author: note.author ? fullName(note.author) : null })),
  };
}

/** Support on a student's profile, for the office. */
export async function supportForStudent(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.studentSupport.findMany({
    where: { studentId },
    orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
    take: 20,
    select: { ...ROW_SELECT, _count: { select: { notes: true } } },
  });
  return rows.map((row) => ({ ...shape(row), followUps: row._count.notes }));
}

// -----------------------------------------------------------------------------
// Parent concerns
// -----------------------------------------------------------------------------

/** A parent raises a concern about one of their current children. */
export async function raiseConcern(ctx: TenantContext, input: ConcernInput): Promise<string> {
  assertRole(ctx.user, "PARENT");
  // Linked to this parent and still a current student — or simply not found.
  const child = await findChild(ctx, input.studentId);
  if (!child.placement) throw new NotFoundError(`${child.student.name} is not placed in a class this year.`);
  if (input.subjectId && !(await ctx.db.subject.count({ where: { id: input.subjectId } }))) {
    throw new ValidationError("Please correct the highlighted fields.", { subjectId: ["Choose a subject"] });
  }
  const open = await ctx.db.supportConcern.findFirst({
    where: { studentId: child.student.id, parentId: child.parentId, subjectId: input.subjectId, status: { in: ["NEW", "REVIEWING"] } },
    select: { id: true },
  });
  if (open) throw new ConflictError("You have already raised this, and the teacher is looking at it. You'll see their reply here.");

  const section = await ctx.db.section.findFirst({ where: { id: child.placement.sectionId }, select: { id: true, classTeacherId: true } });
  const teacherId = section ? await responsibleTeacher(ctx, section, input.subjectId) : null;

  const concern = await ctx.db.supportConcern.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: child.student.id,
      parentId: child.parentId,
      subjectId: input.subjectId,
      teacherId,
      reason: input.reason,
      message: input.message,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "CONCERN_RAISED",
    entityType: "SupportConcern",
    entityId: concern.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `A parent raised a concern about ${child.student.name} (${humanize(input.reason)}).`,
  });
  return concern.id;
}

/** Concerns for staff: the teacher's own (routed to them), or all for the admin. */
export async function listConcerns(ctx: TenantContext, filters: { status?: ConcernStatus | "OPEN" } = {}) {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const status = filters.status ?? "OPEN";
  const mine = ctx.user.role === "TEACHER" ? { teacherId: (await requireTeacherSelf(ctx)).id } : {};
  const rows = await ctx.db.supportConcern.findMany({
    where: { ...mine, ...(status === "OPEN" ? { status: { in: ["NEW", "REVIEWING"] } } : { status }) },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      reason: true,
      message: true,
      status: true,
      response: true,
      createdAt: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          enrollments: { where: { academicSession: { isCurrent: true } }, select: { section: { select: SECTION_SELECT } } },
        },
      },
      parent: { select: { firstName: true, lastName: true, phone: true } },
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      supports: { select: { id: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    message: row.message,
    status: row.status,
    response: row.response,
    createdAt: row.createdAt,
    studentId: row.student.id,
    student: fullName(row.student),
    section: row.student.enrollments[0] ? sectionLabel(row.student.enrollments[0].section) : null,
    parent: fullName(row.parent),
    parentPhone: row.parent.phone,
    subject: row.subject?.name ?? null,
    teacher: row.teacher ? fullName(row.teacher) : null,
    supportId: row.supports[0]?.id ?? null,
  }));
}

/** The teacher (or the office) reviews a concern and tells the parent what is happening. */
export async function reviewConcern(ctx: TenantContext, input: ConcernReviewInput): Promise<void> {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const mine = ctx.user.role === "TEACHER" ? { teacherId: (await requireTeacherSelf(ctx)).id } : {};
  const concern = await ctx.db.supportConcern.findFirst({
    where: { id: input.concernId, ...mine },
    select: { id: true, status: true, student: { select: { firstName: true, lastName: true } } },
  });
  if (!concern) throw new NotFoundError("That concern was not found.");
  if (concern.status === "RESOLVED") throw new ConflictError("This concern is already resolved.");
  const now = new Date();
  await ctx.db.supportConcern.updateMany({
    where: { id: concern.id },
    data: {
      status: input.status,
      ...(input.response ? { response: input.response } : {}),
      reviewedAt: now,
      resolvedAt: input.status === "RESOLVED" ? now : null,
    },
  });
  await recordAudit({
    action: "CONCERN_UPDATED",
    entityType: "SupportConcern",
    entityId: concern.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Concern about ${fullName(concern.student)}: ${humanize(concern.status)} → ${humanize(input.status)}.`,
  });
}

// -----------------------------------------------------------------------------
// Families
// -----------------------------------------------------------------------------

/**
 * What a parent sees: for each current child, the help being given (subject,
 * topic, what is being done, how it is going — no staff notes, no priority),
 * and their own concerns with the school's reply.
 */
export async function familySupport(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");
  const { parent, children } = await listMyChildren(ctx);
  const current = children.filter((child) => child.current);
  const ids = current.map((child) => child.id);
  const [supports, concerns] = await Promise.all([
    ctx.db.studentSupport.findMany({
      where: { studentId: { in: ids }, OR: [{ status: { in: [...OPEN_SUPPORT] } }, { resolvedAt: { gte: addDays(today(), -30) } }] },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        studentId: true,
        reason: true,
        topic: true,
        action: true,
        actionNote: true,
        status: true,
        updatedAt: true,
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
        extraClass: { select: { title: true, date: true, startMinute: true, status: true } },
      },
    }),
    ctx.db.supportConcern.findMany({
      where: { parentId: parent.id, studentId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 20,
      // The parent sees the status and the reply meant for them — nothing internal.
      select: { id: true, studentId: true, reason: true, message: true, status: true, response: true, createdAt: true, reviewedAt: true, subject: { select: { name: true } } },
    }),
  ]);
  const nameOf = new Map(current.map((child) => [child.id, child.name]));
  return {
    children: current.map((child) => ({ id: child.id, name: child.name, sectionLabel: child.sectionLabel })),
    supports: supports.map((row) => ({
      ...row,
      child: nameOf.get(row.studentId) ?? "",
      subject: row.subject?.name ?? null,
      teacher: row.teacher ? fullName(row.teacher) : null,
    })),
    concerns: concerns.map((row) => ({ ...row, child: nameOf.get(row.studentId) ?? "", subject: row.subject?.name ?? null })),
  };
}

/** Subjects a child is taught this year, for the concern form. */
export async function subjectsForChild(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "PARENT");
  const child = await findChild(ctx, studentId);
  if (!child.placement) return [];
  const rows = await ctx.db.teacherSubjectAssignment.findMany({
    where: { sectionId: child.placement.sectionId, academicSession: { isCurrent: true } },
    distinct: ["subjectId"],
    select: { subject: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({ value: row.subject.id, label: row.subject.name })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * What a student sees: the extra help in each subject and what they can do —
 * never a reason, a priority or a label.
 */
export async function mySupport(ctx: TenantContext) {
  assertRole(ctx.user, "STUDENT");
  const student = await ctx.db.student.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
  if (!student) return [];
  const rows = await ctx.db.studentSupport.findMany({
    where: { studentId: student.id, status: { in: ["SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING"] } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      topic: true,
      action: true,
      actionNote: true,
      status: true,
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      extraClass: { select: { title: true, date: true, startMinute: true, status: true } },
    },
  });
  return rows.map((row) => ({ ...row, subject: row.subject?.name ?? null, teacher: row.teacher ? fullName(row.teacher) : null }));
}

// -----------------------------------------------------------------------------
// Teachers: suggestions and options
// -----------------------------------------------------------------------------

/**
 * Students the teacher's own recent remarks flagged "needs attention" who have
 * no open support yet — a nudge, not an automatic label.
 */
export async function supportSuggestions(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const remarks = await ctx.db.studentRemark.findMany({
    where: {
      teacherId: teacher.id,
      understanding: "NEEDS_ATTENTION",
      createdAt: { gte: addDays(today(), -30) },
      academicSession: { isCurrent: true },
      student: { status: { in: [...CURRENT_STUDENT] }, supports: { none: { status: { in: [...OPEN_SUPPORT] } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { createdAt: true, subject: { select: { id: true, name: true } }, student: { select: { id: true, firstName: true, lastName: true } } },
  });
  const seen = new Set<string>();
  return remarks
    .filter((row) => !seen.has(row.student.id) && seen.add(row.student.id))
    .map((row) => ({ studentId: row.student.id, student: fullName(row.student), subjectId: row.subject?.id ?? null, subject: row.subject?.name ?? null, on: formatDate(row.createdAt) }));
}

/** Students and subjects a teacher may choose from when adding support. */
export async function supportFormOptions(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER", "SCHOOL_ADMIN");
  const sections = await accessibleSectionIds(ctx);
  const sectionFilter = Array.isArray(sections) ? { sectionId: { in: sections } } : {};
  const [enrollments, subjects, teachers] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { academicSession: { isCurrent: true }, status: "ACTIVE", student: { status: { in: [...CURRENT_STUDENT] } }, ...sectionFilter },
      select: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } }, section: { select: SECTION_SELECT } },
    }),
    ctx.db.subject.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.user.role === "SCHOOL_ADMIN"
      ? ctx.db.teacher.findMany({ where: { status: { in: [...CURRENT_EMPLOYEE] } }, orderBy: [{ firstName: "asc" }], select: { id: true, firstName: true, lastName: true } })
      : Promise.resolve([]),
  ]);
  return {
    students: enrollments
      .sort((a, b) => a.section.class.level - b.section.class.level || a.section.name.localeCompare(b.section.name) || a.student.firstName.localeCompare(b.student.firstName))
      .map((row) => ({ value: row.student.id, label: `${fullName(row.student)} · ${sectionLabel(row.section)} · ${row.student.admissionNumber}` })),
    subjects: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
    teachers: teachers.map((teacher) => ({ value: teacher.id, label: fullName(teacher) })),
  };
}

// -----------------------------------------------------------------------------
// Extra class, through Meetings
// -----------------------------------------------------------------------------

/** The details an extra-class meeting is prefilled with. School Admin only. */
export async function extraClassPrefill(ctx: TenantContext, supportId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.studentSupport.findFirst({ where: { id: supportId }, select: ROW_SELECT });
  if (!row) return null;
  const support = shape(row);
  return {
    supportId: support.id,
    title: `Extra class: ${support.subject ?? "Support"}${support.topic ? ` — ${support.topic}` : ""}`,
    admissionNumber: support.admissionNumber,
    teacherId: support.teacherId,
    student: support.student,
  };
}

/**
 * Link a meeting just created as a support's extra class: the record moves to
 * In progress and a follow-up says when the class is. Called by `saveMeeting`
 * after the meeting exists, inside the same school.
 */
export async function linkExtraClass(ctx: TenantContext, supportId: string, meetingId: string, when: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const support = await ctx.db.studentSupport.findFirst({ where: { id: supportId }, select: { id: true, status: true } });
  if (!support) throw new NotFoundError("That support record was not found.");
  const moving = support.status === "NEW" || support.status === "REVIEWING" || support.status === "SUPPORT_PLANNED";
  await ctx.db.$transaction(async (tx) => {
    await tx.studentSupport.updateMany({ where: { id: support.id }, data: { extraClassMeetingId: meetingId, ...(moving ? { status: "IN_PROGRESS" } : {}) } });
    await tx.supportNote.create({
      data: {
        schoolId: ctx.schoolId,
        supportId: support.id,
        authorId: ctx.user.id,
        note: `Extra class scheduled for ${when}.`,
        fromStatus: moving ? support.status : null,
        toStatus: moving ? "IN_PROGRESS" : null,
      },
    });
  });
  await recordAudit({
    action: "SUPPORT_UPDATED",
    entityType: "StudentSupport",
    entityId: support.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Extra class scheduled for ${when}.`,
  });
}

// -----------------------------------------------------------------------------
// Alerts (the existing derived feeds)
// -----------------------------------------------------------------------------

const ALERT_DAYS = 7;

/** New concerns routed to this teacher. */
export async function teacherSupportAlerts(ctx: TenantContext) {
  const teacher = await requireTeacherSelf(ctx);
  const rows = await ctx.db.supportConcern.findMany({
    where: { teacherId: teacher.id, status: "NEW" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, subject: { select: { name: true } }, student: { select: { firstName: true } } },
  });
  return rows.map((row) => ({
    kind: "support-concern",
    childId: null,
    title: `A parent has raised a concern about ${row.student.firstName}'s ${row.subject?.name ?? "learning"}`,
    detail: "Review it and let the parent know what you will do.",
    at: row.createdAt,
    href: "/teacher/support",
    tone: "warning" as const,
  }));
}

/** For a parent: concerns just reviewed, and support just arranged. */
export async function parentSupportAlerts(ctx: TenantContext, children: Array<{ id: string; name: string }>) {
  const ids = children.map((child) => child.id);
  if (!ids.length) return [];
  const since = addDays(today(), -ALERT_DAYS);
  const nameOf = new Map(children.map((child) => [child.id, child.name.split(" ")[0] ?? child.name]));
  const [reviewed, arranged] = await Promise.all([
    ctx.db.supportConcern.findMany({
      where: { studentId: { in: ids }, parent: { userId: ctx.user.id }, status: { not: "NEW" }, reviewedAt: { gte: since } },
      select: { studentId: true, reviewedAt: true, subject: { select: { name: true } } },
    }),
    ctx.db.studentSupport.findMany({
      where: { studentId: { in: ids }, createdAt: { gte: since }, status: { not: "RESOLVED" } },
      select: { studentId: true, createdAt: true, action: true, subject: { select: { name: true } } },
    }),
  ]);
  return [
    ...reviewed.map((row) => ({
      kind: "support" as const,
      childId: row.studentId,
      childName: nameOf.get(row.studentId) ?? null,
      title: `Your concern about ${nameOf.get(row.studentId)}'s ${row.subject?.name ?? "learning"} has been reviewed`,
      detail: "See the school's reply on the Support page.",
      at: row.reviewedAt ?? since,
      href: "/parent/support",
      tone: "info" as const,
    })),
    ...arranged.map((row) => ({
      kind: "support" as const,
      childId: row.studentId,
      childName: nameOf.get(row.studentId) ?? null,
      title: `Additional ${row.subject?.name ?? ""} support has been arranged for ${nameOf.get(row.studentId)}`.replace("  ", " "),
      detail: humanize(row.action),
      at: row.createdAt,
      href: "/parent/support",
      tone: "info" as const,
    })),
  ];
}

/** For a student: extra help just added. */
export async function studentSupportAlerts(ctx: TenantContext, studentId: string) {
  const rows = await ctx.db.studentSupport.findMany({
    where: { studentId, createdAt: { gte: addDays(today(), -ALERT_DAYS) }, status: { in: ["SUPPORT_PLANNED", "IN_PROGRESS", "IMPROVING"] } },
    select: { createdAt: true, subject: { select: { name: true } } },
  });
  return rows.map((row) => ({
    kind: "support",
    childId: null,
    title: `Your teacher has added extra support for ${row.subject?.name ?? "your learning"}`,
    detail: "See what you can do on your Today page.",
    at: row.createdAt,
    href: "/student/dashboard",
    tone: "info" as const,
  }));
}
