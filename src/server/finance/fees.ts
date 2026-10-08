import "server-only";

import { today } from "@/lib/dates";
import { allocate, dueSummary, splitInstallments } from "@/lib/fee-allocation";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import { ACTIVE_CONCESSION, netOf } from "@/server/finance/net";

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
 * Writers need the School Admin or a staff fee permission. Parents read their
 * own children's accounts through `server/parent/` (the ParentStudent link is
 * checked first). Students never see fees.
 */

export type FeeSummary = {
  /** What is owed after concessions: the net of every charge. */
  chargedMinor: number;
  paidMinor: number;
  /** Moved into a later session as "Previous outstanding" — no longer owed here. */
  carriedForwardMinor: number;
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
 * Shared by the office and parent views so they cannot drift: a parent
 * reading "₹10,000 pending" is reading the same arithmetic the office is.
 */
export function summarise(
  charges: Array<{ amountMinor: number; dueOn: Date; id?: string; installmentNo?: number }>,
  payments: Array<{ amountMinor: number }>,
  asOf: Date = today(),
  carriedForwardMinor = 0,
): FeeSummary {
  const chargedMinor = charges.reduce((sum, row) => sum + row.amountMinor, 0);
  const paidMinor = payments.reduce((sum, row) => sum + row.amountMinor, 0);
  const pendingMinor = Math.max(chargedMinor - paidMinor - carriedForwardMinor, 0);

  const status: FeeSummary["status"] =
    chargedMinor === 0
      ? "NONE"
      : pendingMinor === 0
        ? "PAID"
        : paidMinor > 0 || carriedForwardMinor > 0
          ? "PARTIAL"
          : "PENDING";

  // The soonest date still unpaid: payments settle the earliest instalments
  // first (lib/fee-allocation.ts), so a paid first instalment no longer makes
  // the account look overdue. Null once everything is paid.
  const allocated = allocate(
    charges.map((row, index) => ({ id: row.id ?? String(index).padStart(6, "0"), netMinor: row.amountMinor, dueOn: row.dueOn, installmentNo: row.installmentNo })),
    paidMinor + carriedForwardMinor,
    asOf,
  );
  const due = dueSummary(allocated);

  return {
    chargedMinor,
    paidMinor,
    carriedForwardMinor,
    pendingMinor,
    status,
    dueOn: pendingMinor === 0 ? null : due.nextDueOn,
    overdue: pendingMinor > 0 && due.overdue,
  };
}

// -----------------------------------------------------------------------------
// Fee heads — what this school charges for
// -----------------------------------------------------------------------------

export async function listFeeHeads(ctx: TenantContext, options: { activeOnly?: boolean } = {}) {
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect", "fees.manage"]);
  return ctx.db.feeHead.findMany({
    // System heads ("Previous outstanding (2025-26)") are created by carry-forward, never picked by hand.
    where: { isSystem: false, ...(options.activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, note: true, isActive: true },
  });
}

export async function createFeeHead(
  ctx: TenantContext,
  input: { name: string; note: string | null },
): Promise<{ id: string }> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");

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
  await assertAdminOrStaffPermission(ctx, "fees.manage");

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
  /** The total for this head. Split into instalments when `installments` has more than one due date. */
  amountMinor: number;
  dueOn: Date;
  notes: string | null;
  /** Due dates of the instalments, earliest first. Omitted or one date: paid in one go (on `dueOn`). */
  installments?: Date[] | null;
};

/** The due dates a charge is split over: the instalments asked for, or just `dueOn`. */
function scheduleOf(input: { dueOn: Date; installments?: Date[] | null }): Date[] {
  const dates = input.installments?.length ? [...input.installments].sort((a, b) => a.getTime() - b.getTime()) : [input.dueOn];
  if (dates.length > 12) throw new AppError("VALIDATION", "Choose at most 12 instalments.");
  if (new Set(dates.map((date) => date.getTime())).size !== dates.length) throw new AppError("VALIDATION", "Each instalment needs its own due date.");
  return dates;
}

type Tx = Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0];

/**
 * Write one head for one student as its instalments (1…n), in whole paise
 * that add up exactly to the total. Raising the head again corrects it: the
 * instalments are rewritten, and any beyond the new count go — unless money
 * has already been applied to them, which is refused.
 */
async function writeHeadCharges(
  tx: Tx,
  ctx: TenantContext,
  input: { studentId: string; academicSessionId: string; feeHeadId: string; totalMinor: number; dates: Date[]; notes?: string | null },
): Promise<string[]> {
  const amounts = splitInstallments(input.totalMinor, input.dates.length);
  const ids: string[] = [];
  for (const [index, dueOn] of input.dates.entries()) {
    const key = { schoolId: ctx.schoolId, academicSessionId: input.academicSessionId, studentId: input.studentId, feeHeadId: input.feeHeadId, installmentNo: index + 1 };
    const row = await tx.feeCharge.upsert({
      where: { schoolId_academicSessionId_studentId_feeHeadId_installmentNo: key },
      create: { ...key, amountMinor: amounts[index]!, dueOn, ...(input.notes !== undefined ? { notes: input.notes } : {}) },
      update: { amountMinor: amounts[index]!, dueOn, ...(input.notes !== undefined ? { notes: input.notes } : {}) },
      select: { id: true },
    });
    ids.push(row.id);
  }
  const extras = await tx.feeCharge.findMany({
    where: { studentId: input.studentId, academicSessionId: input.academicSessionId, feeHeadId: input.feeHeadId, installmentNo: { gt: input.dates.length } },
    select: { id: true },
  });
  if (extras.length) {
    const extraIds = extras.map((row) => row.id);
    await tx.feeCharge.deleteMany({ where: { lateFeeForId: { in: extraIds } } });
    await tx.feeCharge.deleteMany({ where: { id: { in: extraIds } } });
  }
  return ids;
}

/** Raise — or correct — one head on one student for the current session, in one go or in instalments. */
export async function chargeStudent(
  ctx: TenantContext,
  input: ChargeInput,
): Promise<{ id: string }> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");
  const session = await requireCurrentSession(ctx);

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A charge must be more than zero.");
  }
  const dates = scheduleOf(input);

  const [student, head] = await Promise.all([
    ctx.db.student.findFirst({
      where: { id: input.studentId },
      select: { id: true, firstName: true, lastName: true },
    }),
    ctx.db.feeHead.findFirst({ where: { id: input.feeHeadId, isSystem: false }, select: { id: true, name: true } }),
  ]);
  // A student or head from another school resolves to nothing, because the
  // client is already tenant-scoped.
  if (!student || !head) throw new NotFoundError("That student or fee head was not found.");

  const ids = await ctx.db.$transaction((tx) =>
    writeHeadCharges(tx, ctx, { studentId: student.id, academicSessionId: session.id, feeHeadId: head.id, totalMinor: input.amountMinor, dates, notes: input.notes }),
  );

  await recordAudit({
    action: "FEE_CHARGED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${head.name} of ${formatMinor(input.amountMinor)} charged to ${fullName(student)}${dates.length > 1 ? ` in ${dates.length} instalments` : ""}.`,
    metadata: { feeHeadId: head.id, amountMinor: input.amountMinor, installments: dates.length },
  });

  return { id: ids[0]! };
}

/**
 * Raise one head against every enrolled student in a section.
 *
 * The way a school actually bills: "Class 10 A owes ₹20,000 tuition this year",
 * in one go or in instalments. One row per child and instalment, because that
 * is where a charge lands — so a single child's amount can be corrected
 * afterwards. Written in one transaction: the whole class or nobody.
 */
export async function chargeSection(
  ctx: TenantContext,
  input: { sectionId: string; feeHeadId: string; amountMinor: number; dueOn: Date; installments?: Date[] | null },
): Promise<{ charged: number }> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");
  const session = await requireCurrentSession(ctx);

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A charge must be more than zero.");
  }
  const dates = scheduleOf(input);

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
    ctx.db.feeHead.findFirst({ where: { id: input.feeHeadId, isSystem: false }, select: { id: true, name: true } }),
  ]);
  if (!section || !head) throw new NotFoundError("That section or fee head was not found.");

  const enrolled = await ctx.db.studentEnrollment.findMany({
    where: { sectionId: section.id, academicSessionId: session.id, status: "ACTIVE" },
    select: { studentId: true },
  });

  await ctx.db.$transaction(
    async (tx) => {
      for (const row of enrolled) {
        await writeHeadCharges(tx, ctx, { studentId: row.studentId, academicSessionId: session.id, feeHeadId: head.id, totalMinor: input.amountMinor, dates });
      }
    },
    { timeout: 60_000 },
  );

  await recordAudit({
    action: "FEE_CHARGED",
    entityType: "Section",
    entityId: section.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${head.name} of ${formatMinor(input.amountMinor)} charged to ${enrolled.length} students in ${sectionLabel(section)}${dates.length > 1 ? `, in ${dates.length} instalments` : ""}.`,
    metadata: { feeHeadId: head.id, amountMinor: input.amountMinor, installments: dates.length, students: enrolled.length },
  });

  return { charged: enrolled.length };
}

/**
 * Remove a charge raised by mistake. Refused once money has been applied to it
 * (void the receipt or give a concession instead), and for carried-forward
 * balances. Its late fee, if any, goes with it.
 */
export async function removeCharge(ctx: TenantContext, chargeId: string): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");

  const charge = await ctx.db.feeCharge.findFirst({
    where: { id: chargeId },
    select: {
      id: true,
      amountMinor: true,
      installmentNo: true,
      studentId: true,
      academicSessionId: true,
      feeHead: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
      _count: { select: { carriedForwardBy: true } },
    },
  });
  if (!charge) throw new NotFoundError("That charge was not found.");
  if (charge._count.carriedForwardBy) {
    throw new ConflictError("This is a carried-forward balance from an earlier session. It stays on record; collect it, or give a concession on the earlier session's fees.");
  }
  const account = await readStudentFees(ctx, charge.studentId, charge.academicSessionId);
  const applied = account.charges.find((row) => row.id === charge.id);
  if (applied && applied.coveredMinor > 0) {
    throw new ConflictError("Money has already been applied to this charge. To correct it, void the receipt or give a concession instead of removing it.");
  }

  await ctx.db.$transaction([ctx.db.feeCharge.deleteMany({ where: { lateFeeForId: charge.id } }), ctx.db.feeCharge.deleteMany({ where: { id: charge.id } })]);

  await recordAudit({
    action: "FEE_UPDATED",
    entityType: "Student",
    entityId: charge.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${charge.feeHead.name}${charge.installmentNo > 1 ? ` (instalment ${charge.installmentNo})` : ""} charge of ${formatMinor(charge.amountMinor)} removed from ${fullName(charge.student)}.`,
    metadata: { chargeId: charge.id, amountMinor: charge.amountMinor },
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
  /** Sent once per payment form: a double submit returns the first payment instead of a second one. */
  idempotencyKey?: string | null;
};

/**
 * Record money received.
 *
 * Against the student's account for the session rather than head by head, which
 * is how a school takes a payment: "₹10,000 towards this year". The earliest
 * instalments are settled first (lib/fee-allocation.ts).
 *
 * Safe to submit twice: the form's idempotency key finds the first payment.
 * Never more than is outstanding — checked inside a serializable transaction,
 * so two desks taking money at once cannot overpay one child.
 */
export async function recordPayment(
  ctx: TenantContext,
  input: PaymentInput,
): Promise<{ id: string; duplicate?: boolean }> {
  await assertAdminOrStaffPermission(ctx, "fees.collect");
  const session = await requireCurrentSession(ctx);

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A payment must be more than zero.");
  }
  if (input.paidOn > today()) {
    throw new AppError("VALIDATION", "A payment cannot be dated in the future.");
  }

  if (input.idempotencyKey) {
    const earlier = await ctx.db.feePayment.findFirst({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, studentId: true } });
    if (earlier) {
      if (earlier.studentId !== input.studentId) throw new ConflictError("This form was already used for another payment. Reload the page and try again.");
      return { id: earlier.id, duplicate: true };
    }
  }

  const student = await ctx.db.student.findFirst({
    where: { id: input.studentId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) throw new NotFoundError("That student was not found.");

  const write = () =>
    ctx.db.$transaction(
      async (tx) => {
        // What is outstanding right now, from the rows themselves.
        const [charges, paid, carried] = await Promise.all([
          tx.feeCharge.findMany({ where: { studentId: student.id, academicSessionId: session.id }, select: { amountMinor: true, concessions: ACTIVE_CONCESSION } }),
          tx.feePayment.aggregate({ where: { studentId: student.id, academicSessionId: session.id, voidedAt: null }, _sum: { amountMinor: true } }),
          tx.feeCarryForward.aggregate({ where: { studentId: student.id, fromSessionId: session.id }, _sum: { amountMinor: true } }),
        ]);
        const owed = charges.reduce((sum, row) => sum + netOf(row).netMinor, 0);
        const pending = Math.max(owed - (paid._sum.amountMinor ?? 0) - (carried._sum.amountMinor ?? 0), 0);
        if (input.amountMinor > pending) {
          throw new AppError("VALIDATION", pending === 0 ? `${fullName(student)} has nothing outstanding this session. Add the fee to their account first, then record the payment.` : `That is more than the ${formatMinor(pending)} outstanding for ${fullName(student)}.`);
        }
        return tx.feePayment.create({
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
            idempotencyKey: input.idempotencyKey ?? null,
          },
          select: { id: true },
        });
      },
      { isolationLevel: "Serializable" },
    );

  let payment: { id: string };
  try {
    try {
      payment = await write();
    } catch (error) {
      // Another desk wrote at the same moment: try once more against fresh numbers.
      if (isSerializationFailure(error)) payment = await write();
      else throw error;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The same form submitted twice at once: return the payment that won.
      if (input.idempotencyKey) {
        const earlier = await ctx.db.feePayment.findFirst({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
        if (earlier) return { id: earlier.id, duplicate: true };
      }
      throw new ConflictError("That receipt number has already been used.");
    }
    throw error;
  }

  await recordAudit({
    action: "FEE_PAYMENT_RECORDED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${formatMinor(input.amountMinor)} received from ${fullName(student)}, receipt ${input.receiptNo}.`,
    // The record itself, for "Payment #…" on the audit log.
    metadata: { paymentId: payment.id, receiptNo: input.receiptNo, amountMinor: input.amountMinor, method: input.method },
  });

  return payment;
}

function isSerializationFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2034" || /could not serialize|serialization failure|write conflict/i.test(String((error as Error | null)?.message ?? ""));
}

/**
 * Void a payment entered by mistake. It is never deleted: the receipt keeps
 * its number, prints as VOID, and stops counting towards what was paid — so
 * the receipt book has no gaps and the correction is on record, with who,
 * when and why.
 */
export async function voidPayment(ctx: TenantContext, paymentId: string, reason: string): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "fees.manage");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("VALIDATION", "Say why this receipt is being voided.");

  const payment = await ctx.db.feePayment.findFirst({
    where: { id: paymentId },
    select: {
      id: true,
      amountMinor: true,
      receiptNo: true,
      studentId: true,
      voidedAt: true,
      familyPaymentId: true,
      student: { select: { firstName: true, lastName: true } },
    },
  });
  if (!payment) throw new NotFoundError("That payment was not found.");
  if (payment.voidedAt) throw new ConflictError(`Receipt ${payment.receiptNo} is already void.`);
  if (payment.familyPaymentId) throw new ConflictError("This is one child's share of a family payment. Void the family receipt instead, so every child's share is corrected together.");

  const { count } = await ctx.db.feePayment.updateMany({
    where: { id: payment.id, voidedAt: null },
    data: { voidedAt: new Date(), voidedById: ctx.user.id, voidReason: why },
  });
  // Voided by someone else a moment ago: nothing changed here, nothing to record.
  if (!count) throw new ConflictError(`Receipt ${payment.receiptNo} is already void.`);

  await recordAudit({
    action: "FEE_PAYMENT_REMOVED",
    entityType: "Student",
    entityId: payment.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Receipt ${payment.receiptNo} for ${formatMinor(payment.amountMinor)} from ${fullName(payment.student)} voided: ${why}`,
    metadata: { paymentId: payment.id, receiptNo: payment.receiptNo, amountMinor: payment.amountMinor, reason: why },
  });
}

/** The next receipt number for this school, so the office does not invent one. */
export async function suggestReceiptNo(ctx: TenantContext): Promise<string> {
  await assertAdminOrStaffPermission(ctx, "fees.collect");
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
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect"]);
  return readStudentFees(ctx, studentId, academicSessionId);
}

/**
 * The same read without the role assertion, for callers that have already
 * established the reader is entitled to this child — the parent portal through
 * its `ParentStudent` link. Never pass an id that came from a request without
 * that check first. (Students never see fees.)
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
      carriedOut: null,
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
        installmentNo: true,
        lateFeeForId: true,
        notes: true,
        feeHead: { select: { id: true, name: true, note: true, isSystem: true } },
        concessions: ACTIVE_CONCESSION,
        carriedForwardBy: { select: { fromSession: { select: { id: true, name: true } } } },
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
        voidedAt: true,
        voidReason: true,
        familyPaymentId: true,
        createdAt: true,
      },
    }),
  ]);
  const carriedOut = await ctx.db.feeCarryForward.findMany({
    where: { studentId, fromSessionId: sessionId },
    select: { amountMinor: true, toSession: { select: { name: true } } },
  });

  // Each charge with its original amount, its concession and what is left to pay.
  const shaped = charges.map(({ concessions, carriedForwardBy, ...row }) => ({
    ...row,
    ...netOf({ amountMinor: row.amountMinor, concessions }),
    concession: concessions[0] ?? null,
    /** Set for a "Previous outstanding" charge: where it was carried from. */
    carriedFrom: carriedForwardBy[0]?.fromSession ?? null,
  }));
  const carriedForwardMinor = carriedOut.reduce((sum, row) => sum + row.amountMinor, 0);
  const paidMinor = payments.filter((p) => !p.voidedAt).reduce((sum, row) => sum + row.amountMinor, 0);
  // Which instalments the money covers, earliest first; shown in due order.
  const allocated = allocate(
    shaped.map((row) => ({ ...row, netMinor: row.netMinor })),
    paidMinor + carriedForwardMinor,
    today(),
  );

  // A void receipt stays on the list, marked, but paid nothing.
  return {
    session,
    charges: allocated,
    payments,
    carriedOut: carriedOut.length ? { amountMinor: carriedForwardMinor, toSession: carriedOut.map((row) => row.toSession.name).join(", ") } : null,
    summary: summarise(
      shaped.map((row) => ({ id: row.id, amountMinor: row.netMinor, dueOn: row.dueOn, installmentNo: row.installmentNo })),
      payments.filter((p) => !p.voidedAt),
      today(),
      carriedForwardMinor,
    ),
  };
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
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect", "fees.manage"]);
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
          select: { id: true, studentId: true, amountMinor: true, dueOn: true, installmentNo: true, concessions: ACTIVE_CONCESSION },
        })
      : Promise.resolve([]),
    studentIds.length
      ? ctx.db.feePayment.findMany({
          where: { academicSessionId: session.id, studentId: { in: studentIds }, voidedAt: null },
          select: { studentId: true, amountMinor: true },
        })
      : Promise.resolve([]),
  ]);

  const carried = studentIds.length
    ? await ctx.db.feeCarryForward.groupBy({ by: ["studentId"], where: { fromSessionId: session.id, studentId: { in: studentIds } }, _sum: { amountMinor: true } })
    : [];
  const carriedBy = new Map(carried.map((row) => [row.studentId, row._sum.amountMinor ?? 0]));
  // Net of concessions, the same arithmetic as the student's own page.
  const chargesBy = new Map<string, Array<{ id: string; amountMinor: number; dueOn: Date; installmentNo: number }>>();
  for (const row of chargeRows) {
    const list = chargesBy.get(row.studentId) ?? [];
    list.push({ id: row.id, amountMinor: netOf(row).netMinor, dueOn: row.dueOn, installmentNo: row.installmentNo });
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
        summary: summarise(chargesBy.get(row.student.id) ?? [], paymentsBy.get(row.student.id) ?? [], today(), carriedBy.get(row.student.id) ?? 0),
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
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect", "fees.manage"]);

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
      voidedAt: true,
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
