import type { Metadata } from "next";
import { MessagesSquareIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ConcernDetailView } from "@/features/concerns/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/page-helpers";
import { getConcern } from "@/server/support/concerns";

export const metadata: Metadata = { title: "Concern" };

export default async function ParentConcernPage(props: PageProps<"/parent/concerns/[concernId]">) {
  const ctx = await requireTenant("PARENT");
  const { concernId } = await props.params;
  const [t, concern] = await Promise.all([getT(), orNotFound(getConcern(ctx, concernId))]);
  return (
    <>
      <PageHeader
        icon={MessagesSquareIcon}
        tone="blue"
        back={{ href: "/parent/concerns", label: t("concerns.parentTitle") }}
        title={`${concern.student} · ${concern.subject ?? ""}`}
        description={concern.group ?? undefined}
      />
      <ConcernDetailView concern={concern} />
    </>
  );
}
