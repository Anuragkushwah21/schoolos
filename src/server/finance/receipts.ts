import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import type { ReceiptSettingsInput } from "@/lib/validation/school";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { findChild } from "@/server/parent/access";
import { findStudentSelf } from "@/server/student/access";

/**
 * Printable fee receipts.
 *
 * A receipt is a view of one `FeePayment` row, not a document of its own. Its
 * number is the payment's `receiptNo`, written once when the money was taken,
 * so printing it again — tomorrow or next year — shows the same number. The
 * school's name, logo and address come from the session's own `School` row,
 * read through the tenant-scoped client: a receipt can only ever carry the
 * branding of the school the payment belongs to.
 *
 * Who may open one:
 *   * School Admin — any payment of their school.
 *   * Parent       — payments of a child they are linked to.
 *   * Student      — their own payments, and only when the school has turned
 *                    on `showFeesToStudents`.
 * Everyone else, and anyone asking for a payment outside those, gets the same
 * "not found", so an id reveals nothing about whether it exists.
 */

export type Receipt = {
  school: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    affiliation: string | null;
    udiseCode: string | null;
    primaryColor: string;
    headerNote: string | null;
    footerNote: string | null;
  };
  payment: {
    id: string;
    studentId: string;
    receiptNo: string;
    paidOn: Date;
    method: PaymentMethod;
    referenceNo: string | null;
    notes: string | null;
    amountMinor: number;
    recordedBy: string | null;
  };
  session: { name: string };
  student: {
    name: string;
    admissionNumber: string;
    className: string | null;
    sectionName: string | null;
    rollNumber: string | null;
  };
  guardian: { name: string; relationship: string; phone: string } | null;
  fees: {
    breakdown: Array<{ head: string; amountMinor: number }>;
    totalMinor: number;
    /** Paid in this session before this receipt. */
    previouslyPaidMinor: number;
    currentMinor: number;
    /** What was still owed once this payment was taken. Never negative. */
    remainingMinor: number;
    /** Paid beyond the total fee, if this payment overshot it. */
    excessMinor: number;
  };
};

const NOT_FOUND = "That receipt was not found.";

/** Throws the uniform not-found unless this user may see this student's receipts. */
async function assertCanSeeStudentReceipts(ctx: TenantContext, studentId: string): Promise<void> {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
      return;
    case "PARENT": {
      const child = await findChild(ctx, studentId).catch(() => null);
      if (child) return;
      break;
    }
    case "STUDENT": {
      const school = await ctx.db.school.findFirst({ select: { showFeesToStudents: true } });
      if (!school?.showFeesToStudents) break;
      const self = await findStudentSelf(ctx).catch(() => null);
      if (self?.student.id === studentId) return;
      break;
    }
  }
  throw new NotFoundError(NOT_FOUND);
}

export async function getReceipt(ctx: TenantContext, paymentId: string): Promise<Receipt> {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PARENT", "STUDENT");

  const payment = await ctx.db.feePayment.findFirst({
    where: { id: paymentId },
    select: {
      id: true,
      studentId: true,
      academicSessionId: true,
      amountMinor: true,
      paidOn: true,
      createdAt: true,
      method: true,
      receiptNo: true,
      referenceNo: true,
      notes: true,
      recordedBy: { select: { firstName: true, lastName: true } },
      academicSession: { select: { name: true } },
      student: {
        select: {
          firstName: true,
          lastName: true,
          admissionNumber: true,
          parents: {
            orderBy: { isPrimary: "desc" },
            take: 1,
            select: { relationship: true, parent: { select: { firstName: true, lastName: true, phone: true } } },
          },
        },
      },
    },
  });
  if (!payment) throw new NotFoundError(NOT_FOUND);
  await assertCanSeeStudentReceipts(ctx, payment.studentId);

  const [school, enrollment, charges, earlier] = await Promise.all([
    ctx.db.school.findFirst({
      select: {
        name: true,
        logoUrl: true,
        addressLine: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        affiliationBoard: true,
        udiseCode: true,
        primaryColor: true,
        receiptHeaderNote: true,
        receiptFooterNote: true,
      },
    }),
    ctx.db.studentEnrollment.findFirst({
      where: { studentId: payment.studentId, academicSessionId: payment.academicSessionId },
      orderBy: [{ status: "asc" }, { enrolledOn: "desc" }],
      select: { rollNumber: true, class: { select: { name: true } }, section: { select: { name: true } } },
    }),
    ctx.db.feeCharge.findMany({
      where: { studentId: payment.studentId, academicSessionId: payment.academicSessionId },
      orderBy: { feeHead: { name: "asc" } },
      select: { amountMinor: true, feeHead: { select: { name: true } } },
    }),
    // "Previously paid" is everything in the same session taken before this
    // receipt: an earlier date, or the same date but entered first.
    ctx.db.feePayment.aggregate({
      where: {
        studentId: payment.studentId,
        academicSessionId: payment.academicSessionId,
        id: { not: payment.id },
        OR: [
          { paidOn: { lt: payment.paidOn } },
          { paidOn: payment.paidOn, createdAt: { lt: payment.createdAt } },
        ],
      },
      _sum: { amountMinor: true },
    }),
  ]);
  if (!school) throw new NotFoundError(NOT_FOUND);

  const totalMinor = charges.reduce((sum, row) => sum + row.amountMinor, 0);
  const previouslyPaidMinor = earlier._sum.amountMinor ?? 0;
  const afterMinor = totalMinor - previouslyPaidMinor - payment.amountMinor;
  const guardian = payment.student.parents[0] ?? null;
  const address = [school.addressLine, school.city, school.state, school.postalCode].filter(Boolean).join(", ");

  return {
    school: {
      name: school.name,
      logoUrl: school.logoUrl,
      address: address || null,
      phone: school.phone,
      email: school.email,
      affiliation: school.affiliationBoard,
      udiseCode: school.udiseCode,
      primaryColor: school.primaryColor,
      headerNote: school.receiptHeaderNote,
      footerNote: school.receiptFooterNote,
    },
    payment: {
      id: payment.id,
      studentId: payment.studentId,
      receiptNo: payment.receiptNo,
      paidOn: payment.paidOn,
      method: payment.method,
      referenceNo: payment.referenceNo,
      notes: payment.notes,
      amountMinor: payment.amountMinor,
      recordedBy: payment.recordedBy ? fullName(payment.recordedBy) : null,
    },
    session: { name: payment.academicSession.name },
    student: {
      name: fullName(payment.student),
      admissionNumber: payment.student.admissionNumber,
      className: enrollment?.class.name ?? null,
      sectionName: enrollment?.section.name ?? null,
      rollNumber: enrollment?.rollNumber ?? null,
    },
    guardian: guardian
      ? { name: fullName(guardian.parent), relationship: guardian.relationship, phone: guardian.parent.phone }
      : null,
    fees: {
      breakdown: charges.map((row) => ({ head: row.feeHead.name, amountMinor: row.amountMinor })),
      totalMinor,
      previouslyPaidMinor,
      currentMinor: payment.amountMinor,
      remainingMinor: Math.max(afterMinor, 0),
      excessMinor: Math.max(-afterMinor, 0),
    },
  };
}

/** A student's receipts for the receipt list, after the same access check. */
export async function listStudentReceipts(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PARENT", "STUDENT");
  await assertCanSeeStudentReceipts(ctx, studentId);
  return ctx.db.feePayment.findMany({
    where: { studentId },
    orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
    select: { id: true, receiptNo: true, paidOn: true, amountMinor: true, method: true },
  });
}

export async function getReceiptSettings(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const school = await ctx.db.school.findFirst({
    select: { receiptHeaderNote: true, receiptFooterNote: true, showFeesToStudents: true },
  });
  return school ?? { receiptHeaderNote: null, receiptFooterNote: null, showFeesToStudents: false };
}

export async function saveReceiptSettings(ctx: TenantContext, input: ReceiptSettingsInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.school.updateMany({ where: { id: ctx.schoolId }, data: input });

  await recordAudit({
    action: "FEE_RECEIPT_SETTINGS_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Fee receipt settings updated${input.showFeesToStudents ? "; students can see their fees" : ""}.`,
  });
}
