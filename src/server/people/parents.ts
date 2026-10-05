import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { recordAudit } from "@/server/audit/log";
import { invalidateAllSessionsForUser } from "@/server/auth/session";
import { resendAccountEmail } from "@/server/auth/account-links";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { CURRENT_STUDENT, loginState } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import { parentStanding } from "@/server/people/lifecycle";
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
  filters: { q?: string; page?: number; standing?: "ACTIVE" | "NO_ACTIVE_CHILDREN" | "ARCHIVED" } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = Math.max(1, filters.page ?? 1);

  // A guardian's standing follows their children: active while any child is
  // a current student. Families whose children have all left stay findable.
  const current = { student: { status: { in: [...CURRENT_STUDENT] } } };
  const standing: Prisma.ParentWhereInput =
    filters.standing === "ACTIVE"
      ? { children: { some: current } }
      : filters.standing === "NO_ACTIVE_CHILDREN"
        ? { children: { none: current } }
        : {};

  const search: Prisma.ParentWhereInput = filters.q
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
  // Archived parents are off the list unless asked for.
  const archived: Prisma.ParentWhereInput = filters.standing === "ARCHIVED" ? { archivedAt: { not: null } } : { archivedAt: null };
  const where: Prisma.ParentWhereInput = { AND: [standing, search, archived] };

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
        user: { select: { id: true, isActive: true, lastLoginAt: true, disabledReason: true } },
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
      alternatePhone: true,
      city: true,
      state: true,
      postalCode: true,
      selfUpdatedAt: true,
      archivedAt: true,
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, activatedAt: true } },
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
    alternatePhone: parent.alternatePhone,
    city: parent.city,
    state: parent.state,
    postalCode: parent.postalCode,
    /** When the parent last corrected their own details from My account. */
    selfUpdatedAt: parent.selfUpdatedAt,
    archivedAt: parent.archivedAt,
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
  user: { id: string; isActive: boolean; lastLoginAt?: Date | null; disabledReason?: "ADMIN" | "STATUS" | null } | null;
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
    standing: parentStanding(parent.children.map((link) => link.student)),
    login: loginState(parent.user ? { isActive: parent.user.isActive, disabledReason: parent.user.disabledReason ?? null } : null),
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
    where: {
      // An archived parent is history, not someone to link a child to.
      archivedAt: null,
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
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

// -----------------------------------------------------------------------------
// Archive
// -----------------------------------------------------------------------------

/**
 * Archive a parent whose children have all left: the record stays (their
 * children's history points at it), their login closes, and they drop off
 * the lists. A parent of a current student cannot be archived — that child
 * would lose their guardian. Restoring brings them back to the list; the
 * login is reopened separately, by choice.
 */
export async function setParentArchived(ctx: TenantContext, parentId: string, archived: boolean, reason: string | null): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const parent = await ctx.db.parent.findFirst({
    where: { id: parentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      archivedAt: true,
      user: { select: { id: true, isActive: true } },
      children: { select: { student: { select: { firstName: true, status: true } } } },
    },
  });
  if (!parent) throw new NotFoundError("That parent was not found.");
  if (archived === Boolean(parent.archivedAt)) return;
  const current = parent.children.filter((link) => (CURRENT_STUDENT as readonly string[]).includes(link.student.status));
  if (archived && current.length) {
    throw new ConflictError(`${fullName(parent)} is the guardian of ${current.map((link) => link.student.firstName).join(", ")}, still at the school. Unlink or update them first.`);
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.parent.updateMany({ where: { id: parent.id }, data: { archivedAt: archived ? new Date() : null } });
    const base = { schoolId: ctx.schoolId, person: "PARENT" as const, parentId: parent.id, effectiveDate: today(), changedById: ctx.user.id };
    await tx.statusChange.create({ data: { ...base, kind: "STATUS", fromValue: archived ? "ACTIVE" : "ARCHIVED", toValue: archived ? "ARCHIVED" : "ACTIVE", reason } });
    if (archived && parent.user?.isActive) {
      await tx.user.updateMany({ where: { id: parent.user.id }, data: { isActive: false, disabledReason: "STATUS", disabledAt: new Date() } });
      await tx.statusChange.create({ data: { ...base, kind: "LOGIN", fromValue: "ACTIVE", toValue: "LOCKED", reason: "Parent archived" } });
    }
  });
  if (archived && parent.user?.isActive) await invalidateAllSessionsForUser(parent.user.id);
  await recordAudit({
    action: archived ? "PARENT_ARCHIVED" : "PARENT_RESTORED",
    entityType: "Parent",
    entityId: parent.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(parent)} ${archived ? "archived" : "restored"}${reason ? `: ${reason}` : ""}.`,
  });
}

// -----------------------------------------------------------------------------
// Bulk: resend activation links
// -----------------------------------------------------------------------------

/** Parents whose login was made but never activated — the ones a resend is for. */
export async function parentsAwaitingActivation(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.parent.findMany({
    where: { archivedAt: null, user: { activatedAt: null, isActive: true } },
    select: { id: true, firstName: true, lastName: true, user: { select: { id: true, email: true } } },
  });
}

/**
 * Resend the activation link to every parent who has not activated yet
 * (at most 200 at a time). Each goes through the same single resend the
 * parent's page uses — one fresh link each, the old one stops working.
 */
export async function resendParentActivations(ctx: TenantContext): Promise<{ sent: number; failed: string[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const parents = (await parentsAwaitingActivation(ctx)).slice(0, 200);
  let sent = 0;
  const failed: string[] = [];
  for (const parent of parents) {
    if (!parent.user) continue;
    try {
      const result = await resendAccountEmail(ctx, parent.user.id);
      if (result.delivered) sent += 1;
      else failed.push(fullName(parent));
    } catch {
      failed.push(fullName(parent));
    }
  }
  await recordAudit({
    action: "ACTIVATION_RESENT",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Activation links resent to ${sent} parent${sent === 1 ? "" : "s"}${failed.length ? `; ${failed.length} could not be sent` : ""}.`,
  });
  return { sent, failed };
}
