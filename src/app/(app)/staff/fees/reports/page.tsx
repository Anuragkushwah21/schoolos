import type { Metadata } from "next";

import { FeeReportsScreen } from "@/features/finance/fee-reports-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Fee reports" };

/** Fee reports for staff with "Finance reports" (the service checks again). */
export default async function StaffFeeReportsPage() {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, ["fees.reports"]);
  const grants: string[] = await staffGrants(ctx);
  return <FeeReportsScreen ctx={ctx} exportBase="/staff/finance/export" canApplyLateFees={grants.includes("fees.manage")} canSetPolicy={false} />;
}
