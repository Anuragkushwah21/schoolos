import "server-only";

import { cache } from "react";

import { ForbiddenError } from "@/lib/errors";
import { type OptionalModule, cleanModules, moduleLabel, moduleOfGrant } from "@/lib/school-modules";
import { prisma } from "@/server/db/prisma";

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

/** Refuse when the school does not have this module — for every role, the School Admin included. */
export async function assertModuleEnabled(ctx: { schoolId: string }, module: OptionalModule): Promise<void> {
  if (!(await hasModule(ctx, module))) {
    throw new ForbiddenError(`${moduleLabel(module)} is not part of your school's plan. Ask SchoolOS to switch it on.`);
  }
}

/** Grants whose module the school has (grants outside optional modules always pass). */
export async function grantsInPlan<T extends string>(schoolId: string, grants: readonly T[]): Promise<T[]> {
  const enabled = await schoolModules(schoolId);
  return grants.filter((grant) => {
    const owner = moduleOfGrant(grant);
    return owner === null || enabled.includes(owner);
  });
}
