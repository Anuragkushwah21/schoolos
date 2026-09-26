import "server-only";

import { today } from "@/lib/dates";
import { AppError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * What the school pays its staff.
 *
 * The most sensitive data in the application. Every function here asserts
 * `SCHOOL_ADMIN` except `getMySalary`, which reads only the signed-in teacher's
 * own record — a teacher may see their own figure and nobody else's, and there
 * is no read here that a student, a parent or another teacher can reach.
 *
 * Effective-dated: a raise is a new row, so what somebody was paid last April
 * survives it. The current figure is the newest row whose date has passed, which
 * also lets a raise be entered before it takes effect.
 */

export const SALARY_TYPES = ["MONTHLY", "ANNUAL", "HOURLY"] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

export type SalaryInput = {
  teacherId: string;
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

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "A salary must be more than zero.");
  }
  if (input.deductionsMinor > input.amountMinor + input.allowancesMinor) {
    throw new AppError("VALIDATION", "Deductions cannot exceed the salary and allowances.");
  }

  const teacher = await ctx.db.teacher.findFirst({
    where: { id: input.teacherId },
    select: { id: true, firstName: true, lastName: true },
  });
  // A teacher in another school resolves to nothing: the client is scoped.
  if (!teacher) throw new NotFoundError("That teacher was not found.");

  const record = await ctx.db.teacherSalary.upsert({
    where: {
      schoolId_teacherId_effectiveFrom: {
        schoolId: ctx.schoolId,
        teacherId: teacher.id,
        effectiveFrom: input.effectiveFrom,
      },
    },
    create: {
      schoolId: ctx.schoolId,
      teacherId: teacher.id,
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
    action: "TEACHER_SALARY_SET",
    entityType: "Teacher",
    entityId: teacher.id,
    schoolId: ctx.schoolId,
    // The figure is deliberately not in the summary: support staff read the
    // audit log, and what a colleague earns is not theirs to browse.
    actorId: ctx.user.id,
    summary: `Salary recorded for ${fullName(teacher)}, effective ${input.effectiveFrom.toISOString().slice(0, 10)}.`,
  });

  return record;
}

export async function removeSalary(ctx: TenantContext, salaryId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const row = await ctx.db.teacherSalary.findFirst({
    where: { id: salaryId },
    select: {
      id: true,
      teacherId: true,
      effectiveFrom: true,
      teacher: { select: { firstName: true, lastName: true } },
    },
  });
  if (!row) throw new NotFoundError("That salary record was not found.");

  await ctx.db.teacherSalary.deleteMany({ where: { id: row.id } });

  await recordAudit({
    action: "TEACHER_SALARY_SET",
    entityType: "Teacher",
    entityId: row.teacherId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Salary record from ${row.effectiveFrom.toISOString().slice(0, 10)} removed for ${fullName(row.teacher)}.`,
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
 * The signed-in teacher's own salary.
 *
 * The one read here that is not School Admin: it starts from `ctx.user.id` and
 * takes no teacher id at all, so there is nothing a request could change to see
 * a colleague's figure.
 */
export async function getMySalary(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");

  const teacher = await ctx.db.teacher.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true },
  });
  if (!teacher) throw new NotFoundError("Your staff record is not set up yet.");

  const rows = await ctx.db.teacherSalary.findMany({
    where: { teacherId: teacher.id },
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
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const asOf = today();

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

  const rows = teachers.map((teacher) => {
    const history = shape(teacher.salaries, asOf);
    const current = history.find((row) => row.current) ?? null;
    return {
      teacherId: teacher.id,
      name: fullName(teacher),
      employeeId: teacher.employeeId,
      designation: teacher.designation,
      status: teacher.status,
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
