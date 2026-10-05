import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { FamilyReceiptView } from "@/features/finance/family-desk";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Family receipt" };

export default async function FamilyReceiptPage(props: PageProps<"/school-admin/finance/family/[familyPaymentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { familyPaymentId } = await props.params;
  const view = await orNotFound(FamilyReceiptView({ ctx, familyPaymentId, back: "/school-admin/finance/family" }));
  return (
    <>
      <PageHeader back={{ href: "/school-admin/finance/family", label: "Family payment" }} title="Family receipt" />
      {view}
    </>
  );
}
