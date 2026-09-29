import type { Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateTime } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import type { getComplaint, listComplaints } from "@/server/communication/complaints";

import { closeMyComplaintAction } from "./complaint-actions";

export const COMPLAINT_TONE = { OPEN: "warning", IN_PROGRESS: "info", RESOLVED: "positive", CLOSED: "neutral" } as const;
export const PRIORITY_TONE = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "negative" } as const;

type Row = Awaited<ReturnType<typeof listComplaints>>[number];

/** A list for the family's own view; `detailBase` links each row when set. */
export function ComplaintList({ rows, detailBase, closable = false }: { rows: Row[]; detailBase?: string; closable?: boolean }) {
  if (!rows.length) return <EmptyState title="No complaints" />;
  return (
    <ul className="divide-y rounded-xl border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1.5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {detailBase ? (
              <Link href={`${detailBase}/${row.id}` as Route} className="font-medium hover:underline">
                {row.subject}
              </Link>
            ) : (
              <span className="font-medium">{row.subject}</span>
            )}
            <StatusBadge status={row.status} tone={COMPLAINT_TONE[row.status]} />
            <StatusBadge status={row.priority} tone={PRIORITY_TONE[row.priority]} />
            <span className="text-muted-foreground ml-auto text-xs">
              {humanize(row.category)} · {formatDate(row.createdAt)}
              {row.student ? ` · ${fullName(row.student)}` : ""}
            </span>
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm">{row.description}</p>
          {row.response ? (
            <p className="bg-muted/40 rounded-md px-3 py-2 text-sm">
              <span className="font-medium">School&apos;s response: </span>
              {row.response}
            </p>
          ) : null}
          {closable && row.status !== "CLOSED" ? (
            <div>
              <ActionButton action={closeMyComplaintAction} fields={{ complaintId: row.id }} variant="ghost" size="xs">
                Mark as closed
              </ActionButton>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ComplaintDetail({ complaint }: { complaint: Awaited<ReturnType<typeof getComplaint>> }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={complaint.status} tone={COMPLAINT_TONE[complaint.status]} />
        <StatusBadge status={complaint.priority} tone={PRIORITY_TONE[complaint.priority]} />
        <span className="text-muted-foreground">
          {humanize(complaint.category)} · raised {formatDateTime(complaint.createdAt)}
          {complaint.raisedBy ? ` by ${fullName(complaint.raisedBy)} (${humanize(complaint.raisedBy.role)})` : ""}
        </span>
      </div>
      {complaint.student ? (
        <p>
          About: <span className="font-medium">{fullName(complaint.student)}</span> ({complaint.student.admissionNumber})
        </p>
      ) : null}
      <p className="whitespace-pre-wrap">{complaint.description}</p>
      {complaint.assignedTo ? <p className="text-muted-foreground">Assigned to {fullName(complaint.assignedTo)}</p> : null}
    </div>
  );
}
