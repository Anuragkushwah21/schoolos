/**
 * Membership reminders: the Super Admin emails one school or many that their
 * plan or trial is ending (one email per organization, to its owner, else a
 * School Admin, else the contact), the School Admin sees it in their alerts,
 * and nothing about the subscription changes. A second reminder within 24
 * hours, demo sandboxes and schools without a running plan are skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ForbiddenError } from "@/lib/errors";
import { getAdminAlerts } from "@/server/alerts/feeds";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { setMailTransport, resetMailTransport, type Mail } from "@/server/mail/mailer";
import { listMemberships, sendMembershipReminders } from "@/server/platform/membership";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "pmr";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let organizationId: string;
let branchId: string;
let demoId: string;
let noPlanId: string;
const sent: Mail[] = [];
let failNext = false;

beforeAll(async () => {
  setMailTransport(async (mail) => {
    if (failNext) {
      failNext = false;
      throw new Error("550 Recipient address rejected");
    }
    sent.push(mail);
  });
  ({ schoolA, schoolB } = await createIsolationFixture());
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "M", lastName: "R" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "M", lastName: "R", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  const planId = (await prisma.plan.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { id: true } })).id;

  // School A: an organization of two campuses, owned by A's admin, ending in 5 days.
  organizationId = (await prisma.organization.create({ data: { name: "PMR Group", ownerId: schoolA.adminUserId } })).id;
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId } });
  branchId = (await prisma.school.create({ data: { slug: `${PREFIX}-branch`, name: "PMR Branch", status: "ACTIVE", contactName: "x", contactEmail: `branch@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId } })).id;
  for (const schoolId of [schoolA.schoolId, branchId]) {
    await prisma.subscription.deleteMany({ where: { schoolId } });
    await prisma.subscription.create({ data: { schoolId, planId, status: "ACTIVE", startsAt: addDays(today(), -300), endsAt: addDays(today(), 5) } });
  }
  // School B: on its own, trial ended 2 days ago.
  await prisma.subscription.deleteMany({ where: { schoolId: schoolB.schoolId } });
  await prisma.subscription.create({ data: { schoolId: schoolB.schoolId, planId, status: "TRIALING", startsAt: addDays(today(), -30), endsAt: addDays(today(), -2) } });
  demoId = (await prisma.school.create({ data: { slug: `${PREFIX}-demo`, name: "PMR Demo", status: "ACTIVE", isDemo: true, contactName: "x", contactEmail: `demo@${PREFIX}.test`, contactPhone: "+91 9000000000" } })).id;
  await prisma.subscription.create({ data: { schoolId: demoId, planId, status: "ACTIVE", startsAt: today(), endsAt: addDays(today(), 3) } });
  noPlanId = (await prisma.school.create({ data: { slug: `${PREFIX}-noplan`, name: "PMR No Plan", status: "ACTIVE", contactName: "x", contactEmail: `noplan@${PREFIX}.test`, contactPhone: "+91 9000000000" } })).id;
}, 60_000);

afterAll(async () => {
  resetMailTransport();
  await prisma.school.deleteMany({ where: { slug: { startsWith: `${PREFIX}-` } } });
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { organizationId: null } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${PREFIX}.test` } } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("membership reminders", () => {
  it("one school: one email to the owner, an audit entry per campus, a notice for the School Admin, the subscription unchanged", async () => {
    const before = await prisma.subscription.findMany({ where: { schoolId: { in: [schoolA.schoolId, branchId] } }, select: { id: true, status: true, endsAt: true, updatedAt: true } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: schoolA.adminUserId }, select: { email: true } });
    const result = await sendMembershipReminders(superAdmin, [schoolA.schoolId]);
    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    const mail = sent.at(-1)!;
    expect(mail.to).toBe(owner.email);
    expect(mail.subject).toMatch(/membership is ending/);
    expect(mail.text).toMatch(/plan for PMR Group ends on .* \(days left: 5\)/);
    expect(mail.text).toMatch(/Nothing has been charged/);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_REMINDER_SENT", schoolId: { in: [schoolA.schoolId, branchId] } } })).toBe(2);
    expect(await prisma.subscription.findMany({ where: { schoolId: { in: [schoolA.schoolId, branchId] } }, select: { id: true, status: true, endsAt: true, updatedAt: true } })).toEqual(before);

    const alert = (await getAdminAlerts(adminOf(schoolA))).find((row) => row.kind === "membership");
    expect(alert).toMatchObject({ tone: "warning", href: "/school-admin/plan" });
    expect(alert?.title).toMatch(/plan ends on/);
    // The other school's admin sees nothing.
    expect((await getAdminAlerts(adminOf(schoolB))).some((row) => row.kind === "membership")).toBe(false);
  });

  it("many at once: one email per organization; already reminded, demo, no plan and unknown are skipped", async () => {
    const count = sent.length;
    const result = await sendMembershipReminders(superAdmin, [schoolA.schoolId, branchId, schoolB.schoolId, demoId, noPlanId, "missing-id"]);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(sent.length).toBe(count + 1);
    const reasons = Object.fromEntries(result.outcomes.map((row) => [row.schoolId, row.reason ?? row.result]));
    expect(reasons[schoolA.schoolId]).toMatch(/last 24 hours|Same organization/);
    expect(reasons[branchId]).toMatch(/last 24 hours|Same organization/);
    expect(reasons[demoId]).toBe("Demo sandbox");
    expect(reasons[noPlanId]).toBe("No running plan");
    expect(reasons["missing-id"]).toBe("Not found");
    expect(sent.at(-1)!.subject).toMatch(/trial has ended/);
    expect((await getAdminAlerts(adminOf(schoolB))).find((row) => row.kind === "membership")).toMatchObject({ tone: "critical" });
  });

  it("a refused email is reported, recorded as not delivered, and does not count as sent", async () => {
    await prisma.auditLog.deleteMany({ where: { action: "MEMBERSHIP_REMINDER_SENT", schoolId: schoolB.schoolId } });
    failNext = true;
    const result = await sendMembershipReminders(superAdmin, [schoolB.schoolId]);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(result.outcomes[0]?.reason).toMatch(/refused this recipient/);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBERSHIP_REMINDER_SENT", schoolId: schoolB.schoolId } })).summary).toMatch(/not delivered/);
    expect((await listMemberships(superAdmin)).rows.find((row) => row.schoolIds.includes(schoolB.schoolId))).toMatchObject({ lastReminderDelivered: false });
    // A failed email does not block trying again straight away.
    expect(await sendMembershipReminders(superAdmin, [schoolB.schoolId])).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect((await listMemberships(superAdmin)).rows.find((row) => row.schoolIds.includes(schoolB.schoolId))).toMatchObject({ lastReminderDelivered: true });
    // …but once delivered, the 24-hour rule applies.
    expect(await sendMembershipReminders(superAdmin, [schoolB.schoolId])).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("the Membership page lists last reminded, filters, and is the Super Admin's alone", async () => {
    const all = await listMemberships(superAdmin);
    const group = all.rows.find((row) => row.schoolIds.includes(schoolA.schoolId));
    expect(group).toMatchObject({ title: "PMR Group", daysLeft: 5 });
    expect(group?.schoolIds.sort()).toEqual([schoolA.schoolId, branchId].sort());
    expect(group?.lastRemindedAt).toBeInstanceOf(Date);
    expect(all.rows.some((row) => row.schoolIds.includes(demoId))).toBe(false);
    expect((await listMemberships(superAdmin, "ended")).rows.every((row) => row.daysLeft !== null && row.daysLeft < 0)).toBe(true);
    expect((await listMemberships(superAdmin, "soon")).rows.some((row) => row.title === "PMR Group")).toBe(true);

    const admin = { ...superAdmin, id: schoolA.adminUserId, role: "SCHOOL_ADMIN", schoolId: schoolA.schoolId } as SessionUser;
    await expect(listMemberships(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendMembershipReminders(admin, [schoolA.schoolId])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendMembershipReminders(superAdmin, [])).rejects.toBeInstanceOf(AppError);
  });
});
