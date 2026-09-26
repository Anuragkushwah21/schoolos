import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { CreateTeacherForm } from "@/features/school/people-forms";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Add teacher" };

export default async function NewTeacherPage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/teachers", label: "Teachers" }}
        title="Add teacher"
        description="Creates the staff record and the teacher's sign-in together."
      />
      <CreateTeacherForm />
    </>
  );
}
