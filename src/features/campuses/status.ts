import type { Tone } from "@/components/shared/status-badge";

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "info" },
  APPROVED: { label: "Approved", tone: "positive" },
  MODIFIED: { label: "Approved with changes", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
};
