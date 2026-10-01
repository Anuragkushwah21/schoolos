import type { Metadata } from "next";
import { MessagesSquareIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ConcernDetailView } from "@/features/concerns/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/page-helpers";
import { getConcern } from "@/server/support/concerns";

export const metadata: Metadata = { title: "Concern" };

export default async function TeacherConcernPage(props: PageProps<"/teacher/concerns/[concernId]">) {
  const ctx = await requireTenant("TEACHER");
  const { concernId } = await props.params;
  const [t, concern] = await Promise.all([getT(), orNotFound(getConcern(ctx, concernId))]);
  return (
    <>
      <PageHeader
        icon={MessagesSquareIcon}
        tone="blue"
        back={{ href: "/teacher/concerns", label: t("concerns.myTitle") }}
        title={`${concern.student} · ${concern.subject ?? ""}`}
        description={concern.group ?? undefined}
      />
      <ConcernDetailView concern={concern} />
    </>
  );
}
