import type { Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveApplicationAction } from "@/features/admissions/actions";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { FollowUpForm } from "@/features/admissions/enquiry-forms";
import { DriveDecisionForm } from "@/features/admissions/drive-forms";
import { ApplicationStatusForm } from "@/features/admissions/forms";
import { formatDate, formatDateTime, today, toDateInput } from "@/lib/dates";
import { humanize } from "@/lib/format";
import type { TenantContext } from "@/server/auth/current-user";
import type { DeskScope } from "./scope";
import { applicationDocuments } from "@/server/admissions/drives";
import { getApplication } from "@/server/admissions/service";
import { orNotFound } from "@/server/page-helpers";


const SOURCE_LABEL: Record<string, string> = { WEBSITE: "Website", WALK_IN: "Walk-in", PHONE: "Phone", ADMIN: "Office", DRIVE: "Admission drive" };
const STEPS = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED"] as const;
/** A teacher's application in an admission drive: entered, sent for review, approved, admitted. */
const DRIVE_STEPS = ["DRAFT", "SUBMITTED", "APPROVED", "CONVERTED"] as const;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children || "—"}</dd>
    </div>
  );
}

function answersOf(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => (row && typeof row === "object" && typeof (row as { label?: unknown }).label === "string" && typeof (row as { value?: unknown }).value === "string" ? [row as { label: string; value: string }] : []));
}

export async function ApplicationScreen({ ctx, applicationId, scope }: { ctx: TenantContext; applicationId: string; scope: DeskScope }) {

  const application = await orNotFound(getApplication(ctx, applicationId));
  const decided = application.status === "CONVERTED" || application.status === "REJECTED";
  const answers = answersOf(application.customAnswers);
  const fromDrive = !!application.drive;
  const steps: readonly string[] = fromDrive ? DRIVE_STEPS : STEPS;
  const shownStatus = fromDrive ? ({ CORRECTION_REQUESTED: "DRAFT", UNDER_REVIEW: "SUBMITTED", SHORTLISTED: "SUBMITTED" } as Record<string, string>)[application.status] ?? application.status : application.status;
  const step = steps.indexOf(shownStatus);
  const documents = fromDrive ? await applicationDocuments(ctx, application.id) : [];
  // With the teacher: not ready for a decision yet.
  const withTeacher = application.status === "DRAFT" || application.status === "CORRECTION_REQUESTED";

  return (
    <>
      <PageHeader
        back={
          application.drive && scope.admin
            ? { href: `/school-admin/admissions/drives/${application.drive.id}` as Route, label: application.drive.name }
            : { href: scope.base as Route, label: scope.admin ? "Online admissions" : "Applications" }
        }
        title={`${application.studentFirstName} ${application.studentLastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={application.status} label={APPLICATION_STATUS_LABEL[application.status]} />
            <StatusBadge status={application.source} tone="info" label={SOURCE_LABEL[application.source] ?? "Website"} />
            {application.archivedAt ? <StatusBadge status="ARCHIVED" /> : null}
            <span className="font-mono text-xs">{application.applicationNumber}</span>
            <span>· received {formatDateTime(application.submittedAt)}</span>
          </span>
        }
        actions={
          scope.admin ? (
          <>
            {application.createdStudent ? (
              <Button asChild variant="outline">
                <Link href={`/school-admin/students/${application.createdStudent.id}`}>Open student record</Link>
              </Button>
            ) : application.status === "APPROVED" ? (
              <Button asChild>
                <Link href={`/school-admin/admissions/${application.id}/convert`}>Convert to student</Link>
              </Button>
            ) : null}
            {decided ? (
              <ActionButton
                action={archiveApplicationAction}
                fields={{ applicationId: application.id, archived: application.archivedAt ? "false" : "true" }}
                variant="ghost"
                size="default"
              >
                {application.archivedAt ? "Restore" : "Archive"}
              </ActionButton>
            ) : null}
          </>
          ) : undefined
        }
      />

      {application.status !== "REJECTED" ? (
        <ol className="mb-6 flex flex-wrap gap-2" aria-label="Application progress">
          {steps.map((name, index) => (
            <li
              key={name}
              className={
                index < step
                  ? "bg-success-soft text-success-strong rounded-full px-3 py-1 text-xs font-semibold"
                  : index === step
                    ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-semibold"
                    : "bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs"
              }
            >
              {index + 1}. {APPLICATION_STATUS_LABEL[name]}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Application</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <Detail label="Class">
                  {application.requestedClass.name}
                  {application.requestedStream ? ` · ${application.requestedStream.name}` : ""}
                </Detail>
                <Detail label="Session">{application.academicSession.name}</Detail>
                {application.drive ? (
                  <Detail label="Admission drive">
                    {scope.admin ? (
                      <Link href={`/school-admin/admissions/drives/${application.drive.id}` as Route} className="hover:underline">
                        {application.drive.name}
                      </Link>
                    ) : (
                      application.drive.name
                    )}
                    {application.assignment
                      ? ` · ${application.assignment.class.name}${application.assignment.section ? ` – ${application.assignment.section.name}` : ""} · ${application.assignment.teacher.firstName} ${application.assignment.teacher.lastName}`
                      : ""}
                  </Detail>
                ) : null}
                <Detail label="Date of birth">{application.dateOfBirth ? formatDate(application.dateOfBirth) : null}</Detail>
                <Detail label="Gender">{application.gender ? humanize(application.gender) : null}</Detail>
                <Detail label="Previous school">{application.previousSchool}</Detail>
                <Detail label="Parent">
                  {application.parentName} ({humanize(application.parentRelationship)})
                </Detail>
                <Detail label="Phone">{application.parentPhone}</Detail>
                <Detail label="Email">{application.parentEmail}</Detail>
                <Detail label="Address">{[application.addressLine, application.city, application.state, application.postalCode].filter(Boolean).join(", ")}</Detail>
                <Detail label="Notes">{application.notes}</Detail>
                {answers.map((answer) => (
                  <Detail key={answer.label} label={answer.label}>
                    {answer.value}
                  </Detail>
                ))}
                <Detail label="Reviewed">
                  {application.reviewedAt
                    ? `${formatDateTime(application.reviewedAt)}${application.reviewedBy ? ` by ${application.reviewedBy.firstName} ${application.reviewedBy.lastName}` : ""}`
                    : null}
                </Detail>
                <Detail label="Review notes">{application.reviewNotes}</Detail>
              </dl>
            </CardContent>
          </Card>

          {application.siblings.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Applied together with</CardTitle>
                <CardDescription>Brothers and sisters sent in the same form. Each is decided and admitted on their own.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {application.siblings.map((sibling) => (
                    <li key={sibling.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`${scope.base}/${sibling.id}` as Route} className="font-medium hover:underline">
                        {sibling.studentFirstName} {sibling.studentLastName} · {sibling.requestedClass.name}
                      </Link>
                      <StatusBadge status={sibling.status} label={APPLICATION_STATUS_LABEL[sibling.status]} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {fromDrive ? (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>Uploaded by the teacher.</CardDescription>
              </CardHeader>
              <CardContent>
                {documents.length ? (
                  <ul className="divide-y text-sm">
                    {documents.map((document) => (
                      <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          <span className="font-medium">{document.label}</span>
                          <span className="text-muted-foreground block text-xs">{document.fileName}</span>
                        </span>
                        <a href={`/api/v1/admission-documents/${document.id}/file`} target="_blank" rel="noreferrer" className="text-primary text-sm font-medium hover:underline">
                          Open PDF
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No documents uploaded.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {decided ? (
            <Card>
              <CardHeader>
                <CardTitle>{application.status === "CONVERTED" ? "Converted" : "Rejected"}</CardTitle>
                <CardDescription>
                  {application.status === "CONVERTED" ? "This application became a student record." : "This application was rejected. It stays in the records."}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              {scope.admin && application.status === "APPROVED" ? (
                <Card className="border-success/40">
                  <CardHeader>
                    <CardTitle>Convert to student</CardTitle>
                    <CardDescription>
                      Opens the admission form already filled in — child, parent, contact details and class. A parent already at the school is linked, never
                      duplicated. You confirm the class, section and stream.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild>
                      <Link href={`/school-admin/admissions/${application.id}/convert`}>Convert to student</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
              {fromDrive && withTeacher ? (
                <Card>
                  <CardHeader>
                    <CardTitle>With the teacher</CardTitle>
                    <CardDescription>
                      {application.status === "CORRECTION_REQUESTED"
                        ? "Sent back for correction. It comes back here when the teacher submits it again."
                        : "The teacher has not submitted this application yet."}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : null}
              {fromDrive && scope.admin && !withTeacher && application.status !== "APPROVED" ? (
                <Card className="border-warning/40">
                  <CardHeader>
                    <CardTitle>Pending your review</CardTitle>
                    <CardDescription>Approve to admit the student, send back to the teacher for correction, or reject.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DriveDecisionForm applicationId={application.id} />
                  </CardContent>
                </Card>
              ) : null}
              {scope.canManage && !fromDrive ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Decision</CardTitle>
                    <CardDescription>Under review → shortlisted → approved. Only an approved application can be converted.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ApplicationStatusForm applicationId={application.id} status={application.status} />
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Calls and notes</CardTitle>
              <CardDescription>Kept even after the application is decided.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {scope.canManage ? <FollowUpForm applicationId={application.id} today={toDateInput(today())} /> : null}
              {application.followUps.length ? (
                <ol className="divide-y border-t text-sm">
                  {application.followUps.map((item) => (
                    <li key={item.id} className="py-2.5">
                      <p className="whitespace-pre-wrap">{item.note}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(item.createdAt)}
                        {item.author ? ` · ${item.author.firstName} ${item.author.lastName}` : ""}
                        {item.nextFollowUpOn ? ` · next: ${formatDate(item.nextFollowUpOn)}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
