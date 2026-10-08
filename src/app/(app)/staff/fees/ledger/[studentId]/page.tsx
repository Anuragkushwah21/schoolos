import type { Metadata } from "next";

import { LedgerView } from "@/features/finance/ledger-screen";
import { orNotFound } from "@/server/page-helpers";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";
import { studentLedger } from "@/server/finance/fee-reports";

export const metadata: Metadata = { title: "Fee ledger" };

export default async function StaffLedgerPage(props: PageProps<"/staff/fees/ledger/[studentId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.view", "fees.collect", "fees.manage", "fees.reports"]);
  const { studentId } = await props.params;
  const grants: string[] = await staffGrants(ctx);
  const ledger = await orNotFound(studentLedger(ctx, studentId));
  return <LedgerView ledger={ledger} back={{ href: `/staff/fees?student=${studentId}`, label: "Fees" }} csvHref={grants.includes("fees.reports") ? `/staff/finance/export?kind=fees-ledger&student=${studentId}` : undefined} />;
}
