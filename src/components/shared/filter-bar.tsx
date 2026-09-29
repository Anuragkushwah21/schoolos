import Link from "next/link";
import type { Route } from "next";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeSelectClass } from "@/components/forms/styles";
import { getT } from "@/server/i18n";

type FilterSelect = {
  name: string;
  label: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
  /** Label for the "no filter" option. Omit to force a choice. */
  allLabel?: string;
  /** Rarely used: tucked under "More filters". */
  advanced?: boolean;
};

/**
 * A GET form for list filters. Filters live in the URL, so a filtered list can
 * be bookmarked, shared and navigated back to — and the page stays a Server
 * Component with no client state.
 *
 * On a list with a search box, only the search is shown by default; the
 * dropdowns fold behind a "Filters" button (a native `<details>`, so it works
 * without JavaScript) that says how many are active, and opens by itself when
 * any are. Bars without a search box are pickers (choose a section and a
 * date) and stay fully visible.
 */
export async function FilterBar({
  action,
  search,
  selects = [],
  hidden = {},
  dates = [],
}: {
  action: string;
  search?: { name?: string; defaultValue?: string; placeholder: string };
  selects?: FilterSelect[];
  hidden?: Record<string, string | undefined>;
  dates?: Array<{ name: string; label: string; defaultValue?: string; max?: string }>;
}) {
  const t = await getT();
  const collapsible = Boolean(search) && selects.length > 0 && dates.length === 0;
  const activeCount = selects.filter((select) => select.defaultValue && select.allLabel !== undefined).length;
  const basic = selects.filter((select) => !select.advanced);
  const advanced = selects.filter((select) => select.advanced);
  const anyActive = activeCount > 0 || Boolean(search?.defaultValue);

  const selectEl = (select: FilterSelect) => (
    <label key={select.name} className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground font-medium">{select.label}</span>
      <select name={select.name} defaultValue={select.defaultValue ?? ""} className={`${nativeSelectClass} w-full min-w-40 sm:w-auto`}>
        {select.allLabel !== undefined ? <option value="">{select.allLabel}</option> : null}
        {select.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form method="get" action={action} className="mb-5 flex flex-col gap-3">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <div className="flex flex-wrap items-end gap-2">
        {search ? (
          <div className="relative w-full sm:w-72">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input
              type="search"
              name={search.name ?? "q"}
              defaultValue={search.defaultValue}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="pl-9"
            />
          </div>
        ) : null}
        {collapsible ? null : selects.map(selectEl)}
        {dates.map((date) => (
          <label key={date.name} className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">{date.label}</span>
            <Input type="date" name={date.name} defaultValue={date.defaultValue} max={date.max} className="w-auto" />
          </label>
        ))}
        <Button type="submit" variant={collapsible ? "default" : "secondary"}>
          {search ? t("common.search") : t("filters.apply")}
        </Button>
        {collapsible && anyActive ? (
          <Button asChild variant="ghost">
            <Link href={action as Route}>
              <XIcon aria-hidden />
              {t("filters.clear")}
            </Link>
          </Button>
        ) : null}
      </div>

      {collapsible ? (
        <details open={activeCount > 0} className="group rounded-xl border bg-card open:p-4 open:shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
          <summary className="text-muted-foreground hover:text-foreground flex min-h-10 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium group-open:mb-3 group-open:px-0 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontalIcon className="size-4" aria-hidden />
            {activeCount ? t("filters.active", { count: activeCount }) : t("filters.button")}
          </summary>
          <div className="flex flex-wrap items-end gap-3">
            {basic.map(selectEl)}
            <Button type="submit" variant="secondary">
              {t("filters.apply")}
            </Button>
          </div>
          {advanced.length ? (
            <details open={advanced.some((select) => select.defaultValue)} className="mt-4">
              <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-sm">{t("filters.more")}</summary>
              <div className="mt-3 flex flex-wrap items-end gap-3">{advanced.map(selectEl)}</div>
            </details>
          ) : null}
        </details>
      ) : null}
    </form>
  );
}
