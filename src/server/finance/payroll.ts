import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { workingDays } from "@/lib/calendar";
import { addDays, dateOnly, formatDate, formatMonth, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney, fullName, humanize } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import type { TenantContext } from "@/server/auth/current-user";
import { getSchoolCalendar } from "@/server/calendar/holidays";
import { type PayeeRef, monthOf, payeeKey, payeeOf } from "@/server/finance/salary";
import { type BaseStaffRole, STAFF_ROLE_NAMES } from "@/lib/staff-access";

/**
 * Monthly payroll, built on what already exists: the salary structure in
 * `TeacherSalary` and the money paid in `SalaryPayment`, for teachers and
 * non-teaching staff alike. No draft table — the payroll for a month is
 * computed on demand, the admin adjusts any amount before paying, and
 * marking a batch paid writes one `SalaryPayment` per person in a single
 * transaction. The unique (person, month) indexes still make paying anyone
 * twice impossible.
 *
 * The School Admin, or staff with the admin-granted payroll permissions
 * ("View payroll & salaries", "Record salary payments"). Teachers and staff
 * see their own salary on their profile; students and parents never reach
 * any of this.
 */

export type PayrollRow = {
  /** "T:<teacherId>" or "S:<staffMemberId>". */
  key: string;
  kind: "TEACHER" | "STAFF";
  teacherId: string | null;
  staffMemberId: string | null;
  /** "Teacher", or the staff role: Accountant, Driver… */
  role: string;
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
  payment: { id: string; amountMinor: number; paidOn: Date; method: PaymentMethod; createdAt: Date; /** Who recorded it: "Ravi Gupta (Accountant)". */ paidBy: string | null } | null;
};

const STRUCTURE_SELECT = {
  where: {} as { effectiveFrom: { lte: Date } },
  orderBy: { effectiveFrom: "desc" as const },
  take: 1,
  select: { salaryType: true, amountMinor: true, allowancesMinor: true, deductionsMinor: true },
};

function monthBounds(month: Date) {
  const start = monthOf(month);
  const end = addDays(dateOnly(start.getUTCFullYear(), start.getUTCMonth() + 2, 1), -1);
  return { start, end };
}

/** Who recorded a salary payment — the School Admin, or a staff member by role. */
export const RECORDER_SELECT = {
  select: { firstName: true, lastName: true, role: true, staffMember: { select: { role: true, roleProfile: { select: { name: true } } } } },
} as const;

export function recorderLabel(user: { firstName: string; lastName: string; role: string; staffMember: { role: string; roleProfile: { name: string } | null } | null } | null): string | null {
  if (!user) return null;
  const role =
    user.role === "SCHOOL_ADMIN"
      ? "School Admin"
      : user.staffMember
        ? (user.staffMember.roleProfile?.name ?? STAFF_ROLE_NAMES[user.staffMember.role as BaseStaffRole] ?? "Staff")
        : humanize(user.role);
  return `${fullName(user)} (${role})`;
}

export async function getPayroll(ctx: TenantContext, month: Date) {
  await assertAdminOrStaffPermission(ctx, "payroll.view");
  const { start, end } = monthBounds(month);

  const structure = { ...STRUCTURE_SELECT, where: { effectiveFrom: { lte: end } } };
  const [teachers, staff, payments, unpaidLeave, calendar] = await Promise.all([
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
        salaries: structure,
      },
    }),
    ctx.db.staffMember.findMany({
      where: { OR: [{ status: { in: ["ACTIVE", "ON_LEAVE"] } }, { salaryPayments: { some: { forMonth: start } } }] },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        designation: true,
        role: true,
        roleProfile: { select: { name: true } },
        salaries: structure,
      },
    }),
    ctx.db.salaryPayment.findMany({
      where: { forMonth: start },
      select: { id: true, teacherId: true, staffMemberId: true, amountMinor: true, paidOn: true, method: true, createdAt: true, recordedBy: RECORDER_SELECT },
    }),
    // Approved unpaid leave, for teachers and staff alike.
    ctx.db.leaveRequest.findMany({
      where: { type: "UNPAID", status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
      select: { teacherId: true, staffMemberId: true, startDate: true, endDate: true },
    }),
    getSchoolCalendar(ctx, start, end),
  ]);

  const paidBy = new Map(payments.map((payment) => [payeeKey(payment), payment]));
  const leaveDays = new Map<string, number>();
  for (const leave of unpaidLeave) {
    if (!leave.teacherId && !leave.staffMemberId) continue;
    const key = payeeKey(leave);
    const from = leave.startDate > start ? leave.startDate : start;
    const to = leave.endDate < end ? leave.endDate : end;
    leaveDays.set(key, (leaveDays.get(key) ?? 0) + workingDays(calendar, from, to).length);
  }

  const people = [
    ...teachers.map((teacher) => ({ ...teacher, teacherId: teacher.id as string | null, staffMemberId: null as string | null, kind: "TEACHER" as const, roleName: "Teacher" })),
    ...staff.map((member) => ({
      ...member,
      teacherId: null as string | null,
      staffMemberId: member.id as string | null,
      kind: "STAFF" as const,
      roleName: member.roleProfile?.name ?? STAFF_ROLE_NAMES[member.role as BaseStaffRole] ?? "Staff",
    })),
  ];
  const rows: PayrollRow[] = people.map((teacher) => {
    const key = payeeKey(teacher);
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
      key,
      kind: teacher.kind,
      teacherId: teacher.teacherId,
      staffMemberId: teacher.staffMemberId,
      role: teacher.roleName,
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
      unpaidLeaveDays: leaveDays.get(key) ?? 0,
      payment: (() => {
        const payment = paidBy.get(key);
        return payment ? { ...payment, paidBy: recorderLabel(payment.recordedBy) } : null;
      })(),
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
      /** What is still to pay this month: the due amount of everyone not yet paid. */
      remainingMinor: rows.reduce((sum, row) => sum + (row.payment ? 0 : (row.dueMinor ?? 0)), 0),
      withoutStructure: rows.filter((row) => !row.structure).length,
    },
  };
}

/**
 * Pay a batch of teachers and staff for one month. Every entry is checked
 * first — the person is this school's, the amount is positive, nobody is
 * already paid for the month — and the batch is written in one transaction or
 * not at all.
 */
export async function payPayroll(
  ctx: TenantContext,
  input: {
    month: Date;
    paidOn: Date;
    method: PaymentMethod;
    reference: string | null;
    entries: Array<PayeeRef & { amountMinor: number }>;
  },
): Promise<{ paid: number; totalMinor: number }> {
  await assertAdminOrStaffPermission(ctx, "payroll.pay");
  const forMonth = monthOf(input.month);
  if (input.paidOn > today()) throw new AppError("VALIDATION", "A payment cannot be dated in the future.");
  if (!input.entries.length) throw new AppError("VALIDATION", "Tick at least one person to pay.");
  if (forMonth > monthOf(addDays(today(), 31))) {
    throw new AppError("VALIDATION", "Salary can be paid at most one month in advance.");
  }

  if (input.entries.some((entry) => !!entry.teacherId === !!entry.staffMemberId)) throw new AppError("VALIDATION", "Each entry names one teacher or one staff member.");
  const keys = input.entries.map((entry) => payeeKey({ teacherId: entry.teacherId ?? null, staffMemberId: entry.staffMemberId ?? null }));
  if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION", "Someone appears twice in this batch.");
  const bad = input.entries.filter((entry) => !Number.isInteger(entry.amountMinor) || entry.amountMinor <= 0);
  if (bad.length) throw new AppError("VALIDATION", "Every amount must be more than zero.");

  const teacherIds = input.entries.flatMap((entry) => (entry.teacherId ? [entry.teacherId] : []));
  const staffIds = input.entries.flatMap((entry) => (entry.staffMemberId ? [entry.staffMemberId] : []));
  const [teachers, staff, already] = await Promise.all([
    ctx.db.teacher.count({ where: { id: { in: teacherIds } } }),
    ctx.db.staffMember.count({ where: { id: { in: staffIds } } }),
    ctx.db.salaryPayment.findMany({
      where: { forMonth, OR: [{ teacherId: { in: teacherIds } }, { staffMemberId: { in: staffIds } }] },
      select: { teacher: { select: { firstName: true, lastName: true } }, staffMember: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  // Another school's teacher or staff member resolves to nothing.
  if (teachers !== teacherIds.length || staff !== staffIds.length) throw new NotFoundError("Someone in this batch was not found.");
  if (already.length) {
    throw new ConflictError(
      `Already paid for ${formatMonth(forMonth)}: ${already.map((row) => payeeOf(row)).join(", ")}. Untick them and try again.`,
    );
  }

  await ctx.db.salaryPayment.createMany({
    data: input.entries.map((entry) => ({
      schoolId: ctx.schoolId,
      teacherId: entry.teacherId ?? null,
      staffMemberId: entry.staffMemberId ?? null,
      amountMinor: entry.amountMinor,
      paidOn: input.paidOn,
      forMonth,
      method: input.method,
      reference: input.reference,
      recordedById: ctx.user.id,
    })),
  });

  const totalMinor = input.entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  // Who was paid how much, by name and role, so the School Admin can see in
  // the audit log exactly what went out and who recorded it (the actor).
  const [paidTeachers, paidStaff] = await Promise.all([
    ctx.db.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, firstName: true, lastName: true } }),
    ctx.db.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true, role: true, roleProfile: { select: { name: true } } } }),
  ]);
  const lines = input.entries.map((entry) => {
    const teacher = entry.teacherId ? paidTeachers.find((row) => row.id === entry.teacherId) : null;
    const member = entry.staffMemberId ? paidStaff.find((row) => row.id === entry.staffMemberId) : null;
    const name = teacher ? `${fullName(teacher)} (Teacher)` : member ? `${fullName(member)} (${member.roleProfile?.name ?? STAFF_ROLE_NAMES[member.role as BaseStaffRole] ?? "Staff"})` : "Unknown";
    return { name, amountMinor: entry.amountMinor };
  });
  await recordAudit({
    action: "PAYROLL_PAID",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Salary for ${formatMonth(forMonth)} paid on ${formatDate(input.paidOn)} (${humanize(input.method)}${input.reference ? `, ref ${input.reference}` : ""}): ${lines.map((line) => `${line.name} ${formatMoney(line.amountMinor)}`).join("; ")} — ${formatMoney(totalMinor)} in total.`,
    metadata: { month: formatMonth(forMonth), paidOn: input.paidOn.toISOString().slice(0, 10), method: input.method, payees: lines },
  });
  return { paid: input.entries.length, totalMinor };
}
