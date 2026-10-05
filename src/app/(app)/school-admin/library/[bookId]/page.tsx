import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookCopiesCard } from "@/features/operations/book-copies";
import { BookForm } from "@/features/operations/forms";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/current-user";
import { bookCopies, listLoans } from "@/server/operations/library";
import { BookHistoryCard } from "@/features/operations/library-desk";
import { param } from "@/lib/search-params";
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
  const copies = await bookCopies(ctx, book.id);
  // "?copy=" narrows the history to one physical copy of this book.
  const copyParam = param((await props.searchParams).copy);
  const copy = copies.find((row) => row.id === copyParam) ?? null;
  const history = await listLoans(ctx, { bookId: book.id, ...(copy ? { copyId: copy.id } : {}), view: "all" });
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
        <BookCopiesCard copies={copies} canManage historyHref={`/school-admin/library/${book.id}`} />
        <div className="xl:col-span-2">
          <BookHistoryCard loans={history} copyCode={copy?.code} clearHref={`/school-admin/library/${book.id}`} />
        </div>
      </div>
    </>
  );
}
