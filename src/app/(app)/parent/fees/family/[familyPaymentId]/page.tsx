import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { FamilyReceiptView } from "@/features/finance/family-desk";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Family receipt" };

/** A family receipt for this parent only — another family's is "not found". */
export default async function ParentFamilyReceiptPage(props: PageProps<"/parent/fees/family/[familyPaymentId]">) {
  const ctx = await requireTenant("PARENT");
  const { familyPaymentId } = await props.params;
  const view = await orNotFound(FamilyReceiptView({ ctx, familyPaymentId, back: "/parent/fees" }));
  return (
    <>
      <PageHeader back={{ href: "/parent/fees", label: "Fees" }} title="Family receipt" />
      {view}
    </>
  );
}
