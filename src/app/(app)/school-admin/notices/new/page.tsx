import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { NoticeForm } from "@/features/communication/forms";
import { today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { noticeTargetOptions } from "@/server/communication/notices";

export const metadata: Metadata = { title: "New notice" };

export default async function NewNoticePage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const options = await noticeTargetOptions(ctx);
  return (
    <>
      <PageHeader back={{ href: "/school-admin/notices", label: "Notices" }} title="New notice" />
      <NoticeForm minExpiry={toDateInput(today())} classes={options.classes} sections={options.sections} />
    </>
  );
}
