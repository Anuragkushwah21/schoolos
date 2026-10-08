import type { Metadata } from "next";

import { ReportsScreen } from "@/features/reports/reports-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage(props: PageProps<"/school-admin/reports">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <ReportsScreen ctx={ctx} searchParams={await props.searchParams} />;
}
