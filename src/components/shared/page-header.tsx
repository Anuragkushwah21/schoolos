import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, type LucideIcon } from "lucide-react";

import { type AccentTone, TONE_SOLID } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * The top of every page: an optional way back, the title (with the area's
 * icon and colour, so Notices and Meetings, say, never look alike), a short
 * line about what the page is for, and its one or two actions — the primary
 * action last, where the eye ends.
 *
 * `variant="hero"` turns it into the coloured welcome banner at the top of
 * each role's home page.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  icon: Icon,
  tone = "blue",
  variant = "default",
}: {
  title: string;
  description?: React.ReactNode;
  /** Buttons aligned to the right of the title. */
  actions?: React.ReactNode;
  /** A link to the parent page, shown above the title. */
  back?: { href: Route; label: string };
  /** The area's icon, shown in its colour beside the title. */
  icon?: LucideIcon;
  tone?: AccentTone;
  variant?: "default" | "hero";
}) {
  if (variant === "hero") {
    return (
      <div className="bg-brand-gradient relative isolate mb-6 overflow-hidden rounded-3xl px-5 py-6 text-white shadow-[0_20px_40px_-24px_var(--primary)] sm:px-8 sm:py-8">
        <span className="bg-dots absolute inset-0 -z-10" aria-hidden />
        <span className="absolute -top-24 -right-16 -z-10 size-72 rounded-full bg-white/15 blur-3xl" aria-hidden />
        <span className="absolute -bottom-28 left-1/3 -z-10 size-64 rounded-full bg-[var(--brand-to)]/40 blur-3xl" aria-hidden />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
            {description ? <p className="max-w-3xl text-sm text-white/85 sm:text-base">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 [&_[data-slot=button]]:border-white/30 [&_[data-slot=button]]:bg-white/15 [&_[data-slot=button]]:text-white [&_[data-slot=button]]:backdrop-blur [&_[data-slot=button]:hover]:bg-white/25">{actions}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground inline-flex min-h-8 w-fit items-center gap-1 text-sm"
        >
          <ChevronLeftIcon className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className={cn("hidden size-12 shrink-0 items-center justify-center rounded-2xl sm:flex", TONE_SOLID[tone])}>
              <Icon className="size-[22px]" aria-hidden />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-[1.7rem]">{title}</h1>
            {description ? <p className="text-muted-foreground max-w-3xl text-sm">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
