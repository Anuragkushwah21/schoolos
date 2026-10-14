import "server-only";

import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { quote } from "@/lib/plan-catalog";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { organizationPlanOf } from "@/server/platform/entitlements";

/**
 * SchoolOS's own collection: what it bills organizations for their
 * membership, and what it has received. SchoolOS takes no online payments,
 * so the Super Admin enters both by hand — a bill when one is raised, a
 * payment when money arrives (cash, UPI, bank transfer…).
 *
 *   * Total collection — every payment received (voided ones do not count).
 *   * Today's collection — payments received today.
 *   * Pending collection — what live bills still wait for (amount less
 *     payments); "overdue" is the part past its due date.
 *
 * Nothing is deleted: a payment entered by mistake is voided with a reason,
 * a bill with no payments is cancelled with a reason. Selecting a plan or
 * approving a plan request records nothing here — only money actually
 * received counts as collected.
 */

const LIVE_SCHOOL: Prisma.SchoolWhereInput = { isDemo: false, status: { in: ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] } };
const livePayment = { voidedAt: null } as const;

export type BillStatus = "UNPAID" | "PART_PAID" | "PAID" | "CANCELLED";

/** The three numbers, plus the overdue part of pending. */
export async function collectionSummary(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  const now = today();
  const [total, todays, month, bills] = await Promise.all([
    prisma.platformPayment.aggregate({ where: livePayment, _sum: { amountMinor: true }, _count: true }),
    prisma.platformPayment.aggregate({ where: { ...livePayment, receivedOn: now }, _sum: { amountMinor: true }, _count: true }),
    prisma.platformPayment.aggregate({ where: { ...livePayment, receivedOn: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }, _sum: { amountMinor: true } }),
    prisma.platformBill.findMany({ where: { cancelledAt: null }, select: { amountMinor: true, dueOn: true, payments: { where: livePayment, select: { amountMinor: true } } } }),
  ]);
  let pendingMinor = 0;
  let overdueMinor = 0;
  let pendingBills = 0;
  for (const bill of bills) {
    const left = Math.max(0, bill.amountMinor - bill.payments.reduce((sum, row) => sum + row.amountMinor, 0));
    if (!left) continue;
    pendingMinor += left;
    pendingBills += 1;
    if (bill.dueOn < now) overdueMinor += left;
  }
  return {
    totalMinor: total._sum.amountMinor ?? 0,
    totalPayments: total._count,
    todayMinor: todays._sum.amountMinor ?? 0,
    todayPayments: todays._count,
    monthMinor: month._sum.amountMinor ?? 0,
    pendingMinor,
    pendingBills,
    overdueMinor,
  };
}

export type BillFilter = "all" | "pending" | "overdue" | "paid" | "cancelled";

/** Bills with what has been received and what is left, newest due date first within each status. */
export async function listBills(actor: SessionUser, filter: BillFilter = "all") {
  assertRole(actor, "SUPER_ADMIN");
  const now = today();
  const rows = await prisma.platformBill.findMany({
    orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: {
      id: true,
      billNo: true,
      planName: true,
      description: true,
      periodStart: true,
      periodEnd: true,
      amountMinor: true,
      currency: true,
      dueOn: true,
      cancelledAt: true,
      cancelReason: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
      payments: { where: livePayment, select: { amountMinor: true } },
    },
  });
  const bills = rows.map(({ payments, ...bill }) => {
    const receivedMinor = payments.reduce((sum, row) => sum + row.amountMinor, 0);
    const pendingMinor = bill.cancelledAt ? 0 : Math.max(0, bill.amountMinor - receivedMinor);
    const status: BillStatus = bill.cancelledAt ? "CANCELLED" : pendingMinor === 0 ? "PAID" : receivedMinor > 0 ? "PART_PAID" : "UNPAID";
    return { ...bill, receivedMinor, pendingMinor, status, overdue: pendingMinor > 0 && bill.dueOn < now };
  });
  const matches = (bill: (typeof bills)[number]) =>
    filter === "pending" ? bill.pendingMinor > 0
    : filter === "overdue" ? bill.overdue
    : filter === "paid" ? bill.status === "PAID"
    : filter === "cancelled" ? bill.status === "CANCELLED"
    : true;
  return {
    bills: bills.filter(matches),
    counts: {
      all: bills.length,
      pending: bills.filter((bill) => bill.pendingMinor > 0).length,
      overdue: bills.filter((bill) => bill.overdue).length,
      paid: bills.filter((bill) => bill.status === "PAID").length,
      cancelled: bills.filter((bill) => bill.status === "CANCELLED").length,
    },
  };
}

/** Latest payments received, voided ones included and marked. */
export async function recentPlatformPayments(actor: SessionUser, take = 20) {
  assertRole(actor, "SUPER_ADMIN");
  return prisma.platformPayment.findMany({
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, amountMinor: true, receivedOn: true, method: true, referenceNo: true, notes: true, voidedAt: true, voidReason: true, createdAt: true, bill: { select: { id: true, billNo: true, currency: true, organization: { select: { name: true } } } } },
  });
}

/**
 * Organizations that can be billed (any real campus), with their plan and
 * what the plan's price comes to for their campuses — a suggestion only; the
 * Super Admin types the amount on the bill.
 */
export async function billableOrganizations(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  const rows = await prisma.organization.findMany({
    where: { schools: { some: LIVE_SCHOOL } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { schools: { where: LIVE_SCHOOL } } } },
  });
  return Promise.all(
    rows.map(async (org) => {
      const plan = await organizationPlanOf(org.id);
      const breakdown = plan ? quote(plan, org._count.schools) : null;
      const suggestedMinor = breakdown && !breakdown.onRequest ? (breakdown.planFeeMinor ?? 0) + (breakdown.extraTotalMinor ?? 0) : null;
      return { id: org.id, name: org.name, campuses: org._count.schools, planName: plan?.name ?? null, suggestedMinor };
    }),
  );
}

/** "SB-2026-00001": the next number for this year. */
async function nextBillNo(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `SB-${year}-`;
  const last = await tx.platformBill.findFirst({ where: { billNo: { startsWith: prefix } }, orderBy: { billNo: "desc" }, select: { billNo: true } });
  const n = last ? Number(last.billNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(5, "0")}`;
}

export async function createPlatformBill(
  actor: SessionUser,
  input: { organizationId: string; amountMinor: number; dueOn: Date; periodStart: Date | null; periodEnd: Date | null; description: string | null },
) {
  assertRole(actor, "SUPER_ADMIN");
  if (!(input.amountMinor > 0)) throw new AppError("VALIDATION", "The amount must be more than 0.");
  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) throw new AppError("VALIDATION", "The period must end on or after it starts.");
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, schools: { some: LIVE_SCHOOL } }, select: { id: true, name: true } });
  if (!organization) throw new NotFoundError("That organization cannot be billed.");
  const plan = await organizationPlanOf(organization.id);

  // Two bills at once can race for a number: retry on the unique index.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const bill = await prisma.$transaction(async (tx) => {
        const billNo = await nextBillNo(tx, today().getUTCFullYear());
        return tx.platformBill.create({
          data: { organizationId: organization.id, billNo, planName: plan?.name ?? null, description: input.description, periodStart: input.periodStart, periodEnd: input.periodEnd, amountMinor: input.amountMinor, dueOn: input.dueOn, createdById: actor.id },
          select: { id: true, billNo: true },
        });
      });
      await recordAudit({ action: "PLATFORM_BILL_CREATED", entityType: "PlatformBill", entityId: bill.id, actorId: actor.id, summary: `Bill ${bill.billNo} for ${organization.name}: ${formatMoney(input.amountMinor)}, plan ${plan?.name ?? "none"}, due ${input.dueOn.toISOString().slice(0, 10)}.`, metadata: { organizationId: organization.id, amountMinor: input.amountMinor } });
      return bill;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not number the bill. Try again.");
}

/**
 * Record money received against a bill. Refused past what the bill still
 * waits for, on a cancelled bill, or dated in the future. The same form
 * submitted twice (same idempotency key) records it once.
 */
export async function recordPlatformPayment(
  actor: SessionUser,
  input: { billId: string; amountMinor: number; receivedOn: Date; method: PaymentMethod; referenceNo: string | null; notes: string | null; idempotencyKey: string | null },
) {
  assertRole(actor, "SUPER_ADMIN");
  if (!(input.amountMinor > 0)) throw new AppError("VALIDATION", "The amount must be more than 0.");
  if (input.receivedOn > today()) throw new AppError("VALIDATION", "The date received cannot be in the future.");
  if (input.idempotencyKey) {
    const earlier = await prisma.platformPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, billId: true } });
    if (earlier) {
      if (earlier.billId !== input.billId) throw new ConflictError("This form was already used for another bill. Reload and try again.");
      return { id: earlier.id, repeated: true };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Touch the bill first: the update holds its row lock until commit, so two
    // payments at once cannot both pass the "still due" check below.
    const { count } = await tx.platformBill.updateMany({ where: { id: input.billId }, data: { updatedAt: new Date() } });
    if (!count) throw new NotFoundError();
    const bill = await tx.platformBill.findUniqueOrThrow({ where: { id: input.billId }, select: { id: true, billNo: true, amountMinor: true, cancelledAt: true, organization: { select: { name: true } }, payments: { where: livePayment, select: { amountMinor: true } } } });
    if (bill.cancelledAt) throw new ConflictError("This bill is cancelled.");
    const left = bill.amountMinor - bill.payments.reduce((sum, row) => sum + row.amountMinor, 0);
    if (left <= 0) throw new ConflictError("This bill is already paid in full.");
    if (input.amountMinor > left) throw new ConflictError(`Only ${formatMoney(left)} is still due on ${bill.billNo}.`);
    const payment = await tx.platformPayment.create({
      data: { billId: bill.id, amountMinor: input.amountMinor, receivedOn: input.receivedOn, method: input.method, referenceNo: input.referenceNo, notes: input.notes, idempotencyKey: input.idempotencyKey, recordedById: actor.id },
      select: { id: true },
    });
    return { payment, bill, left: left - input.amountMinor };
  });

  await recordAudit({ action: "PLATFORM_PAYMENT_RECORDED", entityType: "PlatformBill", entityId: result.bill.id, actorId: actor.id, summary: `${formatMoney(input.amountMinor)} received from ${result.bill.organization.name} for ${result.bill.billNo} (${input.method.toLowerCase().replace("_", " ")}, ref ${input.referenceNo ?? "—"}). Still due: ${formatMoney(result.left)}.`, metadata: { paymentId: result.payment.id, amountMinor: input.amountMinor } });
  return { id: result.payment.id, repeated: false };
}

/** Undo a payment entered by mistake: it stays on record, marked void, and stops counting. */
export async function voidPlatformPayment(actor: SessionUser, paymentId: string, reason: string) {
  assertRole(actor, "SUPER_ADMIN");
  if (!reason.trim()) throw new AppError("VALIDATION", "Give a reason.");
  const payment = await prisma.platformPayment.findUnique({ where: { id: paymentId }, select: { id: true, amountMinor: true, bill: { select: { id: true, billNo: true } } } });
  if (!payment) throw new NotFoundError();
  const { count } = await prisma.platformPayment.updateMany({ where: { id: paymentId, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason.trim() } });
  if (!count) throw new ConflictError("This payment is already void.");
  await recordAudit({ action: "PLATFORM_PAYMENT_VOIDED", entityType: "PlatformBill", entityId: payment.bill.id, actorId: actor.id, summary: `Payment of ${formatMoney(payment.amountMinor)} on ${payment.bill.billNo} voided: ${reason.trim()}`, metadata: { paymentId } });
}

/** Cancel a bill raised by mistake. Only while nothing has been received on it. */
export async function cancelPlatformBill(actor: SessionUser, billId: string, reason: string) {
  assertRole(actor, "SUPER_ADMIN");
  if (!reason.trim()) throw new AppError("VALIDATION", "Give a reason.");
  const bill = await prisma.platformBill.findUnique({ where: { id: billId }, select: { id: true, billNo: true, cancelledAt: true, _count: { select: { payments: { where: livePayment } } } } });
  if (!bill) throw new NotFoundError();
  if (bill.cancelledAt) throw new ConflictError("This bill is already cancelled.");
  if (bill._count.payments) throw new ConflictError("Money has been received on this bill. Void those payments first.");
  // Conditional, so a payment recorded meanwhile stops the cancellation.
  const { count } = await prisma.platformBill.updateMany({ where: { id: billId, cancelledAt: null, payments: { none: livePayment } }, data: { cancelledAt: new Date(), cancelReason: reason.trim() } });
  if (!count) throw new ConflictError("This bill changed meanwhile. Reload and check it.");
  await recordAudit({ action: "PLATFORM_BILL_CANCELLED", entityType: "PlatformBill", entityId: billId, actorId: actor.id, summary: `Bill ${bill.billNo} cancelled: ${reason.trim()}` });
}
