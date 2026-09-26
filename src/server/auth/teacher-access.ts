import type { TenantContext } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/** The signed-in teacher's own staff record, found by session — never by id. */
export type TeacherSelf = {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
};

/**
 * The `Teacher` row behind the signed-in user.
 *
 * Every teacher-facing service starts here rather than taking a `teacherId`
 * from the caller: the id then cannot be someone else's, so there is no
 * ownership check to forget.
 *
 * A TEACHER account with no staff record is a half-finished setup, not an
 * attack — it is reported as "not found" rather than "forbidden".
 */
export async function requireTeacherSelf(ctx: TenantContext): Promise<TeacherSelf> {
  const teacher = await findTeacherSelf(ctx);
  if (!teacher) {
    throw new NotFoundError("Your staff record has not been set up yet. Ask your school office.");
  }
  return teacher;
}

/**
 * The same lookup without the throw, for the one caller that needs to *ask*:
 * a dashboard greeting a new teacher with "your record is not set up yet"
 * reads better than a 404 page, and it is not an error condition.
 */
export async function findTeacherSelf(ctx: TenantContext): Promise<TeacherSelf | null> {
  return ctx.db.teacher.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  });
}

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

/**
 * Stricter than `requireSectionAccess`: may this teacher teach *this subject*
 * to this section?
 *
 * Section access is deliberately broad — a class teacher reaches their whole
 * section so they can take the daily register. Setting homework or writing up
 * a lesson is narrower: a class teacher who does not teach Mathematics has no
 * business setting Mathematics homework. `TeacherSubjectAssignment` is the
 * only source of truth for that, and a timetable slot upserts one, so the two
 * can never disagree.
 *
 * Returns the assignment, because callers need its `academicSessionId`.
 */
export async function requireSubjectAssignment(
  ctx: TenantContext,
  sectionId: string,
  subjectId: string,
  academicSessionId: string,
): Promise<{ teacherId: string }> {
  const teacher = await requireTeacherSelf(ctx);

  const assignment = await ctx.db.teacherSubjectAssignment.findFirst({
    where: { teacherId: teacher.id, sectionId, subjectId, academicSessionId },
    select: { id: true },
  });

  if (!assignment) {
    // Same message whether the section is another school's, another teacher's,
    // or simply not theirs for this subject: the teacher learns what they may
    // do, and nothing about what exists beyond that.
    throw new ForbiddenError("You do not teach that subject to that class.");
  }

  return { teacherId: teacher.id };
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
