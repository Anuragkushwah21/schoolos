import "server-only";

import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { cleanModules, moduleLabel } from "@/lib/school-modules";
import { type Limits, cleanLimits, cleanRoles, describeLimits, roleLabel } from "@/lib/school-roles";

/**
 * The plan catalogue. Tiers are fixed (one row per `PlanTier`); the Super Admin
 * edits names, prices and limits. Deactivating a plan hides it from the
 * homepage and registration without touching schools already on it.
 */

export async function listPlans(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.plan.findMany({
    orderBy: { priceMinor: "asc" },
    include: {
      _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING"] } } } } },
    },
  });
}

export async function updatePlan(
  actor: SessionUser,
  planId: string,
  input: {
    name: string;
    description: string | null;
    priceMinor: number;
    maxStudents: number | null;
    maxTeachers: number | null;
    maxAdmins: number | null;
    storageMb: number | null;
    isActive: boolean;
    /** Optional modules the plan includes; unknown keys are dropped. */
    optionalModules?: readonly string[];
    /** Campuses one organization may run on this plan (1 = multi-campus off). */
    campusLimit?: number;
    /** Optional roles the plan includes; unknown keys are dropped. */
    availableRoles?: readonly string[];
    /** Per-role/user limits; a missing key is unlimited. */
    roleLimits?: Limits;
  },
): Promise<{ schoolsUpdated: number }> {
  assertRole(actor, "SUPER_ADMIN");
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, optionalModules: true, availableRoles: true, roleLimits: true, campusLimit: true } });
  if (!plan) throw new NotFoundError();

  const before = cleanModules(plan.optionalModules);
  const modules = input.optionalModules ? cleanModules(input.optionalModules) : before;
  const rolesBefore = cleanRoles(plan.availableRoles);
  const roles = input.availableRoles ? cleanRoles(input.availableRoles) : rolesBefore;
  const limitsBefore = cleanLimits(plan.roleLimits);
  const limits = input.roleLimits ? cleanLimits(input.roleLimits) : limitsBefore;
  const campusLimit = input.campusLimit ?? plan.campusLimit;
  const { optionalModules: _m, availableRoles: _r, roleLimits: _l, campusLimit: _c, ...fields } = input;
  void _m;
  void _r;
  void _l;
  void _c;
  await prisma.plan.update({ where: { id: planId }, data: { ...fields, optionalModules: modules, availableRoles: roles, roleLimits: limits, campusLimit } });
  const rolesChanged = rolesBefore.join() !== roles.join();
  if (rolesChanged) {
    const followers = await planFollowers(planId, "roles");
    if (followers.length) await prisma.school.updateMany({ where: { id: { in: followers } }, data: { enabledRoles: roles } });
  }

  // Schools that follow this plan (not adjusted by hand) follow its modules.
  let schoolsUpdated = 0;
  const changed = before.join() !== modules.join();
  if (changed) {
    const followers = await planFollowers(planId, "modules");
    if (followers.length) {
      ({ count: schoolsUpdated } = await prisma.school.updateMany({ where: { id: { in: followers } }, data: { optionalModules: modules } }));
    }
  }
  await recordAudit({
    action: "PLAN_UPDATED",
    entityType: "Plan",
    entityId: planId,
    actorId: actor.id,
    summary: `Plan "${input.name}" updated.${changed ? ` Modules: ${describeModules(before)} → ${describeModules(modules)}${schoolsUpdated ? ` (${schoolsUpdated} school${schoolsUpdated === 1 ? "" : "s"} following the plan updated)` : ""}.` : ""}${rolesChanged ? ` Roles: ${roles.map(roleLabel).join(", ") || "core only"}.` : ""}${campusLimit !== plan.campusLimit ? ` Campus limit: ${plan.campusLimit} → ${campusLimit}.` : ""}${JSON.stringify(limits) !== JSON.stringify(limitsBefore) ? ` Limits: ${describeLimits(limits)}.` : ""}`,
    metadata: { previous: { optionalModules: before, availableRoles: rolesBefore, roleLimits: limitsBefore, campusLimit: plan.campusLimit }, next: { optionalModules: modules, availableRoles: roles, roleLimits: limits, campusLimit }, schoolsUpdated },
  });
  return { schoolsUpdated };
}

/** Schools whose current plan is this one and whose modules were never adjusted by hand. */
async function planFollowers(planId: string, what: "modules" | "roles"): Promise<string[]> {
  const schools = await prisma.school.findMany({
    where: { ...(what === "modules" ? { modulesCustomized: false } : { rolesCustomized: false }), subscriptions: { some: { planId } } },
    select: { id: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { planId: true } } },
  });
  return schools.filter((school) => school.subscriptions[0]?.planId === planId).map((school) => school.id);
}

export function describeModules(modules: readonly string[]): string {
  return modules.length ? modules.map(moduleLabel).join(", ") : "core only";
}
