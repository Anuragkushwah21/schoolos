import { StatusBadge } from "@/components/shared/status-badge";

/**
 * What the teacher recorded after checking a student's homework. Nothing is
 * shown while it is only assigned — opening homework never marks it.
 */
export function SubmissionBadge({ status }: { status: "SUBMITTED" | "LATE" | "MISSING" | null | undefined }) {
  if (!status) return null;
  if (status === "SUBMITTED") return <StatusBadge status="SUBMITTED" label="Submitted" tone="positive" />;
  if (status === "LATE") return <StatusBadge status="LATE" label="Submitted late" tone="warning" />;
  return <StatusBadge status="MISSING" label="Missing work" tone="negative" />;
}
