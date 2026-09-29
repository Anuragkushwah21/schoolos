import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getT } from "@/server/i18n";

/**
 * Previous/next links for a paginated list. Keeps every other query parameter,
 * so filters survive paging.
 */
export async function Pager({
  page,
  pageCount,
  total,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: Route;
  params: Record<string, string | undefined>;
}) {
  const t = await getT();
  if (pageCount <= 1) {
    return <p className="text-muted-foreground mt-4 text-sm">{t("common.total", { count: total })}</p>;
  }

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    search.set("page", String(target));
    // A query string on a known route. Typed routes cover the path, not the
    // search params, so the join is asserted rather than inferred.
    return `${basePath}?${search.toString()}` as Route;
  };

  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-4">
      <p className="text-muted-foreground text-sm">
        {t("common.page", { page, pages: pageCount })} · {t("common.total", { count: total })}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>
              <ChevronLeftIcon aria-hidden /> {t("common.previous")}
            </Link>
          </Button>
        ) : null}
        {page < pageCount ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>
              {t("common.next")} <ChevronRightIcon aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
