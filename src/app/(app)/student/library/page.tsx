import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { rupees } from "@/features/finance/money";
import { formatDate } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { myLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "My Library" };

/** The student's own library books — nobody else's. */
export default async function StudentLibraryPage() {
  const ctx = await requireTenant("STUDENT");
  const loans = await myLoans(ctx);
  return (
    <>
      <PageHeader title="My Library" description="Books you have borrowed." />
      {loans.length ? (
        <ul className="divide-y rounded-xl border">
          {loans.map((loan) => (
            <li key={loan.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{loan.book.title}</span>
                {loan.copyCode ? <span className="bg-muted ml-2 rounded px-1.5 py-0.5 font-mono text-xs">{loan.copyCode}</span> : null}
                <span className="text-muted-foreground block text-xs">
                  Issued {formatDate(loan.issuedOn)} · due {formatDate(loan.dueOn)}
                  {loan.returnedOn ? ` · returned ${formatDate(loan.returnedOn)}` : ""}
                </span>
              </span>
              {loan.overdue ? <StatusBadge status="OVERDUE" tone="negative" label="Overdue — please return" /> : loan.returnedOn ? <StatusBadge status="RETURNED" tone="neutral" label="Returned" /> : <StatusBadge status="ON_LOAN" tone="info" label="Issued" />}
              {loan.fineMinor ? <StatusBadge status="FINE" tone={loan.finePaid ? "positive" : "warning"} label={`Fine ${rupees(loan.fineMinor)}${loan.finePaid ? " paid" : ""}`} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No library books yet" />
      )}
    </>
  );
}
