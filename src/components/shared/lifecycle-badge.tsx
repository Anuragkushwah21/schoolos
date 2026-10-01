import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import type { Lifecycle } from "@/lib/time-status";
import { cn } from "@/lib/utils";

/**
 * Where an event or meeting stands — Upcoming, Today, Completed or Cancelled —
 * worked out from its date (see `lifecycle` in `lib/time-status.ts`), with the
 * countdown beside an upcoming one: "14 days left", "Tomorrow".
 */
export function LifecycleBadge({ status, countdown, className }: { status: Lifecycle; countdown: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <TimeStatusBadge status={status} />
      {status === "UPCOMING" ? (
        <span className="bg-primary-soft text-primary-strong rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums">{countdown}</span>
      ) : null}
    </span>
  );
}

/** A calendar-page style date tile: "OCT / 15". */
export function DateTile({ date, tone = "blue", className }: { date: Date; tone?: "blue" | "cyan" | "neutral"; className?: string }) {
  const toneClass = tone === "cyan" ? "bg-info-soft text-info-strong" : tone === "neutral" ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary-strong";
  return (
    <span className={cn("flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2", toneClass, className)} aria-hidden>
      <span className="text-[11px] font-semibold uppercase">{new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(date)}</span>
      <span className="text-xl leading-tight font-bold tabular-nums">{date.getUTCDate()}</span>
    </span>
  );
}
