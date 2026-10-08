import type { Metadata } from "next";

import { VisitorsScreen } from "@/features/visitors/visitors-screen";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Visitors" };

export default async function AdminVisitorsPage(props: PageProps<"/school-admin/visitors">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  return <VisitorsScreen ctx={ctx} search={await props.searchParams} base="/school-admin/visitors" canManage />;
}
