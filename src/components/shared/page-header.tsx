import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, type LucideIcon } from "lucide-react";

import { type AccentTone, TONE_ICON } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * The top of every page: an optional way back, the title (with the area's
 * icon and colour, so Notices and Meetings, say, never look alike), a short
 * line about what the page is for, and its one or two actions — the primary
 * action last, where the eye ends.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  icon: Icon,
  tone = "blue",
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
}) {
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
            <span className={cn("hidden size-11 shrink-0 items-center justify-center rounded-xl sm:flex", TONE_ICON[tone])}>
              <Icon className="size-[22px]" aria-hidden />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground max-w-3xl text-sm">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
