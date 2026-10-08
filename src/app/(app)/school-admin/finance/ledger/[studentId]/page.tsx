import type { Metadata } from "next";

import { LedgerView } from "@/features/finance/ledger-screen";
import { orNotFound } from "@/server/page-helpers";
import { requireTenant } from "@/server/auth/current-user";
import { studentLedger } from "@/server/finance/fee-reports";

export const metadata: Metadata = { title: "Fee ledger" };

export default async function AdminLedgerPage(props: PageProps<"/school-admin/finance/ledger/[studentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { studentId } = await props.params;
  const ledger = await orNotFound(studentLedger(ctx, studentId));
  return <LedgerView ledger={ledger} back={{ href: `/school-admin/finance/payments?student=${studentId}`, label: "Payments" }} csvHref={`/school-admin/reports/export?kind=fees-ledger&student=${studentId}`} />;
}
