import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { decideLeaveAction } from "@/features/staff/actions";
import { formatSpan } from "@/lib/calendar";
import { formatDayShort, formatMinutes, toDateInput } from "@/lib/dates";
import { humanize, pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getLeaveRequest } from "@/server/staff/leave";

export const metadata: Metadata = { title: "Leave request" };

export default async function LeaveDetailPage(props: PageProps<"/school-admin/leave/[leaveId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { leaveId } = await props.params;
  const { leave, periods } = await orNotFound(getLeaveRequest(ctx, leaveId));
  const name = `${leave.teacher.firstName} ${leave.teacher.lastName}`;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/leave", label: "Leave" }}
        title={`${name} · ${humanize(leave.type)} leave`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {formatSpan(leave.startDate, leave.endDate)} · {pluralize(leave.days, "working day")}
            <TimeStatusBadge status={leave.timeStatus} />
          </span>
        }
        actions={
          leave.status === "PENDING" ? (
            <ActionButton action={decideLeaveAction} fields={{ leaveIds: leave.id, decision: "APPROVED" }}>
              Approve
            </ActionButton>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p>{leave.reason}</p>
            {leave.reviewNote ? <p className="text-muted-foreground">Decision note: {leave.reviewNote}</p> : null}
            {leave.status === "PENDING" ? (
              <ActionForm action={decideLeaveAction}>
                <input type="hidden" name="leaveIds" value={leave.id} />
                <input type="hidden" name="decision" value="REJECTED" />
                <TextField name="note" label="Reason for refusing" required />
                <div>
                  <SubmitButton pendingLabel="Saving…">Reject</SubmitButton>
                </div>
              </ActionForm>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Classes affected</CardTitle>
            <CardDescription>Periods within the next two weeks (and the last one) that need a substitute.</CardDescription>
          </CardHeader>
          <CardContent>
            {periods.length ? (
              <ul className="divide-y">
                {periods.map((period) => (
                  <li key={`${period.slotId}-${toDateInput(period.date)}`} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="w-40 shrink-0 tabular-nums">
                      {formatDayShort(period.date)} · {formatMinutes(period.startMinute)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {period.subject} · {period.section}
                    </span>
                    {period.cover ? (
                      <StatusBadge status="SUBSTITUTE" label={`Cover: ${period.cover.teacher}`} />
                    ) : (
                      <Button asChild size="xs" variant="outline">
                        <Link href={`/school-admin/substitutes?date=${toDateInput(period.date)}` as Route}>Arrange cover</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No timetabled periods fall inside the cover window.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
