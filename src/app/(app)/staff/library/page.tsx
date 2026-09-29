import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { listBooks, listLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "Library" };

/** Read-only catalogue and open loans for staff granted VIEW_LIBRARY. */
export default async function StaffLibraryPage(props: PageProps<"/staff/library">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "VIEW_LIBRARY");
  const search = await props.searchParams;
  const q = param(search.q);
  const [books, loans] = await Promise.all([listBooks(ctx, { q }), listLoans(ctx, { view: "open" })]);

  return (
    <>
      <PageHeader title="Library" description="The catalogue and books currently out. Read-only — issuing and returns are done by the school office." />
      <FilterBar action="/staff/library" search={{ defaultValue: q, placeholder: "Title, author or ISBN" }} />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        {books.length ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Book</TableHead>
                  <TableHead>Shelf</TableHead>
                  <TableHead>Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {books.map((book) => (
                  <TableRow key={book.id}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <span className="font-medium">{book.title}</span>
                      <span className="text-muted-foreground block text-xs">{book.author ?? "—"}</span>
                    </TableCell>
                    <TableCell>{book.shelf ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {book.available} / {book.quantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No books match" />
        )}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>On loan</CardTitle>
          </CardHeader>
          <CardContent>
            {loans.length ? (
              <ul className="divide-y text-sm">
                {loans.map((loan) => (
                  <li key={loan.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      {loan.book.title}
                      <span className="text-muted-foreground block text-xs">
                        {loan.borrower.name} ({loan.borrower.kind}) · due {formatDate(loan.dueOn)}
                      </span>
                    </span>
                    {loan.overdue ? <StatusBadge status="OVERDUE" label="Overdue" tone="negative" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No books are out.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
