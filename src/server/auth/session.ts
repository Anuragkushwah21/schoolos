import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SchoolStatus, UserRole } from "@/generated/prisma/enums";
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
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          isActive: true,
          schoolId: true,
          school: { select: { slug: true, name: true, status: true } },
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

  if (user.role !== "SUPER_ADMIN") {
    // Every non-platform role must belong to a school that is currently live.
    if (!user.schoolId || user.school?.status !== "ACTIVE") return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    schoolId: user.schoolId,
    schoolSlug: user.school?.slug ?? null,
    schoolName: user.school?.name ?? null,
    schoolStatus: user.school?.status ?? null,
  };
}

export async function invalidateSession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

/** Sign a user out everywhere — used on password change and deactivation. */
export async function invalidateAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
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

/** Constant-time comparison, for callers comparing tokens directly. */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
