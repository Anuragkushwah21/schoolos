import type { Metadata, Route } from "next";
import Link from "next/link";
import { BanknoteIcon, DownloadIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { formatDate, toDateInput, today } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";
import { listExpenses } from "@/server/finance/expenses";
import { listFeePositions, listPayments } from "@/server/finance/fees";
import { listSalaries, monthOf } from "@/server/finance/salary";
import { feeDeskToday } from "@/server/staff/portal";

export const metadata: Metadata = { title: "Finance" };

/**
 * The accountant's finance dashboard: where fees stand, today's collection,
 * this month's spending and the salary bill — each part only with its
 * permission (the services check again) — then outstanding fees, recent
 * receipts and the reports they may download.
 */
export default async function StaffFinancePage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.view", "fees.collect", "fees.manage", "expenses.view", "payroll.view", "fees.reports"]);
  const grants: string[] = await staffGrants(ctx);
  const has = (...keys: string[]) => keys.some((key) => grants.includes(key));
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Finance" need="session" />;

  const now = today();
  const monthStart = monthOf(now);
  const canFees = has("fees.view", "fees.collect", "fees.manage");
  const [fees, payments, desk, expenses, salaries] = await Promise.all([
    canFees ? listFeePositions(ctx) : null,
    canFees ? listPayments(ctx, { academicSessionId: session.id, take: 8 }) : [],
    canFees ? feeDeskToday(ctx) : null,
    has("expenses.view") ? listExpenses(ctx, { from: monthStart, to: now, category: null, take: 500 }) : null,
    has("payroll.view") ? listSalaries(ctx) : null,
  ]);
  const totals = fees?.totals;
  const spent = expenses?.reduce((sum, row) => sum + row.amountMinor, 0) ?? 0;
  const range = `from=${toDateInput(monthStart)}&to=${toDateInput(now)}`;

  return (
    <>
      <PageHeader
        icon={WalletIcon}
        tone="orange"
        title="Finance"
        description={`${session.name} · fees, collection, spending and salaries`}
        actions={
          has("fees.collect") || has("fees.manage") ? (
            <>
              {has("fees.manage") ? (
                <Button asChild variant="outline">
                  <Link href="/staff/fees/structure">Fee structure &amp; charges</Link>
                </Button>
              ) : null}
              {has("fees.collect") ? (
                <Button asChild>
                  <Link href="/staff/fees">Collect fee</Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {totals ? (
          <>
            <StatCard label="Collected today" value={rupees(desk?.totalMinor ?? 0)} hint={pluralize(desk?.receipts ?? 0, "receipt")} href="/staff/fees/payments" />
            <StatCard label="Collected this session" value={rupees(totals.paidMinor)} hint={`of ${rupees(totals.chargedMinor)} charged`} />
            <StatCard label="Pending fees" value={rupees(totals.pendingMinor)} hint={totals.overdue ? `${totals.overdue} overdue` : "none overdue"} href="/staff/fees" />
          </>
        ) : null}
        {expenses ? <StatCard label="Spent this month" value={rupees(spent)} hint={pluralize(expenses.length, "expense")} href="/staff/expenses" /> : null}
        {salaries ? <StatCard label="Salary bill" value={rupees(salaries.totals.monthlyMinor)} hint="per month" href="/staff/payroll" /> : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {canFees ? (
          <Button asChild variant="outline">
            <Link href="/staff/fees/payments">
              <ReceiptTextIcon aria-hidden />
              Payment history & receipts
            </Link>
          </Button>
        ) : null}
        {has("expenses.view") ? (
          <Button asChild variant="outline">
            <Link href="/staff/expenses">Expenses</Link>
          </Button>
        ) : null}
        {has("payroll.view") ? (
          <Button asChild variant="outline">
            <Link href="/staff/payroll">
              <BanknoteIcon aria-hidden />
              Payroll
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {fees ? (
          <Card>
            <CardHeader>
              <CardTitle>Outstanding fees</CardTitle>
              <CardDescription>Largest amounts owed first.</CardDescription>
            </CardHeader>
            <CardContent>
              {fees.rows.some((row) => row.summary.pendingMinor > 0) ? (
                <ul className="divide-y">
                  {[...fees.rows]
                    .filter((row) => row.summary.pendingMinor > 0)
                    .sort((a, b) => b.summary.pendingMinor - a.summary.pendingMinor)
                    .slice(0, 8)
                    .map((row) => (
                      <li key={row.studentId} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <Link href={`/staff/fees?student=${row.studentId}` as Route} className="block text-sm font-medium hover:underline">
                            {row.name}
                          </Link>
                          <span className="text-muted-foreground block text-xs">
                            {row.section}
                            {row.parentName ? ` · ${row.parentName}` : ""}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums">{rupees(row.summary.pendingMinor)}</span>
                        <StatusBadge status={row.summary.status} label={FEE_STATUS_LABEL[row.summary.status]} tone={FEE_STATUS_TONE[row.summary.status]} />
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing outstanding — or nothing charged yet.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {canFees ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Recent receipts</CardTitle>
                <CardDescription>Newest first.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/staff/fees/payments">All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {payments.length ? (
                <ul className="divide-y">
                  {payments.map((payment) => (
                    <li key={payment.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {payment.student.firstName} {payment.student.lastName}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {payment.receiptNo} · {formatDate(payment.paidOn)}
                          {payment.voidedAt ? " · Void" : ""}
                        </span>
                      </span>
                      <span className={`text-sm tabular-nums ${payment.voidedAt ? "text-muted-foreground line-through" : ""}`}>{rupees(payment.amountMinor)}</span>
                      <ReceiptLinks paymentId={payment.id} receiptNo={payment.receiptNo} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {has("fees.reports") ? (
          <Card>
            <CardHeader>
              <CardTitle>Finance reports</CardTitle>
              <CardDescription>CSV files that open in Excel. Payment, expense and salary reports cover this month so far.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {[
                { kind: "fees", label: "Fees by student", show: true },
                { kind: "fees-pending", label: "Pending fees", show: true },
                { kind: "fee-payments", label: "Payments this month", show: true, dated: true },
                { kind: "expenses", label: "Expenses this month", show: has("expenses.view"), dated: true },
                { kind: "salary-payments", label: "Salary payments this month", show: has("payroll.view"), dated: true },
              ]
                .filter((report) => report.show)
                .map((report) => (
                  <Button key={report.kind} asChild variant="outline" size="sm">
                    <a href={`/staff/finance/export?kind=${report.kind}${report.dated ? `&${range}` : ""}`} download>
                      <DownloadIcon aria-hidden />
                      {report.label}
                    </a>
                  </Button>
                ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
