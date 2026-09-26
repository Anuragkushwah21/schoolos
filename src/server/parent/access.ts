import "server-only";

import { NotFoundError } from "@/lib/errors";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * The one door into a child's records for a guardian.
 *
 * Every read in `src/server/parent/` starts here, and none of them accepts a
 * `parentId`, a `sectionId` or a `schoolId` from the caller. The chain is
 * always the same:
 *
 *   session user id -> Parent row -> ParentStudent link -> Student -> placement
 *
 * so the only thing a request can influence is *which* `studentId` is asked
 * for, and an id that is not linked to this guardian answers exactly as one
 * that does not exist. Tenant scoping on `ctx.db` sits underneath all of it,
 * which is why another school's child cannot even be seen here.
 */

/** The guardian behind the signed-in user. */
export async function requireParentSelf(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");

  const parent = await ctx.db.parent.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, occupation: true },
  });

  // A PARENT login with no guardian record is a half-finished setup, not an
  // authorization failure — but there is nothing to show either way.
  if (!parent) throw new NotFoundError("Your guardian record is not set up yet.");
  return parent;
}

export type ChildContext = {
  parentId: string;
  student: {
    id: string;
    name: string;
    admissionNumber: string;
    photoUrl: string | null;
    status: string;
  };
  relationship: string;
  /** The child's placement in the current session. */
  placement: {
    sessionId: string;
    sessionName: string;
    sectionId: string;
    sectionLabel: string;
    classId: string;
    rollNumber: string | null;
  };
};

/**
 * Resolve one of this guardian's children, with where they currently sit.
 *
 * The placement comes from the enrollment row rather than from the request, so
 * every read below it is scoped to a section the school itself put this child
 * in. A child with no current placement resolves to `null` placement via
 * `findChild`; this variant insists on one because nearly every screen needs it.
 */
export async function requireChild(ctx: TenantContext, studentId: string): Promise<ChildContext> {
  const found = await findChild(ctx, studentId);
  if (!found.placement) {
    throw new NotFoundError(`${found.student.name} is not placed in a class this session.`);
  }
  return { ...found, placement: found.placement };
}

/** As `requireChild`, but tolerates a child the school has not yet placed. */
export async function findChild(
  ctx: TenantContext,
  studentId: string,
): Promise<Omit<ChildContext, "placement"> & { placement: ChildContext["placement"] | null }> {
  const parent = await requireParentSelf(ctx);

  const link = await ctx.db.parentStudent.findFirst({
    where: { parentId: parent.id, studentId },
    select: {
      relationship: true,
      student: {
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
      },
    },
  });

  // Another guardian's child, another school's child and a made-up id are one
  // answer, so probing ids reveals nothing about who else the school teaches.
  if (!link) throw new NotFoundError("That child was not found.");

  const enrollment = link.student.enrollments[0];

  return {
    parentId: parent.id,
    relationship: link.relationship,
    student: {
      id: link.student.id,
      name: `${link.student.firstName} ${link.student.lastName}`,
      admissionNumber: link.student.admissionNumber,
      photoUrl: link.student.photoUrl,
      status: link.student.status,
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

/**
 * Every child linked to this guardian, newest placement first.
 *
 * Used by the child switcher, which therefore cannot list a child the link
 * table does not join to this parent.
 */
export async function listMyChildren(ctx: TenantContext) {
  const parent = await requireParentSelf(ctx);

  const links = await ctx.db.parentStudent.findMany({
    where: { parentId: parent.id },
    orderBy: { createdAt: "asc" },
    select: {
      relationship: true,
      isPrimary: true,
      student: {
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
              section: {
                select: {
                  id: true,
                  name: true,
                  class: { select: { name: true, level: true } },
                  stream: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return {
    parent,
    children: links.map((link) => {
      const enrollment = link.student.enrollments[0];
      return {
        id: link.student.id,
        name: `${link.student.firstName} ${link.student.lastName}`,
        admissionNumber: link.student.admissionNumber,
        photoUrl: link.student.photoUrl,
        status: link.student.status,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        sectionId: enrollment?.section.id ?? null,
        sectionLabel: enrollment ? sectionLabel(enrollment.section) : null,
        rollNumber: enrollment?.rollNumber ?? null,
        level: enrollment?.section.class.level ?? 0,
      };
    }),
  };
}
