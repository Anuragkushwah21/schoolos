import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { dateOnly, formatDate, formatMonth, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney, fullName, humanize } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import { isUniqueViolation } from "@/server/db/errors";
import { type BaseStaffRole, STAFF_ROLE_NAMES } from "@/lib/staff-access";
import { assertModuleEnabled } from "@/server/platform/modules";

/**
 * What the school pays its staff — teachers and non-teaching staff alike
 * (accountant, receptionist, lab assistant, security, support staff,
 * librarian, driver…). One salary structure and one payment table serve both:
 * each row names either a teacher or a staff member, never both (a database
 * check enforces it).
 *
 * The most sensitive data in the application. Writing a salary structure is
 * School Admin only. Reading payroll and recording payments are open to staff
 * only with the admin-granted "View payroll & salaries" / "Record salary
 * payments" permissions. `getMySalary` reads only the signed-in person's own
 * record — nobody else's, and nothing here reaches a student or parent.
 *
 * Effective-dated: a raise is a new row, so what somebody was paid last April
 * survives it. The current figure is the newest row whose date has passed, which
 * also lets a raise be entered before it takes effect.
 */

export const SALARY_TYPES = ["MONTHLY", "ANNUAL", "HOURLY"] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

/** Whose salary: exactly one of the two. */
export type PayeeRef = { teacherId?: string | null; staffMemberId?: string | null };

export type Payee = {
  kind: "TEACHER" | "STAFF";
  id: string;
  name: string;
  /** The where-clause for this person's salary rows and payments. */
  where: { teacherId: string } | { staffMemberId: string };
  /** For audit entries. */
  entityType: "Teacher" | "StaffMember";
};

/** "T:<id>" or "S:<id>": one key for a person on screens that list both. */
export function payeeKey(row: { teacherId: string | null; staffMemberId: string | null }): string {
  return row.teacherId ? `T:${row.teacherId}` : `S:${row.staffMemberId}`;
}

export function parsePayeeKey(key: string): PayeeRef {
  const match = /^(T|S):(.{1,64})$/.exec(key.trim());
  if (!match) throw new AppError("VALIDATION", "Choose a person.");
  return match[1] === "T" ? { teacherId: match[2] } : { staffMemberId: match[2] };
}

/** The teacher or staff member, in this school (the client is scoped), or a refusal. */
export async function resolvePayee(ctx: TenantContext, ref: PayeeRef): Promise<Payee> {
  if (!!ref.teacherId === !!ref.staffMemberId) throw new AppError("VALIDATION", "Choose one person: a teacher or a staff member.");
  if (ref.teacherId) {
    const teacher = await ctx.db.teacher.findFirst({ where: { id: ref.teacherId }, select: { id: true, firstName: true, lastName: true } });
    if (!teacher) throw new NotFoundError("That teacher was not found.");
    return { kind: "TEACHER", id: teacher.id, name: fullName(teacher), where: { teacherId: teacher.id }, entityType: "Teacher" };
  }
  const staff = await ctx.db.staffMember.findFirst({ where: { id: ref.staffMemberId! }, select: { id: true, firstName: true, lastName: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  return { kind: "STAFF", id: staff.id, name: fullName(staff), where: { staffMemberId: staff.id }, entityType: "StaffMember" };
}

/** A teacher or staff member as stored on a row: whichever is set. */
export function payeeOf(row: { teacher: { firstName: string; lastName: string } | null; staffMember: { firstName: string; lastName: string } | null }): string {
  return row.teacher ? fullName(row.teacher) : row.staffMember ? fullName(row.staffMember) : "—";
}

export type SalaryInput = PayeeRef & {
  salaryType: SalaryType;
  amountMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  effectiveFrom: Date;
  notes: string | null;
};

/**
 * Record — or correct — a salary from a date.
 *
 * Upserted on `(teacher, effectiveFrom)`, so entering the same date twice
 * corrects that figure instead of leaving two claims about what somebody earns.
 * A different date is a new row, which is the history.
 */
export async function setSalary(ctx: TenantContext, input: SalaryInput): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "PAYROLL");

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A salary must be more than zero.");
  }
  if (input.deductionsMinor > input.amountMinor + input.allowancesMinor) {
    throw new AppError("VALIDATION", "Deductions cannot exceed the salary and allowances.");
  }

  // Another school's teacher or staff member resolves to nothing: the client is scoped.
  const payee = await resolvePayee(ctx, input);

  const record = await ctx.db.teacherSalary.upsert({
    where:
      payee.kind === "TEACHER"
        ? { schoolId_teacherId_effectiveFrom: { schoolId: ctx.schoolId, teacherId: payee.id, effectiveFrom: input.effectiveFrom } }
        : { schoolId_staffMemberId_effectiveFrom: { schoolId: ctx.schoolId, staffMemberId: payee.id, effectiveFrom: input.effectiveFrom } },
    create: {
      schoolId: ctx.schoolId,
      ...payee.where,
      salaryType: input.salaryType,
      amountMinor: input.amountMinor,
      allowancesMinor: input.allowancesMinor,
      deductionsMinor: input.deductionsMinor,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes,
      recordedById: ctx.user.id,
    },
    update: {
      salaryType: input.salaryType,
      amountMinor: input.amountMinor,
      allowancesMinor: input.allowancesMinor,
      deductionsMinor: input.deductionsMinor,
      notes: input.notes,
      recordedById: ctx.user.id,
    },
    select: { id: true },
  });

  await recordAudit({
    action: payee.kind === "TEACHER" ? "TEACHER_SALARY_SET" : "STAFF_SALARY_SET",
    entityType: payee.entityType,
    entityId: payee.id,
    schoolId: ctx.schoolId,
    // The figure is deliberately not in the summary: support staff read the
    // audit log, and what a colleague earns is not theirs to browse.
    actorId: ctx.user.id,
    summary: `Salary recorded for ${payee.name}, effective ${input.effectiveFrom.toISOString().slice(0, 10)}.`,
  });

  return record;
}

export async function removeSalary(ctx: TenantContext, salaryId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "PAYROLL");

  const row = await ctx.db.teacherSalary.findFirst({
    where: { id: salaryId },
    select: {
      id: true,
      teacherId: true,
      staffMemberId: true,
      effectiveFrom: true,
      teacher: { select: { firstName: true, lastName: true } },
      staffMember: { select: { firstName: true, lastName: true } },
    },
  });
  if (!row) throw new NotFoundError("That salary record was not found.");

  await ctx.db.teacherSalary.deleteMany({ where: { id: row.id } });

  await recordAudit({
    action: row.teacherId ? "TEACHER_SALARY_SET" : "STAFF_SALARY_SET",
    entityType: row.teacherId ? "Teacher" : "StaffMember",
    entityId: row.teacherId ?? row.staffMemberId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Salary record from ${row.effectiveFrom.toISOString().slice(0, 10)} removed for ${payeeOf(row)}.`,
  });
}

const SALARY_SELECT = {
  id: true,
  salaryType: true,
  amountMinor: true,
  allowancesMinor: true,
  deductionsMinor: true,
  effectiveFrom: true,
  notes: true,
  recordedBy: { select: { email: true } },
} as const;

export type SalaryRecord = {
  id: string;
  salaryType: SalaryType;
  amountMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  /** What actually reaches them: amount + allowances − deductions. */
  netMinor: number;
  effectiveFrom: Date;
  notes: string | null;
  recordedBy: string | null;
  /** True for the row that applies today. */
  current: boolean;
};

function shape(
  rows: Array<{
    id: string;
    salaryType: SalaryType;
    amountMinor: number;
    allowancesMinor: number;
    deductionsMinor: number;
    effectiveFrom: Date;
    notes: string | null;
    recordedBy: { email: string } | null;
  }>,
  asOf: Date,
): SalaryRecord[] {
  // The current figure is the newest row already in effect. A row dated ahead is
  // a scheduled raise and is not current yet.
  const currentId = rows.filter((row) => row.effectiveFrom <= asOf)[0]?.id ?? null;

  return rows.map((row) => ({
    id: row.id,
    salaryType: row.salaryType,
    amountMinor: row.amountMinor,
    allowancesMinor: row.allowancesMinor,
    deductionsMinor: row.deductionsMinor,
    netMinor: row.amountMinor + row.allowancesMinor - row.deductionsMinor,
    effectiveFrom: row.effectiveFrom,
    notes: row.notes,
    recordedBy: row.recordedBy?.email ?? null,
    current: row.id === currentId,
  }));
}

/**
 * One teacher's salary history, newest first. School Admin only.
 *
 * Returns an empty list rather than throwing when nothing is recorded: adding a
 * teacher without a salary is allowed, and "not configured yet" is a normal
 * state rather than an error.
 */
export async function getTeacherSalary(ctx: TenantContext, teacherId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "PAYROLL");

  const teacher = await ctx.db.teacher.findFirst({
    where: { id: teacherId },
    select: { id: true },
  });
  if (!teacher) throw new NotFoundError("That teacher was not found.");

  const rows = await ctx.db.teacherSalary.findMany({
    where: { teacherId },
    orderBy: { effectiveFrom: "desc" },
    select: SALARY_SELECT,
  });

  const history = shape(rows, today());
  return { history, current: history.find((row) => row.current) ?? null };
}

/**
 * One non-teaching staff member's salary history and the payments made to
 * them, newest first. School Admin only.
 */
export async function getStaffSalary(ctx: TenantContext, staffMemberId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "PAYROLL");
  const staff = await ctx.db.staffMember.findFirst({ where: { id: staffMemberId }, select: { id: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const [rows, payments] = await Promise.all([
    ctx.db.teacherSalary.findMany({ where: { staffMemberId }, orderBy: { effectiveFrom: "desc" }, select: SALARY_SELECT }),
    ctx.db.salaryPayment.findMany({
      where: { staffMemberId },
      orderBy: { forMonth: "desc" },
      take: 24,
      select: { id: true, amountMinor: true, paidOn: true, forMonth: true, method: true, reference: true },
    }),
  ]);
  const history = shape(rows, today());
  return { history, current: history.find((row) => row.current) ?? null, payments };
}

/**
 * The signed-in teacher's or staff member's own salary.
 *
 * The one read here that is not School Admin: it starts from `ctx.user.id` and
 * takes no id at all, so there is nothing a request could change to see a
 * colleague's figure.
 */
export async function getMySalary(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER", "NON_TEACHING_STAFF");
  await assertModuleEnabled(ctx, "PAYROLL");

  const self =
    ctx.user.role === "TEACHER"
      ? await ctx.db.teacher.findFirst({ where: { userId: ctx.user.id }, select: { id: true } })
      : await ctx.db.staffMember.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
  if (!self) throw new NotFoundError("Your staff record is not set up yet.");

  const rows = await ctx.db.teacherSalary.findMany({
    where: ctx.user.role === "TEACHER" ? { teacherId: self.id } : { staffMemberId: self.id },
    orderBy: { effectiveFrom: "desc" },
    select: SALARY_SELECT,
  });

  const history = shape(rows, today());
  return { history, current: history.find((row) => row.current) ?? null };
}

/**
 * Every teacher's current figure, for the salaries screen.
 *
 * "Configured" and "not configured" are both useful to see: the second is the
 * list the office has to finish.
 */
export async function listSalaries(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, "payroll.view");
  const asOf = today();

  const staff = await ctx.db.staffMember.findMany({
    where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      designation: true,
      role: true,
      status: true,
      roleProfile: { select: { name: true } },
      salaries: { orderBy: { effectiveFrom: "desc" }, select: SALARY_SELECT },
    },
  });

  const teachers = await ctx.db.teacher.findMany({
    where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      designation: true,
      status: true,
      salaries: {
        orderBy: { effectiveFrom: "desc" },
        select: SALARY_SELECT,
      },
    },
  });

  const people = [
    ...teachers.map((teacher) => ({ ...teacher, teacherId: teacher.id as string | null, staffMemberId: null as string | null, roleName: "Teacher", kind: "TEACHER" as const })),
    ...staff.map((member) => ({
      ...member,
      teacherId: null as string | null,
      staffMemberId: member.id as string | null,
      roleName: member.roleProfile?.name ?? STAFF_ROLE_NAMES[member.role as BaseStaffRole] ?? "Staff",
      kind: "STAFF" as const,
    })),
  ];
  const rows = people.map((person) => {
    const history = shape(person.salaries, asOf);
    const current = history.find((row) => row.current) ?? null;
    return {
      key: payeeKey(person),
      kind: person.kind,
      teacherId: person.teacherId,
      staffMemberId: person.staffMemberId,
      name: fullName(person),
      employeeId: person.employeeId,
      designation: person.designation,
      /** "Teacher", or the staff member's role: Accountant, Driver, Security… */
      role: person.roleName,
      status: person.status as string,
      current,
      /** A raise already entered but not yet in effect. */
      scheduled: history.find((row) => row.effectiveFrom > asOf) ?? null,
    };
  });

  return {
    rows,
    totals: {
      configured: rows.filter((row) => row.current !== null).length,
      missing: rows.filter((row) => row.current === null).length,
      monthlyMinor: rows.reduce(
        (sum, row) => sum + (row.current?.salaryType === "MONTHLY" ? row.current.netMinor : 0),
        0,
      ),
    },
  };
}

// -----------------------------------------------------------------------------
// Salary paid
// -----------------------------------------------------------------------------

export type SalaryPaymentInput = PayeeRef & {
  amountMinor: number;
  paidOn: Date;
  /** Any day in the month being paid; stored as the first of that month. */
  forMonth: Date;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
};

/** The first day of the month `date` falls in. */
export function monthOf(date: Date): Date {
  return dateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Record that a month's salary has been paid to one teacher or staff member.
 *
 * What a teacher is owed lives in `TeacherSalary`; this is the money that
 * actually went out. One payment per teacher per month — the unique index is
 * what stops a salary being paid twice, not this function.
 */
export async function paySalary(
  ctx: TenantContext,
  input: SalaryPaymentInput,
): Promise<{ id: string }> {
  // The School Admin, or staff the admin allowed to record salary payments.
  await assertAdminOrStaffPermission(ctx, "payroll.pay");

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A salary payment must be more than zero.");
  }
  if (input.paidOn > today()) {
    throw new AppError("VALIDATION", "A payment cannot be dated in the future.");
  }

  const payee = await resolvePayee(ctx, input);
  const forMonth = monthOf(input.forMonth);

  try {
    const payment = await ctx.db.salaryPayment.create({
      data: {
        schoolId: ctx.schoolId,
        ...payee.where,
        amountMinor: input.amountMinor,
        paidOn: input.paidOn,
        forMonth,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        recordedById: ctx.user.id,
      },
      select: { id: true },
    });

    await recordAudit({
      action: "SALARY_PAID",
      entityType: payee.entityType,
      entityId: payee.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${formatMoney(input.amountMinor)} salary for ${formatMonth(forMonth)} paid to ${payee.name} on ${formatDate(input.paidOn)} (${humanize(input.method)}${input.reference ? `, ref ${input.reference}` : ""}).`,
      metadata: { month: formatMonth(forMonth), paidOn: input.paidOn.toISOString().slice(0, 10), method: input.method, amountMinor: input.amountMinor },
    });

    return payment;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(`${payee.name} has already been paid for that month.`);
    }
    throw error;
  }
}

export async function removeSalaryPayment(ctx: TenantContext, paymentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertModuleEnabled(ctx, "PAYROLL");

  const payment = await ctx.db.salaryPayment.findFirst({
    where: { id: paymentId },
    select: { id: true, amountMinor: true, teacherId: true, staffMemberId: true, forMonth: true, teacher: { select: { firstName: true, lastName: true } }, staffMember: { select: { firstName: true, lastName: true } } },
  });
  if (!payment) throw new NotFoundError("That salary payment was not found.");

  await ctx.db.salaryPayment.deleteMany({ where: { id: payment.id } });

  await recordAudit({
    action: "SALARY_PAYMENT_REMOVED",
    entityType: payment.teacherId ? "Teacher" : "StaffMember",
    entityId: payment.teacherId ?? payment.staffMemberId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${formatMoney(payment.amountMinor)} salary payment to ${payeeOf(payment)} for ${payment.forMonth.toISOString().slice(0, 7)} removed.`,
  });
}

export async function listSalaryPayments(
  ctx: TenantContext,
  filters: { from?: Date | null; to?: Date | null; take?: number } = {},
) {
  await assertAdminOrStaffPermission(ctx, "payroll.view");

  const rows = await ctx.db.salaryPayment.findMany({
    where:
      filters.from || filters.to
        ? {
            paidOn: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {},
    orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 100,
    select: {
      id: true,
      amountMinor: true,
      paidOn: true,
      forMonth: true,
      method: true,
      reference: true,
      teacherId: true,
      staffMemberId: true,
      teacher: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
      staffMember: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
    },
  });
  return rows.map((row) => ({ ...row, payee: payeeOf(row), employeeId: row.teacher?.employeeId ?? row.staffMember?.employeeId ?? "" }));
}
