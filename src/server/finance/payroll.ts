import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { workingDays } from "@/lib/calendar";
import { addDays, dateOnly, formatMonth, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney, fullName } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { getSchoolCalendar } from "@/server/calendar/holidays";
import { monthOf } from "@/server/finance/salary";

/**
 * Monthly payroll, built on what already exists: the salary structure in
 * `TeacherSalary` and the money paid in `SalaryPayment`. No draft table — the
 * payroll for a month is computed on demand, the admin adjusts any amount
 * before paying, and marking a batch paid writes one `SalaryPayment` per
 * teacher in a single transaction. The unique (teacher, month) index still
 * makes paying anyone twice impossible.
 *
 * School Admin only. Teachers see their own salary on their profile; students
 * and parents never reach any of this.
 */

export type PayrollRow = {
  teacherId: string;
  name: string;
  employeeId: string;
  designation: string | null;
  /** Null when no salary structure is in effect for the month. */
  structure: {
    salaryType: "MONTHLY" | "ANNUAL" | "HOURLY";
    baseMinor: number;
    allowancesMinor: number;
    deductionsMinor: number;
  } | null;
  /** What is due for the month, or null when it cannot be computed (hourly, or no structure). */
  dueMinor: number | null;
  /** Working days of approved unpaid leave in the month — shown for the admin to deduct. */
  unpaidLeaveDays: number;
  payment: { id: string; amountMinor: number; paidOn: Date; method: PaymentMethod } | null;
};

function monthBounds(month: Date) {
  const start = monthOf(month);
  const end = addDays(dateOnly(start.getUTCFullYear(), start.getUTCMonth() + 2, 1), -1);
  return { start, end };
}

export async function getPayroll(ctx: TenantContext, month: Date) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { start, end } = monthBounds(month);

  const [teachers, payments, unpaidLeave, calendar] = await Promise.all([
    ctx.db.teacher.findMany({
      // Current staff, plus anyone already paid for this month.
      where: { OR: [{ status: { in: ["ACTIVE", "ON_LEAVE"] } }, { salaryPayments: { some: { forMonth: start } } }] },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        designation: true,
        salaries: {
          where: { effectiveFrom: { lte: end } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { salaryType: true, amountMinor: true, allowancesMinor: true, deductionsMinor: true },
        },
      },
    }),
    ctx.db.salaryPayment.findMany({
      where: { forMonth: start },
      select: { id: true, teacherId: true, amountMinor: true, paidOn: true, method: true },
    }),
    ctx.db.leaveRequest.findMany({
      where: { type: "UNPAID", status: "APPROVED", startDate: { lte: end }, endDate: { gte: start }, teacherId: { not: null } },
      select: { teacherId: true, startDate: true, endDate: true },
    }),
    getSchoolCalendar(ctx, start, end),
  ]);

  const paidBy = new Map(payments.map((payment) => [payment.teacherId, payment]));
  const leaveDays = new Map<string, number>();
  for (const leave of unpaidLeave) {
    if (!leave.teacherId) continue;
    const from = leave.startDate > start ? leave.startDate : start;
    const to = leave.endDate < end ? leave.endDate : end;
    leaveDays.set(leave.teacherId, (leaveDays.get(leave.teacherId) ?? 0) + workingDays(calendar, from, to).length);
  }

  const rows: PayrollRow[] = teachers.map((teacher) => {
    const salary = teacher.salaries[0] ?? null;
    const net = salary ? salary.amountMinor + salary.allowancesMinor - salary.deductionsMinor : null;
    const dueMinor =
      salary === null || net === null
        ? null
        : salary.salaryType === "MONTHLY"
          ? net
          : salary.salaryType === "ANNUAL"
            ? Math.round(net / 12)
            : null;
    return {
      teacherId: teacher.id,
      name: fullName(teacher),
      employeeId: teacher.employeeId,
      designation: teacher.designation,
      structure: salary
        ? {
            salaryType: salary.salaryType,
            baseMinor: salary.amountMinor,
            allowancesMinor: salary.allowancesMinor,
            deductionsMinor: salary.deductionsMinor,
          }
        : null,
      dueMinor,
      unpaidLeaveDays: leaveDays.get(teacher.id) ?? 0,
      payment: paidBy.get(teacher.id) ?? null,
    };
  });

  return {
    month: start,
    rows,
    totals: {
      dueMinor: rows.reduce((sum, row) => sum + (row.dueMinor ?? 0), 0),
      paidMinor: payments.reduce((sum, row) => sum + row.amountMinor, 0),
      paid: payments.length,
      unpaid: rows.filter((row) => !row.payment).length,
      withoutStructure: rows.filter((row) => !row.structure).length,
    },
  };
}

/**
 * Pay a batch of teachers for one month. Every entry is checked first — the
 * teacher is this school's, the amount is positive, nobody is already paid for
 * the month — and the batch is written in one transaction or not at all.
 */
export async function payPayroll(
  ctx: TenantContext,
  input: {
    month: Date;
    paidOn: Date;
    method: PaymentMethod;
    reference: string | null;
    entries: Array<{ teacherId: string; amountMinor: number }>;
  },
): Promise<{ paid: number; totalMinor: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const forMonth = monthOf(input.month);
  if (input.paidOn > today()) throw new AppError("VALIDATION", "A payment cannot be dated in the future.");
  if (!input.entries.length) throw new AppError("VALIDATION", "Tick at least one teacher to pay.");
  if (forMonth > monthOf(addDays(today(), 31))) {
    throw new AppError("VALIDATION", "Salary can be paid at most one month in advance.");
  }

  const ids = [...new Set(input.entries.map((entry) => entry.teacherId))];
  if (ids.length !== input.entries.length) throw new AppError("VALIDATION", "A teacher appears twice in this batch.");
  const bad = input.entries.filter((entry) => !Number.isInteger(entry.amountMinor) || entry.amountMinor <= 0);
  if (bad.length) throw new AppError("VALIDATION", "Every amount must be more than zero.");

  const [teachers, already] = await Promise.all([
    ctx.db.teacher.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
    ctx.db.salaryPayment.findMany({
      where: { teacherId: { in: ids }, forMonth },
      select: { teacher: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  // Another school's teacher resolves to nothing.
  if (teachers.length !== ids.length) throw new NotFoundError("A teacher in this batch was not found.");
  if (already.length) {
    throw new ConflictError(
      `Already paid for ${formatMonth(forMonth)}: ${already.map((row) => fullName(row.teacher)).join(", ")}. Untick them and try again.`,
    );
  }

  await ctx.db.salaryPayment.createMany({
    data: input.entries.map((entry) => ({
      schoolId: ctx.schoolId,
      teacherId: entry.teacherId,
      amountMinor: entry.amountMinor,
      paidOn: input.paidOn,
      forMonth,
      method: input.method,
      reference: input.reference,
      recordedById: ctx.user.id,
    })),
  });

  const totalMinor = input.entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  await recordAudit({
    action: "PAYROLL_PAID",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    // Totals only: individual salaries are not copied into the log.
    summary: `Payroll for ${formatMonth(forMonth)}: ${input.entries.length} teacher${input.entries.length === 1 ? "" : "s"} paid, ${formatMoney(totalMinor)} in total.`,
  });
  return { paid: input.entries.length, totalMinor };
}
