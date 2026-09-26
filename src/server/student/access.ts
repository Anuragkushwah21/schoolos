import "server-only";

import { NotFoundError } from "@/lib/errors";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * The one door into a student's own records.
 *
 * Every read in `src/server/student/` starts here and none of them takes a
 * `studentId`, a `sectionId` or a `schoolId` from a request. The chain is
 * always:
 *
 *   session user id -> Student row -> current enrollment -> section
 *
 * so there is no id a student could change to see somebody else. That is the
 * difference from the parent module, which has to accept a `studentId` because a
 * guardian has several children: a student has exactly one record, so the
 * request carries nothing at all.
 */

export type StudentContext = {
  student: {
    id: string;
    name: string;
    firstName: string;
    admissionNumber: string;
    photoUrl: string | null;
    status: string;
  };
  placement: {
    sessionId: string;
    sessionName: string;
    sectionId: string;
    sectionLabel: string;
    classId: string;
    rollNumber: string | null;
  };
};

/** The student behind the signed-in user, with where they currently sit. */
export async function requireStudentSelf(ctx: TenantContext): Promise<StudentContext> {
  const found = await findStudentSelf(ctx);
  if (!found.placement) {
    throw new NotFoundError("You are not placed in a class for the current session yet.");
  }
  return { student: found.student, placement: found.placement };
}

/** As `requireStudentSelf`, but tolerates a student the school has not placed. */
export async function findStudentSelf(
  ctx: TenantContext,
): Promise<{ student: StudentContext["student"]; placement: StudentContext["placement"] | null }> {
  assertRole(ctx.user, "STUDENT");

  const student = await ctx.db.student.findFirst({
    where: { userId: ctx.user.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      photoUrl: true,
      status: true,
      enrollments: {
        where: { academicSession: { isCurrent: true } },
        select: {
          rollNumber: true,
          classId: true,
          academicSession: { select: { id: true, name: true } },
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { name: true } },
              stream: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // A STUDENT login with no student record is a half-finished setup.
  if (!student) throw new NotFoundError("Your student record is not set up yet.");

  const enrollment = student.enrollments[0];

  return {
    student: {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      firstName: student.firstName,
      admissionNumber: student.admissionNumber,
      photoUrl: student.photoUrl,
      status: student.status,
    },
    placement: enrollment
      ? {
          sessionId: enrollment.academicSession.id,
          sessionName: enrollment.academicSession.name,
          sectionId: enrollment.section.id,
          sectionLabel: sectionLabel(enrollment.section),
          classId: enrollment.classId,
          rollNumber: enrollment.rollNumber,
        }
      : null,
  };
}
