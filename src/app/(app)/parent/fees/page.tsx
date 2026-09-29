import { WalletIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { listMyChildren } from "@/server/parent/access";
import { getChildFees } from "@/server/parent/child";

export const metadata: Metadata = { title: "Fees" };

/**
 * Every child's fees in one place: what is charged, paid and pending, and the
 * latest receipts to view or print. Each child is read through `getChildFees`,
 * which checks the guardian link first — a parent sees only their own
 * children's accounts. The full breakdown stays on each child's Fees tab.
 */
export default async function ParentFeesPage() {
  const ctx = await requireTenant("PARENT");
  const { children } = await listMyChildren(ctx);
  const placed = children.filter((child) => child.sectionId !== null);
  const accounts = await Promise.all(placed.map(async (child) => ({ child, fees: await getChildFees(ctx, child.id) })));

  const totals = accounts.reduce(
    (acc, { fees }) => ({
      charged: acc.charged + fees.summary.chargedMinor,
      paid: acc.paid + fees.summary.paidMinor,
      pending: acc.pending + fees.summary.pendingMinor,
    }),
    { charged: 0, paid: 0, pending: 0 },
  );

  return (
    <>
      <PageHeader icon={WalletIcon} tone="orange" title="Fees" description="Your children's fees and receipts. To pay or question an amount, contact the school office." />

      {accounts.length === 0 ? (
        <EmptyState title="No fees to show yet">Fees appear here once your child is placed in a class and the school charges them.</EmptyState>
      ) : (
        <>
          {accounts.length > 1 ? (
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <StatCard label="Total fee, all children" value={rupees(totals.charged)} />
              <StatCard label="Paid" value={rupees(totals.paid)} />
              <StatCard label="Pending" value={rupees(totals.pending)} />
            </div>
          ) : null}

          <div className="flex flex-col gap-6">
            {accounts.map(({ child, fees }) => (
              <Card key={child.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{child.name}</CardTitle>
                    <CardDescription>
                      {child.sectionLabel} · {fees.session?.name ?? ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={fees.summary.status} label={FEE_STATUS_LABEL[fees.summary.status]} tone={FEE_STATUS_TONE[fees.summary.status]} />
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/parent/children/${child.id}/fees` as Route}>Full breakdown</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {fees.summary.overdue ? (
                    <p role="status" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--viz-warning)", color: "var(--viz-warning)" }}>
                      {rupees(fees.summary.pendingMinor)} was due on {formatDate(fees.summary.dueOn)}. Please contact the school office.
                    </p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <StatCard label="Total fee" value={rupees(fees.summary.chargedMinor)} />
                    <StatCard label="Paid" value={rupees(fees.summary.paidMinor)} />
                    <StatCard
                      label="Pending"
                      value={rupees(fees.summary.pendingMinor)}
                      hint={fees.summary.dueOn ? `due ${formatDate(fees.summary.dueOn)}` : undefined}
                    />
                    <StatCard label="Receipts" value={fees.payments.length} />
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-medium">Receipts</p>
                    {fees.payments.length ? (
                      <ul className="divide-y rounded-lg border">
                        {fees.payments.slice(0, 5).map((payment) => (
                          <li key={payment.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                            <span className="text-muted-foreground w-24 shrink-0 text-sm tabular-nums">{formatDate(payment.paidOn)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium tabular-nums">{rupees(payment.amountMinor)}</span>
                              <span className="text-muted-foreground block text-xs">
                                Receipt {payment.receiptNo} · {humanize(payment.method)}
                              </span>
                            </span>
                            <ReceiptLinks paymentId={payment.id} receiptNo={payment.receiptNo} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">Nothing received yet.</p>
                    )}
                    {fees.payments.length > 5 ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Showing the latest 5.{" "}
                        <Link href={`/parent/children/${child.id}/fees` as Route} className="underline">
                          See all receipts
                        </Link>
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
