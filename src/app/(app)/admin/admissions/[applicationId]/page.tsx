import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptApplicationForm, ApplicationStatusForm } from "@/features/admissions/forms";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getApplication } from "@/server/admissions/service";
import { sectionOptions } from "@/server/academics/structure";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Application" };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children || "—"}</dd>
    </div>
  );
}

export default async function AdmissionPage(props: PageProps<"/admin/admissions/[applicationId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { applicationId } = await props.params;

  const application = await orNotFound(getApplication(ctx, applicationId));
  const sections = await sectionOptions(ctx, application.academicSessionId);
  const decided = application.status === "ACCEPTED" || application.status === "REJECTED";

  // Sections of the class the family asked for come first as a default.
  const suggested = sections.find((section) => section.label.startsWith(`${application.requestedClass.name} `));

  return (
    <>
      <PageHeader
        back={{ href: "/admin/admissions", label: "Admissions" }}
        title={`${application.studentFirstName} ${application.studentLastName}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={application.status} />
            <span className="font-mono text-xs">{application.applicationNumber}</span>
            <span>· received {formatDateTime(application.submittedAt)}</span>
          </span>
        }
        actions={
          application.createdStudent ? (
            <Button asChild variant="outline">
              <Link href={`/admin/students/${application.createdStudent.id}`}>Open student record</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
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
              <Detail label="Date of birth">
                {application.dateOfBirth ? formatDate(application.dateOfBirth) : null}
              </Detail>
              <Detail label="Gender">{application.gender ? humanize(application.gender) : null}</Detail>
              <Detail label="Previous school">{application.previousSchool}</Detail>
              <Detail label="Guardian">
                {application.parentName} ({humanize(application.parentRelationship)})
              </Detail>
              <Detail label="Phone">{application.parentPhone}</Detail>
              <Detail label="Email">{application.parentEmail}</Detail>
              <Detail label="Address">
                {[application.addressLine, application.city, application.state, application.postalCode]
                  .filter(Boolean)
                  .join(", ")}
              </Detail>
              <Detail label="Notes">{application.notes}</Detail>
              <Detail label="Reviewed">
                {application.reviewedAt
                  ? `${formatDateTime(application.reviewedAt)}${application.reviewedBy ? ` by ${application.reviewedBy.firstName} ${application.reviewedBy.lastName}` : ""}`
                  : null}
              </Detail>
              <Detail label="Review notes">{application.reviewNotes}</Detail>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {decided ? (
            <Card>
              <CardHeader>
                <CardTitle>Decided</CardTitle>
                <CardDescription>
                  {application.status === "ACCEPTED"
                    ? "This application has been accepted and the student record created."
                    : "This application was rejected."}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Accept and admit</CardTitle>
                  <CardDescription>
                    Creates the student, the guardian and the enrollment in one
                    step. A guardian with this phone number is reused, so
                    siblings share one record.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sections.length ? (
                    <AcceptApplicationForm
                      applicationId={application.id}
                      sections={sections}
                      defaultSectionId={suggested?.value}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Create a section for {application.academicSession.name} before admitting.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Or record a decision</CardTitle>
                </CardHeader>
                <CardContent>
                  <ApplicationStatusForm applicationId={application.id} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
