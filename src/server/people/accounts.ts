import "server-only";

import type { UserRole } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { hashPassword } from "@/server/auth/password";
import { invalidateAllSessionsForUser } from "@/server/auth/session";
import { generateTemporaryPassword } from "@/server/auth/temp-password";
import { isUniqueViolation } from "@/server/db/errors";
import type { Credentials } from "@/server/platform/schools";

/**
 * Portal accounts for people in a school — teachers, students and guardians.
 *
 * The School Admin issues them; the role is always set here from the kind of
 * record being linked, never taken from the request. Passwords are generated,
 * shown once, and can only be replaced, never read back.
 */

/** Create a login and return its one-time credentials. Caller links it. */
export async function createPortalUser(
  ctx: TenantContext,
  input: { email: string; role: Exclude<UserRole, "SUPER_ADMIN" | "SCHOOL_ADMIN">; firstName: string; lastName: string; phone?: string | null },
): Promise<{ userId: string; credentials: Credentials }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const password = generateTemporaryPassword();

  try {
    const user = await ctx.db.user.create({
      data: {
        schoolId: ctx.schoolId,
        email: input.email,
        passwordHash: await hashPassword(password),
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
      },
      select: { id: true },
    });
    return { userId: user.id, credentials: { email: input.email, password } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That email address is already used by another account.");
    }
    throw error;
  }
}

/** Replace a portal user's password and sign them out everywhere. */
export async function resetPortalPassword(ctx: TenantContext, userId: string): Promise<Credentials> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const user = await ctx.db.user.findFirst({
    where: { id: userId, role: { in: ["TEACHER", "STUDENT", "PARENT"] } },
    select: { id: true, email: true },
  });
  if (!user) throw new NotFoundError();

  const password = generateTemporaryPassword();
  await ctx.db.user.updateMany({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  await invalidateAllSessionsForUser(user.id);

  await recordAudit({
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Password reset for ${user.email}.`,
  });

  return { email: user.email, password, label: "New password issued" };
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
    where: { id: userId, role: { in: ["TEACHER", "STUDENT", "PARENT"] } },
    data: { isActive },
  });
  if (count && !isActive) await invalidateAllSessionsForUser(userId);
}
