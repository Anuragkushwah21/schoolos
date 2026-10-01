import { LibraryIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importBooksAction } from "@/features/operations/actions";
import { BookForm, LibraryRulesForm } from "@/features/operations/forms";
import { CsvImportForm } from "@/features/operations/import-form";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { bookCategories, libraryRules, listBooks, listLoans } from "@/server/operations/library";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage(props: PageProps<"/school-admin/library">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filters = { q: param(search.q), category: param(search.category), availableOnly: param(search.available) === "1" };
  const [books, categories, overdue, fines, rules] = await Promise.all([
    listBooks(ctx, filters),
    bookCategories(ctx),
    listLoans(ctx, { view: "overdue" }),
    listLoans(ctx, { view: "fines" }),
    libraryRules(ctx),
  ]);
  const copies = books.reduce((sum, book) => sum + book.quantity, 0);
  const onLoan = books.reduce((sum, book) => sum + book.onLoan, 0);

  return (
    <>
      <PageHeader icon={LibraryIcon} tone="blue"
        title="Library"
        description="Titles and copies. Copies available are counted from open loans."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/reports/export?kind=books" prefetch={false}>
                Export CSV
              </Link>
            </Button>
            <Button asChild>
              <Link href={"/school-admin/library/loans" as Route}>Issue &amp; return</Link>
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Titles" value={books.length} />
        <StatCard label="Copies on loan" value={`${onLoan}/${copies}`} />
        <StatCard label="Overdue" value={overdue.length} href={"/school-admin/library/loans?view=overdue" as Route} />
        <StatCard label="Unpaid fines" value={fines.length} href={"/school-admin/library/loans?view=fines" as Route} />
      </div>
      <FilterBar
        action="/school-admin/library"
        search={{ defaultValue: filters.q, placeholder: "Title, author or ISBN" }}
        selects={[
          { name: "category", label: "Category", defaultValue: filters.category, allLabel: "Any category", options: categories.map((value) => ({ value, label: value })) },
          { name: "available", label: "Availability", defaultValue: filters.availableOnly ? "1" : undefined, allLabel: "All titles", options: [{ value: "1", label: "With a free copy" }] },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>
          {books.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Shelf</th>
                    <th className="px-3 py-2 text-right font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((book) => (
                    <tr key={book.id} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={`/school-admin/library/${book.id}` as Route} className="font-medium hover:underline">
                          {book.title}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {[book.author, book.isbn].filter(Boolean).join(" · ")}
                          {!book.isActive ? " · withdrawn" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2">{book.category ?? "—"}</td>
                      <td className="px-3 py-2">{book.shelf ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {book.available}/{book.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No books found.">Add books with the form on this page, or import your catalogue from a spreadsheet.</EmptyState>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Add a book</CardTitle>
            </CardHeader>
            <CardContent>
              <BookForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Library rules</CardTitle>
              <CardDescription>The default due date, how many books one borrower may hold, and the late fine.</CardDescription>
            </CardHeader>
            <CardContent>
              <LibraryRulesForm rules={rules} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Import or update stock from CSV</CardTitle>
              <CardDescription>
                <Link href="/school-admin/reports/export?kind=template-books" prefetch={false} className="underline">
                  Template
                </Link>
                . A row whose ISBN you already have updates its copies; others are added.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImportForm action={importBooksAction} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
