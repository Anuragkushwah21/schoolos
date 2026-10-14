/**
 * Plan Builder audit (12 Oct): what the earlier Plan Builder tests did not
 * pin down.
 *
 *   * Editing keeps the saved configuration: a partial save — from the form
 *     or the API — changes only what it names.
 *   * The ladder cannot be side-stepped: no two plans share a place in the
 *     order, and a plan restored from the archive opens only if it still fits.
 *   * A plan can be copied; the copy is a draft, the original is untouched.
 *   * An archived plan takes nobody new, but its customers can still be updated.
 *   * Plan entitlement, campus activation and role are three separate checks,
 *     all on the server, also for direct API calls.
 *
 * Other plans in the test database are archived for this file and restored
 * afterwards, so the ladder only contains the plans made here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as listBooksRoute } from "@/app/api/v1/library/books/route";
import { PUT as putPlanRoute } from "@/app/api/v1/platform/plans/[planId]/route";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { planCreateSchema, registerSchoolSchema } from "@/lib/validation/platform";
import { createApiToken } from "@/server/auth/api-token";
import { createSession, type SessionUser, validateSessionToken } from "@/server/auth/session";
import { setCampusModules } from "@/server/campuses/modules";
import { prisma } from "@/server/db/prisma";
import { listBooks } from "@/server/operations/library";
import { getPublicPlans } from "@/server/platform/marketing";
import { requestPlanChange } from "@/server/platform/plan-requests";
import { archivePlan, createPlan, listPlans, publishPlan, restorePlan, savePlanDraft, setPlanActive } from "@/server/platform/plans";
import { registerSchool } from "@/server/platform/registration";
import { setSubscription } from "@/server/platform/schools";

import { apiRequest, callApi } from "../helpers/api";
import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "pet";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
const plans: Record<"basic" | "plus" | "legacy", string> = { basic: "", plus: "", legacy: "" };
let restoreStatuses: Array<{ id: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; isActive: boolean }> = [];
const token = { superAdmin: "", adminA: "" };

async function signedIn(userId: string) {
  return (await validateSessionToken((await createSession(userId)).token))!;
}

async function cleanUp() {
  const ours = await prisma.plan.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = ours.map((plan) => plan.id);
  await prisma.school.deleteMany({ where: { contactEmail: { contains: `@${PREFIX}.test` } } });
  await prisma.subscription.deleteMany({ where: { planId: { in: ids } } });
  await prisma.planChangeRequest.deleteMany({ where: { OR: [{ requestedPlanId: { in: ids } }, { currentPlanId: { in: ids } }] } });
  await prisma.plan.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
}

async function publishNew(name: string, config: Record<string, unknown>) {
  const { id } = await createPlan(superAdmin, { name });
  await savePlanDraft(superAdmin, id, { priceOnRequest: true, ...config });
  await publishPlan(superAdmin, id);
  return id;
}

async function draftOf(planId: string) {
  return (await listPlans(superAdmin)).find((plan) => plan.id === planId)!;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await cleanUp();
  restoreStatuses = await prisma.plan.findMany({ select: { id: true, status: true, isActive: true } });
  await prisma.plan.updateMany({ data: { status: "ARCHIVED" } });
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "E" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "E", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  token.superAdmin = (await createApiToken(superAdmin, { name: "pet super", scope: "FULL", expiresAt: null })).token;
  token.adminA = (await createApiToken(await signedIn(schoolA.adminUserId), { name: "pet admin A", scope: "FULL", expiresAt: null })).token;

  // School A is the first campus of its own organization, owned by its admin.
  let organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId }, select: { organizationId: true } })).organizationId;
  if (!organizationId) {
    organizationId = (await prisma.organization.create({ data: { name: "PET A", ownerId: schoolA.adminUserId } })).id;
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId } });
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { ownerId: schoolA.adminUserId, campusLimitOverride: null } });

  plans.basic = await publishNew("PET Basic", { displayOrder: 811, optionalModules: ["FINANCE", "EXPENSES"] });
  plans.plus = await publishNew("PET Plus", { displayOrder: 812, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] });
}, 60_000);

afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { name: { startsWith: "pet " } } });
  await cleanUp();
  for (const row of restoreStatuses) await prisma.plan.update({ where: { id: row.id }, data: { status: row.status, isActive: row.isActive } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"], modulesCustomized: false } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("editing keeps the saved configuration", () => {
  it("a partial draft save changes only what it names; the rest stays as saved", async () => {
    await savePlanDraft(superAdmin, plans.plus, { features: ["ORG_DASHBOARD"], priceOnRequest: false, priceMinor: 40_000_00, campusLimit: 2 });
    await savePlanDraft(superAdmin, plans.plus, { name: "PET Plus Renamed" });
    const { edited, live } = await draftOf(plans.plus);
    expect(edited).toMatchObject({ name: "PET Plus Renamed", features: ["ORG_DASHBOARD"], priceMinor: 40_000_00, priceOnRequest: false, campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] });
    // Nothing is published by saving.
    expect(live).toMatchObject({ name: "PET Plus", features: [], priceOnRequest: true, campusLimit: 1 });
    expect((await getPublicPlans()).find((plan) => plan.id === plans.plus)).toMatchObject({ name: "PET Plus", features: [] });
  });

  it("the API changes only the settings it is sent; only a Super Admin may", async () => {
    const put = (body: unknown, who: keyof typeof token = "superAdmin") => callApi(putPlanRoute, apiRequest(`/api/v1/platform/plans/${plans.plus}`, { method: "PUT", token: token[who], body }), { planId: plans.plus });
    const renamed = await put({ name: "PET Plus API" });
    expect(renamed.status).toBe(200);
    expect((await draftOf(plans.plus)).edited).toMatchObject({ name: "PET Plus API", features: ["ORG_DASHBOARD"], priceMinor: 40_000_00, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] });
    expect((await put({ priceRupees: 45_000 })).status).toBe(200);
    expect((await draftOf(plans.plus)).edited).toMatchObject({ name: "PET Plus API", priceMinor: 45_000_00, features: ["ORG_DASHBOARD"] });
    expect((await put({ name: "Taken over" }, "adminA")).status).toBe(403);
    expect((await draftOf(plans.plus)).edited?.name).toBe("PET Plus API");
    // Publish what was reviewed, so later tests start from it.
    await publishPlan(superAdmin, plans.plus);
  });
});

describe("the ladder cannot be side-stepped", () => {
  it("no two published plans share a place in the order", async () => {
    const { id } = await createPlan(superAdmin, { name: "PET Twin" });
    const { problems } = await savePlanDraft(superAdmin, id, { displayOrder: 811, optionalModules: ["FINANCE", "EXPENSES", "TRANSPORT"], priceOnRequest: true });
    expect(problems.join(" ")).toMatch(/Display order 811 is already used by PET Basic/);
    await expect(publishPlan(superAdmin, id)).rejects.toThrow(/already used by PET Basic/);
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(id);
    await prisma.plan.delete({ where: { id } });
  });

  it("a plan restored from the archive opens to new schools only if it still fits the ladder", async () => {
    await archivePlan(superAdmin, plans.plus);
    // While it was archived, the plan below gained Transport.
    await savePlanDraft(superAdmin, plans.basic, { optionalModules: ["FINANCE", "EXPENSES", "TRANSPORT"] });
    await publishPlan(superAdmin, plans.basic);
    await restorePlan(superAdmin, plans.plus);
    await expect(setPlanActive(superAdmin, plans.plus, true)).rejects.toThrow(/Not opened: .*missing Transport/);
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(plans.plus);
    // Fixed in a draft and published, it opens.
    await savePlanDraft(superAdmin, plans.plus, { optionalModules: ["FINANCE", "EXPENSES", "LIBRARY", "TRANSPORT"] });
    await publishPlan(superAdmin, plans.plus);
    await setPlanActive(superAdmin, plans.plus, true);
    expect((await getPublicPlans()).map((plan) => plan.slug)).toEqual(["pet-basic", "pet-plus"]);
  });
});

describe("copying a plan", () => {
  it("makes a draft with the plan's published settings; the original is untouched", async () => {
    expect(planCreateSchema.parse({ name: "PET Copy", templateKey: `copy:${plans.plus}` })).toEqual({ name: "PET Copy", templateKey: null, copyFromPlanId: plans.plus });
    expect(planCreateSchema.parse({ name: "PET Copy", templateKey: "pro" })).toEqual({ name: "PET Copy", templateKey: "pro", copyFromPlanId: null });
    expect(() => planCreateSchema.parse({ name: "PET Copy", templateKey: "enterprise" })).toThrow();

    const before = await prisma.plan.findUniqueOrThrow({ where: { id: plans.plus } });
    const { id } = await createPlan(superAdmin, { name: "PET Plus Copy", copyFromPlanId: plans.plus });
    const copy = await prisma.plan.findUniqueOrThrow({ where: { id } });
    expect(copy).toMatchObject({ status: "DRAFT", tier: null, optionalModules: before.optionalModules, features: before.features, priceMinor: before.priceMinor, priceOnRequest: before.priceOnRequest, campusLimit: before.campusLimit, availableRoles: before.availableRoles });
    expect(copy.displayOrder).toBeGreaterThan(before.displayOrder);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "PLAN_CREATED" } })).summary).toMatch(/copied from "PET Plus API"/);
    expect(await prisma.plan.findUniqueOrThrow({ where: { id: plans.plus } })).toMatchObject({ updatedAt: before.updatedAt, status: "PUBLISHED" });
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(id);
    await prisma.plan.delete({ where: { id } });
  });
});

describe("archived and unavailable plans", () => {
  it("an archived plan takes nobody new; an organization already on it can still be updated", async () => {
    plans.legacy = await publishNew("PET Legacy", { displayOrder: 813, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY", "TRANSPORT", "PAYROLL"] });
    await setSubscription(superAdmin, { schoolId: schoolB.schoolId, planId: plans.legacy, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await archivePlan(superAdmin, plans.legacy);

    // Its customer carries on, and its record can be kept up to date.
    await setSubscription(superAdmin, { schoolId: schoolB.schoolId, planId: plans.legacy, status: "PAST_DUE", startsAt: new Date(), endsAt: null, notes: "Renewal pending." });
    expect(await prisma.subscription.findFirstOrThrow({ where: { schoolId: schoolB.schoolId }, orderBy: { createdAt: "desc" } })).toMatchObject({ planId: plans.legacy, status: "PAST_DUE" });

    // Nobody new: not by the Super Admin, a plan request, or registration.
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plans.basic, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await expect(setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plans.legacy, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null })).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.subscription.findFirstOrThrow({ where: { schoolId: schoolA.schoolId }, orderBy: { createdAt: "desc" } })).planId).toBe(plans.basic);
    await expect(requestPlanChange(adminOf(schoolA), { planId: plans.legacy, note: null })).rejects.toBeInstanceOf(NotFoundError);
    const form = registerSchoolSchema.parse({ name: "PET Registered", city: "Indore", state: "Madhya Pradesh", contactName: "Owner Person", contactEmail: `reg@${PREFIX}.test`, contactPhone: "+91 98765 43212", password: "correct-horse-9", confirmPassword: "correct-horse-9", plan: "pet-legacy" });
    await expect(registerSchool(form, { ipAddress: "10.89.0.1" })).rejects.toBeInstanceOf(ValidationError);
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(plans.legacy);
  });
});

describe("plan entitlement, campus activation and role — three server checks", () => {
  const books = (who: keyof typeof token) => callApi(listBooksRoute, apiRequest("/api/v1/library/books", { token: token[who] }));

  it("in the plan but off for the campus: refused, and the message says the School Admin can switch it on", async () => {
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plans.plus, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES"] } });
    const refused = await books("adminA");
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/Library is in your plan but switched off for this campus/);

    await setCampusModules(adminOf(schoolA), schoolA.schoolId, ["FINANCE", "EXPENSES", "LIBRARY"]);
    expect((await books("adminA")).status).toBe(200);
    // Role: a teacher cannot use the library desk, module or not.
    await expect(listBooks(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("not in the plan: a kept module works until switched off, then cannot come back by any route", async () => {
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plans.basic, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    // Grandfathered: the downgrade did not switch it off.
    expect((await books("adminA")).status).toBe(200);
    await setCampusModules(adminOf(schoolA), schoolA.schoolId, ["FINANCE", "EXPENSES"]);
    const refused = await books("adminA");
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/Library is not part of your school's plan/);
    await expect(setCampusModules(adminOf(schoolA), schoolA.schoolId, ["FINANCE", "EXPENSES", "LIBRARY"])).rejects.toBeInstanceOf(ForbiddenError);
    // Another organization's admin cannot switch School A's modules.
    await expect(setCampusModules(adminOf(schoolB), schoolA.schoolId, ["FINANCE", "EXPENSES", "LIBRARY"])).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE", "EXPENSES"]);
  });
});
