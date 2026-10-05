import type { Metadata } from "next";

import { InventoryScreen } from "@/features/operations/inventory-screen";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";

export const metadata: Metadata = { title: "Inventory" };

/** Inventory for staff the School Admin allowed (a lab assistant): view, and manage only with that permission. */
export default async function StaffInventoryPage(props: PageProps<"/staff/inventory">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "inventory.view");
  return <InventoryScreen ctx={ctx} search={await props.searchParams} basePath="/staff/inventory" canManage={await staffHolds(ctx, "inventory.manage")} isAdmin={false} />;
}
