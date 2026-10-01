import "server-only";

import type { UserRole } from "@/generated/prisma/enums";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { type LoginInvite, provisionAccount, resendAccountEmail, sendActivation } from "@/server/auth/account-links";
import { prisma } from "@/server/db/prisma";
import { invalidateAllSessionsForUser } from "@/server/auth/session";

/**
 * Portal accounts for people in a school — teachers, students, guardians and
 * non-teaching staff.
 *
 * The School Admin issues them; the role is always set here from the kind of
 * record being linked, never taken from the request. The person activates the
 * account from an email and chooses their own password; nobody else ever
 * sees it (see `server/auth/account-links.ts`).
 */

/** Logins the School Admin issues and manages. Never an administrator. */
const PORTAL_ROLES: UserRole[] = ["TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"];

/**
 * Create a login waiting for activation; the caller links it to the person
 * and then calls `sendActivation`. No password is set or shown.
 */
export async function createPortalUser(
  ctx: TenantContext,
  input: { email: string; role: Exclude<UserRole, "SUPER_ADMIN" | "SCHOOL_ADMIN">; firstName: string; lastName: string; phone?: string | null },
): Promise<{ userId: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return { userId: await provisionAccount(ctx.db, { ...input, schoolId: ctx.schoolId }) };
}

/**
 * The office's "send login email": a fresh activation link for an account not
 * yet activated, a password-reset link for an active one. The office never
 * sees or sets a password.
 */
export async function resetPortalPassword(ctx: TenantContext, userId: string): Promise<LoginInvite> {
  const result = await resendAccountEmail(ctx, userId);
  return { email: result.email, delivered: result.delivered, error: result.error, label: result.kind === "ACTIVATION" ? "Activation email" : "Password reset email" };
}

/** Enable or disable a portal login, signing it out when disabled. */
export async function setPortalUserActive(
  ctx: TenantContext,
  userId: string,
  isActive: boolean,
): Promise<void> {
  // Asserted here rather than left to the caller. Today the only callers are
  // the admin's own update paths, but a login is exactly the kind of switch a
  // future caller would reach for, and the check must not depend on which
  // function got there first.
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const { count } = await ctx.db.user.updateMany({
    where: { id: userId, role: { in: PORTAL_ROLES } },
    data: isActive ? { isActive, disabledReason: null, disabledAt: null } : { isActive, disabledReason: "ADMIN", disabledAt: new Date() },
  });
  if (count && !isActive) await invalidateAllSessionsForUser(userId);
}

/** What happened to a person's sign-in address when their details were saved. */
export type EmailMove = { from: string; to: string; invite: LoginInvite | null } | null;

/**
 * Correct the address a person signs in with — for when the office typed it
 * wrong. The School Admin only; the login must be a portal login in this
 * school. The address must not belong to any other SchoolOS account.
 *
 * Links already emailed (activation, password reset) went to the wrong
 * address, so they are revoked: whoever owns that address cannot use them.
 * A login still waiting for activation gets a fresh link at the new address.
 * Nothing about the password changes.
 */
export async function moveLoginEmail(ctx: TenantContext, userId: string | null, nextEmail: string | null | undefined): Promise<EmailMove> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!userId || nextEmail === undefined) return null;
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: { in: PORTAL_ROLES } }, select: { id: true, email: true, activatedAt: true, isActive: true } });
  if (!user) throw new NotFoundError();
  if (!nextEmail) throw new ValidationError("Please correct the highlighted fields.", { email: ["This person signs in with an email, so it cannot be left empty."] });
  const to = nextEmail.trim().toLowerCase();
  if (to === user.email) return null;
  if (await prisma.user.count({ where: { email: to, NOT: { id: user.id } } })) {
    throw new ConflictError(`${to} is already used by another SchoolOS account.`);
  }
  await ctx.db.user.updateMany({ where: { id: user.id }, data: { email: to } });
  // Links sent to the wrong address must stop working.
  await prisma.accountToken.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  await recordAudit({
    action: "LOGIN_EMAIL_CHANGED",
    entityType: "User",
    entityId: user.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Sign-in email corrected from ${user.email} to ${to}; links sent to the old address were cancelled.`,
  });
  const invite = !user.activatedAt && user.isActive ? await sendActivation(user.id, ctx.user.id) : null;
  return { from: user.email, to, invite };
}

/** Before saving a record whose email is also a login: refuse an address another account uses. */
export async function assertLoginEmailFree(userId: string | null, nextEmail: string | null | undefined): Promise<void> {
  if (!userId || !nextEmail) return;
  const to = nextEmail.trim().toLowerCase();
  if (await prisma.user.count({ where: { email: to, NOT: { id: userId } } })) {
    throw new ConflictError(`${to} is already used by another SchoolOS account.`);
  }
}

/** The office's message after a save that moved a sign-in address. */
export function emailMoveMessage(move: EmailMove): string {
  if (!move) return "";
  const base = ` Sign-in email changed to ${move.to}; any link sent to ${move.from} no longer works.`;
  if (!move.invite) return base;
  return move.invite.delivered
    ? `${base} A new activation email was sent to ${move.to}.`
    : `${base} The new activation email could not be sent${move.invite.error ? ` — ${move.invite.error}` : ""}. Use "Resend activation" once that is fixed.`;
}
