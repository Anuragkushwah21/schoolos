"use client";

import { useTranslateDynamic } from "@/components/i18n/i18n-provider";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A coloured pill for an enum status. Tone is chosen by meaning, so every
 * "good" state reads green and every "stopped" state reads red app-wide.
 *
 * Colours come from the design tokens in `globals.css` (`success`, `warning`,
 * `danger`, `info`), and each pill also carries a dot and its word, so the
 * meaning never rests on colour alone. The word is the translated status
 * (`status.<VALUE>`) unless the caller passes its own label.
 */
const TONES = {
  positive: "bg-success-soft text-success-strong border-success/25",
  warning: "bg-warning-soft text-warning-strong border-warning/25",
  negative: "bg-danger-soft text-danger-strong border-danger/25",
  info: "bg-info-soft text-info-strong border-info/25",
  neutral: "bg-muted text-muted-foreground border-border",
} as const;

const DOTS: Record<keyof typeof TONES, string> = {
  positive: "bg-success",
  warning: "bg-warning",
  negative: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
};

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
  // leave
  APPROVED: "positive",
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
  // employment — leaving is recorded, not judged, except where it is a sanction
  // (SUSPENDED is shared with schools above)
  RESIGNED: "neutral",
  RETIRED: "neutral",
  TERMINATED: "negative",
  // login access
  LOCKED: "warning",
  DISABLED: "negative",
  NO_LOGIN: "neutral",
  NO_ACTIVE_CHILDREN: "neutral",
  // student support and parent concerns
  NEW: "info",
  REVIEWING: "info",
  SUPPORT_PLANNED: "info",
  IN_PROGRESS: "warning",
  IMPROVING: "positive",
  RESOLVED: "neutral",
  ACTION_TAKEN: "positive",
  HIGH: "negative",
  MEDIUM: "warning",
  LOW: "neutral",
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
  const translate = useTranslateDynamic();
  const resolved = tone ?? STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONES[resolved],
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOTS[resolved])} aria-hidden />
      {label ?? translate(`status.${status}`, humanize(status))}
    </span>
  );
}
