import { LibraryIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookForm } from "@/features/operations/forms";
import { LibraryDesk, LibraryTodayPanel, LOAN_VIEWS } from "@/features/operations/library-desk";
import { enumParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffPermissions } from "@/server/auth/staff-access";
import { issuableBooks, libraryRules, libraryToday, listBooks, listLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "Library" };

/**
 * The library for staff. With "Run the library" this is the librarian's desk:
 * today's work, issue / return / renew, history, and the catalogue with
 * add and edit. With "View library" only, the same page is read-only. Every
 * action is checked again on the server, whatever this page shows.
 */
export default async function StaffLibraryPage(props: PageProps<"/staff/library">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["VIEW_LIBRARY", "MANAGE_LIBRARY"]);
  const canManage = (await staffPermissions(ctx)).includes("MANAGE_LIBRARY");
  const search = await props.searchParams;
  const view = enumParam(search.view, LOAN_VIEWS) ?? "open";
  const q = param(search.q);
  const bookQ = param(search.book);

  const [stats, loans, available, books, rules] = await Promise.all([
    libraryToday(ctx),
    listLoans(ctx, { view, q }),
    canManage ? issuableBooks(ctx) : Promise.resolve([]),
    listBooks(ctx, { q: bookQ }),
    libraryRules(ctx),
  ]);

  return (
    <>
      <PageHeader
        icon={LibraryIcon}
        tone="purple"
        title="Library"
        description={
          canManage
            ? "Issue, return and renew books, and keep the catalogue up to date."
            : "The catalogue and books out. Read-only — issuing and returns are done by the librarian."
        }
      />

      <LibraryTodayPanel today={stats} basePath="/staff/library" canManage={canManage} addBookHref="/staff/library#add-book" />
      <LibraryDesk basePath="/staff/library" view={view} q={q} loans={loans} available={available} canManage={canManage} loanDays={rules.loanDays} />

      <section aria-labelledby="catalogue" className="mt-8 flex flex-col gap-4">
        <h2 id="catalogue" className="text-base font-semibold">
          Books
        </h2>
        <FilterBar action="/staff/library" search={{ name: "book", defaultValue: bookQ, placeholder: "Title, author or ISBN" }} hidden={{ view, q }} />
        <div className={canManage ? "grid gap-6 xl:grid-cols-[1.5fr_1fr]" : ""}>
          {books.length ? (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Book</TableHead>
                    <TableHead className="hidden sm:table-cell">Shelf</TableHead>
                    <TableHead>Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {books.map((book) => (
                    <TableRow key={book.id}>
                      <TableCell className="max-w-xs whitespace-normal">
                        <span className="font-medium">{book.title}</span>
                        {book.isActive ? null : <StatusBadge status="INACTIVE" label="Not lent" className="ml-2" />}
                        <span className="text-muted-foreground block text-xs">
                          {[book.author, book.category, book.isbn].filter(Boolean).join(" · ") || "—"}
                        </span>
                        {canManage ? (
                          <details className="mt-2 text-sm">
                            <summary className="text-muted-foreground cursor-pointer text-xs">Edit book</summary>
                            <div className="mt-3">
                              <BookForm book={book} />
                            </div>
                          </details>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{book.shelf ?? "—"}</TableCell>
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
          {canManage ? (
            <Card id="add-book" className="h-fit scroll-mt-24">
              <CardHeader>
                <CardTitle>+ Add book</CardTitle>
              </CardHeader>
              <CardContent>
                <BookForm />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </>
  );
}
