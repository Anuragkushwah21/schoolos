import "server-only";

import { cache } from "react";

import { AppError, ForbiddenError } from "@/lib/errors";
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
    select: { plan: { select: { id: true, name: true, maxStudents: true, maxTeachers: true, roleLimits: true, availableRoles: true, optionalModules: true, campusLimit: true } } },
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
