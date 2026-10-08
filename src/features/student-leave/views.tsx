import { CalendarOffIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { StudentLeaveRow } from "@/server/attendance/student-leave";

import { cancelStudentLeaveAction } from "./actions";
import { LeaveDecisionForm } from "./forms";

const STATUS = {
  PENDING: { label: "With class teacher", tone: "warning" },
  TEACHER_APPROVED: { label: "Waiting for school approval", tone: "info" },
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
export function LeaveList({ rows, showStudent = true, admin = false }: { rows: StudentLeaveRow[]; showStudent?: boolean; /** The School Admin, whose approval is the final one. */ admin?: boolean }) {
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
          </p>
          <LeaveSteps row={row} />
          {row.mayDecide ? <LeaveDecisionForm leaveId={row.id} status={row.status} finalStep={admin} /> : null}
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

/**
 * The two approvals, in order: 1. the class teacher, 2. the school (School
 * Admin). Each says done, waiting, or not needed, with who, when and what
 * they said — so a parent can see exactly where their request is.
 */
function LeaveSteps({ row }: { row: StudentLeaveRow }) {
  const cancelled = row.status === "CANCELLED";
  const review = row.teacherReview;
  const adminDecided = row.decidedByAdmin && row.decidedAt;
  // Rejected by the teacher and not taken up by the admin: it stopped at step 1.
  const teacherRejected = row.status === "REJECTED" && !row.decidedByAdmin;

  const teacherLine = review
    ? `${review.approved ? "Approved" : "Rejected"} by ${review.by} on ${formatDate(review.at)}`
    : adminDecided
      ? "Not needed — the School Admin decided directly"
      : cancelled
        ? "Cancelled before review"
        : row.classTeacher
          ? `Waiting for ${row.classTeacher}`
          : "No class teacher — goes straight to the School Admin";
  const teacherState = review ? (review.approved ? "yes" : "no") : adminDecided ? "skip" : cancelled ? "skip" : "wait";

  const schoolLine = adminDecided
    ? `${row.status === "APPROVED" ? "Approved" : "Rejected"} by ${row.approver} on ${formatDate(row.decidedAt!)}`
    : teacherRejected
      ? "Not needed — rejected by the class teacher"
      : cancelled
        ? "Cancelled"
        : row.status === "TEACHER_APPROVED"
          ? "Waiting for the School Admin's final approval"
          : "After the class teacher";
  const schoolState = adminDecided ? (row.status === "APPROVED" ? "yes" : "no") : teacherRejected || cancelled ? "skip" : row.status === "TEACHER_APPROVED" ? "wait" : "later";

  return (
    <ol className="bg-muted/40 flex flex-col gap-1.5 rounded-xl px-3 py-2.5 text-xs">
      <Step n={1} title="Class teacher" text={teacherLine} state={teacherState} comment={review?.comment ?? null} />
      <Step n={2} title="School approval" text={schoolLine} state={schoolState} comment={adminDecided ? row.comment : null} />
    </ol>
  );
}

const STEP_STYLE = {
  yes: "bg-success text-white",
  no: "bg-destructive text-white",
  wait: "bg-warning text-white",
  later: "bg-muted-foreground/25 text-muted-foreground",
  skip: "bg-muted-foreground/25 text-muted-foreground",
} as const;
const STEP_MARK = { yes: "✓", no: "✕", wait: "…", later: "", skip: "–" } as const;

function Step({ n, title, text, state, comment }: { n: number; title: string; text: string; state: keyof typeof STEP_STYLE; comment: string | null }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${STEP_STYLE[state]}`} aria-hidden>
        {STEP_MARK[state] || n}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{title}: </span>
        <span className="text-muted-foreground">{text}</span>
        {comment ? <span className="mt-0.5 block italic">“{comment}”</span> : null}
      </span>
    </li>
  );
}
