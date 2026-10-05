import type { Metadata } from "next";

import { ExpensesScreen } from "@/features/finance/expenses-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffGrants } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Expenses" };

/** Expenses for staff the School Admin allowed: view, and record or remove only with those permissions. */
export default async function StaffExpensesPage(props: PageProps<"/staff/expenses">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "expenses.view");
  const grants: string[] = await staffGrants(ctx);
  return <ExpensesScreen ctx={ctx} search={await props.searchParams} basePath="/staff/expenses" canCreate={grants.includes("expenses.create")} canDelete={grants.includes("expenses.delete")} />;
}
