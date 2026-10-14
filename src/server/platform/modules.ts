import "server-only";

import { cache } from "react";

import { ForbiddenError } from "@/lib/errors";
import { type OptionalModule, cleanModules, moduleLabel, moduleOfGrant } from "@/lib/school-modules";
import { prisma } from "@/server/db/prisma";
import { moduleStatus } from "@/server/platform/entitlements";

/**
 * The optional modules a school has (see `lib/school-modules.ts`), enforced on
 * the server: staff grants in a module the school lacks are dropped
 * (`server/auth/staff-access.ts`), the School Admin's module services refuse
 * (`assertModuleEnabled`), and the module's pages show "not in your plan".
 * Read from the database once per request, so a change by the Super Admin
 * takes effect on the next request.
 */
export const schoolModules = cache(async (schoolId: string): Promise<OptionalModule[]> => {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { optionalModules: true } });
  return cleanModules(school?.optionalModules ?? []);
});

export async function hasModule(ctx: { schoolId: string }, module: OptionalModule): Promise<boolean> {
  return (await schoolModules(ctx.schoolId)).includes(module);
}

/**
 * Refuse when the school does not have this module — for every role, the
 * School Admin included. The message says which of the two it is: in the
 * plan but switched off for this campus (the School Admin can switch it on),
 * or not in the plan at all.
 */
export async function assertModuleEnabled(ctx: { schoolId: string }, module: OptionalModule): Promise<void> {
  if (await hasModule(ctx, module)) return;
  const status = await moduleStatus(ctx.schoolId, module);
  if (status.reason === "NOT_ENABLED_FOR_CAMPUS") {
    throw new ForbiddenError(`${moduleLabel(module)} is in your plan but switched off for this campus. A School Admin can switch it on in Plan & billing.`);
  }
  throw new ForbiddenError(`${moduleLabel(module)} is not part of your school's plan. Ask SchoolOS to switch it on.`);
}

/** Grants whose module the school has (grants outside optional modules always pass). */
export async function grantsInPlan<T extends string>(schoolId: string, grants: readonly T[]): Promise<T[]> {
  const enabled = await schoolModules(schoolId);
  return grants.filter((grant) => {
    const owner = moduleOfGrant(grant);
    return owner === null || enabled.includes(owner);
  });
}
