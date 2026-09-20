import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeSelectClass } from "@/components/forms/styles";

/**
 * A GET form for list filters. Filters live in the URL, so a filtered list can
 * be bookmarked, shared and navigated back to — and the page stays a Server
 * Component with no client state.
 */
export function FilterBar({
  action,
  search,
  selects = [],
  hidden = {},
  dates = [],
}: {
  action: string;
  search?: { name?: string; defaultValue?: string; placeholder: string };
  selects?: Array<{
    name: string;
    label: string;
    defaultValue?: string;
    options: Array<{ value: string; label: string }>;
    /** Label for the "no filter" option. Omit to force a choice. */
    allLabel?: string;
  }>;
  hidden?: Record<string, string | undefined>;
  dates?: Array<{ name: string; label: string; defaultValue?: string; max?: string }>;
}) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      {search ? (
        <Input
          type="search"
          name={search.name ?? "q"}
          defaultValue={search.defaultValue}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          className="w-full sm:w-64"
        />
      ) : null}
      {selects.map((select) => (
        <select
          key={select.name}
          name={select.name}
          defaultValue={select.defaultValue ?? ""}
          aria-label={select.label}
          className={`${nativeSelectClass} w-auto min-w-36`}
        >
          {select.allLabel !== undefined ? <option value="">{select.allLabel}</option> : null}
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}
      {dates.map((date) => (
        <label key={date.name} className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{date.label}</span>
          <Input type="date" name={date.name} defaultValue={date.defaultValue} max={date.max} className="w-auto" />
        </label>
      ))}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
