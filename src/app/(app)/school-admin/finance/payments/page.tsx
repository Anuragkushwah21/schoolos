import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
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
import { removePaymentAction } from "@/features/finance/actions";
import { PaymentForm } from "@/features/finance/forms";
import { FEE_STATUS_LABEL, FEE_STATUS_TONE, rupees } from "@/features/finance/money";
import { formatDate, toDateInput, today } from "@/lib/dates";
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

  const [positions, payments, receiptNo] = await Promise.all([
    listFeePositions(ctx, { q }),
    listPayments(ctx, { academicSessionId: session.id, take: 50 }),
    suggestReceiptNo(ctx),
  ]);

  // The student being paid for: the one asked for if they are in this school's
  // list, otherwise whatever the search narrowed to.
  const selected =
    positions.rows.find((row) => row.studentId === studentId) ??
    (q && positions.rows.length === 1 ? positions.rows[0] : null);

  const account = selected ? await readStudentFees(ctx, selected.studentId, session.id) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/finance", label: "Finance" }}
        title="Payments"
        description={`${session.name} · record what has been received`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
            <CardDescription>Find the student first, then enter what was received.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FilterBar
              action="/school-admin/finance/payments"
              search={{ defaultValue: q, placeholder: "Student, admission no, parent or mobile" }}
            />

            {selected && account ? (
              <>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {selected.section} · {selected.admissionNumber}
                    {selected.parentName ? ` · ${selected.parentName}` : ""}
                  </p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground text-xs">Charged</dt>
                      <dd className="tabular-nums">{rupees(account.summary.chargedMinor)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Paid</dt>
                      <dd className="tabular-nums">{rupees(account.summary.paidMinor)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Pending</dt>
                      <dd className="tabular-nums">{rupees(account.summary.pendingMinor)}</dd>
                    </div>
                  </dl>
                </div>
                <PaymentForm
                  studentId={selected.studentId}
                  today={toDateInput(today())}
                  suggestedReceiptNo={receiptNo}
                />
              </>
            ) : positions.rows.length && q ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-sm">Choose the student:</p>
                <ul className="divide-y rounded-lg border">
                  {positions.rows.slice(0, 8).map((row) => (
                    <li key={row.studentId} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium">{row.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {row.section} · pending {rupees(row.summary.pendingMinor)}
                        </span>
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/school-admin/finance/payments?student=${row.studentId}` as Route}
                        >
                          Select
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Search for a student above to record a payment against their account.
              </p>
            )}
          </CardContent>
        </Card>

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
                      <TableHead className="w-20" />
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
                        <TableCell className="text-muted-foreground">{payment.receiptNo}</TableCell>
                        <TableCell className="text-muted-foreground hidden md:table-cell">
                          {humanize(payment.method)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {rupees(payment.amountMinor)}
                        </TableCell>
                        <TableCell className="text-right">
                          <ActionButton
                            action={removePaymentAction}
                            fields={{ paymentId: payment.id }}
                            variant="ghost"
                            size="xs"
                            pendingLabel="Removing…"
                            confirm={{
                              title: `Remove receipt ${payment.receiptNo}?`,
                              description:
                                "The family's pending amount goes back up by this much. Use it for a receipt entered by mistake.",
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
              <EmptyState title="No payments recorded yet" />
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
                  <span className="text-sm tabular-nums">{rupees(charge.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
