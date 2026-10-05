import type { Metadata } from "next";

import { PayrollScreen } from "@/features/finance/payroll-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Payroll" };

/** One month's payroll. Amounts can be adjusted before paying (unpaid leave, arrears); nothing is paid twice. */
export default async function PayrollPage(props: PageProps<"/school-admin/finance/payroll">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  return <PayrollScreen ctx={ctx} search={await props.searchParams} basePath="/school-admin/finance/payroll" back={{ href: "/school-admin/finance", label: "Finance" }} canPay />;
}
