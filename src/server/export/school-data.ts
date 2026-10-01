import "server-only";

import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { TENANT_MODELS } from "@/server/tenancy/scope";

/**
 * Everything the school owns, as one JSON file — for the school's own records
 * and for moving or recovering its data.
 *
 * Built from the tenant model list, so a model added later is exported without
 * anyone remembering to add it here. Each table is read through `ctx.db`,
 * which is scoped to the caller's school: another school's rows cannot be in
 * the file. Credentials never are: logins are exported without their password
 * hash, and API tokens, sessions and email codes are left out entirely.
 */

/** Tables that hold secrets or are not the school's records. */
const LEFT_OUT = new Set(["ApiToken", "Subscription"]);

/** Login fields that are safe to hand over. */
const USER_FIELDS = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  preferredLanguage: true,
  disabledReason: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

export async function exportSchoolData(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: ctx.schoolId },
    // The school's own profile, without platform-internal fields.
    omit: { setupSkipped: true },
  });

  const tables: Record<string, unknown[]> = {};
  const db = ctx.db as unknown as Record<string, { findMany: (args?: unknown) => Promise<unknown[]> }>;
  for (const model of [...TENANT_MODELS].sort()) {
    if (LEFT_OUT.has(model)) continue;
    const delegate = db[lowerFirst(model)];
    if (!delegate) continue;
    tables[model] = await delegate.findMany(model === "User" ? { select: USER_FIELDS } : undefined);
  }

  await recordAudit({
    action: "SCHOOL_DATA_EXPORTED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Full school data exported.",
    metadata: { tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) },
  });

  return {
    format: "schoolos-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    school,
    tables,
  };
}
