import type { Metadata } from "next";

import { PayrollScreen } from "@/features/finance/payroll-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Payroll" };

/** Payroll for staff the School Admin allowed: view, and pay only with "Record salary payments". */
export default async function StaffPayrollPage(props: PageProps<"/staff/payroll">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "payroll.view");
  return <PayrollScreen ctx={ctx} search={await props.searchParams} basePath="/staff/payroll" canPay={await staffHolds(ctx, "payroll.pay")} />;
}
