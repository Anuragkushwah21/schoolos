import { rupees } from "@/features/finance/money";
import type { StreamRule } from "@/lib/stream-rules";
import { cn } from "@/lib/utils";

/** Small pieces shared by the enquiry screens — server and client alike. */

export function ClassBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("bg-primary-soft text-primary-strong inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}>{children}</span>;
}

/** The stream as the class rule sees it: a chosen stream, "Optional", "Not applicable", or a missing required one. */
export function StreamBadge({ rule, name }: { rule: StreamRule; name?: string | null }) {
  if (name) {
    return (
      <span className="bg-purple-soft text-purple-strong inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold">
        {rule === "OPTIONAL" ? `Optional — ${name}` : name}
      </span>
    );
  }
  if (rule === "REQUIRED") return <span className="bg-danger-soft text-danger-strong inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold">Stream required</span>;
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
      {rule === "OPTIONAL" ? "Stream: optional" : "Stream: not applicable"}
    </span>
  );
}

export function DiscountText({ kind, value, discountMinor }: { kind: "NONE" | "FIXED" | "PERCENT"; value: number; discountMinor: number }) {
  if (kind === "NONE" || !discountMinor) return <>No discount</>;
  return <>{kind === "PERCENT" ? `${value / 100}% (${rupees(discountMinor)})` : rupees(discountMinor)}</>;
}

/** Original − discount = final, for one child or the family. */
export function FeeFigures({ originalMinor, discount, finalMinor, emphasise = false }: { originalMinor: number; discount: React.ReactNode; finalMinor: number; emphasise?: boolean }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div>
        <dt className="text-muted-foreground text-xs">Discussed fee</dt>
        <dd className="font-semibold tabular-nums">{rupees(originalMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Discount</dt>
        <dd className="text-success-strong font-semibold tabular-nums">{discount}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Final</dt>
        <dd className={cn("font-bold tabular-nums", emphasise && "text-primary-strong text-lg")}>{rupees(finalMinor)}</dd>
      </div>
    </dl>
  );
}

export const ENQUIRY_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  FOLLOW_UP: "Follow up",
  CONVERTED: "Converted",
  CLOSED: "Closed",
};

export const ENQUIRY_SOURCE_LABEL: Record<string, string> = {
  WEBSITE: "Website",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  REFERRAL: "Referral",
  OTHER: "Other",
};

export const FEE_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not discussed",
  DISCUSSING: "Discussing",
  AGREED: "Agreed",
};

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  SHORTLISTED: "Shortlisted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CONVERTED: "Converted",
};
