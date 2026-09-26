/**
 * Email verification, and the gate it puts in front of approval.
 *
 * The code is only six digits, so the tests that matter here are the ones
 * about limits: wrong guesses, expiry, reuse, and what a school can do before
 * anyone has proved they own the address.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, RateLimitedError } from "@/lib/errors";
import { roleHomePath } from "@/lib/roles";
import { registerSchoolSchema } from "@/lib/validation/platform";
import { authenticate } from "@/server/auth/login";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { createSession, validateSessionToken, type SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { type Mail, resetMailTransport, setMailTransport } from "@/server/mail/mailer";
import { registerSchool } from "@/server/platform/registration";
import { markEmailVerified, transitionSchool } from "@/server/platform/schools";
import {
  MAX_ATTEMPTS,
  getVerificationState,
  maskEmail,
  sendVerificationCode,
  verifyCode,
} from "@/server/platform/verification";

const PREFIX = "verify-test";

let superAdmin: SessionUser;
let sent: Array<Mail & { from: string }> = [];

/** The code as the recipient would read it, from the message we "sent". */
function codeFrom(mail: { text: string } | undefined): string {
  const match = mail?.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error("No code in that email");
  return match[1]!;
}

async function registerOne(name: string, email: string) {
  const input = registerSchoolSchema.parse({
    name,
    city: "Indore",
    state: "Madhya Pradesh",
    contactName: "Kavita Joshi",
    contactEmail: email,
    contactPhone: "+91 98765 43210",
    password: "correct-horse-9",
    confirmPassword: "correct-horse-9",
  });
  const { reference } = await registerSchool(input, { ipAddress: "10.1.1.1" });
  return reference;
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: {
      email: `super@${PREFIX}.test`,
      passwordHash: "not-a-real-hash",
      role: "SUPER_ADMIN",
      firstName: "Platform",
      lastName: "Owner",
    },
  });
  superAdmin = {
    id: user.id,
    email: user.email,
    role: "SUPER_ADMIN",
    firstName: user.firstName,
    lastName: user.lastName,
    schoolId: null,
    schoolSlug: null,
    schoolName: null,
    schoolStatus: null,
  };
});

beforeEach(() => {
  __resetAllRateLimits();
  sent = [];
  setMailTransport(async (mail) => {
    sent.push(mail);
  });
});

afterEach(() => resetMailTransport());

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("registering", () => {
  it("emails a code to the contact and leaves the school unverified", async () => {
    const reference = await registerOne(`${PREFIX} Alpha`, `alpha@${PREFIX}.test`);

    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    expect(school.status).toBe("PENDING");
    expect(school.contactEmailVerifiedAt).toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(`alpha@${PREFIX}.test`);
    expect(codeFrom(sent[0])).toMatch(/^\d{6}$/);

    // Only the hash is kept.
    const row = await prisma.emailVerification.findFirstOrThrow({ where: { schoolId: school.id } });
    expect(row.codeHash).not.toContain(codeFrom(sent[0]));
    expect(row.codeHash).toHaveLength(64);
  });

  it("shows the address masked, never in full", async () => {
    const reference = await registerOne(`${PREFIX} Masked`, `kavita@${PREFIX}.test`);
    const state = await getVerificationState(reference);

    expect(state?.status).toBe("pending");
    if (state?.status === "pending") {
      expect(state.email).not.toBe(`kavita@${PREFIX}.test`);
      expect(state.email).toContain(`@${PREFIX}.test`);
    }
    expect(maskEmail("kavita@example.com")).toBe("k••••a@example.com");
  });
});

describe("checking the code", () => {
  it("accepts the right code once and refuses it afterwards", async () => {
    const reference = await registerOne(`${PREFIX} Once`, `once@${PREFIX}.test`);
    const code = codeFrom(sent[0]);

    await verifyCode(reference, code);
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    expect(school.contactEmailVerifiedAt).not.toBeNull();

    // Already verified, so a second call is a no-op rather than an error.
    await expect(verifyCode(reference, code)).resolves.toBeUndefined();
  });

  it("refuses a wrong code and retires it after five tries", async () => {
    const reference = await registerOne(`${PREFIX} Guessy`, `guessy@${PREFIX}.test`);
    const right = codeFrom(sent[0]);
    const wrong = right === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await expect(verifyCode(reference, wrong)).rejects.toThrow(/not right/i);
    }

    // The code is dead now — even the real one no longer works.
    await expect(verifyCode(reference, right)).rejects.toThrow();
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    expect(school.contactEmailVerifiedAt).toBeNull();
  });

  it("refuses an expired code", async () => {
    const reference = await registerOne(`${PREFIX} Stale`, `stale@${PREFIX}.test`);
    const code = codeFrom(sent[0]);
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await prisma.emailVerification.updateMany({
      where: { schoolId: school.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(verifyCode(reference, code)).rejects.toThrow(/expired/i);
  });

  it("answers an unknown registration exactly as it answers a wrong code", async () => {
    await expect(verifyCode(`${PREFIX}-no-such-school`, "123456")).rejects.toThrow(/not right/i);
  });

  it("invalidates the old code when a new one is sent", async () => {
    const reference = await registerOne(`${PREFIX} Resend`, `resend@${PREFIX}.test`);
    const first = codeFrom(sent[0]);

    await sendVerificationCode(reference, { force: true });
    const second = codeFrom(sent[1]);
    expect(second).not.toBe(first);

    await expect(verifyCode(reference, first)).rejects.toThrow();
    await verifyCode(reference, second);
  });

  it("throttles resends", async () => {
    const reference = await registerOne(`${PREFIX} Flood`, `flood@${PREFIX}.test`);

    // One was sent by registering; four more reach the hourly cap.
    for (let index = 0; index < 4; index += 1) {
      await sendVerificationCode(reference, { force: true });
    }
    await expect(sendVerificationCode(reference, { force: true })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("does not resend within the cooldown unless forced", async () => {
    const reference = await registerOne(`${PREFIX} Cool`, `cool@${PREFIX}.test`);
    const before = sent.length;

    const state = await sendVerificationCode(reference);
    expect(sent).toHaveLength(before);
    if (state.status === "pending") expect(state.canResendInSeconds).toBeGreaterThan(0);
  });
});

describe("approval", () => {
  it("refuses to approve a school whose email is not verified", async () => {
    const reference = await registerOne(`${PREFIX} Unverified`, `unverified@${PREFIX}.test`);
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await expect(transitionSchool(superAdmin, school.id, "approve")).rejects.toBeInstanceOf(
      ConflictError,
    );

    const after = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(after.status).toBe("PENDING");

    // The administrator's account exists from registration, and stays shut.
    const blocked = await authenticate(`unverified@${PREFIX}.test`, "correct-horse-9");
    expect(blocked).toMatchObject({ ok: false, reason: "SCHOOL_NOT_ACTIVE" });
  });

  it("approves once verified, and tells the contact they can sign in", async () => {
    const reference = await registerOne(`${PREFIX} Ready`, `ready@${PREFIX}.test`);
    await verifyCode(reference, codeFrom(sent[0]));

    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    const { credentials } = await transitionSchool(superAdmin, school.id, "approve");

    // They chose their own password, so nothing is generated or emailed.
    expect(credentials).toBeUndefined();

    const handover = sent.find((mail) => mail.subject.includes("approved"));
    expect(handover?.to).toBe(`ready@${PREFIX}.test`);
    expect(handover?.text).toContain("the one you chose when you registered");
    expect(handover?.text).not.toMatch(/Password:\s+\S{10,}/);

    const after = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(after.status).toBe("ACTIVE");

    const login = await authenticate(`ready@${PREFIX}.test`, "correct-horse-9");
    expect(login.ok).toBe(true);
  });

  it("lets the Super Admin verify by hand, and records that they did", async () => {
    const reference = await registerOne(`${PREFIX} ByHand`, `byhand@${PREFIX}.test`);
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await markEmailVerified(superAdmin, school.id);
    const after = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(after.contactEmailVerifiedAt).not.toBeNull();

    const entry = await prisma.auditLog.findFirst({
      where: { schoolId: school.id, action: "SCHOOL_EMAIL_VERIFIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.actorId).toBe(superAdmin.id);
    expect(entry?.summary).toMatch(/without a code/i);

    await expect(markEmailVerified(superAdmin, school.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(transitionSchool(superAdmin, school.id, "approve")).resolves.toBeTruthy();
  });

  it("tells a rejected registration why", async () => {
    const reference = await registerOne(`${PREFIX} Nope`, `nope@${PREFIX}.test`);
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await transitionSchool(superAdmin, school.id, "reject", "Could not verify the school.");

    const mail = sent.find((message) => message.subject.includes("About your SchoolOS registration"));
    expect(mail?.to).toBe(`nope@${PREFIX}.test`);
    expect(mail?.text).toContain("Could not verify the school.");
  });
});

/**
 * The whole journey in one test, because the interesting part is the joint.
 *
 * Every step below is covered on its own elsewhere; what is not covered
 * anywhere else is that they connect — that the account registration creates
 * is the same one approval opens, and that signing in to it lands on the
 * dashboard its role owns rather than a generic home page.
 */
describe("registration to dashboard", () => {
  it("makes the contact a SCHOOL_ADMIN who lands on /admin once approved", async () => {
    const email = `journey@${PREFIX}.test`;
    const reference = await registerOne(`${PREFIX} Journey`, email);

    // 1. Registration created the account, already SCHOOL_ADMIN.
    const school = await prisma.school.findUniqueOrThrow({
      where: { slug: reference },
      include: { users: true },
    });
    expect(school.status).toBe("PENDING");
    expect(school.users).toHaveLength(1);
    expect(school.users[0]?.role).toBe("SCHOOL_ADMIN");
    expect(school.users[0]?.email).toBe(email);

    // 2. It does not work yet, and the refusal says why rather than blaming
    //    the password — which was right.
    expect(await authenticate(email, "correct-horse-9")).toMatchObject({
      ok: false,
      reason: "SCHOOL_NOT_ACTIVE",
      schoolStatus: "PENDING",
    });

    // 3. The code from the email they actually received.
    await verifyCode(reference, codeFrom(sent[0]));

    // 4. The Super Admin approves. No password is generated — theirs already
    //    exists, so there is no one-time secret to show or to email.
    const { credentials } = await transitionSchool(superAdmin, school.id, "approve");
    expect(credentials).toBeUndefined();

    // 5. The same password now works.
    const login = await authenticate(email, "correct-horse-9");
    expect(login).toMatchObject({ ok: true });
    if (!login.ok) throw new Error("unreachable");

    // 6. And the session it opens — the thing every later request is checked
    //    against — carries the role that decides the destination.
    const { token } = await createSession(login.userId, { ipAddress: "10.1.1.1" });
    const session = await validateSessionToken(token);
    expect(session?.role).toBe("SCHOOL_ADMIN");
    expect(session?.schoolId).toBe(school.id);
    expect(roleHomePath(session!.role)).toBe("/school-admin/dashboard");
  });
});
