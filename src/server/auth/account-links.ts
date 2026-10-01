import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { AccountTokenPurpose, UserRole } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { hashPassword } from "@/server/auth/password";
import { invalidateAllSessionsForUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { isUniqueViolation } from "@/server/db/errors";
import { sendMail } from "@/server/mail/mailer";
import { activationEmail, passwordResetEmail } from "@/server/mail/templates";
import type { TenantDb } from "@/server/tenancy/scope";

/**
 * Accounts the school provisions, activated by the person themselves.
 *
 *   * The School Admin never sets or sees a password. Creating a login makes
 *     the account (with an unusable password) and emails a one-time
 *     activation link; the person chooses their own password.
 *   * Forgotten passwords are reset the same way, by a one-time link.
 *   * Links: 32 random bytes, only their SHA-256 stored, one use, expiring,
 *     tied to one account; a new link revokes the previous one, and a
 *     password change revokes them all.
 *   * Email goes after the database commit. If delivery fails the account
 *     stays as it is, the failure is recorded, and the office can resend.
 */

export const ACTIVATION_DAYS = 7;
export const RESET_MINUTES = 30;
const PORTAL_ROLES: UserRole[] = ["TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type AccountState = "NO_ACCOUNT" | "PENDING_ACTIVATION" | "ACTIVE" | "DISABLED";

export function accountState(user: { isActive: boolean; activatedAt: Date | null } | null): AccountState {
  if (!user) return "NO_ACCOUNT";
  if (!user.isActive) return "DISABLED";
  return user.activatedAt ? "ACTIVE" : "PENDING_ACTIVATION";
}

/**
 * Create a login waiting for activation. Call inside the caller's
 * transaction; send the email with `sendActivation` after it commits.
 */
export async function provisionAccount(
  db: Pick<TenantDb, "user">,
  input: { schoolId: string; email: string; role: Exclude<UserRole, "SUPER_ADMIN" | "SCHOOL_ADMIN">; firstName: string; lastName: string; phone?: string | null },
  /** For bulk provisioning: one pre-computed unusable hash (see `unusablePasswordHash`). */
  unusableHash?: string,
): Promise<string> {
  // A password nobody knows: the account cannot be signed in to until the
  // person chooses their own through the activation link.
  const unusable = unusableHash ?? (await unusablePasswordHash());
  try {
    const user = await db.user.create({
      data: {
        schoolId: input.schoolId,
        email: input.email.trim().toLowerCase(),
        passwordHash: unusable,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        activatedAt: null,
      },
      select: { id: true },
    });
    return user.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${input.email} already has a SchoolOS login. Use another email.`);
    throw error;
  }
}

/** A bcrypt hash of a random secret nobody keeps — no password matches it. */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64url"));
}

/** What the office is told after creating or re-sending a login. */
export type LoginInvite = { email: string; delivered: boolean; label?: string; error?: string };

/**
 * "Account: Pending activation. Activation email: Sent ✓" — or Failed, why,
 * and what to do. The account is kept either way; nothing is undone.
 */
export function inviteMessage(invite: LoginInvite): string {
  return invite.delivered
    ? `Account: pending activation. Activation email: sent ✓ to ${invite.email} — they choose their own password from the link.`
    : `Account: pending activation. Activation email to ${invite.email}: failed${invite.error ? ` — ${invite.error}` : ""}. Use "Resend activation email" on their page once that is fixed.`;
}

async function issueLink(userId: string, purpose: AccountTokenPurpose, createdById: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (purpose === "ACTIVATION" ? ACTIVATION_DAYS * 86_400_000 : RESET_MINUTES * 60_000));
  const [, row] = await prisma.$transaction([
    // Only the newest link works.
    prisma.accountToken.updateMany({ where: { userId, purpose, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.accountToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt, createdById }, select: { id: true } }),
  ]);
  return { token, id: row.id };
}

async function deliver(tokenId: string, mail: Parameters<typeof sendMail>[0]): Promise<{ delivered: boolean; error?: string }> {
  const result = await sendMail(mail);
  // The provider's reason is kept (never the key or the link), so the office
  // can see why and resend once it is fixed.
  await prisma.accountToken.update({
    where: { id: tokenId },
    data: result.delivered ? { emailStatus: "SENT", emailError: null } : { emailStatus: "FAILED", emailError: result.error ?? "The email provider did not accept the message." },
  });
  return result;
}

const ROLE_NAMES: Partial<Record<UserRole, string>> = {
  TEACHER: "teacher",
  STUDENT: "student",
  PARENT: "parent",
  NON_TEACHING_STAFF: "staff",
};

/**
 * Email an activation link to a pending account — through the same mailer
 * and provider as "forgot password". A new link supersedes the previous one.
 * Returns whether the email went and, if not, why.
 */
export async function sendActivation(userId: string, createdById: string | null): Promise<{ email: string; delivered: boolean; error?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, activatedAt: true, school: { select: { name: true } } },
  });
  if (!user) throw new NotFoundError();
  if (user.activatedAt) throw new ConflictError("This account is already active. Use password reset instead.");
  const { token, id } = await issueLink(user.id, "ACTIVATION", createdById);
  const result = await deliver(
    id,
    activationEmail({
      to: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      role: ROLE_NAMES[user.role] ?? "SchoolOS",
      schoolName: user.school?.name ?? "Your school",
      link: `${env.APP_URL}/activate?token=${token}`,
      days: ACTIVATION_DAYS,
    }),
  );
  return { email: user.email, ...result };
}

/**
 * The office's "send login email" for someone already provisioned: a new
 * activation link while pending, a password-reset link once active.
 */
export async function resendAccountEmail(ctx: TenantContext, userId: string): Promise<{ email: string; delivered: boolean; error?: string; kind: "ACTIVATION" | "PASSWORD_RESET" }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: { in: PORTAL_ROLES } }, select: { id: true, email: true, firstName: true, activatedAt: true, isActive: true } });
  if (!user) throw new NotFoundError();
  if (!user.isActive) throw new ConflictError("This login is switched off. Turn it back on first.");
  let result: { email: string; delivered: boolean; error?: string; kind: "ACTIVATION" | "PASSWORD_RESET" };
  if (!user.activatedAt) {
    result = { ...(await sendActivation(user.id, ctx.user.id)), kind: "ACTIVATION" };
  } else {
    const { token, id } = await issueLink(user.id, "PASSWORD_RESET", ctx.user.id);
    const sent = await deliver(id, passwordResetEmail({ to: user.email, name: user.firstName, link: `${env.APP_URL}/reset-password?token=${token}`, minutes: RESET_MINUTES }));
    result = { email: user.email, ...sent, kind: "PASSWORD_RESET" };
  }
  await recordAudit({
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${result.kind === "ACTIVATION" ? "Activation" : "Password reset"} email ${result.delivered ? "sent" : "could not be sent"} to ${user.email}.`,
  });
  return result;
}

/** A link's account, if the link is real, unused, unrevoked and unexpired. */
export async function inspectLink(token: string, purpose: AccountTokenPurpose) {
  if (!token || token.length > 200) return null;
  const row = await prisma.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, purpose: true, usedAt: true, revokedAt: true, expiresAt: true, user: { select: { id: true, email: true, firstName: true, isActive: true, activatedAt: true } } },
  });
  if (!row || row.purpose !== purpose || row.usedAt || row.revokedAt || row.expiresAt <= new Date() || !row.user.isActive) return null;
  if (purpose === "ACTIVATION" && row.user.activatedAt) return null;
  return row;
}

const GENERIC_LINK_ERROR = "This link has expired or has already been used. Ask for a new one.";

function assertPassword(password: string, confirm: string): void {
  const errors: Record<string, string[]> = {};
  if (password.length < 8) errors.password = ["Use at least 8 characters."];
  else if (password.length > 72) errors.password = ["Use at most 72 characters."];
  if (password !== confirm) errors.confirm = ["The two passwords do not match."];
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted fields.", errors);
}

/**
 * Use a link: set the password, mark the link used, revoke every other link
 * for the account, and — for a reset — sign the account out everywhere.
 * Returns the user id so the caller can sign them in.
 */
export async function redeemAccountLink(token: string, purpose: AccountTokenPurpose, password: string, confirm: string): Promise<string> {
  assertPassword(password, confirm);
  const row = await inspectLink(token, purpose);
  if (!row) throw new ValidationError(GENERIC_LINK_ERROR, { token: [GENERIC_LINK_ERROR] });
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // Claimed with a conditional write, so the same link cannot be used twice at once.
  const claimed = await prisma.accountToken.updateMany({ where: { id: row.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
  if (!claimed.count) throw new ValidationError(GENERIC_LINK_ERROR, { token: [GENERIC_LINK_ERROR] });
  if (purpose === "PASSWORD_RESET") await invalidateAllSessionsForUser(row.user.id);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.user.id }, data: { passwordHash, activatedAt: row.user.activatedAt ?? now } }),
    prisma.accountToken.updateMany({ where: { userId: row.user.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await recordAudit({
    action: purpose === "ACTIVATION" ? "ACCOUNT_ACTIVATED" : "PASSWORD_CHANGED",
    entityType: "User",
    entityId: row.user.id,
    actorId: row.user.id,
    summary: purpose === "ACTIVATION" ? `${row.user.email} activated their account.` : `${row.user.email} reset their password by email.`,
  });
  return row.user.id;
}

/**
 * "Forgot password": always answers the same, whether or not the email is
 * known, so it cannot be used to find out who has an account. A pending
 * account gets a fresh activation link instead.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, firstName: true, isActive: true, activatedAt: true, school: { select: { status: true } } },
  });
  if (!user || !user.isActive || (user.school && user.school.status !== "ACTIVE")) return;
  if (!user.activatedAt) {
    await sendActivation(user.id, null);
    return;
  }
  const { token, id } = await issueLink(user.id, "PASSWORD_RESET", null);
  await deliver(id, passwordResetEmail({ to: user.email, name: user.firstName, link: `${env.APP_URL}/reset-password?token=${token}`, minutes: RESET_MINUTES }));
}

export type ActivationEmailStatus = { at: Date; status: "SENT" | "FAILED" | null; error: string | null; expired: boolean };

/**
 * The latest activation email for each pending account given — sent or
 * failed, why, and whether its link has run out — for the office's view.
 * Only the admin's own school's users are asked about (`ctx.db`).
 */
export async function activationEmailStatuses(ctx: TenantContext, userIds: Array<string | null | undefined>): Promise<Map<string, ActivationEmailStatus>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const users = await ctx.db.user.findMany({ where: { id: { in: ids }, activatedAt: null }, select: { id: true } });
  const rows = await prisma.accountToken.findMany({
    where: { userId: { in: users.map((user) => user.id) }, purpose: "ACTIVATION" },
    orderBy: { createdAt: "desc" },
    select: { userId: true, createdAt: true, expiresAt: true, emailStatus: true, emailError: true },
  });
  const result = new Map<string, ActivationEmailStatus>();
  for (const row of rows) {
    if (result.has(row.userId)) continue;
    result.set(row.userId, {
      at: row.createdAt,
      status: row.emailStatus === "SENT" || row.emailStatus === "FAILED" ? row.emailStatus : null,
      error: row.emailError,
      expired: row.expiresAt <= new Date(),
    });
  }
  return result;
}
