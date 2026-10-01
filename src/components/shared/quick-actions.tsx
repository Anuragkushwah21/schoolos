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
}: {
  title: string;
  actions: Array<{ href: Route; label: string; icon: LucideIcon; tone?: AccentTone }>;
}) {
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
