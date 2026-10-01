import type { Route } from "next";
import Link from "next/link";

import { FilterBar } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentForm } from "@/features/finance/forms";
import { rupees } from "@/features/finance/money";
import { toDateInput, today } from "@/lib/dates";

type Position = {
  studentId: string;
  name: string;
  section: string;
  admissionNumber: string;
  parentName: string | null;
  summary: { pendingMinor: number };
};

/**
 * The fee desk: find a student, see what they owe, take a payment, print the
 * receipt. Shared by the School Admin's Payments page and a staff member who
 * holds "Collect fees" — the same screen, reached from two places.
 */
export function FeeDesk({
  basePath,
  q,
  positions,
  selected,
  account,
  receiptNo,
  justRecorded,
}: {
  basePath: string;
  q: string | undefined;
  positions: Position[];
  selected: Position | null | undefined;
  account: { summary: { chargedMinor: number; paidMinor: number; pendingMinor: number } } | null;
  receiptNo: string;
  justRecorded: { id: string; receiptNo: string; amountMinor: number } | null;
}) {
  return (
    <>
      {justRecorded ? (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success-strong"
        >
          <p>
            {rupees(justRecorded.amountMinor)} recorded · receipt <span className="font-mono">{justRecorded.receiptNo}</span>
          </p>
          <span className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/receipts/${justRecorded.id}` as Route} target="_blank">
                View receipt
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/receipts/${justRecorded.id}?print=1` as Route} target="_blank">
                Print receipt
              </Link>
            </Button>
          </span>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Record a payment</CardTitle>
          <CardDescription>Find the student first, then enter what was received.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FilterBar
            action={basePath}
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
          ) : positions.length && q ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">Choose the student:</p>
              <ul className="divide-y rounded-lg border">
                {positions.slice(0, 8).map((row) => (
                  <li key={row.studentId} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-medium">{row.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {row.section} · pending {rupees(row.summary.pendingMinor)}
                      </span>
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`${basePath}?student=${row.studentId}` as Route}
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
    </>
  );
}
