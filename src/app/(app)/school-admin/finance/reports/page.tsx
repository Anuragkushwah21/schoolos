import type { Metadata } from "next";

import { FeeReportsScreen } from "@/features/finance/fee-reports-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Fee reports" };

export default async function AdminFeeReportsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  return <FeeReportsScreen ctx={ctx} exportBase="/school-admin/reports/export" canApplyLateFees canSetPolicy />;
}
