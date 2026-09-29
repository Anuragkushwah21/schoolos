import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { type AccentTone, TONE_ICON } from "@/components/shared/tones";
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
              className="bg-card hover:border-primary/40 flex h-full min-h-24 flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-sm font-semibold shadow-[0_1px_3px_rgb(15_23_42/0.06)] transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className={cn("flex size-10 items-center justify-center rounded-xl", TONE_ICON[tone])}>
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
