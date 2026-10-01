import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ConcernStatus, ConcernType, SupportPriority, SupportSource } from "@/generated/prisma/enums";
import { addDays, today } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { CURRENT_EMPLOYEE, CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import {
  OPEN_CONCERN,
  type ConcernAssignInput,
  type ConcernReplyInput,
  type ConcernUpdateRequestInput,
  type ParentConcernInput,
  type TeacherConcernInput,
} from "@/lib/validation/support";
import { groupLabel, groupSubjects, groupSubjectTeachers, type Placement } from "@/server/academics/streams";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { findChild, listMyChildren } from "@/server/parent/access";
import { onLeaveToday, teachesStudentSubject } from "@/server/support/teaching";

/**
 * Subject-wise parent–teacher concerns.
 *
 *   * Parent → teacher. A parent picks a child and a subject — never a
 *     teacher. The concern goes to whoever teaches that subject to the
 *     child's academic group this session: school + session + class +
 *     section + stream + subject. A teacher assigned to the child's own
 *     stream wins over one assigned to the whole section; the class teacher
 *     is not a fallback. Nobody assigned: it waits with the School Admin.
 *   * Teacher → parent. Only for a subject the teacher is assigned to teach
 *     that student's group (the same rule), and it reaches all of the
 *     child's parents.
 *   * The School Admin sees every concern in the school, can reply, change
 *     status, hand one to a teacher, and ask the teacher for an update.
 *   * The teacher and placement are copied onto the concern when it is
 *     raised and never rewritten: when "Maths → Rahul" becomes "Maths →
 *     Amit", September's concerns stay Rahul's; October's go to Amit.
 *   * Every id from a request is re-checked against the session's school and
 *     the caller's own relationships; the browser decides nothing.
 */

export const concernRef = (number: number) => `CON-${number}`;

type Viewer = "PARENT" | "TEACHER" | "SCHOOL_ADMIN";

// -----------------------------------------------------------------------------
// Placement and routing
// -----------------------------------------------------------------------------

/** A current student's group this session: section, and stream if any. */
async function currentPlacement(ctx: TenantContext, studentId: string) {
  const student = await ctx.db.student.findFirst({
    where: { id: studentId, status: { in: [...CURRENT_STUDENT] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { academicSession: { isCurrent: true }, status: "ACTIVE" },
        select: {
          academicSessionId: true,
          classId: true,
          streamId: true,
          stream: { select: { name: true } },
          section: { select: { id: true, name: true, streamId: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        },
      },
    },
  });
  const enrollment = student?.enrollments[0];
  if (!student || !enrollment) throw new NotFoundError("That student was not found in a class this year.");
  const placement: Placement & { classId: string } = {
    academicSessionId: enrollment.academicSessionId,
    classId: enrollment.classId,
    sectionId: enrollment.section.id,
    // A whole-stream section's students are in that stream.
    streamId: enrollment.streamId ?? enrollment.section.streamId,
  };
  return { student, placement, group: groupLabel(enrollment.section, enrollment.stream) };
}

async function requireSubject(ctx: TenantContext, subjectId: string) {
  const subject = await ctx.db.subject.findFirst({ where: { id: subjectId, isActive: true }, select: { id: true, name: true } });
  if (!subject) throw new ValidationError("Please correct the highlighted fields.", { subjectId: ["Choose a subject"] });
  return subject;
}

/** The next CON number for this school, in the caller's transaction. */
async function nextNumber(tx: Pick<TenantContext["db"], "school">, schoolId: string): Promise<number> {
  // One UPDATE: concurrent concerns queue on the school row and never share a number.
  const school = await tx.school.update({ where: { id: schoolId }, data: { lastConcernNumber: { increment: 1 } }, select: { lastConcernNumber: true } });
  return school.lastConcernNumber;
}

// -----------------------------------------------------------------------------
// Raising
// -----------------------------------------------------------------------------

export type RaisedConcern = { id: string; number: number; ref: string; teacher: string | null };

/**
 * A parent raises a concern about their child in one subject. Routed to the
 * subject teacher of the child's group, or to the School Admin when no
 * teacher is assigned — the message is never lost.
 */
export async function raiseParentConcern(ctx: TenantContext, input: ParentConcernInput): Promise<RaisedConcern> {
  assertRole(ctx.user, "PARENT");
  // Linked to this parent — or simply not found.
  const child = await findChild(ctx, input.studentId);
  const { student, placement } = await currentPlacement(ctx, child.student.id);
  const subject = await requireSubject(ctx, input.subjectId);

  const open = await ctx.db.supportConcern.findFirst({
    where: { studentId: student.id, subjectId: subject.id, raisedBy: "PARENT", status: { in: [...OPEN_CONCERN] } },
    select: { number: true },
  });
  if (open) {
    throw new ConflictError(`${concernRef(open.number)} about ${student.firstName}'s ${subject.name} is still open. You can follow it under Concerns; a new one can be raised once it is resolved.`);
  }

  const [teacherId] = await groupSubjectTeachers(ctx.db, placement, subject.id);
  const created = await createConcern(ctx, {
    studentId: student.id,
    parentId: child.parentId,
    subjectId: subject.id,
    teacherId: teacherId ?? null,
    raisedBy: "PARENT",
    type: input.type,
    priority: "MEDIUM",
    placement,
    message: input.message,
  });
  const teacher = teacherId ? await ctx.db.teacher.findFirst({ where: { id: teacherId }, select: { firstName: true, lastName: true } }) : null;
  await recordAudit({
    action: "CONCERN_RAISED",
    entityType: "SupportConcern",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${concernRef(created.number)}: a parent raised a ${subject.name} concern about ${fullName(student)} (${humanize(input.type)}), sent to ${teacher ? fullName(teacher) : "the School Admin (no teacher assigned)"}.`,
  });
  return { ...created, ref: concernRef(created.number), teacher: teacher ? fullName(teacher) : null };
}

/** A teacher raises a concern for a student's parents, in a subject they teach that student. */
export async function raiseTeacherConcern(ctx: TenantContext, input: TeacherConcernInput): Promise<RaisedConcern> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const { student, placement } = await currentPlacement(ctx, input.studentId);
  const subject = await requireSubject(ctx, input.subjectId);
  if (!(await teachesStudentSubject(ctx, teacher.id, placement, subject.id))) {
    // Same answer for another stream, another subject, another school's
    // student, or a class the teacher is only covering today.
    throw new ForbiddenError("You can raise a concern only for a student you teach, in the subject you teach them.");
  }
  const created = await createConcern(ctx, {
    studentId: student.id,
    parentId: null,
    subjectId: subject.id,
    teacherId: teacher.id,
    raisedBy: "TEACHER",
    type: input.type,
    priority: input.priority,
    placement,
    message: input.message,
  });
  await recordAudit({
    action: "CONCERN_RAISED",
    entityType: "SupportConcern",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${concernRef(created.number)}: ${subject.name} concern for ${fullName(student)}'s parents (${humanize(input.type)}).`,
  });
  return { ...created, ref: concernRef(created.number), teacher: fullName(teacher) };
}

async function createConcern(
  ctx: TenantContext,
  input: {
    studentId: string;
    parentId: string | null;
    subjectId: string;
    teacherId: string | null;
    raisedBy: SupportSource;
    type: ConcernType;
    priority: SupportPriority;
    placement: Placement & { classId: string };
    message: string;
  },
): Promise<{ id: string; number: number }> {
  return ctx.db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.schoolId);
    const concern = await tx.supportConcern.create({
      data: {
        schoolId: ctx.schoolId,
        number,
        studentId: input.studentId,
        parentId: input.parentId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        raisedBy: input.raisedBy,
        type: input.type,
        priority: input.priority,
        academicSessionId: input.placement.academicSessionId,
        classId: input.placement.classId,
        sectionId: input.placement.sectionId,
        streamId: input.placement.streamId,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await tx.concernMessage.create({
      data: { schoolId: ctx.schoolId, concernId: concern.id, authorId: ctx.user.id, authorRole: input.raisedBy, body: input.message },
    });
    return concern;
  });
}

// -----------------------------------------------------------------------------
// Who sees what
// -----------------------------------------------------------------------------

/** Admin: the whole school. Teacher: concerns routed to them. Parent: their own children's. */
async function visibleWhere(ctx: TenantContext): Promise<{ viewer: Viewer; where: Prisma.SupportConcernWhereInput; teacherId?: string }> {
  if (ctx.user.role === "SCHOOL_ADMIN") return { viewer: "SCHOOL_ADMIN", where: {} };
  if (ctx.user.role === "TEACHER") {
    // Only concerns routed to them as the students' subject teacher — never
    // a colleague's, not even while covering one of their periods.
    const teacher = await requireTeacherSelf(ctx);
    return { viewer: "TEACHER", where: { teacherId: teacher.id }, teacherId: teacher.id };
  }
  assertRole(ctx.user, "PARENT");
  const { children } = await listMyChildren(ctx);
  return { viewer: "PARENT", where: { studentId: { in: children.map((child) => child.id) } } };
}

const LIST_SELECT = {
  id: true,
  number: true,
  type: true,
  priority: true,
  status: true,
  raisedBy: true,
  createdAt: true,
  lastMessageAt: true,
  updateRequestedAt: true,
  teacherId: true,
  student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
  stream: { select: { name: true } },
} as const satisfies Prisma.SupportConcernSelect;

type ListRow = Prisma.SupportConcernGetPayload<{ select: typeof LIST_SELECT }>;

function shapeRow(row: ListRow) {
  return {
    id: row.id,
    number: row.number,
    ref: concernRef(row.number),
    type: row.type,
    priority: row.priority,
    status: row.status,
    raisedBy: row.raisedBy,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    updateRequested: Boolean(row.updateRequestedAt),
    studentId: row.student.id,
    student: fullName(row.student),
    admissionNumber: row.student.admissionNumber,
    subject: row.subject?.name ?? null,
    teacherId: row.teacherId,
    teacher: row.teacher ? fullName(row.teacher) : null,
    /** "Class 9 – A • Science", as it was when raised. */
    group: row.section ? groupLabel(row.section, row.stream) : null,
    stream: row.section?.stream?.name ?? row.stream?.name ?? null,
  };
}

export type ConcernRow = ReturnType<typeof shapeRow> & { message: string; waitingOnMe: boolean; teacherOnLeave: boolean };

export type ConcernFilters = {
  q?: string;
  status?: ConcernStatus | "OPEN_ALL" | "ALL";
  studentId?: string;
  classId?: string;
  sectionId?: string;
  streamId?: string;
  subjectId?: string;
  teacherId?: string;
  /** "NONE": waiting with the School Admin. */
  assigned?: "NONE";
  raisedBy?: SupportSource;
  priority?: SupportPriority;
  from?: Date;
  to?: Date;
};

export async function listConcerns(ctx: TenantContext, filters: ConcernFilters = {}): Promise<ConcernRow[]> {
  const { viewer, where } = await visibleWhere(ctx);
  const status = filters.status ?? "OPEN_ALL";
  const rows = await ctx.db.supportConcern.findMany({
    where: {
      AND: [
        where,
        status === "ALL" ? {} : status === "OPEN_ALL" ? { status: { in: [...OPEN_CONCERN] } } : { status },
        filters.studentId ? { studentId: filters.studentId } : {},
        filters.classId ? { classId: filters.classId } : {},
        filters.sectionId ? { sectionId: filters.sectionId } : {},
        filters.streamId ? { streamId: filters.streamId } : {},
        filters.subjectId ? { subjectId: filters.subjectId } : {},
        filters.teacherId ? { teacherId: filters.teacherId } : {},
        filters.assigned === "NONE" ? { teacherId: null } : {},
        filters.raisedBy ? { raisedBy: filters.raisedBy } : {},
        filters.priority ? { priority: filters.priority } : {},
        filters.from ? { createdAt: { gte: filters.from } } : {},
        filters.to ? { createdAt: { lt: addDays(filters.to, 1) } } : {},
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
    orderBy: [{ lastMessageAt: "desc" }],
    take: 300,
    select: {
      ...LIST_SELECT,
      // The concern itself: its first message.
      messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, take: 1, select: { body: true } },
    },
  });
  const onLeave = viewer === "PARENT" ? new Set<string>() : await onLeaveToday(ctx, rows.map((row) => row.teacherId));
  return rows.map((row) => ({
    ...shapeRow(row),
    message: row.messages[0]?.body ?? "",
    waitingOnMe: waitingOn(viewer, row),
    teacherOnLeave: Boolean(row.teacherId && onLeave.has(row.teacherId)),
  }));
}

/** Whether the concern needs something from this viewer: staff act on open ones; the office on those with no teacher. */
function waitingOn(viewer: Viewer, row: { status: ConcernStatus; updateRequestedAt: Date | null; teacherId: string | null }): boolean {
  if (row.status !== "OPEN" && !row.updateRequestedAt) return false;
  if (!(OPEN_CONCERN as readonly string[]).includes(row.status)) return false;
  if (viewer === "TEACHER") return true;
  if (viewer === "SCHOOL_ADMIN") return !row.teacherId;
  return false;
}

/** One concern: what was raised, and its status history. Families never see the office's staff-only notes. */
export async function getConcern(ctx: TenantContext, concernId: string) {
  const { viewer, where } = await visibleWhere(ctx);
  const row = await ctx.db.supportConcern.findFirst({
    where: { AND: [{ id: concernId }, where] },
    select: {
      ...LIST_SELECT,
      createdBy: { select: { firstName: true, lastName: true, role: true } },
      parent: { select: { firstName: true, lastName: true, phone: true } },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          parents: { select: { parent: { select: { firstName: true, lastName: true, phone: true } } } },
        },
      },
      supports: { select: { id: true } },
      messages: {
        where: viewer === "PARENT" ? { internal: false } : {},
        orderBy: { createdAt: "asc" },
        select: { id: true, authorRole: true, body: true, internal: true, fromStatus: true, toStatus: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!row) throw new NotFoundError("That concern was not found.");
  const closed = row.status === "CLOSED";
  const staff = viewer !== "PARENT";
  return {
    ...shapeRow(row),
    viewer,
    // Staff see who the family is; a parent sees their own child's concern only.
    parents: staff ? row.student.parents.map((link) => ({ name: fullName(link.parent), phone: link.parent.phone })) : [],
    raisedByParent: staff && row.parent ? fullName(row.parent) : null,
    /** The teacher who raised it, for staff. */
    raisedByTeacher: staff && row.raisedBy === "TEACHER" && row.createdBy ? fullName(row.createdBy) : null,
    teacherOnLeave: staff && row.teacherId ? (await onLeaveToday(ctx, [row.teacherId])).has(row.teacherId) : false,
    supportId: staff ? (row.supports[0]?.id ?? null) : null,
    messages: row.messages.map((message) => ({
      id: message.id,
      authorRole: message.authorRole,
      author: message.author ? fullName(message.author) : null,
      body: message.body,
      internal: message.internal,
      fromStatus: message.fromStatus,
      toStatus: message.toStatus,
      createdAt: message.createdAt,
    })),
    mayChangeStatus: staff && !closed,
    mayRequestUpdate: viewer === "SCHOOL_ADMIN" && Boolean(row.teacherId) && (OPEN_CONCERN as readonly string[]).includes(row.status),
    mayAssign: viewer === "SCHOOL_ADMIN" && !closed,
    message: row.messages.find((message) => !message.internal)?.body ?? "",
    waitingOnMe: waitingOn(viewer, row),
  };
}

export type ConcernDetail = Awaited<ReturnType<typeof getConcern>>;

// -----------------------------------------------------------------------------
// Replying and moving it along
// -----------------------------------------------------------------------------

/**
 * Move a concern along: OPEN → IN_PROGRESS → RESOLVED, optionally with a
 * short note for the family. Only staff do this — the teacher the concern is
 * with, or the School Admin; a parent sees the status and cannot change it.
 * The teacher's update answers any action the School Admin requested.
 */
export async function replyToConcern(ctx: TenantContext, input: ConcernReplyInput): Promise<void> {
  if (ctx.user.role === "PARENT") throw new ForbiddenError("The teacher updates the status of a concern.");
  const { viewer, where } = await visibleWhere(ctx);
  const concern = await ctx.db.supportConcern.findFirst({
    where: { AND: [{ id: input.concernId }, where] },
    select: { id: true, number: true, status: true, priority: true, reviewedAt: true, student: { select: { firstName: true, lastName: true } } },
  });
  if (!concern) throw new NotFoundError("That concern was not found.");
  if (concern.status === "CLOSED") throw new ConflictError("This concern is closed.");

  const status = input.status && input.status !== concern.status ? input.status : undefined;
  const priority = input.priority && input.priority !== concern.priority ? input.priority : undefined;
  if (!status && !priority && !input.message) return;
  const now = new Date();

  await ctx.db.$transaction(async (tx) => {
    await tx.supportConcern.updateMany({
      where: { id: concern.id },
      data: {
        lastMessageAt: now,
        ...(status ? { status, resolvedAt: status === "RESOLVED" ? now : null } : {}),
        ...(priority ? { priority } : {}),
        ...(!concern.reviewedAt ? { reviewedAt: now } : {}),
        // The teacher acting is the update the office asked for.
        ...(viewer === "TEACHER" ? { updateRequestedAt: null } : {}),
      },
    });
    await tx.concernMessage.create({
      data: {
        schoolId: ctx.schoolId,
        concernId: concern.id,
        authorId: ctx.user.id,
        authorRole: viewer,
        body: input.message ?? "",
        fromStatus: status ? concern.status : null,
        toStatus: status ?? null,
      },
    });
  });

  await recordAudit({
    action: "CONCERN_UPDATED",
    entityType: "SupportConcern",
    entityId: concern.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${concernRef(concern.number)} (${fullName(concern.student)}): ${[
      status ? `${humanize(concern.status)} → ${humanize(status)}` : null,
      priority ? `priority → ${humanize(priority)}` : null,
      input.message ? "note added" : null,
    ]
      .filter(Boolean)
      .join(", ")}.`,
  });
}

/** The School Admin asks the teacher for an update. Staff-only; the family does not see it. */
export async function requestConcernUpdate(ctx: TenantContext, input: ConcernUpdateRequestInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const concern = await ctx.db.supportConcern.findFirst({
    where: { id: input.concernId },
    select: { id: true, number: true, status: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
  });
  if (!concern) throw new NotFoundError("That concern was not found.");
  if (!concern.teacherId) throw new ConflictError("No teacher has this concern yet. Assign one first, or reply yourself.");
  if (!(OPEN_CONCERN as readonly string[]).includes(concern.status)) throw new ConflictError("This concern is already resolved or closed.");
  const now = new Date();
  await ctx.db.$transaction([
    ctx.db.supportConcern.updateMany({ where: { id: concern.id }, data: { updateRequestedAt: now } }),
    ctx.db.concernMessage.create({
      data: {
        schoolId: ctx.schoolId,
        concernId: concern.id,
        authorId: ctx.user.id,
        authorRole: "SCHOOL_ADMIN",
        body: input.note ?? "Please share an update on this concern.",
        internal: true,
      },
    }),
  ]);
  await recordAudit({
    action: "CONCERN_UPDATED",
    entityType: "SupportConcern",
    entityId: concern.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${concernRef(concern.number)}: update requested from ${concern.teacher ? fullName(concern.teacher) : "the teacher"}.`,
  });
}

/**
 * The School Admin hands a concern to a current teacher — usually one that
 * was waiting with the office because nobody taught the subject. This is an
 * explicit decision; assignment changes never move concerns on their own.
 */
export async function assignConcern(ctx: TenantContext, input: ConcernAssignInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [concern, teacher] = await Promise.all([
    ctx.db.supportConcern.findFirst({ where: { id: input.concernId }, select: { id: true, number: true, status: true, teacherId: true } }),
    ctx.db.teacher.findFirst({ where: { id: input.teacherId, status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  if (!concern) throw new NotFoundError("That concern was not found.");
  if (!teacher) throw new ValidationError("Please correct the highlighted fields.", { teacherId: ["Choose a current teacher"] });
  if (concern.status === "CLOSED") throw new ConflictError("This concern is closed.");
  if (concern.teacherId === teacher.id) return;
  await ctx.db.$transaction([
    ctx.db.supportConcern.updateMany({ where: { id: concern.id }, data: { teacherId: teacher.id, updateRequestedAt: null } }),
    ctx.db.concernMessage.create({
      data: { schoolId: ctx.schoolId, concernId: concern.id, authorId: ctx.user.id, authorRole: "SCHOOL_ADMIN", body: `Handed to ${fullName(teacher)}.`, internal: true },
    }),
  ]);
  await recordAudit({
    action: "CONCERN_UPDATED",
    entityType: "SupportConcern",
    entityId: concern.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${concernRef(concern.number)} handed to ${fullName(teacher)}.`,
  });
}

// -----------------------------------------------------------------------------
// Form options
// -----------------------------------------------------------------------------

/**
 * For a parent's form: each current child with the subjects of their group
 * and who teaches each — then the school's other subjects, which go to the
 * School Admin because nobody teaches them to this child's group.
 */
export async function parentConcernOptions(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");
  const { children } = await listMyChildren(ctx);
  const allSubjects = await ctx.db.subject.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const result = [];
  for (const child of children.filter((row) => row.current)) {
    let placement;
    try {
      placement = await currentPlacement(ctx, child.id);
    } catch {
      continue;
    }
    const taught = await groupSubjects(ctx.db, placement.placement);
    const taughtIds = new Set(taught.map((row) => row.id));
    result.push({
      id: child.id,
      name: child.name,
      group: placement.group,
      subjects: [
        ...taught.map((row) => ({ value: row.id, label: row.name, teacher: fullName(row.teachers[0]!) })),
        ...allSubjects.filter((row) => !taughtIds.has(row.id)).map((row) => ({ value: row.id, label: row.name, teacher: null })),
      ],
    });
  }
  return result;
}

/**
 * For a teacher's form: the students they may raise a concern about, each
 * with the subjects they teach that student — the same rule as routing, so
 * a teacher of "9 – A Science: Maths" sees Science students only.
 */
export async function teacherConcernOptions(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const mine = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, academicSession: { isCurrent: true } },
    select: { sectionId: true, subjectId: true },
  });
  const sectionIds = [...new Set(mine.map((row) => row.sectionId))];
  if (!sectionIds.length) return [];
  const [all, enrollments] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findMany({
      where: {
        sectionId: { in: sectionIds },
        subjectId: { in: [...new Set(mine.map((row) => row.subjectId))] },
        academicSession: { isCurrent: true },
        teacher: { status: { in: [...CURRENT_EMPLOYEE] } },
      },
      select: { sectionId: true, subjectId: true, streamId: true, teacherId: true, subject: { select: { name: true } } },
    }),
    ctx.db.studentEnrollment.findMany({
      where: { sectionId: { in: sectionIds }, status: "ACTIVE", academicSession: { isCurrent: true }, student: { status: { in: [...CURRENT_STUDENT] } } },
      select: {
        streamId: true,
        stream: { select: { name: true } },
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
        section: { select: { id: true, name: true, streamId: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } },
      },
    }),
  ]);
  const options = [];
  for (const enrollment of enrollments) {
    const streamId = enrollment.streamId ?? enrollment.section.streamId;
    const subjects = new Map<string, string>();
    for (const subjectId of new Set(all.filter((row) => row.sectionId === enrollment.section.id).map((row) => row.subjectId))) {
      const rows = all.filter((row) => row.sectionId === enrollment.section.id && row.subjectId === subjectId && (row.streamId === null || row.streamId === streamId));
      const specific = rows.filter((row) => row.streamId !== null);
      if ((specific.length ? specific : rows).some((row) => row.teacherId === teacher.id)) subjects.set(subjectId, rows[0]!.subject.name);
    }
    if (!subjects.size) continue;
    options.push({
      value: enrollment.student.id,
      label: `${fullName(enrollment.student)} · ${groupLabel(enrollment.section, enrollment.stream)}`,
      sort: `${String(enrollment.section.class.level + 10).padStart(3, "0")}|${enrollment.section.name}|${fullName(enrollment.student)}`,
      subjects: [...subjects.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }
  return options.sort((a, b) => a.sort.localeCompare(b.sort)).map((option) => ({ value: option.value, label: option.label, subjects: option.subjects }));
}

/** Filter options for the School Admin's list. */
export async function concernFilterOptions(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [classes, sections, streams, subjects, teachers] = await Promise.all([
    ctx.db.class.findMany({ where: { isActive: true }, orderBy: { level: "asc" }, select: { id: true, name: true } }),
    ctx.db.section.findMany({ where: { academicSession: { isCurrent: true } }, select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } }),
    ctx.db.stream.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.subject.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.teacher.findMany({ where: { status: { in: [...CURRENT_EMPLOYEE] } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
  ]);
  return {
    classes: classes.map((row) => ({ value: row.id, label: row.name })),
    sections: sections
      .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
      .map((row) => ({ value: row.id, label: groupLabel(row) })),
    streams: streams.map((row) => ({ value: row.id, label: row.name })),
    subjects: subjects.map((row) => ({ value: row.id, label: row.name })),
    teachers: teachers.map((row) => ({ value: row.id, label: fullName(row) })),
  };
}

// -----------------------------------------------------------------------------
// Alerts (the existing derived feeds — nothing stored)
// -----------------------------------------------------------------------------

const ALERT_DAYS = 14;

/** For a teacher: new concerns, parents' replies, and the office's update requests. */
export async function teacherConcernAlerts(ctx: TenantContext) {
  const { where } = await visibleWhere(ctx);
  const rows = await ctx.db.supportConcern.findMany({
    where: { AND: [where, { status: { in: [...OPEN_CONCERN] }, lastMessageAt: { gte: addDays(today(), -ALERT_DAYS) } }] },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: {
      id: true,
      number: true,
      raisedBy: true,
      updateRequestedAt: true,
      subject: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
      section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      stream: { select: { name: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { authorRole: true, createdAt: true } },
    },
  });
  const alerts = [];
  for (const row of rows) {
    const last = row.messages[0];
    const subject = row.subject?.name ?? "";
    const href = `/teacher/concerns/${row.id}`;
    if (row.updateRequestedAt) {
      alerts.push({
        kind: "concern",
        childId: null,
        title: `School Admin requested an update for ${row.student.firstName}'s ${subject} concern`,
        detail: `${fullName(row.student)}${row.section ? ` · ${groupLabel(row.section, row.stream)}` : ""} · ${subject}`,
        at: row.updateRequestedAt,
        href,
        tone: "warning" as const,
      });
    } else if (last?.authorRole === "PARENT") {
      const fresh = row.raisedBy === "PARENT" && row._count.messages === 1;
      alerts.push({
        kind: "concern",
        childId: null,
        title: fresh ? `New ${subject} concern from ${fullName(row.student)}'s parent` : `${fullName(row.student)}'s parent replied on ${concernRef(row.number)}`,
        detail: fresh ? "Read it and let the parent know what you will do." : `${subject} concern`,
        at: last.createdAt,
        href,
        tone: "warning" as const,
      });
    }
  }
  return alerts;
}

/** For a parent: a teacher's new concern, or the school's reply on one. */
export async function parentConcernAlerts(ctx: TenantContext, children: Array<{ id: string; name: string }>) {
  const ids = children.map((child) => child.id);
  if (!ids.length) return [];
  const rows = await ctx.db.supportConcern.findMany({
    where: { studentId: { in: ids }, lastMessageAt: { gte: addDays(today(), -ALERT_DAYS) } },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: {
      id: true,
      number: true,
      raisedBy: true,
      studentId: true,
      subject: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
      messages: { where: { internal: false }, orderBy: { createdAt: "desc" }, take: 2, select: { authorRole: true, createdAt: true } },
    },
  });
  const nameOf = new Map(children.map((child) => [child.id, child.name]));
  const alerts = [];
  for (const row of rows) {
    const last = row.messages[0];
    if (!last || last.authorRole === "PARENT") continue;
    const child = nameOf.get(row.studentId) ?? "";
    const first = child.split(" ")[0] ?? child;
    const subject = row.subject?.name ?? "";
    const fresh = row.raisedBy === "TEACHER" && row.messages.length === 1;
    const who = last.authorRole === "TEACHER" && row.teacher ? `Teacher ${fullName(row.teacher)}` : "The school office";
    alerts.push({
      kind: "concern" as const,
      childId: row.studentId,
      childName: first,
      title: fresh ? `New ${subject} concern for ${child}` : `${who} updated ${first}'s ${subject} concern`,
      detail: concernRef(row.number),
      at: last.createdAt,
      href: `/parent/concerns/${row.id}`,
      tone: "info" as const,
    });
  }
  return alerts;
}

/** For the School Admin: how many concerns wait with the office. */
export async function adminConcernCounts(ctx: TenantContext) {
  const [unassigned, open] = await Promise.all([
    ctx.db.supportConcern.count({ where: { teacherId: null, status: { in: [...OPEN_CONCERN] } } }),
    ctx.db.supportConcern.count({ where: { status: "OPEN" } }),
  ]);
  return { unassigned, open };
}
