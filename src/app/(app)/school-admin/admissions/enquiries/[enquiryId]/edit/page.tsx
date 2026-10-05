import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EnquiryForm } from "@/features/admissions/enquiry-form";
import { today, toDateInput } from "@/lib/dates";
import { listClasses, listStreams } from "@/server/academics/structure";
import { getEnquiry } from "@/server/admissions/enquiries";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit enquiry" };

export default async function EditEnquiryPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]/edit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { enquiryId } = await props.params;
  const enquiry = await orNotFound(getEnquiry(ctx, enquiryId));
  const back = { href: `/school-admin/admissions/enquiries/${enquiry.id}` as Route, label: enquiry.enquiryNumber };
  if (!enquiry.open) {
    return (
      <>
        <PageHeader back={back} title="Edit enquiry" />
        <p className="text-muted-foreground">Only an open enquiry can be edited. Converted and closed enquiries are kept as they were.</p>
      </>
    );
  }
  const [classes, streams] = await Promise.all([listClasses(ctx, { activeOnly: true }), listStreams(ctx, { activeOnly: true })]);
  return (
    <>
      <PageHeader back={back} title={`Edit enquiry · ${enquiry.parentName}`} description="Correct the family's details, add a child or remove one. Fees are changed on the enquiry page, where every change is kept." />
      <EnquiryForm
        classes={classes.map((row) => ({ value: row.id, label: row.name, level: row.level }))}
        streams={streams.map((row) => ({ value: row.id, label: row.name }))}
        today={toDateInput(today())}
        defaults={{
          enquiryId: enquiry.id,
          source: enquiry.source,
          parentName: enquiry.parentName,
          relationship: enquiry.relationship,
          phone: enquiry.phone,
          alternatePhone: enquiry.alternatePhone,
          email: enquiry.email,
          addressLine: enquiry.addressLine,
          city: enquiry.city,
          state: enquiry.state,
          postalCode: enquiry.postalCode,
          notes: enquiry.notes,
          children: enquiry.children
            .filter((child) => child.status !== "ADMITTED")
            .map((child) => ({
              id: child.id,
              firstName: child.firstName,
              lastName: child.lastName ?? "",
              dateOfBirth: child.dateOfBirth ? toDateInput(child.dateOfBirth) : "",
              gender: child.gender ?? "",
              classId: child.classId,
              streamId: child.streamId ?? "",
              previousSchool: child.previousSchool ?? "",
              notes: child.notes ?? "",
            })),
          admitted: enquiry.children.filter((child) => child.status === "ADMITTED").map((child) => ({ id: child.id, name: child.name, className: child.class.name })),
        }}
      />
    </>
  );
}
