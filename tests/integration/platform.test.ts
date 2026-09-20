/**
 * School registration and the Super Admin's governance of schools.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { registerSchoolSchema } from "@/lib/validation/platform";
import { authenticate } from "@/server/auth/login";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { createSession, validateSessionToken, type SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { currentAcademicYear, DEFAULT_GRADES } from "@/server/academics/provision";
import { getLiveOffers } from "@/server/platform/marketing";
import { registerSchool } from "@/server/platform/registration";
import {
  createSchoolAdmin,
  setSubscription,
  transitionSchool,
} from "@/server/platform/schools";

const PREFIX = "platform-test";

let superAdmin: SessionUser;

function registration(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values: Record<string, string> = {
    name: `${PREFIX} Academy`,
    city: "Indore",
    state: "Madhya Pradesh",
    contactName: "Kavita Joshi",
    contactEmail: `kavita@${PREFIX}.test`,
    contactPhone: "+91 98765 43210",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return registerSchoolSchema.parse(Object.fromEntries(form));
}

/**
 * Approval now requires a verified contact address; the code flow itself is
 * covered in `verification.test.ts`, so these tests take it as given.
 */
async function markVerified(slug: string) {
  await prisma.school.update({
    where: { slug },
    data: { contactEmailVerifiedAt: new Date() },
  });
}

async function cleanup() {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await prisma.platformOffer.deleteMany({ where: { title: { startsWith: PREFIX } } });
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

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("registration", () => {
  it("creates a PENDING school with a unique slug and no user account", async () => {
    const first = await registerSchool(registration(), { ipAddress: "10.0.0.1" });
    const second = await registerSchool(registration(), { ipAddress: "10.0.0.2" });

    expect(first.reference).toBe(`${PREFIX}-academy`);
    expect(second.reference).toBe(`${PREFIX}-academy-2`);

    const school = await prisma.school.findUniqueOrThrow({ where: { slug: first.reference } });
    expect(school.status).toBe("PENDING");
    expect(await prisma.user.count({ where: { schoolId: school.id } })).toBe(0);
  });

  it("silently discards a submission that fills the honeypot", async () => {
    const before = await prisma.school.count();
    const outcome = await registerSchool(
      registration({ name: `${PREFIX} Bot School`, website: "http://spam.example" }),
      { ipAddress: "10.0.0.3" },
    );
    expect(outcome.reference).toBeTruthy();
    expect(await prisma.school.count()).toBe(before);
  });

  it("rate-limits repeated registrations from one address", async () => {
    for (let i = 0; i < 5; i += 1) {
      await registerSchool(registration({ name: `${PREFIX} Flood ${i}` }), { ipAddress: "10.9.9.9" });
    }
    await expect(
      registerSchool(registration({ name: `${PREFIX} Flood 6` }), { ipAddress: "10.9.9.9" }),
    ).rejects.toThrow(/Too many/);
  });

  it("cannot sign in to a school that has not been approved", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Waiting`, contactEmail: `waiting@${PREFIX}.test` }),
      { ipAddress: "10.0.0.4" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    await prisma.user.create({
      data: {
        email: `early@${PREFIX}.test`,
        passwordHash: "x",
        role: "SCHOOL_ADMIN",
        firstName: "Early",
        lastName: "Bird",
        schoolId: school.id,
      },
    });
    const outcome = await authenticate(`early@${PREFIX}.test`, "anything");
    expect(outcome.ok).toBe(false);
  });
});

describe("approval", () => {
  it("activates, provisions the school and issues its first administrator once", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Approve Me`, contactEmail: `owner@${PREFIX}.test` }),
      { ipAddress: "10.0.1.1" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    await markVerified(reference);

    const { credentials } = await transitionSchool(superAdmin, school.id, "approve");
    expect(credentials?.email).toBe(`owner@${PREFIX}.test`);
    expect(credentials?.password).toMatch(/^(?=.*[a-zA-Z])(?=.*\d).{12}$/);

    const approved = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(approved.status).toBe("ACTIVE");
    expect(approved.reviewedById).toBe(superAdmin.id);

    expect(await prisma.class.count({ where: { schoolId: school.id } })).toBe(DEFAULT_GRADES.length);
    const session = await prisma.academicSession.findFirstOrThrow({ where: { schoolId: school.id } });
    expect(session.isCurrent).toBe(true);
    expect(session.name).toBe(currentAcademicYear().name);

    // The issued password really works.
    const login = await authenticate(credentials!.email, credentials!.password);
    expect(login.ok).toBe(true);

    // Approving again is refused rather than re-provisioning.
    await expect(transitionSchool(superAdmin, school.id, "approve")).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to approve before the contact email is verified", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Unverified`, contactEmail: `unverified@${PREFIX}.test` }),
      { ipAddress: "10.0.1.9" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await expect(transitionSchool(superAdmin, school.id, "approve")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).status).toBe(
      "PENDING",
    );
  });

  it("requires a reason to reject, and records it", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Reject Me` }),
      { ipAddress: "10.0.1.2" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    await expect(transitionSchool(superAdmin, school.id, "reject")).rejects.toBeInstanceOf(ConflictError);
    await transitionSchool(superAdmin, school.id, "reject", "Could not verify the school.");

    const rejected = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Could not verify the school.");
  });

  it("refuses every governance action to anyone but the Super Admin", async () => {
    const impostor: SessionUser = { ...superAdmin, role: "SCHOOL_ADMIN", schoolId: "x" };
    await expect(transitionSchool(impostor, "any", "approve")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("suspension", () => {
  it("signs the school's users out immediately and reactivation restores access", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Suspend Me`, contactEmail: `head@${PREFIX}.test` }),
      { ipAddress: "10.0.2.1" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    await markVerified(reference);
    await transitionSchool(superAdmin, school.id, "approve");

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: `head@${PREFIX}.test` } });
    const { token } = await createSession(admin.id);
    expect(await validateSessionToken(token)).not.toBeNull();

    await transitionSchool(superAdmin, school.id, "suspend", "Unpaid invoice.");
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(0);

    await transitionSchool(superAdmin, school.id, "reactivate");
    const fresh = await createSession(admin.id);
    expect(await validateSessionToken(fresh.token)).not.toBeNull();
  });
});

describe("administrators and subscriptions", () => {
  it("rejects a duplicate administrator email with a readable conflict", async () => {
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Admins` }),
      { ipAddress: "10.0.3.1" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });

    const input = {
      schoolId: school.id,
      firstName: "Second",
      lastName: "Admin",
      email: `second@${PREFIX}.test`,
    };
    const credentials = await createSchoolAdmin(superAdmin, input);
    expect(credentials.email).toBe(input.email);
    await expect(createSchoolAdmin(superAdmin, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates the latest subscription in place", async () => {
    const plan = await prisma.plan.upsert({
      where: { tier: "STARTER" },
      update: {},
      create: { tier: "STARTER", name: "Starter", priceMinor: 1500000 },
    });
    const { reference } = await registerSchool(
      registration({ name: `${PREFIX} Subscriber`, plan: "STARTER" }),
      { ipAddress: "10.0.3.2" },
    );
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference } });
    expect(await prisma.subscription.count({ where: { schoolId: school.id } })).toBe(1);

    await setSubscription(superAdmin, {
      schoolId: school.id,
      planId: plan.id,
      status: "ACTIVE",
      startsAt: new Date(Date.UTC(2026, 3, 1)),
      endsAt: new Date(Date.UTC(2027, 2, 31)),
      notes: null,
    });

    const rows = await prisma.subscription.findMany({ where: { schoolId: school.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ACTIVE");
  });
});

describe("homepage offers", () => {
  it("shows only active offers inside their date window", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = new Date();
    await prisma.platformOffer.createMany({
      data: [
        { title: `${PREFIX} live`, startsAt: new Date(now.getTime() - day), isActive: true },
        { title: `${PREFIX} expired`, startsAt: new Date(now.getTime() - 9 * day), endsAt: new Date(now.getTime() - day), isActive: true },
        { title: `${PREFIX} future`, startsAt: new Date(now.getTime() + day), isActive: true },
        { title: `${PREFIX} off`, startsAt: new Date(now.getTime() - day), isActive: false },
      ],
    });

    const titles = (await getLiveOffers(now)).map((offer) => offer.title).filter((t) => t.startsWith(PREFIX));
    expect(titles).toEqual([`${PREFIX} live`]);
  });
});
