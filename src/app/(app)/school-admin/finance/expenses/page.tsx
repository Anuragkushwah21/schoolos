import { ReceiptTextIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { removeExpenseAction } from "@/features/finance/actions";
import { ExpenseForm } from "@/features/finance/forms";
import { EXPENSE_CATEGORY_OPTIONS, rupees } from "@/features/finance/money";
import { formatDate, parseDateInput, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { EXPENSE_CATEGORIES, listExpenses } from "@/server/finance/expenses";
import { monthOf } from "@/server/finance/salary";

export const metadata: Metadata = { title: "Expenses" };

/**
 * What the school has spent, other than salaries. School Admin only; every
 * row is read through the session's own school.
 */
export default async function ExpensesPage(props: PageProps<"/school-admin/finance/expenses">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const now = today();
  const from = parseDateInput(param(search.from)) ?? monthOf(now);
  const to = parseDateInput(param(search.to)) ?? now;
  const category = enumParam(search.category, EXPENSE_CATEGORIES) ?? null;

  const expenses = await listExpenses(ctx, { from, to, category, take: 200 });
  const total = expenses.reduce((sum, row) => sum + row.amountMinor, 0);

  return (
    <>
      <PageHeader icon={ReceiptTextIcon} tone="red"
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Expenses"
        description="Bills, purchases and running costs. Salaries are recorded under Salaries."
        actions={
          <Button asChild>
            <a href="#add-expense">
              <PlusIcon aria-hidden />
              Add expense
            </a>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total in view" value={rupees(total)} hint={`${formatDate(from)} – ${formatDate(to)}`} />
        <StatCard label="Entries" value={expenses.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div>
          <FilterBar
            action="/school-admin/finance/expenses"
            selects={[
              {
                name: "category",
                label: "Category",
                defaultValue: category ?? "",
                options: EXPENSE_CATEGORY_OPTIONS,
                allLabel: "All categories",
              },
            ]}
            dates={[
              { name: "from", label: "From", defaultValue: toDateInput(from), max: toDateInput(now) },
              { name: "to", label: "To", defaultValue: toDateInput(to), max: toDateInput(now) },
            ]}
          />
          {expenses.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>What for</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.spentOn)}</TableCell>
                      <TableCell>{humanize(row.category)}</TableCell>
                      <TableCell>
                        {row.description}
                        {row.reference ? (
                          <span className="text-muted-foreground block text-xs">{row.reference}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupees(row.amountMinor)}</TableCell>
                      <TableCell className="text-right">
                        <ActionButton
                          action={removeExpenseAction}
                          fields={{ expenseId: row.id }}
                          variant="ghost"
                          size="xs"
                          pendingLabel="Removing…"
                          confirm={{
                            title: "Remove this expense?",
                            description: "It will no longer count in the finance totals.",
                            confirmLabel: "Remove",
                          }}
                        >
                          Remove
                        </ActionButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No expenses in this period">
              Record a bill or purchase with the form, or widen the dates.
            </EmptyState>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle id="add-expense" className="scroll-mt-24">Add expense</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm today={toDateInput(now)} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
