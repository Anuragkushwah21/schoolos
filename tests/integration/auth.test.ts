/**
 * Authentication and session lifecycle.
 *
 * The rules being pinned down here:
 *   - a stored session is useless to whoever reads the database;
 *   - every failed sign-in looks identical from outside;
 *   - suspending a school signs its users out immediately.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/server/auth/password";
import { authenticate } from "@/server/auth/login";
import {
  __resetAllRateLimits,
  rateLimit,
  resetRateLimit,
} from "@/server/auth/rate-limit";
import {
  createSession,
  deleteExpiredSessions,
  hashSessionToken,
  invalidateAllSessionsForSchool,
  invalidateAllSessionsForUser,
  invalidateSession,
  validateSessionToken,
} from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

const PASSWORD = "CorrectHorse123";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdminId: string;

beforeAll(async () => {
  const fixture = await createIsolationFixture();
  schoolA = fixture.schoolA;
  schoolB = fixture.schoolB;

  const passwordHash = await hashPassword(PASSWORD);

  // Give the fixture users real, verifiable credentials.
  await prisma.user.updateMany({
    where: { id: { in: [schoolA.adminUserId, schoolB.adminUserId] } },
    data: { passwordHash },
  });

  const superAdmin = await prisma.user.create({
    data: {
      email: "iso-test-super@schoolos.test",
      passwordHash,
      role: "SUPER_ADMIN",
      firstName: "Iso",
      lastName: "Super",
      schoolId: null,
    },
  });
  superAdminId = superAdmin.id;
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: superAdminId } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

beforeEach(() => {
  __resetAllRateLimits();
});

async function adminEmail(schoolKey: "a" | "b") {
  return `admin@iso-test-${schoolKey}.test`;
}

describe("authenticate()", () => {
  it("accepts correct credentials", async () => {
    const outcome = await authenticate(await adminEmail("a"), PASSWORD);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.userId).toBe(schoolA.adminUserId);
  });

  it("rejects a wrong password", async () => {
    const outcome = await authenticate(await adminEmail("a"), "wrong-password");

    expect(outcome).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("reports an unknown email exactly as a wrong password", async () => {
    const unknown = await authenticate("nobody@nowhere.test", PASSWORD);
    const wrongPassword = await authenticate(await adminEmail("a"), "nope");

    // Identical outcomes: nothing distinguishes a registered address from an
    // unregistered one.
    expect(unknown).toEqual(wrongPassword);
  });

  it("rejects a deactivated account even with the right password", async () => {
    await prisma.user.update({
      where: { id: schoolB.adminUserId },
      data: { isActive: false },
    });

    const outcome = await authenticate(await adminEmail("b"), PASSWORD);
    expect(outcome).toEqual({ ok: false, reason: "ACCOUNT_DISABLED" });

    await prisma.user.update({
      where: { id: schoolB.adminUserId },
      data: { isActive: true },
    });
  });

  it("rejects a user whose school is suspended", async () => {
    await prisma.school.update({
      where: { id: schoolB.schoolId },
      data: { status: "SUSPENDED" },
    });

    const outcome = await authenticate(await adminEmail("b"), PASSWORD);
    expect(outcome).toEqual({ ok: false, reason: "SCHOOL_NOT_ACTIVE" });

    await prisma.school.update({
      where: { id: schoolB.schoolId },
      data: { status: "ACTIVE" },
    });
  });

  it("lets a SUPER_ADMIN in despite having no school", async () => {
    const outcome = await authenticate("iso-test-super@schoolos.test", PASSWORD);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.schoolId).toBeNull();
  });
});

describe("session lifecycle", () => {
  it("never stores the raw token", async () => {
    const { token } = await createSession(schoolA.adminUserId);

    const stored = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { tokenHash: true },
    });

    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).not.toBe(token);

    // The raw token appears nowhere in the table.
    const rawMatch = await prisma.session.findFirst({
      where: { tokenHash: token },
    });
    expect(rawMatch).toBeNull();

    await invalidateSession(token);
  });

  it("issues a different token every time", async () => {
    const [first, second] = await Promise.all([
      createSession(schoolA.adminUserId),
      createSession(schoolA.adminUserId),
    ]);

    expect(first.token).not.toBe(second.token);

    await invalidateSession(first.token);
    await invalidateSession(second.token);
  });

  it("resolves a valid token to a user carrying no password hash", async () => {
    const { token } = await createSession(schoolA.adminUserId);

    const user = await validateSessionToken(token);

    expect(user?.id).toBe(schoolA.adminUserId);
    expect(user?.schoolId).toBe(schoolA.schoolId);
    expect(user).not.toHaveProperty("passwordHash");

    await invalidateSession(token);
  });

  it("returns null for a missing, empty or unknown token", async () => {
    await expect(validateSessionToken(undefined)).resolves.toBeNull();
    await expect(validateSessionToken("")).resolves.toBeNull();
    await expect(validateSessionToken("not-a-real-token")).resolves.toBeNull();
  });

  it("rejects an expired session and cleans it up", async () => {
    const { token } = await createSession(schoolA.adminUserId);

    await prisma.session.update({
      where: { tokenHash: hashSessionToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(validateSessionToken(token)).resolves.toBeNull();

    const remaining = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(remaining).toBeNull();
  });

  it("stops working the moment the session is invalidated", async () => {
    const { token } = await createSession(schoolA.adminUserId);
    await expect(validateSessionToken(token)).resolves.not.toBeNull();

    await invalidateSession(token);
    await expect(validateSessionToken(token)).resolves.toBeNull();
  });

  it("rejects a live session whose user has been deactivated", async () => {
    const { token } = await createSession(schoolA.adminUserId);

    await prisma.user.update({
      where: { id: schoolA.adminUserId },
      data: { isActive: false },
    });

    await expect(validateSessionToken(token)).resolves.toBeNull();

    await prisma.user.update({
      where: { id: schoolA.adminUserId },
      data: { isActive: true },
    });
    await invalidateSession(token);
  });

  it("kills a live session the instant its school is suspended", async () => {
    // This is the requirement a stateless JWT could not satisfy.
    const { token } = await createSession(schoolA.adminUserId);
    await expect(validateSessionToken(token)).resolves.not.toBeNull();

    await prisma.school.update({
      where: { id: schoolA.schoolId },
      data: { status: "SUSPENDED" },
    });

    await expect(validateSessionToken(token)).resolves.toBeNull();

    await prisma.school.update({
      where: { id: schoolA.schoolId },
      data: { status: "ACTIVE" },
    });
    await invalidateSession(token);
  });

  it("revokes every session for a school without touching another school's", async () => {
    const [a, b] = await Promise.all([
      createSession(schoolA.adminUserId),
      createSession(schoolB.adminUserId),
    ]);

    await invalidateAllSessionsForSchool(schoolA.schoolId);

    await expect(validateSessionToken(a.token)).resolves.toBeNull();
    await expect(validateSessionToken(b.token)).resolves.not.toBeNull();

    await invalidateSession(b.token);
  });

  it("revokes every session for one user", async () => {
    const first = await createSession(schoolA.adminUserId);
    const second = await createSession(schoolA.adminUserId);

    await invalidateAllSessionsForUser(schoolA.adminUserId);

    await expect(validateSessionToken(first.token)).resolves.toBeNull();
    await expect(validateSessionToken(second.token)).resolves.toBeNull();
  });

  it("sweeps expired sessions", async () => {
    const { token } = await createSession(schoolA.adminUserId);
    await prisma.session.update({
      where: { tokenHash: hashSessionToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const removed = await deleteExpiredSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and then blocks", () => {
    const key = "test:bucket";

    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }

    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate counts per key", () => {
    expect(rateLimit("a", 1, 60_000).allowed).toBe(true);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("clears a bucket on reset, so a successful login forgives earlier typos", () => {
    rateLimit("c", 1, 60_000);
    expect(rateLimit("c", 1, 60_000).allowed).toBe(false);

    resetRateLimit("c");
    expect(rateLimit("c", 1, 60_000).allowed).toBe(true);
  });
});
