import type { Metadata, Route } from "next";
import { HeartHandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SupportDetailView } from "@/features/support/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/page-helpers";
import { getSupport } from "@/server/support/service";

export const metadata: Metadata = { title: "Student support" };

export default async function AdminSupportDetailPage(props: PageProps<"/school-admin/support/[supportId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { supportId } = await props.params;
  const [t, support] = await Promise.all([getT(), orNotFound(getSupport(ctx, supportId))]);
  // An extra class is arranged as a meeting for the student and their family.
  const extraClassHref = support.action === "EXTRA_CLASS" && !support.extraClass && support.status !== "RESOLVED" ? (`/school-admin/meetings/new?support=${support.id}` as Route) : null;
  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" back={{ href: "/school-admin/support", label: t("support.title") }} title={t("support.additionalSupport")} />
      <SupportDetailView support={support} extraClassHref={extraClassHref} />
    </>
  );
}
