import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EditStudentForm } from "@/features/school/people-forms";
import { toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getStudentProfile } from "@/server/people/students";

export const metadata: Metadata = { title: "Edit student" };

export default async function EditStudentPage(props: PageProps<"/admin/students/[studentId]/edit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { studentId } = await props.params;
  const { student } = await orNotFound(getStudentProfile(ctx, studentId));

  return (
    <>
      <PageHeader
        back={{ href: `/admin/students/${student.id}`, label: `${student.firstName} ${student.lastName}` }}
        title="Edit student"
      />
      <EditStudentForm
        student={{
          studentId: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          gender: student.gender,
          admissionNumber: student.admissionNumber,
          dateOfBirth: student.dateOfBirth ? toDateInput(student.dateOfBirth) : "",
          admissionDate: student.admissionDate ? toDateInput(student.admissionDate) : "",
          bloodGroup: student.bloodGroup,
          addressLine: student.addressLine,
          city: student.city,
          state: student.state,
          postalCode: student.postalCode,
          emergencyContactName: student.emergencyContactName,
          emergencyContactPhone: student.emergencyContactPhone,
          status: student.status,
        }}
      />
    </>
  );
}
