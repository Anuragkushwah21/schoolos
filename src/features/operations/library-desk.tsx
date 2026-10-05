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
import { addDays, formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { LOAN_VIEW_KEYS, type LoanViewKey, type issuableBooks, type libraryToday, type listLoans } from "@/server/operations/library";

/**
 * The library desk, shared by the School Admin's pages and a librarian's:
 * today's numbers, the loans list with return / renew / fine controls, and
 * the issue form. `canManage` switches the controls on; the server checks the
 * same permission on every action regardless.
 */

export const LOAN_VIEWS = LOAN_VIEW_KEYS;
export type LoanView = LoanViewKey;

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
  LOST: { label: "Lost", tone: "negative" },
  DAMAGED: { label: "Damaged", tone: "warning" },
} as const;

/**
 * Loans as a history: book and copy, borrower with admission no. and class
 * (as on the day of issue), when it went out and came back and who handled
 * each, status and fine — and Return / Renew for the desk on books still out.
 */
export function LoansList({
  loans,
  canManage,
  canFines = canManage,
  showBook = true,
}: {
  loans: Awaited<ReturnType<typeof listLoans>>;
  /** Return and renew. */
  canManage: boolean;
  /** Mark fines paid; defaults to `canManage`. */
  canFines?: boolean;
  /** Off on a book's own page, where every row is the same book. */
  showBook?: boolean;
}) {
  const now = toDateInput(today());
  if (!loans.length) return <EmptyState title="Nothing here" />;
  return (
    <ul className="divide-y rounded-xl border">
      {loans.map((loan) => {
        const ended = loan.lostOn ?? loan.damagedOn ?? loan.returnedOn;
        const endedLabel = loan.lostOn ? "Reported lost" : loan.damagedOn ? "Returned damaged" : "Returned";
        return (
          <li key={loan.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1">
              {showBook ? <span className="font-medium">{loan.book.title}</span> : null}
              {loan.copyCode ? <span className={`bg-muted rounded px-1.5 py-0.5 font-mono text-xs ${showBook ? "ml-2" : ""}`}>{loan.copyCode}</span> : null}
              <span className="block">
                {loan.borrower.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {loan.borrower.code}
                  {loan.borrower.group ? ` · ${loan.borrower.group}` : loan.borrower.kind !== "Student" ? ` · ${loan.borrower.kind}` : ""}
                </span>
              </span>
              <span className="text-muted-foreground block text-xs">
                Issued {formatDate(loan.issuedOn)} <span className="tabular-nums">({formatDateTime(loan.createdAt)})</span>
                {loan.issuedByName ? ` by ${loan.issuedByName}` : ""} · Due {formatDate(loan.dueOn)}
              </span>
              {ended ? (
                <span className="text-muted-foreground block text-xs">
                  {endedLabel} {formatDate(ended)}
                  {loan.returnedAt ? <span className="tabular-nums"> ({formatDateTime(loan.returnedAt)})</span> : null}
                  {loan.returnedByName ? ` by ${loan.returnedByName}` : ""}
                </span>
              ) : null}
            </span>
            <StatusBadge status={loan.status} tone={LOAN_STATUS[loan.status].tone} label={LOAN_STATUS[loan.status].label} />
            {loan.fineMinor ? (
              <StatusBadge status="FINE" tone={loan.finePaid ? "positive" : "warning"} label={`${loan.lostOn || loan.damagedOn ? "Charge" : "Fine"} ${rupees(loan.fineMinor)}${loan.finePaid ? " paid" : ""}`} />
            ) : null}
            {canManage && !loan.returnedOn ? (
              <>
                <ReturnBookForm issueId={loan.id} today={now} issuedOn={toDateInput(loan.issuedOn)} />
                <RenewLoanForm issueId={loan.id} currentDue={toDateInput(addDays(loan.dueOn, 1))} />
              </>
            ) : null}
            {canFines && loan.fineMinor && !loan.finePaid ? (
              <ActionButton action={markFinePaidAction} fields={{ issueId: loan.id }} variant="ghost" size="xs">
                Mark fine paid
              </ActionButton>
            ) : null}
          </li>
        );
      })}
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
  canFines = canManage,
  loanDays = 14,
}: {
  canFines?: boolean;
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
          search={{ defaultValue: q, placeholder: "Student, admission no., book or copy ID (BK-…)" }}
          selects={[
            {
              name: "view",
              label: "Show",
              defaultValue: view,
              options: [
                { value: "open", label: "Issued (still out)" },
                { value: "overdue", label: "Overdue" },
                { value: "returned", label: "Returned" },
                { value: "lost", label: "Lost" },
                { value: "damaged", label: "Damaged" },
                { value: "fines", label: "Unpaid fines" },
                { value: "all", label: "All issue history" },
              ],
            },
          ]}
        />
        <LoansList loans={loans} canManage={canManage} canFines={canFines} />
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

/** A book's (or one copy's) complete borrowing history, newest first. */
export function BookHistoryCard({
  loans,
  copyCode,
  clearHref,
}: {
  loans: Awaited<ReturnType<typeof listLoans>>;
  /** Set when the history is narrowed to one copy. */
  copyCode?: string | null;
  /** The book's page without the copy filter. */
  clearHref: string;
}) {
  return (
    <Card id="history" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{copyCode ? `Borrowing history · copy ${copyCode}` : "Borrowing history"}</CardTitle>
        <p className="text-muted-foreground text-sm">
          Every issue of {copyCode ? "this copy" : "this book"}, returned or not — kept permanently.{" "}
          {copyCode ? (
            <Link href={`${clearHref}#history` as Route} className="underline">
              Show all copies
            </Link>
          ) : null}
        </p>
      </CardHeader>
      <CardContent>
        {loans.length ? <LoansList loans={loans} canManage={false} showBook={false} /> : <p className="text-muted-foreground text-sm">Never borrowed.</p>}
      </CardContent>
    </Card>
  );
}
