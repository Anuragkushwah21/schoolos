import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";

/**
 * Fees: what a school charges, and what it has received.
 *
 * One source of truth. What a family owes is the sum of their `FeeCharge` rows;
 * what is left is that minus their `FeePayment` rows. Nothing stores a running
 * balance, so a corrected charge or a deleted receipt cannot leave a total
 * disagreeing with the rows it came from — which is the way fee software usually
 * goes wrong.
 *
 * Money is integer paise throughout, the same convention as `Plan.priceMinor`.
 *
 * Everything here is School Admin only. The parent-facing and student-facing
 * reads live in `server/parent/` and `server/student/`, start from the session,
 * and never reach these writers.
 */

export type FeeSummary = {
  chargedMinor: number;
  paidMinor: number;
  /** Never negative: an overpayment is shown as paid in full, not as a credit. */
  pendingMinor: number;
  status: "PAID" | "PARTIAL" | "PENDING" | "NONE";
  /** The earliest unmet due date, or null when nothing is outstanding. */
  dueOn: Date | null;
  overdue: boolean;
};

/**
 * Turn a set of charges and payments into the four numbers every screen shows.
 *
 * Shared by the admin, parent and student views so all three cannot drift: a
 * parent reading "₹10,000 pending" is reading the same arithmetic the office is.
 */
export function summarise(
  charges: Array<{ amountMinor: number; dueOn: Date }>,
  payments: Array<{ amountMinor: number }>,
  asOf: Date = today(),
): FeeSummary {
  const chargedMinor = charges.reduce((sum, row) => sum + row.amountMinor, 0);
  const paidMinor = payments.reduce((sum, row) => sum + row.amountMinor, 0);
  const pendingMinor = Math.max(chargedMinor - paidMinor, 0);

  const status: FeeSummary["status"] =
    chargedMinor === 0
      ? "NONE"
      : pendingMinor === 0
        ? "PAID"
        : paidMinor > 0
          ? "PARTIAL"
          : "PENDING";

  // The soonest date money is owed by. Once everything is paid there is nothing
  // to be due, which is why this is null rather than the last charge's date.
  const dueOn =
    pendingMinor === 0
      ? null
      : charges
          .map((row) => row.dueOn)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return {
    chargedMinor,
    paidMinor,
    pendingMinor,
    status,
    dueOn,
    overdue: dueOn !== null && dueOn < asOf,
  };
}

// -----------------------------------------------------------------------------
// Fee heads — what this school charges for
// -----------------------------------------------------------------------------

export async function listFeeHeads(ctx: TenantContext, options: { activeOnly?: boolean } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.feeHead.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, note: true, isActive: true },
  });
}

export async function createFeeHead(
  ctx: TenantContext,
  input: { name: string; note: string | null },
): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  try {
    const created = await ctx.db.feeHead.create({
      data: { schoolId: ctx.schoolId, name: input.name, note: input.note },
      select: { id: true },
    });

    await recordAudit({
      action: "FEE_HEAD_CREATED",
      entityType: "FeeHead",
      entityId: created.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Fee head "${input.name}" added.`,
    });

    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A fee head with that name already exists.");
    }
    throw error;
  }
}

export async function setFeeHeadActive(
  ctx: TenantContext,
  feeHeadId: string,
  isActive: boolean,
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const head = await ctx.db.feeHead.findFirst({
    where: { id: feeHeadId },
    select: { id: true, name: true },
  });
  if (!head) throw new NotFoundError("That fee head was not found.");

  // Deactivated rather than deleted: charges already raised under it must keep
  // their label, and a school that stops charging for transport this year may
  // start again next year.
  await ctx.db.feeHead.updateMany({ where: { id: head.id }, data: { isActive } });

  await recordAudit({
    action: "FEE_HEAD_UPDATED",
    entityType: "FeeHead",
    entityId: head.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Fee head "${head.name}" ${isActive ? "reactivated" : "deactivated"}.`,
  });
}

// -----------------------------------------------------------------------------
// Charges
// -----------------------------------------------------------------------------

export type ChargeInput = {
  studentId: string;
  feeHeadId: string;
  amountMinor: number;
  dueOn: Date;
  notes: string | null;
};

/** Raise — or correct — one charge on one student for the current session. */
export async function chargeStudent(
  ctx: TenantContext,
  input: ChargeInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A charge must be more than zero.");
  }

  const [student, head] = await Promise.all([
    ctx.db.student.findFirst({
      where: { id: input.studentId },
      select: { id: true, firstName: true, lastName: true },
    }),
    ctx.db.feeHead.findFirst({ where: { id: input.feeHeadId }, select: { id: true, name: true } }),
  ]);
  // A student or head from another school resolves to nothing, because the
  // client is already tenant-scoped.
  if (!student || !head) throw new NotFoundError("That student or fee head was not found.");

  const charge = await ctx.db.feeCharge.upsert({
    where: {
      schoolId_academicSessionId_studentId_feeHeadId: {
        schoolId: ctx.schoolId,
        academicSessionId: session.id,
        studentId: student.id,
        feeHeadId: head.id,
      },
    },
    create: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      studentId: student.id,
      feeHeadId: head.id,
      amountMinor: input.amountMinor,
      dueOn: input.dueOn,
      notes: input.notes,
    },
    // Raising the same head twice corrects the first rather than billing the
    // family for it again.
    update: { amountMinor: input.amountMinor, dueOn: input.dueOn, notes: input.notes },
    select: { id: true },
  });

  await recordAudit({
    action: "FEE_CHARGED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${head.name} of ${formatMinor(input.amountMinor)} charged to ${fullName(student)}.`,
  });

  return charge;
}

/**
 * Raise one head against every enrolled student in a section.
 *
 * The way a school actually bills: "Class 10 A owes ₹20,000 tuition this year".
 * One row per child, because that is where a charge lands — and it means a
 * single child's amount can be corrected afterwards without touching the class.
 */
export async function chargeSection(
  ctx: TenantContext,
  input: { sectionId: string; feeHeadId: string; amountMinor: number; dueOn: Date },
): Promise<{ charged: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A charge must be more than zero.");
  }

  const [section, head] = await Promise.all([
    ctx.db.section.findFirst({
      where: { id: input.sectionId, academicSessionId: session.id },
      select: {
        id: true,
        name: true,
        class: { select: { name: true } },
        stream: { select: { name: true } },
      },
    }),
    ctx.db.feeHead.findFirst({ where: { id: input.feeHeadId }, select: { id: true, name: true } }),
  ]);
  if (!section || !head) throw new NotFoundError("That section or fee head was not found.");

  const enrolled = await ctx.db.studentEnrollment.findMany({
    where: { sectionId: section.id, academicSessionId: session.id, status: "ACTIVE" },
    select: { studentId: true },
  });

  for (const row of enrolled) {
    await ctx.db.feeCharge.upsert({
      where: {
        schoolId_academicSessionId_studentId_feeHeadId: {
          schoolId: ctx.schoolId,
          academicSessionId: session.id,
          studentId: row.studentId,
          feeHeadId: head.id,
        },
      },
      create: {
        schoolId: ctx.schoolId,
        academicSessionId: session.id,
        studentId: row.studentId,
        feeHeadId: head.id,
        amountMinor: input.amountMinor,
        dueOn: input.dueOn,
      },
      update: { amountMinor: input.amountMinor, dueOn: input.dueOn },
    });
  }

  await recordAudit({
    action: "FEE_CHARGED",
    entityType: "Section",
    entityId: section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${head.name} of ${formatMinor(input.amountMinor)} charged to ${enrolled.length} students in ${sectionLabel(section)}.`,
  });

  return { charged: enrolled.length };
}

export async function removeCharge(ctx: TenantContext, chargeId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const charge = await ctx.db.feeCharge.findFirst({
    where: { id: chargeId },
    select: {
      id: true,
      amountMinor: true,
      studentId: true,
      feeHead: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
    },
  });
  if (!charge) throw new NotFoundError("That charge was not found.");

  await ctx.db.feeCharge.deleteMany({ where: { id: charge.id } });

  await recordAudit({
    action: "FEE_UPDATED",
    entityType: "Student",
    entityId: charge.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${charge.feeHead.name} charge of ${formatMinor(charge.amountMinor)} removed from ${fullName(charge.student)}.`,
  });
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

export type PaymentInput = {
  studentId: string;
  amountMinor: number;
  paidOn: Date;
  method: "CASH" | "CHEQUE" | "BANK_TRANSFER" | "UPI" | "CARD" | "OTHER";
  receiptNo: string;
  /** Cheque number, UPI or bank transaction id. */
  referenceNo?: string | null;
  notes: string | null;
};

/**
 * Record money received.
 *
 * Against the student's account for the session rather than head by head, which
 * is how a school takes a payment: "₹10,000 towards this year". Splitting every
 * receipt across four heads would invent work for the office and a new way for
 * the books to be wrong.
 */
export async function recordPayment(
  ctx: TenantContext,
  input: PaymentInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await requireCurrentSession(ctx);

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A payment must be more than zero.");
  }
  if (input.paidOn > today()) {
    throw new AppError("VALIDATION", "A payment cannot be dated in the future.");
  }

  const student = await ctx.db.student.findFirst({
    where: { id: input.studentId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) throw new NotFoundError("That student was not found.");

  try {
    const payment = await ctx.db.feePayment.create({
      data: {
        schoolId: ctx.schoolId,
        academicSessionId: session.id,
        studentId: student.id,
        amountMinor: input.amountMinor,
        paidOn: input.paidOn,
        method: input.method,
        receiptNo: input.receiptNo,
        referenceNo: input.referenceNo ?? null,
        notes: input.notes,
        recordedById: ctx.user.id,
      },
      select: { id: true },
    });

    await recordAudit({
      action: "FEE_PAYMENT_RECORDED",
      entityType: "Student",
      entityId: student.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${formatMinor(input.amountMinor)} received from ${fullName(student)}, receipt ${input.receiptNo}.`,
    });

    return payment;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That receipt number has already been used.");
    }
    throw error;
  }
}

export async function removePayment(ctx: TenantContext, paymentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const payment = await ctx.db.feePayment.findFirst({
    where: { id: paymentId },
    select: {
      id: true,
      amountMinor: true,
      receiptNo: true,
      studentId: true,
      student: { select: { firstName: true, lastName: true } },
    },
  });
  if (!payment) throw new NotFoundError("That payment was not found.");

  await ctx.db.feePayment.deleteMany({ where: { id: payment.id } });

  await recordAudit({
    action: "FEE_PAYMENT_REMOVED",
    entityType: "Student",
    entityId: payment.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Receipt ${payment.receiptNo} for ${formatMinor(payment.amountMinor)} from ${fullName(payment.student)} removed.`,
  });
}

/** The next receipt number for this school, so the office does not invent one. */
export async function suggestReceiptNo(ctx: TenantContext): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await ctx.db.feePayment.findMany({
    where: { receiptNo: { startsWith: "REC-" } },
    select: { receiptNo: true },
  });
  const highest = rows.reduce((max, row) => {
    const n = Number.parseInt(row.receiptNo.slice(4), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 1000);
  return `REC-${highest + 1}`;
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/**
 * One student's fee account for a session: the breakdown, the receipts and the
 * four numbers.
 *
 * Takes a `studentId`, so it is School Admin only. The parent and student views
 * resolve the child from the session first and then read the same rows.
 */
export async function getStudentFees(
  ctx: TenantContext,
  studentId: string,
  academicSessionId?: string,
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return readStudentFees(ctx, studentId, academicSessionId);
}

/**
 * The same read without the role assertion, for callers that have already
 * established the reader is entitled to this child — the parent portal through
 * its `ParentStudent` link, and a student reading their own record.
 *
 * Not exported from the module's public surface by accident: it is named for
 * what it assumes, and the two callers both resolve the child from the session
 * before they get here.
 */
export async function readStudentFees(
  ctx: TenantContext,
  studentId: string,
  academicSessionId?: string,
) {
  const sessionId =
    academicSessionId ??
    (
      await ctx.db.academicSession.findFirst({
        where: { isCurrent: true },
        select: { id: true },
      })
    )?.id;

  if (!sessionId) {
    return {
      session: null,
      charges: [],
      payments: [],
      summary: summarise([], []),
    };
  }

  const [session, charges, payments] = await Promise.all([
    ctx.db.academicSession.findFirst({
      where: { id: sessionId },
      select: { id: true, name: true },
    }),
    ctx.db.feeCharge.findMany({
      where: { studentId, academicSessionId: sessionId },
      orderBy: { dueOn: "asc" },
      select: {
        id: true,
        amountMinor: true,
        dueOn: true,
        notes: true,
        feeHead: { select: { id: true, name: true, note: true } },
      },
    }),
    ctx.db.feePayment.findMany({
      where: { studentId, academicSessionId: sessionId },
      orderBy: { paidOn: "desc" },
      select: {
        id: true,
        amountMinor: true,
        paidOn: true,
        method: true,
        receiptNo: true,
        referenceNo: true,
        notes: true,
      },
    }),
  ]);

  return { session, charges, payments, summary: summarise(charges, payments) };
}

export const FEE_STATUSES = ["PAID", "PARTIAL", "PENDING", "NONE"] as const;
export type FeeStatusFilter = (typeof FEE_STATUSES)[number];

export const FEE_PAGE_SIZE = 25;

/**
 * Every student's fee position for a session, for the collection screen.
 *
 * Two grouped queries and one student query rather than three per student, so a
 * school with a thousand children still renders.
 */
export async function listFeePositions(
  ctx: TenantContext,
  filters: {
    q?: string;
    sectionId?: string;
    status?: FeeStatusFilter;
    academicSessionId?: string;
    page?: number;
  } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = filters.academicSessionId
    ? await ctx.db.academicSession.findFirst({
        where: { id: filters.academicSessionId },
        select: { id: true, name: true },
      })
    : await ctx.db.academicSession.findFirst({
        where: { isCurrent: true },
        select: { id: true, name: true },
      });

  if (!session) return { session: null, rows: [], total: 0, page: 1, pageCount: 1, totals: null };

  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: {
      academicSessionId: session.id,
      status: "ACTIVE",
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.q
        ? {
            student: {
              OR: [
                { firstName: { contains: filters.q, mode: "insensitive" } },
                { lastName: { contains: filters.q, mode: "insensitive" } },
                { admissionNumber: { contains: filters.q, mode: "insensitive" } },
                {
                  parents: {
                    some: {
                      parent: {
                        OR: [
                          { firstName: { contains: filters.q, mode: "insensitive" } },
                          { lastName: { contains: filters.q, mode: "insensitive" } },
                          { phone: { contains: filters.q } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          }
        : {}),
    },
    select: {
      rollNumber: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          parents: {
            orderBy: { isPrimary: "desc" },
            take: 1,
            select: { parent: { select: { firstName: true, lastName: true, phone: true } } },
          },
        },
      },
      section: {
        select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
      },
    },
  });

  const studentIds = enrollments.map((row) => row.student.id);
  const [chargeRows, paymentRows] = await Promise.all([
    studentIds.length
      ? ctx.db.feeCharge.findMany({
          where: { academicSessionId: session.id, studentId: { in: studentIds } },
          select: { studentId: true, amountMinor: true, dueOn: true },
        })
      : Promise.resolve([]),
    studentIds.length
      ? ctx.db.feePayment.findMany({
          where: { academicSessionId: session.id, studentId: { in: studentIds } },
          select: { studentId: true, amountMinor: true },
        })
      : Promise.resolve([]),
  ]);

  const chargesBy = new Map<string, Array<{ amountMinor: number; dueOn: Date }>>();
  for (const row of chargeRows) {
    const list = chargesBy.get(row.studentId) ?? [];
    list.push({ amountMinor: row.amountMinor, dueOn: row.dueOn });
    chargesBy.set(row.studentId, list);
  }
  const paymentsBy = new Map<string, Array<{ amountMinor: number }>>();
  for (const row of paymentRows) {
    const list = paymentsBy.get(row.studentId) ?? [];
    list.push({ amountMinor: row.amountMinor });
    paymentsBy.set(row.studentId, list);
  }

  let rows = enrollments
    .map((row) => {
      const primary = row.student.parents[0]?.parent ?? null;
      return {
        studentId: row.student.id,
        name: fullName(row.student),
        admissionNumber: row.student.admissionNumber,
        rollNumber: row.rollNumber,
        section: sectionLabel(row.section),
        parentName: primary ? fullName(primary) : null,
        parentPhone: primary?.phone ?? null,
        summary: summarise(chargesBy.get(row.student.id) ?? [], paymentsBy.get(row.student.id) ?? []),
      };
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));

  if (filters.status) rows = rows.filter((row) => row.summary.status === filters.status);

  // The school-wide position, computed from the same rows the table shows.
  const totals = {
    chargedMinor: rows.reduce((sum, row) => sum + row.summary.chargedMinor, 0),
    paidMinor: rows.reduce((sum, row) => sum + row.summary.paidMinor, 0),
    pendingMinor: rows.reduce((sum, row) => sum + row.summary.pendingMinor, 0),
    students: rows.length,
    overdue: rows.filter((row) => row.summary.overdue).length,
  };

  const page = Math.max(1, filters.page ?? 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / FEE_PAGE_SIZE));

  return {
    session,
    rows: rows.slice((page - 1) * FEE_PAGE_SIZE, page * FEE_PAGE_SIZE),
    total: rows.length,
    page,
    pageCount,
    totals,
  };
}

/** Recent receipts across the school, for the payments screen. */
export async function listPayments(
  ctx: TenantContext,
  filters: { academicSessionId?: string; take?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  return ctx.db.feePayment.findMany({
    where: filters.academicSessionId ? { academicSessionId: filters.academicSessionId } : {},
    orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 50,
    select: {
      id: true,
      amountMinor: true,
      paidOn: true,
      method: true,
      receiptNo: true,
      student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
      recordedBy: { select: { email: true } },
    },
  });
}

/** ₹25,000 from 2500000 paise. Kept here so audit lines read like the UI. */
function formatMinor(minor: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
