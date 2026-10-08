import { createHash, randomBytes } from "node:crypto";

import type { SchoolStatus, UserRole } from "@/generated/prisma/enums";
import { employeeMaySignIn, studentMaySignIn } from "@/lib/validation/lifecycle";
import { prisma } from "@/server/db/prisma";

/**
 * Server-side sessions.
 *
 * The cookie carries an opaque random token. Only the token's SHA-256 hash is
 * stored, so a database leak yields nothing a caller can present as a session.
 *
 * Sessions are rows rather than JWTs because they must be revocable: when a
 * Super Admin suspends a school, every session belonging to it has to stop
 * working immediately, and a stateless token cannot be withdrawn early.
 */

export const SESSION_COOKIE_NAME = "schoolos_session";

/** Absolute lifetime. Sessions do not slide; signing in again issues a new one. */
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** 256 bits of entropy, URL-safe so it survives a cookie round-trip intact. */
function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The only shape of the signed-in user that leaves this module.
 *
 * Deliberately excludes `passwordHash` — nothing downstream can leak a
 * credential it was never handed.
 */
export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  schoolId: string | null;
  schoolSlug: string | null;
  schoolName: string | null;
  schoolStatus: SchoolStatus | null;
  /**
   * The school the login belongs to. Differs from `schoolId` only for an
   * Owner who switched to another of their campuses (server-checked).
   */
  homeSchoolId?: string | null;
  /** The person's own interface language, if they chose one. */
  preferredLanguage?: string | null;
  /** Signed in with a seeded or issued default password: must choose their own first. */
  mustChangePassword?: boolean;
};

export type SessionMetadata = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function createSession(
  userId: string,
  metadata: SessionMetadata = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolve a raw cookie token to the user it belongs to.
 *
 * Returns null — never throws — for every failure mode, so callers cannot
 * distinguish "no session" from "expired" from "school suspended".
 *
 * A session is rejected when:
 *   - the token matches nothing, or has expired;
 *   - the user account has been deactivated;
 *   - the user's school is anything other than ACTIVE.
 *
 * That last rule is what makes suspending a school take effect immediately for
 * users who are already signed in. SUPER_ADMIN has no school and is exempt.
 */
export async function validateSessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      activeSchoolId: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          isActive: true,
          preferredLanguage: true,
          mustChangePassword: true,
          schoolId: true,
          school: { select: { slug: true, name: true, status: true } },
          student: { select: { status: true } },
          teacher: { select: { status: true } },
          staffMember: { select: { status: true } },
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Clean up on the way past rather than leaving dead rows to accumulate.
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const { user } = session;
  if (!user.isActive) return null;
  // A login never outranks the school's decision about the person: someone
  // who has left (or is suspended) is refused even if their login were open.
  if (!personMaySignIn(user)) return null;

  if (user.role !== "SUPER_ADMIN") {
    // Every non-platform role must belong to a school that is currently live.
    if (!user.schoolId || user.school?.status !== "ACTIVE") return null;
  }

  // An Owner working in another of their campuses: honoured only while that
  // campus is live and belongs to the organization this login owns. Anything
  // else (a campus of someone else, a suspended one) falls back to home.
  let school = { id: user.schoolId, slug: user.school?.slug ?? null, name: user.school?.name ?? null, status: user.school?.status ?? null };
  if (session.activeSchoolId && session.activeSchoolId !== user.schoolId && user.role === "SCHOOL_ADMIN") {
    const campus = await prisma.school.findFirst({
      where: { id: session.activeSchoolId, status: "ACTIVE", organization: { ownerId: user.id } },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (campus) school = campus;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    schoolId: school.id,
    schoolSlug: school.slug,
    schoolName: school.name,
    schoolStatus: school.status,
    homeSchoolId: user.schoolId,
    preferredLanguage: user.preferredLanguage,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Whether the person behind a login is still someone who may use the portal.
 * Students, teachers and staff must have a current status; guardians,
 * administrators and the platform have no person status of their own.
 */
export function personMaySignIn(user: {
  role: UserRole;
  student?: { status: string } | null;
  teacher?: { status: string } | null;
  staffMember?: { status: string } | null;
}): boolean {
  switch (user.role) {
    case "STUDENT":
      return !user.student || studentMaySignIn(user.student.status);
    case "TEACHER":
      return !user.teacher || employeeMaySignIn(user.teacher.status);
    case "NON_TEACHING_STAFF":
      return !user.staffMember || employeeMaySignIn(user.staffMember.status);
    default:
      return true;
  }
}

export async function invalidateSession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

/**
 * Sign a user out everywhere — used on password reset and deactivation. API
 * tokens are credentials too, so they are revoked with the sessions: a token
 * minted before a reset must not outlive it.
 */
export async function invalidateAllSessionsForUser(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

/**
 * Revoke every session belonging to a school.
 *
 * Called when a school is suspended or deactivated, so staff and parents are
 * signed out at once rather than lingering until their cookies expire.
 */
export async function invalidateAllSessionsForSchool(
  schoolId: string,
): Promise<void> {
  await prisma.session.deleteMany({ where: { user: { schoolId } } });
}

/** Housekeeping: drop sessions that have already lapsed. */
export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}
