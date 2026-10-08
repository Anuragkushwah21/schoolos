import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardListIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestHistory, RequestStatusBadge, RequestedVsApproved, requestRef } from "@/features/campuses/request-views";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/current-user";
import { getMyCampusRequest } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "Campus request" };

/** One request: what was asked, what SchoolOS decided, and the history. */
export default async function MyCampusRequestPage(props: PageProps<"/school-admin/campuses/requests/[requestId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { requestId } = await props.params;
  const row = await getMyCampusRequest(ctx, requestId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/campuses/requests" as Route, label: "My Campus Requests" }}
        icon={ClipboardListIcon}
        tone="blue"
        title={row.name}
        description={`Request ${requestRef(row.id)} · sent ${formatDate(row.createdAt)}${row.requestedBy ? ` by ${row.requestedBy.firstName} ${row.requestedBy.lastName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={row.status} />
            {row.editable ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/school-admin/campuses/requests/${row.id}/edit` as Route}>Edit request</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-6">
          {row.status === "REJECTED" ? (
            <p className="bg-danger-soft text-danger-strong rounded-xl border px-4 py-3 text-sm">{`Rejected by SchoolOS: ${row.rejectionReason ?? ""}`}</p>
          ) : null}
          {row.createdSchool ? (
            <p className="bg-success-soft text-success-strong rounded-xl border px-4 py-3 text-sm">
              {`${row.createdSchool.name} is live. Find it under My Schools.`}{" "}
              <Link className="font-medium underline" href="/school-admin/campuses">
                Open My Schools
              </Link>
            </p>
          ) : null}
          {!row.editable && (row.status === "PENDING" || row.status === "UNDER_REVIEW") ? (
            <p className="bg-info-soft text-info-strong rounded-xl border px-4 py-3 text-sm">SchoolOS is reviewing this request, so it can no longer be changed.</p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>What you asked for, and what SchoolOS approved.</CardDescription>
            </CardHeader>
            <CardContent>
              <RequestedVsApproved row={row} />
              {row.reviewNote ? <p className="text-muted-foreground mt-3 text-sm">{`Note from SchoolOS: ${row.reviewNote}`}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>School details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <p>{[row.addressLine, row.city, row.state, row.postalCode].filter(Boolean).join(", ")}</p>
              <p>{`Contact: ${row.contactName} · ${row.contactEmail} · ${row.contactPhone}`}</p>
              {row.affiliationBoard ? <p>{`Board: ${row.affiliationBoard}`}</p> : null}
              <p>{`Expected: ${row.expectedStudents ?? "—"} students · ${row.expectedTeachers ?? "—"} teachers · ${row.expectedStaff ?? "—"} staff`}</p>
              {row.notes ? <p className="text-muted-foreground whitespace-pre-line">{row.notes}</p> : null}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestHistory history={row.history} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
