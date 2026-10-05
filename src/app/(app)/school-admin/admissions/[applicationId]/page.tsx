import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveApplicationAction } from "@/features/admissions/actions";
import { APPLICATION_STATUS_LABEL } from "@/features/admissions/enquiry-bits";
import { FollowUpForm } from "@/features/admissions/enquiry-forms";
import { ApplicationStatusForm } from "@/features/admissions/forms";
import { formatDate, formatDateTime, today, toDateInput } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getApplication } from "@/server/admissions/service";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Application" };

const SOURCE_LABEL: Record<string, string> = { WEBSITE: "Website", WALK_IN: "Walk-in", PHONE: "Phone", ADMIN: "Office" };
const STEPS = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED"] as const;

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

export default async function AdmissionPage(props: PageProps<"/school-admin/admissions/[applicationId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { applicationId } = await props.params;

  const application = await orNotFound(getApplication(ctx, applicationId));
  const decided = application.status === "CONVERTED" || application.status === "REJECTED";
  const answers = answersOf(application.customAnswers);
  const step = STEPS.indexOf(application.status as (typeof STEPS)[number]);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/admissions", label: "Online admissions" }}
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
        }
      />

      {application.status !== "REJECTED" ? (
        <ol className="mb-6 flex flex-wrap gap-2" aria-label="Application progress">
          {STEPS.map((name, index) => (
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
                      <Link href={`/school-admin/admissions/${sibling.id}` as Route} className="font-medium hover:underline">
                        {sibling.studentFirstName} {sibling.studentLastName} · {sibling.requestedClass.name}
                      </Link>
                      <StatusBadge status={sibling.status} label={APPLICATION_STATUS_LABEL[sibling.status]} />
                    </li>
                  ))}
                </ul>
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
              {application.status === "APPROVED" ? (
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
              <Card>
                <CardHeader>
                  <CardTitle>Decision</CardTitle>
                  <CardDescription>Under review → shortlisted → approved. Only an approved application can be converted.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ApplicationStatusForm applicationId={application.id} status={application.status} />
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Calls and notes</CardTitle>
              <CardDescription>Kept even after the application is decided.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FollowUpForm applicationId={application.id} today={toDateInput(today())} />
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
