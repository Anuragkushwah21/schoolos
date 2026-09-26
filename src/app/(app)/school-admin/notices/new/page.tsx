import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { NoticeForm } from "@/features/communication/forms";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New notice" };

export default async function NewNoticePage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader back={{ href: "/school-admin/notices", label: "Notices" }} title="New notice" />
      <NoticeForm />
    </>
  );
}
