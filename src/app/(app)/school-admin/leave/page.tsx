import { CalendarClockIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { decideLeaveAction } from "@/features/staff/actions";
import { formatSpan } from "@/lib/calendar";
import { humanize, pluralize } from "@/lib/format";
import { enumParam } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listLeaveRequests } from "@/server/staff/leave";

export const metadata: Metadata = { title: "Leave" };

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export default async function AdminLeavePage(props: PageProps<"/school-admin/leave">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const status = enumParam(search.status, [...STATUSES, "ALL"] as const) ?? "PENDING";
  const requests = await listLeaveRequests(ctx, { status: status === "ALL" ? undefined : status });
  const pending = requests.filter((request) => request.status === "PENDING");

  return (
    <>
      <PageHeader icon={CalendarClockIcon} tone="purple"
        title="Leave"
        description="Approved leave fills the staff register and shows the classes that need cover."
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/substitutes">Arrange cover</Link>
          </Button>
        }
      />
      <FilterBar
        action="/school-admin/leave"
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: status,
            options: [...STATUSES.map((value) => ({ value, label: humanize(value) })), { value: "ALL", label: "All" }],
          },
        ]}
      />
      {requests.length ? (
        <ActionForm action={decideLeaveAction}>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 font-medium">Teacher</th>
                  <th className="px-3 py-2 font-medium">Leave</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      {request.status === "PENDING" ? (
                        <input type="checkbox" name="leaveIds" value={request.id} aria-label="Select request" className="accent-primary size-4" />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/school-admin/leave/${request.id}` as Route} className="font-medium hover:underline">
                        {request.teacher.firstName} {request.teacher.lastName}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{request.teacher.employeeId}</span>
                    </td>
                    <td className="px-3 py-2">
                      {humanize(request.type)} · {formatSpan(request.startDate, request.endDate)}
                      <span className="text-muted-foreground block text-xs">{pluralize(request.days, "working day")}</span>
                    </td>
                    <td className="text-muted-foreground max-w-xs px-3 py-2">{request.reason}</td>
                    <td className="px-3 py-2">
                      <TimeStatusBadge status={request.timeStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pending.length ? (
            <div className="flex flex-wrap items-end gap-3">
              <TextField name="note" label="Note to the teacher" hint="Required when rejecting." className="min-w-64 flex-1" />
              <select name="decision" aria-label="Decision" className="border-input h-9 rounded-md border px-2 text-sm" defaultValue="APPROVED">
                <option value="APPROVED">Approve selected</option>
                <option value="REJECTED">Reject selected</option>
              </select>
              <SubmitButton pendingLabel="Saving…">Apply</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      ) : (
        <EmptyState title={status === "PENDING" ? "No leave waiting for a decision" : "No leave requests"} />
      )}
    </>
  );
}
