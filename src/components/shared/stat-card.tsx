import type { Route } from "next";
import Link from "next/link";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";

import { type AccentTone, TONE_BAR, TONE_ICON } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * A headline figure. With a `tone` and `icon` it becomes a colour-coded card
 * (see `tones.ts`); the label always says what the number is, so the colour
 * only helps — it never carries the meaning alone. With `href` the whole card
 * is a link and lifts slightly on hover.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
  className,
  tone,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: Route;
  className?: string;
  tone?: AccentTone;
  icon?: LucideIcon;
}) {
  const card = (
    <div
      className={cn(
        "bg-card relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)] sm:p-5",
        href && "group-hover/stat:border-primary/40 transition-[box-shadow,border-color,transform] group-hover/stat:-translate-y-0.5 group-hover/stat:shadow-md",
        className,
      )}
    >
      {tone ? <span className={cn("absolute inset-x-0 top-0 h-1", TONE_BAR[tone])} aria-hidden /> : null}
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm leading-snug font-medium">{label}</p>
        {Icon ? (
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_ICON[tone ?? "neutral"])}>
            <Icon className="size-5" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      {hint || href ? (
        <p className="text-muted-foreground mt-auto flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">{hint}</span>
          {href ? <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/stat:opacity-100" aria-hidden /> : null}
        </p>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="group/stat block h-full rounded-2xl">
      {card}
    </Link>
  ) : (
    card
  );
}
