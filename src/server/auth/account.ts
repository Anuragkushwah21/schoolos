import "server-only";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hashSessionToken, type SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * Self-service password change.
 *
 * Every other session for the account is revoked, so a password changed
 * because it leaked actually locks the other party out. The session making the
 * change survives, so the user is not bounced to the login form.
 */
export async function changePassword(
  user: SessionUser,
  currentSessionToken: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!account) throw new NotFoundError();

  const ok = await verifyPassword(input.currentPassword, account.passwordHash);
  if (!ok) {
    throw new ValidationError("Please correct the highlighted fields.", {
      currentPassword: ["Your current password is incorrect"],
    });
  }

  if (input.currentPassword === input.newPassword) {
    throw new ValidationError("Please correct the highlighted fields.", {
      newPassword: ["Choose a password you have not used here before"],
    });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword) },
    }),
    prisma.session.deleteMany({
      where: {
        userId: user.id,
        tokenHash: { not: hashSessionToken(currentSessionToken) },
      },
    }),
    // A token issued under the old password does not survive the change.
    prisma.apiToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await recordAudit({
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: user.id,
    actorId: user.id,
    schoolId: user.schoolId,
    summary: `${user.email} changed their password.`,
  });
}
