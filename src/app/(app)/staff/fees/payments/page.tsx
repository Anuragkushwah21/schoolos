import type { Metadata } from "next";
import { ReceiptTextIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VoidPaymentForm } from "@/features/finance/forms";
import { rupees } from "@/features/finance/money";
import { ReceiptLinks } from "@/features/finance/receipt-links";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";
import { ActionButton } from "@/components/forms/action-button";
import { listPayments } from "@/server/finance/fees";

export const metadata: Metadata = { title: "Payment history" };

/**
 * Every fee payment this session, newest first, with its receipt. Voided
 * receipts stay, marked void. With "Fee structure & charges" (the Accountant's
 * default) a receipt entered by mistake can be voided here, as the admin can.
 */
export default async function StaffPaymentHistoryPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.view", "fees.collect", "fees.manage"]);
  const canVoid = await staffHolds(ctx, "fees.manage");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Payment history" need="session" />;
  const payments = await listPayments(ctx, { academicSessionId: session.id, take: 300 });

  return (
    <>
      <PageHeader icon={ReceiptTextIcon} tone="orange" back={{ href: "/staff/finance", label: "Finance" }} title="Payment history" description={`${session.name} · the latest ${payments.length} receipts`} />
      {payments.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(payment.paidOn)}</TableCell>
                  <TableCell>
                    {payment.student.firstName} {payment.student.lastName}
                    <span className="text-muted-foreground block text-xs">{payment.student.admissionNumber}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {payment.receiptNo}
                    {payment.voidedAt ? <StatusBadge status="VOID" tone="negative" label="Void" className="ml-2" /> : null}
                  </TableCell>
                  <TableCell>{humanize(payment.method)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${payment.voidedAt ? "text-muted-foreground line-through" : ""}`}>{rupees(payment.amountMinor)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <ReceiptLinks paymentId={payment.id} receiptNo={payment.receiptNo} />
                      {canVoid && !payment.voidedAt ? (
                        <VoidPaymentForm paymentId={payment.id} receiptNo={payment.receiptNo} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No payments recorded yet" />
      )}
    </>
  );
}
