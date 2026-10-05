import type { Metadata } from "next";

import { InventoryScreen } from "@/features/operations/inventory-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Inventory" };

/** Assets, where they are, who has them and their condition. */
export default async function InventoryPage(props: PageProps<"/school-admin/inventory">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  return <InventoryScreen ctx={ctx} search={await props.searchParams} basePath="/school-admin/inventory" canManage isAdmin />;
}
