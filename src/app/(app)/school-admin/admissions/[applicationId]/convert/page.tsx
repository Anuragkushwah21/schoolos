import type { Metadata, Route } from "next";
import Link from "next/link";
import { UserCheckIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateStudentForm } from "@/features/school/people-forms";
import { toDateInput } from "@/lib/dates";
import { getCurrentSession } from "@/server/academics/structure";
import { admissionSeatOptions } from "@/server/academics/streams";
import { conversionPlan } from "@/server/admissions/service";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { parentOptions } from "@/server/people/parents";
import { studentFormSections } from "@/server/people/students";

export const metadata: Metadata = { title: "Convert to student" };

/**
 * Convert an approved application: the admission form, already filled in.
 * The office only confirms session, class, section and stream — and a parent
 * already at the school is linked, not created twice. A parent matching only
 * by name is offered but never chosen for the office.
 */
export default async function ConvertPage(props: PageProps<"/school-admin/admissions/[applicationId]/convert">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { applicationId } = await props.params;
  const plan = await orNotFound(conversionPlan(ctx, applicationId));
  const session = await getCurrentSession(ctx);
  const { application, prefill } = plan;

  if (!plan.open || !session) {
    return (
      <>
        <PageHeader back={{ href: `/school-admin/admissions/${application.id}` as Route, label: "Application" }} title="Convert to student" />
        <p className="text-muted-foreground">
          {!session
            ? "Set up the current academic session first."
            : application.status === "CONVERTED" || application.status === "REJECTED"
              ? "This application has already been converted or rejected."
              : "Approve the application first — only an approved application can become a student."}
        </p>
      </>
    );
  }

  const [sections, parents, seats] = await Promise.all([studentFormSections(ctx, session.id), parentOptions(ctx), admissionSeatOptions(ctx, session.id)]);
  // A drive application names its section when the teacher's assignment was for one.
  const requested =
    sections.find((section) => section.value === application.assignment?.sectionId) ?? sections.find((section) => section.classId === prefill.requestedClassId);
  const match = plan.matchingParents[0];
  // A parent already here is offered first, so the family is linked, not duplicated.
  const parentChoices = [
    ...plan.matchingParents.map((row) => ({ value: row.id, label: `${row.name} · ${row.phone} (matches by ${row.matchedBy})` })),
    ...plan.nameOnlyParents.map((row) => ({ value: row.id, label: `${row.name} · ${row.phone} (same name only — check first)` })),
    ...parents.filter((row) => !plan.matchingParents.some((match) => match.id === row.value) && !plan.nameOnlyParents.some((match) => match.id === row.value)),
  ];

  return (
    <>
      <PageHeader
        back={{ href: `/school-admin/admissions/${application.id}` as Route, label: "Application" }}
        icon={UserCheckIcon}
        tone="green"
        title={`Convert ${application.studentFirstName} ${application.studentLastName} to a student`}
        description={`Application ${application.applicationNumber} · requested ${application.requestedClass.name}${application.requestedStream ? ` (${application.requestedStream.name})` : ""} · ${session.name}`}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className={match ? "border-success/40" : undefined}>
          <CardHeader>
            <CardTitle>Parent</CardTitle>
            <CardDescription>
              {match
                ? `${match.name} is already a parent here (same ${match.matchedBy}). They are selected, so this child joins their account — no second parent record.`
                : plan.nameOnlyParents.length
                  ? `A parent with the same name (${plan.nameOnlyParents.map((row) => row.name).join(", ")}) is here, but with a different mobile/email. A new parent is prefilled — choose them under "Existing parent" only after checking.`
                  : "No parent with this mobile or email is at the school yet: a new parent is prefilled."}
            </CardDescription>
          </CardHeader>
        </Card>
        {plan.possibleDuplicates.length ? (
          <Card className="border-warning/50">
            <CardHeader>
              <CardTitle>Possible duplicate</CardTitle>
              <CardDescription>
                Already at the school with this name: {plan.possibleDuplicates.map((row) => `${row.name} (${row.admissionNumber})`).join(", ")}.
                Check before converting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href={`/school-admin/students/${plan.possibleDuplicates[0]!.id}` as Route}>Open the existing student</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <CreateStudentForm
        sections={sections}
        parents={parentChoices}
        sessionName={session.name}
        seats={seats}
        prefill={{
          student: {
            firstName: prefill.firstName,
            lastName: prefill.lastName,
            gender: prefill.gender,
            dateOfBirth: prefill.dateOfBirth ? toDateInput(prefill.dateOfBirth) : undefined,
            addressLine: prefill.addressLine,
            city: prefill.city,
            state: prefill.state,
            postalCode: prefill.postalCode,
          },
          sectionId: requested?.value,
          streamId: prefill.requestedStreamId,
          guardian: match
            ? { mode: "existing", existingParentId: match.id, relationship: prefill.relationship }
            : {
                mode: "new",
                firstName: prefill.parentFirstName,
                lastName: prefill.parentLastName,
                phone: prefill.parentPhone,
                email: prefill.parentEmail,
                address: prefill.addressLine,
                relationship: prefill.relationship,
              },
        }}
        convert={{ applicationId: application.id, duplicates: plan.possibleDuplicates.map((row) => `${row.name} (${row.admissionNumber})`) }}
      />
    </>
  );
}
