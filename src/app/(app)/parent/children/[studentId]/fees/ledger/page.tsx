import type { Metadata } from "next";

import { LedgerView } from "@/features/finance/ledger-screen";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getChildLedger } from "@/server/parent/child";

export const metadata: Metadata = { title: "Fee statement" };

/** A child's fee statement — read-only, and only for a child linked to this parent. */
export default async function ChildFeeLedgerPage(props: PageProps<"/parent/children/[studentId]/fees/ledger">) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;
  const { ledger } = await orNotFound(getChildLedger(ctx, studentId));
  return <LedgerView ledger={ledger} back={{ href: `/parent/children/${studentId}/fees`, label: "Fees" }} />;
}
