import "server-only";

import { today } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { ageingBucket, allocate, daysOverdue } from "@/lib/fee-allocation";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import { ACTIVE_CONCESSION, netOf } from "@/server/finance/net";

/**
 * Fee reports, every figure from the rows themselves:
 *
 *   * charges (net of their active concession), non-void payments and
 *     carry-forwards are read once per session, each row once — no joins that
 *     could count a payment twice;
 *   * payments settle the earliest instalments first (lib/fee-allocation.ts),
 *     which is what makes "overdue" mean an instalment really is unpaid.
 *
 * Reading needs a fee permission (the School Admin always has it).
 */

const READ = ["fees.view", "fees.collect", "fees.manage", "fees.reports"] as const;

async function sessionOf(ctx: TenantContext, academicSessionId?: string | null) {
  const session = await ctx.db.academicSession.findFirst({
    where: academicSessionId ? { id: academicSessionId } : { isCurrent: true },
    select: { id: true, name: true },
  });
  if (!session) throw new NotFoundError("Set up an academic session first.");
  return session;
}

/** Every student with fees in a session: their class, charges (net), payments and carry-forward. */
export async function loadSessionAccounts(ctx: TenantContext, academicSessionId: string, filter: { sectionId?: string | null; studentId?: string | null } = {}) {
  const asOf = today();
  const [enrollments, charges, payments, carried] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { academicSessionId, ...(filter.sectionId ? { sectionId: filter.sectionId } : {}), ...(filter.studentId ? { studentId: filter.studentId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { studentId: true, status: true, section: { select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } } },
    }),
    ctx.db.feeCharge.findMany({
      where: { academicSessionId, ...(filter.studentId ? { studentId: filter.studentId } : {}) },
      select: { id: true, studentId: true, amountMinor: true, dueOn: true, installmentNo: true, lateFeeForId: true, createdAt: true, feeHead: { select: { name: true } }, concessions: ACTIVE_CONCESSION },
    }),
    ctx.db.feePayment.findMany({
      where: { academicSessionId, voidedAt: null, ...(filter.studentId ? { studentId: filter.studentId } : {}) },
      select: { studentId: true, amountMinor: true },
    }),
    ctx.db.feeCarryForward.findMany({ where: { fromSessionId: academicSessionId, ...(filter.studentId ? { studentId: filter.studentId } : {}) }, select: { studentId: true, amountMinor: true } }),
  ]);

  // One placement per student: the latest enrolment in the session.
  const placement = new Map<string, (typeof enrollments)[number]>();
  for (const row of enrollments) if (!placement.has(row.studentId)) placement.set(row.studentId, row);

  const byStudent = new Map<string, { charges: typeof charges; paidMinor: number; carriedMinor: number }>();
  const entry = (studentId: string) => {
    let row = byStudent.get(studentId);
    if (!row) byStudent.set(studentId, (row = { charges: [], paidMinor: 0, carriedMinor: 0 }));
    return row;
  };
  for (const row of charges) entry(row.studentId).charges.push(row);
  for (const row of payments) entry(row.studentId).paidMinor += row.amountMinor;
  for (const row of carried) entry(row.studentId).carriedMinor += row.amountMinor;

  const studentIds = [...new Set([...byStudent.keys()].filter((id) => !filter.sectionId || placement.has(id)))];
  const students = studentIds.length
    ? await ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true, admissionNumber: true } })
    : [];
  const studentById = new Map(students.map((row) => [row.id, row]));

  return studentIds.flatMap((studentId) => {
    const account = byStudent.get(studentId)!;
    const student = studentById.get(studentId);
    if (!student) return [];
    const perHead = new Map<string, number>();
    for (const charge of account.charges) perHead.set(charge.feeHead.name, (perHead.get(charge.feeHead.name) ?? 0) + 1);
    const shaped = account.charges.map((charge) => {
      const net = netOf(charge);
      return { installments: perHead.get(charge.feeHead.name) ?? 1, id: charge.id, netMinor: net.netMinor, originalMinor: net.originalMinor, discountMinor: net.discountMinor, dueOn: charge.dueOn, installmentNo: charge.installmentNo, head: charge.feeHead.name, isLateFee: charge.lateFeeForId !== null, lateFeeForId: charge.lateFeeForId };
    });
    const allocated = allocate(shaped, account.paidMinor + account.carriedMinor, asOf);
    const chargedMinor = shaped.reduce((sum, row) => sum + row.netMinor, 0);
    const place = placement.get(studentId);
    return [
      {
        studentId,
        name: fullName(student),
        admissionNumber: student.admissionNumber,
        sectionId: place?.section.id ?? null,
        section: place ? sectionLabel(place.section) : "Not placed",
        level: place?.section.class.level ?? 999,
        assignedMinor: shaped.reduce((sum, row) => sum + row.originalMinor, 0),
        concessionMinor: shaped.reduce((sum, row) => sum + row.discountMinor, 0),
        chargedMinor,
        paidMinor: account.paidMinor,
        carriedMinor: account.carriedMinor,
        pendingMinor: Math.max(chargedMinor - account.paidMinor - account.carriedMinor, 0),
        overdueMinor: allocated.filter((row) => row.overdue).reduce((sum, row) => sum + row.remainingMinor, 0),
        charges: allocated,
      },
    ];
  });
}

type Totals = { students: number; assignedMinor: number; concessionMinor: number; chargedMinor: number; paidMinor: number; pendingMinor: number; overdueMinor: number };
const emptyTotals = (): Totals => ({ students: 0, assignedMinor: 0, concessionMinor: 0, chargedMinor: 0, paidMinor: 0, pendingMinor: 0, overdueMinor: 0 });
function add(totals: Totals, row: Omit<Totals, "students">) {
  totals.students += 1;
  totals.assignedMinor += row.assignedMinor;
  totals.concessionMinor += row.concessionMinor;
  totals.chargedMinor += row.chargedMinor;
  totals.paidMinor += row.paidMinor;
  totals.pendingMinor += row.pendingMinor;
  totals.overdueMinor += row.overdueMinor;
}

/** Class-wise: for each class, what was assigned, given off, collected, and is still pending or overdue. */
export async function classFeeSummary(ctx: TenantContext, academicSessionId?: string | null) {
  await assertAdminOrStaffPermission(ctx, [...READ]);
  const session = await sessionOf(ctx, academicSessionId);
  const accounts = await loadSessionAccounts(ctx, session.id);
  const bySection = new Map<string, Totals & { section: string; level: number }>();
  const total = emptyTotals();
  for (const account of accounts) {
    const key = account.sectionId ?? "none";
    let row = bySection.get(key);
    if (!row) bySection.set(key, (row = { ...emptyTotals(), section: account.section, level: account.level }));
    add(row, account);
    add(total, account);
  }
  return { session, rows: [...bySection.values()].sort((a, b) => a.level - b.level || a.section.localeCompare(b.section)), total };
}

/** Session-wise: the same totals for every session, so years can be compared. */
export async function sessionFeeSummary(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, [...READ]);
  const sessions = await ctx.db.academicSession.findMany({ orderBy: { startDate: "desc" }, select: { id: true, name: true, isCurrent: true } });
  const rows = [];
  for (const session of sessions) {
    const total = emptyTotals();
    for (const account of await loadSessionAccounts(ctx, session.id)) add(total, account);
    rows.push({ ...session, ...total });
  }
  return rows;
}

/**
 * Instalments still unpaid after their due date, oldest first, with how many
 * days overdue and the ageing bucket.
 */
export async function overdueInstallments(ctx: TenantContext, filters: { academicSessionId?: string | null; sectionId?: string | null } = {}) {
  await assertAdminOrStaffPermission(ctx, [...READ]);
  const session = await sessionOf(ctx, filters.academicSessionId);
  const asOf = today();
  const accounts = await loadSessionAccounts(ctx, session.id, { sectionId: filters.sectionId });
  const rows = accounts.flatMap((account) =>
    account.charges
      .filter((charge) => charge.overdue)
      .map((charge) => {
        const days = daysOverdue(charge.dueOn, asOf);
        return {
          chargeId: charge.id,
          studentId: account.studentId,
          name: account.name,
          admissionNumber: account.admissionNumber,
          section: account.section,
          head: charge.head,
          installmentNo: charge.installmentNo,
          installments: charge.installments,
          isLateFee: charge.isLateFee,
          dueOn: charge.dueOn,
          remainingMinor: charge.remainingMinor,
          days,
          bucket: ageingBucket(days),
        };
      }),
  );
  rows.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime() || a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<ReturnType<typeof ageingBucket>, number>;
  for (const row of rows) buckets[row.bucket] += row.remainingMinor;
  return { session, rows, buckets, totalMinor: rows.reduce((sum, row) => sum + row.remainingMinor, 0) };
}

export type LedgerEntry = {
  date: Date;
  kind: "CHARGE" | "CONCESSION" | "PAYMENT" | "VOID" | "CARRIED_OUT";
  description: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
  receiptNo?: string;
};

/**
 * One student's ledger for a session, in date order: charges (debit),
 * concessions and payments (credit), a voided receipt shown with its reversal,
 * and balances carried into a later session — with the running balance.
 */
export async function studentLedger(ctx: TenantContext, studentId: string, academicSessionId?: string | null) {
  await assertAdminOrStaffPermission(ctx, [...READ]);
  return readStudentLedger(ctx, studentId, academicSessionId);
}

/** The ledger without the permission check — for callers that already checked the reader (the parent portal's link). */
export async function readStudentLedger(ctx: TenantContext, studentId: string, academicSessionId?: string | null) {
  const session = await sessionOf(ctx, academicSessionId);
  const student = await ctx.db.student.findFirst({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true, admissionNumber: true } });
  if (!student) throw new NotFoundError("That student was not found.");
  const [charges, payments, carried] = await Promise.all([
    ctx.db.feeCharge.findMany({
      where: { studentId, academicSessionId: session.id },
      select: { id: true, amountMinor: true, dueOn: true, installmentNo: true, createdAt: true, feeHead: { select: { name: true } }, concessions: ACTIVE_CONCESSION },
    }),
    ctx.db.feePayment.findMany({ where: { studentId, academicSessionId: session.id }, select: { id: true, amountMinor: true, paidOn: true, receiptNo: true, method: true, voidedAt: true, voidReason: true, createdAt: true } }),
    ctx.db.feeCarryForward.findMany({ where: { studentId, fromSessionId: session.id }, select: { amountMinor: true, createdAt: true, toSession: { select: { name: true } } } }),
  ]);
  type Raw = Omit<LedgerEntry, "balanceMinor"> & { order: number };
  const raw: Raw[] = [];
  for (const charge of charges) {
    const label = `${charge.feeHead.name}${charge.installmentNo > 1 || charges.some((other) => other.feeHead.name === charge.feeHead.name && other.id !== charge.id) ? ` — instalment ${charge.installmentNo}` : ""}`;
    // A charge is booked on its due date, the date the family owes it.
    raw.push({ date: charge.dueOn, kind: "CHARGE", description: label, debitMinor: charge.amountMinor, creditMinor: 0, order: 0 });
    const net = netOf(charge);
    if (net.discountMinor > 0) raw.push({ date: charge.concessions[0]!.createdAt, kind: "CONCESSION", description: `Concession on ${label}: ${charge.concessions[0]!.reason}`, debitMinor: 0, creditMinor: net.discountMinor, order: 1 });
  }
  for (const payment of payments) {
    raw.push({ date: payment.paidOn, kind: "PAYMENT", description: `Payment (${payment.method.replace("_", " ").toLowerCase()})`, debitMinor: 0, creditMinor: payment.amountMinor, receiptNo: payment.receiptNo, order: 2 });
    if (payment.voidedAt) raw.push({ date: payment.voidedAt, kind: "VOID", description: `Receipt ${payment.receiptNo} voided${payment.voidReason ? `: ${payment.voidReason}` : ""}`, debitMinor: payment.amountMinor, creditMinor: 0, receiptNo: payment.receiptNo, order: 3 });
  }
  for (const row of carried) raw.push({ date: row.createdAt, kind: "CARRIED_OUT", description: `Carried forward to ${row.toSession.name}`, debitMinor: 0, creditMinor: row.amountMinor, order: 4 });
  raw.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);
  let balance = 0;
  const entries: LedgerEntry[] = raw.map(({ order: _order, ...row }) => {
    void _order;
    balance += row.debitMinor - row.creditMinor;
    return { ...row, balanceMinor: balance };
  });
  return {
    session,
    student: { id: student.id, name: fullName(student), admissionNumber: student.admissionNumber },
    entries,
    totals: {
      debitMinor: entries.reduce((sum, row) => sum + row.debitMinor, 0),
      creditMinor: entries.reduce((sum, row) => sum + row.creditMinor, 0),
      balanceMinor: balance,
    },
  };
}
