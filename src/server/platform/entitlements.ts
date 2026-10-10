import "server-only";

import { cache } from "react";

import { AppError, ForbiddenError } from "@/lib/errors";
import { type PlanFeature, campusPolicy, cleanFeatures, featureLabel } from "@/lib/plan-catalog";
import { cleanModules, type OptionalModule } from "@/lib/school-modules";
import { type LimitKey, type Limits, type OptionalRole, OPTIONAL_ROLE_KEYS, cleanLimits, cleanRoles, limitLabel, roleLabel } from "@/lib/school-roles";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { prisma } from "@/server/db/prisma";

/**
 * What one campus may use — modules, roles and limits — read from its plan
 * and the Super Admin's adjustments for that campus, enforced on the server:
 *
 *   * a role the campus does not have cannot be given to anyone
 *     (`assertRoleAvailable`), whoever asks — the School Admin included;
 *   * at a limit, creating one more is refused with the limit in the message
 *     (`assertWithinLimit`), never silently.
 *
 * A campus with no live subscription is limited only by its own overrides —
 * billing is out of V1, and a missing record must not stop a school working.
 */

const LIVE = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

export const currentPlanOf = cache(async (schoolId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { schoolId, status: { in: [...LIVE] } },
    orderBy: { createdAt: "desc" },
    select: { plan: { select: { id: true, name: true, maxStudents: true, maxTeachers: true, roleLimits: true, availableRoles: true, optionalModules: true, campusLimit: true, features: true, extraCampusAllowed: true, extraCampusPriceMinor: true, extraCampusPeriod: true, maxCampuses: true, priceMinor: true, priceOnRequest: true, billingPeriod: true } } },
  });
  return subscription?.plan ?? null;
});

/** A plan's limits as one map (its student/teacher columns included). */
export function planLimits(plan: { maxStudents: number | null; maxTeachers: number | null; roleLimits: unknown }): Limits {
  return {
    ...cleanLimits(plan.roleLimits),
    ...(plan.maxStudents !== null ? { STUDENTS: plan.maxStudents } : {}),
    ...(plan.maxTeachers !== null ? { TEACHERS: plan.maxTeachers } : {}),
  };
}

export const schoolEntitlements = cache(async (schoolId: string) => {
  const [school, plan] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { optionalModules: true, enabledRoles: true, roleLimits: true } }),
    currentPlanOf(schoolId),
  ]);
  const limits: Limits = { ...(plan ? planLimits(plan) : {}), ...cleanLimits(school?.roleLimits) };
  return {
    planName: plan?.name ?? null,
    modules: cleanModules(school?.optionalModules ?? []) as OptionalModule[],
    roles: cleanRoles(school?.enabledRoles ?? OPTIONAL_ROLE_KEYS) as OptionalRole[],
    limits,
  };
});

export async function hasRole(schoolId: string, role: OptionalRole): Promise<boolean> {
  return (await schoolEntitlements(schoolId)).roles.includes(role);
}

/** Refuse a role this campus does not have — the School Admin cannot switch it on. */
export async function assertRoleAvailable(ctx: { schoolId: string }, role: OptionalRole): Promise<void> {
  if (!(await hasRole(ctx.schoolId, role))) {
    throw new ForbiddenError(`The ${roleLabel(role)} role is not part of your school's plan. Ask SchoolOS to switch it on.`);
  }
}

async function countFor(schoolId: string, key: LimitKey): Promise<number> {
  switch (key) {
    case "STUDENTS":
      return prisma.student.count({ where: { schoolId, status: "ACTIVE" } });
    case "TEACHERS":
      return prisma.teacher.count({ where: { schoolId, status: { in: ["ACTIVE", "ON_LEAVE"] } } });
    case "STAFF":
      return prisma.staffMember.count({ where: { schoolId, status: { in: [...CURRENT_EMPLOYEE] } } });
    case "PRINCIPAL":
      return prisma.user.count({ where: { schoolId, role: "PRINCIPAL", isActive: true } });
    default:
      return prisma.staffMember.count({ where: { schoolId, role: key, status: { in: [...CURRENT_EMPLOYEE] } } });
  }
}

/** How many more of `key` this campus may add, or null for no limit. */
export async function remainingCapacity(schoolId: string, key: LimitKey): Promise<{ limit: number; used: number; remaining: number; plan: string | null } | null> {
  const { limits, planName } = await schoolEntitlements(schoolId);
  const limit = limits[key];
  if (limit === undefined) return null;
  const used = await countFor(schoolId, key);
  return { limit, used, remaining: Math.max(limit - used, 0), plan: planName };
}

/** Refuse adding `adding` more of `key` past the campus limit, saying what the limit is. */
export async function assertWithinLimit(ctx: { schoolId: string }, key: LimitKey, adding = 1): Promise<void> {
  const capacity = await remainingCapacity(ctx.schoolId, key);
  if (!capacity || capacity.remaining >= adding) return;
  throw new AppError(
    "CONFLICT",
    `Your ${capacity.plan ? `${capacity.plan} plan` : "school"} allows up to ${capacity.limit} ${limitLabel(key).toLowerCase()} (${capacity.used} in use). Contact SchoolOS to raise the limit.`,
  );
}

// -----------------------------------------------------------------------------
// Organization level: one plan for the owner's organization
// -----------------------------------------------------------------------------

/**
 * The organization's plan is the plan of its first live campus (each campus
 * carries a subscription row on the same plan — a plan change is applied to
 * all of them together, see `approvePlanChange`).
 */
export const organizationPlanOf = cache(async (organizationId: string) => {
  const primary = await prisma.school.findFirst({ where: { organizationId, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return primary ? currentPlanOf(primary.id) : null;
});

/**
 * Everything one organization may use, kept apart so a refusal can say why:
 * the plan (`plan`), which modules it makes eligible (`eligibleModules`),
 * which organization-level features it includes (`features`), and its
 * campus allowance. What each campus has switched on is per campus
 * (`campusModules`).
 */
export const organizationEntitlements = cache(async (organizationId: string) => {
  const [plan, organization, campuses] = await Promise.all([
    organizationPlanOf(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { campusLimitOverride: true } }),
    prisma.school.count({ where: { organizationId, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] } } }),
  ]);
  const policy = campusPolicy(plan ?? { campusLimit: 1, extraCampusAllowed: false, extraCampusPriceMinor: null, extraCampusPeriod: "YEARLY", maxCampuses: null }, organization?.campusLimitOverride ?? null);
  const features = cleanFeatures(plan?.features ?? []);
  // An organization the Super Admin has allowed several campuses manages
  // them from the organization dashboard, whatever its plan says.
  if ((organization?.campusLimitOverride ?? 0) > 1 && !features.includes("ORG_DASHBOARD")) features.push("ORG_DASHBOARD");
  return {
    planId: plan?.id ?? null,
    planName: plan?.name ?? null,
    eligibleModules: cleanModules(plan?.optionalModules ?? []),
    features,
    campuses,
    ...policy,
    canAddCampus: policy.cap === null || campuses < policy.cap,
  };
});

export async function hasPlanFeature(organizationId: string, feature: PlanFeature): Promise<boolean> {
  return (await organizationEntitlements(organizationId)).features.includes(feature);
}

/** Refuse an organization-level feature the plan does not include, naming the plans that do. */
export async function assertPlanFeature(organizationId: string, feature: PlanFeature): Promise<void> {
  if (await hasPlanFeature(organizationId, feature)) return;
  const plans = await prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true, features: { has: feature } }, orderBy: { displayOrder: "asc" }, select: { name: true } });
  throw new ForbiddenError(`${featureLabel(feature)} is not part of your plan.${plans.length ? ` It comes with ${plans.map((plan) => plan.name).join(" and ")}.` : ""}`);
}

/**
 * Why a module is or is not available on one campus — for an honest message
 * instead of an unexplained refusal. Role permissions are checked separately
 * (`assertCan`), demo restrictions by `assertNotDemo`.
 */
export async function moduleStatus(schoolId: string, module: OptionalModule): Promise<{ enabled: boolean; eligible: boolean; reason: "ENABLED" | "NOT_ENABLED_FOR_CAMPUS" | "NOT_IN_PLAN" | "NO_SUBSCRIPTION" }> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { optionalModules: true, organizationId: true } });
  const enabled = cleanModules(school?.optionalModules ?? []).includes(module);
  const plan = school?.organizationId ? await organizationPlanOf(school.organizationId) : await currentPlanOf(schoolId);
  const eligible = cleanModules(plan?.optionalModules ?? []).includes(module);
  if (enabled) return { enabled, eligible, reason: "ENABLED" };
  if (!plan) return { enabled, eligible, reason: "NO_SUBSCRIPTION" };
  return { enabled, eligible, reason: eligible ? "NOT_ENABLED_FOR_CAMPUS" : "NOT_IN_PLAN" };
}

/**
 * Modules this campus's plan includes but the campus has not switched on —
 * shown as "available to switch on" (sidebar badge, dashboard notice, Plan &
 * billing), never switched on by themselves.
 */
export async function modulesAvailableToEnable(schoolId: string): Promise<{ planName: string | null; modules: OptionalModule[] }> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { optionalModules: true, organizationId: true } });
  if (!school) return { planName: null, modules: [] };
  const plan = school.organizationId ? await organizationPlanOf(school.organizationId) : await currentPlanOf(schoolId);
  const enabled = cleanModules(school.optionalModules);
  return { planName: plan?.name ?? null, modules: cleanModules(plan?.optionalModules ?? []).filter((key) => !enabled.includes(key)) };
}
