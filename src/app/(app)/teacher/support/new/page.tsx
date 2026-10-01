import type { Metadata } from "next";
import { HeartHandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SupportForm } from "@/features/support/forms";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { supportFormOptions } from "@/server/support/service";

export const metadata: Metadata = { title: "Add support" };

/** Student → subject → reason → what will be done → save. */
export default async function NewTeacherSupportPage(props: PageProps<"/teacher/support/new">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const [t, options] = await Promise.all([getT(), supportFormOptions(ctx)]);
  const concernId = param(search.concern);
  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" back={{ href: "/teacher/support", label: t("support.title") }} title={t("support.addSupport")} />
      <SupportForm
        students={options.students}
        subjects={options.subjects}
        subjectsByStudent={options.subjectsByStudent}
        generalStudentIds={options.generalStudentIds}
        defaults={{
          // Hints only: the server re-checks the student, subject and concern.
          studentId: param(search.student),
          subjectId: param(search.subject) ?? null,
          concernId,
          reason: concernId ? "PARENT_CONCERN" : undefined,
        }}
      />
    </>
  );
}
