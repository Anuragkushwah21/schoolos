import type { Route } from "next";
import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";

import { type AccentTone, TONE_ICON } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AttentionRow = { key: string; text: string; action: string; href: string; tone: AccentTone };

/**
 * Only what needs someone to act — "8 students absent today [View
 * attendance]" — each line with the one button that takes them there. When
 * nothing needs attention it says so plainly, which is itself useful to know.
 */
export function NeedsAttention({ title, rows, allClear }: { title: string; rows: AttentionRow[]; allClear: string }) {
  return (
    <section aria-labelledby="needs-attention" className="mb-8">
      <h2 id="needs-attention" className="mb-3 flex items-center gap-2 text-base font-semibold">
        {title}
        {rows.length ? <span className="bg-warning-soft text-warning-strong rounded-full px-2 text-xs font-semibold tabular-nums">{rows.length}</span> : null}
      </h2>
      {rows.length ? (
        <ul className="bg-card divide-y rounded-2xl border shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE_ICON[row.tone])} aria-hidden>
                <TriangleAlertIcon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1 font-medium">{row.text}</span>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={row.href as Route}>
                  {row.action}
                  <ArrowRightIcon aria-hidden />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bg-success-soft text-success-strong border-success/25 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium">
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
          {allClear}
        </p>
      )}
    </section>
  );
}
