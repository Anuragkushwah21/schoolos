import "server-only";

import type { ExpenseCategory } from "@/generated/prisma/enums";
import { addDays, dateOnly, formatDate, parseDateInput, toDateInput, today } from "@/lib/dates";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { listFeePositions } from "@/server/finance/fees";
import { monthOf } from "@/server/finance/salary";

/**
 * The School Admin's financial overview: money in, money out, what is owed.
 *
 * Every figure is a sum over `FeePayment`, `Expense` and `SalaryPayment` rows
 * read through `ctx.db`, which is scoped to the session's school — so nothing
 * here takes a school id, and nothing here can add up another school's money.
 * "Today" and "this month" are the school's calendar (`today()`), not UTC.
 *
 * Net cash flow is fees received minus expenses minus salary paid. It is an
 * operational figure, not profit: there is no accrual, depreciation or
 * liability model behind it.
 */

export const FINANCE_RANGES = ["today", "week", "month", "custom"] as const;
export type FinanceRangeKey = (typeof FINANCE_RANGES)[number];

export type FinanceRange = { key: FinanceRangeKey; from: Date; to: Date; label: string };

/** A custom range longer than this is almost always a typo in the year. */
const MAX_RANGE_DAYS = 366;

/** How many months the trend chart covers, the current one included. */
export const TREND_MONTHS = 6;

/**
 * Turn `?range=&from=&to=` into a concrete, inclusive date range.
 *
 * Anything unreadable falls back to this month rather than failing: a filter is
 * a convenience, and a bad bookmark should still show the page.
 */
export function resolveFinanceRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = today(),
): FinanceRange {
  const key = (FINANCE_RANGES as readonly string[]).includes(params.range ?? "")
    ? (params.range as FinanceRangeKey)
    : "month";

  if (key === "today") return { key, from: now, to: now, label: "Today" };

  if (key === "week") {
    // Weeks start on Monday, as the school timetable does.
    const back = (now.getUTCDay() + 6) % 7;
    return { key, from: addDays(now, -back), to: now, label: "This week" };
  }

  if (key === "custom") {
    const from = parseDateInput(params.from);
    const to = parseDateInput(params.to);
    if (from && to && from <= to && to <= now && to.getTime() - from.getTime() <= MAX_RANGE_DAYS * 86_400_000) {
      return { key, from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
    }
  }

  return { key: "month", from: monthOf(now), to: now, label: "This month" };
}

export type FinanceTotals = { feesMinor: number; expensesMinor: number; salaryMinor: number };

/** Fees in, less expenses and salary out. Operational cash flow, not profit. */
export function netCashFlow(totals: FinanceTotals): number {
  return totals.feesMinor - totals.expensesMinor - totals.salaryMinor;
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" });

function monthKey(date: Date): string {
  return toDateInput(date).slice(0, 7);
}

function between(from: Date, to: Date) {
  return { gte: from, lte: to };
}

export async function financeOverview(ctx: TenantContext, range: FinanceRange) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { db } = ctx;

  const now = today();
  const monthStart = monthOf(now);
  const trendStart = dateOnly(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1 - (TREND_MONTHS - 1),
    1,
  );

  const fees = (from: Date, to: Date) =>
    db.feePayment.aggregate({ where: { paidOn: between(from, to), voidedAt: null }, _sum: { amountMinor: true } });
  const expenses = (from: Date, to: Date) =>
    db.expense.aggregate({ where: { spentOn: between(from, to) }, _sum: { amountMinor: true } });
  const salary = (from: Date, to: Date) =>
    db.salaryPayment.aggregate({ where: { paidOn: between(from, to) }, _sum: { amountMinor: true } });

  const [
    feesToday,
    feesMonth,
    feesRange,
    expensesToday,
    expensesMonth,
    expensesRange,
    salaryToday,
    salaryMonth,
    salaryRange,
    positions,
    feeTrend,
    expenseTrend,
    salaryTrend,
    byCategory,
    rangePayments,
  ] = await Promise.all([
    fees(now, now),
    fees(monthStart, now),
    fees(range.from, range.to),
    expenses(now, now),
    expenses(monthStart, now),
    expenses(range.from, range.to),
    salary(now, now),
    salary(monthStart, now),
    salary(range.from, range.to),
    listFeePositions(ctx),
    db.feePayment.findMany({
      where: { paidOn: between(trendStart, now), voidedAt: null },
      select: { paidOn: true, amountMinor: true },
    }),
    db.expense.findMany({
      where: { spentOn: between(trendStart, now) },
      select: { spentOn: true, amountMinor: true },
    }),
    db.salaryPayment.findMany({
      where: { paidOn: between(trendStart, now) },
      select: { paidOn: true, amountMinor: true },
    }),
    db.expense.groupBy({
      by: ["category"],
      where: { spentOn: between(range.from, range.to) },
      _sum: { amountMinor: true },
    }),
    db.feePayment.findMany({
      where: { paidOn: between(range.from, range.to), voidedAt: null },
      select: { studentId: true, academicSessionId: true, amountMinor: true },
    }),
  ]);

  const sum = (agg: { _sum: { amountMinor: number | null } }) => agg._sum.amountMinor ?? 0;

  // ---- monthly trend -------------------------------------------------------
  const months = Array.from({ length: TREND_MONTHS }, (_, index) => {
    const start = dateOnly(trendStart.getUTCFullYear(), trendStart.getUTCMonth() + 1 + index, 1);
    return { key: monthKey(start), label: SHORT_MONTH.format(start), feesMinor: 0, expensesMinor: 0, salaryMinor: 0 };
  });
  const byMonth = new Map(months.map((month) => [month.key, month]));
  for (const row of feeTrend) byMonth.get(monthKey(row.paidOn))!.feesMinor += row.amountMinor;
  for (const row of expenseTrend) byMonth.get(monthKey(row.spentOn))!.expensesMinor += row.amountMinor;
  for (const row of salaryTrend) byMonth.get(monthKey(row.paidOn))!.salaryMinor += row.amountMinor;

  // ---- fee collection by class --------------------------------------------
  // A payment carries its session and student; the enrollment in that session
  // says which class the student was in when they paid.
  const studentIds = [...new Set(rangePayments.map((row) => row.studentId))];
  const enrollments = studentIds.length
    ? await db.studentEnrollment.findMany({
        where: { studentId: { in: studentIds } },
        select: {
          studentId: true,
          academicSessionId: true,
          class: { select: { id: true, name: true, level: true } },
        },
      })
    : [];
  const classOf = new Map(
    enrollments.map((row) => [`${row.studentId}:${row.academicSessionId}`, row.class]),
  );
  const byClass = new Map<string, { key: string; label: string; level: number; amountMinor: number }>();
  for (const payment of rangePayments) {
    const klass = classOf.get(`${payment.studentId}:${payment.academicSessionId}`);
    const key = klass?.id ?? "unplaced";
    const entry = byClass.get(key) ?? {
      key,
      label: klass?.name ?? "Not placed",
      level: klass?.level ?? -1,
      amountMinor: 0,
    };
    entry.amountMinor += payment.amountMinor;
    byClass.set(key, entry);
  }

  const period: FinanceTotals = {
    feesMinor: sum(feesRange),
    expensesMinor: sum(expensesRange),
    salaryMinor: sum(salaryRange),
  };

  return {
    range,
    today: { feesMinor: sum(feesToday), expensesMinor: sum(expensesToday), salaryMinor: sum(salaryToday) },
    month: { feesMinor: sum(feesMonth), expensesMinor: sum(expensesMonth), salaryMinor: sum(salaryMonth) },
    period: { ...period, netMinor: netCashFlow(period) },
    pending: {
      pendingMinor: positions.totals?.pendingMinor ?? 0,
      overdue: positions.totals?.overdue ?? 0,
      hasSession: positions.session !== null,
    },
    trend: months,
    expenseByCategory: byCategory
      .map((row) => ({ category: row.category as ExpenseCategory, amountMinor: row._sum.amountMinor ?? 0 }))
      .filter((row) => row.amountMinor > 0)
      .sort((a, b) => b.amountMinor - a.amountMinor),
    feesByClass: [...byClass.values()].sort((a, b) => b.level - a.level),
  };
}

export type FinanceOverview = Awaited<ReturnType<typeof financeOverview>>;
