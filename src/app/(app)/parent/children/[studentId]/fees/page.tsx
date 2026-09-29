import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChildSwitcher, ChildTabs } from "@/features/parent/child-nav";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { listMyChildren } from "@/server/parent/access";
import { getChildFees } from "@/server/parent/child";

export const metadata: Metadata = { title: "Fees & payments" };

/**
 * What one child's fees stand at, and every receipt against them.
 *
 * The same rows the school office works from — there is no parent-only copy of a
 * fee record, and the four numbers come from the same arithmetic the collection
 * screen uses, so this cannot quietly disagree with what the school sees.
 *
 * Read-only. No online payment is offered, because none exists: showing a "Pay
 * now" button that does nothing would be worse than not having one.
 */
export default async function ChildFeesPage(
  props: PageProps<"/parent/children/[studentId]/fees">,
) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;

  const [{ children }, data] = await Promise.all([
    listMyChildren(ctx),
    orNotFound(getChildFees(ctx, studentId)),
  ]);

  const { child, summary, charges, payments, session } = data;
  const placed = children.filter((sibling) => sibling.sectionId !== null);

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={`${child.student.name} — fees`}
        description={`${child.placement.sectionLabel} · ${session?.name ?? child.placement.sessionName}`}
      />

      <ChildSwitcher options={placed} activeId={studentId} tab="fees" />
      <ChildTabs studentId={studentId} active="fees" />

      {summary.status === "NONE" ? (
        <EmptyState title="No fees have been charged yet">
          When the school raises fees for {child.student.name.split(" ")[0]}&apos;s class, the
          breakdown and what has been paid appear here.
        </EmptyState>
      ) : (
        <>
          {summary.overdue ? (
            <div
              role="status"
              className="mb-6 rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: "var(--viz-warning)", color: "var(--viz-warning)" }}
            >
              {rupees(summary.pendingMinor)} was due on {formatDate(summary.dueOn)}. Please contact
              the school office.
            </div>
          ) : null}

          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total fee" value={rupees(summary.chargedMinor)} />
            <StatCard label="Paid" value={rupees(summary.paidMinor)} />
            <StatCard
              label="Pending"
              value={rupees(summary.pendingMinor)}
              hint={summary.dueOn ? `due ${formatDate(summary.dueOn)}` : undefined}
            />
            <StatCard
              label="Status"
              value={
                <StatusBadge
                  status={summary.status}
                  label={FEE_STATUS_LABEL[summary.status]}
                  tone={FEE_STATUS_TONE[summary.status]}
                />
              }
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Breakdown</CardTitle>
                <CardDescription>What the school has charged this session.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fee</TableHead>
                        <TableHead className="w-28">Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {charges.map((charge) => (
                        <TableRow key={charge.id}>
                          <TableCell>
                            <span className="font-medium">{charge.feeHead.name}</span>
                            {charge.feeHead.note || charge.notes ? (
                              <p className="text-muted-foreground text-xs">
                                {charge.notes ?? charge.feeHead.note}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatDate(charge.dueOn)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupees(charge.amountMinor)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="font-medium">Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right font-medium tabular-nums">
                          {rupees(summary.chargedMinor)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Payment history</CardTitle>
                <CardDescription>
                  {payments.length
                    ? "Newest first. Receipts are issued by the school office."
                    : "Nothing received yet."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payments.length ? (
                  <ul className="divide-y">
                    {payments.map((payment) => (
                      <li key={payment.id} className="flex flex-wrap items-center gap-3 py-3">
                        <span className="text-muted-foreground w-24 shrink-0 text-sm tabular-nums">
                          {formatDate(payment.paidOn)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium tabular-nums">
                            {rupees(payment.amountMinor)}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            Receipt {payment.receiptNo} · {humanize(payment.method)}
                            {payment.notes ? ` · ${payment.notes}` : ""}
                          </span>
                        </span>
                        <ReceiptLinks paymentId={payment.id} receiptNo={payment.receiptNo} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Payments appear here once the school records them.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-muted-foreground mt-6 text-xs">
            These figures come from the school&apos;s own records. To pay, or to question an amount,
            contact the school office — this portal does not take payments.
          </p>
        </>
      )}
    </>
  );
}
