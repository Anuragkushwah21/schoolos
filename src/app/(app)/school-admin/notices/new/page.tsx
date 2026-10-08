import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { NoticeForm } from "@/features/communication/forms";
import { today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { noticeTargetOptions } from "@/server/communication/notices";

export const metadata: Metadata = { title: "New notice" };

export default async function NewNoticePage(props: PageProps<"/school-admin/notices/new">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const options = await noticeTargetOptions(ctx);
  const asked = param((await props.searchParams).kind);
  const kind = asked === "ANNOUNCEMENT" || asked === "EMERGENCY" ? asked : "NOTICE";
  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/communication", label: "Communication" }}
        title={kind === "EMERGENCY" ? "New emergency alert" : kind === "ANNOUNCEMENT" ? "New announcement" : "New notice"}
      />
      <NoticeForm minExpiry={toDateInput(today())} classes={options.classes} sections={options.sections} streams={options.streams} kind={kind} />
    </>
  );
}
