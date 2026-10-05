import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import { isUniqueViolation } from "@/server/db/errors";
import { previousDues } from "@/server/finance/carry-forward";
import { readStudentFees } from "@/server/finance/fees";

/**
 * Family fees: a parent with several children at the school sees each child's
 * fees separately and the family's combined total. Where the school has
 * switched it on, the fee desk takes one payment for several children —
 * stored as one `FeePayment` per child (their accounts never merge) under a
 * single family receipt that shows which amount belongs to which child.
 */

const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** The parent this user may see family fees for: themselves, or — for the office — the one named. */
async function resolveParent(ctx: TenantContext, parentId?: string) {
  if (ctx.user.role === "PARENT") {
    const parent = await ctx.db.parent.findFirst({ where: { userId: ctx.user.id }, select: { id: true, firstName: true, lastName: true, phone: true } });
    if (!parent) throw new NotFoundError();
    if (parentId && parentId !== parent.id) throw new ForbiddenError();
    return parent;
  }
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect"]);
  const parent = await ctx.db.parent.findFirst({ where: { id: parentId ?? "" }, select: { id: true, firstName: true, lastName: true, phone: true } });
  if (!parent) throw new NotFoundError("That parent was not found.");
  return parent;
}

/**
 * Each current child's fees — heads with original, concession and net, paid,
 * pending, and any earlier session still owed — and the family's totals.
 * Parents: their own children only. The office: any parent of the school.
 */
export async function familyFees(ctx: TenantContext, parentId?: string) {
  const parent = await resolveParent(ctx, parentId);
  const links = await ctx.db.parentStudent.findMany({
    where: { parentId: parent.id, student: { status: { in: [...CURRENT_STUDENT] } } },
    orderBy: { createdAt: "asc" },
    select: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          enrollments: {
            where: { academicSession: { isCurrent: true }, status: "ACTIVE" },
            take: 1,
            select: { section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  const children = [];
  for (const link of links) {
    const student = link.student;
    const [fees, previous] = await Promise.all([readStudentFees(ctx, student.id), previousDues(ctx, student.id)]);
    const previousMinor = previous.reduce((sum, due) => sum + due.pendingMinor, 0);
    children.push({
      id: student.id,
      name: fullName(student),
      admissionNumber: student.admissionNumber,
      section: student.enrollments[0] ? sectionLabel(student.enrollments[0].section) : null,
      session: fees.session,
      charges: fees.charges.map((charge) => ({
        id: charge.id,
        head: charge.feeHead.name,
        originalMinor: charge.originalMinor,
        discountMinor: charge.discountMinor,
        netMinor: charge.netMinor,
        dueOn: charge.dueOn,
        concessionReason: charge.concession?.reason ?? null,
        carriedFrom: charge.carriedFrom?.name ?? null,
      })),
      summary: fees.summary,
      /** Earlier sessions still owed and not yet carried forward — shown separately, never merged. */
      previous,
      payableMinor: fees.summary.pendingMinor + previousMinor,
    });
  }
  const school = await ctx.db.school.findFirst({ select: { familyPaymentEnabled: true } });
  return {
    parent: { id: parent.id, name: fullName(parent), phone: parent.phone },
    children,
    totals: {
      chargedMinor: children.reduce((sum, child) => sum + child.summary.chargedMinor, 0),
      paidMinor: children.reduce((sum, child) => sum + child.summary.paidMinor, 0),
      currentPendingMinor: children.reduce((sum, child) => sum + child.summary.pendingMinor, 0),
      previousMinor: children.reduce((sum, child) => sum + child.previous.reduce((total, due) => total + due.pendingMinor, 0), 0),
      payableMinor: children.reduce((sum, child) => sum + child.payableMinor, 0),
    },
    familyPaymentEnabled: school?.familyPaymentEnabled ?? false,
  };
}

/** School Admin: allow (or stop) one payment covering several siblings. */
export async function setFamilyPaymentEnabled(ctx: TenantContext, enabled: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { familyPaymentEnabled: enabled } });
  await recordAudit({ action: "FEE_SETTINGS_UPDATED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Family payments ${enabled ? "switched on" : "switched off"}.` });
}

async function nextFamilyReceiptNo(ctx: TenantContext): Promise<string> {
  const rows = await ctx.db.familyPayment.findMany({ where: { receiptNo: { startsWith: "FAM-" } }, select: { receiptNo: true } });
  const highest = rows.reduce((max, row) => {
    const n = Number.parseInt(row.receiptNo.slice(4), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 1000);
  return `FAM-${highest + 1}`;
}

export type FamilyAllocation = { studentId: string; amountMinor: number };

/**
 * Record one family payment at the fee desk. Each child's share becomes their
 * own receipt (FAM-1001/1, /2 …) in their own account; no child is credited
 * more than they owe this session. One family receipt ties them together.
 */
export async function recordFamilyPayment(
  ctx: TenantContext,
  input: { parentId: string; paidOn: Date; method: PaymentMethod; referenceNo: string | null; notes: string | null; allocations: FamilyAllocation[] },
): Promise<{ id: string; receiptNo: string; totalMinor: number }> {
  await assertAdminOrStaffPermission(ctx, "fees.collect");
  const school = await ctx.db.school.findFirst({ select: { familyPaymentEnabled: true } });
  if (!school?.familyPaymentEnabled) throw new ForbiddenError("Family payments are switched off. The School Admin can switch them on in Fees.");
  const session = await requireCurrentSession(ctx);
  if (input.paidOn > today()) throw new AppError("VALIDATION", "A payment cannot be dated in the future.");

  const allocations = input.allocations.filter((row) => row.amountMinor > 0);
  if (!allocations.length) throw new ValidationError("Enter an amount for at least one child.");
  if (new Set(allocations.map((row) => row.studentId)).size !== allocations.length) throw new ValidationError("Each child can appear once.");

  const family = await familyFees(ctx, input.parentId);
  const errors: Record<string, string[]> = {};
  for (const allocation of allocations) {
    const child = family.children.find((row) => row.id === allocation.studentId);
    // A child who is not this parent's (or has left) is not theirs to pay for.
    if (!child) throw new NotFoundError("A child in this payment is not linked to this parent.");
    if (!Number.isInteger(allocation.amountMinor) || allocation.amountMinor <= 0) (errors[`amount:${child.id}`] ??= []).push("Enter an amount");
    else if (allocation.amountMinor > child.summary.pendingMinor) {
      (errors[`amount:${child.id}`] ??= []).push(`${child.name} owes ${rupees(child.summary.pendingMinor)} this session — no more can be taken for them.`);
    }
  }
  if (Object.keys(errors).length) throw new ValidationError("Some amounts need correcting.", errors);
  const totalMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const receiptNo = await nextFamilyReceiptNo(ctx);
    try {
      const created = await ctx.db.$transaction(async (tx) => {
        const familyPayment = await tx.familyPayment.create({
          data: {
            schoolId: ctx.schoolId,
            academicSessionId: session.id,
            parentId: family.parent.id,
            receiptNo,
            totalMinor,
            paidOn: input.paidOn,
            method: input.method,
            referenceNo: input.referenceNo,
            notes: input.notes,
            recordedById: ctx.user.id,
          },
          select: { id: true },
        });
        await tx.feePayment.createMany({
          data: allocations.map((allocation, index) => ({
            schoolId: ctx.schoolId,
            academicSessionId: session.id,
            studentId: allocation.studentId,
            amountMinor: allocation.amountMinor,
            paidOn: input.paidOn,
            method: input.method,
            receiptNo: `${receiptNo}/${index + 1}`,
            referenceNo: input.referenceNo,
            notes: `Part of family payment ${receiptNo}.`,
            recordedById: ctx.user.id,
            familyPaymentId: familyPayment.id,
          })),
        });
        return familyPayment;
      });
      await recordAudit({
        action: "FAMILY_PAYMENT_RECORDED",
        entityType: "Parent",
        entityId: family.parent.id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: `Family payment ${receiptNo}: ${rupees(totalMinor)} from ${family.parent.name} — ${allocations
          .map((row) => `${family.children.find((child) => child.id === row.studentId)!.name} ${rupees(row.amountMinor)}`)
          .join(", ")}.`,
      });
      return { id: created.id, receiptNo, totalMinor };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not allocate a receipt number. Try again.");
}

/** A family receipt: the total, and which amount belongs to which child. */
export async function getFamilyReceipt(ctx: TenantContext, familyPaymentId: string) {
  const payment = await ctx.db.familyPayment.findFirst({
    where: { id: familyPaymentId },
    select: {
      id: true,
      receiptNo: true,
      totalMinor: true,
      paidOn: true,
      method: true,
      referenceNo: true,
      voidedAt: true,
      voidReason: true,
      parentId: true,
      academicSession: { select: { name: true } },
      parent: { select: { firstName: true, lastName: true, phone: true, userId: true } },
      parts: {
        orderBy: { receiptNo: "asc" },
        select: { id: true, receiptNo: true, amountMinor: true, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
      },
    },
  });
  if (!payment) throw new NotFoundError();
  // The paying parent may read it; so may the office. Nobody else.
  if (ctx.user.role === "PARENT") {
    if (payment.parent.userId !== ctx.user.id) throw new NotFoundError();
  } else {
    await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect"]);
  }
  return {
    ...payment,
    parent: { name: fullName(payment.parent), phone: payment.parent.phone },
    parts: payment.parts.map((part) => ({ ...part, student: fullName(part.student), admissionNumber: part.student.admissionNumber, studentId: part.student.id })),
  };
}

/** School Admin: void a family payment — every child's share with it, so no account is left half-credited. */
export async function voidFamilyPayment(ctx: TenantContext, familyPaymentId: string, reason: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const payment = await ctx.db.familyPayment.findFirst({ where: { id: familyPaymentId, voidedAt: null }, select: { id: true, receiptNo: true } });
  if (!payment) throw new NotFoundError("That family payment was not found, or is already void.");
  const now = new Date();
  await ctx.db.$transaction([
    ctx.db.familyPayment.updateMany({ where: { id: payment.id }, data: { voidedAt: now, voidReason: reason } }),
    ctx.db.feePayment.updateMany({ where: { familyPaymentId: payment.id, voidedAt: null }, data: { voidedAt: now, voidedById: ctx.user.id, voidReason: `Family payment ${payment.receiptNo} voided: ${reason}` } }),
  ]);
  await recordAudit({ action: "FAMILY_PAYMENT_VOIDED", entityType: "FamilyPayment", entityId: payment.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Family payment ${payment.receiptNo} voided: ${reason}` });
}

/** Parents with more than one current child, for the fee desk's family picker. */
export async function familiesWithSiblings(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect"]);
  const parents = await ctx.db.parent.findMany({
    where: { archivedAt: null, children: { some: { student: { status: { in: [...CURRENT_STUDENT] } } } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, phone: true, children: { where: { student: { status: { in: [...CURRENT_STUDENT] } } }, select: { student: { select: { firstName: true } } } } },
  });
  return parents
    .filter((row) => row.children.length > 1)
    .map((row) => ({ value: row.id, label: `${fullName(row)} · ${row.phone} — ${row.children.map((child) => child.student.firstName).join(", ")}` }));
}
