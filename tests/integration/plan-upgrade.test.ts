/**
 * The first campus at registration, and Upgrade Plan.
 *
 *   * Registering a school creates exactly one organization with that school
 *     as its first campus (same id, name and approval lifecycle); a repeated
 *     registration creates nothing; approval does not add a second.
 *   * Every School Admin sees My Schools and Upgrade Plan.
 *   * Choosing a plan is a request: nothing changes — plan, modules, campus
 *     entitlement — until the Super Admin approves; then the subscription
 *     moves, once. Rejections need a reason; another school cannot touch it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { adminNav } from "@/lib/nav";
import { registerSchoolSchema } from "@/lib/validation/platform";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { campusLimitOf, ensureOrganization } from "@/server/platform/campuses";
import { approvePlanChange, cancelPlanChange, listPlanChangeRequests, planOverview, rejectPlanChange, requestPlanChange } from "@/server/platform/plan-requests";
import { registerSchool } from "@/server/platform/registration";
import { transitionSchool } from "@/server/platform/schools";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "plan-up-test";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let starter: { id: string };
let pro: { id: string };
const restore: Array<{ id: string; data: { optionalModules: string[]; campusLimit: number; isActive: boolean } }> = [];

function registration(email: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: `${PREFIX} Academy`, city: "Indore", state: "Madhya Pradesh", contactName: "Kavita Joshi", contactEmail: email, contactPhone: "+91 98765 43210", password: "correct-horse-9", confirmPassword: "correct-horse-9" })) form.set(key, value);
  return registerSchoolSchema.parse(Object.fromEntries(form));
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.school.deleteMany({ where: { contactEmail: { contains: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  const user = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "Platform", lastName: "Admin" } });
  superAdmin = { id: user.id, email: user.email, role: "SUPER_ADMIN", firstName: "Platform", lastName: "Admin", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  for (const [tier, data] of [["STARTER", { optionalModules: ["FINANCE"], campusLimit: 1, isActive: true }], ["PRO", { optionalModules: ["FINANCE", "LIBRARY", "TRANSPORT"], campusLimit: 3, isActive: true }]] as const) {
    const row = await prisma.plan.upsert({ where: { tier }, update: {}, create: { tier, slug: tier.toLowerCase(), name: tier[0] + tier.slice(1).toLowerCase(), priceMinor: tier === "PRO" ? 5000 : 100 } });
    restore.push({ id: row.id, data: { optionalModules: row.optionalModules, campusLimit: row.campusLimit, isActive: row.isActive } });
    await prisma.plan.update({ where: { id: row.id }, data: { ...data, optionalModules: [...data.optionalModules] } });
    if (tier === "STARTER") starter = row;
    else pro = row;
  }
  await prisma.subscription.create({ data: { schoolId: schoolA.schoolId, planId: starter.id, status: "ACTIVE", startsAt: new Date() } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE"] } });
}, 60_000);

afterAll(async () => {
  for (const row of restore) await prisma.plan.update({ where: { id: row.id }, data: row.data });
  const orgs = (await prisma.school.findMany({ where: { OR: [{ id: { in: [schoolA.schoolId, schoolB.schoolId] } }, { contactEmail: { contains: PREFIX } }] }, select: { organizationId: true } })).flatMap((row) => (row.organizationId ? [row.organizationId] : []));
  await prisma.school.deleteMany({ where: { contactEmail: { contains: PREFIX } } });
  await destroyIsolationFixture();
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await prisma.$disconnect();
});

describe("the first campus at registration", () => {
  it("creates exactly one organization, with the school as its first campus", async () => {
    const email = `kavita@${PREFIX}.test`;
    const { reference } = await registerSchool(registration(email), { ipAddress: "10.9.0.1" });
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference }, select: { id: true, name: true, status: true, organizationId: true, organization: { select: { name: true, ownerId: true, _count: { select: { schools: true } } } } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    expect(school).toMatchObject({ name: `${PREFIX} Academy`, status: "PENDING", organization: { name: `${PREFIX} Academy`, ownerId: admin.id, _count: { schools: 1 } } });

    // A repeated registration with the same address writes nothing.
    const organizations = await prisma.organization.count();
    await expect(registerSchool(registration(email), { ipAddress: "10.9.0.2" })).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.organization.count()).toBe(organizations);
    expect(await ensureOrganization(school.id)).toBe(school.organizationId);

    // Approval activates the same campus; no second organization.
    await prisma.school.update({ where: { id: school.id }, data: { contactEmailVerifiedAt: new Date() } });
    await transitionSchool(superAdmin, school.id, "approve");
    const approved = await prisma.school.findUniqueOrThrow({ where: { id: school.id }, select: { status: true, organizationId: true } });
    expect(approved).toEqual({ status: "ACTIVE", organizationId: school.organizationId });
    expect(await prisma.organization.count()).toBe(organizations);
  });
});

describe("Upgrade Plan", () => {
  it("every School Admin's sidebar has My Schools", () => {
    expect(adminNav({ leave: 0 }).map((item) => item.href)).toContain("/school-admin/campuses");
  });

  it("shows the current plan, the plans on offer and the campus entitlement", async () => {
    const overview = await planOverview(adminOf(schoolA));
    expect(overview.current?.id).toBe(starter.id);
    expect(overview.plans.map((plan) => plan.id)).toEqual(expect.arrayContaining([starter.id, pro.id]));
    expect(overview.plans.find((plan) => plan.id === pro.id)).toMatchObject({ campusLimit: 3, multiCampus: true });
    expect(overview.campus).toMatchObject({ limit: 1, used: 1 });
    await expect(planOverview(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("choosing a plan changes nothing until SchoolOS approves", async () => {
    const { id } = await requestPlanChange(adminOf(schoolA), { planId: pro.id, note: "Second campus in April" });
    const live = await prisma.subscription.findFirstOrThrow({ where: { schoolId: schoolA.schoolId }, orderBy: { createdAt: "desc" } });
    expect(live.planId).toBe(starter.id);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE"]);
    expect((await campusLimitOf(await ensureOrganization(schoolA.schoolId))).limit).toBe(1);
    expect((await planOverview(adminOf(schoolA))).open?.id).toBe(id);

    await expect(requestPlanChange(adminOf(schoolA), { planId: pro.id, note: null })).rejects.toThrow(/already have a plan request/);
    await expect(cancelPlanChange(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(approvePlanChange({ ...superAdmin, role: "SCHOOL_ADMIN" }, id, null)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listPlanChangeRequests(superAdmin, "PENDING")).map((row) => row.id)).toContain(id);

    await approvePlanChange(superAdmin, id, "Paid by bank transfer");
    await expect(approvePlanChange(superAdmin, id, null)).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.subscription.findFirstOrThrow({ where: { schoolId: schoolA.schoolId }, orderBy: { createdAt: "desc" } })).planId).toBe(pro.id);
    // The upgrade grants eligibility: modules stay as they were until the school switches them on.
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE"]);
    expect((await campusLimitOf(await ensureOrganization(schoolA.schoolId))).limit).toBe(3);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["PLAN_CHANGE_REQUESTED", "PLAN_CHANGE_APPROVED"]));
  });

  it("a rejection needs a reason; the same plan cannot be asked for; a request can be withdrawn", async () => {
    await expect(requestPlanChange(adminOf(schoolA), { planId: pro.id, note: null })).rejects.toThrow(/already on the Pro plan/);
    const { id } = await requestPlanChange(adminOf(schoolA), { planId: starter.id, note: null });
    await expect(rejectPlanChange(superAdmin, id, " ")).rejects.toThrow(/reason/);
    await rejectPlanChange(superAdmin, id, "Downgrades at renewal only");
    expect(await prisma.planChangeRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "REJECTED", rejectionReason: "Downgrades at renewal only" });
    expect((await prisma.subscription.findFirstOrThrow({ where: { schoolId: schoolA.schoolId }, orderBy: { createdAt: "desc" } })).planId).toBe(pro.id);

    const again = await requestPlanChange(adminOf(schoolA), { planId: starter.id, note: null });
    await cancelPlanChange(adminOf(schoolA), again.id);
    expect((await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: again.id } })).status).toBe("CANCELLED");
  });
});
