import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { FamilyReceiptView } from "@/features/finance/family-desk";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule } from "@/server/auth/staff-access";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Family receipt" };

export default async function FamilyReceiptPage(props: PageProps<"/staff/fees/family/[familyPaymentId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "fees.collect");
  const { familyPaymentId } = await props.params;
  const view = await orNotFound(FamilyReceiptView({ ctx, familyPaymentId, back: "/staff/fees/family" }));
  return (
    <>
      <PageHeader back={{ href: "/staff/fees/family", label: "Family payment" }} title="Family receipt" />
      {view}
    </>
  );
}
