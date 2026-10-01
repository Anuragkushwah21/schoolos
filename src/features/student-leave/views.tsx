import { CalendarOffIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { StudentLeaveRow } from "@/server/attendance/student-leave";

import { cancelStudentLeaveAction } from "./actions";
import { LeaveDecisionForm } from "./forms";

const STATUS = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
} as const;

const dates = (row: Pick<StudentLeaveRow, "fromDate" | "toDate" | "days">) =>
  row.days > 1 ? `${formatDate(row.fromDate)} – ${formatDate(row.toDate)} (${row.days} days)` : formatDate(row.fromDate);

/**
 * Leave requests as cards: student and class, dates, reason, status, who
 * decides or decided, when, and the comment. Approve / Reject where this
 * person may decide; Cancel where they asked for it.
 */
export function LeaveList({ rows, showStudent = true }: { rows: StudentLeaveRow[]; showStudent?: boolean }) {
  if (!rows.length) {
    return (
      <EmptyState icon={CalendarOffIcon} tone="blue" title="No leave requests">
        Requests appear here once they are submitted.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="bg-card flex flex-col gap-2 rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {showStudent ? <p className="font-semibold">{row.student}</p> : null}
              <p className={showStudent ? "text-muted-foreground text-sm" : "font-semibold"}>{showStudent ? (row.group ?? "—") : dates(row)}</p>
            </div>
            <StatusBadge status={row.status} tone={STATUS[row.status].tone} label={STATUS[row.status].label} />
          </div>
          {showStudent ? <p className="text-sm font-medium">{dates(row)}</p> : null}
          <p className="text-sm">
            <span className="text-muted-foreground">Reason: </span>
            {row.reasonLabel}
            {row.note ? <span className="text-muted-foreground"> — {row.note}</span> : null}
          </p>
          <p className="text-muted-foreground text-xs">
            Requested by {row.requestedBy} · {formatDateTime(row.requestedAt)}
            {row.approver ? ` · ${row.status === "PENDING" ? "Goes to" : row.status === "CANCELLED" ? "Class teacher" : row.status === "APPROVED" ? "Approved by" : "Rejected by"} ${row.approver}${row.decidedByAdmin ? " (School Admin)" : ""}` : row.status === "PENDING" ? " · Goes to the School Admin (no class teacher)" : ""}
            {row.decidedAt ? ` on ${formatDate(row.decidedAt)}` : ""}
          </p>
          {row.comment ? <p className="bg-muted rounded-lg px-3 py-2 text-sm">“{row.comment}”</p> : null}
          {row.mayDecide ? <LeaveDecisionForm leaveId={row.id} status={row.status} /> : null}
          {row.mayCancel ? (
            <ActionButton action={cancelStudentLeaveAction} fields={{ leaveId: row.id }} variant="outline" size="sm" className="w-fit" confirm={{ title: "Cancel this leave request?", description: "The class teacher will no longer see it as a request.", confirmLabel: "Cancel request" }}>
              Cancel request
            </ActionButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
