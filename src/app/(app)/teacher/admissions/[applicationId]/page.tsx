import type { Metadata, Route } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeAdmissionDocumentAction, submitDriveApplicationAction } from "@/features/admissions/drive-actions";
import { AdmissionDocumentForm, DriveApplicationForm } from "@/features/admissions/drive-forms";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { getMyApplication, streamOptionsFor } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Application" };

/**
 * One application on the teacher's own assignment. While it is a draft (or
 * sent back for correction) and their assignment is open, they may edit it,
 * add documents and submit it — each only with that permission. After that it
 * is the School Admin's.
 */
export default async function TeacherAdmissionPage(props: PageProps<"/teacher/admissions/[applicationId]">) {
  const ctx = await requireTenant("TEACHER");
  const { applicationId } = await props.params;
  const { application, assignment, can } = await orNotFound(getMyApplication(ctx, applicationId));
  const streams = can.edit ? await streamOptionsFor(ctx, application.requestedClass.level) : [];
  const status = application.status === "SUBMITTED" ? "Pending admin review" : APPLICATION_STATUS_LABEL[application.status];
  const locked = !can.edit && !can.documents && !can.submit;

  return (
    <>
      <PageHeader
        back={{ href: "/teacher/admissions" as Route, label: "Admissions" }}
        title={`${application.studentFirstName} ${application.studentLastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={application.status} label={status} />
            <span className="font-mono text-xs">{application.applicationNumber}</span>
            <span>
              · {assignment.label} · {assignment.drive.name}
            </span>
          </span>
        }
        actions={
          can.submit ? (
            <ActionButton
              action={submitDriveApplicationAction}
              fields={{ applicationId: application.id }}
              size="default"
              confirm={{ title: "Submit for admin review?", description: "After this you cannot change it unless the School Admin sends it back.", confirmLabel: "Submit" }}
            >
              Submit for review
            </ActionButton>
          ) : undefined
        }
      />

      {application.status === "CORRECTION_REQUESTED" && application.reviewNotes ? (
        <Card className="border-warning/40 mb-6">
          <CardHeader>
            <CardTitle>Correction requested</CardTitle>
            <CardDescription className="whitespace-pre-wrap">{application.reviewNotes}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {application.status === "REJECTED" && application.reviewNotes ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Rejected</CardTitle>
            <CardDescription className="whitespace-pre-wrap">{application.reviewNotes}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {locked && (application.status === "DRAFT" || application.status === "CORRECTION_REQUESTED") ? (
        <p className="text-muted-foreground mb-6 rounded-xl border border-dashed p-4 text-sm">
          You cannot change this application now — your admission dates have ended, the work is paused, or you do not have that permission. Ask the School Admin.
        </p>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{can.edit ? "Edit application" : "Application"}</CardTitle>
          </CardHeader>
          <CardContent>
            {can.edit ? (
              <DriveApplicationForm
                applicationId={application.id}
                streams={streams}
                values={{
                  studentFirstName: application.studentFirstName,
                  studentLastName: application.studentLastName,
                  dateOfBirth: application.dateOfBirth ? toDateInput(application.dateOfBirth) : "",
                  gender: application.gender ?? "",
                  previousSchool: application.previousSchool ?? "",
                  requestedStreamId: application.requestedStreamId ?? "",
                  parentName: application.parentName,
                  parentRelationship: application.parentRelationship,
                  parentPhone: application.parentPhone,
                  parentEmail: application.parentEmail ?? "",
                  addressLine: application.addressLine ?? "",
                  city: application.city ?? "",
                  state: application.state ?? "",
                  postalCode: application.postalCode ?? "",
                  notes: application.notes ?? "",
                }}
              />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Class</dt>
                <dd>
                  {application.requestedClass.name}
                  {application.requestedStream ? ` · ${application.requestedStream.name}` : ""}
                </dd>
                <dt className="text-muted-foreground">Date of birth</dt>
                <dd>{application.dateOfBirth ? formatDate(application.dateOfBirth) : "—"}</dd>
                <dt className="text-muted-foreground">Gender</dt>
                <dd>{application.gender ? humanize(application.gender) : "—"}</dd>
                <dt className="text-muted-foreground">Parent</dt>
                <dd>
                  {application.parentName} ({humanize(application.parentRelationship)})
                </dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{application.parentPhone}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{application.parentEmail || "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{[application.addressLine, application.city, application.state, application.postalCode].filter(Boolean).join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{application.notes || "—"}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>PDF only — birth certificate, previous report card, and so on.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {application.documents.length ? (
                <ul className="divide-y text-sm">
                  {application.documents.map((document) => (
                    <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <a href={`/api/v1/admission-documents/${document.id}/file`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {document.label}
                        <span className="text-muted-foreground block text-xs font-normal">{document.fileName}</span>
                      </a>
                      {can.documents ? (
                        <ActionButton action={removeAdmissionDocumentAction} fields={{ documentId: document.id }} variant="ghost">
                          Remove
                        </ActionButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No documents yet.</p>
              )}
              {can.documents ? <AdmissionDocumentForm applicationId={application.id} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {application.followUps.length ? (
                <ol className="divide-y text-sm">
                  {application.followUps.map((item) => (
                    <li key={item.id} className="py-2">
                      <p className="whitespace-pre-wrap">{item.note}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(item.createdAt)}
                        {item.author ? ` · ${item.author.firstName} ${item.author.lastName}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">Started {formatDateTime(application.submittedAt)}.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
