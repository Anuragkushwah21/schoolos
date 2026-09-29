import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markFinePaidAction } from "@/features/operations/actions";
import { IssueBookForm, ReturnBookForm } from "@/features/operations/forms";
import { rupees } from "@/features/finance/money";
import { addDays, formatDate, today, toDateInput } from "@/lib/dates";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listBooks, listLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "Loans" };

const VIEWS = ["open", "overdue", "returned", "fines"] as const;

export default async function LoansPage(props: PageProps<"/school-admin/library/loans">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const view = enumParam(search.view, VIEWS) ?? "open";
  const q = param(search.q);
  const [loans, available] = await Promise.all([listLoans(ctx, { view, q }), listBooks(ctx, { availableOnly: true })]);
  const now = toDateInput(today());

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/library", label: "Library" }}
        title="Issue & return"
        actions={
          <Button asChild variant="outline">
            <Link href={`/school-admin/reports/export?kind=${view === "fines" ? "loans-fines" : "loans-overdue"}`} prefetch={false}>
              Export {view === "fines" ? "fines" : "overdue"} CSV
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-4">
          <FilterBar
            action="/school-admin/library/loans"
            search={{ defaultValue: q, placeholder: "Book, borrower name, admission no. or employee ID" }}
            selects={[{ name: "view", label: "Show", defaultValue: view, options: [
              { value: "open", label: "On loan" },
              { value: "overdue", label: "Overdue" },
              { value: "returned", label: "Returned" },
              { value: "fines", label: "Unpaid fines" },
            ] }]}
          />
          {loans.length ? (
            <ul className="divide-y rounded-xl border">
              {loans.map((loan) => (
                <li key={loan.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{loan.book.title}</span>
                    <span className="text-muted-foreground block text-xs">
                      {loan.borrower.name} ({loan.borrower.kind} {loan.borrower.code}) · issued {formatDate(loan.issuedOn)} · due {formatDate(loan.dueOn)}
                      {loan.returnedOn ? ` · returned ${formatDate(loan.returnedOn)}` : ""}
                    </span>
                  </span>
                  {loan.overdue ? <StatusBadge status="OVERDUE" tone="negative" label="Overdue" /> : null}
                  {loan.fineMinor ? <StatusBadge status="FINE" tone={loan.finePaid ? "positive" : "warning"} label={`Fine ${rupees(loan.fineMinor)}${loan.finePaid ? " paid" : ""}`} /> : null}
                  {!loan.returnedOn ? <ReturnBookForm issueId={loan.id} today={now} issuedOn={toDateInput(loan.issuedOn)} /> : null}
                  {loan.fineMinor && !loan.finePaid ? (
                    <ActionButton action={markFinePaidAction} fields={{ issueId: loan.id }} variant="ghost" size="xs">
                      Mark fine paid
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing here" />
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Issue a book</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueBookForm
              today={now}
              defaultDue={toDateInput(addDays(today(), 14))}
              books={available.map((book) => ({ value: book.id, label: `${book.title} (${book.available} free)` }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
