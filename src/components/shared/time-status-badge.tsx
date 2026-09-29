import { StatusBadge } from "@/components/shared/status-badge";
import { TIME_STATUS_LABEL, TIME_STATUS_TONE } from "@/lib/time-status";

/**
 * A status worked out from the date (see `lib/time-status.ts`), in the app's
 * usual pill. Statuses with a dictionary entry (`status.UPCOMING`, …) are shown
 * in the reader's language; the rest fall back to the English label.
 */
export function TimeStatusBadge({ status, label }: { status: string; label?: string }) {
  const translated = new Set(["UPCOMING", "ONGOING", "TODAY", "COMPLETED", "ASSIGNED", "DUE_TODAY", "OVERDUE", "ON_LEAVE", "PENDING", "REJECTED", "CANCELLED", "DRAFT", "SCHEDULED", "ACTIVE", "EXPIRED", "ARCHIVED"]);
  return (
    <StatusBadge
      status={status}
      label={label ?? (translated.has(status) ? undefined : (TIME_STATUS_LABEL[status] ?? status))}
      tone={TIME_STATUS_TONE[status] ?? "neutral"}
    />
  );
}
