import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * The few things this person does most, as large labelled buttons. Each has an
 * icon in its area's colour and words — never an icon alone — and is big
 * enough to tap.
 */
export function QuickActions({
  title,
  actions,
  compact = false,
}: {
  title: string;
  actions: Array<{ href: Route; label: string; icon: LucideIcon; tone?: AccentTone }>;
  /** Smaller tiles, icon over label, in one card — for a busy home page. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <section aria-label={title} className="bg-card shadow-card mb-8 rounded-2xl border border-border/70 p-4">
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        <ul className={cn("grid grid-cols-4 gap-2", actions.length > 8 ? "sm:grid-cols-5 xl:grid-cols-10" : "sm:grid-cols-4 lg:grid-cols-8")}>
          {actions.map(({ href, label, icon: Icon, tone = "blue" }) => (
            <li key={href}>
              <Link
                href={href}
                className="group/qa hover:bg-muted/60 flex h-full flex-col items-center gap-2 rounded-xl px-1 py-2.5 text-center text-xs leading-tight font-medium transition-colors"
              >
                <span className={cn("flex size-11 items-center justify-center rounded-2xl transition-transform group-hover/qa:-translate-y-0.5", TONE_SOLID[tone])}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section aria-label={title} className="mb-8">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {actions.map(({ href, label, icon: Icon, tone = "blue" }) => (
          <li key={href}>
            <Link
              href={href}
              className="group/qa bg-card shadow-card hover:border-primary/40 hover:shadow-lift relative isolate flex h-full min-h-24 flex-col items-start justify-between gap-3 overflow-hidden rounded-2xl border border-border/70 p-4 text-sm font-semibold transition-[box-shadow,border-color,transform] hover:-translate-y-0.5"
            >
              <span className={cn("absolute -right-8 -bottom-8 -z-10 size-24 rounded-full opacity-0 blur-2xl transition-opacity group-hover/qa:opacity-100", TONE_GLOW[tone])} aria-hidden />
              <span className={cn("flex size-10 items-center justify-center rounded-xl transition-transform group-hover/qa:scale-105", TONE_SOLID[tone])}>
                <Icon className="size-5" aria-hidden />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
