import type { Route } from "next";
import Link from "next/link";
import { BookCheckIcon, BookUpIcon, BookXIcon, LibraryIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { markFinePaidAction } from "@/features/operations/actions";
import { IssueBookForm, RenewLoanForm, ReturnBookForm } from "@/features/operations/forms";
import { addDays, formatDate, toDateInput, today } from "@/lib/dates";
import type { issuableBooks, libraryToday, listLoans } from "@/server/operations/library";

/**
 * The library desk, shared by the School Admin's pages and a librarian's:
 * today's numbers, the loans list with return / renew / fine controls, and
 * the issue form. `canManage` switches the controls on; the server checks the
 * same permission on every action regardless.
 */

export const LOAN_VIEWS = ["open", "overdue", "returned", "fines"] as const;
export type LoanView = (typeof LOAN_VIEWS)[number];

export function LibraryTodayPanel({
  today: stats,
  basePath,
  canManage,
  addBookHref,
}: {
  today: Awaited<ReturnType<typeof libraryToday>>;
  basePath: string;
  canManage: boolean;
  /** Where "+ Add book" goes; omitted where there is nowhere to add one. */
  addBookHref?: string;
}) {
  return (
    <section aria-labelledby="library-today" className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="library-today" className="text-base font-semibold">
          Today&apos;s library work
        </h2>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`${basePath}#issue` as Route}>+ Issue book</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`${basePath}?view=open` as Route}>Return book</Link>
            </Button>
            {addBookHref ? (
              <Button asChild size="sm" variant="outline">
                <Link href={addBookHref as Route}>+ Add book</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard tone="blue" icon={BookUpIcon} label="Issued today" value={stats.issuedToday} />
        <StatCard tone="green" icon={BookCheckIcon} label="Returned today" value={stats.returnedToday} />
        <StatCard tone="red" icon={BookXIcon} label="Overdue" value={stats.overdue} href={`${basePath}?view=overdue` as Route} />
        <StatCard tone="purple" icon={LibraryIcon} label="Copies on the shelf" value={stats.available} />
      </div>
    </section>
  );
}

const LOAN_STATUS = {
  ISSUED: { label: "Issued", tone: "info" },
  OVERDUE: { label: "Overdue", tone: "negative" },
  RETURNED: { label: "Returned", tone: "positive" },
} as const;

/** Issued books: student and class, book and copy, dates, status — and Return for the desk. */
export function LoansList({
  loans,
  canManage,
}: {
  loans: Awaited<ReturnType<typeof listLoans>>;
  canManage: boolean;
}) {
  const now = toDateInput(today());
  if (!loans.length) return <EmptyState title="Nothing here" />;
  return (
    <ul className="divide-y rounded-xl border">
      {loans.map((loan) => (
        <li key={loan.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{loan.book.title}</span>
            {loan.copyCode ? <span className="bg-muted ml-2 rounded px-1.5 py-0.5 font-mono text-xs">{loan.copyCode}</span> : null}
            <span className="block">
              {loan.borrower.name}
              <span className="text-muted-foreground"> · {loan.borrower.group ?? `${loan.borrower.kind} ${loan.borrower.code}`}</span>
            </span>
            <span className="text-muted-foreground block text-xs">
              Issued {formatDate(loan.issuedOn)} · Due {formatDate(loan.dueOn)}
              {loan.returnedOn ? ` · Returned ${formatDate(loan.returnedOn)}` : ""}
            </span>
          </span>
          <StatusBadge status={loan.status} tone={LOAN_STATUS[loan.status].tone} label={LOAN_STATUS[loan.status].label} />
          {loan.fineMinor ? (
            <StatusBadge status="FINE" tone={loan.finePaid ? "positive" : "warning"} label={`Fine ${rupees(loan.fineMinor)}${loan.finePaid ? " paid" : ""}`} />
          ) : null}
          {canManage && !loan.returnedOn ? (
            <>
              <ReturnBookForm issueId={loan.id} today={now} issuedOn={toDateInput(loan.issuedOn)} />
              <RenewLoanForm issueId={loan.id} currentDue={toDateInput(addDays(loan.dueOn, 1))} />
            </>
          ) : null}
          {canManage && loan.fineMinor && !loan.finePaid ? (
            <ActionButton action={markFinePaidAction} fields={{ issueId: loan.id }} variant="ghost" size="xs">
              Mark fine paid
            </ActionButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Filters, the loans list and — for someone who runs the desk — the issue form. */
export function LibraryDesk({
  basePath,
  view,
  q,
  loans,
  available,
  canManage,
  loanDays = 14,
}: {
  basePath: string;
  view: LoanView;
  q: string | undefined;
  loans: Awaited<ReturnType<typeof listLoans>>;
  /** Books with copies on the shelf, and those copies. */
  available: Awaited<ReturnType<typeof issuableBooks>>;
  canManage: boolean;
  /** The school's loan period, for the default due date. */
  loanDays?: number;
}) {
  return (
    <div className={canManage ? "grid gap-6 xl:grid-cols-[1.5fr_1fr]" : "flex flex-col gap-4"}>
      <div className="flex flex-col gap-4">
        <FilterBar
          action={basePath}
          search={{ defaultValue: q, placeholder: "Book, borrower name, admission no. or employee ID" }}
          selects={[
            {
              name: "view",
              label: "Show",
              defaultValue: view,
              options: [
                { value: "open", label: "Issued Books" },
                { value: "overdue", label: "Overdue" },
                { value: "returned", label: "Returned (history)" },
                { value: "fines", label: "Unpaid fines" },
              ],
            },
          ]}
        />
        <LoansList loans={loans} canManage={canManage} />
      </div>
      {canManage ? (
        <Card id="issue" className="h-fit scroll-mt-24">
          <CardHeader>
            <CardTitle>Issue Book</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueBookForm today={toDateInput(today())} defaultDue={toDateInput(addDays(today(), loanDays))} books={available} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
