/**
 * A Super Admin plan change reaches the whole organization: every campus
 * moves to the plan, the School Admin's views read it, modules newly made
 * eligible stay off until switched on, and existing selections are kept.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { type SessionUser } from "@/server/auth/session";
import { campusModulesOverview } from "@/server/campuses/modules";
import { prisma } from "@/server/db/prisma";
import { currentPlanOf, organizationEntitlements } from "@/server/platform/entitlements";
import { planOverview } from "@/server/platform/plan-requests";
import { setSubscription } from "@/server/platform/schools";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "pcs";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let organizationId: string;
let secondId: string;
const plan = { starter: "", pro: "" };

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { plan: { slug: { startsWith: PREFIX } } } });
  await prisma.plan.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "A" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "A", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  plan.starter = (await prisma.plan.create({ data: { slug: `${PREFIX}-starter`, name: "PCS Starter", priceMinor: 100, displayOrder: 960, campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES"], status: "PUBLISHED" } })).id;
  plan.pro = (await prisma.plan.create({ data: { slug: `${PREFIX}-pro`, name: "PCS Pro", priceMinor: 200, displayOrder: 961, campusLimit: 3, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY", "TRANSPORT"], features: ["ORG_DASHBOARD"], status: "PUBLISHED" } })).id;

  const org = await prisma.organization.create({ data: { name: "PCS Group", ownerId: schoolA.adminUserId } });
  organizationId = org.id;
  await prisma.organization.updateMany({ where: { ownerId: schoolA.adminUserId, id: { not: org.id } }, data: { ownerId: null } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: org.id, optionalModules: ["FINANCE", "EXPENSES"] } });
  const second = await prisma.school.create({ data: { slug: `${PREFIX}-second`, name: "PCS Second", status: "ACTIVE", contactName: "x", contactEmail: `second@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: org.id, optionalModules: ["FINANCE"] } });
  secondId = second.id;
  for (const schoolId of [schoolA.schoolId, secondId]) await prisma.subscription.create({ data: { schoolId, planId: plan.starter, status: "ACTIVE", startsAt: new Date() } });
}, 60_000);

afterAll(async () => {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { planId: { in: [plan.starter, plan.pro] } } });
  await prisma.plan.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: null } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const base = { status: "ACTIVE" as const, startsAt: new Date(), endsAt: null, notes: null };

describe("a Super Admin plan change", () => {
  it("made from any campus's page moves the whole organization", async () => {
    // Changed from the second campus's page — the owner's view reads the organization's plan.
    await setSubscription(superAdmin, { schoolId: secondId, planId: plan.pro, ...base });
    expect((await currentPlanOf(schoolA.schoolId))?.id).toBe(plan.pro);
    expect((await currentPlanOf(secondId))?.id).toBe(plan.pro);
    expect((await organizationEntitlements(organizationId)).planName).toBe("PCS Pro");
    expect((await planOverview(adminOf(schoolA))).current?.name).toBe("PCS Pro");
  });

  it("makes new modules eligible but switches none on; existing selections are kept", async () => {
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE", "EXPENSES"]);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: secondId } })).optionalModules).toEqual(["FINANCE"]);
    const overview = await campusModulesOverview(adminOf(schoolA));
    expect(overview.eligible).toEqual(["FINANCE", "EXPENSES", "LIBRARY", "TRANSPORT"]);
    const own = overview.campuses.find((campus) => campus.id === schoolA.schoolId)!;
    expect(own.available).toEqual(["LIBRARY", "TRANSPORT"]);
    expect(overview.notInPlan.map((row) => row.key)).toEqual(["PAYROLL", "INVENTORY"]);
  });

  it("moving back down keeps an enabled module (grandfathered) but it cannot be switched on again", async () => {
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] } });
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plan.starter, ...base });
    expect((await currentPlanOf(secondId))?.id).toBe(plan.starter);
    const own = (await campusModulesOverview(adminOf(schoolA))).campuses.find((campus) => campus.id === schoolA.schoolId)!;
    expect(own.grandfathered).toEqual(["LIBRARY"]);
  });

  it("is a Super Admin's alone; a refused change leaves every campus as it was", async () => {
    await expect(setSubscription({ ...superAdmin, role: "SCHOOL_ADMIN" }, { schoolId: secondId, planId: plan.pro, ...base })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setSubscription(superAdmin, { schoolId: secondId, planId: "no-such-plan", ...base })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setSubscription(superAdmin, { schoolId: secondId, planId: plan.pro, ...base, endsAt: new Date(Date.UTC(2000, 0, 1)) })).rejects.toThrow(/end date/);
    for (const schoolId of [schoolA.schoolId, secondId]) expect((await currentPlanOf(schoolId))?.id).toBe(plan.starter);
    // Another school is never touched.
    expect((await prisma.subscription.findMany({ where: { schoolId: schoolB.schoolId, planId: { in: [plan.starter, plan.pro] } } }))).toEqual([]);
  });
});

describe("what the School Admin sees after a change", () => {
  it("navigation and dashboard count modules available to switch on; they stay closed until switched on", async () => {
    const { modulesAvailableToEnable } = await import("@/server/platform/entitlements");
    const { adminNav } = await import("@/lib/nav");
    const { assertModuleEnabled, hasModule } = await import("@/server/platform/modules");
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plan.pro, ...base });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES"] } });
    const available = await modulesAvailableToEnable(schoolA.schoolId);
    expect(available).toEqual({ planName: "PCS Pro", modules: ["LIBRARY", "TRANSPORT"] });
    const mySchools = adminNav({ leave: 0, modulesToEnable: available.modules.length }).find((item) => item.href === "/school-admin/campuses");
    expect(mySchools?.badge).toBe(2);
    // Eligible is not enabled: the module stays closed on the server until someone switches it on.
    expect(await hasModule({ schoolId: schoolA.schoolId }, "TRANSPORT")).toBe(false);
    await expect(assertModuleEnabled({ schoolId: schoolA.schoolId }, "TRANSPORT")).rejects.toBeInstanceOf(ForbiddenError);
    // A module not in the plan at all stays closed too.
    await expect(assertModuleEnabled({ schoolId: schoolA.schoolId }, "INVENTORY")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an approved plan request moves every campus; a failed approval leaves the request waiting and the plan unchanged", async () => {
    const { requestPlanChange, approvePlanChange } = await import("@/server/platform/plan-requests");
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plan.starter, ...base });
    const ok = await requestPlanChange(adminOf(schoolA), { planId: plan.pro, note: null });
    await approvePlanChange(superAdmin, ok.id, null);
    for (const schoolId of [schoolA.schoolId, secondId]) expect((await currentPlanOf(schoolId))?.id).toBe(plan.pro);

    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plan.starter, ...base });
    const failing = await requestPlanChange(adminOf(schoolA), { planId: plan.pro, note: null });
    // The plan is withdrawn to a draft before the Super Admin approves: the change cannot happen.
    await prisma.plan.update({ where: { id: plan.pro }, data: { status: "DRAFT" } });
    await expect(approvePlanChange(superAdmin, failing.id, null)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.planChangeRequest.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe("PENDING");
    for (const schoolId of [schoolA.schoolId, secondId]) expect((await currentPlanOf(schoolId))?.id).toBe(plan.starter);
    await prisma.plan.update({ where: { id: plan.pro }, data: { status: "PUBLISHED" } });
    await prisma.planChangeRequest.deleteMany({ where: { schoolId: schoolA.schoolId } });
  });
});
