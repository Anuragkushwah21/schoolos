import type { Metadata } from "next";
import { HeartHandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { SupportDetailView } from "@/features/support/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { orHidden } from "@/server/page-helpers";
import { getSupport } from "@/server/support/service";

export const metadata: Metadata = { title: "Student support" };

export default async function TeacherSupportDetailPage(props: PageProps<"/teacher/support/[supportId]">) {
  const ctx = await requireTenant("TEACHER");
  const { supportId } = await props.params;
  const [t, support] = await Promise.all([getT(), orHidden(getSupport(ctx, supportId))]);
  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" back={{ href: "/teacher/support", label: t("support.title") }} title={t("support.additionalSupport")} />
      <SupportDetailView support={support} />
    </>
  );
}
