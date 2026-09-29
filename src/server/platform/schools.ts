import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { SchoolStatus, SubscriptionStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { hashPassword } from "@/server/auth/password";
import type { SessionUser } from "@/server/auth/session";
import {
  invalidateAllSessionsForSchool,
  invalidateAllSessionsForUser,
} from "@/server/auth/session";
import { generateTemporaryPassword } from "@/server/auth/temp-password";
import { provisionSchool } from "@/server/academics/provision";
import { isUniqueViolation } from "@/server/db/errors";
import { prisma } from "@/server/db/prisma";
import { PLATFORM_AUDIT_WHERE } from "@/server/platform/audit";
import { sendMail } from "@/server/mail/mailer";
import { schoolApprovedEmail, schoolRejectedEmail } from "@/server/mail/templates";

/**
 * School governance for the Super Admin.
 *
 * This is the one area that uses the unscoped client, because the platform
 * owner acts across schools by definition. It deliberately exposes schools'
 * *governance* data only — status, contacts, admins, subscription and counts —
 * and never lists a school's students, parents or staff records.
 */

export const SCHOOL_PAGE_SIZE = 20;

export type Credentials = { email: string; password: string; label?: string };

export async function listSchools(
  actor: SessionUser,
  filters: { status?: SchoolStatus | "REVIEW"; q?: string; page?: number },
) {
  assertRole(actor, "SUPER_ADMIN");

  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.SchoolWhereInput = {
    ...(filters.status === "REVIEW"
      ? { status: { in: ["PENDING", "UNDER_REVIEW"] } }
      : filters.status
        ? { status: filters.status }
        : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
            { city: { contains: filters.q, mode: "insensitive" } },
            { contactEmail: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * SCHOOL_PAGE_SIZE,
      take: SCHOOL_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        state: true,
        status: true,
        createdAt: true,
        contactEmailVerifiedAt: true,
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, plan: { select: { name: true } } },
        },
        _count: { select: { students: true, teachers: true } },
      },
    }),
    prisma.school.count({ where }),
  ]);

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / SCHOOL_PAGE_SIZE)) };
}

export async function getSchoolForPlatform(actor: SessionUser, schoolId: string) {
  assertRole(actor, "SUPER_ADMIN");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: {
      reviewedBy: { select: { firstName: true, lastName: true } },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { plan: { select: { id: true, name: true, tier: true } } },
      },
      _count: {
        select: { students: true, teachers: true, parents: true, classes: true },
      },
    },
  });
  if (!school) throw new NotFoundError();

  const [admins, recentAudit] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId, role: "SCHOOL_ADMIN" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
      },
    }),
    prisma.auditLog.findMany({
      // Platform events for this school only — not its daily operations.
      where: { schoolId, ...PLATFORM_AUDIT_WHERE },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, summary: true, createdAt: true },
    }),
  ]);

  return { school, admins, recentAudit };
}

// -----------------------------------------------------------------------------
// Status transitions
// -----------------------------------------------------------------------------

/**
 * Which states each transition may start from. Transitions are applied with a
 * conditional `updateMany`, so two admins acting at once cannot, say, approve a
 * school the other has just rejected.
 */
const TRANSITIONS = {
  review: { from: ["PENDING"], to: "UNDER_REVIEW", audit: "SCHOOL_UNDER_REVIEW" },
  approve: {
    from: ["PENDING", "UNDER_REVIEW", "REJECTED"],
    to: "ACTIVE",
    audit: "SCHOOL_APPROVED",
  },
  reject: { from: ["PENDING", "UNDER_REVIEW"], to: "REJECTED", audit: "SCHOOL_REJECTED" },
  suspend: { from: ["ACTIVE"], to: "SUSPENDED", audit: "SCHOOL_SUSPENDED" },
  reactivate: {
    from: ["SUSPENDED", "INACTIVE"],
    to: "ACTIVE",
    audit: "SCHOOL_REACTIVATED",
  },
} as const satisfies Record<
  string,
  {
    from: readonly SchoolStatus[];
    to: SchoolStatus;
    audit:
      | "SCHOOL_UNDER_REVIEW"
      | "SCHOOL_APPROVED"
      | "SCHOOL_REJECTED"
      | "SCHOOL_SUSPENDED"
      | "SCHOOL_REACTIVATED";
  }
>;

export type SchoolTransition = keyof typeof TRANSITIONS;

const TRANSITION_VERB: Record<SchoolTransition, string> = {
  review: "moved to review",
  approve: "approved",
  reject: "rejected",
  suspend: "suspended",
  reactivate: "reactivated",
};

export type TransitionOutcome = { credentials?: Credentials };

export async function transitionSchool(
  actor: SessionUser,
  schoolId: string,
  transition: SchoolTransition,
  reason: string | null = null,
): Promise<TransitionOutcome> {
  assertRole(actor, "SUPER_ADMIN");
  const rule = TRANSITIONS[transition];

  if ((transition === "reject" || transition === "suspend") && !reason) {
    throw new ConflictError("Give a reason — the school will be told why.");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      status: true,
      contactName: true,
      contactEmail: true,
      contactEmailVerifiedAt: true,
    },
  });
  if (!school) throw new NotFoundError();

  // Approving a school whose contact never proved they own that inbox would
  // hand someone else's name to whoever filled in the form.
  if (transition === "approve" && !school.contactEmailVerifiedAt) {
    throw new ConflictError(
      "The contact has not verified their email address yet. Ask them to enter the code, or mark it verified yourself once you have confirmed it another way.",
    );
  }

  let credentials: Credentials | undefined;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.school.updateMany({
      where: { id: schoolId, status: { in: [...rule.from] } },
      data: {
        status: rule.to,
        ...(transition === "approve" || transition === "reject" || transition === "review"
          ? { reviewedAt: new Date(), reviewedById: actor.id }
          : {}),
        ...(transition === "reject" ? { rejectionReason: reason } : {}),
        ...(transition === "approve" ? { rejectionReason: null } : {}),
        ...(transition === "suspend" ? { suspendedReason: reason } : {}),
        ...(transition === "reactivate" ? { suspendedReason: null } : {}),
      },
    });

    if (count === 0) {
      throw new ConflictError(
        `This school is ${school.status.toLowerCase().replace("_", " ")} and cannot be ${TRANSITION_VERB[transition]}.`,
      );
    }

    if (transition === "approve") {
      await provisionSchool(tx, schoolId);
      credentials = await issueFirstAdmin(tx, school);

      // A subscription requested at registration becomes live on approval.
      await tx.subscription.updateMany({
        where: { schoolId, status: "TRIALING" },
        data: { status: "ACTIVE" },
      });
    }
  });

  // Suspension must take effect for people who are already signed in.
  if (transition === "suspend") await invalidateAllSessionsForSchool(schoolId);

  await recordAudit({
    action: rule.audit,
    entityType: "School",
    entityId: schoolId,
    schoolId,
    actorId: actor.id,
    summary: `${school.name} ${TRANSITION_VERB[transition]}${reason ? `: ${reason}` : "."}`,
    metadata: { from: school.status, to: rule.to },
  });

  if (credentials) {
    await recordAudit({
      action: "SCHOOL_ADMIN_CREATED",
      entityType: "User",
      schoolId,
      actorId: actor.id,
      summary: `Administrator ${credentials.email} created for ${school.name}.`,
    });
  }

  if (transition === "approve") {
    // Either way the school is told it is live. A password appears only when
    // the platform generated one; normally they chose it at registration.
    await sendMail(
      schoolApprovedEmail({
        to: school.contactEmail,
        contactName: school.contactName,
        schoolName: school.name,
        email: credentials?.email ?? school.contactEmail,
        password: credentials?.password,
      }),
    );
  }

  if (transition === "reject" && reason) {
    await sendMail(
      schoolRejectedEmail({
        to: school.contactEmail,
        contactName: school.contactName,
        schoolName: school.name,
        reason,
      }),
    );
  }

  return { credentials };
}

/**
 * On first approval, turn the registration contact into the school's first
 * administrator. Skipped if the school already has one, or if the address is
 * already in use elsewhere — the Super Admin then adds an admin by hand.
 */
async function issueFirstAdmin(
  tx: Prisma.TransactionClient,
  school: { id: string; contactName: string; contactEmail: string },
): Promise<Credentials | undefined> {
  const existingAdmin = await tx.user.count({
    where: { schoolId: school.id, role: "SCHOOL_ADMIN" },
  });
  if (existingAdmin) return undefined;

  const email = school.contactEmail.toLowerCase();
  const emailTaken = await tx.user.count({ where: { email } });
  if (emailTaken) return undefined;

  const [firstName, ...rest] = school.contactName.trim().split(/\s+/);
  const password = generateTemporaryPassword();

  await tx.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: "SCHOOL_ADMIN",
      firstName: firstName || "School",
      lastName: rest.join(" ") || "Admin",
      schoolId: school.id,
    },
  });

  return { email, password, label: "Administrator sign-in for the school" };
}

/**
 * Mark the contact address verified by hand.
 *
 * The escape hatch for a school that confirmed itself some other way — a phone
 * call, a letterhead — when the code never arrives. It is audited, and it says
 * who decided, because it bypasses the proof everyone else has to give.
 */
export async function markEmailVerified(actor: SessionUser, schoolId: string): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, contactEmail: true, contactEmailVerifiedAt: true },
  });
  if (!school) throw new NotFoundError();
  if (school.contactEmailVerifiedAt) throw new ConflictError("That email is already verified.");

  await prisma.school.update({
    where: { id: school.id },
    data: { contactEmailVerifiedAt: new Date() },
  });

  await recordAudit({
    action: "SCHOOL_EMAIL_VERIFIED",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    actorId: actor.id,
    summary: `${school.contactEmail} marked verified by the Super Admin, without a code.`,
  });
}

// -----------------------------------------------------------------------------
// School administrators
// -----------------------------------------------------------------------------

export async function createSchoolAdmin(
  actor: SessionUser,
  input: { schoolId: string; firstName: string; lastName: string; email: string; phone?: string },
): Promise<Credentials> {
  assertRole(actor, "SUPER_ADMIN");

  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new NotFoundError();

  const password = generateTemporaryPassword();

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await hashPassword(password),
        role: "SCHOOL_ADMIN",
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        schoolId: school.id,
      },
      select: { id: true },
    });

    await recordAudit({
      action: "SCHOOL_ADMIN_CREATED",
      entityType: "User",
      entityId: user.id,
      schoolId: school.id,
      actorId: actor.id,
      summary: `Administrator ${input.email} created for ${school.name}.`,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("An account with that email address already exists.");
    }
    throw error;
  }

  return { email: input.email, password, label: "New administrator sign-in" };
}

/** Issue a fresh one-time password and sign the admin out everywhere. */
export async function resetSchoolAdminPassword(
  actor: SessionUser,
  userId: string,
): Promise<Credentials> {
  assertRole(actor, "SUPER_ADMIN");

  const user = await prisma.user.findFirst({
    where: { id: userId, role: "SCHOOL_ADMIN" },
    select: { id: true, email: true, schoolId: true },
  });
  if (!user) throw new NotFoundError();

  const password = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  await invalidateAllSessionsForUser(user.id);

  await recordAudit({
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user.id,
    schoolId: user.schoolId,
    actorId: actor.id,
    summary: `Password reset for administrator ${user.email}.`,
  });

  return { email: user.email, password, label: "New password issued" };
}

export async function setSchoolAdminActive(
  actor: SessionUser,
  userId: string,
  isActive: boolean,
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");

  const user = await prisma.user.findFirst({
    where: { id: userId, role: "SCHOOL_ADMIN" },
    select: { id: true, email: true, schoolId: true },
  });
  if (!user) throw new NotFoundError();

  await prisma.user.update({ where: { id: user.id }, data: { isActive } });
  if (!isActive) await invalidateAllSessionsForUser(user.id);

  await recordAudit({
    action: isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
    entityType: "User",
    entityId: user.id,
    schoolId: user.schoolId,
    actorId: actor.id,
    summary: `Administrator ${user.email} ${isActive ? "reactivated" : "deactivated"}.`,
  });
}

// -----------------------------------------------------------------------------
// Subscription
// -----------------------------------------------------------------------------

/**
 * Record the school's entitlement. The latest subscription row is updated in
 * place; payment integration is out of V1, so this is bookkeeping, not billing.
 */
export async function setSubscription(
  actor: SessionUser,
  input: {
    schoolId: string;
    planId: string;
    status: SubscriptionStatus;
    startsAt: Date;
    endsAt: Date | null;
    notes: string | null;
  },
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");

  const [school, plan] = await Promise.all([
    prisma.school.findUnique({ where: { id: input.schoolId }, select: { id: true, name: true } }),
    prisma.plan.findUnique({ where: { id: input.planId }, select: { id: true, name: true } }),
  ]);
  if (!school || !plan) throw new NotFoundError();

  if (input.endsAt && input.endsAt < input.startsAt) {
    throw new ConflictError("The end date must be after the start date.");
  }

  const latest = await prisma.subscription.findFirst({
    where: { schoolId: school.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const data = {
    planId: plan.id,
    status: input.status,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    notes: input.notes,
  };

  if (latest) {
    await prisma.subscription.update({ where: { id: latest.id }, data });
  } else {
    await prisma.subscription.create({ data: { ...data, schoolId: school.id } });
  }

  await recordAudit({
    action: "SUBSCRIPTION_UPDATED",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    actorId: actor.id,
    summary: `${school.name} subscription set to ${plan.name} (${input.status.toLowerCase()}).`,
  });
}

export async function listPlansForSelect() {
  return prisma.plan.findMany({
    orderBy: { priceMinor: "asc" },
    select: { id: true, name: true, isActive: true },
  });
}

/** Set or clear a school's UDISE code. Unique across the platform. */
export async function setSchoolUdise(
  actor: SessionUser,
  schoolId: string,
  udiseCode: string | null,
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) throw new NotFoundError("That school was not found.");

  try {
    await prisma.school.update({ where: { id: school.id }, data: { udiseCode } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Another school already has that UDISE code.");
    }
    throw error;
  }

  await recordAudit({
    action: "SCHOOL_UPDATED",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    actorId: actor.id,
    summary: udiseCode ? `UDISE code for ${school.name} set to ${udiseCode}.` : `UDISE code for ${school.name} cleared.`,
  });
}
