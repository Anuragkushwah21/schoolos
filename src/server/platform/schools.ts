import "server-only";

import { Prisma } from "@/generated/prisma/client";
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
import { cleanModules } from "@/lib/school-modules";
import { type Limits, cleanLimits, cleanRoles, describeLimits, roleLabel } from "@/lib/school-roles";
import { describeModules } from "@/server/platform/plans";
import { syncOrganizationName } from "@/server/platform/campuses";
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
    // Live Demo sandboxes are not schools the platform manages.
    isDemo: false,
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

  const school = await prisma.school.findFirst({
    where: { id: schoolId, isDemo: false },
    include: {
      reviewedBy: { select: { firstName: true, lastName: true } },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { plan: { select: { id: true, name: true, tier: true, availableRoles: true, campusLimit: true } } },
      },
      organization: {
        select: { id: true, name: true, campusLimitOverride: true, owner: { select: { firstName: true, lastName: true, email: true } }, schools: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true } } },
      },
      _count: {
        select: { students: true, teachers: true, parents: true, classes: true },
      },
    },
  });
  if (!school) throw new NotFoundError();

  const [admins, recentAudit, currentSession, sections] = await Promise.all([
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
    // Academic overview: counts only, never the school's records.
    prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true }, select: { name: true, startDate: true, endDate: true } }),
    prisma.section.count({ where: { schoolId, academicSession: { isCurrent: true } } }),
  ]);

  return { school, admins, recentAudit, academic: { currentSession, sections } };
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
  /**
   * Approval only: the plan the school starts on, and — when the Super Admin
   * adjusted them — its optional modules. Without a plan, the one requested at
   * registration (or already assigned) stays.
   */
  approval: { planId?: string | null; modules?: readonly string[] | null } = {},
): Promise<TransitionOutcome> {
  assertRole(actor, "SUPER_ADMIN");
  const rule = TRANSITIONS[transition];
  const plan =
    transition === "approve" && approval.planId
      ? await prisma.plan.findFirst({ where: { id: approval.planId, status: "PUBLISHED" }, select: { id: true, name: true, optionalModules: true } })
      : null;
  if (transition === "approve" && approval.planId && !plan) throw new NotFoundError("That plan is not published. Choose a published plan.");

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
  type Approved = { plan: string | null; modules: string[]; customized: boolean };
  // Set inside the transaction on approval.
  const approval_: { value: Approved | null } = { value: null };

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

      if (plan) {
        // The plan chosen at approval: the latest subscription takes it, live.
        const latest = await tx.subscription.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" }, select: { id: true } });
        if (latest) await tx.subscription.update({ where: { id: latest.id }, data: { planId: plan.id, status: "ACTIVE" } });
        else await tx.subscription.create({ data: { schoolId, planId: plan.id, status: "ACTIVE", startsAt: new Date() } });
      } else {
        // A subscription requested at registration becomes live on approval.
        await tx.subscription.updateMany({
          where: { schoolId, status: "TRIALING" },
          data: { status: "ACTIVE" },
        });
      }

      // The school's optional modules: the plan's, or the adjusted set.
      const current = await tx.subscription.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" }, select: { plan: { select: { name: true, optionalModules: true } } } });
      const planModules = cleanModules(current?.plan.optionalModules ?? []);
      const modules = approval.modules ? cleanModules(approval.modules) : planModules;
      const customized = Boolean(approval.modules) && modules.join() !== planModules.join();
      await tx.school.update({ where: { id: schoolId }, data: { optionalModules: modules, modulesCustomized: customized } });
      // Roles follow the plan too, unless adjusted for this school.
      const planRoles = await tx.subscription.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" }, select: { plan: { select: { availableRoles: true } } } });
      const own = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { rolesCustomized: true, organizationId: true, name: true } });
      if (planRoles && !own.rolesCustomized) await tx.school.update({ where: { id: schoolId }, data: { enabledRoles: cleanRoles(planRoles.plan.availableRoles) } });
      // The approved school is the first campus of its organization; its first admin owns it.
      const firstAdmin = await tx.user.findFirst({ where: { schoolId, role: "SCHOOL_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!own.organizationId) {
        const organization = await tx.organization.create({ data: { name: own.name, ownerId: firstAdmin && !(await tx.organization.count({ where: { ownerId: firstAdmin.id } })) ? firstAdmin.id : null } });
        await tx.school.update({ where: { id: schoolId }, data: { organizationId: organization.id } });
      } else if (firstAdmin) {
        await tx.organization.updateMany({ where: { id: own.organizationId, ownerId: null }, data: { ownerId: firstAdmin.id } });
      }
      approval_.value = { plan: current?.plan.name ?? null, modules, customized };
    }
  });

  const approvedWith = approval_.value;

  // Suspension must take effect for people who are already signed in.
  if (transition === "suspend") await invalidateAllSessionsForSchool(schoolId);

  await recordAudit({
    action: rule.audit,
    entityType: "School",
    entityId: schoolId,
    schoolId,
    actorId: actor.id,
    summary: `${school.name} ${TRANSITION_VERB[transition]}${reason ? `: ${reason}` : "."}${
      approvedWith ? ` Plan: ${approvedWith.plan ?? "none"}. Modules: ${describeModules(approvedWith.modules)}${approvedWith.customized ? " (adjusted for this school)" : ""}.` : ""
    }`,
    metadata: { from: school.status, to: rule.to, ...(approvedWith ? { plan: approvedWith.plan, optionalModules: approvedWith.modules, modulesCustomized: approvedWith.customized } : {}) },
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
      activatedAt: new Date(),
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
  input: { schoolId: string; firstName: string; lastName: string; email: string; phone?: string | null },
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
        activatedAt: new Date(),
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
/**
 * Set the subscription. One plan per organization: the change is applied to
 * every campus of the school's organization (live, pending or suspended) in
 * one transaction — all campuses or none — so the owner's views, which read
 * the organization's plan, and each campus's own checks always agree. A
 * school without an organization is changed on its own.
 *
 * A new plan grants *eligibility*: no campus's switched-on modules change
 * (owners and admins switch newly eligible ones on; modules the new plan no
 * longer includes stay on until switched off). Roles the new plan adds are
 * offered to campuses that follow their plan's roles — additive only.
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
): Promise<{ campuses: number }> {
  assertRole(actor, "SUPER_ADMIN");

  const [school, plan] = await Promise.all([
    prisma.school.findUnique({ where: { id: input.schoolId }, select: { id: true, name: true, organizationId: true } }),
    // Never a draft: a plan nobody has published cannot carry customers.
    prisma.plan.findFirst({ where: { id: input.planId, status: { not: "DRAFT" } }, select: { id: true, name: true, status: true, optionalModules: true, availableRoles: true } }),
  ]);
  if (!school || !plan) throw new NotFoundError();
  // An archived plan carries the customers already on it (their dates and
  // status can still be updated) but takes nobody new.
  if (plan.status === "ARCHIVED") {
    const onIt = await prisma.subscription.findFirst({ where: { schoolId: school.id }, orderBy: { createdAt: "desc" }, select: { planId: true } });
    if (onIt?.planId !== plan.id) throw new ConflictError(`${plan.name} is archived. Choose a published plan, or restore ${plan.name} first.`);
  }

  if (input.endsAt && input.endsAt < input.startsAt) {
    throw new ConflictError("The end date must be after the start date.");
  }

  const campuses = school.organizationId
    ? await prisma.school.findMany({ where: { organizationId: school.organizationId, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } })
    : [];
  if (!campuses.some((campus) => campus.id === school.id)) campuses.push({ id: school.id, name: school.name });

  const data = { planId: plan.id, status: input.status, startsAt: input.startsAt, endsAt: input.endsAt, notes: input.notes };
  const eligible = cleanModules(plan.optionalModules);
  const planRoles = cleanRoles(plan.availableRoles);

  const changes = await prisma.$transaction(async (tx) => {
    const done: Array<{ id: string; name: string; previous: string | null; enabled: string[] }> = [];
    for (const campus of campuses) {
      const latest = await tx.subscription.findFirst({ where: { schoolId: campus.id }, orderBy: { createdAt: "desc" }, select: { id: true, plan: { select: { id: true, name: true } } } });
      if (latest) await tx.subscription.update({ where: { id: latest.id }, data });
      else await tx.subscription.create({ data: { ...data, schoolId: campus.id } });
      const current = await tx.school.findUniqueOrThrow({ where: { id: campus.id }, select: { optionalModules: true, enabledRoles: true, rolesCustomized: true } });
      if (latest?.plan.id !== plan.id && !current.rolesCustomized) {
        await tx.school.update({ where: { id: campus.id }, data: { enabledRoles: cleanRoles([...current.enabledRoles, ...planRoles]) } });
      }
      done.push({ id: campus.id, name: campus.name, previous: latest?.plan.id === plan.id ? plan.name : (latest?.plan.name ?? null), enabled: cleanModules(current.optionalModules) });
    }
    return done;
  });

  for (const campus of changes) {
    await recordAudit({
      action: "SUBSCRIPTION_UPDATED",
      entityType: "School",
      entityId: campus.id,
      schoolId: campus.id,
      actorId: actor.id,
      summary: `${campus.name} subscription set to ${plan.name} (${input.status.toLowerCase()})${changes.length > 1 ? `, with the organization's ${changes.length} campuses` : ""}.`,
    });
    if (campus.previous === plan.name) continue;
    const newlyEligible = eligible.filter((key) => !campus.enabled.includes(key));
    const kept = campus.enabled.filter((key) => !(eligible as string[]).includes(key));
    await recordAudit({
      action: "SCHOOL_PLAN_CHANGED",
      entityType: "School",
      entityId: campus.id,
      schoolId: campus.id,
      actorId: actor.id,
      summary: `${campus.name} plan changed: ${campus.previous ?? "none"} → ${plan.name}. Modules unchanged (${describeModules(campus.enabled)}).${newlyEligible.length ? ` Now eligible to switch on: ${describeModules(newlyEligible)}.` : ""}${kept.length ? ` Kept although not in the new plan: ${describeModules(kept)}.` : ""}`,
      metadata: { previous: { plan: campus.previous }, next: { plan: plan.name }, optionalModules: campus.enabled, newlyEligible, kept },
    });
  }
  return { campuses: changes.length };
}

// -----------------------------------------------------------------------------
// Feature access
// -----------------------------------------------------------------------------

/**
 * Set one school's optional modules. "Follow the plan" takes the current
 * plan's modules and keeps following it; otherwise the set chosen here is the
 * school's own, kept through later plan changes. Core modules are not
 * switchable and unknown keys are dropped, so nothing that does not exist can
 * be switched on. Only this school changes.
 */
export async function setSchoolModules(
  actor: SessionUser,
  input: { schoolId: string; followPlan: boolean; modules: readonly string[] },
): Promise<{ modules: string[] }> {
  assertRole(actor, "SUPER_ADMIN");
  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, name: true, optionalModules: true, modulesCustomized: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { plan: { select: { name: true, optionalModules: true } } } } },
  });
  if (!school) throw new NotFoundError();
  const plan = school.subscriptions[0]?.plan ?? null;
  if (input.followPlan && !plan) throw new ConflictError("This school has no plan yet. Choose its modules, or give it a plan first.");

  const before = cleanModules(school.optionalModules);
  const after = input.followPlan ? cleanModules(plan!.optionalModules) : cleanModules(input.modules);
  const customized = !input.followPlan;
  if (before.join() === after.join() && school.modulesCustomized === customized) return { modules: after };

  await prisma.school.update({ where: { id: school.id }, data: { optionalModules: after, modulesCustomized: customized } });
  const enabled = after.filter((key) => !before.includes(key));
  const disabled = before.filter((key) => !after.includes(key));
  await recordAudit({
    action: "SCHOOL_MODULES_CHANGED",
    entityType: "School",
    entityId: school.id,
    schoolId: school.id,
    actorId: actor.id,
    summary: `${school.name} modules ${input.followPlan ? `set to follow the ${plan!.name} plan` : "adjusted for this school"}.${enabled.length ? ` Enabled: ${describeModules(enabled)}.` : ""}${disabled.length ? ` Disabled: ${describeModules(disabled)}.` : ""}`,
    metadata: { previous: { optionalModules: before, customized: school.modulesCustomized }, next: { optionalModules: after, customized }, enabled, disabled },
  });
  return { modules: after };
}

/**
 * Set one school's roles and limits. "Follow the plan" takes the current
 * plan's roles; otherwise the ticked set is this school's own. Limits set here
 * override the plan's for this school only (blank = the plan's). Fixed system
 * roles only — nothing new can be created here.
 */
export async function setSchoolRolesAndLimits(
  actor: SessionUser,
  input: { schoolId: string; followPlan: boolean; roles: readonly string[]; limits: Limits },
): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, name: true, enabledRoles: true, rolesCustomized: true, roleLimits: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { plan: { select: { name: true, availableRoles: true } } } } },
  });
  if (!school) throw new NotFoundError();
  const plan = school.subscriptions[0]?.plan ?? null;
  if (input.followPlan && !plan) throw new ConflictError("This school has no plan yet. Choose its roles, or give it a plan first.");
  const before = cleanRoles(school.enabledRoles);
  const after = input.followPlan ? cleanRoles(plan!.availableRoles) : cleanRoles(input.roles);
  const limitsBefore = cleanLimits(school.roleLimits);
  const limits = cleanLimits(input.limits);
  await prisma.school.update({ where: { id: school.id }, data: { enabledRoles: after, rolesCustomized: !input.followPlan, roleLimits: Object.keys(limits).length ? limits : Prisma.DbNull } });
  if (before.join() !== after.join() || school.rolesCustomized === input.followPlan) {
    const enabled = after.filter((key) => !before.includes(key));
    const disabled = before.filter((key) => !after.includes(key));
    await recordAudit({
      action: "SCHOOL_ROLES_CHANGED",
      entityType: "School",
      entityId: school.id,
      schoolId: school.id,
      actorId: actor.id,
      summary: `${school.name} roles ${input.followPlan ? `set to follow the ${plan!.name} plan` : "adjusted for this school"}.${enabled.length ? ` Enabled: ${enabled.map(roleLabel).join(", ")}.` : ""}${disabled.length ? ` Disabled: ${disabled.map(roleLabel).join(", ")}.` : ""}`,
      metadata: { previous: before, next: after, enabled, disabled },
    });
  }
  if (JSON.stringify(limitsBefore) !== JSON.stringify(limits)) {
    await recordAudit({
      action: "SCHOOL_LIMITS_CHANGED",
      entityType: "School",
      entityId: school.id,
      schoolId: school.id,
      actorId: actor.id,
      summary: `${school.name} limits: ${describeLimits(limits)} (blank ones follow the plan).`,
      metadata: { previous: limitsBefore, next: limits },
    });
  }
}

/** Plans a Super Admin can put a school on: published (open or closed to new sign-ups), never drafts or archived. */
export async function listPlansForSelect() {
  return prisma.plan.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ displayOrder: "asc" }, { priceMinor: "asc" }],
    select: { id: true, name: true, isActive: true, tier: true, optionalModules: true },
  });
}

/**
 * Super Admin: correct a school's (campus's) name. The id and every record
 * stay as they are; the new name shows wherever the campus is shown, and a
 * single-campus organization named after it follows.
 */
export async function renameSchool(actor: SessionUser, schoolId: string, name: string): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  const next = name.trim();
  if (next.length < 2 || next.length > 150) throw new ConflictError("Enter a school name between 2 and 150 characters.");
  const school = await prisma.school.findFirst({ where: { id: schoolId, isDemo: false }, select: { id: true, name: true } });
  if (!school) throw new NotFoundError();
  if (school.name === next) return;
  await prisma.school.update({ where: { id: school.id }, data: { name: next } });
  await syncOrganizationName(school.id, school.name, next);
  await recordAudit({ action: "SCHOOL_UPDATED", entityType: "School", entityId: school.id, schoolId: school.id, actorId: actor.id, summary: `School renamed: ${school.name} → ${next}.`, metadata: { previous: school.name, next } });
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

/** Schools waiting for a decision, oldest first, with what was submitted. */
export async function listPendingSchools(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.school.findMany({
    where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, isDemo: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      udiseCode: true,
      city: true,
      state: true,
      status: true,
      createdAt: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      contactEmailVerifiedAt: true,
      affiliationBoard: true,
      principalName: true,
      users: { where: { role: "SCHOOL_ADMIN" }, take: 1, select: { firstName: true, lastName: true } },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { plan: { select: { name: true } } } },
    },
  });
}
