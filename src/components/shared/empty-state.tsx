import { InboxIcon, type LucideIcon } from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * What a page says when there is nothing to show yet: a friendly line, an
 * optional explanation, and — wherever someone can fix it — the one button
 * that does ("No students added yet." [Add student]).
 */
export function EmptyState({
  title,
  children,
  action,
  icon: Icon = InboxIcon,
  tone = "blue",
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
  tone?: AccentTone;
}) {
  return (
    <div className="bg-card/70 relative isolate flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-dashed px-6 py-12 text-center">
      <span className={cn("absolute top-0 left-1/2 -z-10 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl", TONE_GLOW[tone])} aria-hidden />
      <span className={cn("flex size-12 items-center justify-center rounded-2xl", TONE_SOLID[tone])}>
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {children ? <p className="text-muted-foreground max-w-md text-sm">{children}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
