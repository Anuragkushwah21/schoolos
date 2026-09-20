import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { TeacherStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { CreateTeacherInput, UpdateTeacherInput } from "@/lib/validation/school";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { hashPassword } from "@/server/auth/password";
import { generateTemporaryPassword } from "@/server/auth/temp-password";
import { requireCurrentSession } from "@/server/academics/structure";
import { isUniqueViolation } from "@/server/db/errors";
import { setPortalUserActive } from "@/server/people/accounts";
import { assertWithinPlanLimit } from "@/server/platform/limits";
import type { Credentials } from "@/server/platform/schools";

/**
 * Teaching staff. Every teacher has a login — they need one to see their
 * timetable and mark attendance — so creating a teacher creates the user too,
 * in one transaction.
 */

export const TEACHER_PAGE_SIZE = 25;

export async function listTeachers(
  ctx: TenantContext,
  filters: { q?: string; status?: TeacherStatus; page?: number },
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = Math.max(1, filters.page ?? 1);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });

  const where: Prisma.TeacherWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { employeeId: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    ctx.db.teacher.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * TEACHER_PAGE_SIZE,
      take: TEACHER_PAGE_SIZE,
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        assignments: {
          where: { academicSessionId: session?.id ?? "__none__" },
          select: { subject: { select: { name: true } } },
        },
        classTeacherOf: {
          where: { academicSessionId: session?.id ?? "__none__" },
          select: { name: true, class: { select: { name: true } } },
        },
      },
    }),
    ctx.db.teacher.count({ where }),
  ]);

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / TEACHER_PAGE_SIZE)) };
}

export async function teacherOptions(ctx: TenantContext) {
  const teachers = await ctx.db.teacher.findMany({
    where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
  return teachers.map((t) => ({ value: t.id, label: `${t.firstName} ${t.lastName} (${t.employeeId})` }));
}

export async function getTeacherProfile(ctx: TenantContext, teacherId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });

  const teacher = await ctx.db.teacher.findFirst({
    where: { id: teacherId },
    include: {
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      assignments: {
        where: { academicSessionId: session?.id ?? "__none__" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          subject: { select: { name: true, code: true } },
          section: { select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } },
        },
      },
      classTeacherOf: {
        where: { academicSessionId: session?.id ?? "__none__" },
        select: { id: true, name: true, class: { select: { name: true } } },
      },
    },
  });
  if (!teacher) throw new NotFoundError();

  const periodsPerWeek = session
    ? await ctx.db.timetableSlot.count({ where: { teacherId: teacher.id, academicSessionId: session.id } })
    : 0;

  return { teacher, session, periodsPerWeek };
}

async function nextEmployeeId(ctx: TenantContext): Promise<string> {
  const rows = await ctx.db.teacher.findMany({
    where: { employeeId: { startsWith: "EMP" } },
    select: { employeeId: true },
  });
  const highest = rows.reduce((max, row) => {
    const n = Number.parseInt(row.employeeId.slice(3), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `EMP${String(highest + 1).padStart(3, "0")}`;
}

export async function createTeacher(
  ctx: TenantContext,
  input: CreateTeacherInput,
): Promise<{ teacherId: string; credentials: Credentials }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertWithinPlanLimit(ctx, "teachers");

  const password = generateTemporaryPassword();
  const employeeId = input.employeeId ?? (await nextEmployeeId(ctx));
  const passwordHash = await hashPassword(password);

  try {
    const teacherId = await ctx.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          schoolId: ctx.schoolId,
          email: input.email,
          passwordHash,
          role: "TEACHER",
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        },
        select: { id: true },
      });

      const teacher = await tx.teacher.create({
        data: {
          schoolId: ctx.schoolId,
          userId: user.id,
          employeeId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          gender: input.gender,
          qualification: input.qualification,
          joiningDate: input.joiningDate,
        },
        select: { id: true },
      });
      return teacher.id;
    });

    await recordAudit({
      action: "TEACHER_CREATED",
      entityType: "Teacher",
      entityId: teacherId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Teacher ${input.firstName} ${input.lastName} (${employeeId}) added.`,
    });

    return {
      teacherId,
      credentials: { email: input.email, password, label: `Sign-in for ${input.firstName}` },
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That email address or employee ID is already in use.");
    }
    throw error;
  }
}

export async function updateTeacher(ctx: TenantContext, input: UpdateTeacherInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { teacherId, ...data } = input;

  const existing = await ctx.db.teacher.findFirst({
    where: { id: teacherId },
    select: { id: true, status: true, userId: true },
  });
  if (!existing) throw new NotFoundError();

  if (data.status !== "INACTIVE" && existing.status === "INACTIVE") {
    await assertWithinPlanLimit(ctx, "teachers");
  }

  try {
    await ctx.db.teacher.updateMany({ where: { id: teacherId }, data });
    await ctx.db.user.updateMany({
      where: { id: existing.userId },
      data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That employee ID is already in use.");
    throw error;
  }

  // A teacher who has left keeps their history but loses their login.
  if ((data.status === "INACTIVE") !== (existing.status === "INACTIVE")) {
    await setPortalUserActive(ctx, existing.userId, data.status !== "INACTIVE");
  }

  await recordAudit({
    action: "TEACHER_UPDATED",
    entityType: "Teacher",
    entityId: teacherId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Teacher ${data.firstName} ${data.lastName} updated.`,
  });
}

/**
 * Assign a subject in a section for the current session. This is also the
 * authorization grant that lets the teacher mark that section's attendance.
 */
export async function assignSubject(
  ctx: TenantContext,
  input: { teacherId: string; subjectId: string; sectionId: string },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  const [teacher, subject, section] = await Promise.all([
    ctx.db.teacher.findFirst({ where: { id: input.teacherId }, select: { id: true, firstName: true, lastName: true } }),
    ctx.db.subject.findFirst({ where: { id: input.subjectId, isActive: true }, select: { id: true, name: true } }),
    ctx.db.section.findFirst({
      where: { id: input.sectionId, academicSessionId: session.id },
      select: { id: true, name: true, class: { select: { name: true } } },
    }),
  ]);
  if (!teacher || !subject || !section) throw new NotFoundError();

  try {
    await ctx.db.teacherSubjectAssignment.create({
      data: {
        schoolId: ctx.schoolId,
        academicSessionId: session.id,
        teacherId: teacher.id,
        subjectId: subject.id,
        sectionId: section.id,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That assignment already exists.");
    throw error;
  }

  await recordAudit({
    action: "TEACHER_ASSIGNED",
    entityType: "Teacher",
    entityId: teacher.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${teacher.firstName} ${teacher.lastName} assigned ${subject.name} in ${section.class.name} – ${section.name}.`,
  });
}

export async function unassignSubject(ctx: TenantContext, assignmentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const assignment = await ctx.db.teacherSubjectAssignment.findFirst({
    where: { id: assignmentId },
    select: { id: true, teacherId: true },
  });
  if (!assignment) throw new NotFoundError();

  await ctx.db.teacherSubjectAssignment.deleteMany({ where: { id: assignment.id } });
  await recordAudit({
    action: "TEACHER_UNASSIGNED",
    entityType: "Teacher",
    entityId: assignment.teacherId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Subject assignment removed.",
  });
}
