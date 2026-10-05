import type { Metadata } from "next";
import { UsersIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { FamilyDesk } from "@/features/finance/family-desk";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Family payment" };

export default async function FamilyPaymentPage(props: PageProps<"/school-admin/finance/family">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  return (
    <>
      <PageHeader icon={UsersIcon} tone="orange" title="Family payment" description="Each child's fees separately, the family total, and one payment split per child." />
      <FamilyDesk ctx={ctx} base="/school-admin/finance/family" parentId={param(search.parent)} />
    </>
  );
}
