/**
 * Plans, optional modules and the Super Admin's control of them.
 *
 *   * Approval takes a plan; the school gets that plan's optional modules, or
 *     a set adjusted for it (audited with the plan and modules).
 *   * Manage features changes one school only; unknown modules are ignored;
 *     enabled/disabled and previous → new are audited. A School Admin cannot.
 *   * A plan change grants eligibility; the campus's switched-on modules stay
 *     as they are (owners switch newly eligible ones on).
 *   * Enforcement: with Fees off, the School Admin's fee services refuse,
 *     staff fee grants open nothing, and dashboards and alerts still load.
 *   * The other school keeps everything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { OPTIONAL_MODULE_KEYS } from "@/lib/school-modules";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { getAdminAlerts } from "@/server/alerts/feeds";
import { needsAttention } from "@/server/analytics/today";
import { staffGrants } from "@/server/auth/staff-access";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { listFeePositions } from "@/server/finance/fees";
import { setSalary } from "@/server/finance/salary";
import { getParentAlerts } from "@/server/parent/alerts";
import { hasModule, schoolModules } from "@/server/platform/modules";
import { setSchoolModules, setSubscription, transitionSchool } from "@/server/platform/schools";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "modules-test";
let superAdmin: SessionUser;
let schoolA: SeededSchool;
let schoolB: SeededSchool;
const plans: Record<"STARTER" | "STANDARD" | "PRO", { id: string; name: string }> = {} as never;

async function pendingSchool(key: string) {
  return prisma.school.create({
    data: { slug: `${PREFIX}-${key}`, name: `${PREFIX} ${key}`, contactName: "Kavita Joshi", contactEmail: `${key}@${PREFIX}.test`, contactPhone: "+91 98765 43210", contactEmailVerifiedAt: new Date(), status: "PENDING", optionalModules: [] },
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  const user = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner" } });
  superAdmin = { id: user.id, email: user.email, role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null } as SessionUser;
  const base = { description: null, priceMinor: 100, maxStudents: null, maxTeachers: null, maxAdmins: null, storageMb: null, isActive: true };
  for (const [tier, modules] of [["STARTER", ["FINANCE"]], ["STANDARD", ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"]], ["PRO", [...OPTIONAL_MODULE_KEYS]]] as const) {
    const row = await prisma.plan.upsert({ where: { tier }, update: {}, create: { tier, slug: tier.toLowerCase(), name: tier[0] + tier.slice(1).toLowerCase(), ...base } });
    await prisma.plan.update({ where: { id: row.id }, data: { optionalModules: [...modules] } });
    plans[tier] = { id: row.id, name: row.name };
  }
}, 60_000);

afterAll(async () => {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("approval with a plan", () => {
  it("the school gets the chosen plan's modules, and the audit names plan and modules", async () => {
    const school = await pendingSchool("standard");
    await transitionSchool(superAdmin, school.id, "approve", null, { planId: plans.STANDARD.id });
    const after = await prisma.school.findUniqueOrThrow({ where: { id: school.id }, include: { subscriptions: { include: { plan: true } } } });
    expect(after.status).toBe("ACTIVE");
    expect(after.optionalModules).toEqual(["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"]);
    expect(after.modulesCustomized).toBe(false);
    expect(after.subscriptions[0]).toMatchObject({ planId: plans.STANDARD.id, status: "ACTIVE" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "SCHOOL_APPROVED" } });
    expect(audit.summary).toMatch(/Plan: Standard\. Modules: Fees & finance, Expenses, Payroll, Library/);
    expect(audit.metadata).toMatchObject({ from: "PENDING", to: "ACTIVE", plan: "Standard", modulesCustomized: false });
  });

  it("adjusted at approval: kept as this school's own set, unknown keys dropped", async () => {
    const school = await pendingSchool("custom");
    await transitionSchool(superAdmin, school.id, "approve", null, { planId: plans.STARTER.id, modules: ["FINANCE", "TRANSPORT", "HOSTEL"] });
    const after = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(after.optionalModules).toEqual(["FINANCE", "TRANSPORT"]);
    expect(after.modulesCustomized).toBe(true);
  });
});

describe("manage features for one school", () => {
  it("changes only that school, audits enabled/disabled and previous → new; a School Admin cannot", async () => {
    const school = await pendingSchool("manage");
    await transitionSchool(superAdmin, school.id, "approve", null, { planId: plans.PRO.id });
    await setSchoolModules(superAdmin, { schoolId: school.id, followPlan: false, modules: ["FINANCE", "LIBRARY", "NOT_A_MODULE"] });
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).optionalModules).toEqual(["FINANCE", "LIBRARY"]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "SCHOOL_MODULES_CHANGED" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toMatch(/Disabled: Expenses, Payroll, Transport, Inventory/);
    expect(audit.metadata).toMatchObject({ previous: { optionalModules: [...OPTIONAL_MODULE_KEYS] }, next: { optionalModules: ["FINANCE", "LIBRARY"], customized: true } });
    // Back to the plan.
    await setSchoolModules(superAdmin, { schoolId: school.id, followPlan: true, modules: [] });
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).optionalModules).toEqual([...OPTIONAL_MODULE_KEYS]);
    // Never a School Admin.
    await expect(setSchoolModules(adminOf(schoolA).user as SessionUser, { schoolId: schoolA.schoolId, followPlan: false, modules: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a plan change grants eligibility only: the campus keeps its modules, and the audit says what is newly eligible", async () => {
    const school = await pendingSchool("follower");
    await transitionSchool(superAdmin, school.id, "approve", null, { planId: plans.STARTER.id });
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).optionalModules).toEqual(["FINANCE"]);

    await setSubscription(superAdmin, { schoolId: school.id, planId: plans.PRO.id, status: "ACTIVE", startsAt: new Date(), endsAt: null, notes: null });
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).optionalModules).toEqual(["FINANCE"]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "SCHOOL_PLAN_CHANGED" } });
    expect(audit.summary).toMatch(/Starter → Pro\. Modules unchanged \(Fees & finance\)\. Now eligible to switch on: Expenses, Payroll, Library, Transport, Inventory/);
  });
});

describe("enforcement in the school", () => {
  it("with Fees and Payroll off, the School Admin is refused, staff grants open nothing, dashboards still load", async () => {
    await setSchoolModules(superAdmin, { schoolId: schoolA.schoolId, followPlan: false, modules: ["LIBRARY"] });
    const admin = adminOf(schoolA);
    expect(await hasModule(admin, "FINANCE")).toBe(false);
    await expect(listFeePositions(admin)).rejects.toThrow(/not part of your school's plan/);
    await expect(setSalary(admin, { teacherId: schoolA.teacherId, salaryType: "MONTHLY", amountMinor: 1_00, allowancesMinor: 0, deductionsMinor: 0, effectiveFrom: new Date(), notes: null } as never)).rejects.toBeInstanceOf(ForbiddenError);

    const user = await prisma.user.create({ data: { email: `acc@${PREFIX}.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "Ravi", lastName: "Gupta", schoolId: schoolA.schoolId } });
    await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "MOD-ACC", firstName: "Ravi", lastName: "Gupta", role: "ACCOUNTANT", grants: STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT } });
    const accountant = contextFor(schoolA, user.id, "NON_TEACHING_STAFF");
    const grants = await staffGrants(accountant);
    expect(grants.some((grant) => grant.startsWith("fees.") || grant.startsWith("payroll.") || grant.startsWith("expenses."))).toBe(false);
    await expect(listFeePositions(accountant)).rejects.toBeInstanceOf(ForbiddenError);

    // Dashboards and alerts that read across modules still load.
    await expect(needsAttention(admin, { academicSessionId: schoolA.academicSessionId, registersPending: 0, staffMarked: 1, closedToday: false })).resolves.toBeInstanceOf(Array);
    await expect(getAdminAlerts(admin)).resolves.toBeInstanceOf(Array);
    const parentAlerts = await getParentAlerts(contextFor(schoolA, schoolA.parentUserId, "PARENT"));
    expect(parentAlerts.some((alert) => alert.kind === "fee-due" || alert.kind === "fee-paid")).toBe(false);
  });

  it("the other school keeps everything", async () => {
    expect(await schoolModules(schoolB.schoolId)).toEqual([...OPTIONAL_MODULE_KEYS]);
    await expect(listFeePositions(adminOf(schoolB))).resolves.toHaveProperty("rows");
  });
});
