/**
 * The Super Admin's organization page: one plan for every campus, a
 * comparison before saving, legacy mixed plans detected and fixed, and the
 * School Admin's views following — with modules never switched on by it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { superAdminNav } from "@/lib/nav";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { currentPlanOf, modulesAvailableToEnable } from "@/server/platform/entitlements";
import { changeOrganizationPlan, listOrganizations, organizationDetail, planChangeOptions } from "@/server/platform/organizations";
import { planOverview } from "@/server/platform/plan-requests";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "orgp";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let organizationId: string;
let secondId: string;
let thirdId: string;
const plan = { small: "", big: "", draft: "" };
const base = { status: "ACTIVE" as const, startsAt: new Date(), endsAt: null, notes: null };

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { plan: { slug: { startsWith: PREFIX } } } });
  await prisma.plan.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "A" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "A", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  plan.small = (await prisma.plan.create({ data: { slug: `${PREFIX}-small`, name: "ORGP Small", priceMinor: 10_000_00, displayOrder: 970, campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"], status: "PUBLISHED" } })).id;
  plan.big = (await prisma.plan.create({ data: { slug: `${PREFIX}-big`, name: "ORGP Big", priceMinor: 30_000_00, displayOrder: 971, campusLimit: 3, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "TRANSPORT"], features: ["ORG_DASHBOARD"], status: "PUBLISHED" } })).id;
  plan.draft = (await prisma.plan.create({ data: { slug: `${PREFIX}-draft`, name: "ORGP Draft", priceMinor: 1, displayOrder: 972, status: "DRAFT" } })).id;

  const org = await prisma.organization.create({ data: { name: "ORGP Trust", ownerId: null } });
  organizationId = org.id;
  await prisma.organization.updateMany({ where: { ownerId: schoolA.adminUserId }, data: { ownerId: null } });
  await prisma.organization.update({ where: { id: org.id }, data: { ownerId: schoolA.adminUserId } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: org.id, optionalModules: ["FINANCE", "LIBRARY"] } });
  for (const key of ["second", "third"]) {
    const row = await prisma.school.create({ data: { slug: `${PREFIX}-${key}`, name: `ORGP ${key}`, status: "ACTIVE", contactName: "x", contactEmail: `${key}@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: org.id, optionalModules: ["FINANCE"] } });
    if (key === "second") secondId = row.id;
    else thirdId = row.id;
  }
  // Legacy data from before plans were kept in step: campuses on different plans.
  await prisma.subscription.create({ data: { schoolId: schoolA.schoolId, planId: plan.small, status: "ACTIVE", startsAt: new Date() } });
  await prisma.subscription.create({ data: { schoolId: secondId, planId: plan.big, status: "ACTIVE", startsAt: new Date() } });
  await prisma.subscription.create({ data: { schoolId: thirdId, planId: plan.small, status: "ACTIVE", startsAt: new Date() } });
}, 60_000);

afterAll(async () => {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.subscription.deleteMany({ where: { planId: { in: Object.values(plan) } } });
  await prisma.plan.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: null } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("organization page", () => {
  it("lists the organization, flags campuses on different plans, and shows each campus's modules", async () => {
    const row = (await listOrganizations(superAdmin, "ORGP")).find((entry) => entry.id === organizationId);
    expect(row).toMatchObject({ campuses: 3, mixedPlans: true, plan: { name: "ORGP Small" } });
    const detail = await organizationDetail(superAdmin, organizationId);
    expect(detail.mixedPlans).toBe(true);
    expect(detail.campuses.find((campus) => campus.id === secondId)?.differs).toBe(true);
    expect(detail.campuses.find((campus) => campus.id === schoolA.schoolId)).toMatchObject({ enabled: ["FINANCE", "LIBRARY"], available: ["EXPENSES"], kept: [] });
  });

  it("compares before saving: newly included, no longer included (and where kept on), price and campus cap", async () => {
    const big = (await planChangeOptions(superAdmin, organizationId)).find((option) => option.plan.id === plan.big)!;
    expect(big.newlyEligible).toEqual(["Payroll", "Transport"]);
    expect(big.noLongerIncluded).toEqual(["Library"]);
    expect(big.keptOn).toEqual([{ campus: expect.any(String), module: "Library" }]);
    expect(big.featuresGained).toEqual(["Organization dashboard"]);
    expect(big.overCap).toBeNull();
    const small = (await planChangeOptions(superAdmin, organizationId)).find((option) => option.plan.id === plan.small)!;
    expect(small.overCap).toEqual({ live: 3, cap: 2 });
    // Drafts are never offered.
    expect((await planChangeOptions(superAdmin, organizationId)).map((option) => option.plan.id)).not.toContain(plan.draft);
  });

  it("saving moves every campus (fixing mixed plans), keeps modules, and a double submit changes nothing", async () => {
    await expect(changeOrganizationPlan(superAdmin, { organizationId, planId: plan.small, ...base, confirmOverCap: false })).rejects.toBeInstanceOf(ConflictError);
    for (const schoolId of [schoolA.schoolId, secondId, thirdId]) expect((await currentPlanOf(schoolId))?.id).not.toBe(undefined);
    const result = await changeOrganizationPlan(superAdmin, { organizationId, planId: plan.big, ...base, confirmOverCap: false });
    expect(result).toEqual({ unchanged: false, campuses: 3 });
    for (const schoolId of [schoolA.schoolId, secondId, thirdId]) expect((await currentPlanOf(schoolId))?.id).toBe(plan.big);
    expect((await organizationDetail(superAdmin, organizationId)).mixedPlans).toBe(false);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE", "LIBRARY"]);

    const audits = await prisma.auditLog.count({ where: { schoolId: { in: [schoolA.schoolId, secondId, thirdId] }, action: "SUBSCRIPTION_UPDATED" } });
    expect(await changeOrganizationPlan(superAdmin, { organizationId, planId: plan.big, ...base, startsAt: new Date(), confirmOverCap: false })).toEqual({ unchanged: true, campuses: 3 });
    expect(await prisma.auditLog.count({ where: { schoolId: { in: [schoolA.schoolId, secondId, thirdId] }, action: "SUBSCRIPTION_UPDATED" } })).toBe(audits);
    // History on the page shows the change.
    expect((await organizationDetail(superAdmin, organizationId)).history.some((row) => row.action === "SCHOOL_PLAN_CHANGED")).toBe(true);
  });

  it("the School Admin sees the new plan; new modules are offered, not switched on; a kept one stays", async () => {
    expect((await planOverview(adminOf(schoolA))).current?.name).toBe("ORGP Big");
    expect(await modulesAvailableToEnable(schoolA.schoolId)).toEqual({ planName: "ORGP Big", modules: ["EXPENSES", "PAYROLL", "TRANSPORT"] });
    expect((await organizationDetail(superAdmin, organizationId)).campuses.find((campus) => campus.id === schoolA.schoolId)?.kept).toEqual(["LIBRARY"]);
  });

  it("refuses others, drafts and unknown organizations; another organization is untouched", async () => {
    await expect(changeOrganizationPlan({ ...superAdmin, role: "SCHOOL_ADMIN" }, { organizationId, planId: plan.small, ...base, confirmOverCap: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(organizationDetail({ ...superAdmin, role: "SCHOOL_ADMIN" }, organizationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeOrganizationPlan(superAdmin, { organizationId, planId: plan.draft, ...base, confirmOverCap: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(organizationDetail(superAdmin, "no-such-org")).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.subscription.count({ where: { schoolId: schoolB.schoolId, planId: { in: Object.values(plan) } } })).toBe(0);
  });

  it("the Super Admin sidebar is in five groups and includes Organizations", () => {
    const nav = superAdminNav({ pending: 0 });
    expect(nav.filter((item) => item.group).map((item) => item.group)).toEqual(["nav.groupOverview", "nav.groupCustomers", "nav.groupPlans", "nav.groupRequests", "nav.groupPlatform"]);
    expect(nav.map((item) => item.href)).toContain("/super-admin/organizations");
  });
});
