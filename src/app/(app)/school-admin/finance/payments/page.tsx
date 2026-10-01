import { WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { removeChargeAction, removePaymentAction } from "@/features/finance/actions";
import { FeeDesk } from "@/features/finance/fee-desk";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import {
  listFeePositions,
  listPayments,
  readStudentFees,
  suggestReceiptNo,
} from "@/server/finance/fees";

export const metadata: Metadata = { title: "Payments" };

/**
 * Taking money in, and the receipts already issued.
 *
 * A payment is recorded against the student's account for the session rather
 * than split across fee heads: that is how a school takes one, and forcing the
 * office to allocate every receipt across four heads would invent work and a new
 * way to be wrong.
 */
export default async function PaymentsPage(props: PageProps<"/school-admin/finance/payments">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Payments" need="session" />;

  const search = await props.searchParams;
  const q = param(search.q);
  const studentId = param(search.student);
  const receiptId = param(search.receipt);

  const [positions, payments, receiptNo, justRecorded] = await Promise.all([
    listFeePositions(ctx, { q }),
    listPayments(ctx, { academicSessionId: session.id, take: 50 }),
    suggestReceiptNo(ctx),
    // Set after a payment is saved. Looked up through the scoped client, so an
    // id from another school simply shows nothing.
    receiptId
      ? ctx.db.feePayment.findFirst({
          where: { id: receiptId },
          select: { id: true, receiptNo: true, amountMinor: true },
        })
      : Promise.resolve(null),
  ]);

  // The student being paid for: the one asked for if they are in this school's
  // list, otherwise whatever the search narrowed to.
  const selected =
    positions.rows.find((row) => row.studentId === studentId) ??
    (q && positions.rows.length === 1 ? positions.rows[0] : null);

  const account = selected ? await readStudentFees(ctx, selected.studentId, session.id) : null;

  return (
    <>
      <PageHeader icon={WalletIcon} tone="orange"
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Payments"
        description={`${session.name} · record what has been received`}
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/finance/receipts">Receipt settings</Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-6">
          <FeeDesk
            basePath="/school-admin/finance/payments"
            q={q}
            positions={positions.rows}
            selected={selected}
            account={account}
            receiptNo={receiptNo}
            justRecorded={justRecorded}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
            <CardDescription>Newest first, this session.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="w-28">Receipt</TableHead>
                      <TableHead className="hidden w-28 md:table-cell">Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-44" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="tabular-nums">{formatDate(payment.paidOn)}</TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {payment.student.firstName} {payment.student.lastName}
                          </span>
                          <p className="text-muted-foreground text-xs">
                            {payment.student.admissionNumber}
                          </p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.receiptNo}
                          {payment.voidedAt ? <StatusBadge status="VOID" tone="negative" label="Void" className="ml-1" /> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden md:table-cell">
                          {humanize(payment.method)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${payment.voidedAt ? "text-muted-foreground line-through" : ""}`}>
                          {rupees(payment.amountMinor)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <ReceiptLinks paymentId={payment.id} receiptNo={payment.receiptNo} />
                          {payment.voidedAt ? null : (
                          <ActionButton
                            action={removePaymentAction}
                            fields={{ paymentId: payment.id }}
                            variant="ghost"
                            size="xs"
                            pendingLabel="Voiding…"
                            confirm={{
                              title: `Void receipt ${payment.receiptNo}?`,
                              description:
                                "For a receipt entered by mistake. It stays on record marked VOID, and the family's pending amount goes back up by this much.",
                              confirmLabel: "Void receipt",
                            }}
                          >
                            Void
                          </ActionButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title="No fee payments found.">Choose a student above to collect their first payment — a receipt is ready to print straight away.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && account && account.charges.length ? (
        <Card className="mt-6">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{selected.name} — breakdown</CardTitle>
              <CardDescription>What has been charged this session.</CardDescription>
            </div>
            <StatusBadge
              status={account.summary.status}
              label={FEE_STATUS_LABEL[account.summary.status]}
              tone={FEE_STATUS_TONE[account.summary.status]}
            />
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {account.charges.map((charge) => (
                <li key={charge.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{charge.feeHead.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      due {formatDate(charge.dueOn)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">{rupees(charge.amountMinor)}</span>
                    <ActionButton
                      action={removeChargeAction}
                      fields={{ chargeId: charge.id }}
                      variant="ghost"
                      size="xs"
                      pendingLabel="Removing…"
                      confirm={{
                        title: `Remove ${charge.feeHead.name} from ${selected.name}?`,
                        description: "The family's total fee and pending amount go down by this much. Payments already recorded are not touched.",
                        confirmLabel: "Remove",
                      }}
                    >
                      Remove
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
