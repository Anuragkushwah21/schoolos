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
import { StudentCharges } from "@/features/finance/student-charges";
import { FeeDesk } from "@/features/finance/fee-desk";
import { StudentFeeAccount } from "@/features/finance/family-views";
import { previousDues } from "@/server/finance/carry-forward";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { VoidPaymentForm } from "@/features/finance/forms";
import { rupees } from "@/features/finance/money";
import { formatDate, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import {
  listFeeHeads,
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

  const [positions, payments, receiptNo, justRecorded, heads] = await Promise.all([
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
    listFeeHeads(ctx),
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
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/finance/family">Family payment</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/school-admin/finance/receipts">Receipt settings</Link>
            </Button>
          </>
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
          {selected && account ? <StudentFeeAccount studentId={selected.studentId} account={account} previous={await previousDues(ctx, selected.studentId)} canManage ledgerHref={`/school-admin/finance/ledger/${selected.studentId}`} /> : null}
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
                          <VoidPaymentForm paymentId={payment.id} receiptNo={payment.receiptNo} />
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

      {selected && account ? (
        <div className="mt-6">
          <StudentCharges
            studentId={selected.studentId}
            studentName={selected.name}
            charges={account.charges}
            status={account.summary.status}
            heads={heads.filter((head) => head.isActive).map((head) => ({ value: head.id, label: head.name }))}
            canManage
            defaultDueOn={toDateInput(today())}
          />
        </div>
      ) : null}
    </>
  );
}
