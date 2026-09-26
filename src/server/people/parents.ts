import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Parents as the office manages them, rather than as an attribute of a student.
 *
 * The question these answer is "how many children does this family have here?",
 * which a student-first list cannot: three siblings appear as three rows with
 * the same parent repeated, and nothing says they are one family. One `Parent`
 * row per person, joined to any number of children, is what makes that legible —
 * and what stops a school ending up with three accounts for one father.
 *
 * School Admin only. A parent's contact details are the other families' PII as
 * far as any other role is concerned.
 */

export const PARENT_PAGE_SIZE = 25;

/**
 * Parents in this school, with their children.
 *
 * Searchable by the parent's own details and by their children's, because the
 * office usually starts from whichever name they have been given.
 */
export async function listParents(
  ctx: TenantContext,
  filters: { q?: string; page?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = Math.max(1, filters.page ?? 1);

  const where: Prisma.ParentWhereInput = filters.q
    ? {
        OR: [
          { firstName: { contains: filters.q, mode: "insensitive" } },
          { lastName: { contains: filters.q, mode: "insensitive" } },
          { phone: { contains: filters.q } },
          { email: { contains: filters.q, mode: "insensitive" } },
          // Searching by a child's name finds the family, which is how a parent
          // is usually looked up: the office knows the student, not the father.
          {
            children: {
              some: {
                student: {
                  OR: [
                    { firstName: { contains: filters.q, mode: "insensitive" } },
                    { lastName: { contains: filters.q, mode: "insensitive" } },
                    { admissionNumber: { contains: filters.q, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    ctx.db.parent.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * PARENT_PAGE_SIZE,
      take: PARENT_PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        user: { select: { id: true, isActive: true, lastLoginAt: true } },
        children: {
          orderBy: { isPrimary: "desc" },
          select: {
            relationship: true,
            isPrimary: true,
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNumber: true,
                status: true,
                enrollments: {
                  where: { academicSession: { isCurrent: true } },
                  select: {
                    rollNumber: true,
                    section: {
                      select: {
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
        },
      },
    }),
    ctx.db.parent.count({ where }),
  ]);

  return {
    rows: rows.map(shapeParent),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PARENT_PAGE_SIZE)),
  };
}

/**
 * One parent and every child of theirs at this school.
 *
 * What the details dialog reads. A parent in another school resolves to nothing,
 * because `ctx.db` is scoped before this runs.
 */
export async function getParentWithChildren(ctx: TenantContext, parentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const parent = await ctx.db.parent.findFirst({
    where: { id: parentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      occupation: true,
      addressLine: true,
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      children: {
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          relationship: true,
          isPrimary: true,
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              admissionNumber: true,
              status: true,
              enrollments: {
                where: { academicSession: { isCurrent: true } },
                select: {
                  rollNumber: true,
                  section: {
                    select: {
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
      },
    },
  });

  if (!parent) throw new NotFoundError("That parent was not found.");

  return {
    ...shapeParent(parent),
    occupation: parent.occupation,
    addressLine: parent.addressLine,
    loginEmail: parent.user?.email ?? null,
    /** The link row id, so the dialog can offer to unlink one child. */
    links: parent.children.map((link) => ({
      id: link.id,
      studentId: link.student.id,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
    })),
  };
}

type ParentRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  user: { id: string; isActive: boolean; lastLoginAt?: Date | null } | null;
  children: Array<{
    relationship: string;
    isPrimary: boolean;
    student: {
      id: string;
      firstName: string;
      lastName: string;
      admissionNumber: string;
      status: string;
      enrollments: Array<{
        rollNumber: string | null;
        section: { name: string; class: { name: string }; stream: { name: string } | null };
      }>;
    };
  }>;
};

function shapeParent(parent: ParentRow) {
  return {
    id: parent.id,
    name: fullName(parent),
    firstName: parent.firstName,
    lastName: parent.lastName,
    phone: parent.phone,
    email: parent.email,
    hasLogin: parent.user !== null,
    loginActive: parent.user?.isActive ?? false,
    lastLoginAt: parent.user?.lastLoginAt ?? null,
    childCount: parent.children.length,
    children: parent.children.map((link) => {
      const enrollment = link.student.enrollments[0];
      return {
        id: link.student.id,
        name: fullName(link.student),
        admissionNumber: link.student.admissionNumber,
        status: link.student.status,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        sectionLabel: enrollment ? sectionLabel(enrollment.section) : null,
        rollNumber: enrollment?.rollNumber ?? null,
      };
    }),
  };
}

/**
 * Options for the "existing parent" picker when admitting a student.
 *
 * Labelled with the phone number and the child count, because two fathers named
 * Rajesh Sharma are a real thing and picking the wrong one links a child to the
 * wrong family.
 */
export async function parentOptions(ctx: TenantContext, q?: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const rows = await ctx.db.parent.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {},
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 200,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      _count: { select: { children: true } },
    },
  });

  return rows.map((row) => ({
    value: row.id,
    label:
      `${fullName(row)} · ${row.phone}` +
      (row._count.children
        ? ` · ${row._count.children} ${row._count.children === 1 ? "child" : "children"}`
        : ""),
  }));
}
