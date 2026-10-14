import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangleIcon, CalendarCheckIcon, HourglassIcon, WalletIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewBillForm, ReasonActionForm, RecordPaymentForm } from "@/features/platform/collection-forms";
import { cancelPlatformBillAction, voidPlatformPaymentAction } from "@/features/platform/actions";
import { addDays, formatDate, toDateInput, today } from "@/lib/dates";
import { formatMoney, pluralize } from "@/lib/format";
import { enumParam } from "@/lib/search-params";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { billableOrganizations, collectionSummary, listBills, recentPlatformPayments } from "@/server/platform/collections";

export const metadata: Metadata = { title: "Collections" };

const FILTERS = ["pending", "overdue", "paid", "cancelled"] as const;
const METHOD: Record<string, string> = { CASH: "Cash", CHEQUE: "Cheque", BANK_TRANSFER: "Bank transfer", UPI: "UPI", CARD: "Card", OTHER: "Other" };
const STATUS = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PART_PAID: { label: "Part paid", tone: "info" },
  PAID: { label: "Paid", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
} as const;

/**
 * SchoolOS's own collection: bills raised to organizations and money
 * received, both entered by hand (SchoolOS takes no online payments).
 * Collected = payments recorded; pending = what live bills still wait for.
 */
export default async function CollectionsPage(props: PageProps<"/super-admin/collections">) {
  const user = await requireSuperAdmin();
  const search = await props.searchParams;
  const filter = enumParam(search.show, FILTERS) ?? "all";
  const [summary, { bills, counts }, payments, organizations] = await Promise.all([collectionSummary(user), listBills(user, filter), recentPlatformPayments(user, 20), billableOrganizations(user)]);
  const now = today();
  const tab = (value: (typeof FILTERS)[number] | null, label: string, count: number) => ({
    href: (value ? `/super-admin/collections?show=${value}` : "/super-admin/collections") as Route,
    label,
    count,
    active: (filter === "all" ? null : filter) === value,
  });

  return (
    <>
      <PageHeader icon={WalletIcon} tone="green" title="Collections" description="What SchoolOS has billed organizations and received from them. Both are entered by hand — SchoolOS takes no online payments, and a plan or upgrade alone is never counted as collected." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="green" icon={WalletIcon} label="Total collection" value={formatMoney(summary.totalMinor)} hint={`${pluralize(summary.totalPayments, "payment")} · this month ${formatMoney(summary.monthMinor)}`} />
        <StatCard tone="blue" icon={CalendarCheckIcon} label="Today's collection" value={formatMoney(summary.todayMinor)} hint={pluralize(summary.todayPayments, "payment received today", "payments received today")} />
        <StatCard tone="amber" icon={HourglassIcon} label="Pending collection" value={formatMoney(summary.pendingMinor)} hint={pluralize(summary.pendingBills, "bill waiting", "bills waiting")} href="/super-admin/collections?show=pending" />
        <StatCard tone="red" icon={AlertTriangleIcon} label="Overdue" value={formatMoney(summary.overdueMinor)} hint="pending past the due date" href="/super-admin/collections?show=overdue" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader>
            <CardTitle>New bill</CardTitle>
            <CardDescription>Raise a bill to an organization. It shows as pending until you record money against it.</CardDescription>
          </CardHeader>
          <CardContent>{organizations.length ? <NewBillForm organizations={organizations} defaultDueOn={toDateInput(addDays(now, 15))} /> : <p className="text-muted-foreground text-sm">No organization to bill yet.</p>}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
            <CardDescription>Newest first. A payment entered by mistake is voided with a reason — it stays on record and stops counting.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length ? (
              <ul className="divide-y text-sm">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex flex-col gap-1 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={payment.voidedAt ? "text-muted-foreground line-through" : "font-medium"}>{`${formatMoney(payment.amountMinor, payment.bill.currency)} · ${payment.bill.organization.name}`}</span>
                      {payment.voidedAt ? <StatusBadge status="VOID" label="Voided" tone="neutral" /> : null}
                    </div>
                    <span className="text-muted-foreground text-xs">{[formatDate(payment.receivedOn), METHOD[payment.method] ?? payment.method, payment.referenceNo ? `Ref ${payment.referenceNo}` : null, payment.bill.billNo, payment.voidReason ? `Voided: ${payment.voidReason}` : null].filter(Boolean).join(" · ")}</span>
                    {!payment.voidedAt ? (
                      <details className="text-xs">
                        <summary className="text-muted-foreground cursor-pointer">Void this payment</summary>
                        <div className="mt-2">
                          <ReasonActionForm action={voidPlatformPaymentAction} id={payment.id} label="Void payment" hint="Why it was wrong — kept on the record." />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-bold">Bills</h2>
      <div className="mb-4">
        <ViewTabs label="Bills" tabs={[tab(null, "All", counts.all), tab("pending", "Pending", counts.pending), tab("overdue", "Overdue", counts.overdue), tab("paid", "Paid", counts.paid), tab("cancelled", "Cancelled", counts.cancelled)]} />
      </div>
      {bills.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill.id} className="align-top">
                  <TableCell>
                    <span className="font-medium">{bill.billNo}</span>
                    <p className="text-muted-foreground text-xs">{[bill.planName, bill.periodStart && bill.periodEnd ? `${formatDate(bill.periodStart)} – ${formatDate(bill.periodEnd)}` : null, bill.description].filter(Boolean).join(" · ")}</p>
                  </TableCell>
                  <TableCell>
                    <Link href={`/super-admin/organizations/${bill.organization.id}` as Route} className="hover:underline">
                      {bill.organization.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(bill.amountMinor, bill.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(bill.receivedMinor, bill.currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(bill.pendingMinor, bill.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(bill.dueOn)}
                    {bill.overdue ? <p className="text-danger-strong text-xs">Overdue</p> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={bill.status} label={STATUS[bill.status].label} tone={STATUS[bill.status].tone} />
                    {bill.cancelReason ? <p className="text-muted-foreground mt-1 text-xs">{bill.cancelReason}</p> : null}
                  </TableCell>
                  <TableCell className="min-w-56 text-right">
                    {bill.pendingMinor > 0 ? (
                      <details className="text-left">
                        <summary className="text-primary cursor-pointer text-sm font-medium">Record payment</summary>
                        <div className="mt-2">
                          <RecordPaymentForm billId={bill.id} pendingMinor={bill.pendingMinor} today={toDateInput(now)} />
                        </div>
                      </details>
                    ) : null}
                    {bill.status === "UNPAID" ? (
                      <details className="mt-2 text-left">
                        <summary className="text-muted-foreground cursor-pointer text-xs">Cancel bill</summary>
                        <div className="mt-2">
                          <ReasonActionForm action={cancelPlatformBillAction} id={bill.id} label="Cancel bill" hint="Only a bill with nothing received can be cancelled." />
                        </div>
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No bills here">Bills you raise appear here with what has been received.</EmptyState>
      )}
    </>
  );
}
