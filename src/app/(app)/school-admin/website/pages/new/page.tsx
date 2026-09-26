import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { PageForm } from "@/features/website/forms";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New page" };

export default async function NewWebsitePage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader back={{ href: "/admin/website", label: "Website" }} title="New page" />
      <PageForm />
    </>
  );
}
