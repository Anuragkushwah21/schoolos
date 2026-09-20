import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Previous/next links for a paginated list. Keeps every other query parameter,
 * so filters survive paging.
 */
export function Pager({
  page,
  pageCount,
  total,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) {
    return <p className="text-muted-foreground mt-4 text-sm">{total} total</p>;
  }

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };

  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-4">
      <p className="text-muted-foreground text-sm">
        Page {page} of {pageCount} · {total} total
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>
              <ChevronLeftIcon /> Previous
            </Link>
          </Button>
        ) : null}
        {page < pageCount ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>
              Next <ChevronRightIcon />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
