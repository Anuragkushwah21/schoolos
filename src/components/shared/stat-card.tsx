import type { Route } from "next";
import Link from "next/link";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
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
        "bg-card shadow-card relative isolate flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 p-4 sm:p-5",
        href && "group-hover/stat:border-primary/40 group-hover/stat:shadow-lift transition-[box-shadow,border-color,transform] group-hover/stat:-translate-y-0.5",
        className,
      )}
    >
      {tone ? <span className={cn("absolute -top-10 -right-10 -z-10 size-32 rounded-full blur-2xl", TONE_GLOW[tone])} aria-hidden /> : null}
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm leading-snug font-medium">{label}</p>
        {Icon ? (
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_SOLID[tone ?? "neutral"])}>
            <Icon className="size-5" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl">{value}</p>
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
