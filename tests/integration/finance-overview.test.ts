/**
 * The School Admin's finance overview.
 *
 * Three things under test: the arithmetic (today, this month, a chosen period,
 * net cash flow, the six-month trend and the two breakdowns) is computed from
 * real rows; the date filter resolves to the right window; and every figure
 * belongs to the admin's own school and no other.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { dateOnly, toDateInput, today } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";
import { recordExpense, listExpenses, removeExpense } from "@/server/finance/expenses";
import { chargeStudent, createFeeHead, listFeePositions, listPayments, recordPayment } from "@/server/finance/fees";
import { financeOverview, netCashFlow, resolveFinanceRange } from "@/server/finance/overview";
import { listSalaryPayments, monthOf, paySalary } from "@/server/finance/salary";
import { expenseSchema, salaryPaymentSchema } from "@/lib/validation/school";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const now = today();
const monthStart = monthOf(now);
/** Mid-month of the previous month: inside the session, outside "this month". */
const lastMonth = dateOnly(now.getUTCFullYear(), now.getUTCMonth(), 15);

const payment = (studentId: string, amountRupees: number, paidOn: Date, receiptNo: string) => ({
  studentId,
  amountMinor: amountRupees * 100,
  paidOn,
  method: "CASH" as const,
  receiptNo,
  notes: null,
});

const expense = (category: "ELECTRICITY" | "STATIONERY" | "RENT", rupees: number, spentOn: Date) => ({
  category,
  description: `${category} test`,
  amountMinor: rupees * 100,
  spentOn,
  method: "CASH" as const,
  reference: null,
  notes: null,
});

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const admin = adminOf(schoolA);
  const [first, second] = schoolA.studentIds as [string, string];

  const tuition = await createFeeHead(admin, { name: "Tuition fee", note: null });
  await chargeStudent(admin, {
    studentId: first,
    feeHeadId: tuition.id,
    amountMinor: 200_000_00,
    dueOn: now,
    notes: null,
  });
  await chargeStudent(admin, {
    studentId: second,
    feeHeadId: tuition.id,
    amountMinor: 100_000_00,
    dueOn: now,
    notes: null,
  });

  // Today: ₹42,500 across two receipts.
  await recordPayment(admin, payment(first, 30_000, now, "R-1"));
  await recordPayment(admin, payment(second, 12_500, now, "R-2"));
  // Earlier this month (or today, on the 1st): ₹5,000.
  await recordPayment(admin, payment(first, 5_000, monthStart, "R-3"));
  // Last month: ₹10,000.
  await recordPayment(admin, payment(first, 10_000, lastMonth, "R-4"));

  // Today: ₹8,200 of expenses in two categories; last month ₹20,000 rent.
  await recordExpense(admin, expense("ELECTRICITY", 5_000, now));
  await recordExpense(admin, expense("STATIONERY", 3_200, now));
  await recordExpense(admin, expense("RENT", 20_000, lastMonth));

  // Today: ₹75,000 salary.
  await paySalary(admin, {
    teacherId: schoolA.teacherId,
    amountMinor: 75_000_00,
    paidOn: now,
    forMonth: now,
    method: "BANK_TRANSFER",
    reference: null,
    notes: null,
  });

  // School B has its own, different money, which must never appear in A.
  await recordExpense(adminOf(schoolB), expense("RENT", 99_999, now));
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const sameDayAsMonthStart = monthStart.getTime() === now.getTime();

describe("today's figures", () => {
  it("adds up today's fees, expenses and salary from the rows", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({ range: "today" }));
    expect(overview.today.feesMinor).toBe((42_500 + (sameDayAsMonthStart ? 5_000 : 0)) * 100);
    expect(overview.today.expensesMinor).toBe(8_200_00);
    expect(overview.today.salaryMinor).toBe(75_000_00);
  });

  it("shows pending fees as charged minus paid", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({}));
    // ₹3,00,000 charged, ₹57,500 paid this session.
    expect(overview.pending.pendingMinor).toBe((300_000 - 57_500) * 100);
    const positions = await listFeePositions(adminOf(schoolA));
    expect(overview.pending.pendingMinor).toBe(positions.totals!.pendingMinor);
  });
});

describe("the month and the chosen period", () => {
  it("totals this month and leaves last month out", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({ range: "month" }));
    expect(overview.month.feesMinor).toBe(47_500_00);
    expect(overview.month.expensesMinor).toBe(8_200_00);
    expect(overview.month.salaryMinor).toBe(75_000_00);
    expect(overview.period.feesMinor).toBe(47_500_00);
  });

  it("computes net cash flow as fees minus expenses minus salary", async () => {
    expect(netCashFlow({ feesMinor: 800_000, expensesMinor: 150_000, salaryMinor: 400_000 })).toBe(250_000);

    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({ range: "month" }));
    expect(overview.period.netMinor).toBe((47_500 - 8_200 - 75_000) * 100);
  });

  it("honours a custom range covering only last month", async () => {
    const range = resolveFinanceRange({
      range: "custom",
      from: toDateInput(lastMonth),
      to: toDateInput(lastMonth),
    });
    expect(range.key).toBe("custom");

    const overview = await financeOverview(adminOf(schoolA), range);
    expect(overview.period).toMatchObject({ feesMinor: 10_000_00, expensesMinor: 20_000_00, salaryMinor: 0 });
    expect(overview.expenseByCategory).toEqual([{ category: "RENT", amountMinor: 20_000_00 }]);
  });

  it("breaks expenses down by category and fees down by class", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({ range: "today" }));
    expect(overview.expenseByCategory).toEqual([
      { category: "ELECTRICITY", amountMinor: 5_000_00 },
      { category: "STATIONERY", amountMinor: 3_200_00 },
    ]);
    expect(overview.feesByClass).toHaveLength(1);
    expect(overview.feesByClass[0]!.amountMinor).toBe(overview.period.feesMinor);
  });

  it("draws a six-month trend with this month and last month in place", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({}));
    expect(overview.trend).toHaveLength(6);
    const current = overview.trend.at(-1)!;
    const previous = overview.trend.at(-2)!;
    expect(current).toMatchObject({ feesMinor: 47_500_00, expensesMinor: 8_200_00, salaryMinor: 75_000_00 });
    expect(previous).toMatchObject({ feesMinor: 10_000_00, expensesMinor: 20_000_00, salaryMinor: 0 });
  });
});

describe("the date filter", () => {
  const wednesday = dateOnly(2026, 9, 23);

  it("resolves today, this week (from Monday) and this month", () => {
    expect(resolveFinanceRange({ range: "today" }, wednesday)).toMatchObject({ from: wednesday, to: wednesday });
    expect(resolveFinanceRange({ range: "week" }, wednesday).from).toEqual(dateOnly(2026, 9, 21));
    expect(resolveFinanceRange({ range: "month" }, wednesday).from).toEqual(dateOnly(2026, 9, 1));
  });

  it("falls back to this month for a reversed, future or unreadable range", () => {
    for (const params of [
      { range: "custom", from: "2026-09-20", to: "2026-09-10" },
      { range: "custom", from: "2026-09-20", to: "2026-12-31" },
      { range: "custom", from: "nonsense", to: "2026-09-10" },
      { range: "yearly" },
    ]) {
      expect(resolveFinanceRange(params, wednesday).key).toBe("month");
    }
  });
});

describe("school isolation", () => {
  it("shows School B only its own money", async () => {
    const overview = await financeOverview(adminOf(schoolB), resolveFinanceRange({ range: "today" }));
    expect(overview.today).toEqual({ feesMinor: 0, expensesMinor: 99_999_00, salaryMinor: 0 });
    expect(overview.feesByClass).toEqual([]);
  });

  it("never lets School A count School B's expense", async () => {
    const overview = await financeOverview(adminOf(schoolA), resolveFinanceRange({ range: "today" }));
    expect(overview.today.expensesMinor).toBe(8_200_00);
    const rows = await listExpenses(adminOf(schoolA));
    expect(rows.every((row) => row.description !== "RENT test" || row.amountMinor !== 99_999_00)).toBe(true);
  });

  it("does not return another school's receipts or salary payments", async () => {
    expect(await listPayments(adminOf(schoolB))).toEqual([]);
    expect(await listSalaryPayments(adminOf(schoolB))).toEqual([]);
    expect((await listPayments(adminOf(schoolA))).length).toBe(4);
  });

  it("answers another school's expense id as not found", async () => {
    const [foreign] = await listExpenses(adminOf(schoolB));
    await expect(removeExpense(adminOf(schoolA), foreign!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to pay another school's teacher", async () => {
    await expect(
      paySalary(adminOf(schoolA), {
        teacherId: schoolB.teacherId,
        amountMinor: 100,
        paidOn: now,
        forMonth: now,
        method: "CASH",
        reference: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is School Admin only", async () => {
    const range = resolveFinanceRange({});
    await expect(financeOverview(teacherOf(schoolA), range)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      financeOverview(contextFor(schoolA, schoolA.parentUserId, "PARENT"), range),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("recording money", () => {
  it("refuses to pay the same teacher twice for one month", async () => {
    await expect(
      paySalary(adminOf(schoolA), {
        teacherId: schoolA.teacherId,
        amountMinor: 100,
        paidOn: now,
        forMonth: monthStart,
        method: "CASH",
        reference: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a future-dated expense", async () => {
    const tomorrow = new Date(now.getTime() + 86_400_000);
    await expect(recordExpense(adminOf(schoolA), expense("RENT", 1, tomorrow))).rejects.toBeInstanceOf(AppError);
  });

  it("parses rupees into paise and a month input into its first day", () => {
    const parsedExpense = expenseSchema.parse({
      category: "ELECTRICITY",
      description: "Bill",
      amountMinor: "8200",
      spentOn: "2026-09-26",
      method: "CASH",
    });
    expect(parsedExpense.amountMinor).toBe(820_000);

    const parsedSalary = salaryPaymentSchema.parse({
      teacherId: "t1",
      amountMinor: "75000",
      paidOn: "2026-09-26",
      forMonth: "2026-09",
      method: "UPI",
    });
    expect(parsedSalary.forMonth).toEqual(dateOnly(2026, 9, 1));
    expect(expenseSchema.safeParse({ category: "PARTY", description: "x", amountMinor: "1", spentOn: "2026-09-26", method: "CASH" }).success).toBe(false);
  });
});
