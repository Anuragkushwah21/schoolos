import "server-only";

import type { ExpenseCategory, PaymentMethod } from "@/generated/prisma/enums";
import { today } from "@/lib/dates";
import { AppError, NotFoundError } from "@/lib/errors";
import { formatMoney, humanize } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * What the school spends, other than salaries.
 *
 * The same shape as fee receipts: one row per amount, integer paise, no stored
 * totals. School Admin only — nothing here is reachable from a teacher, parent
 * or student screen.
 */

export const EXPENSE_CATEGORIES = [
  "ELECTRICITY",
  "RENT",
  "STATIONERY",
  "MAINTENANCE",
  "TRANSPORT",
  "EVENTS",
  "EQUIPMENT",
  "INTERNET",
  "OTHER",
] as const satisfies readonly ExpenseCategory[];

export type ExpenseInput = {
  category: ExpenseCategory;
  description: string;
  amountMinor: number;
  spentOn: Date;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
};

export async function recordExpense(
  ctx: TenantContext,
  input: ExpenseInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  if (input.amountMinor <= 0) {
    throw new AppError("VALIDATION", "An expense must be more than zero.");
  }
  if (input.spentOn > today()) {
    throw new AppError("VALIDATION", "An expense cannot be dated in the future.");
  }

  const expense = await ctx.db.expense.create({
    data: {
      schoolId: ctx.schoolId,
      category: input.category,
      description: input.description,
      amountMinor: input.amountMinor,
      spentOn: input.spentOn,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      recordedById: ctx.user.id,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "EXPENSE_RECORDED",
    entityType: "Expense",
    entityId: expense.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${formatMoney(input.amountMinor)} spent on ${humanize(input.category).toLowerCase()}: ${input.description}.`,
  });

  return expense;
}

export async function removeExpense(ctx: TenantContext, expenseId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  // Scoped by `ctx.db`: another school's expense id is simply not found.
  const expense = await ctx.db.expense.findFirst({
    where: { id: expenseId },
    select: { id: true, amountMinor: true, description: true },
  });
  if (!expense) throw new NotFoundError("That expense was not found.");

  await ctx.db.expense.deleteMany({ where: { id: expense.id } });

  await recordAudit({
    action: "EXPENSE_REMOVED",
    entityType: "Expense",
    entityId: expense.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${formatMoney(expense.amountMinor)} expense removed: ${expense.description}.`,
  });
}

export async function listExpenses(
  ctx: TenantContext,
  filters: { from?: Date | null; to?: Date | null; category?: ExpenseCategory | null; take?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  return ctx.db.expense.findMany({
    where: {
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.from || filters.to
        ? {
            spentOn: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 100,
    select: {
      id: true,
      category: true,
      description: true,
      amountMinor: true,
      spentOn: true,
      method: true,
      reference: true,
      recordedBy: { select: { email: true } },
    },
  });
}
