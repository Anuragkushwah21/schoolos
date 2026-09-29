import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookForm } from "@/features/operations/forms";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/current-user";
import { listLoans } from "@/server/operations/library";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Book" };

export default async function BookPage(props: PageProps<"/school-admin/library/[bookId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { bookId } = await props.params;
  const book = await orNotFound(
    ctx.db.book.findFirst({ where: { id: bookId } }).then((row) => {
      if (!row) throw new NotFoundError();
      return row;
    }),
  );
  const history = await listLoans(ctx, { bookId: book.id });
  return (
    <>
      <PageHeader back={{ href: "/school-admin/library", label: "Library" }} title={book.title} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <BookForm book={book} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Borrowing history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length ? (
              <ul className="divide-y text-sm">
                {history.map((loan) => (
                  <li key={loan.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="flex-1">
                      {loan.borrower.name} <span className="text-muted-foreground text-xs">({loan.borrower.kind} {loan.borrower.code})</span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(loan.issuedOn)} → {loan.returnedOn ? formatDate(loan.returnedOn) : `due ${formatDate(loan.dueOn)}`}
                    </span>
                    {loan.overdue ? <StatusBadge status="OVERDUE" tone="negative" label="Overdue" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Never borrowed.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
