import { WalletIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import { FamilyPayCalculator } from "@/features/finance/family-forms";
import { FamilyFeesView } from "@/features/finance/family-views";
import { familyFees } from "@/server/finance/family";

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
  const [family, accounts] = await Promise.all([familyFees(ctx), Promise.all(placed.map(async (child) => ({ child, fees: await getChildFees(ctx, child.id) })))]);
  const familyPayments = await ctx.db.familyPayment.findMany({
    where: { parentId: family.parent.id, voidedAt: null },
    orderBy: { paidOn: "desc" },
    take: 10,
    select: { id: true, receiptNo: true, totalMinor: true, paidOn: true, _count: { select: { parts: true } } },
  });

  return (
    <>
      <PageHeader
        icon={WalletIcon}
        tone="orange"
        title={family.children.length > 1 ? "Family fees" : "Fees"}
        description="Each child's fees separately — with any concession and anything still owed from last session — and the family total. To pay or question an amount, contact the school office."
      />

      {family.children.length === 0 ? (
        <EmptyState title="No fees to show yet">Fees appear here once your child is placed in a class and the school charges them.</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <FamilyFeesView family={family} />

          {family.familyPaymentEnabled && family.children.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Pay for several children together</CardTitle>
                <CardDescription>Choose the children; the school records one payment and keeps each child&apos;s share on their own account.</CardDescription>
              </CardHeader>
              <CardContent>
                <FamilyPayCalculator childrenDue={family.children.map((child) => ({ id: child.id, name: child.name, payableMinor: child.payableMinor }))} />
              </CardContent>
            </Card>
          ) : null}

          {familyPayments.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Family receipts</CardTitle>
                <CardDescription>One payment for several children, with each child&apos;s share.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {familyPayments.map((payment) => (
                    <li key={payment.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                      <span className="text-muted-foreground w-24 tabular-nums">{formatDate(payment.paidOn)}</span>
                      <span className="flex-1">
                        <span className="font-medium tabular-nums">{rupees(payment.totalMinor)}</span>
                        <span className="text-muted-foreground block text-xs">
                          {payment.receiptNo} · {payment._count.parts} children
                        </span>
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/parent/fees/family/${payment.id}` as Route}>View</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <section className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">Receipts</h2>
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
                <CardContent>
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
                </CardContent>
              </Card>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
