import { cn } from "@/lib/utils";

/**
 * The frame every chart sits in: a caption, an optional legend, and a table
 * view of the same numbers.
 *
 * The table is not a nicety. Some of the colours these charts use sit below
 * 3:1 against a white surface (a documented trade for keeping the reserved
 * status hues), and the rule for that is relief: visible labels plus a table.
 * It is also what makes every chart readable to a screen reader, in print, and
 * with colours forced off.
 */

export type LegendItem = { label: string; color: string; value?: string };

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.label} className="text-muted-foreground flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
          />
          {item.label}
          {item.value ? <span className="text-foreground font-medium">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function ChartFigure({
  title,
  subtitle,
  legend,
  table,
  className,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  legend?: LegendItem[];
  /** Header row and body rows of the same data the chart draws. */
  table?: { head: string[]; rows: Array<Array<string | number>> };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={cn("flex flex-col", className)}>
      <figcaption className="mb-4 flex flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        {subtitle ? <span className="text-muted-foreground text-sm">{subtitle}</span> : null}
      </figcaption>

      {children}

      {legend?.length ? <ChartLegend items={legend} /> : null}

      {table ? (
        <details className="group mt-3">
          <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs">
            Table view
          </summary>
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  {table.head.map((heading, index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-medium",
                        index === 0 ? "text-left" : "text-right",
                      )}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={String(row[0])} className="border-t">
                    {row.map((cell, index) => (
                      <td
                        key={index}
                        className={cn(
                          "px-3 py-1.5",
                          index === 0 ? "text-left" : "text-right tabular-nums",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

/** Shown in place of a chart when there is nothing yet to draw. */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground flex min-h-32 items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </p>
  );
}
