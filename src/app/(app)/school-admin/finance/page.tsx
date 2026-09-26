import type { Metadata, Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { listFeePositions, listPayments } from "@/server/finance/fees";
import { listSalaries } from "@/server/finance/salary";

export const metadata: Metadata = { title: "Finance" };

/**
 * Where the school's money stands.
 *
 * Every figure is computed from the charge and payment rows themselves, not from
 * a stored balance — so a corrected charge or a deleted receipt cannot leave this
 * page disagreeing with the ledger it summarises.
 */
export default async function FinancePage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Finance" need="session" />;

  const [fees, payments, salaries] = await Promise.all([
    listFeePositions(ctx),
    listPayments(ctx, { academicSessionId: session.id, take: 8 }),
    listSalaries(ctx),
  ]);

  const totals = fees.totals;

  return (
    <>
      <PageHeader
        title="Finance"
        description={`${session.name} · fee collection and staff salaries`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/finance/payments">Payments</Link>
            </Button>
            <Button asChild>
              <Link href="/school-admin/finance/fees">Fee collection</Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Charged"
          value={rupees(totals?.chargedMinor ?? 0)}
          hint={`${pluralize(totals?.students ?? 0, "student")}`}
        />
        <StatCard label="Collected" value={rupees(totals?.paidMinor ?? 0)} />
        <StatCard
          label="Pending"
          value={rupees(totals?.pendingMinor ?? 0)}
          hint={totals?.overdue ? `${totals.overdue} overdue` : "none overdue"}
        />
        <StatCard
          label="Salary bill"
          value={rupees(salaries.totals.monthlyMinor)}
          hint="per month, configured staff"
          href="/school-admin/finance/salaries"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Outstanding fees</CardTitle>
              <CardDescription>Largest amounts owed first.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/finance/fees?status=PENDING">All</Link>
            </Button>
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
                        <Link
                          href={`/school-admin/finance/fees?q=${encodeURIComponent(row.admissionNumber)}` as Route}
                          className="block text-sm font-medium hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {row.section}
                          {row.parentName ? ` · ${row.parentName}` : ""}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">{rupees(row.summary.pendingMinor)}</span>
                      <StatusBadge
                        status={row.summary.status}
                        label={FEE_STATUS_LABEL[row.summary.status]}
                        tone={FEE_STATUS_TONE[row.summary.status]}
                      />
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nothing outstanding — or nothing charged yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Recent receipts</CardTitle>
              <CardDescription>Newest first.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/finance/payments">All</Link>
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
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">{rupees(payment.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
