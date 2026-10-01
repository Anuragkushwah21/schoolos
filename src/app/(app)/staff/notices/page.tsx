import { MegaphoneIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { NoticesScreen } from "@/features/notices/notices-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Notices" };

/** Notices only — information from the school. Events and meetings have their own pages. */
export default async function NoticesPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  return (
    <>
      <PageHeader icon={MegaphoneIcon} tone="amber" title="Notices" description="Messages and announcements from your school. Unread ones are outlined." />
      <NoticesScreen ctx={ctx} />
    </>
  );
}
