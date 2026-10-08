import type { Route } from "next";
import Link from "next/link";
import { BookOpenTextIcon, DownloadIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LedgerEntry } from "@/server/finance/fee-reports";

import { rupees } from "./money";

/** A student's fee ledger: every entry in date order with the running balance. Shared by the office and parents. */
export function LedgerView({ ledger, back, csvHref }: { ledger: { session: { name: string }; student: { name: string; admissionNumber: string }; entries: LedgerEntry[]; totals: { debitMinor: number; creditMinor: number; balanceMinor: number } }; back: { href: string; label: string }; csvHref?: string }) {
  return (
    <>
      <PageHeader
        back={{ href: back.href as Route, label: back.label }}
        icon={BookOpenTextIcon}
        tone="green"
        title={`Fee ledger · ${ledger.student.name}`}
        description={`${ledger.student.admissionNumber} · ${ledger.session.name}. Charges add to the balance; concessions and payments take it down; a voided receipt adds back what it had taken off.`}
        actions={
          csvHref ? (
            <Button asChild variant="outline" size="sm">
              <Link href={csvHref as Route} prefetch={false}>
                <DownloadIcon className="size-4" aria-hidden />
                CSV
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {ledger.entries.length ? (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Entry</th>
                  <th className="px-3 py-2 text-right font-medium">Charged</th>
                  <th className="px-3 py-2 text-right font-medium">Paid / off</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ledger.entries.map((row, index) => (
                  <tr key={index} className={cn(row.kind === "VOID" && "text-danger-strong")}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDate(row.date)}</td>
                    <td className="px-3 py-2">
                      {row.description}
                      {row.receiptNo && row.kind === "PAYMENT" ? <span className="text-muted-foreground block text-xs">{`Receipt ${row.receiptNo}`}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.debitMinor ? rupees(row.debitMinor) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.creditMinor ? rupees(row.creditMinor) : ""}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{rupees(row.balanceMinor)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Balance due
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(ledger.totals.debitMinor)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(ledger.totals.creditMinor)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupees(Math.max(ledger.totals.balanceMinor, 0))}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-muted-foreground text-sm">No fees or payments this session.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
