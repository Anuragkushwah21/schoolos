import type { Metadata } from "next";
import { MessagesSquareIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ConcernDetailView } from "@/features/concerns/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/page-helpers";
import { concernFilterOptions, getConcern } from "@/server/support/concerns";

export const metadata: Metadata = { title: "Concern" };

export default async function AdminConcernPage(props: PageProps<"/school-admin/concerns/[concernId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { concernId } = await props.params;
  const [t, concern, options] = await Promise.all([getT(), orNotFound(getConcern(ctx, concernId)), concernFilterOptions(ctx)]);
  return (
    <>
      <PageHeader
        icon={MessagesSquareIcon}
        tone="blue"
        back={{ href: "/school-admin/concerns", label: t("concerns.title") }}
        title={`${concern.student} · ${concern.subject ?? ""}`}
        description={`${concern.group ?? ""} · ${concern.ref}`}
      />
      <ConcernDetailView concern={concern} teachers={options.teachers} />
    </>
  );
}
