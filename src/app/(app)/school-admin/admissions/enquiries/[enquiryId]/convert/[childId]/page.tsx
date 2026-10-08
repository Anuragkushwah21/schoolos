import type { Metadata, Route } from "next";
import Link from "next/link";
import { UserCheckIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassBadge, StreamBadge } from "@/features/admissions/enquiry-bits";
import { rupees } from "@/features/finance/money";
import { CreateStudentForm } from "@/features/school/people-forms";
import { toDateInput } from "@/lib/dates";
import { getCurrentSession } from "@/server/academics/structure";
import { admissionSeatOptions } from "@/server/academics/streams";
import { childConversionPlan } from "@/server/admissions/enquiries";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { parentOptions } from "@/server/people/parents";
import { studentFormSections } from "@/server/people/students";

export const metadata: Metadata = { title: "Admit from enquiry" };

/**
 * Admit one child of a family enquiry: the admission form, filled in. The
 * family's parent is linked (never duplicated); a parent matching only by
 * name is offered but never chosen for the office. Fees are not touched.
 */
export default async function ConvertEnquiryChildPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]/convert/[childId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { enquiryId, childId } = await props.params;
  const plan = await orNotFound(childConversionPlan(ctx, enquiryId, childId));
  const session = await getCurrentSession(ctx);
  const { enquiry, child, prefill } = plan;
  const back = { href: `/school-admin/admissions/enquiries/${enquiry.id}` as Route, label: enquiry.enquiryNumber };

  if (!plan.open || !session) {
    return (
      <>
        <PageHeader back={back} title={`Admit ${child.name}`} />
        <p className="text-muted-foreground">{!session ? "Set up the current academic session first." : "This child is already admitted, not proceeding, or the enquiry is closed."}</p>
      </>
    );
  }

  const [sections, parents, seats] = await Promise.all([studentFormSections(ctx, session.id), parentOptions(ctx), admissionSeatOptions(ctx, session.id)]);
  const requested = sections.find((section) => section.classId === prefill.classId);
  const link = plan.linkParent;
  const parentChoices = [
    ...plan.safeParents.map((row) => ({ value: row.id, label: `${row.name} · ${row.phone} (${row.matchedBy === "linked" ? "linked to this enquiry" : `same ${row.matchedBy}`})` })),
    ...plan.nameOnlyParents.map((row) => ({ value: row.id, label: `${row.name} · ${row.phone} (same name only — check first)` })),
    ...parents.filter((row) => !plan.safeParents.some((match) => match.id === row.value) && !plan.nameOnlyParents.some((match) => match.id === row.value)),
  ];

  return (
    <>
      <PageHeader
        back={back}
        icon={UserCheckIcon}
        tone="green"
        title={`Admit ${child.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            From enquiry {enquiry.enquiryNumber} · <ClassBadge>{child.class.name}</ClassBadge> <StreamBadge rule={child.streamRule} name={child.stream?.name} /> · {session.name}
          </span>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className={link ? "border-success/40" : undefined}>
          <CardHeader>
            <CardTitle>Parent</CardTitle>
            <CardDescription>
              {link
                ? `${link.name} is already a parent here (${link.matchedBy === "linked" ? "linked to this enquiry" : `same ${link.matchedBy}`}). They are selected, so ${child.firstName} joins their account — no second parent record.`
                : plan.nameOnlyParents.length
                  ? `A parent with the same name (${plan.nameOnlyParents.map((row) => row.name).join(", ")}) is here but with a different mobile/email. A new parent is prefilled — choose them under "Existing parent" only if you have checked it is the same person.`
                  : "No parent with this mobile or email is at the school yet: a new parent is prefilled."}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fees</CardTitle>
            <CardDescription>
              {child.finalMinor !== null
                ? `Discussed ${rupees(child.feeOriginalMinor ?? 0)} − ${rupees(child.discountMinor)} = ${rupees(child.finalMinor)}. Admitting creates no fee. After the fees are charged, apply the agreed discount from the enquiry — it asks for confirmation.`
                : "No fee was discussed. Admitting creates no fee."}
            </CardDescription>
          </CardHeader>
        </Card>
        {plan.possibleDuplicates.length ? (
          <Card className="border-warning/50 lg:col-span-2">
            <CardHeader>
              <CardTitle>Possible duplicate</CardTitle>
              <CardDescription>Already at the school with this name: {plan.possibleDuplicates.map((row) => `${row.name} (${row.admissionNumber})`).join(", ")}. Check before admitting.</CardDescription>
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
          streamId: prefill.streamId,
          guardian: link
            ? { mode: "existing", existingParentId: link.id, relationship: prefill.relationship }
            : { mode: "new", firstName: prefill.parentFirstName, lastName: prefill.parentLastName, phone: prefill.parentPhone, email: prefill.parentEmail, address: prefill.addressLine, relationship: prefill.relationship },
        }}
        convert={{ enquiry: { enquiryId: enquiry.id, childId: child.id }, duplicates: plan.possibleDuplicates.map((row) => `${row.name} (${row.admissionNumber})`) }}
      />
    </>
  );
}
