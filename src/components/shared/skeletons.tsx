import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholders shaped like the thing that is coming.
 *
 * A skeleton is worth more than a spinner when the page has a known layout: it
 * keeps the header and the sidebar usable, holds the space so nothing jumps when
 * the data lands, and tells the reader what kind of thing to expect.
 *
 * These are rendered by `loading.tsx` files, so Next shows them while the page's
 * own awaits are still running. Nothing here is timed or faked — the skeleton is
 * on screen for exactly as long as the real work takes.
 */

/** A row of stat cards, as nearly every dashboard opens with. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="h-full">
          <CardHeader className="pb-0">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** A card with a few lines of list inside it. */
export function ListCardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-4 w-20 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A table, header row included. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="bg-muted/40 flex gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 border-b px-4 py-3 last:border-b-0">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A chart's block of space, so the page does not reflow when one arrives. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-48 w-full" />
      </CardContent>
    </Card>
  );
}

/** The page title and its description. */
export function PageHeaderSkeleton({ withActions = true }: { withActions?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {withActions ? <Skeleton className="h-9 w-28" /> : null}
    </div>
  );
}

/**
 * The shape almost every dashboard in this app has: a header, a row of stats,
 * then two columns of cards.
 */
export function DashboardSkeleton({ stats = 4 }: { stats?: number }) {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={stats} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <ListCardSkeleton rows={5} />
          <ChartSkeleton />
        </div>
        <div className="flex flex-col gap-6">
          <ListCardSkeleton rows={3} />
          <ListCardSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}

/** A header, then a table — the shape of every list screen. */
export function ListPageSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-20" />
      </div>
      <TableSkeleton columns={columns} />
    </div>
  );
}

/** A header, then a card of form fields — every "new" and "edit" screen. */
export function FormPageSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton withActions={false} />
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-5 pt-6">
          {Array.from({ length: fields }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}

/** A header, then two columns of cards — a record and what hangs off it. */
export function DetailPageSkeleton() {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton />
      <div className="grid gap-6 xl:grid-cols-2">
        <ListCardSkeleton rows={5} />
        <ListCardSkeleton rows={5} />
      </div>
    </div>
  );
}

/** A printable sheet (receipt, report card) on its grey page, with the toolbar above. */
export function PrintSheetSkeleton() {
  return (
    <main aria-busy="true" className="min-h-screen bg-neutral-100 px-4 py-6 sm:py-10">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="mx-auto flex max-w-[210mm] flex-col gap-4 bg-white p-8 shadow-sm ring-1 ring-neutral-200 sm:p-10">
        <div className="flex gap-4">
          <Skeleton className="size-16" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="mx-auto h-5 w-40" />
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-3/4" />
          ))}
        </div>
        <TableSkeleton rows={5} columns={3} />
      </div>
    </main>
  );
}

/** Content blocks for public pages (the school website, the marketing site). */
export function PublicPageSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A centred card, as the sign-in and verification screens are. */
export function AuthCardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-1 items-center justify-center px-5 py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 pt-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
