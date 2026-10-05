import type { Metadata } from "next";

import { ExpensesScreen } from "@/features/finance/expenses-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Expenses" };

/** What the school has spent, other than salaries. Every row is read through the session's own school. */
export default async function ExpensesPage(props: PageProps<"/school-admin/finance/expenses">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  return <ExpensesScreen ctx={ctx} search={await props.searchParams} basePath="/school-admin/finance/expenses" back={{ href: "/school-admin/finance", label: "Finance" }} canCreate canDelete />;
}
