import type { Metadata } from "next";
import { HeartHandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SupportForm } from "@/features/support/forms";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { supportFormOptions } from "@/server/support/service";

export const metadata: Metadata = { title: "Add support" };

/** The office adds support and, if it wishes, names the teacher who looks after it. */
export default async function NewAdminSupportPage(props: PageProps<"/school-admin/support/new">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const [t, options] = await Promise.all([getT(), supportFormOptions(ctx)]);
  const concernId = param(search.concern);
  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" back={{ href: "/school-admin/support", label: t("support.title") }} title={t("support.addSupport")} />
      <SupportForm
        students={options.students}
        subjects={options.subjects}
        teachers={options.teachers}
        defaults={{ studentId: param(search.student), subjectId: param(search.subject) ?? null, concernId, reason: concernId ? "PARENT_CONCERN" : undefined }}
      />
    </>
  );
}
