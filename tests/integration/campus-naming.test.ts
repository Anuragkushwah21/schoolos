/**
 * The first campus is the school that registered: one School row, named as
 * registered, inside an Organization of the same name — and renaming the
 * school renames the campus everywhere, without touching ids or records.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { registerSchoolSchema, } from "@/lib/validation/platform";
import { websiteProfileSchema } from "@/lib/validation/website";
import { createSession, type SessionUser, validateSessionToken } from "@/server/auth/session";
import { forSchool } from "@/server/tenancy/scope";
import { prisma } from "@/server/db/prisma";
import { myOrganization, switchCampus } from "@/server/platform/campuses";
import { registerSchool } from "@/server/platform/registration";
import { renameSchool, transitionSchool } from "@/server/platform/schools";
import { updateWebsiteProfile } from "@/server/website/admin";

import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "naming-test";
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let schoolId: string;
let adminUserId: string;

const form = (email: string) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "Green Valley Academy", city: "Gwalior", state: "Madhya Pradesh", contactName: "Owner Person", contactEmail: email, contactPhone: "+91 98765 43210", password: "correct-horse-9", confirmPassword: "correct-horse-9" })) data.set(key, value);
  return registerSchoolSchema.parse(Object.fromEntries(data));
};

async function signedIn(userId: string) {
  const { token } = await createSession(userId);
  return { token, user: (await validateSessionToken(token))! };
}

beforeAll(async () => {
  ({ schoolB } = await createIsolationFixture());
  await prisma.school.deleteMany({ where: { contactEmail: { contains: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "A" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "A", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
}, 60_000);

afterAll(async () => {
  const orgs = (await prisma.school.findMany({ where: { OR: [{ contactEmail: { contains: PREFIX } }, { id: schoolB.schoolId }] }, select: { organizationId: true } })).flatMap((row) => (row.organizationId ? [row.organizationId] : []));
  await prisma.school.deleteMany({ where: { contactEmail: { contains: PREFIX } } });
  await destroyIsolationFixture();
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await prisma.$disconnect();
});

describe("registration makes the first campus", () => {
  it("one School named as registered, in an Organization of the same name, owned by the registering admin", async () => {
    const email = `owner@${PREFIX}.test`;
    const { reference } = await registerSchool(form(email), { ipAddress: "10.77.0.1" });
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference }, select: { id: true, name: true, city: true, organization: { select: { id: true, name: true, ownerId: true, _count: { select: { schools: true } } } } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, schoolId: true, role: true } });
    schoolId = school.id;
    adminUserId = admin.id;
    expect(school).toMatchObject({ name: "Green Valley Academy", city: "Gwalior", organization: { name: "Green Valley Academy", ownerId: admin.id, _count: { schools: 1 } } });
    expect(admin).toMatchObject({ schoolId: school.id, role: "SCHOOL_ADMIN" });

    // Submitting again creates nothing.
    const before = { schools: await prisma.school.count(), orgs: await prisma.organization.count() };
    await expect(registerSchool(form(email), { ipAddress: "10.77.0.2" })).rejects.toBeInstanceOf(ConflictError);
    expect({ schools: await prisma.school.count(), orgs: await prisma.organization.count() }).toEqual(before);

    // Approval activates the same campus — no second school or organization.
    await prisma.school.update({ where: { id: school.id }, data: { contactEmailVerifiedAt: new Date() } });
    await transitionSchool(superAdmin, school.id, "approve");
    expect({ schools: await prisma.school.count(), orgs: await prisma.organization.count() }).toEqual(before);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).organizationId).toBe(school.organization!.id);
  });

  it("My Schools and the session show the registered name and location", async () => {
    const { user } = await signedIn(adminUserId);
    expect(user.schoolName).toBe("Green Valley Academy");
    const organization = await myOrganization(user);
    expect(organization).toMatchObject({ name: "Green Valley Academy", isOwner: true, count: 1 });
    expect(organization.schools).toEqual([expect.objectContaining({ id: schoolId, name: "Green Valley Academy", city: "Gwalior", status: "ACTIVE" })]);
  });
});

describe("renaming", () => {
  it("a Super Admin rename shows everywhere; the single-campus organization follows; the id stays", async () => {
    await renameSchool(superAdmin, schoolId, "Green Valley Academy, Gwalior");
    const { user } = await signedIn(adminUserId);
    expect(user).toMatchObject({ schoolId, schoolName: "Green Valley Academy, Gwalior" });
    const organization = await myOrganization(user);
    expect(organization.name).toBe("Green Valley Academy, Gwalior");
    expect(organization.schools[0]).toMatchObject({ id: schoolId, name: "Green Valley Academy, Gwalior" });
    await expect(renameSchool(user, schoolId, "Hijack")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the School Admin's own profile edit renames the campus too", async () => {
    const { user } = await signedIn(adminUserId);
    const ctx = { user, schoolId, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(schoolId) };
    await updateWebsiteProfile(ctx, websiteProfileSchema.parse({ name: "GVA Gwalior", primaryColor: "#1e40af", secondaryColor: "#f59e0b", logoUrl: "", bannerUrl: "" }));
    expect((await myOrganization(user)).schools[0]?.name).toBe("GVA Gwalior");
    expect((await myOrganization(user)).name).toBe("GVA Gwalior");
  });

  it("an owner's group name for several campuses is never overwritten", async () => {
    const orgId = (await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { organizationId: true } })).organizationId!;
    await prisma.organization.update({ where: { id: orgId }, data: { name: "Valley Education Trust" } });
    const second = await prisma.school.create({ data: { slug: `${PREFIX}-second`, name: "Valley Junior", status: "ACTIVE", contactName: "x", contactEmail: `second@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: orgId } });
    await renameSchool(superAdmin, schoolId, "GVA Main Campus");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).name).toBe("Valley Education Trust");
    const { user } = await signedIn(adminUserId);
    expect((await myOrganization(user)).schools.map((row) => row.name).sort()).toEqual(["GVA Main Campus", "Valley Junior"]);
    // Switching never reaches another organization's school.
    const session = await signedIn(adminUserId);
    await expect(switchCampus(session.user, session.token, schoolB.schoolId)).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.school.delete({ where: { id: second.id } });
  });
});
