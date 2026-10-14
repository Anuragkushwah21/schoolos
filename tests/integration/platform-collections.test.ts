/**
 * SchoolOS's own collection: bills to organizations and payments received,
 * entered by the Super Admin by hand. Total = payments recorded (voided ones
 * do not count), today = received today, pending = what live bills still
 * wait for. Nothing is deleted; Super Admin only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { platformBillSchema } from "@/lib/validation/platform";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { billableOrganizations, cancelPlatformBill, collectionSummary, createPlatformBill, listBills, recordPlatformPayment, voidPlatformPayment } from "@/server/platform/collections";

const PREFIX = "pcol";
let superAdmin: SessionUser;
let admin: SessionUser;
let orgId: string;
let demoOrgId: string;

const pay = (billId: string, amountMinor: number, extra: Partial<{ receivedOn: Date; idempotencyKey: string | null }> = {}) =>
  recordPlatformPayment(superAdmin, { billId, amountMinor, receivedOn: today(), method: "UPI", referenceNo: "UTR1", notes: null, idempotencyKey: null, ...extra });
const bill = (amountMinor: number, dueOn = addDays(today(), 10), organizationId = orgId) =>
  createPlatformBill(superAdmin, { organizationId, amountMinor, dueOn, periodStart: null, periodEnd: null, description: "PCOL test" });

async function cleanUp() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: "PCOL " } }, select: { id: true } });
  const ids = orgs.map((org) => org.id);
  const bills = await prisma.platformBill.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityType: "PlatformBill", entityId: { in: bills.map((row) => row.id) } } });
  await prisma.platformPayment.deleteMany({ where: { bill: { organizationId: { in: ids } } } });
  await prisma.platformBill.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.school.deleteMany({ where: { slug: { startsWith: `${PREFIX}-` } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${PREFIX}.test` } } });
}

beforeAll(async () => {
  await cleanUp();
  const sa = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "C", lastName: "L" } });
  superAdmin = { id: sa.id, email: sa.email, role: "SUPER_ADMIN", firstName: "C", lastName: "L", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  orgId = (await prisma.organization.create({ data: { name: "PCOL Group" } })).id;
  const school = await prisma.school.create({ data: { slug: `${PREFIX}-main`, name: "PCOL Main", status: "ACTIVE", contactName: "x", contactEmail: `main@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: orgId } });
  admin = { ...superAdmin, id: "someone", role: "SCHOOL_ADMIN", schoolId: school.id } as SessionUser;
  demoOrgId = (await prisma.organization.create({ data: { name: "PCOL Demo" } })).id;
  await prisma.school.create({ data: { slug: `${PREFIX}-demo`, name: "PCOL Demo School", status: "ACTIVE", isDemo: true, contactName: "x", contactEmail: `demo@${PREFIX}.test`, contactPhone: "+91 9000000000", organizationId: demoOrgId } });
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe("SchoolOS collection", () => {
  it("a bill is pending until money is recorded; nothing counts as collected by billing", async () => {
    const before = await collectionSummary(superAdmin);
    const { id, billNo } = await bill(50_000_00);
    expect(billNo).toMatch(new RegExp(`^SB-${today().getUTCFullYear()}-\\d{5}$`));
    const after = await collectionSummary(superAdmin);
    expect(after.pendingMinor - before.pendingMinor).toBe(50_000_00);
    expect(after.totalMinor).toBe(before.totalMinor);
    expect(after.todayMinor).toBe(before.todayMinor);
    expect(await prisma.auditLog.count({ where: { action: "PLATFORM_BILL_CREATED", entityId: id } })).toBe(1);
  });

  it("payments add to total and today, reduce pending; part paid, then paid; over-payment, future dates and repeats are handled", async () => {
    const before = await collectionSummary(superAdmin);
    const { id } = await bill(30_000_00);
    await pay(id, 10_000_00);
    // Yesterday's payment counts in total but not today.
    await pay(id, 5_000_00, { receivedOn: addDays(today(), -1) });
    let row = (await listBills(superAdmin)).bills.find((entry) => entry.id === id)!;
    expect(row).toMatchObject({ status: "PART_PAID", receivedMinor: 15_000_00, pendingMinor: 15_000_00 });
    const mid = await collectionSummary(superAdmin);
    expect(mid.totalMinor - before.totalMinor).toBe(15_000_00);
    expect(mid.todayMinor - before.todayMinor).toBe(10_000_00);
    expect(mid.pendingMinor - before.pendingMinor).toBe(15_000_00);

    await expect(pay(id, 15_000_01)).rejects.toThrow(/Only ₹15,000(\.00)? is still due/);
    await expect(pay(id, 1_00, { receivedOn: addDays(today(), 1) })).rejects.toBeInstanceOf(AppError);
    // The same form twice: recorded once.
    const first = await pay(id, 5_000_00, { idempotencyKey: `${PREFIX}-key-1` });
    const again = await pay(id, 5_000_00, { idempotencyKey: `${PREFIX}-key-1` });
    expect(again).toEqual({ id: first.id, repeated: true });
    await pay(id, 10_000_00);
    row = (await listBills(superAdmin)).bills.find((entry) => entry.id === id)!;
    expect(row).toMatchObject({ status: "PAID", pendingMinor: 0, receivedMinor: 30_000_00 });
    await expect(pay(id, 1_00)).rejects.toThrow(/already paid in full/);
  });

  it("two payments at the same moment cannot both take the last amount due", async () => {
    const { id } = await bill(8_000_00);
    const results = await Promise.allSettled([pay(id, 8_000_00), pay(id, 8_000_00)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await listBills(superAdmin)).bills.find((entry) => entry.id === id)).toMatchObject({ receivedMinor: 8_000_00, status: "PAID" });
  });

  it("voiding a payment keeps it on record and stops it counting; a bill can be cancelled only with nothing received", async () => {
    const { id } = await bill(12_000_00);
    const { id: paymentId } = await pay(id, 12_000_00);
    const paid = await collectionSummary(superAdmin);
    await expect(cancelPlatformBill(superAdmin, id, "raised twice")).rejects.toThrow(/Void those payments first/);
    await voidPlatformPayment(superAdmin, paymentId, "entered on the wrong bill");
    await expect(voidPlatformPayment(superAdmin, paymentId, "again")).rejects.toBeInstanceOf(ConflictError);
    const voided = await collectionSummary(superAdmin);
    expect(paid.totalMinor - voided.totalMinor).toBe(12_000_00);
    expect(voided.pendingMinor - paid.pendingMinor).toBe(12_000_00);
    expect(await prisma.platformPayment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ voidReason: "entered on the wrong bill" });

    await cancelPlatformBill(superAdmin, id, "raised twice");
    const cancelled = await collectionSummary(superAdmin);
    expect(voided.pendingMinor - cancelled.pendingMinor).toBe(12_000_00);
    await expect(pay(id, 1_00)).rejects.toThrow(/cancelled/);
    expect((await listBills(superAdmin, "cancelled")).bills.find((entry) => entry.id === id)).toMatchObject({ status: "CANCELLED", cancelReason: "raised twice" });
  });

  it("a bill past its due date with money left is overdue", async () => {
    const { id } = await bill(4_000_00, addDays(today(), -1));
    expect((await listBills(superAdmin, "overdue")).bills.map((entry) => entry.id)).toContain(id);
    expect((await collectionSummary(superAdmin)).overdueMinor).toBeGreaterThanOrEqual(4_000_00);
  });

  it("only real organizations can be billed; amounts and periods are checked; Super Admin only", async () => {
    const billable = await billableOrganizations(superAdmin);
    expect(billable.map((org) => org.id)).toContain(orgId);
    expect(billable.map((org) => org.id)).not.toContain(demoOrgId);
    await expect(bill(1_00, addDays(today(), 5), demoOrgId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bill(0)).rejects.toBeInstanceOf(AppError);
    expect(platformBillSchema.safeParse({ organizationId: orgId, amount: "0", dueOn: "2026-11-01" }).success).toBe(false);
    expect(platformBillSchema.safeParse({ organizationId: orgId, amount: "100", dueOn: "2026-11-01", periodStart: "2026-12-01", periodEnd: "2026-11-01" }).success).toBe(false);

    await expect(collectionSummary(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listBills(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPlatformBill(admin, { organizationId: orgId, amountMinor: 1_00, dueOn: today(), periodStart: null, periodEnd: null, description: null })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
