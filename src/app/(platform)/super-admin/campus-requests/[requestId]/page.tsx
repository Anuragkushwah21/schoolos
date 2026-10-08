import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2Icon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reviewCampusRequestAction } from "@/features/campuses/actions";
import { ApproveCampusForm, CampusLimitForm, RejectCampusForm } from "@/features/campuses/forms";
import { REQUEST_STATUS } from "@/features/campuses/status";
import { RequestHistory, RequestedVsApproved } from "@/features/campuses/request-views";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { moduleLabel } from "@/lib/school-modules";
import { cleanLimits, describeLimits, roleLabel } from "@/lib/school-roles";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { getCampusRequest } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "Campus request" };

export default async function CampusRequestPage(props: PageProps<"/super-admin/campus-requests/[requestId]">) {
  const user = await requireSuperAdmin();
  const { requestId } = await props.params;
  const row = await getCampusRequest(user, requestId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const status = REQUEST_STATUS[row.status]!;
  const open = row.status === "PENDING" || row.status === "UNDER_REVIEW";
  const asked = cleanLimits(row.requestedLimits);
  const atLimit = row.campusCount >= row.campusLimit;

  return (
    <>
      <PageHeader icon={Building2Icon} tone="blue" title={row.name} description={`Request ${row.id.slice(-8).toUpperCase()} · ${formatDate(row.createdAt)}`} actions={<StatusBadge status={row.status} label={status.label} tone={status.tone} />} />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Owner / organization</CardTitle>
              <CardDescription>{`${row.organization.name}${row.organization.owner ? ` · ${row.organization.owner.firstName} ${row.organization.owner.lastName} (${row.organization.owner.email})` : " · no owner yet"}`}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>{`Current plan: ${row.plan.planName ?? "none"} · campuses ${row.campusCount} of ${row.campusLimit}`}</p>
              <ul className="list-disc pl-5">
                {row.organization.schools.map((school) => (
                  <li key={school.id}>
                    <Link className="hover:underline" href={`/super-admin/schools/${school.id}`}>
                      {school.name}
                    </Link>
                    {` · ${school.status.toLowerCase()}`}
                  </li>
                ))}
              </ul>
              <CampusLimitForm organizationId={row.organization.id} current={row.organization.campusLimitOverride} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Requested</CardTitle>
              <CardDescription>{`By ${row.requestedBy ? `${row.requestedBy.firstName} ${row.requestedBy.lastName} (${row.requestedBy.email})` : "—"}`}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <p>{[row.addressLine, row.city, row.state, row.postalCode].filter(Boolean).join(", ")}</p>
              <p>{`Contact: ${row.contactName} · ${row.contactEmail} · ${row.contactPhone}`}</p>
              {row.affiliationBoard ? <p>{`Board: ${row.affiliationBoard}`}</p> : null}
              <p>{`Expected: ${row.expectedStudents ?? "—"} students · ${row.expectedTeachers ?? "—"} teachers · ${row.expectedStaff ?? "—"} staff`}</p>
              <p>{`Modules: ${row.requestedModules.map(moduleLabel).join(", ") || "core only"}`}</p>
              <p>{`Roles: ${row.requestedRoles.map(roleLabel).join(", ") || "core only"}`}</p>
              <p>{`Limits: ${describeLimits(asked)}`}</p>
              {row.entitlementNotes.length ? (
                <div className="bg-warning-soft text-warning-strong mt-2 rounded-lg border px-3 py-2">
                  <p className="font-medium">Beyond the plan when requested</p>
                  <ul className="list-disc pl-5">
                    {row.entitlementNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {row.notes ? <p className="text-muted-foreground whitespace-pre-line">{row.notes}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestHistory history={row.history} />
            </CardContent>
          </Card>
          {!open ? (
            <Card>
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>{row.reviewedBy ? `By ${row.reviewedBy.firstName} ${row.reviewedBy.lastName}${row.reviewedAt ? ` on ${formatDate(row.reviewedAt)}` : ""}` : ""}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-sm">
                {row.rejectionReason ? <p className="text-danger-strong">{`Rejected: ${row.rejectionReason}`}</p> : null}
                {row.status !== "REJECTED" ? <RequestedVsApproved row={row} /> : null}
                {row.reviewNote ? <p className="text-muted-foreground">{row.reviewNote}</p> : null}
                {row.createdSchool ? (
                  <Link className="text-primary font-medium hover:underline" href={`/super-admin/schools/${row.createdSchool.id}`}>
                    {`Open ${row.createdSchool.name}`}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
        {open ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Approve</CardTitle>
                <CardDescription>{atLimit ? `This organization is at its campus limit (${row.campusLimit}). Raise its campus limit to approve.` : "Approve as asked, or change what this campus gets."}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {row.status === "PENDING" ? (
                  <div>
                    <ActionButton action={reviewCampusRequestAction} fields={{ requestId: row.id }} variant="outline">
                      Mark under review
                    </ActionButton>
                  </div>
                ) : null}
                <ApproveCampusForm requestId={row.id} modules={row.requestedModules} roles={row.requestedRoles} limits={asked} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Reject</CardTitle>
              </CardHeader>
              <CardContent>
                <RejectCampusForm requestId={row.id} />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
