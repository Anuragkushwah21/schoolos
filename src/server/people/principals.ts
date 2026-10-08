import "server-only";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertRoleAvailable, assertWithinLimit } from "@/server/platform/entitlements";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { type LoginInvite, provisionAccount, sendActivation } from "@/server/auth/account-links";
import type { TenantContext } from "@/server/auth/current-user";
import { invalidateAllSessionsForUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { recentResponsibilities, responsibilityCounts } from "@/server/responsibilities/service";

/**
 * The school's Principal logins. The School Admin decides who has one: the
 * login is created waiting for activation and the Principal chooses their
 * own password from the emailed link — no password is ever set or shown
 * here. Closing a login signs them out everywhere at once.
 */

export async function listPrincipals(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.user.findMany({
    where: { role: "PRINCIPAL" },
    orderBy: { createdAt: "asc" },
    select: { id: true, firstName: true, lastName: true, email: true, isActive: true, activatedAt: true, lastLoginAt: true },
  });
}

export async function createPrincipal(ctx: TenantContext, input: { firstName: string; lastName: string; email: string; phone: string | null }): Promise<LoginInvite> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertRoleAvailable(ctx, "PRINCIPAL");
  await assertWithinLimit(ctx, "PRINCIPAL");
  const email = input.email.toLowerCase();
  if (await prisma.user.count({ where: { email } })) throw new ConflictError(`${email} already has a SchoolOS login. Use another email.`);
  const userId = await provisionAccount(ctx.db, { schoolId: ctx.schoolId, email, role: "PRINCIPAL", firstName: input.firstName, lastName: input.lastName, phone: input.phone });
  await recordAudit({
    action: "PRINCIPAL_CREATED",
    entityType: "User",
    entityId: userId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Principal login created for ${input.firstName} ${input.lastName} (${email}); activation email sent.`,
  });
  return { ...(await sendActivation(userId, ctx.user.id)), label: `Principal login for ${input.firstName}` };
}

export async function setPrincipalActive(ctx: TenantContext, userId: string, isActive: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: "PRINCIPAL" }, select: { id: true, email: true, isActive: true } });
  if (!user) throw new NotFoundError("That Principal login was not found.");
  if (isActive && !user.isActive) {
    await assertRoleAvailable(ctx, "PRINCIPAL");
    await assertWithinLimit(ctx, "PRINCIPAL");
  }
  await ctx.db.user.updateMany({ where: { id: user.id }, data: { isActive } });
  if (!isActive) await invalidateAllSessionsForUser(user.id);
  await recordAudit({
    action: isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
    entityType: "User",
    entityId: user.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Principal login ${user.email} ${isActive ? "reopened" : "closed"}.`,
  });
}

/**
 * The School Admin's view of the Principal: who holds the login, the
 * responsibilities given to them and the ones they gave out, and their recent
 * key actions from the audit log. With no Principal, `principals` is empty and
 * the School Admin carries the Principal's work.
 */
export async function principalWorkspace(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const principals = await ctx.db.user.findMany({
    where: { role: "PRINCIPAL" },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, isActive: true, activatedAt: true, lastLoginAt: true, createdAt: true },
  });
  const ids = principals.map((principal) => principal.id);
  if (!ids.length) return { principals, held: null, delegated: null, heldRows: [], delegatedRows: [], activity: [] };
  const [held, delegated, heldRows, delegatedRows, activity] = await Promise.all([
    responsibilityCounts(ctx, { assignedToId: { in: ids } }),
    responsibilityCounts(ctx, { assignedById: { in: ids } }),
    recentResponsibilities(ctx, { assignedToId: { in: ids } }),
    recentResponsibilities(ctx, { assignedById: { in: ids } }),
    prisma.auditLog.findMany({
      where: { schoolId: ctx.schoolId, actorId: { in: ids }, action: { notIn: ["USER_LOGIN", "USER_LOGOUT"] } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, action: true, module: true, summary: true, createdAt: true },
    }),
  ]);
  return { principals, held, delegated, heldRows, delegatedRows, activity };
}
