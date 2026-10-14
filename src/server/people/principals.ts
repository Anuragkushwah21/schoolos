import "server-only";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
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

// -----------------------------------------------------------------------------
// The Principal's employment record
// -----------------------------------------------------------------------------

export type PrincipalProfileInput = {
  employeeId: string | null;
  designation: string | null;
  qualification: string | null;
  experience: string | null;
  appointmentDate: Date | null;
  joiningDate: Date | null;
  exitDate: Date | null;
  dateOfBirth: Date | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

/** One Principal: their login and their employment record (null until the School Admin first saves it). School Admin only. */
export async function getPrincipal(ctx: TenantContext, userId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: "PRINCIPAL" }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, isActive: true, activatedAt: true, lastLoginAt: true, createdAt: true } });
  if (!user) throw new NotFoundError("That Principal was not found.");
  const profile = await ctx.db.principalProfile.findFirst({ where: { userId } });
  return { user, profile };
}

/** The login behind a Principal's employment record — for links from a document back to the profile. */
export async function principalUserIdFor(ctx: TenantContext, profileIds: readonly string[]): Promise<Map<string, string>> {
  if (!profileIds.length) return new Map();
  const rows = await ctx.db.principalProfile.findMany({ where: { id: { in: [...new Set(profileIds)] } }, select: { id: true, userId: true } });
  return new Map(rows.map((row) => [row.id, row.userId]));
}

/** Create or update the Principal's employment record. Dates and IDs are the School Admin's to enter — never filled in by the system. */
export async function savePrincipalProfile(ctx: TenantContext, userId: string, input: PrincipalProfileInput): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: "PRINCIPAL" }, select: { id: true, firstName: true, lastName: true } });
  if (!user) throw new NotFoundError("That Principal was not found.");
  if (input.joiningDate && input.exitDate && input.exitDate < input.joiningDate) throw new ConflictError("The last working day is before the joining date.");
  if (input.employeeId) {
    const clash = await ctx.db.principalProfile.findFirst({ where: { employeeId: input.employeeId, userId: { not: userId } }, select: { id: true } });
    const elsewhere = (await ctx.db.teacher.count({ where: { employeeId: input.employeeId } })) + (await ctx.db.staffMember.count({ where: { employeeId: input.employeeId } }));
    if (clash || elsewhere) throw new ConflictError(`Employee ID ${input.employeeId} is already used in this school.`);
  }
  const data = { ...input, designation: input.designation || "Principal" };
  const existing = await ctx.db.principalProfile.findFirst({ where: { userId }, select: { id: true } });
  const row = existing ? await ctx.db.principalProfile.update({ where: { id: existing.id }, data, select: { id: true } }) : await ctx.db.principalProfile.create({ data: { ...data, schoolId: ctx.schoolId, userId }, select: { id: true } });
  await recordAudit({ action: "PRINCIPAL_PROFILE_SAVED", entityType: "PrincipalProfile", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Employment record saved for ${fullName(user)} (Principal).` });
  return row;
}
