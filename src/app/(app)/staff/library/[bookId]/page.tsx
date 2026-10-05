import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { BookCopiesCard } from "@/features/operations/book-copies";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";
import { bookCopies, listLoans } from "@/server/operations/library";
import { BookHistoryCard } from "@/features/operations/library-desk";
import { param } from "@/lib/search-params";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Book" };

/** One book for the librarian: its copies (report lost or damaged, put back in stock) and every loan it ever had. */
export default async function StaffBookPage(props: PageProps<"/staff/library/[bookId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "library.view");
  // Lost / damaged / back in stock is its own permission.
  const canManage = await staffHolds(ctx, "library.copies");
  const { bookId } = await props.params;
  const book = await orNotFound(
    ctx.db.book.findFirst({ where: { id: bookId }, select: { id: true, title: true, author: true } }).then((row) => {
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
      <PageHeader back={{ href: "/staff/library", label: "Library" }} title={book.title} description={book.author ?? undefined} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <BookCopiesCard copies={copies} canManage={canManage} historyHref={`/staff/library/${book.id}`} />
        <BookHistoryCard loans={history} copyCode={copy?.code} clearHref={`/staff/library/${book.id}`} />
      </div>
    </>
  );
}
