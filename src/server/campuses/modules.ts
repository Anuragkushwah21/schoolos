import "server-only";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type OptionalModule, OPTIONAL_MODULE_KEYS, cleanModules, moduleLabel } from "@/lib/school-modules";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { ensureOrganization } from "@/server/platform/campuses";
import { organizationEntitlements } from "@/server/platform/entitlements";

/**
 * Which eligible modules each campus has switched on. The organization's plan
 * decides what is *eligible*; the owner (any campus of the organization) or
 * a School Admin (their own campus) decides what is *on*. An upgrade never
 * switches a module on by itself, and a module the plan no longer includes
 * stays on (grandfathered) until someone switches it off — it can then not be
 * switched back on without the plan.
 */

const LIVE = ["ACTIVE", "SUSPENDED"] as const;

async function scope(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const homeId = ctx.user.homeSchoolId ?? ctx.schoolId;
  const organizationId = await ensureOrganization(homeId);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ownerId: true } });
  return { organizationId, homeId, isOwner: organization.ownerId === ctx.user.id };
}

/** The campuses this person may configure, with enabled, eligible and grandfathered modules. */
export async function campusModulesOverview(ctx: TenantContext) {
  const { organizationId, homeId, isOwner } = await scope(ctx);
  const [entitlements, campuses] = await Promise.all([
    organizationEntitlements(organizationId),
    prisma.school.findMany({ where: { organizationId, status: { in: [...LIVE] }, ...(isOwner ? {} : { id: { in: [homeId, ctx.schoolId] } }) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, city: true, optionalModules: true } }),
  ]);
  // Modules the plan does not include, with the published plans that do.
  const missing = OPTIONAL_MODULE_KEYS.filter((key) => !entitlements.eligibleModules.includes(key));
  const offering = missing.length ? await prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true }, orderBy: { displayOrder: "asc" }, select: { name: true, optionalModules: true } }) : [];
  return {
    isOwner,
    planName: entitlements.planName,
    eligible: entitlements.eligibleModules,
    notInPlan: missing.map((key) => ({ key, label: moduleLabel(key), plans: offering.filter((plan) => plan.optionalModules.includes(key)).map((plan) => plan.name) })),
    campuses: campuses.map((campus) => {
      const enabled = cleanModules(campus.optionalModules);
      return {
        ...campus,
        enabled,
        /** In the plan but not switched on here — the owner or admin may switch them on. */
        available: entitlements.eligibleModules.filter((key) => !enabled.includes(key)),
        /** Switched on but no longer in the plan — kept until switched off. */
        grandfathered: enabled.filter((key) => !entitlements.eligibleModules.includes(key)),
      };
    }),
  };
}

/**
 * Set one campus's switched-on modules. Adding needs plan eligibility;
 * removing is always allowed. Checked on the server against the session's
 * organization — a campus id from another organization is refused.
 */
export async function setCampusModules(ctx: TenantContext, schoolId: string, wanted: readonly string[]) {
  const { organizationId, homeId, isOwner } = await scope(ctx);
  const campus = await prisma.school.findFirst({ where: { id: schoolId, organizationId, status: { in: [...LIVE] } }, select: { id: true, name: true, optionalModules: true } });
  if (!campus) throw new NotFoundError();
  if (!isOwner && campus.id !== homeId && campus.id !== ctx.schoolId) throw new ForbiddenError("Only the owner can change another campus's modules.");

  const entitlements = await organizationEntitlements(organizationId);
  const current = cleanModules(campus.optionalModules);
  const next = cleanModules(wanted);
  const added = next.filter((key) => !current.includes(key));
  const removed = current.filter((key) => !next.includes(key));
  const notEligible = added.filter((key) => !entitlements.eligibleModules.includes(key));
  if (notEligible.length) {
    const plans = await prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true, optionalModules: { hasEvery: notEligible } }, orderBy: { displayOrder: "asc" }, select: { name: true } });
    throw new ForbiddenError(`${notEligible.map(moduleLabel).join(", ")} ${notEligible.length === 1 ? "is" : "are"} not part of your ${entitlements.planName ?? ""} plan.${plans.length ? ` Available with ${plans.map((plan) => plan.name).join(" and ")} — request an upgrade from Plan & billing.` : ""}`.replace("  ", " "));
  }
  if (!added.length && !removed.length) return { added, removed };

  await prisma.school.update({ where: { id: campus.id }, data: { optionalModules: OPTIONAL_MODULE_KEYS.filter((key) => next.includes(key)) as OptionalModule[], modulesCustomized: true } });
  await recordAudit({
    action: "CAMPUS_MODULES_CHANGED",
    entityType: "School",
    entityId: campus.id,
    schoolId: campus.id,
    actorId: ctx.user.id,
    summary: `${campus.name} modules: ${added.length ? `switched on ${added.map(moduleLabel).join(", ")}` : ""}${added.length && removed.length ? "; " : ""}${removed.length ? `switched off ${removed.map(moduleLabel).join(", ")}` : ""}.`,
    metadata: { added, removed, before: current, after: next },
  });
  return { added, removed };
}
