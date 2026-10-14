/**
 * The Super Admin's calendar: plans and trials ending (one entry per
 * organization, demo sandboxes left out), overdue subscriptions, and requests
 * waiting for a decision. Super Admin only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { membershipOverview, platformCalendarEntries, platformReminders } from "@/server/platform/calendar";

const PREFIX = "pcal";
let superAdmin: SessionUser;
let owner: SessionUser;
let organizationId: string;

async function cleanUp() {
  await prisma.platformInquiry.deleteMany({ where: { email: { endsWith: `@${PREFIX}.test` } } });
  await prisma.school.deleteMany({ where: { slug: { startsWith: `${PREFIX}-` } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: "PCAL " } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${PREFIX}.test` } } });
}

async function campus(slug: string, organization: string | null, subscription: { status: "ACTIVE" | "TRIALING" | "PAST_DUE"; endsAt: Date | null }, isDemo = false) {
  const planId = (await prisma.plan.findFirstOrThrow({ select: { id: true } })).id;
  const school = await prisma.school.create({ data: { slug: `${PREFIX}-${slug}`, name: `PCAL ${slug}`, status: "ACTIVE", contactName: "x", contactEmail: `${slug}@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: organization, isDemo } });
  await prisma.subscription.create({ data: { schoolId: school.id, planId, startsAt: addDays(today(), -30), ...subscription } });
  return school.id;
}

beforeAll(async () => {
  await cleanUp();
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "P", lastName: "C" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "P", lastName: "C", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  owner = { ...superAdmin, id: "owner", role: "SCHOOL_ADMIN" } as SessionUser;
  organizationId = (await prisma.organization.create({ data: { name: "PCAL Two Campuses" } })).id;
  // Two campuses of one organization, both ending in 5 days: one entry.
  await campus("main", organizationId, { status: "ACTIVE", endsAt: addDays(today(), 5) });
  await campus("branch", organizationId, { status: "ACTIVE", endsAt: addDays(today(), 5) });
  await campus("trial", null, { status: "TRIALING", endsAt: addDays(today(), 3) });
  await campus("lapsed", null, { status: "ACTIVE", endsAt: addDays(today(), -2) });
  await campus("unpaid", null, { status: "PAST_DUE", endsAt: null });
  await campus("open", null, { status: "ACTIVE", endsAt: null });
  await campus("demo", null, { status: "TRIALING", endsAt: addDays(today(), 4) }, true);
  await prisma.platformInquiry.create({ data: { name: "Asker", email: `asker@${PREFIX}.test`, message: "Demo please", createdAt: addDays(today(), -3) } });
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe("Super Admin calendar", () => {
  it("shows plans and trials ending, one entry per organization, demo sandboxes left out", async () => {
    const ours = (await platformCalendarEntries(superAdmin, today(), addDays(today(), 30))).filter((entry) => entry.title.startsWith("PCAL "));
    expect(ours.map((entry) => [entry.title, entry.kind])).toEqual([
      ["PCAL trial", "TRIAL_ENDS"],
      ["PCAL Two Campuses", "PLAN_ENDS"],
    ]);
    expect(ours[1]).toMatchObject({ date: addDays(today(), 5), detail: expect.stringMatching(/2 campuses$/), href: `/super-admin/organizations/${organizationId}` });
    // A single day.
    const day = await platformCalendarEntries(superAdmin, addDays(today(), 3), addDays(today(), 3));
    expect(day.map((entry) => entry.title)).toContain("PCAL trial");
    expect(day.map((entry) => entry.title)).not.toContain("PCAL Two Campuses");
  });

  it("reminds of overdue subscriptions and requests waiting for a decision", async () => {
    const { overdue, waiting } = await platformReminders(superAdmin);
    const ours = overdue.filter((row) => row.title.startsWith("PCAL "));
    expect(ours.map((row) => [row.title, row.text])).toEqual([
      ["PCAL lapsed", "Plan ended — not renewed"],
      ["PCAL unpaid", "Payment overdue"],
    ]);
    const enquiries = waiting.find((row) => row.key === "enquiries");
    expect(enquiries?.count).toBeGreaterThanOrEqual(1);
    expect(enquiries?.href).toBe("/super-admin/inquiries");
  });

  it("the dashboard's membership list: soonest end first, ended at the top, no end date last, demo left out", async () => {
    const { rows, total, ended, within30, noEndDate } = await membershipOverview(superAdmin, 1000);
    const ours = rows.filter((row) => row.title.startsWith("PCAL "));
    expect(ours.map((row) => [row.title, row.status, row.daysLeft])).toEqual([
      ["PCAL lapsed", "ACTIVE", -2],
      ["PCAL trial", "TRIALING", 3],
      ["PCAL Two Campuses", "ACTIVE", 5],
      ["PCAL open", "ACTIVE", null],
      ["PCAL unpaid", "PAST_DUE", null],
    ]);
    expect(ours[2]).toMatchObject({ detail: expect.stringMatching(/2 campuses$/), href: `/super-admin/organizations/${organizationId}`, endsOn: addDays(today(), 5) });
    expect(total).toBe(rows.length);
    expect(ended).toBeGreaterThanOrEqual(1);
    expect(within30).toBeGreaterThanOrEqual(2);
    expect(noEndDate).toBeGreaterThanOrEqual(2);
    expect((await membershipOverview(superAdmin, 2)).rows).toHaveLength(2);
  });

  it("is the Super Admin's only", async () => {
    await expect(platformCalendarEntries(owner, today(), today())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(platformReminders(owner)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(membershipOverview(owner)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
