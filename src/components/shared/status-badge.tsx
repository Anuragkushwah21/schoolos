import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A coloured pill for an enum status. Tone is chosen by meaning, so every
 * "good" state reads green and every "stopped" state reads red app-wide.
 */
const TONES = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-red-500/10 text-red-700 dark:text-red-400",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  // schools
  ACTIVE: "positive",
  PENDING: "warning",
  UNDER_REVIEW: "info",
  REJECTED: "negative",
  SUSPENDED: "negative",
  INACTIVE: "neutral",
  // subscriptions
  TRIALING: "info",
  PAST_DUE: "warning",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  // attendance
  PRESENT: "positive",
  ABSENT: "negative",
  LATE: "warning",
  EXCUSED: "info",
  ON_LEAVE: "info",
  // class records — COMPLETED is shared with enrollments above, where neutral
  // is right; a finished lesson is not an achievement either.
  SUBSTITUTE: "info",
  REMOTE: "info",
  MISSED: "negative",
  SCHEDULED: "neutral",
  // admissions
  SUBMITTED: "warning",
  ACCEPTED: "positive",
  WAITLISTED: "info",
  // notices
  PUBLISHED: "positive",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
  // teacher remarks — the three bands read as a traffic light, so a parent
  // scanning a year of them sees the shape without reading every word.
  GOOD: "positive",
  NEEDS_ATTENTION: "warning",
  REGULAR: "positive",
  SOMETIMES_MISSING: "warning",
  FREQUENTLY_MISSING: "negative",
  NEEDS_IMPROVEMENT: "warning",
  // AVERAGE and ACTIVE are deliberately absent: AVERAGE is neither good nor
  // bad, and ACTIVE already reads as positive from the school statuses above.
  // students
  TRANSFERRED: "neutral",
  GRADUATED: "info",
  COMPLETED: "neutral",
  WITHDRAWN: "neutral",
};

export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  status: string;
  label?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone ?? STATUS_TONE[status] ?? "neutral"],
        className,
      )}
    >
      {label ?? humanize(status)}
    </span>
  );
}
