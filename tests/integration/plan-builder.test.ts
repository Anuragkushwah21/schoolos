/**
 * Dynamic plans end to end: the Plan Builder (draft → publish, ladder rules,
 * impact, archive), organization-level plans with campus-level modules,
 * extra-campus pricing, registration with a published plan, custom feature
 * requests, and the Live Demo's plan switcher.
 *
 * Other plans in the test database are archived for this file and restored
 * afterwards, so the ladder only contains the three plans made here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { campusRequestSchema } from "@/lib/validation/campuses";
import { registerSchoolSchema } from "@/lib/validation/platform";
import { createSession, type SessionUser, validateSessionToken } from "@/server/auth/session";
import { campusModulesOverview, setCampusModules } from "@/server/campuses/modules";
import { submitCampusRequest } from "@/server/campuses/requests";
import { prisma } from "@/server/db/prisma";
import { startDemo, switchDemoPlan } from "@/server/demo/sessions";
import { allCampusesSummary } from "@/server/platform/campuses";
import { organizationEntitlements } from "@/server/platform/entitlements";
import { commentOnMyFeatureRequest, decideFeatureRequest, myFeatureRequest, submitFeatureRequest } from "@/server/platform/feature-requests";
import { getPublicPlans } from "@/server/platform/marketing";
import { approvePlanChange, requestPlanChange } from "@/server/platform/plan-requests";
import { archivePlan, createPlan, discardPlanDraft, listPlans, planImpact, publishPlan, restorePlan, savePlanDraft, setPlanActive } from "@/server/platform/plans";
import { registerSchool } from "@/server/platform/registration";
import { setSubscription } from "@/server/platform/schools";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "pbt";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let owner: SessionUser;
let otherOwner: SessionUser;
const plans: Record<"starter" | "growth" | "pro", string> = { starter: "", growth: "", pro: "" };
let restoreStatuses: Array<{ id: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; isActive: boolean }> = [];
let organizationId: string;
let secondCampusId: string;

async function signedIn(userId: string) {
  return (await validateSessionToken((await createSession(userId)).token))!;
}

const DECISION = { note: null, internal: false, estimatedTimeline: null, estimatedCostMinor: null, costAgreed: false, potentialStandard: false, releaseScope: null, eligiblePlanIds: [], eligibleOrgIds: [], releaseNote: null, developedBy: null, testedBy: null };

async function cleanUp() {
  const ours = await prisma.plan.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = ours.map((plan) => plan.id);
  await prisma.school.deleteMany({ where: { OR: [{ slug: { startsWith: PREFIX } }, { contactEmail: { contains: `@${PREFIX}.test` } }] } });
  await prisma.subscription.deleteMany({ where: { planId: { in: ids } } });
  await prisma.planChangeRequest.deleteMany({ where: { OR: [{ requestedPlanId: { in: ids } }, { currentPlanId: { in: ids } }] } });
  await prisma.plan.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { contains: `@${PREFIX}.test` } } });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await cleanUp();
  restoreStatuses = await prisma.plan.findMany({ select: { id: true, status: true, isActive: true } });
  await prisma.plan.updateMany({ data: { status: "ARCHIVED" } });
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "A" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "A", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  owner = await signedIn(schoolA.adminUserId);
  otherOwner = await signedIn(schoolB.adminUserId);
  organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId }, select: { organizationId: true } })).organizationId ?? "";
  if (!organizationId) {
    const org = await prisma.organization.create({ data: { name: "PBT A", ownerId: schoolA.adminUserId } });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: org.id } });
    organizationId = org.id;
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { ownerId: schoolA.adminUserId, campusLimitOverride: null } });
}, 60_000);

afterAll(async () => {
  await prisma.featureRequest.deleteMany({ where: { organizationId } });
  await cleanUp();
  for (const row of restoreStatuses) await prisma.plan.update({ where: { id: row.id }, data: { status: row.status, isActive: row.isActive } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"], modulesCustomized: false } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("Plan Builder", () => {
  it("a new plan is a draft nobody sees; publishing makes it public and is audited", async () => {
    const { id } = await createPlan(superAdmin, { name: "PBT Starter" });
    plans.starter = id;
    expect((await prisma.plan.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(id);
    await savePlanDraft(superAdmin, id, { displayOrder: 901, priceMinor: 12_000_00, campusLimit: 1, optionalModules: ["FINANCE", "EXPENSES"], highlights: ["A complete school"] });
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(id);
    await publishPlan(superAdmin, id);
    const shown = (await getPublicPlans()).find((plan) => plan.id === id);
    expect(shown).toMatchObject({ slug: "pbt-starter", priceMinor: 12_000_00, campusLimit: 1, optionalModules: ["FINANCE", "EXPENSES"], highlights: ["A complete school"] });
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "PLAN_PUBLISHED" } })).toBe(1);

    for (const [key, name, order, config] of [
      ["growth", "PBT Growth", 902, { campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"], features: ["ORG_DASHBOARD"], priceOnRequest: true }],
      ["pro", "PBT Pro", 903, { campusLimit: 3, extraCampusAllowed: true, extraCampusPriceMinor: 5_000_00, maxCampuses: 5, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"], features: ["ORG_DASHBOARD", "FEATURE_REQUESTS"], priceMinor: 60_000_00 }],
    ] as const) {
      const row = await createPlan(superAdmin, { name });
      plans[key] = row.id;
      await savePlanDraft(superAdmin, row.id, { displayOrder: order, ...config });
      await publishPlan(superAdmin, row.id);
    }
    expect((await getPublicPlans()).map((plan) => plan.slug)).toEqual(["pbt-starter", "pbt-growth", "pbt-pro"]);
    expect((await getPublicPlans()).find((plan) => plan.slug === "pbt-growth")).toMatchObject({ priceOnRequest: true });
  });

  it("a draft of a published plan changes nothing public until published; discarding restores it", async () => {
    await savePlanDraft(superAdmin, plans.starter, { name: "PBT Starter Renamed" });
    expect((await getPublicPlans()).find((plan) => plan.id === plans.starter)?.name).toBe("PBT Starter");
    await discardPlanDraft(superAdmin, plans.starter);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plans.starter } })).draft).toBeNull();
    await expect(publishPlan(superAdmin, plans.starter)).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses publishing a plan that breaks the ladder or drops an essential module, saying why", async () => {
    const { problems } = await savePlanDraft(superAdmin, plans.pro, { optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "TRANSPORT"] });
    expect(problems.join(" ")).toMatch(/PBT Pro must include everything in PBT Growth: missing Library/);
    await expect(publishPlan(superAdmin, plans.pro)).rejects.toThrow(/missing Library/);
    await savePlanDraft(superAdmin, plans.pro, { optionalModules: ["FINANCE", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"] });
    await expect(publishPlan(superAdmin, plans.pro)).rejects.toThrow(/must include Expenses/);
    await discardPlanDraft(superAdmin, plans.pro);
    // A Super Admin only.
    await expect(savePlanDraft(owner, plans.pro, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("organization plan, campus modules", () => {
  it("publishing a plan never rewrites a campus's modules; the impact preview lists campuses that keep one", async () => {
    await setSubscription(superAdmin, { schoolId: schoolA.schoolId, planId: plans.growth, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] } });
    await savePlanDraft(superAdmin, plans.growth, { optionalModules: ["FINANCE", "EXPENSES", "PAYROLL"] });
    const impact = await planImpact(superAdmin, plans.growth);
    expect(impact.removed).toEqual(["LIBRARY"]);
    expect(impact.grandfathered).toEqual([expect.objectContaining({ modules: ["LIBRARY"] })]);
    expect(impact.notes.join(" ")).toMatch(/keep them until switched off/);
    await publishPlan(superAdmin, plans.growth);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE", "EXPENSES", "LIBRARY"]);
  });

  it("the owner switches eligible modules on; a module outside the plan is refused with the plans that have it; a kept module cannot come back", async () => {
    const ctx = adminOf(schoolA);
    const overview = await campusModulesOverview(ctx);
    expect(overview.eligible).toEqual(["FINANCE", "EXPENSES", "PAYROLL"]);
    expect(overview.campuses.find((campus) => campus.id === schoolA.schoolId)?.grandfathered).toEqual(["LIBRARY"]);

    await setCampusModules(ctx, schoolA.schoolId, ["FINANCE", "EXPENSES", "LIBRARY", "PAYROLL"]);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"]);
    await expect(setCampusModules(ctx, schoolA.schoolId, ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT"])).rejects.toThrow(/Transport is not part of your PBT Growth plan\. Available with PBT Pro/);
    // Switch the kept module off; it cannot be switched back on without the plan.
    await setCampusModules(ctx, schoolA.schoolId, ["FINANCE", "EXPENSES", "PAYROLL"]);
    await expect(setCampusModules(ctx, schoolA.schoolId, ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"])).rejects.toBeInstanceOf(ForbiddenError);
    // Another organization's campus is not reachable by id.
    await expect(setCampusModules(ctx, schoolB.schoolId, ["FINANCE"])).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.auditLog.count({ where: { entityId: schoolA.schoolId, action: "CAMPUS_MODULES_CHANGED" } })).toBeGreaterThanOrEqual(2);
  });

  it("a plan upgrade moves every campus of the organization, and switches no module on", async () => {
    const second = await prisma.school.create({ data: { slug: `${PREFIX}-second`, name: "PBT Second Campus", status: "ACTIVE", contactName: "x", contactEmail: `second@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId, optionalModules: ["FINANCE", "EXPENSES"] } });
    secondCampusId = second.id;
    await prisma.subscription.create({ data: { schoolId: second.id, planId: plans.growth, status: "ACTIVE", startsAt: new Date() } });
    const { id } = await requestPlanChange(adminOf(schoolA), { planId: plans.pro, note: null });
    await approvePlanChange(superAdmin, id, null);
    for (const schoolId of [schoolA.schoolId, second.id]) {
      const latest = await prisma.subscription.findFirstOrThrow({ where: { schoolId }, orderBy: { createdAt: "desc" } });
      expect(latest.planId).toBe(plans.pro);
    }
    expect((await prisma.school.findUniqueOrThrow({ where: { id: second.id } })).optionalModules).toEqual(["FINANCE", "EXPENSES"]);
    const entitlements = await organizationEntitlements(organizationId);
    expect(entitlements).toMatchObject({ planName: "PBT Pro", included: 3, cap: 5, extraAllowed: true, features: ["ORG_DASHBOARD", "FEATURE_REQUESTS"] });
  });

  it("the organization dashboard is a plan feature, checked on the server", async () => {
    await expect(allCampusesSummary(owner)).resolves.toMatchObject({ campuses: expect.any(Array) });
    for (const schoolId of [schoolA.schoolId, secondCampusId]) await setSubscription(superAdmin, { schoolId, planId: plans.starter, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await expect(allCampusesSummary(owner)).rejects.toThrow(/Organization dashboard is not part of your plan\. It comes with PBT Growth and PBT Pro/);
    for (const schoolId of [schoolA.schoolId, secondCampusId]) await setSubscription(superAdmin, { schoolId, planId: plans.pro, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
  });
});

describe("plan templates", () => {
  it("a plan created from a template starts with its modules, features, roles and campuses; without one it copies the top plan", async () => {
    // Without a template: a copy of the highest plan (PBT Pro here).
    const plain = await createPlan(superAdmin, { name: "PBT No Template" });
    expect(await prisma.plan.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ templateKey: null, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"] });
    await prisma.plan.delete({ where: { id: plain.id } });

    const { id } = await createPlan(superAdmin, { name: "PBT From Growth", templateKey: "growth" });
    const row = await prisma.plan.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "DRAFT", templateKey: "growth", campusLimit: 2, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"], features: ["ORG_DASHBOARD"] });
    expect(row.availableRoles).toContain("LIBRARIAN");
    expect(row.availableRoles).not.toContain("DRIVER");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "PLAN_CREATED" } })).summary).toMatch(/from the Growth template/);
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(id);

    await expect(createPlan(superAdmin, { name: "PBT Bad", templateKey: "enterprise" })).rejects.toBeInstanceOf(AppError);
    await expect(createPlan(owner, { name: "PBT Owner", templateKey: "pro" })).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.plan.delete({ where: { id } });
  });

  it("an edited plan keeps its saved selections, shows Customized, and restoring the template only happens by saving it", async () => {
    const { id } = await createPlan(superAdmin, { name: "PBT Custom", templateKey: "starter" });
    await savePlanDraft(superAdmin, id, { optionalModules: ["FINANCE", "EXPENSES", "TRANSPORT"], availableRoles: ["ACCOUNTANT", "DRIVER"] });
    // Reading the plan again (opening the editor) never resets it to the template.
    let shown = (await listPlans(superAdmin)).find((plan) => plan.id === id)!;
    expect(shown.edited?.optionalModules).toEqual(["FINANCE", "EXPENSES", "TRANSPORT"]);
    expect(shown.templateDiff).toMatchObject({ template: "Starter", customized: true, modules: { added: ["TRANSPORT"], removed: [] } });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "PLAN_DRAFT_SAVED" }, orderBy: { createdAt: "desc" } })).summary).toMatch(/customized from Starter/);

    // A role without its module is a warning, not a refusal.
    const { warnings } = await savePlanDraft(superAdmin, id, { optionalModules: ["FINANCE", "EXPENSES"], availableRoles: ["DRIVER"] });
    expect(warnings.join(" ")).toMatch(/Driver role is offered without Transport/);

    // Restore defaults = the template's selection, saved as a draft.
    const { optionalModules, features, availableRoles, campusLimit } = (await import("@/lib/plan-catalog")).templateSelection("starter");
    await savePlanDraft(superAdmin, id, { optionalModules, features, availableRoles, campusLimit, templateKey: "starter" });
    shown = (await listPlans(superAdmin)).find((plan) => plan.id === id)!;
    expect(shown.templateDiff).toMatchObject({ customized: false });
    expect(shown.warnings).toEqual([]);
    await prisma.plan.delete({ where: { id } });
  });

  it("a draft of a plan in use changes no organization's entitlements, and lists what it would change", async () => {
    const before = await organizationEntitlements(organizationId);
    const modulesBefore = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules;
    await savePlanDraft(superAdmin, plans.pro, { campusLimit: 4, templateKey: "pro" });
    expect(await organizationEntitlements(organizationId)).toEqual(before);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).optionalModules).toEqual(modulesBefore);
    const shown = (await listPlans(superAdmin)).find((plan) => plan.id === plans.pro)!;
    expect(shown.changes.join(" ")).toMatch(/campus/i);
    expect(shown.templateDiff).toMatchObject({ customized: true, campuses: { from: 3, to: 4 } });
    await discardPlanDraft(superAdmin, plans.pro);
    expect((await getPublicPlans()).find((plan) => plan.id === plans.pro)?.campusLimit).toBe(3);
    await expect(listPlans(owner)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("extra campuses", () => {
  const request = (name: string) => campusRequestSchema.parse({ name, city: "Indore", state: "Madhya Pradesh", contactName: "Asha Rao", contactEmail: `campus@${PREFIX}.test`, contactPhone: "+91 98765 43210", modules: [], roles: [] });

  it("past the included campuses a request is quoted the plan's extra-campus price; past the cap it needs an upgrade", async () => {
    await prisma.school.create({ data: { slug: `${PREFIX}-third`, name: "PBT Third Campus", status: "ACTIVE", contactName: "x", contactEmail: `third@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId } });
    // 3 campuses, 3 included: the next is campus 4 — quoted ₹5,000.
    const { id } = await submitCampusRequest(adminOf(schoolA), request("PBT Fourth Campus"), {});
    const row = await prisma.campusRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ quotedExtraFeeMinor: 5_000_00, quotedExtraPeriod: "YEARLY" });
    expect(row.entitlementNotes[0]).toMatch(/Extra campus beyond the 3 included: quoted ₹5,000 per year/);
    // Fill to the cap of 5 (3 live + 1 pending + 1 more live): the next one is beyond it.
    await prisma.school.create({ data: { slug: `${PREFIX}-fifth`, name: "PBT Fifth Campus", status: "ACTIVE", contactName: "x", contactEmail: `fifth@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId } });
    const beyond = await submitCampusRequest(adminOf(schoolA), request("PBT Sixth Campus"), {});
    const beyondRow = await prisma.campusRequest.findUniqueOrThrow({ where: { id: beyond.id } });
    expect(beyondRow.quotedExtraFeeMinor).toBeNull();
    expect(beyondRow.entitlementNotes.join(" ")).toMatch(/Campus limit: the plan includes 3 \(cap 5\)/);
    await prisma.campusRequest.deleteMany({ where: { organizationId } });
  });
});

describe("registration with a published plan", () => {
  const form = (email: string, plan: string) => registerSchoolSchema.parse({ name: `PBT Registered ${email.split("@")[0]}`, city: "Bhopal", state: "Madhya Pradesh", contactName: "Owner Person", contactEmail: email, contactPhone: "+91 98765 43211", password: "correct-horse-9", confirmPassword: "correct-horse-9", plan });

  it("records the chosen plan as a pending (trialing) subscription; a closed or unknown plan is refused", async () => {
    const { reference } = await registerSchool(form(`one@${PREFIX}.test`, "pbt-growth"), { ipAddress: "10.88.0.1" });
    const school = await prisma.school.findUniqueOrThrow({ where: { slug: reference }, select: { status: true, subscriptions: { select: { planId: true, status: true } }, _count: { select: { students: true } } } });
    expect(school).toMatchObject({ status: "PENDING", subscriptions: [{ planId: plans.growth, status: "TRIALING" }], _count: { students: 0 } });

    await setPlanActive(superAdmin, plans.growth, false);
    await expect(registerSchool(form(`two@${PREFIX}.test`, "pbt-growth"), { ipAddress: "10.88.0.2" })).rejects.toBeInstanceOf(ValidationError);
    await setPlanActive(superAdmin, plans.growth, true);
    await expect(registerSchool(form(`three@${PREFIX}.test`, "no-such-plan"), { ipAddress: "10.88.0.3" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.school.count({ where: { contactEmail: { in: [`two@${PREFIX}.test`, `three@${PREFIX}.test`] } } })).toBe(0);
  });

  it("archiving hides a plan from everyone new; organizations on it carry on", async () => {
    await archivePlan(superAdmin, plans.starter);
    expect((await getPublicPlans()).map((plan) => plan.id)).not.toContain(plans.starter);
    await restorePlan(superAdmin, plans.starter);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plans.starter } })).isActive).toBe(false);
    await setPlanActive(superAdmin, plans.starter, true);
  });
});

describe("custom feature requests", () => {
  const input = { title: "Bus pass printing", problem: "Parents ask for bus passes", description: "Print a pass per student", expectedOutcome: null, schoolId: null, moduleKey: "TRANSPORT", priority: "HIGH" as const, examples: null };

  it("only an owner whose plan includes them can ask; nobody else can read them", async () => {
    // On Pro: allowed.
    const { id } = await submitFeatureRequest(adminOf(schoolA), input);
    // The other organization's owner cannot read it.
    await expect(myFeatureRequest(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    // A campus id from another organization is refused.
    await expect(submitFeatureRequest(adminOf(schoolA), { ...input, schoolId: schoolB.schoolId })).rejects.toBeInstanceOf(NotFoundError);
    // A plan without the feature: refused, naming the plans that have it.
    void otherOwner;
    await setSubscription(superAdmin, { schoolId: schoolB.schoolId, planId: plans.growth, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    await expect(submitFeatureRequest(adminOf(schoolB), input)).rejects.toThrow(/Custom feature requests is not part of your plan\. It comes with PBT Pro/);
  });

  it("follows the review workflow: clarification, agreed cost before development, an explicit release scope", async () => {
    const row = await prisma.featureRequest.findFirstOrThrow({ where: { organizationId } });
    await expect(decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "IN_DEVELOPMENT" })).rejects.toBeInstanceOf(ConflictError);
    await expect(decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "NEEDS_INFO" })).rejects.toBeInstanceOf(AppError);
    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "NEEDS_INFO", note: "Which details go on the pass?" });
    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "NEEDS_INFO", note: "Internal: similar to library card", internal: true });
    await commentOnMyFeatureRequest(adminOf(schoolA), row.id, "Name, class, route and stop.");
    expect((await prisma.featureRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("UNDER_EVALUATION");
    // The owner never sees internal notes.
    const visible = await myFeatureRequest(adminOf(schoolA), row.id);
    expect(visible.events.map((event) => event.body)).not.toContain("Internal: similar to library card");
    expect(visible).not.toHaveProperty("eligibleOrgIds");

    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "APPROVED", estimatedCostMinor: 20_000_00, estimatedTimeline: "3 weeks" });
    await expect(decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "IN_DEVELOPMENT", estimatedTimeline: "3 weeks" })).rejects.toThrow(/Agree the cost/);
    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "IN_DEVELOPMENT", estimatedCostMinor: 20_000_00, estimatedTimeline: "3 weeks", costAgreed: true, developedBy: "Dev team" });
    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "TESTING", costAgreed: true, estimatedTimeline: "3 weeks", testedBy: "QA" });
    await expect(decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "RELEASED", costAgreed: true })).rejects.toThrow(/Decide what the released feature is/);
    await expect(decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "RELEASED", releaseScope: "STANDARD_FEATURE" })).rejects.toThrow(/Choose the plans/);
    await decideFeatureRequest(superAdmin, row.id, { ...DECISION, status: "RELEASED", releaseScope: "CUSTOMER_SPECIFIC", eligiblePlanIds: [plans.pro] });
    const released = await prisma.featureRequest.findUniqueOrThrow({ where: { id: row.id } });
    // A customization reaches the requester only — not every Pro customer.
    expect(released).toMatchObject({ status: "RELEASED", releaseScope: "CUSTOMER_SPECIFIC", eligibleOrgIds: [organizationId], releasedById: superAdmin.id });
    // Pro plan itself was not changed by the release.
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: plans.pro } })).features).toEqual(["ORG_DASHBOARD", "FEATURE_REQUESTS"]);
  });
});

describe("Live Demo plan switcher", () => {
  it("a sandbox starts on the chosen published plan and switches plan; only demo schools can", async () => {
    const started = await startDemo("SCHOOL_ADMIN", { ipAddress: "10.99.0.7", userAgent: null }, "pbt-starter");
    const user = (await validateSessionToken(started.token))!;
    const sandbox = () => prisma.school.findUniqueOrThrow({ where: { id: user.schoolId! }, select: { isDemo: true, optionalModules: true, subscriptions: { select: { planId: true } } } });
    expect(await sandbox()).toMatchObject({ isDemo: true, optionalModules: ["FINANCE", "EXPENSES"], subscriptions: [{ planId: plans.starter }] });
    await switchDemoPlan(user, "pbt-pro");
    expect(await sandbox()).toMatchObject({ optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT", "INVENTORY"], subscriptions: [{ planId: plans.pro }] });
    await expect(switchDemoPlan(user, "no-such-plan")).rejects.toBeInstanceOf(ForbiddenError);
    // A real school can never use the demo switcher, whatever it sends.
    await expect(switchDemoPlan({ ...owner, isDemo: true }, "pbt-starter")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(switchDemoPlan(owner, "pbt-starter")).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.school.deleteMany({ where: { id: user.schoolId!, isDemo: true } });
  });
});
