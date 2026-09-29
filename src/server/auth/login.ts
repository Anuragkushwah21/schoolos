import type { SchoolStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { fakeVerifyPassword, verifyPassword } from "@/server/auth/password";
import { personMaySignIn } from "@/server/auth/session";

/**
 * Credential verification.
 *
 * Every failure returns the same opaque outcome to the caller. The reasons are
 * distinguished internally only so the audit log can record them; the user is
 * always told the same thing, because "no such account" and "wrong password"
 * told apart is an account-enumeration oracle.
 */

export type LoginFailureReason =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "SCHOOL_NOT_ACTIVE";

export type LoginOutcome =
  | { ok: true; userId: string; schoolId: string | null }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "ACCOUNT_DISABLED" }
  /**
   * The password was right, so there is nothing to protect by being vague:
   * the caller already holds the credential. The school's status comes back so
   * the screen can say "waiting for approval" rather than "wrong password",
   * which for a school that has just registered is simply untrue.
   */
  | { ok: false; reason: "SCHOOL_NOT_ACTIVE"; schoolStatus: SchoolStatus | null };

export async function authenticate(
  email: string,
  password: string,
): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      role: true,
      schoolId: true,
      school: { select: { status: true } },
      student: { select: { status: true } },
      teacher: { select: { status: true } },
      staffMember: { select: { status: true } },
    },
  });

  if (!user) {
    // Spend the same CPU a real bcrypt comparison would, so an unknown email
    // is not detectable from how quickly the request comes back.
    await fakeVerifyPassword(password);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (!user.isActive || !personMaySignIn(user)) {
    return { ok: false, reason: "ACCOUNT_DISABLED" };
  }

  if (user.role !== "SUPER_ADMIN") {
    const status: SchoolStatus | undefined = user.school?.status;
    if (!user.schoolId || status !== "ACTIVE") {
      return { ok: false, reason: "SCHOOL_NOT_ACTIVE", schoolStatus: status ?? null };
    }
  }

  return { ok: true, userId: user.id, schoolId: user.schoolId };
}
