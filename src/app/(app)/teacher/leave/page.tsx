import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelLeaveAction } from "@/features/staff/actions";
import { LeaveRequestForm } from "@/features/staff/forms";
import { formatSpan } from "@/lib/calendar";
import { addDays, today, toDateInput } from "@/lib/dates";
import { humanize, pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { LEAVE_AHEAD_DAYS, LEAVE_BACKDATE_DAYS, listMyLeave } from "@/server/staff/leave";

export const metadata: Metadata = { title: "Leave" };

export default async function TeacherLeavePage() {
  const ctx = await requireTenant("TEACHER");
  const requests = await listMyLeave(ctx);
  const now = today();

  return (
    <>
      <PageHeader title="Leave" description="Request leave and follow what the school office decides." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Request leave</CardTitle>
            <CardDescription>
              Up to {LEAVE_BACKDATE_DAYS} days back and {LEAVE_AHEAD_DAYS} days ahead. Holidays and weekly offs inside the
              dates are not counted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveRequestForm
              today={toDateInput(now)}
              min={toDateInput(addDays(now, -LEAVE_BACKDATE_DAYS))}
              max={toDateInput(addDays(now, LEAVE_AHEAD_DAYS))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>My requests</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length ? (
              <ul className="divide-y">
                {requests.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-start gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {humanize(request.type)} · {formatSpan(request.startDate, request.endDate)}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {pluralize(request.days, "working day")} · {request.reason}
                      </span>
                      {request.reviewNote ? (
                        <span className="mt-1 block text-xs">Office: {request.reviewNote}</span>
                      ) : null}
                    </span>
                    <TimeStatusBadge status={request.timeStatus} />
                    {request.cancellable ? (
                      <ActionButton
                        action={cancelLeaveAction}
                        fields={{ leaveId: request.id }}
                        variant="ghost"
                        size="xs"
                        confirm={{ title: "Cancel this leave request?", description: "You can request it again later.", confirmLabel: "Cancel leave" }}
                      >
                        Cancel
                      </ActionButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No leave requested yet.">Use the form on this page to ask for leave; the office replies here.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
