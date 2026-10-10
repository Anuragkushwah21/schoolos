/**
 * The Live Demo: a private, fictional sandbox per visitor, entered through a
 * server-made session — and fenced off from everything real.
 *
 *   * Each start makes its own sandbox (36 students, exams, fees…); visitors
 *     never share or see each other's sandbox, or any real school.
 *   * Role switching and reset stay inside the visitor's own sandbox and
 *     cannot be pointed elsewhere.
 *   * A sandbox ends at its expiry; clean-up removes it whole.
 *   * No email leaves a sandbox; passwords, API tokens, campuses and plans are
 *     refused; the platform's lists, reports and public pages never show it.
 *   * The real workflows run inside the sandbox: collect a fee, add a student.
 *   * Parents see only their children; students never see fees.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { today } from "@/lib/dates";
import { ForbiddenError, NotFoundError, RateLimitedError } from "@/lib/errors";
import { createStudentSchema } from "@/lib/validation/school";
import { campusRequestSchema } from "@/lib/validation/campuses";
import { requestPasswordReset, sendActivation } from "@/server/auth/account-links";
import { changePassword } from "@/server/auth/account";
import { createApiToken } from "@/server/auth/api-token";
import type { TenantContext } from "@/server/auth/current-user";
import { type SessionUser, validateSessionToken } from "@/server/auth/session";
import { submitCampusRequest } from "@/server/campuses/requests";
import { prisma } from "@/server/db/prisma";
import { DEMO_EMAIL_DOMAIN } from "@/server/demo/config";
import { cleanUpDemoSandboxes, resetDemo, startDemo, switchDemoRole } from "@/server/demo/sessions";
import { getReceipt } from "@/server/finance/receipts";
import { chargeStudent, createFeeHead, readStudentFees, recordPayment } from "@/server/finance/fees";
import { schoolsByStatus } from "@/server/analytics/platform";
import { listMyChildren } from "@/server/parent/access";
import { createStudent, listStudents } from "@/server/people/students";
import { switchCampus } from "@/server/platform/campuses";
import { requestPlanChange } from "@/server/platform/plan-requests";
import { getSchoolForPlatform, listSchools } from "@/server/platform/schools";
import { forSchool } from "@/server/tenancy/scope";
import { getPublicSchool } from "@/server/website/public";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let superAdmin: SessionUser;
let ip = 0;
const meta = () => ({ ipAddress: `203.0.113.${++ip}`, userAgent: "test" });
const sandboxes: string[] = [];

async function enter(role: Parameters<typeof startDemo>[0]) {
  const started = await startDemo(role, meta());
  const user = (await validateSessionToken(started.token))!;
  sandboxes.push(user.schoolId!);
  const ctx: TenantContext = { user, schoolId: user.schoolId!, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(user.schoolId!) };
  return { ...started, user, ctx };
}

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
  const sa = await prisma.user.create({ data: { email: "super@live-demo-test.test", passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "A" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "A", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
}, 60_000);

afterAll(async () => {
  await prisma.school.deleteMany({ where: { id: { in: sandboxes }, isDemo: true } });
  await prisma.user.deleteMany({ where: { email: "super@live-demo-test.test" } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("entering the demo", () => {
  it("each visitor gets their own fictional sandbox, signed in without any password", async () => {
    const admin = await enter("SCHOOL_ADMIN");
    expect(admin.user).toMatchObject({ role: "SCHOOL_ADMIN", isDemo: true, schoolName: "Green Valley Demo School" });
    expect(admin.home).toBe("/school-admin/dashboard");
    const school = await prisma.school.findUniqueOrThrow({ where: { id: admin.ctx.schoolId }, select: { isDemo: true, demoExpiresAt: true, _count: { select: { students: true, teachers: true, assessmentResults: true, feePayments: true } } } });
    expect(school.isDemo).toBe(true);
    expect(school._count.students).toBe(36);
    expect(school._count.teachers).toBe(6);
    expect(school._count.assessmentResults).toBeGreaterThan(0);
    expect(school._count.feePayments).toBeGreaterThan(0);
    // The session ends with the sandbox.
    expect(admin.expiresAt.getTime()).toBe(school.demoExpiresAt!.getTime());
    // Every login is on the undeliverable demo domain.
    const emails = await prisma.user.findMany({ where: { schoolId: admin.ctx.schoolId }, select: { email: true } });
    expect(emails.every((row) => row.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);

    const other = await enter("SCHOOL_ADMIN");
    expect(other.ctx.schoolId).not.toBe(admin.ctx.schoolId);
    // Visitors never see each other's sandbox, nor a real school.
    const mine = JSON.stringify(await listStudents(admin.ctx, {}));
    const theirs = await prisma.student.findFirstOrThrow({ where: { schoolId: other.ctx.schoolId } });
    expect(mine).not.toContain(theirs.id);
    expect(mine).not.toContain(schoolA.studentIds[0]!);
  });

  it("every role opens its own home in the same kind of sandbox", async () => {
    for (const role of ["PRINCIPAL", "TEACHER", "PARENT", "STUDENT", "ACCOUNTANT"] as const) {
      const visit = await enter(role);
      expect(visit.user.isDemo).toBe(true);
      expect(visit.user.role).toBe(role === "ACCOUNTANT" ? "NON_TEACHING_STAFF" : role);
    }
  });

  it("starting is rate-limited per address", async () => {
    const address = { ipAddress: "198.51.100.77", userAgent: "test" };
    let refused = false;
    for (let i = 0; i < 8; i += 1) {
      try {
        const started = await startDemo("TEACHER", address);
        sandboxes.push((await validateSessionToken(started.token))!.schoolId!);
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitedError);
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });
});

describe("switching, resetting, expiry", () => {
  it("switching role stays inside the visitor's own sandbox; a real user cannot use it", async () => {
    const admin = await enter("SCHOOL_ADMIN");
    const parent = await switchDemoRole(admin.user, admin.token, "PARENT");
    const asParent = (await validateSessionToken(parent.token))!;
    expect(asParent).toMatchObject({ role: "PARENT", schoolId: admin.ctx.schoolId, isDemo: true });
    // The old session is gone.
    expect(await validateSessionToken(admin.token)).toBeNull();
    const realAdmin = { ...admin.user, id: schoolA.adminUserId, schoolId: schoolA.schoolId, isDemo: false };
    await expect(switchDemoRole(realAdmin, "nope", "PARENT")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("start over gives a fresh sandbox and deletes the old one", async () => {
    const visit = await enter("TEACHER");
    const fresh = await resetDemo(visit.user, visit.token, "TEACHER", meta());
    const next = (await validateSessionToken(fresh.token))!;
    sandboxes.push(next.schoolId!);
    expect(next.schoolId).not.toBe(visit.ctx.schoolId);
    expect(await prisma.school.count({ where: { id: visit.ctx.schoolId } })).toBe(0);
  });

  it("an expired sandbox signs nobody in, and clean-up removes it whole", async () => {
    const visit = await enter("PARENT");
    await prisma.school.update({ where: { id: visit.ctx.schoolId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(visit.token)).toBeNull();
    await cleanUpDemoSandboxes();
    expect(await prisma.school.count({ where: { id: visit.ctx.schoolId } })).toBe(0);
    expect(await prisma.student.count({ where: { schoolId: visit.ctx.schoolId } })).toBe(0);
    // A real school is never touched by clean-up.
    expect(await prisma.school.count({ where: { id: schoolA.schoolId } })).toBe(1);
  });
});

describe("fenced off from everything real", () => {
  it("no email leaves a sandbox — not even to an address a visitor typed in", async () => {
    const admin = await enter("SCHOOL_ADMIN");
    const section = await prisma.section.findFirstOrThrow({ where: { schoolId: admin.ctx.schoolId } });
    const result = await createStudent(admin.ctx, createStudentSchema.parse({ firstName: "Test", lastName: "Visitor", sectionId: section.id, guardianMode: "new", parentFirstName: "Real", parentLastName: "Person", parentPhone: "+91 9876500001", parentEmail: "someone.real@example.com", relationship: "FATHER", confirmDuplicate: "on" }));
    expect(result.invites.every((invite) => !invite.delivered)).toBe(true);
    const parentUser = await prisma.user.findFirstOrThrow({ where: { email: "someone.real@example.com", schoolId: admin.ctx.schoolId } });
    expect((await sendActivation(parentUser.id, null)).delivered).toBe(false);
    await requestPasswordReset("someone.real@example.com");
    // No activation or reset link was ever issued, so nothing could have been emailed.
    expect(await prisma.accountToken.count({ where: { userId: parentUser.id } })).toBe(0);
  });

  it("passwords, API tokens, campuses and plans are refused", async () => {
    const admin = await enter("SCHOOL_ADMIN");
    await expect(changePassword(admin.user, admin.token, { currentPassword: "x", newPassword: "a-long-new-password-1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createApiToken(admin.user, { name: "t", scope: "READ", expiresAt: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(switchCampus(admin.user, admin.token, null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(submitCampusRequest(admin.ctx, campusRequestSchema.parse({ name: "X", city: "Y", state: "Z", contactName: "A", contactEmail: "a@example.com", contactPhone: "+91 9876543210" }), {})).rejects.toBeInstanceOf(ForbiddenError);
    const plan = await prisma.plan.findFirst({ select: { id: true } });
    if (plan) await expect(requestPlanChange(admin.ctx, { planId: plan.id, note: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the platform's lists, reports and public pages never show a sandbox", async () => {
    const admin = await enter("SCHOOL_ADMIN");
    const listed = await listSchools(superAdmin, { q: "Green Valley Demo" });
    expect(listed.rows.map((row) => row.id)).not.toContain(admin.ctx.schoolId);
    await expect(getSchoolForPlatform(superAdmin, admin.ctx.schoolId)).rejects.toBeInstanceOf(NotFoundError);
    const before = await schoolsByStatus(superAdmin);
    expect(before.total).toBe(await prisma.school.count({ where: { isDemo: false } }));
    const slug = (await prisma.school.findUniqueOrThrow({ where: { id: admin.ctx.schoolId }, select: { slug: true } })).slug;
    expect(await getPublicSchool(slug)).toBeNull();
  });
});

describe("the real workflows, inside the sandbox", () => {
  it("collects a fee and issues a receipt — in the sandbox only", async () => {
    const accountant = await enter("ACCOUNTANT");
    const student = await prisma.student.findFirstOrThrow({ where: { schoolId: accountant.ctx.schoolId } });
    const head = await createFeeHead(accountant.ctx, { name: "Demo test fee", note: null });
    await chargeStudent(accountant.ctx, { studentId: student.id, feeHeadId: head.id, amountMinor: 500_00, dueOn: today(), notes: null });
    const payment = await recordPayment(accountant.ctx, { studentId: student.id, amountMinor: 500_00, paidOn: today(), method: "CASH", notes: null, receiptNo: "DEMO-T-1" });
    expect((await getReceipt(accountant.ctx, payment.id)).payment.receiptNo).toBe("DEMO-T-1");
    // A real school's student cannot be charged from a sandbox.
    await expect(recordPayment(accountant.ctx, { studentId: schoolA.studentIds[0]!, amountMinor: 1, paidOn: today(), method: "CASH", notes: null, receiptNo: "DEMO-T-2" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.feePayment.count({ where: { schoolId: schoolA.schoolId, receiptNo: { startsWith: "DEMO-T" } } })).toBe(0);
  });

  it("the demo parent sees exactly their two children; the demo student never sees fees", async () => {
    const parent = await enter("PARENT");
    const { children } = await listMyChildren(parent.ctx);
    expect(children.map((child) => child.name).sort()).toEqual(["Ananya Sharma", "Kabir Sharma"]);
    await expect(readStudentFees(parent.ctx, children[0]!.id)).resolves.toHaveProperty("summary");

    const student = await enter("STUDENT");
    const anyPayment = await prisma.feePayment.findFirstOrThrow({ where: { schoolId: student.ctx.schoolId } });
    await expect(getReceipt(student.ctx, anyPayment.id)).rejects.toBeInstanceOf(ForbiddenError);
    // A real school's admin context cannot reach a sandbox's records either.
    expect(JSON.stringify(await listStudents(adminOf(schoolA), {}))).not.toContain(anyPayment.studentId);
  });
});
