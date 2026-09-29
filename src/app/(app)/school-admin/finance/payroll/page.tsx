import { BanknoteIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { rupees } from "@/features/finance/money";
import { PayrollForm } from "@/features/finance/payroll-form";
import { dateOnly, formatDate, formatMonth, today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getPayroll } from "@/server/finance/payroll";

export const metadata: Metadata = { title: "Payroll" };

/**
 * One month's payroll: what each teacher is due from their salary structure,
 * who is already paid, and a batch "mark paid" for the rest. Amounts can be
 * adjusted before paying (unpaid leave, arrears); nothing is paid twice.
 */
export default async function PayrollPage(props: PageProps<"/school-admin/finance/payroll">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const now = today();
  const match = param(search.month)?.match(/^(\d{4})-(\d{2})$/);
  const month = match ? dateOnly(Number(match[1]), Number(match[2]), 1) : dateOnly(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const monthKey = toDateInput(month).slice(0, 7);
  const payroll = await getPayroll(ctx, month);

  return (
    <>
      <PageHeader icon={BanknoteIcon} tone="amber"
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Payroll"
        description={`${formatMonth(month)} · generated from each teacher's salary structure.`}
      />
      <form action="/school-admin/finance/payroll" className="mb-6 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Month
          <input type="month" name="month" defaultValue={monthKey} className="border-input h-9 rounded-md border px-2" />
        </label>
        <button type="submit" className="border-input h-9 rounded-md border px-3 text-sm">
          Show
        </button>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Due this month" value={rupees(payroll.totals.dueMinor)} />
        <StatCard label="Paid" value={rupees(payroll.totals.paidMinor)} hint={`${payroll.totals.paid} teachers`} />
        <StatCard label="Still to pay" value={payroll.totals.unpaid} />
        <StatCard label="No salary set" value={payroll.totals.withoutStructure} href="/school-admin/finance/salaries" />
      </div>
      {payroll.rows.length ? (
        <PayrollForm
          month={monthKey}
          today={toDateInput(now)}
          rows={payroll.rows.map((row) => ({
            ...row,
            payment: row.payment ? { amountMinor: row.payment.amountMinor, paidOn: formatDate(row.payment.paidOn), method: row.payment.method } : null,
          }))}
        />
      ) : (
        <EmptyState
          title="No teachers yet."
          action={
            <Button asChild>
              <Link href="/school-admin/teachers/new">Add teacher</Link>
            </Button>
          }
        >
          Add your teachers first; their salaries then appear here to pay each month.
        </EmptyState>
      )}
    </>
  );
}
