import type { Metadata } from "next";

import { ResponsibilitiesScreen } from "@/features/responsibilities/responsibilities-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Responsibilities" };

/** Assign, follow and confirm responsibilities — the School Admin and the Principal. */
export default async function ResponsibilitiesPage(props: PageProps<"/school-admin/responsibilities">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  return <ResponsibilitiesScreen ctx={ctx} search={await props.searchParams} base="/school-admin/responsibilities" />;
}
