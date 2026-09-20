import type { TenantContext } from "@/server/auth/current-user";
import { ForbiddenError } from "@/lib/errors";

/**
 * Question 5 of the authorization checklist: for a teacher, is this one of
 * *their* sections?
 *
 * School Admins may act on any section in their school. Teachers may act only
 * on sections they are assigned to teach, which `TeacherSubjectAssignment`
 * defines. This is what stops a teacher marking attendance for a class that
 * isn't theirs — the tenant scope alone would happily allow it, since the
 * section does belong to their school.
 */
export async function canAccessSection(
  ctx: TenantContext,
  sectionId: string,
): Promise<boolean> {
  if (ctx.user.role === "SCHOOL_ADMIN") return true;
  if (ctx.user.role !== "TEACHER") return false;

  const teacher = await ctx.db.teacher.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true },
  });

  if (!teacher) return false;

  // Either they teach a subject to this section, or they are its class teacher.
  const [assignment, classTeacherOf] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findFirst({
      where: { teacherId: teacher.id, sectionId },
      select: { id: true },
    }),
    ctx.db.section.findFirst({
      where: { id: sectionId, classTeacherId: teacher.id },
      select: { id: true },
    }),
  ]);

  return Boolean(assignment ?? classTeacherOf);
}

export async function requireSectionAccess(
  ctx: TenantContext,
  sectionId: string,
): Promise<void> {
  if (!(await canAccessSection(ctx, sectionId))) {
    throw new ForbiddenError("You are not assigned to this class.");
  }
}

/** The section ids a teacher may act on, for building lists and filters. */
export async function accessibleSectionIds(
  ctx: TenantContext,
  academicSessionId?: string,
): Promise<string[] | "ALL"> {
  if (ctx.user.role === "SCHOOL_ADMIN") return "ALL";
  if (ctx.user.role !== "TEACHER") return [];

  const teacher = await ctx.db.teacher.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true },
  });

  if (!teacher) return [];

  const [assignments, classTeacherSections] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findMany({
      where: {
        teacherId: teacher.id,
        ...(academicSessionId ? { academicSessionId } : {}),
      },
      select: { sectionId: true },
    }),
    ctx.db.section.findMany({
      where: {
        classTeacherId: teacher.id,
        ...(academicSessionId ? { academicSessionId } : {}),
      },
      select: { id: true },
    }),
  ]);

  return [
    ...new Set([
      ...assignments.map((a) => a.sectionId),
      ...classTeacherSections.map((s) => s.id),
    ]),
  ];
}
